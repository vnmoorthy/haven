import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cpu, MessageCircle, Minimize2, Presentation, ScanLine, ShieldCheck, Timer, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../lib/store';
import { Button, Counter, PageHeader, ToolChip, fmtMs, fmtUsd } from '../components/ui';
import { KpiCard } from '../components/mission/KpiCard';
import { Constellation } from '../components/mission/Constellation';
import { BandWire } from '../components/mission/BandWire';
import { LiveIncidents } from '../components/mission/LiveIncidents';
import { SpendByModel, TrafficChart } from '../components/mission/Charts';
import { NowRunning } from '../components/mission/NowRunning';

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString());

const rise = (i: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] as const } });

function Kpi({ i, children, onClick, className }: { i: number; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <motion.div {...rise(i)} className={clsx('min-w-0', className)}>
      {onClick ? <button type="button" onClick={onClick} className="block w-full h-full text-left cursor-pointer group">{children}</button> : children}
    </motion.div>
  );
}

export default function MissionControl() {
  const nav = useNavigate();
  const m = useHaven((s) => s.metrics);
  const workforceCount = useHaven((s) => s.workforce.length);
  const communities = useHaven((s) => s.communities);
  const founder = useHaven((s) => s.founder);
  const llmLive = useHaven((s) => s.llmMode?.live ?? false);
  const members = communities.reduce((a, c) => a + c.members, 0);
  const awaiting = m?.awaitingApproval ?? 0;

  return (
    <div className="max-w-[1800px] mx-auto">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-ok animate-ping" /><span className="relative w-1.5 h-1.5 rounded-full bg-ok" /></span>
            Haven HQ · live
          </span>
        }
        title={<span className="text-gradient">Your AI Trust &amp; Safety team is on shift</span>}
        subtitle={<>
          {workforceCount} AI employees screen every message, detonate every suspicious link and care for every member across{' '}
          <b className="text-fg">{communities.length}</b> communities and <b className="text-fg">{members.toLocaleString()}</b> people — and only escalate to {founder?.name ? <b className="text-fg">{founder.name}</b> : 'you'} when it truly matters.
        </>}
        actions={<>
          <Button icon={<MessageCircle size={15} />} onClick={() => nav('/workforce/aria')}>Talk to Aria</Button>
          <Button variant="primary" icon={<Presentation size={15} />} onClick={() => nav('/briefing')}>Run daily briefing</Button>
        </>}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:max-[1859px]:grid-cols-3 min-[1860px]:grid-cols-6 gap-3 mb-4">
        <Kpi i={0}>
          <KpiCard label="Messages screened" accent="#22d3ee" icon={<ScanLine size={18} />}
            value={<Counter value={m?.screened ?? 0} />}
            sub={<>by Nova <ToolChip id="rocketride" /></>} />
        </Kpi>
        <Kpi i={1}>
          <KpiCard label="Threats blocked" accent="#f43f5e" icon={<ShieldCheck size={18} />}
            value={<Counter value={m?.threatsBlocked ?? 0} />}
            sub={<>{(m?.incidentsResolved ?? 0).toLocaleString()} resolved · {(m?.incidentsOpen ?? 0).toLocaleString()} open</>} />
        </Kpi>
        <Kpi i={2}>
          <KpiCard label="Median time-to-action" accent="#10b981" icon={<Timer size={18} />}
            value={<Counter value={m?.medianTimeToActionMs ?? 0} format={(n) => (m?.medianTimeToActionMs ? fmtMs(n) : '—')} />}
            sub="detect → act, end to end" />
        </Kpi>
        <Kpi i={3} onClick={() => nav('/incidents')}>
          <KpiCard label="Awaiting your approval" accent="#f59e0b" icon={<UserCheck size={18} />} highlight={awaiting > 0}
            className="panel-hover"
            value={<span className={awaiting > 0 ? 'text-warn' : undefined}><Counter value={awaiting} /></span>}
            sub={<span className="inline-flex items-center gap-1 group-hover:text-fg transition-colors">{awaiting > 0 ? 'Review now' : 'Nothing needs you'} <ArrowRight size={11} /></span>} />
        </Kpi>
        <Kpi i={4}>
          <KpiCard label="LLM spend today" accent="#c084fc" icon={<Cpu size={18} />}
            value={<span title={`${(m?.llmCalls ?? 0).toLocaleString()} model calls`}><Counter value={m?.llmSpendUsd ?? 0} format={fmtUsd} /></span>}
            sub={<>via <ToolChip id="flatkey" /> · {(m?.llmCalls ?? 0).toLocaleString()} calls{llmLive ? '' : ' · local'}</>} />
        </Kpi>
        <Kpi i={5}>
          <KpiCard label="Tokens saved" accent="#34d399" icon={<Minimize2 size={18} />}
            value={<Counter value={m?.tokensSaved ?? 0} format={compact} />}
            sub={<>context compression <ToolChip id="paritok" /></>} />
        </Kpi>
      </div>

      {/* Hero: constellation + BAND wire */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px] gap-4 mb-4">
        <motion.div {...rise(3)} className="min-w-0 flex flex-col gap-3">
          <Constellation />
          <NowRunning />
        </motion.div>
        <motion.div {...rise(4)} className="relative min-h-[460px]">
          <BandWire className="absolute inset-0" />
        </motion.div>
      </div>

      {/* Incidents + analytics */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-4">
        <motion.div {...rise(5)} className="min-w-0">
          <LiveIncidents />
        </motion.div>
        <motion.div {...rise(6)} className="min-w-0 flex flex-col gap-4">
          <TrafficChart />
          <SpendByModel />
        </motion.div>
      </div>
    </div>
  );
}
