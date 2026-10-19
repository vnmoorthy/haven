import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { ROSTER } from '../agents/roster.js';
import type { AgentId } from '../types.js';

// The sponsor-tool registry: one place that knows how Haven uses each of the 14 tools, whether it is running
// live against the real service or on Haven's local engine, and how to health-check it. Status functions of sibling
// integrations are imported lazily so this module never creates import cycles and tolerates modules still in flight.

export interface Integration {
  id: string; name: string; category: string; purpose: string; usedBy: AgentId[]; mode: 'live' | 'local'; detail: string;
  envVars: string[]; docs: string; stats?: any;
}

interface Def { id: string; name: string; category: string; purpose: string; envVars: string[]; docs: string; module?: string; statusFn?: string }

const DEFS: Def[] = [
  { id: 'kylon', name: 'Kylon', category: 'Workforce', purpose: 'Hosts the 8 AI employees as real teammates (name, specialty, persona, reporting line) next to the human founder.', envVars: ['KYLON_WORKSPACE_ID', 'KYLON_API_KEY'], docs: 'https://docs.kylon.io', module: './kylon.js', statusFn: 'kylonStatus' },
  { id: 'masky', name: 'Masky.AI + Maskord', category: 'Identity', purpose: 'Gives every AI employee a generated face and a distinct voice; Mira and Aria speak to members and the founder through Masky.', envVars: ['MASKY_API_KEY', 'MASKY_BASE_URL', 'MASKORD_WEBHOOK_URL'], docs: 'https://masky.ai/masky-api.md', module: './masky.js', statusFn: 'maskyStatus' },
  { id: 'band', name: 'BAND', category: 'Agent comms', purpose: 'The agent-to-agent nervous system: every delegation, report and hand-off between employees, pipelines and workflows is a BAND message.', envVars: ['BAND_API_KEY', 'BAND_BASE_URL', 'BAND_WORKSPACE'], docs: 'https://docs.band.ai', module: '../bus/band.js' },
  { id: 'n8n', name: 'n8n', category: 'Automation', purpose: 'Runs the business automations: crisis paging, moderator alerts, community onboarding and weekly safety reports.', envVars: ['N8N_URL', 'N8N_API_KEY'], docs: 'https://docs.n8n.io', module: './n8n.js', statusFn: 'n8nStatus' },
  { id: 'rocketride', name: 'RocketRide', category: 'AI pipelines', purpose: 'Executes the .pipe AI pipelines: real-time message triage and the weekly community insights pipeline.', envVars: ['ROCKETRIDE_API_KEY', 'ROCKETRIDE_BASE_URL'], docs: 'https://docs.rocketride.org', module: './rocketride.js', statusFn: 'rocketrideStatus' },
  { id: 'adal', name: 'AdaL', category: 'Browser agent', purpose: 'Rex drives AdaL browser workflows to detonate suspicious links and collect screenshots, forms and redirects as evidence.', envVars: ['ADAL_BIN'], docs: 'https://docs.sylph.ai', module: './adal.js', statusFn: 'adalStatus' },
  { id: 'celesto', name: 'Celesto', category: 'Agent computers', purpose: 'Isolated sandbox computers where links are detonated and untrusted bots are executed, never on Haven hosts.', envVars: ['CELESTO_API_KEY', 'CELESTO_BASE_URL'], docs: 'https://celesto.ai/docs', module: './celesto.js', statusFn: 'celestoStatus' },
  { id: 'flatkey', name: 'Flatkey', category: 'Model gateway', purpose: 'One gateway for every model call: each employee asks for a tier (fast, reasoning, coding, vision) and gets automatic failover and cost tracking.', envVars: ['FLATKEY_API_KEY', 'FLATKEY_BASE_URL', 'FLATKEY_MODEL_FAST', 'FLATKEY_MODEL_REASONING'], docs: 'https://docs.flatkey.ai', module: './flatkey.js' },
  { id: 'promptql', name: 'PromptQL', category: 'Shared context', purpose: 'Iris answers founder questions over live safety data, and the shared context wiki gives every employee the same definitions.', envVars: ['PROMPTQL_MCP_URL', 'PROMPTQL_BOT_TOKEN', 'PROMPTQL_API_KEY', 'PROMPTQL_BASE_URL'], docs: 'https://promptql.io/en/docs', module: './promptql.js', statusFn: 'promptqlStatus' },
  { id: 'paritok', name: 'Paritok', category: 'Context compression', purpose: 'Compresses long-running employees\' working memory so they keep every decision while staying inside their context budget.', envVars: ['PARITOK_API_KEY', 'PARITOK_BASE_URL'], docs: 'https://paritok.com', module: './paritok.js', statusFn: 'paritokStatus' },
  { id: 'finch', name: 'Finch', category: 'Skills', purpose: 'Reusable, versioned SKILL.md skills (phishing forensics, crisis de-escalation, risk scoring...) that can be switched on per employee.', envVars: ['FINCH_API_KEY', 'FINCH_BASE_URL'], docs: 'https://finch.ai', module: './finch.js', statusFn: 'finchStatus' },
  { id: 'tenki', name: 'Tenki', category: 'Sandbox & CI', purpose: 'Kai runs third-party bot test suites in Tenki sandbox runners before a bot can be installed.', envVars: ['TENKI_API_KEY', 'TENKI_BASE_URL'], docs: 'https://tenki.cloud/docs', module: './tenki.js', statusFn: 'tenkiStatus' },
  { id: 'prelint', name: 'Prelint', category: 'Spec compliance', purpose: 'Checks each bot\'s requested permissions and behaviour against Haven\'s product spec (least privilege) before install.', envVars: ['PRELINT_API_KEY', 'PRELINT_BASE_URL'], docs: 'https://prelint.com/docs', module: './prelint.js', statusFn: 'prelintStatus' },
  { id: 'snyk', name: 'Snyk', category: 'Security', purpose: 'Scans bot dependencies and code for known vulnerabilities and secrets as part of Kai\'s bot audit.', envVars: ['SNYK_TOKEN', 'SNYK_BIN'], docs: 'https://docs.snyk.io', module: './snyk.js', statusFn: 'snykStatus' },
];

