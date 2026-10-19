import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { emit, sleep } from '../events.js';
import { id, now, extractJson, clamp, URL_RE } from '../util.js';
import { complete, recordOffline } from './flatkey.js';
import type { PipelineRun, PipelineStageState, IncidentKind, Severity, AgentId } from '../types.js';

// RocketRide runs Haven's AI pipelines. Every pipeline is a real RocketRide `.pipe` file in /pipelines (open them in
// the RocketRide editor). Haven executes the same graph locally with a RocketRide-compatible engine — each component
// provider maps to a stage handler that does the real work — and, when a RocketRide key is configured, mirrors the
// run to RocketRide cloud via the official SDK (best effort, never blocking the local run).

const PIPE_DIR = path.join(ROOT, 'pipelines');

// ---------------------------------------------------------------------------------------------- types

export interface PipeComponent {
  id: string; provider: string; name?: string; config: any;
  input?: { lane: string; from: string }[]; control?: { classType: string; from: string }[];
  ui?: { position: { x: number; y: number } };
}
export interface PipeFile { components: PipeComponent[]; project_id: string; viewport?: any; version: number }
export interface PipelineDef {
  id: string; name: string; description: string; file: string;
  stages: { id: string; name: string; type: string; description: string }[];
  edges: [string, string][];
}
export type StageHandler = (input: any, ctx: { runId: string; pipelineId: string; stageId: string; incidentId: string | null; outputs: Record<string, any> }) => Promise<any> | any;

// ---------------------------------------------------------------------------------------------- metadata

const PIPELINE_META: Record<string, { name: string; description: string; agent: AgentId }> = {
  'message-triage': { name: 'Message triage', agent: 'nova', description: 'Every community message: PII redaction → signal extraction → policy pre-filter → Flatkey risk classification → routing decision. Nova runs this in under a second.' },
  'link-forensics': { name: 'Link forensics', agent: 'rex', description: 'Suspicious URLs are detonated inside an isolated sandbox computer (Celesto) driven by a browser agent (AdaL); forensic signals are scored and a verdict is returned to Rex.' },
  'community-insights': { name: 'Community insights', agent: 'iris', description: 'Weekly founder insights: load safety time series from shared context, detect anomalies with z-scores, and have Iris write the headline insights.' },
  'bot-audit': { name: 'Bot security audit', agent: 'kai', description: 'Before a third-party bot is installed: Snyk scan → Tenki sandboxed test run → Prelint spec check → Kai grades the bot A–F.' },
};

const STAGE_DESC: Record<string, string> = {
  'message-triage/webhook_1': 'Receives each new community message (text, author, channel) as a RocketRide webhook source.',
  'message-triage/anonymize_text_1': 'Redacts emails, phone numbers, card numbers and IP addresses before any model sees the text.',
  'message-triage/ner_1': 'Extracts URLs, @mentions, #hashtags, emails and named entities as risk signals.',
  'message-triage/guardrails_1': 'Strict keyword policy pre-filter: self-harm, credential phishing, scams, harassment, hate, spam.',
  'message-triage/prompt_1': 'Builds Nova\'s risk-classification prompt from redacted text, signals and policy hits.',
  'message-triage/llm_openai_1': 'Classifies risk through the Flatkey gateway (fast tier, automatic model failover).',
  'message-triage/extract_data_1': 'Parses the classification JSON and decides the route: allow, monitor, review or quarantine + which specialist owns it.',
  'message-triage/response_json_1': 'Returns the triage verdict to Haven\'s orchestrator.',
  'link-forensics/webhook_1': 'Receives a suspicious URL plus incident context.',
  'link-forensics/tool_http_request_1': 'Detonates the link in an isolated sandbox computer (Celesto) with a browser agent (AdaL) that follows redirects and screenshots the page.',
  'link-forensics/extract_data_1': 'Extracts forensic signals: redirects, credential forms, look-alike domains, TLD and entropy risk.',
  'link-forensics/prompt_1': 'Builds Rex\'s verdict prompt from the forensic evidence.',
  'link-forensics/llm_openai_1': 'Reasons over the evidence through the Flatkey gateway.',
  'link-forensics/response_json_1': 'Returns verdict, score, reasons and recommended action.',
  'community-insights/chat_1': 'A founder question (or the weekly schedule) starts the run.',
  'community-insights/question_1': 'Loads hourly message / incident series and incident mix from Haven\'s shared context.',
  'community-insights/anomaly_detector_1': 'Flags spikes and drops with z-scores over every series.',
  'community-insights/prompt_1': 'Builds Iris\'s insight-writer prompt from stats and anomalies.',
  'community-insights/llm_openai_1': 'Writes the insights through the Flatkey gateway.',
  'community-insights/response_answers_1': 'Returns headline + insights to the founder dashboard.',
  'bot-audit/webhook_1': 'Receives the bot to audit (bundled sample or public GitHub URL).',
  'bot-audit/tool_http_request_1': 'Runs a Snyk dependency + code scan.',
  'bot-audit/tool_http_request_2': 'Executes the bot\'s test suite inside a Tenki sandbox runner.',
  'bot-audit/guardrails_1': 'Checks the bot against the Prelint product spec (permissions, data handling, tests).',
  'bot-audit/prompt_1': 'Builds Kai\'s security review prompt.',
  'bot-audit/llm_openai_1': 'Grades the bot through the Flatkey gateway.',
  'bot-audit/response_json_1': 'Returns grade, score, summary and findings.',
};
const PROVIDER_DESC: Record<string, string> = {
  webhook: 'Webhook source', chat: 'Chat source', anonymize_text: 'PII anonymization', ner: 'Named-entity & signal extraction',
  guardrails: 'Guardrails policy check', prompt: 'Prompt builder', question: 'Question / context loader', llm_openai: 'LLM (OpenAI-compatible via Flatkey)',
  extract_data: 'Structured data extraction', anomaly_detector: 'Anomaly detection', tool_http_request: 'HTTP tool call', tool_pipe: 'Sub-pipeline',
  agent_rocketride: 'RocketRide agent', response_json: 'JSON response', response_answers: 'Answers response',
};

const prettify = (s: string) => s.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------------------------------------- loading

function readPipe(pipelineId: string): PipeFile | null {
  const file = path.join(PIPE_DIR, `${pipelineId}.pipe`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as PipeFile; } catch (e) { console.warn(`[rocketride] bad pipe ${file}:`, (e as Error).message); return null; }
}

