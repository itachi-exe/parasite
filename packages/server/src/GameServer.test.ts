import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioc, type Socket } from 'socket.io-client';
import { AddressInfo } from 'node:net';
import { GameServer } from './GameServer.js';
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  TASK_STATIONS,
  TASK_INTERACT_RADIUS,
  JUMP_RANGE,
} from '@parasite/shared';

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

  it('refreshes each client identity when lobby bots step aside', async () => {
    const ROOM = 'DENSEIDENTITY';
    const joined: Socket[] = [];
    const ownSeats = new Map<Socket, number>();
    for (let i = 0; i < MIN_PLAYERS - 1; i++) {
      const s = connect();
      s.on('you', (p) => ownSeats.set(s, p.seat));
      expect((await join(s, `P${i}`, ROOM)).ok).toBe(true);
      joined.push(s);
    }
    const updates = joined.map((s) => new Promise<any>((resolve) => {
      const onState = (state: any) => {
        if (state.players.some((p: any) => p.isBot)) return;
        s.off('state', onState);
        resolve(state);
      };
      s.on('state', onState);
    }));
    const last = connect();
    last.on('you', (p) => ownSeats.set(last, p.seat));
    const ack = await join(last, 'P3', ROOM);
    expect(ack.ok).toBe(true);
    joined.push(last);
    const states = [...await Promise.all(updates), ack.state];
    for (const [i, s] of joined.entries()) {
      expect(states[i].players.find((p: any) => p.id === s.id)?.seat).toBe(i);
      expect(ownSeats.get(s)).toBe(i);
      s.disconnect();
    }
  });

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
  /**
   * Voice channel isolation.
   *
   * The claim this feature is demoed on is that a dead player cannot be heard
   * by the living — and that it holds because the *server* refuses to relay
   * signalling across channels, not because the browser mutes something it
   * already received. This asserts the server half: a signal sent from a dead
   * socket to a living one must never arrive.
   */
  it('never relays voice signalling between the living and the dead', async () => {
    const code = 'VOICEISO';
    const a = connect();
    const b = connect();
    await join(a, 'Alive', code);
    await join(b, 'Doomed', code);
    for (let i = 0; i < MIN_PLAYERS - 2; i++) {
      await join(connect(), `Filler${i}`, code);
    }

    await new Promise((res) => a.emit('startGame', res));

    // Kill the second player directly through the room, which is what a purge
    // ultimately does, without needing to arrange one.
    const room = game.roomFor(code)!;
    const victim = [...room.players.values()].find((p) => p.name === 'Doomed')!;
    victim.alive = false;

    await new Promise((res) => a.emit('voiceJoin', res));
    await new Promise((res) => b.emit('voiceJoin', res));

    // The living socket must not be offered the dead one as a peer.
    const aPeers = await new Promise<any>((res) => {
      a.emit('voiceJoin', () => {});
      a.once('voicePeers' as any, res);
    });
    expect(aPeers.peers.some((p: any) => p.name === 'Doomed')).toBe(false);

    // And a signal from the dead to the living must not arrive.
    let leaked = false;
    a.on('voiceSignal' as any, () => {
      leaked = true;
    });
    b.emit('voiceSignal', { to: (a as any).id, data: { sdp: 'should-never-arrive' } } as any);
    await new Promise((r) => setTimeout(r, 400));
    expect(leaked).toBe(false);
  });

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

  /**
   * The bug reported from a real playtest: a player who becomes the new
   * Parasite host via a mid-game jump was never told. deliverSimulatedRoles
   * only ever ran once, right after startGame — jumpAnnounce accepted the
   * call and enforced its public rules but never touched the room's role
   * oracle or re-notified anyone. This drives the fix over the real wire:
   * real sockets, a real jump from whoever the actual host turns out to be,
   * and asserts BOTH ends of the transfer get a fresh 'simulatedRole' event.
   */
  it('notifies the new host — and un-notifies the old one — after a real mid-game jump', async () => {
    const ROOM = 'JUMPNOTIFY';
    const roles = new Map<string, boolean>();
    const clients: Socket[] = [];

    for (let i = 0; i < MIN_PLAYERS; i++) {
      const s = connect();
      s.on('simulatedRole' as any, (p: { isParasite: boolean }) => roles.set(s.id!, p.isParasite));
      const ack = await join(s, `J${i}`, ROOM);
      expect(ack.ok).toBe(true);
      clients.push(s);
    }

    const host = clients[0]!;
    const started = await new Promise<any>((res) => host.emit('startGame', res));
    expect(started.ok).toBe(true);
    // Let every 'simulatedRole' delivered at game start land.
    await new Promise((r) => setTimeout(r, 100));
    expect(roles.size).toBe(MIN_PLAYERS);

    const room = game.roomFor(ROOM)!;
    const parasiteSocketId = [...roles.entries()].find(([, isP]) => isP)?.[0];
    expect(parasiteSocketId).toBeDefined();
    const parasiteClient = clients.find((c) => c.id === parasiteSocketId)!;
    const parasitePlayer = [...room.players.values()].find((p) => p.id === parasiteSocketId)!;
    const targetPlayer = [...room.players.values()].find((p) => p.id !== parasiteSocketId)!;

    // Put them in range and clear the roles map so the post-jump emissions
    // are unambiguous (only real changes need to arrive for this assertion;
    // a same-value re-emit for everyone else is fine and expected).
    targetPlayer.x = parasitePlayer.x + JUMP_RANGE / 2;
    targetPlayer.y = parasitePlayer.y;
    roles.clear();

    const jumpAck = await new Promise<any>((res) =>
      parasiteClient.emit('jumpAnnounce', { targetSeat: targetPlayer.seat }, res)
    );
    expect(jumpAck.ok, jumpAck.error).toBe(true);
    await new Promise((r) => setTimeout(r, 150));

    expect(roles.get(parasitePlayer.id)).toBe(false);
    expect(roles.get(targetPlayer.id)).toBe(true);
    // And the room's own authoritative state agrees.
    expect(await room.readRoleForSeat(parasitePlayer.seat)).toBe(false);
    expect(await room.readRoleForSeat(targetPlayer.seat)).toBe(true);

    for (const s of clients) s.disconnect();
  });

  it('rejects reportChainGameId outside Inco mode', async () => {
    const ROOM = 'REPORTSIM';
    const s = connect();
    await join(s, 'Sim', ROOM);
    const res = await new Promise<any>((r) =>
      s.emit('reportChainGameId', { chainGameId: '7' }, r)
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/inco/i);
    s.disconnect();
  });

  it('redacts hidden locations on every state and positions delivery', async () => {
    const code = 'SIGHTWIRE';
    const sockets = Array.from({ length: MIN_PLAYERS }, () => connect());
    for (const [i, s] of sockets.entries()) await join(s, `Sight${i}`, code);
    await new Promise((res) => sockets[0]!.emit('startGame', res));
    const room = game.roomFor(code)!;
    const viewer = room.players.get(sockets[0]!.id!)!;
    const hidden = room.players.get(sockets[1]!.id!)!;
    viewer.x = 800; viewer.y = 600;
    hidden.x = 800; hidden.y = 480; // Behind the default down-facing cone.
    const stateEv = once<any>(sockets[0]!, 'state');
    const positionsEv = once<any>(sockets[0]!, 'positions');
    const ack = await new Promise<any>((res) => sockets[0]!.emit(
      'completeTask', { taskId: 'upload-research-data' }, res
    ));
    expect(ack.ok).toBe(true);
    const state = await stateEv;
    const packet = await positionsEv;
    expect(state.players).toHaveLength(MIN_PLAYERS);
    expect(state.players.find((p: any) => p.seat === hidden.seat)).toMatchObject({ x: null, y: null });
    expect(packet.p.some((p: any) => p.s === hidden.seat)).toBe(false);
    expect(packet.p.find((p: any) => p.s === viewer.seat)).toMatchObject({ x: 800, y: 600 });
    for (const s of sockets) s.disconnect();
  });

  it('streams bodies as sight changes without a structural event', async () => {
    const code = 'BODYSIGHTWIRE';
    const sockets = Array.from({ length: MIN_PLAYERS }, () => connect());
    for (const [i, s] of sockets.entries()) await join(s, `Body${i}`, code);
    await new Promise((res) => sockets[0]!.emit('startGame', res));
    const room = game.roomFor(code)!;
    const viewer = room.players.get(sockets[0]!.id!)!;
    const victim = room.players.get(sockets[1]!.id!)!;
    viewer.x = 800; viewer.y = 600;
    victim.x = 800; victim.y = 480; victim.alive = false;
    const body = { seat: victim.seat, x: 800, y: 480 };
    room.bodies = [body];
    expect((await once<any>(sockets[0]!, 'positions')).b).toEqual([]);
    sockets[0]!.emit('input', { ax: 0, ay: 0, fx: 0, fy: -5, seq: 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect((await once<any>(sockets[0]!, 'positions')).b).toEqual([body]);
    const stateEv = once<any>(sockets[0]!, 'state');
    await new Promise((res) => sockets[0]!.emit('completeTask', { taskId: 'upload-research-data' }, res));
    const state = await stateEv;
    expect(state.bodies).toEqual([body]);
    expect(state.players.find((p: any) => p.seat === victim.seat)).toMatchObject({ x: null, y: null });
    sockets[0]!.emit('input', { ax: 0, ay: 0, fx: 0, fy: 1, seq: 2 });
    await new Promise((r) => setTimeout(r, 60));
    expect((await once<any>(sockets[0]!, 'positions')).b).toEqual([]);
    for (const s of sockets) s.disconnect();
  });

  it('does not put corpse coordinates in the global purge notice', async () => {
    const code = 'PURGENOTICE';
    const sockets = Array.from({ length: MIN_PLAYERS }, () => connect());
    for (const [i, s] of sockets.entries()) await join(s, `Purge${i}`, code);
    await new Promise((res) => sockets[0]!.emit('startGame', res));
    const room = game.roomFor(code)!;
    const killer = room.players.get(sockets[0]!.id!)!;
    const victim = room.players.get(sockets[1]!.id!)!;
    killer.x = 800; killer.y = 480;
    victim.x = 810; victim.y = 480;
    const notice = once<any>(sockets[2]!, 'playerPurged');
    const ack = await new Promise<any>((res) => sockets[0]!.emit('purge', { targetSeat: victim.seat }, res));
    expect(ack.ok).toBe(true);
    expect(await notice).toEqual({ victimSeat: victim.seat });
    for (const s of sockets) s.disconnect();
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

/**
 * reportChainGameId, in a real Inco-mode room.
 *
 * The bug this closes: nothing in the system ever called this, so
 * chainGameId stayed null forever and every player's role sat at WAITING
 * permanently, not just slowly. Needs its own server instance because the
 * shared one above is fixed to simulated mode.
 */
describe('GameServer — reportChainGameId (Inco mode)', () => {
  let http: ReturnType<typeof createServer>;
  let game: GameServer;
  let port: number;
  const clients: Socket[] = [];

  beforeAll(async () => {
    http = createServer();
    const io = new Server(http);
    // A syntactically-plausible address is all this needs: the server never
    // actually calls the chain for this feature (by design — it holds no
    // role oracle in Inco mode), it only stores whatever id the host reports.
    game = new GameServer(io, {
      contractAddress: '0x0000000000000000000000000000000000dEaD',
      positionEveryTicks: 1,
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

  async function join(s: Socket, name: string, code: string): Promise<any> {
    return new Promise((res) => s.emit('join', { code, name, skin: 0, address: null }, res));
  }

  it('lets the host report the id once, and broadcasts it', async () => {
    const ROOM = 'INCOREPORT';
    const host = connect();
    await join(host, 'Host', ROOM);

    const stateEv = new Promise<any>((resolve) => host.once('state' as any, resolve));
    const res = await new Promise<any>((r) =>
      host.emit('reportChainGameId', { chainGameId: '42' }, r)
    );
    expect(res.ok, res.error).toBe(true);

    const st = await stateEv;
    expect(st.chainGameId).toBe('42');
    host.disconnect();
  });

  it('rejects a non-host caller', async () => {
    const ROOM = 'INCOREPORTNOTHOST';
    const host = connect();
    const other = connect();
    await join(host, 'Host', ROOM);
    await join(other, 'Other', ROOM);

    const res = await new Promise<any>((r) =>
      other.emit('reportChainGameId', { chainGameId: '1' }, r)
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/host/i);
    host.disconnect();
    other.disconnect();
  });

  it('rejects a second report once the id is already set', async () => {
    const ROOM = 'INCOREPORTTWICE';
    const host = connect();
    await join(host, 'Host', ROOM);

    const first = await new Promise<any>((r) =>
      host.emit('reportChainGameId', { chainGameId: '5' }, r)
    );
    expect(first.ok).toBe(true);

    const second = await new Promise<any>((r) =>
      host.emit('reportChainGameId', { chainGameId: '999' }, r)
    );
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already set/i);
    host.disconnect();
  });
});
