/**
 * The scientists, the infected, and the Parasite — built entirely from filled
 * primitives.
 *
 * Everything here draws into a {@link Pen}, in a fixed 64x76 cell with the
 * character's feet on `FEET`. `bakeCharacters` in phaserPen.ts renders each
 * (form, facing, step) combination into its own texture once at scene start and
 * hands them to Phaser's animation system, so the per-frame cost at runtime is a
 * texture swap and nothing else.
 *
 * The three facings are drawn, not flipped-and-hoped: the front view has a face,
 * an open coat and chest straps; the back view is a hair mass, a closed coat and
 * the backpack those straps belong to; the side view is a true profile with the
 * pack peeking out behind and a nose on the silhouette. `side` is mirrored for
 * left/right, which is the one place a flip is honest — a profile mirrors
 * cleanly, a front pose does not.
 */

import {
  type Pen,
  type Pt,
  tendrilPts,
  blobPts,
  capsulePts,
  eggPts,
  rng,
  range,
  softShadow,
  mix,
  warm,
  cool,
} from './pen';
import {
  type CharPalette,
  type Accessory,
  VINES,
} from './palette';

export type Facing = 'down' | 'up' | 'side';
/** Walk phase: -1 and +1 are the contact poses, 0 is the passing pose. */
export type Step = -1 | 0 | 1;
export type Form = 'human' | 'infected' | 'parasite';

export const CELL_W = 64;
export const CELL_H = 76;
/** Ground line inside the cell. The sprite origin is placed here. */
export const FEET = 66;
export const ORIGIN_Y = FEET / CELL_H;

const CX = 32;
const HEAD_Y = 20;
const HEAD_R = 15;
/** Top of the coat. The head tucks over it, the legs emerge below it. */
const TORSO_Y = 32;
const TORSO_H = 21;
const ARM_Y = 34;
/**
 * Hips. Legs start well above the coat hem so they are overlapped, not hidden —
 * roughly a fifth of the body has to be visible leg or the walk cycle reads as
 * a sliding statue however good the pose is.
 */
const LEG_TOP = 46;
/** Stride amplitude, in pixels of foot travel from neutral. */
const STRIDE = 4.5;

/**
 * Passing pose rides higher than the contacts — real squash and stretch.
 *
 * Deepened from -2 to -2.6 and paired with `squash` below. Two pixels of rise on
 * a 76px cell is most of the difference between a character who walks and one who
 * slides, and it was under-reading at play scale.
 */
function lift(step: Step): number {
  return step === 0 ? -2.6 : 0;
}

/**
 * Horizontal squash to go with the vertical lift.
 *
 * A body that rises without narrowing has changed size, not shape. The contacts
 * are the compressed poses (weight landing, so wider and shorter) and the passing
 * pose is the extended one. Returned as a multiplier on half-widths.
 */
function squash(step: Step): number {
  return step === 0 ? 0.975 : 1.02;
}

/**
 * The world's light direction, as a sign on x.
 *
 * Top-left, matching the map's walls and prop shadows (see `drawWall` in
 * mapArt.ts). Every lit face and every core shadow in this file derives from
 * this rather than being decided per shape, which is what stops one limb being
 * lit from the left and its neighbour from the right.
 */
const LIT = -1;

/**
 * A lit and a shaded version of a surface colour.
 *
 * Lit faces move toward the warm work-lamp colour rather than toward white, and
 * shaded faces toward the jungle's cool bounce rather than toward black. Lerping
 * to white and black is what made the first pass of these characters read as grey
 * plastic: it desaturates on both ends, so the mid-tone was the only colour left
 * with any life in it.
 */
function litFace(c: number, t = 0.16): number {
  return warm(c, t);
}
function shadeFace(c: number, t = 0.24): number {
  return cool(c, t);
}


// ── Shared bits ──────────────────────────────────────────────────────────────

function eye(pen: Pen, pal: CharPalette, x: number, y: number, s = 1): void {
  if (pal.eyeGlow !== null) {
    pen.fill(pal.eyeGlow, 0.16);
    pen.circle(x, y, 6.4 * s);
    pen.fill(pal.eyeGlow, 0.42);
    pen.circle(x, y, 3.9 * s);
    pen.fill(pal.eyeGlow, 1);
    pen.ellipse(x, y, 2.4 * s, 2.9 * s);
    pen.fill(0xffffff, 0.85);
    pen.circle(x, y - 0.7 * s, 1 * s);
    return;
  }
  pen.fill(0xffffff, 0.93);
  pen.ellipse(x, y, 2.9 * s, 3.4 * s);
  pen.fill(pal.eye);
  pen.ellipse(x, y + 0.3 * s, 2.1 * s, 2.6 * s);
  pen.fill(0xffffff, 0.95);
  pen.circle(x - 0.7 * s, y - 1 * s, 0.85 * s);
}

/**
 * The keyline. Vector characters need it to hold up over a dark floor.
 *
 * Both the weight and the colour changed in the GGD readability pass. It was
 * 1.1px of near-black at 0.35–0.55 alpha, which measured as "present" and read as
 * "absent": against the near-black jungle soil a black outline is the same value
 * as the background, so it separated nothing at all — the one place the character
 * most needed an edge was the one place the edge disappeared.
 *
 * Now 1.5px at 0.72–0.9 of a very dark *teal* (see OUTLINE in palette.ts), which
 * stays darker than the coat but lighter than the soil, so it works as a boundary
 * in both directions. This is the single biggest readability win in the pass and
 * the cheapest.
 */
function key(pen: Pen, pal: CharPalette, a = 1): void {
  // 2.8px opaque, not 1.5px at 85%. The reference art this project is measured
  // against is built on heavy, fully-opaque linework — it is the single loudest
  // signal separating "illustrated character" from "coloured shapes", and a
  // hairline keyline at a 40px display size reads as no keyline at all.
  pen.line(2.8, pal.outline, a);
}

/** A lighter inner keyline, for seams and panels *inside* the silhouette. */
function seam(pen: Pen, pal: CharPalette, a = 0.55): void {
  pen.line(1.5, pal.outline, a);
}


