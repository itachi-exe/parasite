import type { PublicPlayer, Seat, TaskId, RoomState, PositionsPayload } from '@parasite/shared';

export type LivePosition = { x: number; y: number; dir: -1 | 1; moving: boolean };
export type LocatedPlayer = PublicPlayer & { x: number; y: number };

/** Only the current sight map grants a location. Never fall back to a snapshot. */
export function playersInSight(players: PublicPlayer[], positions: Map<Seat, LivePosition>): LocatedPlayer[] {
  return players.flatMap((p) => {
    const live = positions.get(p.seat);
    return live ? [{ ...p, ...live }] : [];
  });
}

/** Preserve the Map identity held by the scene while evicting every omitted seat. */
export function replacePositions(positions: Map<Seat, LivePosition>, payload: PositionsPayload): void {
  positions.clear();
  for (const p of payload.p) positions.set(p.s, { x: p.x, y: p.y, dir: p.d, moving: p.m });
}

export function replaceSnapshot(positions: Map<Seat, LivePosition>, state: Pick<RoomState, 'players' | 'bodies'>): void {
  positions.clear();
  for (const p of state.players) {
    if (p.x !== null && p.y !== null) {
      positions.set(p.seat, { x: p.x, y: p.y, dir: p.dir, moving: p.moving });
    }
  }
}

/**
 * What React hands the renderer. Mutated in place by GameStage so the scene
 * reads fresh data every frame without React re-rendering at 60fps.
 */
export interface SceneBridge {
  /** Latest authoritative snapshot from the server. */
  players: PublicPlayer[];
  /**
   * Live positions from the server's high-frequency channel, keyed by seat.
   * Mutated in place by the socket layer, so it is merged every frame.
   */
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>;
  bodies: { seat: Seat; x: number; y: number }[];
  mySeat: Seat | null;
  /** Local player's own role, if they have revealed it to themselves. */
  isParasite: boolean;
  /** Which of my tasks remain. */
  myTasks: TaskId[];
  doneTasks: TaskId[];
  /** True while a meeting or the end screen is up: input is frozen. */
  frozen: boolean;
  onInput: (ax: number, ay: number, fx?: number, fy?: number) => void;
}
