# Parasite — Inco Track submission

A real-time multiplayer social deduction game in which **the traitor's identity
is encrypted on-chain and the game server cannot read it.**

| | |
|---|---|
| **Play** | `<DOMAIN>` |
| **Contract** | [`0x9013FEFb791591D644088C0618aC922052346619`](https://sepolia.basescan.org/address/0x9013FEFb791591D644088C0618aC922052346619) |
| **Chain** | Base Sepolia (84532) |
| **Inco Lightning** | `0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6` |
| **Players** | 4–10 |

---

## What Inco is actually doing here

Most "on-chain social deduction" games put the roles on a server and call the
result decentralised. Ours does not have that server.

When a game starts, each seat's role is written as an **Inco Lightning
ciphertext**. The only party who can decrypt a given seat's role is the wallet
that holds it — decryption happens **in the player's browser**. In Inco mode
the game server is constructed with **no role oracle at all** (see
`GameServer.roleMode`), so there is no code path by which it could answer the
question "who is the Parasite" even if it wanted to. `RoomState` has no role
field; the serialiser is unit-tested to prove one never leaks.

**The mechanic that needs this:** mid-game, the Parasite can **Jump** into
another living player. The infection moves. Nobody — not the other players, not
the server, not somebody reading every transaction on Basescan — can tell that
a Jump happened, who performed it, or who received it. The player who *was* the
Parasite becomes genuinely innocent and the accused becomes genuinely guilty,
with no trusted party anywhere in the loop.

To keep the Jump indistinguishable on-chain, **every living player's client can
send a Jump transaction**, not only the Parasite's. A human's Jump is turned
into a no-op by the contract. That is deliberate decoy traffic: a button that
only appeared for the Parasite would leak the role to anyone glancing at a
screen, and a transaction that only the Parasite could send would leak it to
anyone reading the chain.

The one thing the contract *does* reveal is a single derived bit on ejection —
"was the ejected player the Parasite's host" — via `e.reveal` on a derived
`ebool`. That is the game's one sanctioned disclosure, and it is the only one.

### Known limitation, stated up front

**Purge is not authorised on-chain.** Jump goes through the contract, so the
encrypted role is what makes it real or a no-op. Purge does not: the server
validates range, cooldown and liveness, but cannot check that the caller is
the Parasite, because in Inco mode it holds no oracle and genuinely cannot
know. Today only the client hides the button from crew members.

The correct fix is to route Purge through the contract the same way Jump
already is. We found this about a day out from the deadline on an otherwise
working build and judged a contract change plus redeploy too risky to attempt
then. It is documented rather than hidden — see `DECISIONS.md`.

---

## Two minutes: what to try

1. Open `<DOMAIN>` and press **Play**. Pick a name, keep the outpost code, join.
2. Open the same link in a few more tabs and join with the same code. Four
   players minimum. Press **Begin the expedition** from the first tab.
3. Top-left badge reads **CONNECT WALLET** in Inco mode — tap it, connect a
   Base Sepolia wallet, and your role decrypts in your browser. It will say
   HUMAN or PARASITE. Nobody else's client, and no server, has that value.
4. Move with **WASD / arrows**, or drag anywhere on the left of the screen on a
   phone. Walk onto a lit station and press **USE** to run a task.
5. Press **MEET** to call an emergency meeting. Discussion, then a vote.
6. If you are the Parasite: walk next to someone and press **PURGE**, or
   **JUMP** to move the infection into them.

Also worth a look: **`/gallery`** renders every character the game can draw —
four scientists across three facings, ten crew colours, the walk cycle, the
infected and Parasite forms, and the corpses. None of it is image files; it is
all drawn from primitives at runtime.

---

## Running it from a clean clone

```bash
npm ci
cp .env.example .env      # works as-is in simulated mode
npm run dev               # server on 9101, web on 9100
```

For real Inco mode, set `DEPLOYER_PRIVATE_KEY` to a Base Sepolia key with
testnet ETH, then:

```bash
npm run compile:contracts
npm run deploy:baseSepolia
# put the printed address in NEXT_PUBLIC_PARASITE_GAME_ADDRESS
```

`npm test` covers the shared rules, the server over real sockets, and the
contract.

---

## Where the interesting code is

| Path | What |
|---|---|
| `packages/contracts/contracts/ParasiteGame.sol` | Encrypted roles, the Jump, the single ejection reveal |
| `packages/web/src/hooks/useRole.ts` | Browser-side decryption of your own role |
| `packages/server/src/GameRoom.ts` | Authoritative rules. Note the absence of any role oracle in Inco mode |
| `packages/shared/src/constants.ts` | The rules both client and server share verbatim, so they cannot disagree |
| `packages/web/src/game/art/` | The entire visual layer, drawn from primitives — no image assets |

`DECISIONS.md` is a running log of every ambiguity and how it was resolved,
including the ones we got wrong first. `DESIGN.md` is the visual system.
