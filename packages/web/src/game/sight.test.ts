import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ThreeScene } from './three/ThreeScene';
import type { PublicPlayer } from '@parasite/shared';

import * as bridge from './bridge';

const player = (seat: number): PublicPlayer => ({
  id: `p${seat}`, seat, name: `P${seat}`, skin: 0, address: null,
  x: 800, y: 600, dir: 1, moving: false, alive: true, bodyReported: false,
  connected: true, isBot: false, tasksDone: 0, emergencyMeetingsLeft: 1,
});

test('renderer removes a hidden seat rather than resurrecting snapshot coordinates', () => {
  const people = new Map([0, 1].map((seat) => [seat, {
    key: 'human:1:0', x: 800, y: 600, facing: 'down',
    rig: { root: new THREE.Group(), update() {}, setFacing() {} },
    tag: { textContent: `P${seat}`, classList: { toggle() {} }, remove() {} },
  }]));
  const scene = {
    bridge: { players: [player(0), player(1)], mySeat: 0, isParasite: false,
      positions: new Map([[0, { x: 800, y: 600, dir: 1, moving: false }]]) },
    readInput: () => [0, 0], lastSent: { ax: 0, ay: 0, at: 0 }, people,
    scene: new THREE.Scene(), predict: (p: PublicPlayer) => p,
    syncBodies() {}, applySight() {}, updateStations() {}, updateCamera() {}, placeTags() {},
    outpost: { update() {} }, still: false,
  };
  ThreeScene.prototype.step.call(scene as unknown as ThreeScene, 0, 0.05);
  assert.deepEqual([...people.keys()], [0]);
});

test('both transport deliveries completely replace visible positions', () => {
  const positions = new Map([[1, { x: 800, y: 480, dir: 1 as const, moving: false }]]);
  assert.equal(typeof bridge.replacePositions, 'function', 'the fast channel needs replacement semantics');
  bridge.replacePositions(positions, { t: 1, p: [{ s: 0, x: 800, y: 600, d: 1, m: false }], b: [] });
  assert.deepEqual([...positions.keys()], [0]);
  bridge.replaceSnapshot(positions, { players: [player(0), { ...player(1), x: null, y: null }], bodies: [] });
  assert.deepEqual([...positions.keys()], [0]);
  bridge.replaceSnapshot(positions, { players: [], bodies: [] });
  assert.equal(positions.size, 0);
});

test('idle facing changes travel through the existing input bridge', () => {
  const sent: unknown[][] = [];
  const scene = {
    bridge: { players: [], positions: new Map(), onInput: (...args: unknown[]) => sent.push(args) },
    readInput: () => [0, 0], lastSent: { ax: 0, ay: 0, at: 0, look: Math.PI / 2 }, look: 0,
    people: new Map(), syncBodies() {}, applySight() {}, updateStations() {}, updateCamera() {}, placeTags() {},
    outpost: { update() {} }, still: false,
  };
  ThreeScene.prototype.step.call(scene as unknown as ThreeScene, 0, 0.05);
  assert.deepEqual(sent, [[0, 0, 1, 0]]);
});

test('corpse appearance keeps full roster metadata without granting a location', () => {
  const roster = [{ ...player(1), alive: false, x: null, y: null }];
  let received: PublicPlayer[] = [];
  const scene = {
    bridge: { players: roster, positions: new Map() }, readInput: () => [0, 0],
    lastSent: { ax: 0, ay: 0, at: 0 }, people: new Map(),
    syncBodies: (p: PublicPlayer[]) => { received = p; }, applySight() {}, updateStations() {}, updateCamera() {}, placeTags() {},
    outpost: { update() {} }, still: false,
  };
  ThreeScene.prototype.step.call(scene as unknown as ThreeScene, 0, 0.05);
  assert.deepEqual(received, roster);
});
