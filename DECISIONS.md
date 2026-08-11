# DECISIONS

Running log of ambiguities in the spec and how they were resolved during the
build. Appended to as the build progressed.

---

## Contract toolchain: Hardhat vs Foundry
- **Chose:** Hardhat (with `hardhat-toolbox`, TypeScript config).
- **Why:** The spec says "your call". Foundry is not installed on this build
  machine and `foundryup` needs a network install of prebuilt binaries;
  Hardhat is pure npm and installs from the same registry we already use for
  the rest of the monorepo. Inco ships `@inco/lightning` as an npm package
  with plain Solidity sources under `src/`, so Hardhat resolves the imports
  natively with zero remapping config.
- **Alternatives considered:** Foundry (Inco's own quickstart prefers it, and
  `@inco/lightning` bundles `forge-std` + an `IncoTest` harness). If the grader
  has Foundry installed, the contract source is plain Solidity and compiles
  there unchanged — only the test/deploy harness is Hardhat-specific.

## Which Inco `Lib` variant to import
- **Chose:** `@inco/lightning/src/Lib.testnet.sol` for the deployed contract,
  selected via a one-line import in `contracts/src/incoLib.sol`.
- **Why:** This was a real trap. The default `Lib.sol` hardcodes
  `inco = 0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624`, which is the **mainnet**
  IncoLightning address — identical to `Lib.mainnet.sol`. `Lib.testnet.sol`
  points at `0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6`, which is the Base
  Sepolia deployment. Importing the default `Lib.sol` and deploying to Base
  Sepolia would produce a contract that compiles, deploys, and then reverts on
  every FHE op because there is no IncoLightning at the mainnet address on
  Base Sepolia. Verified by diffing the `inco` constant across all five
  `Lib.*.sol` variants in the installed package.
- **Alternatives considered:** Importing `Lib.sol` directly (wrong network);
  copying the library (unmaintainable).

## Multiplayer transport
- **Chose:** Socket.io, with an authoritative Node server.
- **Why:** The spec requires the 4–10 player cap and lobby-only joining to be
  enforced *server-side, not just in the UI*. That requires a server that owns
  the game state and can reject joins — which rules out a pure CRDT/presence
  product where every client can write shared state. Socket.io also gives us
  room semantics and a simple binary-ish tick loop for movement.
- **Alternatives considered:** Liveblocks and PartyKit. Both are excellent for
  presence but are hosted services needing API keys (none were provided), and
  Liveblocks' storage model is last-write-wins per client, which cannot enforce
  "no mid-game join" as a hard invariant.

## Who knows the roles
- **Chose:** Nobody except each player, for their own role. The game server is
  deliberately kept ignorant of every role and of the Parasite's identity.
- **Why:** The spec says role state must be encrypted "even in the
  backend/contract state" and that "only the affected player(s) should ever be
  able to decrypt role-relevant private information for themselves." A server
  that knew the roles would make the Inco integration decorative. So the server
  runs the public game (positions, tasks, meetings, votes) and the chain runs
  the private game (roles, host identity), and they only touch at two
  deliberate, rules-sanctioned reveal points (ejection result, game over).
- **Alternatives considered:** Server-side role assignment mirrored to chain
  (simpler, but fake confidentiality — explicitly rejected by the spec).

## How the Parasite proves it is the Parasite when jumping, without revealing it
- **Chose:** *Everyone* can call `jump(...)`, and the contract makes the call a
  no-op for non-Parasites using `e.select` instead of `require`.
- **Why:** Inco's control-flow rules forbid branching or reverting on an
  encrypted value — doing so leaks the value through the transaction outcome.
  So `jump` cannot check "are you the Parasite?" and revert. Instead it computes
  `ebool callerIsParasite = e.eq(hostSeat, callerSeat)` and then
  `hostSeat = e.select(callerIsParasite, submittedTarget, hostSeat)`. A
  non-Parasite's jump silently writes the host seat back to its current value.
  Every jump transaction is byte-for-byte indistinguishable on-chain regardless
  of who sent it or whether it did anything. The client sends **decoy jumps**
  from every player on a jitter so even tx timing/frequency leaks nothing.
