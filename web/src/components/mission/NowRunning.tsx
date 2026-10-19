import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Rocket, Workflow, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import { api } from '../../lib/api';
import type { AutomationDef, AutomationRun, PipelineDef, PipelineRun } from '../../lib/types';
import { TimeAgo, ToolChip, fmtMs } from '../ui';

type Item =
  | { type: 'pipe'; id: string; name: string; run: PipelineRun; ts: number }
  | { type: 'auto'; id: string; name: string; run: AutomationRun; ts: number };

const pretty = (id: string) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const STALE_MS = 3 * 60 * 1000;

function Dot({ status }: { status: string }) {
  const running = status === 'running';
  const color = status === 'done' || status === 'success' ? '#10b981' : running ? '#f97316' : status === 'error' ? '#f43f5e' : status === 'skipped' ? '#5d6379' : 'rgba(255,255,255,0.14)';
  return (
    <span className="relative inline-flex w-2 h-2">
      {running && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color }} />}
      <span className="relative w-2 h-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

/** Strip of RocketRide pipeline runs and n8n automation runs currently in flight. */
export function NowRunning() {
  const pipelineRuns = useHaven((s) => s.pipelineRuns);
  const automationRuns = useHaven((s) => s.automationRuns);
  const nav = useNavigate();
  const [names, setNames] = useState<{ pipes: Record<string, string>; autos: Record<string, string> }>({ pipes: {}, autos: {} });
  const [history, setHistory] = useState<{ pipes: PipelineRun[]; autos: AutomationRun[] }>({ pipes: [], autos: [] });

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.get<PipelineDef[]>('/api/pipelines').catch(() => [] as PipelineDef[]),
      api.get<AutomationDef[]>('/api/automations').catch(() => [] as AutomationDef[]),
    ]).then(([p, a]) => {
      if (!alive) return;
      const pipes = Array.isArray(p) ? p : [];
      const autos = Array.isArray(a) ? a : [];
      setNames({ pipes: Object.fromEntries(pipes.map((d) => [d.id, d.name])), autos: Object.fromEntries(autos.map((d) => [d.id, d.name])) });
      setHistory({ pipes: pipes.flatMap((d) => d.runs ?? []), autos: autos.flatMap((d) => d.runs ?? []) });
    });
    return () => { alive = false; };
  }, []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);

  const { active, recent } = useMemo(() => {
    const pipes = new Map<string, PipelineRun>();
    for (const r of history.pipes) pipes.set(r.id, r);
    for (const r of Object.values(pipelineRuns)) pipes.set(r.id, r);
    const autos = new Map<string, AutomationRun>();
    for (const r of history.autos) autos.set(r.id, r);
    for (const r of Object.values(automationRuns)) autos.set(r.id, r);
    const all: Item[] = [
      ...[...pipes.values()].map((r) => ({ type: 'pipe' as const, id: r.id, name: names.pipes[r.pipelineId] ?? pretty(r.pipelineId), run: r, ts: r.finishedAt ?? r.startedAt })),
      ...[...autos.values()].map((r) => ({ type: 'auto' as const, id: r.id, name: names.autos[r.workflowId] ?? pretty(r.workflowId), run: r, ts: r.finishedAt ?? r.startedAt })),
    ];
    return {
      active: all.filter((i) => i.run.status === 'running' && now - i.run.startedAt < STALE_MS).sort((a, b) => b.run.startedAt - a.run.startedAt).slice(0, 6),
      recent: all.filter((i) => i.run.status !== 'running').sort((a, b) => b.ts - a.ts).slice(0, 4),
    };
  }, [pipelineRuns, automationRuns, history, names, now]);

  const shown = active.length ? active : recent;

  return (
    <div className="panel px-4 py-2.5 flex items-center gap-3 min-h-[52px] overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 pr-3 border-r border-line">
        <span className="relative flex w-2 h-2">
          {active.length > 0 && <span className="absolute inset-0 rounded-full bg-orange-400 animate-ping" />}
          <span className={clsx('relative w-2 h-2 rounded-full', active.length ? 'bg-orange-400' : 'bg-ok')} />
        </span>
        <div className="leading-tight">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-fg/90">{active.length ? 'Now running' : 'All quiet'}</div>
          <div className="text-[10.5px] text-dim">{active.length ? `${active.length} in flight` : 'last runs'}</div>
        </div>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scroll-thin py-0.5">
        {shown.length === 0 && <span className="text-xs text-muted">No pipeline or automation runs yet — they appear here the moment Nova or Leo kicks one off.</span>}
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((it) => {
            const steps = it.type === 'pipe' ? it.run.stages.map((s) => ({ name: s.name, status: s.status })) : it.run.steps.map((s) => ({ name: s.name, status: s.status }));
            const current = steps.find((s) => s.status === 'running') ?? steps.filter((s) => s.status === 'done' || s.status === 'success').slice(-1)[0];
            const running = it.run.status === 'running';
            const failed = it.run.status === 'error';
            const Icon = it.type === 'pipe' ? Rocket : Workflow;
            const color = it.type === 'pipe' ? '#f97316' : '#ea4b71';
            const incidentId = it.type === 'pipe' ? it.run.incidentId : null;
            const engine = it.type === 'pipe' ? (it.run.engine === 'local' ? 'local' : 'cloud') : (it.run.mode === 'local' ? 'local' : 'n8n');
            return (
              <motion.button key={it.id} layout type="button" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: running ? 1 : 0.75, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => nav(incidentId ? `/incidents/${incidentId}` : '/automations')}
                className="shrink-0 flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.03] hover:bg-white/[0.06] px-2.5 py-1.5 cursor-pointer text-left"
                style={running ? { borderColor: `${color}55`, boxShadow: `0 0 20px -10px ${color}` } : undefined}>
                <span className="w-6 h-6 rounded-lg grid place-items-center shrink-0" style={{ background: `${color}1f`, color }}><Icon size={13} /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap">
                    {it.name}
                    {!running && (failed ? <XCircle size={12} className="text-danger" /> : <CheckCircle2 size={12} className="text-ok" />)}
                  </span>
                  <span className="flex items-center gap-1 mt-0.5">
                    {steps.slice(0, 12).map((s, i) => <span key={i} title={`${s.name} · ${s.status}`}><Dot status={s.status} /></span>)}
                    <span className="ml-1 text-[10.5px] text-dim whitespace-nowrap max-w-[150px] truncate">
                      {running ? current?.name ?? 'starting' : it.run.finishedAt ? <>{fmtMs(it.run.finishedAt - it.run.startedAt)} · <TimeAgo ts={it.run.finishedAt} /></> : ''}
                    </span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <ToolChip id={it.type === 'pipe' ? 'rocketride' : 'n8n'} />
                  <span className="text-[9.5px] mono text-dim">{engine}</span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
