import { config } from '../config.js';
import { db, sqlite } from '../db.js';
import { emit } from '../events.js';
import { now, extractJson } from '../util.js';
import { complete, completeJson, llmMode, recordOffline } from './flatkey.js';

// PromptQL is Iris's data brain: a shared AI context layer + data intelligence over Haven's live safety data.
// LIVE: when a PromptQL MCP endpoint + bot token are configured, Iris asks PromptQL over MCP (JSON-RPC 2.0) and
// uses its answer, while still running a local SQL query so the founder sees the table and chart.
// LOCAL: Iris translates the question to SQL (via Flatkey when a model is reachable, otherwise an offline intent
// matcher with ~15 hand-tuned templates), runs it read-only against the live SQLite database, and explains it.

export interface WikiEntry { id: string; title: string; body: string; category: string; updatedBy: string; updatedAt: number }
export type ChartSpec = { type: 'bar' | 'line' | 'pie' | 'none'; x: string; y: string };
export interface AskResult {
  answer: string; sql: string; rows: any[]; columns: string[]; chart: ChartSpec | null;
  engine: 'promptql' | 'local'; agentId: 'iris'; model: string;
}

const stats = { questions: 0, live: 0, liveErrors: 0, lastError: '', lastLatencyMs: 0 };

/* ------------------------------------------------------------------ wiki ------------------------------------------------------------------ */

const SEED_WIKI: Omit<WikiEntry, 'updatedBy' | 'updatedAt'>[] = [
  {
    id: 'severity-levels', title: 'Severity levels', category: 'Definitions',
    body: [
      'low — nuisance content (off-topic promo, mild spam). Auto-remove allowed, no member penalty.',
      'medium — policy violation with limited harm (repeated spam, insults, low-confidence scam). Warn or mute 24h.',
      'high — credible harm to members (phishing link, targeted harassment, coordinated raid, impersonation). Quarantine immediately; ban needs a human for first offences.',
      'critical — risk to life or mass compromise (self-harm / suicide signals, doxxing, credential-harvest campaign hitting many members). Page the human on-call within 60 seconds.',
      'Risk score mapping: 0-0.39 low, 0.40-0.64 medium, 0.65-0.84 high, 0.85+ critical.',
    ].join('\n'),
  },
  {
    id: 'what-counts-as-phishing', title: 'What counts as phishing', category: 'Definitions',
    body: [
      'A message is phishing when it tries to get a member to hand over credentials, wallet seed phrases, 2FA codes or payment details by impersonating a trusted brand, moderator or platform.',
      'Strong signals: look-alike domains (paypa1, disc0rd, glimmer-auth-verify), urgency ("your account will be deleted in 24h"), login or password forms on a non-official domain, URL shorteners hiding the destination, free-nitro / airdrop / giveaway lures.',
      'Not phishing: legitimate links to official domains, members sharing their own projects, or links that are merely off-topic (that is spam).',
      'Every phishing URL must be detonated by Rex in an isolated computer before a verdict is final.',
    ].join('\n'),
  },
  {
    id: 'crisis-protocol', title: 'Crisis protocol', category: 'Protocols',
    body: [
      'Any message suggesting self-harm, suicide or a member in immediate danger is critical severity and is owned by Mira.',
      '1. Mira replies privately within 30 seconds: warm, non-judgemental, no diagnosis, no lecturing.',
      '2. Share the 988 Suicide & Crisis Lifeline (call or text 988 in the US) and findahelpline.com for other countries; if danger is immediate, encourage contacting local emergency services.',
      '3. Keep the person talking and encourage them to reach out to someone they trust.',
      '4. Page the human on-call through the n8n crisis workflow immediately. A human must take over within 15 minutes.',
      '5. Never remove the member\'s message publicly in a way that shames them; hide it quietly and keep the evidence.',
    ].join('\n'),
  },
  {
    id: 'auto-action-policy', title: 'Auto-action policy', category: 'Policy',
    body: [
      'AI employees may act without a human when ALL are true: risk >= 0.85, the category is spam, phishing or raid, and the action is reversible (quarantine, mute, remove message).',
      'Bans, legal reports and anything involving a crisis always require founder approval (status awaiting_approval).',
      'Harassment and hate are judged by Juno against community policy before any member penalty.',
      'Every automatic action is logged with evidence and can be undone from the incident page.',
    ].join('\n'),
  },
  {
    id: 'blocklist-domains', title: 'Shared blocklist (domains)', category: 'Threat intel',
    body: [
      'glimmer-auth-verify.top',
      'disc0rd-nitro.gift',
      'free-nitro-drop.xyz',
      'steamcommunlty.ru',
      'airdrop-claim-eth.io',
      'wallet-connect-secure.app',
      'paypa1-security.com',
    ].join('\n'),
  },
  {
    id: 'escalation-sla', title: 'Escalation SLA', category: 'Protocols',
    body: [
      'critical: human paged in < 60s, human owner in < 15 min.',
      'high: specialist verdict in < 2 min, founder approval requested if a ban is recommended.',
      'medium: resolved by AI employees in < 10 min; daily digest to moderators.',
      'low: batched; summarised in the founder daily briefing.',
      'Target median time-to-action across all incidents: under 5 seconds for auto-actionable threats.',
    ].join('\n'),
  },
  {
    id: 'cost-per-incident', title: 'Cost per incident (definition)', category: 'Metrics',
    body: [
      'cost_per_incident = total LLM spend (sum of llm_calls.cost_usd) / number of incidents in the same period.',
      'Human benchmark: a contract moderator costs ~$4.10 per handled incident (avg 6 min at $41/h loaded).',
      'human_hours_saved = incidents handled end-to-end by AI x 6 minutes / 60.',
      'Offline-brain calls cost $0 and are counted separately so the number stays honest.',
    ].join('\n'),
  },
  {
    id: 'community-tone', title: 'Community tone of voice', category: 'Brand',
    body: [
      'Haven speaks like a calm, kind moderator who is on the members\' side.',
      'Be brief, warm and specific. Explain what happened and why in one sentence. Never sarcastic, never threatening.',
      'Public notices: "We removed a message that contained a suspicious link. Stay safe — never share your login or seed phrase."',
      'Private messages to a warned member always include how to appeal.',
    ].join('\n'),
  },
];