/**
 * One filled, keylined capsule, returning the point it ended at so the next one
 * can start there. Limbs at an angle are built from these.
 *
 * `halo` puts a wider capsule of scene bounce light behind the fill first. Near
 * black trousers over a near black shadow have no edge at all otherwise — a dark
 * keyline around a dark shape on a dark floor separates nothing.
 */
function seg(
  pen: Pen,
  pal: CharPalette,
  color: number,
  x: number,
  y: number,
  angle: number,
  len: number,
  w0: number,
  w1: number,
  halo = false
): Pt {
  if (halo) {
    pen.fill(pal.rim, 0.11);
    pen.poly(capsulePts(x, y, angle, len, w0 + 1.1, w1 + 1.1));
  }
  const pts = capsulePts(x, y, angle, len, w0, w1);
  pen.fill(color);
  pen.poly(pts);
  key(pen, pal, 0.72);
  pen.strokePoly(pts, true);
  return [x + Math.cos(angle) * len, y + Math.sin(angle) * len];
}

/**
 * Hairline fractures for the infected form. Seeded by facing alone so the cracks
 * stay put across the walk cycle instead of crawling around the face.
 */
function crackle(pen: Pen, facing: Facing, ly: number): void {
  const r = rng(facing === 'down' ? 4801 : facing === 'up' ? 9137 : 2683);
  pen.line(0.9, 0x2c3a29, 0.75);
  const n = facing === 'up' ? 4 : 7;
  for (let i = 0; i < n; i++) {
    const x = range(r, CX - 13, CX + 13);
    const y = range(r, HEAD_Y + ly - 10, HEAD_Y + ly + 10);
    const a = range(r, -1.4, 1.4);
    const len = range(r, 3.5, 7);
    const pts: Pt[] = [
      [x, y],
      [x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + 1],
      [x + Math.cos(a) * len, y + Math.sin(a) * len],
    ];
    pen.strokePoly(pts);
  }
  // Mossy bloom creeping over the coat.
  for (let i = 0; i < 5; i++) {
    pen.fill(0x7d9270, 0.3);
    pen.poly(blobPts(range(r, 19, 45), range(r, LEG_TOP - 6, LEG_TOP + 11), range(r, 2.4, 4.6), 0.4, r, 7));
  }
}

// ── Legs ─────────────────────────────────────────────────────────────────────

function legVertical(pen: Pen, pal: CharPalette, x: number, off: number): void {
  const top = LEG_TOP;
  const bot = FEET + off;
  // Bounce light behind the leg before it is filled. Near-black trousers over a
  // dark floor have no edge otherwise, and a dark keyline around a dark shape on
  // a dark floor separates nothing — same reasoning as `seg`'s halo.
  pen.fill(pal.rim, 0.13);
  pen.roundRect(x - 1, top, 10, bot - top - 1.5, 3.6);
  pen.fill(pal.pants);
  pen.roundRect(x, top, 8, bot - top - 2.5, 3);
  pen.fill(mix(pal.pants, pal.rim, 0.14));
  pen.roundRect(x + 0.6, top + 1, 2.4, bot - top - 6, 1.6);
  key(pen, pal, 0.75);
  pen.strokeRoundRect(x, top, 8, bot - top - 2.5, 3);
  pen.fill(pal.shoe);
  pen.roundRect(x - 0.7, bot - 4.5, 9.4, 5, { tl: 1.4, tr: 1.4, bl: 2.6, br: 2.6 });
  // The shoe used to be drawn after the stroke with no outline of its own, so the
  // foot — the part that touches the floor and sells the contact — was the one
  // piece with no edge at all.
  key(pen, pal, 0.7);
  pen.strokeRoundRect(x - 0.7, bot - 4.5, 9.4, 5, { tl: 1.4, tr: 1.4, bl: 2.6, br: 2.6 });
}


/** `away` inverts the step so a forward stride reads correctly from behind. */
function legsVertical(pen: Pen, pal: CharPalette, step: Step, away: boolean): void {
  const s = away ? -step : step;
  const a = s * STRIDE;
  // Draw the trailing leg first so the leading one overlaps it.
  if (a >= 0) {
    legVertical(pen, pal, CX + 1, -a);
    legVertical(pen, pal, CX - 9, a);
  } else {
    legVertical(pen, pal, CX - 9, a);
    legVertical(pen, pal, CX + 1, -a);
  }
}

function legsSide(pen: Pen, pal: CharPalette, step: Step): void {
  const back = CX - 4.5 - step * STRIDE;
  const front = CX - 4.5 + step * STRIDE;
  // Back leg is shaded so the two read as separate limbs when they cross.
  const shade: CharPalette = { ...pal, pants: pal.shoe };
  legVertical(pen, shade, back, step === 0 ? 0 : -1.5);
  legVertical(pen, pal, front, 0);
}
// ── Torso ────────────────────────────────────────────────────────────────────

/**
 * Open lab coat over the crew-coloured undershirt, with the pack straps on the
 * chest.
 *
 * The shirt V is the primary identity read from the front: 16 units wide at the
 * dead centre of the silhouette, right under the face the eye goes to first.
 */
