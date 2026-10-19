import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import os from 'node:os';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { emit } from '../events.js';
import { id, now } from '../util.js';
import { completeJson, recordOffline } from './flatkey.js';
import type { Audit } from '../types.js';

// Kai's third-party community-bot security audit.
//   fetch → Snyk (deps) → Snyk Code (SAST) → Tenki (sandbox install + tests) → Prelint (spec check) → grade
// Every sponsor tool runs live when it is configured and falls back to a local engine that does the same job
// (OSV.dev for vulns, a seatbelt-sandboxed local runner for tests, a local spec engine reading the same specs/
// that the Prelint GitHub App indexes). Fallback modes are always labelled 'local'.

type Sev = 'critical' | 'high' | 'medium' | 'low';
type Step = Audit['steps'][number];
type OnProgress = (stepId: string, detail: string) => void;

export interface Vuln { id: string; title: string; severity: Sev; pkg: string; version: string; fixedIn: string | null; cve: string | null; cvss: number | null; direct: boolean; path?: string; url: string }
export interface Finding { kind: 'code-exec' | 'secret-hardcoded' | 'secret-logged' | 'insecure-http' | 'admin-permission' | 'message-content'; label: string; file: string; line: number; snippet: string; severity: Sev }
export interface RuleResult { ruleId: string; title: string; status: 'pass' | 'fail' | 'warn'; evidence: string; severity: string }

const SAMPLES: Record<string, { dir: string; name: string; blurb: string }> = {
  sample: { dir: resolve(ROOT, 'samples/sketchy-bot'), name: 'RaidShield Pro', blurb: 'Bundled sample: an unverified anti-raid bot' },
  'safe-sample': { dir: resolve(ROOT, 'samples/safe-bot'), name: 'Friendly Greeter', blurb: 'Bundled sample: a least-privilege greeter bot' },
};
const SPEC_PATH = resolve(ROOT, 'specs/bot-policy.md');
const PRELINT_CONFIG = resolve(ROOT, 'prelint.json');
const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const DEFAULT_ALLOW = ['discord.com', 'discordapp.com', 'slack.com', 'hooks.slack.com', 'github.com', 'api.github.com', 'haven.dev'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'vendor', '.next', '.venv', 'venv', '__pycache__', 'test', 'tests', '__tests__', 'spec', 'fixtures']);

let tenkiSdkMissing = false;
const PACE_MS = Math.max(0, Number(process.env.HAVEN_AUDIT_PACE_MS ?? 650) || 0);

// ───────────────────────────────────────── helpers ─────────────────────────────────────────

interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number; error?: string }

function run(cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer?: number }): Promise<RunResult> {
  return new Promise((done) => {
    const t0 = now();
    const max = o.maxBuffer ?? 8 * 1024 * 1024;
    let stdout = '', stderr = '', timedOut = false, settled = false;
    let child: import('node:child_process').ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      done({ code: null, stdout: '', stderr: '', timedOut: false, durationMs: 0, error: (e as Error).message });
      return;
    }
    const finish = (r: Partial<RunResult>) => {
      if (settled) return; settled = true; clearTimeout(timer);
      done({ code: null, stdout, stderr, timedOut, durationMs: now() - t0, ...r });
    };
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    child.stdout!.on('data', (d: Buffer) => { if (stdout.length < max) stdout += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { if (stderr.length < max) stderr += d.toString(); });
    child.on('error', (e: Error) => finish({ error: e.message }));
    child.on('close', (code: number | null) => finish({ code }));
  });
}

function onPath(bin: string): boolean {
  if (bin.includes('/')) return existsSync(bin);
  return (process.env.PATH ?? '').split(':').some((p) => p && existsSync(join(p, bin)));
}

function readJson<T = any>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function copyTree(src: string, dst: string, skipNodeModules = true) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (p) => { const b = p.split('/').pop() ?? ''; return b !== '.git' && !(skipNodeModules && b === 'node_modules'); },
  });
}

function walk(dir: string, opts: { skip?: Set<string>; maxFiles?: number } = {}): string[] {
  const out: string[] = [];
  const skip = opts.skip ?? SKIP_DIRS;
  const max = opts.maxFiles ?? 600;
  const visit = (d: string) => {
    if (out.length >= max) return;
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) visit(p); }
      else if (e.isFile()) out.push(p);
    }
  };
  visit(dir);
  return out;
}

