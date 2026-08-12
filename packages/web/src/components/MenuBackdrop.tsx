'use client';

import { useEffect, useRef } from 'react';
import { CanvasPen } from '@/game/art/canvasPen';
import { drawCharacter, FEET, CELL_W } from '@/game/art/chibi';
import { SKINS, seatPalette, PARASITE_PAL, ENV, VINES } from '@/game/art/palette';
import {
  rng,
  range,
  pick,
  bloom,
  pool,
  gradRect,
  blobPts,
  tendrilPts,
  mix,
  darken,
  lighten,
} from '@/game/art/pen';

/**
 * The title-screen scene.
 *
 * Deliberately a plain 2D canvas rather than a Phaser instance: this is a
 * static painting, and standing up a WebGL context and the whole game loop to
 * show one would cost about a megabyte for no motion. It draws the *real*
 * scientists and the *real* Parasite through {@link CanvasPen}, so the menu
 * cannot drift away from what the game actually looks like — which is the
 * failure mode a hand-drawn "hero illustration" would have had.
 *
 * Composition follows the reference the owner supplied: a deep interior with a
 * lit back wall, a knot of small characters low-left, and one very large figure
 * on the right that the title overlaps. Everything sits in the outer thirds so
 * the centre column stays clear for the logo and the buttons.
 */

const W = 1600;
const H = 900;

/** Where the light lives, so glows and shadows agree on a direction. */
const LAMPS: readonly [number, number, number][] = [
  [250, 250, 210],
  [800, 190, 260],
  [1330, 265, 200],
];