function torsoFront(pen: Pen, pal: CharPalette, ly: number, step: Step): void {
  const y = TORSO_Y + ly;
  const q = squash(step);
  pen.fill(pal.skinShade);
  pen.roundRect(CX - 4, y - 3, 8, 7, 2);

  // Shirt, in the seat colour, shaded down its right side away from the light.
  pen.fill(pal.crew);
  pen.roundRect(CX - 8 * q, y, 16 * q, TORSO_H, { tl: 5, tr: 5, bl: 4, br: 4 });
  pen.fill(pal.crewShade, 0.75);
  pen.roundRect(CX + 2.6 * q, y + 1, 5 * q, TORSO_H - 2, { tl: 3, tr: 4, bl: 3, br: 3 });
  seam(pen, pal, 0.45);
  pen.strokeRoundRect(CX - 8 * q, y, 16 * q, TORSO_H, { tl: 5, tr: 5, bl: 4, br: 4 });

  for (const dir of [-1, 1]) {
    const x = dir < 0 ? 15 : 34;
    const r = dir < 0 ? { tl: 7, tr: 2, bl: 5, br: 4 } : { tl: 2, tr: 7, bl: 4, br: 5 };
    // The lapel facing the light catches it; the other falls into shade. Same
    // white coat, two values — that is what makes it read as cloth with a
    // volume rather than as two flat cards either side of a stripe.
    pen.fill(dir === LIT ? litFace(pal.coat, 0.1) : shadeFace(pal.coat, 0.14));
    pen.roundRect(x, y, 15, TORSO_H, r);
    pen.fill(pal.coatShade, 0.85);
    pen.rect(dir < 0 ? 27.6 : 34, y + 1, 1.7, TORSO_H - 2);
    key(pen, pal, 0.8);
    pen.strokeRoundRect(x, y, 15, TORSO_H, r);
  }

  pen.fill(pal.strap);
  pen.roundRect(19.8, y + 0.5, 3.4, 14, 1.7);
  pen.roundRect(40.8, y + 0.5, 3.4, 14, 1.7);

  // Collar band: a second, smaller hit of the crew colour up at eye level, where
  // a player is already looking to read the name tag.
  pen.fill(pal.crew);
  pen.roundRect(CX - 7.5, y - 0.6, 15, 3.2, 1.6);
  pen.fill(pal.accent);
  pen.roundRect(43.4, y + 7, 2.4, 4, 1);
  // A hem crease keeps the coat from reading as a flat card.
  pen.fill(pal.coatLine, 0.5);
  pen.rect(16, y + TORSO_H - 1.5, 13, 1);
  pen.rect(35, y + TORSO_H - 1.5, 13, 1);
}

/**
 * Closed coat with a centre seam and a shaded back panel, plus the backpack the
 * chest straps belong to. The panel shading is what keeps the back from reading
 * as a flat dark slab at play scale.
 *
 * The back view is the awkward one for identity: a closed coat shows no shirt at
 * all, so if the crew colour only lived on the undershirt a player walking away
 * from you would be anonymous — exactly the moment you most want to know who it
 * was. The backpack panel carries it instead, at 22x17 the largest single shape
 * back here, plus a hem band so the colour still reads if the pack is occluded.
 */
function torsoBack(pen: Pen, pal: CharPalette, ly: number): void {
  const y = TORSO_Y + ly;
  pen.fill(pal.skinShade);
  pen.roundRect(CX - 4, y - 3, 8, 6, 2);

  pen.fill(pal.coat);
  pen.roundRect(15, y, 34, TORSO_H, { tl: 8, tr: 8, bl: 5, br: 5 });
  // Lit shoulder to shaded shoulder, across the closed back.
  pen.fill(shadeFace(pal.coat, 0.16), 0.85);
  pen.roundRect(CX + 1, y + 1, 16, TORSO_H - 2, { tl: 4, tr: 8, bl: 3, br: 5 });
  key(pen, pal, 0.85);
  pen.strokeRoundRect(15, y, 34, TORSO_H, { tl: 8, tr: 8, bl: 5, br: 5 });
  pen.fill(pal.coatShade, 0.7);
  pen.rect(CX - 0.7, y + 2, 1.4, TORSO_H - 3);
  pen.fill(pal.coatShade, 0.35);
  pen.roundRect(17, y + 4, 30, TORSO_H - 7, 4);
  // Bounce rim on the lit shoulder, tying the head and coat volume together.
  pen.fill(pal.rim, 0.3);
  pen.roundRect(16.4, y + 2, 2, TORSO_H - 4, 1);

  pen.fill(pal.strap);
  pen.roundRect(21, y + 1.5, 22, 17, 5);
  pen.fill(0x1b1e23);
  pen.roundRect(21, y + 1.5, 22, 7, { tl: 5, tr: 5, bl: 1, br: 1 });
  // The pack's main panel in the seat colour — the back view's identity read.
  pen.fill(pal.crew);
  pen.roundRect(23, y + 9.4, 18, 7.6, 2.4);
  pen.fill(pal.crewShade, 0.7);
  pen.roundRect(32.6, y + 9.4, 8.4, 7.6, { tl: 1, tr: 2.4, bl: 1, br: 2.4 });
  seam(pen, pal, 0.5);
  pen.strokeRoundRect(23, y + 9.4, 18, 7.6, 2.4);
  pen.fill(pal.coatLine, 0.35);
  pen.rect(22.5, y + 8, 19, 1.2);
  // Coat hem band: a sliver of the same colour below the pack, so identity does
  // not depend on the pack alone.
  pen.fill(pal.crew, 0.9);
  pen.rect(17.5, y + TORSO_H - 2.6, 29, 2);
  pen.fill(pal.accent, 0.9);
  pen.roundRect(30, y + TORSO_H - 6.5, 4, 2.4, 1.2);
}

/**
 * Narrower profile, with the pack behind and a visible coat-front edge.
 *
 * The side view's identity read is the pack (now crew-coloured) plus the shirt
 * strip at the coat opening. The strip alone is only 5.5 units, which is why the
 * pack has to carry it here too.
 */
function torsoSide(pen: Pen, pal: CharPalette, ly: number): void {
  const y = TORSO_Y + ly;
  pen.fill(pal.strap);
  pen.roundRect(16.2, y + 2, 9, 15, 4);
  pen.fill(pal.crew, 0.92);
  pen.roundRect(17.4, y + 4.6, 6.6, 9.4, 2.6);
  pen.fill(pal.skinShade);
  pen.roundRect(CX - 3, y - 3, 8, 6, 2);

  pen.fill(pal.coat);
  pen.roundRect(20, y, 24, TORSO_H, { tl: 8, tr: 7, bl: 5, br: 6 });
  key(pen, pal, 0.85);
  pen.strokeRoundRect(20, y, 24, TORSO_H, { tl: 8, tr: 7, bl: 5, br: 6 });
  pen.fill(pal.coatShade, 0.75);
  pen.roundRect(20, y + 1, 5, TORSO_H - 2, { tl: 6, tr: 0, bl: 4, br: 0 });
  pen.fill(pal.crew);
  pen.roundRect(38.5, y + 2, 5.5, TORSO_H - 2, { tl: 3, tr: 5, bl: 3, br: 4 });
  pen.fill(pal.crew);
  pen.roundRect(CX - 4, y - 0.8, 11, 3, 1.5);
  pen.fill(pal.coatLine, 0.5);
  pen.rect(21, y + TORSO_H - 1.5, 21, 1);
}


