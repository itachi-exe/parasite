// ThreeScene driven by a fake bridge, rendered headless (no dev server, no server).
// ?mode=meeting|specimen|ghost  ?w= tests a narrow viewport via the page size
import { ThreeScene } from '../../src/game/three/ThreeScene';
import { replaceSnapshot, type SceneBridge } from '../../src/game/bridge';
import { TASK_IDS, type PublicPlayer } from '@parasite/shared';

const mode = new URLSearchParams(location.search).get('mode') ?? 'meeting';
const names = ['Wren', 'Okafor', 'Ilse', 'Tomas', 'Juno', 'Rhee', 'Bastian', 'Mara', 'Kenji', 'Asha'];
const spots: [number, number][] = mode === 'specimen'
  ? [[1240, 920], [1180, 860], [1320, 980], [1150, 1000], [1290, 870], [800, 600], [820, 640], [760, 560], [780, 620], [840, 580]]
  : [[800, 600], [870, 580], [720, 640], [900, 670], [760, 520], [690, 560], [850, 690], [940, 600], [1240, 920], [320, 930]];
const players = names.map((name, seat) => ({
  id: `p${seat}`, seat, name, skin: (seat % 4) as 0 | 1 | 2 | 3, address: null,
  x: spots[seat]![0], y: spots[seat]![1], dir: 1, moving: seat % 3 === 1,
  alive: !(mode === 'ghost' && seat === 0) && seat !== 9, connected: true,
})) as unknown as PublicPlayer[];

const bridge: SceneBridge = {
  players,
  positions: new Map(),
  bodies: mode === 'specimen' ? [{ seat: 9, x: 1200, y: 960 }] : [{ seat: 9, x: 980, y: 700 }],
  mySeat: 0,
  isParasite: mode === 'specimen',
  myTasks: [...TASK_IDS],
  doneTasks: [],
  frozen: false,
  onInput: () => {},
};
replaceSnapshot(bridge.positions, bridge);
// the living walk a step first so the sight cone has a direction (?look=up|down|left|right)
const look = new URLSearchParams(location.search).get('look') ?? (mode === 'specimen' ? 'up' : 'right');
const step = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, number[]>)[look] ?? [1, 0];
const t0 = performance.now();
const walker = setInterval(() => {
  const k = Math.min(1, (performance.now() - t0) / 900);
  bridge.positions.set(0, { x: spots[0]![0] + step[0]! * 40 * k, y: spots[0]![1] + step[1]! * 40 * k, dir: 1, moving: k < 1 });
  if (k >= 1) clearInterval(walker);
}, 50);
const host = document.getElementById('stage')!;
new ThreeScene(host, bridge);
// let the walk cycles, flicker and camera settle, then shoot
setTimeout(() => ((window as unknown as { done: boolean }).done = true), 2500);
