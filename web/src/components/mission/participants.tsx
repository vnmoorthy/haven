import clsx from 'clsx';
import { MessagesSquare, Radio, Rocket, Workflow, type LucideIcon } from 'lucide-react';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { useHaven } from '../../lib/store';
import type { BandMessage, Employee } from '../../lib/types';

/** Non-employee BAND participants: the community gateway, n8n workflows, RocketRide pipelines and broadcasts. */
export const SYSTEM_META: Record<string, { label: string; sub: string; color: string; icon: LucideIcon; tool?: string }> = {
  gateway: { label: 'Community', sub: 'gateway', color: '#f472b6', icon: MessagesSquare },
  n8n: { label: 'n8n', sub: 'automations', color: '#ea4b71', icon: Workflow, tool: 'n8n' },
  rocketride: { label: 'RocketRide', sub: '.pipe pipelines', color: '#f97316', icon: Rocket, tool: 'rocketride' },
  all: { label: 'All hands', sub: 'broadcast', color: '#22d3ee', icon: Radio },
};

export const FOUNDER_COLOR = '#c4b5fd';

export const BAND_KIND_COLOR: Record<BandMessage['kind'], string> = {
  delegate: '#a78bfa', report: '#10b981', request: '#f59e0b', broadcast: '#22d3ee', ack: '#8d93a8', handoff: '#f472b6',
};

export function participantColor(id: string, workforce: Employee[]) {
  if (id === 'founder') return FOUNDER_COLOR;
  return workforce.find((w) => w.id === id)?.color ?? SYSTEM_META[id]?.color ?? '#8d93a8';
}

export function participantName(id: string, workforce: Employee[]) {
  if (id === 'founder') return 'You';
  const emp = workforce.find((w) => w.id === id);
  if (emp) return emp.name;
  return SYSTEM_META[id]?.label ?? id;
}

/** Avatar for any BAND participant: employee faces, founder monogram or an icon chip for system participants. */
export function ParticipantAvatar({ id, size = 22, className }: { id: string; size?: number; className?: string }) {
  const isAgent = useHaven((s) => s.workforce.some((w) => w.id === id));
  if (isAgent) return <AgentAvatar id={id} size={size} showStatus={false} className={className} />;
  if (id === 'founder') return <FounderAvatar size={size} />;
  const meta = SYSTEM_META[id];
  const Icon = meta?.icon ?? Radio;
  const color = meta?.color ?? '#8d93a8';
  return (
    <span className={clsx('shrink-0 grid place-items-center rounded-full', className)}
      style={{ width: size, height: size, background: `${color}1f`, boxShadow: `0 0 0 1.5px ${color}88`, color }}>
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}
