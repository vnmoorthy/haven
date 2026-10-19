import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { ArrowUpRight, Boxes, CircleCheck, CircleX, ExternalLink, KeyRound, Plug, RefreshCw, Search, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useHaven } from '../lib/store';
import type { Integration } from '../lib/types';
import { AgentAvatar } from '../components/Avatar';
import { Badge, Button, Empty, PageHeader, Spinner, Tabs, TOOL_META, fmtMs } from '../components/ui';
import { OperatingLoop } from '../components/ops/OperatingLoop';

type TestResult = { ok: boolean; detail: string; latencyMs: number; at: number };
type Filter = 'all' | 'live' | 'local';

const ORDER = ['kylon', 'masky', 'band', 'n8n', 'rocketride', 'adal', 'celesto', 'flatkey', 'promptql', 'paritok', 'finch', 'tenki', 'prelint', 'snyk'];
const SEE_IT: Record<string, { to: string; label: string }> = {
  kylon: { to: '/workforce', label: 'AI Workforce' }, masky: { to: '/briefing', label: 'Founder Briefing' }, band: { to: '/', label: 'Mission Control' },
  n8n: { to: '/automations?tab=n8n', label: 'n8n workflows' }, rocketride: { to: '/automations', label: 'Pipelines' }, adal: { to: '/incidents', label: 'Incident forensics' },
  celesto: { to: '/incidents', label: 'Incident forensics' }, flatkey: { to: '/workforce', label: 'AI Workforce' }, promptql: { to: '/ask', label: 'Ask Haven' },
  paritok: { to: '/workforce', label: 'Employee memory' }, finch: { to: '/workforce', label: 'Employee skills' }, tenki: { to: '/security', label: 'Bot Audits' },
  prelint: { to: '/security', label: 'Bot Audits' }, snyk: { to: '/security', label: 'Bot Audits' },
};

const humanKey = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
function statValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v.length > 28 ? `${v.slice(0, 28)}…` : v;
  if (Array.isArray(v)) return `${v.length} items`;
  try { const s = JSON.stringify(v); return s.length > 28 ? `${s.slice(0, 28)}…` : s; } catch { return String(v); }
}

