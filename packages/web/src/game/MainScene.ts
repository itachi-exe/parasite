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

export interface SceneBridge {
  /** Latest authoritative snapshot from the server. */
  players: PublicPlayer[];
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

const SKIN_KEYS = ['skin0', 'skin1', 'skin2', 'skin3'] as const;

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
  private sprites = new Map<Seat, Phaser.GameObjects.Container>();
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
  private jumpRing!: Phaser.GameObjects.Graphics;

  constructor() {
    super('main');
  }

  init(data: { bridge: SceneBridge }) {
    this.bridge = data.bridge;
  }

  preload() {
    this.load.image('skin0', '/sprites/human-0.png');
    this.load.image('skin1', '/sprites/human-1.png');
    this.load.image('skin2', '/sprites/human-2.png');
    this.load.image('skin3', '/sprites/human-3.png');
    this.load.image('infected', '/sprites/infected.png');
    this.load.image('parasite', '/sprites/parasite.png');
  }

  create() {
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBackgroundColor('#04130f');

    this.drawMap();
    this.drawStations();

    this.jumpRing = this.add.graphics().setDepth(5);

    const kb = this.input.keyboard!;
    this.keys = {
      W: kb.addKey('W'),
      A: kb.addKey('A'),
      S: kb.addKey('S'),
      D: kb.addKey('D'),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    };

    // Stop WASD/arrows from scrolling the page behind the canvas.
    kb.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
  }

  /** Jungle floor, room slabs, and bioluminescent accents. */
  private drawMap() {
    const g = this.add.graphics().setDepth(0);

    // Jungle backdrop with a soft vignette of darker foliage patches.
    g.fillStyle(0x06251b, 1);
    g.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Deterministic foliage speckle — seeded so every client renders the same
    // map (no Math.random, which would desync the visual between players).
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 260; i++) {
      const x = rnd() * MAP_WIDTH;
      const y = rnd() * MAP_HEIGHT;
      const r = 12 + rnd() * 34;
      g.fillStyle(0x0a3527, 0.55);
      g.fillCircle(x, y, r);
    }
    for (let i = 0; i < 90; i++) {
      const x = rnd() * MAP_WIDTH;
      const y = rnd() * MAP_HEIGHT;
      g.fillStyle(0x2ef2b0, 0.13);
      g.fillCircle(x, y, 2 + rnd() * 3);
    }

