// Namespace import, not a default import: Phaser's ESM build (dist/phaser.esm.js,
// which is what bundlers pick up via the `module` field) exposes named exports
// only and has NO default export. `import Phaser from 'phaser'` typechecks —
// the .d.ts uses `export = Phaser` and esModuleInterop papers over it — but
// resolves to `undefined` at runtime and throws on `new Phaser.Game`.
import * as Phaser from 'phaser';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  ROOMS,
  TASK_STATIONS,
  TASK_LABELS,
  TASK_IDS,
  PLAYER_RADIUS,
  JUMP_RANGE,
  type PublicPlayer,
  type TaskId,
  type Seat,
} from '@parasite/shared';
import {
  PhaserPen,
  bakePlayableSkins,
  ensureSkin,
  ensureInfected,
  ensureParasite,
  ensureCorpse,
  walkAnim,
  frameKey,
  ORIGIN_Y,
  CELL_W,
  CELL_H,
  type Variant,
  type Facing,
} from './art/phaserPen';
import { drawOutpost } from './art/mapArt';
import { THEMES } from './art/palette';

export interface SceneBridge {
  /** Latest authoritative snapshot from the server. */
  players: PublicPlayer[];
  /**
   * Live positions from the server's high-frequency channel, keyed by seat.
   * Mutated in place by the socket layer — read fresh every Phaser frame here
   * rather than merged in React, since a ref mutation does not trigger a
   * React re-render and `players` above may go stale between full snapshots.
   */
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>;
  bodies: { seat: Seat; x: number; y: number }[];
  mySeat: Seat | null;
  /** Local player's own role, if they have revealed it to themselves. */
  isParasite: boolean;
  /** Which of my tasks remain. */
  myTasks: TaskId[];
  doneTasks: TaskId[];
  /** True while a meeting or the end screen is up — input is frozen. */
  frozen: boolean;
  onInput: (ax: number, ay: number) => void;
  /** Called every frame with what the player could interact with right now. */
  onContext: (ctx: {
    taskInRange: TaskId | null;
    jumpTargets: { seat: Seat; name: string }[];
    bodyInRange: Seat | null;
  }) => void;
}

/**
 * Everything the renderer keeps per player, on top of what the server sends.
 *
 * `facing` and `from*` exist because facing is a *view* concern the wire
 * protocol has no field for — see `resolveFacing`.
 */
interface Vis {
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.Text;
  /** Which baked variant is currently on the sprite. */
  variant: Variant;
  facing: Facing;
  /** Last drawn position, used to infer which way the character is walking. */
  fromX: number;
  fromY: number;
}

/**
 * How far a player must move in a frame before the sprite turns.
 *
 * Positions arrive at 20Hz and are then interpolated, so the per-frame delta on
 * a standing player is not exactly zero. Below this it is noise, and honouring
 * it makes an idle character twitch between facings.
 */
const TURN_DEADZONE = 0.35;

/**
 * How much more vertical than horizontal the motion has to be to switch to a
 * front/back view. Diagonal movement is drawn as a side view because the side
 * view is the most legible of the three, and biasing towards it stops a
 * diagonal walk from flickering between two facings on every frame.
 */
const VERTICAL_BIAS = 1.6;

/**
 * Whether the player has asked the OS for less motion.
 *
 * Read at scene construction rather than cached at module scope so a scene
 * rebuilt after the user flips the setting picks up the new value. Guarded for
 * `matchMedia` because the scene module is imported dynamically and must not
 * assume a browser that has it.
 */
/**
 * Whether a DOM text field currently has focus.
 *
 * The canvas and the HTML chrome share one keyboard, so without this a player
 * typing a name would also walk across the map behind the dialog.
 */
