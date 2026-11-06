'use client';

import { useEffect, useRef } from 'react';
import type { RoomState, Seat, TaskId } from '@parasite/shared';
import { TASK_DEFS } from '@parasite/shared';
import type { SceneBridge } from '@/game/bridge';

export const preloadGameScene = () => import('@/game/three/ThreeScene');

/**
 * Mounts the three.js scene and feeds it the latest snapshot.
 *
 * three is imported dynamically so Next's server render never touches WebGL.
 * The bridge is mutated in place rather than replaced, so the scene reads fresh
 * data every frame without React re-rendering at 60fps. `positions` is passed
 * through as the same ref-backed Map; the scene merges it every frame.
 */
export default function GameStage(props: {
  state: RoomState | null;
  mySeat: Seat | null;
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>;
  isParasite: boolean;
  onInput: (ax: number, ay: number, fx?: number, fy?: number) => void;
  inputEnabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
    let scene: { destroy(): void } | null = null;
    (async () => {
      const { ThreeScene } = await preloadGameScene();
      if (destroyed || !hostRef.current) return;
      scene = new ThreeScene(hostRef.current, bridge.current);
    })();
    return () => {
      destroyed = true;
      scene?.destroy();
    };
  }, []);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}
