/**
 * Game rules and tuning constants.
 *
 * This is the single source of truth for both the authoritative server and the
 * client. The client uses these for prediction/rendering; the server uses them
 * for enforcement. Any value here that the client could lie about is re-checked
 * server-side.
 */

// ── Player count ─────────────────────────────────────────────────────────────
// Spec: minimum 4 players, maximum 10 players. Enforced server-side in
// GameRoom.join(), not just in the UI.
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

// ── World ────────────────────────────────────────────────────────────────────
// World units == pixels at 1x zoom. The outpost is deliberately small and
// walkable end-to-end in ~15s so a 10-player game stays dense.
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 1200;

// ── Movement ─────────────────────────────────────────────────────────────────
export const PLAYER_SPEED = 190; // px/sec
export const PLAYER_RADIUS = 16; // collision + proximity radius

/** Server simulation rate. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Max distance a player may travel in one input frame before the server treats
 * it as a teleport and snaps them back. Generous (3x) to tolerate lag spikes
 * and frame drops — this is anti-teleport, not anti-cheat-with-teeth.
 */
export const MAX_MOVE_PER_INPUT = PLAYER_SPEED * 3 * (TICK_MS / 1000);

// ── Interaction distances ────────────────────────────────────────────────────
export const TASK_INTERACT_RADIUS = 56;
export const JUMP_RANGE = 72; // Parasite must be this close to jump
export const PURGE_RANGE = 64;
export const REPORT_BODY_RADIUS = 96;

// ── Cooldowns / timers (ms) ──────────────────────────────────────────────────
export const PURGE_COOLDOWN_MS = 25_000;
export const JUMP_COOLDOWN_MS = 20_000;
export const MEETING_DISCUSSION_MS = 15_000;
export const MEETING_VOTING_MS = 30_000;
export const MEETING_RESULT_MS = 7_000;
export const EMERGENCY_MEETINGS_PER_PLAYER = 1;

// ── Tasks ────────────────────────────────────────────────────────────────────
/** Exact task names from the spec. Order matters — index is the task id. */
export const TASK_DEFS = [
  {
    id: 'analyze-bio-samples',
    name: 'Analyze Bio-Samples',
    area: 'lab-a',
    kind: 'hold',
    durationMs: 4000,
  },
  {
    id: 'repair-power-conduit',
    name: 'Repair Power Conduit',
    area: 'specimen',
    kind: 'sequence',
    steps: 4,
  },
  {
    id: 'collect-plant-samples',
    name: 'Collect Plant Samples',
    area: 'greenhouse',
    kind: 'clicks',
    steps: 5,
  },
  {
    id: 'calibrate-sensors',
    name: 'Calibrate Sensors',
    area: 'lab-b',
    kind: 'slider',
    steps: 3,
  },
  {
    id: 'upload-research-data',
    name: 'Upload Research Data',
    area: 'meeting',
    kind: 'hold',
    durationMs: 6000,
  },
] as const;

export type TaskId = (typeof TASK_DEFS)[number]['id'];
export const TASK_IDS = TASK_DEFS.map((t) => t.id) as TaskId[];
export const TASKS_PER_PLAYER = TASK_DEFS.length;

// ── Win conditions ───────────────────────────────────────────────────────────
/**
 * Crew win when every living crew member has completed all 5 tasks, or when
 * the Parasite's host is ejected.
 *
 * Parasite wins when living crew <= PARASITE_WIN_THRESHOLD. Standard Among Us
 * uses "impostors >= crew"; with exactly one Parasite that reduces to 1 crew
 * remaining. We use 1 so the game ends decisively rather than dragging into a
 * 1v1 where the Parasite can simply refuse to act.
 */
export const PARASITE_WIN_CREW_THRESHOLD = 1;

// ── Map areas ────────────────────────────────────────────────────────────────
export type AreaId =
  | 'meeting'
  | 'lab-a'
  | 'lab-b'
  | 'greenhouse'
  | 'specimen'
  | 'path';

