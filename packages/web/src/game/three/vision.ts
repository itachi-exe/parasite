/**
 * Line of sight for the living: a facing cone plus a small ambient radius,
 * both stopped by walls. Walls are exactly the walkable boundary from
 * @parasite/shared (isWalkable), so sight never disagrees with collision.
 *
 * The visible region is drawn as a fan polygon into a top-down mask texture
 * (scene XZ), which post.ts VisionPass samples per pixel to sink the rest of
 * the frame into fog. The same rays answer "can I see that player / body".
 */
import * as THREE from 'three';
import { isWalkable, WORLD_WIDTH, WORLD_HEIGHT } from '@parasite/shared';
import { PX, toScene } from './outpost3d';

export const VISION = {
  /** Cone reach in world px. */
  range: 380,
  /** Always-visible radius around the player, still blocked by walls. */
  ambient: 78,
  /** Half the cone angle, and the angular blend at its edge (radians). */
  half: 0.72,
  soft: 0.2,
  /** Half width (radians) of the drawn cone edge in post.ts, inside the canSee blend so nobody stands lit but hidden. */
  edge: 0.09,
  rays: 256,
  /** Rays continue this far past the hit, so the face of the wall reads. */
  pad: 14,
};

/** Distance a ray from (x, y) travels before leaving the walkable region. */
export function rayLength(x: number, y: number, ang: number, max: number): number {
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const STEP = 8;
  for (let s = STEP; s <= max; s += STEP) {
    if (isWalkable(x + cx * s, y + cy * s)) continue;
    let lo = s - STEP, hi = s;
    for (let i = 0; i < 3; i++) {
      const m = (lo + hi) / 2;
      if (isWalkable(x + cx * m, y + cy * m)) lo = m;
      else hi = m;
    }
    return lo;
  }
  return max;
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Reach of sight at a bearing: full range inside the cone, ambient outside, smooth between. */
export function reachAt(ang: number, look: number): number {
  const d = Math.abs(angDiff(ang, look));
  const k = 1 - THREE.MathUtils.smoothstep(d, VISION.half - VISION.soft, VISION.half + VISION.soft);
  return VISION.ambient + (VISION.range - VISION.ambient) * k;
}

/** Can a viewer at (ax, ay) looking along `look` see the point (bx, by)? */
export function canSee(ax: number, ay: number, look: number, bx: number, by: number, slack = 0): boolean {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const ang = Math.atan2(dy, dx);
  if (d > reachAt(ang, look) + slack) return false;
  return rayLength(ax, ay, ang, d) >= d - 2;
}

// mask covers the world plus the jungle margin the outpost draws
const MARGIN = 300;
const MIN_X = -WORLD_WIDTH / 2 / PX - MARGIN / PX;
const MIN_Z = -WORLD_HEIGHT / 2 / PX - MARGIN / PX;
const SIZE_X = (WORLD_WIDTH + MARGIN * 2) / PX;
const SIZE_Z = (WORLD_HEIGHT + MARGIN * 2) / PX;

export class VisionMask {
  readonly target = new THREE.WebGLRenderTarget(512, 384, { depthBuffer: false });
  /** minX, minZ, sizeX, sizeZ of the mask in scene units. */
  readonly rect = new THREE.Vector4(MIN_X, MIN_Z, SIZE_X, SIZE_Z);
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(MIN_X, MIN_X + SIZE_X, MIN_Z + SIZE_Z, MIN_Z, -1, 1);
  private pos: Float32Array;
  private fan: THREE.BufferGeometry;

  constructor() {
    const n = VISION.rays;
    this.pos = new Float32Array((n + 1) * 3);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
    this.fan = new THREE.BufferGeometry();
    this.fan.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.fan.setIndex(idx);
    const mesh = new THREE.Mesh(this.fan, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.scene.background = new THREE.Color(0x000000);
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    // the mask camera looks down -z with +y = scene +z, so a vertex (x, z, 0) maps straight through
    this.cam.position.set(0, 0, 0.5);
  }

  /** Rebuild the sight polygon for a viewer at world (x, y) looking along `look`. */
  update(r: THREE.WebGLRenderer, x: number, y: number, look: number): void {
    const n = VISION.rays;
    const c = toScene(x, y);
    this.pos[0] = c.x;
    this.pos[1] = c.z;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // occlusion only: post.ts draws the cone's falloff and rim, so the polygon needs no soft shoulder
      const reach = Math.abs(angDiff(a, look)) < VISION.half + VISION.edge + 0.1 ? VISION.range : VISION.ambient;
      const len = Math.min(reach, rayLength(x, y, a, reach) + VISION.pad);
      this.pos[3 + i * 3] = (x + Math.cos(a) * len - WORLD_WIDTH / 2) / PX;
      this.pos[4 + i * 3] = (y + Math.sin(a) * len - WORLD_HEIGHT / 2) / PX;
    }
    (this.fan.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.fan.dispose();
  }
}
