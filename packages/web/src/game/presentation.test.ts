import test from 'node:test';
import assert from 'node:assert/strict';

test('crew portraits retain every seat color and chest trim identity', async () => {
  const module = await import('./presentation').catch(() => null);
  assert.ok(module, 'Crew portrait mapping is not implemented');
  const paths = new Set<string>();
  for (let seat = 0; seat < 10; seat++) for (let skin = 0; skin < 4; skin++) {
    const imagePath: string = module.portraitPath(seat, skin);
    assert.equal(imagePath, `/v2/crew/${seat}-${skin}-human.webp`);
    paths.add(imagePath);
  }
  assert.equal(paths.size, 40);
});

test('alternate forms keep the same seat and trim rather than a shared old sprite', async () => {
  const { portraitPath } = await import('./presentation');
  for (const form of ['infected', 'parasite', 'fallen'] as const) {
    assert.equal(portraitPath(7, 3, form), `/v2/crew/7-3-${form}.webp`);
  }
});

test('malformed identity never escapes the presentation asset directory', async () => {
  const { portraitPath } = await import('./presentation');
  assert.equal(portraitPath(-1, 9), '/v2/crew/9-1-human.webp');
  assert.equal(portraitPath(NaN, Infinity), '/v2/crew/0-0-human.webp');
  assert.equal(portraitPath(2.5, 1.2), '/v2/crew/0-0-human.webp');
  assert.equal(portraitPath(1, 2, '../../private' as never), '/v2/crew/1-2-human.webp');
});