    for (const room of ROOMS) {
      const isPath = room.kind === 'path';
      const fill = isPath ? 0x123a2c : 0x16473a;
      const edge = isPath ? 0x1f7a5c : 0x37d99a;

      g.fillStyle(fill, 1);
      g.fillRoundedRect(room.x, room.y, room.w, room.h, isPath ? 6 : 14);
      g.lineStyle(isPath ? 2 : 3, edge, isPath ? 0.5 : 0.85);
      g.strokeRoundedRect(room.x, room.y, room.w, room.h, isPath ? 6 : 14);

      if (!isPath) {
        // Bioluminescent corner lamps.
        const pts = [
          [room.x + 16, room.y + 16],
          [room.x + room.w - 16, room.y + 16],
          [room.x + 16, room.y + room.h - 16],
          [room.x + room.w - 16, room.y + room.h - 16],
        ];
        for (const [px, py] of pts) {
          g.fillStyle(0x6affd0, 0.22);
          g.fillCircle(px!, py!, 13);
          g.fillStyle(0xb6ffe8, 0.9);
          g.fillCircle(px!, py!, 3.5);
        }

        this.add
          .text(room.x + room.w / 2, room.y + 13, room.name.toUpperCase(), {
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#8ffce0',
          })
          .setOrigin(0.5, 0)
          .setAlpha(0.75)
          .setDepth(1);
      }
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

  /** Build (or fetch) the container for one player. */
  private spriteFor(p: PublicPlayer): Phaser.GameObjects.Container {
    let c = this.sprites.get(p.seat);
    if (c) return c;

    c = this.add.container(p.x, p.y).setDepth(10);

    const shadow = this.add.ellipse(0, PLAYER_RADIUS - 2, 34, 12, 0x000000, 0.35);
    const key = SKIN_KEYS[p.skin % SKIN_KEYS.length]!;
    const img = this.add.image(0, 0, key);
    // Sprites are sliced at varying sizes; normalise to a consistent height.
    img.setDisplaySize((img.width / img.height) * 62, 62);
    img.setName('body');

    const nameTag = this.add
      .text(0, -46, p.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#eafff8',
        backgroundColor: '#04130faa',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setName('tag');

    c.add([shadow, img, nameTag]);
    this.sprites.set(p.seat, c);
    return c;
  }

  update(_time: number, delta: number) {
    const b = this.bridge;

    // ── Input ────────────────────────────────────────────────────────────────
    let ax = 0;
    let ay = 0;
    if (!b.frozen) {
      if (this.keys.A.isDown || this.keys.left.isDown) ax -= 1;
      if (this.keys.D.isDown || this.keys.right.isDown) ax += 1;
      if (this.keys.W.isDown || this.keys.up.isDown) ay -= 1;
      if (this.keys.S.isDown || this.keys.down.isDown) ay += 1;
      const len = Math.hypot(ax, ay);
      if (len > 0) {
        ax /= len;
        ay /= len;
      }
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
    const seen = new Set<Seat>();
    let me: PublicPlayer | null = null;

    for (const p of b.players) {
      seen.add(p.seat);
      const c = this.spriteFor(p);
      const img = c.getByName('body') as Phaser.GameObjects.Image;
      const tag = c.getByName('tag') as Phaser.GameObjects.Text;

      const isMe = p.seat === b.mySeat;
      if (isMe) me = p;

      // Reveal art: only ever for MY OWN sprite, and only once I have decrypted
      // my role. Other players' skins never change — that is the confidentiality
      // requirement, enforced here as well as on the wire.
      const wantKey = isMe && b.isParasite ? 'parasite' : SKIN_KEYS[p.skin % SKIN_KEYS.length]!;
      if (img.texture.key !== wantKey) {
        img.setTexture(wantKey);
        img.setDisplaySize((img.width / img.height) * 62, 62);
      }

      if (!p.alive) {
        c.setAlpha(0.28);
        tag.setColor('#8899aa');
      } else {
        c.setAlpha(p.connected ? 1 : 0.55);
        tag.setColor(isMe ? '#7dffcd' : '#eafff8');
      }

      // Smooth toward the authoritative position. My own sprite snaps harder so
      // input feels immediate; others interpolate so 20Hz looks continuous.
      const t = isMe ? 0.55 : Math.min(1, (delta / 1000) * 12);
      c.x = Phaser.Math.Linear(c.x, p.x, t);
      c.y = Phaser.Math.Linear(c.y, p.y, t);
      c.setDepth(10 + c.y / 100);

      img.setFlipX(p.dir < 0);
      // Walk bob, driven by the server's `moving` flag.
      img.y = p.moving && p.alive ? Math.sin(now / 90) * 2.5 : 0;
    }

    for (const [seat, c] of this.sprites) {
      if (!seen.has(seat)) {
        c.destroy();
        this.sprites.delete(seat);
      }
    }

    this.renderBodies();

    if (me) {
      this.cameras.main.centerOn(
        Phaser.Math.Linear(this.cameras.main.midPoint.x, me.x, 0.12),
        Phaser.Math.Linear(this.cameras.main.midPoint.y, me.y, 0.12)
      );
      this.renderContext(me);
    }
  }

  private renderBodies() {
    const seen = new Set<Seat>();
    for (const body of this.bridge.bodies) {
      seen.add(body.seat);
      let c = this.bodySprites.get(body.seat);
      if (!c) {
        c = this.add.container(body.x, body.y).setDepth(6);
        const pool = this.add.ellipse(0, 6, 44, 20, 0x3a0f1c, 0.75);
        const img = this.add.image(0, 0, 'infected');
        img.setDisplaySize((img.width / img.height) * 52, 52);
        img.setAngle(90).setTint(0x9fb8ae);
        const mark = this.add
          .text(0, -26, '☠', { fontFamily: 'monospace', fontSize: '15px', color: '#ff9aa8' })
          .setOrigin(0.5);
        c.add([pool, img, mark]);
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
  private renderContext(me: PublicPlayer) {
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
      for (const p of b.players) {
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

    this.jumpRing.clear();
    if (b.isParasite && me.alive) {
      this.jumpRing.lineStyle(1.5, 0x8affd4, jumpTargets.length ? 0.5 : 0.16);
      this.jumpRing.strokeCircle(me.x, me.y, JUMP_RANGE);
    }

    b.onContext({ taskInRange, jumpTargets, bodyInRange });
  }
}