function upstreams(c: PipeComponent): string[] {
  return [...(c.input ?? []).map((i) => i.from), ...(c.control ?? []).map((i) => i.from)];
}

/** Kahn topological sort, ties broken by ui x-position then file order. */
function topo(components: PipeComponent[]): PipeComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const indeg = new Map(components.map((c) => [c.id, upstreams(c).filter((u) => byId.has(u)).length]));
  const order: PipeComponent[] = [];
  const rank = (c: PipeComponent) => (c.ui?.position?.x ?? 0) * 1000 + components.indexOf(c);
  const ready = components.filter((c) => indeg.get(c.id) === 0);
  while (ready.length) {
    ready.sort((a, b) => rank(a) - rank(b));
    const c = ready.shift()!;
    order.push(c);
    for (const d of components) {
      if (!upstreams(d).includes(c.id)) continue;
      const n = indeg.get(d.id)! - upstreams(d).filter((u) => u === c.id).length;
      indeg.set(d.id, n);
      if (n === 0) ready.push(d);
    }
  }
  for (const c of components) if (!order.includes(c)) order.push(c); // cycles: append in file order
  return order;
}

function toDef(pipelineId: string, pipe: PipeFile): PipelineDef {
  const meta = PIPELINE_META[pipelineId];
  const comps = topo(pipe.components);
  const edges: [string, string][] = [];
  for (const c of pipe.components) for (const u of upstreams(c)) edges.push([u, c.id]);
  return {
    id: pipelineId,
    name: meta?.name ?? prettify(pipelineId),
    description: meta?.description ?? `RocketRide pipeline ${pipelineId}.pipe`,
    file: `pipelines/${pipelineId}.pipe`,
    stages: comps.map((c) => ({
      id: c.id, name: c.name || prettify(c.provider), type: c.provider,
      description: STAGE_DESC[`${pipelineId}/${c.id}`] ?? STAGE_DESC[c.id] ?? PROVIDER_DESC[c.provider] ?? c.provider,
    })),
    edges,
  };
}

