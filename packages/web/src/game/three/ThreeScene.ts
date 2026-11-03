/**
 * The game renderer: one three.js scene drawing the live game state.
 *
 * A dumb renderer like the Phaser scene it replaces: it owns no rules. It draws
 * the last server snapshot, predicts only the local player (same speed and the
 * same resolveMove the server enforces), and reports input through the bridge.
 *
 * Name plates and the touch stick are DOM, not WebGL: crisp text at any DPR,
 * and they keep the site's type instead of a canvas font.
 */
import * as THREE from 'three';
import {
  TASK_STATIONS,
  TASK_IDS,
  PLAYER_SPEED,
  resolveMove,
  isWalkable,
  type PublicPlayer,
  type Seat,
  type TaskId,
} from '@parasite/shared';
import type { SceneBridge } from '../bridge';
import { buildCrew, buildFallen, glowMat, geo, type CrewRig, type Facing4 } from './crew3d';
import { buildOutpost, addNightLights, toScene } from './outpost3d';
import { setupRenderer, setupEnvironment, makePost, type Post } from './post';
import { VisionMask, VISION, canSee, rayLength } from './vision';

/** Interpolated motion below this (px per frame) is 20Hz noise, not a turn. */
const TURN_DEADZONE = 0.35;
/** Half-height of the view in scene units at a landscape aspect. */
const VIEW = 6.3;
/** Camera offset from the look point: about 34 degrees down, low enough to feel present, not a map view. */
const CAM_UP = 10;
const CAM_BACK = 14.8;
/** Corpses render at least this far (px) from a wall so props never swallow them. */
const BODY_INSET = 20;
const STICK_R = 54;
const STATION_REACH = 56;

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

function typingInAField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Facing from the motion actually drawn this frame; holds through the deadzone. */
export function resolveFacing4(dx: number, dy: number, prev: Facing4): Facing4 {
  if (Math.hypot(dx, dy) < TURN_DEADZONE) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

interface Vis {
  rig: CrewRig;
  key: string;
  tag: HTMLDivElement;
  x: number;
  y: number;
  facing: Facing4;
}

/** A dead player's own view of themself: a translucent copy, own materials. */
function ghostify(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.Material).clone();
    mat.transparent = true;
    mat.opacity = Math.min(mat.opacity, 0.32);
    mat.depthWrite = false;
    m.material = mat;
    m.castShadow = false;
  });
}

/** Pull a point away from nearby walls along the four axes. */
function inset(x: number, y: number): { x: number; y: number } {
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const free = rayLength(x, y, a, BODY_INSET);
    if (free < BODY_INSET && isWalkable(x - Math.cos(a) * (BODY_INSET - free), y - Math.sin(a) * (BODY_INSET - free))) {
      x -= Math.cos(a) * (BODY_INSET - free);
      y -= Math.sin(a) * (BODY_INSET - free);
    }
  }
  return { x, y };
}

