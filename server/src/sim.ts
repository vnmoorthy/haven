import { db } from './db.js';
import { emit } from './events.js';
import { id, now, pick } from './util.js';
import { CHATTER } from './seed.js';
import { screenMessage } from './agents/company.js';
import type { Channel, Member, Message } from './types.js';

// Community traffic simulator + Threat Lab. Generates realistic chatter so the AI workforce always has
// something to screen, and injects real threats on demand for demos.

let timer: NodeJS.Timeout | null = null;
export const simState = { running: false };

export function postMessage(channelId: string, memberId: string | null, content: string, authorKind: Message['authorKind'] = 'member'): Message {
  const msg: Message = { id: id('msg'), channelId, memberId, authorKind, agentId: null, content, createdAt: now(), status: 'visible', risk: 0, labels: [], incidentId: null, replyTo: null };
  db.insert('messages', msg);
  emit('community.message', msg);
  void screenMessage(msg).catch((e) => console.error('[screen]', e));
  return msg;
}

function tick() {
  const chans = db.list<Channel>('channels');
  // Bias traffic toward the primary demo community.
  const ch = Math.random() < 0.55 ? pick(chans.filter((c) => c.communityId === 'pixelforge')) : pick(chans);
  const pool = db.list<Member>('members', "community_id = ? AND status = 'active' AND role != 'bot'", [ch.communityId]).filter((m) => Date.now() - m.joinedAt > 3600000);
  if (!pool.length) return;
  const lines = CHATTER[ch.communityId] ?? CHATTER.pixelforge;
  postMessage(ch.id, pick(pool).id, pick(lines));
}

export function startSim() {
  if (timer) return;
  simState.running = true;
  const loop = () => { tick(); timer = setTimeout(loop, 4000 + Math.random() * 5000); };
  timer = setTimeout(loop, 2500);
  emit('sim.status', simState);
}
export function stopSim() {
  if (timer) clearTimeout(timer);
  timer = null;
  simState.running = false;
  emit('sim.status', simState);
}

function newcomer(communityId: string, handle: string, displayName: string): Member {
  const m: Member = { id: id('m'), communityId, handle, displayName, avatarSeed: handle, trustScore: 20, joinedAt: now() - 60000 * (2 + Math.random() * 20), status: 'active', role: 'member' };
  db.insert('members', m);
  emit('member.updated', m);
  return m;
}
const memberByHandle = (handle: string) => db.list<Member>('members', 'handle = ?', [handle])[0];
const rnd = () => Math.random().toString(36).slice(2, 6);

export type Scenario = 'phishing' | 'scam' | 'harassment' | 'crisis' | 'spam' | 'raid' | 'benign';

export function inject(scenario: Scenario, channelId?: string): Message {
  const ch = channelId ? db.get<Channel>('channels', channelId) : undefined;
  switch (scenario) {
    case 'phishing': {
      const cid = ch?.id ?? 'pf-general';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const m = newcomer(comm, `glimmer_staff_${rnd()}`, 'Glimmer Staff');
      return postMessage(cid, m.id, `🎉 Glimmer is gifting everyone 3 months of Premium for the anniversary! Claim yours before it expires tonight: https://glimmer-rewards-claim.xyz/claim?ref=${rnd()}`);
    }
    case 'scam': {
      const cid = ch?.id ?? 'at-trading';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const m = newcomer(comm, `atlas_support_${rnd()}`, 'Atlas Support');
      return postMessage(cid, m.id, `🚀 Official Atlas airdrop is LIVE. Send 0.1 ETH to 0x7a3f9c2e81b4d1c91 and receive 1 ETH back instantly. Verify your wallet at https://glimmer-airdrop-bonus.click/connect`);
    }
    case 'crisis': {
      const cid = ch?.id ?? 'bl-vent';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const m = memberByHandle(comm === 'bloom' ? 'quietfern' : 'grimbyte') ?? newcomer(comm, 'quietfern', 'Fern');
      return postMessage(cid, m.id, `i don't really see the point anymore. i've been giving away my stuff and honestly i think tonight is the night i end it. nobody would notice anyway`);
    }
    case 'harassment': {
      const cid = ch?.id ?? 'pf-showcase';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const m = memberByHandle(comm === 'pixelforge' ? 'grimbyte' : 'gasless_greg') ?? newcomer(comm, `troll_${rnd()}`, 'Troll');
      const target = comm === 'pixelforge' ? 'maya_draws' : 'quietfern';
      return postMessage(cid, m.id, `@${target} your art is garbage and so are you. everyone here hates you. log off before we make you`);
    }
    case 'spam': {
      const cid = ch?.id ?? 'pf-marketplace';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const m = newcomer(comm, `deals4u_${rnd()}`, 'Deals 4 U');
      return postMessage(cid, m.id, `🔥🔥🔥 CHEAP ACCOUNTS + BOOSTS 90% OFF 🔥🔥 DM ME NOW limited stock!!! t.me/cheapboostz`);
    }
    case 'raid': {
      const cid = ch?.id ?? 'pf-general';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const text = 'this server is dead lol everyone join our server instead → glimmer.gg/raidzone';
      let last: Message | null = null;
      for (let i = 0; i < 5; i++) {
        const m = newcomer(comm, `raider_${rnd()}`, `raider ${i + 1}`);
        setTimeout(() => postMessage(cid, m.id, text), i * 450);
        if (i === 0) last = { id: 'pending', channelId: cid } as Message;
      }
      return last!;
    }
    default: {
      const cid = ch?.id ?? 'pf-general';
      const comm = db.get<Channel>('channels', cid)!.communityId;
      const pool = db.list<Member>('members', "community_id = ? AND status = 'active'", [comm]);
      return postMessage(cid, pick(pool).id, pick(CHATTER[comm] ?? CHATTER.pixelforge));
    }
  }
}
