import { type ReactNode, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import {
  Bug, CircleCheck, CircleDashed, CircleX, ClipboardCheck, Code2, ExternalLink, FlaskConical, KeyRound, LoaderCircle, Package, ShieldCheck, ShieldX, Terminal, TriangleAlert,
} from 'lucide-react';
import type { Audit } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, Empty, Panel, TOOL_META, ToolChip, fmtMs } from '../ui';
import { ScoreRing } from '../incidents/shared';

// ---------- helpers ----------
export const GRADE_COLOR: Record<string, string> = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#f97316', F: '#f43f5e' };
export const gradeColor = (g: string | null | undefined) => GRADE_COLOR[(g ?? '').trim().charAt(0).toUpperCase()] ?? '#8d93a8';
export const SEV_COLOR: Record<string, string> = { critical: '#f43f5e', high: '#f97316', medium: '#f59e0b', low: '#60a5fa' };
const SEVS = ['critical', 'high', 'medium', 'low'] as const;

export function prettyTarget(t: string) {
  if (t === 'sample') return 'RaidShield Pro';
  if (t === 'safe-sample') return 'Safe sample bot';
  return t.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '');
}
export function targetSub(t: string) {
  if (t === 'sample') return 'bundled sample · sketchy community bot';
  if (t === 'safe-sample') return 'bundled sample · well-behaved bot';
  return /github\.com/i.test(t) ? 'public GitHub repository' : t;
}

export function verdictFor(grade: string | null) {
  const g = (grade ?? '').charAt(0).toUpperCase();
  if (g === 'A' || g === 'B') return { label: 'Approved for install', color: '#10b981', icon: ShieldCheck };
  if (g === 'C') return { label: 'Install with restricted permissions', color: '#f59e0b', icon: TriangleAlert };
  if (g === 'D' || g === 'F') return { label: 'Blocked — do not install', color: '#f43f5e', icon: ShieldX };
  return { label: 'Pending', color: '#8d93a8', icon: CircleDashed };
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
const modeLabel = (m: unknown) => {
  const s = str(m);
  if (!s) return null;
  return /local|fallback|offline|static|builtin|skipped|error/i.test(s) ? { text: s, live: false } : { text: s, live: true };
};

function ModeBadge({ mode }: { mode: unknown }) {
  const m = modeLabel(mode);
  if (!m) return null;
  return <Badge color={m.live ? '#10b981' : '#8d93a8'} dot>{m.live ? `live · ${m.text}` : m.text}</Badge>;
}

/** Step tools arrive as display names ("Snyk Code", "Tenki", "Kai", "git"); map them onto sponsor chips when we can. */
export function StepToolChip({ tool }: { tool: string }) {
  const key = (tool ?? '').toLowerCase().split(/[\s-]+/)[0];
  const meta = TOOL_META[key];
  const color = meta?.color ?? (key === 'kai' ? '#10b981' : '#8d93a8');
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold mono border whitespace-nowrap"
      style={{ color, borderColor: `${color}40`, background: `${color}12` }}>
      {meta ? tool.replace(new RegExp(`^${key}`, 'i'), meta.name) : tool}
    </span>
  );
}
const stepRunning = (a: Audit, id: string) => (a.steps ?? []).some((s) => s.id === id && s.status === 'running');

// ---------- step tracker ----------
function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <LoaderCircle size={16} className="animate-spin text-violet-300" />;
  if (status === 'done') return <CircleCheck size={16} className="text-emerald-400" />;
  if (status === 'error') return <CircleX size={16} className="text-rose-400" />;
  return <CircleDashed size={16} className="text-dim" />;
}

