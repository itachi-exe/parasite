/**
 * The outpost, drawn from primitives.
 *
 * Everything here is a pure function of a {@link Pen} plus a seed, for two
 * reasons that matter to this game specifically:
 *
 *  - Every client must draw an *identical* map. Two players describing
 *    different foliage while discussing where somebody was reads as a bug even
 *    though nothing in the simulation diverged, so the only randomness is the
 *    seeded LCG from pen.ts. No `Math.random` anywhere in this file.
 *  - The geometry is the same rect union the server enforces in `isWalkable`.
 *    Walls are *derived* from it rather than listed separately, so a wall can
 *    never appear across a doorway the server will happily let you walk
 *    through.
 *
 * All of it is drawn once into a RenderTexture at scene start; nothing here
 * runs per frame.
 */

import {
  type Pen,
  type Pt,
  rng,
  range,
  pick,
  blobPts,
  tendrilPts,
  arcPts,
  softShadow,
  softShadowRect,
  bloom,
  gradRect,
  insetShade,
  pool,
  ellipsePts,
  warm,
  cool,
  mix,
  darken,
  lighten,
} from './pen';
import { ENV, VINES, type RoomTheme } from './palette';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far walls stand out from the walkable rect. Drawn outward, never into it. */
export const WALL_T = 11;

/**
 * How far a doorway lamp sits in from a room's corner.
 *
 * Shared between {@link drawRoomFloor}, which pools light under the lamps, and
 * {@link drawOutpost}, which places them. They were separate literals, and a
 * light pool that does not line up with its lamp is worse than no pool at all —
 * it reads as a stain.
 */
export const LAMP_INSET = 20;

// ── Floors ───────────────────────────────────────────────────────────────────

export interface FloorOpts extends Rect {
  theme: RoomTheme;
  seed: number;
}

/**
 * A room's floor. Three treatments, because "clinical lab" and "greenhouse"
 * wanting different *patterns* rather than different tints is most of what
 * makes a room feel like a place.
 *
 * The floor is then *lit*, in three passes that are the whole difference between
 * a room and a rectangle:
 *
 *  1. A vertical ramp across the whole slab — the far wall is further from the
 *     lamps, so the top of the room sits darker than the bottom.
 *  2. A warm pool under each of the four doorway lamps. Four lamps that emit
 *     light but never *land* it anywhere is the flattest thing this map did.
 *  3. Ambient occlusion feathered inward from all four walls, replacing the two
 *     hard bands (14px at 16% black on the top, 12px at 10% down the left) that
 *     read as a painted border rather than as a corner falling into shadow.
 */
export function drawRoomFloor(pen: Pen, o: FloorOpts): void {
  const r = rng(o.seed);
  // Base is a ramp, not a flat fill: cooler and darker at the back of the room,
  // warmer toward the camera. 14 bands is invisible as banding at play scale.
  gradRect(pen, o.x, o.y, o.w, o.h, cool(o.theme.floor, 0.22), warm(o.theme.floor, 0.06), {
    bands: 14,
  });

  if (o.theme.pattern === 'tile') tiles(pen, o, r);
  else if (o.theme.pattern === 'moss') mossFloor(pen, o, r);
  else deck(pen, o, r);

  // Lamp pools, in the lamp's own accent warmed toward the work-lamp colour, so
  // the light on the floor and the light in the fixture are the same light.
  //
  // Kept deliberately tight and faint. The first attempt used 108x92 at 0.3 and
  // the four pools met in the middle of the room, which is not lighting — it is
  // fog, and it washed the floor pattern out entirely. A pool has to have an
  // *edge* somewhere inside the room or it is just a brightness change.
  const lit = mix(o.theme.accent, ENV.lamp, 0.55);
  const pr = Math.min(64, o.w * 0.2, o.h * 0.24);
  for (const [lx, ly] of [
    [o.x + LAMP_INSET, o.y + LAMP_INSET],
    [o.x + o.w - LAMP_INSET, o.y + LAMP_INSET],
    [o.x + LAMP_INSET, o.y + o.h - LAMP_INSET],
    [o.x + o.w - LAMP_INSET, o.y + o.h - LAMP_INSET],
  ] as const) {
    pool(pen, lx, ly, pr, pr * 0.86, { color: lit, alpha: 0.14, bands: 9 });
  }

  // Grime gathering where the floor meets the walls — the cheapest way to stop
  // a floor reading as a flat slab pasted onto the ground.
  pen.fill(o.theme.grout, 0.5);
  pen.rect(o.x, o.y, o.w, 5);
  pen.rect(o.x, o.y + o.h - 4, o.w, 4);
  pen.rect(o.x, o.y, 4, o.h);
  pen.rect(o.x + o.w - 4, o.y, 4, o.h);

  // Occlusion under the walls, deepest where the light does not reach. The top
  // and left edges face the light, so they occlude least; bottom and right get
  // the deeper falloff.
  const ao = { color: ENV.bounce, alpha: 0.3 } as const;
  insetShade(pen, o, 'top', 26, { ...ao, alpha: 0.34 });
  insetShade(pen, o, 'left', 22, ao);
  insetShade(pen, o, 'bottom', 18, { ...ao, alpha: 0.2 });
  insetShade(pen, o, 'right', 16, { ...ao, alpha: 0.18 });
}

/** Clinical grid. Alternating tones, grout lines, a bevel on each tile. */
function tiles(pen: Pen, o: FloorOpts, r: () => number): void {
  const s = 38;
  const cols = Math.ceil(o.w / s);
  const rows = Math.ceil(o.h / s);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = o.x + cx * s;
      const y = o.y + cy * s;
      const w = Math.min(s, o.x + o.w - x);
      const h = Math.min(s, o.y + o.h - y);
      if ((cx + cy) % 2 === 0) {
        pen.fill(o.theme.floorAlt, 1);
        pen.rect(x, y, w, h);
      }
      // Bevel: light on the top-left of the tile, grout on the bottom-right.
      pen.fill(o.theme.scuff, 0.3);
      pen.rect(x, y, w, 1);
      pen.rect(x, y, 1, h);
      pen.fill(o.theme.grout, 0.75);
      pen.rect(x, y + h - 1.4, w, 1.4);
      pen.rect(x + w - 1.4, y, 1.4, h);
    }
  }
  // A handful of scuffs and one spill, so the grid is not perfectly clean.
  for (let i = 0; i < 9; i++) {
    pen.fill(o.theme.scuff, range(r, 0.1, 0.26));
    pen.poly(
      blobPts(
        range(r, o.x + 20, o.x + o.w - 20),
        range(r, o.y + 24, o.y + o.h - 20),
        range(r, 9, 22),
        0.4,
        r,
        7
      )
    );
  }
  pen.fill(o.theme.grout, 0.45);
  pen.poly(blobPts(o.x + o.w * 0.32, o.y + o.h * 0.68, 26, 0.45, r, 9));
}

