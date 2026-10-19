import { type ReactNode, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  BrainCircuit, CircleCheck, CircleX, Flag, Globe, MessageSquare, Network, ShieldCheck, Workflow, Zap,
} from 'lucide-react';
import type { AutomationRun, BandMessage, Employee, Incident, LlmCall, Message, Member, PipelineRun } from '../../lib/types';
import type { ForensicStep } from '../../lib/store';
import { asset } from '../../lib/api';
import { AgentAvatar, MemberAvatar } from '../Avatar';
import { Badge, TimeAgo, ToolChip, fmtMs, fmtUsd } from '../ui';
import { brief, fmtOffset, prettyAction } from './shared';

export type TimelineKind = 'band' | 'pipeline' | 'llm' | 'automation' | 'forensics' | 'system';
export interface TimelineItem {
  key: string; ts: number; kind: TimelineKind; tool?: string; actor?: string | null; memberSeed?: string;
  icon?: ReactNode; accent: string; title: ReactNode; detail?: string; tag?: string; status?: 'ok' | 'error' | 'running'; image?: string;
}

const AGENT_IDS = new Set(['aria', 'nova', 'rex', 'mira', 'kai', 'iris', 'juno', 'leo']);
const nameOf = (id: string | null | undefined, wf: Employee[]) => {
  if (!id) return '—';
  const e = wf.find((w) => w.id === id);
  if (e) return e.name;
  if (id === 'founder') return 'You';
  if (id === 'all') return 'everyone';
  if (id === 'n8n') return 'n8n';
  if (id === 'rocketride') return 'RocketRide';
  if (id === 'gateway') return 'Gateway';
  return id.charAt(0).toUpperCase() + id.slice(1);
};

export function buildTimeline(args: {
  incident: Incident; message: Message | null; member: Member | null; band: BandMessage[]; pipelines: PipelineRun[]; llm: LlmCall[];
  automations: AutomationRun[]; forensics: ForensicStep[]; workforce: Employee[]; forensicEngine?: string; forensicDriver?: string;
}): TimelineItem[] {
  const { incident, message, member, band, pipelines, llm, automations, forensics, workforce } = args;
  const items: TimelineItem[] = [];

  if (message) {
    items.push({
      key: `msg-${message.id}`, ts: message.createdAt, kind: 'system', accent: '#8d93a8', memberSeed: member?.avatarSeed,
      icon: <MessageSquare size={14} />, title: <><b>{member?.displayName ?? 'A member'}</b> posted a message</>,
      detail: message.content, tag: message.status.replace('_', ' '),
    });
  }
  items.push({
    key: `open-${incident.id}`, ts: incident.createdAt, kind: 'system', accent: '#a78bfa', icon: <Flag size={14} />,
    title: <>Incident opened · <span className="text-muted font-normal">{incident.kind.replace('_', ' ')} / {incident.severity}</span></>,
    detail: incident.title,
  });

  for (const b of band) {
    const fromAgent = AGENT_IDS.has(b.from) ? b.from : null;
    items.push({
      key: `band-${b.id}`, ts: b.createdAt, kind: 'band', tool: 'band', actor: fromAgent, accent: '#22d3ee',
      icon: b.from === 'n8n' ? <Workflow size={14} /> : b.from === 'rocketride' ? <Zap size={14} /> : <Network size={14} />,
      title: <><b>{nameOf(b.from, workforce)}</b> <span className="text-dim">→</span> <b>{nameOf(b.to, workforce)}</b> <span className="text-muted font-normal">· {b.subject}</span></>,
      detail: b.body, tag: b.kind,
    });
  }

  for (const run of pipelines) {
    items.push({
      key: `pipe-start-${run.id}`, ts: run.startedAt, kind: 'pipeline', tool: 'rocketride', accent: '#f97316', icon: <Zap size={14} />,
      title: <>Pipeline <span className="mono text-[12px]">{run.pipelineId}</span> started</>,
      detail: `${run.stages.length} stages · ${run.engine === 'rocketride-cloud' ? 'RocketRide cloud' : 'local .pipe runtime'}`,
      tag: run.engine === 'rocketride-cloud' ? 'live' : 'local',
    });
    for (const st of run.stages) {
      if (!st.finishedAt) continue;
      items.push({
        key: `stage-${run.id}-${st.id}`, ts: st.finishedAt, kind: 'pipeline', tool: 'rocketride', accent: st.status === 'error' ? '#f43f5e' : '#f97316',
        icon: st.status === 'error' ? <CircleX size={14} /> : <CircleCheck size={14} />, status: st.status === 'error' ? 'error' : 'ok',
        title: <>{st.name} <span className="text-muted font-normal">· {st.type}</span></>,
        detail: [st.startedAt ? fmtMs(st.finishedAt - st.startedAt) : null, brief(st.output)].filter(Boolean).join(' · '),
        tag: st.status,
      });
    }
  }

  for (const c of llm) {
    items.push({
      key: `llm-${c.id}`, ts: c.createdAt, kind: 'llm', tool: 'flatkey', actor: AGENT_IDS.has(c.agentId) ? c.agentId : null, accent: '#c084fc',
      icon: <BrainCircuit size={14} />, status: c.ok ? 'ok' : 'error',
      title: <><b>{nameOf(c.agentId, workforce)}</b> <span className="text-muted font-normal">· {c.purpose}</span></>,
      detail: `${c.model} via ${c.provider} · ${(c.promptTokens + c.completionTokens).toLocaleString()} tok · ${fmtUsd(c.costUsd)} · ${fmtMs(c.latencyMs)}${c.fallback ? ' · fallback' : ''}`,
      tag: c.fallback ? 'fallback' : undefined,
    });
  }

  for (const a of automations) {
    items.push({
      key: `auto-${a.id}`, ts: a.startedAt, kind: 'automation', tool: 'n8n', accent: '#ea4b71', icon: <Workflow size={14} />,
      status: a.status === 'error' ? 'error' : a.status === 'running' ? 'running' : 'ok',
      title: <>Workflow <span className="mono text-[12px]">{a.workflowId}</span> <span className="text-muted font-normal">· {a.trigger}</span></>,
      detail: a.steps.map((s) => s.name).join(' → '), tag: a.mode === 'n8n' ? 'n8n live' : 'local',
    });
  }

  for (const f of forensics) {
    const sandbox = /sandbox|vm|boot|isolat|computer|celesto|provision/i.test(f.action);
    const local = sandbox ? args.forensicEngine === 'local-sandbox' : args.forensicDriver === 'playwright';
    items.push({
      key: `fx-${f.ts}-${f.action}`, ts: f.ts, kind: 'forensics', tool: sandbox ? 'celesto' : 'adal', actor: 'rex', accent: '#fbbf24',
      icon: <Globe size={14} />, title: <>{f.action}</>, detail: f.detail, image: f.screenshot ? asset(f.screenshot) : undefined,
      tag: local ? 'local' : undefined,
    });
  }

  if (incident.resolvedAt) {
    const ok = incident.status === 'resolved';
    items.push({
      key: `close-${incident.id}`, ts: incident.resolvedAt, kind: 'system', accent: ok ? '#10b981' : '#5d6379',
      icon: <ShieldCheck size={14} />, status: 'ok',
      title: ok ? <>Resolved · <span className="text-emerald-300">{prettyAction(incident.actionTaken)}</span></> : <>Dismissed</>,
      detail: incident.timeToActionMs != null ? `Time to action ${fmtMs(incident.timeToActionMs)}` : undefined,
    });
  }

  // Dedupe (live store + REST can overlap) and order chronologically.
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).sort((a, b) => a.ts - b.ts);
}