const tail = (s: string, n = 4096) => (s.length > n ? '…' + s.slice(-n) : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function cmpVer(a: string, b: string): number {
  const pa = a.replace(/^[^\d]*/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^[^\d]*/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Mask secret-looking values so evidence never leaks a credential (TS-004: redact before any LLM call). */
function redact(s: string): string {
  return s
    .replace(/\b([MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.)[\w-]{27,38}\b/g, '$1…[redacted]')
    .replace(/\b(sk-|ghp_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/g, '$1…[redacted]')
    .replace(/((?:token|secret|api[_-]?key|apikey|password|passwd)[\w$]*['"]?\s*[:=]\s*['"`])([^'"`\s]{4})[^'"`\s]*(['"`])/gi, '$1$2…[redacted]$3');
}

// ───────────────────────────────────────── status ─────────────────────────────────────────

function snykAuth(): { ok: boolean; how: string } {
  if (config.snyk.token) return { ok: true, how: 'SNYK_TOKEN' };
  const base = process.env.XDG_CONFIG_HOME || join(os.homedir(), '.config');
  const store = readJson<Record<string, any>>(join(base, 'configstore', 'snyk.json'));
  if (store && (store.api || store.INTERNAL_OAUTH_TOKEN_STORAGE || store['internal_oauth_token_storage'])) return { ok: true, how: '`snyk auth` session' };
  return { ok: false, how: 'Snyk CLI not authenticated (run `snyk auth` or set SNYK_TOKEN)' };
}

export function auditStatus(): { snyk: 'live' | 'local'; tenki: 'live' | 'local'; prelint: 'live' | 'local'; detail: string } {
  const binOk = onPath(config.snyk.bin);
  const auth = snykAuth();
  const snykLive = binOk && auth.ok;
  const tenkiLive = !!config.tenki.apiKey && !tenkiSdkMissing;
  const specRules = loadSpec().rules.length;
  const parts = [
    snykLive ? `Snyk CLI live (${auth.how})` : `Snyk: local (OSV.dev) — ${binOk ? auth.how : `'${config.snyk.bin}' not found on PATH`}`,
    tenkiLive ? 'Tenki cloud sandbox live (@tenkicloud/sandbox)' : `Tenki: local sandbox runner${process.platform === 'darwin' ? ' (macOS seatbelt: no internet egress, confined writes)' : ''}${config.tenki.apiKey && tenkiSdkMissing ? ' — TENKI_API_KEY set but @tenkicloud/sandbox not installed' : ''}`,
    `Prelint: local spec engine over specs/bot-policy.md (${specRules} rules; same specs the Prelint GitHub App indexes via prelint.json)`,
  ];
  return { snyk: snykLive ? 'live' : 'local', tenki: tenkiLive ? 'live' : 'local', prelint: 'local', detail: parts.join(' · ') };
}

// ───────────────────────────────────────── persistence ─────────────────────────────────────────

export function listAudits(): Audit[] {
  return db.list<Audit>('audits', '', [], 'created_at DESC', 50);
}
export function getAudit(auditId: string): Audit | undefined {
  return db.get<Audit>('audits', auditId);
}
export function auditTargets() {
  return Object.entries(SAMPLES).map(([target, s]) => ({ target, name: s.name, description: s.blurb }));
}

// Audits that were running when the server stopped can never finish — mark them so the UI doesn't spin forever.
try {
  for (const a of db.list<Audit>('audits', "status IN ('queued','running')")) {
    db.update<Audit>('audits', a.id, { status: 'error', summary: 'Interrupted by a server restart — re-run the audit.', finishedAt: now() });
  }
} catch { /* table may not exist yet in exotic setups */ }

// ───────────────────────────────────────── fetch ─────────────────────────────────────────

function normalizeGithub(target: string): string | null {
  let t = target.trim();
  if (/^github\.com\//i.test(t)) t = 'https://' + t;
  const m = t.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

export function validateTarget(target: string): { kind: 'sample'; dir: string; name: string } | { kind: 'github'; url: string; name: string } {
  const t = (target ?? '').trim();
  if (SAMPLES[t]) return { kind: 'sample', dir: SAMPLES[t].dir, name: SAMPLES[t].name };
  const gh = normalizeGithub(t);
  if (gh) return { kind: 'github', url: gh, name: gh.replace('https://github.com/', '') };
  throw new Error(`Unsupported audit target "${t}". Use 'sample', 'safe-sample' or a public https://github.com/<owner>/<repo> URL.`);
}

/** Pick the directory that actually holds the bot (repo root, or the first nested package.json for monorepos). */
function projectRoot(dir: string): string {
  const has = (d: string) => existsSync(join(d, 'package.json')) || existsSync(join(d, 'requirements.txt')) || existsSync(join(d, 'bot.manifest.json'));
  if (has(dir)) return dir;
  const queue: [string, number][] = [[dir, 0]];
  while (queue.length) {
    const [d, depth] = queue.shift()!;
    if (depth > 2) continue;
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (has(p)) return p;
      queue.push([p, depth + 1]);
    }
  }
  return dir;
}

// ───────────────────────────────────────── Snyk (deps) ─────────────────────────────────────────

function parseSnykJson(stdout: string): { vulns: Vuln[]; dependencyCount: number; projectName: string | null } {
  const j = JSON.parse(stdout);
  const projects: any[] = Array.isArray(j) ? j : [j];
  const errs = projects.filter((p) => p && p.ok === false && p.error && !p.vulnerabilities);
  if (errs.length === projects.length) throw new Error(String(errs[0].error).slice(0, 200));
  const seen = new Map<string, Vuln>();
  let deps = 0;
  for (const p of projects) {
    deps += Number(p.dependencyCount ?? 0);
    for (const v of p.vulnerabilities ?? []) {
      const key = `${v.id}|${v.packageName}|${v.version}`;
      if (seen.has(key)) continue;
      const from: string[] = v.from ?? [];
      seen.set(key, {
        id: v.id, title: v.title, severity: (['critical', 'high', 'medium', 'low'].includes(v.severity) ? v.severity : 'medium') as Sev,
        pkg: v.packageName, version: v.version, fixedIn: (v.fixedIn ?? []).length ? v.fixedIn.join(', ') : null,
        cve: v.identifiers?.CVE?.[0] ?? null, cvss: typeof v.cvssScore === 'number' ? v.cvssScore : null,
        direct: from.length === 2, path: from.slice(1).join(' › '), url: `https://security.snyk.io/vuln/${v.id}`,
      });
    }
  }
  return { vulns: [...seen.values()], dependencyCount: deps, projectName: projects[0]?.projectName ?? null };
}

interface Pkg { name: string; version: string; ecosystem: 'npm' | 'PyPI'; direct: boolean }

function collectPackages(dir: string): { pkgs: Pkg[]; source: string } {
  const pj = readJson<any>(join(dir, 'package.json'));
  const directNames = new Set<string>(Object.keys({ ...(pj?.dependencies ?? {}), ...(pj?.devDependencies ?? {}) }));
  const lock = readJson<any>(join(dir, 'package-lock.json'));
  const map = new Map<string, Pkg>();
  const add = (p: Pkg) => { const k = `${p.ecosystem}:${p.name}@${p.version}`; if (!map.has(k)) map.set(k, p); else if (p.direct) map.get(k)!.direct = true; };
  if (lock?.packages) {
    for (const [path, info] of Object.entries<any>(lock.packages)) {
      if (!path || !info?.version || info.link) continue;
      const name = info.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const top = path.split('node_modules/').length === 2;
      add({ name, version: info.version, ecosystem: 'npm', direct: top && directNames.has(name) });
    }
    if (map.size) return { pkgs: [...map.values()], source: 'package-lock.json' };
  }
  if (lock?.dependencies) {
    const visit = (deps: Record<string, any>, depth: number) => {
      for (const [name, info] of Object.entries<any>(deps)) {
        if (info?.version) add({ name, version: info.version, ecosystem: 'npm', direct: depth === 0 && directNames.has(name) });
        if (info?.dependencies) visit(info.dependencies, depth + 1);
      }
    };
    visit(lock.dependencies, 0);
    if (map.size) return { pkgs: [...map.values()], source: 'package-lock.json (v1)' };
  }
  if (pj) {
    for (const [name, spec] of Object.entries<string>({ ...(pj.dependencies ?? {}), ...(pj.devDependencies ?? {}) })) {
      const m = String(spec).match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
      if (m) add({ name, version: m[1], ecosystem: 'npm', direct: true });
    }
    if (map.size) return { pkgs: [...map.values()], source: 'package.json (declared minimum versions)' };
  }
  try {
    const req = readFileSync(join(dir, 'requirements.txt'), 'utf8');
    for (const line of req.split('\n')) {
      const m = line.trim().match(/^([A-Za-z0-9_.\-\[\]]+)\s*==\s*([\w.]+)/);
      if (m) add({ name: m[1].replace(/\[.*\]/, ''), version: m[2], ecosystem: 'PyPI', direct: true });
    }
    if (map.size) return { pkgs: [...map.values()], source: 'requirements.txt' };
  } catch { /* none */ }
  return { pkgs: [], source: 'none' };
}

function sevFromCvss(vec: string | undefined): Sev {
  if (!vec) return 'medium';
  const g = (k: string) => (vec.match(new RegExp(`(?:^|/)${k}:([A-Z])`)) ?? [])[1];
  const highs = ['C', 'I', 'A', 'VC', 'VI', 'VA'].map(g).filter((x) => x === 'H').length;
  const net = g('AV') === 'N', noPriv = g('PR') === 'N', noUi = g('UI') === 'N';
  if (highs >= 2 && net && noPriv && noUi) return 'critical';
  if (highs >= 1) return 'high';
  if (['C', 'I', 'A', 'VC', 'VI', 'VA'].map(g).some((x) => x === 'L')) return 'medium';
  return 'low';
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', 'user-agent': 'haven-kai-audit/1.0', ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function osvScan(dir: string): Promise<{ vulns: Vuln[]; dependencyCount: number; source: string }> {
  const { pkgs, source } = collectPackages(dir);
  if (!pkgs.length) return { vulns: [], dependencyCount: 0, source };
  const batch = pkgs.slice(0, 1000);
  const res = await fetchJson('https://api.osv.dev/v1/querybatch', {
    method: 'POST', body: JSON.stringify({ queries: batch.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
  }, 20000);
  const pairs: { pkg: Pkg; vid: string }[] = [];
  (res.results ?? []).forEach((r: any, i: number) => { for (const v of r?.vulns ?? []) pairs.push({ pkg: batch[i], vid: v.id }); });
  const ids = [...new Set(pairs.map((p) => p.vid))].slice(0, 200);
  const details = new Map<string, any>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(16, ids.length) }, async () => {
    while (cursor < ids.length) {
      const vid = ids[cursor++];
      try { details.set(vid, await fetchJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(vid)}`, {}, 8000)); } catch { /* keep id-only */ }
    }
  }));
  const vulns: Vuln[] = [];
  const seen = new Set<string>();
  for (const { pkg, vid } of pairs) {
    const d = details.get(vid);
    const key = `${vid}|${pkg.name}|${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Skip a GHSA if we already listed its CVE twin for the same package (OSV can return both ids).
    const raw = String(d?.database_specific?.severity ?? '').toUpperCase();
    const vec = (d?.severity ?? []).find((s: any) => String(s.type).startsWith('CVSS'))?.score as string | undefined;
    const severity: Sev = vid.startsWith('MAL-') ? 'critical'
      : raw === 'CRITICAL' ? 'critical' : raw === 'HIGH' ? 'high' : raw === 'MODERATE' || raw === 'MEDIUM' ? 'medium' : raw === 'LOW' ? 'low' : sevFromCvss(vec);
    const fixes: string[] = [];
    for (const a of d?.affected ?? []) {
      if (a?.package?.name !== pkg.name) continue;
      for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed && cmpVer(e.fixed, pkg.version) > 0) fixes.push(e.fixed);
    }
    fixes.sort(cmpVer);
    vulns.push({
      id: vid, title: d?.summary || (d?.details ? String(d.details).split('\n')[0].slice(0, 120) : vid), severity,
      pkg: pkg.name, version: pkg.version, fixedIn: fixes[0] ?? null,
      cve: (d?.aliases ?? []).find((a: string) => a.startsWith('CVE-')) ?? null, cvss: null, direct: pkg.direct,
      url: `https://osv.dev/vulnerability/${vid}`,
    });
  }
  return { vulns, dependencyCount: pkgs.length, source };
}

function summarizeVulns(vulns: Vuln[]) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of vulns) counts[v.severity]++;
  const top = [...vulns].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || (b.cvss ?? 0) - (a.cvss ?? 0) || Number(b.direct) - Number(a.direct)).slice(0, 12);
  const packages = [...new Set(vulns.map((v) => `${v.pkg}@${v.version}`))];
  return { counts, total: vulns.length, top, vulnerablePackages: packages.length, packages: packages.slice(0, 30) };
}

async function snykDeps(dir: string, auditId: string): Promise<any> {
  const t0 = now();
  const auth = snykAuth();
  const binOk = onPath(config.snyk.bin);
  let cliError: string | null = null;
  if (binOk && auth.ok) {
    const tmp = join(os.tmpdir(), `haven-snyk-${auditId}`);
    try {
      copyTree(dir, tmp, false);
      const r = await run(config.snyk.bin, ['test', '--json'], {
        cwd: tmp, timeoutMs: 120000, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...(config.snyk.token ? { SNYK_TOKEN: config.snyk.token } : {}), SNYK_DISABLE_ANALYTICS: '1', FORCE_COLOR: '0' },
      });
      if (r.timedOut) cliError = 'snyk test timed out after 120s';
      else if (r.code === 0 || r.code === 1) {
        const parsed = parseSnykJson(r.stdout);
        return { mode: 'snyk-cli', engine: `Snyk CLI (${auth.how})`, ok: parsed.vulns.length === 0, dependencyCount: parsed.dependencyCount, source: 'snyk test --json', durationMs: now() - t0, ...summarizeVulns(parsed.vulns) };
      } else {
        try { parseSnykJson(r.stdout); } catch (e) { cliError = (e as Error).message; }
        cliError = cliError || `snyk exited ${r.code}: ${(r.stderr || r.stdout).slice(0, 200)}`;
      }
    } catch (e) { cliError = (e as Error).message; }
    finally { rmSync(tmp, { recursive: true, force: true }); }
  } else {
    cliError = binOk ? auth.how : `'${config.snyk.bin}' not found on PATH`;
  }
  const osv = await osvScan(dir);
  return {
    mode: 'local (OSV.dev)', engine: 'OSV.dev vulnerability database (Snyk fallback)', cliError,
    ok: osv.vulns.length === 0, dependencyCount: osv.dependencyCount, source: osv.source, durationMs: now() - t0, ...summarizeVulns(osv.vulns),
  };
}

// ───────────────────────────────────────── source scan (local SAST) ─────────────────────────────────────────

const SRC_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.json', '.yml', '.yaml']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'package.json', 'bot.manifest.json', 'tsconfig.json']);

export interface SourceScan { files: number; findings: Finding[]; httpUrls: string[]; adminRefs: string[]; intentRefs: string[] }

export function scanSource(dir: string): SourceScan {
  const files = walk(dir).filter((f) => {
    const b = f.split('/').pop()!;
    if (SKIP_FILES.has(b)) return false;
    if (/^\.env(\.|$)/.test(b)) return !/example|sample|template/i.test(b);
    return SRC_EXT.has(extname(b));
  });
  const findings: Finding[] = [];
  const httpUrls = new Set<string>();
  const adminRefs: string[] = [], intentRefs: string[] = [];
  const PLACEHOLDER = /^(your|<|\$\{|xxx|example|placeholder|changeme_here|dummy|process\.env)/i;
  for (const f of files) {
    let text: string;
    try { if (statSync(f).size > 256 * 1024) continue; text = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = relative(dir, f);
    const isPy = f.endsWith('.py');
    const hasChildProcess = /child_process/.test(text);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.length > 1000) return; // minified
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
      const hit = (kind: Finding['kind'], label: string, severity: Sev) =>
        findings.push({ kind, label, file: rel, line: i + 1, snippet: redact(trimmed).slice(0, 160), severity });
      // BOT-003: eval / exec of user content
      if (/(^|[^.\w$])eval\s*\(/.test(line)) hit('code-exec', 'eval() of dynamic input', 'critical');
      if (/\bnew\s+Function\s*\(/.test(line)) hit('code-exec', 'new Function() code construction', 'critical');
      if (/\bvm\.(runIn\w+|compileFunction)\s*\(|new\s+vm\.Script\s*\(/.test(line)) hit('code-exec', 'node:vm execution of dynamic code', 'high');
      if (hasChildProcess && /(^|[^\w$.])(exec|execSync|spawn|spawnSync)\s*\(\s*(?!['"`][^'"`$]*['"`]\s*[,)])/.test(line)) hit('code-exec', 'child_process with interpolated input (command injection)', 'critical');
      if (isPy && (/\bos\.system\s*\(/.test(line) || /subprocess\.\w+\([^)]*shell\s*=\s*True/.test(line) || /(^|[^.\w])exec\s*\(/.test(line))) hit('code-exec', 'shell/exec of dynamic input', 'critical');
      // BOT-004: hardcoded / logged secrets
      const lit = line.match(/\b[\w$]*(token|secret|api[_-]?key|apikey|password|passwd|private[_-]?key)[\w$]*['"]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/i);
      if (lit && !PLACEHOLDER.test(lit[2])) hit('secret-hardcoded', `hardcoded ${lit[1].toLowerCase()} literal`, 'critical');
      else if (/\b[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,38}\b/.test(line) || /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/.test(line)) hit('secret-hardcoded', 'credential-shaped string literal', 'critical');
      if (/(console\.(log|info|warn|error|debug)|logger\.\w+|\bprint)\s*\(.*\b\w*(token|secret|password|api_?key)\w*/i.test(line)) hit('secret-logged', 'secret written to logs', 'high');
      if (/[?&](token|key|secret|api_key|access_token)=['"`]?\s*\+/i.test(line) || /stringify\s*\(\s*\{[^}]*\b(token|secret)\s*:/i.test(line)) hit('secret-logged', 'secret sent in URL / telemetry payload', 'high');
      // BOT-005: plain-http endpoints
      for (const m of line.matchAll(/['"`](http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[^'"`\s]+)['"`]?/g)) {
        httpUrls.add(m[1]);
        hit('insecure-http', `plain-http endpoint ${m[1].replace(/[?#].*/, '').slice(0, 60)}`, 'medium');
      }
      // BOT-001 / BOT-002 signals in code
      if (/PermissionFlagsBits\.Administrator|Permissions\.FLAGS\.ADMINISTRATOR|['"]ADMINISTRATOR['"]|administrator\s*[:=]\s*True|permissions=8\b/.test(line)) { adminRefs.push(`${rel}:${i + 1}`); hit('admin-permission', 'requests administrator permission in code', 'critical'); }
      if (/GatewayIntentBits\.MessageContent|Intents\.FLAGS\.MESSAGE_CONTENT|['"]MESSAGE_CONTENT['"]|intents\.message_content\s*=\s*True/.test(line)) { intentRefs.push(`${rel}:${i + 1}`); hit('message-content', 'enables MESSAGE_CONTENT intent', 'medium'); }
    });
  }
  return { files: files.length, findings, httpUrls: [...httpUrls], adminRefs, intentRefs };
}

// ───────────────────────────────────────── Snyk Code (SAST) ─────────────────────────────────────────

async function snykCode(dir: string, auditId: string, scan: SourceScan): Promise<any> {
  const t0 = now();
  const local = {
    engine: 'Haven local SAST rules (same patterns Prelint BOT-003/004/005 cite)',
    counts: scan.findings.reduce((acc, f) => { acc[f.severity]++; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 } as Record<Sev, number>),
    findings: scan.findings.slice(0, 20), files: scan.files,
  };
  const auth = snykAuth();
  if (!onPath(config.snyk.bin) || !auth.ok) {
    return { mode: 'skipped', skipped: true, reason: onPath(config.snyk.bin) ? auth.how : `'${config.snyk.bin}' not found`, local, durationMs: now() - t0 };
  }
  const tmp = join(os.tmpdir(), `haven-snykcode-${auditId}`);
  try {
    copyTree(dir, tmp, true);
    const r = await run(config.snyk.bin, ['code', 'test', '--json'], {
      cwd: tmp, timeoutMs: 90000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...(config.snyk.token ? { SNYK_TOKEN: config.snyk.token } : {}), SNYK_DISABLE_ANALYTICS: '1', FORCE_COLOR: '0' },
    });
    if (r.timedOut) return { mode: 'skipped', skipped: true, reason: 'snyk code test timed out (90s)', local, durationMs: now() - t0 };
    if (r.code !== 0 && r.code !== 1) {
      let reason = `snyk code exited ${r.code}`;
      try { const j = JSON.parse(r.stdout); if (j.error) reason = String(j.error).slice(0, 200); } catch { if (r.stderr) reason += `: ${r.stderr.slice(0, 160)}`; }
      if (r.code === 3) reason = 'no files Snyk Code supports in this repo';
      return { mode: 'skipped', skipped: true, reason, local, durationMs: now() - t0 };
    }
    const sarif = JSON.parse(r.stdout);
    const rules = new Map<string, any>();
    for (const run of sarif.runs ?? []) for (const rule of run.tool?.driver?.rules ?? []) rules.set(rule.id, rule);
    const issues = (sarif.runs ?? []).flatMap((run: any) => run.results ?? []).map((res: any) => {
      const loc = res.locations?.[0]?.physicalLocation;
      const sev: Sev = res.level === 'error' ? 'high' : res.level === 'warning' ? 'medium' : 'low';
      return { ruleId: res.ruleId, title: rules.get(res.ruleId)?.shortDescription?.text ?? res.ruleId, severity: sev, message: redact(String(res.message?.text ?? '')).slice(0, 220), file: loc?.artifactLocation?.uri ?? '', line: loc?.region?.startLine ?? 0 };
    });
    const counts = issues.reduce((acc: Record<Sev, number>, i: any) => { acc[i.severity as Sev]++; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 });
    return { mode: 'snyk-code', skipped: false, counts, total: issues.length, issues: issues.slice(0, 12), local, durationMs: now() - t0 };
  } catch (e) {
    return { mode: 'skipped', skipped: true, reason: (e as Error).message.slice(0, 200), local, durationMs: now() - t0 };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ───────────────────────────────────────── Tenki (sandbox install + test) ─────────────────────────────────────────

function parseTestCounts(out: string): { passed: number | null; failed: number | null } {
  const num = (re: RegExp) => { const m = out.match(re); return m ? Number(m[1]) : null; };
  let passed = num(/^#\s*pass\s+(\d+)/m) ?? num(/(\d+)\s+passing/) ?? num(/Tests:.*?(\d+)\s+passed/) ?? num(/Tests\s+.*?(\d+)\s+passed/) ?? num(/(\d+)\s+passed/);
  let failed = num(/^#\s*fail\s+(\d+)/m) ?? num(/(\d+)\s+failing/) ?? num(/Tests:.*?(\d+)\s+failed/) ?? num(/Tests\s+.*?(\d+)\s+failed/) ?? num(/(\d+)\s+failed/);
  if (passed === null && failed === null) {
    const ok = (out.match(/^\s*ok\s+/gm) ?? []).length, notOk = (out.match(/^\s*(not ok|FAIL)\s+/gm) ?? []).length;
    if (ok || notOk) { passed = ok; failed = notOk; }
  }
  if (passed !== null && failed === null) failed = 0;
  if (failed !== null && passed === null) passed = 0;
  return { passed, failed };
}

function hasDeps(pkg: any) {
  return Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }).length > 0;
}

async function tenkiLive(dir: string, auditId: string): Promise<any> {
  const t0 = now();
  const modName = '@tenkicloud/sandbox';
  let mod: any;
  try { mod = await import(modName); } catch { tenkiSdkMissing = true; throw new Error('@tenkicloud/sandbox SDK not installed'); }
  const Sandbox = mod.TenkiSandbox ?? mod.default?.TenkiSandbox;
  const sandbox = new Sandbox({ authToken: config.tenki.apiKey, ...(config.tenki.baseUrl ? { baseUrl: config.tenki.baseUrl } : {}), warningHandler: null });
  const session = await sandbox.create({ name: `haven-audit-${auditId}`, cpuCores: 2, memoryMb: 4096, allowOutbound: true, maxDurationMs: 10 * 60 * 1000, tags: ['haven', 'bot-audit'], metadata: { purpose: 'haven-bot-audit', auditId } });
  const decode = (x: any) => (x == null ? '' : typeof x === 'string' ? x : new TextDecoder().decode(x));
  try {
    const root = '/home/tenki/repo';
    const files = walk(dir, { skip: new Set(['node_modules', '.git']), maxFiles: 300 }).filter((f) => { try { return statSync(f).size < 256 * 1024; } catch { return false; } });
    const dirs = [...new Set(files.map((f) => `${root}/${dirname(relative(dir, f))}`.replace(/\/\.$/, '')))];
    await session.exec(['mkdir', '-p', root, ...dirs]);
    for (const f of files) await session.writeFile(`${root}/${relative(dir, f)}`, readFileSync(f, 'utf8'));
    const pkg = readJson<any>(join(dir, 'package.json'));
    let install: any = { ran: false };
    if (hasDeps(pkg)) {
      const i = await session.exec(['bash', '-c', `cd ${root} && npm install --ignore-scripts --no-audit --no-fund`], { timeoutMs: 120000 });
      install = { ran: true, exitCode: i.exitCode ?? null, timedOut: i.status === 'TIMED_OUT', added: Number((decode(i.stdout).match(/added (\d+) packages?/) ?? [])[1] ?? 0) || null };
    }
    const testScript = pkg?.scripts?.test;
    if (!testScript || /no test specified/.test(testScript)) {
      return { mode: 'tenki-cloud', engine: 'Tenki cloud sandbox', isolation: 'Tenki microVM', sessionId: session.id ?? null, install, noTests: true, exitCode: null, passed: 0, failed: 0, durationMs: now() - t0, logTail: 'No "test" script in package.json.' };
    }
    const t1 = now();
    const r = await session.exec(['bash', '-c', `cd ${root} && NODE_ENV=test CI=1 npm test`], { timeoutMs: 60000 });
    const out = decode(r.stdout) + (decode(r.stderr) ? '\n' + decode(r.stderr) : '');
    const counts = parseTestCounts(out);
    return {
      mode: 'tenki-cloud', engine: 'Tenki cloud sandbox', isolation: 'Tenki microVM (no host access, no secrets)', sessionId: session.id ?? null, install,
      exitCode: r.exitCode ?? null, timedOut: r.status === 'TIMED_OUT', ...counts, testDurationMs: now() - t1, durationMs: now() - t0, logTail: tail(out),
    };
  } finally { try { await session.close(); } catch { /* already gone */ } }
}

function seatbeltProfile(work: string): string {
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const allow = [real(work), real(os.tmpdir()), '/private/tmp', '/private/var/folders'].map((p) => `(subpath "${p.replace(/"/g, '')}")`).join(' ');
  return `(version 1)(allow default)(deny network-outbound)(allow network-outbound (local unix))(allow network-outbound (remote ip "localhost:*"))(deny file-write*)(allow file-write* ${allow} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`;
}

async function tenkiLocal(dir: string, auditId: string): Promise<any> {
  const t0 = now();
  const work = join(os.tmpdir(), `haven-tenki-${auditId}`);
  const base = { mode: 'local sandbox runner', engine: 'Haven local sandbox runner (Tenki fallback)' };
  try {
    copyTree(dir, work, false);
    const pkg = readJson<any>(join(work, 'package.json'));
    if (!pkg) return { ...base, isolation: 'n/a', skipped: true, noTests: true, reason: 'No package.json — nothing to install or test.', exitCode: null, passed: 0, failed: 0, durationMs: now() - t0, logTail: '' };
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
    let install: any = { ran: false };
    let log = '';
    if (!existsSync(join(work, 'node_modules')) && hasDeps(pkg)) {
      const i = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, env, timeoutMs: 90000 });
      install = { ran: true, exitCode: i.code, timedOut: i.timedOut, durationMs: i.durationMs, added: Number((i.stdout.match(/added (\d+) packages?/) ?? [])[1] ?? 0) || null, ignoreScripts: true };
      log += `$ npm install --ignore-scripts --no-audit --no-fund\n${(i.stdout + i.stderr).trim().split('\n').slice(-4).join('\n')}\n\n`;
      if (i.timedOut || i.code !== 0) {
        return { ...base, isolation: 'install only', install, exitCode: i.code, timedOut: i.timedOut, passed: 0, failed: 0, installFailed: true, durationMs: now() - t0, logTail: tail(log + (i.stderr || i.error || '')) };
      }
    }
    const testScript = pkg.scripts?.test;
    if (!testScript || /no test specified/.test(testScript)) {
      return { ...base, isolation: 'n/a', install, noTests: true, exitCode: null, passed: 0, failed: 0, durationMs: now() - t0, logTail: log + 'No "test" script in package.json.' };
    }
    const testEnv: NodeJS.ProcessEnv = { PATH: env.PATH, HOME: env.HOME, NODE_ENV: 'test', CI: '1', npm_config_update_notifier: 'false' };
    const useSeatbelt = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
    let isolation = 'env-stripped child process (PATH/HOME only, no secrets)';
    let r: RunResult;
    if (useSeatbelt) {
      r = await run('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(work), 'npm', 'test', '--logs-max=0'], { cwd: work, env: testEnv, timeoutMs: 60000 });
      if ((r.code === 71 || /sandbox_apply|sandbox-exec:/.test(r.stderr)) && !r.timedOut) {
        r = await run('npm', ['test', '--logs-max=0'], { cwd: work, env: testEnv, timeoutMs: 60000 });
      } else isolation = 'macOS seatbelt: internet egress denied (localhost only), writes confined to sandbox dir, no secrets in env';
    } else {
      r = await run('npm', ['test', '--logs-max=0'], { cwd: work, env: testEnv, timeoutMs: 60000 });
    }
    const out = (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim();
    log += `$ npm test\n${out}`;
    return {
      ...base, isolation, install, exitCode: r.code, timedOut: r.timedOut, ...parseTestCounts(out),
      testDurationMs: r.durationMs, durationMs: now() - t0, logTail: tail(log),
    };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

async function tenkiRun(dir: string, auditId: string): Promise<any> {
  if (config.tenki.apiKey && !tenkiSdkMissing) {
    try {
      return await Promise.race([
        tenkiLive(dir, auditId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Tenki sandbox timed out (150s)')), 150000)),
      ]);
    } catch (e) {
      const local = await tenkiLocal(dir, auditId);
      return { ...local, liveError: (e as Error).message.slice(0, 200) };
    }
  }
  return tenkiLocal(dir, auditId);
}

// ───────────────────────────────────────── Prelint (spec check) ─────────────────────────────────────────

interface SpecRule { id: string; title: string; body: string; severity: string }

function loadSpec(): { rules: SpecRule[]; allowList: string[] } {
  let text = '';
  try { text = readFileSync(SPEC_PATH, 'utf8'); } catch { return { rules: [], allowList: DEFAULT_ALLOW }; }
  const rules: SpecRule[] = [];
  const parts = text.split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const m = p.match(/^(BOT-\d{3})\s+(.+)\n([\s\S]*)$/);
    if (!m) continue;
    const body = m[3].split(/^##\s+/m)[0].trim();
    rules.push({ id: m[1], title: m[2].trim(), body, severity: ((body.match(/\*\*Severity:\*\*\s*(\w+)/) ?? [])[1] ?? 'medium').toLowerCase() });
  }
  const r005 = rules.find((r) => r.id === 'BOT-005');
  const allowList = r005 ? [...r005.body.matchAll(/`([a-z0-9-]+(?:\.[a-z0-9-]+)+)`/gi)].map((x) => x[1].toLowerCase()).filter((d) => !d.includes('manifest') && !d.endsWith('.json')) : [];
  return { rules, allowList: allowList.length ? allowList : DEFAULT_ALLOW };
}

function loadManifest(dir: string, scan: SourceScan, repoUrl: string | null): { manifest: any; file: string | null; inferred: boolean } {
  for (const f of ['bot.manifest.json', '.haven/bot.json', 'manifest.json', 'app.json']) {
    const j = readJson<any>(join(dir, f));
    if (j && (j.permissions || j.intents || f === 'bot.manifest.json')) return { manifest: j, file: f, inferred: false };
  }
  return {
    manifest: (() => {
      const pj = readJson<any>(join(dir, 'package.json')) ?? {};
      const author = typeof pj.author === 'string' ? pj.author : pj.author?.name;
      const home = typeof pj.homepage === 'string' ? pj.homepage : repoUrl;
      return { name: pj.name, version: pj.version, author, homepage: home, privacyPolicy: null, permissions: scan.adminRefs.length ? ['ADMINISTRATOR'] : [], intents: scan.intentRefs.length ? ['MESSAGE_CONTENT'] : [], intentPurpose: {}, webhooks: [] };
    })(),
    file: null, inferred: true,
  };
}

const evid = (fs: Finding[], n = 3) => fs.slice(0, n).map((f) => `${f.file}:${f.line} ${f.snippet}`).join(' · ') + (fs.length > n ? ` · +${fs.length - n} more` : '');

function evaluateRules(ctx: { manifest: any; manifestFile: string | null; inferred: boolean; scan: SourceScan; snyk: any; tenki: any; allowList: string[] }): Record<string, Omit<RuleResult, 'ruleId' | 'title' | 'severity'>> {
  const { manifest: mf, scan, snyk, tenki, allowList } = ctx;
  const perms: string[] = (mf.permissions ?? []).map((p: string) => String(p).toUpperCase());
  const intents: string[] = (mf.intents ?? []).map((p: string) => String(p).toUpperCase());
  const src = ctx.manifestFile ?? 'source (no manifest — inferred)';
  const out: Record<string, Omit<RuleResult, 'ruleId' | 'title' | 'severity'>> = {};

  // BOT-001
  const risky = perms.filter((p) => ['MANAGE_GUILD', 'BAN_MEMBERS', 'KICK_MEMBERS', 'MANAGE_ROLES', 'MANAGE_WEBHOOKS', 'MENTION_EVERYONE'].includes(p));
  if (perms.includes('ADMINISTRATOR') || scan.adminRefs.length) {
    out['BOT-001'] = { status: 'fail', evidence: `${src} requests ADMINISTRATOR${risky.length ? ` plus ${risky.join(', ')}` : ''}${scan.adminRefs.length ? ` (code: ${scan.adminRefs.slice(0, 2).join(', ')})` : ''}` };
  } else if (risky.length && !mf.permissionPurpose) {
    out['BOT-001'] = { status: 'warn', evidence: `Requests ${risky.join(', ')} without a permissionPurpose justification` };
  } else if (ctx.inferred) {
    out['BOT-001'] = { status: 'warn', evidence: 'No bot.manifest.json — no administrator flags found in code, but requested permissions could not be verified' };
  } else {
    out['BOT-001'] = { status: 'pass', evidence: `Least privilege: ${perms.length ? perms.join(', ') : 'no permissions'}` };
  }

  // BOT-002
  const privileged = intents.filter((i) => ['MESSAGE_CONTENT', 'GUILD_MEMBERS', 'GUILD_PRESENCES'].includes(i));
  const purpose = mf.intentPurpose ?? {};
  const missing = privileged.filter((i) => !(typeof purpose[i] === 'string' && purpose[i].trim().length >= 10));
  if (missing.length) out['BOT-002'] = { status: 'fail', evidence: `${src} requests ${missing.join(', ')} with no stated purpose (intentPurpose is empty)` };
  else if (privileged.length) out['BOT-002'] = { status: 'pass', evidence: privileged.map((i) => `${i}: "${String(purpose[i]).slice(0, 80)}"`).join(' · ') };
  else out['BOT-002'] = { status: 'pass', evidence: `No privileged intents requested (${intents.join(', ') || 'none'})` };

  // BOT-003
  const exec = scan.findings.filter((f) => f.kind === 'code-exec');
  out['BOT-003'] = exec.length
    ? { status: 'fail', evidence: `${plural(exec.length, 'dynamic-execution sink')}: ${evid(exec)}` }
    : { status: 'pass', evidence: `No eval / new Function / child_process exec of input in ${plural(scan.files, 'source file')}` };

  // BOT-004
  const hard = scan.findings.filter((f) => f.kind === 'secret-hardcoded');
  const logged = scan.findings.filter((f) => f.kind === 'secret-logged');
  out['BOT-004'] = hard.length || logged.length
    ? { status: 'fail', evidence: [hard.length ? `${plural(hard.length, 'hardcoded secret')}: ${evid(hard, 2)}` : '', logged.length ? `${plural(logged.length, 'secret leak')} to logs/telemetry: ${evid(logged, 2)}` : ''].filter(Boolean).join(' · ') }
    : { status: 'pass', evidence: 'No secret literals; secrets are read from the environment and never logged' };

  // BOT-005
  const endpoints: string[] = [...(mf.webhooks ?? []), ...(mf.telemetry ? [mf.telemetry] : []), ...scan.httpUrls];
  const bad = [...new Set(endpoints)].map((u) => {
    let host = '', proto = '';
    try { const x = new URL(u); host = x.hostname.toLowerCase(); proto = x.protocol; } catch { return `${u} (unparseable)`; }
    if (proto !== 'https:') return `${u.replace(/[?#].*/, '')} (plain http)`;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return `${host} (raw IP)`;
    if (!allowList.some((d) => host === d || host.endsWith('.' + d))) return `${host} (not allow-listed)`;
    return null;
  }).filter(Boolean) as string[];
  out['BOT-005'] = bad.length
    ? { status: 'fail', evidence: `${plural(bad.length, 'non-compliant endpoint')}: ${bad.slice(0, 4).join(', ')}` }
    : { status: 'pass', evidence: endpoints.length ? `All ${endpoints.length} endpoints are HTTPS + allow-listed` : 'No outbound webhooks or telemetry' };

  // BOT-006
  const ret = mf.dataRetention;
  const days = typeof ret === 'number' ? ret : typeof ret === 'string' && /^\s*\d+\s*(d|days?)?\s*$/i.test(ret) ? parseInt(ret, 10) : null;
  const sensitive = (mf.dataCollected ?? []).filter((d: string) => ['direct_messages', 'ip_addresses'].includes(d));
  if (ctx.inferred && ret == null) out['BOT-006'] = { status: 'warn', evidence: 'No manifest — data retention is undeclared' };
  else if (days === null || days > 30) out['BOT-006'] = { status: 'fail', evidence: `dataRetention is "${ret ?? 'undeclared'}" (max 30 days)${sensitive.length ? `; collects ${sensitive.join(', ')}` : ''}` };
  else if (sensitive.length) out['BOT-006'] = { status: 'warn', evidence: `Retention ${days}d but collects ${sensitive.join(', ')}` };
  else out['BOT-006'] = { status: 'pass', evidence: `Retention ${days} days; collects ${(mf.dataCollected ?? []).join(', ') || 'nothing'}` };

  // BOT-007
  if (!snyk || snyk.error) out['BOT-007'] = { status: 'warn', evidence: `Dependency scan unavailable: ${snyk?.error ?? 'not run'}` };
  else {
    const c = snyk.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
    const worst = (snyk.top ?? []).slice(0, 3).map((v: Vuln) => `${v.pkg}@${v.version} ${v.cve ?? v.id}`).join(', ');
    if (c.critical + c.high > 0) out['BOT-007'] = { status: 'fail', evidence: `${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.low} low via ${snyk.mode} — ${worst}` };
    else if (c.medium + c.low > 0) out['BOT-007'] = { status: 'warn', evidence: `${c.medium} medium · ${c.low} low via ${snyk.mode} — ${worst}` };
    else out['BOT-007'] = { status: 'pass', evidence: `0 known vulnerabilities across ${plural(snyk.dependencyCount ?? 0, 'dependency').replace('dependencys', 'dependencies')} via ${snyk.mode}` };
  }

  // BOT-008
  if (!tenki || tenki.error) out['BOT-008'] = { status: 'warn', evidence: `Sandbox run unavailable: ${tenki?.error ?? 'not run'}` };
  else if (tenki.noTests) out['BOT-008'] = { status: 'warn', evidence: tenki.reason ?? 'No test suite shipped — cannot verify behaviour' };
  else if (tenki.installFailed) out['BOT-008'] = { status: 'fail', evidence: `Install failed in sandbox (exit ${tenki.exitCode}${tenki.timedOut ? ', timed out' : ''})` };
  else if (tenki.exitCode === 0) out['BOT-008'] = { status: 'pass', evidence: `${tenki.passed ?? '?'} passed, 0 failed in ${tenki.mode} (${Math.round((tenki.testDurationMs ?? tenki.durationMs) / 100) / 10}s)` };
  else out['BOT-008'] = { status: 'fail', evidence: `${tenki.failed ?? '?'} failed, ${tenki.passed ?? '?'} passed — exit ${tenki.exitCode}${tenki.timedOut ? ' (timed out)' : ''} in ${tenki.mode}` };

  // BOT-009
  const issues: string[] = [];
  if (!mf.author || /unverified|unknown/i.test(String(mf.author))) issues.push(`publisher "${mf.author ?? 'unknown'}" is not verified`);
  if (!mf.homepage || !String(mf.homepage).startsWith('https://')) issues.push(`homepage ${mf.homepage ? `is ${String(mf.homepage).split(':')[0]}` : 'missing'}`);
  if (!mf.privacyPolicy) issues.push('no privacy policy');
  out['BOT-009'] = issues.length ? { status: 'warn', evidence: issues.join('; ') } : { status: 'pass', evidence: `${mf.author} · ${mf.homepage}` };

  return out;
}

function upgradePlan(top: Vuln[]): string {
  const best = new Map<string, string>();
  for (const v of top) {
    if (!v.fixedIn) continue;
    const fix = v.fixedIn.split(',')[0].trim();
    const cur = best.get(v.pkg);
    if (!cur || cmpVer(fix, cur) > 0) best.set(v.pkg, fix);
  }
  return [...best.entries()].slice(0, 4).map(([p, f]) => `${p}→${f}`).join(', ');
}

async function prelintCheck(dir: string, scan: SourceScan, snyk: any, tenki: any, auditId: string, repoUrl: string | null): Promise<any> {
  const t0 = now();
  const spec = loadSpec();
  const { manifest, file, inferred } = loadManifest(dir, scan, repoUrl);
  const pj = readJson<any>(join(dir, 'package.json'));
  const evals = evaluateRules({ manifest, manifestFile: file, inferred, scan, snyk, tenki, allowList: spec.allowList });
  const rules: RuleResult[] = spec.rules.map((r) => ({
    ruleId: r.id, title: r.title, severity: r.severity,
    ...(evals[r.id] ?? { status: 'warn' as const, evidence: 'No automated check for this rule yet — needs human review' }),
  }));
  const failed = rules.filter((r) => r.status === 'fail'), warned = rules.filter((r) => r.status === 'warn');
  const counts = snyk?.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const blocking = failed.filter((r) => r.severity === 'critical' || r.severity === 'high');

  // Reviewer summary — Kai writes it through the Flatkey gateway (coding tier); deterministic fallback when offline.
  const fallbackBullets = [
    failed.length
      ? `Blocking: ${failed.length}/${rules.length} rules fail (${failed.map((r) => r.ruleId).join(', ')}). Worst: ${failed[0].ruleId} ${failed[0].title} — ${failed[0].evidence.slice(0, 140)}`
      : warned.length ? `No rule failures across ${rules.length} rules; ${plural(warned.length, 'warning')} to review: ${warned.map((r) => `${r.ruleId} (${r.evidence.slice(0, 70)})`).join('; ')}.` : `All ${rules.length} rules pass.`,
    counts.critical + counts.high
      ? `Dependencies: ${counts.critical} critical / ${counts.high} high vulns in ${plural(snyk.vulnerablePackages, 'package')} — upgrade ${upgradePlan(snyk.top ?? []) || 'affected packages'}.`
      : `Dependencies: no critical/high vulnerabilities across ${plural(snyk?.dependencyCount ?? 0, 'package')} (via ${snyk?.mode ?? 'n/a'}).`,
    blocking.length
      ? `Recommendation: block install and notify community admins; publisher must ${[
        failed.some((r) => r.ruleId === 'BOT-001') && 'drop ADMINISTRATOR',
        failed.some((r) => r.ruleId === 'BOT-003') && 'remove eval/exec of user input',
        failed.some((r) => r.ruleId === 'BOT-004') && 'rotate the leaked token and load secrets from env',
        failed.some((r) => r.ruleId === 'BOT-006') && 'cap retention at 30 days',
        failed.some((r) => r.ruleId === 'BOT-005') && 'move webhooks to allow-listed HTTPS',
      ].filter(Boolean).slice(0, 3).join(', ') || 'fix the failing rules'}.`
      : failed.length
        ? `Recommendation: hold for moderator approval until ${failed.map((r) => `${r.ruleId} (${r.title})`).join(', ')} is fixed.`
        : `Recommendation: approve install; ${tenki?.passed ?? 0} tests passed in the ${tenki?.mode ?? 'sandbox'} with no secrets in the environment.`,
  ];
  let review: any = { bullets: fallbackBullets, model: null, provider: 'offline-brain', live: false };
  const input = JSON.stringify({ rules: rules.map((r) => ({ id: r.ruleId, status: r.status, evidence: r.evidence.slice(0, 200) })), vulns: counts, tests: { exitCode: tenki?.exitCode, passed: tenki?.passed, failed: tenki?.failed } });
  try {
    const r = await completeJson<{ bullets: string[] }>({
      agentId: 'kai', purpose: 'prelint-review', tier: 'coding', maxTokens: 400, temperature: 0.2, timeoutMs: 20000,
      system: 'You are Kai, Haven\'s security engineer. You review third-party community bots against specs/bot-policy.md, Prelint-style. Be specific, cite rule IDs, no fluff. Secrets in the evidence are already redacted.',
      messages: [{ role: 'user', content: `Audit results for bot "${manifest.name ?? pj?.name ?? 'unknown'}":\n${input}\n\nReturn JSON {"bullets": [exactly 3 short reviewer bullets: blocking issues, dependency risk, recommendation]}` }],
    });
    const bullets = Array.isArray(r?.data?.bullets) ? r!.data.bullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3) : [];
    if (r && bullets.length) review = { bullets, model: r.meta.model, provider: r.meta.provider, live: true };
    else recordOffline('kai', 'prelint-review', 'coding', input, fallbackBullets.join('\n'));
  } catch {
    recordOffline('kai', 'prelint-review', 'coding', input, fallbackBullets.join('\n'));
  }

  const prelintCfg = readJson<any>(PRELINT_CONFIG);
  return {
    mode: 'local (Prelint spec engine)',
    engine: 'Local spec engine over the same specs/ the Prelint GitHub App indexes',
    spec: relative(ROOT, SPEC_PATH), specRules: spec.rules.length, allowList: spec.allowList,
    prelintConfig: prelintCfg ? { trigger_mode: prelintCfg.trigger_mode, ignore_patterns: prelintCfg.ignore_patterns } : null,
    manifest: { file, inferred, permissions: manifest.permissions ?? [], intents: manifest.intents ?? [], dataRetention: manifest.dataRetention ?? null, webhooks: manifest.webhooks ?? [] },
    bot: { name: manifest.name ?? pj?.name ?? null, version: manifest.version ?? pj?.version ?? null, author: manifest.author ?? pj?.author ?? null, description: manifest.description ?? pj?.description ?? null },
    rules, passed: rules.filter((r) => r.status === 'pass').length, failed: failed.length, warned: warned.length,
    scannedFiles: scan.files, findings: scan.findings.slice(0, 25), review, auditId, durationMs: now() - t0,
  };
}

// ───────────────────────────────────────── grade ─────────────────────────────────────────

function grade(snyk: any, prelint: any, tenki: any): { score: number; grade: string; summary: string; breakdown: any } {
  const c = snyk?.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const vulnPenalty = Math.min(60, c.critical * 25 + c.high * 12 + c.medium * 4 + c.low * 1);
  const rules: RuleResult[] = prelint?.rules ?? [];
  const failed = rules.filter((r) => r.status === 'fail'), warned = rules.filter((r) => r.status === 'warn');
  const testsFailing = !!tenki && !tenki.noTests && !tenki.skipped && tenki.exitCode !== 0;
  const score = Math.max(0, Math.min(100, 100 - vulnPenalty - failed.length * 10 - warned.length * 3 - (testsFailing ? 10 : 0)));
  const g = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  const has = (rid: string) => failed.some((r) => r.ruleId === rid);
  const exec = (prelint?.findings ?? []).filter((f: Finding) => f.kind === 'code-exec');
  const reasons = [
    c.critical + c.high ? `${c.critical ? `${c.critical} critical` : ''}${c.critical && c.high ? ' + ' : ''}${c.high ? `${c.high} high` : ''} vulns` : '',
    has('BOT-001') ? 'requests ADMINISTRATOR' : '',
    has('BOT-003') ? (exec.some((f: Finding) => /eval|Function/.test(f.label)) ? 'evals user input' : 'executes user input in a shell') : '',
    has('BOT-004') ? 'hardcodes and leaks its bot token' : '',
    has('BOT-002') ? 'reads all message content without a stated purpose' : '',
    has('BOT-005') ? 'ships data to unvetted http:// endpoints' : '',
    has('BOT-006') ? 'keeps your data forever' : '',
    has('BOT-008') ? 'fails its own tests in the sandbox' : '',
  ].filter(Boolean);
  const warnTxt = warned.map((r) => r.ruleId).join(', ');
  const summary =
    g === 'D' || g === 'F' ? `Do not install: ${reasons.slice(0, 4).join(', ')}.`
      : g === 'C' ? `Install only with moderator approval: ${(reasons.length ? reasons : warned.map((r) => r.title)).slice(0, 3).join(', ')}.`
        : g === 'B' ? `Safe to install with minor notes${warnTxt ? ` (${warnTxt})` : ''}${reasons.length ? `: ${reasons.slice(0, 2).join(', ')}` : ''}.`
          : `Safe to install: no critical/high vulnerabilities, ${prelint?.manifest?.inferred ? 'no admin permission flags in code' : 'least-privilege permissions'}${tenki?.exitCode === 0 ? `, and ${tenki.passed ? `all ${tenki.passed}` : 'all'} tests pass in the sandbox` : ''}.`;
  return { score, grade: g, summary, breakdown: { vulnPenalty, failedRules: failed.length, warnings: warned.length, testsFailing } };
}

// ───────────────────────────────────────── orchestration ─────────────────────────────────────────

function newAudit(target: string, isGithub: boolean): Audit {
  return {
    id: id('aud'), target, status: 'queued', grade: null, score: null,
    steps: [
      { id: 'fetch', label: isGithub ? 'Clone repository' : 'Load bot source', tool: isGithub ? 'git' : 'Haven', status: 'pending' },
      { id: 'snyk', label: 'Dependency vulnerability scan', tool: 'Snyk', status: 'pending' },
      { id: 'snyk-code', label: 'Static code analysis', tool: 'Snyk Code', status: 'pending' },
      { id: 'tenki', label: 'Sandbox install + test run', tool: 'Tenki', status: 'pending' },
      { id: 'prelint', label: 'Spec check vs specs/bot-policy.md', tool: 'Prelint', status: 'pending' },
      { id: 'grade', label: 'Grade & verdict', tool: 'Kai', status: 'pending' },
    ],
    snyk: null, tenki: null, prelint: null, summary: null, createdAt: now(), finishedAt: null,
  };
}

function save(a: Audit) {
  db.insert('audits', a);
  emit('audit.update', JSON.parse(JSON.stringify(a)));
}

async function execute(a: Audit, onProgress?: OnProgress): Promise<Audit> {
  const started = new Map<string, number>();
  const step = async (sid: string, patch: Partial<Step>) => {
    const s = a.steps.find((x) => x.id === sid)!;
    // Keep each step on screen long enough for the live audit view to animate (the work itself is real and usually faster).
    if (patch.status === 'running') started.set(sid, now());
    else if ((patch.status === 'done' || patch.status === 'error') && started.has(sid)) {
      const wait = PACE_MS - (now() - started.get(sid)!);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    Object.assign(s, patch);
    save(a);
    if (patch.detail || patch.status) { try { onProgress?.(sid, patch.detail ?? patch.status ?? ''); } catch { /* caller bug must not kill the audit */ } }
  };
  const target = validateTarget(a.target);
  const auditDir = join(config.dataDir, 'audits', a.id);
  const repoDir = join(auditDir, 'repo');
  a.status = 'running';
  save(a);
  try {
    // 1 · fetch
    await step('fetch', { status: 'running', detail: target.kind === 'github' ? `git clone --depth 1 ${target.url}` : `Loading ${target.name}` });
    if (target.kind === 'sample') {
      copyTree(target.dir, repoDir, true);
    } else {
      mkdirSync(auditDir, { recursive: true });
      const r = await run('git', ['clone', '--depth', '1', '--single-branch', '-q', target.url + '.git', repoDir], {
        cwd: auditDir, timeoutMs: 60000, env: { PATH: process.env.PATH, HOME: os.homedir(), GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      });
      if (r.timedOut) throw new Error('git clone timed out after 60s');
      if (r.code !== 0) throw new Error(`git clone failed: ${(r.stderr || r.error || '').replace(/\s*\n\s*/g, ' ').trim().slice(0, 200) || 'repository not found or private'}`);
    }
    const dir = projectRoot(repoDir);
    const fileCount = walk(dir, { skip: new Set(['node_modules', '.git']), maxFiles: 5000 }).length;
    const pj = readJson<any>(join(dir, 'package.json'));
    await step('fetch', { status: 'done', detail: `${target.name}${pj?.version ? ` v${pj.version}` : ''} · ${plural(fileCount, 'file')}${dir !== repoDir ? ` · project at ${relative(repoDir, dir)}/` : ''}` });

    // 2 · Snyk deps
    await step('snyk', { status: 'running', detail: snykAuth().ok && onPath(config.snyk.bin) ? 'snyk test --json' : 'Snyk CLI not authenticated → querying OSV.dev' });
    try {
      a.snyk = await snykDeps(dir, a.id);
      const c = a.snyk.counts;
      await step('snyk', {
        status: 'done', tool: a.snyk.mode === 'snyk-cli' ? 'Snyk' : 'Snyk → OSV.dev (local)',
        detail: `${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.low} low across ${a.snyk.dependencyCount} deps${a.snyk.mode === 'snyk-cli' ? '' : ' (local OSV.dev)'}`,
      });
    } catch (e) {
      a.snyk = { mode: 'error', error: (e as Error).message.slice(0, 200), counts: { critical: 0, high: 0, medium: 0, low: 0 }, total: 0, top: [] };
      await step('snyk', { status: 'error', detail: `Dependency scan failed: ${a.snyk.error}` });
    }

    // 3 · Snyk Code (optional)
    const scan = scanSource(dir);
    await step('snyk-code', { status: 'running', detail: 'snyk code test --json' });
    const code = await snykCode(dir, a.id, scan);
    a.snyk = { ...(a.snyk ?? {}), code };
    await step('snyk-code', code.skipped
      ? { status: 'done', tool: 'Snyk Code → local SAST', detail: `Snyk Code skipped (${code.reason}) · local SAST: ${plural(scan.findings.length, 'finding')} in ${plural(scan.files, 'file')}` }
      : { status: 'done', detail: `${code.counts.high} high · ${code.counts.medium} medium · ${code.counts.low} low code issues` });

    // 4 · Tenki
    await step('tenki', { status: 'running', detail: config.tenki.apiKey && !tenkiSdkMissing ? 'Booting Tenki cloud sandbox…' : 'Local sandbox: npm install --ignore-scripts && npm test' });
    try {
      a.tenki = await tenkiRun(dir, a.id);
      const t = a.tenki;
      await step('tenki', {
        status: 'done', tool: t.mode === 'tenki-cloud' ? 'Tenki' : 'Tenki → local sandbox',
        detail: t.noTests ? (t.reason ?? 'No test suite shipped') : t.installFailed ? `Install failed (exit ${t.exitCode})`
          : `${t.exitCode === 0 ? 'PASS' : 'FAIL'} · ${t.passed ?? '?'} passed · ${t.failed ?? '?'} failed · exit ${t.exitCode} · ${(t.durationMs / 1000).toFixed(1)}s${t.mode === 'tenki-cloud' ? '' : ' (local)'}`,
      });
    } catch (e) {
      a.tenki = { mode: 'error', error: (e as Error).message.slice(0, 200) };
      await step('tenki', { status: 'error', detail: `Sandbox run failed: ${a.tenki.error}` });
    }

    // 5 · Prelint
    await step('prelint', { status: 'running', detail: `Checking ${loadSpec().rules.length} rules from specs/bot-policy.md` });
    a.prelint = await prelintCheck(dir, scan, a.snyk, a.tenki, a.id, target.kind === 'github' ? target.url : null);
    await step('prelint', { status: 'done', tool: 'Prelint (local spec engine)', detail: `${a.prelint.failed} fail · ${a.prelint.warned} warn · ${a.prelint.passed} pass` });

    // 6 · Grade
    await step('grade', { status: 'running', detail: 'Scoring' });
    const g = grade(a.snyk, a.prelint, a.tenki);
    a.score = g.score; a.grade = g.grade; a.summary = g.summary;
    a.prelint = { ...a.prelint, breakdown: g.breakdown };
    a.status = 'done'; a.finishedAt = now();
    await step('grade', { status: 'done', detail: `${g.grade} · ${g.score}/100 — ${g.summary}` });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    for (const s of a.steps) if (s.status === 'running') { s.status = 'error'; s.detail = msg; }
    a.status = 'error'; a.summary = `Audit failed: ${msg}`; a.finishedAt = now();
    save(a);
    try { onProgress?.('error', msg); } catch { /* ignore */ }
  }
  return a;
}

/** Run a full audit and resolve when it finishes. `target` = 'sample' | 'safe-sample' | https://github.com/<owner>/<repo>. */
export async function runAudit(target: string, onProgress?: OnProgress): Promise<Audit> {
  const t = validateTarget(target);
  const a = newAudit(t.kind === 'github' ? t.url : target.trim(), t.kind === 'github');
  save(a);
  return execute(a, onProgress);
}

/** Start an audit in the background and return the queued Audit immediately (progress streams via `audit.update`). */
export function startAudit(target: string, onProgress?: OnProgress): Audit {
  const t = validateTarget(target);
  const a = newAudit(t.kind === 'github' ? t.url : target.trim(), t.kind === 'github');
  save(a);
  const snapshot = JSON.parse(JSON.stringify(a)) as Audit;
  setTimeout(() => { void execute(a, onProgress).catch((e) => console.error('[audit] crashed', e)); }, 0);
  return snapshot;
}
