// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint256, ebool, eaddress, e, inco} from "@inco/lightning/src/Lib.testnet.sol";

/**
 * @title ParasiteGame
 * @notice Confidential hidden-role state for Parasite, a social deduction game.
 *
 * ── What this contract is for ────────────────────────────────────────────────
 *
 * The public game (positions, tasks, meetings, votes) runs on a Socket.io
 * server at 20Hz and never touches the chain — that state is public by the
 * rules of the genre, and encrypting it would buy nothing while making the game
 * unplayable at Base block times.
 *
 * This contract owns exactly the part that must stay secret:
 *
 *   1. WHO IS THE PARASITE      — an encrypted seat index (`_hostSeat`)
 *   2. EACH PLAYER'S ROLE BIT   — an encrypted bool per seat, readable only by
 *                                 that seat's own wallet
 *   3. THE JUMP                 — moving the Parasite from one body to another
 *                                 without anyone, including this contract's own
 *                                 event log, learning that it happened
 *
 * ── The core problem, and why `jump` is callable by everyone ─────────────────
 *
 * Inco forbids branching or reverting on an encrypted value, because the
 * transaction's success/failure is a public channel that leaks the value
 * (docs/inco.md §4). So `jump()` CANNOT do the obvious thing:
 *
 *      require(msg.sender == parasite);   // ← would broadcast the Parasite
 *
 * Instead every seat may call `jump()`, and the contract resolves entitlement
 * homomorphically:
 *
 *      ebool callerIsHost = e.eq(_hostSeat, callerSeat);
 *      _hostSeat = e.select(callerIsHost, targetSeat, _hostSeat);
 *
 * A non-Parasite's jump writes the host seat back to its current value: a
 * silent, gas-identical no-op. Combined with clients emitting decoy jumps on a
 * jitter, an observer with a full node and every event log still cannot
 * distinguish the Parasite's real jump from six other players' cover traffic.
 *
 * That is the property the game needs: "other players should have no on-chain
 * or client-visible signal of who the Parasite currently is."
 *
 * ── What is deliberately revealed, and when ──────────────────────────────────
 *
 * Two disclosures, both required by the rules of the game:
 *
 *   • On ejection — `revealEjection(seat)` reveals ONE derived bit: "was this
 *     seat the host?" It never reveals `_hostSeat` itself, so a "no" leaves the
 *     Parasite hidden among everyone still alive.
 *   • At game over — `revealHost()` reveals `_hostSeat` outright.
 *
 * Nothing else is ever revealed. See DECISIONS.md for the full disclosure table.
 */
