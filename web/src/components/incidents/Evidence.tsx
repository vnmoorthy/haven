import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  ArrowRight, CircleAlert, FileText, Globe, Hash, KeyRound, LockKeyholeOpen, Maximize2, RotateCw, ScanSearch, ShieldCheck, ShieldX, X,
} from 'lucide-react';
import type { Channel, ForensicReport, Member, Message } from '../../lib/types';
import type { ForensicStep } from '../../lib/store';
import { asset } from '../../lib/api';
import { MemberAvatar } from '../Avatar';
import { Badge, Spinner, TimeAgo, ToolChip, fmtMs } from '../ui';
import { HighlightUrls, ScoreRing, SectionLabel } from './shared';

const MSG_STATUS: Record<string, string> = { visible: '#10b981', under_review: '#f59e0b', quarantined: '#f97316', removed: '#f43f5e' };
const MEMBER_STATUS: Record<string, string> = { active: '#10b981', muted: '#f59e0b', banned: '#f43f5e' };
export const VERDICT_COLOR: Record<string, string> = { malicious: '#f43f5e', suspicious: '#f59e0b', benign: '#10b981', unreachable: '#8d93a8' };

export function MessageEvidence({ message, member, channel }: { message: Message | null; member: Member | null; channel: Channel | null }) {
  if (!message) return <div className="text-xs text-muted">No source message — this incident was raised by a scan, not a post.</div>;
  return (
    <div className="rounded-xl border border-line bg-black/25 p-3">
      <div className="flex items-center gap-2.5">
        {member ? <MemberAvatar seed={member.avatarSeed} size={34} /> : <span className="w-[34px] h-[34px] rounded-full bg-white/10" />}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-semibold truncate">{member?.displayName ?? (message.authorKind === 'agent' ? message.agentId : 'Unknown')}</div>
          <div className="text-[11px] text-dim truncate">
            {member && <>@{member.handle} · </>}
            {channel && <span className="inline-flex items-center"><Hash size={10} />{channel.name}</span>} · <TimeAgo ts={message.createdAt} />
          </div>
        </div>
        <Badge color={MSG_STATUS[message.status] ?? '#8d93a8'} dot>{message.status.replace('_', ' ')}</Badge>
      </div>
      <div className={clsx('mt-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 border-l-2',
        message.status === 'removed' ? 'border-rose-500/60 bg-rose-500/[0.04] text-fg/70' : 'border-amber-400/50 bg-white/[0.02]')}>
        <HighlightUrls text={message.content} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <span className="text-[10.5px] text-dim mr-1">risk <span className="mono text-fg/80">{Math.round(message.risk ?? 0)}</span></span>
        {(message.labels ?? []).map((l) => <Badge key={l} color="#a78bfa" className="!text-[10px]">{l}</Badge>)}
      </div>
    </div>
  );
}

export function MemberEvidence({ member }: { member: Member | null }) {
  if (!member) return null;
  const trust = member.trustScore <= 1 ? member.trustScore * 100 : member.trustScore;
  const tColor = trust >= 70 ? '#10b981' : trust >= 40 ? '#f59e0b' : '#f43f5e';
  const ageDays = Math.max(0, Math.round((Date.now() - member.joinedAt) / 86_400_000));
  return (
    <div className="rounded-xl border border-line bg-white/[0.015] p-3 flex items-center gap-3">
      <ScoreRing value={trust} size={52} stroke={5} color={tColor}>
        <span className="mono text-[13px] font-semibold" style={{ color: tColor }}>{Math.round(trust)}</span>
      </ScoreRing>
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] uppercase tracking-wider text-muted">Member trust score</div>
        <div className="text-[13px] font-medium truncate">{member.displayName} <span className="text-dim font-normal">@{member.handle}</span></div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <Badge color={MEMBER_STATUS[member.status] ?? '#8d93a8'} dot>{member.status}</Badge>
          <Badge color="#8d93a8">{member.role}</Badge>
          <span className="text-[10.5px] text-dim">joined {ageDays === 0 ? 'today' : `${ageDays}d ago`}</span>
        </div>
      </div>
    </div>
  );
}