export default function Stack() {
  const integrations = useHaven((s) => s.integrations);
  const workforce = useHaven((s) => s.workforce);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult | 'pending'>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [testingAll, setTestingAll] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await api.get<Integration[]>('/api/integrations');
      useHaven.setState({ integrations: d });
      setError(null);
    } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const test = useCallback(async (id: string) => {
    setResults((r) => ({ ...r, [id]: 'pending' }));
    const t0 = performance.now();
    try {
      const res = await api.post<{ ok: boolean; detail: string; latencyMs: number }>(`/api/integrations/${id}/test`);
      setResults((r) => ({ ...r, [id]: { ...res, latencyMs: res.latencyMs ?? Math.round(performance.now() - t0), at: Date.now() } }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { ok: false, detail: (e as Error).message, latencyMs: Math.round(performance.now() - t0), at: Date.now() } }));
    }
  }, []);

  const testAll = async () => {
    setTestingAll(true);
    await Promise.allSettled(integrations.map((i) => test(i.id)));
    setTestingAll(false);
    void refresh();
  };

  const sorted = useMemo(() => [...integrations].sort((a, b) => {
    const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }), [integrations]);
  const shown = sorted.filter((i) => (filter === 'all' || i.mode === filter) &&
    (!q || `${i.name} ${i.category} ${i.purpose}`.toLowerCase().includes(q.toLowerCase())));
  const live = integrations.filter((i) => i.mode === 'live').length;
  const tested = Object.values(results).filter((r) => r !== 'pending') as TestResult[];
  const passing = tested.filter((r) => r.ok).length;
  const agentsCovered = new Set(integrations.flatMap((i) => i.usedBy)).size;

  return (
    <div className="max-w-[1500px] mx-auto">
      <PageHeader
        eyebrow="Built on the sponsor stack"
        title={<>Sponsor stack — <span className="text-gradient">{integrations.length || 14} tools</span>, one AI-native company</>}
        subtitle="Every tool is wired into real work. With no keys, each runs on a high-quality local engine (labelled LOCAL); drop in its env var and the same feature switches to the live sponsor API."
        actions={<>
          <Button onClick={refresh} disabled={refreshing} icon={refreshing ? <Spinner /> : <RefreshCw size={14} />}>Refresh</Button>
          <Button variant="primary" onClick={testAll} disabled={testingAll || !integrations.length} icon={testingAll ? <Spinner /> : <Zap size={14} />}>
            {testingAll ? 'Testing…' : 'Test all connections'}
          </Button>
        </>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Sponsor tools', value: integrations.length, color: '#8b5cf6', sub: 'wired into the product' },
          { label: 'Live APIs', value: live, color: '#10b981', sub: `${integrations.length - live} on local engines` },
          { label: 'AI employees using them', value: agentsCovered, color: '#22d3ee', sub: `of ${workforce.length} on the team` },
          { label: 'Connection tests', value: tested.length ? `${passing}/${tested.length}` : '—', color: passing === tested.length && tested.length ? '#10b981' : '#f59e0b', sub: tested.length ? 'passing' : 'run "Test all"' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="panel p-4 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-25" style={{ background: s.color }} />
            <div className="text-[11px] uppercase tracking-wider text-muted">{s.label}</div>
            <div className="text-2xl font-semibold mt-1.5 tabular-nums">{s.value}</div>
            <div className="text-xs text-muted mt-0.5">{s.sub}</div>
          </motion.div>
        ))}
      </div>

      <OperatingLoop />

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2"><Boxes size={17} className="text-muted" /> Integrations</h2>
        <Tabs<Filter> value={filter} onChange={setFilter} items={[
          { id: 'all', label: `All ${integrations.length}` }, { id: 'live', label: `Live ${live}` }, { id: 'local', label: `Local ${integrations.length - live}` },
        ]} />
        <div className="flex-1" />
        <label className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tools…"
            className="w-56 rounded-xl border border-line bg-white/[0.03] pl-8 pr-3 py-1.5 text-sm outline-none focus:border-brand-violet/60 placeholder:text-dim" />
        </label>
      </div>

      {error && !integrations.length ? (
        <div className="panel"><Empty icon={<Plug size={22} />} title="Couldn't load integrations" body={error} action={<Button size="sm" onClick={refresh}>Retry</Button>} /></div>
      ) : !integrations.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-[340px] shimmer" />)}</div>
      ) : shown.length === 0 ? (
        <div className="panel"><Empty icon={<Search size={20} />} title="No tools match" body="Try a different filter." /></div>
      ) : (
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {shown.map((it, i) => <IntegrationCard key={it.id} it={it} index={i} result={results[it.id]} onTest={() => test(it.id)} />)}
          </AnimatePresence>
        </motion.div>
      )}
      <div className="h-6" />
    </div>
  );
}

