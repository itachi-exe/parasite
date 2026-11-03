#!/usr/bin/env node
// Drive one human into a bot-filled round and screenshot the live map.
//   node scripts/shoot-game.mjs <url> <outDir> [--walk]
// Writes lobby.png, game.png (and walk.png after a short walk with --walk).
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const [, , url = 'http://127.0.0.1:9200/', out = 'shots', ...rest] = process.argv;
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME ?? '/opt/hermes/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const b = await puppeteer.launch({ headless: true, executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (text) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
  if (el) el.click();
  return !!el;
}, text);

await p.goto(url, { waitUntil: 'load', timeout: 120000 });
await sleep(4000);
await p.screenshot({ path: `${out}/menu.png` });
await click('Play');
await sleep(800);
await p.type('#lobby-name', 'Dr Vale');
await p.$eval('#lobby-code', (el) => el.focus());
await p.keyboard.type('SHOT' + Math.floor(Math.random() * 9999));
await click('Join outpost');
await sleep(2500);
await p.screenshot({ path: `${out}/lobby.png` });
console.log('start clicked:', await click('Begin'));
await sleep(6000);
// Dismiss any reveal overlay by clicking through buttons that look like continue.
await click('Continue'); await click('Got it'); await click('Close');
await sleep(1500);
await p.screenshot({ path: `${out}/game.png` });
if (rest.includes('--walk')) {
  for (const k of ['KeyA', 'KeyW']) { await p.keyboard.down(k); await sleep(1300); await p.keyboard.up(k); }
  await p.keyboard.down('KeyD'); await sleep(450);
  await p.screenshot({ path: `${out}/walk.png` });
  await p.keyboard.up('KeyD');
}
await b.close();
console.log('saved to', out);
