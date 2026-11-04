import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import {
  TICK_MS,
  LocalRoleOracle,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@parasite/shared';
import { GameRoom, type Emit, type MeetingTimings } from './GameRoom.js';

export interface GameServerConfig {
  contractAddress: string | null;
  /** Positions are broadcast every N ticks to keep bandwidth sane. */
  positionEveryTicks?: number;
  /** Meeting stage durations. Defaults to the shared constants. */
  timings?: Partial<MeetingTimings>;
}

/**
 * Socket.io adapter over GameRoom.
 *
 * Thin on purpose: it translates events to method calls, fans out whatever the
 * room asks it to broadcast, and drives the tick loop. All rules live in
 * GameRoom so they can be tested without a socket.
 */
export class GameServer {
  readonly io: Server<ClientToServerEvents, ServerToClientEvents>;
  private rooms = new Map<string, GameRoom>();
  private socketRoom = new Map<string, string>();
  /**
   * Sockets that have opted in to voice, and which channel they are on.
   *
   * The living and the dead are separate channels, and separation is enforced
   * here rather than in the browser: a signalling message is only relayed
   * between two sockets on the same channel, so a living player's browser is
   * never offered a peer connection to a dead one. There is no stream to mute
   * because there is no connection to carry it.
   */
  private voice = new Map<string, 'alive' | 'dead'>();
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private config: GameServerConfig;

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    config: GameServerConfig
  ) {
    this.io = io;
    this.config = config;
    this.wire();
    this.start();
  }

  /**
   * Role backend selection. With a contract address configured we run in Inco
   * mode and the server holds NO oracle — it cannot learn any role. Without one
   * we fall back to a clearly-labelled in-process simulation so the game is
   * still playable end to end.
   */
  private roleMode(): 'inco' | 'simulated' {
    return this.config.contractAddress ? 'inco' : 'simulated';
  }

  private getRoom(code: string): GameRoom {
    const key = code.trim().toUpperCase() || 'VIRELIA';
    let room = this.rooms.get(key);
    if (!room) {
      const mode = this.roleMode();
      room = new GameRoom({
        code: key,
        roleMode: mode,
        contractAddress: this.config.contractAddress,
        // Only ever constructed in simulated mode — see the class comment.
        localOracle: mode === 'simulated' ? new LocalRoleOracle() : undefined,
        timings: this.config.timings,
      });
      this.rooms.set(key, room);
    }
    return room;
  }

  private wire(): void {
    this.io.on('connection', (socket) => {
      socket.on('join', async (payload, ack) => {
        const code = (payload?.code ?? 'VIRELIA').trim().toUpperCase() || 'VIRELIA';
        const room = this.getRoom(code);
        const { result, player } = room.join(
          socket.id,
          payload?.name ?? '',
          payload?.skin ?? 0,
          payload?.address ?? null
        );

        if (!result.ok || !player) {
          ack?.({ ok: false, error: result.error });
          return;
        }

        this.socketRoom.set(socket.id, code);
        await socket.join(code);
        // A real player has arrived: drop a bot if one was holding a seat for
        // them. Done before the ack so the client's first snapshot is correct.
        room.syncBots();

        // Tell the room someone turned up. socket.to() rather than io.to():
        // it excludes the sender, so nobody is told about their own arrival.
        // "they", not "he" — the lobby knows a name, not a person.
        socket.to(code).emit('toast', {
          kind: 'info',
          text: `${player.name} joined. Are they the Parasite?`,
        });
        socket.emit('you', { id: player.id, seat: player.seat });
        ack?.({
          ok: true,
          you: { id: player.id, seat: player.seat },
          state: room.stateFor(socket.id),
        });
        this.broadcastState(room);
      });

      socket.on('startGame', async (ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const res = await room.startGame(socket.id);
        if (!res.ok) {
          this.cleanup(room);
          this.broadcastState(room);
          return ack?.(res);
        }

        ack?.({ ok: true });
        this.io.to(room.code).emit('gameStarted', {
          chainGameId: room.chainGameId,
          // Inco canStart already requires every seat to be a wallet-owning human.
          seats: [...room.players.values()]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => ({ seat: p.seat, address: p.address })),
        });
        this.broadcastState(room);
        await this.deliverSimulatedRoles(room);
      });

      socket.on('input', (payload) => {
        const room = this.roomOf(socket);
        room?.setInput(socket.id, payload?.ax ?? 0, payload?.ay ?? 0, payload?.fx, payload?.fy);
      });

      socket.on('completeTask', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const { result, emits } = room.completeTask(socket.id, payload.taskId);
        ack?.(result);
        void this.flush(room, emits);
      });

      socket.on('taskProgress', (_payload, ack) => {
        // Intermediate progress is purely cosmetic and client-local; the server
        // only records completion (and re-checks proximity when it does).
        ack?.({ ok: true });
      });

      socket.on('callMeeting', (ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const { result, emits } = room.callMeeting(socket.id);
        ack?.(result);
        void this.flush(room, emits);
      });

      socket.on('reportBody', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const { result, emits } = room.reportBody(socket.id, payload.victimSeat);
        ack?.(result);
        void this.flush(room, emits);
      });

      socket.on('castVote', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const result = room.castVote(socket.id, payload.target);
        ack?.(result);
        if (result.ok) this.broadcastState(room);
      });

      socket.on('purge', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const { result, emits } = room.purge(socket.id, payload.targetSeat);
        ack?.(result);
        void this.flush(room, emits);
      });

      socket.on('jumpAnnounce', async (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        // Returns the same answer for real jumps and decoys.
        const result = await room.jumpAnnounce(socket.id, payload.targetSeat);
        ack?.(result);
        // Simulated mode only: re-tell everyone their current role. For a
        // decoy (or an Inco-mode call, where this is a no-op) it re-sends the
        // same value nobody notices; for a real transfer it is the only path
        // that tells the new host they are now the Parasite.
        if (result.ok) await this.deliverSimulatedRoles(room);
      });

      /**
       * Inco mode: the lobby host's own client calls createGame() on the
       * contract right after the game starts, then reports the resulting id
       * here. Nothing else in the system ever learns it otherwise — until
       * this lands, chainGameId stays null and no client can decrypt a role
       * (see useRole.ts: the decrypt effect requires chainGameId).
       *
       * Host-gated and one-shot (rejects once already set) so a stray retry
       * or a second tab cannot clobber a valid id with a different one.
       */
      socket.on('reportChainGameId', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        if (socket.id !== room.hostId) {
          return ack?.({ ok: false, error: 'Only the lobby host can report the chain game id.' });
        }
        if (room.roleMode !== 'inco') {
          return ack?.({ ok: false, error: 'Not in Inco mode.' });
        }
        if (room.chainGameId) {
          return ack?.({ ok: false, error: 'Chain game id already set.' });
        }
        const id = (payload?.chainGameId ?? '').trim();
        if (!id) return ack?.({ ok: false, error: 'Missing chain game id.' });
        room.setChainGameId(id);
        ack?.({ ok: true });
        this.broadcastState(room);
      });

      socket.on('submitEjectionReveal', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        // Inco mode: any client that performed the on-chain reveal may report it.
        // The value is public by then (e.reveal made it so), so this is not a
        // trust escalation.
        const emits = room.submitEjectionReveal(payload.wasParasite);
        ack?.({ ok: true });
        void this.flush(room, emits);
      });

      /*
       * Room chat.
       *
       * The dead talk only to the dead. Sending a ghost line to the living
       * would hand them information the game is built on withholding — and it
       * is fanned out per-socket rather than to the room, so a living client
       * never receives the message at all. Filtering it in the UI would leave
       * it sitting in the network tab.
       */
      socket.on('sendChat', (payload, ack) => {
        const room = this.roomOf(socket);
        if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
        const me = room.players.get(socket.id);
        if (!me) return ack?.({ ok: false, error: 'Not in this game.' });

        const text = (payload?.text ?? '').trim().slice(0, 140);
        if (!text) return ack?.({ ok: false, error: 'Nothing to say.' });

        const msg = {
          seat: me.seat,
          name: me.name,
          text,
          at: Date.now(),
          ghost: !me.alive,
        };

        if (msg.ghost) {
          for (const p of room.players.values()) {
            if (!p.alive && !p.isBot) this.io.to(p.id).emit('chat', msg);
          }
        } else {
          this.io.to(room.code).emit('chat', msg);
        }
        ack?.({ ok: true });
      });

      // ── Voice ──────────────────────────────────────────────────────────
      socket.on('voiceJoin', (ack) => {
        const room = this.roomOf(socket);
        const me = room?.players.get(socket.id);
        if (!room || !me) return ack?.({ ok: false, error: 'Not in a room.' });

        const channel: 'alive' | 'dead' = me.alive ? 'alive' : 'dead';
        this.voice.set(socket.id, channel);

        const peers = [...this.voice.entries()]
          .filter(([id, ch]) => id !== socket.id && ch === channel)
          .map(([id]) => {
            const p = room.players.get(id);
            return p ? { id, seat: p.seat, name: p.name } : null;
          })
          .filter((p): p is { id: string; seat: number; name: string } => p !== null);

        socket.emit('voicePeers', { peers });
        for (const p of peers) {
          this.io.to(p.id).emit('voicePeerJoined', {
            id: socket.id,
            seat: me.seat,
            name: me.name,
          });
        }
        ack?.({ ok: true });
      });

      socket.on('voiceLeave', () => this.dropVoice(socket.id));

      socket.on('voiceSignal', (payload) => {
        const mine = this.voice.get(socket.id);
        const theirs = this.voice.get(payload?.to ?? '');
        // Same channel or nothing happens. This is the whole guarantee.
        if (!mine || !theirs || mine !== theirs) return;
        if (this.socketRoom.get(socket.id) !== this.socketRoom.get(payload.to)) return;
        this.io.to(payload.to).emit('voiceSignal', { from: socket.id, data: payload.data });
      });

      socket.on('leaveLobby', (ack) => {
        const room = this.roomOf(socket);
        if (room) {
          // Name has to be read before disconnect(), which deletes the player
          // outright while the room is still in the lobby.
          const who = room.players.get(socket.id)?.name;
          if (who) {
            socket.to(room.code).emit('toast', {
              kind: 'info',
              text: `${who} left the outpost.`,
            });
          }
          room.disconnect(socket.id);
          void socket.leave(room.code);
          this.socketRoom.delete(socket.id);
          room.syncBots();
          this.cleanup(room);
          this.broadcastState(room);
        }
        ack?.({ ok: true });
      });

      socket.on('disconnect', () => {
        const room = this.roomOf(socket);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (p) {
          // Mid-game a seat is kept and only marked disconnected, so the two
          // cases read differently: someone who leaves the lobby is gone,
          // someone who drops mid-round is still a suspect.
          socket.to(room.code).emit('toast', {
            kind: 'warn',
            text:
              room.phase === 'lobby'
                ? `${p.name} left the outpost.`
                : `${p.name} lost connection. Their body stays in the game.`,
          });
        }
        this.dropVoice(socket.id);
        room.disconnect(socket.id);
        this.socketRoom.delete(socket.id);
        // Top the lobby back up, so the seat a leaver freed does not strand
        // whoever is left below the minimum.
        room.syncBots();
        this.cleanup(room);
        this.broadcastState(room);
      });
    });
  }

  /** Remove a socket from voice and tell whoever it was talking to. */
  private dropVoice(id: string): void {
    if (!this.voice.has(id)) return;
    const channel = this.voice.get(id);
    this.voice.delete(id);
    for (const [other, ch] of this.voice) {
      if (ch === channel) this.io.to(other).emit('voicePeerLeft', { id });
    }
  }

  private roomOf(socket: Socket): GameRoom | undefined {
    const code = this.socketRoom.get(socket.id);
    return code ? this.rooms.get(code) : undefined;
  }

  private cleanup(room: GameRoom): void {
    if (room.isEmpty()) this.rooms.delete(room.code);
  }

  /**
   * SIMULATED MODE ONLY: privately tell each player their own role.
   *
   * Sent per-socket, never broadcast, so one player's role does not travel to
   * anyone else's client. That is the best a server-side oracle can do — it is
   * still a server that KNOWS the roles, which is exactly why this path is
   * labelled SIMULATED in the UI and why Inco mode exists.
   *
   * In Inco mode this is a no-op: the room has no oracle, and each player reads
   * their own encrypted bit from chain with their own wallet.
   */
  private async deliverSimulatedRoles(room: GameRoom): Promise<void> {
    if (room.roleMode !== 'simulated') return;
    await room.recoverSimulatedRoles();
    for (const player of room.players.values()) {
      if (player.isBot || !player.connected || this.socketRoom.get(player.id) !== room.code) continue;
      const isParasite = room.simulatedRoleForSeat(player.seat);
      if (isParasite === null) continue;
      this.io.to(player.id).emit('simulatedRole', { isParasite });
    }
  }

  private broadcastState(room: GameRoom): void {
    if (!this.rooms.has(room.code)) return;
    for (const p of room.players.values()) {
      if (!p.isBot && p.connected && this.socketRoom.get(p.id) === room.code) {
        if (room.phase === 'lobby') this.io.to(p.id).emit('you', { id: p.id, seat: p.seat });
        this.io.to(p.id).emit('state', room.stateFor(p.id));
      }
    }
  }

  /** Fan out a batch of room emits, then run any follow-up local resolution. */
  private async flush(room: GameRoom, emits: Emit[]): Promise<void> {
    for (const e of emits) {
      switch (e.type) {
        case 'rolesUpdated':
          await this.deliverSimulatedRoles(room);
          break;
        case 'state':
          this.broadcastState(room);
          break;
        case 'meetingStarted':
          this.io.to(room.code).emit('meetingStarted', {
            reason: e.reason,
            endsAt: e.endsAt,
          });
          break;
        case 'meetingResult':
          this.io.to(room.code).emit('meetingResult', e.result);
          break;
        case 'gameEnded':
          this.io.to(room.code).emit('gameEnded', e.end);
          break;
        case 'playerPurged':
          this.io.to(room.code).emit('playerPurged', {
            victimSeat: e.victimSeat,
          });
          break;
        case 'toast':
          if (e.to) this.io.to(e.to).emit('toast', { kind: e.kind, text: e.text });
          else this.io.to(room.code).emit('toast', { kind: e.kind, text: e.text });
          break;
        case 'gameStarted':
          break;
      }
    }

    // Simulated mode resolves its own reveals; Inco mode waits for a client.
    const follow: Emit[] = [
      ...(await room.resolveEjectionLocally()),
      ...(await room.resolveFinalRevealLocally()),
    ];
    if (follow.length) await this.flush(room, follow);
  }

  private start(): void {
    // Every tick, not every other one. The default was 2, which made the
    // "20Hz" the client interpolates against actually 10Hz — a 100ms gap
    // between authoritative positions, on top of tunnel latency. The payload
    // is a seat, two rounded ints and two flags per player; at ten players
    // that is a few hundred bytes twenty times a second.
    const every = this.config.positionEveryTicks ?? 1;
    this.timer = setInterval(() => {
      this.tickCount++;
      for (const room of [...this.rooms.values()]) {
        const emits = room.tick();
        if (emits.length) void this.flush(room, emits);
        if (
          (room.phase === 'playing' || room.phase === 'meeting') &&
          this.tickCount % every === 0
        ) {
          for (const p of room.players.values()) {
            if (!p.isBot && p.connected && this.socketRoom.get(p.id) === room.code) {
              this.io.to(p.id).emit('positions', room.positionsPayload(p.id));
            }
          }
        }
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed for tests. */
  roomFor(code: string): GameRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }
}
