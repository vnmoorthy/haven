import { config } from '../config.js';
import { db } from '../db.js';
import { emit } from '../events.js';
import { id, now, estTokens, URL_RE } from '../util.js';
import { complete } from './flatkey.js';

// Paritok keeps Haven's long-running AI employees inside their context budget. When an employee's working memory
// grows (hundreds of screened messages, BAND threads, tool outputs) we compress it: Paritok's GPU compressor when
// a key is configured, otherwise a local extractive + abstractive compressor that keeps every load-bearing line
// (incident ids, decisions, numbers, URLs, obligations, escalations) and summarises the rest.

export interface CompressionResult {
  id: string; agentId: string; beforeTokens: number; afterTokens: number; summary: string; kept: string[];
  method: 'paritok' | 'local'; ratio: number; createdAt: number;
}

const stats = { liveCalls: 0, liveErrors: 0, lastError: '', gpuUnavailable: 0 };

const IMPORTANT: [RegExp, number][] = [
  [/\binc_[a-z0-9]+\b/i, 3],
  [/\b(decid\w*|approv\w*|ban(ned)?|mut(e|ed)|quarantin\w*|removed?|resolved|dismiss\w*|warn(ed)?|blocked|blocklist\w*|verdict)\b/i, 2.5],
  [/\b(must|never|always|required?|policy|sla)\b/i, 2],
  [/\bescalat\w*/i, 3],
  [/\b(crisis|critical|self[- ]harm|suicid\w*|988)\b/i, 3],
  [/\b(phishing|scam|raid|harass\w*|hate|malicious|suspicious)\b/i, 1.5],
  [/\b\d+(\.\d+)?(%|ms|s|x|\$)?/, 1],
  [/\$\d/, 1.5],
];

