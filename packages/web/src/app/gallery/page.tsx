'use client';

import { useEffect, useRef } from 'react';
import { CanvasPen } from '@/game/art/canvasPen';
import { drawCharacter, drawCorpse, FEET, CELL_W, type Facing, type Form } from '@/game/art/chibi';
import {
  SKINS,
  CREW,
  seatPalette,
  infectedPalette,
  corpsePalette,
  PARASITE_PAL,
} from '@/game/art/palette';

/**
 * Art gallery.
 *
 * Every character the game can draw, on one page. This exists because "are the
 * other characters actually built?" is a question that should be answered by
 * looking, not by reading the palette file and believing it — and because a
 * rendering regression in a variant nobody plays (the corpse, the infected
 * form) is otherwise invisible until it appears mid-game in front of players.
 *
 * Uses the same CanvasPen the title screen does, so what is on this page is
 * literally what the game draws.
 */

const SCALE = 2.2;
const PAD = 10;

function Figure(props: { label: string; draw: (pen: CanvasPen) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = CELL_W * SCALE + PAD * 2;
    const h = FEET * SCALE + PAD * 2;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pen = new CanvasPen(ctx);
    pen.withTransform(PAD, PAD, SCALE, () => props.draw(pen));
  }, [props]);

  return (
    <figure className="gal-fig">
      <canvas ref={ref} />
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}

export default function GalleryPage() {
  const facings: Facing[] = ['down', 'side', 'up'];

  return (
    <main className="gal">
      <h1>Parasite character art</h1>
      <p className="gal-note">
        Everything below is drawn from primitives at runtime. There are no image
        files: {SKINS.length} scientists × {CREW.length} crew colours, plus the
        infected and Parasite forms and the corpse.
      </p>

      <h2>Scientists: {SKINS.length} builds, three facings</h2>
      <div className="gal-row">
        {SKINS.map((s, i) =>
          facings.map((f) => (
            <Figure
              key={`${i}-${f}`}
              label={`#${i} ${s.accessory} ${f}`}
              draw={(pen) =>
                drawCharacter(pen, {
                  pal: s.pal,
                  accessory: s.accessory,
                  facing: f,
                  step: 0,
                  form: 'human',
                })
              }
            />
          ))
        )}
      </div>

      <h2>Crew colours: {CREW.length} seats</h2>
      <p className="gal-note">
        Four builds cannot identify ten players, so the seat colour rides on the
        shirt, collar, pack and coat hem rather than on the face.
      </p>
      <div className="gal-row">
        {CREW.map((c, seat) => {
          const base = SKINS[seat % SKINS.length]!;
          return (
            <Figure
              key={c.id}
              label={c.id}
              draw={(pen) =>
                drawCharacter(pen, {
                  pal: seatPalette(base.pal, seat),
                  accessory: base.accessory,
                  facing: 'down',
                  step: 0,
                  form: 'human',
                })
              }
            />
          );
        })}
      </div>

      <h2>Walk cycle</h2>
      <div className="gal-row">
        {([-1, 0, 1] as const).map((step) => (
          <Figure
            key={step}
            label={`step ${step}`}
            draw={(pen) =>
              drawCharacter(pen, {
                pal: SKINS[0]!.pal,
                accessory: SKINS[0]!.accessory,
                facing: 'side',
                step,
                form: 'human',
              })
            }
          />
        ))}
      </div>

      <h2>Other forms</h2>
      <p className="gal-note">
        The infected and Parasite forms are only ever drawn for your own
        character, once you have decrypted your own role. Another player&apos;s
        skin never changes, which is the confidentiality rule enforced on the
        wire as well as here.
      </p>
      <div className="gal-row">
        {SKINS.map((s, i) => (
          <Figure
            key={`inf-${i}`}
            label={`infected #${i}`}
            draw={(pen) =>
              drawCharacter(pen, {
                pal: infectedPalette(s.pal),
                accessory: s.accessory,
                facing: 'down',
                step: 0,
                form: 'infected' as Form,
              })
            }
          />
        ))}
        {facings.map((f) => (
          <Figure
            key={`par-${f}`}
            label={`parasite ${f}`}
            draw={(pen) =>
              drawCharacter(pen, {
                pal: PARASITE_PAL,
                accessory: 'scanner',
                facing: f,
                step: 0,
                form: 'parasite',
              })
            }
          />
        ))}
        {SKINS.map((s, i) => (
          <Figure
            key={`corpse-${i}`}
            label={`corpse #${i}`}
            draw={(pen) => drawCorpse(pen, corpsePalette(s.pal), s.accessory)}
          />
        ))}
      </div>
    </main>
  );
}
