import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  ArrowUpRight, CircleCheck, CircleX, Download, History, LoaderCircle, MousePointerClick, Pin, PinOff, Play, Radio, Rocket, RotateCcw, X,
} from 'lucide-react';
import { api, IS_REPLAY } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { PipelineDef, PipelineRun } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, Button, Empty, Panel, Spinner, TimeAgo, ToolChip, fmtMs } from '../ui';
import { PipelineGraph, providerColor, stageIcon, stageTools } from './PipelineGraph';
import { CopyButton, JsonEditor, JsonView, RUN_STATUS_COLOR, StatusDot, fileHref, parseJson, subsetMatch, useNow } from './shared';

export const DEFAULT_PIPELINE_INPUT: Record<string, any> = {
  'message-triage': { text: 'Free Glimmer Premium! claim at https://glimmer-rewards-claim.xyz now', agentId: 'nova' },
  'link-forensics': { url: 'http://localhost:8787/lab/glimmer-rewards' },
  'community-insights': { question: 'weekly insights' },
  'bot-audit': { target: 'sample' },
};
const OWNER: Record<string, string> = { 'message-triage': 'nova', 'link-forensics': 'rex', 'community-insights': 'iris', 'bot-audit': 'kai' };
const pretty = (v: any) => JSON.stringify(v, null, 2);

function inputSummary(input: any): string {
  if (input == null) return '—';
  if (typeof input !== 'object') return String(input);
  for (const k of ['text', 'url', 'question', 'target', 'message']) if (typeof input[k] === 'string') return input[k];
  const first = Object.values(input).find((v) => typeof v === 'string');
  return typeof first === 'string' ? first : JSON.stringify(input).slice(0, 120);
}
const runDuration = (r: PipelineRun, nowTs: number) => (r.finishedAt ?? nowTs) - r.startedAt;

