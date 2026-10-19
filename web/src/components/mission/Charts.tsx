import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Cpu } from 'lucide-react';
import { useHaven } from '../../lib/store';
import { Badge, Empty, Panel, ToolChip, fmtUsd } from '../ui';

const tooltipStyle = {
  contentStyle: { background: '#0e111a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12, color: '#e8eaf2' },
  labelStyle: { color: '#8d93a8', marginBottom: 4 },
  itemStyle: { padding: 0 },
};

/** Screened vs threats over time (metrics.timeline). */
export function TrafficChart() {
  const timeline = useHaven((s) => s.metrics?.timeline);
  const data = useMemo(() => (timeline ?? []).map((p) => ({
    ...p, label: new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  })), [timeline]);
  const totals = data.reduce((a, p) => ({ s: a.s + p.screened, t: a.t + p.threats }), { s: 0, t: 0 });

  return (
    <Panel title="Traffic screened" icon={<Activity size={14} />}
      actions={<>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><span className="w-2 h-2 rounded-sm bg-brand-cyan" />screened <b className="text-fg mono">{totals.s.toLocaleString()}</b></span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><span className="w-2 h-2 rounded-sm bg-danger" />threats <b className="text-fg mono">{totals.t.toLocaleString()}</b></span>
        <ToolChip id="rocketride" />
      </>}>
      {data.length < 2 ? (
        <Empty icon={<Activity size={22} />} title="Collecting traffic" body="The timeline fills in as Nova screens community messages." />
      ) : (
        <div className="h-[178px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="mc-screened" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="mc-threats" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.55} /><stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis yAxisId="l" tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" hide allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Area yAxisId="l" type="monotone" dataKey="screened" name="Screened" stroke="#22d3ee" strokeWidth={2} fill="url(#mc-screened)" animationDuration={500} />
              <Area yAxisId="r" type="monotone" dataKey="threats" name="Threats" stroke="#f43f5e" strokeWidth={2} fill="url(#mc-threats)" animationDuration={500} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

const MODEL_COLORS = ['#c084fc', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#f97316'];

/** LLM spend per model, routed by Flatkey. */
export function SpendByModel() {
  const byModel = useHaven((s) => s.metrics?.byModel);
  const spend = useHaven((s) => s.metrics?.llmSpendUsd ?? 0);
  const llmMode = useHaven((s) => s.llmMode);
  const rows = useMemo(() => [...(byModel ?? [])].sort((a, b) => b.costUsd - a.costUsd).slice(0, 6), [byModel]);
  const max = Math.max(...rows.map((r) => r.costUsd), 0.000001);

  return (
    <Panel title="Spend by model" icon={<Cpu size={14} />}
      actions={<>
        <Badge color={llmMode?.live ? '#c084fc' : '#8d93a8'} dot>{llmMode?.live ? 'live gateway' : 'local'}</Badge>
        <ToolChip id="flatkey" />
      </>}>
      {rows.length === 0 ? (
        <Empty icon={<Cpu size={22} />} title="No model calls yet" body="Every LLM call is routed and metered through Flatkey." />
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.model}>
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="mono truncate text-fg/90">{r.model}</span>
                <span className="shrink-0 text-muted"><span className="mono">{r.calls.toLocaleString()}</span> calls · <b className="text-fg mono">{fmtUsd(r.costUsd)}</b></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }}
                  initial={{ width: 0 }} animate={{ width: `${Math.max(3, (r.costUsd / max) * 100)}%` }} transition={{ duration: 0.7 }} />
              </div>
            </div>
          ))}
          <div className="pt-1 flex items-center justify-between text-[11px] text-dim border-t border-line mt-1">
            <span className="pt-2">{llmMode?.provider ? `Provider: ${llmMode.provider}` : 'Model gateway'}</span>
            <span className="pt-2">Total <b className="text-fg mono">{fmtUsd(spend)}</b></span>
          </div>
        </div>
      )}
    </Panel>
  );
}
