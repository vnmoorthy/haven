import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft, BrainCircuit, Coins, FileSearch, GitBranch, Hash, History, RefreshCw, SearchX, Timer, UserRound, Users, Workflow,
} from 'lucide-react';
import { useHaven } from '../lib/store';
import type { ForensicStep } from '../lib/store';
import { api } from '../lib/api';
import type { AutomationRun, BandMessage, IncidentDetail, PipelineRun } from '../lib/types';
import {
  Button, Empty, KIND_META, KindBadge, Panel, SeverityBadge, StatusBadge, TimeAgo, ToolChip, fmtMs, fmtUsd,
} from '../components/ui';
import { AgentAvatar } from '../components/Avatar';
import { ElapsedTimer, ScoreRing, SectionLabel, llmCost, riskColor } from '../components/incidents/shared';
import { Timeline, buildTimeline } from '../components/incidents/Timeline';
import { DecisionCard, OutcomeBanner } from '../components/incidents/DecisionCard';
import { ForensicsReportView, LiveForensics, MemberEvidence, MessageEvidence, NoForensics } from '../components/incidents/Evidence';
import { AutomationRuns, ModelCalls, PipelineRuns } from '../components/incidents/Panels';

const AGENTS = new Set(['aria', 'nova', 'rex', 'mira', 'kai', 'iris', 'juno', 'leo']);
const finishedStages = (r: PipelineRun) => r.stages.filter((s) => s.finishedAt).length + (r.status !== 'running' ? 100 : 0);

