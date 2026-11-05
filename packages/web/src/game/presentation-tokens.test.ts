import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Configuration contract, not a substitute for computed-style/browser review.
test('the shared stylesheet uses the approved amber PBR identity and local Inter', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('--accent: #e9bc82'));
  assert.ok(css.includes("font-family: 'Inter'"));
  assert.ok(css.includes('/v2/fonts/inter-400.woff'));
  assert.ok(!css.includes('#4ad9f0'));
  assert.ok(css.includes('prefers-reduced-motion'));
});

test('the shared stylesheet keeps interaction tokens and visible active states', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  for (const token of ['--hit', '--inset', '--dur-fast', '--dur-mid', '--r-pill']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `${token} must be declared`);
  }
  assert.ok(css.includes('.task.active'), 'nearby tasks need a visible active state');
  assert.ok(css.includes('.mg-cell.hot'), 'the current minigame target needs a visible hot state');
});
