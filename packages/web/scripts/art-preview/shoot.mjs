// node shoot.mjs <html> <out.png> [clipW clipH]
import puppeteer from 'puppeteer';
const [, , html, out, w, h] = process.argv;
const b = await puppeteer.launch({ headless: true, executablePath: '/opt/hermes/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('[pageerror]', e.message));
await p.setViewport({ width: 1280, height: 720 });
await p.goto('file://' + html);
await p.waitForFunction('window.done === true', { timeout: 15000 });
const dim = await p.evaluate(() => { const c = document.querySelector('canvas'); return { w: c.width, h: c.height }; });
await p.setViewport({ width: dim.w, height: dim.h });
await p.screenshot({ path: out, clip: { x: 0, y: 0, width: +w || dim.w, height: +h || dim.h } });
await b.close();
console.log('saved', out, dim);
