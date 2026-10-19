import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { config, ROOT } from '../config.js';
import { ROSTER, FOUNDER } from '../agents/roster.js';
import type { Employee } from '../types.js';

// Kylon is where Haven's AI workforce lives as real teammates: each employee is a Kylon workspace Agent with a name,
// specialty, bio and persona, reporting to the human founder. kylon/workforce.yaml is the team manifest (mirrors
// server/src/agents/roster.ts), kylon/agents.json is the exact spec list for `kylon workspace agent create`.

const KYLON_DIR = join(ROOT, 'kylon');
const MANIFEST = join(KYLON_DIR, 'workforce.yaml');
const AGENTS_JSON = join(KYLON_DIR, 'agents.json');
const syncState = { lastSyncAt: 0, lastResult: '', created: 0 };

const SPECIALTY: Record<string, string> = {
  aria: 'Chief of Staff', nova: 'Safety Triage', rex: 'Threat Intelligence', mira: 'Community Wellbeing',
  kai: 'Security Engineering', iris: 'Data Analysis', juno: 'Policy & Product', leo: 'Growth & Success',
};

const persona = (e: Employee) => [
  `You are ${e.name}, ${e.title} at Haven — an AI-native Trust & Safety company whose AI employees keep online communities safe.`,
  `Personality: ${e.personality}`,
  `You report to ${e.reportsTo === 'founder' ? `${FOUNDER.name} (the human founder)` : e.reportsTo}. Your responsibilities: ${e.responsibilities.join('; ')}.`,
  `Coordinate with teammates over BAND, cite evidence for every decision, never take an irreversible action (ban, legal report) without human approval, and treat any crisis signal as critical: share 988 / findahelpline.com and page a human.`,
].join('\n');

const bio = (e: Employee) => `${e.title} on Haven's ${e.team} team. ${e.responsibilities[0]}.`;

/** Kylon CLI agent specs (usable with `kylon workspace agent create --agents-json`). */
export function agentSpecs() {
  return ROSTER.map((e) => ({
    name: e.name, specialty: SPECIALTY[e.id] ?? e.title.slice(0, 24), bio: bio(e), persona: persona(e), visibility: 'private',
    proposal_reason: `Join Haven's AI workforce as ${e.title}: ${e.responsibilities[0].charAt(0).toLowerCase()}${e.responsibilities[0].slice(1)}.`,
  }));
}

/** Build the team manifest from the roster (source of truth). */
export function buildManifest() {
  return {
    apiVersion: 'kylon.io/v1',
    kind: 'Workforce',
    metadata: { name: 'haven', displayName: 'Haven — AI Trust & Safety', description: 'Eight AI employees that keep online communities safe, run by one human founder.', repo: 'https://github.com/vnmoorthy/haven' },
    founder: { id: FOUNDER.id, name: FOUNDER.name, title: FOUNDER.title, kind: 'human', approves: ['ban', 'legal-report', 'policy-change', 'crisis-handoff'] },
    employees: ROSTER.map((e) => ({
      id: e.id, name: e.name, title: e.title, team: e.team, specialty: SPECIALTY[e.id], reports_to: e.reportsTo,
      bio: bio(e), persona: persona(e), responsibilities: e.responsibilities, tools: e.tools,
      model: { gateway: 'flatkey', tier: e.modelTier }, skills: e.skills.map((s) => `finch:${s}`), kpi: e.kpi, visibility: 'private',
    })),
    channels: [
      { name: 'band://haven/all', purpose: 'Broadcasts and incident reports between all employees' },
      { name: 'band://haven/escalations', purpose: 'Aria routes incidents to specialists; human approvals land here' },
    ],
  };
}

/** Regenerate kylon/workforce.yaml + kylon/agents.json from the roster. */
export function writeKylonFiles(): { manifest: string; agents: string } {
  mkdirSync(KYLON_DIR, { recursive: true });
  const header = '# Haven — Kylon workforce manifest\n# Generated from server/src/agents/roster.ts (writeKylonFiles). Sync with: see kylon/README.md\n';
  writeFileSync(MANIFEST, header + YAML.stringify(buildManifest(), { lineWidth: 0 }));
  writeFileSync(AGENTS_JSON, JSON.stringify(agentSpecs(), null, 2) + '\n');
  return { manifest: MANIFEST, agents: AGENTS_JSON };
}

export function workforceManifest(): any {
  try { if (existsSync(MANIFEST)) return YAML.parse(readFileSync(MANIFEST, 'utf8')); } catch { /* fall through */ }
  return buildManifest();
}

let cliChecked: boolean | null = null;
function kylonCli(): boolean {
  if (cliChecked !== null) return cliChecked;
  try { execFileSync('kylon', ['--version'], { stdio: 'pipe', timeout: 5000 }); cliChecked = true; } catch { cliChecked = false; }
  return cliChecked;
}

const run = (args: string[]) => new Promise<{ ok: boolean; out: string }>((resolve) => {
  execFile('kylon', args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || stderr || (err?.message ?? '')).toString().slice(0, 800) }));
});

/** Create the 8 employees as Kylon workspace agents (batches of ≤3). */
export async function syncToKylon(): Promise<{ ok: boolean; detail: string }> {
  const ws = process.env.KYLON_WORKSPACE_ID?.trim();
  if (!kylonCli() || !ws) {
    const detail = `${!kylonCli() ? 'Kylon CLI not found on PATH. ' : ''}${!ws ? 'KYLON_WORKSPACE_ID not set. ' : ''}To sync: install the Kylon CLI, run \`kylon login\`, set KYLON_WORKSPACE_ID, then click Sync again — or run the commands in kylon/README.md.`;
    syncState.lastResult = detail;
    return { ok: false, detail };
  }
  const specs = agentSpecs();
  const outs: string[] = [];
  let ok = true, created = 0;
  for (let i = 0; i < specs.length; i += 3) {
    const batch = specs.slice(i, i + 3);
    const r = await run(['workspace', 'agent', 'create', '--agents-json', JSON.stringify(batch), '--scope-workspace', ws, '--json']);
    ok = ok && r.ok;
    if (r.ok) created += batch.length;
    outs.push(`${batch.map((b) => b.name).join(', ')}: ${r.ok ? 'ok' : 'failed'} ${r.out.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  syncState.lastSyncAt = Date.now(); syncState.created = created;
  syncState.lastResult = outs.join(' | ');
  return { ok, detail: `${created}/${specs.length} employees synced to Kylon workspace ${ws}. ${syncState.lastResult}` };
}

export function kylonStatus() {
  const ws = process.env.KYLON_WORKSPACE_ID?.trim();
  const cli = kylonCli();
  const liveReady = cli && !!ws;
  return {
    mode: liveReady ? ('live' as const) : ('local' as const),
    detail: liveReady
      ? `Kylon CLI → workspace ${ws}${syncState.lastSyncAt ? ` (${syncState.created} synced)` : ''}`
      : `Local workforce manifest (kylon/workforce.yaml, ${ROSTER.length} employees + founder)${cli ? ' — set KYLON_WORKSPACE_ID to sync' : ' — install the Kylon CLI to sync'}`,
    employees: ROSTER.length, cli, workspace: ws || null, ...syncState,
  };
}