export interface Area {
  id: AreaId;
  name: string;
  /** Rect in world coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

/**
 * The outpost. Five named areas connected by paths — kept small and focused per
 * the spec. Rooms are axis-aligned rects; the walkable region is the union of
 * these rects (see isWalkable), which keeps collision trivial and identical on
 * client and server.
 */
export const AREAS: Area[] = [
  { id: 'meeting', name: 'Central Meeting Platform', x: 620, y: 460, w: 360, h: 280, color: 0x2b6b4f },
  { id: 'lab-a', name: 'Lab Tent A', x: 120, y: 140, w: 340, h: 260, color: 0x27596b },
  { id: 'lab-b', name: 'Lab Tent B', x: 1140, y: 140, w: 340, h: 260, color: 0x27596b },
  { id: 'greenhouse', name: 'Greenhouse', x: 120, y: 800, w: 380, h: 280, color: 0x2f7a3d },
  { id: 'specimen', name: 'Specimen Area', x: 1100, y: 800, w: 380, h: 280, color: 0x5a3b6b },
  // Connecting paths (corridors).
  { id: 'path', name: 'Path', x: 440, y: 240, w: 220, h: 90, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 940, y: 240, w: 220, h: 90, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 250, y: 380, w: 90, h: 460, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 1250, y: 380, w: 90, h: 460, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 440, y: 880, w: 220, h: 90, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 940, y: 880, w: 220, h: 90, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 620, y: 300, w: 90, h: 180, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 890, y: 300, w: 90, h: 180, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 620, y: 720, w: 90, h: 180, color: 0x3a5a44 },
  { id: 'path', name: 'Path', x: 890, y: 720, w: 90, h: 180, color: 0x3a5a44 },
];

/** Where each task's console sits in the world. */
export const TASK_STATIONS: Record<TaskId, { x: number; y: number }> = {
  'analyze-bio-samples': { x: 290, y: 250 },
  'calibrate-sensors': { x: 1310, y: 250 },
  'collect-plant-samples': { x: 310, y: 930 },
  'repair-power-conduit': { x: 1290, y: 930 },
  'upload-research-data': { x: 800, y: 600 },
};

/** Spawn ring around the central platform. */
export const SPAWN_CENTER = { x: 800, y: 600 };
export const SPAWN_RADIUS = 110;

/**
 * Walkability test, shared verbatim by client prediction and server
 * enforcement so they can never disagree about where a player may stand.
 */
export function isWalkable(x: number, y: number): boolean {
  for (const a of AREAS) {
    if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return true;
  }
  return false;
}

/**
 * Clamp a desired position to the walkable region. Tries the full move, then
 * axis-separated moves so players slide along walls instead of sticking.
 */
export function resolveMove(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): { x: number; y: number } {
  if (isWalkable(toX, toY)) return { x: toX, y: toY };
  if (isWalkable(toX, fromY)) return { x: toX, y: fromY };
  if (isWalkable(fromX, toY)) return { x: fromX, y: toY };
  return { x: fromX, y: fromY };
}

export function areaAt(x: number, y: number): AreaId | null {
  for (const a of AREAS) {
    if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a.id;
  }
  return null;
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Client render metadata ───────────────────────────────────────────────────
// Derived from AREAS rather than re-listed, so the collision geometry the
// server enforces and the slabs the client draws can never drift apart.

export const MAP_WIDTH = WORLD_WIDTH;
export const MAP_HEIGHT = WORLD_HEIGHT;

export interface RoomVisual {
  kind: 'room' | 'path';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOMS: RoomVisual[] = AREAS.map((a) => ({
  kind: a.id === 'path' ? 'path' : 'room',
  name: a.id === 'path' ? '' : a.name,
  x: a.x,
  y: a.y,
  w: a.w,
  h: a.h,
}));

/** Display names for the five tasks, keyed by id. */
export const TASK_LABELS: Record<TaskId, string> = Object.fromEntries(
  TASK_DEFS.map((t) => [t.id, t.name])
) as Record<TaskId, string>;
