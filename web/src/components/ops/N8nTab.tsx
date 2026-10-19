import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  Braces, CalendarClock, ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleMinus, CircleX, Code, Download, GitFork, Globe, History,
  LoaderCircle, Mail, MessageSquare, Play, Radio, Reply, RotateCcw, Split, Webhook, Workflow, type LucideIcon,
} from 'lucide-react';
import { api, IS_REPLAY } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { AutomationDef, AutomationRun } from '../../lib/types';
import { Badge, Button, Empty, Panel, Spinner, TimeAgo, ToolChip, fmtMs } from '../ui';
import { JsonEditor, JsonView, N8N_COLOR, RUN_STATUS_COLOR, StatusDot, fileHref, parseJson, useNow } from './shared';

export const DEFAULT_AUTOMATION_PAYLOAD: Record<string, any> = {
  'community-onboarding': { name: 'Pixel Forge', platform: 'Discord', members: 3200, plan: 'Growth', ownerEmail: 'owner@pixelforge.example' },
  'moderator-alert': {
    incidentId: 'inc_demo', severity: 'critical', kind: 'phishing', title: 'Credential phishing in #general', risk: 94, assignedTo: 'rex',
    summary: 'Fake "free Premium" link harvesting logins', rationale: 'Look-alike domain serving a password form',
  },
  'crisis-escalation': { incidentId: 'inc_demo', member: '@quietfern', channel: 'vent', excerpt: "I don't see the point of anything anymore", region: 'US' },
  'enforcement-log': { incidentId: 'inc_demo', action: 'ban', actor: 'founder', member: '@glimmer_rewards', rationale: 'Repeat phishing' },
  'weekly-safety-report': {},
};

const NODE_ICON: Record<string, LucideIcon> = {
  webhook: Webhook, set: Braces, httpRequest: Globe, emailSend: Mail, respondToWebhook: Reply, if: Split, scheduleTrigger: CalendarClock,
  code: Code, slack: MessageSquare, merge: GitFork, switch: Split, cron: CalendarClock,
};
const nodeIcon = (t: string) => NODE_ICON[t] ?? Workflow;
const cleanName = (n: string) => n.replace(/^Haven\s*·\s*/, '');
const pretty = (v: any) => JSON.stringify(v, null, 2);

function StepIcon({ status }: { status: string }) {
  if (status === 'success' || status === 'done') return <CircleCheck size={15} className="text-ok" />;
  if (status === 'running') return <LoaderCircle size={15} className="text-violet-300 animate-spin" />;
  if (status === 'error') return <CircleX size={15} className="text-danger" />;
  if (status === 'skipped') return <CircleMinus size={15} className="text-dim" />;
  return <CircleDashed size={15} className="text-dim" />;
}