export default function IncidentRoom() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const workforce = useHaven((s) => s.workforce);
  const storeIncident = useHaven((s) => s.incidents.find((i) => i.id === id));
  const bandAll = useHaven((s) => s.band);
  const runsAll = useHaven((s) => s.pipelineRuns);
  const autosAll = useHaven((s) => s.automationRuns);
  const fxAll = useHaven((s) => s.forensics);
  const llmLen = useHaven((s) => s.llm.length);

  const liveBand = useMemo(() => bandAll.filter((b) => b.incidentId === id), [bandAll, id]);
  const livePipes = useMemo(() => Object.values(runsAll).filter((r) => r.incidentId === id), [runsAll, id]);
  const liveAutos = useMemo(() => Object.values(autosAll).filter((a) => a.payload?.incidentId === id || a.payload?.incident?.id === id), [autosAll, id]);
  const liveFx = useMemo(() => fxAll.filter((f) => f.incidentId === id), [fxAll, id]);

  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    if (!quiet) setRefreshing(true);
    try {
      const d = await api.get<IncidentDetail>(`/api/incidents/${id}`);
      if (d && d.incident) { setDetail(d); setError(null); } else if (!quiet) setError('Incident not found');
    } catch (e) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Initial load whenever the route changes.
  useEffect(() => { setDetail(null); setError(null); void load(); }, [id, load]);

  // Re-fetch (debounced) whenever anything about this incident streams in over the websocket.
  const unresolved = (storeIncident ?? detail?.incident)?.status !== 'resolved' && (storeIncident ?? detail?.incident)?.status !== 'dismissed';
  const sig = [
    storeIncident?.updatedAt ?? 0, liveBand.length,
    livePipes.map((r) => `${r.id}:${r.status}:${finishedStages(r)}`).join(','),
    liveAutos.map((a) => `${a.id}:${a.status}:${a.steps.length}`).join(','),
    liveFx.length, unresolved ? llmLen : 0,
  ].join('|');
  const firstSig = useRef(true);
  useEffect(() => {
    if (firstSig.current) { firstSig.current = false; return; }
    const t = setTimeout(() => void load(true), 300);
    return () => clearTimeout(t);
  }, [sig, load]);

  // ---- merge REST detail with fresher live data ----
  const incident = detail
    ? (storeIncident && (storeIncident.updatedAt ?? 0) >= (detail.incident.updatedAt ?? 0) ? storeIncident : detail.incident)
    : storeIncident ?? null;

  const band = useMemo(() => {
    const m = new Map<string, BandMessage>();
    for (const b of detail?.band ?? []) m.set(b.id, b);
    for (const b of liveBand) m.set(b.id, b);
    return [...m.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [detail, liveBand]);

  const pipelines = useMemo(() => {
    const m = new Map<string, PipelineRun>();
    for (const r of detail?.pipelines ?? []) m.set(r.id, r);
    for (const r of livePipes) { const prev = m.get(r.id); if (!prev || finishedStages(r) >= finishedStages(prev)) m.set(r.id, r); }
    return [...m.values()].sort((a, b) => a.startedAt - b.startedAt);
  }, [detail, livePipes]);

  const automations = useMemo(() => {
    const m = new Map<string, AutomationRun>();
    for (const r of detail?.automations ?? []) m.set(r.id, r);
    for (const r of liveAutos) {
      const prev = m.get(r.id);
      if (!prev || r.steps.length > prev.steps.length || (r.status !== 'running' && prev.status === 'running')) m.set(r.id, r);
    }
    return [...m.values()].sort((a, b) => a.startedAt - b.startedAt);
  }, [detail, liveAutos]);

  const fxSteps = useMemo(() => {
    const out: ForensicStep[] = [];
    const seen = new Set<string>();
    const rep = detail?.forensics;
    // Live frames first: they carry screenshots the stored report's step list doesn't.
    for (const s of liveFx) { const k = `${s.ts}-${s.action}`; if (seen.has(k)) continue; seen.add(k); out.push(s); }
    for (const s of rep?.steps ?? []) {
      const k = `${s.ts}-${s.action}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ incidentId: id, url: rep?.url ?? '', action: s.action, detail: s.detail, ts: s.ts });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [detail, liveFx, id]);

  const timeline = useMemo(() => {
    if (!incident) return [];
    return buildTimeline({
      incident, message: detail?.message ?? null, member: detail?.member ?? null, band, pipelines, llm: detail?.llm ?? [], automations,
      forensics: fxSteps, workforce, forensicEngine: detail?.forensics?.engine, forensicDriver: detail?.forensics?.driver,
    });
  }, [incident, detail, band, pipelines, automations, fxSteps, workforce]);

  const team = useMemo(() => {
    const s = new Set<string>();
    if (incident?.assignedTo) s.add(incident.assignedTo);
    for (const b of band) { if (AGENTS.has(b.from)) s.add(b.from); if (AGENTS.has(b.to)) s.add(b.to); }
    for (const c of detail?.llm ?? []) if (AGENTS.has(c.agentId)) s.add(c.agentId);
    if (fxSteps.length) s.add('rex');
    return [...s];
  }, [incident, band, detail, fxSteps]);

  // ---- states ----
  if (error && !incident) {
    return (
      <div className="max-w-3xl mx-auto mt-10 panel">
        <Empty icon={<SearchX size={30} />} title="We couldn’t open this incident" body={<>It may have been cleared by a demo reset. <span className="mono">{id}</span> · {error}</>}
          action={<div className="flex gap-2"><Button onClick={() => nav('/incidents')} icon={<ArrowLeft size={14} />}>Back to queue</Button><Button variant="ghost" onClick={() => load()} icon={<RefreshCw size={14} />}>Retry</Button></div>} />
      </div>
    );
  }
  if (!incident) return <RoomSkeleton />;

  const kindColor = KIND_META[incident.kind]?.color ?? '#8b5cf6';
  const emp = workforce.find((w) => w.id === incident.assignedTo);
  const cost = llmCost(detail);
  const tokens = (detail?.llm ?? []).reduce((a, c) => a + c.promptTokens + c.completionTokens, 0);
  const anchor = Math.min(incident.createdAt, detail?.message?.createdAt ?? Infinity);
  const forensics = detail?.forensics ?? null;

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/incidents" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg"><ArrowLeft size={14} /> Incident queue</Link>
        <div className="flex items-center gap-2 text-[11px] text-dim">
          <span className="mono">{incident.id}</span>
          <button onClick={() => load()} className="inline-flex items-center gap-1 hover:text-fg cursor-pointer" title="Refresh">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> refresh
          </button>
        </div>
      </div>

      {/* Header */}
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel relative overflow-hidden p-6">
        <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
        <div className="absolute -top-28 -left-20 w-96 h-96 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: kindColor }} />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge k={incident.kind} /><SeverityBadge s={incident.severity} /><StatusBadge s={incident.status} />
            {detail?.channel && <span className="inline-flex items-center text-[11.5px] text-muted"><Hash size={11} />{detail.channel.name}</span>}
            <span className="text-[11.5px] text-dim">· opened <TimeAgo ts={incident.createdAt} /></span>
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-3 leading-tight max-w-4xl">{incident.title}</h1>
          <p className="text-[14px] text-fg/75 mt-2 max-w-3xl leading-relaxed">{incident.summary}</p>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-5">
            <StatChip label="Risk" icon={<FileSearch size={12} />}>
              <div className="flex items-center gap-2.5">
                <ScoreRing value={incident.risk ?? 0} size={38} stroke={4}><span className="mono text-[11px] font-semibold" style={{ color: riskColor(incident.risk ?? 0) }}>{Math.round(incident.risk ?? 0)}</span></ScoreRing>
                <span className="text-[12px] text-muted">of 100</span>
              </div>
            </StatChip>
            <StatChip label={incident.timeToActionMs != null ? 'Time to action' : 'Elapsed'} icon={<Timer size={12} />}>
              {incident.timeToActionMs != null
                ? <span className="text-[20px] font-semibold mono text-emerald-300">{fmtMs(incident.timeToActionMs)}</span>
                : unresolved ? <ElapsedTimer since={incident.createdAt} className="text-[20px] font-semibold text-amber-300" /> : <span className="text-[20px] text-muted">—</span>}
            </StatChip>
            <StatChip label="Assigned" icon={<UserRound size={12} />}>
              {incident.assignedTo ? (
                <Link to={`/workforce/${incident.assignedTo}`} className="flex items-center gap-2 group">
                  <AgentAvatar id={incident.assignedTo} size={34} />
                  <div className="leading-tight min-w-0">
                    <div className="text-[13.5px] font-semibold group-hover:underline">{emp?.name ?? incident.assignedTo}</div>
                    <div className="text-[10.5px] text-dim truncate">{emp?.title}</div>
                  </div>
                </Link>
              ) : <span className="text-[13px] text-muted">Unassigned</span>}
            </StatChip>
            <StatChip label="Model cost" icon={<Coins size={12} />} right={<ToolChip id="flatkey" />}>
              <div className="text-[20px] font-semibold mono text-violet-200">{fmtUsd(cost)}</div>
              <div className="text-[10.5px] text-dim">
                {detail?.llm.length ?? 0} calls · {tokens.toLocaleString()} tok
                {(detail?.llm.length ?? 0) > 0 && detail!.llm.every((c) => /offline|local/i.test(c.provider)) ? ' · offline brain (local)' : ''}
              </div>
            </StatChip>
            <StatChip label="AI team on it" icon={<Users size={12} />} right={<ToolChip id="kylon" />}>
              <div className="flex -space-x-2">
                {team.length ? team.map((a) => <AgentAvatar key={a} id={a} size={30} className="ring-2 ring-ink-900 rounded-full" />) : <span className="text-[12px] text-muted">—</span>}
              </div>
            </StatChip>
          </div>
        </div>
      </motion.header>

      {incident.status === 'awaiting_approval' && <DecisionCard key={incident.updatedAt} incident={incident} onDone={() => void load(true)} />}
      <OutcomeBanner incident={incident} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <Panel title="Live timeline" icon={<History size={14} />}
            actions={<div className="hidden md:flex items-center gap-1"><ToolChip id="band" /><ToolChip id="rocketride" /><ToolChip id="flatkey" /><ToolChip id="n8n" /><ToolChip id="adal" /><ToolChip id="celesto" /></div>}>
            {timeline.length ? <Timeline items={timeline} anchor={anchor} live={unresolved} /> : <Empty title="Waiting for the first event…" />}
          </Panel>

          <Panel title="Pipeline" icon={<GitBranch size={14} />} actions={<ToolChip id="rocketride" />}>
            <PipelineRuns runs={pipelines} />
          </Panel>

          <Panel title="Model calls" icon={<BrainCircuit size={14} />} actions={<ToolChip id="flatkey" />}>
            <ModelCalls calls={detail?.llm ?? []} />
          </Panel>
        </div>

        <div className="space-y-5 min-w-0">
          <Panel title="Evidence" icon={<FileSearch size={14} />} actions={<><ToolChip id="adal" /><ToolChip id="celesto" /></>}>
            <div className="space-y-4">
              <div>
                <SectionLabel>Original message</SectionLabel>
                <MessageEvidence message={detail?.message ?? null} member={detail?.member ?? null} channel={detail?.channel ?? null} />
              </div>
              {detail?.member && (
                <div>
                  <SectionLabel>Member</SectionLabel>
                  <MemberEvidence member={detail.member} />
                </div>
              )}
              <div>
                <SectionLabel right={forensics ? <span className="text-[10.5px] text-dim">Rex · link forensics</span> : undefined}>Forensics</SectionLabel>
                {forensics ? <ForensicsReportView report={forensics} /> : liveFx.length ? <LiveForensics steps={liveFx} /> : <NoForensics />}
              </div>
            </div>
          </Panel>

          <Panel title="Automations" icon={<Workflow size={14} />} actions={<ToolChip id="n8n" />}>
            <AutomationRuns key={automations.map((a) => a.id).join()} runs={automations} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, icon, children, right }: { label: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900/60 backdrop-blur px-3.5 py-3 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">{icon}{label}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div className="h-4 w-32 rounded bg-white/[0.05]" />
      <div className="panel h-[260px] shimmer" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 panel h-[480px] shimmer" />
        <div className="panel h-[480px] shimmer" />
      </div>
    </div>
  );
}
