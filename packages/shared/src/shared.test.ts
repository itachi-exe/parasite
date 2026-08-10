import { describe, it, expect } from 'vitest';
import {
  tallyVotes,
  isWalkable,
  resolveMove,
  areaAt,
  LocalRoleOracle,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TASK_DEFS,
  TASK_STATIONS,
  SPAWN_CENTER,
  AREAS,
  type Seat,
} from './index.js';

describe('tallyVotes', () => {
  it('ejects the clear top-voted player', () => {
    const r = tallyVotes({ 0: 3, 1: 3, 2: 3, 3: 0 });
    expect(r.ejectedSeat).toBe(3);
    expect(r.tie).toBe(false);
  });

  it('ejects nobody on a tie between two players', () => {
    const r = tallyVotes({ 0: 2, 1: 2, 2: 0, 3: 0 });
    expect(r.ejectedSeat).toBeNull();
    expect(r.tie).toBe(true);
  });

  it('ejects nobody when skip wins outright', () => {
    const r = tallyVotes({ 0: 'skip', 1: 'skip', 2: 'skip', 3: 1 });
    expect(r.ejectedSeat).toBeNull();
    expect(r.tie).toBe(false);
  });

  it('treats a skip-vs-player tie as a tie, so nobody is ejected', () => {
    const r = tallyVotes({ 0: 'skip', 1: 'skip', 2: 3, 3: 3 });
    expect(r.ejectedSeat).toBeNull();
    expect(r.tie).toBe(true);
  });

  it('handles no votes at all', () => {
    const r = tallyVotes({});
    expect(r.ejectedSeat).toBeNull();
    expect(r.tie).toBe(false);
  });

  it('ejects on a single vote when it is the only one cast', () => {
    const r = tallyVotes({ 2: 4 });
    expect(r.ejectedSeat).toBe(4);
  });

  it('reports an accurate tally', () => {
    const r = tallyVotes({ 0: 1, 1: 1, 2: 'skip' });
    expect(r.tally['1']).toBe(2);
    expect(r.tally['skip']).toBe(1);
  });

  it('does not eject seat 0 spuriously (falsy-seat regression)', () => {
    // Seat 0 is falsy in JS; a `if (!winner)` bug would drop this ejection.
    const r = tallyVotes({ 1: 0, 2: 0, 3: 5 });
    expect(r.ejectedSeat).toBe(0);
    expect(r.tie).toBe(false);
  });
});

describe('map geometry', () => {
  it('spawn point is walkable', () => {
    expect(isWalkable(SPAWN_CENTER.x, SPAWN_CENTER.y)).toBe(true);
  });

  it('every task station is walkable and in its declared area', () => {
    for (const def of TASK_DEFS) {
      const st = TASK_STATIONS[def.id];
      expect(isWalkable(st.x, st.y), `${def.id} station walkable`).toBe(true);
      expect(areaAt(st.x, st.y), `${def.id} in area ${def.area}`).toBe(def.area);
    }
  });

  it('rejects points outside the outpost', () => {
    expect(isWalkable(-50, -50)).toBe(false);
    expect(isWalkable(5000, 5000)).toBe(false);
  });

  it('resolveMove blocks movement into the void but allows sliding', () => {
    // Deep inside the meeting platform, moving further right stays inside.
    const inside = resolveMove(700, 600, 720, 600);
    expect(inside).toEqual({ x: 720, y: 600 });

    // From a walkable tile, a move to an unwalkable spot must not be applied
    // verbatim on both axes.
    const blocked = resolveMove(700, 600, 700, -400);
    expect(isWalkable(blocked.x, blocked.y)).toBe(true);
  });

  it('never returns an unwalkable position from resolveMove', () => {
    // Sweep a grid of from/to pairs; the invariant must hold everywhere.
    for (let x = 0; x < 1600; x += 97) {
      for (let y = 0; y < 1200; y += 89) {
        if (!isWalkable(x, y)) continue;
        for (const [dx, dy] of [
          [40, 0],
          [-40, 0],
          [0, 40],
          [0, -40],
          [40, 40],
        ] as const) {
          const r = resolveMove(x, y, x + dx, y + dy);
          expect(isWalkable(r.x, r.y), `from ${x},${y} to ${x + dx},${y + dy}`).toBe(true);
        }
      }
    }
  });

  it('all five named areas exist exactly once', () => {
    const named = AREAS.filter((a) => a.id !== 'path').map((a) => a.id);
    expect(new Set(named).size).toBe(5);
    expect(named.length).toBe(5);
  });

  it('the whole outpost is connected — every area reachable from spawn', () => {
    // Flood fill on a coarse grid over the walkable union.
    const STEP = 10;
    const key = (x: number, y: number) => `${x},${y}`;
    const start = {
      x: Math.round(SPAWN_CENTER.x / STEP) * STEP,
      y: Math.round(SPAWN_CENTER.y / STEP) * STEP,
    };
    const seen = new Set<string>([key(start.x, start.y)]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const [dx, dy] of [
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ] as const) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!isWalkable(nx, ny)) continue;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    // Every task station must be inside the flood-filled region.
    for (const def of TASK_DEFS) {
      const st = TASK_STATIONS[def.id];
      const sx = Math.round(st.x / STEP) * STEP;
      const sy = Math.round(st.y / STEP) * STEP;
      expect(seen.has(key(sx, sy)), `${def.id} reachable from spawn`).toBe(true);
    }
  });
});

