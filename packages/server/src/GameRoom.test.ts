import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameRoom } from './GameRoom.js';
import {
  LocalRoleOracle,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TASK_IDS,
  TASK_STATIONS,
  TASKS_PER_PLAYER,
  MEETING_DISCUSSION_MS,
  MEETING_VOTING_MS,
  MEETING_RESULT_MS,
  PURGE_RANGE,
  JUMP_RANGE,
  PLAYER_SPEED,
  SPAWN_CENTER,
  type TaskId,
} from '@parasite/shared';

/** Controllable clock so meeting timers are deterministic. */
function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function makeRoom(opts?: { simulated?: boolean; clock?: ReturnType<typeof makeClock>; rng?: () => number }) {
  const clock = opts?.clock ?? makeClock();
  const simulated = opts?.simulated ?? true;
  return new GameRoom({
    code: 'TEST',
    roleMode: simulated ? 'simulated' : 'inco',
    contractAddress: simulated ? null : '0xcontract',
    localOracle: simulated ? new LocalRoleOracle(opts?.rng ?? (() => 0)) : undefined,
    now: clock.now,
  });
}

function fill(room: GameRoom, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    const { result } = room.join(id, `P${i}`, 0, `0x${(i + 1).toString(16).padStart(40, '0')}`);
    if (result.ok) ids.push(id);
  }
  return ids;
}

describe('GameRoom — lobby constraints (spec: enforced server-side)', () => {
  it('caps the lobby at 10 players', () => {
    const room = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      expect(room.join(`p${i}`, `P${i}`, 0, null).result.ok).toBe(true);
    }
    const overflow = room.join('extra', 'Extra', 0, null);
    expect(overflow.result.ok).toBe(false);
    expect(overflow.result.error).toMatch(/full/i);
    expect(room.players.size).toBe(MAX_PLAYERS);
  });

  it('refuses to start below 4 players', async () => {
    const room = makeRoom();
    fill(room, MIN_PLAYERS - 1);
    const res = await room.startGame('p0');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least 4/i);
    expect(room.phase).toBe('lobby');
  });

  it('starts at exactly 4 players', async () => {
    const room = makeRoom();
    fill(room, MIN_PLAYERS);
    const res = await room.startGame('p0');
    expect(res.ok).toBe(true);
    expect(room.phase).toBe('playing');
  });

  it('blocks joining once the game has started (no mid-game join)', async () => {
    const room = makeRoom();
    fill(room, 4);
    await room.startGame('p0');

    const late = room.join('latecomer', 'Late', 0, null);
    expect(late.result.ok).toBe(false);
    expect(late.result.error).toMatch(/lobby/i);
    expect(room.players.size).toBe(4);
  });

  it('blocks joining during a meeting and after the game ends', async () => {
    const room = makeRoom();
    fill(room, 4);
    await room.startGame('p0');
    room.callMeeting('p0');
    expect(room.join('x', 'X', 0, null).result.ok).toBe(false);

    room.endGame('crew', 'crew-tasks');
    expect(room.join('y', 'Y', 0, null).result.ok).toBe(false);
  });

  it('only the lobby host can start', async () => {
    const room = makeRoom();
    fill(room, 5);
    const res = await room.startGame('p3');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/host/i);
  });

  it('frees the slot when a player leaves the LOBBY', () => {
    const room = makeRoom();
    fill(room, MAX_PLAYERS);
    room.disconnect('p0');
    expect(room.players.size).toBe(MAX_PLAYERS - 1);
    expect(room.join('newcomer', 'New', 0, null).result.ok).toBe(true);
  });

  it('keeps the seat when a player drops MID-GAME (no mid-game leave)', async () => {
    const room = makeRoom();
    fill(room, 5);
    await room.startGame('p0');
    room.disconnect('p2');

    expect(room.players.size).toBe(5);
    expect(room.bySeat(2)?.connected).toBe(false);
    // The seat is still theirs, and still alive — the contract committed to it.
    expect(room.bySeat(2)?.alive).toBe(true);
  });

  it('re-packs seats densely in the lobby so the contract gets 0..n-1', () => {
    const room = makeRoom();
    fill(room, 5);
    room.disconnect('p2');
    const seats = [...room.players.values()].map((p) => p.seat).sort((a, b) => a - b);
    expect(seats).toEqual([0, 1, 2, 3]);
  });

  it('keeps human seats equal to contract roster indices as bots step aside', () => {
    const room = makeRoom({ simulated: false });
    for (let i = 0; i < MIN_PLAYERS; i++) {
      const address = `0x${(i + 1).toString(16).padStart(40, '0')}`;
      expect(room.join(`p${i}`, `P${i}`, 0, address).result.ok).toBe(true);
      room.syncBots();
    }
    const roster = [...room.players.values()]
      .filter((p) => !p.isBot)
      .sort((a, b) => a.seat - b.seat);
    expect(roster.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(room.botSeats()).toHaveLength(0);
  });

  it('rejects an Inco start while bots occupy contract seats', async () => {
    const room = makeRoom({ simulated: false });
    room.join('p0', 'P0', 0, '0x0000000000000000000000000000000000000001');
    room.syncBots();
    const res = await room.startGame('p0');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/real players/i);
    expect(room.phase).toBe('lobby');
  });

  it.each([null, '0xaddr3', `0x${'0'.repeat(40)}`, 7])(
    'rejects an Inco start with an invalid wallet (%s)',
    async (address) => {
      const room = makeRoom({ simulated: false });
      fill(room, MIN_PLAYERS - 1);
      room.join('p3', 'P3', 0, address as string | null);
      const res = await room.startGame('p0');
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/valid wallet/i);
      expect(room.phase).toBe('lobby');
    }
  );

  it('rejects duplicate Inco wallets regardless of address case', async () => {
    const room = makeRoom({ simulated: false });
    fill(room, MIN_PLAYERS);
    room.players.get('p0')!.address = `0x${'aB'.repeat(20)}`;
    room.players.get('p3')!.address = `0x${'Ab'.repeat(20)}`;
    const res = await room.startGame('p0');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/different wallet/i);
    expect(room.phase).toBe('lobby');
  });

  it('passes lobby ownership to a human instead of a filler bot', () => {
    const room = makeRoom();
    for (let i = 0; i < 2; i++) {
      room.join(`p${i}`, `P${i}`, 0);
      room.syncBots();
    }
    room.disconnect('p0');
    room.syncBots();
    expect(room.hostId).toBe('p1');
  });

  it('reassigns the lobby host if the host leaves', () => {
    const room = makeRoom();
    fill(room, 4);
    expect(room.hostId).toBe('p0');
    room.disconnect('p0');
    expect(room.hostId).not.toBe('p0');
    expect(room.hostId).toBeTruthy();
  });
});