/** Browser-chrome frame around a sandbox screenshot. */
export function BrowserFrame({ url, src, title, danger = true, onExpand }: { url: string; src?: string; title?: string; danger?: boolean; onExpand?: () => void }) {
  return (
    <div className="rounded-xl overflow-hidden border border-line-strong bg-ink-900 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 px-2.5 py-2 bg-ink-800 border-b border-line">
        <span className="flex gap-1"><i className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" /><i className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" /><i className="w-2.5 h-2.5 rounded-full bg-[#28c840]" /></span>
        <div className={clsx('flex-1 min-w-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] mono border',
          danger ? 'bg-rose-500/[0.08] border-rose-500/30 text-rose-200' : 'bg-white/[0.04] border-line text-muted')}>
          {danger ? <LockKeyholeOpen size={11} className="text-rose-400 shrink-0" /> : <ShieldCheck size={11} className="text-emerald-400 shrink-0" />}
          <span className="truncate">{url}</span>
        </div>
        {onExpand && src && <button onClick={onExpand} className="text-dim hover:text-fg cursor-pointer" title="Expand screenshot"><Maximize2 size={13} /></button>}
      </div>
      <div className="relative bg-white/[0.02] min-h-[120px]">
        {src ? (
          <button onClick={onExpand} className="block w-full cursor-zoom-in">
            <img src={src} alt={title ?? 'Sandbox screenshot'} className="w-full max-h-[260px] object-cover object-top" />
          </button>
        ) : (
          <div className="h-[140px] grid place-items-center text-center px-6">
            <div>
              <Globe size={22} className="mx-auto text-dim mb-2" />
              <div className="text-[12px] text-muted">{title || 'No screenshot captured'}</div>
            </div>
          </div>
        )}
        {danger && src && (
          <div className="absolute top-2 right-2 rotate-3 rounded-md border-2 border-rose-500/80 text-rose-400 bg-ink-950/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] uppercase">
            Detonated in sandbox
          </div>
        )}
      </div>
    </div>
  );
}

