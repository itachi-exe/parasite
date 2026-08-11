/**
 * A tiny 2D drawing surface, and the geometry helpers the art is built from.
 *
 * The art in this folder is deliberately written against this interface rather
 * than against `Phaser.GameObjects.Graphics` directly. Two reasons:
 *
 *  1. The drawing code becomes pure geometry with no Phaser import, so it can be
 *     rendered outside a browser. `scripts/preview-art.mjs` implements this same
 *     interface as an SVG emitter and rasterises it, which is how the character
 *     and map art was actually eyeballed during the build — there is no headless
 *     browser here, and "it typechecks" says nothing about whether a drawing
 *     looks right.
 *  2. It keeps the Phaser-specific quirks (ellipses taking width/height rather
 *     than radii, degrees vs radians) in exactly one adapter instead of smeared
 *     through every shape.
 *
 * Coordinates are plain units; the adapter applies any supersampling scale.
 */

export type Pt = readonly [number, number];

/** Per-corner radii for {@link Pen.roundRect}. Omitted corners are square. */
export interface Corners {
  tl?: number;
  tr?: number;
  bl?: number;
  br?: number;
}

export interface Pen {
  /** Set the fill colour for subsequent fill calls. */
  fill(color: number, alpha?: number): void;
  /** Set the stroke width/colour for subsequent stroke calls. */
  line(width: number, color: number, alpha?: number): void;

  rect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number | Corners): void;
  circle(x: number, y: number, r: number): void;
  /** Radii, not width/height. */
  ellipse(x: number, y: number, rx: number, ry: number): void;
  /** Filled closed polygon. */
  poly(pts: readonly Pt[]): void;

  strokePoly(pts: readonly Pt[], close?: boolean): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  strokeCircle(x: number, y: number, r: number): void;
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number | Corners): void;
}

// ── Determinism ──────────────────────────────────────────────────────────────

/**
 * The same LCG the original map code used, kept because every client must draw
 * an identical map. `Math.random` here would mean two players looking at
 * visibly different foliage, which reads as a bug even though nothing about the
 * simulation diverges.
 */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Deterministic value in [lo, hi). */
export function range(r: () => number, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

/** Deterministic pick from a non-empty list. */
export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;
}

// ── Point generators ─────────────────────────────────────────────────────────

/** Sampled arc, for stroked curves without needing an arc primitive. */
export function arcPts(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  steps = 12
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function quad(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
  ];
}

/**
 * A tapered curved sliver: vines, tendrils, ponytails, grass blades.
 *
 * `curve` bends the shape sideways (radians of control-point offset), `profile`
 * shapes the width along the length — 'taper' for a tendril that narrows to a
 * point, 'leaf' for something fattest in the middle.
 */
export function tendrilPts(opts: {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  curve?: number;
  profile?: 'taper' | 'leaf';
  steps?: number;
}): Pt[] {
  const { x, y, angle, len, width } = opts;
  const curve = opts.curve ?? 0;
  const steps = opts.steps ?? 8;
  const profile = opts.profile ?? 'taper';

  const p0: Pt = [x, y];
  const p1: Pt = [x + Math.cos(angle) * len, y + Math.sin(angle) * len];
  const mid = angle + curve;
  const c: Pt = [x + Math.cos(mid) * len * 0.55, y + Math.sin(mid) * len * 0.55];

  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = quad(p0, c, p1, t);
    const n = quad(p0, c, p1, Math.min(1, t + 0.02));
    const dx = n[0] - p[0];
    const dy = n[1] - p[1];
    const m = Math.hypot(dx, dy) || 1;
    const w = (profile === 'leaf' ? Math.sin(Math.PI * t) : 1 - t) * width;
    left.push([p[0] - (dy / m) * w, p[1] + (dx / m) * w]);
    right.push([p[0] + (dy / m) * w, p[1] - (dx / m) * w]);
  }
  return [...left, ...right.reverse()];
}

/**
 * A capsule with independent end radii, at any angle: the two circular caps and
 * the hull between them, as one closed outline so it can be filled and keylined
 * with a single stroke.
 *
 * The Pen has no transform stack, so anything off-axis is built from points — and
 * a body on the floor is nothing but off-axis limbs.
 */
export function capsulePts(
  x: number,
  y: number,
  angle: number,
  len: number,
  w0: number,
  w1: number,
  steps = 8
): Pt[] {
  const ex = x + Math.cos(angle) * len;
  const ey = y + Math.sin(angle) * len;
  const h = Math.PI / 2;
  return [
    ...arcPts(x, y, w0, angle + h, angle + 3 * h, steps),
    ...arcPts(ex, ey, w1, angle - h, angle + h, steps),
  ];
}

/**
 * An egg: an ellipse whose radii differ between its two ends, blended smoothly
 * across. The big end is at -x.
 *
 * Wide at one end and narrow at the other is the whole difference between a body
 * and a pill — a slumped figure is shoulders tapering to hips, and a rounded rect
 * in the same place reads as an appliance.
 */
export function eggPts(
  cx: number,
  cy: number,
  rxBig: number,
  rxSmall: number,
  ryBig: number,
  rySmall: number,
  n = 26
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const t = (1 - Math.cos(a)) / 2;
    const rx = rxSmall + (rxBig - rxSmall) * t;
    const ry = rySmall + (ryBig - rySmall) * t;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** A rough blob — moss patches, spill stains, canopy clumps. */
export function blobPts(
  x: number,
  y: number,
  r: number,
  wobble: number,
  rand: () => number,
  lobes = 9
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (1 - wobble + rand() * wobble * 2);
    out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.82]);
  }
  return out;
}
