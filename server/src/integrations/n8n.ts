import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { emit, sleep } from '../events.js';
import { id, now } from '../util.js';
import type { AutomationRun } from '../types.js';

// n8n runs Haven's business automations (onboarding, moderator alerts, crisis paging, enforcement audit log, weekly
// report). Every workflow is a real, importable n8n workflow JSON in /n8n. When N8N_URL is set Haven triggers the
// workflow's production webhook on that n8n instance; otherwise Haven's local executor walks the same graph node by
// node — evaluating n8n expressions, IF branches and Set nodes — and performs real side effects (Slack webhook,
// .eml files in data/outbox, audit log lines).

const WF_DIR = path.join(ROOT, 'n8n');
const OUTBOX = () => path.join(config.dataDir, 'outbox');

interface N8nNode { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: any; webhookId?: string; credentials?: any; onError?: string; disabled?: boolean }
interface N8nWorkflow { name: string; nodes: N8nNode[]; connections: Record<string, { main: { node: string; type: string; index: number }[][] }>; active?: boolean; settings?: any }
type Step = AutomationRun['steps'][number];

const DESCRIPTIONS: Record<string, string> = {
  'community-onboarding': 'Leo onboards a new community: creates the tenant, provisions it in Haven and emails the welcome pack.',
  'moderator-alert': 'Critical incidents page human moderators on Slack + email; everything else is queued for the daily moderator digest.',
  'crisis-escalation': 'Mira\'s crisis protocol: attaches crisis-line resources, pages the human on-call and notifies #wellbeing within seconds.',
  'enforcement-log': 'Every ban / mute / removal becomes an immutable audit record — who acted, who approved, and why.',
  'weekly-safety-report': 'Every Monday 09:00: pulls safety metrics, asks Iris (PromptQL) for the story behind them and emails the founders.',
};

const stats = { remoteOk: 0, remoteFail: 0, lastError: '', localRuns: 0 };

// ---------------------------------------------------------------------------------------------- loading

