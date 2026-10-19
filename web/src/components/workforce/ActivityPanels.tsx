import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cloud, Cpu, HardDrive, Radio, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import { useHaven } from '../../lib/store';
import type { BandMessage, Employee, LlmCall } from '../../lib/types';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { Badge, Empty, Panel, TimeAgo, ToolChip, fmtMs, fmtUsd } from '../ui';
import { agentName } from './shared';

const KIND_COLOR: Record<string, string> = {
  delegate: '#a78bfa', report: '#34d399', request: '#60a5fa', broadcast: '#facc15', ack: '#8d93a8', handoff: '#f472b6',
};

function Party({ id }: { id: string }) {
  const workforce = useHaven((s) => s.workforce);
  if (id === 'founder') return <FounderAvatar size={20} />;
  if (workforce.some((w) => w.id === id)) return <AgentAvatar id={id} size={20} showStatus={false} />;
  return <span className="w-5 h-5 rounded-full bg-white/[0.08] grid place-items-center text-[8px] mono text-muted uppercase">{id.slice(0, 2)}</span>;
}

export function BandPanel({ emp, items }: { emp: Employee; items: BandMessage[] }) {
  const workforce = useHaven((s) => s.workforce);
  const nav = useNavigate();
  const list = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 14);
  return (
    <Panel title="Recent BAND messages" icon={<Radio size={14} />} actions={<ToolChip id="band" />} pad={false}>
      {list.length === 0 ? (
        <Empty icon={<Radio size={20} />} title="No messages yet" body={`${emp.name} hasn't sent or received any BAND messages yet. Fire a Threat Lab scenario to see the team coordinate.`} />
      ) : (
        <ul className="divide-y divide-line max-h-[420px] overflow-y-auto scroll-thin">
          <AnimatePresence initial={false}>
            {list.map((b) => {
              const outgoing = b.from === emp.id;
              return (
                <motion.li key={b.id} layout initial={{ opacity: 0, backgroundColor: `${emp.color}22` }} animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }} transition={{ duration: 0.8 }}
                  onClick={() => b.incidentId && nav(`/incidents/${b.incidentId}`)}
                  className={clsx('px-4 py-2.5', b.incidentId && 'cursor-pointer hover:bg-white/[0.03]')}>
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <Party id={String(b.from)} />
                    <span className={clsx('font-medium', outgoing && 'text-fg')}>{agentName(workforce, String(b.from))}</span>
                    <ArrowRight size={11} className="text-dim shrink-0" />
                    {b.to === 'all' ? <span className="font-medium">everyone</span> : <><Party id={String(b.to)} /><span className="font-medium">{agentName(workforce, String(b.to))}</span></>}
                    <Badge color={KIND_COLOR[b.kind] ?? '#8d93a8'} className="ml-1">{b.kind}</Badge>
                    <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-dim shrink-0">
                      {b.remote === 'band-cloud' ? <Cloud size={11} className="text-cyan-300" /> : <HardDrive size={11} />}
                      <TimeAgo ts={b.createdAt} />
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] font-medium truncate">{b.subject}</div>
                  {b.body && <div className="text-xs text-muted line-clamp-2 leading-snug">{b.body}</div>}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

export function LlmPanel({ emp, items, stats }: { emp: Employee; items: LlmCall[]; stats: Record<string, number> }) {
  const list = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  return (
    <Panel title="Recent model calls" icon={<Cpu size={14} />} pad={false}
      actions={<><span className="text-[11px] text-muted mono">{(stats.llmCalls ?? list.length).toLocaleString()} calls · {fmtUsd(Number(stats.costUsd) || 0)}</span><ToolChip id="flatkey" /></>}>
      {list.length === 0 ? (
        <Empty icon={<Cpu size={20} />} title="No model calls yet" body={`Every time ${emp.name} thinks, the call is routed through Flatkey and logged here with model, cost and latency.`} />
      ) : (
        <div className="overflow-x-auto scroll-thin max-h-[420px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-ink-900/95 backdrop-blur text-[10.5px] uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left font-medium px-4 py-2">Model</th>
                <th className="text-left font-medium px-2 py-2">Purpose</th>
                <th className="text-right font-medium px-2 py-2">Tokens</th>
                <th className="text-right font-medium px-2 py-2">Cost</th>
                <th className="text-right font-medium px-2 py-2">Latency</th>
                <th className="text-right font-medium px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((c) => {
                const offline = c.provider === 'offline-brain' || c.provider === 'local';
                return (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2 min-w-0">
                      <div className="mono text-[11.5px] text-fg truncate max-w-[180px]" title={c.model}>{c.model}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={clsx('mono text-[10px]', offline ? 'text-dim' : 'text-violet-300')}>{offline ? 'local' : c.provider}</span>
                        {c.fallback && <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300"><RotateCw size={9} />fallback</span>}
                        {!c.ok && <span className="text-[10px] text-rose-300">error</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted max-w-[160px] truncate" title={c.purpose}>{c.purpose}</td>
                    <td className="px-2 py-2 text-right mono tabular-nums text-muted">{((c.promptTokens ?? 0) + (c.completionTokens ?? 0)).toLocaleString()}</td>
                    <td className="px-2 py-2 text-right mono tabular-nums">{fmtUsd(Number(c.costUsd) || 0)}</td>
                    <td className="px-2 py-2 text-right mono tabular-nums text-muted">{fmtMs(c.latencyMs)}</td>
                    <td className="px-4 py-2 text-right text-dim whitespace-nowrap"><TimeAgo ts={c.createdAt} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
