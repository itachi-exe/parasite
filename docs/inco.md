# Inco Lightning — working reference for Parasite

Distilled from https://docs.inco.org (pages listed in `llms.txt`) **and verified
against the actual installed `@inco/lightning@1.0.2` package sources**, because
the published docs are incomplete in a few places that matter. Where the docs
and the package disagree, the package wins and it is called out below.

---

## 1. Package + import

```
npm install @inco/lightning        # Solidity
npm install @inco/lightning-js     # client SDK
```

Canonical import (from `guide/input.md`):

```solidity
import {euint256, ebool, eaddress, e} from "@inco/lightning/src/Lib.sol";
using e for *;
```

`pragma solidity ^0.8;` — taken from `Lib.sol` itself, which is `^0.8`, so any
0.8.x works. We pin 0.8.24.

### ⚠️ `Lib.sol` is the MAINNET library

This is the single most dangerous thing in the package and it is not flagged in
the docs. Each `Lib.*.sol` variant hardcodes a different `IncoLightning` address:

| File | `inco` constant |
|---|---|
| `Lib.sol` (default) | `0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624` |
| `Lib.mainnet.sol` | `0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624` ← same as default |
| **`Lib.testnet.sol`** | **`0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6`** ← Base Sepolia |
| `Lib.devnet.sol` | `0xB3C06f0Ed967a7E366ba31C67927DDf93d7c1154` |
| `Lib.demonet.sol` | `0xad9Af2e804FbF14d69391167F1FCDf918A3980fb` |
| `Lib.alphanet.sol` | `0xc0d693DeEF0A91CE39208676b6da09B822abd199` |

Importing the default `Lib.sol` and deploying to Base Sepolia gives you a
contract that compiles and deploys fine, then reverts on the first FHE
operation, because there is no IncoLightning contract at the mainnet address on
Base Sepolia. **We import `Lib.testnet.sol`**, behind a single re-export in
`contracts/src/incoLib.sol` so switching networks is a one-line change.

---

## 2. Types

Only three encrypted scalar types exist. There is **no** `euint8`/`euint32`/
`euint64` — the platform standardised on 256-bit.

- `ebool`
- `euint256`
- `eaddress`
- `elist` — an encrypted list (used by ConfidentialDeck for the deck)

A value of one of these types is a **handle** (a `bytes32`), not the data. The
ciphertext lives in Inco's TEE; the chain only ever holds the handle. Handles
are immutable: any operation produces a *new* handle.

---

## 3. Operations (`library e`, verified against `Lib.sol`)

Arithmetic → `euint256`: `add sub mul div rem`
Bitwise → `euint256` or `ebool`: `and or xor shr shl rotr rotl`
Comparison → `ebool`: `eq ne` (on `euint256`, `eaddress`, and mixed
plain/encrypted), `ge gt le lt min max` (`euint256` only)
Unary: `not(ebool)`

Overloads let either operand be plaintext, e.g. `e.eq(euint256 a, uint256 b)`
and `e.eq(eaddress a, address b)` both exist. This is what lets us compare an
encrypted seat against a loop counter cheaply.

### Multiplexer — the replacement for `if`

```solidity
function select(ebool control, euint256 ifTrue, euint256 ifFalse) internal returns (euint256);
function select(ebool control, ebool    ifTrue, ebool    ifFalse) internal returns (ebool);
function select(ebool control, eaddress ifTrue, eaddress ifFalse) internal returns (eaddress);
```

### Randomness (costs a fee)

```solidity
function rand() internal returns (euint256);
function randBounded(uint256 upperBound) internal returns (euint256);
function randBounded(euint256 upperBound) internal returns (euint256);
```

---

## 4. Control flow — the rule that shapes the whole design

From `guide/control-flow.md`, verbatim:

> "You can't use an if/else statement with a condition depending on a private
> value." — because "The flow that the program would take would leak
> information about the private value."

and

> you "can't revert a transaction based on a condition depending on a private
> value."

So: **no `if`, no `require`, no `revert` on anything derived from an encrypted
value.** You compute both branches and `select` between them. The docs' own
example, where an overdrawn transfer moves zero rather than reverting:

