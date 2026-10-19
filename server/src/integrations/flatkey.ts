import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { db } from '../db.js';
import { emit } from '../events.js';
import { id, now, estTokens, extractJson } from '../util.js';
import type { LlmCall, ModelTier } from '../types.js';

// Flatkey is Haven's single model gateway: every AI employee asks for a *tier* (fast / reasoning / coding / vision)
// and Flatkey maps it to the best model with automatic failover. When no Flatkey key is configured we fall back to
// direct provider keys, then to the local Claude Code CLI (opt-in), then to Haven's deterministic "offline brain".

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface CompleteOpts {
  agentId: string; purpose: string; tier: ModelTier; system?: string; messages: ChatMsg[];
  json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number;
}
export interface CompleteResult { text: string; model: string; provider: string; fallback: boolean; costUsd: number; latencyMs: number }

// $ per 1M tokens (input, output) — used for transparent cost accounting in the UI.
const PRICES: Record<string, [number, number]> = {
  'gemini-3.1-flash-lite': [0.25, 1.5], 'deepseek-v4-flash': [0.27, 1.1], 'claude-haiku-5-5': [1, 5], 'claude-sonnet-5': [3, 15],
  'gpt-4o-mini': [0.15, 0.6], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4o': [2.5, 10], 'deepseek-chat': [0.27, 1.1],
  'claude-sonnet-4-5': [3, 15], 'claude-haiku-4-5': [1, 5], 'gemini-2.5-flash': [0.3, 2.5], 'qwen-plus': [0.4, 1.2],
  'claude-cli': [0, 0], 'offline-brain': [0, 0],
};
const price = (model: string, pin: number, pout: number) => {
  const key = Object.keys(PRICES).find((k) => model.includes(k));
  const [a, b] = key ? PRICES[key] : [0.5, 1.5];
  return (pin * a + pout * b) / 1_000_000;
};

export function llmMode(): { provider: string; live: boolean; detail: string } {
  if (config.flatkey.apiKey) return { provider: 'flatkey', live: true, detail: `Flatkey gateway (${config.flatkey.baseUrl})` };
  if (config.anthropicKey) return { provider: 'anthropic', live: true, detail: 'Direct Anthropic key (Flatkey not configured)' };
  if (config.openaiKey) return { provider: 'openai', live: true, detail: 'Direct OpenAI-compatible key (Flatkey not configured)' };
  if (config.localClaude) return { provider: 'claude-cli', live: true, detail: 'Local Claude Code CLI' };
  return { provider: 'offline-brain', live: false, detail: 'Deterministic offline brain (add FLATKEY_API_KEY for live models)' };
}

async function openaiCompatible(baseUrl: string, apiKey: string, model: string, o: CompleteOpts, extraHeaders: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model, max_tokens: o.maxTokens ?? 700, temperature: o.temperature ?? 0.4,
        messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), ...o.messages],
        ...(o.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return { text: j.choices?.[0]?.message?.content ?? '', pin: j.usage?.prompt_tokens, pout: j.usage?.completion_tokens, model: model, cost: typeof j.usage?.cost === 'number' ? j.usage.cost : undefined };
  } finally { clearTimeout(t); }
}

async function anthropic(o: CompleteOpts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: o.maxTokens ?? 700, system: o.system, messages: o.messages.filter((m) => m.role !== 'system') }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return { text: j.content?.map((c: any) => c.text || '').join('') ?? '', pin: j.usage?.input_tokens, pout: j.usage?.output_tokens, model: config.anthropicModel };
  } finally { clearTimeout(t); }
}

function claudeCli(o: CompleteOpts): Promise<{ text: string; model: string }> {
  return new Promise((resolve, reject) => {
    const prompt = `${o.system ? o.system + '\n\n' : ''}${o.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}${o.json ? '\n\nRespond with ONLY valid JSON.' : ''}`;
    const p = spawn('claude', ['-p', '--model', 'haiku', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('claude cli timeout')); }, o.timeoutMs ?? 45000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve({ text: out.trim(), model: 'claude-cli' }) : reject(new Error('claude cli exit ' + code)); });
    p.stdin.end(prompt);
  });
}

