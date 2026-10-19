// Records real Haven runs into web/public/replay/bundle.json so the static GitHub Pages build can replay them.
// Usage: (server running on :8787 with a fresh DB)  node scripts/record-replay.mjs
import WebSocket from 'ws';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const B = process.env.HAVEN_URL ?? 'http://localhost:8787';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'web/public/replay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(B + p)).json();
const post = async (p, body = {}) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

const events = [];
const ws = new WebSocket(B.replace('http', 'ws') + '/ws');
await new Promise((r) => ws.on('open', r));
ws.on('message', (m) => { const e = JSON.parse(m.toString()); if (e.type !== 'hello') events.push({ at: Date.now(), event: e }); });

async function capture(name, fn, settleMs) {
  const start = Date.now();
  const from = events.length;
  const out = await fn();
  await sleep(settleMs);
  const evts = events.slice(from).map(({ at, event }) => ({ offsetMs: Math.max(0, at - start), event }));
  console.log(`recorded ${name}: ${evts.length} events`);
  return { evts, out };
}

const scenarios = {};
const approvals = {};
await post('/api/sim/toggle', { running: false });
for (const s of ['phishing', 'crisis', 'harassment', 'scam', 'raid', 'spam']) {
  const { evts } = await capture(s, () => post('/api/sim/inject', { scenario: s }), s === 'phishing' || s === 'scam' ? 14000 : 9000);
  scenarios[s] = evts;
}
// approvals for every incident awaiting the founder
const awaiting = (await get('/api/incidents')).filter((i) => i.status === 'awaiting_approval');
const awaitingIds = awaiting.map((i) => i.id);
// record detail BEFORE approval so replay shows the decision card, approval events replay on click
const incidentDetailsBefore = {};
for (const id of awaitingIds) incidentDetailsBefore[id] = await get(`/api/incidents/${id}`);
for (const inc of awaiting.slice(0, 3)) {
  const { evts } = await capture(`approve ${inc.id}`, () => post(`/api/incidents/${inc.id}/approve`, {}), 3000);
  approvals[inc.id] = evts;
}
const { evts: auditEvts, out: audit } = await capture('audit', () => post('/api/audits', { target: 'sample' }), 70000);
scenarios.audit = auditEvts;

const routes = {};
const incidents = await get('/api/incidents');
routes['GET /api/incidents'] = incidents;
for (const i of incidents.slice(0, 40)) routes[`GET /api/incidents/${i.id}`] = incidentDetailsBefore[i.id] ?? await get(`/api/incidents/${i.id}`);
routes['GET /api/audits'] = await get('/api/audits');
for (const a of routes['GET /api/audits']) routes[`GET /api/audits/${a.id}`] = a;
routes['POST /api/audits'] = audit;
for (const p of ['/api/pipelines', '/api/automations', '/api/integrations', '/api/skills', '/api/wiki', '/api/briefing', '/api/metrics']) routes[`GET ${p}`] = await get(p);
const askMap = {};
for (const q of ['Which kind of incident is most common?', 'Which channel has the most threats?', 'What is our median time to action by kind?', 'How much have we spent on models, by model?', 'Who are the top offenders?', 'How many messages did we screen per channel?', 'Which AI employee handled the most incidents?', 'How many tokens has Paritok saved?']) askMap[q] = await post('/api/ask', { question: q });
routes['POST /api/ask'] = askMap;
const chatMap = {};
for (const a of ['aria', 'nova', 'rex', 'mira', 'kai', 'iris', 'juno', 'leo']) {
  routes[`GET /api/agents/${a}`] = await get(`/api/agents/${a}`);
  chatMap[a] = await post(`/api/agents/${a}/chat`, { message: 'Introduce yourself in 2 sentences to the founder.' });
}
routes['POST /api/agents/*/chat'] = chatMap;
routes['POST /api/agents/*/compress'] = await post('/api/agents/aria/compress');
for (const p of routes['GET /api/pipelines']) routes[`POST /api/pipelines/${p.id}/run`] = p.runs?.[0] ?? {};
for (const a of routes['GET /api/automations']) routes[`POST /api/automations/${a.id}/run`] = a.runs?.[0] ?? {};

// Fresh-looking initial state: snapshot taken after reset so the replay starts calm.
await post('/api/reset');
await sleep(1500);
const state = await get('/api/state');
state.sim = { running: false };

mkdirSync(join(OUT, 'forensics'), { recursive: true });
const fdir = join(ROOT, 'data/forensics');
if (existsSync(fdir)) for (const f of readdirSync(fdir)) copyFileSync(join(fdir, f), join(OUT, 'forensics', f));
writeFileSync(join(OUT, 'bundle.json'), JSON.stringify({ state, routes, scenarios, approvals }));
console.log('wrote', join(OUT, 'bundle.json'));
ws.close();
process.exit(0);