const binCache = new Map<string, string | null>();
function binVersion(bin: string, args = ['--version']): string | null {
  if (binCache.has(bin)) return binCache.get(bin)!;
  let v: string | null = null;
  try { v = execFileSync(bin, args, { stdio: 'pipe', timeout: 8000 }).toString().trim().split('\n')[0] || 'installed'; } catch { v = null; }
  binCache.set(bin, v);
  return v;
}

const sq = (sql: string, params: any[] = []): any => { try { return db.raw(sql, params)[0] ?? {}; } catch { return {}; } };
const cnt = (table: string, where = '', params: any[] = []) => { try { return db.count(table, where, params); } catch { return 0; } };

async function siblingStatus(def: Def): Promise<any | null> {
  if (!def.module) return null;
  try {
    const mod: any = await import(def.module);
    const fn = (def.statusFn && mod[def.statusFn]) || mod.status || (def.id === 'band' ? () => mod.band?.status?.() : null) || (def.id === 'flatkey' ? mod.llmMode : null);
    return typeof fn === 'function' ? (await fn()) ?? null : null;
  } catch { return null; }
}

const isLive = (m: any) => typeof m === 'string' ? !!m && !/local|offline/i.test(m) : typeof m === 'boolean' ? m : false;

function envMode(id: string): { live: boolean; detail: string } {
  switch (id) {
    case 'kylon': return { live: !!(process.env.KYLON_WORKSPACE_ID && binVersion('kylon')), detail: 'Local workforce manifest (kylon/workforce.yaml)' };
    case 'masky': return { live: !!config.masky.apiKey, detail: config.masky.apiKey ? 'Masky.AI faces + voices' : 'Local faces + browser speech (add MASKY_API_KEY)' };
    case 'band': return { live: !!config.band.apiKey, detail: config.band.apiKey ? `BAND cloud workspace "${config.band.workspace}"` : 'Local BAND-compatible bus (add BAND_API_KEY to mirror to BAND cloud)' };
    case 'n8n': return { live: !!config.n8n.url, detail: config.n8n.url ? `n8n at ${config.n8n.url}` : 'Local n8n-compatible workflow runner (n8n/*.json)' };
    case 'rocketride': return { live: !!config.rocketride.apiKey, detail: config.rocketride.apiKey ? 'RocketRide cloud pipelines' : 'Local .pipe pipeline engine (pipelines/*.pipe)' };
    case 'adal': { const v = binVersion(config.adal.bin); return { live: !!v, detail: v ? `AdaL CLI ${v}` : 'Local Playwright browser driver (install AdaL CLI for live)' }; }
    case 'celesto': return { live: !!config.celesto.apiKey, detail: config.celesto.apiKey ? 'Celesto sandbox computers' : 'Local isolated headless sandbox' };
    case 'flatkey': return { live: !!config.flatkey.apiKey, detail: config.flatkey.apiKey ? `Flatkey gateway (${config.flatkey.baseUrl})` : 'Direct provider / offline brain (add FLATKEY_API_KEY)' };
    case 'promptql': { const on = !!((process.env.PROMPTQL_MCP_URL || config.promptql.baseUrl) && (process.env.PROMPTQL_BOT_TOKEN || config.promptql.apiKey)); return { live: on, detail: on ? 'PromptQL MCP' : 'Local NL→SQL over live SQLite' }; }
    case 'paritok': return { live: !!config.paritok.apiKey, detail: config.paritok.apiKey ? 'Paritok GPU compressor' : 'Local extractive + abstractive compressor' };
    case 'finch': return { live: !!(config.finch.apiKey && config.finch.baseUrl), detail: 'Finch-format skills from skills/' };
    case 'tenki': return { live: !!config.tenki.apiKey, detail: config.tenki.apiKey ? 'Tenki sandbox runners' : 'Local sandboxed test runner' };
    case 'prelint': return { live: !!config.prelint.apiKey, detail: config.prelint.apiKey ? 'Prelint spec checks' : 'Local spec checker (specs/)' };
    case 'snyk': {
      const v = binVersion(config.snyk.bin);
      const last = sq(`SELECT snyk FROM audits WHERE status = 'done' ORDER BY created_at DESC LIMIT 1`);
      const usedOsv = typeof last.snyk === 'string' && /OSV/i.test(last.snyk);
      const live = !!v && (!!config.snyk.token || (!!last.snyk && !usedOsv));
      return { live, detail: !v ? 'Local OSV.dev advisory scan (install the Snyk CLI for live scans)' : live ? `Snyk CLI ${v}${config.snyk.token ? ' (token set)' : ''}` : `Snyk CLI ${v} installed but not authenticated — using OSV.dev fallback (run \`snyk auth\`)` };
    }
    default: return { live: false, detail: 'local' };
  }
}