/** Greenhouse: moss creeping over the pavers, roots, fallen leaves. */
function mossFloor(pen: Pen, o: FloorOpts, r: () => number): void {
  // Faint paver seams still readable under the growth.
  pen.fill(o.theme.grout, 0.5);
  for (let x = o.x + 46; x < o.x + o.w - 10; x += 46) pen.rect(x, o.y + 4, 1.4, o.h - 8);
  for (let y = o.y + 46; y < o.y + o.h - 10; y += 46) pen.rect(o.x + 4, y, o.w - 8, 1.4);

  // Moss, both lighter and darker than the pavers. Only-lighter patches raise
  // the whole floor's average and the room goes flat and olive next to the labs.
  for (let i = 0; i < 16; i++) {
    const x = range(r, o.x + 12, o.x + o.w - 12);
    const y = range(r, o.y + 16, o.y + o.h - 12);
    pen.fill(
      pick(r, [o.theme.floorAlt, o.theme.scuff, o.theme.grout, ENV.canopy[0]!, ENV.canopy[1]!]),
      range(r, 0.2, 0.42)
    );
    pen.poly(blobPts(x, y, range(r, 14, 34), 0.5, r, 10));
  }
  // Roots pushing through, and leaf litter on top of them. Both are pushed
  // toward the walls: growth belongs at the edges of a room people walk across,
  // and litter strewn evenly over the middle just reads as noise on the floor.
  const edged = (): Pt => {
    const t = r();
    const m = 22 + r() * 46;
    if (t < 0.25) return [range(r, o.x + 8, o.x + o.w - 8), o.y + m];
    if (t < 0.5) return [range(r, o.x + 8, o.x + o.w - 8), o.y + o.h - m];
    if (t < 0.75) return [o.x + m, range(r, o.y + 8, o.y + o.h - 8)];
    return [o.x + o.w - m, range(r, o.y + 8, o.y + o.h - 8)];
  };
  for (let i = 0; i < 7; i++) {
    const [x, y] = edged();
    pen.fill(VINES[1]!, 0.45);
    pen.poly(
      tendrilPts({
        x,
        y,
        angle: range(r, 0, Math.PI * 2),
        len: range(r, 40, 92),
        width: range(r, 2.4, 4.2),
        curve: range(r, -0.9, 0.9),
      })
    );
  }
  for (let i = 0; i < 16; i++) {
    const [x, y] = edged();
    pen.fill(pick(r, [ENV.canopy[2]!, ENV.frond[0]!, ENV.frond[1]!]), range(r, 0.35, 0.6));
    pen.poly(
      tendrilPts({
        x,
        y,
        angle: range(r, 0, Math.PI * 2),
        len: range(r, 9, 18),
        width: range(r, 3, 5),
        curve: range(r, -0.5, 0.5),
        profile: 'leaf',
      })
    );
  }
}

/** The meeting platform: a built deck. Planks, seams, and an inlaid ring. */
function deck(pen: Pen, o: FloorOpts, r: () => number): void {
  const ph = 22;
  for (let i = 0, y = o.y; y < o.y + o.h; i++, y += ph) {
    const h = Math.min(ph, o.y + o.h - y);
    if (i % 2 === 0) {
      pen.fill(o.theme.floorAlt, 1);
      pen.rect(o.x, y, o.w, h);
    }
    pen.fill(o.theme.grout, 0.8);
    pen.rect(o.x, y + h - 1.8, o.w, 1.8);
    pen.fill(o.theme.scuff, 0.28);
    pen.rect(o.x, y, o.w, 1.2);
    // Butt joints. Spaced wide and staggered over five rows: on a regular grid
    // they stop reading as board ends and start reading as tiles.
    const off = ((i * 2) % 5) * 74;
    for (let x = o.x + 90 + off; x < o.x + o.w - 30; x += 330) {
      pen.fill(o.theme.grout, 0.85);
      pen.rect(x, y, 1.8, h - 1.8);
      pen.fill(o.theme.scuff, 0.25);
      pen.rect(x + 1.8, y, 1, h - 1.8);
    }
    // Grain, so the boards have a surface rather than a tint.
    for (let k = 0; k < 3; k++) {
      pen.fill(o.theme.grout, 0.16);
      pen.rect(range(r, o.x, o.x + o.w - 60), y + range(r, 3, h - 5), range(r, 22, 58), 1);
    }
  }
  // Inlaid ring under the central console — the platform's focal point.
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  pen.line(3, o.theme.accent, 0.3);
  pen.strokeCircle(cx, cy, 88);
  pen.line(1.5, o.theme.accent, 0.18);
  pen.strokeCircle(cx, cy, 96);
  pen.fill(o.theme.scuff, 0.2);
  pen.circle(cx, cy, 84);
}

// ── Props ────────────────────────────────────────────────────────────────────
//
// Decoration only. Nothing here is collidable and nothing here is interactive —
// the walkable region is still exactly the rect union in shared/constants.ts, so
// props are placed around the room edges where players have no reason to be and
// clear of every task station.

/**
 * Contact shadow. Props that skip this float.
 *
 * One soft stack rather than one hard rect at 40% — this is the single highest-
 * leverage function in the file, because every prop routes through it, so a prop
 * either sits on the floor or hovers over it depending on this one call.
 */
function shade(pen: Pen, x: number, y: number, w: number, h: number): void {
  softShadowRect(pen, x + 2, y + 5, w, h, 5, {
    color: ENV.wallShadow,
    alpha: 0.42,
    layers: 4,
    spread: 1.4,
  });
}

/** A lab bench seen from above: worktop, front face, dark underside. */
function bench(pen: Pen, x: number, y: number, w: number, t: RoomTheme): void {
  const h = 26;
  shade(pen, x, y, w, h + 6);
  pen.fill(0x121a1e, 1);
  pen.roundRect(x, y + h - 4, w, 10, { bl: 3, br: 3 });
  pen.fill(0xc3ced4, 1);
  pen.roundRect(x, y, w, h, 4);
  pen.fill(0xe8eef1, 1);
  pen.roundRect(x, y, w, h - 8, { tl: 4, tr: 4 });
  pen.fill(0x8fa0a8, 0.75);
  pen.rect(x + 3, y + h - 9, w - 6, 1.6);
  pen.line(1.4, 0x5e6d74, 0.5);
  pen.strokeRoundRect(x, y, w, h, 4);
  // Drawer seams.
  pen.fill(0x8fa0a8, 0.5);
  for (let dx = x + 34; dx < x + w - 10; dx += 34) pen.rect(dx, y + h - 8, 1.4, 7);
  pen.fill(t.accent, 0.5);
  pen.rect(x + 6, y + h + 2, w - 12, 1.4);
}

