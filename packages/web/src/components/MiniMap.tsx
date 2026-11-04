'use client';

import { useEffect, useRef } from 'react';
import { MAP_WIDTH, MAP_HEIGHT, ROOMS, type PublicPlayer, type Seat } from '@parasite/shared';
import { playersInSight, type LivePosition } from '../game/bridge';

const W = 168;
const H = Math.round((MAP_HEIGHT / MAP_WIDTH) * W);

/**
 * Canvas minimap. Drawn imperatively so it can update at animation rate without
 * churning React state.
 */
export default function MiniMap(props: {
  players: PublicPlayer[];
  positions: Map<Seat, LivePosition>;
  mySeat: Seat | null;
  bodies: { seat: Seat; x: number; y: number }[];
  /** Current area name, captioned under the dial (DESIGN.md §4). */
  room?: string | null;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const data = useRef(props);
  data.current = props;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = ref.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        if (ctx) {
          const sx = W / MAP_WIDTH;
          const sy = H / MAP_HEIGHT;

          ctx.clearRect(0, 0, W, H);
          ctx.fillStyle = '#04130f';
          ctx.fillRect(0, 0, W, H);

          for (const r of ROOMS) {
            ctx.fillStyle = r.kind === 'path' ? '#123a2c' : '#1a5343';
            ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
          }

          const { players, positions, mySeat, bodies } = data.current;

          ctx.fillStyle = '#ff5f7e';
          for (const b of bodies) {
            ctx.fillRect(b.x * sx - 1.5, b.y * sy - 1.5, 3, 3);
          }

          for (const p of playersInSight(players, positions)) {
            if (!p.alive) continue;
            const isMe = p.seat === mySeat;
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, isMe ? 3.2 : 2.2, 0, Math.PI * 2);
            ctx.fillStyle = isMe ? '#3affc0' : '#9fe8d2';
            ctx.fill();
            if (isMe) {
              ctx.strokeStyle = 'rgba(58,255,192,0.55)';
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="minimap" data-room={(props.room ?? 'VIRELIA').toUpperCase()}>
      {/*
        The positional information here is already spoken by the stage's
        sr-only status line, so the canvas itself is hidden rather than
        described twice.
      */}
      <canvas ref={ref} width={W} height={H} role="presentation" aria-hidden="true" />
    </div>
  );
}
