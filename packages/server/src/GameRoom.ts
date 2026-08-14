import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PLAYER_SPEED,
  TICK_MS,
  MAX_MOVE_PER_INPUT,
  TASK_IDS,
  TASKS_PER_PLAYER,
  TASK_STATIONS,
  TASK_INTERACT_RADIUS,
  AREAS,
  PURGE_RANGE,
  PURGE_COOLDOWN_MS,
  JUMP_RANGE,
  JUMP_COOLDOWN_MS,
  REPORT_BODY_RADIUS,
  MEETING_DISCUSSION_MS,
  MEETING_VOTING_MS,
  MEETING_RESULT_MS,
  EMERGENCY_MEETINGS_PER_PLAYER,
  PARASITE_WIN_CREW_THRESHOLD,
  SPAWN_CENTER,
  SPAWN_RADIUS,
  resolveMove,
  distance,
  tallyVotes,
  type PlayerId,
  type Seat,
  type SkinId,
  type PublicPlayer,
  type RoomState,
  type GamePhase,
  type MeetingState,
  type MeetingReason,
  type MeetingResult,
  type EndState,
  type TaskId,
  type RoleOracle,
} from '@parasite/shared';

export interface RoomPlayer extends PublicPlayer {
  /** Which of this player's tasks are done. */
  tasks: Set<TaskId>;
  /** Server-side input state. */
  ax: number;
  ay: number;
  lastPurgeAt: number;
  lastJumpAt: number;
  /** Bot steering. Absent on humans. */
  bot?: BotBrain;
}

/**
 * A bot's private state.
 *
 * Bots are ordinary RoomPlayers that happen to have no socket, so every rule
 * already written — movement, collision, task validation, meetings, win
 * conditions — applies to them without a single special case. Only the
 * *intent* is synthesised, and that is all this holds.
 */
interface BotBrain {
  /** Where it is walking. */
  target: { x: number; y: number } | null;
  /** Which task it is walking to, if any. */
  taskId: TaskId | null;
  /** Wall-clock ms at which the current action completes. */
  actAt: number;
  /** For unsticking: last position sampled, and when. */
  lastX: number;
  lastY: number;
  stuckSince: number;
  /** When this bot will cast its vote in the current meeting. */
  voteAt: number;
}

export interface MeetingTimings {
  discussionMs: number;
  votingMs: number;
  resultMs: number;
}

export interface GameRoomOptions {
  code: string;
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
  /**
   * Only supplied in simulated mode. In Inco mode the server has NO oracle and
   * therefore genuinely cannot learn any player's role — reveals must come back
   * from a client that performed the on-chain call.
   */
  localOracle?: RoleOracle;
  now?: () => number;
  /**
   * Meeting stage durations. Defaults come from the shared constants; tests
   * override them so an integration run does not have to sit through a real
   * 15-second discussion phase.
   */
  timings?: Partial<MeetingTimings>;
}

export type Emit =
  | { type: 'state' }
  | { type: 'gameStarted'; chainGameId: string | null }
  | { type: 'meetingStarted'; reason: MeetingReason; endsAt: number }
  | { type: 'meetingResult'; result: MeetingResult }
  | { type: 'gameEnded'; end: EndState }
  | { type: 'playerPurged'; victimSeat: Seat; x: number; y: number }
  | { type: 'toast'; kind: 'info' | 'warn' | 'error'; text: string; to?: PlayerId };

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const OK: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/**
 * Authoritative game room.
 *
 * Deliberately transport-free: it takes actions in, mutates state, and returns
 * a list of things to broadcast. The Socket.io layer is a thin adapter over
 * this, which is what makes the whole rules engine unit-testable without
 * opening a port.
 *
 * ── What this class knows, and what it must never know ──────────────────────
 *
 * It owns all PUBLIC state: positions, task progress, meetings, votes,
 * liveness, win conditions. It does NOT know who the Parasite is, and in Inco
 * mode it has no way to find out — role bits live on-chain as ciphertext
 * granted only to individual players. That is the point of the design, and it
 * shapes several decisions below (see `purge` and `taskTotal`).
 */
export class GameRoom {
  readonly code: string;
  readonly roleMode: 'inco' | 'simulated';
  readonly contractAddress: string | null;

  phase: GamePhase = 'lobby';
  hostId: PlayerId | null = null;
  players = new Map<PlayerId, RoomPlayer>();
  bodies: { seat: Seat; x: number; y: number }[] = [];
  meeting: MeetingState | null = null;
  end: EndState | null = null;
  chainGameId: string | null = null;