/** Bench-top monitor: a lit screen on a small stand. */
function monitor(pen: Pen, x: number, y: number, t: RoomTheme): void {
  pen.fill(0x0d1417, 1);
  pen.roundRect(x - 12, y - 3, 24, 6, 2);
  pen.fill(0x1b262b, 1);
  pen.roundRect(x - 15, y - 20, 30, 19, 3);
  pen.fill(t.accent, 0.85);
  pen.roundRect(x - 12, y - 17, 24, 13, 2);
  pen.fill(0xffffff, 0.35);
  pen.rect(x - 10, y - 15, 12, 1.6);
  pen.rect(x - 10, y - 11, 17, 1.6);
  pen.rect(x - 10, y - 7, 9, 1.6);
  // Screen spill onto the bench, on the same falloff as every other light source
  // in the map rather than as one flat ellipse of its own invention.
  pool(pen, x, y + 6, 24, 9, { color: t.accent, alpha: 0.3, bands: 6 });
}

/** Stool, from directly above: a disc, a shadow, three legs peeking out. */
/**
 * A lab stool.
 *
 * Drawn in the same high three-quarter projection as the benches and crates:
 * seat disc on top, legs splaying *downward* toward the viewer. Straight
 * overhead a stool is an ambiguous disc, and legs radiating evenly in four
 * directions read as something with legs rather than something to sit on — so
 * the near side is the side that shows.
 */
function stool(pen: Pen, x: number, y: number, t: RoomTheme): void {
  softShadow(pen, x + 2, y + 12, 12, 6, { color: ENV.wallShadow, alpha: 0.44, spread: 1.5 });

  // Three legs, all toward the viewer, ending in feet on the floor line.
  for (const [a, len] of [
    [2.36, 15],
    [1.5708, 17],
    [0.79, 15],
  ] as const) {
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len * 0.82;
    pen.line(4.2, 0x101619, 0.85);
    pen.strokePoly([
      [x, y],
      [ex, ey],
    ]);
    pen.line(2.2, 0x455860, 1);
    pen.strokePoly([
      [x, y],
      [ex, ey],
    ]);
    pen.fill(0x1b2429, 1);
    pen.ellipse(ex, ey, 2.4, 1.7);
  }

  // Seat: dark rim, lit cushion, highlight, accent lip on the near edge.
  pen.fill(0x232e34, 1);
  pen.ellipse(x, y, 11, 7.6);
  pen.fill(0x4a5d64, 1);
  pen.ellipse(x, y - 1.4, 9.6, 6.4);
  pen.fill(0x62787f, 1);
  pen.ellipse(x - 1.4, y - 2.4, 6.4, 3.8);
  pen.fill(t.scuff, 0.4);
  pen.ellipse(x - 2.4, y - 3.2, 3.8, 2);
  // The Pen has no strokeEllipse; `ellipsePts` in pen.ts is the shared point ring
  // this used to hand-roll. The accent lip is the near half of it.
  const rim = ellipsePts(x, y, 11, 7.6, 24);
  pen.line(1.2, t.accent, 0.24);
  pen.strokePoly(ellipsePts(x, y, 9.8, 6.6, 24).slice(1, 12));
  pen.line(1, 0x101619, 0.65);
  pen.strokePoly(rim, true);
}

/**
 * A cable run between two fixtures.
 *
 * Stroked at constant width with round caps rather than filled as a tapering
 * polygon — a cable that thins to a point looks like a stray pen stroke, and one
 * that stops in open floor looks like a mistake. Both ends are therefore
 * terminated: it leaves a clamp and lands on a junction plate.
 */
function cable(pen: Pen, x0: number, y0: number, x1: number, y1: number, bow: number): void {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const nl = Math.hypot(nx, ny) || 1;
  const cx = (x0 + x1) / 2 + (nx / nl) * bow;
  const cy = (y0 + y1) / 2 + (ny / nl) * bow;
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    pts.push([
      u * u * x0 + 2 * u * t * cx + t * t * x1,
      u * u * y0 + 2 * u * t * cy + t * t * y1,
    ]);
  }
  pen.line(4, ENV.wallShadow, 0.4);
  pen.strokePoly(pts);
  pen.line(2.4, 0x182226, 1);
  pen.strokePoly(pts);
  pen.line(0.9, 0x36474d, 0.7);
  pen.strokePoly(pts);

  pen.fill(0x131b1f, 1);
  pen.roundRect(x1 - 8, y1 - 6, 16, 12, 3);
  pen.fill(0x2b383e, 1);
  pen.roundRect(x1 - 6.5, y1 - 4.8, 13, 8.4, 2);
  pen.fill(0x0f161a, 1);
  pen.rect(x1 - 3.5, y1 - 2.6, 7, 1.6);
}

/** Specimen tank: a lit cylinder with something suspended in it. */
function tank(pen: Pen, x: number, y: number, rx: number, t: RoomTheme): void {
  softShadow(pen, x + 3, y + 10, rx + 2, rx * 0.5 + 2, {
    color: ENV.wallShadow,
    alpha: 0.48,
    spread: 1.45,
  });
  pen.fill(0x1a1424, 1);
  pen.roundRect(x - rx, y - rx * 1.5, rx * 2, rx * 2.2, rx * 0.7);
  pen.fill(t.accent, 0.34);
  pen.roundRect(x - rx + 3, y - rx * 1.5 + 3, rx * 2 - 6, rx * 2.2 - 6, rx * 0.6);
  // The specimen, and the glass.
  pen.fill(VINES[2]!, 0.8);
  pen.poly(blobPts(x, y - rx * 0.3, rx * 0.5, 0.4, rng(rx * 31 + x), 8));
  pen.fill(0xffffff, 0.2);
  pen.roundRect(x - rx + 4, y - rx * 1.4, rx * 0.5, rx * 1.9, rx * 0.25);
  pen.line(2, t.accent, 0.7);
  pen.strokeRoundRect(x - rx, y - rx * 1.5, rx * 2, rx * 2.2, rx * 0.7);
  // Collar and base rings.
  pen.fill(0x3a3050, 1);
  pen.roundRect(x - rx - 2, y - rx * 1.5 - 5, rx * 2 + 4, 8, 3);
  pen.roundRect(x - rx - 2, y + rx * 0.6, rx * 2 + 4, 7, 3);
  pen.fill(t.accent, 0.9);
  pen.circle(x, y - rx * 1.5 - 1, 2);
}

/** Raised planter bed with growth spilling over the lip. */
function planter(pen: Pen, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  shade(pen, x, y, w, h + 4);
  pen.fill(0x4a3524, 1);
  pen.roundRect(x, y, w, h, 5);
  pen.fill(0x5d4430, 1);
  pen.roundRect(x, y, w, h - 6, 5);
  pen.fill(0x241a12, 1);
  pen.roundRect(x + 5, y + 5, w - 10, h - 14, 4);
  pen.line(1.4, 0x2f2116, 0.7);
  pen.strokeRoundRect(x, y, w, h, 5);
  // Planting, drawn as leaf slivers fanning out of the soil.
  for (let i = 0; i < Math.round(w / 7); i++) {
    const px = range(r, x + 7, x + w - 7);
    const py = range(r, y + 8, y + h - 12);
    pen.fill(pick(r, [ENV.frond[0], ENV.frond[1], ENV.frond[2], VINES[3]!]), range(r, 0.7, 1));
    pen.poly(
      tendrilPts({
        x: px,
        y: py,
        angle: range(r, -Math.PI, Math.PI),
        len: range(r, 12, 26),
        width: range(r, 3.4, 6),
        curve: range(r, -0.7, 0.7),
        profile: 'leaf',
      })
    );
  }
}

