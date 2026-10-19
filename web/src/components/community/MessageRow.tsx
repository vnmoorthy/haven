import { useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import type { Member, Message } from '../../lib/types';
import { AgentAvatar, FounderAvatar, MemberAvatar } from '../Avatar';
import { Badge, RiskMeter, Spinner } from '../ui';
import { RichText } from './RichText';

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ROLE_COLOR: Record<string, string> = { admin: '#f43f5e', moderator: '#22d3ee', bot: '#a3e635' };

export function MessageRow({ message: m, member, compact, selected, onSelect }: {
  message: Message; member?: Member; compact: boolean; selected: boolean; onSelect: () => void;
}) {
  const emp = useHaven((s) => (m.agentId ? s.workforce.find((w) => w.id === m.agentId) : undefined));
  const founderName = useHaven((s) => s.founder?.name ?? 'Founder');
  const nova = useHaven((s) => s.workforce.find((w) => w.id === 'nova'));
  const [peek, setPeek] = useState(false);

  if (m.authorKind === 'system') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 justify-center py-2 px-4 text-[11.5px] text-muted">
        <span className="h-px flex-1 bg-line" />
        <ShieldCheck size={12} className="text-ok shrink-0" />
        <span className="text-center"><RichText text={m.content} /></span>
        <span className="h-px flex-1 bg-line" />
      </motion.div>
    );
  }

  const flagged = m.status !== 'visible';
  const accent = m.status === 'quarantined' ? '#f43f5e' : m.status === 'under_review' ? '#22d3ee' : m.status === 'removed' ? '#5d6379' : m.authorKind === 'agent' ? emp?.color : undefined;
  const name = m.authorKind === 'agent' ? emp?.name ?? m.agentId ?? 'Haven' : m.authorKind === 'founder' ? founderName : member?.displayName ?? 'Unknown member';
  const nameColor = m.authorKind === 'agent' ? emp?.color : m.authorKind === 'founder' ? '#c4b5fd' : member?.status === 'banned' ? '#f43f5e' : undefined;
  const dangerous = m.risk >= 55 || m.status === 'quarantined';
  const showCompact = compact && !flagged;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      onClick={onSelect}
      className={clsx('group relative flex gap-3 px-4 cursor-pointer transition-colors', showCompact ? 'py-0.5' : 'pt-2.5 pb-1.5 mt-1',
        selected ? 'bg-white/[0.055]' : 'hover:bg-white/[0.025]', m.authorKind === 'agent' && !selected && 'bg-gradient-to-r from-white/[0.025] to-transparent')}>
      {accent && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full" style={{ background: accent, opacity: m.authorKind === 'agent' && !flagged ? 0.7 : 1 }} />}

      <div className="w-9 shrink-0 pt-0.5">
        {showCompact ? (
          <span className="block text-[10px] text-dim mono opacity-0 group-hover:opacity-100 pt-1">{clock(m.createdAt)}</span>
        ) : m.authorKind === 'agent' && m.agentId ? (
          <AgentAvatar id={m.agentId} size={36} />
        ) : m.authorKind === 'founder' ? (
          <FounderAvatar size={36} />
        ) : (
          <MemberAvatar seed={member?.avatarSeed ?? m.memberId ?? 'x'} size={36} className={clsx(member?.status === 'banned' && 'grayscale opacity-60')} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!showCompact && (
          <div className="flex items-center gap-2 flex-wrap leading-tight">
            <span className={clsx('text-[14px] font-semibold', member?.status === 'banned' && 'line-through')} style={{ color: nameColor }}>{name}</span>
            {m.authorKind === 'agent' && emp && <Badge color={emp.color}>Haven · {emp.title}</Badge>}
            {m.authorKind === 'founder' && <Badge color="#a78bfa">Founder</Badge>}
            {member && member.role !== 'member' && <Badge color={ROLE_COLOR[member.role] ?? '#8d93a8'}>{member.role}</Badge>}
            {member?.status === 'banned' && <Badge color="#f43f5e" dot>banned</Badge>}
            {member?.status === 'muted' && <Badge color="#f59e0b" dot>muted</Badge>}
            {member && m.authorKind === 'member' && <span className="text-[11px] text-dim">@{member.handle}</span>}
            <span className="text-[11px] text-dim" title={new Date(m.createdAt).toLocaleString()}>{clock(m.createdAt)}</span>
          </div>
        )}

        <div className={clsx('text-[14px] leading-relaxed text-fg/90', !showCompact && 'mt-0.5')}>
          {m.status === 'removed' ? (
            <span className="inline-flex items-center gap-1.5 text-dim italic line-through decoration-dim/60">
              <Trash2 size={13} className="not-italic" /> Message removed by Haven
            </span>
          ) : m.status === 'quarantined' ? (
            <div className="relative rounded-lg overflow-hidden my-0.5 min-h-[44px]">
              <div className={clsx('transition-all duration-300 px-2 py-1.5', peek ? 'bg-danger/[0.06]' : 'blur-sm select-none pointer-events-none')} aria-hidden={!peek}>
                <RichText text={m.content} dangerous />
              </div>
              {!peek && <div className="absolute inset-0 bg-ink-900/40" />}
              <div className={clsx('flex items-center gap-2 flex-wrap', peek ? 'px-2 pb-1.5' : 'absolute inset-0 justify-center px-2')}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/50 bg-ink-900/90 px-2.5 py-1 text-[11.5px] font-medium text-rose-200 shadow-lg">
                  🛡 Quarantined by Haven{m.labels.length ? ` — ${m.labels.join(', ')}` : ''}
                </span>
                {m.incidentId && (
                  <Link to={`/incidents/${m.incidentId}`} onClick={(e) => e.stopPropagation()}
                    className="rounded-full border border-line-strong bg-ink-900/90 px-2.5 py-1 text-[11.5px] text-fg hover:bg-white/[0.08]">View incident →</Link>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); setPeek((p) => !p); }} title={peek ? 'Hide content' : 'Moderator peek'}
                  className="rounded-full border border-line-strong bg-ink-900/90 p-1.5 text-muted hover:text-fg cursor-pointer">
                  {peek ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
          ) : m.status === 'under_review' ? (
            <div>
              <div className="relative rounded-md overflow-hidden">
                <RichText text={m.content} dangerous={dangerous} />
                {!m.incidentId && <div className="absolute inset-0 shimmer pointer-events-none" />}
              </div>
              {m.incidentId ? (
                <span className="mt-1 inline-flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border border-warn/40 bg-warn/10 text-amber-300">
                    <ShieldCheck size={11} /> Held for review by Haven{m.labels.length ? ` — ${m.labels.join(', ')}` : ''}
                  </span>
                  <Link to={`/incidents/${m.incidentId}`} onClick={(e) => e.stopPropagation()} className="text-[11px] text-muted hover:text-fg">View incident →</Link>
                </span>
              ) : (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border"
                  style={{ color: nova?.color ?? '#22d3ee', borderColor: `${nova?.color ?? '#22d3ee'}44`, background: `${nova?.color ?? '#22d3ee'}12` }}>
                  <Spinner className="!w-3 !h-3 !border-[1.5px]" /> Nova is screening…
                </span>
              )}
            </div>
          ) : (
            <RichText text={m.content} dangerous={dangerous} />
          )}
        </div>
      </div>

      {(m.risk > 0 || m.labels.length > 0) && m.status !== 'removed' && (
        <div className={clsx('absolute right-3 top-1.5 items-center gap-2 rounded-lg border border-line bg-ink-850/95 px-2 py-1 shadow-xl z-10',
          selected ? 'flex' : 'hidden group-hover:flex')}>
          <span className="text-[10px] uppercase tracking-wider text-dim">risk</span>
          <RiskMeter value={m.risk} size="sm" />
          {m.labels.slice(0, 3).map((l) => <Badge key={l} color={dangerous ? '#f43f5e' : '#f59e0b'}>{l}</Badge>)}
        </div>
      )}
    </motion.div>
  );
}
