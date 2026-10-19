import { type ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  LayoutDashboard, MessagesSquare, ShieldAlert, Users, Bug, Sparkles, Workflow, Presentation, Boxes, Volume2, VolumeX, Zap,
  ChevronDown, Fish, HeartCrack, Swords, Megaphone, Waves, Link2, Radio, Play, Pause,
} from 'lucide-react';
import { useHaven } from '../lib/store';
import { api, IS_REPLAY } from '../lib/api';
import { AgentAvatar } from './Avatar';
import { Badge } from './ui';

const NAV = [
  { to: '/', label: 'Mission Control', icon: LayoutDashboard, end: true },
  { to: '/community', label: 'Community', icon: MessagesSquare },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert, badge: 'incidents' },
  { to: '/workforce', label: 'AI Workforce', icon: Users },
  { to: '/security', label: 'Bot Audits', icon: Bug },
  { to: '/ask', label: 'Ask Haven', icon: Sparkles },
  { to: '/automations', label: 'Pipelines & Flows', icon: Workflow },
  { to: '/briefing', label: 'Founder Briefing', icon: Presentation },
  { to: '/stack', label: 'Sponsor Stack', icon: Boxes },
];

export const SCENARIOS = [
  { id: 'phishing', label: 'Phishing link', desc: 'Fake "free Premium" credential harvester', icon: Fish, color: '#f97316' },
  { id: 'crisis', label: 'Member in crisis', desc: 'Self-harm signal in #vent', icon: HeartCrack, color: '#f472b6' },
  { id: 'harassment', label: 'Targeted harassment', desc: 'Repeated abuse aimed at a member', icon: Swords, color: '#f43f5e' },
  { id: 'scam', label: 'Crypto scam', desc: '"Send 0.1 ETH, get 1 back" DM bait', icon: Link2, color: '#fb923c' },
  { id: 'spam', label: 'Spam burst', desc: 'Promo flood from a new account', icon: Megaphone, color: '#a3a3a3' },
  { id: 'raid', label: 'Raid wave', desc: 'Coordinated brigading attempt', icon: Waves, color: '#eab308' },
] as const;

