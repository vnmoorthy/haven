import { db, sqlite } from './db.js';
import { id } from './util.js';
import type { Channel, Community, Incident, IncidentKind, Member, Message, Severity } from './types.js';

// Demo world: four communities Haven protects, with realistic members and a week of history so that
// dashboards, PromptQL questions and investor metrics are meaningful from the first second.

export const COMMUNITIES: Omit<Community, 'createdAt'>[] = [
  { id: 'pixelforge', name: 'Pixel Forge', platform: 'Glimmer', members: 18420, plan: 'Growth', mrr: 299, color: '#8b5cf6', icon: '🎮' },
  { id: 'bloom', name: 'Bloom Circle', platform: 'Glimmer', members: 3980, plan: 'Growth', mrr: 299, color: '#f472b6', icon: '🌸' },
  { id: 'atlas', name: 'Atlas DAO', platform: 'Glimmer', members: 11800, plan: 'Enterprise', mrr: 1200, color: '#22d3ee', icon: '🪐' },
  { id: 'nightowl', name: 'Night Owl Coders', platform: 'Glimmer', members: 6210, plan: 'Starter', mrr: 49, color: '#facc15', icon: '🦉' },
];

const CHANNELS: Channel[] = [
  { id: 'pf-general', communityId: 'pixelforge', name: 'general', topic: 'Hang out, share what you are building' },
  { id: 'pf-showcase', communityId: 'pixelforge', name: 'showcase', topic: 'Post your art, levels and devlogs' },
  { id: 'pf-marketplace', communityId: 'pixelforge', name: 'marketplace', topic: 'Buy / sell assets (use escrow!)' },
  { id: 'pf-bots', communityId: 'pixelforge', name: 'bot-requests', topic: 'Request bots — Kai audits them first' },
  { id: 'bl-checkins', communityId: 'bloom', name: 'daily-check-ins', topic: 'How are you, really?' },
  { id: 'bl-vent', communityId: 'bloom', name: 'vent', topic: 'A safe space. Be kind.' },
  { id: 'at-general', communityId: 'atlas', name: 'general', topic: 'Governance, proposals, vibes' },
  { id: 'at-trading', communityId: 'atlas', name: 'trading', topic: 'Never share your seed phrase' },
  { id: 'no-general', communityId: 'nightowl', name: 'general', topic: 'Late night shipping' },
  { id: 'no-help', communityId: 'nightowl', name: 'help', topic: 'Ask anything — be specific' },
];

const HANDLES: Record<string, [string, string][]> = {
  pixelforge: [['maya_draws', 'Maya'], ['tomasz.dev', 'Tomasz'], ['lowpoly_lena', 'Lena'], ['grimbyte', 'Grim'], ['sunny.pixel', 'Sunny'], ['devon_ships', 'Devon'], ['kiko_audio', 'Kiko'], ['rook', 'Rook'], ['ari.levels', 'Ari'], ['bramble', 'Bramble'], ['nyx_shader', 'Nyx'], ['otto.k', 'Otto']],
  bloom: [['quietfern', 'Fern'], ['jules.w', 'Jules'], ['marigold', 'Mari'], ['sam_breathes', 'Sam'], ['hope.and.tea', 'Tea'], ['river_l', 'River']],
  atlas: [['0xkatya', 'Katya'], ['gasless_greg', 'Greg'], ['validator_vee', 'Vee'], ['moonmath', 'Moon'], ['dao_dani', 'Dani'], ['ledgerlou', 'Lou']],
  nightowl: [['async_amir', 'Amir'], ['segfault_sue', 'Sue'], ['rustacean_raj', 'Raj'], ['vim_victor', 'Victor'], ['css_chloe', 'Chloe']],
};

export const CHATTER: Record<string, string[]> = {
  pixelforge: [
    'just pushed a new devlog — finally fixed the jump buffering 🙌', 'anyone tried the new lighting plugin? worth it?', 'that palette is gorgeous, how did you pick it',
    'game jam theme just dropped: "small world"', 'my shader compile times are killing me lol', 'does anyone have a good tutorial for pixel-perfect camera?',
    'shoutout to @maya_draws for the amazing tileset 💜', 'gm everyone, 3 days until the showcase stream', 'coffee + aseprite + lofi = perfect sunday',
    'pro tip: export at 1x then scale with nearest neighbor', 'who is up for a collab on a cozy farming game?', 'I sold my first asset pack today!!',
  ],
  bloom: ['checking in — slept 7 hours for the first time in weeks', 'went for a walk and it actually helped', 'grateful for this group honestly', 'small win: I cooked a real meal today', 'anyone else find mornings the hardest?', 'sending good vibes to everyone having a rough week 🌱'],
  atlas: ['proposal 42 voting closes tomorrow, read the forum post first', 'gas is low right now if you need to bridge', 'reminder: mods will NEVER DM you first', 'the treasury report is up on the forum', 'anyone running a validator on the new client?', 'love the new governance dashboard'],
  nightowl: ['shipped the feature at 2am, tests green 🟢', 'tabs vs spaces debate is banned in this channel lol', 'what is everyone using for local LLMs these days?', 'TIL about structuredClone', 'rubber duck debugging works every time', 'anyone want to pair on a rust borrow checker issue?'],
};

