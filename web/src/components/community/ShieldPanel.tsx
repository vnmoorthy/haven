import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, CheckCircle2, Circle, Loader2, MinusCircle, Shield, ShieldCheck, X, XCircle } from 'lucide-react';
import { useHaven } from '../../lib/store';
import { api } from '../../lib/api';
import type { IncidentDetail, Message, PipelineRun } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, Button, Empty, KindBadge, SeverityBadge, StatusBadge, ToolChip, fmtMs } from '../ui';

const riskColor = (v: number) => (v >= 80 ? '#f43f5e' : v >= 55 ? '#f97316' : v >= 30 ? '#f59e0b' : '#10b981');
const STATUS_TEXT: Record<Message['status'], { label: string; color: string }> = {
  visible: { label: 'Passed screening', color: '#10b981' },
  under_review: { label: 'Under review', color: '#22d3ee' },
  quarantined: { label: 'Quarantined', color: '#f43f5e' },
  removed: { label: 'Removed', color: '#8d93a8' },
};

function RiskRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const color = riskColor(value);
  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
        <circle cx={44} cy={44} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={7} />
        <motion.circle cx={44} cy={44} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, value)) / 100) }} transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <motion.div key={Math.round(value)} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[26px] font-semibold tabular-nums" style={{ color }}>{Math.round(value)}</motion.div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-dim mt-1">risk</div>
        </div>
      </div>
    </div>
  );
}

function StageIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-orange-400" />;
  if (status === 'done') return <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }}><CheckCircle2 size={14} className="text-ok" /></motion.span>;
  if (status === 'error') return <XCircle size={14} className="text-danger" />;
  if (status === 'skipped') return <MinusCircle size={14} className="text-dim" />;
  return <Circle size={14} className="text-dim/70" />;
}