/** Supply crate, stacked or alone. */
function crate(pen: Pen, x: number, y: number, s: number, t: RoomTheme): void {
  shade(pen, x, y, s, s);
  pen.fill(0x3f4a44, 1);
  pen.roundRect(x, y, s, s, 4);
  pen.fill(0x4f5d55, 1);
  pen.roundRect(x + 2, y + 2, s - 4, s - 8, 3);
  pen.line(1.4, 0x1f2723, 0.7);
  pen.strokeRoundRect(x, y, s, s, 4);
  pen.fill(0x2c352f, 0.9);
  pen.rect(x + s * 0.45, y + 2, s * 0.1, s - 8);
  pen.fill(t.accent, 0.65);
  pen.roundRect(x + 5, y + s - 13, 10, 5, 2);
}

// ── Prop vocabulary, second pass ─────────────────────────────────────────────
//
// The first pass gave each room six or seven pieces hugging its edges, which
// left 340x260 rooms reading as empty floor with the furniture pushed against
// the walls. The reference this project is measured against fills rooms with
// working clutter — racks, pipes, paperwork, spills — while still keeping the
// middle clear to walk through. These are the pieces that were missing.

/** Equipment rack. The tall vertical note a lab wall needs. */
function rack(pen: Pen, x: number, y: number, w: number, h: number, t: RoomTheme): void {
  shade(pen, x, y, w, h);
  pen.fill(darken(t.floor, 0.55), 1);
  pen.roundRect(x, y, w, h, 3);
  pen.fill(darken(t.floor, 0.34), 1);
  pen.roundRect(x + 2, y + 2, w - 4, h - 6, 2);
  // Uneven fill on purpose: a full rack looks stocked, a patchy one looks used.
  const rows = Math.max(2, Math.floor((h - 10) / 13));
  const rr = rng(Math.round(x * 7 + y * 13 + w));
  for (let i = 0; i < rows; i++) {
    const uy = y + 5 + i * 13;
    pen.fill(darken(t.floor, 0.12), 1);
    pen.rect(x + 4, uy, w - 8, 9);
    pen.fill(0x000000, 0.35);
    pen.rect(x + 4, uy + 7, w - 8, 2);
    if (rr() < 0.62) {
      pen.fill(rr() < 0.22 ? 0xff7a90 : t.accent, 0.9);
      pen.circle(x + w - 9, uy + 4.5, 1.9);
    }
  }
  pen.line(1.3, 0x000000, 0.5);
  pen.strokeRoundRect(x, y, w, h, 3);
}

/** A pipe run along a wall, with collars. Reads as infrastructure. */
function pipes(
  pen: Pen,
  x: number,
  y: number,
  len: number,
  vertical: boolean,
  t: RoomTheme
): void {
  const th = 7;
  shade(pen, x, y, vertical ? th : len, vertical ? len : th);
  for (const [off, col, a] of [
    [0, darken(t.floor, 0.5), 1],
    [1.6, lighten(t.floor, 0.16), 0.9],
    [th - 2.4, darken(t.floor, 0.62), 0.85],
  ] as const) {
    pen.fill(col, a);
    if (vertical) pen.rect(x + off, y, 2.4, len);
    else pen.rect(x, y + off, len, 2.4);
  }
  for (let d = 18; d < len - 10; d += 34) {
    pen.fill(darken(t.floor, 0.66), 1);
    if (vertical) pen.roundRect(x - 1.5, y + d, th + 3, 5, 1.5);
    else pen.roundRect(x + d, y - 1.5, 5, th + 3, 1.5);
  }
}

/** Wall-mounted screen or notice panel. */
function panel(pen: Pen, x: number, y: number, w: number, h: number, t: RoomTheme): void {
  pen.fill(0x000000, 0.3);
  pen.roundRect(x + 1, y + 2, w, h, 2);
  pen.fill(darken(t.floor, 0.6), 1);
  pen.roundRect(x, y, w, h, 2);
  pen.fill(t.accent, 0.34);
  pen.roundRect(x + 2, y + 2, w - 4, h - 4, 1.5);
  // Scan lines, so it reads as lit rather than as a painted rectangle.
  pen.fill(t.accent, 0.5);
  for (let i = 0; i < Math.floor((h - 6) / 4); i++) {
    pen.rect(x + 4, y + 4 + i * 4, Math.max(3, (w - 8) * (0.4 + ((i * 37) % 60) / 100)), 1.4);
  }
}

/** Loose paperwork on the floor. Pure storytelling, costs three fills. */
function papers(pen: Pen, x: number, y: number, n: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const px = x + range(r, -16, 16);
    const py = y + range(r, -11, 11);
    pen.fill(0x000000, 0.22);
    pen.rect(px + 1, py + 1.5, 9, 6.5);
    pen.fill(0xd8e7dd, range(r, 0.55, 0.8));
    pen.rect(px, py, 9, 6.5);
    pen.fill(0x2b3b34, 0.5);
    pen.rect(px + 1.4, py + 1.6, 6, 0.9);
    pen.rect(px + 1.4, py + 3.4, 4.4, 0.9);
  }
}

/** A wet stain / spill on the floor. */
function spill(pen: Pen, x: number, y: number, r0: number, color: number, seed: number): void {
  const r = rng(seed);
  pen.fill(color, 0.16);
  pen.poly(blobPts(x, y, r0, 0.4, r, 10));
  pen.fill(color, 0.24);
  pen.poly(blobPts(x, y, r0 * 0.6, 0.45, r, 9));
}

/** Hazard chevrons painted on the floor — a threshold marker. */
function hazardStrip(pen: Pen, x: number, y: number, w: number, h: number): void {
  pen.fill(0xd7a53a, 0.2);
  pen.rect(x, y, w, h);
  pen.fill(0x0d1410, 0.3);
  for (let i = 0; i < w; i += 16) {
    pen.poly([
      [x + i, y + h],
      [x + i + 8, y],
      [x + i + 15, y],
      [x + i + 7, y + h],
    ]);
  }
}

/** Toolbox / supply case. */
function toolbox(pen: Pen, x: number, y: number, t: RoomTheme): void {
  shade(pen, x, y, 26, 16);
  pen.fill(darken(t.accent, 0.62), 1);
  pen.roundRect(x, y, 26, 16, 2.5);
  pen.fill(darken(t.accent, 0.44), 1);
  pen.roundRect(x, y, 26, 9, { tl: 2.5, tr: 2.5 });
  pen.fill(0x0e1512, 0.8);
  pen.rect(x + 9, y + 6, 8, 3);
  pen.line(1.2, 0x0b120f, 0.7);
  pen.strokeRoundRect(x, y, 26, 16, 2.5);
}

