import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { ChevronRight, CircleCheck, CircleDashed, CircleX, LoaderCircle, CircleMinus } from 'lucide-react';
import type { AutomationRun, LlmCall, PipelineRun, PipelineStageState } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, Spinner, fmtMs, fmtUsd } from '../ui';
import { JsonBlock } from './shared';

const STAGE_COLOR: Record<PipelineStageState['status'], string> = { pending: '#5d6379', running: '#a78bfa', done: '#10b981', skipped: '#8d93a8', error: '#f43f5e' };

function StageIcon({ s }: { s: PipelineStageState['status'] }) {
  if (s === 'running') return <LoaderCircle size={12} className="animate-spin" />;
  if (s === 'done') return <CircleCheck size={12} />;
  if (s === 'error') return <CircleX size={12} />;
  if (s === 'skipped') return <CircleMinus size={12} />;
  return <CircleDashed size={12} />;
}

export function PipelineRuns({ runs }: { runs: PipelineRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <div className="text-xs text-muted">No RocketRide pipeline has run for this incident yet.</div>;
  return (
    <div className="space-y-4">
      {runs.map((run) => {
        const dur = (run.finishedAt ?? Date.now()) - run.startedAt;
        const sel = run.stages.find((s) => `${run.id}:${s.id}` === open);
        return (
          <div key={run.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="mono text-[12px] font-semibold">{run.pipelineId}.pipe</span>
              <Badge color={run.engine === 'rocketride-cloud' ? '#f97316' : '#8d93a8'}>{run.engine === 'rocketride-cloud' ? 'RocketRide cloud' : 'local runtime'}</Badge>
              <Badge color={run.status === 'done' ? '#10b981' : run.status === 'error' ? '#f43f5e' : '#a78bfa'} dot>{run.status}</Badge>
              <span className="ml-auto mono text-[10.5px] text-dim">{run.status === 'running' ? <Spinner className="w-2.5 h-2.5" /> : fmtMs(dur)}</span>
            </div>
            <div className="flex items-center flex-wrap gap-y-2">
              {run.stages.map((st, i) => {
                const c = STAGE_COLOR[st.status] ?? '#8d93a8';
                const key = `${run.id}:${st.id}`;
                const active = open === key;
                return (
                  <Fragment key={st.id}>
                    {i > 0 && (
                      <span className="w-4 h-px mx-0.5" style={{ background: `linear-gradient(90deg, ${STAGE_COLOR[run.stages[i - 1].status]}, ${c})` }} />
                    )}
                    <motion.button
                      layout
                      onClick={() => setOpen(active ? null : key)}
                      title={`${st.name} · ${st.type}${st.startedAt && st.finishedAt ? ` · ${fmtMs(st.finishedAt - st.startedAt)}` : ''}`}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-shadow"
                      style={{ color: c, borderColor: `${c}55`, background: `${c}14`, ...(active ? { boxShadow: `0 0 0 2px ${c}66` } : {}) }}
                      animate={st.status === 'running' ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
                      transition={st.status === 'running' ? { duration: 1.2, repeat: Infinity } : undefined}
                    >
                      <StageIcon s={st.status} />
                      <span className="text-fg/90">{st.name}</span>
                    </motion.button>
                  </Fragment>
                );
              })}
            </div>
            <AnimatePresence>
              {sel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-3">
                    <div className="flex items-center gap-2 text-[11px] text-muted mb-1.5">
                      <span className="font-semibold text-fg/90">{sel.name}</span>
                      <span className="mono">{sel.type}</span>
                      {sel.startedAt && sel.finishedAt && <span className="mono">· {fmtMs(sel.finishedAt - sel.startedAt)}</span>}
                    </div>
                    <JsonBlock value={sel.output ?? (sel.status === 'pending' ? 'not started yet' : sel.status === 'running' ? 'running…' : null)} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      <div className="text-[10.5px] text-dim">Click a stage to inspect its output.</div>
    </div>
  );
}

const STEP_COLOR: Record<string, string> = { success: '#10b981', done: '#10b981', ok: '#10b981', running: '#a78bfa', error: '#f43f5e', failed: '#f43f5e', skipped: '#8d93a8', pending: '#5d6379' };

export function AutomationRuns({ runs }: { runs: AutomationRun[] }) {
  const [open, setOpen] = useState<string | null>(runs[0]?.id ?? null);
  if (!runs.length) return <div className="text-xs text-muted">No n8n workflow was triggered for this incident.</div>;
  return (
    <div className="space-y-2">
      {runs.map((r) => {
        const expanded = open === r.id;
        return (
          <div key={r.id} className="rounded-xl border border-line bg-white/[0.015] overflow-hidden">
            <button onClick={() => setOpen(expanded ? null : r.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-white/[0.03]">
              <ChevronRight size={13} className={clsx('text-dim transition-transform', expanded && 'rotate-90')} />
              <span className="mono text-[12px] font-semibold truncate flex-1">{r.workflowId}</span>
              <Badge color={r.mode === 'n8n' ? '#ea4b71' : '#8d93a8'}>{r.mode === 'n8n' ? 'n8n live' : 'local'}</Badge>
              <Badge color={STEP_COLOR[r.status] ?? '#8d93a8'} dot>{r.status}</Badge>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-3 pb-3">
                  <div className="text-[10.5px] text-dim mb-2">trigger · {r.trigger} {r.finishedAt ? `· ${fmtMs(r.finishedAt - r.startedAt)}` : ''}</div>
                  {r.steps.map((s, i) => {
                    const c = STEP_COLOR[s.status] ?? '#8d93a8';
                    return (
                      <li key={i} className="relative flex gap-2.5 pb-2 last:pb-0">
                        {i < r.steps.length - 1 && <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-white/10" />}
                        <span className="relative mt-1 w-[11px] h-[11px] rounded-full border-2 shrink-0" style={{ borderColor: c, background: s.status === 'running' ? 'transparent' : `${c}55` }} />
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium">{s.name} <span className="mono text-[10px] ml-1" style={{ color: c }}>{s.status}</span></div>
                          {s.detail && <div className="text-[11px] text-muted break-words">{s.detail}</div>}
                        </div>
                      </li>
                    );
                  })}
                </motion.ol>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export function ModelCalls({ calls }: { calls: LlmCall[] }) {
  if (!calls.length) return <div className="text-xs text-muted">No model calls recorded for this incident.</div>;
  const total = calls.reduce((a, c) => a + (c.costUsd || 0), 0);
  const tokens = calls.reduce((a, c) => a + c.promptTokens + c.completionTokens, 0);
  return (
    <div className="overflow-x-auto scroll-thin -mx-4 px-4">
      <table className="w-full text-[12px] min-w-[640px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-dim text-left">
            <th className="font-medium py-1.5 pr-3">Agent</th>
            <th className="font-medium py-1.5 pr-3">Purpose</th>
            <th className="font-medium py-1.5 pr-3">Model</th>
            <th className="font-medium py-1.5 pr-3">Provider</th>
            <th className="font-medium py-1.5 pr-3 text-right">Tokens</th>
            <th className="font-medium py-1.5 pr-3 text-right">Cost</th>
            <th className="font-medium py-1.5 pr-3 text-right">Latency</th>
            <th className="font-medium py-1.5 text-right">Route</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id} className="border-t border-line hover:bg-white/[0.02]">
              <td className="py-2 pr-3">
                <span className="inline-flex items-center gap-1.5"><AgentAvatar id={c.agentId} size={20} showStatus={false} /><span className="capitalize">{c.agentId}</span></span>
              </td>
              <td className="py-2 pr-3 text-muted max-w-[180px] truncate" title={c.purpose}>{c.purpose}</td>
              <td className="py-2 pr-3 mono text-[11px] text-fg/85">{c.model}</td>
              <td className="py-2 pr-3 text-muted">{c.provider}</td>
              <td className="py-2 pr-3 mono text-[11px] text-right tabular-nums">{(c.promptTokens + c.completionTokens).toLocaleString()}</td>
              <td className="py-2 pr-3 mono text-[11px] text-right tabular-nums">{fmtUsd(c.costUsd)}</td>
              <td className="py-2 pr-3 mono text-[11px] text-right tabular-nums">{fmtMs(c.latencyMs)}</td>
              <td className="py-2 text-right">
                {!c.ok ? <Badge color="#f43f5e">error</Badge> : c.fallback ? <Badge color="#f59e0b">fallback</Badge> : <Badge color="#10b981">primary</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong text-[11px]">
            <td className="pt-2 text-muted" colSpan={4}>{calls.length} calls routed through the gateway</td>
            <td className="pt-2 pr-3 mono text-right tabular-nums">{tokens.toLocaleString()}</td>
            <td className="pt-2 pr-3 mono text-right tabular-nums font-semibold text-violet-300">{fmtUsd(total)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
