/**
 * Wire protocol and game state types shared by server and client.
 *
 * IMPORTANT: nothing in here carries a player's role. The server never learns
 * who the Parasite is — roles live only as Inco ciphertext handles on-chain,
 * decryptable solely by the player they belong to. See docs/inco.md §10.
 */

import type { TaskId } from './constants.js';

// ── Identity ─────────────────────────────────────────────────────────────────

/** Stable per-connection player id issued by the server. */
export type PlayerId = string;

/**
 * A player's index in the game, 0..n-1, fixed at game start.
 *
 * The seat is the unit of identity the *contract* uses: the encrypted host
 * identity is an euint256 seat index. Seats never change during a game, even
 * when players die, so the encrypted seat maps cleanly to a wallet address.
 */
export type Seat = number;

export type SkinId = 0 | 1 | 2 | 3;

// ── Public player state ──────────────────────────────────────────────────────

/** One line of room chat. */
export interface ChatMessage {
  seat: Seat;
  name: string;
  text: string;
  /** Unix ms, server-stamped. */
  at: number;
  /**
   * Sent by a dead player. The dead can talk among themselves without the
   * living hearing it, so this decides who the server fans it out to and how
   * the client renders it.
   */
  ghost: boolean;
}

export interface PublicPlayer {
  id: PlayerId;
  seat: Seat;
  name: string;
  skin: SkinId;
  /** Wallet address if connected, else null. Needed to grant Inco access. */
  address: string | null;
  x: number;
  y: number;
  /** Facing, for sprite flip. */
  dir: -1 | 1;
  moving: boolean;
  alive: boolean;
  /**
   * Whether the body has been reported/found. A dead player's corpse is
   * visible on the map until reported.
   */
  bodyReported: boolean;
  connected: boolean;
  /**
   * A server-driven filler player.
   *
   * Public on purpose. A lobby that quietly pads itself with bots and does not
   * say so is lying to the player about who they are deducing against — and
   * since bots are never assigned the Parasite (see GameRoom.botSeats), hiding
   * the flag would also hide a real piece of game information.
   */
  isBot: boolean;
  /** Public count only — which tasks are done is public in Among Us too. */
  tasksDone: number;
  emergencyMeetingsLeft: number;
}

// ── Phases ───────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'lobby'
  | 'assigning' // waiting for on-chain encrypted role assignment
  | 'playing'
  | 'meeting'
  | 'ended';

export type MeetingStage = 'discussion' | 'voting' | 'result';

export type MeetingReason =
  | { kind: 'emergency'; callerSeat: Seat }
  | { kind: 'body'; reporterSeat: Seat; victimSeat: Seat };

export interface MeetingState {
  stage: MeetingStage;
  reason: MeetingReason;
  /** Unix ms when the current stage ends. */
  endsAt: number;
  /** seat -> voted seat, or 'skip'. Only who HAS voted is public until tally. */
  votes: Record<Seat, Seat | 'skip'>;
  /** Populated only in the 'result' stage. */
  result: MeetingResult | null;
}

export interface MeetingResult {
  /** null = no ejection (tie or skip majority). */
  ejectedSeat: Seat | null;
  tie: boolean;
  tally: Record<string, number>;
  /**
   * Whether the ejected player was the Parasite's host.
   *
   * This is the ONE bit the contract deliberately reveals on ejection (via
   * e.reveal on a derived ebool). It is null until the reveal resolves, and
   * null forever if no one was ejected.
   */
  ejectedWasParasite: boolean | null;
}

export type EndReason =
  | 'crew-tasks'
  | 'crew-ejected-parasite'
  | 'parasite-outnumber'
  | 'aborted';

export interface EndState {
  winner: 'crew' | 'parasite';
  reason: EndReason;
  /** Final host seat, revealed on-chain at game over. null if unrevealed. */
  revealedParasiteSeat: Seat | null;
}

// ── Room state (the full public snapshot) ────────────────────────────────────

export interface RoomState {
  code: string;
  phase: GamePhase;
  hostId: PlayerId;
  players: PublicPlayer[];
  /** Corpses on the map: seat -> position. */
  bodies: { seat: Seat; x: number; y: number }[];
  meeting: MeetingState | null;
  end: EndState | null;
  /** Total tasks completed across all crew / total required. */
  taskProgress: { done: number; total: number };
  /**
   * On-chain game id, set when role assignment happens in Inco mode.
   * null in simulated mode.
   */
  chainGameId: string | null;
  /** Which role backend is live. Surfaced in the HUD, never hidden. */
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
}

// ── Client → Server ──────────────────────────────────────────────────────────

