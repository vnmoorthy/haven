import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, Hash, Pause, Play, ShieldCheck, ShieldAlert, Users } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../lib/store';
import { api } from '../lib/api';
import type { Message } from '../lib/types';
import { AgentAvatar } from '../components/Avatar';
import { Badge, Empty, Spinner } from '../components/ui';
import { MessageRow } from '../components/community/MessageRow';
import { Composer } from '../components/community/Composer';
import { ShieldPanel } from '../components/community/ShieldPanel';
import { MembersList } from '../components/community/MembersList';

const LS_KEY = 'haven.community.sel';
const readSel = (): { c?: string; ch: Record<string, string> } => {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    return { c: typeof v?.c === 'string' ? v.c : undefined, ch: v?.ch && typeof v.ch === 'object' ? v.ch : {} };
  } catch { return { ch: {} }; }
};
const isFlagged = (m: Message) => m.status !== 'visible' || !!m.incidentId || m.risk >= 30;

export default function Community() {
  const communities = useHaven((s) => s.communities);
  const channels = useHaven((s) => s.channels);
  const allMessages = useHaven((s) => s.messages);
  const membersMap = useHaven((s) => s.members);
  const incidents = useHaven((s) => s.incidents);
  const sim = useHaven((s) => s.sim);
  const captionOn = useHaven((s) => s.captions.length > 0);
  const workforce = useHaven((s) => s.workforce);
  const [params] = useSearchParams();

  const [sel, setSel] = useState(readSel);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(sel)); } catch { /* ignore */ } }, [sel]);

  // Deep link support: /community?channel=<id>&message=<id>
  const [selectedId, setSelectedId] = useState<string | null>(params.get('message'));
  useEffect(() => {
    const chId = params.get('channel');
    const ch = chId ? channels.find((c) => c.id === chId) : undefined;
    if (ch) setSel((s) => ({ c: ch.communityId, ch: { ...s.ch, [ch.communityId]: ch.id } }));
    if (params.get('message')) setSelectedId(params.get('message'));
  }, [params, channels]);

  const community = communities.find((c) => c.id === sel.c) ?? communities[0];
  const chans = useMemo(() => channels.filter((c) => c.communityId === community?.id), [channels, community?.id]);
  const channel = chans.find((c) => c.id === sel.ch[community?.id ?? '']) ?? chans[0];

  const messages = useMemo(() => allMessages.filter((m) => m.channelId === channel?.id).sort((a, b) => a.createdAt - b.createdAt), [allMessages, channel?.id]);
  const flaggedByChannel = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of allMessages) if (m.status === 'quarantined' || m.status === 'under_review') out[m.channelId] = (out[m.channelId] ?? 0) + 1;
    return out;
  }, [allMessages]);
  const openByCommunity = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of incidents) if (i.communityId && i.status !== 'resolved' && i.status !== 'dismissed') out[i.communityId] = (out[i.communityId] ?? 0) + 1;
    return out;
  }, [incidents]);
  const recentPosters = useMemo(() => {
    const cut = Date.now() - 20 * 60 * 1000;
    const chanIds = new Set(chans.map((c) => c.id));
    return new Set(allMessages.filter((m) => m.memberId && m.createdAt > cut && chanIds.has(m.channelId)).map((m) => m.memberId!));
  }, [allMessages, chans]);

  const selectCommunity = (id: string) => { setSel((s) => ({ ...s, c: id })); setSelectedId(null); };
  const selectChannel = (id: string) => { if (!community) return; setSel((s) => ({ c: community.id, ch: { ...s.ch, [community.id]: id } })); setSelectedId(null); };

  const selected = selectedId ? messages.find((m) => m.id === selectedId) ?? null : null;
  const latestFlagged = useMemo(() => [...messages].reverse().find(isFlagged) ?? null, [messages]);
  const focus = selected ?? latestFlagged;

  // Scroll management: stick to bottom unless the user scrolled up.
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    stick.current = near;
    if (near) setUnseen(0);
  };
  const toBottom = (smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stick.current = true; setUnseen(0);
  };
  useLayoutEffect(() => { toBottom(false); }, [channel?.id]);
  const lastId = messages[messages.length - 1]?.id;
  const prevLast = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!lastId || prevLast.current === lastId) return;
    const first = prevLast.current === undefined;
    prevLast.current = lastId;
    if (first || stick.current) requestAnimationFrame(() => toBottom(!first));
    else setUnseen((u) => u + 1);
  }, [lastId]);

  const [toggling, setToggling] = useState(false);
  const toggleSim = async () => {
    setToggling(true);
    try {
      const r = await api.post<{ running: boolean }>('/api/sim/toggle', { running: !sim.running });
      if (typeof r?.running === 'boolean') useHaven.setState({ sim: { running: r.running } });
    } finally { setToggling(false); }
  };

  const underReview = messages.some((m) => m.status === 'under_review' && !m.incidentId);
  const flaggedHere = messages.filter((m) => m.status === 'quarantined' || m.status === 'removed').length;

  if (!community || !channel) {
    return <div className="panel"><Empty icon={<Users size={24} />} title="No communities yet" body="Onboard a community from the Sponsor Stack or reset the demo data." /></div>;
  }

  return (
    <div style={{ height: captionOn ? 'calc(100vh - 186px)' : 'calc(100vh - 104px)' }}
      className="panel overflow-hidden min-h-[560px] transition-[height] duration-300 ease-out grid grid-rows-[minmax(0,1fr)] grid-cols-[64px_200px_minmax(0,1fr)_300px] 2xl:grid-cols-[72px_236px_minmax(0,1fr)_360px]">
      {/* Community rail */}
      <nav className="bg-ink-950/60 border-r border-line flex flex-col items-center gap-2 py-3 overflow-y-auto scroll-thin">
        {communities.map((c) => {
          const active = c.id === community.id;
          const open = openByCommunity[c.id] ?? 0;
          return (
            <button key={c.id} type="button" onClick={() => selectCommunity(c.id)} title={`${c.name} · ${c.members.toLocaleString()} members`}
              className="relative group cursor-pointer">
              {active && <motion.span layoutId="community-pill" className="absolute -left-[13px] 2xl:-left-[17px] top-1.5 bottom-1.5 w-1 rounded-r-full bg-fg" />}
              <span className={clsx('grid place-items-center w-11 h-11 text-[22px] transition-all duration-200', active ? 'rounded-[14px]' : 'rounded-[22px] group-hover:rounded-[14px]')}
                style={{ background: active ? `${c.color}40` : `${c.color}1c`, boxShadow: active ? `0 0 0 1.5px ${c.color}, 0 0 20px -4px ${c.color}` : undefined }}>
                {c.icon}
              </span>
              {open > 0 && <span className="absolute -bottom-0.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center border-2 border-ink-950">{open}</span>}
            </button>
          );
        })}
        <div className="mt-auto pt-2 flex flex-col items-center gap-1 text-dim" title="Protected by Haven">
          <ShieldCheck size={18} className="text-ok" />
        </div>
      </nav>

      {/* Channels */}
      <aside className="bg-ink-900/50 border-r border-line flex flex-col min-h-0">
        <div className="px-4 pt-3.5 pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{community.icon}</span>
            <span className="font-semibold text-[14.5px] truncate">{community.name}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <Badge color={community.color}>{community.plan}</Badge>
            <span className="text-[11px] text-muted">{community.members.toLocaleString()} members</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-2 py-2.5">
          <div className="px-2 pb-1.5 text-[10.5px] uppercase tracking-wider text-dim font-medium">Text channels</div>
          {chans.map((c) => {
            const active = c.id === channel.id;
            const n = flaggedByChannel[c.id] ?? 0;
            return (
              <button key={c.id} type="button" onClick={() => selectChannel(c.id)}
                className={clsx('relative w-full text-left rounded-lg px-2 py-1.5 mb-0.5 cursor-pointer transition-colors', active ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg hover:bg-white/[0.04]')}>
                <span className="flex items-center gap-1.5">
                  <Hash size={14} className="shrink-0 opacity-70" />
                  <span className="text-[13.5px] font-medium truncate flex-1">{c.name}</span>
                  {n > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-danger/20 text-rose-300 text-[10px] font-semibold px-1.5 py-px"><ShieldAlert size={9} />{n}</span>}
                </span>
                {active && <span className="block text-[10.5px] text-dim pl-5 mt-0.5 truncate">{c.topic}</span>}
              </button>
            );
          })}
        </div>
        <div className="p-3 border-t border-line space-y-2">
          <button type="button" onClick={toggleSim} disabled={toggling}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.03] hover:bg-white/[0.06] px-3 py-2 cursor-pointer disabled:opacity-60">
            <span className="text-left">
              <span className="block text-[12px] font-medium">Live traffic</span>
              <span className="block text-[10.5px] text-dim">{sim.running ? 'simulated members chatting' : 'paused'}</span>
            </span>
            <span className={clsx('relative w-9 h-5 rounded-full transition-colors shrink-0', sim.running ? 'bg-ok/80' : 'bg-white/[0.12]')}>
              <motion.span layout className="absolute top-0.5 w-4 h-4 rounded-full bg-white grid place-items-center text-ink-900" style={{ left: sim.running ? 18 : 2 }}>
                {toggling ? <Spinner className="!w-2.5 !h-2.5 !border-[1.5px] !border-ink-900/30 !border-t-ink-900" /> : sim.running ? <Pause size={8} /> : <Play size={8} />}
              </motion.span>
            </span>
          </button>
          <div className="flex items-center gap-2 text-[10.5px] text-dim px-1">
            <ShieldCheck size={12} className="text-ok shrink-0" /> Protected by {workforce.length} Haven agents
          </div>
        </div>
      </aside>

      {/* Messages */}
      <main className="flex flex-col min-h-0 min-w-0 bg-ink-900/30">
        <header className="h-[52px] shrink-0 flex items-center gap-2.5 px-4 border-b border-line">
          <Hash size={18} className="text-muted shrink-0" />
          <span className="font-semibold text-[15px]">{channel.name}</span>
          <span className="w-px h-4 bg-line hidden md:block" />
          <span className="text-[12px] text-muted truncate hidden md:block flex-1 min-w-0">{channel.topic}</span>
          <span className="flex-1 md:hidden" />
          <span className="shrink-0 hidden 2xl:inline-flex items-center gap-1.5 text-[11px] text-muted">
            <b className="text-fg mono">{messages.length}</b> screened · <b className={clsx('mono', flaggedHere ? 'text-rose-300' : 'text-fg')}>{flaggedHere}</b> stopped
          </span>
          <div className="shrink-0 flex -space-x-1.5 pl-1" title="Haven agents watching this channel">
            {['nova', 'rex', 'mira'].filter((id) => workforce.some((w) => w.id === id)).map((id) => <AgentAvatar key={id} id={id} size={22} showStatus={false} className="ring-2 ring-ink-900 rounded-full" />)}
          </div>
        </header>

        <div className="relative flex-1 min-h-0">
          <div ref={listRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto scroll-thin py-3">
            {messages.length === 0 ? (
              <Empty icon={<Hash size={26} />} title={`Welcome to #${channel.name}`} body="No messages yet. Post as a member or simulate a threat to watch Haven respond." />
            ) : (
              <>
                <div className="px-4 pb-3 mb-1 border-b border-line/60">
                  <div className="w-11 h-11 rounded-full grid place-items-center bg-white/[0.06] mb-2"><Hash size={22} className="text-muted" /></div>
                  <div className="text-[17px] font-semibold">#{channel.name}</div>
                  <div className="text-[12px] text-muted">{channel.topic} · every message is screened by Haven before members see it.</div>
                </div>
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const compact = !!prev && prev.authorKind === m.authorKind && prev.memberId === m.memberId && prev.agentId === m.agentId
                    && m.createdAt - prev.createdAt < 5 * 60 * 1000 && prev.status === 'visible';
                  return (
                    <MessageRow key={m.id} message={m} member={m.memberId ? membersMap[m.memberId] : undefined} compact={compact}
                      selected={focus?.id === m.id && !!selectedId} onSelect={() => setSelectedId((s) => (s === m.id ? null : m.id))} />
                  );
                })}
              </>
            )}
          </div>
          <AnimatePresence>
            {unseen > 0 && (
              <motion.button type="button" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                onClick={() => toBottom()} className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full brand-gradient px-3 py-1.5 text-[12px] font-medium text-white shadow-lg cursor-pointer">
                <ArrowDown size={13} /> {unseen} new message{unseen === 1 ? '' : 's'}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className="h-5 px-5 text-[11px] text-muted flex items-center">
          {underReview && <span className="inline-flex items-center gap-1.5"><span className="flex gap-0.5">{[0, 1, 2].map((d) => <motion.span key={d} className="w-1 h-1 rounded-full bg-brand-cyan" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }} />)}</span> Nova is screening a new message…</span>}
        </div>
        <Composer channel={channel} onSent={() => { stick.current = true; }} />
      </main>

      {/* Haven Shield */}
      <aside className="border-l border-line bg-ink-950/40 flex flex-col min-h-0">
        <div className="max-h-[68%] min-h-0 flex flex-col">
          <ShieldPanel message={focus} auto={!selected} channelName={channel.name} />
        </div>
        <div className="flex-1 min-h-0">
          <MembersList communityId={community.id} recentPosters={recentPosters} />
        </div>
      </aside>
    </div>
  );
}