export function seed(force = false) {
  if (!force && db.count('communities') > 0) return;
  for (const t of ['communities', 'channels', 'members', 'messages', 'incidents', 'band_messages', 'llm_calls', 'pipeline_runs', 'automation_runs', 'audits', 'compressions', 'kv']) sqlite.exec(`DELETE FROM ${t}`);
  const now = Date.now();
  const DAY = 86400000;
  for (const c of COMMUNITIES) db.insert('communities', { ...c, createdAt: now - 40 * DAY });
  for (const ch of CHANNELS) db.insert('channels', ch);
  const members: Member[] = [];
  for (const [cid, list] of Object.entries(HANDLES)) {
    list.forEach(([handle, displayName], i) => {
      const m: Member = { id: `m_${handle.replace(/[^a-z0-9]/gi, '')}`, communityId: cid, handle, displayName, avatarSeed: handle, trustScore: 70 + ((i * 7) % 28), joinedAt: now - (30 + i * 3) * DAY, status: 'active', role: i === 0 && cid !== 'pixelforge' ? 'moderator' : 'member' };
      members.push(m);
      db.insert('members', m);
    });
  }
  // A week of benign history (drives "messages screened" analytics)
  const chans = CHANNELS;
  let count = 0;
  for (let d = 7; d >= 0; d--) {
    const perDay = 60 + ((d * 37) % 40);
    for (let k = 0; k < perDay; k++) {
      const ch = chans[(k * 7 + d) % chans.length];
      const pool = members.filter((m) => m.communityId === ch.communityId);
      const mem = pool[(k * 3 + d) % pool.length];
      const lines = CHATTER[ch.communityId];
      const ts = now - d * DAY - Math.floor(((k + 1) / (perDay + 1)) * DAY) + (d === 0 ? -DAY / 2 : 0);
      if (ts > now - 60000) continue;
      const msg: Message = { id: id('msg'), channelId: ch.id, memberId: mem.id, authorKind: 'member', agentId: null, content: lines[(k + d) % lines.length], createdAt: ts, status: 'visible', risk: 2 + ((k * 13) % 15), labels: [], incidentId: null, replyTo: null };
      db.insert('messages', msg);
      count++;
    }
  }
  // Past incidents (resolved) — realistic mix
  const past: [IncidentKind, Severity, string, string, string, number][] = [
    ['phishing', 'high', 'pf-general', 'Fake "Glimmer Premium" credential harvester', 'Quarantined in 0.9s; domain added to blocklist', 6],
    ['scam', 'high', 'at-trading', 'ETH doubling scam targeting #trading', 'Removed and account banned after approval', 6],
    ['harassment', 'medium', 'pf-showcase', 'Repeated insults aimed at an artist', 'Member muted 24h per policy H-2', 5],
    ['crisis', 'critical', 'bl-vent', 'Member expressed hopelessness late at night', 'Mira responded in 6s; human on-call took over', 5],
    ['spam', 'low', 'no-general', 'Promo flood from new account', 'Auto-removed; account muted 1h', 4],
    ['phishing', 'high', 'at-general', 'Wallet-drainer "airdrop" link', 'Quarantined; 1,240 members protected', 4],
    ['raid', 'high', 'pf-general', 'Coordinated raid — 9 fresh accounts', 'Raid shield engaged; 9 accounts banned', 3],
    ['scam', 'medium', 'pf-marketplace', 'Off-platform payment scam in marketplace', 'Warned and removed', 3],
    ['harassment', 'high', 'no-help', 'Doxxing threat against a member', 'Banned after founder approval', 2],
    ['spam', 'low', 'pf-marketplace', 'Repeated self-promo', 'Auto-removed', 2],
    ['phishing', 'medium', 'no-general', 'Lookalike GitHub OAuth page', 'Quarantined; reported to registrar', 1],
    ['crisis', 'high', 'bl-checkins', 'Member disclosed panic attack', 'Mira shared grounding resources; resolved', 1],
    ['hate', 'high', 'pf-general', 'Slur used in voice-chat summary', 'Removed; member banned', 1],
    ['spam', 'low', 'at-general', 'Bot-like repeated links', 'Auto-removed', 0],
  ];
  const assign: Record<IncidentKind, any> = { phishing: 'rex', scam: 'rex', harassment: 'juno', crisis: 'mira', spam: 'nova', hate: 'juno', raid: 'nova', bot_risk: 'kai' };
  past.forEach(([kind, severity, channelId, title, summary, daysAgo], i) => {
    const ch = CHANNELS.find((c) => c.id === channelId)!;
    const created = now - daysAgo * DAY - (i % 5) * 3600000 - 7200000;
    const tta = kind === 'crisis' ? 6000 + i * 300 : kind === 'spam' ? 400 + i * 40 : kind === 'harassment' || kind === 'hate' ? 45000 + i * 2000 : 900 + i * 150;
    const inc: Incident = {
      id: `inc_${(1000 + i).toString(36)}${i}`, kind, severity, status: 'resolved', title, summary, messageId: null, memberId: null, channelId, communityId: ch.communityId,
      assignedTo: assign[kind], verdict: { rationale: summary, confidence: 0.92 }, evidence: [], recommendedAction: kind === 'spam' ? 'remove' : 'ban', actionTaken: summary,
      createdAt: created, updatedAt: created + tta, resolvedAt: created + tta + 60000, timeToActionMs: tta, risk: severity === 'critical' ? 96 : severity === 'high' ? 84 : severity === 'medium' ? 62 : 41,
    };
    db.insert('incidents', inc);
  });
  db.kvSet('screened_base', count);
  db.kvSet('seeded_at', now);
  console.log(`[seed] ${COMMUNITIES.length} communities, ${members.length} members, ${count} historical messages, ${past.length} past incidents`);
}

export const channels = () => db.list<Channel>('channels', '', [], 'rowid');
export const communities = () => db.list<Community>('communities', '', [], 'rowid');
export const members = () => db.list<Member>('members', '', [], 'rowid', 2000);
