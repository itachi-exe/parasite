// Contact sheet for the v2 crew art: every seat, every facing, every frame.
import { drawCrew, drawFallen, CELL_W, CELL_H, type Facing, type Form } from '../../src/game/art2/crew';
const S = 2.5;
const cv = document.createElement('canvas');
const cols = 3 * 6;
const rows = 10 + 3;
cv.width = cols * CELL_W * S;
cv.height = rows * CELL_H * S;
document.body.appendChild(cv);
const c = cv.getContext('2d')!;
c.fillStyle = '#0f2a2c';
c.fillRect(0, 0, cv.width, cv.height);
const facings: Facing[] = ['down', 'side', 'up'];
const cell = (r: number, col: number, f: (x: CanvasRenderingContext2D) => void) => {
  c.save();
  c.translate(col * CELL_W * S, r * CELL_H * S);
  c.scale(S, S);
  if ((r + col) % 2) { c.fillStyle = 'rgba(255,255,255,0.025)'; c.fillRect(0, 0, CELL_W, CELL_H); }
  f(c);
  c.restore();
};
for (let seat = 0; seat < 10; seat++)
  facings.forEach((fa, i) => { for (let fr = 0; fr < 6; fr++) cell(seat, i * 6 + fr, (x) => drawCrew(x, { seat, skin: seat % 4, form: 'human' }, fa, fr)); });
(['infected', 'parasite'] as Form[]).forEach((form, k) =>
  facings.forEach((fa, i) => { for (let fr = 0; fr < 6; fr++) cell(10 + k, i * 6 + fr, (x) => drawCrew(x, { seat: 8, skin: 0, form }, fa, fr)); }));
for (let s = 0; s < 6; s++) cell(12, s, (x) => drawFallen(x, s, s % 4));
(window as any).done = true;
