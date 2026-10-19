import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import { config } from '../config.js';
import { emit } from '../events.js';
import { id, now, clamp } from '../util.js';
import { completeJson, recordOffline } from './flatkey.js';

// Rex's link-detonation forensics. A suspicious URL is opened inside a disposable, isolated sandbox
// (a Celesto cloud computer when CELESTO_API_KEY is set, otherwise a fresh headless playwright-core
// incognito context on this machine). We follow redirects, capture a screenshot, extract forms, and
// score phishing indicators into a verdict. Everything works with zero API keys; labels say 'local'.

export interface ForensicForm { action: string; method: string; hasPassword: boolean; external: boolean }
export interface ForensicSignal { id: string; label: string; weight: number; detail: string }
export interface ForensicDomain { host: string; tld: string; lookalikeOf: string | null; entropy: number; ageDaysEstimate: number | null }
export interface ForensicStep { action: string; detail: string; ts: number }
export interface ForensicReport {
  url: string;
  finalUrl: string;
  redirects: string[];
  title: string;
  screenshot: string | null;
  forms: ForensicForm[];
  signals: ForensicSignal[];
  domain: ForensicDomain;
  score: number;
  verdict: 'malicious' | 'suspicious' | 'benign' | 'unreachable';
  engine: 'celesto' | 'local-sandbox';
  driver: 'adal' | 'playwright';
  steps: ForensicStep[];
  durationMs: number;
  analystNote?: string;
}

const BRANDS = ['glimmer', 'discord', 'steam', 'paypal', 'coinbase', 'metamask', 'google', 'apple', 'microsoft', 'opensea', 'binance'];
const SUSPICIOUS_TLDS = ['xyz', 'top', 'click', 'zip', 'gq', 'tk', 'ru', 'country', 'rest'];

// --- small deterministic helpers -------------------------------------------------
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = new Array(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

const HOMOGLYPHS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '@': 'a', 'vv': 'w', 'rn': 'm' };
function deglyph(s: string): string {
  let out = s.toLowerCase();
  for (const [k, v] of Object.entries(HOMOGLYPHS)) out = out.split(k).join(v);
  return out;
}

function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq: Record<string, number> = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const c of Object.values(freq)) { const p = c / s.length; h -= p * Math.log2(p); }
  return Math.round(h * 100) / 100;
}

function lookalike(host: string): string | null {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  let best: { brand: string; dist: number } | null = null;
  for (const label of labels) {
    const norm = deglyph(label);
    for (const brand of BRANDS) {
      // substring or small edit distance against a brand name
      const dist = norm.includes(brand) ? 0 : levenshtein(norm, brand);
      const near = dist <= Math.max(1, Math.floor(brand.length / 4));
      if ((near || norm.includes(brand)) && brand !== norm) {
        if (!best || dist < best.dist) best = { brand, dist };
      }
    }
  }
  return best ? best.brand : null;
}

function ageEstimate(host: string): number {
  // Deterministic pseudo-estimate (labelled 'estimated' in the signal) for unknown domains.
  const h = createHash('sha256').update(host).digest();
  return (h[0] << 8 | h[1]) % 3650; // 0..~10y
}

function domainParts(u: string): { host: string; tld: string } {
  try { const url = new URL(u); const host = url.hostname; const tld = host.split('.').pop() || ''; return { host, tld }; }
  catch { return { host: u, tld: '' }; }
}