function record(o: CompleteOpts, model: string, provider: string, pin: number, pout: number, latencyMs: number, fallback: boolean, ok: boolean, realCost?: number): LlmCall {
  const call: LlmCall = { id: id('llm'), agentId: o.agentId, model, provider, purpose: o.purpose, promptTokens: pin, completionTokens: pout, costUsd: provider === 'offline-brain' || provider === 'claude-cli' || !ok ? 0 : realCost ?? price(model, pin, pout), latencyMs, fallback, createdAt: now(), ok };
  db.insert('llm_calls', call);
  emit('llm.call', call);
  return call;
}

/** Ask a model. Returns null when no live model is reachable — callers must then use their deterministic fallback. */
export async function complete(o: CompleteOpts): Promise<CompleteResult | null> {
  const promptText = (o.system ?? '') + o.messages.map((m) => m.content).join('\n');
  const t0 = now();
  const attempts: { provider: string; model: string; run: () => Promise<{ text: string; pin?: number; pout?: number; model: string; cost?: number }> }[] = [];
  // Spend guard: stay inside the configured model budget so a demo never dies on an empty balance.
  const spent = Number(db.raw('SELECT COALESCE(SUM(cost_usd),0) s FROM llm_calls')[0]?.s ?? 0);
  if (spent >= config.llmBudgetUsd) return null;
  if (config.flatkey.apiKey) {
    const models = [config.flatkey.models[o.tier], ...config.flatkey.fallbacks].filter((m, i, a) => m && a.indexOf(m) === i);
    for (const m of models) attempts.push({ provider: 'flatkey', model: m, run: () => openaiCompatible(config.flatkey.baseUrl, config.flatkey.apiKey, m, o, { 'x-haven-agent': o.agentId }) });
  }
  if (config.anthropicKey) attempts.push({ provider: 'anthropic', model: config.anthropicModel, run: () => anthropic(o) });
  if (config.openaiKey) attempts.push({ provider: 'openai', model: config.openaiModel, run: () => openaiCompatible(config.openaiBaseUrl, config.openaiKey, config.openaiModel, o) });
  if (config.localClaude) attempts.push({ provider: 'claude-cli', model: 'claude-cli', run: () => claudeCli(o) });

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const t1 = now();
    try {
      const r = await a.run();
      const pin = r.pin ?? estTokens(promptText), pout = r.pout ?? estTokens(r.text);
      const call = record(o, r.model || a.model, a.provider, pin, pout, now() - t1, i > 0, true, r.cost);
      return { text: r.text, model: call.model, provider: a.provider, fallback: i > 0, costUsd: call.costUsd, latencyMs: now() - t0 };
    } catch (err) {
      record(o, a.model, a.provider, estTokens(promptText), 0, now() - t1, i > 0, false);
      console.warn(`[flatkey] ${a.provider}/${a.model} failed for ${o.agentId}:${o.purpose} →`, (err as Error).message);
    }
  }
  return null;
}

/** Same as complete() but parses JSON; returns null on failure so the caller can use its heuristic. */
export async function completeJson<T = any>(o: CompleteOpts): Promise<{ data: T; meta: CompleteResult } | null> {
  const r = await complete({ ...o, json: true });
  if (!r) return null;
  const data = extractJson<T>(r.text);
  return data ? { data, meta: r } : null;
}

/** Records a deterministic "offline brain" decision so the UI still shows which tier/model would have been used. */
export function recordOffline(agentId: string, purpose: string, tier: ModelTier, inputText: string, outputText: string) {
  const model = config.flatkey.models[tier];
  return record({ agentId, purpose, tier, messages: [] }, `${model} (offline)`, 'offline-brain', estTokens(inputText), estTokens(outputText), 3 + Math.round(Math.random() * 9), false, true);
}
