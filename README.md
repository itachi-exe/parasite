# Parasite

A real-time multiplayer social deduction game where **the traitor's identity is
encrypted on-chain**, not held by a server.

Built for the **Inco Track** of the Inco x Megapot Summer Game Jam.

Four to ten players wake on a derelict research station. One of them is not
human. The crew completes tasks to win; the Parasite purges them one at a time.
Bodies get reported, meetings get called, and someone gets voted into space.

The twist that needs a blockchain: **the Parasite can Jump**. Mid-game, the
Parasite transfers the infection to another living player. Nobody — not the
other players, not the game server, not an observer reading every transaction —
can tell that it happened, who did it, or who received it. The player who was
the Parasite genuinely becomes innocent, and the accused genuinely becomes
guilty, with no trusted party anywhere in the loop.

---

## Why this needs FHE and not just a private server

A normal game server *could* hide the roles. The reason it isn't good enough is
that every player has to take the server's word for it. With Inco Lightning the
role is an `euint256` handle on Base Sepolia:

- **Only you can read your own role.** `myRoleHandle(gameId)` is scoped to
  `msg.sender`, and decrypting it requires your wallet's EIP-712 signature. The
  server never sees a role. There is no admin key that can.
- **The Jump has no observable signature.** Jumping cannot be gated with
  `require(isParasite)` — a revert is a side channel, and a transaction that
  only succeeds for the Parasite identifies them. Instead the contract runs
  `hostSeat = e.select(callerIsHost, targetSeat, hostSeat)` for *everybody*.
  A non-Parasite's jump is a silent, successful no-op.
- **Everyone sends jumps.** The client emits decoy jumps on a jitter, so the
  existence of a jump transaction says nothing about the sender. Real jumps and
  decoys are byte-identical, emit the same event shape, and burn identical gas
  — all three are asserted in the test suite.
- **Exactly one bit is ever revealed.** On ejection the contract publishes
  `e.eq(hostSeat, ejectedSeat)` — "was this seat the Parasite?" — and nothing
  else. A "no" leaves the Parasite hidden among everyone still alive.

---

## Running it locally

Requires Node 20+.

```bash
npm install
npm run build:shared     # the server and web both import @parasite/shared
npm run dev              # server on 127.0.0.1:9101, web on 127.0.0.1:9100
```

Open **http://127.0.0.1:9100** in four tabs, enter the same room code, and hit
Start. It also runs with no wallet and no deployed contract, see the two modes
below.

### The two role modes

The app boots in whichever mode its configuration supports, and the HUD badge
always states which one is live. It never silently pretends.

| | **Simulated** (default) | **Inco** |
|---|---|---|
| Set by | no `NEXT_PUBLIC_PARASITE_GAME_ADDRESS` | that variable set to a deployed address |
| Roles come from | the server, sent privately per-socket | `myRoleHandle` + `attestedDecrypt` |
| Jump | server-side transfer | on-chain `jump()` with encrypted target |
| Wallet needed | no | yes (Base Sepolia) |
| Trust model | **you trust the server** | **you trust nobody** |

Simulated mode exists so the game is playable and reviewable in one command.
It is not the point of the project; it's the fallback that keeps the project
demonstrable without a funded key.

### Deploying the contract (needs a funded key)

```bash
cp .env.example .env
# set DEPLOYER_PRIVATE_KEY to a Base Sepolia key with testnet ETH
npm run compile:contracts
npm run deploy:baseSepolia
# put the printed address in NEXT_PUBLIC_PARASITE_GAME_ADDRESS, then npm run dev
```

### Live deployment

**Inco mode is deployed and running.**

| | |
|---|---|
| Contract | [`0xe304aCd0DFdAe69B5480b7caB45c412dd45A04C6`](https://sepolia.basescan.org/address/0xe304aCd0DFdAe69B5480b7caB45c412dd45A04C6) |
| Chain | Base Sepolia (84532) |
| Inco Lightning | `0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6` |

The contract is pre-funded with 0.001 ETH for FHE fees. The running instance
reports `role mode INCO (on-chain encrypted roles)` at boot, and the server
holds no oracle in that mode — it cannot derive anyone's role.

Players need a wallet on Base Sepolia to decrypt their own role; the role badge
in the top bar prompts for one and does the decryption in the browser.

---

## Tests

```bash
npm test          # shared rules, server sockets, contracts
npm run typecheck
```

There is also an over-the-wire smoke test that drives the *built* server with
four real socket clients at production timings:

```bash
npm run build
node packages/server/dist/index.js &          # binds 127.0.0.1:9101
node packages/server/src/e2e.smoke.mjs
```

---

## Layout

```
packages/shared      game rules, wire protocol, RoleOracle seam   (~900 loc)
packages/server      authoritative Socket.io server, 20Hz tick   (~2300 loc)
packages/web         Next.js 15 + Phaser 3 client                (~2500 loc)
packages/contracts   ParasiteGame.sol + Hardhat harness          (~1500 loc)
docs/inco.md         distilled Inco Lightning reference
```

The server is deliberately **role-ignorant** in Inco mode: it runs movement,
proximity, meetings and voting, and it is not told who the Parasite is. That
split is the whole architecture — the server owns physics, the chain owns
secrets.