function IntegrationCard({ it, index, result, onTest }: { it: Integration; index: number; result: TestResult | 'pending' | undefined; onTest: () => void }) {
  const workforce = useHaven((s) => s.workforce);
  const meta = TOOL_META[it.id] ?? { name: it.name, color: '#8d93a8' };
  const color = meta.color;
  const isLive = it.mode === 'live';
  const stats = it.stats && typeof it.stats === 'object' && !Array.isArray(it.stats) ? Object.entries(it.stats as Record<string, unknown>).slice(0, 6) : [];
  const see = SEE_IT[it.id];
  const pending = result === 'pending';
  const res = result && result !== 'pending' ? result : null;

  return (
    <motion.article layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(index, 12) * 0.03, type: 'spring', stiffness: 300, damping: 30 }}
      className="panel panel-hover relative overflow-hidden p-4 flex flex-col">
      <div className="absolute -top-20 -right-16 w-48 h-48 rounded-full blur-3xl opacity-[0.16] pointer-events-none" style={{ background: color }} />
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}aa, transparent)` }} />

      <div className="relative flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center font-semibold text-[13px] mono shrink-0 border"
          style={{ color, background: `${color}18`, borderColor: `${color}44` }}>
          {it.id === 'n8n' ? 'n8n' : meta.name.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight truncate" style={{ color }}>{it.name}</div>
          <div className="text-[11px] text-muted uppercase tracking-wider">{it.category}</div>
        </div>
        {isLive ? <Badge color="#10b981" dot className="font-semibold">LIVE</Badge> : <Badge color="#8d93a8" className="font-semibold">LOCAL ENGINE</Badge>}
      </div>

      <p className="relative mt-3 text-[13px] leading-relaxed text-fg/85">{it.purpose}</p>

      <div className="relative mt-3 flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-dim whitespace-nowrap shrink-0">Used by</span>
        <div className="flex -space-x-1.5 shrink-0">
          {it.usedBy.map((a) => {
            const emp = workforce.find((w) => w.id === a);
            return (
              <Link key={a} to={`/workforce/${a}`} title={emp ? `${emp.name} — ${emp.title}` : a} className="hover:z-10 hover:-translate-y-0.5 transition-transform">
                <AgentAvatar id={a} size={24} showStatus={false} className="ring-2 ring-ink-900 rounded-full" />
              </Link>
            );
          })}
        </div>
        <span className="text-[11px] text-muted truncate">{it.usedBy.map((a) => workforce.find((w) => w.id === a)?.name ?? a).join(', ')}</span>
      </div>

      <div className="relative mt-3 text-xs text-muted leading-relaxed rounded-xl border border-line bg-black/20 px-3 py-2">{it.detail}</div>

      {it.envVars.length > 0 && (
        <div className="relative mt-3 flex items-center gap-1.5 flex-wrap">
          <KeyRound size={11} className="text-dim" />
          {it.envVars.map((v) => <span key={v} className="kbd text-fg/75">{v}</span>)}
        </div>
      )}

      {stats.length > 0 && (
        <dl className="relative mt-3 grid grid-cols-3 gap-1.5">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.025] border border-line px-2 py-1.5 min-w-0">
              <dt className="text-[9.5px] uppercase tracking-wider text-dim truncate">{humanKey(k)}</dt>
              <dd className="mono text-[12px] text-fg/90 truncate">{statValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex-1" />
      <AnimatePresence initial={false}>
        {(pending || res) && (
          <motion.div key="res" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="relative overflow-hidden">
            <div className={clsx('mt-3 rounded-xl border px-3 py-2 text-xs flex items-start gap-2',
              pending ? 'border-line bg-white/[0.02] text-muted' : res?.ok ? 'border-ok/35 bg-ok/[0.07] text-emerald-100' : 'border-danger/40 bg-danger/[0.08] text-rose-100')}>
              {pending ? <Spinner className="mt-0.5" /> : res?.ok ? <CircleCheck size={14} className="text-ok shrink-0 mt-0.5" /> : <CircleX size={14} className="text-danger shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{pending ? 'Testing connection…' : res?.ok ? 'Connection OK' : 'Connection failed'}{res && <span className="mono text-[10.5px] opacity-70 ml-1.5">{fmtMs(res.latencyMs)}</span>}</div>
                {res && <div className="opacity-80 mt-0.5 leading-relaxed break-words">{res.detail}</div>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mt-3 pt-3 border-t border-line flex items-center gap-2">
        <a href={it.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg shrink-0">
          Docs <ExternalLink size={11} />
        </a>
        {see && (
          <Link to={see.to} title={`See ${it.name} at work in ${see.label}`} className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-fg ml-2 whitespace-nowrap min-w-0 truncate">
            {see.label} <ArrowUpRight size={11} className="shrink-0" />
          </Link>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={onTest} disabled={pending} icon={pending ? <Spinner /> : <Plug size={12} />}>Test connection</Button>
      </div>
    </motion.article>
  );
}