// ── Arms ─────────────────────────────────────────────────────────────────────

function armsFront(pen: Pen, pal: CharPalette, ly: number, step: Step): void {
  const y = ARM_Y + ly;
  // Arms counter-swing against the legs; the near arm on a walking figure is the
  // easiest read of "which foot is forward" at this size.
  const sw = step * 2.6;
  for (const dir of [-1, 1]) {
    const x = dir < 0 ? 11.6 : 45.8;
    const off = dir < 0 ? -sw : sw;
    pen.fill(dir === LIT ? litFace(pal.coat, 0.12) : shadeFace(pal.coat, 0.18));
    pen.roundRect(x, y + off, 6.6, 15, 3.2);
    key(pen, pal, 0.8);
    pen.strokeRoundRect(x, y + off, 6.6, 15, 3.2);
    pen.fill(dir === LIT ? pal.skin : pal.skinShade);
    pen.circle(x + 3.3, y + off + 16.5, 3.1);
    key(pen, pal, 0.65);
    pen.strokeCircle(x + 3.3, y + off + 16.5, 3.1);
  }
}

/**
 * The far arm in a profile view.
 *
 * Drawn behind the torso and in shade, and — unlike every other limb — it used to
 * have no keyline at all, which left the one arm that most needs separating from
 * the body with nothing separating it.
 */
function armSideBack(pen: Pen, pal: CharPalette, ly: number, step: Step): void {
  const y = ARM_Y + ly - step * 2.8;
  pen.fill(shadeFace(pal.coatShade, 0.2));
  pen.roundRect(22.5, y, 6.4, 14.5, 3.1);
  key(pen, pal, 0.6);
  pen.strokeRoundRect(22.5, y, 6.4, 14.5, 3.1);
  pen.fill(pal.skinShade);
  pen.circle(25.7, y + 16, 2.9);
  key(pen, pal, 0.62);
  pen.strokeCircle(25.7, y + 16, 2.9);
}

function armSideFront(pen: Pen, pal: CharPalette, ly: number, step: Step): void {
  const y = ARM_Y + ly + step * 3;
  pen.fill(litFace(pal.coat, 0.1));
  pen.roundRect(33.5, y, 6.8, 15, 3.3);
  key(pen, pal, 0.85);
  pen.strokeRoundRect(33.5, y, 6.8, 15, 3.3);
  pen.fill(pal.skin);
  pen.circle(36.9, y + 16.5, 3.1);
  key(pen, pal, 0.65);
  pen.strokeCircle(36.9, y + 16.5, 3.1);
}

// ── Head ─────────────────────────────────────────────────────────────────────

function headFront(pen: Pen, pal: CharPalette, ly: number, form: Form): void {
  const y = HEAD_Y + ly;
  // Hair mass first; the face is then laid over it, leaving hair as the rim.
  pen.fill(pal.hair);
  pen.circle(CX, y, HEAD_R + 0.9);
  pen.fill(pal.skin);
  pen.ellipse(CX, y + 2.6, 13, 13.4);
  pen.fill(pal.skinShade, 0.45);
  pen.ellipse(CX, y + 11, 8.5, 3.4);
  // Fringe.
  pen.fill(pal.hair);
  pen.ellipse(CX - 7.4, y - 6.2, 6.6, 5.2);
  pen.ellipse(CX + 0.6, y - 7.6, 8.4, 5.4);
  pen.ellipse(CX + 8.2, y - 5.4, 6, 5);
  pen.fill(pal.hairLight, 0.5);
  pen.ellipse(CX + 3.5, y - 10.4, 4.6, 1.9);

  eye(pen, pal, CX - 5.6, y + 3.2);
  eye(pen, pal, CX + 5.6, y + 3.2);
  if (form !== 'parasite') {
    pen.fill(pal.skinShade, 0.8);
    pen.roundRect(CX - 1.7, y + 9.2, 3.4, 1.3, 0.65);
  }
  key(pen, pal, 0.9);
  pen.strokeCircle(CX, y, HEAD_R + 0.9);
}

function headBack(pen: Pen, pal: CharPalette, ly: number): void {
  const y = HEAD_Y + ly;
  // Nape skin breaks the hair disc at the bottom, tying the head to the neck.
  pen.fill(pal.skinShade);
  pen.roundRect(CX - 4.5, y + 10, 9, 6, 2);
  pen.fill(pal.hair);
  pen.circle(CX, y, HEAD_R + 0.9);
  // Core shadow on the far (right) edge, wide soft shade across the lower half.
  pen.fill(pal.hairShade, 0.9);
  pen.ellipse(CX, y + 9.4, 12.4, 6.2);
  pen.fill(pal.hairShade, 0.55);
  pen.ellipse(CX + 7, y, 5.6, 10.4);
  // A tall rim light on the lit side — the strongest volume cue for a back view.
  pen.fill(pal.hairLight, 0.5);
  pen.ellipse(CX - 11.6, y, 3.4, 12.6);
  // Bounce light from the scene along the very edge. Without this the black-haired
  // scientists' back views are a featureless disc however the hair is shaded.
  pen.fill(pal.rim, 0.34);
  pen.ellipse(CX - 12.6, y - 1, 2.5, 10.4);
  pen.fill(pal.rim, 0.18);
  pen.ellipse(CX + 1, y - 13, 9.6, 2.6);
  // Crown swirl and a parting swoosh, so the hair has direction.
  pen.fill(pal.hairShade, 0.7);
  pen.poly(tendrilPts({ x: CX + 3, y: y - 8.6, angle: 1.9, len: 16, width: 1.9, curve: 0.55 }));
  pen.fill(pal.hairLight, 0.55);
  pen.poly(tendrilPts({ x: CX - 4.4, y: y - 8, angle: 2.5, len: 13, width: 1.5, curve: 0.4 }));
  key(pen, pal, 0.9);
  pen.strokeCircle(CX, y, HEAD_R + 0.9);
}

