import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { config, ROOT } from './config.js';
import { db } from './db.js';
import { hub } from './events.js';
import { seed, channels, communities, members } from './seed.js';
import { ROSTER, FOUNDER } from './agents/roster.js';
import { band, bandBootstrap } from './bus/band.js';
import { llmMode } from './integrations/flatkey.js';
import * as company from './agents/company.js';
import { inject, postMessage, simState, startSim, stopSim, type Scenario } from './sim.js';
import { labRouter } from './lab.js';
import { investigateUrl } from './integrations/forensics.js';
import { listAudits, getAudit } from './integrations/audit.js';
import { listPipelines, runPipeline } from './integrations/rocketride.js';
import { listAutomations, runAutomation } from './integrations/n8n.js';
import { askData, wikiList, wikiUpsert, seedWiki } from './integrations/promptql.js';
import { listSkills, toggleSkill } from './integrations/finch.js';
import { provisionAvatars, maskyAvatars } from './integrations/masky.js';
import { syncToKylon } from './integrations/kylon.js';
import { integrations, testIntegration } from './integrations/registry.js';
import type { AgentId, Incident, Message, PipelineRun, AutomationRun, LlmCall } from './types.js';

seed();
seedWiki();
mkdirSync(join(config.dataDir, 'forensics'), { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const wrap = (fn: (req: express.Request, res: express.Response) => any) => async (req: express.Request, res: express.Response) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out ?? { ok: true }); }
  catch (e) { console.error(`[api] ${req.method} ${req.path}`, e); if (!res.headersSent) res.status(400).json({ error: (e as Error).message }); }
};
const isAgent = (x: string): x is AgentId => ROSTER.some((e) => e.id === x);
const agentParam = (req: express.Request): AgentId => { const v = String(req.params.id); if (!isAgent(v)) throw new Error('unknown agent'); return v; };

async function snapshot() {
  return {
    workforce: ROSTER.map((e) => ({ ...e, maskyAvatar: maskyAvatars()[e.id]?.imageUrl ?? null })), founder: FOUNDER,
    communities: communities(), channels: channels(), members: members(),
    messages: db.list<Message>('messages', '', [], 'created_at DESC', 300).reverse(),
    incidents: db.list<Incident>('incidents', '', [], 'created_at DESC', 150),
    band: band.recent(80), metrics: company.metrics(), integrations: await integrations().catch(() => []),
    agentStatus: company.agentStatus, sim: simState, llm: llmMode(),
  };
}

app.get('/api/health', (_q, r) => r.json({ ok: true, ts: Date.now() }));
app.get('/api/state', wrap(snapshot));
app.get('/api/metrics', wrap(() => company.metrics()));
app.post('/api/reset', wrap(async () => { stopSim(); seed(true); seedWiki(); if (config.simAutostart) startSim(); hub.emitEvent('hello', await snapshot()); return { ok: true }; }));

// Community
app.post('/api/community/messages', wrap((req) => {
  const { channelId, memberId, content, asFounder } = req.body ?? {};
  if (!channelId || !content) throw new Error('channelId and content are required');
  return postMessage(channelId, asFounder ? null : memberId ?? null, String(content).slice(0, 2000), asFounder ? 'founder' : 'member');
}));
app.post('/api/sim/inject', wrap((req) => inject((req.body?.scenario ?? 'phishing') as Scenario, req.body?.channelId)));
app.post('/api/sim/toggle', wrap((req) => { req.body?.running ? startSim() : stopSim(); return simState; }));

// Incidents
app.get('/api/incidents', wrap(() => db.list<Incident>('incidents', '', [], 'created_at DESC', 300)));
app.get('/api/incidents/:id', wrap((req) => {
  const incident = db.get<Incident>('incidents', String(req.params.id));
  if (!incident) throw new Error('not found');
  const message = incident.messageId ? db.get<Message>('messages', incident.messageId) ?? null : null;
  const t0 = incident.createdAt - 2000, t1 = (incident.resolvedAt ?? Date.now()) + 5000;
  return {
    incident, message, member: incident.memberId ? db.get('members', incident.memberId) ?? null : null,
    channel: incident.channelId ? db.get('channels', incident.channelId) ?? null : null,
    band: band.thread(incident.id),
    pipelines: db.list<PipelineRun>('pipeline_runs', 'incident_id = ?', [incident.id], 'started_at ASC'),
    llm: db.list<LlmCall>('llm_calls', 'created_at >= ? AND created_at <= ?', [t0, t1], 'created_at ASC', 60).filter((c) => ['nova', 'aria', 'rex', 'mira', 'juno', 'kai'].includes(c.agentId)),
    automations: db.list<AutomationRun>('automation_runs', 'payload LIKE ?', [`%${incident.id}%`], 'started_at ASC'),
    forensics: db.kvGet<any>(`forensics:${incident.id}`, null),
  };
}));
app.post('/api/incidents/:id/approve', wrap((req) => company.approve(String(req.params.id), req.body?.action)));
app.post('/api/incidents/:id/dismiss', wrap((req) => company.dismiss(String(req.params.id))));

