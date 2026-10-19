import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import type { Member } from '../../lib/types';
import { AgentAvatar, MemberAvatar } from '../Avatar';
import { Badge } from '../ui';

const ROLE_RANK: Record<Member['role'], number> = { admin: 0, moderator: 1, member: 2, bot: 3 };
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const trustColor = (t: number) => (t >= 75 ? '#10b981' : t >= 50 ? '#f59e0b' : '#f43f5e');

/** Members of the selected community plus the Haven agents present in it. */
export function MembersList({ communityId, recentPosters }: { communityId: string; recentPosters: Set<string> }) {
  const membersMap = useHaven((s) => s.members);
  const workforce = useHaven((s) => s.workforce);
  const nav = useNavigate();
  const members = useMemo(() => Object.values(membersMap).filter((m) => m.communityId === communityId), [membersMap, communityId]);
  const rows = useMemo(() => members.map((m) => ({
    m, online: m.status !== 'banned' && (recentPosters.has(m.id) || hash(m.id) % 3 !== 0),
  })).sort((a, b) => Number(b.online) - Number(a.online) || ROLE_RANK[a.m.role] - ROLE_RANK[b.m.role] || a.m.displayName.localeCompare(b.m.displayName)), [members, recentPosters]);
  const online = rows.filter((r) => r.online).length;

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-t border-line">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dim font-medium"><Users size={12} /> Members — {members.length}</div>
        <span className="text-[11px] text-muted"><span className="inline-block w-1.5 h-1.5 rounded-full bg-ok mr-1 align-middle" />{online} online</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-2 pb-3">
        <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-dim">Haven · on shift</div>
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          {workforce.map((w) => (
            <button key={w.id} type="button" title={`${w.name} — ${w.title}`} onClick={() => nav(`/workforce/${w.id}`)} className="cursor-pointer rounded-full hover:scale-110 transition-transform">
              <AgentAvatar id={w.id} size={28} />
            </button>
          ))}
        </div>
        <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-dim">Community</div>
        {rows.map(({ m, online: on }) => (
          <motion.div key={m.id} layout="position" className={clsx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]', m.status === 'banned' && 'opacity-55')}>
            <div className="relative shrink-0">
              <MemberAvatar seed={m.avatarSeed} size={28} className={clsx(m.status === 'banned' && 'grayscale')} />
              <span className={clsx('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-ink-900', on ? 'bg-ok' : 'bg-dim')} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={clsx('text-[12.5px] font-medium truncate', m.status === 'banned' && 'line-through text-rose-300', !on && m.status !== 'banned' && 'text-muted')}>{m.displayName}</span>
                {m.role === 'moderator' && <Badge color="#22d3ee">mod</Badge>}
                {m.role === 'admin' && <Badge color="#f43f5e">admin</Badge>}
                {m.role === 'bot' && <Badge color="#a3e635">bot</Badge>}
              </div>
              <div className="text-[10.5px] text-dim truncate">@{m.handle}</div>
            </div>
            {m.status === 'banned' ? <Badge color="#f43f5e" dot>banned</Badge> : m.status === 'muted' ? <Badge color="#f59e0b" dot>muted</Badge> : (
              <span className="flex flex-col items-end gap-0.5" title="Trust score">
                <span className="text-[10.5px] mono tabular-nums" style={{ color: trustColor(m.trustScore) }}>{Math.round(m.trustScore)}</span>
                <span className="w-9 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, m.trustScore))}%`, background: trustColor(m.trustScore) }} />
                </span>
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