function headSide(pen: Pen, pal: CharPalette, ly: number, form: Form): void {
  const y = HEAD_Y + ly;
  pen.fill(pal.hair);
  pen.circle(CX, y, HEAD_R + 0.9);
  pen.fill(pal.skin);
  pen.ellipse(CX + 4.2, y + 2.4, 11.4, 13.2);
  pen.fill(pal.skinShade, 0.4);
  pen.ellipse(CX + 3, y + 11, 7, 3);
  // Nose on the silhouette — the cheapest, strongest profile cue there is.
  pen.fill(pal.skin);
  pen.poly([
    [CX + 14.6, y + 1.6],
    [CX + 18.4, y + 3.9],
    [CX + 14.6, y + 5.6],
  ]);
  // Ear.
  pen.fill(pal.skinShade);
  pen.ellipse(CX + 0.6, y + 4.2, 2.2, 2.9);
  // Hair sweeps back over the crown and down the nape.
  pen.fill(pal.hair);
  pen.ellipse(CX - 1.4, y - 7.4, 11.4, 6.2);
  pen.ellipse(CX - 8.6, y + 1.4, 6.4, 8.4);
  pen.fill(pal.hairLight, 0.45);
  pen.ellipse(CX - 1, y - 10.2, 6, 2.1);

  eye(pen, pal, CX + 9.2, y + 3);
  if (form !== 'parasite') {
    pen.fill(pal.skinShade, 0.8);
    pen.roundRect(CX + 11.6, y + 8.6, 3, 1.2, 0.6);
  }
  key(pen, pal, 0.9);
  pen.strokeCircle(CX, y, HEAD_R + 0.9);
}

// ── Accessories ──────────────────────────────────────────────────────────────

function drawAccessory(
  pen: Pen,
  pal: CharPalette,
  acc: Accessory,
  facing: Facing,
  ly: number,
  step: Step
): void {
  const y = HEAD_Y + ly;
  switch (acc) {
    case 'cap': {
      const dome = 0x1a1a20;
      if (facing === 'down') {
        pen.fill(dome);
        pen.ellipse(CX, y - 6.6, 15.2, 9.4);
        pen.fill(pal.accent, 0.55);
        pen.ellipse(CX, y - 9.6, 9, 3);
        pen.fill(0x111116);
        pen.ellipse(CX, y + 0.6, 14.4, 4.6);
        pen.fill(dome);
        pen.ellipse(CX, y - 1.8, 15, 6);
      } else if (facing === 'up') {
        pen.fill(dome);
        pen.ellipse(CX, y - 3.4, 15.6, 11.6);
        pen.fill(pal.accent, 0.5);
        pen.ellipse(CX, y - 8.4, 8.4, 2.8);
        pen.fill(0x0e0e12);
        pen.roundRect(CX - 4.4, y + 2.6, 8.8, 3.4, 1.7);
      } else {
        pen.fill(dome);
        pen.ellipse(CX - 0.6, y - 5.4, 15.4, 10);
        pen.fill(0x111116);
        pen.ellipse(CX + 10.4, y - 2.2, 7.6, 2.7);
        pen.fill(pal.accent, 0.5);
        pen.ellipse(CX - 3, y - 9.6, 6.4, 2.6);
      }
      break;
    }
    case 'ponytail': {
      // Reads as a silhouette behind the head from the front, a full tail from
      // behind, and a sweep off the back of the skull in profile.
      if (facing === 'down') {
        pen.fill(pal.hairShade);
        pen.ellipse(CX - 14.4, y + 3.4, 3.6, 7.4);
        pen.ellipse(CX + 14.4, y + 3.4, 3.6, 7.4);
        pen.fill(pal.hair);
        pen.ellipse(CX - 12.6, y + 1.6, 4.4, 8.6);
        pen.ellipse(CX + 12.6, y + 1.6, 4.4, 8.6);
      } else if (facing === 'up') {
        pen.fill(pal.hair);
        pen.poly(
          tendrilPts({ x: CX, y: y + 6, angle: Math.PI / 2, len: 24, width: 5.4, curve: 0.16, profile: 'leaf' })
        );
        pen.fill(pal.hairShade, 0.8);
        pen.roundRect(CX - 3.4, y + 9.4, 6.8, 2.8, 1.4);
        pen.fill(pal.hairLight, 0.32);
        pen.poly(tendrilPts({ x: CX - 1, y: y + 12, angle: 1.62, len: 12, width: 1.4 }));
      } else {
        pen.fill(pal.hair);
        pen.poly(
          tendrilPts({
            x: CX - 8,
            y: y - 1,
            angle: Math.PI * 0.82,
            len: 20,
            width: 4.6,
            curve: -0.45 + step * 0.12,
            profile: 'leaf',
          })
        );
        pen.fill(pal.hairShade, 0.75);
        pen.ellipse(CX - 8.4, y - 1.6, 3, 2.6);
      }
      break;
    }
    case 'headlamp': {
      const band = 0x9aa4ab;
      const strap = 0x3b4046;
      if (facing === 'down') {
        pen.fill(strap);
        pen.roundRect(CX - 14.6, y - 6.4, 29.2, 5.2, 2.6);
        pen.fill(band);
        pen.roundRect(CX - 5.6, y - 8.4, 11.2, 8.4, 3);
        pen.fill(0xe8f4ff, 0.95);
        pen.circle(CX, y - 4.2, 3.1);
        pen.fill(0xffffff, 0.55);
        pen.circle(CX - 0.9, y - 5.1, 1.2);
        pen.fill(0xdcf6ff, 0.14);
        pen.circle(CX, y - 4.2, 8.4);
      } else if (facing === 'up') {
        pen.fill(strap);
        pen.roundRect(CX - 14.6, y - 5.4, 29.2, 5.4, 2.7);
        pen.fill(0x2f343a);
        pen.roundRect(CX - 5, y - 7, 10, 7.6, 2.6);
        pen.fill(pal.accent, 0.5);
        pen.roundRect(CX - 2.2, y - 5.2, 4.4, 2, 1);
      } else {
        pen.fill(strap);
        pen.roundRect(CX - 14, y - 7, 27, 5.2, 2.6);
        pen.fill(band);
        pen.roundRect(CX + 6.4, y - 8.8, 9.6, 8.6, 3);
        pen.fill(0xe8f4ff, 0.95);
        pen.ellipse(CX + 15.4, y - 4.6, 1.9, 3.1);
        pen.fill(0xdcf6ff, 0.13);
        pen.poly([
          [CX + 16, y - 7.6],
          [CX + 30, y - 10.4],
          [CX + 30, y + 1.6],
          [CX + 16, y - 1.6],
        ]);
      }
      break;
    }
    case 'scanner': {
      // Held device. Sits in the same hand in every facing, which is why the
      // side view is drawn rather than derived from the front.
      const shell = 0x2b3138;
      const y0 = 48 + ly + (facing === 'side' ? step * 2.4 : step * 2.2);
      if (facing === 'down') {
        pen.fill(shell);
        pen.roundRect(43.4, y0, 11.4, 12.6, 2.4);
        pen.fill(0x0e1a14);
        pen.roundRect(45, y0 + 1.6, 8.2, 6.4, 1.2);
        pen.fill(pal.accent, 0.92);
        pen.roundRect(45.8, y0 + 2.4, 6.6, 4.8, 0.9);
        pen.fill(pal.accent, 0.13);
        pen.circle(49.1, y0 + 4.8, 8.6);
        pen.fill(0x596270);
        pen.roundRect(46.4, y0 + 9.4, 5.4, 1.8, 0.9);
      } else if (facing === 'up') {
        pen.fill(shell);
        pen.roundRect(43.4, y0, 11.4, 12.6, 2.4);
        pen.fill(0x1e242a);
        pen.roundRect(45, y0 + 2, 8.2, 7.4, 1.2);
        pen.fill(pal.accent, 0.28);
        pen.circle(49.1, y0 + 5.6, 1.6);
      } else {
        pen.fill(shell);
        pen.roundRect(39.6, y0 - 1, 12.6, 10.4, 2.3);
        pen.fill(0x0e1a14);
        pen.roundRect(41.4, y0 + 0.6, 9, 5.4, 1.1);
        pen.fill(pal.accent, 0.92);
        pen.roundRect(42.2, y0 + 1.3, 7.4, 4, 0.8);
        pen.fill(pal.accent, 0.12);
        pen.circle(45.9, y0 + 3.3, 8);
      }
      break;
    }
  }
}
// ── The Parasite ─────────────────────────────────────────────────────────────

