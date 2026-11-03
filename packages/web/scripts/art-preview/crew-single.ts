// One card per character: down, side, up at large scale. ?seat=N&form=human|infected|parasite|fallen
import { drawCrew, drawFallen, CELL_W, CELL_H, type Facing, type Form } from '../../src/game/art2/crew';
const q = new URLSearchParams(location.search);
const seat = +(q.get('seat') ?? 0), form = (q.get('form') ?? 'human') as Form | 'fallen';
const S = 5, cv = document.createElement('canvas');
const n = form === 'fallen' ? 1 : 3;
cv.width = n * CELL_W * S; cv.height = CELL_H * S;
document.body.appendChild(cv);
const c = cv.getContext('2d')!;
const g = c.createRadialGradient(cv.width / 2, cv.height * 0.6, 20, cv.width / 2, cv.height * 0.6, cv.width * 0.7);
g.addColorStop(0, '#153a3c'); g.addColorStop(1, '#081618');
c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
(['down', 'side', 'up'] as Facing[]).slice(0, n).forEach((fa, i) => {
  c.save(); c.translate(i * CELL_W * S, 0); c.scale(S, S);
  if (form === 'fallen') drawFallen(c, seat, seat % 4);
  else drawCrew(c, { seat, skin: seat % 4, form }, fa, 4);
  c.restore();
});
(window as any).done = true;