export default function MenuBackdrop() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  /**
   * Place a character by where its FEET land and where it is centred.
   *
   * `drawCharacter` draws into a 64x76 cell whose origin is the cell's
   * top-left, with the feet at y=FEET — so translating straight to a floor
   * position hangs the whole body *below* that point. At menu scales (3x–10x)
   * that put every character several hundred pixels off the bottom of the
   * canvas, and the first two passes rendered nothing but floating heads.
   */
  const place = (
    pen: CanvasPen,
    cx: number,
    feetY: number,
    scale: number,
    flipX: boolean,
    draw: () => void
  ) => {
    const half = (CELL_W / 2) * scale;
    pen.withTransform(flipX ? cx + half : cx - half, feetY - FEET * scale, scale, draw, {
      flipX,
    });
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina-aware without exceeding 2x: this is a full-bleed backdrop, and a
    // 3x buffer on a big desktop display is tens of megabytes for detail that
    // is behind a dark scrim anyway.
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pen = new CanvasPen(ctx);
    const r = rng(20260812);

    // ── Deep background ─────────────────────────────────────────────────────
    // Vertical ramp: the ceiling is far from the lamps, the floor is not.
    gradRect(pen, 0, 0, W, H, darken(ENV.wallDark, 0.45), ENV.soilDark, { bands: 22 });

    // Canopy pressing in through the far wall's glazing — three depth bands,
    // darkest first, so the jungle outside reads as receding rather than as a
    // flat green backdrop.
    ENV.canopy.forEach((band, i) => {
      pen.fill(band, 0.5 - i * 0.08);
      for (let n = 0; n < 9; n++) {
        const cx = range(r, -60, W + 60);
        const cy = range(r, 40, 300 + i * 60);
        pen.poly(blobPts(cx, cy, range(r, 70, 150), 0.34, r, 9));
      }
    });

    // ── Back wall and shelving ──────────────────────────────────────────────
    // Specimen racks stand in for the reference's bookcases: same job, which is
    // to give the far plane vertical rhythm so it does not read as a void.
    pen.fill(ENV.wallDark, 0.92);
    pen.rect(0, 300, W, 150);
    pen.fill(ENV.wall, 0.5);
    pen.rect(0, 300, W, 12);

    for (let x = 40; x < W; x += 132) {
      const h = range(r, 96, 138);
      const y = 318 + (138 - h);
      pen.fill(darken(ENV.wall, 0.5), 0.95);
      pen.roundRect(x, y, 96, h, 4);
      pen.fill(darken(ENV.wallDark, 0.25), 1);
      pen.rect(x + 6, y + 6, 84, h - 12);
      // Shelves, with the odd lit specimen jar.
      for (let sy = y + 16; sy < y + h - 10; sy += 26) {
        pen.fill(ENV.wall, 0.55);
        pen.rect(x + 6, sy, 84, 3);
        if (r() < 0.42) {
          // Unlit glassware. These used to carry a glow halo each, which put a
          // field of green dots across the whole back wall.
          const jx = x + range(r, 14, 70);
          pen.fill(darken(ENV.wall, 0.25), 0.9);
          pen.roundRect(jx - 3.5, sy - 12, 7, 11, 1.5);
          pen.fill(lighten(ENV.wall, 0.1), 0.5);
          pen.rect(jx - 2.5, sy - 11, 1.6, 8);
        }
      }
    }

    // ── Floor ───────────────────────────────────────────────────────────────
    gradRect(pen, 0, 450, W, H - 450, ENV.pathFloor, darken(ENV.soil, 0.25), { bands: 16 });
    for (let y = 470; y < H; y += 34) {
      pen.fill(y % 68 === 0 ? ENV.pathPlank : ENV.pathPlankAlt, 0.22);
      pen.rect(0, y, W, 17);
    }
    pen.fill(ENV.pathGrime, 0.35);
    pen.rect(0, 450, W, 10);

    // ── Lamp light ──────────────────────────────────────────────────────────
    // Pools land on the floor first, then the bloom sits over everything, so a
    // lamp reads as lighting the room rather than as a decal floating on it.
    for (const [lx, ly, rad] of LAMPS) {
      pool(pen, lx, 470, rad * 1.5, rad * 0.5, { color: ENV.lamp, alpha: 0.1, bands: 12 });
      bloom(pen, lx, ly, rad, { color: ENV.lamp, alpha: 0.13, layers: 7 });
      // The fixture: a hanging cage lamp. Shade, then the glowing element
      // inside it, then two bars of the cage over the top — three cheap layers
      // that read as an object rather than as a flat triangle.
      pen.line(2.5, darken(ENV.wallDark, 0.35), 0.95);
      pen.strokePoly([
        [lx, 96],
        [lx, 168],
      ]);
      pen.fill(darken(ENV.wall, 0.55), 1);
      pen.poly([
        [lx - 27, 205],
        [lx + 27, 205],
        [lx + 12, 166],
        [lx - 12, 166],
      ]);
      pen.fill(mix(ENV.lamp, 0xffffff, 0.4), 0.95);
      pen.ellipse(lx, 204, 21, 7);
      pen.fill(ENV.lamp, 0.85);
      pen.circle(lx, 200, 9);
      pen.line(1.6, darken(ENV.wallDark, 0.2), 0.8);
      pen.strokePoly([
        [lx - 20, 202],
        [lx, 214],
        [lx + 20, 202],
      ]);
    }

    // ── Hanging vines, along the top edge ───────────────────────────────────
    for (let i = 0; i < 16; i++) {
      const vx = range(r, -20, W + 20);
      pen.fill(pick(r, VINES), range(r, 0.45, 0.85));
      pen.poly(
        tendrilPts({
          x: vx,
          y: -10,
          len: range(r, 110, 300),
          width: range(r, 7, 16),
          angle: Math.PI / 2 + range(r, -0.22, 0.22),
          curve: range(r, -0.5, 0.5),
          steps: 12,
        })
      );
    }

    // ── The crew, low-left ──────────────────────────────────────────────────
    // Facing 'side' and mirrored toward the centre, so the group reads as
    // turned in on itself the way the reference's cluster does.
    //
    // Positions account for `object-fit: cover`: at a 4:3 viewport this 16:9
    // canvas loses roughly its outer 13% on each side, so nothing that matters
    // sits outside x≈230..1370, and feet stay clear of the bottom edge.
    const crowd: { x: number; y: number; s: number; skin: number; seat: number; flip: boolean }[] = [
      { x: 300, y: 742, s: 3.0, skin: 0, seat: 0, flip: false },
      { x: 412, y: 776, s: 3.4, skin: 1, seat: 4, flip: true },
      { x: 214, y: 828, s: 3.8, skin: 2, seat: 3, flip: false },
      { x: 500, y: 846, s: 4.1, skin: 3, seat: 9, flip: true },
    ];
    for (const c of crowd) {
      const base = SKINS[c.skin % SKINS.length]!;
      const pal = seatPalette(base.pal, c.seat);
      // A warm pool under each: they are standing in the room's light, and
      // without it a character drawn on a dark floor floats.
      pool(pen, c.x, c.y - 2, 34 * c.s * 0.42, 12 * c.s * 0.42, {
        color: ENV.lamp,
        alpha: 0.12,
        bands: 6,
      });
      place(pen, c.x, c.y, c.s, c.flip, () =>
        drawCharacter(pen, {
          pal,
          accessory: base.accessory,
          facing: 'side',
          step: 0,
          form: 'human',
        })
      );
    }

    // ── The Parasite, right ─────────────────────────────────────────────────
    // The reference puts one huge character on the right for the title to
    // overlap. Ours is the thing the game is named after, at a scale nothing
    // else on the screen comes close to — it should feel like it is leaning
    // into the frame.
    //
    // Its palette is all dark greens (see PARASITE_PAL) and so is the jungle
    // behind it, so a green glow *behind* a green figure — the first attempt —
    // rendered it invisible. It needs the opposite: a dark plate to sit
    // against, and the glow pushed out to a halo around the silhouette.
    pen.fill(0x030b0a, 0.66);
    pen.ellipse(1215, 690, 165, 215);
    pen.fill(0x02090a, 0.45);
    pen.ellipse(1215, 720, 120, 165);
    // 6.2x, not 10.4x. The art is authored to read at ~40px; at ten times that
    // its eye and spore pods stop being features and become large flat circles
    // strewn across the right third of the screen — which is precisely what they
    // looked like. Smaller shows the whole creature and lets it read as one.
    place(pen, 1215, 858, 6.2, true, () =>
      drawCharacter(pen, {
        pal: PARASITE_PAL,
        accessory: 'scanner',
        facing: 'down',
        step: 0,
        form: 'parasite',
      })
    );

    // ── Foreground foliage, framing the very bottom ─────────────────────────
    // Kept below the crew's feet and out to the corners on purpose: the first
    // pass scattered these across the lower third and they painted straight
    // over the characters, which is the whole reason the group was invisible.
    for (let i = 0; i < 10; i++) {
      const fx = i < 5 ? range(r, -60, 190) : range(r, W - 200, W + 60);
      const fy = range(r, H - 40, H + 70);
      pen.fill(pick(r, [ENV.frond[0], ENV.frond[1], darken(ENV.frond[0], 0.3)]), 0.85);
      pen.poly(blobPts(fx, fy, range(r, 80, 150), 0.3, r, 8));
    }

    // Gentle vignette. Deliberately weak — the readability plate lives in CSS
    // (`.menu-scrim`) over the centre column, so darkening here too just buries
    // the characters this scene exists to show.
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.42, W / 2, H * 0.5, H * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(2,6,9,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }, []);

  return <canvas ref={ref} className="menu-canvas" aria-hidden="true" />;
}
