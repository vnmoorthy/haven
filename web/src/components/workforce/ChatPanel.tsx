import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Markdown from 'react-markdown';
import clsx from 'clsx';
import { ArrowUp, Cpu, MessageCircle, RotateCcw, Volume2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { Employee } from '../../lib/types';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { ToolChip } from '../ui';
import { StatusPill, SUGGESTED_PROMPTS, onColor } from './shared';

export interface ChatMsg {
  id: string; role: 'user' | 'assistant'; content: string; ts: number;
  model?: string; provider?: string; voice?: boolean; error?: boolean; note?: string; hidden?: boolean;
}

// Conversations survive navigating between pages for the whole browser session.
const conversations = new Map<string, ChatMsg[]>();
let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Chat state for one AI employee (POST /api/agents/:id/chat). */
export function useAgentChat(agentId: string) {
  const [messages, setMessages] = useState<ChatMsg[]>(() => conversations.get(agentId) ?? []);
  const [pending, setPending] = useState(false);
  const ref = useRef(messages);
  useEffect(() => { const m = conversations.get(agentId) ?? []; ref.current = m; setMessages(m); setPending(false); }, [agentId]);
  const update = useCallback((fn: (m: ChatMsg[]) => ChatMsg[]) => {
    const next = fn(ref.current);
    ref.current = next;
    conversations.set(agentId, next);
    setMessages(next);
  }, [agentId]);

  const send = useCallback(async (text: string, opts: { note?: string } = {}) => {
    const message = text.trim();
    if (!message) return null;
    const history = ref.current.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    const user: ChatMsg = { id: mid(), role: 'user', content: message, ts: Date.now(), note: opts.note };
    update((m) => [...m, user]);
    setPending(true);
    try {
      const r = await api.post<{ reply: string; model: string; provider: string; voice: boolean }>(`/api/agents/${agentId}/chat`, { message, history });
      const reply: ChatMsg = { id: mid(), role: 'assistant', content: String(r?.reply ?? '').trim() || '…', ts: Date.now(), model: r?.model, provider: r?.provider, voice: r?.voice };
      update((m) => [...m, reply]);
      return reply;
    } catch (e: any) {
      update((m) => [...m, { id: mid(), role: 'assistant', content: `I couldn't reply just now (${String(e?.message ?? e)}). Try again in a moment.`, ts: Date.now(), error: true }]);
      return null;
    } finally { setPending(false); }
  }, [agentId, update]);

  const clear = useCallback(() => update(() => []), [update]);
  return { messages, pending, send, clear };
}

function ModelTag({ m }: { m: ChatMsg }) {
  const offline = !m.provider || m.provider === 'offline-brain' || m.provider === 'local';
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-dim pl-1">
      <Cpu size={10} />
      <span className="mono">{m.model ?? 'unknown model'}</span>
      <span>·</span>
      <span className={clsx('mono', offline ? 'text-dim' : 'text-violet-300')}>{offline ? 'local' : m.provider}</span>
      {m.voice && <><span>·</span><Volume2 size={10} /><span>spoken</span></>}
    </div>
  );
}

