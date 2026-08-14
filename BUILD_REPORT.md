# BUILD_REPORT — Parasite

**Date:** 2026-08-11 · **Deadline:** 2026-08-14
**Platform:** Base Sepolia · **Stack:** Inco Lightning FHE + Hardhat + Socket.io + Next.js/Phaser
**Repo state:** 12 commits on `master`, working tree clean, **no remote** (this is a local-only repo).

---

## TL;DR

A complete, tested, playable build of the core game loop plus the
FHE-encrypted Parasite identity and Jump mechanic. **114 tests pass**
(26 shared + 50 server + 38 contracts), typecheck is clean, the Next
production build is clean, and the full
loop is verified over the wire by a 4-client smoke test against the built
server.

**The one big thing that could not be done: nothing was ever deployed.** No
wallet key was provided, so the contract was never deployed to Base Sepolia,
no player ever ran in true FHE mode against the live chain, and the "wire the
frontend to the deployed contract" step of the build priority list is the
single step left. Everything up to the point of needing a funded key is built,
tested, and stubbed behind a clean seam. Details in [Deployment](#deployment).

---

## What was built

### The game (packages/shared + packages/server)
A real-time social deduction loop, fully server-authoritative:
- Lobby → play → meeting → verdict → play, with mid-game joins rejected
  server-side and disconnects handled.
- 20 Hz server tick with a transport-free rules engine; clients send intent
  (a desired heading), the server owns physics (`resolveMove`, wall
  collision), and positions stream on a separate `positions` channel — full
  state snapshots fire only on structural change, so live movement is cheap.
- **Tasks**: 5 per player × (players − 1), since the Parasite's job is to be
  *not* doing them. Claim requires proximity; a completed task is a station
  minigame. In Inco mode the server cannot — by design — tell a Parasite's
  task from a human's; the client owns the fake-task guard for the Parasite.
- **Purge** (the kill): the Parasite kills an adjacent player with a cooldown;
  the victim's body is left on the floor for anyone to report.
- **Meetings**: emergency call or body report → discussion → voting → result,
  with a per-player vote, ejection, and a reveal that a living player cannot
  be ejected on a tie.
- Roles never touch the server: each client learns its role privately (see
  below) and the server's rules are written without ever reading it.

### The chain (packages/contracts) — the centerpiece
`ParasiteGame.sol` stores the host seat as a single **`euint256` handle** and
implements the Jump with `e.select(callerIsHost, targetSeat, hostSeat)` —
every player's jump executes identically, a non-Parasite's is a silent no-op,
and the target seat is encrypted so it never appears in the event log.
Sanctioned reveals: `revealEjection` publishes only
`e.eq(hostSeat, ejectedSeat)`; `revealHost` (game end) reveals the seat.
Role bits are scoped per-wallet (`e.allow`), and the immutable-handle trap is
handled by re-granting after every jump (`_grantRoleBits`).

The test harness mocks the Inco library (`MockIncoLightning`) by
`hardhat_setCode`-ing it at the library's hardcoded address, so the *deployed*
artifact is the *tested* artifact. The suite asserts the anti-fingerprinting
properties directly: decoys don't revert, emit an identical event shape, never
leak the target, and burn identical gas to a real jump.

### The client (packages/web)
Next.js 15 App Router + React 19 + Phaser 3.90 (dynamic import, loopback-bound
`dev`/`start`). Role-aware HUD (the badge names which role mode is live),
crew list, minimap, task list + station minigame modal, meeting overlay with a
voting stage, end overlay, lobby with room code + start. Game input is the
keyboard; decoy jumps run on a jittered 25–60 s schedule.

### Roles and the seam
A `RoleOracle` seam with two implementations:
- `LocalRoleOracle` (default) — the server tells each client its role
  privately over its socket. Makes the whole game playable without a wallet.
- `IncoRoleOracle` — derives the role from `myRoleHandle` +
  `attestedDecrypt`, and submits `jump()` on-chain with an encrypted target.

---

## What is genuinely verified

| Thing | How |
|---|---|
| FHE contract behaviour | 34 Hardhat tests incl. role privacy, select-Jump, re-grants, gas-identity |
| Client↔contract agreement | ABI drift test — diffs the hand-written client ABI against the compiled artifact; **proven to fail** when perturbed |
| Server game rules | 50 vitest tests |
| Shared protocol/rules | 26 vitest tests |
| Web code | `tsc --noEmit` clean; Next production build clean, zero warnings |
| Full loop over the wire | 4-client smoke test against the *built* server: join, start, mid-game-join **rejected**, movement sync + mirroring, out-of-range task **rejected**, task completion, Purge → body, dead-cannot-act **rejected**, report → meeting, skip, emergency meeting, majority ejection, death state |
| Runtime-only traps | Phaser ESM default-export crash, sprite key 404 — both found and fixed |

**Totals: 114 tests passing** (26 shared + 50 server + 34 contracts + 4
additional ABI-drift tests folded into the contracts count of 38).

---

## Not tested / not done — stated plainly

1. **No live-chain test.** Nothing was ever deployed, so every FHE interaction
   with the real Inco library on a real network is unverified: the encryption
   round-trip, fee estimation, the mock's fidelity to real
   `MockIncoLightning`, and the deployed-contract UI path. The contract logic
   is tested against a faithful in-process mock of the library's *interface*;
   the library itself is exercised only at the unit level, offline.
2. **No browser/manual playtest.** The UI was never clicked by a human. The
   Phaser scene loads and builds, but visual layout, sprite proportions, and
   feel are unjudged.
3. **Browser→server wiring is only partially exercised.** The smoke test uses
   real socket.io clients with the real protocol, so the wire contract is
   covered; the React components and socket hook are not run against a live
   server in a browser.
4. **Parasite decoy bug — found, fixed, committed.** The decoy scheduler
   originally aimed at a random other player, which for the Parasite was a
   *real* jump (a self-secretly-moving host). Fixed to self-target and locked
   with a contract regression test. This was the highest-impact find of the
   build: it would have silently broken the judged centerpiece.
5. **A fake task for the Parasite is client-side only.** In Inco mode the
   server cannot reject a Parasite's task (it would need to know the role);
   the guard lives in the client and is honest-but-soft — a determined cheater
   could bypass it. The server-side `taskTotal = (players−1)×5` cap makes such
   cheating self-defeating for the cheater anyway.

---

## Every stub / TODO left in the tree

Everything needing a credential that was not provided is stubbed behind a
clean seam and marked with a searchable marker. There are **no** code-level
`TODO` stubs beyond the env scaffolding:

- `.env.example`:
  - `NEXT_PUBLIC_BASE_SEPOLIA_RPC` — public default `https://sepolia.base.org`; set a private endpoint for reliability.
  - `NEXT_PUBLIC_PARASITE_GAME_ADDRESS` — **EMPTY = simulated mode.** Set to a deployed address to switch the app to Inco mode.
  - `DEPLOYER_PRIVATE_KEY` — required only for `npm run deploy:baseSepolia`.
- `packages/contracts/scripts/deploy.ts` — refuses to run without the key and
  prints what to set.

No other credentials are needed anywhere in the app.

---

## Known issues / honest caveats

- **Simulated mode is a trust fallback, not the feature.** It plays the full
  loop with server-held roles. It exists so the project runs in one command;
  the FHE chain is the point of the project, and simulated mode deliberately
  says so in the HUD.
- **Inco mode untested live** (see above) — if a judge funds a wallet and
  deploys, the *first* things to check are the fee estimate call and the
  `attestedDecrypt` shape, which are the two places the mock and reality are
  most likely to differ.
- **Decoy cadence is tuned for humans, not for a judge replaying a match.**
  25–60 s between decoys is good cover during real play; a spectator watching
  only the parasite's *movement* rather than tx flow can still deduce by play
  skill — that's the game, and it's true in Among Us too.
- **No reconnection mid-game.** A client that drops during a meeting simply
  misses it; there is no session replay. Acceptable for a jam game, noted for
  completeness.
- **Emergency meetings can be spammed** within the rules (they cost nothing);
  there is no anti-spam besides the meeting cooldown/sequence.

---

## How a judge reproduces the important claims

```bash
npm install && npm run build:shared && npm test        # 114 passing
npm run typecheck                                       # clean
npm run build                                           # server + web, clean
node packages/server/dist/index.js &                   # 127.0.0.1:9101
node packages/server/src/e2e.smoke.mjs                  # full-loop smoke
npm run dev                                             # play at :9100
```

To judge the FHE claims for real: set `DEPLOYER_PRIVATE_KEY`,
`npm run deploy:baseSepolia`, put the address in
`NEXT_PUBLIC_PARASITE_GAME_ADDRESS`, and play four windows of Inco mode. The
drift test, the gas-identity tests, and the event-shape tests are the
on-paper proxies for what that run would prove.

## What I would do next, given more time

1. Deploy and run one real Inco-mode game to validate the live encryption
   path (the entire remaining risk is concentrated here).
2. A browser-driven manual pass — even a scripted one — over Lobby → Play →
   Meeting to judge feel and catch layout bugs the compiler cannot.
3. Reconnection/resume for players who drop mid-meeting.
4. Vercel/Node deploy notes for the client and server so a remote playtest
   (multiple machines) is possible before the deadline.

---

# ADDENDUM — visual rebuild pass

Everything above describes the game as first built and still stands. This
section covers a later, **visual-only** pass over the two things that looked
worst: the map and the in-game characters. No game logic, wire protocol,
server state model, or contract code was touched, and the 114 tests pass
unchanged — that invariance is the evidence the pass stayed cosmetic.

## What was wrong

- **The map** was flat coloured rounded rectangles with translucent circles
  for foliage. A blockout, not a place.
- **The characters** were one static front-facing PNG per skin, moved with a
  left/right flip and a vertical sine bob — a cardboard cutout being dragged
  around.

## What replaced it

Under a hard constraint: **no image generation, no asset downloads.** Every
pixel is drawn from primitives at boot.

- `packages/web/src/game/art/pen.ts` — a backend-agnostic `Pen` interface all
  art draws into, plus seeded RNG and shape helpers.
- `chibi.ts` — the characters: three drawn facings (`down`, `up`, `side`),
  three walk poses each, human / infected / Parasite forms, and corpses.
- `palette.ts` — character skins, reveal palettes, environment tones, and the
  per-room `RoomTheme`s.
- `mapArt.ts` — themed floors (lab tile, greenhouse moss, meeting deck
  planking), walls with real thickness and derived doorways, thematic props,
  layered three-species foliage, and the bioluminescent lamps.
- `phaserPen.ts` — bakes all of the above into Phaser textures and registers
  the walk animations.
- `MainScene.ts` — `preload()` is gone; there is nothing left to load. The map
  is one baked texture and one draw call. Characters animate off the existing
  `p.moving` flag, with facing inferred client-side from position deltas.

## How it was verified without a browser

There is no headless browser here, so `scripts/preview-art.ts` hosts the same
`Pen` as an SVG emitter and `sharp` rasterises it. Dev-only; imports nothing
that ships.

```bash
npx tsx scripts/preview-art.ts          # /tmp/chars.png  — every facing, pose, form
npx tsx scripts/preview-art.ts map      # /tmp/map.png    — full 1600x1200 outpost
npx tsx scripts/preview-art.ts rooms    # /tmp/rooms.png  — per-room floors and props
npx tsx scripts/preview-art.ts scene    # /tmp/scene.png  — characters on the real map, 1:1
```

The `scene` view is the one that matters: a character sheet and a map sheet can
both look fine in isolation and still tell you nothing about whether a
scientist reads against a tiled lab floor at real scale.

**Defects this caught that no typecheck could:** a wall drawn across a doorway;
a cable that tapered to a point in open floor and read as a stray pen mark;
stools that read as rocks (three rewrites); those stools then sitting exactly on
the meeting deck's inlaid ring, reading as beads on a track.

## Verified for this pass

```
npm run typecheck   # clean across shared, server, web
npm test            # 114 passing (26 shared + 50 server + 38 contracts), unchanged
npm run build       # shared + server + web, clean
```

Note: `npm run build` initially failed with `EACCES` on
`packages/web/.next/trace` — a stale root-owned Next cache from an earlier run,
not a code fault. Moved aside; the rebuild is clean.

## Caveats specific to this pass

- **Still never rendered by Phaser.** The SVG preview and `PhaserPen` implement
  the same interface, and the semantics were matched deliberately (including
  per-corner radii), but they are two implementations. Animation timing,
  texture bake cost at boot, and depth sorting under real motion are unproven
  until someone loads the page.
- **Art was judged by my own eye**, from rendered crops. No human has looked at
  it yet.
- **The lobby / meeting / end-screen portraits still use the sliced PNGs.** That
  was deliberate (see DECISIONS.md); the consequence is that the game now has
  two visual registers — photo-real portraits in menus, procedural chibis in
  play. Unifying them would mean drawing portrait-scale art for the pickers.
