import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { ArrowRight, Network, Radio } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { Employee } from '../../lib/types';
import { AgentAvatar, FounderAvatar, useSpeaking } from '../Avatar';
import { ToolChip, timeAgo } from '../ui';
import { TEAM_COLOR, TEAM_ORDER, STATUS_META, agentName } from './shared';

/** Vertical connector that lights up in the agent's colour while the agent below it is busy. */
function VLine({ color, active, h = 22 }: { color: string; active: boolean; h?: number }) {
  return (
    <div className="relative mx-auto w-px" style={{ height: h }}>
      <div className="absolute inset-0 bg-white/15" />
      {active && (
        <motion.div className="absolute left-0 w-px" style={{ background: `linear-gradient(${color}, transparent)`, height: h / 1.5 }}
          initial={{ top: -h / 2, opacity: 0 }} animate={{ top: [-h / 2, h], opacity: [0, 1, 0] }} transition={{ duration: 1.1, repeat: Infinity }} />
      )}
    </div>
  );
}

function Node({ emp, big }: { emp: Employee; big?: boolean }) {
  const nav = useNavigate();
  const st = useHaven((s) => s.agentStatus[emp.id]);
  const speaking = useSpeaking(emp.id);
  const status = speaking ? 'speaking' : st?.status ?? 'idle';
  const busy = status !== 'idle';
  return (
    <motion.button type="button" onClick={() => nav(`/workforce/${emp.id}`)} whileHover={{ y: -2 }}
      className={clsx('group relative flex items-center gap-2.5 rounded-xl border text-left cursor-pointer transition-colors bg-ink-900/70 hover:bg-ink-800/80',
        big ? 'px-3.5 py-2.5 min-w-[220px]' : 'px-2 py-2 flex-1 min-w-0')}
      style={{ borderColor: busy ? `${emp.color}88` : 'rgba(255,255,255,0.08)', boxShadow: busy ? `0 0 24px -8px ${emp.color}` : undefined }}>
      <AgentAvatar id={emp.id} size={big ? 40 : 30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx('font-semibold truncate', big ? 'text-sm' : 'text-[13px]')}>{emp.name}</span>
          {busy && <span className="text-[9.5px] uppercase tracking-wider font-semibold" style={{ color: STATUS_META[status]?.color }}>{STATUS_META[status]?.label}</span>}
        </div>
        <div className="text-[11px] text-muted truncate">{busy && st?.task ? st.task : emp.title}</div>
      </div>
    </motion.button>
  );
}

export function OrgChart() {
  const workforce = useHaven((s) => s.workforce);
  const founder = useHaven((s) => s.founder);
  const agentStatus = useHaven((s) => s.agentStatus);
  const band = useHaven((s) => s.band);
  const aria = workforce.find((w) => w.id === 'aria') ?? workforce.find((w) => w.reportsTo === 'founder');
  const teams = useMemo(() => TEAM_ORDER.map((t) => ({ team: t, members: workforce.filter((w) => w.team === t && w.id !== aria?.id) })).filter((t) => t.members.length), [workforce, aria?.id]);
  const isBusy = (id: string) => (agentStatus[id]?.status ?? 'idle') !== 'idle';
  const ariaBusy = aria ? isBusy(aria.id) : false;
  const anySpecialistBusy = teams.some((t) => t.members.some((m) => isBusy(m.id)));
  const latest = useMemo(() => [...band].sort((a, b) => b.createdAt - a.createdAt).slice(0, 1), [band]);

  if (!aria) return null;
  return (
    <div className="panel relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[220px] rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: aria.color }} />
      <header className="relative flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg/90 uppercase">
          <span className="text-muted"><Network size={14} /></span> Org chart
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="hidden sm:inline">Reporting lines from the</span><ToolChip id="kylon" /><span className="hidden sm:inline">manifest · delegation over</span><ToolChip id="band" />
        </div>
      </header>

      <div className="relative overflow-x-auto scroll-thin">
        <div className="min-w-[880px] px-4 pt-5 pb-4 flex flex-col items-center">
          {/* Founder */}
          <div className="flex items-center gap-2.5 rounded-xl border border-line-strong bg-ink-900/70 px-3.5 py-2.5 min-w-[220px]">
            <FounderAvatar size={40} />
            <div>
              <div className="text-sm font-semibold">{founder?.name ?? 'Founder'}</div>
              <div className="text-[11px] text-muted">{founder?.title ?? 'Founder & CEO (human)'}</div>
            </div>
            <span className="ml-auto text-[9.5px] uppercase tracking-wider rounded-md px-1.5 py-0.5 border border-line-strong text-muted">human</span>
          </div>
          <VLine color={aria.color} active={ariaBusy} />
          <Node emp={aria} big />
          <VLine color={aria.color} active={anySpecialistBusy} />

          {/* Teams */}
          <div className="flex w-full max-w-[1240px]">
            {teams.map((t, ti) => {
              const color = TEAM_COLOR[t.team];
              const first = ti === 0, last = ti === teams.length - 1;
              return (
                <div key={t.team} className="relative px-1.5 pt-[22px] flex flex-col items-center min-w-0" style={{ flex: t.members.length }}>
                  {/* horizontal rail */}
                  <div className="absolute top-0 h-px bg-white/15" style={{ left: first ? '50%' : 0, right: last ? '50%' : 0 }} />
                  <div className="absolute top-0 left-1/2 w-px h-[22px] bg-white/15" />
                  <div className="mb-2 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{t.team}
                  </div>
                  <div className="flex gap-2 w-full">
                    {t.members.map((m) => <Node key={m.id} emp={m} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live BAND wire */}
      <div className="relative border-t border-line px-4 py-2.5 flex items-center gap-3 text-xs min-h-[42px]">
        <span className="inline-flex items-center gap-1.5 text-muted shrink-0"><Radio size={13} className="text-brand-cyan animate-pulse" /> Live wire</span>
        <div className="flex-1 min-w-0 relative h-5">
          <AnimatePresence mode="popLayout" initial={false}>
            {latest.map((b) => (
              <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="absolute inset-0 flex items-center gap-2 min-w-0">
                <b className="text-fg shrink-0">{agentName(workforce, String(b.from))}</b>
                <ArrowRight size={12} className="text-dim shrink-0" />
                <b className="text-fg shrink-0">{b.to === 'all' ? 'everyone' : agentName(workforce, String(b.to))}</b>
                <span className="mono text-[10.5px] text-dim shrink-0">{b.kind}</span>
                <span className="text-muted truncate">{b.subject}{b.body ? ` — ${b.body}` : ''}</span>
                <span className="text-dim shrink-0 ml-auto">{timeAgo(b.createdAt)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!latest.length && <span className="text-dim">Waiting for the first BAND message…</span>}
        </div>
      </div>
    </div>
  );
}