export function ChatPanel({ emp, chat, className }: { emp: Employee; chat: ReturnType<typeof useAgentChat>; className?: string }) {
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const founder = useHaven((s) => s.founder);
  const prompts = SUGGESTED_PROMPTS[emp.id] ?? ['What are you working on?', 'What should I know today?'];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat.messages.length, chat.pending]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(140, ta.scrollHeight)}px`;
  }, [input]);

  const submit = (text = input) => {
    if (!text.trim() || chat.pending) return;
    setInput('');
    void chat.send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <section className={clsx('panel flex flex-col min-h-0 overflow-hidden', className)}>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-line relative">
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${emp.color}, transparent)` }} />
        <AgentAvatar id={emp.id} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold flex items-center gap-2">Chat with {emp.name}</div>
          <StatusPill agentId={emp.id} />
        </div>
        <div className="flex items-center gap-1"><ToolChip id="flatkey" /><ToolChip id="masky" /></div>
        {chat.messages.length > 0 && (
          <button onClick={chat.clear} title="Clear conversation" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer"><RotateCcw size={14} /></button>
        )}
      </header>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 py-4 space-y-4">
        {chat.messages.length === 0 && !chat.pending && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <div className="relative mb-3">
              <div className="absolute inset-0 rounded-full blur-2xl opacity-40" style={{ background: emp.color }} />
              <AgentAvatar id={emp.id} size={64} showStatus={false} />
            </div>
            <div className="text-sm font-medium">Ask {emp.name} anything</div>
            <div className="text-xs text-muted mt-1 max-w-[280px]">Replies are generated through the Flatkey model gateway with live company context, and spoken aloud in {emp.name}'s voice.</div>
            <div className="mt-4 flex flex-col gap-2 w-full">
              {prompts.map((p) => (
                <button key={p} onClick={() => submit(p)} className="text-left text-[13px] rounded-xl border border-line bg-white/[0.02] hover:bg-white/[0.06] hover:border-line-strong px-3 py-2 cursor-pointer transition-colors">
                  <MessageCircle size={12} className="inline mr-2 -mt-0.5" style={{ color: emp.color }} />{p}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {chat.messages.map((m) => (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.25 }}
              className={clsx('flex gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'assistant' && <AgentAvatar id={emp.id} size={28} showStatus={false} className="mt-0.5" />}
              <div className={clsx('max-w-[84%] min-w-0', m.role === 'user' && 'flex flex-col items-end')}>
                {m.note && <div className="text-[10.5px] uppercase tracking-wider text-dim mb-1 pr-1">{m.note}</div>}
                <div className={clsx('rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed break-words',
                  m.role === 'user' ? 'brand-gradient text-white rounded-br-md' : 'bg-white/[0.05] border border-line rounded-bl-md',
                  m.error && 'border-danger/40 bg-danger/10 text-rose-200')}>
                  {m.role === 'assistant' ? <div className="prose-haven"><Markdown>{m.content}</Markdown></div> : m.content}
                </div>
                {m.role === 'assistant' && !m.error && <ModelTag m={m} />}
              </div>
              {m.role === 'user' && <div className="mt-0.5"><FounderAvatar size={28} /></div>}
            </motion.div>
          ))}
        </AnimatePresence>

        {chat.pending && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 items-center">
            <AgentAvatar id={emp.id} size={28} showStatus={false} />
            <div className="rounded-2xl rounded-bl-md bg-white/[0.05] border border-line px-3.5 py-3 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: emp.color }}
                  animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }} />
              ))}
            </div>
            <span className="text-[11px] text-dim">{emp.name} is thinking…</span>
          </motion.div>
        )}
      </div>

      <div className="border-t border-line p-3 space-y-2 bg-ink-950/30">
        {chat.messages.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-0.5">
            {prompts.map((p) => (
              <button key={p} onClick={() => submit(p)} disabled={chat.pending}
                className="shrink-0 text-[11.5px] rounded-full border border-line px-2.5 py-1 text-muted hover:text-fg hover:border-line-strong cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-ink-900/80 px-3 py-2 focus-within:border-white/25 transition-colors"
          style={{ boxShadow: input ? `0 0 0 3px ${emp.color}1f` : undefined }}>
          <textarea ref={taRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1}
            placeholder={`Message ${emp.name}… (as ${founder?.name ?? 'the founder'})`}
            className="flex-1 resize-none bg-transparent outline-none text-[13.5px] placeholder:text-dim py-1 max-h-[140px] scroll-thin" />
          <button onClick={() => submit()} disabled={!input.trim() || chat.pending} aria-label="Send"
            className="w-8 h-8 rounded-xl grid place-items-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:brightness-110"
            style={{ background: emp.color, color: onColor(emp.color) }}>
            <ArrowUp size={16} />
          </button>
        </div>
        <div className="text-[10.5px] text-dim px-1">Enter to send · Shift+Enter for a new line</div>
      </div>
    </section>
  );
}
