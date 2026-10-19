import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import { AlertTriangle, BookOpen, Check, Clock, Cpu, Database, LineChart as LineIcon, RotateCw, Rows3, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { AskResult } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, TimeAgo, ToolChip, fmtMs } from '../ui';
import { DataTable, ResultChart, SqlBlock } from './ResultParts';

export interface AskEntry {
  id: string; question: string; status: 'pending' | 'done' | 'error'; result?: AskResult; error?: string; ts: number; ms?: number;
}

const STEPS = [
  { icon: BookOpen, label: 'Reading the shared context wiki' },
  { icon: Database, label: 'Writing SQL over live safety data' },
  { icon: Zap, label: 'Running the query' },
  { icon: LineIcon, label: 'Charting and explaining the answer' },
];

function Thinking() {
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 700); return () => clearInterval(t); }, []);
  return (
    <div className="space-y-2 py-1">
      {STEPS.map((s, i) => (
        <motion.div key={s.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: i <= step ? 1 : 0.35, x: 0 }} transition={{ delay: i * 0.05 }}
          className="flex items-center gap-2.5 text-[13px]">
          <span className={clsx('w-6 h-6 rounded-lg grid place-items-center', i < step ? 'bg-ok/15 text-ok' : i === step ? 'bg-yellow-300/15 text-yellow-300' : 'bg-white/[0.04] text-dim')}>
            {i < step ? <Check size={13} /> : <s.icon size={13} className={i === step ? 'animate-pulse' : ''} />}
          </span>
          <span className={i <= step ? 'text-fg/90' : 'text-dim'}>{s.label}{i === step && '…'}</span>
        </motion.div>
      ))}
      <div className="h-24 rounded-xl shimmer border border-line mt-3" />
    </div>
  );
}

export function ResultCard({ entry, latest, onRerun, onRemove }: { entry: AskEntry; latest: boolean; onRerun: () => void; onRemove: () => void }) {
  const r = entry.result;
  const live = r?.engine === 'promptql';
  const hasChart = !!r?.chart && r.chart.type !== 'none' && (r.rows?.length ?? 0) > 0;
  return (
    <motion.article layout initial={{ opacity: 0, y: 16, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={clsx('panel relative overflow-hidden', latest && 'border-yellow-300/25')}>
      {latest && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-yellow-300/70 to-transparent" />}
      <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-muted flex items-center gap-2">You asked · <TimeAgo ts={entry.ts} /></div>
          <h3 className="text-[17px] font-semibold tracking-tight mt-0.5">{entry.question}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onRerun} disabled={entry.status === 'pending'} title="Ask again" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer disabled:opacity-30"><RotateCw size={14} /></button>
          <button onClick={onRemove} title="Remove" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer"><Trash2 size={14} /></button>
        </div>
      </header>

      <div className="p-5 space-y-4">
        <div className="flex gap-3">
          <AgentAvatar id="iris" size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold">Iris</span>
              <span className="text-[11px] text-muted">Data Analyst</span>
              {r && (
                <>
                  <Badge color={live ? '#facc15' : '#8d93a8'} dot>{live ? 'PromptQL live' : 'local NL→SQL'}</Badge>
                  <Badge color="#c084fc"><Cpu size={10} />{r.model || 'unknown'}</Badge>
                  <Badge color="#8d93a8"><Rows3 size={10} />{r.rows?.length ?? 0} rows</Badge>
                  {entry.ms != null && <Badge color="#8d93a8"><Clock size={10} />{fmtMs(entry.ms)}</Badge>}
                </>
              )}
            </div>
            {entry.status === 'pending' && <Thinking />}
            {entry.status === 'error' && (
              <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-rose-200">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div>Iris couldn't answer that: {entry.error}. <button onClick={onRerun} className="underline cursor-pointer">Try again</button></div>
              </div>
            )}
            {r && <div className="prose-haven text-[14px] text-fg/90"><Markdown>{r.answer || '_No answer text returned._'}</Markdown></div>}
          </div>
        </div>

        {r && (
          <>
            <SqlBlock sql={r.sql} defaultOpen={false} />
            <div className={clsx('grid gap-3', hasChart && '2xl:grid-cols-2')}>
              {hasChart && <ResultChart result={r} />}
              {(r.rows?.length ?? 0) > 0 || r.sql ? <DataTable rows={r.rows ?? []} columns={r.columns ?? []} /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
              Powered by <ToolChip id="promptql" /> <ToolChip id="flatkey" /> · read-only SQL, validated before it runs
            </div>
          </>
        )}
      </div>
    </motion.article>
  );
}
