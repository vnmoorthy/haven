import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { emit } from '../events.js';
import { ROSTER } from '../agents/roster.js';
import type { AgentId } from '../types.js';

// Finch gives Haven's AI employees reusable, versioned skills. Each skill is a SKILL.md (YAML frontmatter +
// "When to use" / "Instructions" / "Output format") in skills/<id>/. Skills are enabled per employee (defaults from
// the roster, overrides persisted in kv) and their instructions are injected into that employee's prompts.
// When FINCH_API_KEY + FINCH_BASE_URL are set we also publish the skills to Finch so other agents can reuse them.

export interface SkillInfo {
  id: string; name: string; description: string; owner: AgentId; path: string; enabledFor: AgentId[]; tags: string[]; version: string;
}
interface ParsedSkill extends Omit<SkillInfo, 'enabledFor'> { instructions: string; whenToUse: string; outputFormat: string; raw: string }

const SKILLS_DIR = join(ROOT, 'skills');
const OVERRIDES_KEY = 'skill-overrides';
const AGENT_IDS = ROSTER.map((e) => e.id);
const publishState = { published: 0, errors: 0, lastError: '', lastPublishedAt: 0 };
let cache: ParsedSkill[] | null = null;

function section(body: string, title: string): string {
  const re = new RegExp(`^##\\s+${title}\\s*$`, 'im');
  const m = body.match(re);
  if (!m || m.index === undefined) return '';
  const after = body.slice(m.index + m[0].length);
  const next = after.search(/^##\s+/m);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function parseSkill(dir: string): ParsedSkill | null {
  const file = join(SKILLS_DIR, dir, 'SKILL.md');
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  let meta: any = {};
  try { meta = fm ? YAML.parse(fm[1]) ?? {} : {}; } catch { meta = {}; }
  const body = fm ? fm[2] : raw;
  const owner = (AGENT_IDS.includes(meta.owner) ? meta.owner : 'aria') as AgentId;
  return {
    id: dir, name: String(meta.name ?? dir), description: String(meta.description ?? ''), owner,
    path: relative(ROOT, file), tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], version: String(meta.version ?? '1.0.0'),
    instructions: section(body, 'Instructions'), whenToUse: section(body, 'When to use'), outputFormat: section(body, 'Output format'), raw,
  };
}

function load(force = false): ParsedSkill[] {
  if (cache && !force) return cache;
  let dirs: string[] = [];
  try { dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { dirs = []; }
  cache = dirs.map(parseSkill).filter((s): s is ParsedSkill => !!s);
  return cache;
}

/** Re-read skills/ from disk (e.g. after adding a SKILL.md). */
export function reloadSkills(): number { return load(true).length; }

type Overrides = Record<string, Record<string, boolean>>; // agentId -> skillId -> enabled
const overrides = (): Overrides => db.kvGet<Overrides>(OVERRIDES_KEY, {});

function enabledFor(skillId: string, ov = overrides()): AgentId[] {
  return ROSTER.filter((e) => {
    const o = ov[e.id]?.[skillId];
    return o === undefined ? e.skills.includes(skillId) : o;
  }).map((e) => e.id);
}

export function listSkills(): SkillInfo[] {
  const ov = overrides();
  return load().map((s) => ({ id: s.id, name: s.name, description: s.description, owner: s.owner, path: s.path, enabledFor: enabledFor(s.id, ov), tags: s.tags, version: s.version }));
}

export function getSkill(skillId: string) { return load().find((s) => s.id === skillId) ?? null; }

export function toggleSkill(agentId: AgentId | string, skillId: string, enabled: boolean): void {
  if (!AGENT_IDS.includes(agentId as AgentId)) throw new Error(`Unknown employee ${agentId}`);
  if (!getSkill(skillId)) throw new Error(`Unknown skill ${skillId}`);
  const ov = overrides();
  ov[agentId] = { ...(ov[agentId] ?? {}), [skillId]: !!enabled };
  db.kvSet(OVERRIDES_KEY, ov);
  emit('skill.toggled', { agentId, skillId, enabled: !!enabled });
}

/** The enabled skills' instructions for one employee, ready to drop into a system prompt (~2500 chars max). */
export function skillPrompt(agentId: AgentId | string, maxChars = 2500): string {
  const ov = overrides();
  const skills = load().filter((s) => enabledFor(s.id, ov).includes(agentId as AgentId));
  if (!skills.length) return '';
  let out = '';
  for (const s of skills) {
    const block = `### Skill: ${s.name} (finch:${s.id}@${s.version})\n${s.instructions}\n\n`;
    if (out.length + block.length > maxChars) {
      const room = maxChars - out.length;
      if (room > 200) out += block.slice(0, room - 1) + '…';
      break;
    }
    out += block;
  }
  return out.trim();
}

export function finchStatus(): { mode: 'finch' | 'local'; detail: string; skills: number; published?: number; errors?: number; lastError?: string } {
  const n = load().length;
  const live = !!(config.finch.apiKey && config.finch.baseUrl);
  return live
    ? { mode: 'finch', detail: `Publishing ${n} skills to Finch (${config.finch.baseUrl}) — ${publishState.published} published${publishState.errors ? `, ${publishState.errors} errors` : ''}`, skills: n, ...publishState }
    : { mode: 'local', detail: `Local skill registry: ${n} Finch-format SKILL.md skills from skills/ (add FINCH_API_KEY + FINCH_BASE_URL to publish)`, skills: n };
}

/** Best-effort publish of every skill to Finch. Never throws. */
export async function publishSkills(): Promise<{ ok: boolean; published: number; errors: number; detail: string }> {
  if (!config.finch.apiKey || !config.finch.baseUrl) return { ok: false, published: 0, errors: 0, detail: 'Finch not configured — skills served locally' };
  let published = 0, errors = 0;
  for (const s of load()) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${config.finch.baseUrl.replace(/\/$/, '')}/skills`, {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${config.finch.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, name: s.name, description: s.description, owner: s.owner, version: s.version, tags: s.tags, content: s.raw, enabledFor: enabledFor(s.id) }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      published++;
    } catch (e) {
      errors++; publishState.lastError = `${s.id}: ${(e as Error).message}`;
    } finally { clearTimeout(t); }
  }
  publishState.published = published; publishState.errors = errors; publishState.lastPublishedAt = Date.now();
  return { ok: errors === 0, published, errors, detail: `${published} published, ${errors} failed${publishState.lastError ? ` (last: ${publishState.lastError})` : ''}` };
}
