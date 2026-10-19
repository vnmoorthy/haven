import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, ChevronDown, Copy, Database } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import type { AskResult } from '../../lib/types';
import { fmtMs, fmtUsd } from '../ui';

// ───────────────────────────── SQL ─────────────────────────────

const KEYWORDS = new Set(('select from where group by order having limit offset join left right inner outer full cross on as and or not in is null like between ' +
  'case when then else end distinct union all with asc desc over partition exists cast coalesce ifnull nullif count sum avg min max round ' +
  'strftime datetime date julianday lower upper length substr replace total abs printf group_concat json_extract').split(' '));
const FUNCS = new Set('count sum avg min max round strftime datetime date julianday lower upper length substr replace total abs printf group_concat json_extract coalesce ifnull nullif cast'.split(' '));

function tintSql(sql: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_'"]+)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(sql))) {
    const [tok, comment, str, ident, num, word] = m;
    const k = i++;
    if (comment) out.push(<span key={k} className="text-dim italic">{tok}</span>);
    else if (str) out.push(<span key={k} className="text-emerald-300">{tok}</span>);
    else if (ident) out.push(<span key={k} className="text-sky-300">{tok}</span>);
    else if (num) out.push(<span key={k} className="text-amber-300">{tok}</span>);
    else if (word) {
      const lw = word.toLowerCase();
      if (FUNCS.has(lw) && /^\s*\(/.test(sql.slice(re.lastIndex))) out.push(<span key={k} className="text-cyan-300">{tok}</span>);
      else if (KEYWORDS.has(lw)) out.push(<span key={k} className="text-violet-300 font-semibold">{tok}</span>);
      else out.push(<span key={k} className="text-fg/90">{tok}</span>);
    } else out.push(<span key={k} className="text-muted">{tok}</span>);
  }
  return out;
}

/** Light pretty-print: break before major clauses. */
function formatSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
    .replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN|INNER JOIN|JOIN|UNION ALL|UNION)\b/gi, '\n$1')
    .replace(/\s+(AND|OR)\s+/g, '\n  $1 ');
}

export function SqlBlock({ sql, defaultOpen = false }: { sql: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => formatSql(sql || ''), [sql]);
  const tinted = useMemo(() => tintSql(pretty), [pretty]);
  if (!sql) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(pretty); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="rounded-xl border border-line bg-ink-950/60 overflow-hidden">
      <div className="flex items-center">
        <button onClick={() => setOpen((o) => !o)} className="flex-1 flex items-center gap-2 px-3 py-2 text-xs text-muted hover:text-fg cursor-pointer">
          <Database size={13} className="text-yellow-300" />
          <span className="font-medium">{open ? 'Hide' : 'Show'} SQL</span>
          <span className="mono text-[10.5px] text-dim truncate max-w-[420px]">{open ? '' : pretty.split('\n')[0]}</span>
          <ChevronDown size={13} className={clsx('ml-auto transition-transform', open && 'rotate-180')} />
        </button>
        <button onClick={copy} title="Copy SQL" className="px-3 py-2 text-muted hover:text-fg border-l border-line cursor-pointer">
          {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <pre className="mono text-[12px] leading-relaxed px-4 py-3 border-t border-line overflow-x-auto scroll-thin whitespace-pre">{tinted}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────── Formatting ─────────────────────────────

export function formatCell(col: string, v: any): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    const c = col.toLowerCase();
    if (/(cost|usd|spend|price|mrr|revenue)/.test(c)) return fmtUsd(v);
    if (/(_ms|latency|ms$)/.test(c)) return fmtMs(v);
    if (/(seconds|_secs?$|_s$)/.test(c)) return v >= 60 ? `${(v / 60).toFixed(1)}m` : `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}s`;
    if (/(_at$|^t$|time$|ts$)/.test(c) && v > 1e12) return new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 });
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const isNumericCol = (rows: any[], col: string) => rows.length > 0 && rows.every((r) => r[col] == null || typeof r[col] === 'number' || (typeof r[col] === 'string' && r[col].trim() !== '' && !isNaN(Number(r[col]))));

// ───────────────────────────── Table ─────────────────────────────

