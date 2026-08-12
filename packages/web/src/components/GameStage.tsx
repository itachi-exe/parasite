'use client';

import { useEffect, useRef } from 'react';
import type { RoomState, Seat, TaskId } from '@parasite/shared';
import { TASK_DEFS } from '@parasite/shared';
import type { SceneBridge } from '@/game/MainScene';

/**
 * Mounts Phaser and feeds it the latest snapshot.
 *
 * Phaser is imported dynamically because it touches `window` at module scope and
 * would break Next's server render. The bridge object is mutated in place rather
 * than replaced so the scene reads fresh data every frame without React needing
 * to re-render at 60fps.
 *
 * `positions` is handed straight through as the same ref-backed Map, unmerged.
 * It's mutated by the socket layer many times a second with no React re-render
 * at all, so merging it here (in the render body) would only ever pick up the
 * rare re-renders triggered by a full `state` snapshot — MainScene merges it
 * fresh every Phaser frame instead, which is where "every frame" is actually true.
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
    positions: props.positions,
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
  b.players = props.state?.players ?? [];
  b.positions = props.positions;
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