```solidity
function _transfer(address to, euint256 value) internal returns (ebool success) {
    success = balanceOf[msg.sender].ge(value);
    euint256 transferredValue = success.select(value, uint256(0).asEuint256());
    // ... rest of the transfer logic
}
```

> "Expect this kind of logic in most confidential apps."

**This is exactly why Parasite's `jump()` is callable by everyone.** We cannot
`require(callerIsParasite)` — that would leak the Parasite via the revert. So a
non-Parasite's jump computes `select(false, target, currentHost)` and writes the
host seat back unchanged: a silent, gas-identical no-op.

---

## 5. Encrypted inputs from the client

Contract side (`guide/input.md`). Note the parameter is `bytes memory`, the
function is `payable`, and a fee must be paid **per ciphertext consumed**:

```solidity
function transfer(
        address to,
        bytes memory valueInput
    ) external payable returns (ebool) {
```

```solidity
require(msg.value >= inco.getFee() * 1, "Fee Not Paid");
```

Conversion — because of `using e for *;` these read as methods on the bytes:

```solidity
euint256  value          = valueInput.newEuint256(msg.sender);
eaddress  authorizedAddr = addressInput.newEaddress(msg.sender);
ebool     flag           = flagInput.newEbool(msg.sender);
```

The second argument is the input's originator. Docs: it "should always be the
one that created the input" and it receives decryption rights; passing anything
else is "a malicious implementation."

Both arities exist in `Lib.sol`:
```solidity
function newEuint256(bytes memory ciphertext) internal returns (euint256);
function newEuint256(bytes memory ciphertext, address user) internal returns (euint256);
```

Trivial encryption of an already-public value:
```solidity
balanceOf[msg.sender] = uint256(1000 * 1e9).asEuint256();
isActive = true.asEbool();
```

### Two behaviours worth knowing
- **Malformed / replayed input does not revert.** It silently degrades to a
  default (`0` / `false`). A ciphertext used outside the account+chain+contract
  it was bound to hits the same path. So you cannot detect a bad input by
  catching a revert.
- Handles are usable immediately; real decryption happens later in the TEE via
  "symbolic execution".

---

## 6. Access control — the actual privacy boundary

From `guide/guide-access-control.md`. Access is per-ciphertext, per-address, and
**visible on-chain** (who may decrypt is public; the value is not).

```solidity
function allow(euint256 a, address to) internal;   // + ebool, eaddress, elist
function allowThis(euint256 a) internal;           // alias for allow(a, address(this))
function reveal(euint256 a) internal;              // makes it public, irreversible
function isAllowed(address user, euint256 a) internal view returns (bool);
```

Rules that bite:
1. `e.allow` grants **permanent** access — "seeing, publicly decrypting and
   computing over the ciphertext". There is no revoke. Granting to the wrong
   address is, in ConfidentialDeck's words, "a one-line leak."
2. **Handles are immutable, so grants do not follow updates.** After you write a
   new value the handle changes and you must re-grant. This is why Parasite
   re-grants every seat's role bit after every jump.
3. `allowThis` is the "common mistake" — forget it and your own contract cannot
   compute over its own stored value on a later transaction. Operation results
   are only *transiently* allowed to the calling contract.
4. Treat any address that ever had access as knowing the value forever. Do not
   treat transient grants as safer than permanent ones.
5. Transient allowance as an explicit API is "not yet available in the SDK".

---

## 7. Fees

`inco.getFee()` returns the per-op fee. `Lib.sol` internally caches it in a
custom storage slot (`keccak256("inco.fee")`) and has a retry path
(`_callWithFeeRetry`) that refreshes the cached fee and retries once if a call
fails — so a fee change does not brick a contract. Practically:

- Any function that consumes ciphertexts or does FHE ops must be `payable`.
- Guard with `require(msg.value >= inco.getFee() * N, "Fee Not Paid")` where N
  is the number of ciphertexts consumed.
- The contract pays Inco out of its **own balance**, so it needs to actually
  hold the ETH — forward `msg.value` or pre-fund to sponsor players.
- `e.rand()`/`randBounded()` cost a fee. ConfidentialDeck's shuffle costs
  `2 * inco.getEListFee(n, ETypes.Uint256)` (range + shuffle).

---

## 8. JS SDK (`@inco/lightning-js`)