/**
 * The full reveal. Same skeleton and the same walk cycle as the humans — it has
 * to move like the thing that was wearing a lab coat a moment ago — but the
 * silhouette is broken up by tendrils so it is unmistakable at a glance.
 *
 * Tendrils are seeded by facing only, never by walk phase, so they stay put
 * while the limbs move. A per-step sway is added to the tips instead, which
 * gives the mass some life without making it boil.
 */
function parasiteBody(pen: Pen, pal: CharPalette, facing: Facing, step: Step): void {
  const ly = lift(step);
  const y = TORSO_Y + ly;
  const r = rng(facing === 'down' ? 7717 : facing === 'up' ? 3391 : 5507);
  const sway = step * 0.12;

  // Root-legs.
  const s = facing === 'up' ? -step : step;
  for (const [x, off] of [
    [CX - 9, s * STRIDE],
    [CX + 1, -s * STRIDE],
  ] as const) {
    pen.fill(pal.pants);
    pen.roundRect(x, LEG_TOP, 8, FEET + off - LEG_TOP - 2, 3.5);
    key(pen, pal, 0.7);
    pen.strokeRoundRect(x, LEG_TOP, 8, FEET + off - LEG_TOP - 2, 3.5);
    pen.fill(VINES[1], 0.75);
    pen.poly(tendrilPts({ x: x + 4, y: LEG_TOP + 2, angle: Math.PI / 2 + 0.2, len: 13, width: 2.2, curve: -0.3 }));
  }

  // Trunk.
  pen.fill(pal.coatShade);
  pen.roundRect(15.5, y, 33, TORSO_H + 1, { tl: 9, tr: 9, bl: 6, br: 6 });
  // The reveal form had no keyline anywhere on it. Its own colours are all dark
  // greens, so against the jungle it was the *least* separated thing in the game
  // — the opposite of what the one silhouette that has to read instantly needs.
  key(pen, pal, 0.85);
  pen.strokeRoundRect(15.5, y, 33, TORSO_H + 1, { tl: 9, tr: 9, bl: 6, br: 6 });
  pen.fill(pal.coat, 0.9);
  pen.roundRect(18, y + 1.5, 28, TORSO_H - 2, { tl: 8, tr: 8, bl: 5, br: 5 });

  // Vine ropes over the trunk.
  for (let i = 0; i < 9; i++) {
    pen.fill(VINES[1 + Math.floor(r() * 3)]!, 0.9);
    pen.poly(
      tendrilPts({
        x: range(r, 17, 47),
        y: range(r, y + 1, y + 20),
        angle: range(r, -0.5, 0.5) + (r() > 0.5 ? Math.PI / 2 : -Math.PI / 2),
        len: range(r, 9, 19),
        width: range(r, 1.6, 3.2),
        curve: range(r, -0.7, 0.7) + sway,
      })
    );
  }
  // Shredded coat remnants — a hint of what it used to be wearing.
  pen.fill(0xd8dcd2, 0.5);
  pen.poly([
    [16.5, y + 6],
    [22.5, y + 4],
    [21, y + 21],
    [16, y + 18],
  ]);
  pen.fill(0xd8dcd2, 0.35);
  pen.poly([
    [47.5, y + 7],
    [42, y + 5],
    [43.5, y + 20],
    [48, y + 17],
  ]);

  // Head mass with a crown of tendrils.
  const hy = HEAD_Y + ly;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    pen.fill(VINES[Math.floor(r() * 3)]!, 0.95);
    pen.poly(
      tendrilPts({
        x: CX + Math.cos(a) * 9,
        y: hy + Math.sin(a) * 9,
        angle: a,
        len: range(r, 7, 13.5),
        width: range(r, 1.7, 3.1),
        curve: range(r, -0.8, 0.8) + sway,
      })
    );
  }
  pen.fill(pal.hairShade);
  pen.circle(CX, hy, HEAD_R - 0.4);
  key(pen, pal, 0.8);
  pen.strokeCircle(CX, hy, HEAD_R - 0.4);
  pen.fill(pal.skinShade, 0.9);
  pen.ellipse(CX, hy + 1.6, 12.4, 12.8);
  for (let i = 0; i < 10; i++) {
    pen.fill(VINES[1 + Math.floor(r() * 3)]!, 0.8);
    pen.poly(
      tendrilPts({
        x: CX + range(r, -10, 10),
        y: hy + range(r, -9, 9),
        angle: range(r, 0, Math.PI * 2),
        len: range(r, 4, 9),
        width: range(r, 1.2, 2.2),
        curve: range(r, -0.6, 0.6),
      })
    );
  }

  if (facing === 'down') {
    eye(pen, pal, CX - 5.6, hy + 2.6, 1.15);
    eye(pen, pal, CX + 5.6, hy + 2.6, 1.15);
  } else if (facing === 'side') {
    eye(pen, pal, CX + 7.4, hy + 2.2, 1.15);
  }
  // No spore motes. Seven accent-coloured dots floating around the head read as
  // texture at a 40px sprite, but the title screen draws this same figure at
  // 10x, where they become large bright circles scattered over the scene with
  // nothing tying them to the creature. The tendril crown already carries the
  // "shedding" read without them.
}