describe('GameRoom — movement', () => {
  it('moves a player and never leaves the walkable region', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 4);
    await room.startGame('p0');

    const p = room.bySeat(0)!;
    const startX = p.x;
    room.setInput('p0', 1, 0);
    clock.advance(100);
    room.tick();

    expect(p.x).not.toBe(startX);
    expect(p.dir).toBe(1);
  });

  it('normalizes diagonal input so it is not faster', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 4);
    await room.startGame('p0');

    const p = room.bySeat(0)!;
    p.x = SPAWN_CENTER.x;
    p.y = SPAWN_CENTER.y;
    room.setInput('p0', 1, 1);
    clock.advance(1000);
    room.tick();

    const moved = Math.hypot(p.x - SPAWN_CENTER.x, p.y - SPAWN_CENTER.y);
    // Should be ~PLAYER_SPEED, not PLAYER_SPEED * sqrt(2).
    expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * 1.05);
  });

  it('ignores input from dead players', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 4);
    await room.startGame('p0');

    const p = room.bySeat(0)!;
    p.alive = false;
    const { x, y } = p;
    room.setInput('p0', 1, 1);
    clock.advance(500);
    room.tick();
    expect(p.x).toBe(x);
    expect(p.y).toBe(y);
  });

  it('does not move players during a meeting', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 4);
    await room.startGame('p0');
    room.callMeeting('p0');

    const p = room.bySeat(1)!;
    const { x, y } = p;
    room.setInput('p1', 1, 0);
    clock.advance(200);
    room.tick();
    expect(p.x).toBe(x);
    expect(p.y).toBe(y);
  });
});

