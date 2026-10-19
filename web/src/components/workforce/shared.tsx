import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useHaven } from '../../lib/store';
import type { AgentId, AgentState, BandMessage, Employee, LlmCall, ModelTier, Skill } from '../../lib/types';

// ───────────────────────────── Static metadata ─────────────────────────────

export const TEAM_ORDER: Employee['team'][] = ['Safety Ops', 'Security', 'Intelligence', 'Product', 'Growth'];
export const TEAM_COLOR: Record<Employee['team'], string> = {
  Executive: '#8b5cf6', 'Safety Ops': '#22d3ee', Security: '#10b981', Intelligence: '#facc15', Product: '#60a5fa', Growth: '#a3e635',
};

export const TIER_META: Record<ModelTier, { label: string; color: string; blurb: string }> = {
  fast: { label: 'Fast tier', color: '#22d3ee', blurb: 'Low-latency model for high-volume screening' },
  reasoning: { label: 'Reasoning tier', color: '#c084fc', blurb: 'Frontier model for judgement calls' },
  coding: { label: 'Coding tier', color: '#34d399', blurb: 'Code-specialised model for audits' },
  vision: { label: 'Vision tier', color: '#fb923c', blurb: 'Multimodal model that reads screenshots' },
};

export const STATUS_META: Record<string, { label: string; color: string }> = {
  idle: { label: 'Available', color: '#10b981' },
  thinking: { label: 'Thinking', color: '#a78bfa' },
  working: { label: 'Working', color: '#22d3ee' },
  speaking: { label: 'Speaking', color: '#f472b6' },
  waiting: { label: 'Waiting on you', color: '#f59e0b' },
};

/** One-line explanation of how each sponsor tool is used by an employee. */
export const TOOL_INFO: Record<string, string> = {
  kylon: 'Employee record, role and reporting line live in the Kylon workforce manifest.',
  masky: 'A real face and voice — speaks to the founder and to community members.',
  band: 'Agent-to-agent messaging: delegations, hand-offs, reports and acks.',
  n8n: 'Business automations — paging on-call humans, onboarding, weekly reports.',
  rocketride: 'Runs .pipe AI pipelines (triage, insights) stage by stage.',
  adal: 'Drives a real browser to click through pages and collect evidence.',
  celesto: 'Isolated sandbox computer for detonating untrusted links and code.',
  flatkey: 'Model gateway — routes every call to the right model with fallbacks and cost tracking.',
  promptql: 'Natural-language queries over live safety data and the shared context wiki.',
  paritok: 'Compresses long-running working memory so context stays inside budget.',
  finch: 'Versioned, reusable skills whose instructions are injected into prompts.',
  tenki: 'Sandboxed test runners that execute third-party bot test suites.',
  prelint: 'Checks bot behaviour and permissions against the product spec.',
  snyk: 'Dependency and source vulnerability scanning before anything ships.',
};

export const SUGGESTED_PROMPTS: Record<string, string[]> = {
  aria: ['What needs my attention today?', 'Summarize the last hour in 3 bullets.', 'When do you escalate to me vs. auto-act?'],
  nova: ['How do you score risk on a message?', 'What did you quarantine recently?', 'How fast is your triage pipeline?'],
  rex: ['How do you detonate a link safely?', 'What makes a URL look like phishing?', 'Which indicators went on the blocklist?'],
  mira: ['How do you handle a member in crisis?', 'When do you hand off to a human?', 'How do you de-escalate a heated thread?'],
  kai: ['Why is ADMINISTRATOR permission dangerous?', 'How do you audit a third-party bot?', 'What does a failing Snyk scan block?'],
  iris: ['What is our cost per incident?', 'Which channel has the most threats?', 'What trend should I worry about?'],
  juno: ['How do you decide harassment vs. banter?', 'What policy would you change this week?', 'How do incidents become policy?'],
  leo: ['How is MRR trending?', 'How do you onboard a new community?', 'Which customer is at churn risk?'],
};

// ───────────────────────────── Types & helpers ─────────────────────────────

export interface AgentDetail {
  employee: Employee | null;
  status: AgentState | null;
  memory: { items: string[]; tokens: number; budget: number };
  stats: Record<string, number>;
  recentBand: BandMessage[];
  recentLlm: LlmCall[];
  compressions: any[];
}