export function StepTracker({ audit }: { audit: Audit }) {
  const steps = audit.steps ?? [];
  const done = steps.filter((s) => s.status === 'done' || s.status === 'error').length;
  const pct = steps.length ? done / steps.length : 0;
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div className="h-full rounded-full brand-gradient" initial={{ width: 0 }} animate={{ width: `${Math.max(3, pct * 100)}%` }} transition={{ duration: 0.6 }} />
        </div>
        <span className="mono text-[11px] text-muted tabular-nums">{done}/{steps.length}</span>
      </div>
      {steps.length === 0 ? (
        <div className="text-xs text-muted">Queued — Kai is provisioning the audit…</div>
      ) : (
        <ol className="relative">
          {steps.map((s, i) => (
            <motion.li key={s.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span className={clsx('absolute left-[13px] top-7 bottom-0 w-px', s.status === 'done' ? 'bg-emerald-500/40' : 'bg-white/10')} />
              )}
              <span className={clsx('relative z-10 w-[27px] h-[27px] rounded-full grid place-items-center border shrink-0 bg-ink-900',
                s.status === 'running' ? 'border-violet-400/60 shadow-[0_0_16px_-2px_rgba(167,139,250,0.7)]' : s.status === 'done' ? 'border-emerald-500/40' : s.status === 'error' ? 'border-rose-500/50' : 'border-line')}>
                <StepIcon status={s.status} />
              </span>
              <div className={clsx('flex-1 min-w-0 rounded-xl border px-3 py-2 relative overflow-hidden',
                s.status === 'running' ? 'border-violet-400/30 bg-violet-500/[0.06]' : s.status === 'error' ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-line bg-white/[0.015]')}>
                {s.status === 'running' && <div className="absolute inset-0 shimmer pointer-events-none" />}
                <div className="relative flex items-center gap-2">
                  <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{s.label}</span>
                  <StepToolChip tool={s.tool} />
                </div>
                {s.detail && <div className="relative text-[11.5px] text-muted mt-0.5 break-words">{s.detail}</div>}
              </div>
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------- grade hero ----------
export function GradeHero({ audit }: { audit: Audit }) {
  const finished = audit.status === 'done' || audit.status === 'error';
  const g = audit.grade ? audit.grade.trim() : null;
  const color = gradeColor(g);
  const v = verdictFor(g);
  const VIcon = v.icon;
  return (
    <div className="relative flex flex-col items-center text-center py-2">
      <div className="absolute top-6 w-48 h-48 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ background: finished && g ? color : '#8b5cf6' }} />
      <AnimatePresence mode="wait">
        {finished && g ? (
          <motion.div key="grade" initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }}>
            <ScoreRing value={audit.score ?? 0} size={172} stroke={10} color={color}>
              <span className="text-[84px] font-bold leading-none tracking-tighter" style={{ color, textShadow: `0 0 40px ${color}88` }}>{g}</span>
              <span className="mono text-[12px] text-muted mt-1 tabular-nums">{audit.score != null ? `${Math.round(audit.score)}/100` : ''}</span>
            </ScoreRing>
          </motion.div>
        ) : audit.status === 'error' ? (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-[172px] h-[172px] rounded-full border-2 border-rose-500/40 grid place-items-center">
            <CircleX size={54} className="text-rose-400" />
          </motion.div>
        ) : (
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative w-[172px] h-[172px] grid place-items-center">
            <motion.span className="absolute inset-0 rounded-full border-[3px] border-transparent"
              style={{ borderTopColor: '#8b5cf6', borderRightColor: '#22d3ee' }} animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
            <span className="absolute inset-3 rounded-full border border-white/10" />
            <span className="text-[64px] font-bold text-white/15">?</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 border text-[12.5px] font-semibold"
        style={{ color: finished ? v.color : '#a78bfa', borderColor: `${finished ? v.color : '#a78bfa'}55`, background: `${finished ? v.color : '#a78bfa'}14` }}>
        {finished ? <><VIcon size={14} /> {audit.status === 'error' ? 'Audit failed' : v.label}</> : <><LoaderCircle size={14} className="animate-spin" /> Kai is auditing…</>}
      </div>

      <div className="mt-4 flex items-start gap-2.5 text-left max-w-md">
        <AgentAvatar id="kai" size={34} />
        <div className="rounded-2xl rounded-tl-sm border border-line bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-fg/85">
          {audit.summary ?? (finished ? 'Audit complete.' : 'Running dependency scan, sandboxed tests and the permission spec check. This usually takes a few seconds.')}
        </div>
      </div>
    </div>
  );
}

// ---------- Snyk ----------
interface Vuln { id: string; title: string; pkg: string; version: string; severity: string; fixedIn: string; cve: string | null; cvss: number | null; direct: boolean | null; url: string | null }
function normalizeVulns(snyk: any): Vuln[] {
  const raw = asArray(snyk?.vulns ?? snyk?.top ?? snyk?.vulnerabilities ?? snyk?.results);
  return raw.map((v: any, i: number) => {
    const fixed = v?.fixedIn ?? v?.fixed_in ?? v?.upgradeTo;
    const cve = v?.cve ?? v?.CVE ?? asArray(v?.identifiers?.CVE)[0] ?? asArray(v?.cves)[0] ?? null;
    return {
      id: str(v?.id) ?? `vuln-${i}`,
      title: str(v?.title ?? v?.name ?? v?.message) ?? 'Untitled issue',
      pkg: str(v?.pkg ?? v?.packageName ?? v?.package ?? v?.moduleName) ?? '—',
      version: str(v?.version ?? v?.installed) ?? '',
      severity: (str(v?.severity) ?? 'low').toLowerCase(),
      fixedIn: Array.isArray(fixed) ? fixed.join(', ') || '—' : str(fixed) ?? '—',
      cve: str(cve),
      cvss: typeof v?.cvss === 'number' ? v.cvss : null,
      direct: typeof v?.direct === 'boolean' ? v.direct : null,
      url: str(v?.url),
    };
  });
}
interface CodeIssue { rule: string; title: string; severity: string; file: string; line: number | null; message: string }
function normalizeCode(code: any): { mode: string | null; engine: string | null; note: string | null; issues: CodeIssue[]; counts: Record<string, number> | null } | null {
  if (!code || typeof code !== 'object') return null;
  const src = code.skipped && code.local ? code.local : code;
  const raw = asArray(src?.issues ?? src?.findings);
  const issues = raw.map((f: any) => ({
    rule: str(f?.ruleId ?? f?.kind) ?? '—',
    title: str(f?.title ?? f?.label) ?? '',
    severity: (str(f?.severity) ?? 'low').toLowerCase(),
    file: str(f?.file) ?? '',
    line: typeof f?.line === 'number' ? f.line : null,
    message: str(f?.message ?? f?.snippet) ?? '',
  }));
  return {
    mode: code.skipped ? 'local SAST rules' : str(code.mode),
    engine: str(src?.engine) ?? str(code.engine),
    note: code.skipped ? `Snyk Code skipped (${str(code.reason) ?? 'not configured'}) — fell back to local rules` : null,
    issues, counts: src?.counts && typeof src.counts === 'object' ? src.counts : null,
  };
}

export function SnykPanel({ audit }: { audit: Audit }) {
  const snyk = audit.snyk;
  const vulns = useMemo(() => normalizeVulns(snyk), [snyk]);
  const code = useMemo(() => normalizeCode(snyk?.code), [snyk]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const given = snyk?.counts ?? snyk?.summary?.counts;
    if (given && typeof given === 'object' && SEVS.some((s) => typeof given[s] === 'number')) {
      for (const s of SEVS) c[s] = Number(given[s]) || 0;
    } else {
      for (const v of vulns) if (v.severity in c) c[v.severity]++;
    }
    return c;
  }, [snyk, vulns]);
  const total = typeof snyk?.total === 'number' ? snyk.total : vulns.length;
  const summary = typeof snyk?.summary === 'string' ? snyk.summary : null;
  const sorted = useMemo(() => [...vulns].sort((a, b) => SEVS.indexOf(a.severity as any) - SEVS.indexOf(b.severity as any) || (b.cvss ?? 0) - (a.cvss ?? 0)), [vulns]);
  const running = stepRunning(audit, 'snyk') || stepRunning(audit, 'snyk-code');

  return (
    <Panel title="Dependency & code scan" icon={<Bug size={14} />} actions={<><ModeBadge mode={snyk?.mode} /><ToolChip id="snyk" /></>}>
      {!snyk ? (
        <Empty icon={running ? <LoaderCircle className="animate-spin" size={22} /> : <Package size={22} />} title={running ? 'Snyk is scanning dependencies…' : 'Scan not started'} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {SEVS.map((s, i) => (
              <motion.div key={s} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="rounded-xl border p-3 relative overflow-hidden" style={{ borderColor: `${SEV_COLOR[s]}${counts[s] ? '55' : '22'}`, background: `${SEV_COLOR[s]}${counts[s] ? '14' : '06'}` }}>
                {counts[s] > 0 && <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full blur-xl opacity-40" style={{ background: SEV_COLOR[s] }} />}
                <div className="relative text-[10px] uppercase tracking-wider font-semibold" style={{ color: SEV_COLOR[s] }}>{s}</div>
                <div className="relative text-[28px] font-semibold tabular-nums leading-tight" style={{ color: counts[s] ? SEV_COLOR[s] : '#5d6379' }}>{counts[s]}</div>
              </motion.div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
            {str(snyk.engine) && <span>{snyk.engine}</span>}
            {typeof snyk.dependencyCount === 'number' && <span><b className="text-fg/90 tabular-nums">{snyk.dependencyCount}</b> dependencies</span>}
            {typeof snyk.vulnerablePackages === 'number' && <span><b className="text-fg/90 tabular-nums">{snyk.vulnerablePackages}</b> vulnerable packages</span>}
            <span><b className="text-fg/90 tabular-nums">{total}</b> issues</span>
            {typeof snyk.durationMs === 'number' && <span className="mono">{fmtMs(snyk.durationMs)}</span>}
            {str(snyk.error) && <span className="text-rose-300">error: {snyk.error}</span>}
          </div>
          {summary && <div className="text-[12.5px] text-muted">{summary}</div>}
          {sorted.length ? (
            <div className="overflow-x-auto scroll-thin -mx-4 px-4">
              <table className="w-full text-[12px] min-w-[720px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-dim text-left">
                    <th className="font-medium py-1.5 pr-3">Severity</th>
                    <th className="font-medium py-1.5 pr-3">Issue</th>
                    <th className="font-medium py-1.5 pr-3">Package</th>
                    <th className="font-medium py-1.5 pr-3 whitespace-nowrap">Fixed in</th>
                    <th className="font-medium py-1.5">CVE / ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((v, i) => (
                    <motion.tr key={`${v.id}-${v.pkg}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 15) * 0.03 }}
                      className="border-t border-line hover:bg-white/[0.02] align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge color={SEV_COLOR[v.severity] ?? '#8d93a8'} dot>{v.severity}</Badge>
                        {v.cvss != null && <div className="mono text-[10px] text-dim mt-1">CVSS {v.cvss.toFixed(1)}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-fg/90">{v.title}</div>
                        {v.direct != null && <div className="text-[10.5px] text-dim">{v.direct ? 'direct dependency' : 'transitive dependency'}</div>}
                      </td>
                      <td className="py-2 pr-3 mono text-[11px] text-fg/80 whitespace-nowrap">{v.pkg}{v.version ? <span className="text-dim">@{v.version}</span> : null}</td>
                      <td className="py-2 pr-3 mono text-[11px]">{v.fixedIn === '—' ? <span className="text-dim">no fix</span> : <span className="text-emerald-300">{v.fixedIn}</span>}</td>
                      <td className="py-2 mono text-[10.5px] text-muted whitespace-nowrap">
                        {v.url ? (
                          <a href={v.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-fg">{v.cve ?? v.id}<ExternalLink size={10} /></a>
                        ) : (v.cve ?? v.id)}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {total > sorted.length && <div className="text-[11px] text-dim mt-2">Showing the top {sorted.length} of {total} issues by severity.</div>}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12.5px] text-emerald-300"><ShieldCheck size={15} /> No known dependency vulnerabilities found.</div>
          )}

          {code && (
            <div className="rounded-xl border border-line bg-white/[0.015] p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Code2 size={13} className="text-violet-300" />
                <span className="text-[12px] font-semibold">Static code analysis</span>
                <StepToolChip tool="Snyk Code" />
                {code.mode && <ModeBadge mode={code.mode} />}
                {code.counts && (
                  <span className="ml-auto flex items-center gap-1.5">
                    {SEVS.filter((s) => (code.counts?.[s] ?? 0) > 0).map((s) => <Badge key={s} color={SEV_COLOR[s]}>{code.counts?.[s]} {s}</Badge>)}
                  </span>
                )}
              </div>
              {code.note && <div className="text-[11px] text-dim mb-2">{code.note}</div>}
              {code.issues.length ? (
                <ul className="space-y-1.5 max-h-64 overflow-auto scroll-thin">
                  {code.issues.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11.5px]">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEV_COLOR[f.severity] ?? '#8d93a8' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium text-fg/90">{f.title || f.rule}</span>
                          {f.file && <span className="mono text-[10.5px] text-dim">{f.file}{f.line ? `:${f.line}` : ''}</span>}
                        </div>
                        {f.message && <div className="mono text-[10.5px] text-muted truncate" title={f.message}>{f.message}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11.5px] text-emerald-300">No risky code patterns found.</div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------- Tenki ----------
export function TenkiPanel({ audit }: { audit: Audit }) {
  const t = audit.tenki;
  const tests = asArray(t?.tests ?? t?.cases ?? t?.results);
  const passed = typeof t?.passed === 'number' ? t.passed : tests.filter((x: any) => /pass|ok|success/i.test(String(x?.status ?? x?.result))).length;
  const failed = typeof t?.failed === 'number' ? t.failed : tests.filter((x: any) => /fail|error/i.test(String(x?.status ?? x?.result))).length;
  const exit = t?.exitCode ?? t?.exit_code ?? t?.code;
  const dur = t?.durationMs ?? t?.duration_ms ?? t?.duration;
  const rawLog = t?.logTail ?? t?.log ?? t?.logs ?? t?.output ?? t?.stdout;
  const log = Array.isArray(rawLog) ? rawLog.join('\n') : typeof rawLog === 'string' ? rawLog : '';
  const tail = log.split('\n').slice(-40).join('\n');
  const running = stepRunning(audit, 'tenki');
  const ok = exit === 0 || (exit == null && failed === 0 && passed > 0);

  return (
    <Panel title="Sandboxed test run" icon={<FlaskConical size={14} />} actions={<><ModeBadge mode={t?.mode} /><ToolChip id="tenki" /></>}>
      {!t ? (
        <Empty icon={running ? <LoaderCircle className="animate-spin" size={22} /> : <FlaskConical size={22} />} title={running ? 'Tenki is running the bot’s test suite…' : 'Not run yet'} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Exit" value={exit != null ? String(exit) : '—'} color={exit == null ? '#8d93a8' : ok ? '#10b981' : '#f43f5e'} />
            <Tile label="Passed" value={String(passed)} color="#10b981" />
            <Tile label="Failed" value={String(failed)} color={failed ? '#f43f5e' : '#5d6379'} />
            <Tile label="Duration" value={typeof dur === 'number' ? fmtMs(dur) : str(dur) ?? '—'} color="#60a5fa" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
            {str(t.engine) && <span>{t.engine}</span>}
            {str(t.isolation) && <span className="inline-flex items-center gap-1"><ShieldCheck size={11} className="text-emerald-400" />{t.isolation}</span>}
            {t.install?.ran && (
              <span className="mono text-[11px]">npm install{t.install.ignoreScripts ? ' --ignore-scripts' : ''} → exit {String(t.install.exitCode ?? '—')}{t.install.added ? ` · ${t.install.added} pkgs` : ''}</span>
            )}
            {t.timedOut && <span className="text-amber-300">timed out</span>}
            {str(t.sessionId) && <span className="mono text-[10.5px] text-dim">session {t.sessionId}</span>}
          </div>
          {(t.noTests || t.skipped || t.installFailed || str(t.reason) || str(t.error)) && (
            <div className={clsx('rounded-lg border px-3 py-2 text-[12px]', t.installFailed || t.error ? 'border-rose-500/30 bg-rose-500/[0.05] text-rose-200' : 'border-amber-400/25 bg-amber-500/[0.05] text-amber-100/90')}>
              {str(t.error) ?? str(t.reason) ?? (t.installFailed ? 'Dependency install failed inside the sandbox.' : 'The bot ships no test suite — install was verified, nothing to execute.')}
            </div>
          )}
          {tests.length > 0 && (
            <ul className="space-y-1 max-h-40 overflow-auto scroll-thin">
              {tests.map((x: any, i: number) => {
                const st = String(x?.status ?? x?.result ?? '');
                const good = /pass|ok|success/i.test(st);
                return (
                  <li key={i} className="flex items-center gap-2 text-[11.5px]">
                    {good ? <CircleCheck size={12} className="text-emerald-400 shrink-0" /> : <CircleX size={12} className="text-rose-400 shrink-0" />}
                    <span className="truncate flex-1">{str(x?.name ?? x?.title) ?? `test ${i + 1}`}</span>
                    {x?.detail || x?.error ? <span className="text-dim truncate max-w-[45%]">{str(x?.detail ?? x?.error)}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {tail && (
            <div className="rounded-xl border border-line bg-black/50 overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-line text-[10.5px] text-dim"><Terminal size={11} /> log tail</div>
              <pre className="mono text-[11px] leading-relaxed text-emerald-100/80 p-3 max-h-60 overflow-auto scroll-thin whitespace-pre-wrap break-words">{tail}</pre>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wider text-dim">{label}</div>
      <div className="mono text-[16px] font-semibold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

// ---------- Prelint ----------
const RULE_COLOR: Record<string, string> = { pass: '#10b981', fail: '#f43f5e', warn: '#f59e0b' };
const normStatus = (s: unknown) => {
  const v = String(s ?? '').toLowerCase();
  if (/fail|error|violat|block/.test(v)) return 'fail';
  if (/warn|partial|review/.test(v)) return 'warn';
  if (/pass|ok|success|compliant/.test(v)) return 'pass';
  return v || 'warn';
};

export function PrelintPanel({ audit }: { audit: Audit }) {
  const p = audit.prelint;
  const [filter, setFilter] = useState<'all' | 'fail' | 'warn' | 'pass'>('all');
  const rules = asArray(p?.rules ?? p?.results ?? p?.checks).map((r: any, i: number) => ({
    id: str(r?.ruleId ?? r?.id ?? r?.rule) ?? `R${i + 1}`,
    title: str(r?.title ?? r?.name ?? r?.description) ?? '',
    status: normStatus(r?.status ?? r?.result ?? (r?.passed === true ? 'pass' : r?.passed === false ? 'fail' : undefined)),
    evidence: str(r?.evidence ?? r?.detail ?? r?.message ?? r?.reason) ?? '',
    severity: (str(r?.severity) ?? '').toLowerCase(),
  }));
  const perms: string[] = asArray(p?.manifest?.permissions).map((x) => str(x) ?? '').filter(Boolean);
  const intents: string[] = asArray(p?.manifest?.intents).map((x) => str(x) ?? '').filter(Boolean);
  const review = p?.review && typeof p.review === 'object' && !Array.isArray(p.review) ? p.review : null;
  const reviewerRaw = p?.reviewer?.bullets ?? p?.reviewer ?? p?.review?.bullets ?? p?.review ?? p?.bullets ?? p?.notes;
  const bullets: string[] = Array.isArray(reviewerRaw)
    ? reviewerRaw.map((b: unknown) => str(b) ?? str((b as any)?.text) ?? '').filter(Boolean)
    : typeof reviewerRaw === 'string' ? reviewerRaw.split('\n').map((s) => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean) : [];
  const counts = { pass: 0, fail: 0, warn: 0 } as Record<string, number>;
  for (const r of rules) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const shown = filter === 'all' ? rules : rules.filter((r) => r.status === filter);
  const running = stepRunning(audit, 'prelint');
  const spec = str(p?.spec ?? p?.specFile ?? p?.specName);

  return (
    <Panel title="Spec & permission check" icon={<ClipboardCheck size={14} />} actions={<><ModeBadge mode={p?.mode} /><ToolChip id="prelint" /></>}>
      {!p ? (
        <Empty icon={running ? <LoaderCircle className="animate-spin" size={22} /> : <ClipboardCheck size={22} />} title={running ? 'Prelint is checking the bot against the spec…' : 'Not run yet'} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'fail', 'warn', 'pass'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={clsx('text-[11px] px-2.5 py-1 rounded-lg border cursor-pointer transition-colors capitalize', filter === f ? 'bg-white/[0.08] border-line-strong text-fg' : 'border-line text-muted hover:text-fg')}
                style={filter === f && f !== 'all' ? { color: RULE_COLOR[f], borderColor: `${RULE_COLOR[f]}66` } : undefined}>
                {f} <span className="mono text-[10px] opacity-70">{f === 'all' ? rules.length : counts[f] ?? 0}</span>
              </button>
            ))}
            {spec && <span className="ml-auto mono text-[10.5px] text-dim truncate">{spec}</span>}
          </div>
          {(perms.length > 0 || intents.length > 0) && (
            <div className="rounded-xl border border-line bg-white/[0.015] p-3">
              <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-2"><KeyRound size={11} /> Requested permissions{p?.manifest?.inferred ? ' (inferred from code)' : ''}</div>
              <div className="flex flex-wrap gap-1.5">
                {perms.map((x) => <Badge key={x} color={/admin/i.test(x) ? '#f43f5e' : /manage|ban|kick/i.test(x) ? '#f97316' : '#8d93a8'} className="mono">{x}</Badge>)}
                {intents.map((x) => <Badge key={`i-${x}`} color={/message_?content/i.test(x) ? '#f59e0b' : '#60a5fa'} className="mono">intent:{x}</Badge>)}
              </div>
            </div>
          )}
          {rules.length ? (
            <div className="overflow-x-auto scroll-thin -mx-4 px-4">
              <table className="w-full text-[12px] min-w-[520px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-dim text-left">
                    <th className="font-medium py-1.5 pr-3">Rule</th>
                    <th className="font-medium py-1.5 pr-3">Requirement</th>
                    <th className="font-medium py-1.5 pr-3">Sev.</th>
                    <th className="font-medium py-1.5 pr-3">Status</th>
                    <th className="font-medium py-1.5">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={`${r.id}-${i}`} className="border-t border-line align-top hover:bg-white/[0.02]">
                      <td className="py-2 pr-3 mono text-[11px] text-muted whitespace-nowrap">{r.id}</td>
                      <td className="py-2 pr-3 text-fg/90">{r.title}</td>
                      <td className="py-2 pr-3 text-[10.5px] whitespace-nowrap" style={{ color: SEV_COLOR[r.severity] ?? '#8d93a8' }}>{r.severity || '—'}</td>
                      <td className="py-2 pr-3"><Badge color={RULE_COLOR[r.status] ?? '#8d93a8'} dot>{r.status}</Badge></td>
                      <td className="py-2 text-[11.5px] text-muted break-words">{r.evidence || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-muted">No rule results returned.</div>
          )}
          {bullets.length > 0 && (
            <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/[0.05] p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10.5px] uppercase tracking-wider text-indigo-300 font-semibold">Kai’s reviewer notes</span>
                {review && (
                  <span className="ml-auto text-[10px] mono text-dim">
                    {review.live ? <>via Flatkey · {str(review.model) ?? 'model'}</> : 'offline brain · local'}
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {bullets.map((b, i) => (
                  <li key={i} className="text-[12px] text-fg/85 flex gap-2"><span className="text-indigo-300">•</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function MiniGrade({ audit, size = 36 }: { audit: Audit; size?: number }): ReactNode {
  const done = audit.status === 'done' && audit.grade;
  const c = gradeColor(audit.grade);
  if (!done) {
    return (
      <span className="grid place-items-center rounded-full border border-line shrink-0" style={{ width: size, height: size }}>
        {audit.status === 'error' ? <CircleX size={16} className="text-rose-400" /> : <LoaderCircle size={16} className="animate-spin text-violet-300" />}
      </span>
    );
  }
  return (
    <ScoreRing value={audit.score ?? 0} size={size} stroke={3} color={c} glow={false}>
      <span className="text-[14px] font-bold" style={{ color: c }}>{audit.grade}</span>
    </ScoreRing>
  );
}