describe('GameRoom — tasks', () => {
  async function playing(n = 4) {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, n);
    await room.startGame('p0');
    return { room, clock };
  }

  function standAt(room: GameRoom, id: string, taskId: TaskId) {
    const p = room.players.get(id)!;
    const st = TASK_STATIONS[taskId];
    p.x = st.x;
    p.y = st.y;
  }

  it('completes a task when standing at the station', async () => {
    const { room } = await playing();
    const taskId = TASK_IDS[0]!;
    standAt(room, 'p0', taskId);
    const { result } = room.completeTask('p0', taskId);
    expect(result.ok).toBe(true);
    expect(room.bySeat(0)!.tasksDone).toBe(1);
  });

  it('rejects a task claimed from across the map', async () => {
    const { room } = await playing();
    const taskId = TASK_IDS[0]!;
    const p = room.players.get('p0')!;
    p.x = 800;
    p.y = 600;
    const { result } = room.completeTask('p0', taskId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too far/i);
  });

  it('rejects duplicate completion', async () => {
    const { room } = await playing();
    const taskId = TASK_IDS[0]!;
    standAt(room, 'p0', taskId);
    room.completeTask('p0', taskId);
    const second = room.completeTask('p0', taskId);
    expect(second.result.ok).toBe(false);
  });

  it('rejects unknown task ids', async () => {
    const { room } = await playing();
    const { result } = room.completeTask('p0', 'not-a-task' as TaskId);
    expect(result.ok).toBe(false);
  });

  it('excludes one player from the task total (the Parasite never submits)', async () => {
    const { room } = await playing(5);
    expect(room.taskTotal()).toBe(4 * TASKS_PER_PLAYER);
  });

  it('crew wins when all required tasks are done', async () => {
    const { room } = await playing(4);
    // 3 crew * 5 tasks = 15 required.
    let ended = false;
    outer: for (const id of ['p0', 'p1', 'p2']) {
      for (const taskId of TASK_IDS) {
        standAt(room, id, taskId);
        const { emits } = room.completeTask(id, taskId);
        if (emits.some((e) => e.type === 'gameEnded')) {
          ended = true;
          break outer;
        }
      }
    }
    expect(ended).toBe(true);
    expect(room.end?.winner).toBe('crew');
    expect(room.end?.reason).toBe('crew-tasks');
  });
});

describe('GameRoom — purge and win conditions', () => {
  async function playing(n = 5) {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, n);
    await room.startGame('p0');
    return { room, clock };
  }

  function adjacent(room: GameRoom, a: string, b: string) {
    const pa = room.players.get(a)!;
    const pb = room.players.get(b)!;
    pb.x = pa.x + PURGE_RANGE / 2;
    pb.y = pa.y;
  }

  it('kills an adjacent player and leaves a body', async () => {
    const { room } = await playing();
    adjacent(room, 'p0', 'p1');
    const { result, emits } = room.purge('p0', 1);
    expect(result.ok).toBe(true);
    expect(room.bySeat(1)!.alive).toBe(false);
    expect(room.bodies).toHaveLength(1);
    expect(emits.some((e) => e.type === 'playerPurged')).toBe(true);
  });

  it('rejects an out-of-range purge', async () => {
    const { room } = await playing();
    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x + PURGE_RANGE * 3;
    const { result } = room.purge('p0', 1);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/range/i);
  });

  it('rejects self-purge and purging the dead', async () => {
    const { room } = await playing();
    expect(room.purge('p0', 0).result.ok).toBe(false);
    adjacent(room, 'p0', 'p1');
    room.purge('p0', 1);
    // Cooldown aside, the victim is already dead.
    expect(room.purge('p0', 1).result.ok).toBe(false);
  });

  it('enforces the purge cooldown', async () => {
    const { room, clock } = await playing(6);
    adjacent(room, 'p0', 'p1');
    expect(room.purge('p0', 1).result.ok).toBe(true);
    adjacent(room, 'p0', 'p2');
    const second = room.purge('p0', 2);
    expect(second.result.ok).toBe(false);
    expect(second.result.error).toMatch(/recharg/i);

    clock.advance(30_000);
    expect(room.purge('p0', 2).result.ok).toBe(true);
  });

  it('parasite wins when only two players remain', async () => {
    const { room, clock } = await playing(4);
    adjacent(room, 'p0', 'p1');
    room.purge('p0', 1);
    clock.advance(30_000);
    adjacent(room, 'p0', 'p2');
    const { emits } = room.purge('p0', 2);

    expect(emits.some((e) => e.type === 'gameEnded')).toBe(true);
    expect(room.end?.winner).toBe('parasite');
    expect(room.end?.reason).toBe('parasite-outnumber');
  });

  it('rejects purges during a meeting', async () => {
    const { room } = await playing();
    room.callMeeting('p0');
    adjacent(room, 'p0', 'p1');
    expect(room.purge('p0', 1).result.ok).toBe(false);
  });
});

