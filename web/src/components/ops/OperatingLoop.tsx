import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { BookOpen, Crown, Database, Gavel, MessageSquare, Network, Pause, Play, type LucideIcon } from 'lucide-react';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { ToolChip } from '../ui';

// The Haven operating loop, drawn as a racetrack: a message enters top-left, flows right through triage and routing,
// fans out to specialists, comes back along the bottom through approval → enforcement → learning, and the learning
// feeds the next message. A glowing packet travels the loop continuously; the node it passes lights up.

const W = 1200, H = 400, TOP = 100, BOT = 300, LEFT = 140, RIGHT = 1060, R = 100;
const PATH = `M ${LEFT} ${TOP} L ${RIGHT} ${TOP} A ${R} ${R} 0 0 1 ${RIGHT} ${BOT} L ${LEFT} ${BOT} A ${R} ${R} 0 0 1 ${LEFT} ${TOP} Z`;
const DURATION = 16000;

interface LoopNode {
  id: string; x: number; y: number; title: string; sub: string; color: string; icon?: LucideIcon; agent?: string; founder?: boolean; tools: string[];
  caption: string; branches?: { agent: string; label: string; tools: string[] }[];
}

const NODES: LoopNode[] = [
  { id: 'msg', x: LEFT, y: TOP, title: 'New message', sub: 'any community, any channel', color: '#8d93a8', icon: MessageSquare, tools: [],
    caption: 'A member posts in a protected community. Every single message enters Haven in real time.' },
  { id: 'nova', x: 360, y: TOP, title: 'Nova triages', sub: 'risk score in < 1s', color: '#22d3ee', agent: 'nova', tools: ['rocketride', 'flatkey'],
    caption: 'Nova runs the RocketRide message-triage .pipe: PII redaction → signals → guardrails → Flatkey-routed classifier.' },
  { id: 'band', x: 580, y: TOP, title: 'BAND hand-off', sub: 'agent-to-agent bus', color: '#22d3ee', icon: Network, tools: ['band'],
    caption: 'The verdict travels as a typed BAND message — every delegation and report between employees is on the bus.' },
  { id: 'aria', x: 800, y: TOP, title: 'Aria routes', sub: 'act now or escalate', color: '#8b5cf6', agent: 'aria', tools: ['kylon', 'paritok'],
    caption: 'Aria, Chief of Staff, decides who owns it and whether policy allows acting alone or needs the founder.' },
  { id: 'spec', x: 1030, y: TOP, title: 'Specialists', sub: 'parallel investigation', color: '#f97316', tools: [],
    caption: 'Specialists work in parallel: Rex detonates links in a Celesto sandbox via AdaL, Mira cares for members via Masky + n8n, Juno judges policy with Prelint.',
    branches: [
      { agent: 'rex', label: 'Rex · forensics', tools: ['adal', 'celesto'] },
      { agent: 'mira', label: 'Mira · care', tools: ['masky', 'n8n'] },
      { agent: 'juno', label: 'Juno · policy', tools: ['prelint'] },
    ] },
  { id: 'founder', x: 1030, y: BOT, title: 'Founder approval', sub: 'one tap, with evidence', color: '#f59e0b', founder: true, icon: Crown, tools: [],
    caption: 'High-stakes calls land on the founder with the evidence pack attached. One tap approves the action.' },
  { id: 'n8n', x: 780, y: BOT, title: 'n8n enforcement', sub: 'ban · alert · audit log', color: '#ea4b71', icon: Gavel, tools: ['n8n'],
    caption: 'n8n workflows execute: enforcement log, moderator alerts on Slack/email, crisis paging for the on-call human.' },
  { id: 'learn', x: 530, y: BOT, title: 'Learning loop', sub: 'shared safety context', color: '#facc15', agent: 'iris', icon: Database, tools: ['promptql'],
    caption: 'Every outcome lands in PromptQL shared context — Iris answers founder questions over it and spots trends.' },
  { id: 'skills', x: 280, y: BOT, title: 'Skills & memory', sub: 'the team gets smarter', color: '#34d399', agent: 'juno', icon: BookOpen, tools: ['finch', 'paritok'],
    caption: 'Juno turns lessons into Finch skills for the whole team; Paritok compresses each agent’s memory so context stays sharp.' },
];