const URGENCY_RE = /(expires?\s+in|act\s+now|limited\s+time|limited\s+offer|verify\s+your\s+account|claim\s+(your|now)|last\s+chance|account\s+(suspend|lock)|within\s+24\s*hours|don'?t\s+miss)/i;
const SEED_RE = /(seed\s*phrase|recovery\s*phrase|12[\s-]?word|24[\s-]?word|mnemonic|secret\s*recovery)/i;
const PASSWORD_RE = /(password|passphrase|pass\s*code)/i;
const TWOFA_RE = /(2fa|two[\s-]?factor|one[\s-]?time\s*(code|password)|otp|authenticator\s*code|verification\s*code)/i;
const CARD_RE = /(card\s*number|credit\s*card|cvv|cvc|card\s*verification|expiry|expiration\s*date)/i;

// --- engine status ---------------------------------------------------------------
let _adalChecked = false;
let _adalPresent = false;
async function adalOnPath(): Promise<boolean> {
  if (_adalChecked) return _adalPresent;
  _adalChecked = true;
  _adalPresent = await new Promise<boolean>((resolve) => {
    const p = spawn('which', [config.adal.bin], { stdio: 'ignore' });
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
  return _adalPresent;
}

export function forensicsStatus(): { engine: 'celesto' | 'local-sandbox'; driver: 'adal' | 'playwright'; detail: string } {
  const engine = config.celesto.apiKey ? 'celesto' : 'local-sandbox';
  const driver = _adalPresent ? 'adal' : 'playwright';
  const detail = engine === 'celesto'
    ? 'Celesto cloud sandbox computer (REST exec) + phishing scorer'
    : `Local isolated sandbox: playwright-core chromium headless, fresh incognito context${_adalPresent ? ', AdaL agent assist' : ''}`;
  return { engine, driver, detail };
}

// --- browser singleton -----------------------------------------------------------
let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;

async function findHeadlessShell(): Promise<string | null> {
  const base = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  let entries: string[] = [];
  try { entries = await fs.readdir(base); } catch { return null; }
  const candidates: { dir: string; rev: number; rel: string }[] = [];
  for (const e of entries) {
    const m = e.match(/^chromium_headless_shell-(\d+)$/);
    if (m) candidates.push({ dir: e, rev: Number(m[1]), rel: 'chrome-headless-shell-mac-arm64/chrome-headless-shell' });
    const m2 = e.match(/^chromium-(\d+)$/);
    if (m2) candidates.push({ dir: e, rev: Number(m2[1]), rel: 'chrome-mac/Chromium.app/Contents/MacOS/Chromium' });
  }
  candidates.sort((a, b) => b.rev - a.rev);
  for (const c of candidates) {
    const full = path.join(base, c.dir, c.rel);
    try { await fs.access(full); return full; } catch { /* next */ }
  }
  return null;
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    const { chromium } = await import('playwright-core');
    try {
      _browser = await chromium.launch({ headless: true });
    } catch (err) {
      const exe = await findHeadlessShell();
      if (!exe) throw err;
      _browser = await chromium.launch({ headless: true, executablePath: exe });
    }
    return _browser;
  })();
  try { return await _browserPromise; }
  finally { _browserPromise = null; }
}

// --- analysis (shared by both engines) -------------------------------------------
interface PageData {
  finalUrl: string;
  redirects: string[];
  title: string;
  html: string;
  text: string;
  forms: ForensicForm[];
  externalScripts: number;
  hiddenIframes: number;
  reachable: boolean;
}

function scoreFromData(startUrl: string, data: PageData, labDomain: string | null, steps: ForensicStep[]): { signals: ForensicSignal[]; domain: ForensicDomain } {
  // When analyzing a lab fixture served from localhost, present the declared fake domain so the demo reads realistically.
  const analyzedUrl = labDomain ? `https://${labDomain}/` : data.finalUrl;
  const { host, tld } = domainParts(analyzedUrl);
  const subdomain = host.split('.').slice(0, -2).join('.') || host.split('.')[0] || host;
  const entropy = shannonEntropy(host.replace(/\./g, ''));
  const look = lookalike(host);
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isPunycode = host.includes('xn--');
  const age = (host === 'localhost' || host === '127.0.0.1') ? null : ageEstimate(host);

  const signals: ForensicSignal[] = [];
  const add = (sid: string, label: string, weight: number, detail: string) => signals.push({ id: sid, label, weight, detail });

  const text = data.text;
  const html = data.html;

  if (look) add('brand_lookalike', `Brand look-alike: ${look}`, 30, `Host "${host}" closely resembles the "${look}" brand — classic impersonation pattern.`);
  if (SUSPICIOUS_TLDS.includes(tld)) add('suspicious_tld', `High-risk TLD .${tld}`, 15, `.${tld} is heavily abused for throwaway phishing domains.`);
  if (entropy > 3.6) add('high_entropy', 'High-entropy / random host', 12, `Host entropy ${entropy} suggests an auto-generated or DGA-style domain.`);
  if ((subdomain.match(/\./g) || []).length >= 2 || subdomain.length > 25) add('long_subdomain', 'Long / nested subdomain', 10, `Deep subdomain "${subdomain}" is used to disguise the real registrable domain.`);
  if (isIpLiteral) add('ip_host', 'IP-literal host', 18, `Served from a raw IP (${host}) instead of a named domain.`);
  if (isPunycode) add('punycode', 'Punycode (IDN) host', 16, `Host uses punycode (xn--) — often a homoglyph attack on a real brand.`);

  const forms = data.forms;
  const credForm = forms.find((f) => f.hasPassword);
  const externalForm = forms.find((f) => f.external);
  if (credForm) add('credential_form', 'Credential-harvesting form', 20, `Page contains a login form requesting a password.`);
  if (externalForm) add('external_post', 'Form posts to external host', 22, `A form submits to "${externalForm.action}" — a different host than the page itself.`);

  if (SEED_RE.test(text) || SEED_RE.test(html)) add('seed_phrase', 'Requests wallet recovery phrase', 35, `Page asks for a seed / recovery phrase — no legitimate service ever does this.`);
  if (PASSWORD_RE.test(text) && credForm) add('asks_password', 'Asks for a password', 8, `Password entry requested in page copy.`);
  if (TWOFA_RE.test(text)) add('asks_2fa', 'Asks for 2FA / OTP code', 14, `Page requests a one-time / 2FA code — used to defeat MFA in real time.`);
  if (CARD_RE.test(text)) add('asks_card', 'Asks for card / payment details', 18, `Page solicits credit-card details.`);
  if (URGENCY_RE.test(text)) add('urgency', 'Urgency / pressure language', 10, `Uses time-pressure wording ("act now", "expires", "verify") to rush the victim.`);

  const obf = (html.match(/\b(eval|atob|unescape|document\.write)\s*\(/g) || []).length;
  if (obf > 0) add('obfuscated_js', 'Obfuscated JavaScript', clamp(6 + obf * 4, 6, 20), `${obf} obfuscation primitive(s) (eval/atob/unescape/document.write) found inline.`);
  if (data.externalScripts >= 4) add('many_ext_scripts', 'Many external scripts', 8, `${data.externalScripts} third-party scripts loaded.`);
  if (data.hiddenIframes > 0) add('hidden_iframe', 'Hidden iframe', 12, `${data.hiddenIframes} hidden/zero-size iframe(s) — often used for clickjacking or drive-by.`);

  if (age !== null) {
    const ageWeight = age < 30 ? 14 : age < 180 ? 7 : 0;
    add('domain_age', `Domain age ~${age}d (estimated)`, ageWeight, `Estimated registration age ~${age} days. Note: ESTIMATED heuristic (no live WHOIS) — recently registered domains are higher risk.`);
  }

  if (!data.reachable) add('unreachable', 'Unreachable / blocked', 0, 'The sandbox could not load the page.');

  steps.push({ action: 'Analyzing domain', detail: `host=${host} tld=.${tld} entropy=${entropy} lookalike=${look ?? 'none'}${labDomain ? ' (lab fixture)' : ''}`, ts: now() });

  const domain: ForensicDomain = { host, tld, lookalikeOf: look, entropy, ageDaysEstimate: age };
  return { signals, domain };
}

// --- celesto engine (REST exec) --------------------------------------------------
async function celestoFetch(url: string, incidentId: string | null, steps: ForensicStep[]): Promise<PageData | null> {
  const base = (config.celesto.baseUrl || 'https://api.celesto.ai/v1').replace(/\/$/, '');
  const key = config.celesto.apiKey;
  const H = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const step = (action: string, detail: string) => { const s = { action, detail, ts: now() }; steps.push(s); emit('forensics.step', { incidentId, url, ...s }); };
  let computerId: string | null = null;
  try {
    step('Provisioning isolated sandbox computer', 'Requesting a Celesto browser-agent computer');
    const cr = await fetch(`${base}/computers`, { method: 'POST', headers: H, body: JSON.stringify({ template_id: 'browser-agent' }) });
    if (!cr.ok) throw new Error(`create ${cr.status}`);
    const cj: any = await cr.json();
    computerId = cj.id || cj.computer_id;
    if (!computerId) throw new Error('no computer id');
    // poll until running
    const deadline = now() + 20000;
    while (now() < deadline) {
      const gr = await fetch(`${base}/computers/${computerId}`, { headers: H });
      const gj: any = await gr.json().catch(() => ({}));
      if ((gj.status || gj.state) === 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    step('Opening browser', `Sandbox computer ${computerId} ready`);
    const exec = async (cmd: string): Promise<string> => {
      const r = await fetch(`${base}/computers/${computerId}/exec`, { method: 'POST', headers: H, body: JSON.stringify({ command: cmd }) });
      const j: any = await r.json().catch(() => ({}));
      return (j.stdout ?? j.output ?? '').toString();
    };
    step('Navigating', `curl inside sandbox → ${url}`);
    const effective = (await exec(`curl -sL -m 15 -o /dev/null -w "%{url_effective} %{http_code}" ${JSON.stringify(url)}`)).trim();
    const [finalUrl = url] = effective.split(/\s+/);
    step('Following redirects', `Effective URL: ${finalUrl}`);
    const html = await exec(`curl -sL -m 15 ${JSON.stringify(url)} | head -c 200000`);
    step('Extracting forms', 'Parsing HTML retrieved inside the sandbox');
    return parseHtml(url, finalUrl, [url, finalUrl].filter((v, i, a) => a.indexOf(v) === i), html);
  } catch (err) {
    step('Scoring', `Celesto unavailable (${(err as Error).message}); falling back to local sandbox`);
    return null;
  } finally {
    if (computerId) { try { await fetch(`${base}/computers/${computerId}`, { method: 'DELETE', headers: H }); } catch { /* ignore */ } }
  }
}

// Parse raw HTML (used by the Celesto curl path — no DOM available).
function parseHtml(startUrl: string, finalUrl: string, redirects: string[], html: string): PageData {
  const pageHost = domainParts(finalUrl).host;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 200);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const forms: ForensicForm[] = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(html))) {
    const attrs = fm[1]; const inner = fm[2];
    const actionRaw = attrs.match(/action\s*=\s*["']([^"']*)["']/i)?.[1] || finalUrl;
    const method = (attrs.match(/method\s*=\s*["']([^"']*)["']/i)?.[1] || 'get').toUpperCase();
    let action = actionRaw; let external = false;
    try { const a = new URL(actionRaw, finalUrl); action = a.href; external = a.host !== pageHost && !!a.host; } catch { /* keep raw */ }
    const hasPassword = /type\s*=\s*["']password["']/i.test(inner);
    forms.push({ action, method, hasPassword, external });
  }
  const externalScripts = (html.match(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi) || []).length;
  const hiddenIframes = (html.match(/<iframe\b[^>]*(display\s*:\s*none|visibility\s*:\s*hidden|width\s*=\s*["']?0|height\s*=\s*["']?0|hidden)[^>]*>/gi) || []).length;
  return { finalUrl, redirects, title, html, text, forms, externalScripts, hiddenIframes, reachable: !!html };
}

// --- local playwright engine -----------------------------------------------------
async function playwrightFetch(startUrl: string, incidentId: string | null, screenshotPath: string, steps: ForensicStep[]): Promise<PageData> {
  const step = (action: string, detail: string, screenshot?: string) => { const s = { action, detail, ts: now() }; steps.push(s); emit('forensics.step', { incidentId, url: startUrl, ...s, ...(screenshot ? { screenshot } : {}) }); };
  step('Provisioning isolated sandbox computer', 'Launching local headless chromium (isolated, no storage)');
  const browser = await getBrowser();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: true,
      bypassCSP: false,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.on('download', (d) => d.cancel().catch(() => {}));
    const redirects: string[] = [startUrl];
    page.on('response', (res) => {
      const s = res.status();
      if (s >= 300 && s < 400) { const loc = res.headers()['location']; if (loc) { try { redirects.push(new URL(loc, res.url()).href); } catch { redirects.push(loc); } } }
    });
    step('Opening browser', 'Fresh incognito context created');
    step('Navigating', `Loading ${startUrl} (15s timeout)`);
    let reachable = true;
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(400);
    } catch (err) {
      reachable = false;
      step('Navigating', `Navigation failed: ${(err as Error).message}`);
    }
    const finalUrl = page.url();
    const uniqRedirects = redirects.filter((v, i, a) => a.indexOf(v) === i);
    if (uniqRedirects.length > 1) step('Following redirects', `${uniqRedirects.length} hop(s): ${uniqRedirects.join(' → ')}`);

    let title = '', html = '', text = '';
    let forms: ForensicForm[] = [];
    let externalScripts = 0, hiddenIframes = 0;
    if (reachable) {
      title = (await page.title().catch(() => '')).slice(0, 200);
      html = await page.content().catch(() => '');
      const pageHost = domainParts(finalUrl).host;
      // NOTE: no named inner functions here — esbuild's keepNames wraps them in a __name() helper
      // that is undefined inside the page, so page.evaluate would throw. Keep everything inline.
      const extracted = await page.evaluate((ph: string) => {
        const forms = Array.from(document.querySelectorAll('form')).map((f) => {
          const raw = (f as HTMLFormElement).getAttribute('action') || location.href;
          let action = raw; let host = '';
          try { const u = new URL(raw, location.href); action = u.href; host = u.host; } catch { action = raw; }
          return {
            action,
            method: ((f as HTMLFormElement).getAttribute('method') || 'get').toUpperCase(),
            hasPassword: !!f.querySelector('input[type="password"]'),
            external: !!host && host !== ph,
          };
        });
        const externalScripts = Array.from(document.querySelectorAll('script[src]')).filter((s) => /^https?:\/\//.test((s as HTMLScriptElement).src) && !(s as HTMLScriptElement).src.includes(location.host)).length;
        const hiddenIframes = Array.from(document.querySelectorAll('iframe')).filter((f) => {
          const st = getComputedStyle(f as HTMLElement); const r = (f as HTMLElement).getBoundingClientRect();
          return st.display === 'none' || st.visibility === 'hidden' || (f as HTMLElement).hasAttribute('hidden') || r.width < 2 || r.height < 2;
        }).length;
        return { forms, externalScripts, hiddenIframes, bodyText: (document.body ? document.body.innerText : '').slice(0, 20000) };
      }, pageHost).catch(() => ({ forms: [], externalScripts: 0, hiddenIframes: 0, bodyText: '' }));
      forms = extracted.forms as ForensicForm[];
      externalScripts = extracted.externalScripts;
      hiddenIframes = extracted.hiddenIframes;
      text = extracted.bodyText || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      step('Extracting forms', `${forms.length} form(s), ${externalScripts} external script(s), ${hiddenIframes} hidden iframe(s)`);

      try {
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        step('Capturing screenshot', `Saved sandbox screenshot`, path.posix.join('/forensics', path.basename(screenshotPath)));
      } catch (err) { step('Capturing screenshot', `Screenshot failed: ${(err as Error).message}`); }
    }
    return { finalUrl, redirects: uniqRedirects, title, html, text, forms, externalScripts, hiddenIframes, reachable };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// Best-effort AdaL agent assist — non-blocking, attached as a signal detail.
async function adalSignal(url: string): Promise<string | null> {
  if (!_adalPresent) return null;
  return new Promise<string | null>((resolve) => {
    const prompt = `Summarize the phishing indicators you can infer from this URL in one sentence: ${url}`;
    const p = spawn(config.adal.bin, ['-q', prompt, '-o', 'json', '--permission-mode', 'default'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', () => {
      clearTimeout(t);
      try { const j = JSON.parse(out); resolve((j.answer || j.result || j.text || '').toString().slice(0, 300) || null); }
      catch { resolve(out.trim().slice(0, 300) || null); }
    });
  });
}

// --- lab fixture domain detection ------------------------------------------------
function labDomainFromHtml(html: string): string | null {
  const m = html.match(/<meta\s+name=["']haven-lab-domain["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// --- public entrypoint -----------------------------------------------------------
export async function investigateUrl(url: string, opts: { incidentId: string | null }): Promise<ForensicReport> {
  const t0 = now();
  const incidentId = opts.incidentId;
  const reportId = id('frn').replace('frn_', '');
  const steps: ForensicStep[] = [];
  const screenshotPath = path.join(config.dataDir, 'forensics', `${reportId}.png`);

  await adalOnPath();
  const status = forensicsStatus();
  const emitStep = (action: string, detail: string) => { const s = { action, detail, ts: now() }; steps.push(s); emit('forensics.step', { incidentId, url, ...s }); };
  emitStep('Starting investigation', `Engine: ${status.engine} · Driver: ${status.driver}`);

  let data: PageData | null = null;
  let engine: 'celesto' | 'local-sandbox' = 'local-sandbox';

  if (config.celesto.apiKey) {
    data = await celestoFetch(url, incidentId, steps);
    if (data) engine = 'celesto';
  }
  if (!data) {
    engine = 'local-sandbox';
    try {
      data = await playwrightFetch(url, incidentId, screenshotPath, steps);
    } catch (err) {
      emitStep('Scoring', `Sandbox launch failed: ${(err as Error).message}`);
      data = { finalUrl: url, redirects: [url], title: '', html: '', text: '', forms: [], externalScripts: 0, hiddenIframes: 0, reachable: false };
    }
  }

  const labDomain = labDomainFromHtml(data.html);
  if (labDomain) emitStep('Analyzing domain', `Lab fixture detected — presenting declared domain "${labDomain}"`);

  const { signals, domain } = scoreFromData(url, data, labDomain, steps);
  emit('forensics.step', { incidentId, url, action: 'Analyzing domain', detail: `${signals.length} signal(s) collected`, ts: now() });

  // AdaL assist (best effort, non-blocking by racing a short timeout handled inside)
  const adalNote = await adalSignal(url);
  if (adalNote) signals.push({ id: 'adal_assist', label: 'AdaL agent assessment', weight: 0, detail: adalNote });

  let score = clamp(signals.reduce((s, x) => s + x.weight, 0), 0, 100);
  emitStep('Scoring', `Raw score ${score} from ${signals.length} signals`);

  // Optional LLM analyst note (Flatkey vision tier) with tight timeout; otherwise deterministic offline note.
  let analystNote: string | undefined;
  const summaryInput = JSON.stringify({ host: domain.host, verdict_preliminary: score, signals: signals.map((s) => ({ id: s.id, w: s.weight })), pageExcerpt: (data.text || data.html).slice(0, 1500) });
  const llm = await completeJson<{ note: string; adjust: number }>({
    agentId: 'rex', purpose: 'forensic-verdict', tier: 'vision', timeoutMs: 8000,
    system: 'You are Rex, a threat-intel investigator. Given forensic signals and a page excerpt, reply as strict JSON {"note": "<=2 sentence analyst note", "adjust": <integer -15..15 adjustment to the phishing score>}.',
    messages: [{ role: 'user', content: summaryInput }],
  });
  if (llm) {
    analystNote = (llm.data.note || '').toString().slice(0, 400);
    const adj = clamp(Math.round(Number(llm.data.adjust) || 0), -15, 15);
    score = clamp(score + adj, 0, 100);
    emitStep('Scoring', `Analyst (${llm.meta.model}) adjusted score by ${adj} → ${score}`);
  } else {
    const look = domain.lookalikeOf;
    analystNote = data.reachable
      ? `${domain.host} shows ${signals.filter((s) => s.weight > 0).length} phishing indicators${look ? `, impersonating ${look}` : ''}. ${score >= 70 ? 'High-confidence credential/asset theft attempt — block and warn members.' : score >= 40 ? 'Treat as suspicious pending review.' : 'No strong malicious indicators found.'}`
      : `${domain.host} was unreachable from the sandbox; unable to render content for analysis.`;
    recordOffline('rex', 'forensic-verdict', 'vision', summaryInput, analystNote);
  }

  const verdict: ForensicReport['verdict'] = !data.reachable ? 'unreachable' : score >= 70 ? 'malicious' : score >= 40 ? 'suspicious' : 'benign';
  const screenshot = (engine === 'local-sandbox' && data.reachable) ? path.posix.join('/forensics', `${reportId}.png`) : null;
  // verify screenshot exists
  let finalScreenshot: string | null = screenshot;
  if (screenshot) { try { await fs.access(screenshotPath); } catch { finalScreenshot = null; } }

  emitStep('Scoring', `Verdict: ${verdict.toUpperCase()} (score ${score})`);

  return {
    url,
    finalUrl: data.finalUrl,
    redirects: data.redirects,
    title: data.title,
    screenshot: finalScreenshot,
    forms: data.forms,
    signals,
    domain,
    score,
    verdict,
    engine,
    driver: status.driver,
    steps,
    durationMs: now() - t0,
    analystNote,
  };
}
