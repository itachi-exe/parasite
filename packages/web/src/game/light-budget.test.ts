import test from 'node:test';
import assert from 'node:assert/strict';

test('live lighting keeps a fixed budget nearest the player as they move', async () => {
  const { limitNearbyLights } = await import('./three/lightBudget');
  const lights = [0, 10, 20, 30, 40, 50].map(x => ({ position: { x, z: 0 }, visible: true }));
  limitNearbyLights(lights, 0, 0, 4);
  assert.deepEqual(lights.map(l => l.visible), [true, true, true, true, false, false]);
  limitNearbyLights(lights, 50, 0, 4);
  assert.deepEqual(lights.map(l => l.visible), [false, false, true, true, true, true]);
  limitNearbyLights(lights, 50, 0, 0);
  assert.ok(lights.every(l => !l.visible));
});

test('small and empty rooms do not create nonexistent lights', async () => {
  const { limitNearbyLights } = await import('./three/lightBudget');
  const lights = [{ position: { x: 0, z: 0 }, visible: false }];
  limitNearbyLights(lights, 10, 5, 4);
  assert.equal(lights[0].visible, true);
  assert.doesNotThrow(() => limitNearbyLights([], 0, 0, 4));
});