function nearestLength(path: SVGPathElement, x: number, y: number) {
  const len = path.getTotalLength();
  let best = 0, bd = Infinity;
  for (let l = 0; l <= len; l += 4) {
    const p = path.getPointAtLength(l);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

export function OperatingLoop() {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const trailRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const state = useRef({ t0: performance.now(), pausedP: 0, playing: true, nodeL: [] as number[], len: 1 });

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const s = state.current;
    s.len = path.getTotalLength();
    s.nodeL = NODES.map((n) => nearestLength(path, n.x, n.y));
    let raf = 0;
    let lastActive = -1;
    const place = (el: SVGCircleElement | null, l: number) => {
      if (!el) return;
      const p = path.getPointAtLength(((l % s.len) + s.len) % s.len);
      el.setAttribute('cx', String(p.x)); el.setAttribute('cy', String(p.y));
    };
    const tick = (t: number) => {
      const p = s.playing ? (((t - s.t0) / DURATION) % 1 + 1) % 1 : s.pausedP;
      const l = p * s.len;
      place(dotRef.current, l); place(haloRef.current, l);
      trailRefs.current.forEach((el, i) => place(el, l - (i + 1) * 14));
      // active = last node the packet has reached
      let idx = 0;
      for (let i = 0; i < s.nodeL.length; i++) if (l + 20 >= s.nodeL[i]) idx = i;
      if (idx !== lastActive) { lastActive = idx; setActive(idx); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = () => {
    const s = state.current;
    const now = performance.now();
    if (s.playing) { s.pausedP = (((now - s.t0) / DURATION) % 1 + 1) % 1; s.playing = false; setPlaying(false); }
    else { s.t0 = now - s.pausedP * DURATION; s.playing = true; setPlaying(true); }
  };
  const jump = (i: number) => {
    const s = state.current;
    const p = (s.nodeL[i] ?? 0) / s.len;
    if (s.playing) s.t0 = performance.now() - p * DURATION; else s.pausedP = p;
  };

  const node = NODES[active];
  const trail = useMemo(() => [0.55, 0.38, 0.24, 0.14, 0.07], []);

  return (
    <div className="panel relative overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase text-fg/90">
          <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" /> Operating loop
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="hidden md:inline">one message, end to end — click any step</span>
          <button onClick={toggle} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:bg-white/[0.06] hover:text-fg cursor-pointer">
            {playing ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Play</>}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto scroll-thin">
        <div className="relative min-w-[980px]" style={{ aspectRatio: `${W} / ${H}` }}>
          <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" aria-hidden>
            <defs>
              <linearGradient id="loop-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" /><stop offset="50%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#f472b6" />
              </linearGradient>
              <radialGradient id="loop-halo">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" /><stop offset="35%" stopColor="#a78bfa" stopOpacity="0.55" /><stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path d={PATH} fill="none" stroke="url(#loop-grad)" strokeOpacity={0.18} strokeWidth={14} strokeLinejoin="round" />
            <path ref={pathRef} d={PATH} fill="none" stroke="url(#loop-grad)" strokeOpacity={0.55} strokeWidth={1.6} />
            <path d={PATH} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.6} strokeDasharray="2 14" strokeLinecap="round">
              <animate attributeName="stroke-dashoffset" from="0" to="-32" dur="1.2s" repeatCount="indefinite" />
            </path>
            <text x={1190} y={200} fill="#5d6379" fontSize="11" textAnchor="middle" transform="rotate(90 1190 200)" letterSpacing="3">ESCALATE</text>
            <text x={12} y={200} fill="#5d6379" fontSize="11" textAnchor="middle" transform="rotate(-90 12 200)" letterSpacing="3">LEARN · REPEAT</text>
            {trail.map((o, i) => <circle key={i} ref={(el) => { trailRefs.current[i] = el; }} r={5 - i * 0.6} fill="#c4b5fd" opacity={o} />)}
            <circle ref={haloRef} r={26} fill="url(#loop-halo)" />
            <circle ref={dotRef} r={6} fill="#ffffff" />
          </svg>

          {NODES.map((n, i) => {
            const on = i === active;
            const Icon = n.icon;
            return (
              <motion.button key={n.id} onClick={() => jump(i)}
                className={clsx('absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-2xl border backdrop-blur-xl px-3 py-2.5 cursor-pointer',
                  n.branches ? 'w-[212px]' : 'w-[180px]')}
                style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%`, background: 'rgba(14,17,26,0.88)' }}
                animate={{
                  borderColor: on ? `${n.color}cc` : 'rgba(255,255,255,0.09)',
                  boxShadow: on ? `0 0 0 1px ${n.color}66, 0 0 36px -4px ${n.color}88` : '0 14px 30px -20px rgba(0,0,0,0.9)',
                  scale: on ? 1.05 : 1,
                }}
                transition={{ duration: 0.35 }}>
                <span className="absolute -top-2 -left-2 w-[18px] h-[18px] rounded-full grid place-items-center mono text-[9.5px] font-semibold border"
                  style={{ background: on ? n.color : '#0e111a', color: on ? '#05060a' : '#8d93a8', borderColor: on ? n.color : 'rgba(255,255,255,0.14)' }}>{i + 1}</span>
                <div className="flex items-center gap-2">
                  {n.founder ? <FounderAvatar size={26} /> : n.agent ? <AgentAvatar id={n.agent} size={26} showStatus={false} /> : Icon ? (
                    <span className="w-[26px] h-[26px] rounded-lg grid place-items-center" style={{ background: `${n.color}22`, color: n.color }}><Icon size={14} /></span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold leading-tight truncate">{n.title}</div>
                    <div className="text-[10.5px] text-muted truncate">{n.sub}</div>
                  </div>
                </div>
                {n.branches ? (
                  <div className="mt-2 space-y-1.5">
                    {n.branches.map((b) => (
                      <div key={b.agent} className="flex items-center gap-1.5">
                        <AgentAvatar id={b.agent} size={18} showStatus={false} />
                        <span className="text-[10.5px] text-fg/80 truncate flex-1">{b.label}</span>
                        <span className="flex gap-0.5">{b.tools.map((t) => <ToolChip key={t} id={t} className="!text-[9px] !px-1" />)}</span>
                      </div>
                    ))}
                  </div>
                ) : n.tools.length > 0 && (
                  <div className="mt-1.5 flex gap-1 flex-wrap">{n.tools.map((t) => <ToolChip key={t} id={t} className="!text-[9.5px]" />)}</div>
                )}
              </motion.button>
            );
          })}

          {/* center caption */}
          <div className="absolute left-[18%] right-[18%] top-1/2 -translate-y-1/2 text-center pointer-events-none">
            <AnimatePresence mode="wait">
              <motion.div key={node.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                <div className="text-[10.5px] uppercase tracking-[0.2em] mb-1.5" style={{ color: node.color }}>Step {active + 1} / {NODES.length} · {node.title}</div>
                <div className="text-[13.5px] text-fg/85 leading-relaxed max-w-[560px] mx-auto">{node.caption}</div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