export interface PropOpts extends Rect {
  id: string;
  theme: RoomTheme;
  seed: number;
}

/**
 * Furnish one room. Coordinates are local to the room rect, so the layouts read
 * as layouts rather than as world-space magic numbers.
 *
 * Two hard placement rules, both derived from geometry elsewhere in the repo
 * rather than from taste:
 *
 *  - Nothing may sit in a doorway. Paths overlap *into* rooms, so the overlap
 *    intervals are where players enter.
 *  - Nothing may sit on a task station, and the meeting platform gets no
 *    central table however much the room wants one: `upload-research-data` is
 *    at the exact centre of the platform with a 56px interact radius, so a
 *    table there would have players standing on the furniture. The centre is
 *    left as floor and the seating rings it instead.
 */
export function drawProps(pen: Pen, o: PropOpts): void {
  const t = o.theme;
  const r = rng(o.seed);
  const at = (lx: number, ly: number): Pt => [o.x + lx, o.y + ly];

  if (o.id === 'lab-a' || o.id === 'lab-b') {
    // lab-b is lab-a mirrored: its doorways are on the opposite side.
    const m = o.id === 'lab-b';
    const fx = (lx: number, w: number) => (m ? o.w - lx - w : lx);

    // Floor first, so everything below sits on top of it.
    spill(pen, o.x + fx(96, 0), o.y + 150, 22, t.accent, o.seed + 5);
    papers(pen, o.x + fx(210, 0), o.y + 120, 4, o.seed + 41);
    hazardStrip(pen, o.x + fx(0, 0) + 6, o.y + o.h - 20, 64, 9);

    // Main worktop with its instruments, along the top wall.
    bench(pen, o.x + fx(24, 176), o.y + 34, 176, t);
    monitor(pen, ...at(fx(24, 176) + 40, 46), t);
    monitor(pen, ...at(fx(24, 176) + 108, 46), t);
    // Second bench, with a toolbox left out on it.
    bench(pen, o.x + fx(24, 96), o.y + 196, 96, t);
    toolbox(pen, o.x + fx(40, 26), o.y + 186, t);
    stool(pen, ...at(fx(66, 0), 78), t);
    stool(pen, ...at(fx(142, 0), 78), t);

    // Server/equipment racks against the far wall — the vertical mass the room
    // was missing entirely.
    rack(pen, o.x + fx(238, 40), o.y + 30, 40, 92, t);
    rack(pen, o.x + fx(284, 34), o.y + 30, 34, 74, t);
    // Wall screens above the main bench.
    panel(pen, o.x + fx(60, 46), o.y + 12, 46, 18, t);
    panel(pen, o.x + fx(120, 34), o.y + 12, 34, 18, t);
    // Coolant/power runs.
    pipes(pen, o.x + fx(6, 7), o.y + 40, 150, true, t);
    pipes(pen, o.x + 40, o.y + o.h - 14, o.w - 120, false, t);

    crate(pen, o.x + fx(250, 34), o.y + 200, 34, t);
    crate(pen, o.x + fx(252, 26), o.y + 166, 26, t);
    // Power run from under the main bench to a junction plate on the side wall.
    cable(
      pen,
      o.x + fx(24, 176) + (m ? 156 : 20),
      o.y + 58,
      o.x + fx(14, 0),
      o.y + 132,
      m ? -14 : 14
    );
    return;
  }

  if (o.id === 'greenhouse') {
    // Damp floor and dropped cuttings — this room leaks.
    spill(pen, o.x + 120, o.y + 120, 30, ENV.frond[0], o.seed + 7);
    spill(pen, o.x + 290, o.y + 160, 20, ENV.frond[1], o.seed + 17);
    papers(pen, o.x + 200, o.y + 70, 3, o.seed + 53);

    planter(pen, o.x + 18, o.y + 40, 60, 90, o.seed + 3);
    planter(pen, o.x + 18, o.y + 150, 60, 100, o.seed + 11);
    planter(pen, o.x + 110, o.y + 200, 160, 56, o.seed + 19);
    planter(pen, o.x + 250, o.y + 34, 108, 52, o.seed + 29);
    // Irrigation running the length of the beds, and a potting bench.
    pipes(pen, o.x + 14, o.y + 24, o.w - 40, false, t);
    pipes(pen, o.x + o.w - 16, o.y + 60, 150, true, t);
    bench(pen, o.x + 292, o.y + 110, 70, t);
    toolbox(pen, o.x + 300, o.y + 100, t);
    panel(pen, o.x + 150, o.y + 12, 40, 16, t);
    crate(pen, o.x + 300, o.y + 210, 32, t);
    // Vines climbing the walls from the beds.
    for (let i = 0; i < 6; i++) {
      pen.fill(pick(r, VINES), range(r, 0.5, 0.85));
      pen.poly(
        tendrilPts({
          x: range(r, o.x + 20, o.x + o.w - 20),
          y: o.y + (r() < 0.5 ? 6 : o.h - 6),
          angle: range(r, -Math.PI, Math.PI),
          len: range(r, 26, 54),
          width: range(r, 2.6, 4.4),
          curve: range(r, -1, 1),
        })
      );
    }
    return;
  }

  if (o.id === 'specimen') {
    // Containment: hazard paint at the threshold, something spilled that
    // nobody cleaned up, and more tanks than anyone is comfortable with.
    hazardStrip(pen, o.x + 12, o.y + o.h - 22, 120, 10);
    spill(pen, o.x + 210, o.y + 190, 26, 0x8a5ad0, o.seed + 23);
    papers(pen, o.x + 96, o.y + 96, 5, o.seed + 61);

    for (let i = 0; i < 4; i++) tank(pen, o.x + 60 + i * 60, o.y + 240, 18, t);
    tank(pen, o.x + 302, o.y + 66, 21, t);
    tank(pen, o.x + 302, o.y + 156, 21, t);
    rack(pen, o.x + 14, o.y + 96, 36, 84, t);
    pipes(pen, o.x + 56, o.y + 16, o.w - 110, false, t);
    panel(pen, o.x + 214, o.y + 60, 44, 20, t);
    toolbox(pen, o.x + 150, o.y + 150, t);
    crate(pen, o.x + 40, o.y + 26, 30, t);
    crate(pen, o.x + 76, o.y + 32, 24, t);
    // Containment rack along the top wall.
    pen.fill(0x241d33, 1);
    pen.roundRect(o.x + 130, o.y + 22, 130, 22, 4);
    pen.fill(0x33294a, 1);
    pen.roundRect(o.x + 130, o.y + 22, 130, 15, { tl: 4, tr: 4 });
    for (let i = 0; i < 5; i++) {
      pen.fill(t.accent, 0.7);
      pen.circle(o.x + 144 + i * 26, o.y + 30, 4);
    }
    pen.line(1.4, 0x1a1526, 0.7);
    pen.strokeRoundRect(o.x + 130, o.y + 22, 130, 22, 4);
    return;
  }

  // meeting — the social hub. Seating rings an empty centre.
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  bench(pen, o.x + 14, cy - 12, 74, t);
  bench(pen, o.x + o.w - 88, cy - 12, 74, t);
  monitor(pen, o.x + 51, cy, t);
  monitor(pen, o.x + o.w - 51, cy, t);
  // Outside the inlaid deck ring, not on it — seating sitting exactly on the
  // radius the floor pattern already draws reads as beads on a track.
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2 + 0.26;
    stool(pen, cx + Math.cos(a) * 112, cy + Math.sin(a) * 112 * 0.84, t);
  }
  crate(pen, o.x + 26, o.y + 34, 30, t);
  crate(pen, o.x + o.w - 62, o.y + o.h - 62, 30, t);
  // Notice board on the solid left wall.
  pen.fill(0x14251f, 1);
  pen.roundRect(o.x + 10, o.y + 90, 16, 44, 3);
  pen.fill(t.accent, 0.5);
  pen.roundRect(o.x + 12, o.y + 93, 12, 38, 2);

  // This is where the crew argues, so it gets the signs of a room people
  // actually gather in: a board wall of notices, dropped paperwork, coffee
  // rings on the deck.
  panel(pen, o.x + o.w - 74, o.y + 16, 56, 22, t);
  panel(pen, o.x + o.w - 74, o.y + 44, 34, 16, t);
  papers(pen, o.x + 92, o.y + o.h - 44, 4, o.seed + 71);
  papers(pen, o.x + o.w - 120, o.y + 58, 3, o.seed + 79);
  spill(pen, o.x + 128, o.y + 74, 13, 0x6b4a2a, o.seed + 83);
  spill(pen, o.x + o.w - 150, o.y + o.h - 70, 10, 0x6b4a2a, o.seed + 89);
  toolbox(pen, o.x + o.w - 108, o.y + o.h - 40, t);
  pipes(pen, o.x + 40, o.y + 10, o.w - 130, false, t);
}

