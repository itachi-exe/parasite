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
import { INK, toon, flat, glowMat, part, geo } from './crew3d';

// Architecture uses the crew's toon ramp without its view-space rim: under the
// orthographic game camera that rim paints every camera-facing box face cyan.
const matCache = new Map<number, THREE.MeshToonMaterial>();
function mat(color: number): THREE.MeshToonMaterial {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = toon(color).clone()));
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

function floorMat(color: number, kind: 'plate' | 'grate' | 'soil', w: number, h: number, tile: number): THREE.MeshToonMaterial {
  const m = toon(color).clone();
  const tex = deckTexture(kind);
  tex.repeat.set(w / tile, h / tile);
  m.map = tex;
  return m;
}

// instanced ink hull: same look as crew3d's, but per instance
let INK_I: THREE.ShaderMaterial | null = null;
function inkInstanced(): THREE.ShaderMaterial {
  if (INK_I) return INK_I;
  INK_I = new THREE.ShaderMaterial({
    uniforms: { uW: { value: 0.05 }, uC: { value: new THREE.Color(INK) } },
    vertexShader: `uniform float uW;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec3 n = normalize(normalMatrix * mat3(im) * normal);
        vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
        mv.xyz += n * uW;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, 1.0); }`,
    side: THREE.BackSide,
  });
  return INK_I;
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
    // the toon ramp flattens falloff, so the pool on the deck is painted too
    const pool = glowMat(color, 0.42);
    const c = toScene(x, y);
    part(root, geo('pool', () => new THREE.PlaneGeometry(1, 1)), pool, [c.x, 0.015, c.z], [-Math.PI / 2, 0, 0], false, [dist * 1.1, dist * 0.95, 1]);
    pools.push({ m: pool, base: 0.42 });
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
    const slab = part(root, geo(`slab${w}:${d}:${thick}`, () => new THREE.BoxGeometry(w, thick, d)), mat(path ? 0x26302f : 0x2a3434), [c.x, top - thick / 2, c.z]);
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
  const wallMat = mat(0x5b6b6c), capMat = mat(0x8fa3a3), railMat = mat(0x6d7b7b);
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
            if (i % 2 === 0) part(root, geo('postLed', () => new THREE.BoxGeometry(0.16, 0.08, 0.16)), flat(TEAL), [pp[0], h + 0.08, pp[2]], [0, 0, 0], false);
          }
          continue;
        }
        part(root, geo(`wall${bw}:${h}:${bd}`, () => new THREE.BoxGeometry(bw, h, bd)), wallMat, [p.x, h / 2, p.z]);
        part(root, geo(`cap${bw}:${bd}`, () => new THREE.BoxGeometry(bw + 0.06, 0.12, bd + 0.06)), capMat, [p.x, h + 0.06, p.z]);
        // a warm strip on the inner face of the tall back wall
        if (e.side === 'n' && len > 2) {
          part(root, geo(`strip${len}`, () => new THREE.BoxGeometry(len - 0.6, 0.07, 0.02)), flat(WARM), [p.x, h - 0.45, p.z + t / 2 + 0.012], [0, 0, 0], false);
        }
        // door frames: pillars with a lamp on each run end that is not a corner
        for (const [end, isCorner] of [[r0, corner0], [r1, corner1]] as const) {
          if (isCorner) continue;
          const q = e.horiz ? toScene(end, e.fixed + off) : toScene(e.fixed + off, end);
          const ph = Math.max(h, 1.6) + 0.3;
          part(root, geo(`pillar${ph}`, () => new THREE.BoxGeometry(0.5, ph, 0.5)), mat(0x3a4748), [q.x, ph / 2, q.z]);
          part(root, geo('lampcap', () => new THREE.BoxGeometry(0.36, 0.16, 0.36)), flat(WARM), [q.x, ph + 0.08, q.z], [0, 0, 0], false);
          part(root, geo('lampglow', () => new THREE.PlaneGeometry(3.6, 3.6)), glowMat(WARM, 0.42), [q.x, 0.03, q.z], [-Math.PI / 2, 0, 0], false);
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
    part(g, geo('conTop', () => new THREE.BoxGeometry(1.5, 0.12, 0.85)), mat(0x7f9292), [0, 0.95, 0.05], [-0.35, 0, 0]);
    const scr = flat(TEAL).clone();
    part(g, geo('conScr', () => new THREE.PlaneGeometry(1.2, 0.55)), scr, [0, 1.02, 0.12], [-Math.PI / 2 + 1.2, 0, 0], false);
    pulses.push({ m: scr, base: 1, seed: x });
    part(g, geo('conGlow', () => new THREE.PlaneGeometry(3.2, 3.2)), glowMat(TEAL, 0.35), [0, 0.03, 0.9], [-Math.PI / 2, 0, 0], false);
  }

  // ── rooms: props and lights ────────────────────────────────────────────────
  const area = (id: AreaId) => AREAS.find((a) => a.id === id)!;
  const bench = (x: number, y: number, w = 3, d = 1.1) => {
    const [px, , pz] = at(x, y);
    part(root, geo(`bench${w}:${d}`, () => new THREE.BoxGeometry(w, 0.12, d)), mat(0xa9b8b6), [px, 0.95, pz]);
    part(root, geo(`benchB${w}:${d}`, () => new THREE.BoxGeometry(w - 0.3, 0.85, d - 0.25)), mat(0x3d4a4b), [px, 0.45, pz]);
    return [px, pz] as const;
  };

  // Central meeting platform: a docking pad with a holo table in the middle
  {
    const [cx, , cz] = at(800, 600);
    part(root, geo('padRing', () => new THREE.RingGeometry(5.2, 5.6, 64)), flat(WARM, 0.75), [cx, 0.01, cz], [-Math.PI / 2, 0, 0], false);
    part(root, geo('padRing2', () => new THREE.RingGeometry(3.3, 3.45, 64)), flat(0x8fa3a3, 0.5), [cx, 0.01, cz], [-Math.PI / 2, 0, 0], false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(root, geo('chev', () => new THREE.PlaneGeometry(0.9, 0.28)), flat(WARM, 0.8), [cx + Math.cos(a) * 4.4, 0.012, cz + Math.sin(a) * 4.4], [-Math.PI / 2, 0, -a], false);
    }
    part(root, geo('tableBase', () => new THREE.CylinderGeometry(0.9, 1.2, 0.8, 8)), mat(0x34403f), [cx, 0.4, cz]);
    part(root, geo('tableTop', () => new THREE.CylinderGeometry(1.7, 1.6, 0.18, 8)), mat(0x8fa3a3), [cx, 0.88, cz]);
    const holo = flat(TEAL, 0.55, true).clone();
    part(root, geo('holo', () => new THREE.CylinderGeometry(1.1, 0.4, 1.4, 16, 1, true)), holo, [cx, 1.7, cz], [0, 0, 0], false);
    pulses.push({ m: holo, base: 0.55, seed: 3 });
    part(root, geo('holoCore', () => new THREE.OctahedronGeometry(0.32)), flat(0xbff7ee), [cx, 1.9, cz], [0, 0, 0], false).name = 'holoCore';
    part(root, geo('holoGlow', () => new THREE.PlaneGeometry(6, 6)), glowMat(TEAL, 0.4), [cx, 0.02, cz], [-Math.PI / 2, 0, 0], false);
    // crates stacked at the pad's edge
    for (const [x, y, s] of [[650, 490, 1.1], [672, 492, 0.8], [950, 710, 1.1], [655, 712, 0.9]] as const) {
      part(root, geo(`crate${s}`, () => new THREE.BoxGeometry(s, s, s)), mat(0x7a6a4f), at(x, y, s / 2));
    }
    light(800, 600, 3.2, LAB, 60, 16);
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
    part(root, geo('scope', () => new THREE.CylinderGeometry(0.16, 0.24, 0.7, 12)), mat(0xd8dfdf), [mx, 1.35, mz], [0.3, 0, 0]);
    part(root, geo('fuge', () => new THREE.CylinderGeometry(0.7, 0.75, 1.0, 16)), mat(0x9fb0b0), at(a.x + 300, a.y + 200, 0.5));
    part(root, geo('fugeLid', () => new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16)), flat(TEAL), at(a.x + 300, a.y + 200, 1.04), [0, 0, 0], false);
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
        const led = flat(k % 2 ? WARM : TEAL).clone();
        part(root, geo('led', () => new THREE.PlaneGeometry(0.7, 0.07)), led, [px, 0.45 + k * 0.4, pz + 0.46], [0, 0, 0], false);
        pulses.push({ m: led, base: 1, seed: i * 4 + k });
      }
    }
    const [dx, , dz] = at(a.x + 290, a.y + 200);
    part(root, geo('mast', () => new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8)), mat(0x8fa3a3), [dx, 1.1, dz]);
    part(root, geo('dish', () => new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, 1.0)), mat(0xd8dfdf), [dx, 2.3, dz + 0.2], [-0.9, 0, 0]);
    part(root, geo('dishTip', () => new THREE.SphereGeometry(0.12, 10, 8)), flat(WARM), [dx, 2.55, dz + 0.7], [0, 0, 0], false);
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
      part(root, geo('planter', () => new THREE.BoxGeometry(8, 0.5, 1.3)), mat(0x5a4632), [px, 0.25, pz]);
      for (let i = 0; i < 9; i++) {
        const tint = [0x3fa79a, 0x2e8f86, 0x5fc4b5][i % 3]!;
        const s = 0.35 + r() * 0.25;
        part(root, geo(`leaf${s.toFixed(2)}`, () => new THREE.ConeGeometry(s, s * 2.2, 5)), mat(tint), [px - 3.6 + i * 0.9, 0.5 + s * 1.1, pz + (r() - 0.5) * 0.4]);
        if (i % 3 === 1) part(root, geo('bulb', () => new THREE.SphereGeometry(0.11, 8, 6)), flat(0xbff7ee), [px - 3.6 + i * 0.9, 0.62 + s * 2.2, pz], [0, 0, 0], false);
      }
      part(root, geo('lampBar', () => new THREE.BoxGeometry(7.6, 0.1, 0.24)), flat(0xffd9a0), [px, 2.9, pz], [0, 0, 0], false);
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
      const [px, , pz] = at(a.x + 70 + i * 60, a.y + 60);
      part(root, geo('tankBase', () => new THREE.CylinderGeometry(0.85, 0.95, 0.4, 16)), mat(0x3a4748), [px, 0.2, pz]);
      part(root, geo('tankCap', () => new THREE.CylinderGeometry(0.85, 0.85, 0.3, 16)), mat(0x8fa3a3), [px, 2.55, pz]);
      part(root, geo('tankGlass', () => new THREE.CylinderGeometry(0.7, 0.7, 2.0, 16, 1, true)), flat(0x7fd8e0, 0.28, true), [px, 1.4, pz], [0, 0, 0], false);
      part(root, geo('tankThing', () => new THREE.IcosahedronGeometry(0.38, 0)), mat(0x6a5a7a), [px, 1.3 + i * 0.1, pz]);
    }
    // generator with a warm core and cables to the conduit console
    const [gx, , gz] = at(a.x + 320, a.y + 200);
    part(root, geo('gen', () => new THREE.CylinderGeometry(1.1, 1.3, 1.6, 10)), mat(0x4c5455), [gx, 0.8, gz]);
    const core = flat(0xffb35c).clone();
    part(root, geo('genCore', () => new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16)), core, [gx, 1.85, gz], [0, 0, 0], false);
    pulses.push({ m: core, base: 1, seed: 11 });
    part(root, geo('genGlow', () => new THREE.PlaneGeometry(5, 5)), glowMat(0xffb35c, 0.4), [gx, 0.03, gz], [-Math.PI / 2, 0, 0], false);
    const st = TASK_STATIONS['repair-power-conduit'];
    const [sx, , sz] = at(st.x, st.y);
    const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(gx, 0.1, gz), new THREE.Vector3((gx + sx) / 2, 0.05, gz + 0.8), new THREE.Vector3(sx + 0.6, 0.1, sz - 0.9)]);
    part(root, new THREE.TubeGeometry(cable, 24, 0.09, 6), mat(0x1f2627), [0, 0, 0], [0, 0, 0], false);
    light(a.x + a.w / 2, a.y + a.h / 2, 3, 0xe9c8ff, 36, 14, true);
    light(a.x + 320, a.y + 200, 2, 0xffb35c, 20, 8);
  }

  // ── jungle: instanced trees and ferns outside the walkable region ──────────
  {
    const r = rng(42);
    const spots: Box[] = [];
    const clear = (x: number, y: number, m: number) => {
      for (const a of AREAS) if (x > a.x - m && x < a.x + a.w + m && y > a.y - m && y < a.y + a.h + m) return false;
      return true;
    };
    for (let i = 0; i < 2600 && spots.length < 230; i++) {
      const x = -200 + r() * (WORLD_WIDTH + 400), y = -200 + r() * (WORLD_HEIGHT + 400);
      if (!clear(x, y, 40)) continue;
      spots.push([x, y, 0.8 + r() * 0.7, r() * Math.PI * 2]);
    }
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6);
    trunk.translate(0, 1.1, 0);
    const crown = new THREE.IcosahedronGeometry(1.5, 0);
    const crownTop = new THREE.IcosahedronGeometry(1.0, 0);
    const fern = new THREE.ConeGeometry(0.9, 1.4, 5);
    fern.translate(0, 0.4, 0);
    const layer = (g: THREE.BufferGeometry, color: number, place: (m: THREE.Matrix4, s: Box, i: number) => boolean) => {
      const tm = toon(color).clone();
      const im = new THREE.InstancedMesh(g, tm, spots.length);
      im.castShadow = true;
      const ink = new THREE.InstancedMesh(g, inkInstanced(), spots.length);
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      let n = 0;
      spots.forEach((s, i) => {
        if (!place(m, s, i)) return;
        im.setMatrixAt(n, m);
        ink.setMatrixAt(n, m);
        im.setColorAt(n, col.setHex(color).multiplyScalar(0.8 + ((i * 37) % 10) / 25));
        n++;
      });
      im.count = ink.count = n;
      root.add(im, ink);
    };
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const tree = (i: number) => i % 3 !== 2;
    const set = (m: THREE.Matrix4, s: Box, dy: number, k: number) => {
      const p = toScene(s[0], s[1]);
      e.set(0, s[3], 0);
      m.compose(v.set(p.x, -0.3 + dy * s[2], p.z), q.setFromEuler(e), sc.setScalar(s[2] * k));
      return true;
    };
    layer(trunk, 0x3a2e26, (m, s, i) => tree(i) && set(m, s, 0, 1));
    layer(crown, 0x276a5e, (m, s, i) => {
      if (!tree(i)) return false;
      set(m, s, 2.6, 1);
      return !!m.scale(sc.set(1 + (i % 4) * 0.12, 0.6 + (i % 5) * 0.12, 1 + (i % 3) * 0.1));
    });
    layer(crownTop, 0x358a78, (m, s, i) => tree(i) && set(m, s, 3.7, 1));
    layer(fern, 0x2f7462, (m, s, i) => !tree(i) && set(m, s, 0, 1));
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
  // shadows: solid toon parts cast and receive; ink hulls, glows and decals do not
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const toonish = (m.material as THREE.Material).type === 'MeshToonMaterial';
    m.receiveShadow = toonish;
    if (!(m as THREE.InstancedMesh).isInstancedMesh) m.castShadow = toonish && m.position.y > 0.05;
  });
  update(0);
  return { root, lights, update };
}

/** The night lighting rig the outpost is tuned for. Returns the shadow-casting key light. */
export function addNightLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.background = new THREE.Color(0x081a1b);
  scene.add(new THREE.HemisphereLight(0x7fb6b4, 0x16403d, 0.36));
  const key = new THREE.DirectionalLight(0xffe2b8, 1.25);
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
