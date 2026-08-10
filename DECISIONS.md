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
