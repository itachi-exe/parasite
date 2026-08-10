// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ETypes} from "@inco/lightning/src/Types.sol";

/**
 * @title MockIncoLightning
 * @notice A PLAINTEXT stand-in for the IncoLightning singleton, for local tests.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Inco's real test harness needs their Dockerised FHE devnet, and Docker is not
 * available on this build machine. The alternative was shipping zero contract
 * tests, which is unacceptable for the piece of the project being judged.
 *
 * So: this mock implements the subset of `IncoLightning`'s ABI that the Inco
 * Lightning `Lib.testnet.sol` actually calls, over plaintext values.
 * In tests it is injected at the library's hardcoded testnet address
 * (0xe9CB...41B6) with `hardhat_setCode`, which means **ParasiteGame is tested
 * completely unmodified** — same source, same imports, same call sequence as the
 * contract we would deploy to Base Sepolia. Only the callee is swapped.
 *
 * ── What this DOES prove ─────────────────────────────────────────────────────
 *   • ParasiteGame's control flow and seat bookkeeping are correct.
 *   • The select-based jump really is a no-op for non-hosts and really does
 *     move the host for the Parasite.
 *   • Access grants are issued to exactly the right addresses, and re-issued
 *     after every jump (the immutable-handle trap).
 *   • Real jumps and decoy jumps emit identical events and touch identical
 *     state, which is the confidentiality claim.
 *
 * ── What this does NOT prove ─────────────────────────────────────────────────
 *   • That FHE itself is correct (it is Inco's, not ours).
 *   • That real ciphertexts round-trip through the covalidator.
 *   • That the covalidator enforces access grants the way the docs describe.
 *
 * Those need the Inco devnet or a live Base Sepolia deployment. Stated plainly
 * in BUILD_REPORT.md — this mock is a test double, not evidence of encryption.
 *
 * ── How the encoding works ───────────────────────────────────────────────────
 *
 * A real handle is an opaque pointer to a ciphertext held in Inco's TEE. Here a
 * "handle" is just a key into a plaintext mapping.
 *
 * Handles are allocated from a MONOTONIC COUNTER, so every operation yields a
 * brand-new, unique handle even when the underlying value is unchanged. That
 * matches real Inco, where each op produces a fresh ciphertext, and it matters
 * for two reasons that an earlier content-addressed version of this mock got
 * wrong:
 *
 *   1. Two seats whose role bit is both `false` must NOT share a handle.
 *      Content-addressing collapsed them into one, which made "seat 1 can
 *      access seat 0's bit" look true when it is not.
 *   2. A decoy jump must write genuinely new handles to storage, exactly like a
 *      real jump. With content-addressing a decoy re-derived identical handles,
 *      turning its SSTOREs into cheap no-op writes and creating a ~13% gas gap
 *      that would have fingerprinted real jumps — an artefact of the mock, not
 *      of the contract.
 */
