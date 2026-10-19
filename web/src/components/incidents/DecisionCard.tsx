import { useState } from 'react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { Check, Hand, ShieldCheck, ShieldOff, X } from 'lucide-react';
import type { Incident } from '../../lib/types';
import { api } from '../../lib/api';
import { AgentAvatar } from '../Avatar';
import { Badge, Button, Spinner, ToolChip, fmtMs } from '../ui';
import { ACTIONS, type ModAction, confidenceOf, normalizeAction, prettyAction, pushIncident, rationaleOf } from './shared';

/** Human-in-the-loop decision card shown when Aria escalates to the founder. */
export function DecisionCard({ incident, onDone }: { incident: Incident; onDone?: (i: Incident | null) => void }) {
  const recommended = normalizeAction(incident.recommendedAction);
  const [alt, setAlt] = useState<ModAction>(() => (recommended === 'ban' ? 'mute' : recommended === 'mute' ? 'warn' : 'ban'));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const confidence = confidenceOf(incident);

  const run = async (key: string, fn: () => Promise<Incident>) => {
    setBusy(key); setErr(null);
    try {
      const res = await fn();
      pushIncident(res);
      onDone?.(res && (res as Incident).id ? res : null);
    } catch (e) {
      setErr((e as Error).message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };
  const approve = (action: ModAction | undefined, key: string) => run(key, () => api.post<Incident>(`/api/incidents/${incident.id}/approve`, action ? { action } : {}));
  const dismiss = () => run('dismiss', () => api.post<Incident>(`/api/incidents/${incident.id}/dismiss`, {}));

  return (
    <motion.section
      initial={{ opacity: 0, y: 12, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.04] to-transparent p-5"
      style={{ boxShadow: '0 0 0 1px rgba(245,158,11,0.15), 0 30px 80px -30px rgba(245,158,11,0.55)' }}
    >
      <motion.div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-amber-400/20 blur-3xl pointer-events-none"
        animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 3, repeat: Infinity }} />
      <div className="relative flex flex-col lg:flex-row gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-amber-300 font-semibold">
            <Hand size={13} /> Human in the loop · your call
            <span className="relative flex w-2 h-2 ml-1"><span className="absolute inset-0 rounded-full bg-amber-400 animate-ping" /><span className="relative w-2 h-2 rounded-full bg-amber-400" /></span>
          </div>
          <div className="flex items-start gap-3 mt-3">
            <AgentAvatar id="aria" size={44} />
            <div className="min-w-0">
              <div className="text-[19px] font-semibold tracking-tight leading-snug">
                Aria recommends: <span className="text-amber-200">{prettyAction(incident.recommendedAction ?? recommended ?? 'review')}</span>
              </div>
              <p className="text-[13.5px] text-fg/80 leading-relaxed mt-1.5">{rationaleOf(incident)}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {confidence != null && <Badge color="#f59e0b">{confidence}% confidence</Badge>}
                <Badge color="#8d93a8">policy: escalate {incident.severity} {incident.kind.replace('_', ' ')}</Badge>
                <ToolChip id="band" /><ToolChip id="kylon" />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:w-[340px] shrink-0 flex flex-col gap-2.5">
          <Button variant="success" size="lg" disabled={!!busy} onClick={() => approve(recommended ?? undefined, 'primary')} className="w-full"
            icon={busy === 'primary' ? <Spinner /> : <Check size={16} />}>
            Approve {recommended ? ACTIONS.find((a) => a.id === recommended)?.verb.toLowerCase() : prettyAction(incident.recommendedAction ?? 'recommendation').toLowerCase()}
          </Button>

          <div className="rounded-xl border border-line bg-black/20 p-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-muted mb-2">Or choose another action</div>
            <div className="grid grid-cols-4 gap-1.5">
              {ACTIONS.map((a) => (
                <button key={a.id} onClick={() => setAlt(a.id)} title={a.desc}
                  className={clsx('flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium cursor-pointer transition-all',
                    alt === a.id ? 'text-fg' : 'border-line text-muted hover:text-fg hover:border-line-strong')}
                  style={alt === a.id ? { borderColor: `${a.color}88`, background: `${a.color}1c`, color: a.color } : undefined}>
                  <a.icon size={15} />
                  {a.label}
                  {recommended === a.id && <span className="text-[8.5px] uppercase tracking-wider opacity-70">rec.</span>}
                </button>
              ))}
            </div>
            <Button variant={alt === 'ban' ? 'danger' : 'outline'} size="sm" disabled={!!busy} onClick={() => approve(alt, `alt:${alt}`)} className="w-full mt-2"
              icon={busy === `alt:${alt}` ? <Spinner className="w-3 h-3" /> : undefined}>
              Apply: {ACTIONS.find((a) => a.id === alt)?.verb}
            </Button>
          </div>

          <Button variant="ghost" size="sm" disabled={!!busy} onClick={dismiss} icon={busy === 'dismiss' ? <Spinner className="w-3 h-3" /> : <X size={14} />}>
            Dismiss — not a violation
          </Button>
          {err && <div className="text-[11.5px] text-rose-300">Couldn’t submit decision: {err}</div>}
        </div>
      </div>
    </motion.section>
  );
}

export function OutcomeBanner({ incident }: { incident: Incident }) {
  if (incident.status !== 'resolved' && incident.status !== 'dismissed') return null;
  const ok = incident.status === 'resolved';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={clsx('rounded-2xl border p-4 flex items-center gap-3', ok ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-line bg-white/[0.02]')}>
      <span className={clsx('w-10 h-10 rounded-xl grid place-items-center', ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.05] text-muted')}>
        {ok ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold">
          {ok ? <>Resolved · <span className="text-emerald-300">{prettyAction(incident.actionTaken)}</span></> : 'Dismissed — no action taken'}
        </div>
        <div className="text-[12px] text-muted">
          {incident.timeToActionMs != null ? <>Time to action <span className="mono text-fg/90">{fmtMs(incident.timeToActionMs)}</span></> : 'Closed'}
          {incident.resolvedAt ? <> · closed {new Date(incident.resolvedAt).toLocaleTimeString()}</> : null}
        </div>
      </div>
    </motion.div>
  );
}
