/**
 * A tiny 2D drawing surface, and the geometry helpers the art is built from.
 *
 * The art in this folder is deliberately written against this interface rather
 * than against `Phaser.GameObjects.Graphics` directly. Two reasons:
 *
 *  1. The drawing code becomes pure geometry with no Phaser import, so it can be
 *     rendered outside a browser. `scripts/preview-art.ts` implements this same
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

/**
 * A sampled ellipse outline.
 *
 * The Pen has `ellipse` but no `strokeEllipse`, because Phaser's Graphics has no
 * primitive for one either. Rather than every caller rolling its own point ring
 * (the stool rim in mapArt.ts used to), stroke this with {@link Pen.strokePoly}.
 */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// ── Colour ───────────────────────────────────────────────────────────────────

/**
 * Linear blend between two packed 0xRRGGBB colours.
 *
 * Interpolating in sRGB rather than a perceptual space is deliberate: it is what
 * a painter blending two swatches gets, the inputs here are already
 * hand-tuned neighbours rather than arbitrary far-apart hues, and the result has
 * to be reproducible by eye when someone later edits a palette entry.
 */
export function mix(a: number, b: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((ar + (br - ar) * k) << 16) |
    ((ag + (bg - ag) * k) << 8) |
    (ab + (bb - ab) * k)
  ) & 0xffffff;
}

/** Toward black. `t` is how far. */
export function darken(c: number, t: number): number {
  return mix(c, 0x000000, t);
}

/** Toward white. Washes out saturation, so prefer {@link warm} for lit faces. */
export function lighten(c: number, t: number): number {
  return mix(c, 0xffffff, t);
}

/**
 * Toward a warm lamp colour rather than toward white.
 *
 * Lighting a surface by lerping to #fff desaturates it, which is what made the
 * first pass of this map read as grey-green plastic. Real light has a colour;
 * this outpost is lit by warm work-lamps under a bioluminescent canopy, so lit
 * faces move toward amber and keep their chroma.
 */
export function warm(c: number, t: number): number {
  return mix(c, 0xffd9a0, t);
}

/** Toward the cool bounce of the jungle canopy — for shadow sides, not black. */
export function cool(c: number, t: number): number {
  return mix(c, 0x0d2f3a, t);
}

// ── Easing ───────────────────────────────────────────────────────────────────

/** Classic smoothstep. Falloff curve for the shading helpers below. */
export function smoothstep(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/** Fast out, slow in — the shape of a light pool's edge. */
export function easeOutCubic(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - k) ** 3;
}

// ── Soft layering ────────────────────────────────────────────────────────────

/**
 * Why these exist, and why they are not a `fillGradient` on the Pen.
 *
 * Phaser's `fillGradientStyle` is WebGL-only — it silently degrades to a flat
 * fill on the Canvas renderer, and there is no way to express it in the SVG
 * preview at all. A gradient primitive on the interface would therefore mean art
 * that looks one way in the previewer, another way in a WebGL browser, and a
 * third way in a Canvas fallback, which defeats the whole point of the Pen.
 *
 * So gradients here are *built* out of stacked primitives that every backend
 * already renders identically: banded fills for linear ramps, alpha stacks for
 * soft falloff. Everything below is a generalisation of an idiom the art was
 * already hand-rolling in five places — the eye highlight rings in chibi.ts, the
 * lamp glow and screen spill in mapArt.ts, the cable's three-pass stroke.
 *
 * The band counts are affordable because none of this runs per frame: the map is
 * baked into one RenderTexture at boot and characters into 9 textures per
 * variant. This is load-time cost, not frame cost.
 */

/** Shared shape of the falloff stacks. */
export interface SoftOpts {
  color: number;
  /** Approximate opacity at the core, after the layers accumulate. */
  alpha?: number;
  /** How many stacked passes. More is smoother and costs more. */
  layers?: number;
  /** How far past the given size the faintest layer reaches, as a multiple. */
  spread?: number;
}

/**
 * Per-layer alphas that accumulate to roughly `alpha` at the core.
 *
 * Weights rise linearly toward the centre and are normalised by their sum, so
 * the stack lands a little under the requested alpha rather than saturating to
 * opaque the way a naive `alpha` per layer would.
 */
function stackAlphas(alpha: number, layers: number): number[] {
  const sum = (layers * (layers + 1)) / 2;
  const out: number[] = [];
  for (let i = 0; i < layers; i++) out.push((alpha * (i + 1)) / sum);
  return out;
}

/**
 * A soft elliptical shadow — the thing under a character's feet or a prop.
 *
 * A single flat ellipse at 38% black is what "no shadow budget" looks like: it
 * reads as a sticker, and it is the first thing that separates a code-drawn
 * scene from a lit one. Four rings cost four fills and the sprite suddenly sits
 * *on* the floor.
 */
export function softShadow(
  pen: Pen,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: SoftOpts
): void {
  const layers = o.layers ?? 4;
  const spread = o.spread ?? 1.75;
  const alphas = stackAlphas(o.alpha ?? 0.4, layers);
  for (let i = 0; i < layers; i++) {
    // i = 0 is the outermost, faintest ring.
    const k = layers === 1 ? 0 : i / (layers - 1);
    const s = spread + (1 - spread) * k;
    pen.fill(o.color, alphas[i]!);
    pen.ellipse(cx, cy, rx * s, ry * s);
  }
}

