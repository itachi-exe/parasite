import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioc, type Socket } from 'socket.io-client';
import { AddressInfo } from 'node:net';
import { GameServer } from './GameServer.js';
import { MIN_PLAYERS, MAX_PLAYERS, TASK_STATIONS, TASK_INTERACT_RADIUS } from '@parasite/shared';

/**
 * End-to-end transport test: real Socket.io clients against the real
 * GameServer wiring, exercising join → start → move → task → meeting → vote.
 */
describe('GameServer (socket integration)', () => {
  let http: ReturnType<typeof createServer>;
  let game: GameServer;
  let port: number;
  const clients: Socket[] = [];

  beforeAll(async () => {
    http = createServer();
    const io = new Server(http);
    game = new GameServer(io, {
      contractAddress: null,
      positionEveryTicks: 1,
      // Shorten the meeting stages so the integration test does not sit through
      // a real 15-second discussion phase. Discussion is short (we just need it
      // to elapse), but the voting window must stay comfortably longer than the
      // round trips needed to collect every vote, or the stage times out
      // mid-poll and later votes are rejected.
      timings: { discussionMs: 100, votingMs: 5_000, resultMs: 100 },
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    port = (http.address() as AddressInfo).port;
  });

  afterAll(() => {
    game.stop();
    for (const c of clients) c.disconnect();
    http.close();
  });

  function connect(): Socket {
    const s = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    clients.push(s);
    return s;
  }

  function once<T>(s: Socket, ev: string): Promise<T> {
    return new Promise((resolve) => s.once(ev as any, (d: T) => resolve(d)));
  }

  /**
   * Each test uses its OWN room code. Rooms are only reaped when empty, and a
   * mid-game disconnect deliberately keeps the seat (the spec forbids mid-game
   * leaving), so a room that has started never empties — sharing one code
   * across tests would make every test after the first fail to join.
   */
  async function join(s: Socket, name: string, code: string): Promise<any> {
    const ack = await new Promise((res) =>
      s.emit('join', { code, name, skin: 0, address: null }, res)
    );
    return ack;
  }

  it('enforces the player cap and lobby-only joining over the wire', async () => {
    const ROOM = 'CAPTEST';
    const joined: Socket[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const s = connect();
      const ack = await join(s, `P${i}`, ROOM);
      expect(ack.ok).toBe(true);
      joined.push(s);
    }

    const extra = connect();
    const overflow = await join(extra, 'Overflow', ROOM);
    expect(overflow.ok).toBe(false);

    // Mid-game join is refused, not just full-lobby.
    const host = joined[0]!;
    const started = await new Promise((res) => host.emit('startGame', res));
    expect(started.ok).toBe(true);

    const late = connect();
    const lateAck = await join(late, 'Late', ROOM);
    expect(lateAck.ok).toBe(false);
    expect(lateAck.error).toMatch(/lobby/i);

    for (const s of joined) s.disconnect();
    extra.disconnect();
  });

  // Generous timeout: this test drives a real 20Hz server loop over real
  // websockets, so it is wall-clock bound rather than CPU bound.
  it('runs the full loop over the wire: move, task, meeting, vote', { timeout: 20_000 }, async () => {
    const ROOM = 'LOOPTEST';
    const clients: Socket[] = [];
    const states: any[] = [];

    for (let i = 0; i < MIN_PLAYERS; i++) {
      const s = connect();
      s.on('state' as any, (st: any) => states.push(st));
      const ack = await join(s, `Loop${i}`, ROOM);
      expect(ack.ok).toBe(true);
      clients.push(s);
    }

    const host = clients[0]!;
    const gameStarted = once<any>(host, 'gameStarted');
    const started = await new Promise((res) => host.emit('startGame', res));
    expect(started.ok).toBe(true);
    await gameStarted;

    // The gameStarted snapshot should reflect playing phase.
    const playing = states.filter((s) => s.phase === 'playing');
    expect(playing.length).toBeGreaterThan(0);

    // Movement: steer the host toward a task station.
    //
    // The client sends a direction each frame, exactly like the real game, and
    // the SERVER integrates it — so this genuinely exercises the movement path
    // rather than teleporting. Direction is recomputed every frame so the walk
    // slides along walls instead of pushing into one.
    //
    // "Upload Research Data" sits at the centre of the Central Meeting Platform,
    // one spawn-ring radius (~110px) away, which keeps this test fast and
    // deterministic. Cross-map navigability is covered separately by the
    // flood-fill test in @parasite/shared.
    const taskId = 'upload-research-data' as const;
    const st = TASK_STATIONS[taskId];
    const room = game.roomFor(ROOM)!;
    const hostPlayer = room.bySeat(0)!;
    const spawn = { x: hostPlayer.x, y: hostPlayer.y };

    const interval = setInterval(() => {
      const dx = st.x - hostPlayer.x;
      const dy = st.y - hostPlayer.y;
      const len = Math.hypot(dx, dy) || 1;
      host.emit('input', { ax: dx / len, ay: dy / len, seq: Date.now() });
    }, 25);

    const deadline = Date.now() + 6000;
    while (
      Date.now() < deadline &&
      Math.hypot(hostPlayer.x - st.x, hostPlayer.y - st.y) > TASK_INTERACT_RADIUS - 12
    ) {
      await new Promise((r) => setTimeout(r, 30));
    }
    clearInterval(interval);
    host.emit('input', { ax: 0, ay: 0, seq: Date.now() });

    // The server actually moved them.
    expect(Math.hypot(hostPlayer.x - spawn.x, hostPlayer.y - spawn.y)).toBeGreaterThan(20);

    const finalDist = Math.hypot(hostPlayer.x - st.x, hostPlayer.y - st.y);
    expect(
      finalDist,
      `host failed to reach the station (dist ${finalDist.toFixed(1)})`
    ).toBeLessThan(TASK_INTERACT_RADIUS);

    const taskAck = await new Promise<any>((res) => host.emit('completeTask', { taskId }, res));
    expect(taskAck.ok, taskAck.error).toBe(true);

    // Emergency meeting → everyone votes.
    const meetingEv = once<any>(host, 'meetingStarted');
    const callAck = await new Promise<any>((res) => host.emit('callMeeting', res));
    expect(callAck.ok, callAck.error).toBe(true);
    await meetingEv;

    // Voting only opens after the discussion stage.
    const voteDeadline = Date.now() + 4000;
    while (Date.now() < voteDeadline && room.meeting?.stage !== 'voting') {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(room.meeting?.stage).toBe('voting');

    for (const s of clients) {
      const voteAck = await new Promise<any>((res) => s.emit('castVote', { target: 'skip' }, res));
      expect(voteAck.ok, voteAck.error).toBe(true);
    }

    // With all votes in, the tally resolves without waiting for the timer.
    await new Promise((r) => setTimeout(r, 150));
    const resolved = states.filter((s) => s.phase === 'playing' && s.meeting === null);
    expect(resolved.length).toBeGreaterThan(0);

    for (const s of clients) s.disconnect();
  });

  it('surfaces role mode in the state broadcast', async () => {
    const ROOM = 'MODETEST';
    const s = connect();
    const state = once<any>(s, 'state');
    await join(s, 'ModeCheck', ROOM);
    const st = await state;
    expect(st.roleMode).toBe('simulated');
    s.disconnect();
  });
});