// ── Foliage ──────────────────────────────────────────────────────────────────

/**
 * One clump of jungle growth: a dark mass, then fronds fanning out of it in
 * three brightness layers.
 *
 * The layering is the whole point. The old map drew flat translucent circles,
 * which read as fog rather than as plants; what makes foliage legible from above
 * is overlapping silhouettes with a value step between them.
 */
export function drawFoliageClump(
  pen: Pen,
  o: { x: number; y: number; scale: number; seed: number; depth?: number }
): void {
  const r = rng(o.seed);
  const s = o.scale;

  // Ground shadow the clump sits in. Soft, so a plant is bedded into the soil
  // rather than pasted on top of a dark blob the same shape as itself.
  softShadow(pen, o.x + 3 * s, o.y + 5 * s, 26 * s, 21 * s, {
    color: ENV.soilDark,
    alpha: 0.6,
    layers: 3,
    spread: 1.3,
  });

  // Each clump picks a depth band. Without this every clump lands in the same
  // narrow value range and the jungle reads as one repeated stamp — variety in
  // *brightness* does far more for it than variety in shape.
  //
  // The bands are wider than they were: the old top band topped out at frond[2],
  // so the brightest plant in the jungle was still darker than every room floor
  // and the whole canopy sat in a two-stop range. The near band now reaches
  // frondLit, which is what gives the foreground something to *be* in front of.
  // `o.depth` lets the composition assign a band instead of leaving it to the
  // seed: the background pass wants the dark end and the foreground pass the
  // bright end, which is what makes them read as different distances rather than
  // as the same jungle drawn twice. Still consumes r() either way, so forcing a
  // depth cannot shift the rest of this clump's random sequence.
  const rolled = r();
  const depth = o.depth ?? rolled;
  const band: readonly [number, number, number] =
    depth < 0.42
      ? [ENV.soilDark, ENV.canopy[0]!, ENV.canopy[1]!]
      : depth < 0.8
        ? [ENV.canopy[0]!, ENV.canopy[2]!, ENV.frond[0]!]
        : [ENV.canopy[2]!, ENV.frond[1]!, ENV.frondLit];

  // Three species, so the jungle is a jungle and not one leaf stamped 300
  // times. They differ in blade count, length and width — a broadleaf is few
  // and fat, a fern is many and thin, a palm is a sparse spray of long blades.
  const species = r();
  const shape =
    species < 0.5
      ? { n: [9, 7, 5], len: 34, w: 9, spread: 0.3, curve: 0.6 }
      : species < 0.82
        ? { n: [15, 12, 9], len: 30, w: 4.4, spread: 0.14, curve: 0.95 }
        : { n: [7, 5, 3], len: 46, w: 6.4, spread: 0.42, curve: 0.5 };

  // Three passes, dark to light. Later passes are shorter and sit on top, so
  // the clump has a visible interior instead of a single flat outline.
  const layers = [
    { c: band[0], n: shape.n[0]!, len: shape.len, w: shape.w },
    { c: band[1], n: shape.n[1]!, len: shape.len * 0.79, w: shape.w * 0.83 },
    { c: band[2], n: shape.n[2]!, len: shape.len * 0.59, w: shape.w * 0.67 },
  ];
  // One shared phase per clump so the layers stack into a plant rather than
  // three independent starbursts sharing a centre.
  const phase = range(r, 0, Math.PI * 2);
  for (const l of layers) {
    for (let i = 0; i < l.n; i++) {
      const a = phase + (i / l.n) * Math.PI * 2 + range(r, -shape.spread, shape.spread);
      pen.fill(l.c, 1);
      pen.poly(
        tendrilPts({
          x: o.x + range(r, -3, 3) * s,
          y: o.y + range(r, -3, 3) * s,
          angle: a,
          len: l.len * s * range(r, 0.7, 1.2),
          width: l.w * s * range(r, 0.75, 1.15),
          curve: range(r, -shape.curve, shape.curve),
          profile: 'leaf',
        })
      );
    }
  }

  pen.fill(band[2], 1);
  pen.poly(blobPts(o.x, o.y, (species < 0.82 ? 6.5 : 5) * s, 0.4, r, 7));

  // Bioluminescence, but sparsely: it is an accent, and one on every clump
  // turns the jungle into a starfield.
  if (depth > 0.62 && r() < 0.4) {
    const bx = o.x + range(r, -15, 15) * s;
    const by = o.y + range(r, -15, 15) * s;
    pen.fill(ENV.spore, 0.12);
    pen.circle(bx, by, 5 * s);
    pen.fill(ENV.bio, 0.7);
    pen.circle(bx, by, 1.4 * s);
  }
}

