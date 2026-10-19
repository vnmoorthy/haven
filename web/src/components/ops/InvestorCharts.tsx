import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, BrainCircuit, Building, ChartPie, Crown, Earth, PiggyBank, TrendingUp, Users } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { IncidentKind, Metrics } from '../../lib/types';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { Counter, Empty, KIND_META, Panel, Tabs, ToolChip, fmtUsd } from '../ui';
import { axisTick, chartTooltip, fmtCompactUsd } from './shared';

export const HUMAN_COST_PER_INCIDENT = 4.2;
export const HUMAN_SLA_MS = 4 * 3600 * 1000;
export const HUMAN_TEAM_PER_YEAR = 1_100_000;
const MODEL_COLORS = ['#c084fc', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#f97316', '#60a5fa'];

/** Monthly AI (model) spend extrapolated from the observed window. */
export function useMonthlyAiCost(m: Metrics | null) {
  const llm = useHaven((s) => s.llm);
  return useMemo(() => {
    if (!m) return { monthly: 0, windowHours: 0 };
    const starts = [m.timeline[0]?.t, ...llm.map((c) => c.createdAt)].filter((x): x is number => typeof x === 'number');
    const start = starts.length ? Math.min(...starts) : Date.now() - 3600_000;
    const windowHours = Math.max(1, (Date.now() - start) / 3600_000);
    return { monthly: (m.llmSpendUsd / windowHours) * 24 * 30, windowHours };
  }, [m, llm]);
}

// ---------------------------------------------------------------------------------------------- comparisons

export function CompareTile({ label, icon, aiValue, aiLabel, humanLabel, ratio, ratioWord, accent, aiShare }: {
  label: string; icon: ReactNode; aiValue: ReactNode; aiLabel: string; humanLabel: string; ratio: number | null; ratioWord: string; accent: string; aiShare: number;
}) {
  return (
    <div className="panel p-4 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-30" style={{ background: accent }} />
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted font-medium">{icon}{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{aiValue}</span>
        <span className="text-xs text-muted">{aiLabel}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="w-12 text-muted">Haven</span>
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
            <motion.div className="h-full rounded-full" style={{ background: accent }} initial={{ width: 0 }} animate={{ width: `${Math.max(1.5, Math.min(100, aiShare * 100))}%` }} transition={{ duration: 0.9 }} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="w-12 text-muted">Human</span>
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.12]" />
          <span className="mono text-dim">{humanLabel}</span>
        </div>
      </div>
      <div className="mt-2.5 text-sm font-semibold" style={{ color: accent }}>
        {ratio == null ? <>∞ {ratioWord}</> : <><Counter value={ratio} format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1))} />× {ratioWord}</>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- charts