describe('GameRoom — jump announce (public side only)', () => {
  async function playing(n = 5) {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, n);
    await room.startGame('p0');
    return { room, clock };
  }

  it('accepts an in-range announce from ANY player, parasite or not', async () => {
    const { room } = await playing();
    // The room does not know who the parasite is; both must be accepted
    // identically, or the response itself becomes a side channel.
    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x + JUMP_RANGE / 2;
    pb.y = pa.y;
    expect((await room.jumpAnnounce('p0', 1)).ok).toBe(true);

    const pc = room.players.get('p2')!;
    const pd = room.players.get('p3')!;
    pd.x = pc.x + JUMP_RANGE / 2;
    pd.y = pc.y;
    expect((await room.jumpAnnounce('p2', 3)).ok).toBe(true);
  });

  it('rejects out-of-range announces', async () => {
    const { room } = await playing();
    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x + JUMP_RANGE * 4;
    pb.y = pa.y;
    expect((await room.jumpAnnounce('p0', 1)).ok).toBe(false);
  });

  it('enforces the jump cooldown', async () => {
    const { room, clock } = await playing();
    const pa = room.players.get('p0')!;
    for (const id of ['p1', 'p2']) {
      const t = room.players.get(id)!;
      t.x = pa.x + JUMP_RANGE / 2;
      t.y = pa.y;
    }
    expect((await room.jumpAnnounce('p0', 1)).ok).toBe(true);
    expect((await room.jumpAnnounce('p0', 2)).ok).toBe(false);
    clock.advance(25_000);
    expect((await room.jumpAnnounce('p0', 2)).ok).toBe(true);
  });

  it('rejects jumping to self or to a corpse', async () => {
    const { room } = await playing();
    expect((await room.jumpAnnounce('p0', 0)).ok).toBe(false);
    room.bySeat(1)!.alive = false;
    expect((await room.jumpAnnounce('p0', 1)).ok).toBe(false);
  });

  it('a REAL jump (called by the current host) actually transfers hostSeat in simulated mode', async () => {
    const { room } = await playing();
    // makeRoom's deterministic RNG (rng => 0) always seats the parasite at 0.
    expect(await room.readRoleForSeat(0)).toBe(true);
    expect(await room.readRoleForSeat(1)).toBe(false);

    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x + JUMP_RANGE / 2;
    pb.y = pa.y;
    expect((await room.jumpAnnounce('p0', 1)).ok).toBe(true);

    expect(await room.readRoleForSeat(0)).toBe(false);
    expect(await room.readRoleForSeat(1)).toBe(true);
  });

  it('a DECOY jump (called by a non-host) is a no-op on hostSeat in simulated mode', async () => {
    const { room } = await playing();
    const pb = room.players.get('p1')!;
    const pc = room.players.get('p2')!;
    pc.x = pb.x + JUMP_RANGE / 2;
    pc.y = pb.y;
    // p1 is not the host (seat 0 is), so this call must be accepted (same
    // public answer as a real jump) but change nothing about who is host.
    expect((await room.jumpAnnounce('p1', 2)).ok).toBe(true);

    expect(await room.readRoleForSeat(0)).toBe(true);
    expect(await room.readRoleForSeat(2)).toBe(false);
  });
});

