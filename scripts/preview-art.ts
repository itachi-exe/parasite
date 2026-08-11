/**
 * Dev tool — render the procedural art to a PNG contact sheet so it can be
 * looked at without a browser.
 *
 * The art in `packages/web/src/game/art/` draws into a `Pen` interface rather
 * than into Phaser directly, precisely so it can be re-hosted. This implements
 * that interface as an SVG emitter and rasterises it with sharp. There is no
 * headless browser in this environment, and "the typecheck passes" tells you
 * nothing about whether a character's head is the right size.
 *
 * Not part of the build or the test suite; it imports nothing that ships.
 *
 *   npx tsx scripts/preview-art.ts            # characters + corpses
 *   npx tsx scripts/preview-art.ts map        # map tiles
 */

import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import type { Pen, Corners, Pt } from '../packages/web/src/game/art/pen.ts';
import {
  SKINS,
  infectedPalette,
  corpsePalette,
  PARASITE_PAL,
  ENV,
  THEMES,
} from '../packages/web/src/game/art/palette.ts';
import {
  drawCharacter,
  drawCorpse,
  CELL_W,
  CELL_H,
  type Facing,
  type Step,
} from '../packages/web/src/game/art/chibi.ts';
// mapArt is imported lazily inside map() so the character sheet can render
// independently of it.

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Emits SVG. Mirrors PhaserPen's semantics, including per-corner radii. */
class SvgPen implements Pen {
  out: string[] = [];
  private f = { c: 0x000000, a: 1 };
  private l = { w: 1, c: 0x000000, a: 1 };

  constructor(private s = 1) {}

  fill(color: number, alpha = 1) {
    this.f = { c: color, a: alpha };
  }
  line(width: number, color: number, alpha = 1) {
    this.l = { w: width * this.s, c: color, a: alpha };
  }
  private fa() {
    return `fill="${hex(this.f.c)}" fill-opacity="${this.f.a}"`;
  }
  private sa() {
    return `fill="none" stroke="${hex(this.l.c)}" stroke-opacity="${this.l.a}" stroke-width="${this.l.w}" stroke-linecap="round" stroke-linejoin="round"`;
  }

