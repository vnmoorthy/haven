import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Network } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { BandMessage, Employee } from '../../lib/types';
import { avatarUri, useSpeaking } from '../Avatar';
import { ToolChip } from '../ui';
import { BAND_KIND_COLOR, FOUNDER_COLOR, SYSTEM_META, participantColor } from './participants';

// Live constellation of the Haven org: founder → Aria → specialists, plus system participants.
// Every BAND message becomes a glowing particle that flies from sender to receiver.

const W = 860;
const H = 540;
const HUB = { x: 430, y: 260 };
const FLIGHT_S = 1.25;

type Pt = { x: number; y: number };
interface NodeDef { id: string; kind: 'founder' | 'agent' | 'system'; x: number; y: number; r: number; color: string; emp?: Employee }
interface Flight { id: string; d: string; xs: number[]; ys: number[]; color: string }
interface Hit { id: string; node: string; color: string }
interface Chip { id: string; node: string; text: string; color: string; kind: BandMessage['kind'] }

const SHORT_TITLE: Record<string, string> = {
  aria: 'Chief of Staff', nova: 'T&S Triage', rex: 'Threat Intel', mira: 'Wellbeing Lead', kai: 'Security Eng',
  iris: 'Data Analyst', juno: 'Policy & Product', leo: 'Growth & CS',
};
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function layout(workforce: Employee[]): Record<string, NodeDef> {
  const nodes: Record<string, NodeDef> = {};
  nodes.founder = { id: 'founder', kind: 'founder', x: 430, y: 60, r: 27, color: FOUNDER_COLOR };
  const leads = workforce.filter((w) => w.reportsTo === 'founder');
  const rest = workforce.filter((w) => w.reportsTo !== 'founder');
  leads.forEach((w, i) => {
    const x = leads.length === 1 ? 430 : 330 + (200 * i) / (leads.length - 1);
    nodes[w.id] = { id: w.id, kind: 'agent', x, y: 184, r: 34, color: w.color, emp: w };
  });
  const n = rest.length;
  rest.forEach((w, i) => {
    const deg = n === 1 ? 90 : 166 - (i * 152) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    nodes[w.id] = { id: w.id, kind: 'agent', x: 430 + 345 * Math.cos(rad), y: 194 + 246 * Math.sin(rad), r: 28, color: w.color, emp: w };
  });
  for (const [id, x, y] of [['gateway', 72, 74], ['rocketride', 70, 478], ['n8n', 790, 478]] as const) {
    nodes[id] = { id, kind: 'system', x, y, r: 22, color: SYSTEM_META[id].color };
  }
  return nodes;
}

const cubic = (a: Pt, b: Pt) => {
  const my = (a.y + b.y) / 2;
  return { d: `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`, p1: { x: a.x, y: my }, p2: { x: b.x, y: my } };
};

function flightPath(a: Pt, b: Pt, onTree: boolean) {
  const xs: number[] = [], ys: number[] = [];
  const N = 18;
  if (onTree) {
    const { d, p1, p2 } = cubic(a, b);
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      xs.push(u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x);
      ys.push(u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y);
    }
    return { d, xs, ys };
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = { x: mid.x + (HUB.x - mid.x) * 0.5, y: mid.y + (HUB.y - mid.y) * 0.5 };
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    xs.push(u * u * a.x + 2 * u * t * c.x + t * t * b.x);
    ys.push(u * u * a.y + 2 * u * t * c.y + t * t * b.y);
  }
  return { d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, xs, ys };
}

const SYSTEM_LINKS: [string, string][] = [['gateway', 'nova'], ['rocketride', 'nova'], ['n8n', 'leo'], ['n8n', 'mira']];

