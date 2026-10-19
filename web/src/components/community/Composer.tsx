import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, Fish, HeartCrack, Link2, Loader2, Megaphone, SendHorizonal, Swords, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import { api } from '../../lib/api';
import type { Channel } from '../../lib/types';
import { FounderAvatar, MemberAvatar } from '../Avatar';

const QUICK = [
  { scenario: 'phishing', label: 'Paste phishing link', icon: Fish, color: '#f97316' },
  { scenario: 'crisis', label: 'Send crisis message', icon: HeartCrack, color: '#f472b6' },
  { scenario: 'harassment', label: 'Harass someone', icon: Swords, color: '#f43f5e' },
  { scenario: 'scam', label: 'Crypto scam', icon: Link2, color: '#fb923c' },
  { scenario: 'spam', label: 'Spam', icon: Megaphone, color: '#a3a3a3' },
] as const;

export const FOUNDER_PERSONA = '__founder__';

/** Message composer with persona picker and one-click threat injection. */
export function Composer({ channel, onSent }: { channel: Channel; onSent?: () => void }) {
  const membersMap = useHaven((s) => s.members);
  const founderName = useHaven((s) => s.founder?.name ?? 'Founder');
  const members = useMemo(() => Object.values(membersMap).filter((m) => m.communityId === channel.communityId && m.role !== 'bot')
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [membersMap, channel.communityId]);
  const [persona, setPersona] = useState<string>('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [injecting, setInjecting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Default to an active member of this community whenever the community changes.
  useEffect(() => {
    setPersona((p) => (p === FOUNDER_PERSONA || members.some((m) => m.id === p) ? p : members.find((m) => m.status === 'active')?.id ?? FOUNDER_PERSONA));
  }, [members]);

  const current = persona === FOUNDER_PERSONA ? null : members.find((m) => m.id === persona);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true); setErr(null);
    try {
      await api.post('/api/community/messages', persona === FOUNDER_PERSONA || !current
        ? { channelId: channel.id, content, asFounder: true }
        : { channelId: channel.id, memberId: current.id, content });
      setText('');
      onSent?.();
    } catch (e2) {
      setErr((e2 as Error).message || 'Could not send');
    } finally { setSending(false); }
  };

  const inject = async (scenario: string) => {
    if (injecting) return;
    setInjecting(scenario); setErr(null);
    try { await api.post('/api/sim/inject', { scenario, channelId: channel.id }); onSent?.(); }
    catch (e2) { setErr((e2 as Error).message || 'Injection failed'); }
    finally { setInjecting(null); }
  };

  return (
    <div className="px-4 pb-4 pt-2 space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto scroll-thin pb-0.5">
        <span className="shrink-0 inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-dim mr-1"><Zap size={11} /> Simulate</span>
        {QUICK.map((q) => (
          <button key={q.scenario} type="button" onClick={() => inject(q.scenario)} disabled={!!injecting}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium cursor-pointer transition-all hover:brightness-125 disabled:opacity-50 disabled:cursor-wait"
            style={{ color: q.color, borderColor: `${q.color}44`, background: `${q.color}12` }}>
            {injecting === q.scenario ? <Loader2 size={12} className="animate-spin" /> : <q.icon size={12} />}
            {q.label}
          </button>
        ))}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 rounded-2xl border border-line-strong bg-ink-800/80 pl-2 pr-1.5 py-1.5 focus-within:border-brand-violet/60 focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.15)] transition-all">
        <label className="relative shrink-0 flex items-center gap-1.5 rounded-xl hover:bg-white/[0.05] pl-1 pr-6 py-1 cursor-pointer" title="Post as">
          {current ? <MemberAvatar seed={current.avatarSeed} size={24} /> : <FounderAvatar size={24} />}
          <span className="text-[12px] font-medium max-w-[110px] truncate">{current ? current.displayName : `You (Founder)`}</span>
          <ChevronDown size={12} className="absolute right-1.5 text-muted pointer-events-none" />
          <select value={persona} onChange={(e) => setPersona(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Post as">
            <option value={FOUNDER_PERSONA} style={{ background: '#131726' }}>You (Founder) — {founderName}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} style={{ background: '#131726' }}>
                {m.displayName} (@{m.handle}){m.status !== 'active' ? ` — ${m.status}` : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="w-px h-6 bg-line shrink-0" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message #${channel.name}`}
          className="flex-1 min-w-0 bg-transparent outline-none text-[14px] placeholder:text-dim py-1" />
        <button type="submit" disabled={!text.trim() || sending}
          className={clsx('shrink-0 grid place-items-center w-9 h-9 rounded-xl transition-all cursor-pointer disabled:cursor-not-allowed',
            text.trim() ? 'brand-gradient text-white shadow-[0_6px_18px_-6px_rgba(139,92,246,0.8)]' : 'bg-white/[0.04] text-dim')}>
          {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizonal size={15} />}
        </button>
      </form>
      <div className="flex items-center justify-between gap-3 text-[10.5px] text-dim px-1 min-h-[14px] [&>span:first-child]:truncate [&>span:first-child]:min-w-0">
        {err ? <span className="text-danger">{err}</span> : current && current.status !== 'active'
          ? <span className="text-warn">@{current.handle} is {current.status} — Haven may block this post</span>
          : <span>Every message is screened by Nova in real time before it reaches the community.</span>}
        <span className="mono whitespace-nowrap shrink-0">Enter ↵ to send</span>
      </div>
    </div>
  );
}
