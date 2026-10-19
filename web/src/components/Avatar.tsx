import { useEffect, useMemo, useState } from 'react';
import { createAvatar } from '@dicebear/core';
import { notionists, lorelei } from '@dicebear/collection';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { speakingListeners, currentSpeaker } from '../lib/voice';
import { useHaven } from '../lib/store';

const cache = new Map<string, string>();
export function avatarUri(seed: string, style: 'agent' | 'member' = 'agent', bg?: string) {
  const key = `${style}:${seed}:${bg}`;
  if (!cache.has(key)) {
    const svg = style === 'agent'
      ? createAvatar(notionists, { seed, backgroundColor: [bg?.replace('#', '') ?? 'transparent'], scale: 110 }).toDataUri()
      : createAvatar(lorelei, { seed, backgroundColor: ['1c2135', '2a3150', '131726'], scale: 95 }).toDataUri();
    cache.set(key, svg);
  }
  return cache.get(key)!;
}

export function useSpeaking(agentId?: string | null) {
  const [speaking, setSpeaking] = useState(() => !!agentId && currentSpeaker() === agentId);
  useEffect(() => {
    const l = (id: string | null) => setSpeaking(!!agentId && id === agentId);
    speakingListeners.add(l);
    return () => { speakingListeners.delete(l); };
  }, [agentId]);
  return speaking;
}

/** AI employee avatar with live status ring (Masky identity). */
export function AgentAvatar({ id, size = 40, showStatus = true, className }: { id: string; size?: number; showStatus?: boolean; className?: string }) {
  const emp = useHaven((s) => s.workforce.find((w) => w.id === id));
  const status = useHaven((s) => s.agentStatus[id]?.status ?? 'idle');
  const speaking = useSpeaking(id);
  const color = emp?.color ?? '#8b5cf6';
  const uri = useMemo(() => emp?.maskyAvatar || avatarUri(emp?.avatarSeed ?? id, 'agent', '#1c2135'), [emp?.maskyAvatar, emp?.avatarSeed, id]);
  const busy = status !== 'idle' || speaking;
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      {busy && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 2px ${color}, 0 0 18px 2px ${color}88` }}
          animate={{ scale: speaking ? [1, 1.12, 1] : [1, 1.06, 1], opacity: [0.9, 0.5, 0.9] }}
          transition={{ duration: speaking ? 0.5 : 1.4, repeat: Infinity }}
        />
      )}
      <img src={uri} alt={emp?.name ?? id} className="relative rounded-full w-full h-full object-cover" style={{ boxShadow: `0 0 0 1.5px ${color}aa` }} />
      {showStatus && (
        <span
          className={clsx('absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-ink-900', busy ? 'animate-pulse' : '')}
          style={{ width: Math.max(9, size * 0.26), height: Math.max(9, size * 0.26), background: status === 'idle' && !speaking ? '#10b981' : status === 'waiting' ? '#f59e0b' : color }}
        />
      )}
    </div>
  );
}

/** Community member avatar. */
export function MemberAvatar({ seed, size = 36, className }: { seed: string; size?: number; className?: string }) {
  const uri = useMemo(() => avatarUri(seed, 'member'), [seed]);
  return <img src={uri} alt="" className={clsx('rounded-full shrink-0', className)} style={{ width: size, height: size }} />;
}

export function FounderAvatar({ size = 40 }: { size?: number }) {
  return (
    <div className="relative shrink-0 rounded-full brand-gradient grid place-items-center font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {(useHaven.getState().founder?.name ?? 'F')[0]}
    </div>
  );
}