```ts
import { handleTypes, getViemChain, supportedChains } from '@inco/lightning-js';
import { Lightning } from '@inco/lightning-js/lite';
import { createWalletClient, type Address } from 'viem';
```

Instantiate once:
```ts
const chainId = supportedChains.baseSepolia;
const zap = await Lightning.baseSepoliaTestnet({
  hostChainRpcUrls: ['https://your-rpc-url'],
});
```
(`Lightning.baseMainnet()` for mainnet. Pass your own RPC or viem's public RPC
is used.)

### Encrypt
```ts
const ct = await zap.encrypt(value, {
  accountAddress: walletClient.account.address,
  dappAddress,
  handleType: handleTypes.euint256,   // | handleTypes.ebool | handleTypes.euint160
});
```
`euint160` is the address type — wrap the address in `BigInt(address)` first.
Returns a hex ciphertext you pass straight into the `bytes memory` param.

### Decrypt (what you were granted)
```ts
const results = await zap.attestedDecrypt(walletClient, ["0x<handle>" as HexString]);
const value = results[0].plaintext.value;
```
Positional array matching the input handles. Only handles allowed via
`e.allow()` or `e.reveal()` are decryptable. Options include `backoffConfig`
(`maxRetries`, `baseDelayInMs`, `backoffFactor`) and delegate re-encryption via
`reencryptPubKey`.

Session keys (avoids a wallet signature per decrypt):
```ts
const voucher = await zap.grantSessionKeyAllowanceVoucher(
  walletClient, ephemeralAccount.address, expiresAt, defaultSessionVerifier);
await zap.attestedDecryptWithVoucher(ephemeralAccount, voucher, [handle]);
```
Documented default verifier: `0xc34569efc25901bdd6b652164a2c8a7228b23005`.

---

## 9. ConfidentialDeck patterns we borrow

Setup:
```solidity
import {euint256, elist, ETypes, e, inco} from "@inco/lightning/src/Lib.sol";
using e for *;
```

The five moves, and which ones Parasite uses:

| Move | Deck idiom | Parasite |
|---|---|---|
| Shuffle | `e.shuffledRange(1, n+1, ETypes.Uint256)` | ✗ — we need one secret index, not a permutation. `e.randBounded(n)` is one op instead of a paid list shuffle. |
| Draw | `e.getEuint256(deck, index)` | ✗ |
| **Deal privately** | `card.allowThis(); card.allow(player);` | ✓ **This is the whole hidden-role mechanic.** Each seat's role `ebool` is allowed to exactly that seat's address. |
| Deal face-up | `card.allowThis(); e.reveal(card);` | ✓ — used at the two sanctioned reveal points (ejection bit, game over). |
| Settle | `require(e.verifyDecryption(card, value, sigs), "bad attestation");` | ✓ — pattern used for submitting a verified reveal back on-chain. |

The two failure modes it warns about, both of which we hit while building:
- "always call `allowThis()` on anything you store" — an unreachable handle is
  "lost forever";
- never branch, `require`, or reveal early on an encrypted value.

---

## 10. What this means for Parasite's design

| Value | Encrypted? | Who can decrypt | When |
|---|---|---|---|
| Player positions, task progress, meetings, votes | No | Everyone | Always — public by the rules |
| Per-seat role bit (`isParasite`) | **Yes** (`ebool`) | Only that seat's wallet | From assignment onward |
| Current host seat (who the Parasite *is now*) | **Yes** (`euint256`) | Only the contract + the current host | Re-granted on every jump |
| "Was the ejected player the Parasite" | Derived `ebool`, then `e.reveal` | Everyone | Only at ejection |
| Final host seat | `e.reveal` | Everyone | Only at game over |

The Jump, precisely:
1. Every player's client periodically submits a `jump(bytes encryptedTargetSeat)`
   tx — real ones from the Parasite, decoys from everyone else, on a jitter.
2. The contract computes `ebool isParasite = e.eq(hostSeat, callerSeat)` and
   `hostSeat = e.select(isParasite, targetSeat, hostSeat)`.
3. It re-grants: new `hostSeat` to the contract and to each seat's role bit
   holder as appropriate.
4. Nothing is emitted that distinguishes a real jump from a decoy. Same
   calldata shape, same events, same gas class.

That is the property the spec asks for: "other players should have no on-chain
or client-visible signal of who the Parasite currently is."