function forensicsCount(): number {
  try { const dir = join(config.dataDir, 'forensics'); return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).length : 0; } catch { return 0; }
}

function statsFor(id: string, s: any): any {
  switch (id) {
    case 'kylon': return { employees: ROSTER.length, synced: s?.created ?? 0 };
    case 'masky': return { avatars: s?.avatars ?? 0, spoken: s?.spoken ?? 0, liveTurns: s?.liveTurns ?? 0 };
    case 'band': return { messages: cnt('band_messages'), mirrored: s?.mirrored ?? 0, participants: s?.participants?.length ?? 0, cloud: cnt('band_messages', 'remote = ?', ['band-cloud']) };
    case 'n8n': return { runs: cnt('automation_runs'), success: cnt('automation_runs', 'status = ?', ['success']) };
    case 'rocketride': return { runs: cnt('pipeline_runs'), done: cnt('pipeline_runs', 'status = ?', ['done']) };
    case 'adal': case 'celesto': return { detonations: s?.detonations ?? s?.runs ?? forensicsCount() };
    case 'flatkey': { const r = sq(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(fallback),0) AS failovers, COALESCE(SUM(prompt_tokens + completion_tokens),0) AS tokens FROM llm_calls`); return { calls: Number(r.calls) || 0, costUsd: Math.round((Number(r.cost) || 0) * 10000) / 10000, failovers: Number(r.failovers) || 0, tokens: Number(r.tokens) || 0 }; }
    case 'promptql': return { wikiEntries: cnt('wiki'), questions: s?.questions ?? 0 };
    case 'paritok': { const r = sq(`SELECT COUNT(*) AS runs, COALESCE(SUM(before_tokens - after_tokens),0) AS saved FROM compressions`); return { compressions: Number(r.runs) || 0, tokensSaved: Number(r.saved) || 0 }; }
    case 'finch': return { skills: s?.skills ?? 0 };
    case 'tenki': case 'prelint': case 'snyk': return { audits: cnt('audits'), done: cnt('audits', 'status = ?', ['done']) };
    default: return {};
  }
}

export async function integrations(): Promise<Integration[]> {
  return Promise.all(DEFS.map(async (d) => {
    const s = await siblingStatus(d);
    const env = envMode(d.id);
    const statusMode = s?.mode ?? s?.live;
    const siblingLive = statusMode !== undefined && d.id !== 'flatkey' ? isLive(statusMode) : null;
    const live = siblingLive === null ? env.live : siblingLive || (d.id === 'snyk' && env.live);
    const detail = typeof s?.detail === 'string' && s.detail && (siblingLive === null || siblingLive === live) ? s.detail : env.detail;
    return {
      id: d.id, name: d.name, category: d.category, purpose: d.purpose,
      usedBy: ROSTER.filter((e) => e.tools.includes(d.id)).map((e) => e.id),
      mode: live ? 'live' : 'local', detail: live || /local|offline/i.test(detail) ? detail : `Local: ${detail}`,
      envVars: d.envVars, docs: d.docs, stats: statsFor(d.id, s),
    } satisfies Integration;
  }));
}

/* ------------------------------------------------------------------ tests ------------------------------------------------------------------ */

async function http(url: string, headers: Record<string, string> = {}, timeoutMs = 8000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.text()).slice(0, 300);
  return { ok: res.ok, status: res.status, body };
}

const execP = (bin: string, args: string[], timeout = 20000) => new Promise<{ ok: boolean; out: string }>((resolve) => {
  execFile(bin, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || err?.message || '').trim() }));
});

async function healthCheck(name: string, baseUrl: string, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  if (!baseUrl) return { ok: true, detail: `${name} key configured (no ${name.toUpperCase()}_BASE_URL to ping) — requests use the default endpoint` };
  const root = baseUrl.replace(/\/$/, '');
  for (const p of ['/health', '/healthz', '']) {
    try {
      const r = await http(`${root}${p}`, { Authorization: `Bearer ${apiKey}` });
      if (r.ok || r.status === 401 || r.status === 404) return { ok: r.ok || r.status === 404, detail: `${name} reachable at ${root}${p} (HTTP ${r.status})` };
    } catch { /* try next */ }
  }
  return { ok: false, detail: `${name} unreachable at ${root}` };
}

export async function testIntegration(intId: string): Promise<{ ok: boolean; detail: string; latencyMs: number }> {
  const t0 = Date.now();
  const done = (ok: boolean, detail: string) => ({ ok, detail, latencyMs: Date.now() - t0 });
  const hc = async (name: string, baseUrl: string, apiKey: string) => { const r = await healthCheck(name, baseUrl, apiKey); return done(r.ok, r.detail); };
  try {
    switch (intId) {
      case 'flatkey': {
        if (!config.flatkey.apiKey) { const m = (await import('./flatkey.js')).llmMode(); return done(true, `local engine ready — ${m.detail}`); }
        const r = await http(`${config.flatkey.baseUrl.replace(/\/$/, '')}/models`, { Authorization: `Bearer ${config.flatkey.apiKey}` });
        let n = 0; try { n = JSON.parse(r.body).data?.length ?? 0; } catch { /* truncated */ }
        return done(r.ok, r.ok ? `Flatkey gateway OK${n ? ` (${n}+ models)` : ''}` : `Flatkey HTTP ${r.status}: ${r.body.slice(0, 120)}`);
      }
      case 'band': {
        if (!config.band.apiKey) { const b = (await import('../bus/band.js')).band.status(); return done(true, `local engine ready — BAND bus with ${b.participants.length} participants, ${cnt('band_messages')} messages`); }
        const roots = [config.band.baseUrl, 'https://app.band.ai/api/v1'].filter(Boolean).map((u) => u.replace(/\/$/, ''));
        for (const root of roots) for (const p of ['/agent/me', '/me/profile']) {
          try { const r = await http(`${root}${p}`, { 'X-API-Key': config.band.apiKey, Authorization: `Bearer ${config.band.apiKey}` }); if (r.ok) return done(true, `BAND authenticated (${root}${p})`); } catch { /* next */ }
        }
        return done(false, 'BAND key rejected or endpoint unreachable — local bus still running');
      }
      case 'masky': {
        if (!config.masky.apiKey) return done(true, 'local engine ready — DiceBear faces + browser speech synthesis');
        const r = await http(`${(config.masky.baseUrl || 'https://masky.ai/api').replace(/\/$/, '')}/avatars`, { Authorization: `Bearer ${config.masky.apiKey}` });
        let n = 0; try { n = JSON.parse(r.body).avatars?.length ?? 0; } catch { /* truncated */ }
        return done(r.ok, r.ok ? `Masky key valid${n ? ` (${n} avatars)` : ''}` : `Masky HTTP ${r.status}`);
      }
      case 'snyk': {
        const v = await execP(config.snyk.bin, ['--version'], 10000);
        if (!v.ok) return done(true, 'Snyk CLI not installed — local advisory matcher ready');
        const who = await execP(config.snyk.bin, ['whoami', '--experimental'], 15000);
        return done(true, `Snyk CLI ${v.out.split('\n')[0]}${who.ok && who.out ? ` — authenticated as ${who.out.split('\n')[0].slice(0, 60)}` : ' — not authenticated (run `snyk auth` or set SNYK_TOKEN)'}`);
      }
      case 'n8n': {
        if (!config.n8n.url) return done(true, 'local engine ready — n8n-compatible workflow runner');
        const r = await http(`${config.n8n.url.replace(/\/$/, '')}/healthz`, config.n8n.apiKey ? { 'X-N8N-API-KEY': config.n8n.apiKey } : {});
        return done(r.ok, r.ok ? `n8n healthy at ${config.n8n.url}` : `n8n HTTP ${r.status}`);
      }
      case 'promptql': {
        const { askData, promptqlStatus } = await import('./promptql.js');
        const st = promptqlStatus();
        const r = await askData('Which kind of incident is most common?');
        return done(true, `${st.mode === 'promptql' ? (r.engine === 'promptql' ? 'PromptQL MCP answered' : 'PromptQL configured but unreachable, answered locally') : 'local engine ready'} — ${r.rows.length} rows via ${r.model}: ${r.answer.slice(0, 120)}`);
      }
      case 'paritok': {
        if (!config.paritok.apiKey) return done(true, 'local engine ready — extractive + abstractive compressor');
        return hc('Paritok', config.paritok.baseUrl || 'https://www.paritok.com/api', config.paritok.apiKey);
      }
      case 'finch': {
        const f = await import('./finch.js');
        const n = f.listSkills().length;
        if (!(config.finch.apiKey && config.finch.baseUrl)) return done(n > 0, `local engine ready — ${n} SKILL.md skills loaded`);
        const p = await f.publishSkills();
        return done(p.ok, `Finch: ${p.detail}`);
      }
      case 'kylon': {
        const k = await import('./kylon.js');
        const v = binVersion('kylon');
        return done(true, v ? `Kylon CLI ${v}${process.env.KYLON_WORKSPACE_ID ? ` — workspace ${process.env.KYLON_WORKSPACE_ID}` : ' — set KYLON_WORKSPACE_ID to sync'}` : `local engine ready — manifest with ${k.workforceManifest()?.employees?.length ?? 0} employees (install Kylon CLI to sync)`);
      }
      case 'adal': {
        const v = await execP(config.adal.bin, ['--version'], 8000);
        return done(true, v.ok ? `AdaL CLI ${v.out.split('\n')[0]}` : 'AdaL CLI not installed — local Playwright driver ready');
      }
      case 'rocketride': return config.rocketride.apiKey ? hc('RocketRide', config.rocketride.baseUrl, config.rocketride.apiKey) : done(true, 'local engine ready — .pipe pipeline engine');
      case 'celesto': return config.celesto.apiKey ? hc('Celesto', config.celesto.baseUrl, config.celesto.apiKey) : done(true, 'local engine ready — isolated headless sandbox');
      case 'tenki': return config.tenki.apiKey ? hc('Tenki', config.tenki.baseUrl, config.tenki.apiKey) : done(true, 'local engine ready — sandboxed test runner');
      case 'prelint': return config.prelint.apiKey ? hc('Prelint', config.prelint.baseUrl, config.prelint.apiKey) : done(true, 'local engine ready — spec checker');
      default: return done(false, `Unknown integration "${intId}"`);
    }
  } catch (e) {
    return done(false, `Test failed: ${(e as Error).message}`);
  }
}