contract MockIncoLightning {
    // handle => plaintext value
    mapping(bytes32 => uint256) public values;
    // handle => account => allowed
    mapping(bytes32 => mapping(address => bool)) public allowed;
    // handle => publicly revealed
    mapping(bytes32 => bool) public revealed;

    uint256 public constant FEE = 1000 wei;

    /// Deterministic pseudo-randomness for eRandBounded, settable by tests.
    uint256 public randSeed;
    bool public randSeedForced;

    event Allowed(bytes32 indexed handle, address indexed account);
    event Revealed(bytes32 indexed handle);

    // ── test helpers (not part of the real ABI) ──────────────────────────────

    function setRandSeed(uint256 s) external {
        randSeed = s;
        randSeedForced = true;
    }

    function plaintextOf(bytes32 handle) external view returns (uint256) {
        return _load(handle);
    }

    function isRevealed(bytes32 handle) external view returns (bool) {
        return revealed[handle];
    }

    // ── handle construction ──────────────────────────────────────────────────

    /// Monotonic handle allocator — guarantees every op yields a fresh handle.
    uint256 public handleCounter;

    /**
     * @dev Values are stored OFFSET BY ONE, and this is load-bearing.
     *
     * A naive `values[h] = value` makes storing 0 free (zero→zero, no SSTORE)
     * while storing 1 costs a 20k cold SSTORE. That asymmetry leaks the
     * plaintext through gas — and it produced a measurable ~2.5% gas gap between
     * a real jump and a decoy, because a real jump's `e.eq(hostSeat, callerSeat)`
     * yields 1 and a decoy's yields 0.
     *
     * That gap is an artefact of THIS MOCK, not of ParasiteGame. On real Inco the
     * chain only ever stores an opaque bytes32 handle; the plaintext lives in the
     * TEE and never touches an SSTORE, so the cost cannot depend on the value.
     *
     * Offsetting by one makes every store a uniform zero→nonzero write, which
     * restores the property the real network has and lets the gas-fingerprint
     * test measure the contract instead of the test double.
     */
    function _store(uint256 value, uint8 typeTag) internal returns (bytes32 h) {
        h = keccak256(abi.encodePacked(++handleCounter, typeTag));
        unchecked {
            values[h] = value + 1; // never zero ⇒ uniform SSTORE cost
        }
        // Mirror Inco's transient-allow-to-caller behaviour for op results, so
        // contracts that forget allowThis() still work within one transaction
        // and only break across transactions — same as the real thing.
        allowed[h][msg.sender] = true;
    }

    /// @dev Undo the +1 offset. Unset handles read as 0.
    function _load(bytes32 h) internal view returns (uint256) {
        uint256 raw = values[h];
        unchecked {
            return raw == 0 ? 0 : raw - 1;
        }
    }

    // ── trivial encryption ───────────────────────────────────────────────────

    function asEuint256(uint256 value) external returns (bytes32) {
        return _store(value, 1);
    }

    function asEbool(bool value) external returns (bytes32) {
        return _store(value ? 1 : 0, 2);
    }

    function asEaddress(address value) external returns (bytes32) {
        return _store(uint256(uint160(value)), 3);
    }

    // ── client inputs ────────────────────────────────────────────────────────
    // The real newEuint256 takes an opaque ciphertext. Tests encode the
    // plaintext with abi.encode(uint256) so the mock can read it back.

    function newEuint256(bytes calldata ciphertext, address /*user*/ )
        external
        payable
        returns (bytes32)
    {
        uint256 v = ciphertext.length >= 32 ? abi.decode(ciphertext, (uint256)) : 0;
        return _store(v, 1);
    }

    function newEbool(bytes calldata ciphertext, address /*user*/ ) external payable returns (bytes32) {
        uint256 v = ciphertext.length >= 32 ? abi.decode(ciphertext, (uint256)) : 0;
        return _store(v != 0 ? 1 : 0, 2);
    }

    function newEaddress(bytes calldata ciphertext, address /*user*/ )
        external
        payable
        returns (bytes32)
    {
        uint256 v = ciphertext.length >= 32 ? abi.decode(ciphertext, (uint256)) : 0;
        return _store(v, 3);
    }

    // ── operations ───────────────────────────────────────────────────────────

    function eEq(bytes32 lhs, bytes32 rhs) external returns (bytes32) {
        return _store(_load(lhs) == _load(rhs) ? 1 : 0, 2);
    }

    function eNe(bytes32 lhs, bytes32 rhs) external returns (bytes32) {
        return _store(_load(lhs) != _load(rhs) ? 1 : 0, 2);
    }

    function eIfThenElse(bytes32 control, bytes32 ifTrue, bytes32 ifFalse) external returns (bytes32) {
        return _store(_load(control) != 0 ? _load(ifTrue) : _load(ifFalse), 1);
    }

    function eNot(bytes32 operand) external returns (bytes32) {
        return _store(_load(operand) != 0 ? 0 : 1, 2);
    }

    function eAdd(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) + _load(b), 1);
    }

    function eSub(bytes32 a, bytes32 b) external returns (bytes32) {
        uint256 x = _load(a);
        uint256 y = _load(b);
        return _store(x >= y ? x - y : 0, 1);
    }

    function eMul(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) * _load(b), 1);
    }

    function eBitAnd(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) & _load(b), 2);
    }

    function eBitOr(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) | _load(b), 2);
    }

    function eBitXor(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) ^ _load(b), 2);
    }

    function eGe(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) >= _load(b) ? 1 : 0, 2);
    }

    function eGt(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) > _load(b) ? 1 : 0, 2);
    }

    function eLe(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) <= _load(b) ? 1 : 0, 2);
    }

    function eLt(bytes32 a, bytes32 b) external returns (bytes32) {
        return _store(_load(a) < _load(b) ? 1 : 0, 2);
    }

    function eCast(bytes32 ct, ETypes /*toType*/ ) external returns (bytes32) {
        return _store(_load(ct), 1);
    }

    /**
     * Deterministic "randomness". Real Inco samples uniformly inside the TEE.
     * Tests pin this with setRandSeed() so the chosen Parasite is knowable to
     * the test but never to the contract's callers.
     */
    function eRandBounded(bytes32 upperBound, ETypes /*randType*/ ) external payable returns (bytes32) {
        uint256 bound = _load(upperBound);
        uint256 raw = randSeedForced
            ? randSeed
            : uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, randSeed)));
        uint256 v = bound == 0 ? raw : raw % bound;
        return _store(v, 1);
    }

    // ── access control ───────────────────────────────────────────────────────

    function allow(bytes32 handle, address account) external {
        allowed[handle][account] = true;
        emit Allowed(handle, account);
    }

    function reveal(bytes32 handle) external {
        revealed[handle] = true;
        emit Revealed(handle);
    }

    function isAllowed(bytes32 handle, address account) external view returns (bool) {
        return allowed[handle][account] || revealed[handle];
    }

    // ── fees ─────────────────────────────────────────────────────────────────

    function getFee() external pure returns (uint256) {
        return FEE;
    }

    function getEListFee(uint256 n, ETypes /*t*/ ) external pure returns (uint256) {
        return FEE * n;
    }

    receive() external payable {}
}
