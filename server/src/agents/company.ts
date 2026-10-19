import { db } from '../db.js';
import { emit, sleep } from '../events.js';
import { band } from '../bus/band.js';
import { config } from '../config.js';
import { id, now, estTokens } from '../util.js';
import { ROSTER, employee, FOUNDER } from './roster.js';
import { classify, severityFor, type Classification } from './classify.js';
import { complete, completeJson, recordOffline } from '../integrations/flatkey.js';
import { runPipeline } from '../integrations/rocketride.js';
import { investigateUrl } from '../integrations/forensics.js';
import { runAudit } from '../integrations/audit.js';
import { runAutomation } from '../integrations/n8n.js';
import { say } from '../integrations/masky.js';
import { compressContext } from '../integrations/paritok.js';
import { skillPrompt } from '../integrations/finch.js';
import { wikiText, blocklist, addToBlocklist } from '../integrations/promptql.js';
import type { AgentId, AgentStatus, Audit, Channel, Incident, IncidentKind, Member, Message } from '../types.js';

// ───────────────────────────── Shared state helpers ─────────────────────────────

export const agentStatus: Record<string, { status: AgentStatus; task: string | null }> = Object.fromEntries(ROSTER.map((e) => [e.id, { status: 'idle', task: null }]));
const idleTimers: Record<string, NodeJS.Timeout> = {};
export function setStatus(agentId: AgentId, status: AgentStatus, task: string | null = null, autoIdleMs = 0) {
  agentStatus[agentId] = { status, task };
  emit('agent.status', { agentId, status, task });
  clearTimeout(idleTimers[agentId]);
  if (autoIdleMs) idleTimers[agentId] = setTimeout(() => setStatus(agentId, 'idle', null), autoIdleMs);
}
const toast = (level: 'info' | 'success' | 'warn' | 'error', title: string, body?: string, agentId?: AgentId) => emit('toast', { level, title, body, agentId });

const getMember = (mid: string | null) => (mid ? db.get<Member>('members', mid) : undefined);
const getChannel = (cid: string | null) => (cid ? db.get<Channel>('channels', cid) : undefined);
function updateMessage(mid: string, patch: Partial<Message>) { const m = db.update<Message>('messages', mid, patch); emit('community.message.updated', m); return m; }
function updateIncident(iid: string, patch: Partial<Incident>) { const inc = db.update<Incident>('incidents', iid, { ...patch, updatedAt: now() }); emit('incident.upsert', inc); pushMetrics(); return inc; }
function updateMember(mid: string, patch: Partial<Member>) { const m = db.update<Member>('members', mid, patch); emit('member.updated', m); return m; }

/** Post a message into a community channel as an AI employee (Haven bot) or system. */
export function postAs(agentId: AgentId | null, channelId: string, content: string, replyTo: string | null = null, authorKind: Message['authorKind'] = 'agent') {
  const msg: Message = { id: id('msg'), channelId, memberId: null, authorKind, agentId, content, createdAt: now(), status: 'visible', risk: 0, labels: [], incidentId: null, replyTo };
  db.insert('messages', msg);
  emit('community.message', msg);
  return msg;
}

const firstAction = new Map<string, number>();
function markFirstAction(inc: Incident) {
  if (firstAction.has(inc.id)) return;
  const t = now();
  firstAction.set(inc.id, t);
  updateIncident(inc.id, { timeToActionMs: t - inc.createdAt });
}

/** Context every AI employee receives: persona, Finch skills and the PromptQL shared wiki. */
function systemFor(agentId: AgentId, extra = '') {
  const e = employee(agentId);
  return `You are ${e.name}, ${e.title} at Haven — an AI-native Trust & Safety company that protects online communities. You report to ${e.reportsTo === 'founder' ? `${FOUNDER.name}, the human founder` : employee(e.reportsTo as AgentId).name}.
Personality: ${e.personality}
Responsibilities: ${e.responsibilities.join('; ')}.
Skills (from Finch):\n${safe(() => skillPrompt(agentId), '')}
Shared company wiki (PromptQL context):\n${safe(() => wikiText(), '').slice(0, 2500)}
${extra}`;
}
function safe<T>(fn: () => T, fb: T): T { try { return fn(); } catch { return fb; } }

// ───────────────────────────── Metrics ─────────────────────────────