  private localOracle: RoleOracle | undefined;
  private now: () => number;
  private timings: MeetingTimings;
  private nextSeat = 0;
  private lastTickAt: number;
  /** Seat awaiting an ejection reveal, if any. */
  private pendingEjection: Seat | null = null;

  constructor(opts: GameRoomOptions) {
    this.code = opts.code;
    this.roleMode = opts.roleMode;
    this.contractAddress = opts.contractAddress;
    this.localOracle = opts.localOracle;
    this.now = opts.now ?? (() => Date.now());
    this.timings = {
      discussionMs: opts.timings?.discussionMs ?? MEETING_DISCUSSION_MS,
      votingMs: opts.timings?.votingMs ?? MEETING_VOTING_MS,
      resultMs: opts.timings?.resultMs ?? MEETING_RESULT_MS,
    };
    this.lastTickAt = this.now();
  }

  // ── Membership ─────────────────────────────────────────────────────────────

  /**
   * Join the lobby.
   *
   * Both spec constraints are enforced HERE, server-side, not in the UI:
   *   • hard cap of MAX_PLAYERS
   *   • lobby-only joining — once the game starts, this rejects unconditionally
   */
  join(
    id: PlayerId,
    name: string,
    skin: SkinId,
    address: string | null
  ): { result: ActionResult; player?: RoomPlayer } {
    if (this.phase !== 'lobby') {
      return {
        result: fail('Game already in progress — you can only join from the lobby.'),
      };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return { result: fail(`Lobby is full (${MAX_PLAYERS} players max).`) };
    }
    if (this.players.has(id)) {
      return { result: fail('Already joined.') };
    }

    const clean = (name ?? '').trim().slice(0, 16) || `Scientist ${this.nextSeat + 1}`;
    const seat = this.nextSeat++;
    const angle = (seat / MAX_PLAYERS) * Math.PI * 2;

    const player: RoomPlayer = {
      id,
      seat,
      name: clean,
      skin: (skin ?? 0) as SkinId,
      address: address ?? null,
      x: SPAWN_CENTER.x + Math.cos(angle) * SPAWN_RADIUS,
      y: SPAWN_CENTER.y + Math.sin(angle) * SPAWN_RADIUS,
      dir: 1,
      moving: false,
      alive: true,
      bodyReported: false,
      connected: true,
      isBot: false,
      tasksDone: 0,
      emergencyMeetingsLeft: EMERGENCY_MEETINGS_PER_PLAYER,
      tasks: new Set(),
      ax: 0,
      ay: 0,
      lastPurgeAt: 0,
      lastJumpAt: 0,
    };

    this.players.set(id, player);
    if (this.hostId === null) this.hostId = id;
    return { result: OK, player };
  }

  /**
   * Handle a disconnect.
   *
   * In the lobby, leaving frees the slot. Mid-game it does NOT — the spec says
   * no mid-game leaving, and removing a player would change the seat count the
   * contract already committed to. The seat stays, marked disconnected, and the
   * body stays on the board.
   */
  disconnect(id: PlayerId): void {
    const p = this.players.get(id);
    if (!p) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.reseat();
      if (this.hostId === id) {
        this.hostId = this.players.keys().next().value ?? null;
      }
      return;
    }

