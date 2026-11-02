/**
 * Virelia field crew, v2. Drawn from scratch on Canvas 2D.
 *
 * One look: a chunky expedition suit and a rounded helmet with a dark glass
 * visor, inked with a heavy outline so the silhouette reads at clip size.
 * Key light is the warm lab lamp, from the upper left. The jungle bounces a
 * cool teal rim onto the lower right edge. Toxic green appears ONLY on the
 * Parasite and infected forms.
 *
 * Identity: the suit colour comes from the seat (10 colours), the helmet
 * accessory from the seat too (10 accessories), the chest trim from the
 * chosen skin (4 patterns). Every seat is distinct at a glance.
 */

export const CELL_W = 64;
export const CELL_H = 80;
export const FEET = 73;
export const ORIGIN_Y = FEET / CELL_H;

export type Facing = 'down' | 'up' | 'side';
export type Form = 'human' | 'infected' | 'parasite';

/** Walk frames 0..3 (contact, pass, contact, pass); idle frames 4..5 (breath). */
export const WALK_FRAMES = [0, 1, 2, 3] as const;
export const IDLE_FRAMES = [4, 5] as const;

export const SUITS = [
  0xe04a5f, 0xef8b3f, 0xf0c94a, 0x3f9ae8, 0xa274ee,
  0xe563b0, 0xdfe6e8, 0xa0623c, 0x3a3d48, 0x3fd0dc,
] as const;

export type Accessory =
  | 'headlamp' | 'antenna' | 'fin' | 'earpods' | 'goggles'
  | 'beanie' | 'crest' | 'scarf' | 'dish' | 'hood';

export const ACCESSORIES: readonly Accessory[] = [
  'headlamp', 'antenna', 'fin', 'earpods', 'goggles',
  'beanie', 'crest', 'scarf', 'dish', 'hood',
];

const INK = '#0b1517';
const TOXIC = '#a6ff3d';
const TOXIC_DEEP = '#4fbf1a';
const RIM = 'rgba(110,232,220,0.55)';
const LAMP = '#ffd58a';