describe('GameRoom — meetings and voting', () => {
  async function meeting(n = 5) {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, n);
    await room.startGame('p0');
    room.callMeeting('p0');
    return { room, clock };
  }

  /**
   * Walk a meeting through discussion → voting → result → playing.
   *
   * Each stage transition re-bases `endsAt` from the time of the tick that
   * caused it, so the clock has to be advanced once PER STAGE. Advancing past
   * all three durations up front and then ticking three times does not work —
   * the second stage's deadline lands in the future.
   */
  function finishMeeting(room: GameRoom, clock: ReturnType<typeof makeClock>) {
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick(); // discussion → voting
    clock.advance(MEETING_VOTING_MS + 1);
    room.tick(); // voting → result (tally)
    clock.advance(MEETING_RESULT_MS + 1);
    room.tick(); // result → playing
  }

  it('starts in discussion and opens voting after the timer', async () => {
    const { room, clock } = await meeting();
    expect(room.meeting?.stage).toBe('discussion');
    expect(room.castVote('p1', 2).ok).toBe(false);

    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();
    expect(room.meeting?.stage).toBe('voting');
    expect(room.castVote('p1', 2).ok).toBe(true);
  });

  it('limits emergency meetings per player', async () => {
    const { room, clock } = await meeting();
    finishMeeting(room, clock);
    expect(room.phase).toBe('playing');

    const second = room.callMeeting('p0');
    expect(second.result.ok).toBe(false);
    expect(second.result.error).toMatch(/no emergency meetings/i);
  });

  it('rejects double voting and votes from the dead', async () => {
    const { room, clock } = await meeting();
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();

    expect(room.castVote('p1', 2).ok).toBe(true);
    expect(room.castVote('p1', 3).ok).toBe(false);

    room.bySeat(4)!.alive = false;
    expect(room.castVote('p4', 2).ok).toBe(false);
  });

  it('ejects the top-voted player and marks them dead', async () => {
    const { room, clock } = await meeting(5);
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();

    room.castVote('p0', 3);
    room.castVote('p1', 3);
    room.castVote('p2', 3);
    room.castVote('p3', 0);
    room.castVote('p4', 'skip');

    room.tick(); // all votes in → immediate tally
    expect(room.meeting?.stage).toBe('result');
    expect(room.meeting?.result?.ejectedSeat).toBe(3);
    expect(room.bySeat(3)!.alive).toBe(false);
  });

  it('ejects nobody on a tie', async () => {
    const { room, clock } = await meeting(4);
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();

    room.castVote('p0', 2);
    room.castVote('p1', 2);
    room.castVote('p2', 1);
    room.castVote('p3', 1);
    room.tick();

    expect(room.meeting?.result?.tie).toBe(true);
    expect(room.meeting?.result?.ejectedSeat).toBeNull();
    expect(room.bySeat(1)!.alive).toBe(true);
    expect(room.bySeat(2)!.alive).toBe(true);
  });

  it('auto-skips a disconnected player so the vote can resolve', async () => {
    const { room, clock } = await meeting(4);
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();

    room.castVote('p0', 2);
    room.castVote('p1', 2);
    room.castVote('p2', 'skip');
    room.disconnect('p3'); // auto-skips: the tally now includes skip

    room.tick();
    expect(room.meeting?.stage).toBe('result');
    // 2 for seat 2 vs 2 skips (p2 + disconnected p3) → tie, no ejection.
    expect(room.meeting?.result?.tie).toBe(true);
    expect(room.meeting?.result?.ejectedSeat).toBeNull();
  });

  it('a disconnect does not stall the vote — it resolves without that player', async () => {
    const { room, clock } = await meeting(5);
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();

    room.castVote('p0', 2);
    room.castVote('p1', 2);
    room.castVote('p2', 2);
    room.castVote('p4', 'skip');
    room.disconnect('p3'); // auto-skip completes the roll call

    // Resolves on this tick rather than waiting out the full voting timer.
    room.tick();
    expect(room.meeting?.stage).toBe('result');
    expect(room.meeting?.result?.ejectedSeat).toBe(2);
  });

  it('returns to playing after the result stage', async () => {
    const { room, clock } = await meeting(5);
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();
    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) room.castVote(id, 'skip');
    room.tick();
    expect(room.meeting?.stage).toBe('result');

    clock.advance(MEETING_RESULT_MS + 1);
    room.tick();
    expect(room.phase).toBe('playing');
    expect(room.meeting).toBeNull();
  });

  it('clears bodies when a meeting starts', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 5);
    await room.startGame('p0');

    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x;
    pb.y = pa.y;
    room.purge('p0', 1);
    expect(room.bodies).toHaveLength(1);

    room.reportBody('p0', 1);
    expect(room.bodies).toHaveLength(0);
    expect(room.phase).toBe('meeting');
  });

  it('requires proximity to report a body', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 5);
    await room.startGame('p0');

    const pa = room.players.get('p0')!;
    const pb = room.players.get('p1')!;
    pb.x = pa.x;
    pb.y = pa.y;
    room.purge('p0', 1);

    const far = room.players.get('p2')!;
    far.x = 1400;
    far.y = 200;
    const { result } = room.reportBody('p2', 1);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too far/i);
  });
});

describe('GameRoom — ejection reveal (the one sanctioned bit)', () => {
  async function ejectSeat(room: GameRoom, clock: ReturnType<typeof makeClock>, seat: number) {
    room.callMeeting('p0');
    clock.advance(MEETING_DISCUSSION_MS + 1);
    room.tick();
    for (const p of room.players.values()) {
      if (p.alive) room.castVote(p.id, seat);
    }
    room.tick();
  }

  it('crew wins immediately when the ejected player WAS the parasite', async () => {
    const clock = makeClock();
    // LocalRoleOracle(() => 0) pins the parasite to seat 0.
    const room = makeRoom({ clock });
    fill(room, 5);
    await room.startGame('p0');

    await ejectSeat(room, clock, 0);
    await room.resolveEjectionLocally();
    expect(room.meeting?.result?.ejectedWasParasite).toBe(true);

    clock.advance(MEETING_RESULT_MS + 1);
    room.tick();
    expect(room.end?.winner).toBe('crew');
    expect(room.end?.reason).toBe('crew-ejected-parasite');
  });

  it('game continues when an innocent is ejected', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 6);
    await room.startGame('p0');

    await ejectSeat(room, clock, 3); // seat 3 is innocent (parasite is seat 0)
    await room.resolveEjectionLocally();
    expect(room.meeting?.result?.ejectedWasParasite).toBe(false);

    clock.advance(MEETING_RESULT_MS + 1);
    room.tick();
    expect(room.phase).toBe('playing');
    expect(room.end).toBeNull();
  });

  it('does NOT resolve reveals itself in Inco mode — it cannot know', async () => {
    const clock = makeClock();
    const room = makeRoom({ simulated: false, clock });
    fill(room, 5);
    await room.startGame('p0');
    await ejectSeat(room, clock, 2);

    // No oracle in Inco mode: the server is genuinely ignorant and must wait
    // for a client to report the on-chain reveal.
    const emits = await room.resolveEjectionLocally();
    expect(emits).toHaveLength(0);
    expect(room.meeting?.result?.ejectedWasParasite).toBeNull();

    room.submitEjectionReveal(true);
    expect(room.meeting?.result?.ejectedWasParasite).toBe(true);
  });

  it('ignores a duplicate reveal submission', async () => {
    const clock = makeClock();
    const room = makeRoom({ simulated: false, clock });
    fill(room, 5);
    await room.startGame('p0');
    await ejectSeat(room, clock, 2);

    room.submitEjectionReveal(false);
    const second = room.submitEjectionReveal(true);
    expect(second).toHaveLength(0);
    expect(room.meeting?.result?.ejectedWasParasite).toBe(false);
  });
});