export function Constellation() {
  const workforce = useHaven((s) => s.workforce);
  const band = useHaven((s) => s.band);
  const agentStatus = useHaven((s) => s.agentStatus);
  const awaiting = useHaven((s) => s.metrics?.awaitingApproval ?? 0);
  const founderName = useHaven((s) => s.founder?.name ?? 'Founder');
  const nav = useNavigate();
  const nodes = useMemo(() => layout(workforce), [workforce]);

  const treeEdges = useMemo(() => workforce.map((w) => [w.reportsTo, w.id] as [string, string]).filter(([p]) => nodes[p]), [workforce, nodes]);
  const isTree = (a: string, b: string) => treeEdges.some(([p, c]) => (p === a && c === b) || (p === b && c === a));

  const [flights, setFlights] = useState<Flight[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  // Launch a particle for every BAND message that arrives after mount.
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(band.map((b) => b.id)); return; }
    const fresh = band.filter((b) => !seen.current!.has(b.id));
    if (!fresh.length) return;
    fresh.forEach((b) => seen.current!.add(b.id));
    fresh.slice(-6).forEach((msg, i) => later(() => launch(msg), i * 220));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band]);

  function launch(msg: BandMessage) {
    const from = nodes[msg.from];
    if (!from) return;
    const targets = msg.to === 'all' ? workforce.map((w) => w.id).filter((id) => id !== msg.from) : [msg.to];
    const color = participantColor(msg.from, workforce);
    const newFlights: Flight[] = [];
    for (const t of targets) {
      const to = nodes[t];
      if (!to || to.id === from.id) continue;
      const p = flightPath(from, to, isTree(from.id, to.id));
      const fid = `${msg.id}:${t}`;
      newFlights.push({ id: fid, color, ...p });
      later(() => {
        setFlights((fs) => fs.filter((f) => f.id !== fid));
        setHits((hs) => [...hs.slice(-10), { id: fid, node: t, color }]);
        later(() => setHits((hs) => hs.filter((h) => h.id !== fid)), 1000);
      }, FLIGHT_S * 1000);
    }
    if (!newFlights.length) return;
    setFlights((fs) => [...fs.slice(-24), ...newFlights]);
    const chipNode = msg.to === 'all' ? msg.from : msg.to;
    const cid = `chip:${msg.id}`;
    later(() => {
      setChips((cs) => [...cs.filter((c) => c.node !== chipNode).slice(-5), { id: cid, node: chipNode, text: msg.subject, color, kind: msg.kind }]);
      later(() => setChips((cs) => cs.filter((c) => c.id !== cid)), 2300);
    }, msg.to === 'all' ? 0 : FLIGHT_S * 850);
  }

  // Throughput ticker.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 4000); return () => clearInterval(t); }, []);
  const perMin = band.filter((b) => b.createdAt > now - 60000).length;
  const busyCount = workforce.filter((w) => (agentStatus[w.id]?.status ?? 'idle') !== 'idle').length;

  return (
    <div className="panel relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-70 pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(520px 320px at 50% 42%, rgb(139 92 246 / 0.14), transparent 70%)' }} />

      <div className="relative flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-fg/90">
            <Network size={14} className="text-muted" /> Live org chart
          </div>
          <div className="text-xs text-muted mt-0.5 truncate">Every glowing pulse is a real BAND message between your AI employees</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-2 py-1 text-[11px] text-muted">
            <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-brand-cyan animate-ping" /><span className="relative w-1.5 h-1.5 rounded-full bg-brand-cyan" /></span>
            <b className="text-fg mono tabular-nums">{perMin}</b> msg/min
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-2 py-1 text-[11px] text-muted">
            <b className="text-fg mono tabular-nums">{busyCount}</b>/{workforce.length} on task
          </span>
          <ToolChip id="kylon" />
          <ToolChip id="band" />
        </div>
      </div>

      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}`, maxHeight: 600 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full select-none">
          <defs>
            <filter id="mc-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="mc-founder" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
            <radialGradient id="mc-hub">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" /><stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </radialGradient>
            {Object.values(nodes).filter((n) => n.kind === 'agent').map((n) => (
              <clipPath key={n.id} id={`mc-clip-${n.id}`}><circle cx={n.x} cy={n.y} r={n.r} /></clipPath>
            ))}
          </defs>

          {/* orbit decoration */}
          <circle cx={HUB.x} cy={HUB.y - 70} r={130} fill="url(#mc-hub)" />
          <motion.ellipse cx={430} cy={194} rx={345} ry={246} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeDasharray="2 9"
            animate={{ strokeDashoffset: [0, -110] }} transition={{ duration: 14, repeat: Infinity, ease: 'linear' }} />
          <motion.circle cx={430} cy={184} r={78} fill="none" stroke="rgb(139 92 246 / 0.18)" strokeDasharray="3 7"
            animate={{ strokeDashoffset: [0, 100] }} transition={{ duration: 10, repeat: Infinity, ease: 'linear' }} />

          {/* system links */}
          {SYSTEM_LINKS.filter(([a, b]) => nodes[a] && nodes[b]).map(([a, b]) => {
            const p = flightPath(nodes[a], nodes[b], false);
            return <path key={`${a}-${b}`} d={p.d} fill="none" stroke={nodes[a].color} strokeOpacity={0.16} strokeWidth={1.2} strokeDasharray="3 6" />;
          })}

          {/* reporting lines */}
          {treeEdges.map(([p, c]) => {
            const { d } = cubic(nodes[p], nodes[c]);
            return (
              <g key={`${p}-${c}`}>
                <path d={d} fill="none" stroke={nodes[c].color} strokeOpacity={0.22} strokeWidth={1.6} />
                <motion.path d={d} fill="none" stroke={nodes[c].color} strokeOpacity={0.5} strokeWidth={1.6} strokeDasharray="2 14"
                  animate={{ strokeDashoffset: [0, -32] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }} />
              </g>
            );
          })}

          {/* particles */}
          {flights.map((f) => (
            <g key={f.id} filter="url(#mc-glow)">
              <motion.path d={f.d} fill="none" stroke={f.color} strokeWidth={2.2} strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0.9 }} animate={{ pathLength: 1, opacity: [0.9, 0.7, 0] }}
                transition={{ duration: FLIGHT_S + 0.25, ease: 'easeInOut' }} />
              {[0, 1, 2, 3].map((k) => (
                <motion.circle key={k} r={5.5 - k * 1.2} fill={k === 0 ? '#fff' : f.color} opacity={1 - k * 0.2}
                  initial={{ cx: f.xs[0], cy: f.ys[0] }} animate={{ cx: f.xs, cy: f.ys }}
                  transition={{ duration: FLIGHT_S, ease: 'easeInOut', delay: k * 0.05 }} />
              ))}
            </g>
          ))}

          {/* nodes */}
          {Object.values(nodes).map((n) => {
            if (n.kind === 'agent') {
              const st = agentStatus[n.id];
              return <AgentNode key={n.id} node={n} status={st?.status ?? 'idle'} task={st?.task ?? null} onClick={() => nav(`/workforce/${n.id}`)} />;
            }
            if (n.kind === 'founder') {
              return (
                <g key={n.id} className="cursor-pointer" onClick={() => nav('/incidents')}>
                  <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke="url(#mc-founder)" strokeOpacity={0.5} strokeWidth={1.5} />
                  <circle cx={n.x} cy={n.y} r={n.r} fill="url(#mc-founder)" />
                  <text x={n.x} y={n.y + 7} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fff">{founderName[0]}</text>
                  <text x={n.x + n.r + 12} y={n.y - 2} fontSize={14} fontWeight={600} fill="#e8eaf2">You · Founder</text>
                  <text x={n.x + n.r + 12} y={n.y + 14} fontSize={11} fill="#8d93a8">{founderName} · the only human</text>
                  {awaiting > 0 && (
                    <g>
                      <motion.circle cx={n.x + n.r * 0.75} cy={n.y - n.r * 0.75} r={11} fill="#f43f5e"
                        animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
                      <text x={n.x + n.r * 0.75} y={n.y - n.r * 0.75 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{awaiting}</text>
                      <text x={n.x - n.r - 12} y={n.y + 5} textAnchor="end" fontSize={11} fill="#fbbf24">{awaiting} awaiting your approval →</text>
                    </g>
                  )}
                </g>
              );
            }
            const meta = SYSTEM_META[n.id];
            const Icon = meta.icon;
            return (
              <g key={n.id} className="cursor-pointer" onClick={() => nav(n.id === 'gateway' ? '/community' : '/automations')}>
                <rect x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} rx={12} fill={`${n.color}1c`} stroke={n.color} strokeOpacity={0.55} />
                <Icon x={n.x - 10} y={n.y - 10} size={20} color={n.color} />
                <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#e8eaf2">{meta.label}</text>
                <text x={n.x} y={n.y + n.r + 30} textAnchor="middle" fontSize={10.5} fill="#8d93a8">{meta.sub}</text>
              </g>
            );
          })}

          {/* arrival pulses */}
          {hits.map((h) => {
            const n = nodes[h.node];
            if (!n) return null;
            return (
              <motion.circle key={h.id} cx={n.x} cy={n.y} fill="none" stroke={h.color} strokeWidth={2.5}
                initial={{ r: n.r, opacity: 0.95 }} animate={{ r: n.r + 26, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
            );
          })}

          {/* subject chips */}
          <AnimatePresence>
            {chips.map((c) => {
              const n = nodes[c.node];
              if (!n) return null;
              const cw = 220, chh = 30;
              const above = n.y - n.r - chh - 12 > 0;
              const x = above ? Math.min(W - cw - 4, Math.max(4, n.x - cw / 2)) : Math.min(W - cw - 4, n.x + n.r + 10);
              const y = above ? n.y - n.r - chh - 10 : n.y + n.r + 8;
              return (
                <motion.g key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                  <foreignObject x={x} y={y} width={cw} height={chh}>
                    <div className="w-full h-full flex justify-center items-center">
                      <div className="max-w-full inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium bg-ink-850/95 border shadow-lg"
                        style={{ borderColor: `${c.color}88`, boxShadow: `0 0 18px -4px ${c.color}` }}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BAND_KIND_COLOR[c.kind] }} />
                        <span className="truncate text-fg">{c.text}</span>
                      </div>
                    </div>
                  </foreignObject>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>
      </div>

      <div className="relative flex items-center gap-4 px-4 pb-3 -mt-2 text-[10.5px] text-muted">
        {[['#10b981', 'idle'], ['#a78bfa', 'thinking / working'], ['#f59e0b', 'waiting on you']].map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</span>
        ))}
        <span className="ml-auto text-dim">Click any employee to open their profile</span>
      </div>
    </div>
  );
}

function AgentNode({ node, status, task, onClick }: { node: NodeDef; status: string; task: string | null; onClick: () => void }) {
  const speaking = useSpeaking(node.id);
  const { x, y, r, color, emp } = node;
  const uri = useMemo(() => avatarUri(emp?.avatarSeed ?? node.id, 'agent', '#1c2135'), [emp?.avatarSeed, node.id]);
  const busy = status !== 'idle' || speaking;
  const waiting = status === 'waiting';
  const dot = speaking ? color : status === 'idle' ? '#10b981' : waiting ? '#f59e0b' : color;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <title>{`${emp?.name ?? node.id} — ${emp?.title ?? ''}${task ? `\n${task}` : ''}`}</title>
      {busy && (
        <motion.circle cx={x} cy={y} fill="none" stroke={waiting ? '#f59e0b' : color} strokeWidth={2.4}
          initial={{ r: r + 3, opacity: 0.9 }} animate={{ r: [r + 3, r + (speaking ? 9 : 12), r + 3], opacity: [0.95, 0.15, 0.95] }}
          transition={{ duration: speaking ? 0.6 : 1.6, repeat: Infinity, ease: 'easeInOut' }} />
      )}
      {busy && <circle cx={x} cy={y} r={r + 16} fill={color} opacity={0.08} />}
      <circle cx={x} cy={y} r={r + 2.5} fill="#0a0c13" stroke={color} strokeOpacity={busy ? 1 : 0.6} strokeWidth={busy ? 2.2 : 1.5} />
      <image href={uri} x={x - r} y={y - r} width={r * 2} height={r * 2} clipPath={`url(#mc-clip-${node.id})`} />
      <circle cx={x + r * 0.72} cy={y + r * 0.72} r={5.5} fill={dot} stroke="#0a0c13" strokeWidth={2.5} />
      <text x={x} y={y + r + 18} textAnchor="middle" fontSize={14.5} fontWeight={600} fill="#e8eaf2">{emp?.name ?? node.id}</text>
      <text x={x} y={y + r + 32} textAnchor="middle" fontSize={11} fill={busy ? color : '#8d93a8'} fontWeight={busy ? 500 : 400}>
        {busy && task ? trunc(task, 30) : SHORT_TITLE[node.id] ?? trunc(emp?.title ?? '', 20)}
      </text>
    </g>
  );
}