// ── Entry points ─────────────────────────────────────────────────────────────

/**
 * The contact shadow under a standing figure.
 *
 * Baked into the sprite rather than added as a scene object, for two reasons: it
 * then appears in the SVG preview (where the character is otherwise floating), and
 * it can breathe with the walk cycle — the passing pose lifts the body, so its
 * shadow tightens and darkens the way a real one does as the gap closes.
 *
 * The scene used to place one flat `ellipse(..., 0x000000, 0.38)` behind each
 * sprite. A single hard ellipse at a third opacity is exactly what a sticker looks
 * like; four stacked rings on a falloff cost four fills at bake time and put the
 * character *on* the floor.
 */
function contactShadow(pen: Pen, step: Step): void {
  const tight = step === 0 ? 0.86 : 1;
  softShadow(pen, CX, FEET - 1, 13.5 * tight, 5 * tight, {
    // Not black: the floor's own shadow tone, so a character standing on the
    // bright meeting deck does not carry a hole around with them.
    color: 0x03150f,
    alpha: step === 0 ? 0.5 : 0.44,
    layers: 4,
    spread: 1.7,
  });
}

export function drawCharacter(
  pen: Pen,
  opts: { pal: CharPalette; accessory: Accessory; facing: Facing; step: Step; form: Form }
): void {
  const { pal, accessory, facing, step, form } = opts;
  contactShadow(pen, step);
  if (form === 'parasite') {
    parasiteBody(pen, pal, facing, step);
    return;
  }
  const ly = lift(step);

  if (facing === 'side') {
    legsSide(pen, pal, step);
    armSideBack(pen, pal, ly, step);
    torsoSide(pen, pal, ly);
    armSideFront(pen, pal, ly, step);
    headSide(pen, pal, ly, form);
  } else if (facing === 'up') {
    legsVertical(pen, pal, step, true);
    torsoBack(pen, pal, ly);
    armsFront(pen, pal, ly, step);
    headBack(pen, pal, ly);
  } else {
    legsVertical(pen, pal, step, false);
    torsoFront(pen, pal, ly, step);
    armsFront(pen, pal, ly, step);
    headFront(pen, pal, ly, form);
  }

  drawAccessory(pen, pal, accessory, facing, ly, step);
  if (form === 'infected') crackle(pen, facing, ly);
}

/**
 * A collapsed scientist, seen from above: knees folded, arms thrown out, head
 * turned aside. Drawn along the horizontal axis and rotated into place by the
 * scene.
 *
 * Everything is built from angled capsules and a tapered coat rather than from
 * axis-aligned rectangles. A body on the floor is all diagonals, and a stack of
 * upright rounded rects in the same place reads as a piece of equipment.
 *
 * Corpses are always drawn human, whatever killed them — a corpse that looked
 * infected would publish the victim's role to the whole lobby, and role
 * confidentiality is the point of this game. See DECISIONS.md.
 */
