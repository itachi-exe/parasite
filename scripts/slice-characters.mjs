#!/usr/bin/env node
/**
 * Slice assets/characters.jpg into individual character sprites.
 *
 * The source sheet is a single 1168x784 render of six chibi figures on a white
 * studio background:
 *   0..3 → four human scientist variants (player skins)
 *   4    → "partially infected" human (the just-infected transition state)
 *   5    → the full Parasite form (revealed at game over)
 *
 * Two things make this non-trivial:
 *
 *  1. COLUMN DETECTION. Rather than hardcoding six crop boxes, we scan for
 *     columns containing non-background pixels and group them into runs. That
 *     way the crops come from the actual image and survive a re-render of the
 *     sheet.
 *
 *  2. BACKGROUND REMOVAL. The characters wear WHITE LAB COATS, so the obvious
 *     "make every near-white pixel transparent" pass punches holes straight
 *     through every character's torso. Instead we flood-fill inward from the
 *     image border: only white that is actually connected to the outside is
 *     removed. Coat white is enclosed by outlines and survives.
 *
 * Output: packages/web/public/sprites/*.png plus a manifest.
 * Generated sprites are committed so the app runs with no build step.
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'characters.jpg');
const OUT_DIR = path.join(ROOT, 'packages', 'web', 'public', 'sprites');

/** A pixel is "background" if it is bright and nearly colour-neutral. */
const BG_LUMA = 236;
const BG_CHROMA = 14;

/** Padding kept around each detected figure, in px. */
const PAD = 8;

const NAMES = [
  'human-0',
  'human-1',
  'human-2',
  'human-3',
  'infected',
  'parasite',
];

function isBackgroundPixel(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  return maxc >= BG_LUMA && maxc - minc <= BG_CHROMA;
}

/**
 * Flood fill from every border pixel, marking connected background.
 * Iterative (explicit stack) — a recursive fill blows the stack on a
 * 1168x784 image.
 */
function computeBackgroundMask(data, width, height, channels) {
  const bg = new Uint8Array(width * height);
  const stack = [];

  const consider = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (bg[idx]) return;
    const o = idx * channels;
    if (!isBackgroundPixel(data[o], data[o + 1], data[o + 2])) return;
    bg[idx] = 1;
    stack.push(idx);
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    consider(x + 1, y);
    consider(x - 1, y);
    consider(x, y + 1);
    consider(x, y - 1);
  }

  return bg;
}

/** Group columns that contain foreground into runs, ignoring thin noise. */
function findColumnRuns(bg, width, height, minRunWidth, minColPixels) {
  const runs = [];
  let start = -1;

  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (!bg[y * width + x]) count++;
    }
    const solid = count >= minColPixels;
    if (solid && start === -1) start = x;
    if (!solid && start !== -1) {
      if (x - start >= minRunWidth) runs.push([start, x - 1]);
      start = -1;
    }
  }
  if (start !== -1 && width - start >= minRunWidth) runs.push([start, width - 1]);
  return runs;
}

/** Vertical extent of foreground within a column range. */
function findRowExtent(bg, width, height, x0, x1) {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    let found = false;
    for (let x = x0; x <= x1; x++) {
      if (!bg[y * width + x]) {
        found = true;
        break;
      }
    }
    if (found) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  return [top, bottom];
}

async function main() {
  console.log(`[sprites] reading ${path.relative(ROOT, SRC)}`);
  const img = sharp(SRC);
  const meta = await img.metadata();
  const { width, height } = meta;
  console.log(`[sprites] source is ${width}x${height}`);

  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  const bg = computeBackgroundMask(data, width, height, channels);

  // Require a column to have a meaningful vertical run of foreground before it
  // counts, so JPEG speckle in the background does not create phantom figures.
  const minColPixels = Math.max(4, Math.round(height * 0.02));
  const minRunWidth = Math.max(8, Math.round(width * 0.02));
  let runs = findColumnRuns(bg, width, height, minRunWidth, minColPixels);
  console.log(`[sprites] detected ${runs.length} column run(s)`);

  if (runs.length !== NAMES.length) {
    // Fall back to an even 6-way split rather than failing the build. The sheet
    // is a known, fixed input; this only trips if it is replaced.
    console.warn(
      `[sprites] WARNING: expected ${NAMES.length} figures, found ${runs.length}. ` +
        `Falling back to an even split.`
    );
    const sliceW = Math.floor(width / NAMES.length);
    runs = NAMES.map((_, i) => [
      i * sliceW,
      i === NAMES.length - 1 ? width - 1 : (i + 1) * sliceW - 1,
    ]);
  }

  // Build the transparent RGBA buffer once; each crop is an extract of it.
  const rgba = Buffer.from(data);
  for (let i = 0; i < width * height; i++) {
    if (bg[i]) rgba[i * channels + 3] = 0;
  }

  await mkdir(OUT_DIR, { recursive: true });

  const manifest = [];
  for (let i = 0; i < runs.length; i++) {
    const [x0, x1] = runs[i];
    const [top, bottom] = findRowExtent(bg, width, height, x0, x1);
    if (top === -1) {
      console.warn(`[sprites] run ${i} is empty, skipping`);
      continue;
    }

    const left = Math.max(0, x0 - PAD);
    const right = Math.min(width - 1, x1 + PAD);
    const topP = Math.max(0, top - PAD);
    const bottomP = Math.min(height - 1, bottom + PAD);
    const w = right - left + 1;
    const h = bottomP - topP + 1;

    const name = NAMES[i] ?? `extra-${i}`;
    const file = `${name}.png`;

    await sharp(rgba, { raw: { width, height, channels } })
      .extract({ left, top: topP, width: w, height: h })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, file));

    manifest.push({ name, file, width: w, height: h });
    console.log(`[sprites]   ${file}  ${w}x${h}`);
  }

  // A single sheet is handy for anything that wants all frames at once.
  await sharp(rgba, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, 'characters-full.png'));

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ source: 'assets/characters.jpg', sprites: manifest }, null, 2)
  );

  console.log(`[sprites] wrote ${manifest.length} sprites to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error('[sprites] FAILED:', err);
  process.exit(1);
});
