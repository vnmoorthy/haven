import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, History, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useHaven } from '../lib/store';
import type { AskResult } from '../lib/types';
import { AgentAvatar } from '../components/Avatar';
import { Badge, Empty, PageHeader, ToolChip } from '../components/ui';
import { ResultCard, type AskEntry } from '../components/ask/ResultCard';
import { WikiPanel } from '../components/ask/WikiPanel';

const SUGGESTIONS = [
  'Which kind of incident is most common?',
  'Which channel has the most threats?',
  'What is our median time to action by kind?',
  'How much have we spent on models, by model?',
  'Who are the top offenders?',
  'How many messages did we screen per channel?',
  'Which AI employee handled the most incidents?',
  'How many tokens has Paritok saved?',
];

// Q&A history survives navigating away and back during the browser session.
let sessionHistory: AskEntry[] = [];
let seq = 0;

export default function Ask() {
  const [question, setQuestion] = useState('');
  const [history, setHistoryState] = useState<AskEntry[]>(sessionHistory);
  const inputRef = useRef<HTMLInputElement>(null);
  const irisStatus = useHaven((s) => s.agentStatus.iris?.status ?? 'idle');
  const promptqlMode = useHaven((s) => s.integrations.find((i) => i.id === 'promptql')?.mode);
  const pending = history.some((h) => h.status === 'pending');

  const setHistory = useCallback((fn: (h: AskEntry[]) => AskEntry[]) => {
    sessionHistory = fn(sessionHistory);
    setHistoryState(sessionHistory);
  }, []);

  // Press "/" anywhere to jump to the question box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t && !['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.isContentEditable) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = useCallback(async (q: string, reuseId?: string) => {
    const text = q.trim();
    if (!text) return;
    const id = reuseId ?? `q${Date.now().toString(36)}${(seq++).toString(36)}`;
    const started = performance.now();
    const entry: AskEntry = { id, question: text, status: 'pending', ts: Date.now() };
    setHistory((h) => [entry, ...h.filter((x) => x.id !== id)]);
    try {
      const result = await api.post<AskResult>('/api/ask', { question: text });
      const ms = Math.round(performance.now() - started);
      // Let the step-by-step "thinking" trace finish rendering so fast answers don't flash.
      if (ms < 900) await new Promise((r) => setTimeout(r, 900 - ms));
      const safe: AskResult = {
        answer: String(result?.answer ?? ''), sql: String(result?.sql ?? ''), rows: Array.isArray(result?.rows) ? result.rows : [],
        columns: Array.isArray(result?.columns) ? result.columns : Object.keys(result?.rows?.[0] ?? {}), chart: result?.chart ?? null,
        engine: result?.engine === 'promptql' ? 'promptql' : 'local', agentId: 'iris', model: String(result?.model ?? ''),
      };
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, status: 'done', result: safe, ms } : x)));
    } catch (e: any) {
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, status: 'error', error: String(e?.message ?? e) } : x)));
    }
  }, [setHistory]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!question.trim() || pending) return;
    const q = question;
    setQuestion('');
    void ask(q);
  };

  return (
    <div className="max-w-[1700px] mx-auto">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2"><Sparkles size={12} /> Ask Haven · Iris + <ToolChip id="promptql" /></span>}
        title={<span>Ask <span className="text-gradient">anything</span> about your communities</span>}
        subtitle="Iris turns plain-English questions into read-only SQL over Haven's live safety data, runs it, charts it and explains what it means — grounded in the shared context wiki."
        actions={<Badge color={promptqlMode === 'live' ? '#facc15' : '#8d93a8'} dot>{promptqlMode === 'live' ? 'PromptQL live' : 'local NL→SQL engine'}</Badge>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="min-w-0 space-y-4">
          {/* Hero input */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="panel relative overflow-hidden p-5 md:p-6">
            <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
            <div className="absolute -top-28 left-1/3 w-[520px] h-[260px] rounded-full blur-3xl opacity-[0.14] pointer-events-none bg-yellow-300" />
            <div className="absolute -bottom-32 right-0 w-[420px] h-[240px] rounded-full blur-3xl opacity-[0.12] pointer-events-none bg-brand-violet" />
            <form onSubmit={submit} className="relative">
              <div className="relative group">
                <div className="absolute -inset-[1.5px] rounded-2xl opacity-60 group-focus-within:opacity-100 transition-opacity blur-[2px]"
                  style={{ background: 'linear-gradient(90deg, #facc15, #8b5cf6, #22d3ee, #facc15)', backgroundSize: '300% 100%', animation: 'shimmer 6s linear infinite' }} />
                <div className="relative flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 shadow-[0_20px_60px_-20px_rgba(250,204,21,0.35)]">
                  <AgentAvatar id="iris" size={40} />
                  <input ref={inputRef} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus
                    placeholder="Ask anything about your communities…"
                    className="flex-1 min-w-0 bg-transparent outline-none text-[17px] md:text-lg placeholder:text-dim" />
                  <span className="hidden md:inline kbd text-dim">/</span>
                  <button type="submit" disabled={!question.trim() || pending}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-950 bg-yellow-300 hover:bg-yellow-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {pending ? 'Iris is working…' : <>Ask Iris <ArrowRight size={15} /></>}
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button key={s} type="button" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i + 0.15 }}
                    disabled={pending} onClick={() => void ask(s)}
                    className="text-[12.5px] rounded-full border border-line bg-white/[0.03] hover:bg-yellow-300/10 hover:border-yellow-300/40 hover:text-yellow-100 px-3 py-1.5 text-fg/80 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {s}
                  </motion.button>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-dim flex items-center gap-2">
                <span className="relative flex w-1.5 h-1.5"><span className={`relative w-1.5 h-1.5 rounded-full ${irisStatus === 'idle' ? 'bg-ok' : 'bg-yellow-300 animate-pulse'}`} /></span>
                Iris is {irisStatus === 'idle' ? 'ready' : irisStatus} · queries are validated read-only before they touch the database
              </div>
            </form>
          </motion.div>

          {/* History */}
          {history.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] uppercase tracking-wider text-muted flex items-center gap-2"><History size={12} /> This session · {history.length} question{history.length === 1 ? '' : 's'}</div>
              <button onClick={() => setHistory(() => [])} disabled={pending} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg cursor-pointer disabled:opacity-40"><Trash2 size={12} /> Clear</button>
            </div>
          )}
          <AnimatePresence initial={false} mode="popLayout">
            {history.map((h, i) => (
              <ResultCard key={h.id} entry={h} latest={i === 0}
                onRerun={() => void ask(h.question, h.id)}
                onRemove={() => setHistory((list) => list.filter((x) => x.id !== h.id))} />
            ))}
          </AnimatePresence>
          {history.length === 0 && (
            <div className="panel">
              <Empty icon={<Sparkles size={24} className="text-yellow-300" />} title="No questions yet"
                body="Pick a suggestion above or type your own. Iris shows her SQL, a chart and the raw rows for every answer — nothing is a black box." />
            </div>
          )}
        </div>

        <div className="xl:sticky xl:top-20 xl:h-[calc(100vh-7rem)] min-h-[520px] flex flex-col">
          <WikiPanel />
        </div>
      </div>
    </div>
  );
}
