#!/usr/bin/env node
// Self-verification screenshot tool for ASHE.
//
// Code that looks right in a diff can still render wrong — this project has
// hit that exact failure mode twice (a rendering bug that 114 protocol-level
// tests never caught, and a lighting pass that needed pixel sampling, not a
// source read, to confirm it actually landed). Use this after any visual or
// rendering change, against a server you already have running:
//
//   node scripts/visual-check.mjs <url> <output.png> [--wait=5000]
//
// Prints any console errors/pageerrors it sees, then screenshots. A clean
// run with a saved screenshot is not proof the change is right — actually
// look at the image (or sample specific pixels, see DECISIONS.md's GGD
// lighting-pass entry for an example of pixel-sampling a subtle effect) —
// but a run that never happens proves nothing at all.
// Uses full `puppeteer` (bundled Chromium), not `puppeteer-core` against the
// system's snap-packaged chromium. The snap build genuinely cannot launch as
// this project's `ashe` user or under systemd-run: its sandboxing requires a
// real login session (XDG_RUNTIME_DIR/logind), and `ashe` deliberately has
// none — no SSH, no session, that's part of its hardening. Confirmed by
// testing directly: `snap.chromium.chromium cgroup` errors under both
// `sudo -u ashe` and the actual `systemd-run --uid=ashe` shape ASHE runs
// under. A self-contained Chromium sidesteps the whole problem.
import puppeteer from 'puppeteer';

const [, , url, outPath, ...rest] = process.argv;
if (!url || !outPath) {
  console.error('usage: node scripts/visual-check.mjs <url> <output.png> [--wait=5000]');
  process.exit(1);
}
const waitArg = rest.find((a) => a.startsWith('--wait='));
const waitMs = waitArg ? Number(waitArg.split('=')[1]) : 2000;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 900, height: 700 },
});
const page = await browser.newPage();
let hadError = false;
page.on('pageerror', (err) => {
  hadError = true;
  console.error('[pageerror]', err.message);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[console.error]', msg.text());
});
page.on('response', (res) => {
  if (res.status() >= 400) console.error('[http', res.status() + ']', res.url());
});

await page.goto(url, { waitUntil: 'load', timeout: 20000 });
await new Promise((r) => setTimeout(r, waitMs));
await page.screenshot({ path: outPath });
await browser.close();

console.log(`Screenshot saved to ${outPath}${hadError ? ' (page errors were seen — check above)' : ''}`);
process.exit(hadError ? 1 : 0);
