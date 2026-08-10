/**
 * RoleOracle — the confidentiality seam.
 *
 * Everything the game needs to know about hidden roles goes through this
 * interface. There are exactly two implementations:
 *
 *   1. IncoRoleOracle  (packages/web/src/lib/incoRoleOracle.ts)
 *      Real. Talks to the ParasiteGame contract on Base Sepolia. Role bits and
 *      the host seat exist only as Inco ciphertext handles; the client decrypts
 *      its own bit with zap.attestedDecrypt() and literally cannot read anyone
 *      else's, because the contract only ever granted access to that seat.
 *
 *   2. LocalRoleOracle (below)
 *      A SIMULATION used when no contract address is configured, so the game is
 *      playable without a wallet, a funded account, or a deployment. It mirrors
 *      the contract's logic exactly — including the select-based no-op jump —
 *      so behaviour is identical; only the cryptography is absent.
 *
 * The active mode is always shown in the HUD. LocalRoleOracle is never
 * presented as confidential: it runs in one browser tab and would not survive
 * an adversary with devtools. That is the honest statement of what it is.
 */

import type { Seat } from './types.js';

export interface RoleAssignment {
  /** Whether THIS client's seat is the Parasite's current host. */
  isParasite: boolean;
  /**
   * Opaque handle for the caller's encrypted role bit, if the backend has one.
   * Present in Inco mode, null in simulated mode.
   */
  handle: string | null;
}

export interface RoleOracle {
  readonly mode: 'inco' | 'simulated';

  /**
   * Begin a game. Called once by the room host. Picks the Parasite seat
   * secretly and grants each seat access to its own role bit.
   * Returns an opaque game id.
   */
  startGame(params: {
    seats: { seat: Seat; address: string | null }[];
  }): Promise<{ gameId: string }>;

  /**
   * Read MY role. In Inco mode this is an attested decrypt of a handle that
   * only my address was granted. Never returns anyone else's role.
   */
  readMyRole(params: { gameId: string; mySeat: Seat }): Promise<RoleAssignment>;

  /**
   * Attempt a jump into `targetSeat`.
   *
   * Callable by ANY seat. The backend must make it a silent no-op when the
   * caller is not the current host, without revealing that it was a no-op —
   * this is why the contract uses e.select rather than require(). Clients send
   * decoy jumps precisely so this path is exercised by non-Parasites too.
   */
  jump(params: {
    gameId: string;
    callerSeat: Seat;
    targetSeat: Seat;
    /** True for cover traffic. The backend MUST treat it identically. */
    decoy: boolean;
  }): Promise<void>;

  /**
   * Reveal the single bit "was this seat the host?" — used at ejection.
   * This is a deliberate, rules-sanctioned disclosure.
   */
  revealIsHost(params: { gameId: string; seat: Seat }): Promise<boolean>;

  /** Reveal the host seat outright. Only at game over. */
  revealHostSeat(params: { gameId: string }): Promise<Seat>;
}

/**
 * Deterministic-ish PRNG so tests can pin the chosen seat.
 * Mirrors nothing on-chain — the contract uses e.randBounded().
 */
function pickSeat(seats: Seat[], rng: () => number): Seat {
  const i = Math.floor(rng() * seats.length);
  return seats[Math.min(i, seats.length - 1)]!;
}

/**
 * In-process simulation of ParasiteGame.sol.
 *
 * Deliberately written to mirror the contract's *control flow*, so it doubles
 * as an executable spec for the Solidity. Note `jump()` below: it does not
 * branch on "am I the parasite" to decide whether to act — it computes both
 * outcomes and selects, exactly as e.select does on-chain.
 */
export class LocalRoleOracle implements RoleOracle {
  readonly mode = 'simulated' as const;

  private games = new Map<
    string,
    { hostSeat: Seat; seats: Seat[]; nonce: number }
  >();
  private counter = 0;
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  async startGame(params: {
    seats: { seat: Seat; address: string | null }[];
  }): Promise<{ gameId: string }> {
    const seats = params.seats.map((s) => s.seat);
    if (seats.length === 0) throw new Error('no seats');
    const gameId = `local-${++this.counter}`;
    this.games.set(gameId, {
      hostSeat: pickSeat(seats, this.rng),
      seats,
      nonce: 0,
    });
    return { gameId };
  }

  async readMyRole(params: {
    gameId: string;
    mySeat: Seat;
  }): Promise<RoleAssignment> {
    const g = this.mustGet(params.gameId);
    return { isParasite: g.hostSeat === params.mySeat, handle: null };
  }

  async jump(params: {
    gameId: string;
    callerSeat: Seat;
    targetSeat: Seat;
    decoy: boolean;
  }): Promise<void> {
    const g = this.mustGet(params.gameId);

    // Mirrors the contract:
    //   ebool callerIsHost = e.eq(hostSeat, callerSeat);
    //   hostSeat = e.select(callerIsHost, targetSeat, hostSeat);
    // Both outcomes are computed; neither the caller nor an observer learns
    // which was taken. `decoy` is intentionally UNUSED — a decoy and a real
    // jump must follow byte-identical paths.
    const callerIsHost = g.hostSeat === params.callerSeat;
    const validTarget = g.seats.includes(params.targetSeat);
    g.hostSeat = callerIsHost && validTarget ? params.targetSeat : g.hostSeat;
    g.nonce += 1;
  }

  async revealIsHost(params: { gameId: string; seat: Seat }): Promise<boolean> {
    const g = this.mustGet(params.gameId);
    return g.hostSeat === params.seat;
  }

  async revealHostSeat(params: { gameId: string }): Promise<Seat> {
    return this.mustGet(params.gameId).hostSeat;
  }

  private mustGet(gameId: string) {
    const g = this.games.get(gameId);
    if (!g) throw new Error(`unknown game ${gameId}`);
    return g;
  }
}
