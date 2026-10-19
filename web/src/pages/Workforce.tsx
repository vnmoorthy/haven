import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Clock, Cpu, Minimize2, RefreshCw, ScanFace, Users, X, Zap } from 'lucide-react';
import { useHaven } from '../lib/store';
import { api } from '../lib/api';
import type { Skill } from '../lib/types';
import { Button, Counter, PageHeader, Stat, ToolChip, fmtUsd } from '../components/ui';
import { OrgChart } from '../components/workforce/OrgChart';
import { EmployeeCard } from '../components/workforce/EmployeeCard';
import { normalizeSkills, pushToast, useDebounced } from '../components/workforce/shared';

interface Notice { tool: 'masky' | 'kylon'; ok: boolean; title: string; detail: string }

export default function Workforce() {
  const workforce = useHaven((s) => s.workforce);
  const metrics = useHaven((s) => s.metrics);
  const agentStatus = useHaven((s) => s.agentStatus);
  const incidents = useHaven((s) => s.incidents);
  const band = useHaven((s) => s.band);
  const communities = useHaven((s) => s.communities);
  const storeAudits = useHaven((s) => s.audits);
  const integrations = useHaven((s) => s.integrations);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<Record<string, Record<string, number>>>({});
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | 'masky' | 'kylon'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadStats = useCallback(async () => {
    const ids = useHaven.getState().workforce.map((w) => w.id);
    const res = await Promise.allSettled(ids.map((id) => api.get(`/api/agents/${id}`)));
    const next: Record<string, Record<string, number>> = {};
    res.forEach((r, i) => { if (r.status === 'fulfilled' && r.value?.stats) next[ids[i]] = r.value.stats; });
    setStats((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    api.get('/api/skills').then((s) => setSkills(normalizeSkills(s))).catch(() => setSkills([]));
    api.get<any[]>('/api/audits').then((a) => setAuditCount(Array.isArray(a) ? a.length : 0)).catch(() => setAuditCount(null));
  }, []);

  // React to live activity: refresh per-employee stats when incidents / BAND traffic change.
  const pulse = useDebounced(`${incidents.length}:${incidents[0]?.updatedAt ?? 0}:${band.length}:${band[band.length - 1]?.id ?? ''}`, 1500);
  useEffect(() => { void loadStats(); }, [pulse, loadStats]);
  const auditsKnown = Math.max(auditCount ?? 0, Object.keys(storeAudits).length);

  const kpiFor = useCallback((id: string, metric: string): number | null => {
    const st = stats[id] ?? {};
    switch (metric) {
      case 'screened': return metrics?.screened ?? null;
      case 'decisions': return st.bandSent ?? null;
      case 'detonations': return Math.max(st.incidents ?? 0, incidents.filter((i) => i.kind === 'phishing' || i.kind === 'scam').length);
      case 'supported': return incidents.filter((i) => i.kind === 'crisis').length;
      case 'audits': return auditsKnown;
      case 'questions': return Math.max(st.bandReceived ?? 0, band.filter((b) => b.from === 'founder' && b.to === id).length);
      case 'policies': return st.incidents ?? st.bandSent ?? null;
      case 'onboarded': return communities.length;
      default: return st.incidents ?? null;
    }
  }, [stats, metrics?.screened, incidents, auditsKnown, band, communities.length]);

  const busyCount = workforce.filter((w) => (agentStatus[w.id]?.status ?? 'idle') !== 'idle').length;
  const maskyMode = integrations.find((i) => i.id === 'masky')?.mode;
  const kylonMode = integrations.find((i) => i.id === 'kylon')?.mode;
  const ordered = useMemo(() => {
    const order = ['aria', 'nova', 'rex', 'mira', 'kai', 'iris', 'juno', 'leo'];
    return [...workforce].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [workforce]);

  const provision = async () => {
    setBusy('masky');
    try {
      const r = await api.post<Record<string, { avatarId: string; imageUrl: string; liveUrl?: string }>>('/api/masky/provision');
      const n = r && typeof r === 'object' ? Object.keys(r).length : 0;
      if (n > 0) {
        setNotice({ tool: 'masky', ok: true, title: `${n}/${workforce.length} employees have a Masky face + voice`, detail: Object.entries(r).map(([k, v]) => `${k}: avatar ${v.avatarId}${v.liveUrl ? ' · live session ready' : ''}`).join('\n') });
        pushToast('success', 'Masky avatars provisioned', `${n} employees now have a Masky face and voice`, 'aria');
      } else {
        const detail = 'Masky is running in local mode — no MASKY_API_KEY is configured, so employees keep their generated portraits and speak through the local browser voice engine. Add MASKY_API_KEY (and MASKY_BASE_URL) to the server .env and click again to provision real faces + voices.';
        setNotice({ tool: 'masky', ok: false, title: 'Masky · local mode', detail });
        pushToast('info', 'Masky in local mode', 'Employees use local voices. Add MASKY_API_KEY to provision real avatars.', 'aria');
      }
    } catch (e: any) {
      setNotice({ tool: 'masky', ok: false, title: 'Masky provisioning failed', detail: String(e?.message ?? e) });
      pushToast('error', 'Masky provisioning failed', String(e?.message ?? e));
    } finally { setBusy(null); }
  };

  const sync = async () => {
    setBusy('kylon');
    try {
      const r = await api.post<{ ok: boolean; detail: string }>('/api/kylon/sync');
      setNotice({ tool: 'kylon', ok: !!r?.ok, title: r?.ok ? 'Workforce synced to Kylon' : 'Kylon · local manifest only', detail: r?.detail ?? 'No detail returned.' });
      pushToast(r?.ok ? 'success' : 'info', r?.ok ? 'Synced to Kylon' : 'Kylon sync not configured', r?.detail?.slice(0, 140));
    } catch (e: any) {
      setNotice({ tool: 'kylon', ok: false, title: 'Kylon sync failed', detail: String(e?.message ?? e) });
      pushToast('error', 'Kylon sync failed', String(e?.message ?? e));
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2"><Users size={12} /> AI Workforce · powered by <ToolChip id="kylon" /></span>}
        title={<span>Meet the <span className="text-gradient">team</span></span>}
        subtitle={<>Eight AI employees with real roles, reporting lines, tools, skills and budgets. Each one has a face and voice from Masky, talks to the others over BAND, thinks through Flatkey and learns Finch skills. Click anyone to talk to them.</>}
        actions={<>
          <Button onClick={provision} disabled={busy !== null} icon={busy === 'masky' ? <RefreshCw size={15} className="animate-spin" /> : <ScanFace size={15} />}>
            Provision Masky avatars
            <span className="mono text-[10px] text-dim">{maskyMode ?? ''}</span>
          </Button>
          <Button variant="primary" onClick={sync} disabled={busy !== null} icon={busy === 'kylon' ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}>
            Sync to Kylon
            {kylonMode && <span className="mono text-[10px] text-white/70">{kylonMode}</span>}
          </Button>
        </>}
      />

      <AnimatePresence>
        {notice && (
          <motion.div key={notice.title} initial={{ opacity: 0, height: 0, y: -8 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -8 }} className="overflow-hidden">
            <div className="panel mb-4 p-4 flex gap-3" style={{ borderColor: notice.ok ? '#10b98155' : '#f59e0b55' }}>
              <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: notice.ok ? '#10b98122' : '#f59e0b1f', color: notice.ok ? '#10b981' : '#f59e0b' }}>
                {notice.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{notice.title} <ToolChip id={notice.tool} /></div>
                <pre className="mt-1.5 text-xs text-muted whitespace-pre-wrap break-words mono leading-relaxed">{notice.detail}</pre>
              </div>
              <button onClick={() => setNotice(null)} className="self-start p-1 rounded-lg text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer" aria-label="Dismiss"><X size={15} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Team pulse */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Stat label="On shift" accent="#8b5cf6" icon={<Users size={13} />} value={<>{workforce.length}<span className="text-muted text-base"> / {workforce.length}</span></>} sub="24/7 · no PTO required" />
        <Stat label="Busy right now" accent="#22d3ee" icon={<Zap size={13} />} value={<Counter value={busyCount} />} sub={busyCount ? 'Working live incidents' : 'All quiet — watching the queue'} />
        <Stat label="Model spend" accent="#c084fc" icon={<Cpu size={13} />} value={fmtUsd(metrics?.llmSpendUsd ?? 0)} sub={<span className="inline-flex items-center gap-1.5">{(metrics?.llmCalls ?? 0).toLocaleString()} calls via <ToolChip id="flatkey" /></span>} />
        <Stat label="Context saved" accent="#34d399" icon={<Minimize2 size={13} />} value={<Counter value={metrics?.tokensSaved ?? 0} />} sub={<span className="inline-flex items-center gap-1.5">tokens compressed by <ToolChip id="paritok" /></span>} />
        <Stat label="Human hours saved" accent="#f472b6" icon={<Clock size={13} />} value={<Counter value={metrics?.humanHoursSaved ?? 0} format={(n) => n.toFixed(1)} />} sub="vs. a human moderation team" className="col-span-2 lg:col-span-1" />
      </div>

      <div className="mb-5"><OrgChart /></div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 min-[1400px]:grid-cols-4 gap-4">
        {ordered.map((emp, i) => <EmployeeCard key={emp.id} emp={emp} index={i} skills={skills} kpi={kpiFor(emp.id, emp.kpi.metric)} />)}
      </div>
    </div>
  );
}