export function ForensicsReportView({ report }: { report: ForensicReport }) {
  const [zoom, setZoom] = useState(false);
  const vColor = VERDICT_COLOR[report.verdict] ?? '#8d93a8';
  const danger = report.verdict === 'malicious' || report.verdict === 'suspicious';
  const maxW = Math.max(1, ...report.signals.map((s) => Math.abs(s.weight)));
  const shot = report.screenshot ? asset(report.screenshot) : undefined;

  return (
    <div className="space-y-4">
      <BrowserFrame url={report.finalUrl || report.url} src={shot} title={report.title} danger={danger} onExpand={() => setZoom(true)} />

      <div className="flex items-center gap-4">
        <ScoreRing value={report.score} size={76} stroke={7} color={vColor}>
          <span className="text-[20px] font-semibold tabular-nums" style={{ color: vColor }}>{Math.round(report.score)}</span>
          <span className="text-[9px] uppercase tracking-wider text-dim mt-0.5">score</span>
        </ScoreRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {danger ? <ShieldX size={16} style={{ color: vColor }} /> : <ShieldCheck size={16} style={{ color: vColor }} />}
            <span className="text-[15px] font-semibold uppercase tracking-wide" style={{ color: vColor }}>{report.verdict}</span>
          </div>
          <div className="text-[12px] text-muted truncate mt-0.5" title={report.title}>{report.title || 'Untitled page'}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {report.engine === 'celesto' ? <ToolChip id="celesto" /> : <Badge color="#8d93a8">local-sandbox</Badge>}
            {report.driver === 'adal' ? <ToolChip id="adal" /> : <Badge color="#8d93a8">playwright · local</Badge>}
            <span className="mono text-[10.5px] text-dim">{fmtMs(report.durationMs)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <Fact label="Host" value={report.domain?.host} mono />
        <Fact label="Look-alike of" value={report.domain?.lookalikeOf ?? 'none'} mono danger={!!report.domain?.lookalikeOf} />
        <Fact label="Entropy" value={report.domain?.entropy != null ? report.domain.entropy.toFixed(2) : '—'} mono />
        <Fact label="Domain age" value={report.domain?.ageDaysEstimate != null ? `~${report.domain.ageDaysEstimate}d` : 'unknown'} mono danger={(report.domain?.ageDaysEstimate ?? 999) < 30} />
      </div>

      {report.signals.length > 0 && (
        <div>
          <SectionLabel right={<span className="mono text-[10px] text-dim">{report.signals.length}</span>}>Signals</SectionLabel>
          <ul className="space-y-2">
            {report.signals.map((s, i) => {
              const c = s.weight >= 0 ? (s.weight / maxW > 0.6 ? '#f43f5e' : '#f59e0b') : '#10b981';
              return (
                <motion.li key={s.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-medium truncate">{s.label}</span>
                    <span className="mono text-[10.5px] tabular-nums" style={{ color: c }}>{s.weight > 0 ? '+' : ''}{s.weight}</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/[0.06] mt-1 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: c }} initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, (Math.abs(s.weight) / maxW) * 100)}%` }} transition={{ duration: 0.7, delay: i * 0.04 }} />
                  </div>
                  {s.detail && <div className="text-[11px] text-dim mt-1 leading-snug break-words">{s.detail}</div>}
                </motion.li>
              );
            })}
          </ul>
        </div>
      )}

      {report.forms.length > 0 && (
        <div>
          <SectionLabel>Forms found</SectionLabel>
          <div className="space-y-1.5">
            {report.forms.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.015] px-2.5 py-1.5 text-[11.5px]">
                <FileText size={12} className="text-dim shrink-0" />
                <span className="mono uppercase text-[10px] text-muted">{f.method || 'get'}</span>
                <span className="mono truncate flex-1 text-fg/80" title={f.action}>{f.action || '(same page)'}</span>
                {f.hasPassword && <Badge color="#f43f5e"><KeyRound size={10} /> password</Badge>}
                {f.external && <Badge color="#f97316">external</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.redirects.length > 0 && (
        <div>
          <SectionLabel>Redirect chain</SectionLabel>
          <div className="flex flex-col gap-1">
            {[...report.redirects].map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] mono text-muted min-w-0">
                {i > 0 ? <ArrowRight size={11} className="text-dim shrink-0" /> : <RotateCw size={11} className="text-dim shrink-0" />}
                <span className="truncate" title={r}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {zoom && shot && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoom(false)}
            className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm grid place-items-center p-8 cursor-zoom-out">
            <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end mb-2"><button onClick={() => setZoom(false)} className="text-muted hover:text-fg cursor-pointer"><X size={18} /></button></div>
              <BrowserFrame url={report.finalUrl || report.url} src={shot} title={report.title} danger={danger} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Fact({ label, value, mono, danger }: { label: string; value: string | null | undefined; mono?: boolean; danger?: boolean }) {
  return (
    <div className={clsx('rounded-lg border px-2.5 py-1.5 min-w-0', danger ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-line bg-white/[0.015]')}>
      <div className="text-[9.5px] uppercase tracking-wider text-dim">{label}</div>
      <div className={clsx('truncate', mono && 'mono', danger ? 'text-rose-300' : 'text-fg/85')} title={value ?? ''}>{value ?? '—'}</div>
    </div>
  );
}

/** Live view while Rex is still detonating a link (no final report yet). */
export function LiveForensics({ steps }: { steps: ForensicStep[] }) {
  const last = steps[steps.length - 1];
  const shot = [...steps].reverse().find((s) => s.screenshot)?.screenshot;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12.5px] text-amber-200">
        <Spinner className="border-t-amber-300" /> Rex is detonating the link in an isolated sandbox…
      </div>
      {last && <BrowserFrame url={last.url} src={shot ? asset(shot) : undefined} title="Capturing…" />}
      <ul className="space-y-1">
        {steps.slice(-6).map((s, i) => (
          <li key={`${s.ts}-${i}`} className="flex items-start gap-2 text-[11.5px]">
            <ScanSearch size={12} className="text-amber-300 mt-0.5 shrink-0" />
            <span className="font-medium">{s.action}</span>
            <span className="text-dim truncate">{s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NoForensics() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <CircleAlert size={14} className="text-dim" /> No link was detonated for this incident.
    </div>
  );
}
