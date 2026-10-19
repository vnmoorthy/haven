import { AnimatePresence, motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import { AgentAvatar } from '../Avatar';
import { Empty, KindBadge, Panel, SeverityBadge, StatusBadge, TimeAgo, fmtMs } from '../ui';

const COLS = 'grid grid-cols-[112px_78px_minmax(0,1fr)_30px_128px_58px] items-center gap-3';

/** Compact live table of the newest incidents. */
export function LiveIncidents({ limit = 8 }: { limit?: number }) {
  const incidents = useHaven((s) => s.incidents);
  const nav = useNavigate();
  const rows = incidents.slice(0, limit);
  const open = incidents.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').length;

  return (
    <Panel title="Live incidents" icon={<ShieldAlert size={14} />} pad={false}
      actions={<>
        <span className="text-[11px] text-muted"><b className="text-fg mono">{open}</b> open</span>
        <Link to="/incidents" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">View all <ArrowUpRight size={12} /></Link>
      </>}>
      {rows.length === 0 ? (
        <Empty icon={<ShieldCheck size={24} />} title="No incidents yet" body="Haven is screening every message. Inject a threat from the Threat Lab to see the team respond." />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <div className="min-w-[640px]">
            <div className={clsx(COLS, 'px-4 py-2 text-[10.5px] uppercase tracking-wider text-dim border-b border-line')}>
              <span>Kind</span><span>Severity</span><span>Incident</span><span title="Assigned">Own</span><span>Status</span><span className="text-right">TTA</span>
            </div>
            <AnimatePresence initial={false}>
              {rows.map((i) => {
                const pending = i.status === 'awaiting_approval';
                return (
                  <motion.button key={i.id} layout="position" type="button"
                    initial={{ opacity: 0, x: -10, backgroundColor: 'rgba(139,92,246,0.14)' }}
                    animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(0,0,0,0)' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, backgroundColor: { duration: 2 } }}
                    onClick={() => nav(`/incidents/${i.id}`)}
                    className={clsx(COLS, 'relative w-full text-left px-4 py-2.5 border-b border-line/60 last:border-b-0 hover:!bg-white/[0.035] cursor-pointer')}>
                    {pending && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-warn animate-pulse" />}
                    <span><KindBadge k={i.kind} /></span>
                    <span><SeverityBadge s={i.severity} /></span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium truncate">{i.title}</span>
                      <span className="block text-[11px] text-dim truncate"><TimeAgo ts={i.createdAt} />{i.recommendedAction ? ` · recommends ${i.recommendedAction}` : ''}</span>
                    </span>
                    <span>{i.assignedTo ? <AgentAvatar id={i.assignedTo} size={26} /> : <span className="text-dim text-xs">—</span>}</span>
                    <span><StatusBadge s={i.status} /></span>
                    <span className="text-right mono text-[12px] tabular-nums">
                      {i.timeToActionMs != null ? <span className="text-ok">{fmtMs(i.timeToActionMs)}</span> : <span className="inline-flex items-center gap-1 text-muted"><span className="w-1.5 h-1.5 rounded-full bg-brand-violet animate-pulse" />live</span>}
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </Panel>
  );
}
