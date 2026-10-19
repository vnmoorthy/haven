import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { emit } from '../events.js';
import { id, now } from '../util.js';
import { ROSTER } from '../agents/roster.js';
import type { BandMessage } from '../types.js';

// BAND is Haven's agent-to-agent nervous system. Every delegation, report, hand-off and broadcast between
// AI employees — whether the employee is an in-process LLM agent, an n8n workflow, a RocketRide pipeline or an
// AdaL browser agent — is a BAND message. Locally we run a BAND-compatible bus. With BAND_USER_KEY set, Haven
// registers every AI employee as an External agent on band.ai, opens a shared "Haven HQ" room, and mirrors each
// message into it as the sending agent (with an @mention of the recipient, as BAND requires), so the whole
// workforce is visible — and joinable by agents built with other tools — in BAND.

type Handler = (msg: BandMessage) => Promise<void> | void;
const handlers = new Map<string, Handler[]>();
const stats = { mirrored: 0, mirrorErrors: 0, lastError: '', roomId: '' as string, agents: 0 };
interface BandAgent { id: string; apiKey: string; name: string; handle?: string }

// band.ai credentials are shown only once at registration, so they live in a gitignored file that survives demo resets.
const CRED_DIR = join(ROOT, '.haven');
const CRED_FILE = join(CRED_DIR, 'band-cloud.json');
type Cloud = { roomId: string; agents: Record<string, BandAgent> };
function loadCloud(): Cloud | null { try { return existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, 'utf8')) : null; } catch { return null; } }
function saveCloud(c: Cloud) { mkdirSync(CRED_DIR, { recursive: true }); writeFileSync(CRED_FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); }

const H = (key: string) => ({ 'X-API-Key': key, 'Content-Type': 'application/json' });
async function bandFetch(path: string, key: string, init: RequestInit = {}) {
  const res = await fetch(`${config.band.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { ...H(key), ...(init.headers as any) }, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`BAND ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

/** Register the workforce on band.ai and open the shared room (idempotent; cached in kv). */
export async function bandBootstrap() {
  if (!config.band.apiKey) return;
  const cached = loadCloud();
  const agents: Record<string, BandAgent> = cached?.agents ?? {};
  for (const e of ROSTER) {
    if (agents[e.id]?.apiKey) continue;
    const r = await bandFetch('/me/agents/register', config.band.apiKey, { method: 'POST', body: JSON.stringify({ agent: { name: `Haven ${e.name}`, description: `${e.title} at Haven (AI Trust & Safety). ${e.responsibilities[0]}.` } }) });
    agents[e.id] = { id: r.data.agent.id, apiKey: r.data.credentials.api_key, name: r.data.agent.name, handle: r.data.agent.handle };
    saveCloud({ roomId: cached?.roomId ?? '', agents });
  }
  let roomId = cached?.roomId ?? '';
  if (!roomId) {
    const room = await bandFetch('/me/chats', config.band.apiKey, { method: 'POST', body: JSON.stringify({ chat: { title: config.band.workspace } }) });
    roomId = room.data.id;
    for (const a of Object.values(agents)) {
      await bandFetch(`/me/chats/${roomId}/participants`, config.band.apiKey, { method: 'POST', body: JSON.stringify({ participant: { participant_id: a.id, role: 'member' } }) }).catch(() => null);
    }
  }
  saveCloud({ roomId, agents });
  stats.roomId = roomId; stats.agents = Object.keys(agents).length;
  console.log(`[band] workforce registered on band.ai — room ${roomId} with ${stats.agents} agents`);
}

let queue: Promise<void> = Promise.resolve();
function mirror(msg: BandMessage) {
  if (!config.band.apiKey) return;
  queue = queue.then(async () => {
    const cloud = loadCloud();
    if (!cloud?.roomId) return;
    const from = cloud.agents[msg.from as string];
    const to = cloud.agents[msg.to as string];
    const content = `[${msg.kind}] ${msg.subject} — ${msg.body}`.slice(0, 1800);
    try {
      if (from && to) {
        await bandFetch(`/agent/chats/${cloud.roomId}/messages`, from.apiKey, { method: 'POST', body: JSON.stringify({ message: { content: `@${to.name} ${content}`, mentions: [{ id: to.id, name: to.name, handle: to.handle }] } }) });
      } else if (from) {
        await bandFetch(`/agent/chats/${cloud.roomId}/events`, from.apiKey, { method: 'POST', body: JSON.stringify({ event: { content, message_type: 'task', metadata: { havenId: msg.id, to: msg.to, incidentId: msg.incidentId } } }) });
      } else if (to) {
        await bandFetch(`/me/chats/${cloud.roomId}/messages`, config.band.apiKey, { method: 'POST', body: JSON.stringify({ message: { content: `@${to.name} (${msg.from}) ${content}`, mentions: [{ id: to.id, name: to.name, handle: to.handle, kind: 'mention' }] } }) });
      } else return;
      stats.mirrored++;
    } catch (e) { stats.mirrorErrors++; stats.lastError = (e as Error).message; }
  });
}

export const band = {
  /** Subscribe an employee (or system participant) to messages addressed to it. */
  on(participant: string, handler: Handler) {
    handlers.set(participant, [...(handlers.get(participant) ?? []), handler]);
  },
  /** Send a message over BAND. Delivery is async and ordered per call. */
  send(m: Omit<BandMessage, 'id' | 'createdAt' | 'remote' | 'threadId' | 'incidentId' | 'payload'> & Partial<Pick<BandMessage, 'threadId' | 'incidentId' | 'payload'>>): BandMessage {
    const msg: BandMessage = {
      id: id('band'), createdAt: now(), remote: config.band.apiKey ? 'band-cloud' : 'local',
      threadId: m.threadId ?? null, incidentId: m.incidentId ?? null, payload: m.payload ?? null,
      from: m.from, to: m.to, kind: m.kind, subject: m.subject, body: m.body,
    };
    db.insert('band_messages', msg);
    emit('band.message', msg);
    mirror(msg);
    const targets = msg.to === 'all' ? [...handlers.keys()].filter((k) => k !== msg.from) : [msg.to];
    for (const t of targets) for (const h of handlers.get(t) ?? []) {
      setTimeout(() => Promise.resolve(h(msg)).catch((e) => console.error(`[band] handler ${t} failed`, e)), 0);
    }
    return msg;
  },
  thread(incidentId: string) {
    return db.list<BandMessage>('band_messages', 'incident_id = ?', [incidentId], 'created_at ASC');
  },
  recent(limit = 80) {
    return db.list<BandMessage>('band_messages', '', [], 'created_at DESC', limit).reverse();
  },
  status() {
    return { mode: config.band.apiKey ? 'band-cloud' : 'local', participants: [...handlers.keys()], ...stats };
  },
};
