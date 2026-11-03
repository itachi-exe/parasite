/**
 * The Virelia outpost as 3D blocks: raised deck rooms, walls that follow the
 * exact walkable geometry from @parasite/shared (doors appear wherever a path
 * crosses a room edge), walkways with rails, room props, task consoles, warm
 * room lights that flicker, and a jungle of instanced trees outside.
 *
 * Collision is untouched: everything here is derived from AREAS and
 * TASK_STATIONS, so what the player sees is what the server enforces.
 *
 * World pixels map to scene units through toScene(): 18 px per unit, the
 * world centre at the origin, world +y is scene +z ("down" on screen).
 * North walls (back) are tall, south walls (front) are a low lip so crew are
 * never hidden behind them.
 */
import * as THREE from 'three';
import { AREAS, TASK_STATIONS, WORLD_WIDTH, WORLD_HEIGHT, isWalkable, type AreaId } from '@parasite/shared';
import { pbr, flat, glowMat, part, geo, type Surf } from './crew3d';

// Architecture: painted-metal PBR with procedural detail computed in world
// space (panel seams, scuffs, grime creeping up from the deck), so long walls
// and shared geometry never stretch a texture.
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, kind: Surf = 'paint', grime = true): THREE.MeshStandardMaterial {
  const k = `${color}:${kind}:${grime}`;
  let m = matCache.get(k);
  if (m) return m;
  m = pbr(color, kind, false).clone();
  if (grime) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec4 wp4 = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           wp4 = instanceMatrix * wp4;
         #endif
         vWP = (modelMatrix * wp4).xyz;`,
      );
      sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float pf = fract((vWP.x + vWP.z) / 1.7);
          float seam = mix(0.62, 1.0, smoothstep(0.006, 0.025, min(pf, 1.0 - pf)));
          float hf = fract(vWP.y / 1.1 + 0.35);
          seam *= mix(0.8, 1.0, smoothstep(0.004, 0.02, min(hf, 1.0 - hf)));
          float n = fract(sin(dot(floor(vWP * 7.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float grimeK = 1.0 - smoothstep(0.0, 0.9, vWP.y);
          diffuseColor.rgb *= seam * mix(1.0, 0.45, grimeK) * (0.93 + 0.07 * n);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor + grimeK * 0.3 + (n - 0.5) * 0.12, 0.05, 1.0);`);
    };
    m.customProgramCacheKey = () => 'virelia-grime';
  }
  matCache.set(k, m);
  return m;
}

export const PX = 18;
export function toScene(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3((x - WORLD_WIDTH / 2) / PX, 0, (y - WORLD_HEIGHT / 2) / PX);
}

const WARM = 0xffc27a;
const LAB = 0xffe2b8;
const TEAL = 0x5fd6c8;

/** Floor tint per room, all inside the deep-teal night palette. */
const FLOOR: Record<AreaId, number> = {
  meeting: 0x46585a,
  'lab-a': 0x4b5f66,
  'lab-b': 0x4a5a6a,
  greenhouse: 0x3e5a4c,
  specimen: 0x544e5e,
  path: 0x55676a,
};