// Kai — audits
app.get('/api/audits', wrap(() => listAudits()));
app.get('/api/audits/:id', wrap((req) => { const a = getAudit(String(req.params.id)); if (!a) throw new Error('not found'); return a; }));
app.post('/api/audits', wrap((req) => company.requestAudit(String(req.body?.target ?? 'sample'))));

// Iris — PromptQL
app.post('/api/ask', wrap(async (req) => {
  const q = String(req.body?.question ?? '').slice(0, 500);
  company.setStatus('iris', 'thinking', `Answering: ${q.slice(0, 50)}`);
  band.send({ from: 'founder', to: 'iris', kind: 'request', subject: 'Data question', body: q });
  try {
    const r = await askData(q);
    band.send({ from: 'iris', to: 'founder', kind: 'report', subject: 'Answer ready', body: r.answer.slice(0, 200), payload: { sql: r.sql } });
    return r;
  } finally { company.setStatus('iris', 'idle'); }
}));
app.get('/api/wiki', wrap(() => wikiList()));
app.put('/api/wiki/:id', wrap((req) => wikiUpsert(String(req.params.id), req.body ?? {}, 'founder')));

// Workforce
app.get('/api/agents/:id', wrap((req) => company.agentDetail(agentParam(req))));
app.post('/api/agents/:id/chat', wrap((req) => company.chat(agentParam(req), String(req.body?.message ?? ''), req.body?.history ?? [])));
app.post('/api/agents/:id/compress', wrap((req) => company.compressAgent(agentParam(req))));
app.post('/api/agents/:id/skills', wrap((req) => { toggleSkill(agentParam(req), req.body.skillId, !!req.body.enabled); return { ok: true }; }));
app.get('/api/skills', wrap(() => listSkills()));
app.get('/api/briefing', wrap(async () => db.kvGet('briefing', null) ?? company.briefing(false)));
app.post('/api/briefing', wrap(() => company.briefing(true)));
app.post('/api/masky/provision', wrap(async () => { const r = await provisionAvatars(); hub.emitEvent('hello', await snapshot()); return r; }));
app.post('/api/kylon/sync', wrap(() => syncToKylon()));
app.post('/api/communities', wrap((req) => company.onboardCommunity(req.body ?? {})));

// RocketRide + n8n
app.get('/api/pipelines', wrap(() => listPipelines()));
app.get('/api/pipelines/:id/file', (req, res) => { const f = resolve(ROOT, 'pipelines', `${String(req.params.id).replace(/[^a-z0-9-]/gi, '')}.pipe`); existsSync(f) ? res.type('application/json').download(f) : res.status(404).end(); });
app.post('/api/pipelines/:id/run', wrap((req) => runPipeline(String(req.params.id), req.body?.input ?? {}, { incidentId: null })));
app.get('/api/automations', wrap(() => listAutomations()));
app.get('/api/automations/:id/file', (req, res) => { const f = resolve(ROOT, 'n8n', `${String(req.params.id).replace(/[^a-z0-9-]/gi, '')}.json`); existsSync(f) ? res.download(f) : res.status(404).end(); });
app.post('/api/automations/:id/run', wrap((req) => runAutomation(String(req.params.id), req.body?.payload ?? {}, 'manual')));
// n8n call-backs (workflows POST here when running on a real n8n instance)
app.post('/api/hooks/:name', wrap((req) => { band.send({ from: 'n8n', to: 'aria', kind: 'report', subject: `n8n: ${String(req.params.name)}`, body: JSON.stringify(req.body ?? {}).slice(0, 200) }); return { ok: true }; }));
// Tool endpoint used by the link-forensics.pipe (RocketRide tool_http_request → AdaL/Celesto detonation)
app.post('/api/tools/detonate', wrap((req) => investigateUrl(company.resolveLabUrl(String(req.body?.url ?? req.body?.text ?? '')), { incidentId: null })));

// Sponsor stack
app.get('/api/integrations', wrap(() => integrations()));
app.post('/api/integrations/:id/test', wrap((req) => testIntegration(String(req.params.id))));

// Static: lab fixtures, forensic screenshots, built web app
app.use('/lab', labRouter);
app.use('/forensics', express.static(join(config.dataDir, 'forensics'), { maxAge: '1h' }));
const webDist = resolve(ROOT, 'web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.get(/^\/(?!api|ws|lab|forensics).*/, (_q, r) => r.type('html').send(readFileSync(join(webDist, 'index.html'), 'utf8')));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', async (ws) => {
  hub.clients.add(ws);
  ws.on('close', () => hub.clients.delete(ws));
  try { ws.send(JSON.stringify({ type: 'hello', ts: Date.now(), data: await snapshot() })); } catch (e) { console.error(e); }
});

server.listen(config.port, () => {
  console.log(`\n  🛡  Haven HQ running → http://localhost:${config.port}  (api + ws${existsSync(webDist) ? ' + web' : ''})`);
  console.log(`     Models: ${llmMode().detail}\n`);
  if (config.simAutostart) startSim();
  void bandBootstrap().catch((e) => console.warn('[band] bootstrap failed:', e.message));
});