export function seedWiki(): void {
  for (const e of SEED_WIKI) {
    if (db.get('wiki', e.id)) continue;
    db.insert<WikiEntry>('wiki', { ...e, updatedBy: 'juno', updatedAt: now() });
  }
}

export function wikiList(): WikiEntry[] {
  return db.list<WikiEntry>('wiki', '', [], 'category ASC, title ASC');
}

export function wikiUpsert(entryId: string, patch: { title?: string; body?: string; category?: string }, by = 'founder'): WikiEntry {
  const prev = db.get<WikiEntry>('wiki', entryId);
  const entry: WikiEntry = {
    id: entryId,
    title: patch.title ?? prev?.title ?? entryId.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    body: patch.body ?? prev?.body ?? '',
    category: patch.category ?? prev?.category ?? 'General',
    updatedBy: by,
    updatedAt: now(),
  };
  db.insert('wiki', entry);
  emit('wiki.updated', entry);
  return entry;
}

/** All wiki entries concatenated — injected into agent prompts as shared context. */
export function wikiText(): string {
  return wikiList().map((e) => `## ${e.title} [${e.id}]\n${e.body}`).join('\n\n');
}

export function blocklist(): string[] {
  const e = db.get<WikiEntry>('wiki', 'blocklist-domains');
  if (!e) return SEED_WIKI.find((s) => s.id === 'blocklist-domains')!.body.split('\n');
  return e.body.split('\n').map((l) => l.replace(/^[-*\s]+/, '').trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
}

export function addToBlocklist(domain: string, by: string): WikiEntry | null {
  let host = (domain || '').trim().toLowerCase();
  try { if (/^https?:\/\//.test(host)) host = new URL(host).hostname; } catch { /* keep raw */ }
  host = host.replace(/^www\./, '').replace(/\/.*$/, '');
  if (!host || !host.includes('.')) return null;
  const list = blocklist();
  if (list.includes(host)) return db.get<WikiEntry>('wiki', 'blocklist-domains') ?? null;
  return wikiUpsert('blocklist-domains', { body: [...list, host].join('\n'), title: 'Shared blocklist (domains)', category: 'Threat intel' }, by);
}

/* ------------------------------------------------------------- SQL safety ------------------------------------------------------------- */

function validateSql(raw: string): string {
  let s = (raw || '').trim().replace(/^```(?:sql)?/i, '').replace(/```$/, '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Only SELECT / WITH queries are allowed');
  if (s.includes(';')) throw new Error('Multiple statements are not allowed');
  if (/\b(pragma|attach|detach|insert|update|delete|drop|alter|create|vacuum|reindex|truncate)\b/i.test(s) || /\breplace\s+into\b/i.test(s)) {
    throw new Error('Write / admin statements are not allowed');
  }
  if (!/\blimit\s+\d+/i.test(s)) s += ' LIMIT 50';
  return s;
}

function runSql(sql: string): { rows: any[]; columns: string[] } {
  const stmt = sqlite.prepare(sql);
  const rows = (stmt.all() as any[]).slice(0, 50).map((r) => {
    const o: any = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v;
    return o;
  });
  let columns: string[] = rows[0] ? Object.keys(rows[0]) : [];
  if (!columns.length) {
    try { columns = ((stmt as any).columns?.() ?? []).map((c: any) => c.name ?? c.column).filter(Boolean); } catch { /* ignore */ }
  }
  return { rows, columns };
}

function fixChart(chart: any, rows: any[], columns: string[]): ChartSpec | null {
  if (!chart || chart.type === 'none') return chart ? { type: 'none', x: chart.x ?? '', y: chart.y ?? '' } : null;
  if (!rows.length || !columns.length) return { type: chart.type, x: chart.x ?? '', y: chart.y ?? '' };
  const numeric = columns.filter((c) => rows.some((r) => typeof r[c] === 'number') && rows.every((r) => r[c] == null || typeof r[c] === 'number'));
  const text = columns.filter((c) => !numeric.includes(c));
  let type: ChartSpec['type'] = ['bar', 'line', 'pie'].includes(chart.type) ? chart.type : 'bar';
  const x: string = columns.includes(chart.x) ? chart.x : text[0] ?? columns[0];
  const y: string = columns.includes(chart.y) && numeric.includes(chart.y) && chart.y !== x ? chart.y : numeric.find((c) => c !== x) ?? '';
  if (!y) return { type: 'none', x, y: '' };
  if (type === 'line' && rows.length < 2) type = 'bar';
  return { type, x, y };
}

/* -------------------------------------------------------- offline intent templates -------------------------------------------------------- */

interface Template {
  id: string; keywords: [RegExp, number][]; sql: (q: string) => string; chart: ChartSpec | null;
  summarize: (rows: any[], q: string) => string;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const cap = (s: any) => String(s ?? 'unknown').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const rest = (rows: any[], label: string, val: string, n = 3) => rows.slice(1, 1 + n).map((r) => `${String(r[label]).replace(/_/g, ' ')} (${fmt(Number(r[val]) || 0)})`).join(', ');
const weekAgo = `(CAST(strftime('%s','now','-7 days') AS INTEGER) * 1000)`;

const TEMPLATES: Template[] = [
  {
    id: 'incidents-by-kind',
    keywords: [[/\b(kind|type|category|categories|common|most|threat|breakdown|incidents?)\b/, 1], [/\b(phishing|scam|spam|harass|hate|raid)\b/, 1]],
    sql: () => `SELECT kind, COUNT(*) AS incidents, ROUND(AVG(risk), 2) AS avg_risk FROM incidents GROUP BY kind ORDER BY incidents DESC LIMIT 50`,
    chart: { type: 'bar', x: 'kind', y: 'incidents' },
    summarize: (rows) => {
      const total = sum(rows, 'incidents'); const top = rows[0];
      return `${cap(top.kind)} is the top threat: ${fmt(top.incidents)} of ${fmt(total)} incidents (${pct(top.incidents, total)}%).${rows.length > 1 ? ` Next: ${rest(rows, 'kind', 'incidents')}.` : ''}`;
    },
  },
  {
    id: 'incidents-by-severity',
    keywords: [[/\b(severity|severe|critical|high[- ]risk)\b/, 3]],
    sql: () => `SELECT severity, COUNT(*) AS incidents FROM incidents GROUP BY severity ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 50`,
    chart: { type: 'pie', x: 'severity', y: 'incidents' },
    summarize: (rows) => {
      const total = sum(rows, 'incidents'); const crit = rows.find((r) => r.severity === 'critical')?.incidents ?? 0; const high = rows.find((r) => r.severity === 'high')?.incidents ?? 0;
      return `${fmt(total)} incidents so far: ${fmt(crit)} critical and ${fmt(high)} high severity (${pct(crit + high, total)}% need fast specialist attention).`;
    },
  },
  {
    id: 'incidents-by-channel',
    keywords: [[/\b(channel|channels|where|room|rooms)\b/, 3], [/\b(incidents?|threats?)\b/, 0.5]],
    sql: () => `SELECT c.name AS channel, COUNT(i.id) AS incidents FROM incidents i JOIN channels c ON c.id = i.channel_id GROUP BY c.name ORDER BY incidents DESC LIMIT 50`,
    chart: { type: 'bar', x: 'channel', y: 'incidents' },
    summarize: (rows) => {
      const total = sum(rows, 'incidents');
      return `#${rows[0].channel} is the hottest channel with ${fmt(rows[0].incidents)} of ${fmt(total)} incidents (${pct(rows[0].incidents, total)}%).${rows.length > 1 ? ` Then ${rows.slice(1, 4).map((r) => `#${r.channel} (${fmt(r.incidents)})`).join(', ')}.` : ''}`;
    },
  },
  {
    id: 'threats-over-time',
    keywords: [[/\b(per|each|over|by)\s+(day|hour|minute|time)\b/, 4], [/\b(trend|timeline|over time|daily|hourly|per day|per hour|when)\b/, 3]],
    sql: (q) => /\b(day|days|daily|week|weekly)\b/.test(q)
      ? `SELECT date(created_at/1000,'unixepoch') AS day, COUNT(*) AS threats FROM incidents GROUP BY day ORDER BY day LIMIT 50`
      : /\b(hour|hours|hourly)\b/.test(q)
        ? `SELECT strftime('%Y-%m-%d %H:00', datetime(created_at/1000,'unixepoch')) AS bucket, COUNT(*) AS threats FROM incidents GROUP BY bucket ORDER BY bucket LIMIT 50`
        : `SELECT strftime('%Y-%m-%d %H:%M', datetime((created_at/1000/600)*600,'unixepoch')) AS bucket, COUNT(*) AS threats FROM incidents GROUP BY bucket ORDER BY bucket LIMIT 50`,
    chart: { type: 'line', x: 'bucket', y: 'threats' },
    summarize: (rows, q) => {
      const x = rows[0].day !== undefined ? 'day' : 'bucket'; const peak = [...rows].sort((a, b) => b.threats - a.threats)[0];
      const unit = x === 'day' ? 'day' : /\b(hour|hours|hourly)\b/.test(q) ? 'hour' : '10-minute window';
      return `${fmt(sum(rows, 'threats'))} threats across ${rows.length} ${unit}${rows.length === 1 ? '' : 's'}; the peak was ${peak[x]} with ${fmt(peak.threats)}.`;
    },
  },
  {
    id: 'top-offenders',
    keywords: [[/\b(offender|offenders|worst|repeat|who|members?|users?|accounts?|bad actors?)\b/, 3]],
    sql: () => `SELECT m.handle, m.display_name, ROUND(m.trust_score, 2) AS trust_score, m.status, COUNT(i.id) AS incidents FROM incidents i JOIN members m ON m.id = i.member_id GROUP BY m.id ORDER BY incidents DESC, trust_score ASC LIMIT 10`,
    chart: { type: 'bar', x: 'handle', y: 'incidents' },
    summarize: (rows) => `@${rows[0].handle} is the top offender with ${fmt(rows[0].incidents)} incident${rows[0].incidents === 1 ? '' : 's'} (trust ${rows[0].trust_score}, ${rows[0].status}).${rows.length > 1 ? ` Also watch ${rows.slice(1, 4).map((r) => `@${r.handle} (${r.incidents})`).join(', ')}.` : ''}`,
  },
  {
    id: 'time-to-action',
    keywords: [[/\b(time to action|time-to-action|how fast|fast|speed|latency|response time|median|average time|sla|quick)\b/, 4]],
    sql: () => `SELECT kind, COUNT(*) AS actioned, ROUND(AVG(time_to_action_ms)/1000.0, 2) AS avg_seconds, ROUND(MIN(time_to_action_ms)/1000.0, 2) AS fastest_seconds FROM incidents WHERE time_to_action_ms IS NOT NULL GROUP BY kind ORDER BY avg_seconds ASC LIMIT 50`,
    chart: { type: 'bar', x: 'kind', y: 'avg_seconds' },
    summarize: (rows) => {
      const n = sum(rows, 'actioned'); const w = rows.reduce((a, r) => a + r.avg_seconds * r.actioned, 0) / (n || 1);
      return `Across ${fmt(n)} actioned incidents the average time to action is ${fmt(Math.round(w * 100) / 100)}s. Fastest category: ${cap(rows[0].kind)} at ${rows[0].avg_seconds}s on average; slowest: ${cap(rows[rows.length - 1].kind)} at ${rows[rows.length - 1].avg_seconds}s.`;
    },
  },
  {
    id: 'llm-spend-by-model',
    keywords: [[/\b(spend|spent|cost|costs|money|dollars?|\$|llm|model|models|tokens?|gateway|flatkey)\b/, 3]],
    sql: () => `SELECT model, provider, COUNT(*) AS calls, SUM(prompt_tokens + completion_tokens) AS tokens, ROUND(SUM(cost_usd), 4) AS cost_usd FROM llm_calls GROUP BY model, provider ORDER BY cost_usd DESC, calls DESC LIMIT 50`,
    chart: { type: 'bar', x: 'model', y: 'calls' },
    summarize: (rows) => {
      const cost = sum(rows, 'cost_usd'); const calls = sum(rows, 'calls');
      return `${fmt(calls)} model calls so far for $${cost.toFixed(4)} total. ${rows[0].model} (${rows[0].provider}) leads with ${fmt(rows[0].calls)} calls and $${Number(rows[0].cost_usd).toFixed(4)}.`;
    },
  },
  {
    id: 'llm-spend-by-agent',
    keywords: [[/\b(spend|spent|cost|costs|calls|tokens?)\b/, 1.5], [/\b(agent|agents|employee|employees|aria|nova|rex|mira|kai|iris|juno|leo)\b/, 2], [/\b(by|per|each|which) (agent|employee)\b/, 4]],
    sql: () => `SELECT agent_id AS agent, COUNT(*) AS calls, SUM(prompt_tokens + completion_tokens) AS tokens, ROUND(SUM(cost_usd), 4) AS cost_usd FROM llm_calls GROUP BY agent_id ORDER BY calls DESC LIMIT 50`,
    chart: { type: 'bar', x: 'agent', y: 'calls' },
    summarize: (rows) => `${cap(rows[0].agent)} is the busiest model user with ${fmt(rows[0].calls)} calls (${fmt(rows[0].tokens)} tokens, $${Number(rows[0].cost_usd).toFixed(4)}). Total across the team: $${sum(rows, 'cost_usd').toFixed(4)}.`,
  },
  {
    id: 'messages-screened',
    keywords: [[/\b(messages?|screened|screen|volume|traffic|posts?|activity|busiest)\b/, 3]],
    sql: () => `SELECT c.name AS channel, COUNT(m.id) AS messages, SUM(CASE WHEN m.status != 'visible' THEN 1 ELSE 0 END) AS flagged, ROUND(AVG(m.risk), 3) AS avg_risk FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.author_kind = 'member' GROUP BY c.name ORDER BY messages DESC LIMIT 50`,
    chart: { type: 'bar', x: 'channel', y: 'messages' },
    summarize: (rows) => {
      const total = sum(rows, 'messages'); const flagged = sum(rows, 'flagged');
      return `Nova has screened ${fmt(total)} member messages across ${rows.length} channels; ${fmt(flagged)} (${pct(flagged, total)}%) were flagged. #${rows[0].channel} is the busiest with ${fmt(rows[0].messages)}.`;
    },
  },
  {
    id: 'awaiting-approval',
    keywords: [[/\b(awaiting|approval|approve|pending|open|waiting|need me|needs me|my attention|queue|unresolved|backlog)\b/, 4]],
    sql: () => `SELECT id, kind, severity, title, assigned_to, recommended_action, datetime(created_at/1000,'unixepoch') AS opened_at FROM incidents WHERE status IN ('awaiting_approval','open','investigating') ORDER BY CASE status WHEN 'awaiting_approval' THEN 0 ELSE 1 END, created_at DESC LIMIT 50`,
    chart: null,
    summarize: (rows) => {
      const crit = rows.filter((r) => r.severity === 'critical').length;
      return `${fmt(rows.length)} incident${rows.length === 1 ? '' : 's'} need attention${crit ? `, ${crit} critical` : ''}. Most recent: "${rows[0].title}" (${rows[0].kind}, ${rows[0].severity}) — recommended: ${rows[0].recommended_action ?? 'review'}.`;
    },
  },
  {
    id: 'crisis-this-week',
    keywords: [[/\b(crisis|crises|self[- ]harm|suicid\w*|wellbeing|well-being|mental|distress|support)\b/, 5]],
    sql: () => `SELECT id, severity, status, title, assigned_to, datetime(created_at/1000,'unixepoch') AS opened_at, ROUND(time_to_action_ms/1000.0, 1) AS seconds_to_action FROM incidents WHERE kind = 'crisis' AND created_at >= ${weekAgo} ORDER BY created_at DESC LIMIT 50`,
    chart: null,
    summarize: (rows) => {
      const resolved = rows.filter((r) => r.status === 'resolved').length;
      return `${fmt(rows.length)} crisis incident${rows.length === 1 ? '' : 's'} this week, ${resolved} resolved. Mira responded to each one${rows[0].seconds_to_action != null ? ` (latest in ${rows[0].seconds_to_action}s)` : ''} and a human was paged per the crisis protocol.`;
    },
  },
  {
    id: 'agent-workload',
    keywords: [[/\b(agent|agents|employee|employees|handled|handles|workload|assigned|busiest|who)\b/, 2.5], [/\b(incidents?|cases?)\b/, 1], [/\b(handled|handles|handle|workload|assigned|resolved|caseload)\b/, 3]],
    sql: () => `SELECT assigned_to AS agent, COUNT(*) AS incidents, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved FROM incidents WHERE assigned_to IS NOT NULL GROUP BY assigned_to ORDER BY incidents DESC LIMIT 50`,
    chart: { type: 'bar', x: 'agent', y: 'incidents' },
    summarize: (rows) => `${cap(rows[0].agent)} handled the most incidents: ${fmt(rows[0].incidents)} (${fmt(rows[0].resolved)} resolved).${rows.length > 1 ? ` Then ${rows.slice(1, 4).map((r) => `${cap(r.agent)} (${r.incidents})`).join(', ')}.` : ''}`,
  },
  {
    id: 'band-pairs',
    keywords: [[/\b(band|talk|talking|talks|conversation|conversations|communicat\w*|delegat\w*|handoffs?|pairs?|agent[- ]to[- ]agent|a2a)\b/, 4]],
    sql: () => `SELECT "from" || ' → ' || "to" AS pair, COUNT(*) AS messages FROM band_messages GROUP BY "from", "to" ORDER BY messages DESC LIMIT 15`,
    chart: { type: 'bar', x: 'pair', y: 'messages' },
    summarize: (rows) => `${fmt(sum(rows, 'messages'))} BAND messages across the top ${rows.length} agent pairs. Busiest line: ${rows[0].pair} with ${fmt(rows[0].messages)} messages.`,
  },
  {
    id: 'compression-savings',
    keywords: [[/\b(compress\w*|paritok|saved|savings|context|memory)\b/, 4], [/\btokens?\b/, 1]],
    sql: () => `SELECT agent_id AS agent, COUNT(*) AS runs, SUM(before_tokens - after_tokens) AS tokens_saved, ROUND(AVG(1.0 * before_tokens / MAX(after_tokens, 1)), 1) AS avg_ratio FROM compressions GROUP BY agent_id ORDER BY tokens_saved DESC LIMIT 50`,
    chart: { type: 'bar', x: 'agent', y: 'tokens_saved' },
    summarize: (rows) => `Context compression saved ${fmt(sum(rows, 'tokens_saved'))} tokens over ${fmt(sum(rows, 'runs'))} runs. ${cap(rows[0].agent)} benefits most (${fmt(rows[0].tokens_saved)} tokens, ~${rows[0].avg_ratio}x smaller).`,
  },
  {
    id: 'communities-by-mrr',
    keywords: [[/\b(mrr|revenue|customers?|communities|community|plan|plans|arr|paying|business|growth)\b/, 4]],
    sql: () => `SELECT name, platform, plan, members, mrr FROM communities ORDER BY mrr DESC LIMIT 50`,
    chart: { type: 'bar', x: 'name', y: 'mrr' },
    summarize: (rows) => `${fmt(rows.length)} communities generate $${fmt(sum(rows, 'mrr'))} MRR ($${fmt(sum(rows, 'mrr') * 12)} ARR). ${rows[0].name} (${rows[0].plan}, ${fmt(rows[0].members)} members) is the largest at $${fmt(rows[0].mrr)}/mo.`,
  },
  {
    id: 'cost-per-incident',
    keywords: [[/\b(cost per incident|per incident|unit economics|cheaper|human moderator|moderators?)\b/, 5]],
    sql: () => `SELECT (SELECT COUNT(*) FROM incidents) AS incidents, ROUND((SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls), 4) AS llm_spend_usd, ROUND((SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls) / MAX((SELECT COUNT(*) FROM incidents), 1), 4) AS cost_per_incident_usd, 4.10 AS human_cost_per_incident_usd LIMIT 1`,
    chart: null,
    summarize: (rows) => {
      const r = rows[0]; const x = r.cost_per_incident_usd > 0 ? Math.round(4.1 / r.cost_per_incident_usd) : null;
      return `Haven spends $${Number(r.cost_per_incident_usd).toFixed(4)} per incident in model costs across ${fmt(r.incidents)} incidents, vs ~$4.10 for a human moderator${x ? ` — about ${fmt(x)}x cheaper` : ''}.`;
    },
  },
];

function pickTemplate(question: string): Template {
  const q = question.toLowerCase();
  let best = TEMPLATES[0], bestScore = 0;
  for (const t of TEMPLATES) {
    let s = 0;
    for (const [re, w] of t.keywords) { const m = q.match(new RegExp(re.source, 'g')); if (m) s += w * Math.min(m.length, 2); }
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return bestScore > 0 ? best : TEMPLATES[0];
}

function deterministicAnswer(t: Template | null, rows: any[], q: string, columns: string[]): string {
  if (!rows.length) return 'No matching data yet — the community simulator is still generating activity. Try again in a minute, or inject a scenario from the Community view.';
  if (t) { try { return t.summarize(rows, q); } catch { /* generic below */ } }
  const num = columns.find((c) => typeof rows[0][c] === 'number');
  const lbl = columns.find((c) => typeof rows[0][c] === 'string');
  if (num && lbl) return `Top result: ${rows[0][lbl]} with ${fmt(rows[0][num])} ${num.replace(/_/g, ' ')} (${rows.length} row${rows.length === 1 ? '' : 's'} total).`;
  return `Found ${rows.length} row${rows.length === 1 ? '' : 's'}.`;
}

/* ------------------------------------------------------------- PromptQL MCP ------------------------------------------------------------- */

function promptqlEndpoint() {
  const url = process.env.PROMPTQL_MCP_URL?.trim() || config.promptql.baseUrl;
  const token = process.env.PROMPTQL_BOT_TOKEN?.trim() || config.promptql.apiKey;
  return url && token ? { url, token } : null;
}

export function promptqlStatus() {
  const ep = promptqlEndpoint();
  return {
    mode: ep ? ('promptql' as const) : ('local' as const),
    detail: ep ? `PromptQL MCP at ${new URL(ep.url).host}` : `Local NL→SQL over live SQLite (${llmMode().live ? 'model: ' + llmMode().provider : 'offline intent matcher'})`,
    wikiEntries: db.count('wiki'), ...stats,
  };
}

async function mcpCall(ep: { url: string; token: string }, session: { id?: string }, body: any, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ep.url, {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: `pat ${ep.token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-03-26', ...(session.id ? { 'Mcp-Session-Id': session.id } : {}),
      },
      body: JSON.stringify(body),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.id = sid;
    if (!res.ok && res.status !== 202) throw new Error(`MCP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const text = await res.text();
    if (!text.trim()) return null;
    if ((res.headers.get('content-type') ?? '').includes('event-stream') || /^(event|data):/m.test(text)) {
      const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
      const last = datas[datas.length - 1];
      return last ? JSON.parse(last) : null;
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

const toolText = (r: any): string => (r?.result?.content ?? []).map((c: any) => c?.text ?? '').join('\n');

function deepFind(obj: any, keys: string[], out: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { for (const v of obj) deepFind(v, keys, out); return out; }
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k) && typeof v === 'string' && v.trim()) out.push(v);
    else if (v && typeof v === 'object') deepFind(v, keys, out);
  }
  return out;
}

async function askPromptql(question: string): Promise<string | null> {
  const ep = promptqlEndpoint();
  if (!ep) return null;
  const t0 = now();
  const session: { id?: string } = {};
  let rpc = 1;
  try {
    const init = await mcpCall(ep, session, { jsonrpc: '2.0', id: rpc++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'haven-iris', version: '1.0.0' } } });
    if (init?.error) throw new Error(init.error.message ?? 'initialize failed');
    await mcpCall(ep, session, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
    const asked = await mcpCall(ep, session, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name: 'ask_promptql', arguments: { query: question } } }, 25000);
    if (asked?.error) throw new Error(asked.error.message ?? 'ask_promptql failed');
    const txt = toolText(asked);
    const parsed = extractJson<any>(txt) ?? {};
    const threadId = parsed.thread_id ?? parsed.threadId ?? txt.match(/thread[_ ]?id["':\s]+([\w-]{8,})/i)?.[1];
    let answer = '';
    if (threadId) {
      const deadline = now() + 25000;
      while (now() < deadline) {
        await new Promise((r) => setTimeout(r, 750));
        const st = await mcpCall(ep, session, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name: 'get_latest_promptql_thread_state', arguments: { thread_id: threadId } } }, 10000);
        const stText = toolText(st);
        const sj = extractJson<any>(stText);
        const msgs = sj ? deepFind(sj, ['message', 'assistant_message', 'response', 'answer', 'text']) : [];
        const status = String(sj?.status ?? sj?.state ?? sj?.thread_state ?? '').toLowerCase();
        const busy = /process|running|pending|progress|queued|thinking/.test(status);
        if (msgs.length && !busy) { answer = msgs[msgs.length - 1]; break; }
        if (!sj && stText.trim() && !/process|running|pending|progress/i.test(stText)) { answer = stText.trim(); break; }
        if (/error|fail/.test(status)) throw new Error('PromptQL thread failed');
      }
    } else {
      answer = deepFind(parsed, ['message', 'answer', 'response']).pop() ?? txt.trim();
    }
    if (!answer) throw new Error('PromptQL returned no answer in 25s');
    stats.live++; stats.lastLatencyMs = now() - t0;
    return answer.slice(0, 2000);
  } catch (e) {
    stats.liveErrors++; stats.lastError = (e as Error).message;
    console.warn('[promptql] live ask failed → local:', stats.lastError);
    return null;
  }
}

/* ---------------------------------------------------------------- askData ---------------------------------------------------------------- */

function schemaPrompt(): string {
  const schema = db.schema().split('\n').filter((l) => !/CREATE TABLE kv\b|CREATE TABLE wiki\b/i.test(l)).join('\n');
  const wiki = wikiText().slice(0, 2200);
  return [
    'You are Iris, Haven\'s data analyst. Translate the founder\'s question into ONE SQLite query over this live Trust & Safety database.',
    'SCHEMA:', schema,
    'NOTES: incidents.kind in (phishing, scam, harassment, crisis, spam, hate, raid, bot_risk); severity in (low, medium, high, critical); status in (open, investigating, awaiting_approval, resolved, dismissed).',
    'incidents.assigned_to and llm_calls.agent_id are AI employee ids (aria, nova, rex, mira, kai, iris, juno, leo). band_messages has columns literally named "from" and "to" — always double-quote them.',
    'messages.author_kind in (member, agent, founder, system); messages.status in (visible, under_review, quarantined, removed). JSON columns (labels, verdict, evidence, payload, stages, steps) are TEXT — use json_extract / json_each.',
    'SHARED CONTEXT WIKI (business definitions):', wiki,
    'RULES: SQLite dialect only. A single SELECT (or WITH … SELECT) statement, never modify data. Always LIMIT 50 or less. All timestamps (*_at) are epoch MILLISECONDS — use datetime(created_at/1000,\'unixepoch\') to display and (strftime(\'%s\',\'now\',\'-7 days\')*1000) style math to filter. Use readable snake_case column aliases. Round decimals to 2-4 places.',
    'Respond with ONLY JSON: {"sql": "...", "chart": {"type": "bar"|"line"|"pie"|"none", "x": "<column alias for labels>", "y": "<numeric column alias>"}}.',
  ].join('\n');
}

export async function askData(question: string): Promise<AskResult> {
  const q = (question || '').trim() || 'Which kind of incident is most common?';
  stats.questions++;
  const livePromise = askPromptql(q); // runs in parallel with local SQL

  let sql = '', rows: any[] = [], columns: string[] = [], chart: ChartSpec | null = null, model = 'offline-brain', template: Template | null = null;
  let viaModel = false;

  // 1) model-driven NL→SQL via Flatkey (when any live model is reachable)
  if (llmMode().live) {
    const system = schemaPrompt();
    let messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: q }];
    for (let attempt = 0; attempt < 2 && !viaModel; attempt++) {
      const r = await completeJson<{ sql: string; chart?: ChartSpec }>({ agentId: 'iris', purpose: 'nl-to-sql', tier: 'reasoning', system, messages, maxTokens: 600, temperature: 0.1 });
      if (!r?.data?.sql) break;
      try {
        sql = validateSql(r.data.sql);
        ({ rows, columns } = runSql(sql));
        chart = fixChart(r.data.chart, rows, columns);
        model = `${r.meta.provider}/${r.meta.model}`;
        viaModel = true;
      } catch (e) {
        messages = [...messages, { role: 'assistant', content: JSON.stringify(r.data) }, { role: 'user', content: `That query failed: ${(e as Error).message}. Fix it and reply with JSON only.` }];
      }
    }
  }

  // 2) offline intent matcher (always works)
  if (!viaModel) {
    template = pickTemplate(q);
    sql = validateSql(template.sql(q.toLowerCase()));
    try { ({ rows, columns } = runSql(sql)); } catch (e) { rows = []; columns = []; console.warn('[promptql] template failed', (e as Error).message); }
    chart = template.chart ? fixChart(template.chart, rows, columns) : null;
    recordOffline('iris', 'nl-to-sql', 'reasoning', q, sql);
  }

  // 3) the answer — PromptQL (live) > model narrative > deterministic summary
  const live = await livePromise;
  let answer = '';
  let engine: AskResult['engine'] = 'local';
  if (live) {
    answer = live; engine = 'promptql'; model = `promptql${viaModel ? ' + ' + model : ''}`;
  } else if (viaModel) {
    const r = await complete({
      agentId: 'iris', purpose: 'data-answer', tier: 'fast', maxTokens: 220, temperature: 0.3,
      system: 'You are Iris, Haven\'s data analyst. Answer the founder\'s question in 1-3 crisp sentences using ONLY the query results. Lead with the headline number, include a percentage or comparison when useful. Plain text only (no markdown, no bold), no preamble, and do not comment on the query itself or its limitations.',
      messages: [{ role: 'user', content: `Question: ${q}\nSQL: ${sql}\nRows (${rows.length}): ${JSON.stringify(rows.slice(0, 20)).slice(0, 3500)}` }],
    });
    answer = r?.text?.trim() || deterministicAnswer(null, rows, q, columns);
  } else {
    answer = deterministicAnswer(template, rows, q.toLowerCase(), columns);
  }
  return { answer, sql, rows, columns, chart, engine, agentId: 'iris', model };
}