export function DataTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  const cols = columns.length ? columns : Object.keys(rows[0] ?? {});
  const numeric = useMemo(() => new Set(cols.filter((c) => isNumericCol(rows, c))), [rows, cols]);
  if (!rows.length) return <div className="text-xs text-dim text-center py-6 rounded-xl border border-dashed border-line">The query returned no rows.</div>;
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className="max-h-[320px] overflow-auto scroll-thin">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
            <tr>
              <th className="text-left font-medium text-dim px-3 py-2 w-8">#</th>
              {cols.map((c) => <th key={c} className={clsx('font-medium text-muted px-3 py-2 mono text-[11px] whitespace-nowrap', numeric.has(c) ? 'text-right' : 'text-left')}>{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-white/[0.025]">
                <td className="px-3 py-1.5 text-dim mono">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className={clsx('px-3 py-1.5 max-w-[280px] truncate', numeric.has(c) ? 'text-right mono tabular-nums' : 'text-fg/85')} title={String(r[c] ?? '')}>
                    {formatCell(c, typeof r[c] === 'string' && numeric.has(c) ? Number(r[c]) : r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-line text-[10.5px] text-dim mono">{rows.length} row{rows.length === 1 ? '' : 's'} · {cols.length} column{cols.length === 1 ? '' : 's'}</div>
    </div>
  );
}

// ───────────────────────────── Chart ─────────────────────────────

const tooltipStyle = {
  contentStyle: { background: '#0e111a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12, color: '#e8eaf2' },
  labelStyle: { color: '#8d93a8', marginBottom: 4 },
  itemStyle: { padding: 0, color: '#e8eaf2' },
};

export function usePalette() {
  const workforce = useHaven((s) => s.workforce);
  return useMemo(() => {
    const base = ['aria', 'nova', 'rex', 'mira', 'kai', 'iris', 'juno', 'leo'].map((id) => workforce.find((w) => w.id === id)?.color).filter(Boolean) as string[];
    return base.length ? base : ['#8b5cf6', '#22d3ee', '#f97316', '#f472b6', '#10b981', '#facc15', '#60a5fa', '#a3e635'];
  }, [workforce]);
}

export function ResultChart({ result, height = 260 }: { result: AskResult; height?: number }) {
  const palette = usePalette();
  const chart = result.chart;
  const data = useMemo(() => {
    if (!chart || chart.type === 'none' || !chart.x || !chart.y) return [];
    return (result.rows ?? []).map((r) => {
      const rawX = r[chart.x];
      const xLabel = typeof rawX === 'number' && rawX > 1e12 ? new Date(rawX).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : rawX == null ? '—' : String(rawX);
      return { ...r, __x: xLabel, __y: Number(r[chart.y]) || 0 };
    }).slice(0, 40);
  }, [result.rows, chart]);

  if (!chart || chart.type === 'none' || !data.length) return null;
  const yName = chart.y.replace(/_/g, ' ');
  const fmtY = (v: number) => formatCell(chart.y, v);
  const longLabels = data.reduce((a, d) => a + d.__x.length, 0) / data.length > 11 || data.length > 9;

  return (
    <div className="rounded-xl border border-line bg-ink-950/40 p-3">
      <div className="flex items-center justify-between text-[11px] text-muted mb-2 px-1">
        <span className="uppercase tracking-wider">{chart.type} · <span className="mono normal-case">{chart.y}</span> by <span className="mono normal-case">{chart.x}</span></span>
      </div>
      <div style={{ height: chart.type === 'bar' && longLabels ? Math.max(height, data.length * 28 + 30) : height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? (
            <PieChart>
              <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtY(Number(v)), yName]} />
              <Pie data={data} dataKey="__y" nameKey="__x" innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="rgba(5,6,10,0.9)" strokeWidth={2} animationDuration={700}
                label={({ name, percent }: any) => `${name} ${(Number(percent) * 100).toFixed(0)}%`} labelLine={false}>
                {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
              </Pie>
            </PieChart>
          ) : chart.type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="__x" tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => fmtY(Number(v))} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtY(Number(v)), yName]} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Line type="monotone" dataKey="__y" name={yName} stroke={palette[5] ?? '#facc15'} strokeWidth={2.5} dot={{ r: 3, fill: palette[5] ?? '#facc15' }} activeDot={{ r: 5 }} animationDuration={700} />
            </LineChart>
          ) : longLabels ? (
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtY(Number(v))} />
              <YAxis type="category" dataKey="__x" tick={{ fill: '#8d93a8', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtY(Number(v)), yName]} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="__y" name={yName} radius={[0, 6, 6, 0]} animationDuration={700} barSize={16}>
                {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="__x" tick={{ fill: '#8d93a8', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: '#5d6379', fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => fmtY(Number(v))} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtY(Number(v)), yName]} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="__y" name={yName} radius={[6, 6, 0, 0]} animationDuration={700} maxBarSize={56}>
                {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {chart.type === 'pie' && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
          {data.map((d, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="w-2 h-2 rounded-sm" style={{ background: palette[i % palette.length] }} />{d.__x} <b className="text-fg mono">{fmtY(d.__y)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
