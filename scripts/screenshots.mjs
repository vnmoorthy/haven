// Captures README screenshots from a running Haven (http://localhost:8787) after demo scenarios have run.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const B = process.env.HAVEN_URL ?? 'http://localhost:8787';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body = {}) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p) => fetch(B + p).then((r) => r.json());

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (path, name, wait = 2500, fn) => {
  await page.goto(B + path, { waitUntil: 'networkidle' });
  await sleep(wait);
  if (fn) await fn();
  await page.screenshot({ path: OUT + name });
  console.log('shot', name);
};

await post('/api/sim/toggle', { running: true });
await page.goto(B + '/', { waitUntil: 'networkidle' });
await sleep(1500);
await post('/api/sim/inject', { scenario: 'phishing' });
await sleep(2200);
await page.screenshot({ path: OUT + 'mission-control.png' });
console.log('shot mission-control.png');
await sleep(9000);
await post('/api/sim/inject', { scenario: 'crisis' });
await sleep(7000);
const incs = await get('/api/incidents');
const phish = incs.find((i) => i.kind === 'phishing' && i.status === 'awaiting_approval');
if (phish) await shot(`/incidents/${phish.id}`, 'incident-room.png', 3000);
await shot('/community', 'community.png', 2500, async () => {
  const bloom = page.getByTitle('Bloom Circle');
  if (await bloom.count()) await bloom.first().click();
  await sleep(500);
  const vent = page.getByText('vent', { exact: true });
  if (await vent.count()) await vent.first().click();
  await sleep(1200);
});
await post('/api/audits', { target: 'sample' });
for (let i = 0; i < 40; i++) { await sleep(2500); const a = (await get('/api/audits'))[0]; if (a?.status === 'done') break; }
await shot('/security', 'audit.png', 3000);
await shot('/ask', 'ask.png', 800, async () => {
  await page.getByPlaceholder(/Ask anything/i).fill('Which kind of incident is most common?');
  await page.keyboard.press('Enter');
  await sleep(3500);
});
await shot('/workforce', 'workforce.png', 2500);
await shot('/automations', 'pipelines.png', 2500);
await shot('/briefing', 'briefing.png', 2500);
await shot('/stack', 'stack.png', 3000);
await shot('/', 'mission-control-2.png', 2500);
await browser.close();