const FILTERS: { id: 'all' | TimelineKind; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'band', label: 'BAND' }, { id: 'pipeline', label: 'Pipelines' }, { id: 'llm', label: 'Models' },
  { id: 'automation', label: 'n8n' }, { id: 'forensics', label: 'Forensics' },
];

export function Timeline({ items, anchor, live }: { items: TimelineItem[]; anchor: number; live: boolean }) {
  const [filter, setFilter] = useState<'all' | TimelineKind>('all');
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter || i.kind === 'system');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} disabled={f.id !== 'all' && !counts[f.id]}
            className={clsx('text-[11.5px] px-2.5 py-1 rounded-lg border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
              filter === f.id ? 'border-line-strong bg-white/[0.08] text-fg' : 'border-line text-muted hover:text-fg')}>
            {f.label} <span className="mono text-[10px] opacity-60">{counts[f.id] ?? 0}</span>
          </button>
        ))}
        {live && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-violet-300">
            <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-violet-400 animate-ping" /><span className="relative w-2 h-2 rounded-full bg-violet-400" /></span>
            streaming live
          </span>
        )}
      </div>

      <ol className="relative">
        <span className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-white/15 via-white/10 to-transparent" />
        <AnimatePresence initial={false}>
          {shown.map((it, idx) => (
            <motion.li key={it.key} layout="position"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.35, delay: Math.min(idx, 12) * 0.015 }}
              className="relative flex gap-3 pb-4 last:pb-0 group">
              <div className="relative z-10 shrink-0 w-8 h-8 grid place-items-center">
                {it.actor ? (
                  <AgentAvatar id={it.actor} size={30} showStatus={false} />
                ) : it.memberSeed ? (
                  <MemberAvatar seed={it.memberSeed} size={30} />
                ) : (
                  <span className="w-8 h-8 rounded-full grid place-items-center border bg-ink-900"
                    style={{ color: it.accent, borderColor: `${it.accent}55`, boxShadow: `0 0 14px -4px ${it.accent}` }}>
                    {it.icon}
                  </span>
                )}
                {it.actor && (
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full grid place-items-center bg-ink-900 border border-line" style={{ color: it.accent }}>
                    <span className="scale-[0.6]">{it.icon}</span>
                  </span>
                )}
              </div>
              <div className={clsx('flex-1 min-w-0 rounded-xl border px-3 py-2 transition-colors',
                it.status === 'error' ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-line bg-white/[0.015] group-hover:bg-white/[0.03]')}>
                <div className="flex items-start gap-2">
                  <div className="text-[12.5px] leading-snug flex-1 min-w-0">{it.title}</div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {it.tag && <Badge color={it.accent} className="!text-[10px] !px-1.5">{it.tag}</Badge>}
                    {it.tool && <ToolChip id={it.tool} />}
                    <span className="mono text-[10.5px] text-dim tabular-nums w-[58px] text-right" title={new Date(it.ts).toLocaleTimeString()}>{fmtOffset(it.ts - anchor)}</span>
                  </div>
                </div>
                {it.detail && <div className="text-[12px] text-muted mt-1 leading-relaxed line-clamp-3 break-words">{it.detail}</div>}
                {it.image && (
                  <img src={it.image} alt="sandbox capture" className="mt-2 rounded-lg border border-line max-h-28 object-cover object-top" />
                )}
                <div className="text-[10px] text-dim mt-1 opacity-0 group-hover:opacity-100 transition-opacity"><TimeAgo ts={it.ts} /></div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