/** Live analysis of one community message: risk, labels, RocketRide triage stages and the owning AI employee. */
export function ShieldPanel({ message, auto, channelName }: { message: Message | null; auto: boolean; channelName: string }) {
  const incident = useHaven((s) => (message?.incidentId ? s.incidents.find((i) => i.id === message.incidentId) : undefined));
  const pipelineRuns = useHaven((s) => s.pipelineRuns);
  const agentStatus = useHaven((s) => s.agentStatus);
  const workforce = useHaven((s) => s.workforce);
  const author = useHaven((s) => (message?.memberId ? s.members[message.memberId] : undefined));
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const incidentId = message?.incidentId ?? null;
  useEffect(() => {
    if (!incidentId) return;
    let alive = true;
    api.get<IncidentDetail>(`/api/incidents/${incidentId}`).then((d) => { if (alive && d?.incident) setDetail(d); }).catch(() => { /* keep last */ });
    return () => { alive = false; };
  }, [incidentId, incident?.updatedAt, incident?.status]);

  const inc = incident ?? (detail?.incident.id === incidentId ? detail?.incident : undefined);

  const run = useMemo<PipelineRun | null>(() => {
    if (!message) return null;
    const pool = new Map<string, PipelineRun>();
    if (detail && detail.incident.id === incidentId) for (const r of detail.pipelines ?? []) pool.set(r.id, r);
    for (const r of Object.values(pipelineRuns)) {
      const inp = r.input ?? {};
      if ((incidentId && r.incidentId === incidentId) || inp.messageId === message.id || inp.message?.id === message.id) pool.set(r.id, r);
    }
    const runs = [...pool.values()].sort((a, b) => {
      const ta = a.pipelineId.includes('triage') ? 1 : 0, tb = b.pipelineId.includes('triage') ? 1 : 0;
      return tb - ta || b.startedAt - a.startedAt;
    });
    return runs[0] ?? null;
  }, [message, incidentId, detail, pipelineRuns]);

  const act = async (kind: 'approve' | 'dismiss') => {
    if (!inc) return;
    setActing(kind); setErr(null);
    try {
      await api.post(`/api/incidents/${inc.id}/${kind}`, {}); // server applies the recommended action
    } catch (e) { setErr((e as Error).message); } finally { setActing(null); }
  };

  const owner = inc?.assignedTo ? workforce.find((w) => w.id === inc.assignedTo) : undefined;
  const ownerState = owner ? agentStatus[owner.id] : undefined;
  const st = message ? STATUS_TEXT[message.status] : null;

  return (
    <div className="flex flex-col min-h-0 max-h-full">
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-fg/90 whitespace-nowrap">
          <Shield size={14} className="text-brand-cyan" /> Haven Shield
        </div>
        <div className="flex items-center gap-1.5">
          {message && <Badge color={auto ? '#8d93a8' : '#a78bfa'}>{auto ? 'latest flagged' : 'selected'}</Badge>}
          <ToolChip id="rocketride" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 py-3 space-y-4">
        {!message ? (
          <Empty icon={<ShieldCheck size={26} className="text-ok" />} title={`All clear in #${channelName}`}
            body="Nova screened every message here. Click any message to inspect its analysis, or simulate a threat below." />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={message.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }} className="space-y-4">
              {/* Risk */}
              <div className="flex items-center gap-4">
                <RiskRing value={message.risk} />
                <div className="min-w-0 space-y-1.5">
                  {st && <div className="text-[15px] font-semibold" style={{ color: st.color }}>{st.label}</div>}
                  <div className="flex flex-wrap gap-1">
                    {message.labels.length ? message.labels.map((l) => <Badge key={l} color={riskColor(message.risk)}>{l}</Badge>) : <span className="text-xs text-dim">no labels</span>}
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    {author ? <>@{author.handle} · trust <b className="text-fg mono">{Math.round(author.trustScore)}</b></> : message.authorKind}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[12px] text-muted leading-relaxed line-clamp-4 break-words">
                <span className="text-[10px] uppercase tracking-wider text-dim block mb-0.5">evidence</span>
                {message.content}
              </div>

              {/* Pipeline */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-dim font-medium">Triage pipeline</div>
                  {run && <span className="text-[10.5px] mono text-dim">{run.pipelineId} · {run.engine === 'local' ? 'local' : 'rocketride-cloud'}</span>}
                </div>
                {run ? (
                  <ol className="relative space-y-0.5">
                    <span className="absolute left-[6.5px] top-2 bottom-2 w-px bg-line" />
                    {run.stages.map((s) => (
                      <motion.li key={s.id} layout className="relative flex items-center gap-2.5 py-1">
                        <span className="relative z-10 bg-ink-900 rounded-full"><StageIcon status={s.status} /></span>
                        <span className={s.status === 'running' ? 'text-[12.5px] text-fg font-medium' : s.status === 'pending' ? 'text-[12.5px] text-dim' : 'text-[12.5px] text-fg/85'}>{s.name}</span>
                        <span className="text-[10px] mono text-dim">{s.type}</span>
                        <span className="ml-auto text-[10.5px] mono text-dim tabular-nums">
                          {s.startedAt && s.finishedAt ? fmtMs(s.finishedAt - s.startedAt) : s.status === 'running' ? '…' : ''}
                        </span>
                      </motion.li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-xs text-dim rounded-xl border border-dashed border-line px-3 py-2.5">
                    {message.status === 'under_review' ? 'Waiting for the RocketRide triage run to start…' : 'Screened by the inline fast path — no pipeline run recorded for this message.'}
                  </div>
                )}
              </div>

              {/* Incident + owner */}
              {inc ? (
                <div className="rounded-xl border border-line bg-white/[0.025] p-3 space-y-2.5">
                  <div className="flex flex-wrap gap-1.5"><KindBadge k={inc.kind} /><SeverityBadge s={inc.severity} /><StatusBadge s={inc.status} /></div>
                  <div className="text-[13px] font-medium leading-snug">{inc.title}</div>
                  {owner && (
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar id={owner.id} size={32} />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium" style={{ color: owner.color }}>{owner.name} <span className="text-dim font-normal">· {owner.title}</span></div>
                        <div className="text-[11px] text-muted truncate">{ownerState && ownerState.status !== 'idle' ? `${ownerState.status} — ${ownerState.task ?? ''}` : 'idle · case handled'}</div>
                      </div>
                    </div>
                  )}
                  {inc.recommendedAction && <div className="text-[11.5px] text-muted">Recommended: <b className="text-fg">{inc.recommendedAction}</b>{inc.actionTaken ? <> · Taken: <b className="text-ok">{inc.actionTaken}</b></> : null}</div>}
                  {inc.status === 'awaiting_approval' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" icon={acting === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} disabled={!!acting} onClick={() => act('approve')}>
                        Approve{inc.recommendedAction ? ` ${inc.recommendedAction}` : ''}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<X size={12} />} disabled={!!acting} onClick={() => act('dismiss')}>Dismiss</Button>
                    </div>
                  )}
                  {err && <div className="text-[11px] text-danger">{err}</div>}
                  <Link to={`/incidents/${inc.id}`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-cyan hover:underline">
                    Open incident room <ArrowUpRight size={12} />
                  </Link>
                </div>
              ) : message.incidentId ? (
                <div className="text-xs text-dim">Loading incident…</div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck size={14} className="text-ok" /> No incident opened — below action threshold.</div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