export function PipelinesTab() {
  const [defs, setDefs] = useState<PipelineDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pinned, setPinned] = useState<Record<string, string | null>>({});
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<{ pipelineId: string; at: number; input: any } | null>(null);
  const [mine, setMine] = useState<Set<string>>(() => new Set());
  const [localRuns, setLocalRuns] = useState<Record<string, PipelineRun>>({});
  const storeRuns = useHaven((s) => s.pipelineRuns);

  const load = useCallback(async () => {
    try {
      const d = await api.get<PipelineDef[]>('/api/pipelines');
      setDefs(d); setError(null);
      setSel((s) => s ?? d[0]?.id ?? null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Every run we know about: fetched history ∪ live store (WebSocket) ∪ our own POST results. Live store wins.
  const allRuns = useMemo(() => {
    const m = new Map<string, PipelineRun>();
    for (const d of defs ?? []) for (const r of d.runs) m.set(r.id, r);
    for (const r of Object.values(localRuns)) m.set(r.id, r);
    for (const r of Object.values(storeRuns)) m.set(r.id, { ...(m.get(r.id) ?? {}), ...r });
    return [...m.values()].sort((a, b) => b.startedAt - a.startedAt);
  }, [defs, storeRuns, localRuns]);

  // Spot the run we just launched as soon as its first WebSocket event lands, and pin the graph to it.
  useEffect(() => {
    if (!launching) return;
    const hit = allRuns.find((r) => r.pipelineId === launching.pipelineId && r.startedAt >= launching.at - 2000 && subsetMatch(launching.input, r.input));
    if (hit) {
      setPinned((p) => ({ ...p, [launching.pipelineId]: hit.id }));
      setMine((s) => new Set(s).add(hit.id));
      setLaunching(null);
    }
  }, [allRuns, launching]);

  const def = defs?.find((d) => d.id === sel) ?? null;
  const runs = useMemo(() => allRuns.filter((r) => r.pipelineId === sel).slice(0, 30), [allRuns, sel]);
  const latest = runs[0] ?? null;
  const pinnedId = sel ? pinned[sel] ?? null : null;
  const shown = (pinnedId && runs.find((r) => r.id === pinnedId)) || latest;
  const isRunning = shown?.status === 'running';
  const nowTs = useNow(250, isRunning || runs.some((r) => r.status === 'running'));
  const inputText = sel ? inputs[sel] ?? pretty(DEFAULT_PIPELINE_INPUT[sel] ?? {}) : '{}';
  const parsed = parseJson(inputText);
  const shownStage = shown?.stages.find((s) => s.id === stage) ?? null;
  const defStage = def?.stages.find((s) => s.id === stage) ?? null;

  const stats = useMemo(() => {
    const finished = runs.filter((r) => r.finishedAt);
    const ok = finished.filter((r) => r.status === 'done').length;
    const durs = finished.map((r) => r.finishedAt! - r.startedAt).sort((a, b) => a - b);
    return { total: runs.length, rate: finished.length ? Math.round((ok / finished.length) * 100) : null, p50: durs.length ? durs[Math.floor(durs.length / 2)] : null };
  }, [runs]);

  const pick = (id: string) => { setSel(id); setStage(null); setRunError(null); };

  const run = async () => {
    if (!sel || !parsed.ok) return;
    const pid = sel;
    setBusy(pid); setRunError(null);
    setLaunching({ pipelineId: pid, at: Date.now(), input: parsed.value });
    try {
      const r = await api.post<PipelineRun>(`/api/pipelines/${pid}/run`, { input: parsed.value });
      setLocalRuns((m) => ({ ...m, [r.id]: r }));
      setPinned((p) => ({ ...p, [pid]: r.id }));
      setMine((s) => new Set(s).add(r.id));
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setBusy(null); setLaunching(null);
    }
  };

  if (error && !defs) return <Panel><Empty icon={<CircleX size={22} />} title="Couldn't load pipelines" body={error} action={<Button size="sm" onClick={load} icon={<RotateCcw size={13} />}>Retry</Button>} /></Panel>;
  if (!defs) return <LoadingSkeleton />;
  if (!defs.length) return <Panel><Empty icon={<Rocket size={22} />} title="No .pipe files found" body="Add RocketRide pipelines to /pipelines and they show up here." /></Panel>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[290px_minmax(0,1fr)] gap-4">
      {/* ------------------------------------------------ pipeline list */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{defs.length} pipelines</span>
          <ToolChip id="rocketride" />
        </div>
        {defs.map((d, i) => {
          const dRuns = allRuns.filter((r) => r.pipelineId === d.id);
          const live = dRuns.some((r) => r.status === 'running');
          const active = d.id === sel;
          return (
            <motion.button key={d.id} onClick={() => pick(d.id)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className={clsx('panel panel-hover text-left p-3.5 cursor-pointer relative overflow-hidden', active && '!border-[#f97316]/50')}>
              {active && <motion.span layoutId="pipe-active" className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-gradient-to-b from-orange-400 to-rose-500" />}
              <div className="flex items-center gap-2.5">
                <AgentAvatar id={OWNER[d.id] ?? 'nova'} size={28} showStatus={false} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  <div className="mono text-[10.5px] text-dim truncate">{d.file}</div>
                </div>
                {live ? <Badge color="#a78bfa" dot>live</Badge> : <span className="mono text-[11px] text-muted tabular-nums">{dRuns.length}</span>}
              </div>
              <p className="mt-2 text-xs text-muted leading-relaxed line-clamp-3">{d.description}</p>
              <div className="mt-2.5 flex items-center gap-1">
                {d.stages.map((s) => <span key={s.id} title={s.name} className="h-1 flex-1 rounded-full" style={{ background: `${providerColor(s.type)}88` }} />)}
              </div>
            </motion.button>
          );
        })}
        <div className="panel p-3.5 text-xs text-muted leading-relaxed">
          Every pipeline is a real RocketRide <span className="mono text-fg/80">.pipe</span> graph — open it in the RocketRide editor. Haven executes the same graph with a
          RocketRide-compatible local engine and mirrors runs to RocketRide cloud when <span className="kbd">ROCKETRIDE_API_KEY</span> is set.
        </div>
      </div>

      {def && (
        <div className="flex flex-col gap-4 min-w-0">
          {/* ------------------------------------------------ graph */}
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
              <span className="w-8 h-8 rounded-lg grid place-items-center bg-orange-500/15 text-orange-400"><Rocket size={16} /></span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight">{def.name}</h2>
                  <ToolChip id="rocketride" />
                </div>
                <div className="mono text-[11px] text-dim">{def.file} · {def.stages.length} stages · {def.edges.length} edges</div>
              </div>
              <div className="flex-1" />
              <a href={fileHref(`/api/pipelines/${def.id}/file`, def.file, IS_REPLAY)} download={`${def.id}.pipe`} target={IS_REPLAY ? '_blank' : undefined} rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.03] hover:bg-white/[0.07] px-3 py-1.5 text-xs font-medium">
                <Download size={13} /> Download .pipe
              </a>
              <Button size="sm" variant="primary" onClick={run} disabled={!!busy || !parsed.ok} icon={busy === def.id ? <Spinner /> : <Play size={13} />}>
                {busy === def.id ? 'Running…' : 'Run pipeline'}
              </Button>
            </header>

            <div className="relative flex h-[440px]">
              <div className="relative flex-1 min-w-0">
                <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
                <PipelineGraph def={def} run={shown} selectedStage={stage} onSelect={setStage} />

                {/* run status overlay */}
                <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                  <AnimatePresence mode="popLayout">
                    {shown ? (
                      <motion.div key={shown.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-ink-900/85 backdrop-blur px-2.5 py-1.5 text-[11px]">
                        <StatusDot status={shown.status} />
                        <span className="mono text-fg/90">{shown.id}</span>
                        <span className="text-muted">{shown.status === 'running' ? `running ${fmtMs(runDuration(shown, nowTs))}` : `${shown.status} in ${fmtMs(runDuration(shown, nowTs))}`}</span>
                        <Badge color={shown.engine === 'rocketride-cloud' ? '#f97316' : '#8d93a8'}>{shown.engine === 'rocketride-cloud' ? 'RocketRide cloud' : 'local engine'}</Badge>
                        {mine.has(shown.id) && <Badge color="#22d3ee">your run</Badge>}
                      </motion.div>
                    ) : (
                      <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="rounded-xl border border-line bg-ink-900/85 px-2.5 py-1.5 text-[11px] text-muted">No runs yet — hit Run pipeline</motion.div>
                    )}
                  </AnimatePresence>
                  {shown && (
                    <button onClick={() => sel && setPinned((p) => ({ ...p, [sel]: pinnedId ? null : shown.id }))}
                      className="pointer-events-auto inline-flex items-center gap-1 rounded-xl border border-line bg-ink-900/85 backdrop-blur px-2 py-1.5 text-[11px] text-muted hover:text-fg cursor-pointer"
                      title={pinnedId ? 'Follow the newest run live' : 'Pin this run'}>
                      {pinnedId ? <><PinOff size={12} /> Follow live</> : <><Radio size={12} className="text-ok" /> Following live</>}
                    </button>
                  )}
                </div>
                <div className={clsx('absolute top-3 right-3 items-center gap-3 rounded-xl border border-line bg-ink-900/85 backdrop-blur px-2.5 py-1.5 text-[11px] text-muted pointer-events-none', stage ? 'hidden' : 'flex')}>
                  <span>runs <b className="text-fg mono">{stats.total}</b></span>
                  <span>success <b className="text-fg mono">{stats.rate == null ? '—' : `${stats.rate}%`}</b></span>
                  <span>p50 <b className="text-fg mono">{fmtMs(stats.p50)}</b></span>
                </div>
                <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-xl border border-line bg-ink-900/80 backdrop-blur px-2.5 py-1.5 text-[10.5px] text-muted pointer-events-none">
                  {(['pending', 'running', 'done', 'error'] as const).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: RUN_STATUS_COLOR[s] }} />{s}</span>
                  ))}
                  <span className="inline-flex items-center gap-1 text-dim"><MousePointerClick size={11} /> click a stage</span>
                </div>
              </div>

              {/* stage inspector */}
              <AnimatePresence>
                {stage && defStage && (
                  <motion.aside key="inspector" initial={{ width: 0, opacity: 0 }} animate={{ width: 360, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    className="shrink-0 border-l border-line bg-ink-900/80 backdrop-blur-xl overflow-hidden">
                    <StageInspector pipelineId={def.id} stage={defStage} state={shownStage} runId={shown?.id ?? null} onClose={() => setStage(null)} />
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* ------------------------------------------------ input + run output */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Run input" icon={<Play size={13} />} actions={<>
              <button onClick={() => sel && setInputs((m) => ({ ...m, [sel]: pretty(DEFAULT_PIPELINE_INPUT[sel] ?? {}) }))}
                className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer"><RotateCcw size={11} /> Reset</button>
              <ToolChip id="rocketride" />
            </>}>
              <JsonEditor value={inputText} onChange={(v) => sel && setInputs((m) => ({ ...m, [sel]: v }))} rows={5} />
              <div className="mt-3 flex items-center gap-3">
                <Button variant="primary" onClick={run} disabled={!!busy || !parsed.ok} icon={busy === def.id ? <Spinner /> : <Play size={14} />}>
                  {busy === def.id ? 'Running pipeline…' : 'Run pipeline'}
                </Button>
                <span className="text-xs text-muted">POST <span className="mono text-fg/80">/api/pipelines/{def.id}/run</span></span>
              </div>
              <AnimatePresence>
                {runError && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="mt-3 text-xs rounded-lg border border-danger/40 bg-danger/10 text-rose-200 px-3 py-2">{runError}</motion.div>
                )}
              </AnimatePresence>
            </Panel>

            <Panel title="Run output" icon={<ArrowUpRight size={13} />} actions={shown && <>
              {shown.incidentId && <Link to={`/incidents/${shown.incidentId}`} className="text-[11px] text-sky-300 hover:underline mono">{shown.incidentId}</Link>}
              <CopyButton text={JSON.stringify(shown.output ?? null, null, 2)} label="Copy" />
            </>}>
              {!shown ? (
                <Empty icon={<Rocket size={20} />} title="No output yet" body="Run the pipeline to see its JSON response." />
              ) : shown.status === 'running' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-violet-200"><LoaderCircle size={14} className="animate-spin" /> Executing stage {Math.max(1, shown.stages.findIndex((s) => s.status === 'running') + 1)} / {shown.stages.length}…</div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <motion.div className="h-full brand-gradient" animate={{ width: `${(shown.stages.filter((s) => s.status === 'done').length / Math.max(1, shown.stages.length)) * 100}%` }} />
                  </div>
                  <div className="h-24 rounded-xl shimmer" />
                </div>
              ) : (
                <JsonView value={shown.output} maxHeight={220} />
              )}
            </Panel>
          </div>

          {/* ------------------------------------------------ history */}
          <Panel title="Run history" icon={<History size={13} />} pad={false} actions={<span className="text-[11px] text-muted">click a run to replay it on the graph</span>}>
            {runs.length === 0 ? (
              <Empty icon={<History size={20} />} title="No runs yet" body="Runs appear here live as Haven executes this pipeline." />
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wider text-dim">
                      <th className="px-4 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Run</th><th className="px-2 py-2 font-medium">Input</th>
                      <th className="px-2 py-2 font-medium">Engine</th><th className="px-2 py-2 font-medium text-right">Duration</th><th className="px-2 py-2 font-medium">Started</th><th className="px-4 py-2 font-medium">Incident</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {runs.map((r) => {
                        const active = shown?.id === r.id;
                        return (
                          <motion.tr key={r.id} layout initial={{ opacity: 0, backgroundColor: 'rgba(139,92,246,0.18)' }} animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.6 }}
                            onClick={() => { if (sel) setPinned((p) => ({ ...p, [sel]: r.id })); }}
                            className={clsx('border-t border-line cursor-pointer hover:bg-white/[0.03]', active && '!bg-white/[0.05]')}>
                            <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><StatusDot status={r.status} /><span style={{ color: RUN_STATUS_COLOR[r.status] }}>{r.status}</span></span></td>
                            <td className="px-2 py-2 mono text-fg/80 whitespace-nowrap">
                              {active && pinnedId === r.id && <Pin size={10} className="inline mr-1 text-violet-300" />}{r.id}
                              {mine.has(r.id) && <span className="ml-1.5 text-[9.5px] text-cyan-300">you</span>}
                            </td>
                            <td className="px-2 py-2 text-muted max-w-[240px] truncate">{inputSummary(r.input)}</td>
                            <td className="px-2 py-2"><Badge color={r.engine === 'rocketride-cloud' ? '#f97316' : '#8d93a8'}>{r.engine}</Badge></td>
                            <td className="px-2 py-2 mono text-right tabular-nums">{fmtMs(runDuration(r, nowTs))}</td>
                            <td className="px-2 py-2 text-muted whitespace-nowrap"><TimeAgo ts={r.startedAt} /></td>
                            <td className="px-4 py-2">{r.incidentId ? <Link onClick={(e) => e.stopPropagation()} to={`/incidents/${r.incidentId}`} className="mono text-sky-300 hover:underline">{r.incidentId}</Link> : <span className="text-dim">—</span>}</td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function StageInspector({ pipelineId, stage, state, runId, onClose }: {
  pipelineId: string; stage: PipelineDef['stages'][number]; state: PipelineRun['stages'][number] | null; runId: string | null; onClose: () => void;
}) {
  const Icon = stageIcon(pipelineId, stage.id, stage.type);
  const color = providerColor(stage.type);
  const dur = state?.startedAt && state?.finishedAt ? state.finishedAt - state.startedAt : null;
  return (
    <div className="w-[360px] h-full flex flex-col">
      <div className="flex items-start gap-2.5 px-4 pt-4 pb-3 border-b border-line">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${color}22`, color }}><Icon size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">{stage.name}</div>
          <div className="mono text-[10.5px] text-dim">{stage.id} · {stage.type}</div>
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3">
        <p className="text-xs text-muted leading-relaxed">{stage.description}</p>
        <div className="flex items-center gap-1.5 flex-wrap">{stageTools(pipelineId, stage.id, stage.type).map((t) => <ToolChip key={t} id={t} />)}</div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg border border-line bg-white/[0.02] px-2 py-1.5">
            <div className="text-dim">status</div>
            <div className="flex items-center gap-1.5 mt-0.5"><StatusDot status={state?.status ?? 'pending'} size={6} /><span style={{ color: RUN_STATUS_COLOR[state?.status ?? 'pending'] }}>{state?.status ?? 'idle'}</span></div>
          </div>
          <div className="rounded-lg border border-line bg-white/[0.02] px-2 py-1.5"><div className="text-dim">duration</div><div className="mono mt-0.5">{fmtMs(dur)}</div></div>
          <div className="rounded-lg border border-line bg-white/[0.02] px-2 py-1.5"><div className="text-dim">run</div><div className="mono mt-0.5 truncate">{runId ?? '—'}</div></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted">Last output</span>
            {state?.output !== undefined && <CopyButton text={JSON.stringify(state.output, null, 2)} label="Copy" />}
          </div>
          {state?.status === 'running' ? (
            <div className="h-32 rounded-xl shimmer border border-line" />
          ) : state?.output !== undefined ? (
            <JsonView value={state.output} maxHeight={250} />
          ) : (
            <div className="text-xs text-dim rounded-xl border border-dashed border-line p-4 text-center">
              {state?.status === 'skipped' ? 'Stage was skipped in this run.' : 'No output for this stage yet — run the pipeline.'}
            </div>
          )}
        </div>
        {state?.status === 'done' && <div className="flex items-center gap-1.5 text-[11px] text-ok"><CircleCheck size={12} /> stage completed</div>}
        {state?.status === 'error' && <div className="flex items-center gap-1.5 text-[11px] text-danger"><CircleX size={12} /> stage failed</div>}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[290px_minmax(0,1fr)] gap-4">
      <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="panel h-[118px] shimmer" />)}</div>
      <div className="space-y-4"><div className="panel h-[480px] shimmer" /><div className="grid grid-cols-2 gap-4"><div className="panel h-48 shimmer" /><div className="panel h-48 shimmer" /></div></div>
    </div>
  );
}