export class ThreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.OrthographicCamera;
  private post: Post;
  private outpost = buildOutpost();
  private overlay: HTMLDivElement;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  private people = new Map<Seat, Vis>();
  private bodies = new Map<Seat, THREE.Group>();
  private stations = new Map<TaskId, { ring: THREE.Mesh; glow: THREE.Mesh }>();
  private playerLight = new THREE.PointLight(0xffe2b8, 2.2, 7, 2);
  private keys = new Set<string>();
  private stick = { id: null as number | null, ox: 0, oy: 0, ax: 0, ay: 0 };
  private lastSent = { ax: 0, ay: 0, at: 0 };
  private predicted: { x: number; y: number } | null = null;
  private vision = new VisionMask();
  /** Where my sight cone points, world radians (0 = +x, PI/2 = down the screen). */
  private look = Math.PI / 2;
  private lookFrom: { x: number; y: number } | null = null;
  private camAt = new THREE.Vector3();
  private camReady = false;
  private raf = 0;
  private last = 0;
  private t0 = 0;
  private still = reducedMotion();
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private off: (() => void)[] = [];

  constructor(private host: HTMLElement, private bridge: SceneBridge) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.overflow = 'hidden';
    host.style.touchAction = 'none';

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    setupRenderer(this.renderer);
    this.renderer.domElement.style.display = 'block';
    host.appendChild(this.renderer.domElement);

    setupEnvironment(this.renderer, this.scene);
    addNightLights(this.scene);
    this.scene.add(this.outpost.root);
    this.playerLight.castShadow = false;
    this.scene.add(this.playerLight);
    this.buildStations();

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.w = host.clientWidth || 1280;
    this.h = host.clientHeight || 720;
    this.post = makePost(this.renderer, this.scene, this.cam, this.w, this.h, 0.5);
    this.resize();

    this.overlay = document.createElement('div');
    this.overlay.className = 'stage-tags';
    this.overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(this.overlay);
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stage-stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'stage-stick-knob';
    this.stickEl.appendChild(this.knobEl);
    host.appendChild(this.stickEl);

    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.t0 = performance.now();
    this.last = this.t0;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.off) f();
    for (const v of this.people.values()) v.tag.remove();
    this.overlay.remove();
    this.stickEl.remove();
    this.post.composer.dispose();
    this.vision.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ── setup ────────────────────────────────────────────────────────────────
  private buildStations(): void {
    for (const id of TASK_IDS) {
      const st = TASK_STATIONS[id];
      const p = toScene(st.x, st.y);
      const ring = new THREE.Mesh(
        geo('station-ring', () => new THREE.RingGeometry(2.55, 2.75, 64)),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7ff0ff), transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      // ring radius ≈ STATION_REACH in scene units: it marks where E works
      ring.position.set(p.x, 0.04, p.z);
      const glow = new THREE.Mesh(geo('station-glow', () => new THREE.RingGeometry(1.6, 2.75, 64)), glowMat(0x5fd6c8, 0.18));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(p.x, 0.035, p.z);
      this.scene.add(ring, glow);
      this.stations.set(id, { ring, glow });
    }
  }

  private resize = (): void => {
    const w = this.host.clientWidth || 1280;
    const h = this.host.clientHeight || 720;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.post.setSize(w, h);
    // Narrow screens pull back so a portrait phone still sees the room.
    const aspect = w / h;
    const v = aspect < 1.3 ? Math.min(16, (VIEW * 1.3) / aspect) : VIEW;
    this.cam.left = -v * aspect;
    this.cam.right = v * aspect;
    this.cam.top = v;
    this.cam.bottom = -v;
    this.cam.updateProjectionMatrix();
  };

  private bindInput(): void {
    const on = (t: EventTarget, ev: string, fn: (e: never) => void) => {
      t.addEventListener(ev, fn as EventListener, { passive: false });
      this.off.push(() => t.removeEventListener(ev, fn as EventListener));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (typingInAField()) return;
      this.keys.add(e.code);
      if (ARROWS.has(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());

    const el = this.renderer.domElement;
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null;
      this.stick.ax = this.stick.ay = 0;
      this.stickEl.classList.remove('on');
    };
    on(el, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || this.stick.id !== null) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x > r.width * 0.55) return;
      this.stick = { id: e.pointerId, ox: x, oy: y, ax: 0, ay: 0 };
      el.setPointerCapture(e.pointerId);
      this.stickEl.style.transform = `translate(${x - STICK_R}px, ${y - STICK_R}px)`;
      this.knobEl.style.transform = 'translate(0px, 0px)';
      this.stickEl.classList.add('on');
    });
    on(el, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left - this.stick.ox;
      const dy = e.clientY - r.top - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len < 8) {
        this.stick.ax = this.stick.ay = 0;
        this.knobEl.style.transform = 'translate(0px, 0px)';
        return;
      }
      const k = Math.min(1, len / STICK_R);
      this.stick.ax = (dx / len) * k;
      this.stick.ay = (dy / len) * k;
      const c = Math.min(len, STICK_R);
      this.knobEl.style.transform = `translate(${(dx / len) * c}px, ${(dy / len) * c}px)`;
    });
    on(el, 'pointerup', release);
    on(el, 'pointercancel', release);
  }

  // ── per frame ────────────────────────────────────────────────────────────
  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.step(t, dt);
    this.post.render();
  };

  private readInput(): [number, number] {
    const b = this.bridge;
    if (b.frozen || typingInAField()) {
      if (this.stick.id !== null) {
        this.stick.id = null;
        this.stickEl.classList.remove('on');
      }
      return [0, 0];
    }
    const k = this.keys;
    let ax = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let ay = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const len = Math.hypot(ax, ay);
    if (len > 0) {
      ax /= len;
      ay /= len;
    }
    // Stick wins while held; never summed, or a touch laptop walks double speed.
    if (this.stick.id !== null && (this.stick.ax || this.stick.ay)) return [this.stick.ax, this.stick.ay];
    return [ax, ay];
  }

  /** Advance one frame. Public so the headless preview can drive it. */
  step(t: number, dt: number): void {
    const b = this.bridge;
    const [ax, ay] = this.readInput();
    const nowMs = t * 1000;
    if (ax !== this.lastSent.ax || ay !== this.lastSent.ay || (nowMs - this.lastSent.at > 120 && (ax || ay))) {
      b.onInput(ax, ay);
      this.lastSent = { ax, ay, at: nowMs };
    }

    const players = b.players.map((p) => {
      const live = b.positions.get(p.seat);
      return live ? { ...p, ...live } : p;
    });
    const seen = new Set<Seat>();
    let me: PublicPlayer | null = null;

    for (let p of players) {
      const isMe = p.seat === b.mySeat;
      // The dead are invisible to the living; a ghost still sees itself.
      if (!p.alive && !isMe) continue;
      seen.add(p.seat);

      if (isMe) {
        p = this.predict(p, ax, ay, dt);
        me = p;
      }
      // Reveal art only on my own model, only once I know my role.
      const form = isMe && b.isParasite && p.alive ? 'parasite' : 'human';
      const key = `${form}:${p.alive ? 1 : 0}:${p.skin}`;
      let v = this.people.get(p.seat);
      if (v && v.key !== key) {
        this.scene.remove(v.rig.root);
        v.tag.remove();
        v = undefined;
      }
      if (!v) {
        const rig = buildCrew({ seat: p.seat, skin: p.skin, form });
        if (!p.alive) ghostify(rig.root);
        const tag = document.createElement('div');
        tag.className = 'stage-tag';
        tag.style.transition = 'opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
        this.overlay.appendChild(tag);
        v = { rig, key, tag, x: p.x, y: p.y, facing: 'down' };
        rig.setFacing('down', true);
        // start unseen: applySight reveals it this frame, so the edge slack never grants a free first look
        rig.root.visible = isMe;
        this.scene.add(rig.root);
        this.people.set(p.seat, v);
      }
      if (v.tag.textContent !== p.name) v.tag.textContent = p.name;
      v.tag.classList.toggle('me', isMe);
      v.tag.classList.toggle('away', !p.connected);

      // Own model sits at the predicted spot; everyone else eases toward 20Hz data.
      const k = isMe ? 1 : Math.min(1, dt * 14);
      const x = v.x + (p.x - v.x) * k;
      const y = v.y + (p.y - v.y) * k;
      const f = resolveFacing4(x - v.x, y - v.y, v.facing);
      if (f !== v.facing) {
        v.facing = f;
        v.rig.setFacing(f);
      }
      v.x = x;
      v.y = y;
      v.rig.root.position.copy(toScene(x, y));
      v.rig.update(t, dt, p.moving && p.alive);
    }
    for (const [seat, v] of this.people) {
      if (seen.has(seat)) continue;
      this.scene.remove(v.rig.root);
      v.tag.remove();
      this.people.delete(seat);
    }

    this.syncBodies(players);
    this.applySight(me, dt);
    this.outpost.update(this.still ? 2 : t);
    this.updateStations(me, t);
    this.updateCamera(me, dt);
    this.placeTags();
  }

  private predict(p: PublicPlayer, ax: number, ay: number, dt: number): PublicPlayer {
    if (!this.predicted) this.predicted = { x: p.x, y: p.y };
    const pr = this.predicted;
    if (!this.bridge.frozen && (ax || ay)) {
      const s = PLAYER_SPEED * dt;
      const m = resolveMove(pr.x, pr.y, pr.x + ax * s, pr.y + ay * s);
      pr.x = m.x;
      pr.y = m.y;
    }
    // Big disagreement (purge teleport, respawn): snap. Small: ease, no rubber band.
    if (Math.hypot(pr.x - p.x, pr.y - p.y) > 90) {
      pr.x = p.x;
      pr.y = p.y;
    } else {
      const k = Math.min(1, dt * 3);
      pr.x += (p.x - pr.x) * k;
      pr.y += (p.y - pr.y) * k;
    }
    return { ...p, x: pr.x, y: pr.y };
  }

  private syncBodies(players: PublicPlayer[]): void {
    const seen = new Set<Seat>();
    const skin = new Map(players.map((p) => [p.seat, p.skin]));
    for (const body of this.bridge.bodies) {
      seen.add(body.seat);
      if (this.bodies.has(body.seat)) continue;
      // Corpses always render human: an infected corpse would publish the role.
      const g = buildFallen(body.seat, skin.get(body.seat) ?? 0);
      const at = inset(body.x, body.y);
      g.position.copy(toScene(at.x, at.y));
      g.userData.at = at;
      g.visible = false;
      this.scene.add(g);
      this.bodies.set(body.seat, g);
    }
    for (const [seat, g] of this.bodies) {
      if (seen.has(seat)) continue;
      this.scene.remove(g);
      this.bodies.delete(seat);
    }
  }

  /**
   * The living see a cone along their walk direction plus a small ring around
   * them, both cut by walls; other crew, corpses and their plates outside it
   * vanish. Ghosts and spectators see everything.
   */
  private applySight(me: PublicPlayer | null, dt: number): void {
    const on = !!me && me.alive;
    this.post.vision.enabled = on;
    if (!me || !on) {
      this.lookFrom = null;
      for (const v of this.people.values()) this.showVis(v, true);
      for (const g of this.bodies.values()) g.visible = true;
      return;
    }
    if (!this.lookFrom) this.lookFrom = { x: me.x, y: me.y };
    const dx = me.x - this.lookFrom.x, dy = me.y - this.lookFrom.y;
    if (Math.hypot(dx, dy) > 0.4) {
      const want = Math.atan2(dy, dx);
      let d = (want - this.look) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.look += d * Math.min(1, dt * 9);
    }
    this.lookFrom = { x: me.x, y: me.y };

    for (const [seat, v] of this.people) {
      // a little slack once seen, so a crewmate on the cone edge does not blink
      if (seat !== this.bridge.mySeat) this.showVis(v, canSee(me.x, me.y, this.look, v.x, v.y, v.rig.root.visible ? 24 : 0));
    }
    for (const g of this.bodies.values()) {
      const at = g.userData.at as { x: number; y: number };
      g.visible = canSee(me.x, me.y, this.look, at.x, at.y, g.visible ? 24 : 0);
    }

    this.vision.update(this.renderer, me.x, me.y, this.look);
    const u = this.post.vision.uniforms;
    u.tMask.value = this.vision.target.texture;
    u.uRect.value.copy(this.vision.rect);
    const c = toScene(me.x, me.y);
    u.uMe.value.set(c.x, c.z);
    u.uRange.value = VISION.range / 18;
  }

  private showVis(v: Vis, on: boolean): void {
    v.rig.root.visible = on;
    const o = on ? '' : '0';
    if (v.tag.style.opacity !== o) v.tag.style.opacity = o;
  }

  private updateStations(me: { x: number; y: number } | null, t: number): void {
    const b = this.bridge;
    const pulse = this.still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.4);
    for (const [id, s] of this.stations) {
      const mine = b.myTasks.includes(id) && !b.doneTasks.includes(id) && !b.isParasite;
      const st = TASK_STATIONS[id];
      const near = !!me && mine && Math.hypot(me.x - st.x, me.y - st.y) <= STATION_REACH;
      s.ring.visible = s.glow.visible = mine;
      const sc = near ? 1.12 : 1;
      s.ring.scale.setScalar(sc);
      (s.ring.material as THREE.MeshBasicMaterial).opacity = near ? 0.85 : 0.3 + 0.25 * pulse;
      (s.glow.material as THREE.MeshBasicMaterial).opacity = near ? 0.28 : 0.08 + 0.08 * pulse;
    }
  }

  private updateCamera(me: { x: number; y: number } | null, dt: number): void {
    const target = me ? toScene(me.x, me.y) : this.camReady ? this.camAt.clone() : toScene(800, 600);
    if (!this.camReady) {
      this.camAt.copy(target);
      this.camReady = true;
    } else {
      this.camAt.lerp(target, Math.min(1, dt * 7));
    }
    const c = this.camAt;
    this.cam.position.set(c.x, CAM_UP + 0.6, c.z + 0.5 + CAM_BACK);
    this.cam.lookAt(c.x, 0.6, c.z + 0.5);
    this.cam.updateMatrixWorld();
    if (me) {
      const p = toScene(me.x, me.y);
      this.playerLight.position.set(p.x, 3.2, p.z + 0.6);
    }
  }

  private v3 = new THREE.Vector3();
  private placeTags(): void {
    for (const v of this.people.values()) {
      this.v3.copy(v.rig.root.position);
      this.v3.y += 2.75;
      this.v3.project(this.cam);
      const x = (this.v3.x * 0.5 + 0.5) * this.w;
      const y = (-this.v3.y * 0.5 + 0.5) * this.h;
      v.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
