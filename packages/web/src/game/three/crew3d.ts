/**
 * Virelia field crew as three.js toon models, built in code.
 *
 * Ported from art2/crew.ts: same seat colours (SUITS), same accessories,
 * same infected / Parasite / fallen forms. Toxic green appears ONLY on the
 * infected and Parasite forms. Lighting language: 3-band toon ramp, warm key
 * from the upper left (scene light), teal rim on the lower right (baked into
 * the material so it survives any scene), inverted-hull ink outline.
 *
 * Units: one unit is roughly a third of a crew member; a crew stands ~2.3 tall
 * with feet at y = 0. The model faces +Z ("down" on screen).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SUITS, ACCESSORIES, type Form } from '../art2/crew';

export type Facing4 = 'down' | 'up' | 'left' | 'right';
export interface CrewLook {
  seat: number;
  skin: number;
  form: Form;
}

export const INK = 0x0b1517;
export const TOXIC = 0xa6ff3d;
const TOXIC_DEEP = 0x4fbf1a;
const LAMP = 0xffd58a;
const RIM = new THREE.Color(0x6ee8dc);
const INK_W = 0.034;

const YAW: Record<Facing4, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

// ── colour helpers (same maths as art2/crew.ts) ─────────────────────────────
function tone(c: number, k: number): number {
  const col = new THREE.Color(c);
  if (k >= 0) col.lerp(new THREE.Color(0xffffff), k);
  else col.multiplyScalar(1 + k);
  return col.getHex();
}
function sicken(c: number, k: number): number {
  return new THREE.Color(c).lerp(new THREE.Color(92 / 255, 104 / 255, 88 / 255), k).getHex();
}
export function suitColor(look: CrewLook): number {
  const base = SUITS[((look.seat % 10) + 10) % 10]!;
  if (look.form === 'parasite') return sicken(base, 0.82);
  if (look.form === 'infected') return sicken(base, 0.45);
  return base;
}

// ── shared materials and geometry caches ────────────────────────────────────
let RAMP: THREE.DataTexture | null = null;
function ramp(): THREE.DataTexture {
  if (RAMP) return RAMP;
  const d = new Uint8Array([84, 84, 84, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  RAMP = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter;
  RAMP.needsUpdate = true;
  return RAMP;
}

const toonCache = new Map<number, THREE.MeshToonMaterial>();
/** Toon material with a banded teal rim on the lower-right edge (view space). */
export function toon(color: number): THREE.MeshToonMaterial {
  const hit = toonCache.get(color);
  if (hit) return hit;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: RIM };
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
       float rimM = smoothstep(-0.1, 0.55, normal.x * 0.75 - normal.y * 0.65);
       outgoingLight += uRim * smoothstep(0.52, 0.62, rimF) * rimM * 0.75;
       #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'virelia-rim';
  toonCache.set(color, m);
  return m;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();
export function flat(color: number, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const k = `${color}:${opacity}:${additive}`;
  const hit = basicCache.get(k);
  if (hit) return hit;
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1 || additive,
    opacity,
    depthWrite: !(opacity < 1 || additive),
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  basicCache.set(k, m);
  return m;
}