function readWorkflow(workflowId: string): N8nWorkflow | null {
  const safe = workflowId.replace(/[^a-z0-9-]/gi, '');
  const file = path.join(WF_DIR, `${safe}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as N8nWorkflow; } catch (e) { console.warn(`[n8n] bad workflow ${file}:`, (e as Error).message); return null; }
}

const shortType = (t: string) => t.replace(/^n8n-nodes-base\./, '').replace(/^@n8n\/n8n-nodes-langchain\./, 'ai.');
const isTrigger = (n: N8nNode) => /webhook$|Trigger$|trigger$/.test(n.type) && !/respondToWebhook/.test(n.type);

/** Nodes in execution (BFS over connections) order, starting from the trigger. Unreachable nodes go last. */
function orderedNodes(wf: N8nWorkflow): N8nNode[] {
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const start = wf.nodes.filter(isTrigger);
  const seen = new Set<string>();
  const out: N8nNode[] = [];
  const queue = [...(start.length ? start : wf.nodes.slice(0, 1))];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.name)) continue;
    seen.add(n.name); out.push(n);
    for (const branch of wf.connections[n.name]?.main ?? []) for (const c of branch ?? []) { const nx = byName.get(c.node); if (nx && !seen.has(nx.name)) queue.push(nx); }
  }
  for (const n of wf.nodes) if (!seen.has(n.name)) out.push(n);
  return out;
}

function triggerOf(wf: N8nWorkflow): string {
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (hook) return `webhook /webhook/${hook.parameters?.path ?? ''}`;
  const sched = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (sched) {
    const iv = sched.parameters?.rule?.interval?.[0] ?? {};
    return `schedule ${iv.field === 'weeks' ? 'weekly' : iv.field === 'days' ? 'daily' : iv.field ?? 'cron'}`;
  }
  return 'manual';
}

export function automationIds(): string[] {
  if (!existsSync(WF_DIR)) return [];
  const order = Object.keys(DESCRIPTIONS);
  return readdirSync(WF_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    .sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
}

export function automationRuns(workflowId: string, limit = 10): AutomationRun[] {
  return db.list<AutomationRun>('automation_runs', 'workflow_id = ?', [workflowId], 'started_at DESC', limit);
}

export function getAutomation(workflowId: string) {
  const wf = readWorkflow(workflowId);
  if (!wf) return null;
  return {
    id: workflowId, name: wf.name, description: DESCRIPTIONS[workflowId] ?? wf.name, file: `n8n/${workflowId}.json`,
    trigger: triggerOf(wf), nodes: orderedNodes(wf).map((n) => ({ name: n.name, type: shortType(n.type) })),
  };
}

export function listAutomations(): { id: string; name: string; description: string; file: string; trigger: string; nodes: { name: string; type: string }[]; runs: AutomationRun[] }[] {
  const out = [];
  for (const wid of automationIds()) {
    const a = getAutomation(wid);
    if (a) out.push({ ...a, runs: automationRuns(wid, 10) });
  }
  return out;
}

export function n8nStatus(): { mode: 'n8n' | 'local'; detail: string; workflows: number } {
  const workflows = automationIds().length;
  if (config.n8n.url) {
    return { mode: 'n8n', workflows, detail: `Triggering workflows on ${config.n8n.url} · ${stats.remoteOk} ok, ${stats.remoteFail} fell back to local${stats.lastError ? ` (last error: ${stats.lastError})` : ''}` };
  }
  return { mode: 'local', workflows, detail: `Local n8n-compatible executor running ${workflows} importable workflows (set N8N_URL to run them on your n8n instance)${stats.localRuns ? ` · ${stats.localRuns} local runs` : ''}` };
}

// ---------------------------------------------------------------------------------------------- expressions

/** Minimal n8n expression engine: "={{ js }}" and "=text {{ js }} text" with $json, $env, $now, $('Node').item.json. */
function makeCtx(item: any, outputs: Record<string, any>) {
  const $ = (name: string) => {
    const j = outputs[name] ?? {};
    const it = { json: j };
    return { item: it, first: () => it, last: () => it, all: () => [it], json: j };
  };
  const $now = { toISO: () => new Date().toISOString(), toString: () => new Date().toISOString(), toMillis: () => Date.now(), toFormat: () => new Date().toISOString() };
  return { $json: item ?? {}, $env: process.env, $now, $, $input: { first: () => ({ json: item }), item: { json: item } }, $workflow: { name: 'haven' } };
}

function evalJs(expr: string, ctx: ReturnType<typeof makeCtx>): any {
  try {
    const fn = new Function('$json', '$env', '$now', '$', '$input', '$workflow', `return (${expr});`);
    return fn(ctx.$json, ctx.$env, ctx.$now, ctx.$, ctx.$input, ctx.$workflow);
  } catch { return undefined; }
}

function evaluate(value: any, item: any, outputs: Record<string, any>): any {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const body = value.slice(1);
  const ctx = makeCtx(item, outputs);
  const whole = body.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
  if (whole && !whole[1].includes('}}')) return evalJs(whole[1], ctx);
  return body.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => { const v = evalJs(e, ctx); return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); });
}

function setPath(obj: any, key: string, v: any) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
  o[parts[parts.length - 1]] = v;
}

function cast(v: any, type: string) {
  if (type === 'number') return Number(v);
  if (type === 'boolean') return v === true || v === 'true';
  if ((type === 'array' || type === 'object') && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

function condition(c: any, item: any, outputs: Record<string, any>): boolean {
  const l = evaluate(c.leftValue, item, outputs), r = evaluate(c.rightValue, item, outputs);
  const op = c.operator?.operation ?? 'equals';
  const ls = String(l ?? ''), rs = String(r ?? '');
  switch (op) {
    case 'equals': return ls === rs;
    case 'notEquals': return ls !== rs;
    case 'contains': return ls.includes(rs);
    case 'notContains': return !ls.includes(rs);
    case 'startsWith': return ls.startsWith(rs);
    case 'endsWith': return ls.endsWith(rs);
    case 'gt': return Number(l) > Number(r);
    case 'gte': return Number(l) >= Number(r);
    case 'lt': return Number(l) < Number(r);
    case 'lte': return Number(l) <= Number(r);
    case 'true': return l === true || ls === 'true';
    case 'false': return l === false || ls === 'false';
    case 'exists': case 'notEmpty': return l != null && ls !== '';
    case 'notExists': case 'empty': return l == null || ls === '';
    default: return ls === rs;
  }
}

// ---------------------------------------------------------------------------------------------- side effects

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const localUrl = (u: string) => u.replace(/^http:\/\/(localhost|127\.0\.0\.1):8787/, `http://localhost:${config.port}`);

function outboxWrite(name: string, content: string) {
  mkdirSync(OUTBOX(), { recursive: true });
  let file = path.join(OUTBOX(), name);
  for (let i = 2; existsSync(file); i++) file = path.join(OUTBOX(), name.replace(/(\.\w+)$/, `-${i}$1`));
  writeFileSync(file, content);
  return path.relative(ROOT, file);
}

async function postJson(url: string, body: any, timeoutMs = 10000, method = 'POST') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctrl.signal, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) }) });
    const txt = await res.text();
    let json: any = txt;
    try { json = JSON.parse(txt); } catch { /* text */ }
    return { ok: res.ok, status: res.status, json };
  } finally { clearTimeout(t); }
}

