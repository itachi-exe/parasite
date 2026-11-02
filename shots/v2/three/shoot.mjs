// node shoot.mjs <url> <out.png> <w> <h>
import puppeteer from '/opt/hermes/projects/parasite-v2/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
const [, , url, out, w, h] = process.argv;
const b = await puppeteer.launch({
  headless: true,
  executablePath: '/opt/hermes/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.error('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
await p.setViewport({ width: +w, height: +h });
await p.goto(url);
await p.waitForFunction('window.done === true', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: out });
await b.close();
console.log('saved', out);