contract ParasiteGame {
    using e for *;

    // ── Limits (mirrors packages/shared/src/constants.ts) ────────────────────
    uint256 public constant MIN_PLAYERS = 4;
    uint256 public constant MAX_PLAYERS = 10;

    enum Status {
        None,
        Active,
        Ended
    }

    struct Game {
        Status status;
        address creator;
        uint64 createdAt;
        /// Public roster. Who is playing is public; what they are is not.
        address[] seats;
        /**
         * ENCRYPTED: the seat index currently hosting the Parasite.
         * Only this contract and the current host are granted access.
         */
        euint256 hostSeat;
        /**
         * ENCRYPTED per seat: "is this seat the Parasite right now?"
         * Seat i's bit is granted to seats[i] and to nobody else.
         */
        mapping(uint256 => ebool) roleBit;
        /// Monotonic counter, bumped on every jump — real or decoy, no distinction.
        uint64 jumpNonce;
        /// Ejection reveals: seat => the revealed ebool handle ("was host?").
        mapping(uint256 => ebool) ejectionReveal;
        mapping(uint256 => bool) ejectionRevealed;
        /// Set once at game over.
        bool hostRevealed;
    }

    mapping(uint256 => Game) private _games;
    uint256 public nextGameId = 1;

    // ── Events ───────────────────────────────────────────────────────────────
    // NOTE: no event in this contract ever carries role information. `Jumped`
    // in particular is emitted identically for real jumps and decoys, and
    // deliberately does NOT include the target seat — including it would leak
    // the Parasite's intended destination even though the move itself is
    // hidden.

    event GameCreated(uint256 indexed gameId, address indexed creator, uint256 playerCount);
    event RolesAssigned(uint256 indexed gameId);
    /// @dev caller is public (it is just "someone sent a tx"), effect is not.
    event Jumped(uint256 indexed gameId, address indexed caller, uint64 nonce);
    event EjectionRevealRequested(uint256 indexed gameId, uint256 indexed seat);
    event HostRevealed(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId);

    // ── Errors ───────────────────────────────────────────────────────────────
    error BadPlayerCount(uint256 given);
    error GameNotActive(uint256 gameId);
    error NotAPlayer(address who);
    error DuplicatePlayer(address who);
    error ZeroAddressPlayer(uint256 seat);
    error SeatOutOfRange(uint256 seat);
    error FeeNotPaid(uint256 provided, uint256 required);
    error AlreadyRevealed();

    // ─────────────────────────────────────────────────────────────────────────
    // Game creation + encrypted role assignment
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a game and secretly assign the Parasite.
     *
     * The Parasite is chosen ON-CHAIN with `e.randBounded(n)`. Nobody — not the
     * caller, not the game server, not this contract — learns the result in
     * plaintext. The caller pays the FHE fee for the whole assignment.
     *
     * Access grants performed here:
     *   • hostSeat  → this contract (so it can compute on it later) and the
     *                 current host (so the Parasite can read their own state).
     *   • roleBit[i] → seats[i] only. This single line is the entire hidden-role
     *                 mechanic; ConfidentialDeck calls granting it to the wrong
     *                 address "a one-line leak".
     *
     * @param players Seat roster. Index in this array IS the seat number.
     */
    function createGame(address[] calldata players) external payable returns (uint256 gameId) {
        uint256 n = players.length;
        if (n < MIN_PLAYERS || n > MAX_PLAYERS) revert BadPlayerCount(n);

        // Reject zero and duplicate addresses. A duplicate would mean two seats
        // share a wallet, and that wallet could decrypt both role bits — which
        // for a 4-player game is a meaningful information advantage.
        for (uint256 i = 0; i < n; i++) {
            if (players[i] == address(0)) revert ZeroAddressPlayer(i);
            for (uint256 j = i + 1; j < n; j++) {
                if (players[i] == players[j]) revert DuplicatePlayer(players[i]);
            }
        }

        // Fee: 1 rand + 1 eq + 1 select per seat, plus slack. Overpayment stays
        // in the contract to fund later jumps rather than being refunded — jumps
        // are frequent and a stranded contract mid-game is worse than dust.
        uint256 required = inco.getFee() * (2 * n + 4);
        if (msg.value < required) revert FeeNotPaid(msg.value, required);

        gameId = nextGameId++;
        Game storage g = _games[gameId];
        g.status = Status.Active;
        g.creator = msg.sender;
        g.createdAt = uint64(block.timestamp);
        for (uint256 i = 0; i < n; i++) {
            g.seats.push(players[i]);
        }

        // The secret draw. Uniform over [0, n).
        euint256 host = e.randBounded(n);
        g.hostSeat = host;
        e.allowThis(host); // MUST: without this we cannot compute on it next tx.

        _grantRoleBits(g, gameId);

        emit GameCreated(gameId, msg.sender, n);
        emit RolesAssigned(gameId);
    }

    /**
     * @dev Recompute every seat's role bit from the current hostSeat and grant
     *      each one to exactly that seat.
     *
     * Called at creation and again after every jump. The re-grant after a jump
     * is mandatory and easy to miss: Inco handles are IMMUTABLE, so writing a
     * new hostSeat produces a new handle, and the old grants describe the old
     * handle. Skipping this would freeze everyone's role at its assignment-time
     * value — the Jump would appear to do nothing.
     */
    function _grantRoleBits(Game storage g, uint256 gameId) private {
        uint256 n = g.seats.length;
        for (uint256 i = 0; i < n; i++) {
            ebool isHost = e.eq(g.hostSeat, i);
            g.roleBit[i] = isHost;
            e.allowThis(isHost);
            e.allow(isHost, g.seats[i]); // ← the privacy boundary, per seat
        }
        // Grant the (new) host seat handle to every player. This looks alarming
        // but is not: `hostSeat` is a HANDLE, and holding a handle is not the
        // same as being able to decrypt it — decryption requires an allow on
        // that handle, which only the contract has. We grant nothing here beyond
        // what the per-seat bits already imply.
        e.allowThis(g.hostSeat);
        gameId; // silence unused-parameter warning; kept for call-site clarity
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE JUMP — the showcase mechanic
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Attempt to move the Parasite into `targetSeatInput`.
     *
     * ⚠️ CALLABLE BY ANY SEAT, BY DESIGN. ⚠️
     *
     * This function must behave identically whether the caller is the Parasite
     * or not. It does not check, cannot check, and must not check. Concretely:
     *
     *   • No require() on anything role-derived (that would leak via revert).
     *   • No branch on anything role-derived (that would leak via gas/trace).
     *   • The event is the same either way and omits the target.
     *   • Every caller pays the same fee and burns the same gas class.
     *
     * The target seat arrives ENCRYPTED from the client, so the intended
     * destination is hidden even from someone reading calldata. A non-Parasite's
     * call still consumes the ciphertext and still runs the select — it simply
     * selects the current value.
     *
     * @param targetSeatInput Inco ciphertext of the target seat index (euint256),
     *                        produced client-side via zap.encrypt(...).
     */
    function jump(uint256 gameId, bytes memory targetSeatInput) external payable {
        Game storage g = _games[gameId];
        if (g.status != Status.Active) revert GameNotActive(gameId);

        uint256 callerSeat = _seatOfOrRevert(g, msg.sender);
        uint256 n = g.seats.length;

        // 1 input + 1 eq + 1 select + n*(eq) for the re-grant, plus slack.
        uint256 required = inco.getFee() * (n + 6);
        if (msg.value < required) revert FeeNotPaid(msg.value, required);

        // Bind the ciphertext to its creator. Per the docs this second argument
        // "should always be the one that created the input" — passing anything
        // else is a malicious implementation. Note a malformed or replayed
        // ciphertext does NOT revert here; it silently degrades to 0, which is
        // simply a jump to seat 0 and is harmless.
        euint256 targetSeat = e.newEuint256(targetSeatInput, msg.sender);

        // ── The whole mechanic, in two lines ──────────────────────────────
        // Is the caller the current host? (encrypted answer)
        ebool callerIsHost = e.eq(g.hostSeat, callerSeat);
        // Move if so, stay put if not. Both branches are always computed.
        g.hostSeat = e.select(callerIsHost, targetSeat, g.hostSeat);
        e.allowThis(g.hostSeat);

        // Re-grant every seat's role bit against the NEW hostSeat handle.
        // This runs for decoys too — it must, or gas would fingerprint real
        // jumps.
        _grantRoleBits(g, gameId);

        g.jumpNonce += 1;
        emit Jumped(gameId, msg.sender, g.jumpNonce);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sanctioned reveals
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Reveal the single bit "was `seat` the Parasite's host?".
     *
     * Called when a player is ejected by vote. This is the "X was not The
     * Parasite." beat. It publishes one derived boolean and NOT the host seat,
     * so a `false` answer keeps the Parasite hidden among the survivors.
     *
     * Idempotent per seat: a second call is rejected rather than re-revealing.
     */
    function revealEjection(uint256 gameId, uint256 seat) external payable {
        Game storage g = _games[gameId];
        if (g.status != Status.Active) revert GameNotActive(gameId);
        if (seat >= g.seats.length) revert SeatOutOfRange(seat);
        if (g.ejectionRevealed[seat]) revert AlreadyRevealed();
        _seatOfOrRevert(g, msg.sender); // players only

        uint256 required = inco.getFee() * 3;
        if (msg.value < required) revert FeeNotPaid(msg.value, required);

        ebool wasHost = e.eq(g.hostSeat, seat);
        e.allowThis(wasHost);
        e.reveal(wasHost); // irreversible, and intended

        g.ejectionReveal[seat] = wasHost;
        g.ejectionRevealed[seat] = true;
        emit EjectionRevealRequested(gameId, seat);
    }

    /**
     * @notice Reveal the host seat outright and end the game.
     * @dev Only at game over. Irreversible.
     */
    function revealHost(uint256 gameId) external payable {
        Game storage g = _games[gameId];
        if (g.status != Status.Active) revert GameNotActive(gameId);
        _seatOfOrRevert(g, msg.sender);

        uint256 required = inco.getFee();
        if (msg.value < required) revert FeeNotPaid(msg.value, required);

        e.reveal(g.hostSeat);
        g.hostRevealed = true;
        g.status = Status.Ended;

        emit HostRevealed(gameId);
        emit GameEnded(gameId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Handle of the caller's own encrypted role bit.
     *
     * Returning the handle is safe: a handle is an opaque bytes32 pointer, and
     * decrypting it requires an Inco access grant. Seat i's bit was granted only
     * to seats[i], so passing someone else's handle to attestedDecrypt fails at
     * the covalidator. The client calls this, then
     * `zap.attestedDecrypt(wallet, [handle])`.
     */
    function myRoleHandle(uint256 gameId) external view returns (ebool) {
        Game storage g = _games[gameId];
        if (g.status == Status.None) revert GameNotActive(gameId);
        uint256 seat = _seatOfOrRevert(g, msg.sender);
        return g.roleBit[seat];
    }

    /// @notice Handle of the revealed "was host" bit for an ejected seat.
    function ejectionRevealHandle(uint256 gameId, uint256 seat) external view returns (ebool) {
        Game storage g = _games[gameId];
        if (!g.ejectionRevealed[seat]) revert AlreadyRevealed();
        return g.ejectionReveal[seat];
    }

    /// @notice Handle of the host seat. Only decryptable after revealHost().
    function hostSeatHandle(uint256 gameId) external view returns (euint256) {
        return _games[gameId].hostSeat;
    }

    function getSeats(uint256 gameId) external view returns (address[] memory) {
        return _games[gameId].seats;
    }

    function gameInfo(uint256 gameId)
        external
        view
        returns (Status status, address creator, uint256 playerCount, uint64 jumpNonce, bool hostRevealed)
    {
        Game storage g = _games[gameId];
        return (g.status, g.creator, g.seats.length, g.jumpNonce, g.hostRevealed);
    }

    function seatOf(uint256 gameId, address who) external view returns (bool found, uint256 seat) {
        Game storage g = _games[gameId];
        uint256 n = g.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (g.seats[i] == who) return (true, i);
        }
        return (false, 0);
    }

    /// @notice Fee a client should send with `jump` for an n-player game.
    function jumpFee(uint256 gameId) external view returns (uint256) {
        return inco.getFee() * (_games[gameId].seats.length + 6);
    }

    /// @notice Fee a client should send with `createGame` for n players.
    function createFee(uint256 n) external view returns (uint256) {
        return inco.getFee() * (2 * n + 4);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    function _seatOfOrRevert(Game storage g, address who) private view returns (uint256) {
        uint256 n = g.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (g.seats[i] == who) return i;
        }
        revert NotAPlayer(who);
    }

    /// @notice Accept ETH so the contract can pre-fund FHE fees for players.
    receive() external payable {}
}
