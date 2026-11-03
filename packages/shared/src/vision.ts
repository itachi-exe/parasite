/**
 * Sight rules shared by the renderer and the server: a 70 degree facing cone
 * plus a small all-round proximity circle, both stopped by walls (the same
 * isWalkable boundary used for collision).
 */
import { isWalkable } from './constants.js';

export const VISION = {
  /** Cone reach in world px. */
  range: 380,
  /** Always-visible radius around the player (about 1.5 m), still blocked by walls. */
  ambient: 78,
  /** Half the cone angle: 35 degrees, so the full wedge is 70. */
  half: (35 * Math.PI) / 180,
  /** Angular blend at the cone edge (radians). */
  soft: 0.2,
  /** Half width of the drawn cone edge, inside the blend so nobody stands lit but hidden. */
  edge: 0.09,
  rays: 256,
  /** Rays continue this far past the hit, so the face of the wall reads. */
  pad: 14,
};

/** Distance a ray from (x, y) travels before leaving the walkable region. */
export function rayLength(x: number, y: number, ang: number, max: number): number {
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const STEP = 8;
  for (let s = STEP; s <= max; s += STEP) {
    if (isWalkable(x + cx * s, y + cy * s)) continue;
    let lo = s - STEP, hi = s;
    for (let i = 0; i < 3; i++) {
      const m = (lo + hi) / 2;
      if (isWalkable(x + cx * m, y + cy * m)) lo = m;
      else hi = m;
    }
    return lo;
  }
  return max;
}

export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function smoothstep(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Reach of sight at a bearing: full range inside the cone, ambient outside, smooth between. */
export function reachAt(ang: number, look: number): number {
  const d = Math.abs(angDiff(ang, look));
  const k = 1 - smoothstep(d, VISION.half - VISION.soft, VISION.half + VISION.soft);
  return VISION.ambient + (VISION.range - VISION.ambient) * k;
}

/** Can a viewer at (ax, ay) looking along `look` see the point (bx, by)? */
export function canSee(ax: number, ay: number, look: number, bx: number, by: number, slack = 0): boolean {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const ang = Math.atan2(dy, dx);
  if (d > reachAt(ang, look) + slack) return false;
  return rayLength(ax, ay, ang, d) >= d - 2;
}
