import { config } from '../config.js';
import { db } from '../db.js';
import { emit, sleep } from '../events.js';
import { now } from '../util.js';
import { ROSTER, employee } from '../agents/roster.js';
import type { AgentId } from '../types.js';

// Masky.AI gives every Haven AI employee a face and a voice. With MASKY_API_KEY set, each employee gets a generated
// portrait, a Masky avatar with a distinct voice, and a live conversation; every time an employee speaks we inject a
// verbatim `speak` turn and hand the rendered audio URL to the browser. Without a key we emit the same `voice.say`
// event with no audioUrl and the browser speaks with local TTS (and DiceBear faces) — the UI says "local".

export interface MaskyAvatar {
  avatarId: string; avatarOwnerUserId?: string; imageUrl: string; voiceId?: string;
  conversationId?: string; shareSlug?: string; liveUrl?: string; createdAt: number;
}
type AvatarMap = Record<string, MaskyAvatar>;

const KV_KEY = 'masky-avatars';
const stats = { spoken: 0, liveTurns: 0, audioReady: 0, errors: 0, lastError: '', provisioning: false };
const base = () => (config.masky.baseUrl || 'https://masky.ai/api').replace(/\/$/, '');
const live = () => !!config.masky.apiKey;
const FEMALE: AgentId[] = ['aria', 'nova', 'mira', 'iris', 'juno'];

async function api<T = any>(method: 'GET' | 'POST', path: string, body?: any, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, {
      method, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${config.masky.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Masky ${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
    return (text ? JSON.parse(text) : {}) as T;
  } finally { clearTimeout(t); }
}

const avatars = (): AvatarMap => db.kvGet<AvatarMap>(KV_KEY, {});
function saveAvatar(agentId: string, rec: MaskyAvatar) {
  const all = avatars();
  all[agentId] = rec;
  db.kvSet(KV_KEY, all);
}

function portraitPrompt(agentId: AgentId) {
  const e = employee(agentId);
  return `Head-and-shoulders portrait of ${e.name}, the ${e.title} at Haven, an AI Trust & Safety company. Personality: ${e.personality} `
    + `Stylized 3D illustrated character, friendly and trustworthy expression, soft studio light, subtle ${e.color} rim light, clean dark navy background, centered, high detail.`;
}

let voicesCache: { id: string; name: string }[] | null = null;
async function pickVoices(): Promise<Record<string, string | undefined>> {
  if (!voicesCache) {
    const v = await api<any>('GET', '/voices', undefined, 10000).catch(() => ({ voices: [] }));
    voicesCache = (v.voices ?? v ?? []).filter((x: any) => x?.id).map((x: any) => ({ id: String(x.id), name: String(x.name ?? '') }));
  }
  const voices = voicesCache ?? [];
  const fem = voices.filter((v) => /female|woman|girl|lady/i.test(v.name));
  const male = voices.filter((v) => /\bmale\b|\bman\b|guy|deep/i.test(v.name) && !/female|woman/i.test(v.name));
  const used = new Set<string>();
  const out: Record<string, string | undefined> = {};
  for (const e of ROSTER) {
    const pool = FEMALE.includes(e.id) ? fem : male;
    const choice = pool.find((v) => !used.has(v.id)) ?? voices.find((v) => !used.has(v.id)) ?? voices[0];
    if (choice) { used.add(choice.id); out[e.id] = choice.id; }
  }
  return out;
}

async function provisionOne(agentId: AgentId, voiceId?: string): Promise<MaskyAvatar> {
  const existing = avatars()[agentId];
  const e = employee(agentId);
  let rec: MaskyAvatar | undefined = existing?.avatarId ? existing : undefined;
  if (!rec) {
    const img = await api<any>('POST', '/images/generate', { prompt: portraitPrompt(agentId), aspectRatio: '1:1' }, 60000);
    const imageUrl = img.imageUrl ?? img.url ?? img.image?.url ?? img.images?.[0]?.url;
    if (!imageUrl) throw new Error('Masky image generation returned no imageUrl');
    const created = await api<any>('POST', '/avatars', {
      displayName: `${e.name} · Haven ${e.title}`, imageUrl,
      personalityPrompt: `You are ${e.name}, ${e.title} at Haven, an AI-native Trust & Safety company. ${e.personality} Responsibilities: ${e.responsibilities.join('; ')}.`,
      ...(voiceId ? { voiceId } : {}),
    }, 30000);
    const a = created.avatar ?? created;
    if (!a?.avatarId) throw new Error('Masky avatar creation returned no avatarId');
    rec = { avatarId: a.avatarId, avatarOwnerUserId: a.avatarOwnerUserId, imageUrl: a.imageUrl ?? imageUrl, voiceId, createdAt: now() };
    saveAvatar(agentId, rec);
  }
  if (!rec.conversationId) {
    const conv = await api<any>('POST', '/conversations', { avatarOwnerUserId: rec.avatarOwnerUserId, avatarId: rec.avatarId }, 20000);
    const c = conv.conversation?.conversationId ? conv.conversation : conv;
    rec = { ...rec, conversationId: c.conversationId ?? conv.conversationId, shareSlug: c.shareSlug ?? conv.shareSlug, liveUrl: c.liveUrl ?? conv.liveUrl };
    saveAvatar(agentId, rec);
  }
  return rec;
}

let provisioning: Promise<AvatarMap> | null = null;
/** Create (or reuse) a Masky portrait + avatar + live conversation for every AI employee. */
export async function provisionAvatars(): Promise<Record<string, { avatarId: string; imageUrl: string; liveUrl?: string }>> {
  if (!live()) return {};
  if (!provisioning) {
    provisioning = (async () => {
      stats.provisioning = true;
      try {
        // Priority order: Mira (wellbeing / crisis voice) first — free Masky plans allow a single avatar.
        const order: AgentId[] = ['mira', 'rex', 'aria', 'kai', 'nova', 'juno', 'iris', 'leo'];
        const missing = order.filter((id) => !avatars()[id]?.conversationId);
        const voices = missing.some((id) => !avatars()[id]?.avatarId) ? await pickVoices() : {};
        const failed: string[] = [];
        for (const aid of missing) {
          try { await provisionOne(aid, voices[aid]); }
          catch (err) {
            failed.push(aid); stats.errors++; stats.lastError = String((err as Error).message ?? err);
            if (/limit|quota|upgrade|plan|402|403/i.test(stats.lastError)) { failed.push(...missing.slice(missing.indexOf(aid) + 1)); break; }
          }
        }
        emit('toast', { level: failed.length ? 'warn' : 'success', title: 'Masky avatars', body: `${ROSTER.length - new Set(failed).size}/${ROSTER.length} employees have a Masky face + voice${failed.length ? ` (${stats.lastError})` : ''}`, agentId: 'aria' });
        return avatars();
      } finally { stats.provisioning = false; provisioning = null; }
    })();
  }
  const all = await provisioning;
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { avatarId: v.avatarId, imageUrl: v.imageUrl, liveUrl: v.liveUrl }]));
}