export function ThreatLab({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const fire = async (id: string) => {
    setOpen(false);
    await api.post('/api/sim/inject', { scenario: id });
    if (location.pathname.startsWith('/briefing') || location.pathname.startsWith('/stack')) nav('/');
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={clsx('inline-flex items-center gap-2 rounded-xl font-semibold text-sm text-white cursor-pointer transition-all hover:brightness-110',
          'bg-gradient-to-r from-rose-500 to-orange-500 shadow-[0_8px_28px_-10px_rgba(244,63,94,0.9)]', compact ? 'px-3 py-1.5' : 'px-4 py-2')}>
        <Zap size={15} /> Threat Lab <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
              className="absolute right-0 mt-2 w-80 z-50 panel p-2 bg-ink-850/95">
              <div className="px-2.5 pt-1.5 pb-2 text-[11px] uppercase tracking-wider text-muted">Inject a live threat into the community</div>
              {SCENARIOS.map((s) => (
                <button key={s.id} onClick={() => fire(s.id)} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.06] text-left cursor-pointer">
                  <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: `${s.color}22`, color: s.color }}><s.icon size={16} /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-muted">{s.desc}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toasts() {
  const toasts = useHaven((s) => s.toasts);
  const dismiss = useHaven((s) => s.dismissToast);
  const color = { info: '#60a5fa', success: '#10b981', warn: '#f59e0b', error: '#f43f5e' } as const;
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px]">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
            onClick={() => dismiss(t.id)} className="panel bg-ink-850/95 p-3 flex gap-3 cursor-pointer" style={{ borderColor: `${color[t.level]}55` }}>
            {t.agentId ? <AgentAvatar id={t.agentId} size={32} showStatus={false} /> : <span className="w-2 rounded-full" style={{ background: color[t.level] }} />}
            <div className="min-w-0">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="text-xs text-muted mt-0.5 line-clamp-3">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Captions() {
  const captions = useHaven((s) => s.captions);
  const workforce = useHaven((s) => s.workforce);
  const c = captions[captions.length - 1];
  const emp = workforce.find((w) => w.id === c?.agentId);
  return (
    <AnimatePresence>
      {c && (
        <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[55] panel bg-ink-850/95 px-4 py-3 flex items-center gap-3 max-w-2xl"
          style={{ borderColor: `${emp?.color ?? '#8b5cf6'}66` }}>
          <AgentAvatar id={c.agentId} size={38} />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: emp?.color }}>{emp?.name} · speaking via Masky</div>
            <div className="text-sm line-clamp-2">{c.text}</div>
          </div>
          <Volume2 size={16} className="text-muted animate-pulse shrink-0" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const connected = useHaven((s) => s.connected);
  const incidents = useHaven((s) => s.incidents);
  const voiceOn = useHaven((s) => s.voiceOn);
  const setVoice = useHaven((s) => s.setVoice);
  const llmMode = useHaven((s) => s.llmMode);
  const sim = useHaven((s) => s.sim);
  const awaiting = incidents.filter((i) => i.status === 'awaiting_approval' || i.status === 'investigating' || i.status === 'open').length;

  return (
    <div className="haven-bg min-h-full flex">
      <aside className="w-[232px] shrink-0 border-r border-line bg-ink-950/60 backdrop-blur-xl sticky top-0 h-screen flex flex-col">
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} className="w-8 h-8" alt="" />
          <div>
            <div className="font-semibold tracking-tight text-[17px] leading-none">Haven</div>
            <div className="text-[10.5px] text-muted mt-1 uppercase tracking-[0.14em]">Trust & Safety HQ</div>
          </div>
        </div>
        <nav className="px-3 flex flex-col gap-0.5 mt-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => clsx('relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-colors',
                isActive ? 'text-fg bg-white/[0.07]' : 'text-muted hover:text-fg hover:bg-white/[0.04]')}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full brand-gradient" />}
                  <n.icon size={16} />
                  <span className="flex-1">{n.label}</span>
                  {n.badge === 'incidents' && awaiting > 0 && <span className="text-[10px] mono rounded-full px-1.5 py-0.5 bg-danger/20 text-rose-300">{awaiting}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4 space-y-3">
          <div className="panel p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted">Realtime</span>
              <Badge color={connected ? '#10b981' : '#f43f5e'} dot>{connected ? (IS_REPLAY ? 'replay' : 'live') : 'offline'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Models</span>
              <Badge color={llmMode?.live ? '#c084fc' : '#8d93a8'}>{llmMode?.live ? 'Flatkey live' : 'offline brain'}</Badge>
            </div>
            <button onClick={() => api.post('/api/sim/toggle', { running: !sim.running })} className="w-full flex items-center justify-between cursor-pointer group">
              <span className="text-muted group-hover:text-fg">Community traffic</span>
              <span className="inline-flex items-center gap-1 text-fg/80">{sim.running ? <><Pause size={12} /> running</> : <><Play size={12} /> paused</>}</span>
            </button>
          </div>
          <div className="text-[10.5px] text-dim leading-relaxed">8 AI employees · 1 human founder · 14 sponsor tools</div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 border-b border-line bg-ink-950/70 backdrop-blur-xl flex items-center gap-3 px-6">
          <Radio size={14} className={clsx(connected ? 'text-ok animate-pulse' : 'text-danger')} />
          <span className="text-xs text-muted">Protecting <b className="text-fg">{useHaven((s) => s.communities.length)}</b> communities · <b className="text-fg">{useHaven((s) => s.communities.reduce((a, c) => a + c.members, 0)).toLocaleString()}</b> members</span>
          <div className="flex -space-x-2 ml-3">
            {useHaven((s) => s.workforce).map((w) => <AgentAvatar key={w.id} id={w.id} size={26} showStatus={false} className="ring-2 ring-ink-950 rounded-full" />)}
          </div>
          <div className="flex-1" />
          <button onClick={() => setVoice(!voiceOn)} title="Toggle employee voices" className="p-2 rounded-lg hover:bg-white/[0.06] text-muted hover:text-fg cursor-pointer">
            {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <ThreatLab compact />
        </header>
        {IS_REPLAY && (
          <div className="bg-brand-violet/15 border-b border-brand-violet/30 text-xs text-center py-1.5 text-violet-200">
            Interactive replay of real Haven runs · clone the repo and run <span className="mono">npm run demo</span> for the live AI workforce
          </div>
        )}
        <main className="flex-1 min-w-0 p-6">{children}</main>
      </div>
      <Toasts />
      <Captions />
    </div>
  );
}