export function KindDonut({ m }: { m: Metrics }) {
  const data = useMemo(() => Object.entries(m.byKind ?? {}).filter(([, v]) => v > 0)
    .map(([k, v]) => ({ kind: k, name: KIND_META[k as IncidentKind]?.label ?? k, value: v, color: KIND_META[k as IncidentKind]?.color ?? '#8d93a8' }))
    .sort((a, b) => b.value - a.value), [m.byKind]);
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <Panel title="Incidents by kind" icon={<ChartPie size={13} />} actions={<ToolChip id="promptql" />}>
      {!total ? <Empty icon={<ChartPie size={20} />} title="No incidents yet" body="Inject a threat from the Threat Lab." /> : (
        <div className="flex items-center gap-4">
          <div className="relative w-[150px] h-[150px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2.5} stroke="none" animationDuration={700}>
                  {data.map((d) => <Cell key={d.kind} fill={d.color} />)}
                </Pie>
                <Tooltip {...chartTooltip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center">
                <div className="text-xl font-semibold tabular-nums"><Counter value={total} /></div>
                <div className="text-[10px] uppercase tracking-wider text-muted">incidents</div>
              </div>
            </div>
          </div>
          <ul className="flex-1 min-w-0 space-y-1.5">
            {data.map((d) => (
              <li key={d.kind} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="mono tabular-nums text-fg/90">{d.value}</span>
                <span className="mono tabular-nums text-dim w-9 text-right">{Math.round((d.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function SpendByModel({ m }: { m: Metrics }) {
  const totalSpend = m.byModel.reduce((a, x) => a + x.costUsd, 0);
  const [mode, setMode] = useState<'spend' | 'calls'>(totalSpend > 0 ? 'spend' : 'calls');
  const data = useMemo(() => m.byModel.map((x, i) => ({ ...x, short: x.model.replace(/\s*\(offline\)/, ' ·local'), color: MODEL_COLORS[i % MODEL_COLORS.length] }))
    .sort((a, b) => (mode === 'spend' ? b.costUsd - a.costUsd : b.calls - a.calls)), [m.byModel, mode]);
  return (
    <Panel title="LLM spend by model" icon={<BrainCircuit size={13} />} actions={<>
      <Tabs<'spend' | 'calls'> value={mode} onChange={setMode} items={[{ id: 'spend', label: '$' }, { id: 'calls', label: 'calls' }]} />
      <ToolChip id="flatkey" />
    </>}>
      {!data.length ? <Empty icon={<BrainCircuit size={20} />} title="No model calls yet" /> : (
        <>
          <div className="h-[150px] -ml-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => (mode === 'spend' ? fmtUsd(v) : String(v))} />
                <YAxis type="category" dataKey="short" tick={{ ...axisTick, fill: '#8d93a8' }} axisLine={false} tickLine={false} width={150} />
                <Tooltip {...chartTooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => (mode === 'spend' ? fmtUsd(Number(v)) : `${v} calls`)} />
                <Bar dataKey={mode === 'spend' ? 'costUsd' : 'calls'} name={mode === 'spend' ? 'Spend' : 'Calls'} radius={[0, 6, 6, 0]} barSize={14} animationDuration={600}>
                  {data.map((d) => <Cell key={d.model} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-[11px] text-muted">
            {m.llmCalls.toLocaleString()} calls · {fmtUsd(m.llmSpendUsd)} total via the Flatkey gateway
            {totalSpend === 0 && <span className="text-dim"> · local offline brain ($0) — set FLATKEY_API_KEY for live models</span>}
          </div>
        </>
      )}
    </Panel>
  );
}

export function ThreatsOverTime({ m }: { m: Metrics }) {
  const data = useMemo(() => m.timeline.map((p) => ({ ...p, label: new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })), [m.timeline]);
  const threats = data.reduce((a, p) => a + p.threats, 0);
  return (
    <Panel title="Threats over time" icon={<Activity size={13} />} actions={<span className="text-[11px] text-muted"><b className="text-rose-300 mono">{threats}</b> threats · <b className="text-cyan-300 mono">{data.reduce((a, p) => a + p.screened, 0).toLocaleString()}</b> screened</span>}>
      {data.length < 2 ? <Empty icon={<Activity size={20} />} title="Collecting" /> : (
        <div className="h-[170px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="br-scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient>
                <linearGradient id="br-thr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e" stopOpacity={0.6} /><stop offset="100%" stopColor="#f43f5e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} minTickGap={30} />
              <YAxis yAxisId="l" tick={axisTick} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" hide allowDecimals={false} />
              <Tooltip {...chartTooltip} />
              <Area yAxisId="l" type="monotone" dataKey="screened" name="Screened" stroke="#22d3ee" strokeWidth={1.8} fill="url(#br-scr)" />
              <Area yAxisId="r" type="monotone" dataKey="threats" name="Threats" stroke="#f43f5e" strokeWidth={2} fill="url(#br-thr)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------- unit economics

const TIERS = [
  { plan: 'Starter', price: '$49', per: '/mo', cap: 'up to 1k members', color: '#22d3ee', perks: ['Nova triage + Rex link forensics', 'Moderator alerts'] },
  { plan: 'Growth', price: '$299', per: '/mo', cap: 'up to 25k members', color: '#8b5cf6', perks: ['Full 8-person AI workforce', 'Crisis escalation + bot audits'] },
  { plan: 'Enterprise', price: 'Custom', per: '', cap: '25k+ members · SSO · SLA', color: '#f472b6', perks: ['Dedicated policy tuning', 'Your models via Flatkey'] },
] as const;

export function UnitEconomics({ m, aiMonthly }: { m: Metrics; aiMonthly: number }) {
  const communities = useHaven((s) => s.communities);
  const mrr = m.mrr;
  const projection = useMemo(() => Array.from({ length: 13 }, (_, i) => ({ month: i === 0 ? 'Now' : `M${i}`, mrr: Math.round(mrr * Math.pow(1.18, i)) })), [mrr]);
  const end = projection[projection.length - 1];
  const n = Math.max(1, m.communities || communities.length);
  const arpu = mrr / n;
  const cogs = aiMonthly / n;
  const margin = arpu > 0 ? Math.max(0, Math.min(99.9, (1 - cogs / arpu) * 100)) : 0;

  return (
    <Panel title="Unit economics" icon={<PiggyBank size={13} />} actions={<ToolChip id="flatkey" />}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {TIERS.map((t, i) => {
          const subs = communities.filter((c) => c.plan === t.plan);
          const tierMrr = subs.reduce((a, c) => a + c.mrr, 0);
          return (
            <motion.div key={t.plan} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
              className="relative rounded-xl border border-line bg-white/[0.02] p-3.5 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)` }} />
              <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: t.color }}>{t.plan}</div>
              <div className="mt-1 flex items-baseline gap-0.5"><span className="text-2xl font-semibold tracking-tight">{t.price}</span><span className="text-xs text-muted">{t.per}</span></div>
              <div className="text-[11px] text-muted">{t.cap}</div>
              <ul className="mt-2 space-y-0.5 text-[11px] text-fg/70">{t.perks.map((p) => <li key={p}>· {p}</li>)}</ul>
              <div className="mt-2.5 pt-2 border-t border-line flex items-center justify-between text-[11px]">
                <span className="text-muted">{subs.length} customer{subs.length === 1 ? '' : 's'}</span>
                <span className="mono text-fg/90">{fmtCompactUsd(tierMrr)}/mo</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-line bg-white/[0.02] py-2.5"><div className="text-[10.5px] uppercase tracking-wider text-muted">ARPU</div><div className="mono text-sm mt-0.5">{fmtCompactUsd(arpu)}/mo</div></div>
        <div className="rounded-xl border border-line bg-white/[0.02] py-2.5"><div className="text-[10.5px] uppercase tracking-wider text-muted">AI COGS / customer</div><div className="mono text-sm mt-0.5">{fmtUsd(cogs)}/mo</div></div>
        <div className="rounded-xl border border-line bg-white/[0.02] py-2.5"><div className="text-[10.5px] uppercase tracking-wider text-muted">Gross margin</div><div className="mono text-sm mt-0.5 text-ok"><Counter value={margin} format={(v) => `${v.toFixed(1)}%`} /></div></div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wider text-muted inline-flex items-center gap-1.5"><TrendingUp size={12} /> MRR projection · 18% MoM</span>
          <span className="text-xs text-muted">M12 <b className="text-fg mono">{fmtCompactUsd(end.mrr)}</b> MRR → <b className="text-gradient mono">{fmtCompactUsd(end.mrr * 12)}</b> ARR</span>
        </div>
        <div className="h-[170px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="br-proj" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#22d3ee" /></linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => fmtCompactUsd(v)} />
              <Tooltip {...chartTooltip} formatter={(v) => [`$${Number(v).toLocaleString()}`, 'MRR']} />
              <Line type="monotone" dataKey="mrr" stroke="url(#br-proj)" strokeWidth={3} dot={false} animationDuration={900} />
              <ReferenceDot x={end.month} y={end.mrr} r={5} fill="#22d3ee" stroke="#0a0c13" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}

export function MarketCard() {
  return (
    <Panel title="Market" icon={<Earth size={13} />}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-gradient">$15B</div>
          <div className="text-[11px] text-muted mt-0.5">trust &amp; safety market (est.)</div>
        </div>
        <div>
          <div className="text-3xl font-semibold tracking-tight text-gradient">30M+</div>
          <div className="text-[11px] text-muted mt-0.5">online communities on Discord, Slack, Telegram &amp; forums</div>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs text-fg/80 leading-relaxed">
        <li className="flex gap-2"><span className="text-brand-cyan">→</span>Today: burned-out volunteer mods or outsourced review at ~$4.20 per incident, hours late.</li>
        <li className="flex gap-2"><span className="text-brand-cyan">→</span>Regulation (EU DSA, UK Online Safety Act) is pushing platforms toward proactive safety.</li>
        <li className="flex gap-2"><span className="text-brand-cyan">→</span>Wedge: 1k–25k member communities, self-serve in minutes → expand to platforms via API.</li>
      </ul>
    </Panel>
  );
}

export function OrgCard({ aiMonthly }: { aiMonthly: number }) {
  const workforce = useHaven((s) => s.workforce);
  const founder = useHaven((s) => s.founder);
  const humanMonthly = HUMAN_TEAM_PER_YEAR / 12;
  const ratio = aiMonthly > 0 ? humanMonthly / aiMonthly : null;
  return (
    <Panel title="Org" icon={<Building size={13} />} actions={<ToolChip id="kylon" />}>
      <div className="flex items-center gap-3">
        <FounderAvatar size={40} />
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-1.5">{founder?.name ?? 'Founder'} <Crown size={12} className="text-amber-300" /></div>
          <div className="text-[11px] text-muted">1 human founder · {workforce.length} AI employees</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {workforce.map((w) => (
          <Link key={w.id} to={`/workforce/${w.id}`} title={`${w.name} — ${w.title}`} className="hover:-translate-y-0.5 transition-transform">
            <AgentAvatar id={w.id} size={30} />
          </Link>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted inline-flex items-center gap-1.5"><BrainCircuit size={12} /> AI workforce (model spend, extrapolated)</span>
          <span className="mono text-fg">{fmtUsd(aiMonthly)}/mo</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
          <motion.div className="h-full brand-gradient rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.max(1.2, Math.min(100, (aiMonthly / humanMonthly) * 100))}%` }} transition={{ duration: 0.9 }} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted inline-flex items-center gap-1.5"><Users size={12} /> Equivalent human team (8 roles)</span>
          <span className="mono text-fg">{fmtCompactUsd(humanMonthly)}/mo · ~$1.1M/yr</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.14]" />
      </div>
      <div className="mt-3 text-sm font-semibold text-ok">
        {ratio == null ? 'Running on the local brain: $0 model spend so far' : <><Counter value={ratio} format={(v) => Math.round(v).toLocaleString()} />× leaner than a human team</>}
      </div>
    </Panel>
  );
}
