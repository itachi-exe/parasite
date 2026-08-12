/**
 * A 2D-canvas implementation of {@link Pen}.
 *
 * The art modules in this folder are written against `Pen` rather than against
 * Phaser, which is what makes this possible: the menu screen is plain React
 * with no Phaser instance anywhere, but it still draws the *real* scientists
 * and the real Parasite from `chibi.ts` rather than a second, drifting copy of
 * them. Boot Phaser just to paint a title card and you pay ~1MB and a WebGL
 * context for a static image.
 *
 * Transform is exposed (`translate`/`scale`/`rotate` via `withTransform`)
 * because the art draws every character at a fixed 64x76 cell origin — placing
 * one anywhere else on a menu backdrop is the caller's job, not the art's.
 */

import type { Pen, Corners, Pt } from './pen';

/** `0x2ef2b0` → `#2ef2b0`. The art speaks in numbers; canvas wants strings. */
function css(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export class CanvasPen implements Pen {
  constructor(private ctx: CanvasRenderingContext2D) {}

  /** Run `draw` with a translated/scaled frame, then restore. */
  withTransform(
    x: number,
    y: number,
    scale: number,
    draw: () => void,
    opts?: { flipX?: boolean; alpha?: number; rotate?: number }
  ): void {
    const c = this.ctx;
    c.save();
    if (opts?.alpha !== undefined) c.globalAlpha = opts.alpha;
    c.translate(x, y);
    if (opts?.rotate) c.rotate(opts.rotate);
    c.scale(opts?.flipX ? -scale : scale, scale);
    draw();
    c.restore();
  }

  fill(color: number, alpha = 1): void {
    this.ctx.fillStyle = css(color, alpha);
  }
  line(width: number, color: number, alpha = 1): void {
    this.ctx.lineWidth = width;
    this.ctx.strokeStyle = css(color, alpha);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.ctx.fillRect(x, y, w, h);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | Corners): void {
    this.path(x, y, w, h, r);
    this.ctx.fill();
  }
  circle(x: number, y: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    this.ctx.fill();
  }
  poly(pts: readonly Pt[]): void {
    if (!pts.length) return;
    this.trace(pts, true);
    this.ctx.fill();
  }

  strokePoly(pts: readonly Pt[], close = false): void {
    if (!pts.length) return;
    this.trace(pts, close);
    this.ctx.stroke();
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.ctx.strokeRect(x, y, w, h);
  }
  strokeCircle(x: number, y: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number | Corners): void {
    this.path(x, y, w, h, r);
    this.ctx.stroke();
  }

  private trace(pts: readonly Pt[], close: boolean): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]![0], pts[i]![1]);
    if (close) c.closePath();
  }

  /**
   * Rounded-rect path. Radii are clamped to half the shorter side — the art
   * passes generous corner values for small shapes (a 6px-tall bar with r=5),
   * and an unclamped arc there renders as a bowtie rather than a pill.
   */
  private path(x: number, y: number, w: number, h: number, r: number | Corners): void {
    const lim = Math.min(Math.abs(w), Math.abs(h)) / 2;
    const cl = (v: number) => Math.max(0, Math.min(v, lim));
    const tl = cl(typeof r === 'number' ? r : (r.tl ?? 0));
    const tr = cl(typeof r === 'number' ? r : (r.tr ?? 0));
    const br = cl(typeof r === 'number' ? r : (r.br ?? 0));
    const bl = cl(typeof r === 'number' ? r : (r.bl ?? 0));

    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + tl, y);
    c.lineTo(x + w - tr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + tr);
    c.lineTo(x + w, y + h - br);
    c.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    c.lineTo(x + bl, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - bl);
    c.lineTo(x, y + tl);
    c.quadraticCurveTo(x, y, x + tl, y);
    c.closePath();
  }
}
