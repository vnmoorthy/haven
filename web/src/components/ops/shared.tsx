import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';

/** Recharts tooltip styling shared by the ops pages. */
export const chartTooltip = {
  contentStyle: { background: '#0e111a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12, color: '#e8eaf2', boxShadow: '0 20px 40px -20px rgba(0,0,0,0.8)' },
  labelStyle: { color: '#8d93a8', marginBottom: 4 },
  itemStyle: { padding: 0, color: '#e8eaf2' },
};
export const axisTick = { fill: '#5d6379', fontSize: 10 };

export const RUN_STATUS_COLOR: Record<string, string> = {
  pending: '#5d6379', queued: '#5d6379', running: '#a78bfa', done: '#10b981', success: '#10b981', skipped: '#8d93a8', error: '#f43f5e',
};

export const N8N_COLOR = '#ea4b71';

/** Pretty-printed JSON with lightweight syntax highlighting (no innerHTML). */
export function JsonView({ value, className, maxHeight = 360 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = useMemo(() => {
    if (value === undefined) return 'undefined';
    try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
  }, [value]);
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    const capped = text.length > 40000 ? text.slice(0, 40000) + '\n…' : text;
    while ((m = re.exec(capped))) {
      if (m.index > last) out.push(capped.slice(last, m.index));
      const tok = m[0];
      let cls = 'text-amber-300';
      if (tok.startsWith('"')) cls = m[2] ? 'text-sky-300' : 'text-emerald-300';
      else if (tok === 'true' || tok === 'false') cls = 'text-violet-300';
      else if (tok === 'null') cls = 'text-dim';
      out.push(<span key={i++} className={cls}>{tok}</span>);
      last = m.index + tok.length;
    }
    if (last < capped.length) out.push(capped.slice(last));
    return out;
  }, [text]);
  return (
    <pre className={clsx('mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words overflow-auto scroll-thin rounded-xl bg-black/40 border border-line p-3 text-fg/80', className)}
      style={{ maxHeight }}>
      {parts}
    </pre>
  );
}

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <button type="button" onClick={copy} title="Copy" className={clsx('inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg cursor-pointer rounded-md px-1.5 py-1 hover:bg-white/[0.06]', className)}>
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />}{label && <span>{done ? 'Copied' : label}</span>}
    </button>
  );
}

/** Status dot; pulses while running. */
export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const c = RUN_STATUS_COLOR[status] ?? '#5d6379';
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {status === 'running' && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: c, opacity: 0.6 }} />}
      <span className="relative rounded-full w-full h-full" style={{ background: c, boxShadow: status === 'running' ? `0 0 10px ${c}` : undefined }} />
    </span>
  );
}

/** Ticks every `ms` so live durations re-render. */
export function useNow(ms = 500, active = true) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return n;
}

/** JSON textarea with live validation. */
export function JsonEditor({ value, onChange, rows = 4, className }: { value: string; onChange: (v: string) => void; rows?: number; className?: string }) {
  const err = useMemo(() => { try { JSON.parse(value || '{}'); return null; } catch (e) { return (e as Error).message; } }, [value]);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className={className}>
      <textarea ref={ref} value={value} rows={rows} spellCheck={false} onChange={(e) => onChange(e.target.value)}
        className={clsx('w-full mono text-[11.5px] leading-relaxed rounded-xl bg-black/40 border p-3 text-fg/90 outline-none resize-y scroll-thin transition-colors',
          err ? 'border-danger/60 focus:border-danger' : 'border-line focus:border-brand-violet/60')} />
      {err && <div className="text-[11px] text-rose-300 mt-1 mono truncate">Invalid JSON · {err}</div>}
    </div>
  );
}

export const parseJson = (s: string): { ok: true; value: any } | { ok: false } => {
  try { return { ok: true, value: JSON.parse(s || '{}') }; } catch { return { ok: false }; }
};

/** Shallow subset match: every key in `want` deep-equals the same key in `have`. */
export function subsetMatch(want: any, have: any): boolean {
  if (!want || typeof want !== 'object') return JSON.stringify(want) === JSON.stringify(have);
  if (!have || typeof have !== 'object') return false;
  return Object.keys(want).every((k) => JSON.stringify(want[k]) === JSON.stringify(have[k]));
}

export const fmtCompactUsd = (n: number) => {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};
export const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
};

/** Section heading with a gradient hairline. */
export function SectionHeading({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mt-10 mb-4">
      <div>
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.18em] text-muted mb-1">{eyebrow}</div>}
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="flex-1 h-px mb-2.5 bg-gradient-to-r from-white/15 via-white/5 to-transparent" />
      {right}
    </div>
  );
}

/** Where the raw .pipe / n8n JSON lives: the API in live mode, GitHub in the static replay build. */
export const REPO_URL = 'https://github.com/vnmoorthy/haven';
export const fileHref = (apiPath: string, repoFile: string, isReplay: boolean) => (isReplay ? `${REPO_URL}/blob/main/${repoFile}` : apiPath);
