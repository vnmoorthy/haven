// Replay engine for the static (GitHub Pages) build: serves API responses recorded from real Haven runs and
// re-emits the recorded realtime event streams, so the hosted demo behaves like the live product.
// The bundle is produced by scripts/record-replay.mjs against a running Haven server.
import type { HavenEvent } from './types';

type Listener = (e: HavenEvent) => void;
type Recorded = { offsetMs: number; event: HavenEvent }[];
interface Bundle { state: any; routes: Record<string, any>; scenarios: Record<string, Recorded>; approvals: Record<string, Recorded> }

const listeners = new Set<Listener>();
let bundle: Bundle | null = null;
let loading: Promise<Bundle> | null = null;

function loadBundle(): Promise<Bundle> {
  if (bundle) return Promise.resolve(bundle);
  loading ??= fetch(`${import.meta.env.BASE_URL}replay/bundle.json`).then((r) => r.json()).then((b) => (bundle = b));
  return loading;
}

const fixPaths = (e: HavenEvent): HavenEvent => {
  // screenshots live under /replay/forensics in the static build
  const s = JSON.stringify(e).replace(/"\/forensics\//g, `"${import.meta.env.BASE_URL}replay/forensics/`);
  return { ...JSON.parse(s), ts: Date.now() };
};

function play(rec: Recorded | undefined) {
  if (!rec) return;
  for (const { offsetMs, event } of rec) setTimeout(() => listeners.forEach((l) => l(fixPaths(event))), offsetMs);
}

const emitLocal = (type: string, data: any) => listeners.forEach((l) => l({ type, ts: Date.now(), data }));

export const replay = {
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
  async request<T>(method: string, path: string, body?: any): Promise<T> {
    const b = await loadBundle();
    const key = `${method} ${path}`;
    if (path === '/api/state') return b.state as T;
    if (key === 'POST /api/sim/inject') { play(b.scenarios[body?.scenario] ?? b.scenarios.phishing); return { ok: true } as T; }
    if (key === 'POST /api/sim/toggle') { emitLocal('sim.status', { running: !!body?.running }); return { running: !!body?.running } as T; }
    if (key === 'POST /api/audits') { play(b.scenarios.audit); return b.routes['POST /api/audits'] as T; }
    const appr = path.match(/^\/api\/incidents\/([^/]+)\/(approve|dismiss)$/);
    if (appr) {
      const rec = b.approvals[appr[1]];
      if (rec && appr[2] === 'approve') play(rec);
      else emitLocal('toast', { level: 'info', title: 'Replay mode', body: 'Run Haven locally to make live decisions on new incidents.' });
      return {} as T;
    }
    if (key === 'POST /api/ask') {
      const m = b.routes['POST /api/ask'] ?? {};
      const q = String(body?.question ?? '').toLowerCase();
      const hit = Object.keys(m).find((k) => k.toLowerCase() === q) ?? Object.keys(m).find((k) => q.split(/\W+/).filter((w) => w.length > 4).some((w) => k.toLowerCase().includes(w)));
      return (m[hit ?? Object.keys(m)[0]] ?? {}) as T;
    }
    const chat = path.match(/^\/api\/agents\/([^/]+)\/chat$/);
    if (chat) {
      const r = (b.routes['POST /api/agents/*/chat'] ?? {})[chat[1]];
      if (r) emitLocal('voice.say', { agentId: chat[1], text: r.reply });
      return (r ?? { reply: 'Run Haven locally to chat live.', model: 'replay', provider: 'replay' }) as T;
    }
    if (/^\/api\/agents\/[^/]+\/compress$/.test(path)) return b.routes['POST /api/agents/*/compress'] as T;
    if (key === 'POST /api/briefing') { const br = b.routes['GET /api/briefing']; if (br?.text) emitLocal('voice.say', { agentId: 'aria', text: br.text }); return br as T; }
    if (b.routes[key] !== undefined) return b.routes[key] as T;
    if (method !== 'GET' && b.routes[`GET ${path}`] !== undefined) return b.routes[`GET ${path}`] as T;
    if (method !== 'GET') emitLocal('toast', { level: 'info', title: 'Replay mode', body: 'This action runs live when you start Haven locally (npm run demo).' });
    return (method === 'GET' && /s$/.test(path) ? [] : {}) as T;
  },
};