export function maskyAvatars(): Record<string, { imageUrl: string; liveUrl?: string }> {
  return Object.fromEntries(Object.entries(avatars()).filter(([, v]) => v?.imageUrl).map(([k, v]) => [k, { imageUrl: v.imageUrl, liveUrl: v.liveUrl }]));
}

/** First ≤3 sentences within 500 chars — Masky renders one clip per ≤3-sentence turn. */
function speakable(text: string) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  let out = '';
  for (const s of sentences.slice(0, 3)) { if ((out + s).length > 500) break; out += s; }
  return (out || text.slice(0, 500)).trim();
}

async function speakLive(agentId: AgentId, text: string): Promise<{ audioUrl?: string; liveUrl?: string } | null> {
  try {
    let rec = avatars()[agentId];
    if (!rec?.conversationId) rec = await provisionOne(agentId, (await pickVoices())[agentId]);
    const posted = await api<any>('POST', `/conversations/${rec.conversationId}/turn`, { userText: speakable(text), output: 'audio', mode: 'speak' }, 10000);
    stats.liveTurns++;
    const turn = posted.turn ?? posted;
    if (turn?.audioUrl) { stats.audioReady++; return { audioUrl: turn.audioUrl, liveUrl: rec.liveUrl }; }
    const deadline = now() + 12000;
    while (now() < deadline) {
      await sleep(1500);
      const conv = rec.shareSlug
        ? await api<any>('GET', `/conversations/by-slug/${rec.shareSlug}`, undefined, 6000).catch(() => null)
        : await api<any>('GET', `/conversations/${rec.conversationId}`, undefined, 6000).catch(() => null);
      const t = (conv?.turns ?? []).find((x: any) => x.id === turn?.id);
      if (t?.audioUrl) { stats.audioReady++; return { audioUrl: t.audioUrl, liveUrl: rec.liveUrl }; }
      if (t?.status === 'error') throw new Error(t.errorMessage ?? 'Masky turn failed');
    }
    return { liveUrl: rec.liveUrl };
  } catch (e) {
    stats.errors++; stats.lastError = (e as Error).message;
    console.warn('[masky] speak failed → browser TTS:', stats.lastError);
    return null;
  }
}

/** Maskord: mirror what an employee says into the community chat (Discord-compatible webhook) with its Masky face. */
async function postToMaskord(agentId: AgentId, text: string) {
  if (!config.masky.maskordWebhook) return;
  try {
    const e = employee(agentId);
    await fetch(config.masky.maskordWebhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ username: `${e.name} · Haven ${e.title}`, avatar_url: avatars()[agentId]?.imageUrl, content: text.slice(0, 1900) }),
    });
  } catch (err) { stats.lastError = `maskord: ${(err as Error).message}`; }
}

/** An AI employee speaks. Emits `voice.say`; with Masky live the event carries the rendered audio URL. Never blocks > 15s. */
export async function say(agentId: AgentId | string, text: string, opts: { incidentId?: string | null } = {}): Promise<void> {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  stats.spoken++;
  const incidentId = opts.incidentId ?? null;
  if (!ROSTER.some((e) => e.id === agentId)) { emit('voice.say', { agentId, text: clean, incidentId, engine: 'local' }); return; }
  void postToMaskord(agentId as AgentId, clean);
  if (!live()) { emit('voice.say', { agentId, text: clean, incidentId, engine: 'local' }); return; }
  const r = await Promise.race([speakLive(agentId as AgentId, clean), sleep(15000).then(() => null)]);
  emit('voice.say', { agentId, text: clean, audioUrl: r?.audioUrl, liveUrl: r?.liveUrl, incidentId, engine: r?.audioUrl ? 'masky' : 'local' });
}

export function maskyStatus() {
  const n = Object.values(avatars()).filter((a) => a?.avatarId).length;
  return {
    mode: live() ? ('live' as const) : ('local' as const),
    detail: live()
      ? `Masky.AI (${base()}) — ${n}/${ROSTER.length} employees provisioned${stats.provisioning ? ' (provisioning…)' : ''}`
      : 'Local faces (DiceBear) + browser speech synthesis (add MASKY_API_KEY for Masky faces & voices)',
    avatars: n, maskord: !!config.masky.maskordWebhook, ...stats,
  };
}