export interface ClientToServerEvents {
  sendChat: (payload: { text: string }, ack?: (res: SimpleResult) => void) => void;
  join: (
    payload: { code: string; name: string; skin: SkinId; address: string | null },
    ack: (res: JoinResult) => void
  ) => void;
  /** Continuous movement input. Direction is normalized server-side. */
  input: (payload: { ax: number; ay: number; seq: number }) => void;
  startGame: (ack: (res: SimpleResult) => void) => void;
  taskProgress: (
    payload: { taskId: TaskId; progress: number },
    ack: (res: SimpleResult) => void
  ) => void;
  completeTask: (payload: { taskId: TaskId }, ack: (res: SimpleResult) => void) => void;
  callMeeting: (ack: (res: SimpleResult) => void) => void;
  reportBody: (payload: { victimSeat: Seat }, ack: (res: SimpleResult) => void) => void;
  castVote: (payload: { target: Seat | 'skip' }, ack: (res: SimpleResult) => void) => void;
  /**
   * The Parasite's kill. The server cannot verify the caller is the Parasite
   * (it does not know), so it verifies everything it CAN — proximity, liveness,
   * cooldown, phase — and the contract is the authority on whether the caller
   * was actually entitled. See docs/inco.md §10 and DECISIONS.md.
   */
  purge: (payload: { targetSeat: Seat }, ack: (res: SimpleResult) => void) => void;
  /**
   * Announce a jump attempt so the server can run the public-side effects
   * (cooldown, proximity check). Carries NO information about whether the
   * caller is actually the Parasite — decoys look identical.
   */
  jumpAnnounce: (payload: { targetSeat: Seat }, ack: (res: SimpleResult) => void) => void;
  /** Reveal results coming back from chain, submitted by any client. */
  submitEjectionReveal: (
    payload: { wasParasite: boolean },
    ack: (res: SimpleResult) => void
  ) => void;
  leaveLobby: (ack: (res: SimpleResult) => void) => void;
}

// ── Server → Client ──────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  /** Full authoritative snapshot. Sent on any structural change. */
  state: (state: RoomState) => void;
  /** High-frequency positions only, to keep the 20Hz tick cheap. */
  positions: (
    payload: { t: number; p: { s: Seat; x: number; y: number; d: -1 | 1; m: boolean }[] }
  ) => void;
  /** You are this player. Sent once on join. */
  you: (payload: { id: PlayerId; seat: Seat }) => void;
  /**
   * Game started — go do your on-chain role lookup. Carries the seat->address
   * table the client needs to interact with the contract.
   */
  gameStarted: (payload: {
    chainGameId: string | null;
    seats: { seat: Seat; address: string | null }[];
  }) => void;
  meetingStarted: (payload: { reason: MeetingReason; endsAt: number }) => void;
  meetingResult: (payload: MeetingResult) => void;
  gameEnded: (payload: EndState) => void;
  /**
   * SIMULATED MODE ONLY — the player's own role, sent to that one socket.
   *
   * This event does not exist in Inco mode, where the server has no oracle and
   * roles are read from chain by the owning wallet. It is the honest shape of
   * the fallback: a server that knows the roles and tells each player theirs.
   * The HUD labels this mode SIMULATED precisely because of this event.
   */
  simulatedRole: (payload: { isParasite: boolean }) => void;
  /** Someone died. Public — everyone sees the body eventually. */
  playerPurged: (payload: { victimSeat: Seat; x: number; y: number }) => void;
  toast: (payload: { kind: 'info' | 'warn' | 'error'; text: string }) => void;
  kicked: (payload: { reason: string }) => void;
  chat: (payload: ChatMessage) => void;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  you?: { id: PlayerId; seat: Seat };
  state?: RoomState;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

// ── Vote tallying (pure, shared, unit-tested) ────────────────────────────────

/**
 * Standard Among Us tally: highest vote count is ejected; a tie between the top
 * candidates means NO ejection. "skip" participates as a candidate — if skip
 * ties with a player, that is still a tie and nobody goes.
 */
export function tallyVotes(votes: Record<Seat, Seat | 'skip'>): {
  ejectedSeat: Seat | null;
  tie: boolean;
  tally: Record<string, number>;
} {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    const key = String(target);
    tally[key] = (tally[key] ?? 0) + 1;
  }

  const entries = Object.entries(tally);
  if (entries.length === 0) {
    return { ejectedSeat: null, tie: false, tally };
  }

  let max = -1;
  for (const [, count] of entries) if (count > max) max = count;
  const top = entries.filter(([, count]) => count === max).map(([key]) => key);

  if (top.length > 1) return { ejectedSeat: null, tie: true, tally };
  const winner = top[0]!;
  if (winner === 'skip') return { ejectedSeat: null, tie: false, tally };
  return { ejectedSeat: Number(winner), tie: false, tally };
}