export function normalizeDetail(raw: any): AgentDetail {
  const r = raw ?? {};
  const mem = r.memory ?? {};
  return {
    employee: r.employee ?? null,
    status: r.status ?? null,
    memory: { items: Array.isArray(mem.items) ? mem.items.map(String) : [], tokens: Number(mem.tokens) || 0, budget: Number(mem.budget) || 8000 },
    stats: r.stats && typeof r.stats === 'object' ? r.stats : {},
    recentBand: Array.isArray(r.recentBand) ? r.recentBand : [],
    recentLlm: Array.isArray(r.recentLlm) ? r.recentLlm : [],
    compressions: Array.isArray(r.compressions) ? r.compressions : [],
  };
}

export const normalizeSkills = (raw: any): Skill[] =>
  (Array.isArray(raw) ? raw : []).map((s: any) => ({ ...s, enabledFor: Array.isArray(s?.enabledFor) ? s.enabledFor : [] }));

export const compactNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString());

/** Push a toast into the shared store (same rendering as server-sent toasts). */
export function pushToast(level: 'info' | 'success' | 'warn' | 'error', title: string, body?: string, agentId?: string) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  useHaven.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, level, title, body, agentId }] }));
  setTimeout(() => useHaven.getState().dismissToast(id), 6000);
}

/**
 * Debounced "something about this agent changed" signal derived from the live store, so detail views can re-fetch
 * when new BAND messages / model calls / incidents involving the agent stream in.
 */
export function useAgentPulse(agentId: string | undefined) {
  return useHaven((s) => {
    if (!agentId) return '';
    let band = 0, bandLast = 0, llm = 0, llmLast = 0, inc = 0, incLast = 0;
    for (const b of s.band) if (b.from === agentId || b.to === agentId) { band++; bandLast = Math.max(bandLast, b.createdAt); }
    for (const c of s.llm) if (c.agentId === agentId) { llm++; llmLast = Math.max(llmLast, c.createdAt); }
    for (const i of s.incidents) if (i.assignedTo === agentId) { inc++; incLast = Math.max(incLast, i.updatedAt); }
    return `${band}:${bandLast}:${llm}:${llmLast}:${inc}:${incLast}`;
  });
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Re-render periodically (for relative timestamps etc). */
export function useTick(ms = 5000) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function useMounted() {
  const ref = useRef(true);
  useEffect(() => { ref.current = true; return () => { ref.current = false; }; }, []);
  return ref;
}

// ───────────────────────────── Small UI pieces ─────────────────────────────

export function Switch({ on, onChange, color = '#8b5cf6', disabled, label }: { on: boolean; onChange: (v: boolean) => void; color?: string; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={clsx('relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        on ? 'border-transparent' : 'border-line-strong bg-white/[0.06]')}
      style={on ? { background: color, boxShadow: `0 0 16px -4px ${color}` } : undefined}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={clsx('block h-4 w-4 rounded-full bg-white shadow', on ? 'ml-[18px]' : 'ml-[2px]')} />
    </button>
  );
}

export function StatusPill({ agentId, className }: { agentId: string; className?: string }) {
  const st = useHaven((s) => s.agentStatus[agentId]);
  const meta = STATUS_META[st?.status ?? 'idle'] ?? STATUS_META.idle;
  const busy = (st?.status ?? 'idle') !== 'idle';
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[11.5px] font-medium min-w-0', className)} style={{ color: meta.color }}>
      <span className="relative flex w-2 h-2 shrink-0">
        {busy && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: meta.color, opacity: 0.6 }} />}
        <span className="relative w-2 h-2 rounded-full" style={{ background: meta.color }} />
      </span>
      {meta.label}
    </span>
  );
}

/** Animated speaking waveform. */
export function Waveform({ color, active, bars = 5, className }: { color: string; active: boolean; bars?: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-end gap-[3px] h-4', className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span key={i} className="w-[3px] rounded-full" style={{ background: color }}
          animate={active ? { height: ['30%', '100%', '45%', '85%', '30%'] } : { height: '25%' }}
          transition={active ? { duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' } : { duration: 0.3 }} />
      ))}
    </span>
  );
}

export const agentName = (workforce: Employee[], id: string) =>
  id === 'founder' ? useHaven.getState().founder?.name ?? 'Founder' : workforce.find((w) => w.id === id)?.name ?? id;

export const isAgentId = (workforce: Employee[], id: string): id is AgentId => workforce.some((w) => w.id === id);

/** Readable foreground (dark or white) for text drawn on top of an accent colour. */
export function onColor(hex: string) {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#05060a' : '#fff';
}