describe('task definitions', () => {
  it('has exactly the five spec-mandated task names', () => {
    expect(TASK_DEFS.map((t) => t.name)).toEqual([
      'Analyze Bio-Samples',
      'Repair Power Conduit',
      'Collect Plant Samples',
      'Calibrate Sensors',
      'Upload Research Data',
    ]);
  });

  it('spreads tasks across distinct areas', () => {
    const areas = new Set(TASK_DEFS.map((t) => t.area));
    expect(areas.size).toBe(5);
  });
});

describe('player bounds', () => {
  it('matches the spec: 4 to 10', () => {
    expect(MIN_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(10);
  });
});

describe('LocalRoleOracle', () => {
  const seats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ seat: i as Seat, address: null }));

  it('assigns exactly one parasite among the seats', async () => {
    const o = new LocalRoleOracle();
    const { gameId } = await o.startGame({ seats: seats(6) });
    const roles = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((s) => o.readMyRole({ gameId, mySeat: s }))
    );
    expect(roles.filter((r) => r.isParasite).length).toBe(1);
  });

  it('lets the parasite move hosts via jump', async () => {
    // Force seat 0 to be the parasite.
    const o = new LocalRoleOracle(() => 0);
    const { gameId } = await o.startGame({ seats: seats(4) });
    expect((await o.readMyRole({ gameId, mySeat: 0 })).isParasite).toBe(true);

    await o.jump({ gameId, callerSeat: 0, targetSeat: 2, decoy: false });

    expect((await o.readMyRole({ gameId, mySeat: 0 })).isParasite).toBe(false);
    expect((await o.readMyRole({ gameId, mySeat: 2 })).isParasite).toBe(true);
  });

  it('makes a non-parasite jump a silent no-op', async () => {
    const o = new LocalRoleOracle(() => 0); // parasite = seat 0
    const { gameId } = await o.startGame({ seats: seats(4) });

    // Seat 1 is NOT the parasite. This must not throw, and must not move
    // the host — the whole point of the select-based design.
    await expect(
      o.jump({ gameId, callerSeat: 1, targetSeat: 3, decoy: false })
    ).resolves.toBeUndefined();

    expect(await o.revealHostSeat({ gameId })).toBe(0);
    expect((await o.readMyRole({ gameId, mySeat: 3 })).isParasite).toBe(false);
  });

  it('treats decoy jumps identically to real ones', async () => {
    const o = new LocalRoleOracle(() => 0);
    const { gameId } = await o.startGame({ seats: seats(4) });
    // A decoy from a non-parasite: no-op.
    await o.jump({ gameId, callerSeat: 2, targetSeat: 3, decoy: true });
    expect(await o.revealHostSeat({ gameId })).toBe(0);
    // A "decoy"-flagged jump from the real parasite still works — the flag is
    // cover traffic metadata only and must not gate behaviour.
    await o.jump({ gameId, callerSeat: 0, targetSeat: 3, decoy: true });
    expect(await o.revealHostSeat({ gameId })).toBe(3);
  });

  it('ignores jumps to a seat that does not exist', async () => {
    const o = new LocalRoleOracle(() => 0);
    const { gameId } = await o.startGame({ seats: seats(4) });
    await o.jump({ gameId, callerSeat: 0, targetSeat: 99, decoy: false });
    expect(await o.revealHostSeat({ gameId })).toBe(0);
  });

  it('reveals only the single bit for revealIsHost', async () => {
    const o = new LocalRoleOracle(() => 0);
    const { gameId } = await o.startGame({ seats: seats(4) });
    expect(await o.revealIsHost({ gameId, seat: 0 })).toBe(true);
    expect(await o.revealIsHost({ gameId, seat: 1 })).toBe(false);
  });

  it('keeps separate games isolated', async () => {
    const o = new LocalRoleOracle(() => 0);
    const a = await o.startGame({ seats: seats(4) });
    const b = await o.startGame({ seats: seats(4) });
    await o.jump({ gameId: a.gameId, callerSeat: 0, targetSeat: 3, decoy: false });
    expect(await o.revealHostSeat({ gameId: a.gameId })).toBe(3);
    expect(await o.revealHostSeat({ gameId: b.gameId })).toBe(0);
  });

  it('throws on an unknown game id', async () => {
    const o = new LocalRoleOracle();
    await expect(o.revealHostSeat({ gameId: 'nope' })).rejects.toThrow();
  });
});
