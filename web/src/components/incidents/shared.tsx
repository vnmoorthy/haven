import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { Ban, Eraser, MessageSquareWarning, VolumeX } from 'lucide-react';
import { useHaven } from '../../lib/store';
import type { Incident, IncidentDetail } from '../../lib/types';

/** Ticking clock. Re-renders the caller every `ms` while mounted. */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}

export const fmtElapsed = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
};

/** Relative offset from an anchor, e.g. "+1.2s". */
export const fmtOffset = (ms: number) => {
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms);
  if (a < 60000) return `${sign}${(a / 1000).toFixed(a < 10000 ? 2 : 1)}s`;
  const m = Math.floor(a / 60000);
  return `${sign}${m}m${String(Math.floor((a % 60000) / 1000)).padStart(2, '0')}s`;
};

/** Live-ticking elapsed timer for unresolved work. */
export function ElapsedTimer({ since, className }: { since: number; className?: string }) {
  const now = useNow(100);
  return <span className={clsx('mono tabular-nums', className)}>{fmtElapsed(now - since)}</span>;
}

export const riskColor = (v: number) => (v >= 80 ? '#f43f5e' : v >= 55 ? '#f97316' : v >= 30 ? '#f59e0b' : '#10b981');

/** Animated SVG score dial. */
export function ScoreRing({ value, max = 100, size = 64, stroke = 6, color, children, track = 'rgba(255,255,255,0.07)', glow = true }: {
  value: number; max?: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string; glow?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, (Number.isFinite(value) ? value : 0) / max));
  const c = color ?? riskColor(pct * 100);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0 grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0" style={glow ? { filter: `drop-shadow(0 0 8px ${c}55)` } : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} stroke={c} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={circ} initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="relative grid place-items-center text-center leading-none">{children}</div>
    </div>
  );
}

export type ModAction = 'warn' | 'mute' | 'remove' | 'ban';
export const ACTIONS: { id: ModAction; label: string; verb: string; color: string; icon: typeof Ban; desc: string }[] = [
  { id: 'warn', label: 'Warn', verb: 'Warn member', color: '#60a5fa', icon: MessageSquareWarning, desc: 'DM a policy reminder, keep the message' },
  { id: 'mute', label: 'Mute', verb: 'Mute member', color: '#f59e0b', icon: VolumeX, desc: 'Temporarily silence the member' },
  { id: 'remove', label: 'Remove', verb: 'Remove message', color: '#f97316', icon: Eraser, desc: 'Delete the message, member stays' },
  { id: 'ban', label: 'Ban', verb: 'Ban member', color: '#f43f5e', icon: Ban, desc: 'Remove message and ban the account' },
];

/** Normalize a free-form recommended action ("remove_and_ban", "Ban user") into a moderation verb when possible. */
export function normalizeAction(a: string | null | undefined): ModAction | null {
  if (!a) return null;
  const s = a.toLowerCase();
  if (s.includes('ban')) return 'ban';
  if (s.includes('mute') || s.includes('timeout')) return 'mute';
  if (s.includes('remove') || s.includes('delete') || s.includes('quarantine')) return 'remove';
  if (s.includes('warn')) return 'warn';
  return null;
}
export const prettyAction = (a: string | null | undefined) => (a ? a.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

/** Push a fresh Incident returned by the API into the live store so every page updates instantly. */
export function pushIncident(inc: Incident | null | undefined) {
  if (inc && typeof inc === 'object' && inc.id && inc.status) useHaven.getState().apply({ type: 'incident.upsert', ts: Date.now(), data: inc });
}

/** Pull a human rationale out of whatever verdict shape the agents produced. */
export function rationaleOf(incident: Incident): string {
  const v = incident.verdict;
  if (!v) return incident.summary;
  if (typeof v === 'string') return v;
  return v.rationale ?? v.reason ?? v.reasoning ?? v.explanation ?? v.summary ?? incident.summary;
}
export function confidenceOf(incident: Incident): number | null {
  const c = incident.verdict?.confidence;
  if (typeof c !== 'number') return null;
  return c <= 1 ? Math.round(c * 100) : Math.round(c);
}

export const llmCost = (d: IncidentDetail | null) => (d?.llm ?? []).reduce((a, c) => a + (c.costUsd || 0), 0);

/** Compact JSON preview with truncation. */
export function JsonBlock({ value, max = 1800, className }: { value: unknown; max?: number; className?: string }) {
  let text: string;
  try { text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); } catch { text = String(value); }
  if (text == null) text = 'null';
  if (text.length > max) text = `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
  return (
    <pre className={clsx('mono text-[11px] leading-relaxed text-fg/80 bg-black/40 border border-line rounded-xl p-3 overflow-auto scroll-thin max-h-72 whitespace-pre-wrap break-words', className)}>
      {text}
    </pre>
  );
}

/** One-line summary of an arbitrary stage output for timelines. */
export function brief(value: unknown, max = 140): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  const o = value as Record<string, unknown>;
  const preferred = ['summary', 'label', 'verdict', 'decision', 'action', 'category', 'kind', 'risk', 'score', 'reply', 'text'];
  const parts: string[] = [];
  for (const k of preferred) {
    const v = o[k];
    if (v == null || typeof v === 'object') continue;
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  if (!parts.length) {
    for (const [k, v] of Object.entries(o)) {
      if (v == null || typeof v === 'object') continue;
      parts.push(`${k}: ${String(v)}`);
      if (parts.length >= 3) break;
    }
  }
  const s = parts.join(' · ') || `{ ${Object.keys(o).slice(0, 4).join(', ')} }`;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Highlights URLs inside free text (links are rendered inert — never clickable from evidence). */
export function HighlightUrls({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+|\b[\w-]+\.(?:com|net|org|io|gg|xyz|app|ru|top|click|link|live|site)\/?[^\s)]*)/gi);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono text-[0.92em] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded px-1 break-all">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-semibold">{children}</div>
      {right}
    </div>
  );
}