// ── colour helpers ───────────────────────────────────────────────────────────
function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function hex(c: [number, number, number]): string {
  return `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
}
function tone(c: number, k: number): string {
  const [r, g, b] = rgb(c);
  return k >= 0
    ? hex([r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k])
    : hex([r * (1 + k), g * (1 + k), b * (1 + k)]);
}
/** Pull a colour toward desaturated grey-olive, for the infected host. */
function sicken(c: number, k: number): number {
  const [r, g, b] = rgb(c);
  const t: [number, number, number] = [92, 104, 88];
  const m = [r + (t[0] - r) * k, g + (t[1] - g) * k, b + (t[2] - b) * k].map(Math.round);
  return (m[0]! << 16) | (m[1]! << 8) | m[2]!;
}

// ── shape helpers ────────────────────────────────────────────────────────────
type Ctx = CanvasRenderingContext2D;

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

/** Fill the current path with a lit-to-shade gradient, then ink it. */
function paint(c: Ctx, base: number, x0: number, y0: number, x1: number, y1: number, ink = 2.2): void {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, tone(base, 0.28));
  g.addColorStop(0.55, tone(base, 0));
  g.addColorStop(1, tone(base, -0.38));
  c.fillStyle = g;
  c.fill();
  if (ink > 0) {
    c.lineWidth = ink;
    c.strokeStyle = INK;
    c.lineJoin = 'round';
    c.stroke();
  }
}

/** Cool rim on the lower-right edge of the current path. */
function rim(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.save();
  c.clip();
  const g = c.createLinearGradient(x + w * 0.55, y + h * 0.4, x + w, y + h);
  g.addColorStop(0, 'rgba(110,232,220,0)');
  g.addColorStop(1, RIM);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
}

// ── the figure ───────────────────────────────────────────────────────────────
export interface Look {
  seat: number;
  skin: number;
  form: Form;
}

interface Pose {
  bob: number;
  legA: number; // forward/back (side) or lift (vertical) for leg A
  legB: number;
  armA: number;
  armB: number;
  breath: number;
}

function poseFor(frame: number): Pose {
  if (frame >= 4) {
    const b = frame === 5 ? 0.8 : 0;
    return { bob: b * 0.6, legA: 0, legB: 0, armA: 0, armB: 0, breath: b };
  }
  const s = [1, 0, -1, 0][frame]!;
  const pass = frame % 2 === 1;
  return { bob: pass ? -2.4 : 0, legA: s, legB: -s, armA: -s, armB: s, breath: 0 };
}

const CX = 32;

function suitColor(look: Look): number {
  const base = SUITS[((look.seat % 10) + 10) % 10]!;
  if (look.form === 'parasite') return sicken(base, 0.82);
  if (look.form === 'infected') return sicken(base, 0.45);
  return base;
}

function shadow(c: Ctx, pose: Pose): void {
  const g = c.createRadialGradient(CX, FEET, 1, CX, FEET, 18);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(CX, FEET, 18 - Math.abs(pose.bob) * 0.8, 6.5, 0, 0, Math.PI * 2);
  c.fill();
}

function legsVertical(c: Ctx, suit: number, p: Pose): void {
  const dark = tone(suit, -0.55);
  for (const [dx, lift] of [[-6.5, p.legA], [6.5, p.legB]] as const) {
    const up = Math.max(0, lift) * 3.2;
    const x = CX + dx - 4;
    const top = 56 + p.bob;
    const h = FEET - top - up;
    rr(c, x, top, 8, h, 3.5);
    c.fillStyle = dark;
    c.fill();
    c.lineWidth = 2.2;
    c.strokeStyle = INK;
    c.stroke();
    // boot
    rr(c, x - 0.5, FEET - up - 5, 9, 5.5, 2.5);
    c.fillStyle = '#1d2628';
    c.fill();
    c.stroke();
  }
}

function legsSide(c: Ctx, suit: number, p: Pose): void {
  const dark = tone(suit, -0.55);
  const back = tone(suit, -0.68);
  const legs: [number, string][] = [[p.legB, back], [p.legA, dark]];
  for (const [s, col] of legs) {
    const swing = s * 4.5;
    const top = 56 + p.bob;
    c.save();
    c.translate(CX, top);
    c.rotate(-s * 0.32);
    rr(c, -4, 0, 8, FEET - top - 1, 3.5);
    c.fillStyle = col;
    c.fill();
    c.lineWidth = 2.2;
    c.strokeStyle = INK;
    c.stroke();
    rr(c, -4, FEET - top - 6, 11, 5.5, 2.5);
    c.fillStyle = '#1d2628';
    c.fill();
    c.stroke();
    c.restore();
    void swing;
  }
}

function torso(c: Ctx, look: Look, facing: Facing, p: Pose): void {
  const suit = suitColor(look);
  const y = 38 + p.bob - p.breath * 0.5;
  const w = facing === 'side' ? 22 : 28;
  const x = CX - w / 2 + (facing === 'side' ? 1 : 0);
  const h = 23 + p.breath * 0.5;

  // back-mounted sample pack (behind the body in side/down, on top in up view)
  if (facing === 'side') {
    rr(c, x - 7, y + 1, 10, 17, 3);
    paint(c, 0x4a5658, x - 7, y, x + 3, y + 18);
    c.fillStyle = LAMP;
    c.fillRect(x - 5, y + 4, 2.5, 2.5);
  }

  rr(c, x, y, w, h, 10);
  paint(c, suit, x, y, x + w, y + h);
  rr(c, x, y, w, h, 10);
  rim(c, x, y, w, h);

  // belt
  c.fillStyle = 'rgba(11,21,23,0.75)';
  c.fillRect(x + 1.5, y + h - 7, w - 3, 3.2);

  if (facing === 'up') {
    rr(c, CX - 9, y + 2, 18, 15, 4);
    paint(c, 0x4a5658, CX - 9, y + 2, CX + 9, y + 17);
    c.fillStyle = LAMP;
    c.beginPath();
    c.arc(CX, y + 9.5, 2.4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,213,138,0.25)';
    c.beginPath();
    c.arc(CX, y + 9.5, 5, 0, Math.PI * 2);
    c.fill();
  } else if (facing === 'down') {
    chestTrim(c, look, x, y, w);
  } else {
    // side: a sliver of the chest panel on the leading edge
    c.fillStyle = 'rgba(255,255,255,0.22)';
    rr(c, x + w - 8, y + 4, 5, 9, 2);
    c.fill();
  }
}

function chestTrim(c: Ctx, look: Look, x: number, y: number, w: number): void {
  const kind = ((look.skin % 4) + 4) % 4;
  c.save();
  c.globalAlpha = 0.9;
  c.fillStyle = 'rgba(245,245,243,0.85)';
  if (kind === 0) {
    rr(c, CX - 5, y + 4, 10, 8, 2.5); // plain chest panel
    c.fill();
    c.fillStyle = INK;
    c.fillRect(CX - 3, y + 7, 6, 1.6);
  } else if (kind === 1) {
    c.fillRect(x + 3, y + 6, w - 6, 2.6); // shoulder stripe
    c.fillRect(x + 3, y + 10, w - 6, 1.4);
  } else if (kind === 2) {
    c.beginPath(); // chevron
    c.moveTo(CX - 8, y + 4); c.lineTo(CX, y + 10); c.lineTo(CX + 8, y + 4);
    c.lineTo(CX + 8, y + 7.5); c.lineTo(CX, y + 13.5); c.lineTo(CX - 8, y + 7.5);
    c.closePath();
    c.fill();
  } else {
    c.beginPath(); // badge dot + zip
    c.arc(CX + 6, y + 7, 2.6, 0, Math.PI * 2);
    c.fill();
    c.fillRect(CX - 0.8, y + 3, 1.6, 14);
  }
  c.restore();
}

function arms(c: Ctx, look: Look, facing: Facing, p: Pose, front: boolean): void {
  const suit = suitColor(look);
  const y = 41 + p.bob;
  const glove = '#e9ecea';
  const draw = (ax: number, swing: number, col: string) => {
    c.save();
    c.translate(ax, y);
    c.rotate(swing * 0.38);
    rr(c, -3.5, -1, 7, 15, 3.5);
    c.fillStyle = col;
    c.fill();
    c.lineWidth = 2.2;
    c.strokeStyle = INK;
    c.stroke();
    c.beginPath();
    c.arc(0, 14.5, 3.6, 0, Math.PI * 2);
    c.fillStyle = look.form === 'parasite' ? '#7c8a72' : glove;
    c.fill();
    c.stroke();
    c.restore();
  };
  if (facing === 'side') {
    if (front) draw(CX + 1, p.armA, tone(suit, -0.05));
    else draw(CX + 3, p.armB, tone(suit, -0.4));
    return;
  }
  if (!front) return;
  draw(CX - 15.5, facing === 'down' ? p.armA * 0.9 : -p.armA * 0.9, tone(suit, 0.05));
  draw(CX + 15.5, facing === 'down' ? -p.armB * 0.9 : p.armB * 0.9, tone(suit, -0.2));
}

function helmet(c: Ctx, look: Look, facing: Facing, p: Pose): void {
  const suit = suitColor(look);
  const hx = CX + (facing === 'side' ? 2 : 0);
  const hy = 25 + p.bob;
  const rx = 15.5;
  const ry = 14.5;

  c.beginPath();
  c.ellipse(hx, hy, rx, ry, 0, 0, Math.PI * 2);
  paint(c, suit, hx - rx, hy - ry, hx + rx, hy + ry, 2.4);
  c.beginPath();
  c.ellipse(hx, hy, rx, ry, 0, 0, Math.PI * 2);
  rim(c, hx - rx, hy - ry, rx * 2, ry * 2);

  // top specular
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.beginPath();
  c.ellipse(hx - 5, hy - 8.5, 5.5, 2.6, -0.35, 0, Math.PI * 2);
  c.fill();

  if (facing === 'up') {
    c.strokeStyle = 'rgba(11,21,23,0.35)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(hx, hy - ry + 2);
    c.lineTo(hx, hy + ry - 3);
    c.stroke();
    return;
  }

  // visor
  const vx = facing === 'side' ? hx + 1 : hx - 11;
  const vw = facing === 'side' ? 15 : 22;
  const vy = hy - 4;
  rr(c, vx, vy, vw, 11, 5.5);
  const g = c.createLinearGradient(vx, vy, vx + vw, vy + 11);
  if (look.form === 'parasite') {
    g.addColorStop(0, '#1b3a10');
    g.addColorStop(1, '#0a1606');
  } else {
    g.addColorStop(0, '#2b4b55');
    g.addColorStop(0.6, '#13242a');
    g.addColorStop(1, '#0a1316');
  }
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 2.2;
  c.strokeStyle = INK;
  c.stroke();

  if (look.form === 'human') {
    // warm lamp reflection, the lab light caught in the glass
    c.fillStyle = 'rgba(255,213,138,0.75)';
    rr(c, vx + 3, vy + 2.2, vw * 0.38, 2.4, 1.2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(vx + vw - 5, vy + 6.5, 2, 2);
  } else {
    // eyeshine: two points of toxic light behind the glass
    const glow = look.form === 'parasite' ? 1 : 0.7;
    const ex = facing === 'side' ? [vx + 9, vx + 13] : [vx + 6, vx + 16];
    for (const e of ex) {
      c.fillStyle = `rgba(166,255,61,${0.28 * glow})`;
      c.beginPath();
      c.arc(e, vy + 5.5, 4.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = TOXIC;
      c.beginPath();
      c.arc(e, vy + 5.5, 1.7, 0, Math.PI * 2);
      c.fill();
    }
    // crack
    c.strokeStyle = look.form === 'parasite' ? TOXIC : 'rgba(166,255,61,0.7)';
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(vx + vw * 0.7, vy + 1);
    c.lineTo(vx + vw * 0.55, vy + 4.5);
    c.lineTo(vx + vw * 0.66, vy + 6.5);
    c.lineTo(vx + vw * 0.5, vy + 10);
    c.stroke();
  }
}

function accessory(c: Ctx, look: Look, facing: Facing, p: Pose, layer: 'back' | 'front'): void {
  const a = ACCESSORIES[((look.seat % 10) + 10) % 10]!;
  const hx = CX + (facing === 'side' ? 2 : 0);
  const hy = 25 + p.bob;
  const suit = suitColor(look);
  c.lineWidth = 2;
  c.strokeStyle = INK;
  const dark = '#27302f';

  if (layer === 'back') {
    if (a === 'hood') {
      c.beginPath();
      c.ellipse(hx - (facing === 'side' ? 3 : 0), hy + 1, 18, 16.5, 0, 0, Math.PI * 2);
      paint(c, 0x5f5446, hx - 18, hy - 16, hx + 18, hy + 17);
    }
    if (a === 'antenna') {
      const ax = facing === 'side' ? hx - 6 : hx + 8;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ax, hy - 9);
      c.lineTo(ax + 3, hy - 24);
      c.lineWidth = 4.2;
      c.strokeStyle = INK;
      c.stroke();
      c.lineWidth = 2;
      c.strokeStyle = '#b9c2c0';
      c.stroke();
      c.lineCap = 'butt';
      c.strokeStyle = INK;
      c.beginPath();
      c.arc(ax + 3, hy - 25, 2.6, 0, Math.PI * 2);
      c.fillStyle = look.form === 'human' ? '#ff6b6b' : TOXIC;
      c.fill();
      c.lineWidth = 1.6;
      c.stroke();
    }
    if (a === 'dish') {
      const ax = facing === 'side' ? hx - 9 : hx - 11;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ax + 1, hy - 5);
      c.lineTo(ax - 3, hy - 16);
      c.lineWidth = 4.2;
      c.strokeStyle = INK;
      c.stroke();
      c.lineWidth = 2;
      c.strokeStyle = '#b9c2c0';
      c.stroke();
      c.lineCap = 'butt';
      c.strokeStyle = INK;
      c.beginPath();
      c.ellipse(ax - 4, hy - 18, 6, 3, -0.4, 0, Math.PI * 2);
      paint(c, 0xc9d1d0, ax - 10, hy - 21, ax + 2, hy - 15, 1.8);
    }
    return;
  }

  switch (a) {
    case 'headlamp': {
      if (facing === 'up') {
        c.fillStyle = dark;
        c.fillRect(hx - 15, hy - 3, 30, 3.2);
        break;
      }
      const lx = facing === 'side' ? hx + 9 : hx;
      c.fillStyle = dark;
      c.fillRect(hx - 15 + (facing === 'side' ? 3 : 0), hy - 8.5, facing === 'side' ? 26 : 30, 3.2);
      rr(c, lx - 4, hy - 12, 8, 6, 2);
      c.fillStyle = '#d7dcd8';
      c.fill();
      c.stroke();
      c.fillStyle = LAMP;
      c.beginPath();
      c.arc(lx, hy - 9, 1.9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,213,138,0.22)';
      c.beginPath();
      c.arc(lx, hy - 9, 6.5, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case 'fin': {
      c.beginPath();
      c.moveTo(hx - 7, hy - 12);
      c.quadraticCurveTo(hx - 2, hy - 24, hx + 7, hy - 21);
      c.quadraticCurveTo(hx + 4, hy - 16, hx + 6, hy - 12);
      c.closePath();
      paint(c, suit, hx - 7, hy - 24, hx + 7, hy - 12, 2);
      break;
    }
    case 'earpods': {
      const sides = facing === 'side' ? [hx - 4] : [hx - 15.5, hx + 15.5];
      for (const ex of sides) {
        rr(c, ex - 3.5, hy - 4, 7, 9, 3);
        c.fillStyle = '#3a4547';
        c.fill();
        c.stroke();
      }
      if (facing === 'down') {
        c.strokeStyle = '#3a4547';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(hx - 15, hy + 4);
        c.quadraticCurveTo(hx - 12, hy + 12, hx - 6, hy + 11);
        c.stroke();
      }
      break;
    }
    case 'goggles': {
      if (facing === 'up') {
        c.fillStyle = dark;
        c.fillRect(hx - 15, hy - 9, 30, 3);
        break;
      }
      const gx = facing === 'side' ? [hx + 6] : [hx - 5.5, hx + 5.5];
      c.fillStyle = dark;
      c.fillRect(hx - 15 + (facing === 'side' ? 3 : 0), hy - 11, facing === 'side' ? 26 : 30, 2.8);
      for (const x of gx) {
        c.beginPath();
        c.arc(x, hy - 10, 4.4, 0, Math.PI * 2);
        c.fillStyle = '#c9a25a';
        c.fill();
        c.stroke();
        c.beginPath();
        c.arc(x, hy - 10, 2.6, 0, Math.PI * 2);
        c.fillStyle = '#1e3a40';
        c.fill();
      }
      break;
    }
    case 'beanie': {
      c.save();
      c.beginPath();
      c.ellipse(hx, hy, 15.5, 14.5, 0, 0, Math.PI * 2);
      c.clip();
      c.beginPath();
      c.rect(hx - 17, hy - 17, 34, 9.5);
      paint(c, 0x3b4c74, hx - 17, hy - 17, hx + 17, hy - 7, 0);
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(hx - 15, hy - 9.5, 30, 2);
      c.beginPath();
      c.arc(hx, hy - 15, 3.4, 0, Math.PI * 2);
      c.fillStyle = '#e8e2d4';
      c.fill();
      c.lineWidth = 1.6;
      c.stroke();
      break;
    }
    case 'crest': {
      c.strokeStyle = look.form === 'human' ? '#7ff0ff' : TOXIC;
      c.lineWidth = 2.2;
      c.beginPath();
      if (facing === 'side') c.ellipse(hx, hy, 14, 13, 0, -Math.PI * 0.95, -Math.PI * 0.3);
      else {
        c.moveTo(hx, hy - 14);
        c.lineTo(hx, hy - 5);
      }
      c.stroke();
      c.fillStyle = 'rgba(127,240,255,0.18)';
      c.beginPath();
      c.arc(hx, hy - 12, 5, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case 'scarf': {
      if (facing === 'up') {
        rr(c, hx - 13, hy + 10, 26, 6, 3);
        paint(c, 0xc95b3c, hx - 13, hy + 10, hx + 13, hy + 16, 2);
        rr(c, hx + 2, hy + 13, 6, 13, 2.5);
        paint(c, 0xc95b3c, hx + 2, hy + 13, hx + 8, hy + 26, 2);
        break;
      }
      rr(c, hx - 13, hy + 10, 26, 6, 3);
      paint(c, 0xc95b3c, hx - 13, hy + 10, hx + 13, hy + 16, 2);
      const tx = facing === 'side' ? hx - 12 : hx - 9;
      rr(c, tx, hy + 13, 6, 11 - p.bob, 2.5);
      paint(c, 0xc95b3c, tx, hy + 13, tx + 6, hy + 24, 2);
      break;
    }
    case 'hood': {
      // the cloth rim around the face opening
      if (facing === 'up') break;
      c.strokeStyle = '#3e372e';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(hx + (facing === 'side' ? 2 : 0), hy + 1, 13, 12, 0, Math.PI * 1.05, Math.PI * 1.95);
      c.stroke();
      break;
    }
    default:
      break;
  }
}

/** Tendrils for the Parasite's own view: tapered, glowing, curling from the pack. */
function tendrils(c: Ctx, facing: Facing, frame: number): void {
  const t = (frame % 4) / 4;
  const roots: [number, number, number, number][] =
    facing === 'up'
      ? [[CX - 7, 42, -1, 0], [CX + 7, 42, 1, 1.3], [CX - 2, 40, -0.4, 2.1], [CX + 3, 41, 0.5, 3]]
      : facing === 'side'
        ? [[CX - 9, 42, -1, 0], [CX - 8, 48, -1.4, 1.7], [CX - 6, 40, -0.5, 2.6]]
        : [[CX - 12, 42, -1, 0], [CX + 12, 42, 1, 1.6], [CX - 6, 39, -0.5, 2.4]];
  c.lineCap = 'round';
  for (const [x, y, d, ph] of roots) {
    const sway = Math.sin(t * Math.PI * 2 + ph) * 3;
    const ex = x + d * 13 + sway;
    const ey = y - 24 - Math.abs(d) * 2;
    const path = () => {
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + d * 12, y - 4 + sway, x + d * 18, y - 15, ex, ey);
    };
    // glow, ink, body, then a thin hot core: reads as one tapered limb
    c.save();
    c.shadowColor = 'rgba(166,255,61,0.9)';
    c.shadowBlur = 8;
    path(); c.lineWidth = 8; c.strokeStyle = INK; c.stroke();
    c.restore();
    path(); c.lineWidth = 5.4; c.strokeStyle = TOXIC_DEEP; c.stroke();
    path(); c.lineWidth = 1.6; c.strokeStyle = TOXIC; c.stroke();
    // barbed tip
    c.fillStyle = TOXIC;
    c.beginPath();
    c.arc(ex, ey, 3, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 1.4; c.strokeStyle = INK; c.stroke();
  }
  c.lineCap = 'butt';
}

/** Veins of light across the suit, for infected and Parasite forms. */
function veins(c: Ctx, form: Form, p: Pose): void {
  if (form === 'human') return;
  c.strokeStyle = form === 'parasite' ? 'rgba(166,255,61,0.85)' : 'rgba(166,255,61,0.5)';
  c.lineWidth = 1.1;
  const y = 40 + p.bob;
  c.beginPath();
  c.moveTo(CX - 9, y + 3); c.lineTo(CX - 5, y + 8); c.lineTo(CX - 7, y + 13);
  c.moveTo(CX + 7, y + 2); c.lineTo(CX + 4, y + 9); c.lineTo(CX + 8, y + 15);
  c.stroke();
}

/** The Parasite's own aura, drawn under the figure. */
function aura(c: Ctx): void {
  const g = c.createRadialGradient(CX, 46, 2, CX, 46, 32);
  g.addColorStop(0, 'rgba(166,255,61,0.38)');
  g.addColorStop(1, 'rgba(166,255,61,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, CELL_W, CELL_H);
}

/**
 * Draw one frame into a 64x80 logical cell. `side` faces right; the scene
 * mirrors it for left.
 */
export function drawCrew(c: Ctx, look: Look, facing: Facing, frame: number, withShadow = true): void {
  const p = poseFor(frame);
  const suit = suitColor(look);
  if (look.form === 'parasite') aura(c);
  if (withShadow) shadow(c, p);
  accessory(c, look, facing, p, 'back');
  if (look.form === 'parasite' && facing === 'up') tendrils(c, facing, frame);
  if (facing === 'side') {
    arms(c, look, facing, p, false);
    legsSide(c, suit, p);
  } else {
    legsVertical(c, suit, p);
  }
  if (look.form === 'parasite' && facing !== 'up') tendrils(c, facing, frame);
  torso(c, look, facing, p);
  veins(c, look.form, p);
  arms(c, look, facing, p, true);
  helmet(c, look, facing, p);
  accessory(c, look, facing, p, 'front');
}

/**
 * A fallen crew member, lying on their side. Always human, whatever killed
 * them: an infected corpse would publish the victim's role to everyone.
 */
export function drawFallen(c: Ctx, seat: number, skin: number): void {
  const look: Look = { seat, skin, form: 'human' };
  // a dark stain, deliberately not green
  const g = c.createRadialGradient(CX + 4, FEET - 9, 2, CX + 4, FEET - 9, 26);
  g.addColorStop(0, 'rgba(60,8,14,0.85)');
  g.addColorStop(0.7, 'rgba(60,8,14,0.45)');
  g.addColorStop(1, 'rgba(60,8,14,0)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(CX + 4, FEET - 9, 27, 10, 0, 0, Math.PI * 2);
  c.fill();
  // lying on the back, head to the left: the front view turned a quarter
  c.save();
  c.translate(CX, FEET - 15);
  c.rotate(-Math.PI / 2);
  c.scale(0.86, 0.86);
  c.translate(-CX, -44);
  drawCrew(c, look, 'down', 4, false);
  c.restore();
  // cracked visor, read from above
  c.strokeStyle = 'rgba(245,245,243,0.85)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(CX - 20, FEET - 18);
  c.lineTo(CX - 17, FEET - 13);
  c.lineTo(CX - 19, FEET - 9);
  c.stroke();
}

