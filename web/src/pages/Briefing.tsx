import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowRight, AudioLines, BadgeCheck, Check, ChevronDown, Clock, DollarSign, Gauge, Headphones, Play, RefreshCw, ShieldCheck, Square, Timer,
  TrendingUp, Users, Volume2, VolumeX,
} from 'lucide-react';
import { api } from '../lib/api';
import { useHaven } from '../lib/store';
import { speak, stopSpeaking } from '../lib/voice';
import type { Metrics } from '../lib/types';
import { AgentAvatar, useSpeaking } from '../components/Avatar';
import { Badge, Button, Counter, Empty, KindBadge, Panel, SeverityBadge, Spinner, Stat, TimeAgo, ToolChip, fmtMs, fmtUsd } from '../components/ui';
import {
  CompareTile, HUMAN_COST_PER_INCIDENT, HUMAN_SLA_MS, KindDonut, MarketCard, OrgCard, SpendByModel, ThreatsOverTime, UnitEconomics, useMonthlyAiCost,
} from '../components/ops/InvestorCharts';
import { SectionHeading, fmtCompactUsd } from '../components/ops/shared';

interface BriefingData { text: string; bullets: string[]; generatedAt: number; model: string }

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Waveform({ active, color }: { active: boolean; color: string }) {
  return (
    <div className="flex items-end gap-[3px] h-6">
      {Array.from({ length: 14 }, (_, i) => (
        <motion.span key={i} className="w-[3px] rounded-full" style={{ background: color }}
          animate={active ? { height: [4, 8 + ((i * 7) % 16), 5, 12 + ((i * 5) % 10), 4] } : { height: 3 }}
          transition={active ? { duration: 0.9 + (i % 4) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.04 } : { duration: 0.3 }} />
      ))}
    </div>
  );
}

