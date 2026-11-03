import type { PublicPlayer, Seat, TaskId } from '@parasite/shared';

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
  onInput: (ax: number, ay: number) => void;
}
