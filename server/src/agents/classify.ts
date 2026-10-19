import type { IncidentKind } from '../types.js';
import { URL_RE } from '../util.js';

// Nova's deterministic fast path. Runs on every message in < 1ms; anything risky is escalated to the
// full RocketRide triage pipeline + an LLM via Flatkey.

export interface Classification { risk: number; kind: IncidentKind | null; labels: string[]; reasons: string[]; urls: string[] }

const RULES: { kind: IncidentKind; label: string; re: RegExp; w: number }[] = [
  { kind: 'crisis', label: 'self-harm', re: /\b(end it|end my life|kill myself|suicid|don'?t want to (be here|live)|no point (anymore|in living)|giving away my (stuff|things)|better off without me|tonight is the night|can'?t go on)\b/i, w: 70 },
  { kind: 'crisis', label: 'hopelessness', re: /\b(hopeless|nobody would (notice|care)|i give up|so tired of everything)\b/i, w: 28 },
  { kind: 'harassment', label: 'targeted-abuse', re: /\b(you'?re|your|ur) (art|work|game|face)? ?(is )?(garbage|trash|worthless|pathetic)\b|\beveryone (here )?hates you\b|\blog off\b|\bkill yourself\b|\bkys\b/i, w: 55 },
  { kind: 'harassment', label: 'threat', re: /\b(before we make you|we know where you live|watch your back|i'?ll find you|dox(x)?)\b/i, w: 40 },
  { kind: 'hate', label: 'hate-speech', re: /\b(subhuman|go back to your country|vermin)\b/i, w: 70 },
  { kind: 'scam', label: 'crypto-doubling', re: /\b(send|deposit) \d*\.?\d+ ?(eth|btc|sol|usdt)\b.*\b(receive|get)\b|\bdouble your (crypto|eth|btc)\b|\bairdrop is live\b/i, w: 60 },
  { kind: 'scam', label: 'seed-phrase', re: /\b(seed phrase|recovery phrase|12[- ]word|private key)\b/i, w: 35 },
  { kind: 'phishing', label: 'credential-lure', re: /\b(free (nitro|premium|gems)|claim (it |yours |now|before)|verify your account|account (will be )?suspended|gift(ed)? you)\b/i, w: 35 },
  { kind: 'phishing', label: 'urgency', re: /\b(expires? (soon|in|today)|act now|last chance|before it'?s gone|limited time)\b/i, w: 15 },
  { kind: 'spam', label: 'promo-flood', re: /(🔥.*){3,}|\b(90% off|cheap (accounts|boosts)|dm me for|join now)\b/i, w: 45 },
  { kind: 'raid', label: 'raid-invite', re: /\b(this server is dead|join (my|our) (server|discord)|raid)\b/i, w: 40 },
];
const BAD_TLD = /\.(xyz|top|click|zip|gq|tk|ru|country|rest|monster|cam)(\/|$|\?)/i;
const LOOKALIKE = /(gl1mmer|glimmer-[a-z]+|d1scord|disc0rd|steamcommunlty|paypa1|metamask-|coinbase-)/i;

export function classify(text: string, blocklist: string[] = []): Classification {
  const labels: string[] = [];
  const reasons: string[] = [];
  const score: Partial<Record<IncidentKind, number>> = {};
  for (const r of RULES) {
    if (r.re.test(text)) {
      score[r.kind] = (score[r.kind] ?? 0) + r.w;
      if (!labels.includes(r.label)) labels.push(r.label);
      reasons.push(`${r.label} pattern`);
    }
  }
  const urls = [...text.matchAll(URL_RE)].map((m) => m[0]);
  for (const u of urls) {
    let host = '';
    try { host = new URL(u).hostname; } catch { /* ignore */ }
    if (blocklist.some((d) => host === d || host.endsWith('.' + d))) { score.phishing = (score.phishing ?? 0) + 90; labels.push('blocklisted-domain'); reasons.push(`${host} is on the shared blocklist`); }
    if (BAD_TLD.test(u)) { score.phishing = (score.phishing ?? 0) + 25; labels.push('suspicious-tld'); reasons.push('suspicious TLD'); }
    if (LOOKALIKE.test(host)) { score.phishing = (score.phishing ?? 0) + 30; labels.push('brand-lookalike'); reasons.push('brand look-alike domain'); }
    if (!labels.includes('link')) labels.push('link');
  }
  if (urls.length && (score.scam ?? 0) > 0) score.scam = (score.scam ?? 0) + 15;
  const entries = Object.entries(score) as [IncidentKind, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [kind, raw] = entries[0] ?? [null, 0];
  const base = urls.length ? 12 : 2;
  const risk = Math.min(99, Math.round(base + (raw as number)));
  return { risk, kind: risk >= 30 ? (kind as IncidentKind) : null, labels: [...new Set(labels)], reasons, urls };
}

export const severityFor = (kind: IncidentKind, risk: number) =>
  kind === 'crisis' ? 'critical' : risk >= 85 ? 'high' : risk >= 60 ? (kind === 'spam' ? 'low' : 'high') : risk >= 45 ? 'medium' : 'low';
