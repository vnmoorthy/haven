import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { ArrowRight, Bot, Clock, FolderGit2, History, ListChecks, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { useHaven } from '../lib/store';
import { api } from '../lib/api';
import type { Audit } from '../lib/types';
import { Badge, Button, Empty, PageHeader, Panel, Spinner, TimeAgo, ToolChip, fmtMs } from '../components/ui';
import { AgentAvatar } from '../components/Avatar';
import {
  GradeHero, MiniGrade, PrelintPanel, SnykPanel, StepTracker, TenkiPanel, gradeColor, prettyTarget, targetSub, verdictFor,
} from '../components/audits/AuditParts';

const GH_RE = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?(\.git)?$/i;
const STATUS_RANK: Record<string, number> = { queued: 0, running: 1, done: 2, error: 2 };
const progress = (a: Audit) => (STATUS_RANK[a.status] ?? 0) * 1000 + (a.steps ?? []).filter((s) => s.status === 'done' || s.status === 'error').length * 10 + (a.steps ?? []).filter((s) => s.status === 'running').length;
const STATUS_COLOR: Record<Audit['status'], string> = { queued: '#8d93a8', running: '#a78bfa', done: '#10b981', error: '#f43f5e' };

export default function Audits() {
  const live = useHaven((s) => s.audits);
  const [fetched, setFetched] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<Audit[]>('/api/audits')
      .then((rows) => { if (alive && Array.isArray(rows)) setFetched(rows); })
      .catch(() => { /* live store fills in */ })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const audits = useMemo(() => {
    const m = new Map<string, Audit>();
    for (const a of fetched) if (a?.id) m.set(a.id, a);
    for (const a of Object.values(live)) {
      if (!a?.id) continue;
      const prev = m.get(a.id);
      if (!prev || progress(a) >= progress(prev)) m.set(a.id, a);
    }
    return [...m.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [fetched, live]);

  const selected = audits.find((a) => a.id === selectedId) ?? audits[0] ?? null;

  // If a selected audit was refreshed via REST, re-poll it until done (covers missed websocket frames).
  useEffect(() => {
    if (!selected || selected.status === 'done' || selected.status === 'error') return;
    const t = setInterval(() => {
      api.get<Audit>(`/api/audits/${selected.id}`).then((a) => {
        if (a?.id === selected.id) setFetched((prev) => [a, ...prev.filter((p) => p.id !== a.id)]);
      }).catch(() => { /* ignore */ });
    }, 2500);
    return () => clearInterval(t);
  }, [selected?.id, selected?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (target: string, key: string) => {
    setSubmitting(key); setSubmitErr(null);
    try {
      const a = await api.post<Audit>('/api/audits', { target });
      if (a?.id) {
        setFetched((prev) => [a, ...prev.filter((p) => p.id !== a.id)]);
        setSelectedId(a.id);
      }
    } catch (e) {
      setSubmitErr((e as Error).message || 'Could not start audit');
    } finally {
      setSubmitting(null);
    }
  };

  const submitUrl = (e?: FormEvent) => {
    e?.preventDefault();
    const v = url.trim();
    if (!v) { setUrlErr('Paste a public GitHub repository URL'); return; }
    if (!GH_RE.test(v)) { setUrlErr('That doesn’t look like github.com/owner/repo'); return; }
    setUrlErr(null);
    void start(/^https?:\/\//i.test(v) ? v.replace(/\.git$/, '').replace(/\/$/, '') : `https://${v.replace(/\.git$/, '').replace(/\/$/, '')}`, 'url');
  };

  const stats = useMemo(() => {
    const done = audits.filter((a) => a.status === 'done');
    const blocked = done.filter((a) => /^[DF]/i.test(a.grade ?? '')).length;
    return { total: audits.length, done: done.length, blocked, approved: done.filter((a) => /^[AB]/i.test(a.grade ?? '')).length };
  }, [audits]);

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Security · Kai <ToolChip id="snyk" /><ToolChip id="tenki" /><ToolChip id="prelint" /></span>}
        title="Bot security audits"
        subtitle="Before a community installs a third-party bot, Kai audits it: Snyk → Tenki sandbox → Prelint spec check."
        actions={
          <div className="flex items-center gap-2">
            <Badge color="#8d93a8">{stats.total} audits</Badge>
            <Badge color="#10b981" dot>{stats.approved} approved</Badge>
            <Badge color="#f43f5e" dot>{stats.blocked} blocked</Badge>
          </div>
        }
      />

      {/* Launcher */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel relative overflow-hidden p-5 mb-5">
        <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col xl:flex-row gap-5 xl:items-center">
          <div className="flex items-center gap-3 xl:w-[300px] shrink-0">
            <AgentAvatar id="kai" size={52} />
            <div>
              <div className="text-[15px] font-semibold">Ask Kai to audit a bot</div>
              <div className="text-[12px] text-muted leading-snug">Paste any public repo. Kai scans deps, runs tests in a throwaway sandbox and checks permissions against your spec.</div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <form onSubmit={submitUrl} className="flex flex-col sm:flex-row gap-2">
              <label className={clsx('flex-1 flex items-center gap-2 rounded-xl border bg-ink-900/70 px-3.5 py-2.5 transition-colors focus-within:border-violet-400/60',
                urlErr ? 'border-rose-500/50' : 'border-line-strong')}>
                <FolderGit2 size={16} className="text-dim shrink-0" />
                <input value={url} onChange={(e) => { setUrl(e.target.value); if (urlErr) setUrlErr(null); }}
                  placeholder="https://github.com/owner/discord-bot" spellCheck={false}
                  className="bg-transparent outline-none flex-1 text-[14px] mono placeholder:text-dim placeholder:font-sans min-w-0" />
              </label>
              <Button type="submit" variant="primary" size="lg" disabled={!!submitting}
                icon={submitting === 'url' ? <Spinner /> : <ShieldCheck size={16} />}>
                Audit repo
              </Button>
            </form>
            {urlErr && <div className="text-[11.5px] text-rose-300 mt-1.5">{urlErr}</div>}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-[11px] text-dim mr-1">Try a sample:</span>
              <Button size="sm" variant="outline" disabled={!!submitting} onClick={() => start('sample', 'sample')}
                icon={submitting === 'sample' ? <Spinner className="w-3 h-3" /> : <ShieldAlert size={13} className="text-rose-400" />}>
                Audit sample: RaidShield Pro (sketchy)
              </Button>
              <Button size="sm" variant="outline" disabled={!!submitting} onClick={() => start('safe-sample', 'safe')}
                icon={submitting === 'safe' ? <Spinner className="w-3 h-3" /> : <Bot size={13} className="text-emerald-400" />}>
                Audit sample: safe bot
              </Button>
              <div className="hidden lg:flex items-center gap-1.5 ml-auto text-[11px] text-dim">
                <ToolChip id="snyk" /><ArrowRight size={11} /><ToolChip id="tenki" /><ArrowRight size={11} /><ToolChip id="prelint" /><ArrowRight size={11} />
                <span className="text-fg/80 font-semibold">Grade</span>
              </div>
            </div>
            {submitErr && <div className="text-[11.5px] text-rose-300 mt-2">Couldn’t start audit: {submitErr}</div>}
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* History */}
        <Panel title="Audit history" icon={<History size={14} />} pad={false} className="lg:sticky lg:top-20">
          {loading && audits.length === 0 ? (
            <div className="p-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-xl shimmer bg-white/[0.02]" />)}</div>
          ) : audits.length === 0 ? (
            <Empty icon={<ListChecks size={24} />} title="No audits yet" body="Run a sample above to watch Kai work." />
          ) : (
            <div className="p-2 max-h-[70vh] overflow-auto scroll-thin">
              <AnimatePresence initial={false}>
                {audits.map((a) => {
                  const active = selected?.id === a.id;
                  return (
                    <motion.button key={a.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      onClick={() => setSelectedId(a.id)}
                      className={clsx('relative w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left cursor-pointer transition-colors',
                        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]')}>
                      {active && <motion.span layoutId="audit-active" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full brand-gradient" />}
                      <MiniGrade audit={a} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{prettyTarget(a.target)}</div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-dim">
                          <span style={{ color: STATUS_COLOR[a.status] }}>{a.status}</span> · <TimeAgo ts={a.createdAt} />
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </Panel>

        {/* Detail */}
        <div className="min-w-0">
          {!selected ? (
            <div className="panel grid-bg">
              <Empty icon={<Sparkles size={28} />} title="Pick a bot to audit"
                body="Haven blocks risky bots before they ever get admin permissions in your community. Start with the sketchy sample to see a failing grade."
                action={<Button variant="primary" onClick={() => start('sample', 'sample')} icon={<ShieldAlert size={14} />}>Audit RaidShield Pro</Button>} />
            </div>
          ) : (
            <AuditDetail key={selected.id} audit={selected} />
          )}
        </div>
      </div>
    </div>
  );
}

function AuditDetail({ audit }: { audit: Audit }) {
  const finished = audit.status === 'done' || audit.status === 'error';
  const v = verdictFor(audit.grade);
  const isUrl = /github\.com/i.test(audit.target);
  const bot = audit.prelint?.bot as { name?: string | null; version?: string | null; author?: unknown; description?: unknown } | undefined;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="panel relative overflow-hidden">
        <div className="absolute -top-32 left-1/3 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-[0.12] pointer-events-none"
          style={{ background: finished && audit.grade ? gradeColor(audit.grade) : '#8b5cf6' }} />
        <div className="relative px-5 pt-4 pb-3 border-b border-line flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-white/[0.05] border border-line"><Bot size={18} className="text-muted" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight truncate">
              {prettyTarget(audit.target)}
              {bot?.name && bot.name !== prettyTarget(audit.target) && <span className="text-muted font-normal"> · {bot.name}{bot.version ? ` v${bot.version}` : ''}</span>}
            </div>
            <div className="text-[11.5px] text-dim truncate">
              {isUrl ? <a href={audit.target} target="_blank" rel="noreferrer noopener" className="hover:text-fg mono">{audit.target}</a> : targetSub(audit.target)}
              {typeof bot?.author === 'string' && bot.author ? <> · by {bot.author}</> : null}
              {typeof bot?.description === 'string' && bot.description ? <> · {bot.description}</> : null}
            </div>
          </div>
          <Badge color={STATUS_COLOR[audit.status]} dot>{audit.status}</Badge>
          <span className="inline-flex items-center gap-1 text-[11.5px] text-dim"><Clock size={12} />
            {audit.finishedAt ? fmtMs(audit.finishedAt - audit.createdAt) : <TimeAgo ts={audit.createdAt} />}
          </span>
        </div>
        <div className="relative grid grid-cols-1 xl:grid-cols-[1fr_1.05fr] gap-6 p-5">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-semibold mb-3">Audit pipeline</div>
            <StepTracker audit={audit} />
          </div>
          <div className="xl:border-l xl:border-line xl:pl-6">
            <GradeHero audit={audit} />
            {finished && audit.grade && (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-line bg-white/[0.02] py-2">
                  <div className="text-[9.5px] uppercase tracking-wider text-dim">Grade</div>
                  <div className="text-[18px] font-bold" style={{ color: gradeColor(audit.grade) }}>{audit.grade}</div>
                </div>
                <div className="rounded-xl border border-line bg-white/[0.02] py-2">
                  <div className="text-[9.5px] uppercase tracking-wider text-dim">Score</div>
                  <div className="text-[18px] font-semibold mono">{audit.score != null ? Math.round(audit.score) : '—'}</div>
                </div>
                <div className="rounded-xl border border-line bg-white/[0.02] py-2">
                  <div className="text-[9.5px] uppercase tracking-wider text-dim">Decision</div>
                  <div className="text-[12px] font-semibold mt-1 px-1 leading-tight" style={{ color: v.color }}>{v.label.split(' —')[0]}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <SnykPanel audit={audit} />
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5 items-start">
        <TenkiPanel audit={audit} />
        <PrelintPanel audit={audit} />
      </div>
    </motion.div>
  );
}