describe('GameRoom — role mode is never hidden', () => {
  it('reports simulated mode in the public state', () => {
    const room = makeRoom({ simulated: true });
    expect(room.toState().roleMode).toBe('simulated');
    expect(room.toState().contractAddress).toBeNull();
  });

  it('reports inco mode and the contract address', () => {
    const room = makeRoom({ simulated: false });
    const s = room.toState();
    expect(s.roleMode).toBe('inco');
    expect(s.contractAddress).toBe('0xcontract');
  });

  it('never leaks a role field in the serialized state', async () => {
    const room = makeRoom();
    fill(room, 5);
    await room.startGame('p0');
    const json = JSON.stringify(room.toState());
    expect(json).not.toMatch(/parasite.*true|isParasite|"role"/i);
  });
});

describe('GameRoom: simulated role settlement', () => {
  it.each(['ejection', 'game end'] as const)(
    'simulated role settlement waits for an admitted transfer before %s reveal', async (boundary) => {
      const clock = makeClock();
      const oracle = new LocalRoleOracle(() => 0);
      const room = new GameRoom({ code: 'BOTREVEALRACE', roleMode: 'simulated', contractAddress: null, localOracle: oracle, now: clock.now });
      fill(room, 1);
      room.syncBots();
      await room.startGame('p0');
      const source = room.bySeat(0)!;
      const target = room.bySeat(1)!;
      Object.assign(source, { x: 810, y: 600 });
      Object.assign(target, { x: 800, y: 600 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const realJump = oracle.jump.bind(oracle);
      const spy = vi.spyOn(oracle, 'jump').mockImplementationOnce(async (params) => { await gate; await realJump(params); });
      const rng = vi.spyOn(Math, 'random').mockReturnValue(0.9);
      const transfer = room.jumpAnnounce(source.id, target.seat);
      let reveal: Promise<unknown> | undefined;
      try {
        if (boundary === 'ejection') {
          expect(room.callMeeting(source.id).result.ok).toBe(true);
          clock.advance(MEETING_DISCUSSION_MS + 1);
          room.tick();
          for (const p of room.players.values()) expect(room.castVote(p.id, target.seat).ok).toBe(true);
          room.tick();
          expect(room.meeting?.result?.ejectedSeat).toBe(target.seat);
          reveal = room.resolveEjectionLocally();
        } else {
          room.endGame('crew', 'crew-tasks');
          reveal = room.resolveFinalRevealLocally();
        }
        let revealed = false;
        void reveal.then(() => { revealed = true; });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(revealed).toBe(false);
        clock.advance(MEETING_RESULT_MS + 1);
        room.tick();
        if (boundary === 'ejection') {
          expect(room.phase).toBe('meeting');
          expect(room.meeting?.result?.ejectedWasParasite).toBeNull();
        } else expect(room.end?.revealedParasiteSeat).toBeNull();
        release();
        expect(await transfer).toEqual({ ok: true });
        await reveal;
        if (boundary === 'ejection') {
          expect(room.meeting?.result?.ejectedWasParasite).toBe(true);
          room.tick();
          expect(room.end?.reason).toBe('crew-ejected-parasite');
          await room.resolveFinalRevealLocally();
        }
        expect(room.end?.revealedParasiteSeat).toBe(target.seat);
        expect(await room.readRoleForSeat(target.seat)).toBe(true);
        expect((await room.jumpAnnounce(source.id, target.seat)).ok).toBe(false);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        release();
        await transfer;
        await reveal;
        spy.mockRestore();
        rng.mockRestore();
      }
    }
  );
});

describe('GameRoom: bot behaviour', () => {
  it('a starting Parasite bot never submits a crew task on its first tick', async () => {
    const room = makeRoom({ rng: () => 0.3 });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    const bot = room.bySeat(1)!;
    expect(await room.readRoleForSeat(bot.seat)).toBe(true);
    const taskId = 'upload-research-data';
    Object.assign(bot, TASK_STATIONS[taskId]);
    Object.assign(bot.bot!, { taskId, target: { ...TASK_STATIONS[taskId] }, actAt: 0 });
    room.tick();
    expect(bot.tasksDone).toBe(0);
    expect(bot.bot!.taskId).toBeNull();
  });

  it('human transfers update bot intent immediately and a former bot host reports as crew', async () => {
    const clock = makeClock();
    const room = makeRoom({ clock });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    const human = room.bySeat(0)!;
    const bot = room.bySeat(1)!;
    const victim = room.bySeat(2)!;
    const other = room.bySeat(3)!;
    Object.assign(human, { x: 810, y: 600 });
    Object.assign(bot, { x: 800, y: 600 });
    Object.assign(other, { x: 290, y: 250 });
    Object.assign(bot.bot!, {
      taskId: 'upload-research-data', target: { x: 800, y: 600 }, actAt: clock.now() + 60_000,
    });
    expect(await room.jumpAnnounce(human.id, bot.seat)).toEqual({ ok: true });
    expect(await room.readRoleForSeat(0)).toBe(false);
    expect(await room.readRoleForSeat(1)).toBe(true);
    expect(bot.bot!.taskId).toBeNull();
    expect(bot.bot!.actAt).toBe(0);
    victim.alive = false;
    room.bodies = [{ seat: victim.seat, x: bot.x, y: bot.y }];
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      room.tick();
      expect(bot.tasksDone).toBe(0);
      expect(room.phase).toBe('playing');
      expect(await room.jumpAnnounce(bot.id, human.seat)).toEqual({ ok: true });
      expect(await room.readRoleForSeat(1)).toBe(false);
      expect(await room.readRoleForSeat(0)).toBe(true);
      room.tick();
      expect(room.meeting?.reason).toEqual({ kind: 'body', reporterSeat: bot.seat, victimSeat: victim.seat });
    } finally {
      rng.mockRestore();
    }
  });

  it('serializes human and bot transfers while bot intent is awaiting the oracle', async () => {
    const clock = makeClock();
    const oracle = new LocalRoleOracle(() => 0);
    const room = new GameRoom({ code: 'BOTRACE', roleMode: 'simulated', contractAddress: null, localOracle: oracle, now: clock.now });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    const bot = room.bySeat(1)!;
    const decoy = room.bySeat(2)!;
    Object.assign(room.bySeat(0)!, { x: 810, y: 600 });
    Object.assign(bot, { x: 800, y: 600 });
    Object.assign(decoy, { x: 830, y: 600 });
    Object.assign(bot.bot!, { taskId: 'upload-research-data', target: { x: 800, y: 600 }, actAt: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realJump = oracle.jump.bind(oracle);
    const spy = vi.spyOn(oracle, 'jump').mockImplementationOnce(async (params) => { await gate; await realJump(params); });
    const transfer = room.jumpAnnounce('p0', bot.seat);
    try {
      const competing = await room.jumpAnnounce(decoy.id, bot.seat);
      expect(competing.ok).toBe(false);
      expect(competing.error).toMatch(/resolving/i);
      room.tick();
      expect(bot.tasksDone).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await transfer;
      spy.mockRestore();
    }
    expect(await room.readRoleForSeat(bot.seat)).toBe(true);
    expect(bot.bot!.taskId).toBeNull();
  });

  it('returns a same-shaped failure on oracle errors and releases the transfer lock', async () => {
    const clock = makeClock();
    const oracle = new LocalRoleOracle(() => 0.3);
    const room = new GameRoom({ code: 'BOTERROR', roleMode: 'simulated', contractAddress: null, localOracle: oracle, now: clock.now });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    Object.assign(room.bySeat(0)!, { x: 830, y: 600 });
    const bot = room.bySeat(1)!;
    Object.assign(bot, { x: 800, y: 600 });
    const spy = vi.spyOn(oracle, 'jump').mockRejectedValueOnce(new Error('unavailable'));
    try {
      await expect(room.jumpAnnounce(bot.id, 0)).resolves.toEqual({ ok: false, error: 'Jump could not be resolved. Try again.' });
      expect(await room.readRoleForSeat(bot.seat)).toBe(true);
      clock.advance(20_000);
      expect(await room.jumpAnnounce(bot.id, 0)).toEqual({ ok: true });
      expect(await room.readRoleForSeat(0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('freezes bot intent if a transferred private role cannot be refreshed', async () => {
    const clock = makeClock();
    const oracle = new LocalRoleOracle(() => 0);
    const room = new GameRoom({ code: 'BOTREADERROR', roleMode: 'simulated', contractAddress: null, localOracle: oracle, now: clock.now });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    Object.assign(room.bySeat(0)!, { x: 810, y: 600 });
    const bot = room.bySeat(1)!;
    Object.assign(bot, { x: 800, y: 600 });
    Object.assign(bot.bot!, { taskId: 'upload-research-data', target: { x: 800, y: 600 }, actAt: 0 });
    const spy = vi.spyOn(oracle, 'readMyRole').mockRejectedValueOnce(new Error('unavailable'));
    try {
      expect((await room.jumpAnnounce('p0', bot.seat)).ok).toBe(true);
      expect((await oracle.readMyRole({ gameId: room.chainGameId!, mySeat: bot.seat })).isParasite).toBe(true);
      room.tick();
      expect(bot.tasksDone).toBe(0);
      expect(bot.ax).toBe(0);
      clock.advance(1001);
      expect(room.tick()).toContainEqual({ type: 'rolesUpdated' });
      expect(bot.tasksDone).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('an ordinary bot-to-bot Jump stays single-flight through a meeting and reveals the new bot seat', async () => {
    const clock = makeClock();
    const oracle = new LocalRoleOracle(() => 0.3);
    const room = new GameRoom({ code: 'BOTCHAIN', roleMode: 'simulated', contractAddress: null, localOracle: oracle, now: clock.now });
    fill(room, 1);
    room.syncBots();
    await room.startGame('p0');
    for (const p of room.players.values()) Object.assign(p, { x: 290, y: 250 });
    const source = room.bySeat(1)!;
    const target = room.bySeat(2)!;
    Object.assign(source, { x: 800, y: 600 });
    Object.assign(target, { x: 835, y: 600 });
    Object.assign(target.bot!, { taskId: 'upload-research-data', target: { x: 800, y: 600 }, actAt: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realJump = oracle.jump.bind(oracle);
    const spy = vi.spyOn(oracle, 'jump').mockImplementationOnce(async (params) => { await gate; await realJump(params); });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      room.tick();
      for (let i = 0; i < 10; i++) { clock.advance(50); room.tick(); }
      expect(spy).toHaveBeenCalledTimes(1);
      expect(target.tasksDone).toBe(0);
      expect(room.callMeeting('p0').result.ok).toBe(true);
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await room.readRoleForSeat(source.seat)).toBe(false);
      expect(await room.readRoleForSeat(target.seat)).toBe(true);
      expect(target.bot!.taskId).toBeNull();
      room.tick();
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await room.jumpAnnounce(target.id, source.seat)).ok).toBe(false);
      clock.advance(MEETING_DISCUSSION_MS + 1);
      room.tick();
      for (const p of room.players.values()) expect(room.castVote(p.id, target.seat).ok).toBe(true);
      room.tick();
      await room.resolveEjectionLocally();
      expect(room.meeting?.result?.ejectedWasParasite).toBe(true);
      clock.advance(MEETING_RESULT_MS + 1);
      room.tick();
      await room.resolveFinalRevealLocally();
      expect(room.end).toEqual({ winner: 'crew', reason: 'crew-ejected-parasite', revealedParasiteSeat: target.seat });
      room.tick();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      spy.mockRestore();
      rng.mockRestore();
    }
  });

  it.each(['out of range', 'dead target', 'dead host', 'cooldown', 'assigning', 'meeting', 'ended'] as const)(
    'bot Jump respects %s without changing the oracle host', async (rule) => {
      const clock = makeClock();
      const room = makeRoom({ clock, rng: () => 0.3 });
      fill(room, 1);
      room.syncBots();
      await room.startGame('p0');
      for (const p of room.players.values()) Object.assign(p, { x: 290, y: 250 });
      const bot = room.bySeat(1)!;
      const target = room.bySeat(0)!;
      Object.assign(bot, { x: 800, y: 600, lastPurgeAt: clock.now() });
      Object.assign(target, { x: 830, y: 600 });
      if (rule === 'out of range') target.x = bot.x + JUMP_RANGE + 1;
      else if (rule === 'dead target') target.alive = false;
      else if (rule === 'dead host') bot.alive = false;
      else if (rule === 'cooldown') bot.lastJumpAt = clock.now();
      else room.phase = rule;
      const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        room.tick();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(await room.readRoleForSeat(bot.seat)).toBe(true);
        expect(await room.readRoleForSeat(target.seat)).toBe(false);
      } finally { rng.mockRestore(); }
    }
  );

  it('a crew bot standing at a body reports it', async () => {
    const room = makeRoom();
    fill(room, 1);
    room.syncBots();
    expect((await room.startGame('p0')).ok).toBe(true);
    const bot = [...room.players.values()].find((p) => p.isBot && p.alive)!;
    const victim = [...room.players.values()].find((p) => p.id !== bot.id)!;
    room.bodies.push({ seat: victim.seat, x: bot.x + 10, y: bot.y });
    victim.alive = false;
    // LocalRoleOracle(() => 0) picks seat 0; make sure this bot is crew.
    const emits = room.tick();
    expect(await room.readRoleForSeat(bot.seat)).toBe(false);
    expect(room.phase).toBe('meeting');
    expect(emits.some((e) => e.type === 'meetingStarted')).toBe(true);
  });
});
