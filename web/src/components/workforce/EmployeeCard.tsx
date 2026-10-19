import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, CornerLeftUp, Cpu, Sparkle } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { Employee, Skill } from '../../lib/types';
import { AgentAvatar, useSpeaking } from '../Avatar';
import { Badge, Counter, ToolChip } from '../ui';
import { STATUS_META, TEAM_COLOR, TIER_META, Waveform, agentName } from './shared';

export function EmployeeCard({ emp, index, skills, kpi }: { emp: Employee; index: number; skills: Skill[]; kpi: number | null }) {
  const nav = useNavigate();
  const workforce = useHaven((s) => s.workforce);
  const st = useHaven((s) => s.agentStatus[emp.id]);
  const speaking = useSpeaking(emp.id);
  const status = speaking ? 'speaking' : st?.status ?? 'idle';
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const busy = status !== 'idle';
  const tier = TIER_META[emp.modelTier] ?? TIER_META.fast;
  const enabledSkills = skills.length ? skills.filter((s) => s.enabledFor.includes(emp.id)) : emp.skills.map((id) => ({ id, name: id.replace(/-/g, ' ') } as Skill));
  const teamColor = TEAM_COLOR[emp.team] ?? '#8d93a8';

  return (
    <motion.div layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.04 * index, ease: [0.22, 1, 0.36, 1] }} className="min-w-0">
      <motion.button type="button" onClick={() => nav(`/workforce/${emp.id}`)} whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        className="group panel panel-hover relative overflow-hidden w-full h-full text-left p-5 flex flex-col gap-4 cursor-pointer"
        style={busy ? { borderColor: `${emp.color}66`, boxShadow: `0 0 0 1px ${emp.color}22, 0 24px 60px -30px ${emp.color}` } : undefined}>
        {/* colour glow */}
        <div className="pointer-events-none absolute -top-20 -left-16 w-64 h-64 rounded-full blur-3xl opacity-[0.18] group-hover:opacity-30 transition-opacity" style={{ background: emp.color }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${emp.color}aa, transparent)` }} />
        <ArrowUpRight size={16} className="absolute top-4 right-4 text-dim opacity-0 -translate-x-1 translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all" />

        {/* identity */}
        <div className="relative flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-xl opacity-50" style={{ background: emp.color }} />
            <AgentAvatar id={emp.id} size={72} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold tracking-tight">{emp.name}</span>
              {speaking && <Waveform color={emp.color} active bars={4} />}
            </div>
            <div className="text-[13px] text-muted leading-snug">{emp.title}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge color={teamColor} dot>{emp.team}</Badge>
              <Badge color={tier.color}><Cpu size={10} />{tier.label}</Badge>
            </div>
          </div>
        </div>

        {/* live status */}
        <div className="relative rounded-xl border border-line bg-ink-950/40 px-3 py-2 flex items-center gap-2 min-h-[38px]">
          <span className="relative flex w-2 h-2 shrink-0">
            {busy && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: meta.color, opacity: 0.6 }} />}
            <span className="relative w-2 h-2 rounded-full" style={{ background: meta.color }} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: meta.color }}>{meta.label}</span>
          <div className="relative flex-1 min-w-0 h-4">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={st?.task ?? 'none'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="absolute inset-0 text-xs text-muted truncate">
                {busy && st?.task ? st.task : 'Watching the queue'}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* personality */}
        <p className="relative text-[13px] text-fg/75 italic leading-relaxed line-clamp-2">“{emp.personality}”</p>

        {/* responsibilities */}
        <ul className="relative space-y-1.5">
          {emp.responsibilities.slice(0, 3).map((r) => (
            <li key={r} className="flex gap-2 text-[12.5px] text-fg/85 leading-snug">
              <Check size={14} className="shrink-0 mt-[1px]" style={{ color: emp.color }} />
              <span className="line-clamp-2">{r}</span>
            </li>
          ))}
        </ul>

        {/* tools + skills */}
        <div className="relative space-y-2">
          <div className="flex flex-wrap gap-1">{emp.tools.map((t) => <ToolChip key={t} id={t} />)}</div>
          {enabledSkills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {enabledSkills.slice(0, 3).map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] border border-rose-400/25 bg-rose-400/[0.07] text-rose-300 capitalize">
                  <Sparkle size={9} />{s.name}
                </span>
              ))}
              {enabledSkills.length > 3 && <span className="text-[10.5px] text-dim px-1">+{enabledSkills.length - 3}</span>}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="relative mt-auto pt-3 border-t border-line flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-muted">{emp.kpi.label}</div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: emp.color }}>
              {kpi == null ? <span className="text-dim">—</span> : <Counter value={kpi} />}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted rounded-lg border border-line px-2 py-1 shrink-0">
            <CornerLeftUp size={11} /> {agentName(workforce, emp.reportsTo)}
          </span>
        </div>
      </motion.button>
    </motion.div>
  );
}