function localMetricsFallback() {
  const since = now() - 7 * 86_400_000;
  return {
    screened: db.count('messages', 'created_at >= ?', [since]),
    threatsBlocked: db.count('messages', "status IN ('quarantined','removed') AND created_at >= ?", [since]),
    incidentsResolved: db.count('incidents', "status = 'resolved' AND created_at >= ?", [since]),
    incidentsOpen: db.count('incidents', "status IN ('open','investigating','awaiting_approval')"),
    medianTimeToActionMs: 0, llmSpendUsd: Number(db.raw('SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_calls WHERE created_at >= ?', [since])[0]?.s ?? 0),
    humanHoursSaved: 0, source: 'local-db (Haven API unreachable)',
  };
}

interface NodeResult { item: any; detail: string; output?: number; status?: string }

async function execNode(n: N8nNode, item: any, outputs: Record<string, any>, workflowId: string, payload: any, sideEffects: boolean): Promise<NodeResult> {
  const p = n.parameters ?? {};
  const ev = (v: any) => evaluate(v, item, outputs);
  switch (n.type) {
    case 'n8n-nodes-base.webhook':
      return { item: { headers: { 'content-type': 'application/json' }, params: {}, query: {}, body: payload ?? {}, webhookUrl: `/webhook/${p.path}`, executionMode: 'production' }, detail: `POST /webhook/${p.path} received (${Object.keys(payload ?? {}).length} fields)` };
    case 'n8n-nodes-base.scheduleTrigger':
    case 'n8n-nodes-base.manualTrigger':
      return { item: { timestamp: new Date().toISOString(), ...(payload ?? {}) }, detail: `triggered ${new Date().toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` };

    case 'n8n-nodes-base.set': {
      const base = p.includeOtherFields ? { ...item } : {};
      const list: any[] = p.assignments?.assignments ?? [];
      for (const a of list) setPath(base, a.name, cast(ev(a.value), a.type));
      return { item: base, detail: `set ${list.map((a) => a.name).slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''}` };
    }

    case 'n8n-nodes-base.if': {
      const conds: any[] = p.conditions?.conditions ?? [];
      const results = conds.map((c) => condition(c, item, outputs));
      const pass = (p.conditions?.combinator ?? 'and') === 'or' ? results.some(Boolean) : results.every(Boolean);
      const c0 = conds[0];
      return { item, output: pass ? 0 : 1, detail: `${c0 ? `${String(ev(c0.leftValue) ?? '∅')} ${c0.operator?.operation ?? '='} ${String(ev(c0.rightValue))}` : 'condition'} → ${pass ? 'true' : 'false'}` };
    }

    case 'n8n-nodes-base.httpRequest': {
      const rawUrl = String(p.url ?? '');
      const url = String(ev(p.url) ?? '');
      const method = String(p.method ?? 'GET').toUpperCase();
      const bodyRaw = p.sendBody ? ev(p.jsonBody ?? '{}') : undefined;
      let body: any = bodyRaw;
      if (typeof bodyRaw === 'string') { try { body = JSON.parse(bodyRaw); } catch { body = bodyRaw; } }
      const isSlack = rawUrl.includes('SLACK_WEBHOOK_URL') || /hooks\.slack\.com/.test(url);
      if (isSlack) {
        if (!sideEffects) return { item, detail: 'Slack (n8n)' };
        const target = url || config.slackWebhook;
        if (target) {
          try { const r = await postJson(target, { text: body?.text ?? String(body ?? '') }); return { item: { ok: r.ok, status: r.status }, detail: r.ok ? 'posted to Slack' : `Slack responded ${r.status}`, status: r.ok ? 'success' : 'error' }; }
          catch (e) { return { item, detail: `Slack unreachable: ${(e as Error).message}`, status: 'error' }; }
        }
        const f = outboxWrite(`${Date.now()}-${workflowId}-slack.json`, JSON.stringify({ channel: n.name, text: body?.text ?? body, at: new Date().toISOString() }, null, 2));
        return { item, detail: `SLACK_WEBHOOK_URL not set — message written to ${f}` };
      }
      const isHook = /\/api\/hooks\//.test(url);
      if (isHook) {
        if (sideEffects) appendFileSync((mkdirSync(OUTBOX(), { recursive: true }), path.join(OUTBOX(), 'hooks.jsonl')), JSON.stringify({ at: new Date().toISOString(), workflow: workflowId, node: n.name, url, body }) + '\n');
        return { item, detail: `success (local) — Haven applies ${url.replace(/^.*\/api\/hooks\//, 'hooks/')} in-process` };
      }
      if (!sideEffects) return { item, detail: `${method} ${url}` };
      if (!/^https?:\/\//.test(url)) return { item, detail: `no URL configured (${rawUrl}) — skipped`, status: 'skipped' };
      try {
        const r = await postJson(localUrl(url), body, 15000, method);
        return { item: typeof r.json === 'object' && r.json ? r.json : { data: r.json }, detail: `${method} ${url.replace(/^https?:\/\/[^/]+/, '')} → ${r.status}`, status: r.ok ? 'success' : 'error' };
      } catch (e) {
        if (/\/api\/metrics/.test(url)) return { item: localMetricsFallback(), detail: 'Haven API unreachable — metrics read from local database' };
        if (/\/api\/ask/.test(url)) return { item: { answer: 'Iris was unreachable when this report ran; see the metrics above.' }, detail: 'Haven API unreachable — Iris skipped', status: 'error' };
        return { item, detail: `${method} ${url} failed: ${(e as Error).message}`, status: n.onError ? 'success' : 'error' };
      }
    }

    case 'n8n-nodes-base.emailSend': {
      const to = String(ev(p.toEmail) ?? ''), from = String(ev(p.fromEmail) ?? 'haven@localhost');
      const subject = String(ev(p.subject) ?? '(no subject)');
      const text = String(ev(p.text ?? p.html ?? '') ?? '');
      if (!sideEffects) return { item, detail: `email to ${to}` };
      const eml = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, `X-Haven-Workflow: ${workflowId}`, `X-Haven-Node: ${n.name}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n');
      const f = outboxWrite(`${Date.now()}-${workflowId}.eml`, eml);
      return { item: { accepted: [to], subject, file: f }, detail: `queued to outbox (no SMTP configured) → ${to}: "${subject.slice(0, 60)}"` };
    }

    case 'n8n-nodes-base.respondToWebhook': {
      const raw = ev(p.responseBody ?? '{}');
      let resp: any = raw;
      if (typeof raw === 'string') { try { resp = JSON.parse(raw); } catch { resp = raw; } }
      return { item: resp, detail: `responded 200 ${JSON.stringify(resp).slice(0, 120)}` };
    }

    case 'n8n-nodes-base.noOp':
      return { item, detail: 'no-op' };
    default:
      return { item, detail: `${shortType(n.type)} (passthrough in local executor)` };
  }
}

// ---------------------------------------------------------------------------------------------- executor

function snapshot(run: AutomationRun): AutomationRun {
  return { ...run, steps: run.steps.map((s) => ({ ...s })) };
}
function publish(run: AutomationRun) {
  const s = snapshot(run);
  db.insert('automation_runs', s);
  emit('automation.run', s);
}

/** Walk the workflow graph. With sideEffects=false it only evaluates routing (used to label steps after a remote n8n run). */
async function walk(wf: N8nWorkflow, workflowId: string, payload: any, run: AutomationRun | null, sideEffects: boolean): Promise<{ visited: Set<string>; results: Record<string, NodeResult>; error: string | null }> {
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const outputs: Record<string, any> = {};
  const results: Record<string, NodeResult> = {};
  const visited = new Set<string>();
  const start = wf.nodes.filter(isTrigger);
  const queue: { node: N8nNode; item: any }[] = (start.length ? start : wf.nodes.slice(0, 1)).map((node) => ({ node, item: payload }));
  let error: string | null = null;
  const step = (name: string) => run?.steps.find((s) => s.name === name);

  while (queue.length) {
    const { node, item } = queue.shift()!;
    if (visited.has(node.name) || node.disabled) continue;
    visited.add(node.name);
    const st = step(node.name);
    if (st && run) { st.status = 'running'; publish(run); }
    const t0 = now();
    let res: NodeResult;
    try { res = await execNode(node, item, outputs, workflowId, payload, sideEffects); }
    catch (e) { res = { item, detail: (e as Error).message, status: 'error' }; }
    results[node.name] = res;
    outputs[node.name] = res.item;
    if (sideEffects) { const wait = 150 + Math.random() * 150 - (now() - t0); if (wait > 0) await sleep(wait); }
    if (st && run) { st.status = res.status ?? 'success'; st.detail = res.detail; publish(run); }
    if (res.status === 'error' && !node.onError) { error = `${node.name}: ${res.detail}`; break; }
    const branches = wf.connections[node.name]?.main ?? [];
    const take = res.output != null ? [branches[res.output] ?? []] : branches;
    for (const b of take) for (const c of b ?? []) { const nx = byName.get(c.node); if (nx) queue.push({ node: nx, item: res.item }); }
  }
  return { visited, results, error };
}

export async function runAutomation(workflowId: string, payload: any, trigger = 'api'): Promise<AutomationRun> {
  const wf = readWorkflow(workflowId);
  if (!wf) throw new Error(`Unknown automation "${workflowId}" (no n8n/${workflowId}.json)`);
  const nodes = orderedNodes(wf);
  const run: AutomationRun = {
    id: id('auto'), workflowId, trigger, status: 'running', mode: 'local', startedAt: now(), finishedAt: null, payload: payload ?? {},
    steps: nodes.map((n): Step => ({ name: n.name, status: 'pending' })),
  };
  publish(run);

  // 1) Real n8n instance: trigger the production webhook.
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  let remoteNote = '';
  if (config.n8n.url && hook) {
    const url = `${config.n8n.url.replace(/\/$/, '')}/webhook/${hook.parameters?.path ?? `haven-${workflowId}`}`;
    try {
      const r = await postJson(url, payload ?? {}, 10000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const dry = await walk(wf, workflowId, payload, null, false);
      for (const s of run.steps) {
        if (dry.visited.has(s.name)) { s.status = 'success'; s.detail = `executed by n8n${s.name === hook.name ? ` (${url})` : ''}`; }
        else { s.status = 'skipped'; s.detail = 'branch not taken'; }
      }
      const last = [...run.steps].reverse().find((s) => s.status === 'success');
      if (last && typeof r.json === 'object') last.detail = `executed by n8n → ${JSON.stringify(r.json).slice(0, 160)}`;
      run.mode = 'n8n'; run.status = 'success'; run.finishedAt = now();
      stats.remoteOk++;
      publish(run);
      return snapshot(run);
    } catch (e) {
      stats.remoteFail++; stats.lastError = (e as Error).message;
      remoteNote = `n8n at ${config.n8n.url} unreachable (${(e as Error).message}) — ran locally`;
    }
  }

  // 2) Local n8n-compatible executor.
  stats.localRuns++;
  const res = await walk(wf, workflowId, payload, run, true);
  for (const s of run.steps) if (s.status === 'pending') { s.status = 'skipped'; s.detail = res.error ? 'not reached (earlier node failed)' : 'branch not taken'; }
  if (remoteNote && run.steps[0]) run.steps[0].detail = `${remoteNote}; ${run.steps[0].detail ?? ''}`;
  run.status = res.error ? 'error' : 'success';
  run.finishedAt = now();
  publish(run);
  return snapshot(run);
}