/** The jungle everything else sits on. */
export function drawJungle(pen: Pen, w: number, h: number, seed: number): void {
  const r = rng(seed);
  pen.fill(ENV.soil, 1);
  pen.rect(0, 0, w, h);

  // Broad tonal drifts, so the ground is not one flat colour under the clumps.
  for (let i = 0; i < 70; i++) {
    pen.fill(pick(r, [ENV.soilDark, ENV.canopy[0]!]), range(r, 0.3, 0.6));
    pen.poly(blobPts(range(r, 0, w), range(r, 0, h), range(r, 40, 130), 0.4, r, 9));
  }
  // Undergrowth speckle.
  for (let i = 0; i < 240; i++) {
    pen.fill(pick(r, [ENV.canopy[1]!, ENV.frond[0]!]), range(r, 0.35, 0.7));
    pen.poly(
      tendrilPts({
        x: range(r, 0, w),
        y: range(r, 0, h),
        angle: range(r, -Math.PI, Math.PI),
        len: range(r, 10, 26),
        width: range(r, 3, 6),
        curve: range(r, -0.6, 0.6),
        profile: 'leaf',
      })
    );
  }
}

/** Boardwalk: planks across the corridor, with grime and a couple of gaps. */
export function drawPathFloor(pen: Pen, o: Rect & { seed: number }): void {
  const r = rng(o.seed);
  pen.fill(ENV.pathFloor, 1);
  pen.rect(o.x, o.y, o.w, o.h);

  // Planks run across the short axis, the way a boardwalk is actually laid.
  const across = o.w >= o.h;
  const n = Math.ceil((across ? o.w : o.h) / 22);
  for (let i = 0; i < n; i++) {
    const p = i * 22;
    const len = Math.min(22, (across ? o.w : o.h) - p);
    if (len <= 0) break;
    pen.fill(i % 2 === 0 ? ENV.pathPlank : ENV.pathPlankAlt, 1);
    if (across) pen.rect(o.x + p, o.y, len - 2, o.h);
    else pen.rect(o.x, o.y + p, o.w, len - 2);
    pen.fill(ENV.pathGrime, 0.8);
    if (across) pen.rect(o.x + p + len - 2, o.y, 2, o.h);
    else pen.rect(o.x, o.y + p + len - 2, o.w, 2);
  }

  // Stringers along the edges, and grime where the jungle creeps in.
  pen.fill(ENV.pathGrime, 0.85);
  if (across) {
    pen.rect(o.x, o.y, o.w, 4);
    pen.rect(o.x, o.y + o.h - 4, o.w, 4);
  } else {
    pen.rect(o.x, o.y, 4, o.h);
    pen.rect(o.x + o.w - 4, o.y, 4, o.h);
  }
  for (let i = 0; i < 10; i++) {
    pen.fill(pick(r, [ENV.frond[0]!, ENV.pathGrime]), range(r, 0.3, 0.6));
    pen.poly(
      blobPts(
        range(r, o.x, o.x + o.w),
        range(r, o.y, o.y + o.h),
        range(r, 6, 16),
        0.5,
        r,
        7
      )
    );
  }
}

// ── Walls ────────────────────────────────────────────────────────────────────

/** An interval on one edge, in that edge's own axis. */
type Span = [number, number];

/**
 * Subtract a set of intervals from `[a, b]`.
 *
 * This is what keeps walls off the doorways. The walkable region is a union of
 * overlapping rects — the corridors reach *into* the rooms — so a room's edge is
 * only a wall where no other rect covers it. Deriving the gaps this way rather
 * than listing doorways by hand means they cannot drift from the collision
 * geometry the server enforces: move a corridor in constants.ts and the doorway
 * moves with it.
 */
