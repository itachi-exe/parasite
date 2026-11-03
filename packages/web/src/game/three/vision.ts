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
import { WORLD_WIDTH, WORLD_HEIGHT } from '@parasite/shared';
import { PX, toScene } from './outpost3d';

export { VISION, rayLength, reachAt, canSee } from '@parasite/shared';
import { VISION, rayLength, angDiff } from '@parasite/shared';

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
