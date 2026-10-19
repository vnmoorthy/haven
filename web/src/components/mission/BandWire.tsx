import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cloud, Radio, Server } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import { Badge, Empty, TimeAgo, ToolChip } from '../ui';
import { BAND_KIND_COLOR, ParticipantAvatar, participantColor, participantName } from './participants';

/** Live feed of BAND agent-to-agent messages. */
export function BandWire({ className, limit = 25 }: { className?: string; limit?: number }) {
  const band = useHaven((s) => s.band);
  const workforce = useHaven((s) => s.workforce);
  const nav = useNavigate();
  const items = useMemo(() => band.slice(-limit).reverse(), [band, limit]);
  const cloud = band.length > 0 && band[band.length - 1].remote === 'band-cloud';

  return (
    <section className={clsx('panel flex flex-col min-h-0 overflow-hidden', className)}>
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg/90 uppercase">
          <Radio size={14} className="text-muted" /> BAND wire
          <span className="relative flex w-1.5 h-1.5 ml-0.5"><span className="absolute inset-0 rounded-full bg-ok animate-ping" /><span className="relative w-1.5 h-1.5 rounded-full bg-ok" /></span>
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge color={cloud ? '#22d3ee' : '#8d93a8'}>{cloud ? <><Cloud size={10} /> band-cloud</> : <><Server size={10} /> local bus</>}</Badge>
          <ToolChip id="band" />
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-2 py-2">
        {items.length === 0 && (
          <Empty icon={<Radio size={22} />} title="Quiet on the wire" body="Fire a scenario from the Threat Lab and watch your AI employees coordinate in real time." />
        )}
        <AnimatePresence initial={false}>
          {items.map((b) => {
            const color = participantColor(b.from, workforce);
            const clickable = !!b.incidentId;
            return (
              <motion.div key={b.id} layout="position"
                initial={{ opacity: 0, y: -14, backgroundColor: `${color}26` }}
                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(255,255,255,0)' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.45, backgroundColor: { duration: 2.4 } }}
                onClick={() => clickable && nav(`/incidents/${b.incidentId}`)}
                className={clsx('relative rounded-xl px-2.5 py-2 mb-0.5 group', clickable && 'cursor-pointer hover:!bg-white/[0.04]')}>
                <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full opacity-70" style={{ background: color }} />
                <div className="flex items-center gap-1.5 min-w-0">
                  <ParticipantAvatar id={b.from} size={20} />
                  <ArrowRight size={11} className="text-dim shrink-0" />
                  <ParticipantAvatar id={b.to} size={20} />
                  <span className="text-[11.5px] text-muted truncate ml-0.5">
                    <b className="text-fg font-medium">{participantName(b.from, workforce)}</b> → <b className="text-fg/80 font-medium">{participantName(b.to, workforce)}</b>
                  </span>
                  <span className="ml-auto pl-1 text-[10.5px] text-dim whitespace-nowrap"><TimeAgo ts={b.createdAt} /></span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 min-w-0">
                  <span className="text-[9.5px] uppercase tracking-wider font-semibold mono shrink-0" style={{ color: BAND_KIND_COLOR[b.kind] }}>{b.kind}</span>
                  <span className="text-[12.5px] font-medium truncate">{b.subject}</span>
                </div>
                {b.body && <div className="text-[11.5px] text-muted leading-snug line-clamp-2 mt-0.5">{b.body}</div>}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
