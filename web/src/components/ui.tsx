import { type ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import type { IncidentKind, Severity, IncidentStatus } from '../lib/types';

export function Panel({ children, className, title, icon, actions, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; icon?: ReactNode; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={clsx('panel flex flex-col min-h-0', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg/90 uppercase">
            {icon && <span className="text-muted">{icon}</span>}
            {title}
          </h3>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('flex-1 min-h-0', pad && 'p-4')}>{children}</div>
    </section>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'outline';
export function Button({ children, onClick, variant = 'outline', size = 'md', disabled, className, icon, type = 'button', title }: {
  children?: ReactNode; onClick?: () => void; variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; className?: string; icon?: ReactNode; type?: 'button' | 'submit'; title?: string;
}) {
  return (
    <button
      type={type} title={title} onClick={onClick} disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all select-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer whitespace-nowrap',
        size === 'sm' && 'text-xs px-2.5 py-1.5', size === 'md' && 'text-sm px-3.5 py-2', size === 'lg' && 'text-[15px] px-5 py-2.5',
        variant === 'primary' && 'brand-gradient text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.7)] hover:brightness-110',
        variant === 'outline' && 'border border-line-strong bg-white/[0.03] hover:bg-white/[0.07] text-fg',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-white/[0.05]',
        variant === 'danger' && 'bg-danger/90 hover:bg-danger text-white shadow-[0_8px_24px_-10px_rgba(244,63,94,0.8)]',
        variant === 'success' && 'bg-ok/90 hover:bg-ok text-white shadow-[0_8px_24px_-10px_rgba(16,185,129,0.8)]',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Badge({ children, color = '#8d93a8', className, dot }: { children: ReactNode; color?: string; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border whitespace-nowrap', className)}
      style={{ color, borderColor: `${color}44`, background: `${color}14` }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export const SEVERITY_COLOR: Record<Severity, string> = { low: '#60a5fa', medium: '#f59e0b', high: '#f97316', critical: '#f43f5e' };
export const KIND_META: Record<IncidentKind, { label: string; color: string; emoji: string }> = {
  phishing: { label: 'Phishing', color: '#f97316', emoji: '🎣' },
  scam: { label: 'Scam', color: '#fb923c', emoji: '💸' },
  harassment: { label: 'Harassment', color: '#f43f5e', emoji: '🛑' },
  crisis: { label: 'Crisis', color: '#f472b6', emoji: '💗' },
  spam: { label: 'Spam', color: '#a3a3a3', emoji: '📢' },
  hate: { label: 'Hate', color: '#ef4444', emoji: '⚠️' },
  raid: { label: 'Raid', color: '#eab308', emoji: '🌊' },
  bot_risk: { label: 'Bot risk', color: '#10b981', emoji: '🤖' },
};
export const STATUS_COLOR: Record<IncidentStatus, string> = { open: '#60a5fa', investigating: '#a78bfa', awaiting_approval: '#f59e0b', resolved: '#10b981', dismissed: '#5d6379' };

export function SeverityBadge({ s }: { s: Severity }) { return <Badge color={SEVERITY_COLOR[s]} dot>{s}</Badge>; }
export function KindBadge({ k }: { k: IncidentKind }) { const m = KIND_META[k]; return <Badge color={m.color}>{m.emoji} {m.label}</Badge>; }
export function StatusBadge({ s }: { s: IncidentStatus }) { return <Badge color={STATUS_COLOR[s]} dot>{s.replace('_', ' ')}</Badge>; }

export function Stat({ label, value, sub, accent = '#8b5cf6', icon, className }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx('panel p-4 relative overflow-hidden', className)}>
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-30" style={{ background: accent }} />
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted font-medium">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Animated number that tweens to its new value. */
export function Counter({ value, format = (n: number) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown, to = value, start = performance.now(), dur = 600;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setShown(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{format(shown)}</>;
}

export function RiskMeter({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const color = value >= 80 ? '#f43f5e' : value >= 55 ? '#f97316' : value >= 30 ? '#f59e0b' : '#10b981';
  return (
    <div className="flex items-center gap-2">
      <div className={clsx('rounded-full bg-white/[0.06] overflow-hidden', size === 'sm' ? 'h-1.5 w-16' : 'h-2 w-28')}>
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, value)}%` }} transition={{ duration: 0.6 }} />
      </div>
      <span className="mono text-[11px] tabular-nums" style={{ color }}>{Math.round(value)}</span>
    </div>
  );
}

export function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function TimeAgo({ ts }: { ts: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 5000); return () => clearInterval(t); }, []);
  return <span title={new Date(ts).toLocaleString()}>{timeAgo(ts)}</span>;
}
export const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
export const fmtUsd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 gap-2">
      {icon && <div className="text-dim mb-1">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="text-xs text-muted max-w-sm">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.18em] text-muted mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Small chip naming the sponsor tool powering a feature. */
export const TOOL_META: Record<string, { name: string; color: string }> = {
  kylon: { name: 'Kylon', color: '#a78bfa' }, masky: { name: 'Masky.AI', color: '#f472b6' }, band: { name: 'BAND', color: '#22d3ee' },
  n8n: { name: 'n8n', color: '#ea4b71' }, rocketride: { name: 'RocketRide', color: '#f97316' }, adal: { name: 'AdaL', color: '#fbbf24' },
  celesto: { name: 'Celesto', color: '#38bdf8' }, flatkey: { name: 'Flatkey', color: '#c084fc' }, promptql: { name: 'PromptQL', color: '#facc15' },
  paritok: { name: 'Paritok', color: '#34d399' }, finch: { name: 'Finch', color: '#fb7185' }, tenki: { name: 'Tenki', color: '#60a5fa' },
  prelint: { name: 'Prelint', color: '#818cf8' }, snyk: { name: 'Snyk', color: '#a78bfa' }, maskord: { name: 'Maskord', color: '#f472b6' },
};
export function ToolChip({ id, className }: { id: string; className?: string }) {
  const m = TOOL_META[id] ?? { name: id, color: '#8d93a8' };
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold mono border', className)} style={{ color: m.color, borderColor: `${m.color}40`, background: `${m.color}12` }}>
      {m.name}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white/[0.02] p-1 gap-1">
      {items.map((it) => (
        <button key={it.id} onClick={() => onChange(it.id)}
          className={clsx('relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer', value === it.id ? 'text-fg' : 'text-muted hover:text-fg')}>
          {value === it.id && <motion.span layoutId={`tab-${items.map((i) => i.id).join()}`} className="absolute inset-0 rounded-lg bg-white/[0.08] border border-line-strong" />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white/80 animate-spin', className)} />;
}