    p.connected = false;
    p.ax = 0;
    p.ay = 0;
    // A disconnected player cannot be the reason the game stalls in a vote.
    if (this.phase === 'meeting' && this.meeting?.stage === 'voting') {
      if (this.meeting.votes[p.seat] === undefined) {
        this.meeting.votes[p.seat] = 'skip';
      }
    }
  }

  /** Reconnect to an existing seat (lobby-phase reconnects only). */
  isEmpty(): boolean {
    // Bots do not keep a room alive. Without this, the last human leaving would
    // leave a lobby of bots running forever and never be reaped.
    return this.humanCount() === 0;
  }

  /** Seats are re-packed in the lobby so the contract gets a dense 0..n-1 array. */
  private reseat(): void {
    let i = 0;
    for (const p of this.players.values()) p.seat = i++;
    this.nextSeat = i;
  }

  // ── Game start ─────────────────────────────────────────────────────────────

  canStart(): ActionResult {
    if (this.phase !== 'lobby') return fail('Game already started.');
    if (this.players.size < MIN_PLAYERS) {
      return fail(`Need at least ${MIN_PLAYERS} players (have ${this.players.size}).`);
    }
    if (this.players.size > MAX_PLAYERS) {
      return fail(`Too many players (max ${MAX_PLAYERS}).`);
    }
    return OK;
  }

  /**
   * Start the game. Role assignment itself happens off this path:
   *   • simulated mode — the room's LocalRoleOracle picks the Parasite now
   *   • Inco mode — the host's client sends createGame() to the contract and
   *     reports the resulting game id back via setChainGameId()
   */
  async startGame(byId: PlayerId): Promise<ActionResult> {
    if (byId !== this.hostId) return fail('Only the lobby host can start the game.');
    const can = this.canStart();
    if (!can.ok) return can;

    this.phase = 'assigning';

    if (this.roleMode === 'simulated' && this.localOracle) {
      // Humans only. A bot has no wallet, so in Inco mode it could never
      // decrypt a role it was given — it would be a Parasite that does not
      // know it is one, and the round would be unwinnable. Excluded in
      // simulated mode too, so both modes behave identically.
      const seats = [...this.players.values()]
        .filter((p) => !p.isBot)
        .map((p) => ({ seat: p.seat, address: p.address }));
      const { gameId } = await this.localOracle.startGame({ seats });
      this.chainGameId = gameId;
    }

    this.phase = 'playing';
    this.lastTickAt = this.now();
    return OK;
  }

  /** Inco mode: the host reports the on-chain game id after createGame(). */
  setChainGameId(id: string): void {
    this.chainGameId = id;
  }


  // ── Bots ───────────────────────────────────────────────────────────────────
  //
  // A lobby that cannot reach MIN_PLAYERS is unplayable, which meant anyone
  // opening the link alone — a judge included — could look at the game but not
  // play it. Bots fill the gap and step aside as real players arrive.

  /** Names drawn in order so a lobby does not show "Bot 1, Bot 2". */
  private static readonly BOT_NAMES = [
    'Adeyemi', 'Novak', 'Sato', 'Okonkwo', 'Rivera',
    'Haddad', 'Lindqvist', 'Mensah', 'Petrov', 'Duarte',
  ];

  /** Seats currently held by bots. */
  botSeats(): Seat[] {
    return [...this.players.values()].filter((p) => p.isBot).map((p) => p.seat);
  }

  private humanCount(): number {
    return [...this.players.values()].filter((p) => !p.isBot).length;
  }

  /**
   * Bring the lobby up to MIN_PLAYERS with bots, and drop bots again as humans
   * arrive. Lobby-only: seats are fixed once a game starts, so a bot that made
   * it to the start line plays the round out.
   */
  syncBots(): boolean {
    if (this.phase !== 'lobby') return false;
    let changed = false;

    // Humans first: a bot must never cost a real player a seat.
    while (this.players.size > Math.max(MIN_PLAYERS, this.humanCount())) {
      const bots = [...this.players.values()].filter((p) => p.isBot);
      if (bots.length === 0) break;
      const drop = bots.reduce((a, b) => (a.seat > b.seat ? a : b));
      this.players.delete(drop.id);
      changed = true;
    }

    // Nobody at all means an empty room, not a room full of bots.
    if (this.humanCount() === 0) {
      for (const p of [...this.players.values()]) {
        if (p.isBot) {
          this.players.delete(p.id);
          changed = true;
        }
      }
      return changed;
    }

    while (this.players.size < MIN_PLAYERS && this.players.size < MAX_PLAYERS) {
      this.addBot();
      changed = true;
    }
    return changed;
  }

  private addBot(): void {
    const seat = this.nextSeat++;
    const angle = (seat / MAX_PLAYERS) * Math.PI * 2;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name =
      GameRoom.BOT_NAMES.find((n) => !used.has(n)) ?? `Scientist ${seat + 1}`;

    const bot: RoomPlayer = {
      id: `bot:${seat}`,
      seat,
      name,
      skin: (seat % 4) as SkinId,
      // No wallet: a bot cannot decrypt anything, which is also why it is never
      // eligible to be the Parasite.
      address: null,
      x: SPAWN_CENTER.x + Math.cos(angle) * SPAWN_RADIUS,
      y: SPAWN_CENTER.y + Math.sin(angle) * SPAWN_RADIUS,
      dir: 1,
      moving: false,
      alive: true,
      bodyReported: false,
      connected: true,
      isBot: true,
      tasksDone: 0,
      emergencyMeetingsLeft: 0,
      tasks: new Set(),
      ax: 0,
      ay: 0,
      lastPurgeAt: 0,
      lastJumpAt: 0,
      bot: {
        target: null,
        taskId: null,
        actAt: 0,
        lastX: 0,
        lastY: 0,
        stuckSince: 0,
        voteAt: 0,
      },
    };
    this.players.set(bot.id, bot);
  }

  /**
   * Drive every bot for one tick.
   *
   * Deliberately writes `ax`/`ay` rather than moving anyone directly, so bots
   * go through exactly the same movement, collision and walkability path as a
   * human holding a key. A bot cannot end up somewhere a player could not.
   */
  private stepBots(now: number): Emit[] {
    const emits: Emit[] = [];

    for (const p of this.players.values()) {
      const b = p.bot;
      if (!b || !p.alive) {
        if (b) {
          p.ax = 0;
          p.ay = 0;
        }
        continue;
      }

      if (this.phase === 'meeting') {
        p.ax = 0;
        p.ay = 0;
        continue;
      }
      if (this.phase !== 'playing') continue;

      // Mid-task: stand still until it finishes.
      if (b.actAt > now) {
        p.ax = 0;
        p.ay = 0;
        continue;
      }

      // Arrived at a task station: complete it through the public entry point
      // so range and phase are validated the same as for a human.
      if (b.taskId && b.target && distance(p, b.target) <= TASK_INTERACT_RADIUS) {
        const { emits: e } = this.completeTask(p.id, b.taskId);
        emits.push(...e);
        b.taskId = null;
        b.target = null;
        // A pause, so a bot does not clear five stations in one sprint.
        b.actAt = now + 2500 + Math.floor(Math.random() * 2500);
        p.ax = 0;
        p.ay = 0;
        continue;
      }

      if (!b.target) this.retargetBot(p, b);
      if (!b.target) continue;

      // Unstick: walls are axis-aligned and bots walk straight lines, so a bot
      // can press into a corner indefinitely. If it has not moved in a second,
      // pick somewhere else.
      if (Math.hypot(p.x - b.lastX, p.y - b.lastY) < 2) {
        if (b.stuckSince === 0) b.stuckSince = now;
        else if (now - b.stuckSince > 1000) {
          this.retargetBot(p, b, true);
          b.stuckSince = 0;
        }
      } else {
        b.stuckSince = 0;
      }
      b.lastX = p.x;
      b.lastY = p.y;

      const dx = b.target.x - p.x;
      const dy = b.target.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 6) {
        b.target = null;
        p.ax = 0;
        p.ay = 0;
        continue;
      }
      p.ax = dx / len;
      p.ay = dy / len;
    }

    return emits;
  }

  /** Choose the next place a bot walks to: an unfinished task, else a wander. */
  private retargetBot(p: RoomPlayer, b: BotBrain, forceWander = false): void {
    const undone = TASK_IDS.filter((t) => !p.tasks.has(t));
    if (!forceWander && undone.length > 0 && Math.random() < 0.75) {
      const id = undone[Math.floor(Math.random() * undone.length)]!;
      b.taskId = id;
      b.target = { ...TASK_STATIONS[id] };
      return;
    }
    // Wander to a random room centre, which is always walkable by construction.
    const rooms = AREAS.filter((a) => a.id !== 'path');
    const room = rooms[Math.floor(Math.random() * rooms.length)]!;
    b.taskId = null;
    b.target = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  }

  /** Bots vote once the ballot is open, after a human-ish pause. */
  private stepBotVotes(now: number): boolean {
    const m = this.meeting;
    if (!m || m.stage !== 'voting') return false;
    let voted = false;

    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of this.players.values()) {
      const b = p.bot;
      if (!b || !p.alive) continue;
      if (m.votes[p.seat] !== undefined) continue;
      if (b.voteAt === 0) {
        b.voteAt = now + 3000 + Math.floor(Math.random() * 9000);
        continue;
      }
      if (now < b.voteAt) continue;

      // A bot has no information, so it must not pretend to: it skips most of
      // the time rather than throwing a random accusation that reads as a
      // signal to the humans reading the vote.
      const others = alive.filter((o) => o.seat !== p.seat);
      const target =
        Math.random() < 0.6 || others.length === 0
          ? 'skip'
          : others[Math.floor(Math.random() * others.length)]!.seat;
      const res = this.castVote(p.id, target as Seat | 'skip');
      if (res.ok) voted = true;
    }
    return voted;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  setInput(id: PlayerId, ax: number, ay: number): void {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    // Normalize so diagonal movement is not faster.
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    p.ax = ax;
    p.ay = ay;
  }

  /** Advance the simulation. Returns anything that must be broadcast. */
  tick(): Emit[] {
    const now = this.now();
    const dtMs = Math.min(now - this.lastTickAt, TICK_MS * 5);
    this.lastTickAt = now;
    const dt = dtMs / 1000;
    const emits: Emit[] = [];

    // Bots decide before movement integrates, so their intent is applied on
    // the same tick as a human's held key rather than one behind it.
    emits.push(...this.stepBots(now));
    // castVote mutates the meeting but emits nothing by itself — a socket vote
    // is broadcast by the caller in GameServer. Bot votes have no caller, so
    // without this the tally sat at "0/4 votes in" on every client for the
    // whole voting window while the server counted them silently.
    if (this.stepBotVotes(now)) emits.push({ type: 'state' });

    if (this.phase === 'playing') {
      for (const p of this.players.values()) {
        if (!p.alive || (p.ax === 0 && p.ay === 0)) {
          p.moving = false;
          continue;
        }
        let nx = p.x + p.ax * PLAYER_SPEED * dt;
        let ny = p.y + p.ay * PLAYER_SPEED * dt;

        // Anti-teleport: never let one step exceed the physical maximum.
        const step = Math.hypot(nx - p.x, ny - p.y);
        if (step > MAX_MOVE_PER_INPUT) {
          const k = MAX_MOVE_PER_INPUT / step;
          nx = p.x + (nx - p.x) * k;
          ny = p.y + (ny - p.y) * k;
        }

        const resolved = resolveMove(p.x, p.y, nx, ny);
        p.moving = resolved.x !== p.x || resolved.y !== p.y;
        if (p.ax !== 0) p.dir = p.ax > 0 ? 1 : -1;
        p.x = resolved.x;
        p.y = resolved.y;
      }
    }

    if (this.phase === 'meeting' && this.meeting) {
      emits.push(...this.tickMeeting(now));
    }

    return emits;
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  /**
   * Total tasks required for a crew victory.
   *
   * Note `players.size - 1`: exactly one player is the Parasite and will never
   * submit task completions (they have no incentive to — finishing tasks helps
   * the crew win). Counting all n players would make the bar unreachable. This
   * is how the server tracks progress without knowing WHICH player is excluded.
   */
  taskTotal(): number {
    return Math.max(0, this.players.size - 1) * TASKS_PER_PLAYER;
  }

  taskDone(): number {
    let n = 0;
    for (const p of this.players.values()) n += p.tasks.size;
    return Math.min(n, this.taskTotal());
  }

  completeTask(id: PlayerId, taskId: TaskId): { result: ActionResult; emits: Emit[] } {
    const p = this.players.get(id);
    if (!p) return { result: fail('Not in this game.'), emits: [] };
    if (this.phase !== 'playing') {
      return { result: fail('Tasks can only be completed during play.'), emits: [] };
    }
    if (!TASK_IDS.includes(taskId)) {
      return { result: fail('Unknown task.'), emits: [] };
    }
    if (p.tasks.has(taskId)) return { result: fail('Task already complete.'), emits: [] };

    // Proximity is re-checked server-side; the client cannot claim a task from
    // across the map.
    const station = TASK_STATIONS[taskId];
    if (distance(p, station) > TASK_INTERACT_RADIUS) {
      return { result: fail('Too far from the task station.'), emits: [] };
    }

    p.tasks.add(taskId);
    p.tasksDone = p.tasks.size;

    const emits: Emit[] = [{ type: 'state' }];
    if (this.taskDone() >= this.taskTotal() && this.taskTotal() > 0) {
      emits.push(...this.endGame('crew', 'crew-tasks'));
    }
    return { result: OK, emits };
  }

  // ── Purge (the Parasite's kill) ────────────────────────────────────────────

  /**
   * Kill a player.
   *
   * ⚠️ TRUST BOUNDARY, stated plainly: the server CANNOT verify that the caller
   * is the Parasite, because it does not know who the Parasite is — that is the
   * whole point of the Inco design. It verifies everything it can (phase,
   * liveness, proximity, cooldown, not-self), and trusts the client on the one
   * predicate only the chain can answer.
   *
   * A modified client could therefore purge while human. Closing this would need
   * the kill to be settled on-chain with an attested decrypt of the caller's role
   * bit, which costs a round trip per kill and was out of scope for the deadline.
   * Recorded in DECISIONS.md and BUILD_REPORT.md rather than glossed over.
   */
  purge(id: PlayerId, targetSeat: Seat): { result: ActionResult; emits: Emit[] } {
    const p = this.players.get(id);
    if (!p) return { result: fail('Not in this game.'), emits: [] };
    if (this.phase !== 'playing') return { result: fail('Not during a meeting.'), emits: [] };
    if (!p.alive) return { result: fail('You are dead.'), emits: [] };

    const now = this.now();
    if (now - p.lastPurgeAt < PURGE_COOLDOWN_MS) {
      return { result: fail('Purge is still recharging.'), emits: [] };
    }

    const victim = this.bySeat(targetSeat);
    if (!victim) return { result: fail('No such player.'), emits: [] };
    if (victim.id === p.id) return { result: fail('You cannot purge yourself.'), emits: [] };
    if (!victim.alive) return { result: fail('Already dead.'), emits: [] };
    if (distance(p, victim) > PURGE_RANGE) {
      return { result: fail('Target is out of range.'), emits: [] };
    }

    victim.alive = false;
    victim.ax = 0;
    victim.ay = 0;
    this.bodies.push({ seat: victim.seat, x: victim.x, y: victim.y });
    p.lastPurgeAt = now;
    // The killer is moved onto the victim's tile, as in the genre.
    p.x = victim.x;
    p.y = victim.y;

    const emits: Emit[] = [
      { type: 'playerPurged', victimSeat: victim.seat, x: victim.x, y: victim.y },
      { type: 'state' },
    ];
    emits.push(...this.checkParasiteWin());
    return { result: OK, emits };
  }

  // ── Jump (public side effects only) ────────────────────────────────────────

  /**
   * Validate the PUBLIC preconditions for a jump: proximity and cooldown.
   *
   * This deliberately reveals nothing. It is called by every client — the real
   * Parasite and the decoys alike — and returns the same answers to all of them.
   *
   * In Inco mode the actual identity transfer happens on-chain in
   * ParasiteGame.jump(); the server never learns whether this call corresponded
   * to a real jump, and nothing below changes that.
   *
   * In simulated mode there is no chain — the room's LocalRoleOracle IS the
   * mechanism, and it already mirrors the contract's own select-based no-op
   * (see roleOracle.ts: both outcomes are computed, decoy and real calls take
   * the identical path). Calling it here does not leak who the caller is; the
   * server already privately knows the host in this mode, same as it does at
   * game start. Whoever the CURRENT host is after the call gets re-told via
   * deliverSimulatedRoles in the socket handler — for a decoy this is a no-op
   * re-emit of the same value everyone already has.
   */
  async jumpAnnounce(id: PlayerId, targetSeat: Seat): Promise<ActionResult> {
    const p = this.players.get(id);
    if (!p) return fail('Not in this game.');
    if (this.phase !== 'playing') return fail('Not during a meeting.');
    if (!p.alive) return fail('You are dead.');

    const target = this.bySeat(targetSeat);
    if (!target) return fail('No such player.');
    if (target.id === p.id) return fail('You are already in that body.');
    if (!target.alive) return fail('That body is dead.');
    if (distance(p, target) > JUMP_RANGE) return fail('Too far away.');

    const now = this.now();
    if (now - p.lastJumpAt < JUMP_COOLDOWN_MS) return fail('Jump is still recharging.');
    p.lastJumpAt = now;

    if (this.roleMode === 'simulated' && this.localOracle && this.chainGameId) {
      await this.localOracle.jump({
        gameId: this.chainGameId,
        callerSeat: p.seat,
        targetSeat,
        decoy: false, // unused by LocalRoleOracle — kept for interface symmetry with Inco
      });
    }
    return OK;
  }

  // ── Meetings ───────────────────────────────────────────────────────────────

  callMeeting(id: PlayerId): { result: ActionResult; emits: Emit[] } {
    const p = this.players.get(id);
    if (!p) return { result: fail('Not in this game.'), emits: [] };
    if (this.phase !== 'playing') return { result: fail('A meeting is already running.'), emits: [] };
    if (!p.alive) return { result: fail('The dead cannot call meetings.'), emits: [] };
    if (p.emergencyMeetingsLeft <= 0) {
      return { result: fail('You have no emergency meetings left.'), emits: [] };
    }
    if (this.bodies.length > 0) {
      return { result: fail('Report the body instead.'), emits: [] };
    }

    p.emergencyMeetingsLeft -= 1;
    return { result: OK, emits: this.beginMeeting({ kind: 'emergency', callerSeat: p.seat }) };
  }

  reportBody(id: PlayerId, victimSeat: Seat): { result: ActionResult; emits: Emit[] } {
    const p = this.players.get(id);
    if (!p) return { result: fail('Not in this game.'), emits: [] };
    if (this.phase !== 'playing') return { result: fail('Not right now.'), emits: [] };
    if (!p.alive) return { result: fail('The dead cannot report.'), emits: [] };

    const body = this.bodies.find((b) => b.seat === victimSeat);
    if (!body) return { result: fail('No body there.'), emits: [] };
    if (distance(p, body) > REPORT_BODY_RADIUS) {
      return { result: fail('Too far from the body.'), emits: [] };
    }

    const victim = this.bySeat(victimSeat);
    if (victim) victim.bodyReported = true;

    return {
      result: OK,
      emits: this.beginMeeting({ kind: 'body', reporterSeat: p.seat, victimSeat }),
    };
  }

  private beginMeeting(reason: MeetingReason): Emit[] {
    this.phase = 'meeting';
    // Bodies are cleared when a meeting starts, as in the genre.
    this.bodies = [];
    const endsAt = this.now() + this.timings.discussionMs;
    this.meeting = { stage: 'discussion', reason, endsAt, votes: {}, result: null };

    // Everyone returns to the Central Meeting Platform.
    let i = 0;
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of alive) {
      const angle = (i / Math.max(1, alive.length)) * Math.PI * 2;
      p.x = SPAWN_CENTER.x + Math.cos(angle) * SPAWN_RADIUS;
      p.y = SPAWN_CENTER.y + Math.sin(angle) * SPAWN_RADIUS;
      p.ax = 0;
      p.ay = 0;
      p.moving = false;
      i++;
    }

    return [{ type: 'meetingStarted', reason, endsAt }, { type: 'state' }];
  }

  /** Clear per-meeting bot state so timers do not carry across meetings. */
  private resetBotVoteTimers(): void {
    for (const p of this.players.values()) {
      if (p.bot) p.bot.voteAt = 0;
    }
  }

  castVote(id: PlayerId, target: Seat | 'skip'): ActionResult {
    const p = this.players.get(id);
    if (!p) return fail('Not in this game.');
    if (this.phase !== 'meeting' || !this.meeting) return fail('No meeting in progress.');
    if (this.meeting.stage !== 'voting') return fail('Voting has not opened yet.');
    if (!p.alive) return fail('The dead cannot vote.');
    if (this.meeting.votes[p.seat] !== undefined) return fail('You already voted.');

    if (target !== 'skip') {
      const t = this.bySeat(target);
      if (!t) return fail('No such player.');
      if (!t.alive) return fail('You cannot vote for a dead player.');
    }

    this.meeting.votes[p.seat] = target;
    return OK;
  }

  /** True once every living player has voted. */
  private allVotesIn(): boolean {
    if (!this.meeting) return false;
    const alive = [...this.players.values()].filter((p) => p.alive);
    return alive.every((p) => this.meeting!.votes[p.seat] !== undefined);
  }

  private tickMeeting(now: number): Emit[] {
    const m = this.meeting;
    if (!m) return [];
    const emits: Emit[] = [];

    if (m.stage === 'discussion') {
      if (now >= m.endsAt) {
        m.stage = 'voting';
        this.resetBotVoteTimers();
        m.endsAt = now + this.timings.votingMs;
        emits.push({ type: 'state' });
      }
      return emits;
    }

    if (m.stage === 'voting') {
      if (now >= m.endsAt || this.allVotesIn()) {
        const tal = tallyVotes(m.votes);
        const result: MeetingResult = {
          ejectedSeat: tal.ejectedSeat,
          tie: tal.tie,
          tally: tal.tally,
          ejectedWasParasite: null,
        };
        m.result = result;
        m.stage = 'result';
        m.endsAt = now + this.timings.resultMs;

        if (tal.ejectedSeat !== null) {
          const ejected = this.bySeat(tal.ejectedSeat);
          if (ejected) {
            ejected.alive = false;
            ejected.ax = 0;
            ejected.ay = 0;
          }
          this.pendingEjection = tal.ejectedSeat;
        }

        emits.push({ type: 'meetingResult', result }, { type: 'state' });
      }
      return emits;
    }

    // stage === 'result'
    if (now >= m.endsAt) {
      const ejectedSeat = m.result?.ejectedSeat ?? null;
      const wasParasite = m.result?.ejectedWasParasite ?? null;
      this.meeting = null;
      this.pendingEjection = null;
      this.phase = 'playing';
      this.lastTickAt = now;

      if (ejectedSeat !== null && wasParasite === true) {
        emits.push(...this.endGame('crew', 'crew-ejected-parasite'));
        return emits;
      }

      // Note: checkParasiteWin/checkCrewTaskWin may set phase to 'ended' as a
      // side effect, which TypeScript cannot see through the method call — hence
      // checking their return values rather than re-reading this.phase, which
      // narrows to 'playing' after the assignment above.
      const parasiteWin = this.checkParasiteWin();
      emits.push(...parasiteWin);
      if (parasiteWin.length === 0) {
        const crewWin = this.checkCrewTaskWin();
        emits.push(...crewWin);
        if (crewWin.length === 0) emits.push({ type: 'state' });
      }
    }
    return emits;
  }

  /**
   * Record the on-chain ejection reveal — the single bit "was the ejected player
   * the Parasite". In Inco mode this comes back from a client that called
   * `revealEjection`; in simulated mode the room resolves it itself.
   */
  submitEjectionReveal(wasParasite: boolean): Emit[] {
    if (!this.meeting?.result) return [];
    if (this.meeting.result.ejectedWasParasite !== null) return [];
    this.meeting.result.ejectedWasParasite = wasParasite;
    return [{ type: 'meetingResult', result: this.meeting.result }, { type: 'state' }];
  }

  /** Simulated mode only: resolve the reveal from the room's own oracle. */
  async resolveEjectionLocally(): Promise<Emit[]> {    if (this.roleMode !== 'simulated' || !this.localOracle || !this.chainGameId) return [];
    if (this.pendingEjection === null) return [];
    const was = await this.localOracle.revealIsHost({
      gameId: this.chainGameId,
      seat: this.pendingEjection,
    });
    return this.submitEjectionReveal(was);
  }

  get awaitingEjectionReveal(): Seat | null {
    return this.pendingEjection;
  }

  /**
   * SIMULATED MODE ONLY: read a seat's role from the room's local oracle.
   *
   * Returns null in Inco mode — the room has no oracle there and genuinely
   * cannot answer this question, which is the property the design depends on.
   */
  async readRoleForSeat(seat: Seat): Promise<boolean | null> {
    if (this.roleMode !== 'simulated' || !this.localOracle || !this.chainGameId) return null;
    const { isParasite } = await this.localOracle.readMyRole({
      gameId: this.chainGameId,
      mySeat: seat,
    });
    return isParasite;
  }

  // ── Win conditions ─────────────────────────────────────────────────────────

  private aliveCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  /**
   * The Parasite wins when only itself plus PARASITE_WIN_CREW_THRESHOLD crew
   * remain.
   *
   * The server can evaluate this without knowing who the Parasite is: the
   * Parasite can only die by ejection, and an ejection that removes the Parasite
   * ends the game as a crew win before this is ever reached. So any surviving
   * population of size <= threshold+1 necessarily contains the Parasite.
   */
  private checkParasiteWin(): Emit[] {
    if (this.phase === 'ended') return [];
    if (this.aliveCount() <= PARASITE_WIN_CREW_THRESHOLD + 1) {
      return this.endGame('parasite', 'parasite-outnumber');
    }
    return [];
  }

  private checkCrewTaskWin(): Emit[] {
    if (this.phase === 'ended') return [];
    if (this.taskTotal() > 0 && this.taskDone() >= this.taskTotal()) {
      return this.endGame('crew', 'crew-tasks');
    }
    return [];
  }

  endGame(winner: 'crew' | 'parasite', reason: EndState['reason']): Emit[] {
    if (this.phase === 'ended') return [];
    this.phase = 'ended';
    this.meeting = null;
    this.end = { winner, reason, revealedParasiteSeat: null };
    return [{ type: 'gameEnded', end: this.end }, { type: 'state' }];
  }

  /** Final reveal of the host seat, from chain or local oracle. */
  setRevealedParasite(seat: Seat): Emit[] {
    if (!this.end) return [];
    if (this.end.revealedParasiteSeat !== null) return [];
    this.end.revealedParasiteSeat = seat;
    return [{ type: 'gameEnded', end: this.end }, { type: 'state' }];
  }

  async resolveFinalRevealLocally(): Promise<Emit[]> {
    if (this.roleMode !== 'simulated' || !this.localOracle || !this.chainGameId) return [];
    if (!this.end || this.end.revealedParasiteSeat !== null) return [];
    const seat = await this.localOracle.revealHostSeat({ gameId: this.chainGameId });
    return this.setRevealedParasite(seat);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  bySeat(seat: Seat): RoomPlayer | undefined {
    for (const p of this.players.values()) if (p.seat === seat) return p;
    return undefined;
  }

  toState(): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId ?? '',
      players: [...this.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({
          id: p.id,
          seat: p.seat,
          name: p.name,
          skin: p.skin,
          address: p.address,
          x: Math.round(p.x),
          y: Math.round(p.y),
          dir: p.dir,
          moving: p.moving,
          alive: p.alive,
          bodyReported: p.bodyReported,
          connected: p.connected,
          isBot: p.isBot,
          tasksDone: p.tasksDone,
          emergencyMeetingsLeft: p.emergencyMeetingsLeft,
        })),
      bodies: [...this.bodies],
      meeting: this.meeting,
      end: this.end,
      taskProgress: { done: this.taskDone(), total: this.taskTotal() },
      chainGameId: this.chainGameId,
      roleMode: this.roleMode,
      contractAddress: this.contractAddress,
    };
  }

  positionsPayload() {
    return {
      t: this.now(),
      p: [...this.players.values()]
        .filter((p) => p.alive)
        .map((p) => ({
          s: p.seat,
          x: Math.round(p.x),
          y: Math.round(p.y),
          d: p.dir,
          m: p.moving,
        })),
    };
  }
}