export function pipelineIds(): string[] {
  if (!existsSync(PIPE_DIR)) return [];
  return readdirSync(PIPE_DIR).filter((f) => f.endsWith('.pipe')).map((f) => f.replace(/\.pipe$/, '')).sort((a, b) => {
    const order = Object.keys(PIPELINE_META);
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

export function getPipeline(pipelineId: string): PipelineDef | null {
  const pipe = readPipe(pipelineId);
  return pipe ? toDef(pipelineId, pipe) : null;
}

export function pipelineRuns(pipelineId: string, limit = 10): PipelineRun[] {
  return db.list<PipelineRun>('pipeline_runs', 'pipeline_id = ?', [pipelineId], 'started_at DESC', limit);
}

export function listPipelines(): (PipelineDef & { runs: PipelineRun[] })[] {
  const out: (PipelineDef & { runs: PipelineRun[] })[] = [];
  for (const pid of pipelineIds()) {
    const def = getPipeline(pid);
    if (def) out.push({ ...def, runs: pipelineRuns(pid, 10) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- storage helpers

/** Shrinks a value so it stores/broadcasts in ~maxChars of JSON. */
export function clip(v: any, maxChars = 2000): any {
  let s: string;
  try { s = JSON.stringify(v); } catch { return String(v); }
  if (s === undefined || s.length <= maxChars) return v;
  const shrink = (x: any, depth: number): any => {
    if (typeof x === 'string') return x.length > 240 ? x.slice(0, 240) + '…' : x;
    if (Array.isArray(x)) {
      const arr = x.slice(0, 8).map((y) => shrink(y, depth + 1));
      return x.length > 8 ? [...arr, `…+${x.length - 8} more`] : arr;
    }
    if (x && typeof x === 'object') {
      if (depth >= 3) return '{…}';
      const o: any = {};
      for (const [k, y] of Object.entries(x)) if (k !== 'prompt' && k !== 'system' && k !== 'screenshotData') o[k] = shrink(y, depth + 1);
      if ('prompt' in x) o.prompt = shrink(String(x.prompt), depth + 1);
      return o;
    }
    return x;
  };
  const small = shrink(v, 0);
  const s2 = JSON.stringify(small);
  if (s2.length <= maxChars) return small;
  return { _truncated: true, preview: s2.slice(0, maxChars) };
}

const persistable = (run: PipelineRun): PipelineRun => ({ ...run, input: clip(run.input, 2000), output: clip(run.output, 6000), stages: run.stages.map((s) => ({ ...s })) });
function save(run: PipelineRun) {
  const p = persistable(run);
  db.insert('pipeline_runs', p);
  return p;
}

// ---------------------------------------------------------------------------------------------- local intelligence

const SUSPICIOUS_TLDS = ['xyz', 'top', 'click', 'zip', 'mov', 'tk', 'gq', 'ml', 'cf', 'ga', 'ru', 'live', 'shop', 'rest', 'icu', 'cam', 'quest', 'monster', 'buzz', 'link', 'support', 'gift', 'sbs', 'cfd'];
const BRANDS = ['discord', 'steam', 'paypal', 'google', 'apple', 'microsoft', 'metamask', 'coinbase', 'roblox', 'epicgames', 'binance', 'opensea', 'twitch', 'github', 'instagram', 'telegram'];
const LEGIT_HOSTS = ['discord.com', 'discord.gg', 'discordapp.com', 'discord.net', 'steampowered.com', 'steamcommunity.com', 'paypal.com', 'google.com', 'apple.com', 'microsoft.com', 'metamask.io', 'coinbase.com', 'roblox.com', 'epicgames.com', 'binance.com', 'opensea.io', 'twitch.tv', 'github.com', 'githubusercontent.com', 'instagram.com', 'telegram.org', 't.me'];
const LURE_WORDS = ['claim', 'reward', 'free', 'gift', 'nitro', 'airdrop', 'verify', 'login', 'signin', 'secure', 'wallet', 'bonus', 'prize', 'giveaway', 'unlock', 'support', 'recovery', 'account', 'update', 'mint'];

function entropy(s: string) {
  const f = new Map<string, number>();
  for (const ch of s) f.set(ch, (f.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of f.values()) { const p = n / s.length; e -= p * Math.log2(p); }
  return Math.round(e * 100) / 100;
}

/** Static (no-network) URL risk analysis used when the sandbox is unavailable and to enrich sandbox findings. */
export function analyzeUrlLocal(url: string) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0].toLowerCase(); }
  const parts = host.split('.');
  const tld = parts[parts.length - 1] ?? '';
  const label = parts.slice(0, -1).join('.');
  const signals: { id: string; label: string; weight: number; detail: string }[] = [];
  if (SUSPICIOUS_TLDS.includes(tld)) signals.push({ id: 'tld', label: 'High-abuse TLD', weight: 22, detail: `.${tld} is heavily used for throwaway phishing domains` });
  const lures = LURE_WORDS.filter((w) => host.includes(w) || url.toLowerCase().includes(`/${w}`));
  if (lures.length) signals.push({ id: 'lure', label: 'Lure keywords', weight: Math.min(30, 12 * lures.length), detail: `URL contains: ${lures.join(', ')}` });
  const official = LEGIT_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  const deleet = (ch1: string) => label.replace(/[013457]/g, (d) => ({ '0': 'o', '1': ch1, '3': 'e', '4': 'a', '5': 's', '7': 't' } as Record<string, string>)[d]);
  const brand = official ? undefined : BRANDS.find((b) => host.includes(b)) ?? BRANDS.find((b) => (deleet('i').includes(b) || deleet('l').includes(b)) && !host.includes(b));
  if (brand) signals.push({ id: 'lookalike', label: 'Brand look-alike', weight: 30, detail: `Impersonates ${brand}` });
  if (host.startsWith('xn--') || host.includes('.xn--')) signals.push({ id: 'punycode', label: 'Punycode domain', weight: 25, detail: 'Internationalized domain can visually spoof a real brand' });
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) signals.push({ id: 'ip', label: 'Raw IP host', weight: 20, detail: 'Links to a bare IP address' });
  if ((label.match(/-/g) ?? []).length >= 2) signals.push({ id: 'hyphens', label: 'Hyphen-stuffed domain', weight: 12, detail: `${(label.match(/-/g) ?? []).length} hyphens in ${host}` });
  const ent = entropy(label.replace(/\./g, ''));
  if (ent > 3.6 && label.length > 12) signals.push({ id: 'entropy', label: 'High-entropy domain', weight: 10, detail: `entropy ${ent}` });
  if (/bit\.ly|tinyurl|t\.co|is\.gd|cutt\.ly|rb\.gy/.test(host)) signals.push({ id: 'shortener', label: 'URL shortener', weight: 12, detail: 'Destination hidden behind a shortener' });
  const score = clamp(signals.reduce((a, s) => a + s.weight, 0), 0, 100);
  const verdict = score >= 60 ? 'malicious' : score >= 30 ? 'suspicious' : 'benign';
  return { url, host, tld, lookalikeOf: brand ?? null, entropy: ent, signals, score, verdict };
}

const KIND_TERMS: Record<IncidentKind, RegExp[]> = {
  crisis: [/\b(want|going|plan(ning)?) to (die|end it)\b/i, /\bkill(ing)? myself\b/i, /\bend (it all|my life)\b/i, /\bno reason to (live|go on)\b/i, /\bsuicid/i, /\bself[- ]?harm\b/i, /\bhurt(ing)? myself\b/i, /\bcan'?t (go on|do this anymore)\b/i, /\bgoodbye (everyone|forever)\b/i, /\bnobody would (care|miss me)\b/i],
  phishing: [/\bverify (your|ur) (account|wallet)\b/i, /\bfree (discord )?nitro\b/i, /\bclaim (your|ur)?\s*(reward|prize|gift|airdrop|nitro)/i, /\bseed phrase\b/i, /\blog ?in (here|now|to claim)\b/i, /\bconnect (your )?wallet\b/i, /\bsteam ?gift\b/i, /\baccount (will be|has been) (suspended|disabled|banned)\b/i],
  scam: [/\bguaranteed (returns?|profit)/i, /\bdouble (your|ur) (money|crypto|btc|eth)\b/i, /\b(\d+)x (returns?|profit)\b/i, /\binvest(ment)? (opportunity|plan)\b/i, /\bdm me (for|to)\b/i, /\bgift ?cards?\b/i, /\bcash ?app\b/i, /\bsend (me )?\$?\d+/i, /\bpassive income\b/i, /\bforex|crypto signals?\b/i],
  harassment: [/\b(you'?re|ur|you are) (an? )?(idiot|loser|stupid|pathetic|worthless|trash|garbage|ugly)\b/i, /\bkys\b/i, /\bnobody (likes|wants) you\b/i, /\bshut (up|ur mouth)\b/i, /\bgo away and die\b/i, /\bi know where you live\b/i, /\bkill yourself\b/i, /\bget (lost|out of here)\b/i],
  hate: [/\bsubhuman\b/i, /\bvermin\b/i, /\bgo back to (your|ur) (own )?country\b/i, /\b(those|these) people are (animals|disgusting)\b/i, /\bdon'?t belong here\b/i],
  spam: [/\bbuy now\b/i, /\bpromo code\b/i, /\b(\d{2,})% off\b/i, /\bsubscribe to my\b/i, /\bfollow (me|my)\b/i, /\bcheck out my (channel|store|onlyfans)\b/i, /\bcheap (followers|likes)\b/i],
  raid: [/@everyone/i, /\braid\b/i, /\bspam (this|the) (server|chat)\b/i, /\beveryone (join|spam)\b/i, /\bjoin (my|our) server\b/i],
  bot_risk: [/\badministrator permission\b/i, /\binstall (this|my) bot\b/i, /\bauthori[sz]e (the |this )?bot\b/i],
};
const KIND_BASE: Record<IncidentKind, number> = { crisis: 70, phishing: 55, scam: 45, harassment: 45, hate: 55, spam: 25, raid: 40, bot_risk: 35 };
const KIND_OWNER: Record<IncidentKind, AgentId> = { phishing: 'rex', scam: 'rex', crisis: 'mira', harassment: 'juno', hate: 'juno', spam: 'nova', raid: 'nova', bot_risk: 'kai' };

/** Deterministic local classifier — Nova's "offline brain" for message triage. */
export function classifyMessageLocal(text: string, entities?: { urls?: string[]; mentions?: string[] }) {
  const t = text || '';
  const hits: Partial<Record<IncidentKind, string[]>> = {};
  for (const [kind, res] of Object.entries(KIND_TERMS) as [IncidentKind, RegExp[]][]) {
    for (const re of res) { const m = t.match(re); if (m) (hits[kind] ??= []).push(m[0]); }
  }
  const urls = entities?.urls ?? (t.match(URL_RE) ?? []);
  const urlFindings = urls.map((u) => analyzeUrlLocal(u));
  const worstUrl = urlFindings.sort((a, b) => b.score - a.score)[0];
  if (worstUrl && worstUrl.score >= 30) (hits.phishing ??= []).push(`link ${worstUrl.host} (${worstUrl.score})`);
  const mentions = entities?.mentions ?? (t.match(/@\w+/g) ?? []);
  if (mentions.length >= 5) (hits.raid ??= []).push(`${mentions.length} mentions`);
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.75) (hits.spam ??= []).push('ALL CAPS');
  if (/(.)\1{7,}/.test(t) || /(\b\w+\b)(\s+\1\b){4,}/i.test(t)) (hits.spam ??= []).push('repetition');
  if (urls.length >= 3) (hits.spam ??= []).push(`${urls.length} links`);

  const scored = (Object.entries(hits) as [IncidentKind, string[]][]).map(([kind, h]) => {
    let s = KIND_BASE[kind] + 12 * (h.length - 1);
    if (kind === 'phishing' && worstUrl) s = Math.max(s, 40 + worstUrl.score * 0.55);
    return { kind, score: clamp(Math.round(s), 0, 100), hits: h };
  }).sort((a, b) => b.score - a.score);
  // Crisis always wins ties — a person may be at risk.
  const crisis = scored.find((s) => s.kind === 'crisis');
  const top = crisis && crisis.score >= (scored[0]?.score ?? 0) - 15 ? crisis : scored[0];
  const risk = top ? clamp(top.score + Math.min(15, 5 * (scored.length - 1)), 0, 100) : (urls.length ? 12 : 4);
  const kind: IncidentKind | 'none' = top ? top.kind : 'none';
  const severity: Severity = kind === 'crisis' ? (risk >= 75 ? 'critical' : 'high') : risk >= 85 ? 'critical' : risk >= 65 ? 'high' : risk >= 35 ? 'medium' : 'low';
  const labels = scored.map((s) => s.kind as string);
  if (urls.length) labels.push('has_link');
  const rationale = top ? `Matched ${top.kind} signals: ${top.hits.slice(0, 3).join('; ')}${worstUrl ? `. Worst link ${worstUrl.host} scored ${worstUrl.score}/100.` : ''}` : 'No policy-relevant signals found.';
  return { labels, risk, kind, severity, rationale, urlFindings };
}

const POLICIES: { id: string; label: string; action: 'block' | 'escalate' | 'flag'; terms: RegExp[] }[] = [
  { id: 'self-harm', label: 'Self-harm / crisis', action: 'escalate', terms: KIND_TERMS.crisis },
  { id: 'credential-phishing', label: 'Credential phishing', action: 'block', terms: KIND_TERMS.phishing },
  { id: 'financial-scam', label: 'Financial scam', action: 'block', terms: KIND_TERMS.scam },
  { id: 'harassment', label: 'Targeted harassment', action: 'flag', terms: KIND_TERMS.harassment },
  { id: 'hate', label: 'Hateful conduct', action: 'block', terms: KIND_TERMS.hate },
  { id: 'spam', label: 'Spam & raids', action: 'flag', terms: [...KIND_TERMS.spam, ...KIND_TERMS.raid] },
];

// Prelint spec rules for community bots (mirrors specs/ in the repo).
const BOT_SPEC = [
  { id: 'no-admin', label: 'Bot must not request ADMINISTRATOR', test: (p: string[]) => !p.includes('ADMINISTRATOR') },
  { id: 'no-mass-mention', label: 'Bot must not request MENTION_EVERYONE', test: (p: string[]) => !p.includes('MENTION_EVERYONE') },
  { id: 'least-privilege', label: 'Bot requests ≤ 6 permissions', test: (p: string[]) => p.length <= 6 },
  { id: 'no-manage-guild', label: 'Bot must not request MANAGE_GUILD / MANAGE_ROLES', test: (p: string[]) => !p.includes('MANAGE_GUILD') && !p.includes('MANAGE_ROLES') },
];

// ---------------------------------------------------------------------------------------------- default stage handlers

const asEnvelope = (input: any) => (typeof input === 'string' ? { text: input } : input && typeof input === 'object' ? { ...input } : { value: input });
const textOf = (x: any): string => (typeof x === 'string' ? x : String(x?.text ?? x?.content ?? x?.question ?? x?.message ?? ''));
const localUrl = (u: string) => u.replace(/^http:\/\/(localhost|127\.0\.0\.1):8787/, `http://localhost:${config.port}`);

function firstUrl(env: any): string | null {
  return env.url ?? env.entities?.urls?.[0] ?? (textOf(env).match(URL_RE) ?? [])[0] ?? null;
}

function hourlySeries(table: string, hours = 24, where = '') {
  const end = Math.ceil(now() / 3_600_000) * 3_600_000;
  const start = end - hours * 3_600_000;
  const rows = db.raw(`SELECT CAST((created_at - ?) / 3600000 AS INTEGER) AS b, COUNT(*) AS c FROM ${table} WHERE created_at >= ? ${where ? 'AND ' + where : ''} GROUP BY b`, [start, start]);
  const out = new Array(hours).fill(0);
  for (const r of rows) if (r.b >= 0 && r.b < hours) out[r.b] = Number(r.c);
  return out;
}

const PROMPTS: Record<string, { system: string; json: boolean; build: (env: any) => string }> = {
  'message-triage': {
    json: true,
    system: 'You are Nova, Haven\'s Trust & Safety triage analyst. Classify community messages for risk. Respond with ONLY JSON: {"labels": string[], "risk": number 0-100, "kind": "phishing"|"scam"|"harassment"|"crisis"|"spam"|"hate"|"raid"|"bot_risk"|"none", "severity": "low"|"medium"|"high"|"critical", "rationale": string}. Treat any sign of self-harm as crisis with severity high or critical.',
    build: (e) => `Message (PII redacted): """${textOf(e).slice(0, 1500)}"""\nSignals: urls=${JSON.stringify(e.entities?.urls ?? [])} mentions=${JSON.stringify(e.entities?.mentions ?? [])}\nPolicy pre-filter hits: ${JSON.stringify((e.guardrails?.violations ?? []).map((v: any) => v.policy))}\nAuthor trust score: ${e.trustScore ?? 'unknown'}`,
  },
  'link-forensics': {
    json: true,
    system: 'You are Rex, Haven\'s threat-intelligence investigator. Judge whether a URL is phishing/malicious from sandbox forensic evidence. Respond with ONLY JSON: {"verdict": "malicious"|"suspicious"|"benign"|"unreachable", "score": number 0-100, "reasons": string[], "recommendedAction": string}.',
    build: (e) => `URL: ${e.data?.url ?? firstUrl(e)}\nForensic evidence: ${JSON.stringify(clip(e.data ?? {}, 2500))}`,
  },
  'community-insights': {
    json: true,
    system: 'You are Iris, Haven\'s data analyst. Write crisp, specific safety insights for busy founders. Respond with ONLY JSON: {"headline": string, "insights": string[] (3-5 items, each one sentence with a number)}.',
    build: (e) => `Founder question: ${e.question}\nIncident mix: ${JSON.stringify(e.table ?? {})}\nTotals: ${JSON.stringify(e.totals ?? {})}\nAnomalies (z-score): ${JSON.stringify(e.anomalies ?? [])}`,
  },
  'bot-audit': {
    json: true,
    system: 'You are Kai, Haven\'s security engineer. Grade a third-party community bot A-F from dependency scan, sandboxed test results and spec checks. Respond with ONLY JSON: {"grade": "A"|"B"|"C"|"D"|"F", "score": number 0-100, "summary": string, "findings": string[]}.',
    build: (e) => `Target: ${e.target ?? 'sample'}\nSnyk: ${JSON.stringify(clip(e.tools?.tool_http_request_1?.body ?? e.snyk ?? null, 1200))}\nTenki: ${JSON.stringify(clip(e.tools?.tool_http_request_2?.body ?? e.tenki ?? null, 800))}\nPrelint spec: ${JSON.stringify(e.guardrails ?? null)}`,
  },
};

function heuristic(pipelineId: string, env: any): any {
  switch (pipelineId) {
    case 'message-triage': {
      const c = classifyMessageLocal(textOf(env), env.entities);
      return { labels: c.labels, risk: c.risk, kind: c.kind, severity: c.severity, rationale: c.rationale };
    }
    case 'link-forensics': {
      const d = env.data ?? {};
      const score = clamp(Math.round(d.score ?? 0), 0, 100);
      const verdict = d.verdict ?? (score >= 60 ? 'malicious' : score >= 30 ? 'suspicious' : 'benign');
      const reasons = (d.signals ?? []).slice(0, 5).map((s: any) => `${s.label}: ${s.detail}`);
      return { verdict, score, reasons: reasons.length ? reasons : ['No strong phishing indicators observed'], recommendedAction: verdict === 'malicious' ? 'Remove message, ban sender, add domain to shared blocklist' : verdict === 'suspicious' ? 'Quarantine message and warn members' : 'No action needed' };
    }
    case 'community-insights': {
      const totals = env.totals ?? {};
      const mix = Object.entries(env.table ?? {}).sort((a: any, b: any) => b[1] - a[1]);
      const insights: string[] = [];
      insights.push(`${totals.messages ?? 0} messages screened in the last 24h with ${totals.incidents ?? 0} incidents opened (${totals.incidents && totals.messages ? ((100 * totals.incidents) / totals.messages).toFixed(1) : '0.0'}% incident rate).`);
      if (mix.length) insights.push(`Top threat category is ${mix[0][0]} with ${mix[0][1]} incidents${mix[1] ? `, followed by ${mix[1][0]} (${mix[1][1]})` : ''}.`);
      for (const a of (env.anomalies ?? []).slice(0, 2)) insights.push(`${a.series} ${a.direction === 'spike' ? 'spiked' : 'dropped'} to ${a.value} in hour ${a.index + 1} of 24 (z=${a.z}) versus a mean of ${a.mean}.`);
      if (totals.resolved != null) insights.push(`${totals.resolved} incidents resolved; ${totals.open ?? 0} still open or awaiting approval.`);
      const headline = (env.anomalies ?? []).length ? `Unusual ${(env.anomalies[0] as any).series} activity detected` : mix.length ? `${mix[0][0]} leads this period's threats` : 'Quiet period — no notable threats';
      return { headline, insights: insights.slice(0, 5) };
    }
    case 'bot-audit': {
      const snyk = env.tools?.tool_http_request_1?.body ?? env.snyk ?? {};
      const tenki = env.tools?.tool_http_request_2?.body ?? env.tenki ?? {};
      const vulns: any[] = snyk?.vulnerabilities ?? snyk?.issues ?? [];
      const crit = vulns.filter((v) => /critical/i.test(v.severity)).length, high = vulns.filter((v) => /high/i.test(v.severity)).length;
      const failed = Number(tenki?.failed ?? tenki?.summary?.failed ?? 0);
      const specPenalty = (env.guardrails?.violations ?? []).reduce((acc: number, v: any) => acc + (v.policy === 'no-admin' ? 45 : v.policy === 'tests-pass' ? 10 : 18), 0);
      const score = clamp(100 - crit * 25 - high * 12 - failed * 8 - specPenalty, 0, 100);
      const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
      const findings = [
        ...(crit || high ? [`${crit} critical / ${high} high vulnerabilities (Snyk)`] : []),
        ...(failed ? [`${failed} failing tests in Tenki sandbox`] : []),
        ...(env.guardrails?.violations ?? []).map((v: any) => `Spec violation: ${v.label ?? v.policy}`),
        ...(['tool_http_request_1', 'tool_http_request_2'] as const).filter((k) => env.tools?.[k] && !env.tools[k].ok).map((k) => `${k === 'tool_http_request_1' ? 'Snyk scan' : 'Tenki test run'} unavailable (${env.tools[k].error ?? 'HTTP ' + env.tools[k].status}) — graded on remaining evidence`),
      ];
      return { grade, score, summary: findings.length ? `Grade ${grade}: ${findings[0]}${findings.length > 1 ? ` and ${findings.length - 1} more finding(s)` : ''}.` : `Grade ${grade}: no blocking issues found.`, findings };
    }
    default:
      return { answer: `Echo: ${textOf(env).slice(0, 400)}` };
  }
}

async function httpTool(url: string, method: string, body: any, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = now();
  try {
    const res = await fetch(localUrl(url), {
      method, signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-haven-pipeline': '1' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const txt = await res.text();
    let parsed: any = txt;
    try { parsed = JSON.parse(txt); } catch { /* text body */ }
    return { url, method, status: res.status, ok: res.ok, latencyMs: now() - t0, body: parsed };
  } catch (e) {
    return { url, method, status: 0, ok: false, latencyMs: now() - t0, error: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message, body: null };
  } finally { clearTimeout(t); }
}

function defaultHandler(provider: string, component: PipeComponent): StageHandler {
  const params = component.config?.parameters ?? {};
  switch (provider) {
    case 'webhook':
    case 'chat':
      return (input) => asEnvelope(input);

    case 'anonymize_text':
      return (input) => {
        const env = asEnvelope(input);
        const redactions: { type: string; count: number }[] = [];
        let text = textOf(env);
        const rules: [string, RegExp, string][] = [
          ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
          ['CREDIT_CARD', /\b(?:\d[ -]?){13,19}\b/g, '[CARD]'],
          ['PHONE', /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[PHONE]'],
          ['IP_ADDRESS', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[IP]'],
        ];
        // Protect URLs so their paths/hosts are not mangled by the number patterns.
        const urls: string[] = [];
        text = text.replace(URL_RE, (u) => { urls.push(u); return `\u0000${urls.length - 1}\u0000`; });
        for (const [type, re, rep] of rules) {
          let count = 0;
          text = text.replace(re, () => { count++; return rep; });
          if (count) redactions.push({ type, count });
        }
        text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
        return { ...env, text, redactions, piiFound: redactions.reduce((a, r) => a + r.count, 0) };
      };

    case 'ner':
      return (input) => {
        const env = asEnvelope(input);
        const t = textOf(env);
        const entities = {
          urls: [...new Set(t.match(URL_RE) ?? [])],
          mentions: [...new Set(t.match(/(?<![\w.])@[A-Za-z0-9_.]{2,32}/g) ?? [])],
          hashtags: [...new Set(t.match(/(?<![\w])#[A-Za-z0-9_]{2,40}/g) ?? [])],
          emails: [...new Set(t.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [])],
          money: [...new Set(t.match(/[$€£]\s?\d[\d,.]*\s?(k|m|K|M)?|\b\d+(\.\d+)?\s?(btc|eth|usdt|sol)\b/gi) ?? [])],
          entities: [...new Set((t.replace(/\[[A-Z_]+\]/g, ' ').match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z]{2,})\b/g) ?? []).filter((w) => w.length > 2 && !/^(The|This|That|And|But|You|Your|Hey|Hi|Please|Check|Just|Free|Click)$/.test(w)))].slice(0, 12),
        };
        return { ...env, entities };
      };

    case 'guardrails':
      return (input, ctx) => {
        const env = asEnvelope(input);
        if (ctx.pipelineId === 'bot-audit' || params.spec) {
          const perms: string[] = (env.manifest?.permissions ?? env.permissions ?? env.tools?.tool_http_request_1?.body?.manifest?.permissions ?? []).map((p: string) => String(p).toUpperCase());
          const violations = BOT_SPEC.filter((r) => !r.test(perms)).map((r) => ({ policy: r.id, label: r.label, action: 'block' as const }));
          const tests = env.tools?.tool_http_request_2?.body;
          if (tests && Number(tests.failed ?? tests.summary?.failed ?? 0) > 0) violations.push({ policy: 'tests-pass', label: 'All bot tests must pass', action: 'block' });
          return { ...env, guardrails: { spec: params.spec ?? 'prelint', checked: BOT_SPEC.length + 1, permissions: perms, passed: violations.length === 0, action: violations.length ? 'block' : 'allow', violations } };
        }
        const t = textOf(env);
        const violations: { policy: string; label: string; action: string; match: string }[] = [];
        for (const p of POLICIES) for (const re of p.terms) { const m = t.match(re); if (m) { violations.push({ policy: p.id, label: p.label, action: p.action, match: m[0] }); break; } }
        if ((env.piiFound ?? 0) > 0) violations.push({ policy: 'pii-shared', label: 'Personal data shared in public', action: 'flag', match: `${env.piiFound} item(s) redacted` });
        const action = violations.some((v) => v.action === 'escalate') ? 'escalate' : violations.some((v) => v.action === 'block') ? 'block' : violations.length ? 'flag' : 'allow';
        return { ...env, guardrails: { profile: component.config?.profile ?? 'strict', mode: component.config?.strict?.policy_mode ?? 'block', passed: violations.length === 0, action, violations } };
      };

    case 'question':
      return (input, ctx) => {
        const env = asEnvelope(input);
        const question = String(env.question ?? env.text ?? 'What changed in our communities this week?');
        if (env.series && env.table && env.totals) return { ...env, question };
        const since = now() - 24 * 3_600_000;
        const mixRows: any[] = env.table ? [] : db.raw('SELECT kind, COUNT(*) AS c FROM incidents WHERE created_at >= ? GROUP BY kind', [since]);
        const table: Record<string, number> = env.table ?? {};
        for (const r of mixRows) table[r.kind] = Number(r.c);
        const totals = env.totals ?? {
          messages: db.count('messages', 'created_at >= ?', [since]),
          incidents: db.count('incidents', 'created_at >= ?', [since]),
          resolved: db.count('incidents', "status = 'resolved' AND created_at >= ?", [since]),
          open: db.count('incidents', "status IN ('open','investigating','awaiting_approval')"),
          llmCalls: db.count('llm_calls', 'created_at >= ?', [since]),
        };
        const series = env.series ?? {
          messages_per_hour: hourlySeries('messages'),
          incidents_per_hour: hourlySeries('incidents'),
          high_risk_messages_per_hour: hourlySeries('messages', 24, 'risk >= 60'),
        };
        return { ...env, question, series, table, totals };
      };

    case 'anomaly_detector':
      return (input) => {
        const env = asEnvelope(input);
        const threshold = Number(params.threshold ?? 2);
        const series: Record<string, number[]> = {};
        const src = env.series && typeof env.series === 'object' ? env.series : env;
        for (const [k, v] of Object.entries(src)) if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number')) series[k] = v as number[];
        const stats: Record<string, { mean: number; std: number; last: number; zLast: number }> = {};
        const anomalies: { series: string; index: number; value: number; z: number; mean: number; direction: 'spike' | 'drop' }[] = [];
        for (const [k, arr] of Object.entries(series)) {
          const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
          const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
          const r2 = (n: number) => Math.round(n * 100) / 100;
          stats[k] = { mean: r2(mean), std: r2(std), last: arr[arr.length - 1], zLast: std ? r2((arr[arr.length - 1] - mean) / std) : 0 };
          if (!std) continue;
          arr.forEach((v, i) => { const z = (v - mean) / std; if (Math.abs(z) >= threshold) anomalies.push({ series: k, index: i, value: v, z: r2(z), mean: r2(mean), direction: z > 0 ? 'spike' : 'drop' }); });
        }
        anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
        return { ...env, stats, anomalies: anomalies.slice(0, 10), threshold };
      };

    case 'prompt':
      return (input, ctx) => {
        const env = asEnvelope(input);
        const p = PROMPTS[ctx.pipelineId];
        const prompt = p ? p.build(env) : `${params.instructions ?? 'Respond helpfully.'}\n\nInput:\n${JSON.stringify(clip(env, 3000))}`;
        return { ...env, system: p?.system ?? String(params.instructions ?? ''), prompt, wantJson: p?.json ?? /json/i.test(String(params.instructions ?? '')) };
      };

    case 'llm_openai':
    case 'agent_rocketride':
      return async (input, ctx) => {
        const env = asEnvelope(input);
        const prompt = String(env.prompt ?? textOf(env));
        const agentId = String(env.agentId || PIPELINE_META[ctx.pipelineId]?.agent || 'nova');
        const wantJson = env.wantJson ?? true;
        const r = await complete({ agentId, purpose: `rocketride:${ctx.pipelineId}`, tier: 'fast', system: env.system, messages: [{ role: 'user', content: prompt }], json: wantJson, maxTokens: 500, temperature: 0.2, timeoutMs: 20000 });
        let answerJson: any = null;
        if (r) answerJson = wantJson ? extractJson(r.text) : null;
        if (r && (!wantJson || answerJson)) {
          return { ...env, answer: r.text, answerJson, llm: { model: r.model, provider: r.provider, fallback: r.fallback, live: true, costUsd: r.costUsd, latencyMs: r.latencyMs } };
        }
        // Offline brain: deterministic heuristic that does the same job, recorded honestly as offline.
        const h = heuristic(ctx.pipelineId, env);
        const answer = JSON.stringify(h);
        const call = recordOffline(agentId, `rocketride:${ctx.pipelineId}`, 'fast', prompt, answer);
        return { ...env, answer, answerJson: h, llm: { model: call.model, provider: 'offline-brain', fallback: true, live: false, costUsd: 0, latencyMs: call.latencyMs, note: r ? 'model reply was not valid JSON — used local heuristic' : 'no live model configured — local heuristic' } };
      };

    case 'extract_data':
      return (input, ctx) => {
        const env = asEnvelope(input);
        if (ctx.pipelineId === 'link-forensics') {
          const report = env.http?.ok && env.http.body && typeof env.http.body === 'object' ? (env.http.body.report ?? env.http.body) : null;
          const url = report?.url ?? firstUrl(env) ?? '';
          const local = analyzeUrlLocal(url);
          const signals = [...(report?.signals ?? []), ...local.signals.filter((s) => !(report?.signals ?? []).some((r: any) => r.id === s.id))];
          const data = {
            url, finalUrl: report?.finalUrl ?? url, redirects: report?.redirects ?? [], title: report?.title ?? null,
            forms: report?.forms ?? [], screenshot: report?.screenshot ?? null,
            domain: report?.domain ?? { host: local.host, tld: local.tld, lookalikeOf: local.lookalikeOf, entropy: local.entropy, ageDaysEstimate: null },
            signals, score: report?.score ?? clamp(signals.reduce((a: number, s: any) => a + (s.weight ?? 0), 0), 0, 100),
            verdict: report?.verdict ?? null, engine: report?.engine ?? 'static-analysis (sandbox unreachable)',
          };
          return { ...env, data };
        }
        const parsed = env.answerJson ?? (typeof env.answer === 'string' ? extractJson(env.answer) : null) ?? env.data ?? null;
        if (ctx.pipelineId === 'message-triage') {
          const c = parsed ?? heuristic('message-triage', env);
          const kind = (c.kind ?? 'none') as IncidentKind | 'none';
          const risk = clamp(Math.round(Number(c.risk ?? 0)), 0, 100);
          const guard = env.guardrails?.action;
          const route = kind === 'crisis' || guard === 'escalate' ? 'escalate' : risk >= 85 ? 'quarantine' : risk >= 60 ? 'review' : risk >= 30 ? 'monitor' : 'allow';
          const result = {
            labels: Array.isArray(c.labels) ? c.labels : [], risk, kind, severity: c.severity ?? 'low', rationale: c.rationale ?? '',
            route, assignTo: kind === 'none' ? null : KIND_OWNER[kind as IncidentKind] ?? 'aria',
            redactedText: textOf(env), redactions: env.redactions ?? [], signals: env.entities ?? {}, policy: env.guardrails ?? null,
            links: (env.entities?.urls ?? []).slice(0, 5).map((u: string) => { const a = analyzeUrlLocal(u); return { url: u, host: a.host, score: a.score, verdict: a.verdict, lookalikeOf: a.lookalikeOf }; }),
            model: env.llm?.model ?? null, provider: env.llm?.provider ?? null, live: !!env.llm?.live,
          };
          return { ...env, data: parsed, result };
        }
        return { ...env, data: parsed };
      };

    case 'tool_http_request':
      return async (input, ctx) => {
        const env = asEnvelope(input);
        const url: string | undefined = component.config?.url ?? params.url;
        if (!url) return env;
        const method = String(component.config?.method ?? params.method ?? 'POST').toUpperCase();
        const body = { url: firstUrl(env), target: env.target, text: textOf(env) || undefined, incidentId: ctx.incidentId, pipelineRunId: ctx.runId, ...(env.request ?? {}) };
        const http = await httpTool(url, method, body, Number(params.timeout ?? 30) * 1000);
        return { ...env, http, tools: { ...(env.tools ?? {}), [ctx.stageId]: http } };
      };

    case 'tool_pipe':
      return async (input, ctx) => {
        const sub = params.pipeline ?? params.pipe;
        if (!sub || sub === ctx.pipelineId) return asEnvelope(input);
        const run = await runPipeline(String(sub).replace(/\.pipe$/, ''), input, { incidentId: ctx.incidentId, stageDelayMs: 60 });
        return { ...asEnvelope(input), subRun: run.id, subOutput: run.output };
      };

    case 'response_json':
      return (input) => {
        const env = asEnvelope(input);
        if (env.result) return env.result;
        const base = env.answerJson ?? env.data ?? null;
        if (base && typeof base === 'object') return { ...base, ...(env.data && env.answerJson ? { evidence: env.data } : {}), llm: env.llm ?? null };
        const { prompt, system, wantJson, ...rest } = env;
        return rest;
      };

    case 'response_answers':
      return (input) => {
        const env = asEnvelope(input);
        const a = env.answerJson ?? extractJson(String(env.answer ?? '')) ?? null;
        return { ...(a && typeof a === 'object' ? a : { answer: env.answer ?? null }), question: env.question ?? null, anomalies: env.anomalies ?? [], stats: env.stats ?? {}, totals: env.totals ?? {}, llm: env.llm ?? null };
      };

    default:
      return (input) => input;
  }
}

// ---------------------------------------------------------------------------------------------- RocketRide cloud mirror

const cloud = { mirrored: 0, errors: 0, lastError: '', sdk: undefined as undefined | null | any };
const rrKey = () => process.env.ROCKETRIDE_APIKEY?.trim() || config.rocketride.apiKey;
const rrUri = () => process.env.ROCKETRIDE_URI?.trim() || config.rocketride.baseUrl || 'https://api.rocketride.ai';

async function loadSdk(): Promise<any | null> {
  if (cloud.sdk !== undefined) return cloud.sdk;
  try {
    const modName = 'rocketride';
    const m: any = await import(modName);
    cloud.sdk = m.RocketRideClient ?? m.default?.RocketRideClient ?? m.default ?? null;
  } catch { cloud.sdk = null; }
  return cloud.sdk;
}
if (rrKey()) void loadSdk();

async function mirrorToCloud(pipelineId: string, input: any): Promise<boolean> {
  const key = rrKey();
  if (!key) return false;
  const work = (async () => {
    const Client = await loadSdk();
    if (!Client) throw new Error('rocketride SDK not installed (npm i rocketride)');
    const client = new Client({ auth: key, uri: rrUri() });
    if (typeof client.connect === 'function') await client.connect();
    try {
      const used = await client.use({ filepath: path.join(PIPE_DIR, `${pipelineId}.pipe`) });
      const token = used?.token ?? used;
      await client.send(token, JSON.stringify(clip(input, 8000)), { name: 'input.json' }, 'application/json');
      try { await client.terminate?.(token); } catch { /* ignore */ }
    } finally { try { await client.disconnect?.(); } catch { /* ignore */ } }
    return true;
  })();
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('rocketride cloud timeout (20s)')), 20000));
  try {
    await Promise.race([work, timeout]);
    cloud.mirrored++;
    return true;
  } catch (e) {
    cloud.errors++; cloud.lastError = (e as Error).message;
    return false;
  }
}

export function rocketrideStatus(): { mode: 'rocketride-cloud' | 'local'; detail: string; pipelines: number } {
  const pipelines = pipelineIds().length;
  if (!rrKey()) return { mode: 'local', pipelines, detail: `Local RocketRide-compatible engine running ${pipelines} .pipe files (set ROCKETRIDE_API_KEY to mirror runs to RocketRide cloud)` };
  if (cloud.sdk === null) return { mode: 'local', pipelines, detail: 'ROCKETRIDE_API_KEY set but the rocketride SDK is not installed — running .pipe files on the local engine' };
  if (cloud.errors && !cloud.mirrored) return { mode: 'local', pipelines, detail: `RocketRide cloud unreachable (${cloud.lastError}) — running locally` };
  return { mode: 'rocketride-cloud', pipelines, detail: `Mirroring runs to ${rrUri()} · ${cloud.mirrored} mirrored, ${cloud.errors} failed${cloud.lastError ? ` (last error: ${cloud.lastError})` : ''}` };
}

// ---------------------------------------------------------------------------------------------- executor

export async function runPipeline(
  pipelineId: string,
  input: any,
  opts: { incidentId?: string | null; handlers?: Record<string, StageHandler>; stageDelayMs?: number } = {},
): Promise<PipelineRun> {
  const pipe = readPipe(pipelineId);
  if (!pipe) throw new Error(`Unknown pipeline "${pipelineId}" (no pipelines/${pipelineId}.pipe)`);
  const comps = topo(pipe.components);
  const incidentId = opts.incidentId ?? null;
  const delay = opts.stageDelayMs ?? 120;
  const run: PipelineRun = {
    id: id('run'), pipelineId, status: 'running', input, output: null, incidentId, engine: 'local',
    startedAt: now(), finishedAt: null,
    stages: comps.map((c): PipelineStageState => ({ id: c.id, name: c.name || prettify(c.provider), type: c.provider, status: 'pending' })),
  };
  emit('pipeline.run', save(run));

  // Best-effort cloud mirror: never blocks the local run; flips engine label only on success.
  if (rrKey()) {
    void mirrorToCloud(pipelineId, input).then((ok) => {
      if (!ok) return;
      run.engine = 'rocketride-cloud';
      if (run.finishedAt) emit('pipeline.run', save(run));
    });
  }

  const outputs: Record<string, any> = {};
  const emitStage = (stage: PipelineStageState) => emit('pipeline.stage', { runId: run.id, pipelineId, stage: { ...stage }, incidentId });
  let failed: string | null = null;

  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const stage = run.stages[i];
    if (failed) { stage.status = 'skipped'; emitStage(stage); continue; }
    stage.status = 'running'; stage.startedAt = now();
    emitStage(stage);
    const ups = upstreams(c).filter((u) => u in outputs);
    const stageInput = ups.length ? outputs[ups[0]] : input;
    const handler = opts.handlers?.[c.id] ?? opts.handlers?.[c.provider] ?? defaultHandler(c.provider, c);
    try {
      const out = await handler(stageInput, { runId: run.id, pipelineId, stageId: c.id, incidentId, outputs });
      outputs[c.id] = out;
      const spent = now() - stage.startedAt;
      if (spent < delay) await sleep(delay - spent);
      stage.status = 'done'; stage.finishedAt = now(); stage.output = clip(out, 2000);
    } catch (e) {
      failed = (e as Error).message || String(e);
      stage.status = 'error'; stage.finishedAt = now(); stage.output = { error: failed };
      console.warn(`[rocketride] ${pipelineId}/${c.id} failed:`, failed);
    }
    emitStage(stage);
    db.update('pipeline_runs', run.id, { stages: run.stages });
  }

  const last = comps.length ? outputs[comps[comps.length - 1].id] : input;
  run.status = failed ? 'error' : 'done';
  run.output = failed ? { error: failed } : last;
  run.finishedAt = now();
  emit('pipeline.run', save(run));
  return run;
}