  rect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect x="${x * this.s}" y="${y * this.s}" width="${w * this.s}" height="${h * this.s}" ${this.fa()}/>`);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | Corners) {
    this.out.push(`<path d="${this.rrPath(x, y, w, h, r)}" ${this.fa()}/>`);
  }
  circle(x: number, y: number, r: number) {
    this.out.push(`<circle cx="${x * this.s}" cy="${y * this.s}" r="${r * this.s}" ${this.fa()}/>`);
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.out.push(`<ellipse cx="${x * this.s}" cy="${y * this.s}" rx="${rx * this.s}" ry="${ry * this.s}" ${this.fa()}/>`);
  }
  poly(pts: readonly Pt[]) {
    this.out.push(`<polygon points="${this.pp(pts)}" ${this.fa()}/>`);
  }
  strokePoly(pts: readonly Pt[], close = false) {
    const tag = close ? 'polygon' : 'polyline';
    this.out.push(`<${tag} points="${this.pp(pts)}" ${this.sa()}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect x="${x * this.s}" y="${y * this.s}" width="${w * this.s}" height="${h * this.s}" ${this.sa()}/>`);
  }
  strokeCircle(x: number, y: number, r: number) {
    this.out.push(`<circle cx="${x * this.s}" cy="${y * this.s}" r="${r * this.s}" ${this.sa()}/>`);
  }
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number | Corners) {
    this.out.push(`<path d="${this.rrPath(x, y, w, h, r)}" ${this.sa()}/>`);
  }

  private pp(pts: readonly Pt[]) {
    return pts.map(([x, y]) => `${(x * this.s).toFixed(2)},${(y * this.s).toFixed(2)}`).join(' ');
  }

  private rrPath(x0: number, y0: number, w0: number, h0: number, r: number | Corners) {
    const x = x0 * this.s;
    const y = y0 * this.s;
    const w = w0 * this.s;
    const h = h0 * this.s;
    const m = Math.min(w, h) / 2;
    const c =
      typeof r === 'number'
        ? { tl: r * this.s, tr: r * this.s, bl: r * this.s, br: r * this.s }
        : {
            tl: (r.tl ?? 0) * this.s,
            tr: (r.tr ?? 0) * this.s,
            bl: (r.bl ?? 0) * this.s,
            br: (r.br ?? 0) * this.s,
          };
    const tl = Math.min(c.tl, m);
    const tr = Math.min(c.tr, m);
    const bl = Math.min(c.bl, m);
    const br = Math.min(c.br, m);
    return [
      `M${x + tl},${y}`,
      `H${x + w - tr}`,
      tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : '',
      `V${y + h - br}`,
      br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : '',
      `H${x + bl}`,
      bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : '',
      `V${y + tl}`,
      tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : '',
      'Z',
    ]
      .filter(Boolean)
      .join(' ');
  }
}

function svg(w: number, h: number, bg: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

async function render(name: string, w: number, h: number, bg: string, body: string) {
  const markup = svg(w, h, bg, body);
  writeFileSync(`/tmp/${name}.svg`, markup);
  await sharp(Buffer.from(markup)).png().toFile(`/tmp/${name}.png`);
  console.log(`/tmp/${name}.png  (${w}x${h})`);
}

const FACINGS: Facing[] = ['down', 'up', 'side'];
const STEPS: Step[] = [-1, 0, 1];

async function characters() {
  const S = 2;
  const cw = CELL_W * S;
  const ch = CELL_H * S;
  const pad = 6;
  const cols = FACINGS.length * STEPS.length;

  const rows: { label: string; draw: (pen: Pen, f: Facing, st: Step) => void }[] = [];
  SKINS.forEach((s, i) =>
    rows.push({
      label: `skin ${i} (${s.accessory})`,
      draw: (pen, facing, step) =>
        drawCharacter(pen, { pal: s.pal, accessory: s.accessory, facing, step, form: 'human' }),
    })
  );
  SKINS.forEach((s, i) =>
    rows.push({
      label: `infected ${i}`,
      draw: (pen, facing, step) =>
        drawCharacter(pen, {
          pal: infectedPalette(s.pal),
          accessory: s.accessory,
          facing,
          step,
          form: 'infected',
        }),
    })
  );
  rows.push({
    label: 'PARASITE',
    draw: (pen, facing, step) =>
      drawCharacter(pen, {
        pal: PARASITE_PAL,
        accessory: 'cap',
        facing,
        step,
        form: 'parasite',
      }),
  });
  rows.push({
    label: 'corpses',
    draw: (pen, _f, step) => {
      const i = ((step + 1) % SKINS.length) as number;
      drawCorpse(pen, corpsePalette(SKINS[i]!.pal), SKINS[i]!.accessory);
    },
  });

  const labelW = 150;
  const W = labelW + cols * (cw + pad);
  const H = 26 + rows.length * (ch + pad);
  const body: string[] = [];

  FACINGS.forEach((f, fi) =>
    STEPS.forEach((st, si) => {
      const x = labelW + (fi * STEPS.length + si) * (cw + pad);
      body.push(
        `<text x="${x + cw / 2}" y="16" fill="#8ffce0" font-family="monospace" font-size="11" text-anchor="middle">${f}/${st}</text>`
      );
    })
  );

  rows.forEach((row, ri) => {
    const y = 26 + ri * (ch + pad);
    body.push(
      `<text x="8" y="${y + ch / 2}" fill="#cfe" font-family="monospace" font-size="12">${row.label}</text>`
    );
    FACINGS.forEach((f, fi) =>
      STEPS.forEach((st, si) => {
        const x = labelW + (fi * STEPS.length + si) * (cw + pad);
        const pen = new SvgPen(S);
        row.draw(pen, f, st);
        const flip = f === 'side' && si === 0 ? ` transform="translate(${cw},0) scale(-1,1)"` : '';
        body.push(
          `<g transform="translate(${x},${y})"><rect width="${cw}" height="${ch}" fill="#12241d"/><g${flip}>${pen.out.join('')}</g></g>`
        );
      })
    );
  });

  await render('chars', W, H, '#04130f', body.join(''));
}

async function map() {
  const { drawRoomFloor, drawProps, drawFoliageClump } = await import(
    '../packages/web/src/game/art/mapArt.ts'
  );
  const cells: { label: string; w: number; h: number; body: string }[] = [];
  for (const [id, theme] of Object.entries(THEMES)) {
    const w = 340;
    const h = 260;
    const pen = new SvgPen(1);
    drawRoomFloor(pen, { x: 0, y: 0, w, h, theme, seed: id.length * 977 + 31 });
    drawProps(pen, { id, x: 0, y: 0, w, h, theme, seed: id.length * 613 + 7 });
    cells.push({ label: id, w, h, body: pen.out.join('') });
  }

  const fp = new SvgPen(1);
  fp.fill(ENV.soil, 1);
  fp.rect(0, 0, 340, 260);
  for (let i = 0; i < 14; i++) {
    drawFoliageClump(fp, {
      x: 30 + (i % 5) * 62 + (i % 3) * 9,
      y: 40 + Math.floor(i / 5) * 70,
      scale: 0.7 + ((i * 7) % 10) / 12,
      seed: 100 + i * 37,
    });
  }
  cells.push({ label: 'foliage', w: 340, h: 260, body: fp.out.join('') });

  const pad = 10;
  const cols = 3;
  const cw = 340;
  const ch = 260;
  const W = pad + cols * (cw + pad);
  const H = pad + Math.ceil(cells.length / cols) * (ch + pad + 18);
  const body = cells.map((c, i) => {
    const x = pad + (i % cols) * (cw + pad);
    const y = pad + Math.floor(i / cols) * (ch + pad + 18);
    return `<g transform="translate(${x},${y})">${c.body}<text x="6" y="${ch + 13}" fill="#8ffce0" font-family="monospace" font-size="12">${c.label}</text></g>`;
  });

  await render('map', W, H, '#04130f', body.join(''));
}

const mode = process.argv[2] ?? 'chars';
if (mode === 'map') await map();
else await characters();