export function N8nTab() {
  const [defs, setDefs] = useState<AutomationDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payloads, setPayloads] = useState<Record<string, string>>({});
  const [openPayload, setOpenPayload] = useState<string | null>(null);
  const [selRun, setSelRun] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState<{ workflowId: string; at: number } | null>(null);
  const [localRuns, setLocalRuns] = useState<Record<string, AutomationRun>>({});
  const storeRuns = useHaven((s) => s.automationRuns);
  const n8n = useHaven((s) => s.integrations.find((i) => i.id === 'n8n'));

  const load = useCallback(async () => {
    try { setDefs(await api.get<AutomationDef[]>('/api/automations')); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const allRuns = useMemo(() => {
    const m = new Map<string, AutomationRun>();
    for (const d of defs ?? []) for (const r of d.runs) m.set(r.id, r);
    for (const r of Object.values(localRuns)) m.set(r.id, r);
    for (const r of Object.values(storeRuns)) m.set(r.id, r);
    return [...m.values()].sort((a, b) => b.startedAt - a.startedAt);
  }, [defs, storeRuns, localRuns]);

  useEffect(() => {
    if (!launching) return;
    const hit = allRuns.find((r) => r.workflowId === launching.workflowId && r.trigger === 'manual' && r.startedAt >= launching.at - 2000);
    if (hit) { setSelRun(hit.id); setLaunching(null); }
  }, [allRuns, launching]);

  const shown = (selRun && allRuns.find((r) => r.id === selRun)) || allRuns[0] || null;
  const anyRunning = allRuns.some((r) => r.status === 'running');
  const nowTs = useNow(300, anyRunning);
  const defName = (wid: string) => cleanName(defs?.find((d) => d.id === wid)?.name ?? wid);

  const runNow = async (wid: string) => {
    const txt = payloads[wid] ?? pretty(DEFAULT_AUTOMATION_PAYLOAD[wid] ?? {});
    const p = parseJson(txt);
    if (!p.ok) { setErrors((e) => ({ ...e, [wid]: 'Payload is not valid JSON' })); setOpenPayload(wid); return; }
    setBusy(wid); setErrors((e) => ({ ...e, [wid]: '' }));
    setLaunching({ workflowId: wid, at: Date.now() });
    try {
      const r = await api.post<AutomationRun>(`/api/automations/${wid}/run`, { payload: p.value });
      setLocalRuns((m) => ({ ...m, [r.id]: r }));
      setSelRun(r.id);
    } catch (e) {
      setErrors((x) => ({ ...x, [wid]: (e as Error).message }));
    } finally { setBusy(null); setLaunching(null); }
  };

  if (error && !defs) return <Panel><Empty icon={<CircleX size={22} />} title="Couldn't load workflows" body={error} action={<Button size="sm" onClick={load} icon={<RotateCcw size={13} />}>Retry</Button>} /></Panel>;
  if (!defs) return <div className="grid grid-cols-1 xl:grid-cols-5 gap-4"><div className="xl:col-span-3 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="panel h-44 shimmer" />)}</div><div className="xl:col-span-2 panel h-[520px] shimmer" /></div>;

  const live = n8n?.mode === 'live';
  return (
    <div className="flex flex-col gap-4">
      {/* banner */}
      <div className="panel relative overflow-hidden p-4 flex flex-wrap items-center gap-4">
        <div className="absolute -left-10 -top-16 w-56 h-56 rounded-full blur-3xl opacity-20" style={{ background: N8N_COLOR }} />
        <span className="relative w-10 h-10 rounded-xl grid place-items-center" style={{ background: `${N8N_COLOR}22`, color: N8N_COLOR }}><Workflow size={19} /></span>
        <div className="relative flex-1 min-w-[260px]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{defs.length} importable n8n workflows run Haven's business operations</span>
            <ToolChip id="n8n" />
            <Badge color={live ? '#10b981' : '#8d93a8'} dot>{live ? 'LIVE · your n8n' : 'LOCAL n8n-compatible executor'}</Badge>
          </div>
          <p className="text-xs text-muted mt-1">
            Import these JSON files into n8n (<b className="text-fg/80">Workflows → Import from file</b>); set <span className="kbd">N8N_URL</span> to execute on your n8n instance.
            {live && n8n?.detail && <span className="text-dim"> · {n8n.detail}</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        {/* workflow cards */}
        <div className="xl:col-span-3 flex flex-col gap-3">
          {defs.map((d, i) => {
            const runs = allRuns.filter((r) => r.workflowId === d.id);
            const last = runs[0];
            const stepStatus = (name: string) => last?.steps.find((s) => s.name === name)?.status;
            const txt = payloads[d.id] ?? pretty(DEFAULT_AUTOMATION_PAYLOAD[d.id] ?? {});
            const isOpen = openPayload === d.id;
            const isSel = shown?.workflowId === d.id;
            return (
              <motion.article key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className={clsx('panel panel-hover p-4 relative overflow-hidden', isSel && '!border-[#ea4b71]/40')}>
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${N8N_COLOR}1f`, color: N8N_COLOR }}>
                    {d.trigger.startsWith('webhook') ? <Webhook size={16} /> : <CalendarClock size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[15px] font-semibold tracking-tight">{cleanName(d.name)}</h3>
                      {last && <Badge color={RUN_STATUS_COLOR[last.status] ?? '#8d93a8'} dot>{last.status === 'running' ? 'running' : `last ${last.status}`}</Badge>}
                      <span className="text-[11px] text-dim mono">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
                    </div>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{d.description}</p>
                    <div className="mt-1.5 mono text-[10.5px] text-dim flex items-center gap-1.5"><Radio size={10} /> {d.trigger}</div>
                  </div>
                </div>

                {/* node chain */}
                <div className="mt-3.5 flex items-center flex-wrap gap-y-2">
                  {d.nodes.map((n, j) => {
                    const Icon = nodeIcon(n.type);
                    const st = stepStatus(n.name);
                    const c = st === 'running' ? '#a78bfa' : st === 'success' ? '#10b981' : st === 'error' ? '#f43f5e' : null;
                    const dim = st === 'skipped';
                    return (
                      <div key={`${n.name}-${j}`} className="flex items-center">
                        <motion.span layout title={`${n.name} (${n.type})${st ? ` · ${st}` : ''}`}
                          className={clsx('inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-[11.5px] transition-colors', dim && 'opacity-45')}
                          style={{ borderColor: c ? `${c}66` : 'rgba(255,255,255,0.1)', background: c ? `${c}14` : 'rgba(255,255,255,0.03)' }}>
                          <span className="w-5 h-5 rounded-full grid place-items-center" style={{ background: `${N8N_COLOR}22`, color: N8N_COLOR }}>
                            {st === 'running' ? <LoaderCircle size={11} className="animate-spin" /> : <Icon size={11} />}
                          </span>
                          <span className="text-fg/90">{n.name}</span>
                        </motion.span>
                        {j < d.nodes.length - 1 && <ChevronRight size={13} className="text-dim mx-0.5" />}
                      </div>
                    );
                  })}
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="pt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] uppercase tracking-wider text-muted">Webhook payload</span>
                          <button onClick={() => setPayloads((m) => ({ ...m, [d.id]: pretty(DEFAULT_AUTOMATION_PAYLOAD[d.id] ?? {}) }))}
                            className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer"><RotateCcw size={11} /> Reset</button>
                        </div>
                        <JsonEditor value={txt} onChange={(v) => setPayloads((m) => ({ ...m, [d.id]: v }))} rows={5} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {errors[d.id] && <div className="mt-2 text-xs text-rose-300">{errors[d.id]}</div>}

                <div className="mt-3.5 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
                  <span className="mono text-[11px] text-dim">{d.file}</span>
                  <div className="flex-1" />
                  <button onClick={() => setOpenPayload(isOpen ? null : d.id)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg px-2 py-1.5 rounded-lg hover:bg-white/[0.05] cursor-pointer">
                    <Braces size={13} /> Payload <ChevronDown size={12} className={clsx('transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  <a href={fileHref(`/api/automations/${d.id}/file`, d.file, IS_REPLAY)} download={`${d.id}.json`} target={IS_REPLAY ? '_blank' : undefined} rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.03] hover:bg-white/[0.07] px-2.5 py-1.5 text-xs font-medium">
                    <Download size={13} /> Download workflow JSON
                  </a>
                  <Button size="sm" variant="primary" onClick={() => runNow(d.id)} disabled={!!busy}
                    icon={busy === d.id ? <Spinner /> : <Play size={13} />}>{busy === d.id ? 'Running…' : 'Run now'}</Button>
                </div>
              </motion.article>
            );
          })}
        </div>

        {/* live run log */}
        <div className="xl:col-span-2 flex flex-col gap-4 xl:sticky xl:top-20">
          <Panel title="Live run log" icon={<Radio size={13} className={anyRunning ? 'text-ok animate-pulse' : ''} />}
            actions={<>{selRun && <button onClick={() => setSelRun(null)} className="text-[11px] text-muted hover:text-fg cursor-pointer">follow latest</button>}<ToolChip id="n8n" /></>}>
            <AnimatePresence mode="wait">
              {!shown ? (
                <Empty key="empty" icon={<Workflow size={22} />} title="No workflow runs yet" body="Hit Run now on any workflow, or inject a threat — Haven triggers alerts and escalations automatically." />
              ) : (
                <motion.div key={shown.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{defName(shown.workflowId)}</div>
                      <div className="mono text-[10.5px] text-dim truncate">{shown.id} · trigger: {shown.trigger}</div>
                    </div>
                    <Badge color={shown.mode === 'n8n' ? N8N_COLOR : '#8d93a8'}>{shown.mode === 'n8n' ? 'n8n instance' : 'local executor'}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1.5"><StatusDot status={shown.status} /><span style={{ color: RUN_STATUS_COLOR[shown.status] }}>{shown.status}</span></span>
                    <span className="mono">{fmtMs((shown.finishedAt ?? nowTs) - shown.startedAt)}</span>
                    <span><TimeAgo ts={shown.startedAt} /></span>
                  </div>
                  <ol className="mt-4 relative">
                    <span className="absolute left-[7px] top-2 bottom-2 w-px bg-white/10" />
                    {shown.steps.map((s, k) => (
                      <motion.li key={`${s.name}-${k}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.04 }} className="relative flex gap-3 pb-3 last:pb-0">
                        <span className="relative z-10 bg-ink-900 rounded-full"><StepIcon status={s.status} /></span>
                        <div className="min-w-0 flex-1 -mt-0.5">
                          <div className={clsx('text-[13px] font-medium', s.status === 'skipped' && 'text-dim')}>{s.name}</div>
                          {s.detail && <div className="mono text-[10.5px] text-muted mt-0.5 break-words leading-relaxed">{s.detail}</div>}
                        </div>
                      </motion.li>
                    ))}
                  </ol>
                  <details className="mt-3 group">
                    <summary className="text-[11px] uppercase tracking-wider text-muted cursor-pointer hover:text-fg list-none flex items-center gap-1">
                      <ChevronRight size={12} className="group-open:rotate-90 transition-transform" /> Payload
                    </summary>
                    <JsonView value={shown.payload} maxHeight={200} className="mt-2" />
                  </details>
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>

          <Panel title="History" icon={<History size={13} />} pad={false} actions={<span className="text-[11px] text-muted mono">{allRuns.length}</span>}>
            {allRuns.length === 0 ? (
              <Empty title="Nothing yet" body="Runs stream in live over the WebSocket." />
            ) : (
              <div className="max-h-[320px] overflow-y-auto scroll-thin">
                <AnimatePresence initial={false}>
                  {allRuns.slice(0, 40).map((r) => (
                    <motion.button key={r.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}
                      onClick={() => setSelRun(r.id)}
                      className={clsx('w-full text-left flex items-center gap-2.5 px-4 py-2 border-t border-line first:border-t-0 hover:bg-white/[0.03] cursor-pointer', shown?.id === r.id && 'bg-white/[0.05]')}>
                      <StatusDot status={r.status} />
                      <span className="text-[12.5px] truncate flex-1">{defName(r.workflowId)}</span>
                      <span className="text-[10.5px] text-dim truncate max-w-[130px] mono">{r.trigger}</span>
                      <span className="text-[10.5px] text-muted mono w-12 text-right">{fmtMs((r.finishedAt ?? nowTs) - r.startedAt)}</span>
                      <span className="text-[10.5px] text-dim w-14 text-right"><TimeAgo ts={r.startedAt} /></span>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
