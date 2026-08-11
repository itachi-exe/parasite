/**
 * The Phaser side of the art system: a `Graphics`-backed {@link Pen}, plus the
 * bakers that turn the primitive drawings in chibi.ts into textures and
 * animations.
 *
 * Frames are baked into textures once and driven by Phaser's animation system,
 * so the per-frame cost at runtime is a texture swap rather than replaying a few
 * hundred draw commands per character per frame.
 *
 * Baking is lazy and idempotent, keyed off `textures.exists`. The four human
 * skins are cheap enough to build up front; the infected and Parasite forms are
 * only ever shown to one player about their own body, and corpses only once
 * somebody dies, so those are built on first use instead of paid for at load.
 *
 * The import is type-only on purpose — this module must not pull Phaser's runtime
 * into the bundle graph twice (see DECISIONS.md on Phaser's ESM build). Every
 * Phaser value it touches arrives through the `scene` argument, and `fillPoints`
 * is fed plain `{x, y}` objects rather than `Phaser.Geom.Point` instances.
 */

import type * as Phaser from 'phaser';
import type { Pen, Corners } from './pen';
import { SKINS, infectedPalette, corpsePalette, PARASITE_PAL } from './palette';
import {
  drawCharacter,
  drawCorpse,
  CELL_W,
  CELL_H,
  type Facing,
  type Step,
} from './chibi';

/**
 * Supersampling factor. Frames are drawn at 2x and displayed at 1x so the
 * curved silhouettes stay smooth — canvas antialiasing plus a linear
 * minification filter is what keeps these from looking like flat vector shapes.
 */
export const SS = 2;

/** Draws art-module geometry into a Phaser Graphics object. */
export class PhaserPen implements Pen {
  constructor(
    private g: Phaser.GameObjects.Graphics,
    private s = 1
  ) {}

  fill(color: number, alpha = 1): void {
    this.g.fillStyle(color, alpha);
  }
  line(width: number, color: number, alpha = 1): void {
    this.g.lineStyle(width * this.s, color, alpha);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x * this.s, y * this.s, w * this.s, h * this.s);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | Corners): void {
    this.g.fillRoundedRect(x * this.s, y * this.s, w * this.s, h * this.s, this.radius(r));
  }
  circle(x: number, y: number, r: number): void {
    this.g.fillCircle(x * this.s, y * this.s, r * this.s);
  }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    this.g.fillEllipse(x * this.s, y * this.s, rx * 2 * this.s, ry * 2 * this.s);
  }
  poly(pts: readonly (readonly [number, number])[]): void {
    this.g.fillPoints(this.pts(pts), true);
  }

  strokePoly(pts: readonly (readonly [number, number])[], close = false): void {
    this.g.strokePoints(this.pts(pts), close);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.g.strokeRect(x * this.s, y * this.s, w * this.s, h * this.s);
  }
  strokeCircle(x: number, y: number, r: number): void {
    this.g.strokeCircle(x * this.s, y * this.s, r * this.s);
  }
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number | Corners): void {
    this.g.strokeRoundedRect(x * this.s, y * this.s, w * this.s, h * this.s, this.radius(r));
  }

  /** Phaser accepts either a scalar or `{tl,tr,bl,br}`; scale whichever came in. */
  private radius(r: number | Corners): number | Corners {
    if (typeof r === 'number') return r * this.s;
    return {
      tl: (r.tl ?? 0) * this.s,
      tr: (r.tr ?? 0) * this.s,
      bl: (r.bl ?? 0) * this.s,
      br: (r.br ?? 0) * this.s,
    };
  }

  private pts(pts: readonly (readonly [number, number])[]): { x: number; y: number }[] {
    return pts.map(([x, y]) => ({ x: x * this.s, y: y * this.s }));
  }
}

// ── Texture keys ─────────────────────────────────────────────────────────────

export type Variant = `s${number}` | `i${number}` | 'para';

export function frameKey(variant: Variant, facing: Facing, step: Step): string {
  return `ch:${variant}:${facing}:${step}`;
}
export function walkAnim(variant: Variant, facing: Facing): string {
  return `walk:${variant}:${facing}`;
}
export function corpseKey(skin: number): string {
  return `corpse:${skin}`;
}

const FACINGS: readonly Facing[] = ['down', 'up', 'side'];
/** -1 and +1 are the contact poses; 0 is the passing pose, used twice a cycle. */
const STEPS: readonly Step[] = [-1, 0, 1];
const CYCLE: readonly Step[] = [-1, 0, 1, 0];

// ── Baking ───────────────────────────────────────────────────────────────────

/**
 * Bake one variant's 9 frames and register its walk animations.
 *
 * A single Graphics is reused across frames — cleared between each — because
 * `generateTexture` snapshots the current command list into a fresh canvas
 * texture, so one object can mint all nine.
 */
function bakeVariant(scene: Phaser.Scene, variant: Variant, skin: number): void {
  if (scene.textures.exists(frameKey(variant, 'down', 0))) return;

  const infected = variant.startsWith('i');
  const parasite = variant === 'para';
  const base = SKINS[Math.min(SKINS.length - 1, Math.max(0, skin))]!;
  const pal = parasite ? PARASITE_PAL : infected ? infectedPalette(base.pal) : base.pal;
  const form = parasite ? 'parasite' : infected ? 'infected' : 'human';

  const g = scene.make.graphics({}, false);
  const pen = new PhaserPen(g, SS);
  for (const facing of FACINGS) {
    for (const step of STEPS) {
      g.clear();
      drawCharacter(pen, { pal, accessory: base.accessory, facing, step, form });
      g.generateTexture(frameKey(variant, facing, step), CELL_W * SS, CELL_H * SS);
    }
  }
  g.destroy();

  for (const facing of FACINGS) {
    const key = walkAnim(variant, facing);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: CYCLE.map((step) => ({ key: frameKey(variant, facing, step) })),
      frameRate: 9,
      repeat: -1,
    });
  }
}

/** Human form for a skin id. Returns the variant key to render with. */
export function ensureSkin(scene: Phaser.Scene, skin: number): Variant {
  const v = `s${skin}` as Variant;
  bakeVariant(scene, v, skin);
  return v;
}

/** The "just infected" form — same person, grey and cracked. */
export function ensureInfected(scene: Phaser.Scene, skin: number): Variant {
  const v = `i${skin}` as Variant;
  bakeVariant(scene, v, skin);
  return v;
}

/** The full Parasite reveal. Skin-independent: almost nothing of the host left. */
export function ensureParasite(scene: Phaser.Scene): Variant {
  bakeVariant(scene, 'para', 0);
  return 'para';
}

/** A collapsed scientist. Always human — see the note in chibi.ts. */
export function ensureCorpse(scene: Phaser.Scene, skin: number): string {
  const key = corpseKey(skin);
  if (scene.textures.exists(key)) return key;
  const base = SKINS[Math.min(SKINS.length - 1, Math.max(0, skin))]!;
  const g = scene.make.graphics({}, false);
  drawCorpse(new PhaserPen(g, SS), corpsePalette(base.pal), base.accessory);
  g.generateTexture(key, CELL_W * SS, CELL_H * SS);
  g.destroy();
  return key;
}

/** Warm the four playable skins so nobody's first step costs a bake. */
export function bakePlayableSkins(scene: Phaser.Scene): void {
  for (let i = 0; i < SKINS.length; i++) ensureSkin(scene, i);
}