let metricsTimer: NodeJS.Timeout | null = null;
export function pushMetrics() {
  if (metricsTimer) return;
  metricsTimer = setTimeout(() => { metricsTimer = null; emit('metrics', metrics()); }, 250);
}
export function metrics() {
  const screened = db.kvGet<number>('screened_base', 0) + db.kvGet<number>('screened_live', 0);
  const incidents = db.list<Incident>('incidents', '', [], 'created_at DESC', 5000);
  const resolved = incidents.filter((i) => i.status === 'resolved');
  const ttas = incidents.map((i) => i.timeToActionMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const median = ttas.length ? ttas[Math.floor(ttas.length / 2)] : 0;
  const llm = db.raw(`SELECT model, COUNT(*) as calls, SUM(cost_usd) as cost FROM llm_calls GROUP BY model ORDER BY cost DESC, calls DESC LIMIT 8`);
  const spend = db.raw(`SELECT COALESCE(SUM(cost_usd),0) as s, COUNT(*) as c FROM llm_calls`)[0];
  const saved = db.raw(`SELECT COALESCE(SUM(before_tokens - after_tokens),0) as s FROM compressions`)[0];
  const comms = db.list<any>('communities');
  const byKind: Record<string, number> = {};
  for (const i of incidents) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const hour = 3600000;
  const tNow = now();
  const timeline = Array.from({ length: 24 }, (_, k) => {
    const t0 = tNow - (24 - k) * hour, t1 = t0 + hour;
    const s = db.count('messages', 'created_at >= ? AND created_at < ?', [t0, t1]);
    const th = incidents.filter((i) => i.createdAt >= t0 && i.createdAt < t1).length;
    return { t: t1, screened: s, threats: th };
  });
  const threatsBlocked = incidents.filter((i) => i.status === 'resolved' || i.actionTaken).length;
  const llmSpend = Number(spend?.s ?? 0);
  return {
    screened, threatsBlocked, incidentsOpen: incidents.filter((i) => ['open', 'investigating'].includes(i.status)).length,
    incidentsResolved: resolved.length, awaitingApproval: incidents.filter((i) => i.status === 'awaiting_approval').length,
    medianTimeToActionMs: median, llmSpendUsd: llmSpend, llmCalls: Number(spend?.c ?? 0), tokensSaved: Number(saved?.s ?? 0),
    communities: comms.length, members: comms.reduce((a, c) => a + c.members, 0), mrr: comms.reduce((a, c) => a + c.mrr, 0),
    humanHoursSaved: Math.round((screened * 6) / 3600 + incidents.length * 0.4),
    costPerIncidentUsd: incidents.length ? Math.max(0.002, llmSpend / Math.max(1, incidents.length)) : 0,
    byKind, byModel: llm.map((r) => ({ model: r.model, calls: Number(r.calls), costUsd: Number(r.cost ?? 0) })), timeline,
  };
}

// ───────────────────────────── Nova: screening every message ─────────────────────────────

const recentByChannel = new Map<string, { t: number; memberId: string | null; content: string }[]>();
const burstClaims = new Map<string, { id: string; t: number; members: Set<string> }>();

export async function screenMessage(msg: Message) {
  db.kvSet('screened_live', db.kvGet<number>('screened_live', 0) + 1);
  pushMetrics();
  if (msg.authorKind !== 'member') return;
  const member = getMember(msg.memberId);
  const channel = getChannel(msg.channelId);
  const bl = safe(() => blocklist(), [] as string[]);
  const fast = classify(msg.content, bl);

  // Raid detection: burst of near-identical messages from fresh accounts in one channel.
  const rec = (recentByChannel.get(msg.channelId) ?? []).filter((r) => now() - r.t < 20000);
  rec.push({ t: now(), memberId: msg.memberId, content: msg.content });
  recentByChannel.set(msg.channelId, rec);
  const fresh = member && now() - member.joinedAt < 3600000;
  const similar = rec.filter((r) => r.content.slice(0, 24) === msg.content.slice(0, 24) && r.memberId !== msg.memberId).length;
  if (fresh && similar >= 2) { fast.kind = 'raid'; fast.risk = Math.max(fast.risk, 78); fast.labels.push('coordinated-burst'); fast.reasons.push(`${similar + 1} fresh accounts posted the same text within 20s`); }

  if (fast.risk < 20 && !fast.urls.length) {
    if (fast.risk !== msg.risk) updateMessage(msg.id, { risk: fast.risk });
    return; // fast path: cleared in < 1ms
  }

  setStatus('nova', 'working', `Screening message in #${channel?.name}`);
  updateMessage(msg.id, { status: 'under_review', risk: fast.risk, labels: fast.labels });
  band.send({ from: 'gateway', to: 'nova', kind: 'delegate', subject: `Screen message in #${channel?.name}`, body: `@${member?.handle}: "${msg.content.slice(0, 140)}"`, payload: { messageId: msg.id, fastRisk: fast.risk } });

  // Collapse bursts (raids / spam waves) into the incident already open (or being opened) for this channel.
  const burst = fast.kind === 'raid' || fast.kind === 'spam' || fast.labels.includes('raid-invite');
  if (burst) {
    const pending = burstClaims.get(msg.channelId);
    const openRow = db.list<Incident>('incidents', "channel_id = ? AND kind IN ('raid','spam') AND status != 'resolved' AND status != 'dismissed' AND created_at > ?", [msg.channelId, now() - 120000], 'created_at DESC', 1)[0];
    const targetId = pending && now() - pending.t < 120000 ? pending.id : openRow?.id;
    if (targetId) {
      updateMessage(msg.id, { status: 'quarantined', incidentId: targetId, risk: Math.max(fast.risk, 78), labels: [...new Set([...fast.labels, 'coordinated-burst'])] });
      if (pending && msg.memberId) pending.members.add(msg.memberId);
      const row = db.get<Incident>('incidents', targetId);
      if (row) {
        const raiders = new Set<string>(((row.evidence ?? []).find((e: any) => e.type === 'raiders')?.members ?? []));
        if (msg.memberId) raiders.add(msg.memberId);
        updateIncident(row.id, { kind: 'raid', evidence: [...(row.evidence ?? []).filter((e: any) => e.type !== 'raiders'), { type: 'raiders', members: [...raiders] }], summary: `${raiders.size} fresh accounts posting the same invite — all quarantined.` });
      }
      band.send({ from: 'nova', to: 'aria', kind: 'report', subject: `${targetId}: +1 burst message quarantined`, body: `@${member?.handle} joined the wave — quarantined automatically.`, incidentId: targetId });
      setStatus('nova', 'idle');
      return;
    }
  }

  let cls: Classification & { rationale?: string } = fast;
  const incId = id('inc');
  if (burst) burstClaims.set(msg.channelId, { id: incId, t: now(), members: new Set(msg.memberId ? [msg.memberId] : []) });
  const run = await runPipeline('message-triage', { text: msg.content, agentId: 'nova', messageId: msg.id, channel: channel?.name }, {
    incidentId: incId,
    handlers: {
      guardrails_1: (input: any) => ({ ...(typeof input === 'object' ? input : { text: input }), policy: { blocklistHits: fast.labels.includes('blocklisted-domain'), patterns: fast.reasons } }),
      llm_openai_1: async () => {
        const r = await completeJson<{ risk: number; kind: string | null; labels: string[]; rationale: string }>({
          agentId: 'nova', purpose: 'triage-classify', tier: 'fast', timeoutMs: 7000, maxTokens: 220,
          system: `${systemFor('nova')}\nClassify a community message for Trust & Safety. Return JSON {"risk":0-100,"kind":"phishing|scam|harassment|crisis|spam|hate|raid|null","labels":[..],"rationale":"one sentence"}. Heuristic pre-score: ${fast.risk} (${fast.reasons.join(', ') || 'none'}).`,
          messages: [{ role: 'user', content: `Channel #${channel?.name}. Author @${member?.handle} (trust ${member?.trustScore}, joined ${member ? Math.round((now() - member.joinedAt) / 86400000) : '?'}d ago).\nMessage: ${msg.content}` }],
        });
        if (r?.data && typeof r.data.risk === 'number') {
          const kind = (r.data.kind && r.data.kind !== 'null' ? r.data.kind : fast.kind) as IncidentKind | null;
          // Blend model + heuristic so a single model hiccup can't wave a blocklisted link through.
          cls = { ...fast, risk: Math.round(Math.max(fast.labels.includes('blocklisted-domain') ? fast.risk : 0, 0.6 * r.data.risk + 0.4 * fast.risk)), kind: kind ?? fast.kind, labels: [...new Set([...(fast.labels), ...(r.data.labels ?? [])])].slice(0, 6), rationale: r.data.rationale };
          return { model: r.meta.model, ...r.data };
        }
        recordOffline('nova', 'triage-classify', 'fast', msg.content, JSON.stringify(fast));
        return { model: 'offline-brain', risk: fast.risk, kind: fast.kind, labels: fast.labels, rationale: fast.reasons.join('; ') };
      },
      extract_data_1: () => ({ route: cls.risk >= 35 && cls.kind ? `open-incident:${cls.kind}` : 'clear', risk: cls.risk, kind: cls.kind }),
    },
  }).catch((e) => { console.error('[nova] pipeline failed', e); return null; });

  if (cls.risk < 35 || !cls.kind) {
    if (burstClaims.get(msg.channelId)?.id === incId) burstClaims.delete(msg.channelId);
    updateMessage(msg.id, { status: 'visible', risk: cls.risk, labels: cls.labels });
    band.send({ from: 'nova', to: 'gateway', kind: 'ack', subject: 'Cleared', body: `Risk ${cls.risk}/100 — no action needed.`, payload: { messageId: msg.id } });
    setStatus('nova', 'idle');
    return;
  }

  const kind = cls.kind;
  const severity = severityFor(kind, cls.risk) as Incident['severity'];
  const inc: Incident = {
    id: incId, kind, severity, status: 'investigating', title: titleFor(kind, channel?.name ?? '', member?.handle ?? ''),
    summary: cls.rationale ?? `Nova flagged this message (${cls.reasons.join(', ')}).`, messageId: msg.id, memberId: msg.memberId, channelId: msg.channelId,
    communityId: channel?.communityId ?? null, assignedTo: 'aria', verdict: { triage: { risk: cls.risk, labels: cls.labels, reasons: cls.reasons } }, evidence: [{ type: 'message', content: msg.content }],
    recommendedAction: null, actionTaken: null, createdAt: msg.createdAt, updatedAt: now(), resolvedAt: null, timeToActionMs: null, risk: cls.risk,
  };
  db.insert('incidents', inc);
  emit('incident.upsert', inc);
  if (run) db.update('pipeline_runs', run.id, { incidentId: inc.id });
  if (burst && (fast.kind === 'raid' || fast.labels.includes('raid-invite'))) { inc.kind = 'raid'; inc.title = titleFor('raid', channel?.name ?? '', ''); }
  if (burst) { inc.evidence.push({ type: 'raiders', members: [...(burstClaims.get(msg.channelId)?.members ?? [])] }); }
  updateMessage(msg.id, { incidentId: inc.id, risk: cls.risk, labels: cls.labels });
  pushMetrics();

  // Auto-action policy (wiki: auto-action-policy): quarantine malicious links and spam immediately; never hide crisis messages.
  if ((kind === 'phishing' || kind === 'scam') && cls.risk >= 60 || kind === 'spam' || kind === 'raid' || kind === 'hate') {
    updateMessage(msg.id, { status: 'quarantined' });
    markFirstAction(inc);
  }
  band.send({ from: 'nova', to: 'aria', kind: 'report', subject: `${inc.id}: ${kind} suspected (risk ${cls.risk})`, body: `${inc.title}. ${kind === 'crisis' ? 'Message left visible per crisis protocol.' : 'Message quarantined pending investigation.'}`, incidentId: inc.id, payload: { kind, risk: cls.risk, labels: cls.labels } });
  setStatus('nova', 'idle');
  void aria(inc, cls);
}

function titleFor(kind: IncidentKind, ch: string, handle: string) {
  return {
    phishing: `Phishing link posted in #${ch}`, scam: `Crypto scam targeting #${ch}`, harassment: `@${handle} harassing a member in #${ch}`,
    crisis: `Member in crisis in #${ch}`, spam: `Spam burst in #${ch}`, hate: `Hate speech in #${ch}`, raid: `Coordinated raid on #${ch}`, bot_risk: `Risky bot requested`,
  }[kind];
}

// ───────────────────────────── Aria: routing & decisions ─────────────────────────────

async function aria(inc: Incident, cls: Classification) {
  setStatus('aria', 'thinking', `Routing ${inc.id}`);
  await sleep(450);
  const route: Record<IncidentKind, AgentId> = { phishing: 'rex', scam: 'rex', harassment: 'juno', hate: 'juno', crisis: 'mira', spam: 'nova', raid: 'nova', bot_risk: 'kai' };
  const to = route[inc.kind];
  let note = `${employee(to).name}, please take ${inc.id}.`;
  const r = await complete({ agentId: 'aria', purpose: 'route-incident', tier: 'reasoning', timeoutMs: 6000, maxTokens: 90, system: systemFor('aria', 'Write ONE short delegation sentence (max 25 words) to the specialist. No preamble.'), messages: [{ role: 'user', content: `Incident ${inc.id} (${inc.kind}, risk ${inc.risk}): ${inc.title}. Delegate to ${employee(to).name} (${employee(to).title}). Triage reasons: ${cls.reasons.join(', ')}` }] });
  if (r?.text) note = r.text.trim().replace(/^"|"$/g, '');
  else recordOffline('aria', 'route-incident', 'reasoning', inc.title, note);
  updateIncident(inc.id, { assignedTo: to });
  band.send({ from: 'aria', to, kind: 'delegate', subject: `Take ${inc.id}`, body: note, incidentId: inc.id, payload: { kind: inc.kind } });
  setStatus('aria', 'idle');
  await sleep(350);
  try {
    if (to === 'rex') await rex(inc, cls);
    else if (to === 'mira') await mira(inc);
    else if (to === 'juno') await juno(inc);
    else await novaEnforce(inc, cls);
  } catch (e) {
    console.error('[company] specialist failed', e);
    updateIncident(inc.id, { status: 'awaiting_approval', recommendedAction: 'remove', summary: `${inc.summary} (specialist error: ${(e as Error).message})` });
  }
}

/** Ask the founder for a decision: human-in-the-loop. */
function requestApproval(inc: Incident, action: string, rationale: string, from: AgentId) {
  updateIncident(inc.id, { status: 'awaiting_approval', recommendedAction: action, verdict: { ...(db.get<Incident>('incidents', inc.id)?.verdict ?? {}), rationale, recommendedBy: from } });
  band.send({ from, to: 'aria', kind: 'report', subject: `${inc.id}: recommend ${action}`, body: rationale, incidentId: inc.id });
  band.send({ from: 'aria', to: 'founder', kind: 'request', subject: `Approve ${action} for ${inc.id}?`, body: rationale, incidentId: inc.id, payload: { action } });
  void runAutomation('moderator-alert', { incidentId: inc.id, severity: inc.severity, kind: inc.kind, title: inc.title, action, rationale }, `incident ${inc.id}`).catch(() => null);
  toast('warn', `Needs your approval: ${inc.title}`, `${employee(from).name} recommends: ${action}`, 'aria');
}

// ───────────────────────────── Rex: link forensics (AdaL + Celesto) ─────────────────────────────

const LAB_ALIASES: Record<string, string> = {
  'glimmer-rewards-claim.xyz': '/lab/glimmer-rewards',
  'glimmer-airdrop-bonus.click': '/lab/wallet-airdrop',
  'pixelforge.community': '/lab/community-guidelines',
};
export function resolveLabUrl(u: string) {
  try {
    const host = new URL(u).hostname;
    if (LAB_ALIASES[host]) return `http://localhost:${config.port}${LAB_ALIASES[host]}`;
  } catch { /* ignore */ }
  return u;
}

async function rex(inc: Incident, cls: Classification) {
  const url = cls.urls[0];
  if (!url) { await novaEnforce(inc, cls); return; }
  setStatus('rex', 'working', 'Detonating link in Celesto sandbox');
  band.send({ from: 'rex', to: 'aria', kind: 'ack', subject: `On it — detonating ${new URL(url).hostname}`, body: 'Spinning up an isolated computer and driving a browser workflow (AdaL) to collect evidence.', incidentId: inc.id });
  await sleep(300);
  const report = await investigateUrl(resolveLabUrl(url), { incidentId: inc.id });
  const shownHost = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  // Lab fixtures are served locally; show the URL the member actually saw.
  const lab = report.finalUrl?.includes('/lab/');
  const shown = { ...report, url, finalUrl: lab ? url : report.finalUrl, redirects: lab ? [url] : report.redirects };
  updateIncident(inc.id, { evidence: [...(inc.evidence ?? []), { type: 'forensics', report: shown }], verdict: { ...(inc.verdict ?? {}), forensics: { verdict: report.verdict, score: report.score } } });
  db.kvSet(`forensics:${inc.id}`, shown);
  setStatus('rex', 'idle');
  const malicious = report.verdict === 'malicious' || report.verdict === 'suspicious' && inc.risk >= 60;
  band.send({ from: 'rex', to: 'aria', kind: 'report', subject: `${inc.id}: ${report.verdict.toUpperCase()} (score ${report.score})`, body: report.signals.slice(0, 4).map((s) => s.label).join(' · ') || 'no strong signals', incidentId: inc.id, payload: { verdict: report.verdict, score: report.score, screenshot: report.screenshot } });
  const msg = inc.messageId ? db.get<Message>('messages', inc.messageId) : undefined;
  if (malicious) {
    if (msg && msg.status !== 'quarantined') updateMessage(msg.id, { status: 'quarantined' });
    markFirstAction(db.get<Incident>('incidents', inc.id)!);
    const domain = report.domain?.lookalikeOf ? shownHost : shownHost;
    safe(() => addToBlocklist(domain, 'rex'), undefined);
    await sleep(400);
    band.send({ from: 'rex', to: 'juno', kind: 'handoff', subject: `New indicator: ${domain}`, body: 'Added to the shared blocklist (PromptQL wiki). Future posts of this domain are quarantined in < 1s.', incidentId: inc.id });
    void juno_learn(inc, domain);
    const ch = getChannel(inc.channelId);
    if (ch) postAs('rex', ch.id, `🛡 Heads up #${ch.name}: I just detonated a link shared here in an isolated sandbox — **${shownHost}** is a ${inc.kind === 'scam' ? 'wallet-draining scam' : 'credential-harvesting phishing page'}. It's quarantined. Never enter your password or seed phrase outside the official app.`, inc.messageId);
    void say('rex', `Heads up. That link in ${ch?.name ?? 'the channel'} is a ${inc.kind === 'scam' ? 'crypto scam' : 'phishing page'}. I've quarantined it. Please don't enter your password anywhere outside the official app.`, { incidentId: inc.id });
    const member = getMember(inc.memberId);
    requestApproval(db.get<Incident>('incidents', inc.id)!, 'ban', `Evidence: ${report.signals.slice(0, 3).map((s) => s.label).join(', ')}. @${member?.handle ?? 'unknown'} ${member && now() - member.joinedAt < 86400000 ? 'joined today' : 'has posted before'}. Rex's verdict: ${report.verdict} (${report.score}/100). Recommend banning the account.`, 'rex');
  } else {
    if (msg) updateMessage(msg.id, { status: 'visible' });
    updateIncident(inc.id, { status: 'resolved', resolvedAt: now(), actionTaken: 'Link verified benign — message restored', recommendedAction: 'none' });
    band.send({ from: 'aria', to: 'nova', kind: 'ack', subject: `${inc.id} closed`, body: 'Benign link — restored the message. Thanks Rex.', incidentId: inc.id });
  }
}

// ───────────────────────────── Mira: crisis response (Masky voice + n8n paging) ─────────────────────────────

const CRISIS_FALLBACK = (handle: string) => `@${handle}, I'm really glad you said something here, and I'm so sorry you're carrying this much right now. You matter — and you don't have to get through tonight alone. If you're in the US you can call or text **988** (Suicide & Crisis Lifeline) any time; elsewhere, **findahelpline.com** lists free, confidential lines. I've also asked one of our human team to reach out to you directly. Would you be willing to tell me a bit about what today has been like?`;

async function mira(inc: Incident) {
  setStatus('mira', 'thinking', 'Composing a careful reply');
  const member = getMember(inc.memberId);
  const msg = inc.messageId ? db.get<Message>('messages', inc.messageId) : undefined;
  markFirstAction(inc);
  band.send({ from: 'mira', to: 'aria', kind: 'ack', subject: `I have ${inc.id}`, body: 'Responding now. Leaving the message visible (crisis protocol) and paging the human on-call via n8n.', incidentId: inc.id });
  void runAutomation('crisis-escalation', { incidentId: inc.id, member: member?.handle, channel: getChannel(inc.channelId)?.name, excerpt: msg?.content?.slice(0, 200) }, `incident ${inc.id}`).catch(() => null);
  let reply = CRISIS_FALLBACK(member?.handle ?? 'friend');
  const r = await complete({ agentId: 'mira', purpose: 'crisis-reply', tier: 'reasoning', timeoutMs: 9000, maxTokens: 260, system: systemFor('mira', `Write a public reply (<= 90 words) to the member. Warm, human, non-judgmental, no diagnosis, no platitudes. Mention 988 (US call/text) and findahelpline.com. Say a human from the team will reach out. End with one gentle open question. Address them as @${member?.handle}.`), messages: [{ role: 'user', content: msg?.content ?? '' }] });
  if (r?.text && r.text.length > 60) reply = r.text.trim();
  else recordOffline('mira', 'crisis-reply', 'reasoning', msg?.content ?? '', reply);
  setStatus('mira', 'speaking', 'Supporting a member');
  if (inc.channelId) postAs('mira', inc.channelId, reply, inc.messageId);
  void say('mira', reply.replace(/\*\*/g, '').replace(/@[\w.]+,?/g, ''), { incidentId: inc.id });
  setTimeout(() => setStatus('mira', 'waiting', 'Staying with the member until a human joins'), 4000);
  updateIncident(inc.id, { actionTaken: 'Mira replied with crisis resources; human on-call paged' });
  requestApproval(db.get<Incident>('incidents', inc.id)!, 'acknowledge & take over', `@${member?.handle} expressed intent to self-harm. Mira replied within seconds with 988 / findahelpline resources and is staying with them. A human must take over now — per policy this is never auto-closed.`, 'mira');
}

// ───────────────────────────── Juno: policy judgments + learning loop ─────────────────────────────

async function juno(inc: Incident) {
  setStatus('juno', 'thinking', 'Checking community policy');
  const member = getMember(inc.memberId);
  const msg = inc.messageId ? db.get<Message>('messages', inc.messageId) : undefined;
  const priors = db.count('incidents', 'member_id = ? AND id != ?', [inc.memberId ?? '', inc.id]);
  if (msg) updateMessage(msg.id, { status: 'quarantined' });
  markFirstAction(inc);
  let verdict = { rule: inc.kind === 'hate' ? 'H-1 Hate speech' : 'H-2 Targeted harassment', action: priors > 0 || inc.kind === 'hate' ? 'ban' : 'mute 24h', rationale: `Message targets another member with abuse${/before we make you|watch your back/i.test(msg?.content ?? '') ? ' and an implied threat' : ''}. ${priors} prior incident(s). Policy ${inc.kind === 'hate' ? 'H-1' : 'H-2'} applies.` };
  const r = await completeJson<{ rule: string; action: string; rationale: string }>({ agentId: 'juno', purpose: 'policy-judgment', tier: 'reasoning', timeoutMs: 8000, maxTokens: 200, system: systemFor('juno', 'Judge the message against community policy. Return JSON {"rule":"policy clause id + name","action":"warn|mute 24h|ban","rationale":"2 sentences citing evidence"}.'), messages: [{ role: 'user', content: `Author @${member?.handle}, prior incidents: ${priors}. Message: ${msg?.content}` }] });
  if (r?.data?.action) verdict = r.data; else recordOffline('juno', 'policy-judgment', 'reasoning', msg?.content ?? '', JSON.stringify(verdict));
  setStatus('juno', 'idle');
  // Mira checks in on the person being targeted.
  const target = (msg?.content.match(/@([\w.]+)/) ?? [])[1];
  if (target && inc.channelId) {
    setTimeout(() => { postAs('mira', inc.channelId!, `@${target} — I saw that, and I'm sorry. It's not okay and it's being handled right now. You're a valued part of this community 💜`); }, 1200);
    band.send({ from: 'juno', to: 'mira', kind: 'request', subject: `Check in on @${target}`, body: 'They were the target of harassment — please reach out with care.', incidentId: inc.id });
  }
  requestApproval(db.get<Incident>('incidents', inc.id)!, verdict.action, `${verdict.rule}: ${verdict.rationale}`, 'juno');
}

async function juno_learn(inc: Incident, domain: string) {
  await sleep(1500);
  setStatus('juno', 'working', 'Updating policy from incident', 2500);
  band.send({ from: 'juno', to: 'all', kind: 'broadcast', subject: 'Policy updated (learning loop)', body: `Added ${domain} to the shared blocklist. Nova will now quarantine it pre-LLM in < 1ms across all ${db.count('communities')} communities.`, incidentId: inc.id });
}

// ───────────────────────────── Nova: autonomous enforcement (spam / raids) ─────────────────────────────

async function novaEnforce(inc: Incident, cls: Classification) {
  setStatus('nova', 'working', inc.kind === 'raid' ? 'Engaging raid shield' : 'Removing spam');
  const member = getMember(inc.memberId);
  const msg = inc.messageId ? db.get<Message>('messages', inc.messageId) : undefined;
  if (msg) updateMessage(msg.id, { status: 'removed' });
  markFirstAction(inc);
  if (inc.kind === 'raid') {
    const ch = getChannel(inc.channelId);
    // Quarantine every burst message from fresh accounts in this channel.
    const recent = db.list<Message>('messages', 'channel_id = ? AND created_at > ?', [inc.channelId, now() - 30000]);
    const raiders = new Set<string>(((db.get<Incident>('incidents', inc.id)?.evidence ?? []).find((e: any) => e.type === 'raiders')?.members ?? []));
    for (const m of recent) {
      const mem = getMember(m.memberId);
      if (mem && now() - mem.joinedAt < 3600000 && m.authorKind === 'member') { raiders.add(mem.id); if (m.status !== 'removed') updateMessage(m.id, { status: 'quarantined', incidentId: inc.id }); }
    }
    if (ch) postAs('nova', ch.id, `🌊 Raid shield engaged in #${ch.name}: slow-mode on, ${raiders.size} fresh accounts quarantined. Regular members — carry on!`);
    void say('nova', `Raid shield engaged. I've quarantined ${raiders.size} new accounts. Founder approval requested to ban them.`, { incidentId: inc.id });
    setStatus('nova', 'idle');
    requestApproval(db.get<Incident>('incidents', inc.id)!, 'ban', `${raiders.size} accounts created < 1h ago posted near-identical invites within 20s (${cls.reasons.join(', ')}). Recommend banning all of them.`, 'nova');
    const cur = db.get<Incident>('incidents', inc.id)!;
    updateIncident(inc.id, { risk: Math.max(cur.risk, 82), severity: 'high', summary: `${raiders.size} accounts created < 1h ago posted the same invite within seconds — all quarantined; raid shield on.` });
    db.update('incidents', inc.id, { evidence: [...(cur.evidence ?? []).filter((e: any) => e.type !== 'raiders'), { type: 'raiders', members: [...raiders] }] });
    return;
  }
  if (member) updateMember(member.id, { status: 'muted', trustScore: Math.max(0, member.trustScore - 30) });
  band.send({ from: 'nova', to: 'aria', kind: 'report', subject: `${inc.id}: auto-resolved`, body: `Removed ${inc.kind} and muted @${member?.handle} for 1h (auto-action policy). No founder action needed.`, incidentId: inc.id });
  band.send({ from: 'nova', to: 'n8n', kind: 'delegate', subject: 'Log enforcement', body: 'enforcement-log workflow', incidentId: inc.id });
  void runAutomation('enforcement-log', { incidentId: inc.id, action: 'remove+mute 1h', actor: 'nova', member: member?.handle }, `incident ${inc.id}`).catch(() => null);
  updateIncident(inc.id, { status: 'resolved', resolvedAt: now(), actionTaken: 'Removed + muted 1h (auto)', recommendedAction: 'remove' });
  setStatus('nova', 'idle');
  toast('success', 'Spam removed automatically', `Nova removed spam from @${member?.handle} and muted them for 1h.`, 'nova');
}

// ───────────────────────────── Founder decisions ─────────────────────────────

export async function approve(incidentId: string, action?: string) {
  const inc = db.get<Incident>('incidents', incidentId);
  if (!inc) throw new Error('incident not found');
  const act = (action || inc.recommendedAction || 'remove').toLowerCase();
  band.send({ from: 'founder', to: 'aria', kind: 'ack', subject: `Approved: ${act}`, body: `${FOUNDER.name} approved "${act}" for ${inc.id}.`, incidentId });
  setStatus('aria', 'working', `Executing ${act}`, 2500);
  const member = getMember(inc.memberId);
  const targets: string[] = inc.kind === 'raid' ? ((inc.evidence ?? []).find((e: any) => e.type === 'raiders')?.members ?? []) : member ? [member.id] : [];
  if (act.includes('ban')) for (const t of targets) updateMember(t, { status: 'banned', trustScore: 0 });
  else if (act.includes('mute')) for (const t of targets) updateMember(t, { status: 'muted' });
  if (inc.messageId && inc.kind !== 'crisis') updateMessage(inc.messageId, { status: 'removed' });
  if (inc.kind === 'crisis') {
    setStatus('mira', 'idle');
    if (inc.channelId) postAs(null, inc.channelId, `💗 ${FOUNDER.name} from the Haven team has joined to support @${member?.handle} directly.`, inc.messageId, 'system');
  } else if (inc.channelId && targets.length) {
    postAs('aria', inc.channelId, `✅ Action taken: ${act} (${targets.length} account${targets.length > 1 ? 's' : ''}). Thanks for keeping this community safe.`);
  }
  band.send({ from: 'aria', to: 'n8n', kind: 'delegate', subject: 'Log enforcement + notify moderators', body: `enforcement-log for ${inc.id}`, incidentId });
  void runAutomation('enforcement-log', { incidentId, action: act, actor: 'founder', members: targets }, `incident ${incidentId}`).catch(() => null);
  const done = updateIncident(incidentId, { status: 'resolved', resolvedAt: now(), actionTaken: `${act} — approved by ${FOUNDER.name}`, timeToActionMs: inc.timeToActionMs ?? now() - inc.createdAt });
  if (inc.kind === 'bot_risk') toast('success', 'Bot install blocked', 'Kai\'s audit report was sent to the community admins.', 'kai');
  band.send({ from: 'iris', to: 'aria', kind: 'report', subject: 'Metrics updated', body: `${inc.kind} resolved in ${Math.round(((done.timeToActionMs ?? 0) / 1000) * 10) / 10}s to first action. Logged for the weekly report.`, incidentId });
  return done;
}

export function dismiss(incidentId: string) {
  const inc = db.get<Incident>('incidents', incidentId);
  if (!inc) throw new Error('incident not found');
  if (inc.messageId) updateMessage(inc.messageId, { status: 'visible' });
  band.send({ from: 'founder', to: 'aria', kind: 'ack', subject: `Dismissed ${inc.id}`, body: 'False positive — restoring content. Juno will tune the policy.', incidentId });
  band.send({ from: 'aria', to: 'juno', kind: 'request', subject: 'Review false positive', body: `Founder dismissed ${inc.id}. Please adjust thresholds if needed.`, incidentId });
  if (inc.kind === 'crisis') setStatus('mira', 'idle');
  return updateIncident(incidentId, { status: 'dismissed', resolvedAt: now(), actionTaken: 'Dismissed by founder' });
}

// ───────────────────────────── Kai: bot audits ─────────────────────────────

export async function requestAudit(target: string): Promise<Audit> {
  band.send({ from: 'founder', to: 'aria', kind: 'request', subject: 'Audit a community bot', body: `Please audit ${target === 'sample' ? 'RaidShield Pro (requested in #bot-requests)' : target} before we let communities install it.` });
  band.send({ from: 'aria', to: 'kai', kind: 'delegate', subject: 'Bot audit', body: 'Run Snyk, execute its tests in a Tenki sandbox, and check it against the Prelint bot policy spec.' });
  setStatus('kai', 'working', 'Auditing bot');
  const p = runAudit(target, (stepId, detail) => {
    setStatus('kai', 'working', detail.slice(0, 60));
    band.send({ from: 'kai', to: 'aria', kind: 'report', subject: `Audit · ${stepId}`, body: detail.slice(0, 220) });
  });
  // Return quickly with the queued audit; finish in background.
  const first = await Promise.race([p, sleep(400).then(() => null)]);
  void p.then(async (audit) => {
    setStatus('kai', 'idle');
    band.send({ from: 'kai', to: 'aria', kind: 'report', subject: `Audit grade ${audit.grade} (${audit.score}/100)`, body: audit.summary ?? '', payload: { auditId: audit.id } });
    if (audit.grade && ['D', 'F'].includes(audit.grade)) {
      const inc: Incident = { id: id('inc'), kind: 'bot_risk', severity: 'high', status: 'awaiting_approval', title: `Block install of "${audit.target === 'sample' ? 'RaidShield Pro' : audit.target}" (grade ${audit.grade})`, summary: audit.summary ?? '', messageId: null, memberId: null, channelId: 'pf-bots', communityId: 'pixelforge', assignedTo: 'kai', verdict: { rationale: audit.summary, auditId: audit.id }, evidence: [{ type: 'audit', auditId: audit.id }], recommendedAction: 'block install', actionTaken: null, createdAt: audit.createdAt, updatedAt: now(), resolvedAt: null, timeToActionMs: (audit.finishedAt ?? now()) - audit.createdAt, risk: 100 - (audit.score ?? 0) };
      db.insert('incidents', inc); emit('incident.upsert', inc);
      band.send({ from: 'aria', to: 'founder', kind: 'request', subject: `Block "${audit.target === 'sample' ? 'RaidShield Pro' : audit.target}"?`, body: audit.summary ?? '', incidentId: inc.id });
      postAs('kai', 'pf-bots', `🔒 Audit complete for the requested bot: **grade ${audit.grade}**. ${audit.summary} Full report in Haven → Bot Audits.`);
      void say('kai', `Audit complete. Grade ${audit.grade}. ${audit.summary ?? ''}`.slice(0, 280));
      toast('warn', `Kai: bot graded ${audit.grade}`, audit.summary ?? '', 'kai');
    } else {
      postAs('kai', 'pf-bots', `✅ Audit complete: **grade ${audit.grade}**. ${audit.summary} Safe to install.`);
      void say('kai', `Audit complete. Grade ${audit.grade}. Safe to install.`);
    }
    pushMetrics();
  }).catch((e) => { setStatus('kai', 'idle'); toast('error', 'Audit failed', (e as Error).message, 'kai'); });
  return first ?? db.list<Audit>('audits', '', [], 'created_at DESC', 1)[0];
}

// ───────────────────────────── Talking to employees ─────────────────────────────

const PERSONA_FALLBACK: Record<AgentId, (q: string, m: ReturnType<typeof metrics>) => string> = {
  aria: (_q, m) => `Here's where we stand: ${m.awaitingApproval} decision${m.awaitingApproval === 1 ? '' : 's'} need you, ${m.incidentsOpen} incident${m.incidentsOpen === 1 ? ' is' : 's are'} active, and median time-to-action is ${(m.medianTimeToActionMs / 1000).toFixed(1)}s. I'd prioritise anything in the approval queue first — everything else is handled.`,
  nova: (_q, m) => `I've screened ${m.screened.toLocaleString()} messages so far. Every message gets a sub-millisecond heuristic pass; anything risky goes through our RocketRide triage pipeline and a fast Flatkey model before I open an incident.`,
  rex: () => `I never click a link on a real machine. I spin up an isolated Celesto computer, drive a browser workflow with AdaL, capture the page, follow redirects, inspect forms and scripts, and score it. Malicious domains go straight onto the shared blocklist.`,
  mira: () => `I lead with warmth: acknowledge, never judge, never diagnose. I share 988 and findahelpline.com, keep the person talking, and page a human through n8n immediately. Crisis messages are never auto-deleted — that's in our Prelint-checked spec.`,
  kai: () => `ADMINISTRATOR bypasses every permission check — a compromised bot with it can ban members, delete channels and read everything. My audit runs Snyk on its dependencies, executes its tests in a Tenki sandbox and checks it against our bot policy spec.`,
  iris: (_q, m) => `We've spent $${m.llmSpendUsd.toFixed(4)} on models across ${m.llmCalls} calls — about $${m.costPerIncidentUsd.toFixed(4)} per incident, versus roughly $4.20 for a human moderator. Ask me anything on the Ask Haven page and I'll show you the query.`,
  juno: () => `I turn every incident into a better rule. When Rex confirms a phishing domain I add it to the shared blocklist; when the founder dismisses a false positive I tune the thresholds. Our specs live in /specs and Prelint checks every PR against them.`,
  leo: (_q, m) => `We protect ${m.communities} communities and ${m.members.toLocaleString()} members — $${m.mrr.toLocaleString()} MRR. Onboarding is fully automated with n8n: tenant setup, welcome email and a weekly safety report.`,
};

export async function chat(agentId: AgentId, message: string, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  setStatus(agentId, 'thinking', 'Talking with the founder');
  const m = metrics();
  const open = db.list<Incident>('incidents', "status != 'resolved' AND status != 'dismissed'", [], 'created_at DESC', 8);
  const r = await complete({
    agentId, purpose: 'founder-chat', tier: employee(agentId).modelTier, timeoutMs: 15000, maxTokens: 320,
    system: systemFor(agentId, `You are chatting with ${FOUNDER.name}, the founder. Be concise (<= 110 words), specific, in character. Live metrics: ${JSON.stringify({ screened: m.screened, threatsBlocked: m.threatsBlocked, awaitingApproval: m.awaitingApproval, medianTimeToActionMs: m.medianTimeToActionMs, llmSpendUsd: m.llmSpendUsd, mrr: m.mrr, communities: m.communities })}. Open incidents: ${open.map((i) => `${i.id} ${i.kind} ${i.status} "${i.title}"`).join('; ') || 'none'}.`),
    messages: [...history.slice(-8), { role: 'user', content: message }],
  });
  const reply = r?.text?.trim() || PERSONA_FALLBACK[agentId](message, m);
  if (!r) recordOffline(agentId, 'founder-chat', employee(agentId).modelTier, message, reply);
  setStatus(agentId, 'speaking', 'Talking with the founder', 5000);
  void say(agentId, reply.replace(/\*\*/g, ''));
  return { reply, model: r?.model ?? 'offline-brain', provider: r?.provider ?? 'offline-brain', voice: true };
}

// ───────────────────────────── Aria's founder briefing ─────────────────────────────

export async function briefing(speak = false) {
  setStatus('aria', 'thinking', 'Writing the founder briefing');
  const m = metrics();
  const recent = db.list<Incident>('incidents', '', [], 'created_at DESC', 12);
  const awaiting = recent.filter((i) => i.status === 'awaiting_approval');
  const bullets = [
    `${m.screened.toLocaleString()} messages screened across ${m.communities} communities (${m.members.toLocaleString()} members).`,
    `${m.threatsBlocked} threats neutralised; median time-to-first-action ${(m.medianTimeToActionMs / 1000).toFixed(1)}s.`,
    awaiting.length ? `${awaiting.length} decision${awaiting.length > 1 ? 's' : ''} need you: ${awaiting.map((i) => i.title).slice(0, 3).join('; ')}.` : 'Nothing is waiting on you right now.',
    `Model spend so far $${m.llmSpendUsd.toFixed(4)} via Flatkey (${m.llmCalls} calls) — $${m.costPerIncidentUsd.toFixed(4)} per incident.`,
    `Paritok has saved ${m.tokensSaved.toLocaleString()} context tokens; MRR is $${m.mrr.toLocaleString()}.`,
  ];
  let text = `Good evening ${FOUNDER.name}. ${bullets.join(' ')} My recommendation: clear the approval queue, then let Leo onboard the two communities in the pipeline.`;
  const r = await complete({ agentId: 'aria', purpose: 'founder-briefing', tier: 'reasoning', timeoutMs: 15000, maxTokens: 300, system: systemFor('aria', 'Write the founder\'s spoken daily briefing: <= 110 words, warm but crisp, end with ONE recommendation.'), messages: [{ role: 'user', content: `Facts:\n- ${bullets.join('\n- ')}\nRecent incidents: ${recent.map((i) => `${i.kind}/${i.status}: ${i.title}`).join('; ')}` }] });
  if (r?.text) text = r.text.trim(); else recordOffline('aria', 'founder-briefing', 'reasoning', bullets.join('\n'), text);
  const out = { text, bullets, generatedAt: now(), model: r?.model ?? 'offline-brain' };
  db.kvSet('briefing', out);
  setStatus('aria', speak ? 'speaking' : 'idle', speak ? 'Briefing the founder' : null, speak ? 9000 : 0);
  if (speak) void say('aria', text.replace(/\*\*/g, ''));
  return out;
}

// ───────────────────────────── Agent profile & memory ─────────────────────────────

export function agentDetail(agentId: AgentId) {
  const e = employee(agentId);
  const recentBand = db.list<any>('band_messages', '"from" = ? OR "to" = ?', [agentId, agentId], 'created_at DESC', 30);
  const recentLlm = db.list<any>('llm_calls', 'agent_id = ?', [agentId], 'created_at DESC', 20);
  const compressions = db.list<any>('compressions', 'agent_id = ?', [agentId], 'created_at DESC', 10);
  const lastCompression = compressions[0]?.createdAt ?? 0;
  const items = recentBand.filter((b) => b.createdAt > lastCompression).map((b) => `[${new Date(b.createdAt).toLocaleTimeString()}] ${b.from}→${b.to} ${b.kind}: ${b.subject} — ${b.body}`);
  const base = compressions[0] ? [`(compressed) ${compressions[0].summary}`] : [];
  const memoryItems = [...base, ...items];
  const tokens = memoryItems.reduce((a, s) => a + estTokens(s), 0) + (compressions[0] ? 0 : 1200);
  const stats = {
    bandSent: db.count('band_messages', '"from" = ?', [agentId]), bandReceived: db.count('band_messages', '"to" = ?', [agentId]),
    incidents: db.count('incidents', 'assigned_to = ?', [agentId]), llmCalls: db.count('llm_calls', 'agent_id = ?', [agentId]),
    costUsd: Number(db.raw('SELECT COALESCE(SUM(cost_usd),0) s FROM llm_calls WHERE agent_id = ?', [agentId])[0]?.s ?? 0),
  };
  return { employee: e, status: agentStatus[agentId], memory: { items: memoryItems.slice(0, 40), tokens, budget: 8000 }, stats, recentBand, recentLlm, compressions };
}

export async function compressAgent(agentId: AgentId) {
  setStatus(agentId, 'working', 'Compressing context (Paritok)', 3000);
  const d = agentDetail(agentId);
  const items = d.memory.items.length > 3 ? d.memory.items : [...d.memory.items, ...employee(agentId).responsibilities.map((r) => `standing responsibility: ${r}`), ...db.list<Incident>('incidents', 'assigned_to = ?', [agentId], 'created_at DESC', 20).map((i) => `${i.id} ${i.kind} ${i.status}: ${i.title} — ${i.actionTaken ?? i.summary}`)];
  return compressContext(agentId, items, `What ${employee(agentId).name} must remember: open incidents, decisions, indicators, commitments`);
}

// ───────────────────────────── Leo: onboarding ─────────────────────────────

export async function onboardCommunity(input: { name: string; platform?: string; members?: number; plan?: 'Starter' | 'Growth' | 'Enterprise' }) {
  const plan = input.plan ?? 'Growth';
  const c = { id: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 5), name: input.name, platform: input.platform ?? 'Glimmer', members: input.members ?? 2500, plan, mrr: plan === 'Starter' ? 49 : plan === 'Growth' ? 299 : 1200, createdAt: now(), color: ['#fb7185', '#34d399', '#60a5fa', '#f59e0b'][Math.floor(Math.random() * 4)], icon: ['🛰️', '🎨', '🎧', '📚', '⚽'][Math.floor(Math.random() * 5)] };
  setStatus('leo', 'working', `Onboarding ${c.name}`, 4000);
  band.send({ from: 'leo', to: 'n8n', kind: 'delegate', subject: `Onboard ${c.name}`, body: 'community-onboarding workflow: tenant, policy seed, welcome email, weekly report schedule.' });
  const run = await runAutomation('community-onboarding', c, 'new signup').catch(() => null);
  db.insert('communities', c);
  db.insert('channels', { id: `${c.id}-general`, communityId: c.id, name: 'general', topic: `Welcome to ${c.name}` });
  emit('community.upsert', c);
  band.send({ from: 'leo', to: 'aria', kind: 'report', subject: `${c.name} is live`, body: `${c.members.toLocaleString()} members now protected · ${plan} plan · +$${c.mrr} MRR.`, payload: { automationRunId: run?.id } });
  toast('success', `${c.name} onboarded`, `+$${c.mrr} MRR · ${c.members.toLocaleString()} members protected`, 'leo');
  pushMetrics();
  return c;
}