function subtract(a: number, b: number, cuts: readonly Span[]): Span[] {
  let spans: Span[] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: Span[] = [];
    for (const [s0, s1] of spans) {
      if (c1 <= s0 || c0 >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (c0 > s0) next.push([s0, c0]);
      if (c1 < s1) next.push([c1, s1]);
    }
    spans = next;
  }
  return spans;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface WallSeg {
  side: Side;
  /** The wall slab itself, in world coordinates, standing outside `rect`. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The wall segments for one rect, given every other rect in the map.
 *
 * A tolerance of 1px is used when testing whether a neighbour touches an edge,
 * because the map data is integral and exact-equality on floats is a trap
 * waiting for the first non-integer rect somebody adds.
 */
export function wallsFor(rect: Rect, others: readonly Rect[]): WallSeg[] {
  const E = 1;
  const out: WallSeg[] = [];
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;

  const cutsOn = (horizontal: boolean, at: number): Span[] =>
    others
      .filter((o) =>
        horizontal
          ? o.y - E <= at && o.y + o.h + E >= at && o.x < x1 && o.x + o.w > rect.x
          : o.x - E <= at && o.x + o.w + E >= at && o.y < y1 && o.y + o.h > rect.y
      )
      .map((o): Span =>
        horizontal
          ? [Math.max(rect.x, o.x), Math.min(x1, o.x + o.w)]
          : [Math.max(rect.y, o.y), Math.min(y1, o.y + o.h)]
      )
      .filter(([a, b]) => b > a);

  // Walls are extended by WALL_T at the corners so adjacent runs mitre instead
  // of leaving a notch — but only where the corner is actually solid.
  for (const [a, b] of subtract(rect.x, x1, cutsOn(true, rect.y)))
    out.push({ side: 'top', x: a, y: rect.y - WALL_T, w: b - a, h: WALL_T });
  for (const [a, b] of subtract(rect.x, x1, cutsOn(true, y1)))
    out.push({ side: 'bottom', x: a, y: y1, w: b - a, h: WALL_T });
  for (const [a, b] of subtract(rect.y, y1, cutsOn(false, rect.x)))
    out.push({ side: 'left', x: rect.x - WALL_T, y: a - WALL_T, w: WALL_T, h: b - a + WALL_T * 2 });
  for (const [a, b] of subtract(rect.y, y1, cutsOn(false, x1)))
    out.push({ side: 'right', x: x1, y: a - WALL_T, w: WALL_T, h: b - a + WALL_T * 2 });

  return out;
}

/**
 * Draw one wall slab: cast shadow, dark base, lit top face, bright lip.
 *
 * A wall reads as a wall because it has thickness and catches light on top, not
 * because it has an outline. The light is treated as coming from the top-left of
 * the world, consistently with the character rim light.
 */
export function drawWall(pen: Pen, s: WallSeg): void {
  // Cast shadow, thrown down-right onto whatever the wall stands on. Soft, and
  // wider than the wall: a hard-edged rect offset by four pixels reads as a
  // duplicate of the wall rather than as the shadow of one.
  softShadowRect(pen, s.x + 4, s.y + 5, s.w, s.h, 2, {
    color: ENV.wallShadow,
    alpha: 0.55,
    layers: 4,
    spread: 1.8,
  });

  pen.fill(ENV.wallDark, 1);
  pen.rect(s.x, s.y, s.w, s.h);
  // The top face, inset — this is the thickness.
  pen.fill(ENV.wall, 1);
  pen.rect(s.x, s.y, s.w, s.h - 3);
  pen.fill(ENV.wallTop, 1);
  pen.rect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 6);

  // Lit lip on the edge facing the light, shadow on the far one.
  const vertical = s.side === 'left' || s.side === 'right';
  pen.fill(ENV.wallLip, 0.9);
  if (vertical) pen.rect(s.x, s.y, 2, s.h);
  else pen.rect(s.x, s.y, s.w, 2);
  pen.fill(ENV.wallDark, 0.75);
  if (vertical) pen.rect(s.x + s.w - 2, s.y, 2, s.h);
  else pen.rect(s.x, s.y + s.h - 2, s.w, 2);

  // Panel seams, so a long run is not one undifferentiated bar.
  pen.fill(ENV.wallDark, 0.5);
  const step = 46;
  if (vertical) for (let y = s.y + step; y < s.y + s.h - 6; y += step) pen.rect(s.x + 1, y, s.w - 2, 1.6);
  else for (let x = s.x + step; x < s.x + s.w - 6; x += step) pen.rect(x, s.y + 1, 1.6, s.h - 2);
}

/**
 * A boardwalk railing. The corridors get this rather than a wall — a low rail
 * says "you may walk here, and not off the side" without boxing the paths in
 * like rooms, and it keeps sightlines open, which matters in a game about
 * watching where people go.
 */
export function drawRailing(pen: Pen, s: WallSeg): void {
  const vertical = s.side === 'left' || s.side === 'right';
  const t = 5;
  // Sit the rail on the outer edge of the wall band rather than filling it.
  const x = vertical && s.side === 'left' ? s.x + s.w - t : s.x;
  const y = !vertical && s.side === 'top' ? s.y + s.h - t : s.y;
  const w = vertical ? t : s.w;
  const h = vertical ? s.h : t;

  softShadowRect(pen, x + 3, y + 4, w, h, 2, {
    color: ENV.wallShadow,
    alpha: 0.46,
    layers: 3,
    spread: 1.3,
  });
  pen.fill(ENV.pathGrime, 1);
  pen.rect(x, y, w, h);
  pen.fill(ENV.pathPlank, 1);
  pen.rect(x, y, vertical ? w - 1.6 : w, vertical ? h : h - 1.6);
  pen.fill(ENV.wallLip, 0.35);
  if (vertical) pen.rect(x, y, 1.6, h);
  else pen.rect(x, y, w, 1.6);

  // Posts.
  const step = 40;
  const len = vertical ? h : w;
  for (let p = 6; p < len - 6; p += step) {
    pen.fill(ENV.pathGrime, 1);
    if (vertical) pen.roundRect(x - 1.6, y + p, t + 3.2, 7, 1.6);
    else pen.roundRect(x + p, y - 1.6, 7, t + 3.2, 1.6);
  }
}

/**
 * The bioluminescent lamp that marks a doorway. Kept from the original map —
 * it is the game's visual signature — but now sitting on a real floor.
 */
export function drawLamp(pen: Pen, x: number, y: number, tint: number = ENV.bio): void {
  // Was a hand-rolled three-ring stack at 0.1/0.16/0.5. `bloom` is that idiom
  // generalised, on a cubic radius falloff — wide halo, tight core, which is how
  // a point source actually behaves.
  bloom(pen, x, y, 7, { color: tint, alpha: 0.52, layers: 5, spread: 3.8 });
  pen.fill(ENV.bioCore, 0.95);
  pen.circle(x, y, 3);
  // Filament flare.
  pen.fill(ENV.bioCore, 0.35);
  pen.poly(arcPts(x, y, 9, 0, Math.PI * 2, 4));
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * One slab of the outpost. Structurally the shared `RoomVisual`, restated here
 * so this module stays pure geometry with no package imports and can be hosted
 * by the SVG preview as easily as by Phaser.
 */
export interface Slab extends Rect {
  kind: 'room' | 'path';
  area: string;
  name: string;
}

/**
 * Draw the whole outpost, back to front: jungle, foliage, wall shadows, floors,
 * walls, props, lamps.
 *
 * Order is doing real work here. Walls are drawn *outward* from the walkable
 * rects and floors are drawn before them, so a floor never paints over the wall
 * of the room next door; foliage goes down before the buildings so clumps are
 * clipped by the structures rather than growing out of the roofs.
 */
export function drawOutpost(
  pen: Pen,
  opts: {
    slabs: readonly Slab[];
    themes: Record<string, RoomTheme>;
    width: number;
    height: number;
    seed: number;
  }
): void {
  const { slabs, themes, width, height } = opts;
  const r = rng(opts.seed);

  drawJungle(pen, width, height, opts.seed);

  // Foliage on a jittered grid, skipping anything that overlaps the outpost.
  // A grid keeps the spacing even without the clustering that pure rejection
  // sampling gives you, which on a map this size looks like a rendering fault.
  const pad = WALL_T + 16;
  const clear = (x: number, y: number) =>
    !slabs.some(
      (s) => x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad
    );
  for (let gy = 40; gy < height; gy += 78) {
    for (let gx = 40; gx < width; gx += 78) {
      const x = gx + range(r, -26, 26);
      const y = gy + range(r, -26, 26);
      const scale = range(r, 0.55, 1.15);
      if (!clear(x, y)) continue;
      drawFoliageClump(pen, { x, y, scale, seed: Math.floor(range(r, 1, 1e6)) });
    }
  }

  // Floors. Paths first so room floors and their wall bases sit on top.
  for (const s of slabs) {
    if (s.kind !== 'path') continue;
    drawPathFloor(pen, { ...s, seed: hash(s) });
  }
  for (const s of slabs) {
    if (s.kind === 'path') continue;
    const theme = themes[s.area] ?? themes['meeting']!;
    drawRoomFloor(pen, { ...s, theme, seed: hash(s) });
  }

  // Walls, derived from the same rect union the server uses for collision.
  const rects: Rect[] = slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  slabs.forEach((s, i) => {
    const others = rects.filter((_, j) => j !== i);
    if (s.kind === 'path') {
      for (const seg of wallsFor(s, others)) drawRailing(pen, seg);
    } else {
      for (const seg of wallsFor(s, others)) drawWall(pen, seg);
    }
  });

  // Props, then the lamps on top of everything so their glow is not buried.
  for (const s of slabs) {
    if (s.kind === 'path') continue;
    const theme = themes[s.area] ?? themes['meeting']!;
    drawProps(pen, { ...s, id: s.area, theme, seed: hash(s) + 7 });
  }
  for (const s of slabs) {
    if (s.kind === 'path') continue;
    const theme = themes[s.area] ?? themes['meeting']!;
    for (const [lx, ly] of [
      [s.x + LAMP_INSET, s.y + LAMP_INSET],
      [s.x + s.w - LAMP_INSET, s.y + LAMP_INSET],
      [s.x + LAMP_INSET, s.y + s.h - LAMP_INSET],
      [s.x + s.w - LAMP_INSET, s.y + s.h - LAMP_INSET],
    ] as const) {
      drawLamp(pen, lx, ly, theme.accent);
    }
  }
}

/** Stable per-slab seed. Position-derived, so it never depends on array order. */
function hash(s: Rect): number {
  return ((s.x * 73856093) ^ (s.y * 19349663) ^ (s.w * 83492791) ^ s.h) & 0x7fffffff;
}
