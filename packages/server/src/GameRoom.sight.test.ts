import { describe, it, expect } from 'vitest';
import { GameRoom } from './GameRoom.js';

function room() {
  const r = new GameRoom({ code: 'SIGHT', roleMode: 'inco', contractAddress: '0xcontract', now: () => 1_000_000 });
  for (let i = 0; i < 4; i++) r.join(`p${i}`, `P${i}`, 0, null);
  r.phase = 'playing';
  r.players.get('p0')!.x = 800; r.players.get('p0')!.y = 600;
  r.players.get('p1')!.x = 800; r.players.get('p1')!.y = 480;
  r.bodies = [{ seat: 2, x: 800, y: 480 }];
  return r;
}

describe('authoritative sight policy', () => {
  it('an absent viewer cannot select a canonical positions payload', () => {
    const r = room();
    expect(r.positionsPayload(undefined as unknown as string).p).toEqual([]);
    expect(r.positionsPayload('unknown').b).toEqual([]);
    expect(r.stateFor('unknown').players.every((p) => p.x === null && p.y === null)).toBe(true);
  });

  it('gives colocated recipients their own cones and the shared feet pool', () => {
    const r = room();
    Object.assign(r.players.get('p1')!, { x: 800, y: 600 });
    Object.assign(r.players.get('p2')!, { x: 800, y: 700 });
    Object.assign(r.players.get('p3')!, { x: 800, y: 500 });
    r.setInput('p0', 0, 0, 0, 5);
    r.setInput('p1', 0, 0, 0, -5);
    expect(r.positionsPayload('p0').p.map((p) => p.s)).toEqual([0, 1, 2]);
    expect(r.positionsPayload('p1').p.map((p) => p.s)).toEqual([0, 1, 3]);
    r.players.get('p3')!.y = 560;
    expect(r.positionsPayload('p0').p.map((p) => p.s)).toContain(3);
    expect(r.stateFor('p0').players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it('walls and range still block sight', () => {
    const r = room();
    Object.assign(r.players.get('p0')!, { x: 950, y: 500 });
    r.setInput('p0', 0, 0, 1, 0);
    expect(r.canSeePoint('p0', 1070, 500)).toBe(false);
    expect(r.canSeePoint('p0', 1500, 500)).toBe(false);
  });

  it('holds validated vertical heading through invalid vectors and stops', () => {
    const r = room();
    r.setInput('p0', 0, 0, 0, -9);
    const heading = r.players.get('p0')!.look;
    expect(heading).toBe(-Math.PI / 2);
    for (const [fx, fy] of [[NaN, 1], [Infinity, 0], [0, 0], [0, NaN]]) {
      r.setInput('p0', 0, 0, fx, fy);
      expect(r.players.get('p0')!.look).toBe(heading);
    }
    r.setInput('p0', NaN, Infinity, 1, 0);
    expect(r.players.get('p0')!.x).toBe(800);
    expect(r.players.get('p0')!.look).toBe(heading);
    r.setInput('p0', 0, 0);
    expect(r.players.get('p0')!.look).toBe(heading);
  });

  it('dead own viewers get whole-map sight including their own position', () => {
    const r = room();
    r.players.get('p0')!.alive = false;
    const state = r.stateFor('p0');
    expect(state.bodies).toEqual(r.bodies);
    expect(state.players.every((p) => p.x !== null && p.y !== null)).toBe(true);
    expect(r.positionsPayload('p0').p.map((p) => p.s)).toEqual([0, 1, 2, 3]);
  });

  it('lobby, assigning, meeting and end keep the roster with deliberate coordinate policy', () => {
    const r = room();
    r.players.get('p2')!.alive = false;
    for (const phase of ['lobby', 'assigning', 'meeting', 'ended'] as const) {
      r.phase = phase;
      const state = r.stateFor('p0');
      expect(state.players).toHaveLength(4);
      expect(state.players.find((p) => p.seat === 1)!.x).toBe(800);
      expect(state.players.find((p) => p.seat === 2)!.x).toBe(phase === 'ended' ? Math.round(r.players.get('p2')!.x) : null);
      expect(r.stateFor('unknown').bodies).toEqual([]);
      expect(r.stateFor('unknown').players.every((p) => p.x === null && p.y === null)).toBe(true);
    }
    expect(r.toState().players.every((p) => p.x !== null)).toBe(true);
  });
});