const norm = (s: string) => s.toLowerCase().replace(URL_RE, 'URL').replace(/\b[a-z]+_[a-z0-9]{6,}\b/g, 'ID').replace(/\d+/g, '#').replace(/[^a-z#\s]/g, ' ').replace(/\s+/g, ' ').trim();

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

function scoreLine(line: string, queryWords: Set<string>): number {
  let s = 0;
  for (const [re, w] of IMPORTANT) if (re.test(line)) s += w;
  if (new RegExp(URL_RE.source, 'i').test(line)) s += 2.5;
  if (queryWords.size) {
    const words = new Set(norm(line).split(' '));
    let hits = 0;
    for (const w of queryWords) if (words.has(w)) hits++;
    s += hits * 1.5;
  }
  return s;
}

/** Local compressor: dedupe → extractive keep → abstractive summary (model if reachable, deterministic otherwise). */
async function localCompress(agentId: string, items: string[], query?: string) {
  const lines = items.flatMap((it) => String(it ?? '').split('\n')).map((l) => l.trim()).filter(Boolean);
  // 1) dedupe near-identical lines (same shape after masking ids / numbers / urls, or Jaccard >= 0.85)
  const groups: { line: string; key: string; words: Set<string>; count: number; idx: number }[] = [];
  lines.forEach((line, idx) => {
    // incident ids and URLs are identity — two lines about different incidents are never duplicates
    const anchors = [...(line.match(/\binc_[a-z0-9]+\b/gi) ?? []), ...(line.match(new RegExp(URL_RE.source, 'gi')) ?? [])].join(',').toLowerCase();
    const key = `${norm(line)}|${anchors}`;
    const words = new Set(norm(line).split(' ').filter((w) => w.length > 2));
    const dup = groups.find((g) => g.key === key || (g.key.endsWith(`|${anchors}`) && words.size >= 4 && jaccard(g.words, words) >= 0.85));
    if (dup) dup.count++;
    else groups.push({ line, key, words, count: 1, idx });
  });
  // 2) extractive keep — the load-bearing lines
  const queryWords = new Set(norm(query ?? '').split(' ').filter((w) => w.length > 3));
  const scored = groups.map((g) => ({ ...g, score: scoreLine(g.line, queryWords) }));
  const budget = Math.min(25, Math.max(4, Math.ceil(groups.length * 0.4)));
  const kept = [...scored].filter((g) => g.score >= 2.5).sort((a, b) => b.score - a.score).slice(0, budget)
    .sort((a, b) => a.idx - b.idx)
    .map((g) => (g.count > 1 ? `${g.line} (×${g.count})` : g.line))
    .map((l) => (l.length > 180 ? l.slice(0, 177) + '…' : l));
  // 3) abstractive summary of everything (incl. the dropped lines)
  const dropped = scored.filter((g) => !kept.some((k) => k.startsWith(g.line.slice(0, 40))));
  const r = await complete({
    agentId, purpose: 'context-compression', tier: 'fast', maxTokens: 220, temperature: 0.2,
    system: 'You compress an AI Trust & Safety employee\'s working memory. Write a dense 2-4 sentence summary that preserves counts, open threads, decisions and anything the employee must remember. No preamble.',
    messages: [{ role: 'user', content: `${query ? `Focus: ${query}\n` : ''}Memory (${lines.length} lines, ${groups.length} unique):\n${groups.map((g) => (g.count > 1 ? `${g.line} (×${g.count})` : g.line)).join('\n').slice(0, 9000)}` }],
  });
  const summary = r?.text?.trim() || deterministicSummary(lines, groups.length, kept.length, dropped.map((d) => d.line));
  return { summary, kept, model: r ? `${r.provider}/${r.model}` : 'offline-brain' };
}

function deterministicSummary(lines: string[], unique: number, keptCount: number, dropped: string[]): string {
  const all = lines.join('\n');
  const incidents = [...new Set(all.match(/\binc_[a-z0-9]+\b/gi) ?? [])];
  const urls = [...new Set(all.match(new RegExp(URL_RE.source, 'gi')) ?? [])];
  const kinds = ['phishing', 'scam', 'spam', 'harassment', 'crisis', 'raid', 'hate']
    .map((k) => [k, (all.match(new RegExp(`\\b${k}`, 'gi')) ?? []).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const actions = ['quarantined', 'removed', 'muted', 'banned', 'warned', 'escalated', 'resolved', 'approved', 'dismissed']
    .map((k) => [k, (all.match(new RegExp(`\\b${k}`, 'gi')) ?? []).length] as const).filter(([, n]) => n > 0);
  const routine = dropped.length;
  const parts = [
    `Compressed ${lines.length} memory lines (${unique} unique) to ${keptCount} load-bearing facts.`,
    incidents.length ? `Tracking ${incidents.length} incident${incidents.length === 1 ? '' : 's'} (${incidents.slice(0, 4).join(', ')}${incidents.length > 4 ? ', …' : ''}).` : '',
    kinds.length ? `Threat mix: ${kinds.map(([k, n]) => `${k} ×${n}`).join(', ')}.` : '',
    actions.length ? `Actions so far: ${actions.map(([k, n]) => `${k} ×${n}`).join(', ')}.` : '',
    urls.length ? `${urls.length} URL${urls.length === 1 ? '' : 's'} referenced.` : '',
    routine ? `${routine} routine line${routine === 1 ? '' : 's'} (benign chatter, acks, status pings) folded into this summary.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

async function paritokCompress(items: string[], query?: string): Promise<{ text: string; afterTokens?: number } | null> {
  if (!config.paritok.apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${(config.paritok.baseUrl || 'https://www.paritok.com/api').replace(/\/$/, '')}/compress`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${config.paritok.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'haven/1.0 (+https://github.com/vnmoorthy/haven)' },
      body: JSON.stringify({ content: items.join('\n'), query, upstream_model: 'claude-sonnet-4' }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    const j: any = await res.json();
    if (j?.gpu_available !== true) { stats.gpuUnavailable++; throw new Error('Paritok GPU unavailable — using local compressor'); }
    const text = [j.compressed, j.compressed_content, j.content, j.result, j.output, j.text].find((v) => typeof v === 'string' && v.trim());
    if (!text) throw new Error('Paritok response had no compressed content');
    stats.liveCalls++;
    const afterTokens = Number(j.compressed_tokens ?? j.output_tokens ?? j.tokens_after) || undefined;
    return { text, afterTokens };
  } catch (e) {
    stats.liveErrors++; stats.lastError = (e as Error).message;
    console.warn('[paritok] live compress failed → local:', stats.lastError);
    return null;
  } finally { clearTimeout(t); }
}

export async function compressContext(agentId: string, items: string[], query?: string): Promise<CompressionResult> {
  const clean = (items ?? []).map((s) => String(s ?? '')).filter((s) => s.trim());
  const beforeTokens = estTokens(clean.join('\n'));
  let method: 'paritok' | 'local' = 'local';
  let summary = '', kept: string[] = [], afterTokens = 0;

  const live = await paritokCompress(clean, query);
  if (live) {
    method = 'paritok';
    summary = live.text.length > 1200 ? live.text.slice(0, 1200) + '…' : live.text;
    kept = live.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
    afterTokens = live.afterTokens ?? estTokens(live.text);
  } else {
    const l = await localCompress(agentId, clean, query);
    summary = l.summary; kept = l.kept;
    afterTokens = estTokens([summary, ...kept].join('\n'));
  }
  afterTokens = Math.max(1, Math.min(afterTokens, beforeTokens));
  const ratio = Math.round((beforeTokens / afterTokens) * 10) / 10;
  const rec: CompressionResult = { id: id('cmp'), agentId, beforeTokens, afterTokens, summary, kept, method, ratio, createdAt: now() };
  db.insert('compressions', { id: rec.id, agentId, beforeTokens, afterTokens, method, summary, createdAt: rec.createdAt });
  emit('context.compressed', { id: rec.id, agentId, beforeTokens, afterTokens, method, summary, ratio, kept: kept.length });
  return rec;
}

export function compressionStats(): { totalSaved: number; runs: number; byAgent: Record<string, number> } {
  const rows = db.raw(`SELECT agent_id AS agent, COUNT(*) AS runs, COALESCE(SUM(before_tokens - after_tokens), 0) AS saved FROM compressions GROUP BY agent_id`);
  const byAgent: Record<string, number> = {};
  let totalSaved = 0, runs = 0;
  for (const r of rows) { byAgent[r.agent] = Number(r.saved) || 0; totalSaved += Number(r.saved) || 0; runs += Number(r.runs) || 0; }
  return { totalSaved, runs, byAgent };
}

export function paritokStatus() {
  const s = compressionStats();
  return {
    mode: config.paritok.apiKey ? ('paritok' as const) : ('local' as const),
    detail: config.paritok.apiKey
      ? `Paritok GPU compressor (${config.paritok.baseUrl || 'https://www.paritok.com/api'})${stats.gpuUnavailable ? ` — GPU unavailable ${stats.gpuUnavailable}x, used local` : ''}`
      : 'Local extractive + abstractive compressor (add PARITOK_API_KEY for Paritok)',
    ...s, ...stats,
  };
}
