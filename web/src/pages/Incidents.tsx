import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { Check, ChevronRight, Hand, Hash, Inbox, Search, ShieldAlert, Timer, X, Zap } from 'lucide-react';
import { useHaven } from '../lib/store';
import { api } from '../lib/api';
import type { Incident, IncidentKind } from '../lib/types';
import {
  Button, Counter, Empty, KIND_META, KindBadge, PageHeader, RiskMeter, SeverityBadge, Spinner, StatusBadge, Tabs, TimeAgo, ToolChip, fmtMs,
} from '../components/ui';
import { AgentAvatar } from '../components/Avatar';
import { ThreatLab } from '../components/Shell';
import { ElapsedTimer, normalizeAction, prettyAction, pushIncident } from '../components/incidents/shared';

type TabId = 'all' | 'needs' | 'active' | 'resolved' | 'dismissed';
const ACTIVE = new Set(['open', 'investigating']);

const matchesTab = (i: Incident, t: TabId) =>
  t === 'all' ? true
    : t === 'needs' ? i.status === 'awaiting_approval'
      : t === 'active' ? ACTIVE.has(i.status)
        : t === 'resolved' ? i.status === 'resolved'
          : i.status === 'dismissed';

export default function Incidents() {
  const live = useHaven((s) => s.incidents);
  const metrics = useHaven((s) => s.metrics);
  const [fetched, setFetched] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>(() => {
    try { return (sessionStorage.getItem('haven.incidents.tab') as TabId) || 'all'; } catch { return 'all'; }
  });
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    api.get<Incident[]>('/api/incidents')
      .then((rows) => { if (alive && Array.isArray(rows)) setFetched(rows); })
      .catch(() => { /* live store still has the recent queue */ })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  useEffect(() => { try { sessionStorage.setItem('haven.incidents.tab', tab); } catch { /* ignore */ } }, [tab]);

  // Merge REST history with the live websocket queue; the fresher copy wins.
  const all = useMemo(() => {
    const map = new Map<string, Incident>();
    for (const i of fetched) if (i?.id) map.set(i.id, i);
    for (const i of live) {
      const prev = map.get(i.id);
      if (!prev || (i.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) map.set(i.id, i);
    }
    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [fetched, live]);

  const counts = useMemo(() => {
    const c = { all: all.length, needs: 0, active: 0, resolved: 0, dismissed: 0 };
    for (const i of all) {
      if (i.status === 'awaiting_approval') c.needs++;
      else if (ACTIVE.has(i.status)) c.active++;
      else if (i.status === 'resolved') c.resolved++;
      else if (i.status === 'dismissed') c.dismissed++;
    }
    return c;
  }, [all]);

  const kindCounts = useMemo(() => {
    const c: Partial<Record<IncidentKind, number>> = {};
    for (const i of all) if (matchesTab(i, tab)) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [all, tab]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const r = all.filter((i) => matchesTab(i, tab) && (!kind || i.kind === kind)
      && (!needle || `${i.title} ${i.summary} ${i.id} ${i.assignedTo ?? ''}`.toLowerCase().includes(needle)));
    // Decisions waiting on a human float to the top of the "All" view.
    if (tab === 'all') r.sort((a, b) => Number(b.status === 'awaiting_approval') - Number(a.status === 'awaiting_approval') || b.createdAt - a.createdAt);
    return r;
  }, [all, tab, kind, q]);


  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Safety Ops <ToolChip id="kylon" /> <ToolChip id="band" /></span>}
        title="Incident queue"
        subtitle={
          <span>
            <b className="text-fg tabular-nums">{counts.all}</b> incidents ·{' '}
            <b className="text-amber-300 tabular-nums">{counts.needs}</b> need your decision ·{' '}
            <b className="text-violet-300 tabular-nums">{counts.active}</b> being worked by the AI team ·{' '}
            <b className="text-emerald-300 tabular-nums">{counts.resolved}</b> resolved
          </span>
        }
        actions={
          <span className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-1.5 text-[12px] text-muted">
            <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping" /><span className="relative w-2 h-2 rounded-full bg-emerald-400" /></span>
            Live queue · 8 AI employees on shift
          </span>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MiniStat label="Needs you" value={counts.needs} color="#f59e0b" icon={<Hand size={13} />} pulse={counts.needs > 0} onClick={() => setTab('needs')} />
        <MiniStat label="In flight" value={counts.active} color="#a78bfa" icon={<Zap size={13} />} pulse={counts.active > 0} onClick={() => setTab('active')} />
        <MiniStat label="Resolved" value={counts.resolved} color="#10b981" icon={<Check size={13} />} sub={counts.dismissed ? `${counts.dismissed} dismissed as benign` : undefined} onClick={() => setTab('resolved')} />
        <MiniStat label="Median time to action" value={metrics?.medianTimeToActionMs ?? 0} format={(n) => fmtMs(n)} color="#22d3ee" icon={<Timer size={13} />} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'all', label: <TabLabel text="All" n={counts.all} /> },
            { id: 'needs', label: <TabLabel text="Needs you" n={counts.needs} hot /> },
            { id: 'active', label: <TabLabel text="Active" n={counts.active} /> },
            { id: 'resolved', label: <TabLabel text="Resolved" n={counts.resolved} /> },
            { id: 'dismissed', label: <TabLabel text="Dismissed" n={counts.dismissed} /> },
          ]}
        />
        <div className="flex-1" />
        <label className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-1.5 w-full sm:w-72 focus-within:border-line-strong">
          <Search size={14} className="text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents…" className="bg-transparent outline-none text-sm flex-1 placeholder:text-dim" />
          {q && <button onClick={() => setQ('')} className="text-dim hover:text-fg cursor-pointer"><X size={13} /></button>}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        <KindChip active={!kind} onClick={() => setKind(null)} color="#8d93a8" label="All kinds" />
        {(Object.keys(KIND_META) as IncidentKind[]).map((k) => (
          <KindChip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)} color={KIND_META[k].color}
            label={`${KIND_META[k].emoji} ${KIND_META[k].label}`} n={kindCounts[k] ?? 0} />
        ))}
      </div>

      {loading && all.length === 0 ? (
        <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="panel h-[92px] shimmer" />)}</div>
      ) : rows.length === 0 ? (
        <div className="panel grid-bg">
          <Empty
            icon={<Inbox size={30} />}
            title={all.length === 0 ? 'Your community is quiet — for now' : 'Nothing matches these filters'}
            body={all.length === 0
              ? 'Fire a live threat from the Threat Lab and watch Nova triage it, Rex detonate the link and Aria bring you a decision — in seconds.'
              : 'Try another tab or kind, or inject a fresh threat to see the workforce respond.'}
            action={<ThreatLab />}
          />
        </div>
      ) : (
        <motion.div layout className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {rows.map((i) => <IncidentRow key={i.id} incident={i} />)}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function TabLabel({ text, n, hot }: { text: string; n: number; hot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className={clsx('mono text-[10px] rounded-md px-1.5 py-px tabular-nums', hot && n > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-muted')}>{n}</span>
    </span>
  );
}

function KindChip({ active, onClick, color, label, n }: { active: boolean; onClick: () => void; color: string; label: string; n?: number }) {
  return (
    <button onClick={onClick}
      className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium border transition-all cursor-pointer',
        active ? 'text-fg' : 'text-muted hover:text-fg border-line hover:border-line-strong bg-white/[0.02]')}
      style={active ? { borderColor: `${color}66`, background: `${color}1f`, color } : undefined}>
      {label}
      {n != null && <span className="mono text-[10px] opacity-70 tabular-nums">{n}</span>}
    </button>
  );
}

function MiniStat({ label, value, color, icon, sub, pulse, onClick, format }: {
  label: string; value: number; color: string; icon: ReactNode; sub?: string; pulse?: boolean; onClick?: () => void; format?: (n: number) => string;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={clsx('panel panel-hover p-3.5 text-left relative overflow-hidden', onClick ? 'cursor-pointer' : 'cursor-default')}>
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-25" style={{ background: color }} />
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted font-semibold">
        <span style={{ color }}>{icon}</span>{label}
        {pulse && <span className="ml-auto relative flex w-2 h-2"><span className="absolute inset-0 rounded-full animate-ping" style={{ background: color }} /><span className="relative w-2 h-2 rounded-full" style={{ background: color }} /></span>}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tabular-nums tracking-tight"><Counter value={value} format={format} /></div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </button>
  );
}

function IncidentRow({ incident: i }: { incident: Incident }) {
  const nav = useNavigate();
  const emp = useHaven((s) => s.workforce.find((w) => w.id === i.assignedTo));
  const channel = useHaven((s) => s.channels.find((c) => c.id === i.channelId));
  const community = useHaven((s) => s.communities.find((c) => c.id === i.communityId));
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const awaiting = i.status === 'awaiting_approval';
  const unresolved = i.status !== 'resolved' && i.status !== 'dismissed';
  const action = normalizeAction(i.recommendedAction);

  const act = async (kind: 'approve' | 'dismiss') => {
    setBusy(kind); setErr(null);
    try {
      const res = kind === 'approve'
        ? await api.post<Incident>(`/api/incidents/${i.id}/approve`, action ? { action } : {})
        : await api.post<Incident>(`/api/incidents/${i.id}/dismiss`, {});
      pushIncident(res);
    } catch (e) {
      setErr((e as Error).message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      onClick={() => nav(`/incidents/${i.id}`)}
      role="link" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') nav(`/incidents/${i.id}`); }}
      className={clsx('panel panel-hover group relative overflow-hidden cursor-pointer outline-none focus-visible:border-line-strong', awaiting && 'border-amber-400/40')}
      style={awaiting ? { boxShadow: '0 0 0 1px rgba(245,158,11,0.28), 0 18px 48px -18px rgba(245,158,11,0.55), inset 0 1px 0 rgba(255,255,255,0.05)' } : undefined}
    >
      {awaiting && (
        <>
          <motion.span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400" animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-amber-500/[0.07] via-transparent to-transparent" />
        </>
      )}
      {!awaiting && <span className="absolute left-0 top-0 bottom-0 w-[3px] opacity-70" style={{ background: KIND_META[i.kind]?.color ?? '#8d93a8' }} />}

      <div className="relative flex flex-col lg:flex-row lg:items-center gap-4 px-4 py-3.5">
        <div className="w-11 h-11 rounded-xl grid place-items-center text-xl shrink-0 border"
          style={{ background: `${KIND_META[i.kind]?.color ?? '#8d93a8'}18`, borderColor: `${KIND_META[i.kind]?.color ?? '#8d93a8'}33` }}>
          {KIND_META[i.kind]?.emoji ?? '⚑'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <KindBadge k={i.kind} />
            <SeverityBadge s={i.severity} />
            <StatusBadge s={i.status} />
            {channel && <span className="inline-flex items-center gap-0.5 text-[11px] text-dim"><Hash size={11} />{channel.name}</span>}
            {community && <span className="text-[11px] text-dim">· {community.name}</span>}
          </div>
          <div className="text-[14.5px] font-semibold tracking-tight truncate group-hover:text-white">{i.title}</div>
          <div className="text-[12.5px] text-muted line-clamp-2 mt-0.5 leading-relaxed">{i.summary}</div>
          {awaiting && i.recommendedAction && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-amber-200/90">
              <ShieldAlert size={12} /> Aria recommends <b className="text-amber-200">{prettyAction(i.recommendedAction)}</b>
            </div>
          )}
          {err && <div className="text-[11px] text-rose-300 mt-1">Couldn’t update: {err}</div>}
        </div>

        <div className="flex items-center gap-5 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 w-[148px]">
            {i.assignedTo ? (
              <>
                <AgentAvatar id={i.assignedTo} size={30} />
                <div className="min-w-0 leading-tight">
                  <div className="text-[12.5px] font-medium truncate">{emp?.name ?? i.assignedTo}</div>
                  <div className="text-[10.5px] text-dim truncate">{emp?.title ?? 'AI employee'}</div>
                </div>
              </>
            ) : (
              <span className="text-[12px] text-dim">Unassigned</span>
            )}
          </div>
          <div className="w-[110px]">
            <div className="text-[10px] uppercase tracking-wider text-dim mb-1">Risk</div>
            <RiskMeter value={i.risk ?? 0} size="sm" />
          </div>
          <div className="w-[86px]">
            <div className="text-[10px] uppercase tracking-wider text-dim mb-1">{i.timeToActionMs != null ? 'Time to act' : unresolved ? 'Elapsed' : 'Closed'}</div>
            {i.timeToActionMs != null ? (
              <span className="mono text-[12px] text-emerald-300 tabular-nums">{fmtMs(i.timeToActionMs)}</span>
            ) : unresolved ? (
              <ElapsedTimer since={i.createdAt} className={clsx('text-[12px]', awaiting ? 'text-amber-300' : 'text-violet-300')} />
            ) : (
              <span className="mono text-[12px] text-muted">—</span>
            )}
          </div>
          <div className="w-[64px] text-[11.5px] text-dim text-right"><TimeAgo ts={i.createdAt} /></div>

          <div className="lg:w-[212px] flex justify-end">
          {awaiting ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Button size="sm" variant="success" disabled={!!busy} onClick={() => act('approve')}
                icon={busy === 'approve' ? <Spinner className="w-3 h-3" /> : <Check size={13} />}>
                Approve{action ? ` ${action}` : ''}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('dismiss')}
                icon={busy === 'dismiss' ? <Spinner className="w-3 h-3" /> : <X size={13} />}>
                Dismiss
              </Button>
            </div>
          ) : (
            <ChevronRight size={16} className="text-dim group-hover:text-fg group-hover:translate-x-0.5 transition-all" />
          )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