// deterministic RNG so the jungle is the same on every client
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function deckTexture(kind: 'plate' | 'grate' | 'soil'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(kind.length * 97);
  if (kind === 'soil') {
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      const v = 150 + Math.floor(r() * 90);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.arc(r() * 128, r() * 128, 1 + r() * 5, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'plate') {
    g.fillStyle = '#dcdcdc';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e8e8e8';
    g.fillRect(4, 4, 56, 56);
    g.fillRect(68, 68, 56, 56);
    g.strokeStyle = '#8a8a8a';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 125, 125);
    g.beginPath();
    g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64);
    g.stroke();
    g.fillStyle = '#9a9a9a';
    for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56], [72, 72], [120, 72], [72, 120], [120, 120]]) g.fillRect(x! - 2, y! - 2, 4, 4);
  } else {
    g.fillStyle = '#9c9c9c';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d0d0d0';
    for (let y = 0; y < 128; y += 16) g.fillRect(0, y + 3, 128, 9);
    g.fillStyle = '#7a7a7a';
    g.fillRect(0, 0, 4, 128);
    g.fillRect(124, 0, 4, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function floorMat(color: number, kind: 'plate' | 'grate' | 'soil', w: number, h: number, tile: number): THREE.MeshStandardMaterial {
  const tex = deckTexture(kind);
  tex.repeat.set(w / tile, h / tile);
  const bump = tex.clone();
  bump.colorSpace = THREE.NoColorSpace;
  const m = kind === 'soil'
    ? new THREE.MeshStandardMaterial({ color, map: tex, bumpMap: bump, bumpScale: 2.5, roughness: 0.9, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color, map: tex, bumpMap: bump, bumpScale: kind === 'grate' ? 3 : 1.5, roughness: 0.34, metalness: 0.6 });
  return m;
}

export interface Outpost {
  root: THREE.Group;
  /** Room lights, in case the scene wants to dim them (sabotage, meetings). */
  lights: THREE.PointLight[];
  /** Deterministic in t: flicker, console pulse, fireflies, spores. */
  update(t: number): void;
}

type Box = [x: number, y: number, w: number, h: number];

export function buildOutpost(): Outpost {
  const root = new THREE.Group();
  root.name = 'outpost';
  const lights: THREE.PointLight[] = [];
  const flickers: { l: THREE.PointLight; base: number; seed: number; stutter: boolean }[] = [];
  const pulses: { m: THREE.MeshBasicMaterial; base: number; seed: number }[] = [];
  const pools: { m: THREE.MeshBasicMaterial; base: number }[] = [];

  const light = (x: number, y: number, h: number, color: number, intensity: number, dist: number, stutter = false) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.copy(toScene(x, y)).setY(h);
    root.add(l);
    // real falloff does the pooling now; a faint painted pool keeps the warm
    // core readable through fog at clip resolution
    const pool = glowMat(color, 0.12);
    const c = toScene(x, y);
    part(root, geo('pool', () => new THREE.PlaneGeometry(1, 1)), pool, [c.x, 0.015, c.z], [-Math.PI / 2, 0, 0], false, [dist * 1.1, dist * 0.95, 1]);
    pools.push({ m: pool, base: 0.12 });
    lights.push(l);
    flickers.push({ l, base: intensity, seed: lights.length * 1.7, stutter });
    return l;
  };
  const at = (x: number, y: number, yy = 0): [number, number, number] => {
    const v = toScene(x, y);
    return [v.x, yy, v.z];
  };

  // ── jungle ground ──────────────────────────────────────────────────────────
  const gw = WORLD_WIDTH / PX + 30, gh = WORLD_HEIGHT / PX + 30;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), floorMat(0x2a5c57, 'soil', gw, gh, 6));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  root.add(ground);

  // ── floors ─────────────────────────────────────────────────────────────────
  for (const a of AREAS) {
    const w = a.w / PX, d = a.h / PX;
    const path = a.id === 'path';
    const top = path ? -0.04 : 0;
    const thick = 0.3 + top;
    const c = toScene(a.x + a.w / 2, a.y + a.h / 2);
    const kind = path ? 'grate' : a.id === 'greenhouse' ? 'soil' : 'plate';
    const slab = part(root, geo(`slab${w}:${d}:${thick}`, () => new THREE.BoxGeometry(w, thick, d)), mat(path ? 0x26302f : 0x2a3434, 'paint'), [c.x, top - thick / 2, c.z]);
    slab.name = `slab-${a.id}`;
    const fm = floorMat(FLOOR[a.id], kind, w, d, path ? 2 : 3);
    if (path && a.h > a.w) fm.map!.rotation = Math.PI / 2;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fm);
    f.rotation.x = -Math.PI / 2;
    f.position.set(c.x, top + 0.002, c.z);
    root.add(f);
  }

  // ── walls and rails: sampled from the walkable boundary ────────────────────
  // For every rect edge, keep the stretches whose outside neighbour is not
  // walkable. Room edges become walls, path edges become rails, and a door
  // opens wherever a path crosses a room edge, all with zero hand-placed data.
  const STEP = 6, OUT = 5;
  const wallMat = mat(0x5b6b6c), capMat = mat(0x8fa3a3, 'metal'), railMat = mat(0x6d7b7b, 'metal', false);
  for (const a of AREAS) {
    const path = a.id === 'path';
    const edges: { horiz: boolean; fixed: number; from: number; to: number; out: number; side: 'n' | 's' | 'e' | 'w' }[] = [
      { horiz: true, fixed: a.y, from: a.x, to: a.x + a.w, out: -1, side: 'n' },
      { horiz: true, fixed: a.y + a.h, from: a.x, to: a.x + a.w, out: 1, side: 's' },
      { horiz: false, fixed: a.x, from: a.y, to: a.y + a.h, out: -1, side: 'w' },
      { horiz: false, fixed: a.x + a.w, from: a.y, to: a.y + a.h, out: 1, side: 'e' },
    ];
    for (const e of edges) {
      const runs: [number, number][] = [];
      let start: number | null = null;
      for (let s = e.from; s <= e.to; s += STEP) {
        const ox = e.horiz ? s : e.fixed + e.out * OUT;
        const oy = e.horiz ? e.fixed + e.out * OUT : s;
        const solid = !isWalkable(ox, oy);
        if (solid && start === null) start = s;
        if ((!solid || s + STEP > e.to) && start !== null) {
          runs.push([start, solid ? e.to : s - STEP]);
          start = null;
        }
      }
      const h = path ? 0.55 : e.side === 'n' ? 2.4 : e.side === 's' ? 0.5 : 1.5;
      const t = path ? 0.14 : e.side === 'n' || e.side === 's' ? 0.4 : 0.6;
      for (const [r0, r1] of runs) {
        const corner0 = Math.abs(r0 - e.from) < STEP, corner1 = Math.abs(r1 - e.to) < STEP;
        const len = (r1 - r0) / PX + (corner0 ? t : 0) + (corner1 ? t : 0);
        if (len < 0.3) continue;
        const mid = (r0 + r1) / 2 + ((corner1 ? t : 0) - (corner0 ? t : 0)) * PX / 2;
        const off = e.out * t * PX / 2;
        const p = e.horiz ? toScene(mid, e.fixed + off) : toScene(e.fixed + off, mid);
        const [bw, bd] = e.horiz ? [len, t] : [t, len];
        if (path) {
          part(root, geo(`rail${bw}:${bd}`, () => new THREE.BoxGeometry(bw, 0.08, bd)), railMat, [p.x, h, p.z]);
          const posts = Math.max(2, Math.round(len / 1.6));
          for (let i = 0; i <= posts; i++) {
            const k = -len / 2 + (len * i) / posts;
            const pp: [number, number, number] = e.horiz ? [p.x + k, h / 2, p.z] : [p.x, h / 2, p.z + k];
            part(root, geo('post', () => new THREE.BoxGeometry(0.1, h, 0.1)), railMat, pp);
            if (i % 2 === 0) part(root, geo('postLed', () => new THREE.BoxGeometry(0.16, 0.08, 0.16)), flat(TEAL, 1, false, 2.5), [pp[0], h + 0.08, pp[2]], [0, 0, 0], false);
          }
          continue;
        }
        part(root, geo(`wall${bw}:${h}:${bd}`, () => new THREE.BoxGeometry(bw, h, bd)), wallMat, [p.x, h / 2, p.z]);
        part(root, geo(`cap${bw}:${bd}`, () => new THREE.BoxGeometry(bw + 0.06, 0.12, bd + 0.06)), capMat, [p.x, h + 0.06, p.z]);
        // a warm strip on the inner face of the tall back wall
        if (e.side === 'n' && len > 2) {
          part(root, geo(`strip${len}`, () => new THREE.BoxGeometry(len - 0.6, 0.07, 0.02)), flat(WARM, 1, false, 3), [p.x, h - 0.45, p.z + t / 2 + 0.012], [0, 0, 0], false);
        }
        // door frames: pillars with a lamp on each run end that is not a corner
        for (const [end, isCorner] of [[r0, corner0], [r1, corner1]] as const) {
          if (isCorner) continue;
          const q = e.horiz ? toScene(end, e.fixed + off) : toScene(e.fixed + off, end);
          const ph = Math.max(h, 1.6) + 0.3;
          part(root, geo(`pillar${ph}`, () => new THREE.BoxGeometry(0.5, ph, 0.5)), mat(0x3a4748), [q.x, ph / 2, q.z]);
          part(root, geo('lampcap', () => new THREE.BoxGeometry(0.36, 0.16, 0.36)), flat(WARM, 1, false, 2.4), [q.x, ph + 0.08, q.z], [0, 0, 0], false);
          part(root, geo('postPool', () => new THREE.PlaneGeometry(3.6, 3.6)), glowMat(WARM, 0.18), [q.x, 0.03, q.z], [-Math.PI / 2, 0, 0], false);
        }
      }
    }
  }

  // ── task consoles ──────────────────────────────────────────────────────────
  for (const [id, s] of Object.entries(TASK_STATIONS)) {
    if (id === 'upload-research-data') continue; // the holo table is this console
    const [x, , z] = at(s.x, s.y);
    const g = new THREE.Group();
    g.position.set(x, 0, z - 0.9);
    root.add(g);
    part(g, geo('conBase', () => new THREE.BoxGeometry(1.4, 0.9, 0.7)), mat(0x34403f), [0, 0.45, 0]);
    part(g, geo('conTop', () => new THREE.BoxGeometry(1.5, 0.12, 0.85)), mat(0x7f9292, 'metal'), [0, 0.95, 0.05], [-0.35, 0, 0]);
    const scr = flat(TEAL, 1, false, 2.2).clone();
    part(g, geo('conScr', () => new THREE.PlaneGeometry(1.2, 0.55)), scr, [0, 1.02, 0.12], [-Math.PI / 2 + 1.2, 0, 0], false);
    pulses.push({ m: scr, base: 1, seed: x });
    part(g, geo('conGlow', () => new THREE.PlaneGeometry(3.2, 3.2)), glowMat(TEAL, 0.18), [0, 0.03, 0.9], [-Math.PI / 2, 0, 0], false);
  }

  // ── rooms: props and lights ────────────────────────────────────────────────
  const area = (id: AreaId) => AREAS.find((a) => a.id === id)!;
  const bench = (x: number, y: number, w = 3, d = 1.1) => {
    const [px, , pz] = at(x, y);
    part(root, geo(`bench${w}:${d}`, () => new THREE.BoxGeometry(w, 0.12, d)), mat(0xa9b8b6, 'metal', false), [px, 0.95, pz]);
    part(root, geo(`benchB${w}:${d}`, () => new THREE.BoxGeometry(w - 0.3, 0.85, d - 0.25)), mat(0x3d4a4b), [px, 0.45, pz]);
    return [px, pz] as const;
  };

  // Central meeting platform: a docking pad with a holo table in the middle
  {
    const [cx, , cz] = at(800, 600);
    part(root, geo('padRing', () => new THREE.RingGeometry(5.2, 5.6, 64)), flat(WARM, 0.75, false, 1.1), [cx, 0.01, cz], [-Math.PI / 2, 0, 0], false);
    part(root, geo('padRing2', () => new THREE.RingGeometry(3.3, 3.45, 64)), flat(0x8fa3a3, 0.5), [cx, 0.01, cz], [-Math.PI / 2, 0, 0], false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(root, geo('chev', () => new THREE.PlaneGeometry(0.9, 0.28)), flat(WARM, 0.8), [cx + Math.cos(a) * 4.4, 0.012, cz + Math.sin(a) * 4.4], [-Math.PI / 2, 0, -a], false);
    }
    part(root, geo('tableBase', () => new THREE.CylinderGeometry(0.9, 1.2, 0.8, 8)), mat(0x34403f), [cx, 0.4, cz]);
    part(root, geo('tableTop', () => new THREE.CylinderGeometry(1.7, 1.6, 0.18, 8)), mat(0x8fa3a3, 'metal', false), [cx, 0.88, cz]);
    // kept under the bloom threshold: whoever stands at the table must stay readable
    const holo = flat(TEAL, 0.18, true, 0.8).clone();
    part(root, geo('holo', () => new THREE.CylinderGeometry(1.1, 0.4, 1.4, 16, 1, true)), holo, [cx, 1.7, cz], [0, 0, 0], false);
    pulses.push({ m: holo, base: 0.32, seed: 3 });
    part(root, geo('holoCore', () => new THREE.OctahedronGeometry(0.32)), flat(0x8fe9dc, 1, false, 0.85), [cx, 1.9, cz], [0, 0, 0], false).name = 'holoCore';
    part(root, geo('holoGlow', () => new THREE.PlaneGeometry(6, 6)), glowMat(TEAL, 0.1), [cx, 0.02, cz], [-Math.PI / 2, 0, 0], false);
    // crates against the side walls, clear of the four corner doors
    for (const [x, y, s] of [[636, 588, 1.1], [638, 610, 0.8], [964, 548, 1.1], [965, 652, 0.9]] as const) {
      part(root, geo(`crate${s}`, () => new THREE.BoxGeometry(s, s, s)), mat(0x7a6a4f, 'cloth'), at(x, y, s / 2));
    }
    // high above the table, not on top of it: a lamp at head height blew out whoever stood there
    light(800, 600, 5.6, LAB, 100, 19);
  }

  // Lab A: bio-sample benches, sample racks, a centrifuge
  {
    const a = area('lab-a');
    bench(a.x + 90, a.y + 70);
    bench(a.x + 260, a.y + 70);
    for (let i = 0; i < 5; i++) {
      const [px, , pz] = at(a.x + 60 + i * 13, a.y + 66);
      part(root, geo('tube', () => new THREE.CylinderGeometry(0.08, 0.08, 0.42, 10)), flat([0xffb35c, 0x7fe0d6, 0xe6eef0][i % 3]!), [px, 1.22, pz], [0, 0, 0], false);
    }
    const [mx, , mz] = at(a.x + 270, a.y + 66);
    part(root, geo('scope', () => new THREE.CylinderGeometry(0.16, 0.24, 0.7, 12)), mat(0xd8dfdf, 'plastic', false), [mx, 1.35, mz], [0.3, 0, 0]);
    part(root, geo('fuge', () => new THREE.CylinderGeometry(0.7, 0.75, 1.0, 16)), mat(0x9fb0b0), at(a.x + 300, a.y + 200, 0.5));
    part(root, geo('fugeLid', () => new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16)), flat(TEAL, 1, false, 2), at(a.x + 300, a.y + 200, 1.04), [0, 0, 0], false);
    part(root, geo('cab', () => new THREE.BoxGeometry(1.2, 1.8, 0.8)), mat(0x5e6e70), at(a.x + 30, a.y + 200, 0.9));
    light(a.x + a.w / 2, a.y + a.h / 2, 3, LAB, 45, 14);
  }

  // Lab B: sensors and comms, server racks and a dish
  {
    const a = area('lab-b');
    for (let i = 0; i < 3; i++) {
      const [px, , pz] = at(a.x + 30 + i * 32, a.y + 40);
      part(root, geo('rack', () => new THREE.BoxGeometry(1.2, 2.0, 0.9)), mat(0x2f3a3c), [px, 1.0, pz]);
      for (let k = 0; k < 4; k++) {
        const led = flat(k % 2 ? WARM : TEAL, 1, false, 3).clone();
        part(root, geo('led', () => new THREE.PlaneGeometry(0.7, 0.07)), led, [px, 0.45 + k * 0.4, pz + 0.46], [0, 0, 0], false);
        pulses.push({ m: led, base: 1, seed: i * 4 + k });
      }
    }
    const [dx, , dz] = at(a.x + 290, a.y + 200);
    part(root, geo('mast', () => new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8)), mat(0x8fa3a3), [dx, 1.1, dz]);
    part(root, geo('commsDish', () => new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, 1.0)), mat(0xd8dfdf, 'metal', false), [dx, 2.3, dz + 0.2], [-0.9, 0, 0]);
    part(root, geo('dishTip', () => new THREE.SphereGeometry(0.12, 10, 8)), flat(WARM, 1, false, 2.6), [dx, 2.55, dz + 0.7], [0, 0, 0], false);
    bench(a.x + 90, a.y + 200, 2.6);
    light(a.x + a.w / 2, a.y + a.h / 2, 3, 0xcfe6ff, 40, 14);
  }

  // Greenhouse: planter rows of bioluminescent flora under warm grow lamps
  {
    const a = area('greenhouse');
    const r = rng(7);
    for (let row = 0; row < 3; row++) {
      const y = a.y + 80 + row * 70;
      const [px, , pz] = at(a.x + 240, y);
      part(root, geo('planter', () => new THREE.BoxGeometry(8, 0.5, 1.3)), mat(0x5a4632, 'cloth'), [px, 0.25, pz]);
      for (let i = 0; i < 9; i++) {
        const tint = [0x3fa79a, 0x2e8f86, 0x5fc4b5][i % 3]!;
        const s = 0.35 + r() * 0.25;
        part(root, geo(`leaf${s.toFixed(2)}`, () => new THREE.ConeGeometry(s, s * 2.2, 5)), mat(tint, 'plastic', false), [px - 3.6 + i * 0.9, 0.5 + s * 1.1, pz + (r() - 0.5) * 0.4]);
        if (i % 3 === 1) part(root, geo('bulb', () => new THREE.SphereGeometry(0.11, 8, 6)), flat(0xbff7ee, 1, false, 3), [px - 3.6 + i * 0.9, 0.62 + s * 2.2, pz], [0, 0, 0], false);
      }
      part(root, geo('lampBar', () => new THREE.BoxGeometry(7.6, 0.1, 0.24)), flat(0xffd9a0, 1, false, 2.2), [px, 2.9, pz], [0, 0, 0], false);
      for (const k of [-3.8, 3.8]) part(root, geo('lampPole', () => new THREE.BoxGeometry(0.12, 2.9, 0.12)), mat(0x6d7b7b), [px + k, 1.45, pz]);
      part(root, geo('bedGlow', () => new THREE.PlaneGeometry(9, 2.6)), glowMat(0xffd9a0, 0.3), [px, 0.52, pz], [-Math.PI / 2, 0, 0], false);
    }
    light(a.x + a.w / 2, a.y + a.h / 2, 3, 0xffd9a0, 45, 14);
    light(a.x + 60, a.y + 60, 2, TEAL, 10, 7);
  }

  // Specimen area: containment tanks and the power conduit that needs repair
  {
    const a = area('specimen');
    for (let i = 0; i < 3; i++) {
      // pods recessed into the back wall: collision is rect only, so a free-standing pod got walked through
      // (x picks skip the north door, where the path comes in)
      const [px, , pz] = at(a.x + [40, 92, 330][i]!, a.y + 2);
      part(root, geo('tankBase', () => new THREE.CylinderGeometry(0.85, 0.95, 0.4, 16)), mat(0x3a4748), [px, 0.2, pz]);
      part(root, geo('tankCap', () => new THREE.CylinderGeometry(0.85, 0.85, 0.3, 16)), mat(0x8fa3a3, 'metal', false), [px, 2.55, pz]);
      part(root, geo('tankGlass', () => new THREE.CylinderGeometry(0.7, 0.7, 2.0, 16, 1, true)), flat(0x7fd8e0, 0.28, true), [px, 1.4, pz], [0, 0, 0], false);
      part(root, geo('tankThing', () => new THREE.IcosahedronGeometry(0.38, 0)), mat(0x6a5a7a, 'plastic', false), [px, 1.3 + i * 0.1, pz]);
    }
    // generator with a warm core and cables to the conduit console
    const [gx, , gz] = at(a.x + 320, a.y + 200);
    part(root, geo('gen', () => new THREE.CylinderGeometry(1.1, 1.3, 1.6, 10)), mat(0x4c5455), [gx, 0.8, gz]);
    const core = flat(0xffb35c, 1, false, 1.7).clone();
    part(root, geo('genCore', () => new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16)), core, [gx, 1.85, gz], [0, 0, 0], false);
    pulses.push({ m: core, base: 1, seed: 11 });
    part(root, geo('genGlow', () => new THREE.PlaneGeometry(5, 5)), glowMat(0xffb35c, 0.4), [gx, 0.03, gz], [-Math.PI / 2, 0, 0], false);
    const st = TASK_STATIONS['repair-power-conduit'];
    const [sx, , sz] = at(st.x, st.y);
    const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(gx, 0.1, gz), new THREE.Vector3((gx + sx) / 2, 0.05, gz + 0.8), new THREE.Vector3(sx + 0.6, 0.1, sz - 0.9)]);
    part(root, new THREE.TubeGeometry(cable, 24, 0.09, 6), mat(0x1f2627, 'rubber', false), [0, 0, 0], [0, 0, 0], false);
    light(a.x + a.w / 2, a.y + a.h / 2, 3, 0xe9c8ff, 36, 14, true);
    light(a.x + 320, a.y + 200, 2, 0xffb35c, 20, 8);
  }

  // ── jungle: instanced, dense and messy (scale, tilt and hue vary) ──────────
  {
    const r = rng(42);
    const spots: [x: number, y: number, s: number, yaw: number, tx: number, tz: number][] = [];
    const clear = (x: number, y: number, m: number) => {
      for (const a of AREAS) if (x > a.x - m && x < a.x + a.w + m && y > a.y - m && y < a.y + a.h + m) return false;
      return true;
    };
    for (let i = 0; i < 9000 && spots.length < 520; i++) {
      const x = -260 + r() * (WORLD_WIDTH + 520), y = -260 + r() * (WORLD_HEIGHT + 520);
      if (!clear(x, y, 24)) continue;
      spots.push([x, y, 0.55 + r() * r() * 1.4, r() * Math.PI * 2, (r() - 0.5) * 0.35, (r() - 0.5) * 0.35]);
    }
    const trunk = new THREE.CylinderGeometry(0.16, 0.34, 2.4, 7, 3);
    trunk.translate(0, 1.2, 0);
    const crown = new THREE.IcosahedronGeometry(1.5, 1);
    const crownTop = new THREE.IcosahedronGeometry(1.0, 1);
    const fern = new THREE.ConeGeometry(0.9, 1.4, 7, 2);
    fern.translate(0, 0.4, 0);
    // broad waxy leaf: a bent plane, scattered as fronds around every spot
    const leaf = new THREE.PlaneGeometry(0.5, 1.5, 1, 4);
    leaf.translate(0, 0.75, 0);
    const lp = leaf.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, -((lp.getY(i) / 1.5) ** 2) * 0.6);
    leaf.computeVertexNormals();
    const leafM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35, side: THREE.DoubleSide });
    type Spot = (typeof spots)[number];
    const layer = (g: THREE.BufferGeometry, color: number, m0: THREE.Material, copies: number, place: (m: THREE.Matrix4, s: Spot, i: number, c: number) => boolean) => {
      const im = new THREE.InstancedMesh(g, m0, spots.length * copies);
      im.castShadow = im.receiveShadow = true;
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      let n = 0;
      spots.forEach((s, i) => {
        for (let c = 0; c < copies; c++) {
          if (!place(m, s, i, c)) continue;
          im.setMatrixAt(n, m);
          // hue and value jitter stay inside the teal/olive night palette
          const h = ((i * 37 + c * 11) % 17) / 17;
          im.setColorAt(n, col.setHex(color).offsetHSL((h - 0.5) * 0.06, (h - 0.5) * 0.1, (h - 0.5) * 0.08));
          n++;
        }
      });
      im.count = n;
      root.add(im);
    };
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const tree = (i: number) => i % 5 < 2;
    const set = (m: THREE.Matrix4, s: Spot, dy: number, k: number, yaw = 0) => {
      const p = toScene(s[0], s[1]);
      e.set(s[4], s[3] + yaw, s[5]);
      m.compose(v.set(p.x, -0.3 + dy * s[2], p.z), q.setFromEuler(e), sc.setScalar(s[2] * k));
      return true;
    };
    const bark = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const canopy = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true });
    layer(trunk, 0x3a2e26, bark, 1, (m, s, i) => tree(i) && set(m, s, 0, 1.15));
    layer(crown, 0x245f55, canopy, 1, (m, s, i) => {
      if (!tree(i)) return false;
      set(m, s, 2.9, 1.1);
      return !!m.scale(sc.set(1 + (i % 4) * 0.14, 0.55 + (i % 5) * 0.12, 1 + (i % 3) * 0.12));
    });
    layer(crownTop, 0x2f7d6c, canopy, 1, (m, s, i) => tree(i) && set(m, s, 4.0, 1.05, 1));
    layer(fern, 0x285f4f, canopy, 1, (m, s, i) => !tree(i) && i % 2 === 0 && set(m, s, 0, 0.8));
    layer(leaf, 0x2d7560, leafM, 5, (m, s, _i, c) => {
      const p = toScene(s[0], s[1]);
      e.set(0.9 + (c % 2) * 0.35, s[3] + (c / 5) * Math.PI * 2, 0, 'YXZ');
      m.compose(v.set(p.x, -0.3, p.z), q.setFromEuler(e), sc.setScalar(0.6 + s[2] * 0.6));
      return true;
    });
  }

  // ── overgrowth on the outpost itself: vines over walls, moss and puddles ──
  {
    const r = rng(77);
    const vine = new THREE.MeshStandardMaterial({ color: 0x24493c, roughness: 0.8 });
    const leafs: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    // vines hang from the tops of tall back walls and sag along walkway rails
    for (const a of AREAS) {
      const path = a.id === 'path';
      for (let i = 0; i < (path ? 26 : 5); i++) {
        const side = path && r() < 0.5 ? a.y + a.h : a.y;
        const x = a.x + r() * a.w;
        if (isWalkable(x, side + (side === a.y ? -5 : 5))) continue; // a door or open edge
        const p = toScene(x, side);
        const top = path ? 0.55 : 2.5;
        const len = path ? 2 + r() * 3 : 1.5 + r() * 2;
        const drop = path ? 0.4 : 1.4 + r();
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 6; k++) {
          const f = k / 6;
          pts.push(new THREE.Vector3(p.x + (f - 0.5) * len, top - Math.sin(f * Math.PI) * drop, p.z + (path ? 0 : 0.22) + (r() - 0.5) * 0.08));
        }
        const c = new THREE.CatmullRomCurve3(pts);
        part(root, new THREE.TubeGeometry(c, 20, 0.035, 5), vine, [0, 0, 0], [0, 0, 0], false);
        for (let k = 0; k < 9; k++) {
          e.set(r() * 6, r() * 6, r() * 6);
          leafs.push(new THREE.Matrix4().compose(c.getPoint(r()), q.setFromEuler(e), sc.setScalar(0.7 + r() * 0.7)));
        }
      }
    }
    const li = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 6), new THREE.MeshStandardMaterial({ color: 0x2f6b55, roughness: 0.5, side: THREE.DoubleSide }), leafs.length);
    leafs.forEach((m, i) => li.setMatrixAt(i, m));
    root.add(li);

    // moss creeping in at path edges, and rain puddles that mirror the lamps
    const path = AREAS.find((x) => x.id === 'path')!;
    const mossM = new THREE.MeshStandardMaterial({ color: 0x2c4a33, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const puddleM = new THREE.MeshPhysicalMaterial({ color: 0x0b1416, roughness: 0.04, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const blob = geo('blob', () => new THREE.CircleGeometry(1, 18));
    for (let i = 0; i < 500; i++) {
      const x = path.x + r() * path.w, y = path.y + r() * path.h;
      if (!isWalkable(x, y)) continue;
      if (AREAS.some((a) => a.id !== 'path' && x > a.x && x < a.x + a.w && y > a.y && y < a.y + a.h)) continue;
      const nearEdge = !isWalkable(x + 14, y) || !isWalkable(x - 14, y) || !isWalkable(x, y + 14) || !isWalkable(x, y - 14);
      const p = toScene(x, y);
      if (nearEdge && r() < 0.8) {
        const s = 0.3 + r() * 0.6;
        part(root, blob, mossM, [p.x, -0.035, p.z], [-Math.PI / 2, 0, r() * 6], false, [s * 1.6, s, 1]);
      } else if (r() < 0.06) {
        const s = 0.5 + r() * 0.9;
        part(root, blob, puddleM, [p.x, -0.034, p.z], [-Math.PI / 2, 0, r() * 6], false, [s * 1.5, s, 1]);
      }
    }
  }

  // ── fireflies (warm) and spores (pale teal), points drifting in t ──────────
  const dot = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const swarm = (n: number, color: number, size: number, seed: number, yMin: number, yMax: number) => {
    const r = rng(seed);
    const base = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) base.set([(r() - 0.5) * (gw - 10), yMin + r() * (yMax - yMin), (r() - 0.5) * (gh - 10), r() * 100], i * 4);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    pts.frustumCulled = false;
    root.add(pts);
    return { base, pos, g, n };
  };
  const flies = swarm(140, 0xffd27a, 0.55, 5, 0.6, 3.5);
  const spores = swarm(220, 0xa8efe4, 0.32, 9, 0.2, 5);

  const update = (t: number) => {
    for (const f of flickers) {
      const n = Math.sin(t * 7.3 + f.seed) * 0.5 + Math.sin(t * 13.1 + f.seed * 2) * 0.5;
      const cut = f.stutter && Math.sin(t * 1.3 + f.seed) > 0.93 ? 0.25 : 1;
      f.l.intensity = f.base * (0.92 + 0.08 * n) * cut;
      const pool = pools[flickers.indexOf(f)];
      if (pool) pool.m.opacity = pool.base * (0.94 + 0.06 * n) * cut;
    }
    for (const p of pulses) p.m.opacity = p.base * (0.75 + 0.25 * Math.sin(t * 2.4 + p.seed));
    const core = root.getObjectByName('holoCore');
    if (core) core.rotation.y = t * 1.2;
    for (let i = 0; i < flies.n; i++) {
      const [x, y, z, s] = flies.base.subarray(i * 4, i * 4 + 4) as unknown as number[];
      flies.pos[i * 3] = x! + Math.sin(t * 0.6 + s!) * 1.6;
      flies.pos[i * 3 + 1] = y! + Math.sin(t * 1.7 + s! * 2) * 0.4;
      flies.pos[i * 3 + 2] = z! + Math.cos(t * 0.5 + s!) * 1.6;
    }
    for (let i = 0; i < spores.n; i++) {
      const [x, y, z, s] = spores.base.subarray(i * 4, i * 4 + 4) as unknown as number[];
      spores.pos[i * 3] = x! + Math.sin(t * 0.3 + s!) * 0.8;
      spores.pos[i * 3 + 1] = 0.2 + ((y! + t * 0.25 + s!) % 5);
      spores.pos[i * 3 + 2] = z! + t * 0.15 % 2;
    }
    flies.g.attributes.position!.needsUpdate = true;
    spores.g.attributes.position!.needsUpdate = true;
  };
  // shadows: lit solids cast and receive; glows, decals and floors do not cast
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    const lit = !(m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
    m.receiveShadow = lit;
    m.castShadow = lit && m.position.y > 0.05 && !(m.material as THREE.Material).transparent;
  });
  update(0);
  return { root, lights, update };
}

/** The night lighting rig the outpost is tuned for. Returns the shadow-casting key light. */
export function addNightLights(scene: THREE.Scene): THREE.DirectionalLight {
  // background and fog come from post.ts setupEnvironment
  scene.add(new THREE.HemisphereLight(0x7fb6b4, 0x16403d, 0.3));
  const key = new THREE.DirectionalLight(0xffe2b8, 1.6);
  key.position.set(-30, 50, 40);
  key.castShadow = true;
  const sc = key.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 160;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.04;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x6ee8dc, 0.7);
  rim.position.set(3, 0.5, -3);
  scene.add(rim);
  return key;
}
