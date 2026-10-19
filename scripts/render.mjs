// Renders an HTML file (or URL) to PNG with headless Chromium. Usage: node scripts/render.mjs <file|url> <out.png> [width] [height] [scale]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [src, out, w = '1600', h = '720', scale = '2'] = process.argv.slice(2);
const url = /^https?:/.test(src) ? src : pathToFileURL(resolve(src)).href;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await browser.close();
console.log('rendered', out);