function typingInAField(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The Phaser layer.
 *
 * Deliberately a *dumb renderer*: it owns no game rules. It draws whatever
 * snapshot the server last sent and reports intent back through `bridge`.
 * Local prediction is limited to the player's own sprite so that walking feels
 * responsive at 20Hz without ever letting the client disagree with the server
 * about where anyone actually is.
 */
export class MainScene extends Phaser.Scene {
  private bridge!: SceneBridge;
  private people = new Map<Seat, Vis>();
  private bodySprites = new Map<Seat, Phaser.GameObjects.Container>();
  private stationMarks = new Map<TaskId, Phaser.GameObjects.Container>();
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private lastSent = { ax: 0, ay: 0, at: 0 };

  constructor() {
    super('main');
  }

  init(data: { bridge: SceneBridge }) {
    this.bridge = data.bridge;
  }

  /**
   * Pull the camera in on the player.
   *
   * The view was drawn at 1:1, which put a 64x76 character on a 1280px-wide
   * screen at roughly 5% of its height — technically the proportion the
   * reference uses, but the reference is doing it with hand-illustrated art
   * that still holds up small. Ours is drawn from primitives and simply loses
   * its detail at that size, so the camera moves closer instead.
   *
   * Scaled against a 1280x800 baseline rather than pinned to a constant: at a
   * fixed zoom a phone in portrait would see almost nothing of the room, and
   * the whole point of a social-deduction map is watching who walks where.
   * Clamped so a very wide monitor cannot pull so far back that it undoes this.
   */
  private applyZoom = () => {
    const cam = this.cameras.main;
    const w = this.scale.gameSize.width || 1280;
    const h = this.scale.gameSize.height || 800;
    const fit = Math.min(w / 1280, h / 800);
    cam.setZoom(Math.max(1.35, Math.min(2.1, 1.75 * fit)));
  };

  /**
   * Virtual thumbstick state.
   *
   * The game shipped keyboard-only, which makes it unplayable on the device
   * most people will actually open a hackathon link on. This is a floating
   * stick rather than a fixed one: it appears wherever the thumb lands, which
   * is what keeps it usable on both a 430px phone and a tablet without
   * guessing where the hand is.
   */
  private stick: {
    id: number | null;
    ox: number;
    oy: number;
    ax: number;
    ay: number;
    gfx?: Phaser.GameObjects.Graphics;
  } = { id: null, ox: 0, oy: 0, ax: 0, ay: 0 };

  /** Max thumb travel, in screen px, before the stick reads as fully deflected. */
  private static readonly STICK_R = 54;


  /**
   * Floating thumbstick.
   *
   * Only the left half of the screen arms it, so a thumb reaching for the
   * action buttons on the right never starts a drag. The stick is drawn in
   * screen space (setScrollFactor(0)) because it belongs to the hand, not to
   * the world the camera is panning over.
   */
  private setupTouch(): void {
    const gfx = this.add.graphics().setDepth(9000).setScrollFactor(0).setVisible(false);
    this.stick.gfx = gfx;

    this.input.addPointer(2);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.stick.id !== null) return;
      if (p.x > this.scale.gameSize.width * 0.55) return;
      this.stick.id = p.id;
      this.stick.ox = p.x;
      this.stick.oy = p.y;
      this.stick.ax = 0;
      this.stick.ay = 0;
      gfx.setVisible(true);
      this.drawStick(p.x, p.y);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.stick.id) return;
      const dx = p.x - this.stick.ox;
      const dy = p.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const R = MainScene.STICK_R;
      // A small deadzone: a resting thumb drifts, and without one the character
      // creeps while the player thinks they are standing still.
      if (len < 8) {
        this.stick.ax = 0;
        this.stick.ay = 0;
        this.drawStick(this.stick.ox, this.stick.oy);
        return;
      }
      const k = Math.min(1, len / R);
      this.stick.ax = (dx / len) * k;
      this.stick.ay = (dy / len) * k;
      const clamped = Math.min(len, R);
      this.drawStick(this.stick.ox + (dx / len) * clamped, this.stick.oy + (dy / len) * clamped);
    });

    const release = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.stick.id) return;
      this.stick.id = null;
      this.stick.ax = 0;
      this.stick.ay = 0;
      gfx.setVisible(false);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    // A pointer lost to a system gesture never fires pointerup, and the stick
    // would stay latched with the player walking into a wall forever.
    this.input.on('gameout', () => {
      this.stick.id = null;
      this.stick.ax = 0;
      this.stick.ay = 0;
      gfx.setVisible(false);
    });
  }

  private drawStick(tx: number, ty: number): void {
    const g = this.stick.gfx;
    if (!g) return;
    const R = MainScene.STICK_R;
    g.clear();
    g.fillStyle(0x0a0e13, 0.5);
    g.fillCircle(this.stick.ox, this.stick.oy, R);
    g.lineStyle(3, 0x4ad9f0, 0.5);
    g.strokeCircle(this.stick.ox, this.stick.oy, R);
    g.fillStyle(0x4ad9f0, 0.85);
    g.fillCircle(tx, ty, 22);
    g.lineStyle(3, 0x05090c, 0.9);
    g.strokeCircle(tx, ty, 22);
  }

  create() {
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBackgroundColor('#04130f');
    this.applyZoom();
    // RESIZE scale mode means the camera viewport follows the window, so the
    // zoom has to be recomputed when it changes or a phone rotation leaves the
    // view either cropped or showing far more map than intended.
    this.scale.on('resize', this.applyZoom, this);

    // No preload(): there are no image files. Every sprite in this game is baked
    // from drawing primitives at boot, which is why the loader is empty and the
    // scene can start drawing immediately.
    bakePlayableSkins(this);

    this.drawMap();
    this.drawStations();

    const kb = this.input.keyboard!;
    // The `false` is the whole point: it is addKey's `enableCapture` flag.
    // Left at its default, Phaser calls preventDefault() on these keys
    // globally, and W/A/S/D never reached a focused text field — a player
    // could not type those letters into their own name. "Solo" arrived as
    // "olo", "Okafor" as "Okfor". The game polls `isDown`, so it needs the
    // key state, not the capture, and the page does not scroll.
    this.keys = {
      W: kb.addKey('W', false),
      A: kb.addKey('A', false),
      S: kb.addKey('S', false),
      D: kb.addKey('D', false),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT, false),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false),
    };

    /*
     * Stop Phaser calling preventDefault() on W/A/S/D and the arrows.
     *
     * Passing `false` to addKey above is not sufficient on its own: the
     * KeyboardManager keeps its own capture list and its own `preventDefault`
     * flag, and that is what was actually swallowing the keys. Until this,
     * a player could not type W, A, S or D into their own name or the outpost
     * code — "Solo" arrived as "olo", "Okafor" as "Okfor", and every dropped
     * character was one of those four.
     *
     * The game polls `isDown` each frame, so it needs the key *state*, never
     * the capture. Nothing else relied on it: html/body are overflow:hidden,
     * so the arrows have no page scroll to suppress.
     */
    kb.clearCaptures();
    kb.manager.clearCaptures();
    kb.manager.preventDefault = false;

    this.setupTouch();

    // Stop WASD/arrows from scrolling the page behind the canvas.
    kb.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
  }

  /**
   * The outpost, baked once into a single texture.
   *
   * `drawOutpost` emits a few thousand primitives — jungle, foliage, floors,
   * walls, props, lamps. Replaying that every frame would be absurd, so it is
   * rendered into one texture at boot and the map costs exactly one draw call
   * from then on. The whole thing is seeded, so every client bakes an identical
   * image (see mapArt.ts).
   */
  private drawMap() {
    const KEY = 'outpost';
    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({}, false);
      drawOutpost(new PhaserPen(g, 1), {
        slabs: ROOMS,
        themes: THEMES,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        seed: 1337,
      });
      g.generateTexture(KEY, MAP_WIDTH, MAP_HEIGHT);
      g.destroy();
    }
    this.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(0);

    // Room names stay live text rather than being baked in, so they keep the
    // HUD's font and can be tinted per area.
    for (const room of ROOMS) {
      if (room.kind === 'path') continue;
      this.add
        .text(room.x + room.w / 2, room.y + 15, room.name.toUpperCase(), {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: THEMES[room.area]?.label ?? '#8ffce0',
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.7)
        .setDepth(1);
    }
  }

  private drawStations() {
    for (const id of TASK_IDS) {
      const st = TASK_STATIONS[id];
      const c = this.add.container(st.x, st.y).setDepth(2);

      const glow = this.add.circle(0, 0, 26, 0x2ef2b0, 0.16);
      const pad = this.add.circle(0, 0, 15, 0x0d2f24, 1).setStrokeStyle(2.5, 0x3affc0, 0.95);
      const icon = this.add
        .text(0, 0, '✦', { fontFamily: 'monospace', fontSize: '17px', color: '#c8fff0' })
        .setOrigin(0.5);
      const label = this.add
        .text(0, 30, TASK_LABELS[id], {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#9dffe4',
          backgroundColor: '#04130fcc',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5, 0);

      c.add([glow, pad, icon, label]);
      this.stationMarks.set(id, c);

      // The pulse marks where a task is, so it is wayfinding rather than
      // decoration — but it also runs forever on five markers at once, which is
      // exactly what prefers-reduced-motion is for. Hold the glow at its mid
      // value instead of animating; the marker still reads as a station.
      if (prefersReducedMotion()) {
        glow.setScale(1.05).setAlpha(0.19);
      } else {
        this.tweens.add({
          targets: glow,
          scale: { from: 0.85, to: 1.25 },
          alpha: { from: 0.1, to: 0.28 },
          duration: 1500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      }
    }
  }

  /**
   * Per-seat view state.
   *
   * Facing and the walk cycle are derived here, on the client, from data the
   * server already sends. See `resolveFacing`.
   */
  private visFor(p: PublicPlayer): Vis {
    const found = this.people.get(p.seat);
    if (found) return found;

    const c = this.add.container(p.x, p.y).setDepth(10);

    // The shadow is the collision circle seen in perspective — same radius the
    // server enforces, so what you can walk into matches what you can see.
    const shadow = this.add.ellipse(0, 1, PLAYER_RADIUS * 2, 12, 0x000000, 0.38);

    const variant = ensureSkin(this, p.skin);
    const body = this.add.sprite(0, 0, frameKey(variant, 'down', 0));
    // Origin on the feet, not the middle: the character then stands *at* the
    // position the server reports, and depth sorting by y puts whoever is
    // further down the screen in front, as it should.
    body.setOrigin(0.5, ORIGIN_Y);
    body.setDisplaySize(CELL_W, CELL_H);

    // Name plate (DESIGN.md §5/§7). The old tag was 12px on a 67%-opaque
    // near-black wash, which vanished over lit floors and bright foliage — the
    // two places a name matters most, because "who did I just see in the
    // greenhouse" is the entire game. Opaque plate, tighter type, hard
    // stroke, so it reads over anything the map can put behind it.
    const tag = this.add
      .text(0, -66, p.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#eafff8',
        backgroundColor: '#0a0e13e8',
        padding: { x: 6, y: 3 },
        stroke: '#04080b',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    tag.setShadow(0, 2, '#000000', 4, false, true);

    c.add([shadow, body, tag]);
    const v: Vis = { c, body, tag, variant, facing: 'down', fromX: p.x, fromY: p.y };
    this.people.set(p.seat, v);
    return v;
  }

  /**
   * Put one character into the right variant, facing and animation state.
   *
   * All three are independent — a Parasite can turn, a corpse-to-be can stop —
   * so this is a single place that reconciles the sprite with what it should be
   * showing, rather than three scattered conditionals.
   */
  private pose(v: Vis, variant: Variant, facing: Facing, walking: boolean, dir: -1 | 1): void {
    // `side` is drawn facing right and mirrored for left. This is the one place
    // a flip is honest: a body seen from the side really is near-symmetric, and
    // baking a second set of frames for it would double the texture cost to say
    // the same thing.
    v.body.setFlipX(facing === 'side' && dir < 0);

    const changed = variant !== v.variant || facing !== v.facing;
    v.variant = variant;
    v.facing = facing;

    if (walking) {
      const key = walkAnim(variant, facing);
      // `ignoreIfPlaying` keeps a continuous walk from restarting on frame 1
      // every tick, which would freeze the cycle on its first pose.
      if (changed || v.body.anims.getName() !== key || !v.body.anims.isPlaying) {
        v.body.anims.play(key, true);
      }
    } else if (v.body.anims.isPlaying || changed) {
      v.body.anims.stop();
      // Idle is the passing pose, feet together — the natural place to stand.
      v.body.setTexture(frameKey(variant, facing, 0));
    }
  }

  update(_time: number, delta: number) {
    const b = this.bridge;

    // ── Input ────────────────────────────────────────────────────────────────
    let ax = 0;
    let ay = 0;
    // Belt and braces alongside clearCaptures(): while the player is typing,
    // their keystrokes belong to the field, not to the character.
    if (!b.frozen && !typingInAField()) {
      if (this.keys.A.isDown || this.keys.left.isDown) ax -= 1;
      if (this.keys.D.isDown || this.keys.right.isDown) ax += 1;
      if (this.keys.W.isDown || this.keys.up.isDown) ay -= 1;
      if (this.keys.S.isDown || this.keys.down.isDown) ay += 1;
      const len = Math.hypot(ax, ay);
      if (len > 0) {
        ax /= len;
        ay /= len;
      }
      // Touch wins while the stick is held. Keyboard and stick are never
      // summed: a laptop with a touchscreen would otherwise get a doubled
      // vector and move at twice the speed diagonally.
      if (this.stick.id !== null && (this.stick.ax !== 0 || this.stick.ay !== 0)) {
        ax = this.stick.ax;
        ay = this.stick.ay;
      }
    } else if (this.stick.id !== null) {
      // A meeting can open mid-drag; drop the stick rather than leaving it
      // latched behind the overlay.
      this.stick.id = null;
      this.stick.gfx?.setVisible(false);
    }

    // Send on change, plus a heartbeat while moving so a dropped packet cannot
    // leave the server integrating a stale direction forever.
    const now = this.time.now;
    const changed = ax !== this.lastSent.ax || ay !== this.lastSent.ay;
    if (changed || (now - this.lastSent.at > 120 && (ax !== 0 || ay !== 0))) {
      b.onInput(ax, ay);
      this.lastSent = { ax, ay, at: now };
    }

    // ── Render players ───────────────────────────────────────────────────────
    // Merge fresh every frame: b.players is only the last full snapshot (React
    // re-renders rarely), b.positions is a ref-backed Map updated ~20x/sec by
    // the socket layer with no React re-render at all. Reading both here is
    // what actually gives 60fps-fresh movement.
    const players = this.mergedPlayers();
    const seen = new Set<Seat>();
    let me: PublicPlayer | null = null;

    for (const p of players) {
      seen.add(p.seat);
      const v = this.visFor(p);
      const isMe = p.seat === b.mySeat;
      if (isMe) me = p;

      // Reveal art: only ever for MY OWN sprite, and only once I have decrypted
      // my role. Other players' skins never change — that is the confidentiality
      // requirement, enforced here as well as on the wire.
      const want =
        isMe && b.isParasite ? ensureParasite(this) : ensureSkin(this, p.skin);

      if (!p.alive) {
        v.c.setAlpha(0.28);
        v.tag.setColor('#8899aa');
      } else {
        v.c.setAlpha(p.connected ? 1 : 0.55);
        v.tag.setColor(isMe ? '#7dffcd' : '#eafff8');
      }

      // Smooth toward the authoritative position. My own sprite snaps harder so
      // input feels immediate; others interpolate so 20Hz looks continuous.
      const t = isMe ? 0.55 : Math.min(1, (delta / 1000) * 12);
      const x = Phaser.Math.Linear(v.c.x, p.x, t);
      const y = Phaser.Math.Linear(v.c.y, p.y, t);

      // Facing comes from where the sprite actually went this frame, so it
      // follows the interpolated motion rather than leading it.
      const facing = resolveFacing(x - v.fromX, y - v.fromY, v.facing);
      v.fromX = x;
      v.fromY = y;
      v.c.x = x;
      v.c.y = y;
      // Sort by feet, so whoever is lower on the screen draws in front.
      v.c.setDepth(10 + y / 100);

      this.pose(v, want, facing, p.moving && p.alive, p.dir);
    }

    for (const [seat, v] of this.people) {
      if (!seen.has(seat)) {
        v.c.destroy();
        this.people.delete(seat);
      }
    }

    this.renderBodies(players);

    if (me) {
      this.cameras.main.centerOn(
        Phaser.Math.Linear(this.cameras.main.midPoint.x, me.x, 0.12),
        Phaser.Math.Linear(this.cameras.main.midPoint.y, me.y, 0.12)
      );
      this.renderContext(me, players);
    }
  }

  /**
   * Overlay live positions (from the high-frequency socket channel) onto the
   * last full player snapshot. Must be recomputed every frame — b.positions
   * is mutated in place and never triggers a React re-render, so caching
   * this anywhere longer-lived than a single frame reintroduces the bug.
   */
  private mergedPlayers(): PublicPlayer[] {
    const b = this.bridge;
    return b.players.map((p) => {
      const live = b.positions.get(p.seat);
      return live ? { ...p, x: live.x, y: live.y, dir: live.dir, moving: live.moving } : p;
    });
  }

  private renderBodies(players: PublicPlayer[]) {
    const seen = new Set<Seat>();
    const bySeat = new Map(players.map((p) => [p.seat, p]));

    for (const body of this.bridge.bodies) {
      seen.add(body.seat);
      let c = this.bodySprites.get(body.seat);
      if (!c) {
        c = this.add.container(body.x, body.y).setDepth(6);

        // Corpses always render human, whichever skin the victim wore and
        // whatever killed them. A corpse drawn as infected would publish the
        // victim's role to the entire lobby — see DECISIONS.md.
        const skin = bySeat.get(body.seat)?.skin ?? 0;
        const img = this.add.image(0, 0, ensureCorpse(this, skin));
        img.setOrigin(0.5, ORIGIN_Y);
        img.setDisplaySize(CELL_W, CELL_H);

        const mark = this.add
          .text(0, -30, '☠', { fontFamily: 'monospace', fontSize: '15px', color: '#ff9aa8' })
          .setOrigin(0.5);

        c.add([img, mark]);
        this.bodySprites.set(body.seat, c);
      }
    }
    for (const [seat, c] of this.bodySprites) {
      if (!seen.has(seat)) {
        c.destroy();
        this.bodySprites.delete(seat);
      }
    }
  }

  /**
   * Work out what the player can act on and hand it to React, which owns the
   * action buttons. Also draws the Parasite's jump range ring.
   */
  private renderContext(me: PublicPlayer, players: PublicPlayer[]) {
    const b = this.bridge;

    let taskInRange: TaskId | null = null;
    for (const id of b.myTasks) {
      if (b.doneTasks.includes(id)) continue;
      const st = TASK_STATIONS[id];
      if (Math.hypot(me.x - st.x, me.y - st.y) <= 56) {
        taskInRange = id;
        break;
      }
    }

    // Highlight the station I am standing on.
    for (const [id, mark] of this.stationMarks) {
      const active = id === taskInRange;
      const mine = b.myTasks.includes(id) && !b.doneTasks.includes(id);
      mark.setAlpha(mine ? 1 : 0.32);
      mark.setScale(active ? 1.18 : 1);
    }

    const jumpTargets: { seat: Seat; name: string }[] = [];
    let bodyInRange: Seat | null = null;

    if (me.alive) {
      for (const p of players) {
        if (p.seat === me.seat || !p.alive) continue;
        if (Math.hypot(me.x - p.x, me.y - p.y) <= JUMP_RANGE) {
          jumpTargets.push({ seat: p.seat, name: p.name });
        }
      }
      for (const body of b.bodies) {
        if (Math.hypot(me.x - body.x, me.y - body.y) <= 70) {
          bodyInRange = body.seat;
          break;
        }
      }
    }

    b.onContext({ taskInRange, jumpTargets, bodyInRange });
  }
}

/**
 * Decide which of the three drawn views a character should show.
 *
 * The wire protocol has no facing field — `dir` is only `-1 | 1`, a left/right
 * hint — so vertical facing is inferred here from the interpolated motion
 * vector. That keeps the change purely visual: no new field, no protocol bump.
 *
 * The rules of thumb, in order:
 *
 * 1. Below the deadzone there is no motion worth honouring, so the facing stays
 *    as it was. Without this, 20Hz interpolation noise makes an idle character
 *    twitch between views.
 * 2. Mostly-vertical motion takes the front or back view.
 * 3. Everything else takes the side view, which is the most legible of the
 *    three. The bias means only *noticeably* vertical motion switches away from
 *    it, so a diagonal walk does not flicker between two facings on consecutive
 *    frames. Left/right within the side view is handled by `dir`, which the
 *    server does send.
 */
function resolveFacing(dx: number, dy: number, prev: Facing): Facing {
  if (Math.hypot(dx, dy) < TURN_DEADZONE) return prev;
  if (Math.abs(dy) > Math.abs(dx) * VERTICAL_BIAS) return dy < 0 ? 'up' : 'down';
  return 'side';
}