export default function Briefing() {
  const founder = useHaven((s) => s.founder);
  const aria = useHaven((s) => s.workforce.find((w) => w.id === 'aria'));
  const storeMetrics = useHaven((s) => s.metrics);
  const incidents = useHaven((s) => s.incidents);
  const voiceOn = useHaven((s) => s.voiceOn);
  const setVoice = useHaven((s) => s.setVoice);
  const llmMode = useHaven((s) => s.llmMode);
  const voiceSpeaking = useSpeaking('aria');
  const captioned = useHaven((s) => s.captions.some((c) => c.agentId === 'aria'));
  const speaking = voiceSpeaking || captioned;
  const [b, setB] = useState<BriefingData | null>(null);
  const [fetchedMetrics, setFetchedMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [memoOpen, setMemoOpen] = useState(true);
  const investorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [br, mt] = await Promise.all([api.get<BriefingData>('/api/briefing'), api.get<Metrics>('/api/metrics').catch(() => null)]);
      setB(br); if (mt) setFetchedMetrics(mt); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const m = storeMetrics ?? fetchedMetrics;
  const { monthly: aiMonthly } = useMonthlyAiCost(m);
  const decisions = useMemo(() => incidents.filter((i) => i.status === 'awaiting_approval').slice(0, 5), [incidents]);

  const play = async () => {
    setBusy(true); setErr(null);
    try { setB(await api.post<BriefingData>('/api/briefing')); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const listen = () => { if (b) { stopSpeaking(); speak(b.text, aria); } };
  const local = !llmMode?.live || /offline|local/i.test(b?.model ?? '');

  const cost = m?.costPerIncidentUsd ?? 0;
  const costRatio = cost > 0 ? HUMAN_COST_PER_INCIDENT / cost : null;
  const tta = m?.medianTimeToActionMs ?? 0;
  const ttaRatio = tta > 0 ? HUMAN_SLA_MS / tta : null;
  const platforms = useHaven((s) => [...new Set(s.communities.map((c) => c.platform))].join(' · '));

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* ------------------------------------------------------------------ hero */}
      <section className="panel relative overflow-hidden p-6 md:p-8">
        <div className="absolute inset-0 grid-bg opacity-70 pointer-events-none" />
        <div className="absolute -top-32 -left-24 w-[460px] h-[460px] rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: aria?.color ?? '#8b5cf6' }} />
        <div className="absolute -bottom-40 right-0 w-[420px] h-[420px] rounded-full blur-3xl opacity-15 pointer-events-none bg-brand-cyan" />

        <div className="relative flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
          <div className="relative w-[128px] h-[128px] shrink-0 grid place-items-center">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="absolute inset-0 rounded-full border" style={{ borderColor: `${aria?.color ?? '#8b5cf6'}55` }}
                animate={speaking || busy ? { scale: [1, 1.35 + i * 0.15], opacity: [0.7, 0] } : { scale: 1, opacity: 0 }}
                transition={speaking || busy ? { duration: 1.8, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' } : { duration: 0.3 }} />
            ))}
            <motion.div animate={speaking ? { scale: [1, 1.04, 1] } : { scale: 1 }} transition={{ duration: 0.6, repeat: speaking ? Infinity : 0 }}>
              <AgentAvatar id="aria" size={112} />
            </motion.div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted flex items-center gap-2 flex-wrap">
              Founder briefing · from Aria, Chief of Staff
              <ToolChip id="flatkey" /><ToolChip id="masky" /><ToolChip id="promptql" />
            </div>
            <h1 className="mt-2 text-[34px] md:text-[40px] font-semibold tracking-tight leading-[1.1]">
              {greeting()}, <span className="text-gradient">{founder?.name ?? 'founder'}</span>
            </h1>
            <p className="mt-2 text-sm text-muted max-w-2xl">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · Your 8 AI employees worked the night shift.
              {b && <> Briefing written <TimeAgo ts={b.generatedAt} /> by <span className="mono text-fg/80">{b.model}</span>{local && <Badge color="#8d93a8" className="ml-1.5">local brain</Badge>}</>}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button variant="primary" size="lg" onClick={play} disabled={busy} icon={busy ? <Spinner /> : <Play size={16} />}>
                {busy ? 'Aria is preparing…' : 'Play briefing'}
              </Button>
              {speaking ? (
                <Button size="lg" onClick={stopSpeaking} icon={<Square size={14} />}>Stop</Button>
              ) : (
                <Button size="lg" onClick={listen} disabled={!b} icon={<Headphones size={15} />}>Listen again</Button>
              )}
              <div className="flex items-center gap-3 ml-1">
                <Waveform active={speaking} color={aria?.color ?? '#8b5cf6'} />
                <span className="text-xs text-muted">{speaking ? 'Aria is speaking…' : busy ? 'regenerating from live data' : 'idle'}</span>
              </div>
              {!voiceOn && (
                <button onClick={() => setVoice(true)} className="inline-flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 cursor-pointer ml-1">
                  <VolumeX size={13} /> Voices muted — unmute so Aria can speak
                </button>
              )}
              {voiceOn && <span className="inline-flex items-center gap-1 text-[11px] text-dim"><Volume2 size={12} /> voice via Masky (browser fallback when no key)</span>}
            </div>
          </div>
        </div>
      </section>

      {err && <div className="mt-4 text-sm rounded-xl border border-danger/40 bg-danger/10 text-rose-200 px-4 py-2.5 flex items-center justify-between">{err}<Button size="sm" onClick={load} icon={<RefreshCw size={12} />}>Retry</Button></div>}

      {/* ------------------------------------------------------------------ briefing body */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" title="Today's briefing" icon={<BadgeCheck size={13} />}
          actions={<button onClick={() => investorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer">Investor mode <ArrowRight size={11} /></button>}>
          {loading && !b ? (
            <div className="space-y-2.5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded-xl shimmer" />)}</div>
          ) : !b ? (
            <Empty title="No briefing yet" action={<Button size="sm" variant="primary" onClick={play} icon={<Play size={12} />}>Generate</Button>} />
          ) : (
            <>
              <ul key={b.generatedAt} className="space-y-2">
                  {b.bullets.map((t, i) => (
                    <motion.li key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.22, type: 'spring', stiffness: 260, damping: 26 }}
                      className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5">
                      <motion.span initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.3 + i * 0.22, type: 'spring', stiffness: 400, damping: 18 }}
                        className="mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0 bg-ok/15 text-ok border border-ok/40">
                        <Check size={12} strokeWidth={3} />
                      </motion.span>
                      <span className="text-[13.5px] leading-relaxed text-fg/90">{t}</span>
                    </motion.li>
                  ))}
              </ul>
              <button onClick={() => setMemoOpen((o) => !o)} className="mt-4 text-[11px] uppercase tracking-wider text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer">
                <ChevronDown size={12} className={memoOpen ? 'rotate-180 transition-transform' : 'transition-transform'} /> Full memo
              </button>
              <AnimatePresence initial={false}>
                {memoOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="prose-haven text-sm text-fg/85 mt-2 rounded-xl border border-line bg-black/20 p-4">
                      <ReactMarkdown>{b.text}</ReactMarkdown>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-dim not-prose">— Aria <AudioLines size={11} /></div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </Panel>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <Panel title="Needs your decision" icon={<ShieldCheck size={13} />} pad={false} actions={<Badge color={decisions.length ? '#f59e0b' : '#10b981'} dot>{decisions.length}</Badge>}>
            {decisions.length === 0 ? (
              <Empty icon={<BadgeCheck size={20} />} title="Inbox zero" body="Nothing is waiting on you — the workforce handled everything within policy." />
            ) : (
              <ul>
                <AnimatePresence initial={false}>
                  {decisions.map((i) => (
                    <motion.li key={i.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <Link to={`/incidents/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 border-t border-line first:border-t-0 hover:bg-white/[0.03] group">
                        {i.assignedTo ? <AgentAvatar id={i.assignedTo} size={28} /> : <span className="w-7 h-7 rounded-full bg-white/10" />}
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate">{i.title}</div>
                          <div className="flex items-center gap-1.5 mt-0.5"><KindBadge k={i.kind} /><SeverityBadge s={i.severity} /></div>
                        </div>
                        <ArrowRight size={14} className="text-dim group-hover:text-fg group-hover:translate-x-0.5 transition-transform" />
                      </Link>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Panel>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Screened" value={<Counter value={m?.screened ?? 0} />} icon={<ShieldCheck size={12} />} accent="#22d3ee" sub="messages, every one" />
            <Stat label="Threats stopped" value={<Counter value={m?.threatsBlocked ?? 0} />} icon={<Gauge size={12} />} accent="#f43f5e" sub={`${m?.incidentsResolved ?? 0} incidents resolved`} />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ investor mode */}
      <div ref={investorRef} className="scroll-mt-20">
        <SectionHeading eyebrow={<span className="inline-flex items-center gap-2"><TrendingUp size={12} /> Investor mode</span>} title="The business"
          right={<Badge color="#10b981" dot>live from production data</Badge>} />
      </div>

      {!m ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-[132px] shimmer" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Communities" icon={<ShieldCheck size={12} />} accent="#8b5cf6" value={<Counter value={m.communities} />} sub={platforms || 'protected'} />
            <Stat label="Members protected" icon={<Users size={12} />} accent="#22d3ee" value={<Counter value={m.members} />} sub="across all tenants" />
            <Stat label="MRR" icon={<DollarSign size={12} />} accent="#10b981" value={<Counter value={m.mrr} format={(n) => `$${Math.round(n).toLocaleString()}`} />} sub={`${fmtCompactUsd(m.mrr * 12)} ARR run-rate`} />
            <Stat label="Human hours saved" icon={<Clock size={12} />} accent="#facc15" value={<Counter value={m.humanHoursSaved} />} sub="of moderator review" />
            <CompareTile label="Cost / incident" icon={<DollarSign size={12} />} accent="#34d399" aiValue={fmtUsd(cost)} aiLabel="Haven" humanLabel="$4.20"
              ratio={costRatio} ratioWord="cheaper" aiShare={cost / HUMAN_COST_PER_INCIDENT} />
            <CompareTile label="Median time to action" icon={<Timer size={12} />} accent="#22d3ee" aiValue={fmtMs(tta)} aiLabel="Haven" humanLabel="4h SLA"
              ratio={ttaRatio} ratioWord="faster" aiShare={tta / HUMAN_SLA_MS} />
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <KindDonut m={m} />
            <SpendByModel m={m} />
            <ThreatsOverTime m={m} />
          </div>

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
            <div className="xl:col-span-3"><UnitEconomics m={m} aiMonthly={aiMonthly} /></div>
            <div className="xl:col-span-2 flex flex-col gap-4">
              <MarketCard />
              <OrgCard aiMonthly={aiMonthly} />
            </div>
          </div>
        </>
      )}
      <div className="h-6" />
    </div>
  );
}
