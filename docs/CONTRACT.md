# Haven internal contract (server ⇄ web)

Server: Node 24 + TypeScript (tsx), Express, `ws`, `node:sqlite`. Port 8787. Web: Vite + React 19 + Tailwind v4 + motion, dev on 5173 proxying `/api`, `/ws`, `/lab`, `/forensics` to 8787.
Types live in `server/src/types.ts` (mirrored to `web/src/lib/types.ts`).

## WebSocket `/ws`
Every message: `{ type: string, ts: number, data: any }`.

| type | data |
|---|---|
| `hello` | full snapshot (same as `GET /api/state`) |
| `community.message` | `Message` (new) |
| `community.message.updated` | `Message` |
| `member.updated` | `Member` |
| `agent.status` | `{ agentId, status: 'idle'|'thinking'|'working'|'speaking'|'waiting', task: string|null }` |
| `band.message` | `BandMessage` |
| `pipeline.run` | `PipelineRun` (on start + finish) |
| `pipeline.stage` | `{ runId, pipelineId, stage: PipelineStageState, incidentId }` |
| `incident.upsert` | `Incident` |
| `llm.call` | `LlmCall` |
| `automation.run` | `AutomationRun` (start, each step, finish) |
| `audit.update` | `Audit` |
| `forensics.step` | `{ incidentId, url, action, detail, ts, screenshot?: string }` |
| `voice.say` | `{ agentId, text, audioUrl?: string, incidentId? }` |
| `context.compressed` | `{ agentId, beforeTokens, afterTokens, method, summary }` |
| `metrics` | `Metrics` |
| `community.upsert` | `Community` |
| `skill.toggled` | `{ agentId, skillId, enabled }` |
| `wiki.updated` | `WikiEntry` |
| `toast` | `{ level: 'info'|'success'|'warn'|'error', title, body?, agentId? }` |

## REST (all JSON)
- `GET /api/state` → `{ workforce: Employee[], founder, communities, channels, members, messages (last 150), incidents (last 100), band (last 80), metrics, integrations, agentStatus: Record<AgentId,{status,task}>, sim: { running: boolean }, llm: {provider, live, detail} }`
- `GET /api/metrics` → `Metrics` = `{ screened, threatsBlocked, incidentsOpen, incidentsResolved, awaitingApproval, medianTimeToActionMs, llmSpendUsd, llmCalls, tokensSaved, communities, members, mrr, humanHoursSaved, costPerIncidentUsd, byKind: Record<IncidentKind,number>, byModel: {model, calls, costUsd}[], timeline: {t:number, screened:number, threats:number}[] }`
- `POST /api/community/messages` `{ channelId, memberId?, content, asFounder?: boolean }` → `Message`
- `POST /api/sim/inject` `{ scenario: 'phishing'|'scam'|'harassment'|'crisis'|'spam'|'raid'|'benign', channelId? }` → `Message`
- `POST /api/sim/toggle` `{ running: boolean }` → `{ running }`
- `POST /api/reset` → reseed demo data
- `GET /api/incidents` → `Incident[]`; `GET /api/incidents/:id` → `{ incident, message, member, channel, band: BandMessage[], pipelines: PipelineRun[], llm: LlmCall[], automations: AutomationRun[], forensics: ForensicReport|null }`
- `POST /api/incidents/:id/approve` `{ action?: 'ban'|'mute'|'warn'|'remove' }` → `Incident`; `POST /api/incidents/:id/dismiss` → `Incident`
- `GET /api/audits` → `Audit[]`; `POST /api/audits` `{ target: string }` (`'sample'` = bundled sketchy bot, or a public GitHub URL) → `Audit`; `GET /api/audits/:id` → `Audit`
- `POST /api/ask` `{ question }` → `{ answer, sql, rows: any[], columns: string[], chart: { type: 'bar'|'line'|'pie'|'none', x: string, y: string } | null, engine: 'promptql'|'local', agentId: 'iris', model }`
- `GET /api/wiki` → `WikiEntry[]` (`{id,title,body,category,updatedBy,updatedAt}`); `PUT /api/wiki/:id` `{title, body, category}`
- `POST /api/agents/:id/chat` `{ message, history?: {role,content}[] }` → `{ reply, model, provider, voice: boolean }`
- `GET /api/briefing` → `{ text, bullets: string[], generatedAt, model }`; `POST /api/briefing` regenerates (Aria speaks it via `voice.say`)
- `GET /api/pipelines` → `{ id, name, description, file, stages: {id,name,type,description}[], edges: [from,to][], runs: PipelineRun[] }[]`; `POST /api/pipelines/:id/run` `{ input? }` → `PipelineRun`
- `GET /api/automations` → `{ id, name, description, file, trigger, nodes: {name,type}[], runs: AutomationRun[] }[]`; `POST /api/automations/:id/run` `{ payload? }` → `AutomationRun`
- `GET /api/integrations` → `Integration[]` = `{ id, name, category, purpose, usedBy: AgentId[], mode: 'live'|'local', detail, envVars: string[], docs: string, stats?: any }`; `POST /api/integrations/:id/test` → `{ ok, detail, latencyMs }`
- `GET /api/skills` → `{ id, name, description, owner: AgentId, path, enabledFor: AgentId[] }[]`; `POST /api/agents/:id/skills` `{ skillId, enabled }`
- `POST /api/agents/:id/compress` → compression result (Paritok)
- `GET /api/agents/:id` → `{ employee, status, memory: {items: string[], tokens: number, budget: number}, stats, recentBand, recentLlm, compressions }`
- `POST /api/communities` `{ name, platform, members, plan }` → onboards a community via the n8n onboarding workflow → `Community`
- Static: `/forensics/<file>.png` (sandbox screenshots), `/lab/<page>` (safe phishing look-alike fixtures for demos)

## ForensicReport
`{ url, finalUrl, redirects: string[], title, screenshot: string|null, forms: {action, method, hasPassword, external}[], signals: {id,label,weight,detail}[], domain: {host, tld, lookalikeOf: string|null, entropy:number, ageDaysEstimate: number|null}, score: number, verdict: 'malicious'|'suspicious'|'benign'|'unreachable', engine: 'celesto'|'local-sandbox', driver: 'adal'|'playwright', steps: {action, detail, ts}[], durationMs }`
