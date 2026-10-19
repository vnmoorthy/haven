import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Briefcase, CheckCircle2, CornerLeftUp, Cpu, Mic, Volume2, Wrench } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { Employee } from '../../lib/types';
import { AgentAvatar, FounderAvatar, useSpeaking } from '../Avatar';
import { Badge, Button, Counter, Panel, ToolChip, TOOL_META, fmtUsd } from '../ui';
import { STATUS_META, TEAM_COLOR, TIER_META, TOOL_INFO, Waveform, onColor } from './shared';

export function ProfileHero({ emp, stats, onIntro, introPending }: { emp: Employee; stats: Record<string, number>; onIntro: () => void; introPending: boolean }) {
  const nav = useNavigate();
  const workforce = useHaven((s) => s.workforce);
  const founder = useHaven((s) => s.founder);
  const st = useHaven((s) => s.agentStatus[emp.id]);
  const maskyMode = useHaven((s) => s.integrations.find((i) => i.id === 'masky')?.mode);
  const speaking = useSpeaking(emp.id);
  const status = speaking ? 'speaking' : st?.status ?? 'idle';
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const manager = workforce.find((w) => w.id === emp.reportsTo);
  const tier = TIER_META[emp.modelTier] ?? TIER_META.fast;
  const portrait: string | null = (emp as any).maskyAvatar ?? null;

  const statItems = [
    { label: 'BAND sent', value: Number(stats.bandSent) || 0 },
    { label: 'BAND received', value: Number(stats.bandReceived) || 0 },
    { label: 'Incidents owned', value: Number(stats.incidents) || 0 },
    { label: 'Model calls', value: Number(stats.llmCalls) || 0 },
  ];

  return (
    <div className="panel relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-70 pointer-events-none" />
      <div className="absolute -top-32 -left-24 w-[520px] h-[360px] rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: emp.color }} />
      <div className="absolute -bottom-40 right-0 w-[420px] h-[300px] rounded-full blur-3xl opacity-10 pointer-events-none" style={{ background: emp.color }} />
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${emp.color}, transparent)` }} />

      <div className="relative p-6">
        <button onClick={() => nav('/workforce')} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg cursor-pointer mb-4">
          <ArrowLeft size={13} /> AI Workforce
        </button>

        <div className="flex flex-col md:flex-row gap-6 md:items-center">
          {/* avatar */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            <div className="relative">
              <motion.div className="absolute -inset-3 rounded-full blur-2xl" style={{ background: emp.color }}
                animate={{ opacity: speaking ? [0.35, 0.7, 0.35] : 0.3, scale: speaking ? [1, 1.08, 1] : 1 }} transition={{ duration: speaking ? 0.9 : 0.4, repeat: speaking ? Infinity : 0 }} />
              {portrait ? (
                <div className="relative w-[120px] h-[120px]">
                  <img src={portrait} alt={emp.name} className="w-full h-full rounded-full object-cover" style={{ boxShadow: `0 0 0 2px ${emp.color}` }} />
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2"><ToolChip id="masky" className="bg-ink-900" /></span>
                </div>
              ) : (
                <AgentAvatar id={emp.id} size={120} />
              )}
            </div>
            <div className="h-5 flex items-center gap-2">
              <Waveform color={emp.color} active={speaking} bars={7} />
              <span className="text-[10.5px] uppercase tracking-wider" style={{ color: speaking ? emp.color : '#5d6379' }}>{speaking ? 'speaking' : 'voice idle'}</span>
            </div>
          </div>

          {/* identity */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge color={TEAM_COLOR[emp.team]} dot>{emp.team}</Badge>
              <Badge color={tier.color}><Cpu size={10} />{tier.label} · Flatkey</Badge>
              <Badge color={meta.color} dot>{meta.label}</Badge>
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">{emp.name}</h1>
            <div className="text-[15px] text-muted mt-0.5 flex items-center gap-2"><Briefcase size={14} />{emp.title}</div>
            <p className="mt-3 text-[14px] text-fg/80 italic leading-relaxed max-w-2xl">“{emp.personality}”</p>
            {status !== 'idle' && st?.task && (
              <div className="mt-2 text-xs text-muted"><span style={{ color: meta.color }}>Now:</span> {st.task}</div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={onIntro} disabled={introPending}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
                style={{ background: emp.color, color: onColor(emp.color), boxShadow: `0 10px 30px -12px ${emp.color}` }}>
                {introPending ? <Mic size={15} className="animate-pulse" /> : <Volume2 size={15} />}
                {introPending ? `${emp.name} is preparing…` : `Hear ${emp.name}'s intro`}
                <span className="mono text-[10px] opacity-70">Masky{maskyMode === 'live' ? '' : ' · local voice'}</span>
              </button>
              <button onClick={() => manager && nav(`/workforce/${manager.id}`)} disabled={!manager}
                className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-white/[0.03] hover:bg-white/[0.07] px-3 py-2 text-xs whitespace-nowrap cursor-pointer disabled:cursor-default disabled:hover:bg-white/[0.03]">
                <CornerLeftUp size={13} className="text-muted" /> Reports to
                {manager ? <><AgentAvatar id={manager.id} size={18} showStatus={false} /><b>{manager.name}</b></> : <><FounderAvatar size={18} /><b>{founder?.name ?? 'Founder'}</b></>}
              </button>
            </div>
          </div>

        </div>

        {/* stats */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {statItems.map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
              <div className="text-[10.5px] uppercase tracking-wider text-muted">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums"><Counter value={s.value} /></div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-1 rounded-xl border px-3 py-2.5" style={{ borderColor: `${emp.color}44`, background: `${emp.color}0f` }}>
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Model spend</div>
            <div className="text-xl font-semibold tabular-nums" style={{ color: emp.color }}>{fmtUsd(Number(stats.costUsd) || 0)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResponsibilitiesPanel({ emp }: { emp: Employee }) {
  return (
    <Panel title="Responsibilities" icon={<CheckCircle2 size={14} />} actions={<ToolChip id="kylon" />} className="h-full">
      <ul className="space-y-2">
        {emp.responsibilities.map((r, i) => (
          <motion.li key={r} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
            className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
            <span className="w-5 h-5 rounded-md grid place-items-center shrink-0 mt-[1px]" style={{ background: `${emp.color}22`, color: emp.color }}>
              <CheckCircle2 size={13} />
            </span>
            <span className="text-[13px] leading-snug">{r}</span>
          </motion.li>
        ))}
      </ul>
    </Panel>
  );
}

export function ToolsPanel({ emp }: { emp: Employee }) {
  return (
    <Panel title="Tools" icon={<Wrench size={14} />} actions={<span className="text-[11px] text-muted mono">{emp.tools.length} sponsor tools</span>} className="h-full">
      <ul className="space-y-2">
        {emp.tools.map((t, i) => (
          <motion.li key={t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}
            className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
            <span className="w-[84px] shrink-0 pt-[1px]"><ToolChip id={t} /></span>
            <span className="text-[12.5px] text-fg/80 leading-snug">{TOOL_INFO[t] ?? `${TOOL_META[t]?.name ?? t} integration.`}</span>
          </motion.li>
        ))}
      </ul>
    </Panel>
  );
}