let FALLOFF: THREE.DataTexture | null = null;
/** Additive radial-falloff material, for ground glows that must not band. */
export function glowMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  if (!FALLOFF) {
    const n = 64;
    const d = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - r) ** 2;
      d.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
    }
    FALLOFF = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    FALLOFF.magFilter = FALLOFF.minFilter = THREE.LinearFilter;
    FALLOFF.needsUpdate = true;
  }
  return new THREE.MeshBasicMaterial({ color, map: FALLOFF, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
}

let INK_MAT: THREE.ShaderMaterial | null = null;
/** Inverted hull pushed out along smoothed normals, so the line is even everywhere. */
function inkMat(): THREE.ShaderMaterial {
  if (INK_MAT) return INK_MAT;
  INK_MAT = new THREE.ShaderMaterial({
    uniforms: { uW: { value: INK_W }, uC: { value: new THREE.Color(INK) } },
    vertexShader: `uniform float uW;
      void main(){
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += n * uW;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, 1.0); }`,
    side: THREE.BackSide,
  });
  return INK_MAT;
}

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Welded copy with smooth normals: hard-edged caps no longer split the hull. */
function hullOf(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = hullCache.get(geo);
  if (hit) return hit;
  const g = geo.clone();
  for (const a of Object.keys(g.attributes)) if (a !== 'position') g.deleteAttribute(a);
  const w = mergeVertices(g, 1e-3);
  w.computeVertexNormals();
  hullCache.set(geo, w);
  return w;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}
const sphere = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 28, 18));
const capsule = (r: number, h: number) => geo(`c${r}:${h}`, () => new THREE.CapsuleGeometry(r, h, 6, 16));
const rbox = (w: number, h: number, d: number, r: number) =>
  geo(`b${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
const torus = (r: number, t: number, arc = Math.PI * 2) =>
  geo(`t${r}:${t}:${arc}`, () => new THREE.TorusGeometry(r, t, 10, 40, arc));
const cyl = (r0: number, r1: number, h: number) => geo(`y${r0}:${r1}:${h}`, () => new THREE.CylinderGeometry(r0, r1, h, 20));

type V3 = [number, number, number];
/** A strip that hugs the helmet: a latitude band of a slightly larger sphere. */
const band = (r: number, from: number, len: number) =>
  geo(`band${r}:${from}:${len}`, () => new THREE.SphereGeometry(r, 36, 3, 0, Math.PI * 2, from, len));
/** Mesh plus its ink hull. `ink` false for decals, glows and tiny details. */
function part(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material,
  pos: V3 = [0, 0, 0],
  rot: V3 = [0, 0, 0],
  ink = true,
  scale?: V3,
): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  parent.add(mesh);
  if (ink) {
    const o = new THREE.Mesh(hullOf(g), inkMat());
    mesh.add(o);
  }
  return mesh;
}

// ── the rig ─────────────────────────────────────────────────────────────────
export interface CrewRig {
  /** Place this in the scene; feet at y = 0. */
  root: THREE.Group;
  look: CrewLook;
  setFacing(f: Facing4, snap?: boolean): void;
  limbs: { legs: THREE.Group[]; arms: THREE.Group[] };
  /** t in seconds, moving = walk cycle, else idle breathing. */
  update(t: number, dt: number, moving: boolean): void;
}

export function buildCrew(look: CrewLook): CrewRig {
  const suit = suitColor(look);
  const human = look.form === 'human';
  const root = new THREE.Group();
  root.name = `crew-${look.seat}-${look.form}`;
  const body = new THREE.Group(); // bobs
  root.add(body);

  // ground shadow (and the Parasite's aura under it)
  const shadow = part(root, geo('shadow', () => new THREE.CircleGeometry(0.62, 32)), flat(0x000000, 0.38), [0, 0.01, 0], [-Math.PI / 2, 0, 0], false, [1, 0.72, 1]);
  shadow.renderOrder = -1;
  shadow.name = 'shadow';
  if (look.form === 'parasite') {
    part(root, geo('aura', () => new THREE.PlaneGeometry(2.6, 2.6)), glowMat(TOXIC, 0.5), [0, 0.02, 0], [-Math.PI / 2, 0, 0], false);
  }

  // legs: pivot at the hip so the walk swings from there
  const lum = new THREE.Color(suit).getHSL({ h: 0, s: 0, l: 0 }).l;
  const limb = lum < 0.3 ? tone(suit, 0.14) : tone(suit, -0.32);
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.19, 0.66, 0);
    body.add(hip);
    part(hip, capsule(0.14, 0.28), toon(limb), [0, -0.22, 0]);
    part(hip, rbox(0.3, 0.2, 0.42, 0.09), toon(0x3b464d), [0, -0.52, 0.05]);
    legs.push(hip);
  }

  // torso
  const chest = new THREE.Group();
  body.add(chest);
  part(chest, capsule(0.42, 0.3), toon(suit), [0, 0.95, 0]);
  part(chest, torus(0.415, 0.055), toon(tone(suit, -0.5)), [0, 0.74, 0], [Math.PI / 2, 0, 0]);
  chestTrim(chest, look);
  part(chest, torus(0.3, 0.07), toon(0x9aa6ab), [0, 1.33, 0], [Math.PI / 2, 0, 0]);
  if (!human) veins(chest, look.form);

  // sample pack with the warm status lamp
  const pack = new THREE.Group();
  pack.position.set(0, 0.95, -0.44);
  chest.add(pack);
  part(pack, rbox(0.54, 0.52, 0.3, 0.1), toon(0x4a5658));
  part(pack, geo('lampdot', () => new THREE.CircleGeometry(0.075, 20)), flat(LAMP), [0, 0.04, -0.152], [0, Math.PI, 0], false);
  part(pack, geo('lampglow', () => new THREE.CircleGeometry(0.17, 20)), flat(LAMP, 0.28, true), [0, 0.04, -0.155], [0, Math.PI, 0], false);

  // arms: pivot at the shoulder; suit coloured like the 2D art, white gloves
  const arms: THREE.Group[] = [];
  const glove = look.form === 'parasite' ? 0x7c8a72 : 0xe9ecea;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.45, 1.15, 0);
    chest.add(sh);
    part(sh, sphere(0.17), toon(suit), [0, 0, 0], [0, 0, 0], false);
    part(sh, capsule(0.11, 0.3), toon(tone(suit, -0.12)), [s * 0.06, -0.24, 0.02], [0, 0, s * 0.16]);
    part(sh, sphere(0.135), toon(glove), [s * 0.11, -0.5, 0.04]);
    arms.push(sh);
  }

  // helmet
  const head = new THREE.Group();
  head.position.set(0, 1.76, 0);
  body.add(head);
  part(head, sphere(0.5), toon(suit));
  visor(head, look);
  accessory(head, chest, look, suit);

  // Parasite tendrils curling out of the pack
  const tendrils: THREE.Group[] = [];
  if (look.form === 'parasite') {
    const roots: [number, number, number][] = [[-0.22, 1, 0], [0.24, 1, 1.6], [-0.05, 1.12, 2.6]];
    for (const [x, d, ph] of roots) {
      const g = new THREE.Group();
      g.position.set(x, 0.12, -0.12);
      g.userData.ph = ph;
      g.userData.side = Math.sign(x) || 1;
      pack.add(g);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.sign(x) * 0.25 * d, 0.3, -0.25),
        new THREE.Vector3(Math.sign(x) * 0.5 * d, 0.75, -0.2),
        new THREE.Vector3(Math.sign(x) * 0.45 * d, 1.1, 0.05),
      ]);
      const tg = new THREE.TubeGeometry(curve, 24, 0.055, 8, false);
      part(g, tg, toon(TOXIC_DEEP));
      part(g, sphere(0.085), flat(TOXIC), curve.getPoint(1).toArray() as V3);
      part(g, sphere(0.2), flat(TOXIC, 0.25, true), curve.getPoint(1).toArray() as V3, [0, 0, 0], false);
      tendrils.push(g);
    }
  }

  let yaw = 0;
  let target = 0;
  let phase = 0;
  let walkW = 0;
  return {
    root,
    look,
    limbs: { legs, arms },
    setFacing(f, snap = false) {
      target = YAW[f];
      if (snap) yaw = target;
    },
    update(t, dt, moving) {
      // turn the short way round, fast but not instant
      let d = target - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 16);
      root.rotation.y = yaw;
      walkW += ((moving ? 1 : 0) - walkW) * Math.min(1, dt * 10);
      phase += dt * 9.5 * walkW;
      const sw = Math.sin(phase) * walkW;
      legs[0]!.rotation.x = sw * 0.62;
      legs[1]!.rotation.x = -sw * 0.62;
      arms[0]!.rotation.x = -sw * 0.55;
      arms[1]!.rotation.x = sw * 0.55;
      const breath = Math.sin(t * 2.3) * (1 - walkW);
      body.position.y = Math.abs(Math.sin(phase)) * 0.07 * walkW + breath * 0.012;
      chest.scale.set(1 + breath * 0.012, 1 + breath * 0.018, 1 + breath * 0.012);
      body.rotation.x = 0.07 * walkW; // lean into the walk
      shadow.scale.set(1 - Math.abs(sw) * 0.08, 0.72, 1);
      for (const g of tendrils) {
        const ph = g.userData.ph as number;
        g.rotation.z = Math.sin(t * 2.6 + ph) * 0.22 * (g.userData.side as number);
        g.rotation.x = Math.sin(t * 1.9 + ph) * 0.15;
      }
    },
  };
}

function visor(head: THREE.Group, look: CrewLook): void {
  const parasite = look.form === 'parasite';
  // frame and glass are concentric sphere patches, so their edges never z-fight
  const frame = geo('visorframe', () => new THREE.SphereGeometry(0.507, 40, 24, Math.PI * 0.13, Math.PI * 0.74, Math.PI * 0.29, Math.PI * 0.42));
  part(head, frame, flat(INK), [0, -0.02, 0], [0, 0, 0], false);
  const vg = geo('visor', () => new THREE.SphereGeometry(0.514, 40, 24, Math.PI * 0.16, Math.PI * 0.68, Math.PI * 0.32, Math.PI * 0.36));
  const glass = new THREE.MeshStandardMaterial({
    color: parasite ? 0x1b3a10 : 0x13242a,
    roughness: 0.15,
    metalness: 0.55,
  });
  part(head, vg, glass, [0, -0.02, 0], [0, 0, 0], false);
  if (look.form === 'human') {
    // the lab lamp caught in the glass, plus a white glint
    part(head, torus(0.4, 0.014, Math.PI * 0.4), flat(LAMP, 0.75), [0, 0.0, 0.27], [0.12, 0, Math.PI * 0.3], false);
    part(head, geo('glint', () => new THREE.CapsuleGeometry(0.028, 0.14, 4, 8)), flat(0xffffff, 0.9), [-0.2, 0.08, 0.46], [0.3, -0.4, 0.7], false);
  } else {
    // eyeshine behind the glass, and a lit crack
    const k = parasite ? 1 : 0.7;
    for (const x of [-0.13, 0.13]) {
      part(head, sphere(0.05), flat(TOXIC), [x, -0.02, 0.47], [0, 0, 0], false);
      part(head, sphere(0.12), flat(TOXIC, 0.3 * k, true), [x, -0.02, 0.45], [0, 0, 0], false);
    }
    const crack = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.2, 0.14, 0.45), new THREE.Vector3(0.12, 0.04, 0.48),
      new THREE.Vector3(0.18, -0.03, 0.48), new THREE.Vector3(0.08, -0.14, 0.46),
    ], false, 'catmullrom', 0);
    part(head, new THREE.TubeGeometry(crack, 12, 0.009, 4, false), flat(TOXIC, parasite ? 1 : 0.7), [0, 0, 0], [0, 0, 0], false);
  }
}

function chestTrim(chest: THREE.Group, look: CrewLook): void {
  const kind = ((look.skin % 4) + 4) % 4;
  const cream = toon(0xf4efe6);
  const z = 0.41;
  const tilt: V3 = [-0.12, 0, 0];
  if (kind === 0) {
    part(chest, rbox(0.3, 0.17, 0.05, 0.02), cream, [0, 1.04, z], tilt);
    part(chest, rbox(0.14, 0.035, 0.02, 0.01), flat(INK), [0, 1.04, z + 0.03], tilt, false);
  } else if (kind === 1) {
    part(chest, rbox(0.62, 0.07, 0.05, 0.02), cream, [0, 1.12, z - 0.04], tilt, false);
    part(chest, rbox(0.56, 0.04, 0.05, 0.015), cream, [0, 1.0, z - 0.02], tilt, false);
  } else if (kind === 2) {
    for (const s of [-1, 1]) part(chest, rbox(0.26, 0.08, 0.05, 0.02), cream, [s * 0.1, 1.05, z], [-0.12, 0, s * 0.55], false);
  } else {
    part(chest, cyl(0.05, 0.05, 0.04), cream, [0.16, 1.1, z - 0.01], [Math.PI / 2 - 0.12, 0, 0], false);
    part(chest, rbox(0.035, 0.42, 0.04, 0.012), cream, [0, 0.98, z + 0.01], tilt, false);
  }
}

function veins(chest: THREE.Group, form: Form): void {
  const m = flat(TOXIC, form === 'parasite' ? 0.9 : 0.55);
  const lines: V3[][] = [
    [[-0.22, 1.18, 0.37], [-0.12, 1.0, 0.41], [-0.18, 0.84, 0.39]],
    [[0.18, 1.2, 0.38], [0.1, 1.02, 0.42], [0.2, 0.82, 0.38]],
  ];
  for (const pts of lines) {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0);
    part(chest, new THREE.TubeGeometry(c, 10, 0.014, 4, false), m, [0, 0, 0], [0, 0, 0], false);
  }
}

function accessory(head: THREE.Group, chest: THREE.Group, look: CrewLook, suit: number): void {
  const a = ACCESSORIES[((look.seat % 10) + 10) % 10]!;
  const human = look.form === 'human';
  const metal = toon(0xb9c2c0);
  const dark = toon(0x27302f);
  switch (a) {
    case 'headlamp': {
      // band round the brow, a big housing on the front of the helmet
      part(head, band(0.512, 0.78, 0.13), dark, [0, 0, 0], [0.12, 0, 0], false);
      const lamp = new THREE.Group();
      lamp.position.set(0, 0.27, 0.43);
      lamp.rotation.x = 0.55;
      head.add(lamp);
      part(lamp, rbox(0.26, 0.17, 0.14, 0.05), toon(0xd7dcd8));
      part(lamp, geo('lens', () => new THREE.CircleGeometry(0.065, 20)), flat(LAMP), [0, 0, 0.072], [0, 0, 0], false);
      part(lamp, geo('lensglow', () => new THREE.CircleGeometry(0.2, 24)), flat(LAMP, 0.35, true), [0, 0, 0.08], [0, 0, 0], false);
      break;
    }
    case 'antenna': {
      const ant = new THREE.Group();
      ant.position.set(0.25, 0.4, -0.08);
      ant.rotation.set(-0.2, 0, -0.18);
      head.add(ant);
      part(ant, cyl(0.04, 0.04, 0.6), metal, [0, 0.3, 0]);
      part(ant, sphere(0.1), toon(human ? 0xff6b6b : TOXIC), [0, 0.64, 0]);
      break;
    }
    case 'fin': {
      const sh = new THREE.Shape();
      sh.moveTo(-0.3, 0);
      sh.quadraticCurveTo(-0.12, 0.42, 0.32, 0.36);
      sh.quadraticCurveTo(0.18, 0.18, 0.28, 0);
      sh.closePath();
      const g = geo('fin', () => new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }));
      // profile runs front to back over the crown
      part(head, g, toon(suit), [-0.04, 0.38, 0.05], [0, -Math.PI / 2, 0]);
      break;
    }
    case 'earpods': {
      for (const s of [-1, 1]) part(head, rbox(0.12, 0.26, 0.22, 0.05), toon(0x3a4547), [s * 0.5, 0, 0]);
      const boom = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.52, -0.08, 0.05), new THREE.Vector3(-0.48, -0.3, 0.25), new THREE.Vector3(-0.25, -0.38, 0.42),
      ]);
      part(head, new THREE.TubeGeometry(boom, 12, 0.022, 6, false), toon(0x3a4547));
      break;
    }
    case 'goggles': {
      part(head, band(0.512, 0.62, 0.11), dark, [0, 0, 0], [0.25, 0, 0], false);
      for (const x of [-0.15, 0.15]) {
        const gg = new THREE.Group();
        gg.position.set(x, 0.33, 0.37);
        gg.rotation.x = Math.PI / 2 - 0.75;
        head.add(gg);
        part(gg, cyl(0.12, 0.12, 0.1), toon(0xc9a25a));
        part(gg, geo('gogglens', () => new THREE.CircleGeometry(0.08, 20)), toon(0x1e3a40), [0, 0.052, 0], [-Math.PI / 2, 0, 0], false);
      }
      break;
    }
    case 'beanie': {
      const cap = geo('beanie', () => new THREE.SphereGeometry(0.53, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.36));
      part(head, cap, toon(0x3b4c74), [0, 0.02, 0]);
      part(head, band(0.545, Math.PI * 0.3, Math.PI * 0.07), toon(0x55679a), [0, 0.02, 0], [0, 0, 0], false);
      part(head, sphere(0.1), toon(0xe8e2d4), [0, 0.56, 0]);
      break;
    }
    case 'crest': {
      const col = human ? 0x7ff0ff : TOXIC;
      part(head, torus(0.53, 0.055, Math.PI * 0.8), flat(col), [0, 0, 0], [0, Math.PI / 2, Math.PI * 0.2]);
      part(head, torus(0.53, 0.14, Math.PI * 0.8), flat(col, 0.25, true), [0, 0, 0], [0, Math.PI / 2, Math.PI * 0.2], false);
      break;
    }
    case 'scarf': {
      const red = toon(0xc95b3c);
      part(chest, torus(0.33, 0.1), red, [0, 1.36, 0], [Math.PI / 2, 0, 0]);
      part(chest, rbox(0.17, 0.38, 0.07, 0.03), red, [-0.2, 1.12, 0.4], [-0.2, 0, 0.1]);
      break;
    }
    case 'dish': {
      const d = new THREE.Group();
      d.position.set(-0.3, 0.35, -0.05);
      d.rotation.z = 0.35;
      head.add(d);
      part(d, cyl(0.04, 0.04, 0.4), metal, [0, 0.2, 0]);
      const cup = geo('dish', () => new THREE.SphereGeometry(0.2, 20, 8, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38));
      const dm = toon(0xc9d1d0);
      dm.side = THREE.DoubleSide;
      part(d, cup, dm, [0, 0.52, 0], [0.5, 0, 0]);
      part(d, sphere(0.035), flat(human ? LAMP : TOXIC), [0, 0.42, 0.06], [0, 0, 0], false);
      break;
    }
    case 'hood': {
      // cloth hood over the back of the helmet, open at the face
      const hood = geo('hood', () => new THREE.SphereGeometry(0.58, 32, 20, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.85));
      const hm = toon(0x5f5446);
      hm.side = THREE.DoubleSide;
      part(head, hood, hm, [0, 0.02, -0.04]);
      part(head, torus(0.5, 0.05, Math.PI * 1.1), toon(0x3e372e), [0, 0.02, 0.1], [0, 0, -Math.PI * 0.05], false);
      break;
    }
  }
}

/**
 * A fallen crew member, lying on their back. Always human, whatever killed
 * them: an infected corpse would publish the victim's role to everyone.
 */
export function buildFallen(seat: number, skin: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `fallen-${seat}`;
  const rig = buildCrew({ seat, skin, form: 'human' });
  rig.update(0, 0, false);
  // sprawled: arms flung out, one knee bent
  rig.limbs.arms[0]!.rotation.z = -1.1;
  rig.limbs.arms[1]!.rotation.set(0.4, 0, 0.7);
  rig.limbs.legs[0]!.rotation.set(0.5, 0, -0.15);
  rig.limbs.legs[1]!.rotation.z = 0.2;
  const body = rig.root;
  body.getObjectByName('shadow')!.visible = false; // the stand-up shadow
  body.rotation.x = -Math.PI / 2; // on the back, head away from the feet
  body.position.set(0, 0.66, 1.15);
  body.scale.setScalar(1.12);
  const turn = new THREE.Group();
  turn.rotation.y = Math.PI / 2 + 0.2; // head to the left
  turn.add(body);
  g.add(turn);
  // a dark, irregular stain under the torso, deliberately not green
  const blot: [number, number, number][] = [[0, 0, 1], [-0.75, 0.15, 0.75], [0.75, -0.12, 0.8], [0.2, 0.55, 0.5], [-0.3, -0.55, 0.55], [1.5, 0.45, 0.2], [-1.55, -0.4, 0.16], [1.2, -0.6, 0.1]];
  for (const [x, z, r] of blot) {
    part(g, geo('stain', () => new THREE.CircleGeometry(1, 28)), flat(0x5a0d14), [x, 0.012, z], [-Math.PI / 2, 0, 0], false, [r, r, 1]);
  }
  return g;
}
