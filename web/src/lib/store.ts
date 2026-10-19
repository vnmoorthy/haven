import { create } from 'zustand';
import { api, IS_REPLAY } from './api';
import { replay } from './replay';
import { speak } from './voice';
import type {
  AgentState, Audit, AutomationRun, BandMessage, Channel, Community, Employee, HavenEvent, Incident, Integration, LlmCall,
  Member, Message, Metrics, PipelineRun, PipelineStageState, Snapshot,
} from './types';

export interface Toast { id: number; level: 'info' | 'success' | 'warn' | 'error'; title: string; body?: string; agentId?: string }
export interface Caption { id: number; agentId: string; text: string }
export interface ForensicStep { incidentId: string; url: string; action: string; detail: string; ts: number; screenshot?: string }

interface State {
  connected: boolean;
  ready: boolean;
  workforce: Employee[];
  founder: Snapshot['founder'] | null;
  communities: Community[];
  channels: Channel[];
  members: Record<string, Member>;
  messages: Message[];
  incidents: Incident[];
  band: BandMessage[];
  llm: LlmCall[];
  metrics: Metrics | null;
  integrations: Integration[];
  agentStatus: Record<string, AgentState>;
  pipelineRuns: Record<string, PipelineRun>;
  automationRuns: Record<string, AutomationRun>;
  audits: Record<string, Audit>;
  forensics: ForensicStep[];
  sim: { running: boolean };
  llmMode: Snapshot['llm'] | null;
  toasts: Toast[];
  captions: Caption[];
  voiceOn: boolean;
  lastEventAt: number;
  setVoice: (on: boolean) => void;
  dismissToast: (id: number) => void;
  load: () => Promise<void>;
  apply: (e: HavenEvent) => void;
}

let toastSeq = 1;
const upsert = <T extends { id: string }>(arr: T[], item: T, max = 400, prepend = false): T[] => {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) { const copy = arr.slice(); copy[i] = { ...arr[i], ...item }; return copy; }
  const next = prepend ? [item, ...arr] : [...arr, item];
  return next.length > max ? (prepend ? next.slice(0, max) : next.slice(next.length - max)) : next;
};

export const useHaven = create<State>((set, get) => ({
  connected: false, ready: false, workforce: [], founder: null, communities: [], channels: [], members: {}, messages: [], incidents: [],
  band: [], llm: [], metrics: null, integrations: [], agentStatus: {}, pipelineRuns: {}, automationRuns: {}, audits: {}, forensics: [],
  sim: { running: false }, llmMode: null, toasts: [], captions: [], voiceOn: (() => { try { return localStorage.getItem('haven.voice') !== 'off'; } catch { return true; } })(), lastEventAt: 0,

  setVoice: (on) => { try { localStorage.setItem('haven.voice', on ? 'on' : 'off'); } catch { /* ignore */ } set({ voiceOn: on }); if (!on) window.speechSynthesis?.cancel(); },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  load: async () => {
    const s = await api.get<Snapshot>('/api/state');
    hydrate(s);
  },

  apply: (e) => {
    const s = get();
    const d = e.data;
    const patch: Partial<State> = { lastEventAt: e.ts };
    switch (e.type) {
      case 'hello': hydrate(d); return;
      case 'community.message':
      case 'community.message.updated': patch.messages = upsert(s.messages, d as Message, 600); break;
      case 'member.updated': patch.members = { ...s.members, [d.id]: d }; break;
      case 'community.upsert': patch.communities = upsert(s.communities, d as Community); break;
      case 'agent.status': patch.agentStatus = { ...s.agentStatus, [d.agentId]: { status: d.status, task: d.task } }; break;
      case 'band.message': patch.band = upsert(s.band, d as BandMessage, 300); break;
      case 'incident.upsert': patch.incidents = upsert(s.incidents, d as Incident, 300, true).sort((a, b) => b.createdAt - a.createdAt); break;
      case 'llm.call': patch.llm = upsert(s.llm, d as LlmCall, 300); break;
      case 'metrics': patch.metrics = d; break;
      case 'pipeline.run': patch.pipelineRuns = { ...s.pipelineRuns, [d.id]: d }; break;
      case 'pipeline.stage': {
        const run = s.pipelineRuns[d.runId];
        if (run) {
          const stages = run.stages.map((st: PipelineStageState) => (st.id === d.stage.id ? d.stage : st));
          patch.pipelineRuns = { ...s.pipelineRuns, [d.runId]: { ...run, stages } };
        }
        break;
      }
      case 'automation.run': patch.automationRuns = { ...s.automationRuns, [d.id]: d }; break;
      case 'audit.update': patch.audits = { ...s.audits, [d.id]: d }; break;
      case 'forensics.step': patch.forensics = [...s.forensics.slice(-200), d]; break;
      case 'voice.say': {
        const cap = { id: toastSeq++, agentId: d.agentId, text: d.text };
        patch.captions = [...s.captions.slice(-2), cap];
        const emp = s.workforce.find((w) => w.id === d.agentId);
        if (s.voiceOn) speak(d.text, emp, d.audioUrl, () => useHaven.setState({ captions: useHaven.getState().captions.filter((c) => c.id !== cap.id) }));
        else setTimeout(() => useHaven.setState({ captions: useHaven.getState().captions.filter((c) => c.id !== cap.id) }), 6000);
        break;
      }
      case 'toast': {
        const t = { id: toastSeq++, ...d } as Toast;
        patch.toasts = [...s.toasts.slice(-4), t];
        setTimeout(() => get().dismissToast(t.id), 6000);
        break;
      }
      case 'sim.status': patch.sim = d; break;
      case 'integrations': patch.integrations = d; break;
    }
    set(patch);
  },
}));

function hydrate(s: Snapshot) {
  const members: Record<string, Member> = {};
  for (const m of s.members) members[m.id] = m;
  useHaven.setState({
    ready: true, workforce: s.workforce, founder: s.founder, communities: s.communities, channels: s.channels, members,
    messages: s.messages, incidents: s.incidents, band: s.band, metrics: s.metrics, integrations: s.integrations,
    agentStatus: s.agentStatus, sim: s.sim, llmMode: s.llm,
  });
}

let ws: WebSocket | null = null;
export function connect() {
  if (IS_REPLAY) {
    useHaven.setState({ connected: true });
    replay.subscribe((e) => useHaven.getState().apply(e));
    void useHaven.getState().load();
    return;
  }
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  if (!useHaven.getState().ready) void useHaven.getState().load().catch(() => { /* WS hello will hydrate */ });
  ws = new WebSocket(url);
  ws.onopen = () => useHaven.setState({ connected: true });
  ws.onmessage = (m) => { try { useHaven.getState().apply(JSON.parse(m.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { useHaven.setState({ connected: false }); setTimeout(connect, 1500); };
}

export const employeeById = (id: string | null | undefined) => useHaven.getState().workforce.find((w) => w.id === id);
