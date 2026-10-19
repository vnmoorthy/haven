import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, Minimize2, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { Employee } from '../../lib/types';
import { Badge, Button, Counter, Panel, TimeAgo, ToolChip } from '../ui';
import { compactNum, pushToast } from './shared';

interface CompressionResult {
  id?: string; agentId?: string; beforeTokens: number; afterTokens: number; summary: string; kept: string[];
  method: 'paritok' | 'local' | string; ratio: number; createdAt?: number; ctxBefore?: number;
}

function Gauge({ value, budget, color }: { value: number; budget: number; color: string }) {
  const pct = Math.min(1, budget > 0 ? value / budget : 0);
  const r = 52, c = 2 * Math.PI * r;
  const tone = pct > 0.8 ? '#f43f5e' : pct > 0.55 ? '#f59e0b' : '#34d399';
  return (
    <div className="relative w-[136px] h-[136px] shrink-0">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        <motion.circle cx="64" cy="64" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${tone}88)` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-xl font-semibold tabular-nums" style={{ color }}><Counter value={value} format={(n) => compactNum(n)} /></div>
          <div className="text-[10.5px] text-muted">of {compactNum(budget)} tokens</div>
          <div className="text-[10.5px] mono mt-0.5" style={{ color: tone }}>{Math.round(pct * 100)}%</div>
        </div>
      </div>
    </div>
  );
}

export function MemoryPanel({ emp, memory, compressions, onCompressed }: {
  emp: Employee; memory: { items: string[]; tokens: number; budget: number }; compressions: any[]; onCompressed: () => void;
}) {
  const mode = useHaven((s) => s.integrations.find((i) => i.id === 'paritok')?.mode);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const totalSaved = compressions.reduce((a, c) => a + Math.max(0, (Number(c.beforeTokens) || 0) - (Number(c.afterTokens) || 0)), 0);

  const compress = async () => {
    setBusy(true);
    try {
      const r = await api.post<CompressionResult>(`/api/agents/${emp.id}/compress`);
      const res: CompressionResult = {
        beforeTokens: Number(r?.beforeTokens) || 0, afterTokens: Number(r?.afterTokens) || 0, summary: String(r?.summary ?? ''),
        kept: Array.isArray(r?.kept) ? r.kept : [], method: r?.method ?? 'local', ratio: Number(r?.ratio) || 1, createdAt: r?.createdAt, ctxBefore: memory.tokens,
      };
      setResult(res);
      pushToast('success', `${emp.name}'s memory compressed`, `${res.beforeTokens.toLocaleString()} → ${res.afterTokens.toLocaleString()} tokens (${res.ratio}×) via ${res.method === 'paritok' ? 'Paritok' : 'local compressor'}`, emp.id);
      onCompressed();
    } catch (e: any) {
      pushToast('error', 'Compression failed', String(e?.message ?? e), emp.id);
    } finally { setBusy(false); }
  };

  const afterPct = result && result.beforeTokens ? Math.max(3, (result.afterTokens / result.beforeTokens) * 100) : 100;

  return (
    <Panel title="Context memory" icon={<Brain size={14} />}
      actions={<><Badge color={mode === 'live' ? '#34d399' : '#8d93a8'} dot>{mode === 'live' ? 'Paritok live' : 'local compressor'}</Badge><ToolChip id="paritok" /></>}>
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="flex flex-col items-center gap-3">
          <Gauge value={memory.tokens} budget={memory.budget} color={emp.color} />
          <Button size="sm" variant="primary" onClick={compress} disabled={busy} icon={busy ? <Sparkles size={13} className="animate-spin" /> : <Minimize2 size={13} />}>
            {busy ? 'Compressing…' : 'Compress now'}
          </Button>
          <div className="text-[11px] text-muted text-center leading-snug">
            {compressions.length} compression{compressions.length === 1 ? '' : 's'} · <b className="text-fg">{totalSaved.toLocaleString()}</b> tokens saved
            {compressions[0]?.createdAt ? <div className="text-dim">last <TimeAgo ts={compressions[0].createdAt} /></div> : null}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div key="result" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="relative rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] p-3.5 overflow-hidden">
                <motion.div className="absolute inset-0 pointer-events-none" initial={{ opacity: 0.6 }} animate={{ opacity: 0 }} transition={{ duration: 1.4 }}
                  style={{ background: 'radial-gradient(400px 120px at 50% 0%, rgba(52,211,153,0.35), transparent)' }} />
                <div className="relative flex items-center justify-between gap-2 mb-3">
                  <div className="text-sm font-medium flex items-center gap-2"><Sparkles size={14} className="text-emerald-300" /> Compressed {result.ratio}×</div>
                  <div className="flex items-center gap-2">
                    <Badge color={result.method === 'paritok' ? '#34d399' : '#8d93a8'}>{result.method === 'paritok' ? 'Paritok GPU' : 'local'}</Badge>
                    <button onClick={() => setResult(null)} className="p-1 rounded-md text-muted hover:text-fg cursor-pointer" aria-label="Close"><X size={13} /></button>
                  </div>
                </div>
                <div className="relative space-y-2">
                  <div>
                    <div className="flex justify-between text-[11px] text-muted mb-1"><span>Before</span><span className="mono">{result.beforeTokens.toLocaleString()} tok</span></div>
                    <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full w-full rounded-full bg-white/25" /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-muted mb-1"><span>After</span>
                      <span className="mono text-emerald-300"><Counter value={result.afterTokens} /> tok</span></div>
                    <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" initial={{ width: '100%' }} animate={{ width: `${afterPct}%` }}
                        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.15 }} />
                    </div>
                  </div>
                </div>
                {result.ctxBefore != null && result.ctxBefore > memory.tokens && (
                  <div className="relative mt-3 flex items-center gap-2 text-[11.5px] rounded-lg border border-line bg-ink-950/40 px-2.5 py-1.5">
                    <span className="text-muted">Working memory</span>
                    <span className="mono text-fg/70 line-through decoration-white/30">{result.ctxBefore.toLocaleString()}</span>
                    <span className="text-dim">→</span>
                    <span className="mono text-emerald-300 font-semibold"><Counter value={memory.tokens} /></span>
                    <span className="text-muted">tokens</span>
                    <span className="ml-auto mono text-emerald-300">−{Math.round((1 - memory.tokens / result.ctxBefore) * 100)}%</span>
                  </div>
                )}
                <div className="relative mt-3 text-[12.5px] text-fg/85 leading-relaxed max-h-28 overflow-y-auto scroll-thin whitespace-pre-wrap">{result.summary || 'No summary returned.'}</div>
                {result.kept.length > 0 && (
                  <div className="relative mt-2.5">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted mb-1">Kept verbatim ({result.kept.length})</div>
                    <ul className="space-y-1 max-h-24 overflow-y-auto scroll-thin">
                      {result.kept.slice(0, 8).map((k, i) => <li key={i} className="mono text-[10.5px] text-muted truncate" title={k}>• {k}</li>)}
                    </ul>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="items" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="text-[11px] uppercase tracking-wider text-muted mb-2">Working memory · {memory.items.length} items</div>
                {memory.items.length === 0 ? (
                  <div className="text-xs text-dim py-6 text-center rounded-xl border border-dashed border-line">Memory is empty — {emp.name} hasn't exchanged any BAND messages since the last compression.</div>
                ) : (
                  <ul className="space-y-1.5 max-h-[220px] overflow-y-auto scroll-thin pr-1">
                    <AnimatePresence initial={false}>
                      {memory.items.slice(0, 30).map((it, i) => (
                        <motion.li key={`${i}-${it.slice(0, 40)}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                          className={`mono text-[11px] leading-snug rounded-lg px-2.5 py-1.5 border ${it.startsWith('(compressed)') ? 'border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-200/90' : 'border-line bg-white/[0.02] text-muted'}`}>
                          <span className="line-clamp-2">{it}</span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Panel>
  );
}