/**
 * The same falloff for a rounded rectangle: prop bases, wall casts, HUD plates.
 *
 * Grows outward from the given rect rather than inward, so the rect you pass is
 * the shape casting the shadow, not the shadow's own bounds.
 */
export function softShadowRect(
  pen: Pen,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  o: SoftOpts
): void {
  const layers = o.layers ?? 4;
  const grow = (o.spread ?? 1.5) * 3;
  const alphas = stackAlphas(o.alpha ?? 0.4, layers);
  for (let i = 0; i < layers; i++) {
    const k = layers === 1 ? 0 : i / (layers - 1);
    const g = grow * (1 - k);
    pen.fill(o.color, alphas[i]!);
    pen.roundRect(x - g, y - g, w + g * 2, h + g * 2, radius + g);
  }
}

/**
 * A glow: concentric rings brightening toward a core.
 *
 * Generalises the four-ring lamp stack the map already drew by hand. Used for
 * lamps, task-station markers, screen spill and bioluminescence, so all of them
 * fall off on the same curve instead of each inventing its own.
 */
export function bloom(pen: Pen, cx: number, cy: number, r: number, o: SoftOpts): void {
  const layers = o.layers ?? 4;
  const spread = o.spread ?? 3;
  const alpha = o.alpha ?? 0.5;
  for (let i = 0; i < layers; i++) {
    // Outermost first. Radius shrinks on a cubic so the halo is wide and the
    // core is tight, which is how a point source actually falls off.
    const k = layers === 1 ? 1 : i / (layers - 1);
    const rr = r * (spread - (spread - 1) * easeOutCubic(k));
    pen.fill(o.color, alpha * (0.12 + 0.88 * k ** 2));
    pen.circle(cx, cy, rr);
  }
}

/**
 * A banded linear gradient across a rect.
 *
 * `bands` opaque strips, each one colour-lerped, overlapping by a hair so
 * antialiasing cannot leave a seam between them. 10-14 bands is invisible as
 * banding on a floor slab at play scale; below about 6 it starts to read as
 * deliberate stripes.
 */
export function gradRect(
  pen: Pen,
  x: number,
  y: number,
  w: number,
  h: number,
  from: number,
  to: number,
  opts: { bands?: number; dir?: 'v' | 'h'; ease?: (t: number) => number } = {}
): void {
  const bands = opts.bands ?? 12;
  const dir = opts.dir ?? 'v';
  const ease = opts.ease ?? ((t: number) => t);
  const span = dir === 'v' ? h : w;
  const step = span / bands;
  for (let i = 0; i < bands; i++) {
    pen.fill(mix(from, to, ease(bands === 1 ? 0 : i / (bands - 1))), 1);
    // The +0.6 overlap is under a pixel but covers the seam a fractional band
    // boundary would otherwise leave.
    const a = i * step;
    const b = Math.min(span, a + step + 0.6);
    if (dir === 'v') pen.rect(x, y + a, w, b - a);
    else pen.rect(x + a, y, b - a, h);
  }
}

/** Which edge {@link insetShade} is measuring from. */
export type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * Ambient occlusion along one inside edge of a rect: dark at the wall, fading
 * to nothing `depth` units in.
 *
 * Replaces the flat "one dark rect against the wall" approximation. The strips
 * do not overlap and each carries its own alpha off a smoothstep, so the total
 * darkness is exactly what was asked for rather than whatever N translucent
 * layers happened to accumulate to.
 */
export function insetShade(
  pen: Pen,
  r: { x: number; y: number; w: number; h: number },
  side: Side,
  depth: number,
  o: { color?: number; alpha?: number; bands?: number } = {}
): void {
  const bands = o.bands ?? 7;
  const alpha = o.alpha ?? 0.22;
  const color = o.color ?? 0x000000;
  const step = depth / bands;
  for (let i = 0; i < bands; i++) {
    const a = alpha * (1 - smoothstep(i / bands));
    if (a <= 0.002) continue;
    pen.fill(color, a);
    const d = i * step;
    if (side === 'top') pen.rect(r.x, r.y + d, r.w, step + 0.5);
    else if (side === 'bottom') pen.rect(r.x, r.y + r.h - d - step, r.w, step + 0.5);
    else if (side === 'left') pen.rect(r.x + d, r.y, step + 0.5, r.h);
    else pen.rect(r.x + r.w - d - step, r.y, step + 0.5, r.h);
  }
}

/**
 * A soft pool of light or shade on the floor, as concentric ellipses.
 *
 * The counterpart to {@link insetShade} for the middle of a room: a floor that
 * is uniformly one value reads as a swatch, and one lamp pool per corner is what
 * turns it into a lit surface.
 */
export function pool(
  pen: Pen,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: { color?: number; alpha?: number; bands?: number } = {}
): void {
  const bands = o.bands ?? 8;
  const alpha = o.alpha ?? 0.16;
  const color = o.color ?? 0xffffff;
  for (let i = 0; i < bands; i++) {
    const k = i / bands;
    pen.fill(color, (alpha * (1 - smoothstep(k))) / 2);
    pen.ellipse(cx, cy, rx * (1 - k * 0.86), ry * (1 - k * 0.86));
  }
}

