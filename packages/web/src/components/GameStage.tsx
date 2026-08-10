'use client';

import { useEffect, useRef } from 'react';
import type { RoomState, Seat, TaskId, PublicPlayer } from '@parasite/shared';
import { TASK_DEFS } from '@parasite/shared';
import type { SceneBridge } from '@/game/MainScene';

/**
 * Mounts Phaser and feeds it the latest snapshot.
 *
 * Phaser is imported dynamically because it touches `window` at module scope and
 * would break Next's server render. The bridge object is mutated in place rather
 * than replaced so the scene reads fresh data every frame without React needing
 * to re-render at 60fps.
 */
export default function GameStage(props: {
  state: RoomState | null;
  mySeat: Seat | null;
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>;
  isParasite: boolean;
  onInput: (ax: number, ay: number) => void;
  inputEnabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<unknown>(null);
  const bridge = useRef<SceneBridge>({
    players: [],
    bodies: [],
    mySeat: null,
    isParasite: false,
    myTasks: TASK_DEFS.map((t) => t.id) as TaskId[],
    doneTasks: [],
    frozen: false,
    onInput: () => {},
    onContext: () => {},
  });

  // Keep the bridge current every render. Mutation, not replacement.
  const b = bridge.current;
  b.players = mergePositions(props.state?.players ?? [], props.positions);
  b.bodies = props.state?.bodies ?? [];
  b.mySeat = props.mySeat;
  b.isParasite = props.isParasite;
  b.frozen = !props.inputEnabled;
  b.onInput = props.onInput;

  useEffect(() => {
    let destroyed = false;

    (async () => {
      // Phaser's ESM build has no default export, but its CJS build (and the
      // .d.ts, via `export = Phaser`) does. Accept whichever the bundler hands
      // us rather than assuming one, or `new Phaser.Game` throws at runtime.
      const mod = await import('phaser');
      const maybe = mod as unknown as { default?: typeof mod };
      const Phaser = maybe.default ?? mod;
      const { MainScene } = await import('@/game/MainScene');
      if (destroyed || !hostRef.current) return;

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        backgroundColor: '#04130f',
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        physics: { default: 'arcade' },
        scene: [MainScene],
        // The canvas is a pure renderer; React owns all UI chrome.
        dom: { createContainer: false },
      });
      game.scene.start('main', { bridge: bridge.current });
      gameRef.current = game;
    })();

    return () => {
      destroyed = true;
      const g = gameRef.current as { destroy?: (removeCanvas: boolean) => void } | null;
      g?.destroy?.(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}

/**
 * Overlay the fast position channel onto the last full snapshot.
 *
 * Full snapshots are only sent on structural change, so without this players
 * would visibly freeze between them.
 */
function mergePositions(
  players: PublicPlayer[],
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>
): PublicPlayer[] {
  return players.map((p) => {
    const live = positions.get(p.seat);
    return live ? { ...p, x: live.x, y: live.y, dir: live.dir, moving: live.moving } : p;
  });
}
