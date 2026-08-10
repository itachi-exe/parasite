
## Gas as a side channel in `jump` (found by a failing test)
- **Chose:** Keep the uniform-cost design, and fix the *mock* that was leaking.
- **Why:** The "identical gas for real jumps and decoys" test failed three
  times, and each failure was worth chasing rather than relaxing the
  threshold:
  1. **13% gap** — the mock content-addressed handles as `keccak(value, type)`,
     so a decoy re-derived identical handles and its `SSTORE`s degraded to
     cheap no-op writes. Fixed by allocating handles from a monotonic counter,
     which also matches real Inco (every op yields a fresh ciphertext). This
     same bug had made two seats with `false` role bits *share a handle*,
     which made an access-control test wrongly report that seat 1 could read
     seat 0's bit.
  2. **7% gap** — the test compared jump #1 against jump #2 in the same game,
     conflating storage warmth with role. Rewritten to compare two freshly
     created, structurally identical games where the only difference is
     whether the caller is the host.
  3. **2.45% gap (19,881 gas ≈ one cold SSTORE)** — the mock stored plaintext,
     and `values[h] = 0` is a free write while `= 1` costs 20k. A real jump's
     `e.eq(hostSeat, callerSeat)` yields 1; a decoy's yields 0. Fixed by
     storing values offset by one so every write is uniformly zero→nonzero.
- **Why this matters:** the leak was in the test double, not in `ParasiteGame`.
  On real Inco the chain only ever stores an opaque `bytes32` handle and the
  plaintext never touches an `SSTORE`, so cost cannot depend on the value. But
  the failing test was still the right thing to have written — it is the only
  check that the confidentiality claim holds at the gas level, and a laxer
  threshold would have hidden all three bugs.
- **Alternatives considered:** Loosening the assertion to `< 15%` (would have
  passed immediately and proven nothing); deleting the test (the spec
  explicitly forbids making the suite look green that way).
