// Shared domain contracts for the Haven server. The web app mirrors these in web/src/lib/types.ts.

export type AgentId = 'aria' | 'nova' | 'rex' | 'mira' | 'kai' | 'iris' | 'juno' | 'leo';
export type ModelTier = 'fast' | 'reasoning' | 'coding' | 'vision';
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'speaking' | 'waiting';

export interface Employee {
  id: AgentId;
  name: string;
  title: string;
  team: 'Executive' | 'Safety Ops' | 'Security' | 'Intelligence' | 'Product' | 'Growth';
  reportsTo: AgentId | 'founder';
  personality: string;
  responsibilities: string[];
  tools: string[]; // sponsor tool ids this employee uses
  modelTier: ModelTier;
  skills: string[]; // Finch skill ids enabled by default
  voice: { pitch: number; rate: number; preferred: string[] };
  color: string; // accent hex
  avatarSeed: string;
  kpi: { label: string; metric: string };
  maskyAvatar?: string | null; // Masky.AI portrait when provisioned
}

export type IncidentKind = 'phishing' | 'scam' | 'harassment' | 'crisis' | 'spam' | 'hate' | 'raid' | 'bot_risk';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'awaiting_approval' | 'resolved' | 'dismissed';
export type MessageStatus = 'visible' | 'under_review' | 'quarantined' | 'removed';

export interface Community {
  id: string; name: string; platform: string; members: number; plan: 'Starter' | 'Growth' | 'Enterprise';
  mrr: number; createdAt: number; color: string; icon: string;
}
export interface Channel { id: string; communityId: string; name: string; topic: string }
export interface Member {
  id: string; communityId: string; handle: string; displayName: string; avatarSeed: string;
  trustScore: number; joinedAt: number; status: 'active' | 'muted' | 'banned'; role: 'member' | 'moderator' | 'admin' | 'bot';
}
export interface Message {
  id: string; channelId: string; memberId: string | null; authorKind: 'member' | 'agent' | 'founder' | 'system';
  agentId: AgentId | null; content: string; createdAt: number; status: MessageStatus; risk: number;
  labels: string[]; incidentId: string | null; replyTo: string | null;
}
export interface Incident {
  id: string; kind: IncidentKind; severity: Severity; status: IncidentStatus; title: string; summary: string;
  messageId: string | null; memberId: string | null; channelId: string | null; communityId: string | null;
  assignedTo: AgentId | null; verdict: any; evidence: any[]; recommendedAction: string | null;
  actionTaken: string | null; createdAt: number; updatedAt: number; resolvedAt: number | null;
  timeToActionMs: number | null; risk: number;
}
export interface BandMessage {
  id: string; from: AgentId | 'founder' | 'gateway' | 'n8n' | 'rocketride'; to: AgentId | 'founder' | 'all' | 'n8n' | 'gateway' | 'rocketride';
  kind: 'delegate' | 'report' | 'request' | 'broadcast' | 'ack' | 'handoff';
  subject: string; body: string; payload: any; threadId: string | null; incidentId: string | null;
  createdAt: number; remote: 'band-cloud' | 'local';
}
export interface LlmCall {
  id: string; agentId: string; model: string; provider: string; purpose: string; promptTokens: number;
  completionTokens: number; costUsd: number; latencyMs: number; fallback: boolean; createdAt: number; ok: boolean;
}
export interface PipelineStageState {
  id: string; name: string; type: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  startedAt?: number; finishedAt?: number; output?: any;
}
export interface PipelineRun {
  id: string; pipelineId: string; status: 'running' | 'done' | 'error'; input: any; output: any;
  stages: PipelineStageState[]; startedAt: number; finishedAt: number | null; incidentId: string | null; engine: 'rocketride-cloud' | 'local';
}
export interface AutomationRun {
  id: string; workflowId: string; trigger: string; status: 'running' | 'success' | 'error'; steps: { name: string; status: string; detail?: string }[];
  mode: 'n8n' | 'local'; startedAt: number; finishedAt: number | null; payload: any;
}
export interface Audit {
  id: string; target: string; status: 'queued' | 'running' | 'done' | 'error'; grade: string | null; score: number | null;
  steps: { id: string; label: string; tool: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }[];
  snyk: any; tenki: any; prelint: any; summary: string | null; createdAt: number; finishedAt: number | null;
}

export interface HavenEvent<T = any> { type: string; ts: number; data: T }

// ---- Web-only view models (see docs/CONTRACT.md) ----
export interface Metrics {
  screened: number; threatsBlocked: number; incidentsOpen: number; incidentsResolved: number; awaitingApproval: number;
  medianTimeToActionMs: number; llmSpendUsd: number; llmCalls: number; tokensSaved: number; communities: number; members: number;
  mrr: number; humanHoursSaved: number; costPerIncidentUsd: number; byKind: Record<string, number>;
  byModel: { model: string; calls: number; costUsd: number }[]; timeline: { t: number; screened: number; threats: number }[];
}
export interface Integration {
  id: string; name: string; category: string; purpose: string; usedBy: AgentId[]; mode: 'live' | 'local'; detail: string;
  envVars: string[]; docs: string; stats?: any;
}
export interface ForensicReport {
  url: string; finalUrl: string; redirects: string[]; title: string; screenshot: string | null;
  forms: { action: string; method: string; hasPassword: boolean; external: boolean }[];
  signals: { id: string; label: string; weight: number; detail: string }[];
  domain: { host: string; tld: string; lookalikeOf: string | null; entropy: number; ageDaysEstimate: number | null };
  score: number; verdict: 'malicious' | 'suspicious' | 'benign' | 'unreachable'; engine: 'celesto' | 'local-sandbox'; driver: 'adal' | 'playwright';
  steps: { action: string; detail: string; ts: number }[]; durationMs: number;
}
export interface WikiEntry { id: string; title: string; body: string; category: string; updatedBy: string; updatedAt: number }
export interface Skill { id: string; name: string; description: string; owner: AgentId; path: string; enabledFor: AgentId[] }
export interface PipelineDef {
  id: string; name: string; description: string; file: string; stages: { id: string; name: string; type: string; description: string }[];
  edges: [string, string][]; runs: PipelineRun[];
}
export interface AutomationDef { id: string; name: string; description: string; file: string; trigger: string; nodes: { name: string; type: string }[]; runs: AutomationRun[] }
export interface AskResult {
  answer: string; sql: string; rows: any[]; columns: string[]; chart: { type: 'bar' | 'line' | 'pie' | 'none'; x: string; y: string } | null;
  engine: 'promptql' | 'local'; agentId: 'iris'; model: string;
}
export interface IncidentDetail {
  incident: Incident; message: Message | null; member: Member | null; channel: Channel | null; band: BandMessage[];
  pipelines: PipelineRun[]; llm: LlmCall[]; automations: AutomationRun[]; forensics: ForensicReport | null;
}
export interface AgentState { status: AgentStatus; task: string | null }
export interface Snapshot {
  workforce: Employee[]; founder: { id: string; name: string; title: string }; communities: Community[]; channels: Channel[]; members: Member[];
  messages: Message[]; incidents: Incident[]; band: BandMessage[]; metrics: Metrics; integrations: Integration[];
  agentStatus: Record<string, AgentState>; sim: { running: boolean }; llm: { provider: string; live: boolean; detail: string };
}