export function drawCorpse(pen: Pen, pal: CharPalette, accessory: Accessory): void {
  const hx = 15;
  const hy = 34;
  const HR = 11;

  // Pooled ground shadow. The body has to sit *in* the scene, and a pale coat
  // splayed under a pale coat just smears the silhouette; a shadow anchors it.
  // Two soft pools rather than two hard ellipses — a body lying down casts a much
  // larger, softer shadow than a standing one, and the hard version read as a
  // second dark shape lying next to the corpse instead of underneath it.
  softShadow(pen, 34, 42, 22, 10.5, { color: 0x02100c, alpha: 0.46, layers: 4, spread: 1.5 });
  softShadow(pen, 16, 40, 11, 7.5, { color: 0x02100c, alpha: 0.3, layers: 3, spread: 1.5 });

  // Far arm, dropped away from the body on the far side.
  const fe = seg(pen, pal, pal.coatShade, 28, 43, 1.35, 8, 4.6, 3.9);
  const fw = seg(pen, pal, pal.coatShade, fe[0], fe[1], 0.75, 6.5, 3.9, 3.2);
  pen.fill(pal.skinShade);
  pen.circle(fw[0], fw[1], 2.9);
  key(pen, pal, 0.7);
  pen.strokeCircle(fw[0], fw[1], 2.9);

  // Legs, folded at the knee and trailing the same way. Both are drawn before
  // the coat so the hem overlaps their tops and they read as attached. Kept
  // near-parallel: splay them and two legs plus two feet become a nest of
  // sausages rather than a pair of limbs.
  const legTo = (x: number, y: number, a1: number, a2: number, near: boolean) => {
    // `strap` is the one tone in the palette between trousers and shoe leather;
    // the near leg needs it, because pants-on-shoe is no contrast at all.
    const c = near ? pal.strap : pal.pants;
    const knee = seg(pen, pal, c, x, y, a1, 10, 5.2, 4.3, true);
    const ankle = seg(pen, pal, c, knee[0], knee[1], a2, 8, 4.3, 3.4, true);
    seg(pen, pal, pal.shoe, ankle[0], ankle[1], a2 + 0.48, 4.2, 3.5, 3.1, true);
  };
  legTo(40, 33.5, 0.18, 0.62, false);
  legTo(40, 40, 0.42, 0.86, true);

  // Torso. Tapered shoulders-to-hips, because the coat is the biggest and
  // brightest mass and is therefore what has to carry the read.
  const coat = eggPts(34, 36.5, 13, 10, 12, 8.5);
  pen.fill(pal.coat);
  pen.poly(coat);
  pen.fill(pal.coatShade, 0.6);
  pen.ellipse(35, 42.5, 10, 4.8);
  pen.fill(pal.coatShade, 0.7);
  pen.ellipse(41, 38, 4.5, 7);
  pen.fill(pal.coatLine, 0.4);
  pen.poly(capsulePts(25, 32.6, 0.17, 18, 0.7, 0.7, 4));
  pen.fill(pal.coatLine, 0.3);
  pen.poly(capsulePts(35, 44, 0.15, 6, 0.8, 0.8, 4));
  pen.fill(pal.rim, 0.2);
  pen.ellipse(32, 27.4, 9, 2.4);
  key(pen, pal, 0.85);
  pen.strokePoly(coat, true);

  // Collar. The shirt shows here and nowhere else — a large dark panel anywhere
  // on this body turns it back into a box. In the seat colour, drained: a body is
  // the basis of an accusation, so it has to be identifiable as *whose* body, and
  // the drained tone is the difference between "Amber is dead" and a grey shape.
  pen.fill(pal.crew);
  pen.ellipse(23.5, 35.5, 4.6, 6.6);
  pen.fill(pal.crewShade, 0.6);
  pen.ellipse(25, 37.4, 3, 4);
  key(pen, pal, 0.6);
  pen.strokeCircle(23.5, 35.5, 5.4);
  // A second, smaller hit at the hem, for when the collar is under the head.
  pen.fill(pal.crew, 0.85);
  pen.poly(capsulePts(41, 43.6, 0.2, 5, 2.2, 1.8, 5));

  // Near arm, bent at the elbow and dropped on the near side. Shade tone so it
  // separates from the coat it overlaps instead of merging into one white shape,
  // and bent rather than straight — a straight capsule with a ball on the end
  // lying across a body reads as a bone, not an arm.
  const ne = seg(pen, pal, pal.coatShade, 27, 29.5, -1.05, 8, 5, 4.2);
  const nw = seg(pen, pal, pal.coatShade, ne[0], ne[1], -0.45, 7, 4.2, 3.4);
  pen.fill(pal.skin);
  pen.circle(nw[0], nw[1], 3);
  key(pen, pal, 0.72);
  pen.strokeCircle(nw[0], nw[1], 3);

  // Head, turned away — a corpse should never stare back at the lobby.
  pen.fill(pal.rim, 0.14);
  pen.circle(hx, hy, HR + 1.4);
  pen.fill(pal.hair);
  pen.circle(hx, hy, HR);
  pen.fill(pal.skin);
  pen.ellipse(hx - 2.8, hy + 4.4, 6.6, 6.4);
  pen.fill(pal.skinShade, 0.45);
  pen.ellipse(hx - 2, hy + 8.4, 4.6, 2.2);
  pen.fill(pal.hair);
  pen.ellipse(hx + 2, hy - 3.4, 9.2, 8.2);
  pen.fill(pal.hairLight, 0.45);
  pen.ellipse(hx - 2.4, hy - 7.4, 4.8, 2.2);
  pen.fill(pal.rim, 0.28);
  pen.ellipse(hx - 9.4, hy - 3, 2.3, 4.6);
  key(pen, pal, 0.85);
  pen.strokeCircle(hx, hy, HR);

  // The accessory survives, knocked askew — it is how you know who this was.
  if (accessory === 'cap') {
    pen.fill(0x1a1a20);
    pen.ellipse(hx - 4.5, hy - 8.5, 7.6, 5.2);
    pen.fill(0x111116);
    pen.ellipse(hx - 10.4, hy - 7, 4.2, 2.9);
  } else if (accessory === 'ponytail') {
    pen.fill(pal.hair);
    pen.poly(tendrilPts({ x: hx + 6, y: hy + 5, angle: 2.45, len: 18, width: 4.4, profile: 'leaf' }));
  } else if (accessory === 'headlamp') {
    pen.fill(0x3b4046);
    pen.poly(capsulePts(hx - 7, hy - 9, 0.35, 14, 2.2, 2.2));
    pen.fill(0x9aa4ab);
    pen.circle(hx - 8.5, hy - 5, 3.6);
    key(pen, pal, 0.65);
    pen.strokeCircle(hx - 8.5, hy - 5, 3.6);
  } else {
    // Dropped where the hand let go of it.
    pen.fill(0x2b3138);
    pen.roundRect(37, 13.5, 11, 9.4, 2.2);
    pen.fill(0x0e1a14);
    pen.roundRect(38.4, 15, 8, 5.4, 1.1);
    pen.fill(0x53ff9b, 0.3);
    pen.roundRect(39, 15.6, 6.6, 4, 0.8);
  }
}