- **Alternatives considered:** A `require(msg.sender == parasite)` check with a
  plaintext parasite address (leaks the Parasite to any block explorer — the
  exact thing the spec says not to fake); a ZK proof of membership (correct but
  a much larger build, and Inco's `select` already gives the property).

## Chain latency vs. real-time gameplay
- **Chose:** Hybrid. Movement/tasks/meetings/votes run at 20Hz over Socket.io
  and never touch the chain. Only role assignment, jumps, and the two reveal
  points are on-chain transactions.
- **Why:** Base Sepolia blocks are ~2s and Inco FHE ops add covalidator
  latency. Putting movement on-chain would make the game unplayable, and
  movement is public information anyway so encrypting it buys nothing.
- **Alternatives considered:** Full on-chain game state (unplayable);
  fully off-chain with a token gesture at the chain (fake).

## Playability without a wallet / deployed contract
- **Chose:** A `RoleOracle` interface with two implementations —
  `IncoRoleOracle` (real Base Sepolia + Inco) and `LocalRoleOracle` (an
  in-process simulation used when no contract address is configured). The
  active mode is surfaced in the UI at all times, never silently.
- **Why:** No deploy key or RPC credential was provided with this build, so the
  contract cannot actually be deployed by me. Without a fallback the game would
  be 100% undemoable, which fails the "complete, actually-playable core loop"
  constraint. The interface is the seam the spec asks for, and it also makes the
  contract logic testable without a live FHE network.
- **Why this is not "faking the confidentiality":** `LocalRoleOracle` is
  explicitly labelled `SIMULATED` in the HUD, and it mirrors the *contract's*
  logic (including the select-based no-op jump), so what you see in local mode
  is what the contract does — it is a reference implementation, not a
  substitute claim. `DECISIONS.md` and `BUILD_REPORT.md` both state plainly
  which values are encrypted only in Inco mode.
- **Alternatives considered:** Ship chain-only (undemoable without credentials);
  ship local-only (fails the judged criterion).

## Testing FHE contracts without Docker
- **Chose:** Split the contract into (a) `ParasiteGame.sol`, which calls the
  real Inco library, and (b) a `MockIncoLightning` deployed at the library's
  hardcoded address via Hardhat's `hardhat_setCode`, so the full contract —
  unmodified, still importing `Lib.testnet.sol` — can be unit-tested locally.
- **Why:** Inco's own test harness needs the Dockerised local FHE devnet, and
  Docker is not installed on this machine. Rather than skip contract tests, the
  mock implements `IncoLightning`'s ABI over *plaintext* values, so the tests
  genuinely exercise `ParasiteGame`'s control flow, the select-based no-op
  jump, the seat bookkeeping, and the access-grant call pattern.
- **What this does NOT test:** actual FHE correctness, real ciphertext handling,
  or that covalidator access grants behave as documented. Those need the Inco
  devnet or a Base Sepolia deployment. Stated plainly in `BUILD_REPORT.md`.
- **Alternatives considered:** No contract tests at all (unacceptable);
  rewriting the contract to be library-agnostic behind an interface (would mean
  the tested artefact is not the deployed artefact).

## Seat indices instead of addresses for the encrypted host identity
- **Chose:** The encrypted host identity is an `euint256` **seat index**
  (0..n-1), not an `eaddress`.
- **Why:** Seat index makes `e.eq(hostSeat, i)` against a plain `uint256` a
  single cheap op per seat when re-granting role bits after a jump, and it
  keeps the "who is in which body" mapping (which is what the Jump actually
  moves) separate from wallet identity. `eaddress` would force an encrypted
  address comparison per seat with no benefit.
- **Alternatives considered:** `eaddress` of the current host (more literal, but
  more expensive and no gameplay difference).

## Ejection reveal
- **Chose:** On ejection, the contract computes `e.eq(hostSeat, ejectedSeat)`
  and calls `e.reveal` on that single `ebool` — publishing *only* the bit
  "was the ejected player the Parasite", never the host seat itself.
- **Why:** This is the Among Us "X was not The Parasite." beat, and it is
  information the rules are supposed to disclose. Revealing one derived bit is
  strictly less disclosure than revealing the host seat, and if the answer is
  false the Parasite's identity is still fully hidden among the remaining
  players.
- **Alternatives considered:** Revealing `hostSeat` on every ejection (ends the
  game instantly, wrong); revealing nothing (crew could never win by voting).

## Tasks: minigame depth
- **Chose:** Five distinct hold-to-progress / click-sequence interactions, one
  per map area, each with its own visual treatment.
- **Why:** The spec explicitly says "simple minigame or interaction-and-
  progress-bar style tasks are fine — the point is task variety and visible
  progress, not mechanical depth", and puts tasks at #5 of 10 in build
  priority, below the Inco work.
- **Alternatives considered:** Five bespoke minigames (more fun, but would eat
  the time budget the Jump mechanic needs).

## Scan and Purge abilities
- **Chose:** Implemented **Purge** (the Parasite's kill), skipped **Scan**.
- **Why:** The spec lists both as optional and says not to let them block the
  core loop. But without a kill the Parasite has no clock and no pressure, so
  meetings never have a body to discuss and the crew always wins by tasks —
  the loop is technically complete but not actually a game. Purge is the
  cheaper of the two and buys the whole "Report a body" beat, which the spec's
  own UI requirements list ("Report" button). Scan adds a second confidential
  read path with no loop-level payoff, so it was dropped.
- **Alternatives considered:** Both (time); neither (loop is inert).

## Sprite slicing approach
- **Chose:** A build script (`scripts/slice-characters.mjs`) using `sharp` that
  auto-detects the six figures by scanning for non-white pixel columns, then
  removes the white background with a **border flood-fill** rather than a
  luminance threshold.
- **Why:** Auto-detection means the crop boxes are derived from the actual
  image rather than hand-tuned magic numbers. The flood-fill matters a lot: the
  characters wear *white lab coats*, so a naive "make near-white pixels
  transparent" pass would punch holes straight through every character. Filling
  inward from the border only removes background that is actually connected to
  the outside.
- **Alternatives considered:** Manual crops (brittle, and the spec allows
  either); threshold-based keying (destroys the lab coats).

## Decoy jumps must target the sender's OWN seat
- **Chose:** Every decoy jump encrypts the sender's *own* seat as the target.
- **Why:** This was a real bug, caught late, and it would have broken the
  centerpiece mechanic in play. The contract computes
  `hostSeat = e.select(callerIsHost, targetSeat, hostSeat)`. The decoy
  scheduler originally aimed at a random *other* player, reasoning that a
  decoy is a no-op. That is true for a human — `callerIsHost` is false, so the
  select keeps the old value regardless of target. But for the **Parasite**
  `callerIsHost` is TRUE, so the select fires and the decoy is a *real jump*:
  the Parasite would have silently handed the role to a random player roughly
  every 40 seconds, with no UI event, for the entire match.
  Self-targeting collapses to `e.select(true, mySeat, mySeat)` — a genuine
  no-op for the Parasite, and still a no-op for everyone else.
- **Cover traffic is unaffected:** the target is encrypted, so an observer
  cannot distinguish a self-target from any other target; the transaction is
  byte-identical and burns identical gas (both are asserted in the contract
  tests).
- **Locked with:** `a self-targeted decoy is a no-op EVEN FOR THE PARASITE`,
  which also asserts the contrast — the same Parasite aiming *elsewhere* does
  move the role, so the test would catch a "fix" that disabled jumps entirely.
- **Alternatives considered:** having the client skip decoys when it knows it
  is the Parasite (destroys the entire point — absence of traffic becomes the
  fingerprint); a contract-level `isDecoy` flag (a plaintext flag that says
  "ignore me" is exactly the leak decoys exist to prevent).

## Hand-written client ABI, guarded by a drift test
- **Chose:** The web client declares its own ABI literal
  (`packages/web/src/lib/contract.ts`) instead of importing the Hardhat
  artifact, and a contracts-package test diffs the two.
- **Why:** Importing the artifact would give the Next build a build-order
  dependency on `hardhat compile`, which makes the frontend unbuildable
  without the contracts toolchain. But hand-copying a signature has a nasty
  failure mode: a Solidity change compiles green, all suites stay green, the
  web typecheck stays green, and the dapp breaks only on a live network with
  an opaque revert — on the one path that *cannot* be covered end-to-end here,
  since no deploy key was provided. The drift test buys the decoupling back
  without the risk, and asserts over mutability and event `indexed` flags too,
  not just names (a silent `payable` → `nonpayable` would revert every jump).
- **Alternatives considered:** generating the ABI into the web package at build
  time (reintroduces the build-order dependency); typechain across workspaces
  (heavier, same coupling).

## Phaser's ESM build has no default export
- **Chose:** `import * as Phaser from 'phaser'` in the scene, plus a
  `mod.default ?? mod` fallback at the dynamic-import site.
- **Why:** A latent runtime crash the type system actively hid. Phaser's
  `.d.ts` uses `export = Phaser`, so with `esModuleInterop` a default import
  *typechecks* — but bundlers resolve the `module` field to `dist/phaser.esm.js`,
  which has named exports only. `Phaser` was `undefined` at runtime and
  `new Phaser.Game` threw. Typecheck and build were both clean; only actually
  loading the page surfaced it. The fallback accepts whichever shape the
  bundler hands over rather than betting on one.
- **Alternatives considered:** forcing the CJS build via a bundler alias
  (fights Next's defaults and pessimises the chunk); `require()` (breaks the
  server render Phaser is dynamically imported to avoid in the first place).

## Repairing a corrupt `viem` install without deleting node_modules
- **Chose:** Diagnosed and repaired in place — `npm cache verify`, then
  `npm pack viem@2.39.3` into a scratch dir inside the workspace and `cp -a`
  over the existing package.
- **Why:** The symptom (TS7016, "could not find a declaration file for
  `viem`") looked like the wagmi/Inco duplicate-version conflict the root
  `overrides` was added to fix. It was not: the override had worked and there
  was exactly one physical copy at the right version. The install was simply
  **corrupt** — 3414 of 8876 files present, and `_types/` held 121 `.d.ts.map`
  files with zero matching `.d.ts`. A blanket `rm -rf node_modules` reinstall
  had been explicitly rejected earlier in the build, so the repair was done
  additively; the scratch dir was removed afterwards.
- **Worth recording because** the misleading symptom cost real time: a
  version-conflict error and a truncated-extraction error present identically
  at the TypeScript layer. Check file counts before trusting the error text.

## An over-the-wire smoke test, separate from the socket unit tests
- **Chose:** `packages/server/src/e2e.smoke.mjs` — four real socket.io clients
  against the *built* server (`dist/index.js`) at *production* timings.
- **Why:** The vitest socket tests start the server in-process with shortened
  meeting timers, which is right for fast feedback but structurally blind to a
  whole class of failure: wrong build output, env wiring, and protocol drift
  between what the server emits and what the web client subscribes to. This
  one drives the real artefact and asserts the security invariants too
  (mid-game join rejected, out-of-range task claim rejected, the dead cannot
  act) rather than only the happy path.
- **Two bugs it caught were in the test, not the code**, and both were kept as
  documentation: movement must be read off the `positions` channel because full
  snapshots are only sent on structural change; and a fixed heading gets stuck
  sliding along walls, so `walkTo` re-aims every frame.

---

# Visual rebuild pass

A later pass, after the game was finished and green. The map was flat coloured
rectangles and the characters were one static photo-real PNG per skin dragged
around with a left/right flip. Both were rebuilt from drawing primitives under
a hard constraint: **no image generation and no asset downloads of any kind.**
Everything below follows from that constraint plus the rule that game logic,
the wire protocol and the contracts were not to be touched.

## Drawing against a `Pen` interface instead of against Phaser
- **Chose:** All art draws into a small backend-agnostic `Pen` interface
  (`packages/web/src/game/art/pen.ts`) — `fill`, `roundRect`, `poly`,
  `strokePoly`, and so on. `PhaserPen` implements it at runtime; a dev-only
  `SvgPen` in `scripts/preview-art.ts` implements it as an SVG emitter that
  `sharp` rasterises to PNG.
- **Why:** This is the decision the whole pass rests on. There is no headless
  browser in this environment, so without it the only available feedback was
  "the typecheck passes" — which tells you nothing about whether a character's
  head is the right size or whether a wall is sitting across a doorway. Being
  able to *look at the output* turned art from guesswork into iteration.
- **It earned its keep repeatedly.** Rendering, not typechecking, is what
  caught: a wall segment drawn across a doorway; a "cable" that tapered to a
  point in open floor and read as a stray pen stroke; lab stools that read as
  rocks or holes rather than seats (three rewrites, each driven by looking at a
  magnified crop); and those same stools placed exactly on the radius of the
  meeting deck's inlaid ring, where they read as beads on a track.
- **Alternatives considered:** drawing straight into Phaser and shipping blind
  (rejected — unverifiable); installing a headless browser (a large dependency
  for a preview, and the `Pen` seam is useful on its own).

## Wall runs are derived from the collision geometry, not authored
- **Chose:** `wallsFor(rect, others)` computes each slab's wall segments by
  subtracting from every edge the intervals where any *other* slab covers it.
- **Why:** The obvious approach — hand-authoring wall rectangles and cutting
  gaps where the doorways are — encodes the same geometry twice. Since
  corridors overlap into rooms, the union of room and path rects is exactly the
  region `isWalkable` accepts, so deriving from that union means a wall can
  never appear across a passage the server will happily let you walk through.
  Edit the map later and the walls follow; there is no second source of truth
  to forget to update.

## Facing is inferred on the client, not added to the wire protocol
- **Chose:** `resolveFacing()` in `MainScene` picks one of three drawn views
  from the *interpolated* per-frame position delta.
- **Why:** The brief called for true directional rendering, but `PublicPlayer`
  carries only `dir: -1 | 1`. Facing is a view concern, and adding a field for
  it would have changed the protocol for something the client can work out from
  data it already has. Two constants stop it from looking cheap: a deadzone,
  because positions arrive at 20Hz and interpolation noise on a standing player
  is not exactly zero and would twitch the sprite between views; and a vertical
  bias, so a diagonal walk resolves to the side view rather than flickering
  between two facings on consecutive frames.
- **The `side` view is mirrored for left/right, and that flip is honest** — a
  body seen from the side really is near-symmetric. Baking a fourth facing
  would double the texture cost to say the same thing. The flip that was wrong
  before was using it as the *only* facing.

## Corpses always render human
- **Chose:** `drawCorpse` has no infected or Parasite form, and `renderBodies`
  cannot select one.
- **Why:** A visual decision that is really a security one. Bodies are visible
  to everyone who walks past them, so a corpse drawn with infected skin or
  vines would publish the victim's role to the entire lobby — through the art,
  bypassing every protection on the wire and in the contract. Reveal art
  (`infected`, `parasite`) is only ever applied to the local player's own
  sprite, guarded at the one place the variant is chosen. Same rule as the
  crew roster, which has no code path that could render another player's role.

## Props are decoration, and stay out of the way
- **Chose:** Benches, monitors, tanks, planters, crates and stools are baked
  into the map texture. None of them are collidable and none are interactive.
  Rooms are furnished at their edges.
- **Why:** The brief asked for thematic props and explicitly not for new
  interaction logic. Furnishing the edges keeps a prop from ever landing on a
  task station's 56px interact radius and making it unreachable. The meeting
  platform gets no central table — the obvious Among-Us-cafeteria move —
  because `upload-research-data` sits at its exact centre; the preview overlays
  the station radii specifically so this stays checkable by eye.

## One cosmetic field on the shared type
- **Chose:** `RoomVisual` gained `area: AreaId`. Nothing else in `shared` or
  `server` changed.
- **Why:** The client keys its floor treatment off which area a slab belongs
  to, and matching on `name` would have made the art break on a copy edit. The
  brief allowed a shared *purely cosmetic* constant for exactly this. Rules
  code still resolves areas through `AREAS` as it always did, and the 114
  existing tests pass unchanged — which is the check that the field stayed
  cosmetic.

## The lobby portraits were left alone
- **Chose:** `Lobby.tsx`, `MeetingOverlay.tsx`, `EndOverlay.tsx` and
  `CrewList.tsx` still use the sliced PNG portraits.
- **Why:** A still portrait in a character picker is a legitimate use of that
  art — the brief said so, and it is right. Mid-pass I had rewritten
  `CrewList.tsx` to drop them, then reverted it: the same PNGs are used by
  three other components, so the change would have left the HUD roster showing
  CSS silhouettes while the meeting overlay showed photo portraits of the same
  players. Consistency across the surface was worth more than consistency with
  the in-game sprites.
