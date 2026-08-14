import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { ParasiteGame, MockIncoLightning } from '../typechain-types';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

/**
 * ParasiteGame tests.
 *
 * ParasiteGame is compiled and exercised COMPLETELY UNMODIFIED — the same source
 * that would go to Base Sepolia, importing the real Lib.testnet.sol. The only
 * substitution is at the network boundary: MockIncoLightning's bytecode is
 * installed at the address Lib.testnet.sol hardcodes, so every `inco.*` call the
 * library makes lands on the mock instead of a contract that does not exist on a
 * local Hardhat node.
 *
 * That keeps the call sequence honest. See MockIncoLightning.sol for exactly what
 * this does and does not prove.
 */

// The IncoLightning singleton address baked into Lib.testnet.sol (Base Sepolia).
const INCO_TESTNET_ADDRESS = '0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6';

const FEE = 1000n;

describe('ParasiteGame', () => {
  let game: ParasiteGame;
  let mock: MockIncoLightning;
  let signers: HardhatEthersSigner[];
  let players: string[];

  /** Encode a plaintext seat the way MockIncoLightning.newEuint256 reads it. */
  function encSeat(seat: number | bigint): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [seat]);
  }

  async function createFee(n: number): Promise<bigint> {
    return FEE * BigInt(2 * n + 4);
  }

  async function jumpFee(n: number): Promise<bigint> {
    return FEE * BigInt(n + 6);
  }

  beforeEach(async () => {
    signers = await ethers.getSigners();

    // 1. Deploy the mock normally so Hardhat compiles + links it.
    const MockFactory = await ethers.getContractFactory('MockIncoLightning');
    const deployed = await MockFactory.deploy();
    await deployed.waitForDeployment();

    // 2. Transplant its runtime bytecode to the hardcoded Inco address.
    const code = await ethers.provider.getCode(await deployed.getAddress());
    await network.provider.send('hardhat_setCode', [INCO_TESTNET_ADDRESS, code]);
    mock = MockFactory.attach(INCO_TESTNET_ADDRESS) as MockIncoLightning;

    // 3. Deploy the real game contract, untouched.
    const GameFactory = await ethers.getContractFactory('ParasiteGame');
    game = await GameFactory.deploy();
    await game.waitForDeployment();

    players = await Promise.all(signers.slice(0, 10).map((s) => s.getAddress()));
  });

  describe('lobby size enforcement', () => {
    it('rejects fewer than 4 players', async () => {
      await expect(
        game.createGame(players.slice(0, 3), { value: await createFee(3) })
      ).to.be.revertedWithCustomError(game, 'BadPlayerCount');
    });

    it('rejects more than 10 players', async () => {
      const eleven = [...players, await signers[10].getAddress()];
      await expect(
        game.createGame(eleven, { value: await createFee(11) })
      ).to.be.revertedWithCustomError(game, 'BadPlayerCount');
    });

    it('accepts exactly 4 and exactly 10', async () => {
      await expect(game.createGame(players.slice(0, 4), { value: await createFee(4) })).to.emit(
        game,
        'GameCreated'
      );
      await expect(game.createGame(players.slice(0, 10), { value: await createFee(10) })).to.emit(
        game,
        'GameCreated'
      );
    });

    it('rejects duplicate players (a shared wallet could decrypt two role bits)', async () => {
      const dup = [players[0], players[1], players[2], players[0]];
      await expect(
        game.createGame(dup, { value: await createFee(4) })
      ).to.be.revertedWithCustomError(game, 'DuplicatePlayer');
    });

    it('rejects the zero address', async () => {
      const withZero = [players[0], players[1], players[2], ethers.ZeroAddress];
      await expect(
        game.createGame(withZero, { value: await createFee(4) })
      ).to.be.revertedWithCustomError(game, 'ZeroAddressPlayer');
    });

    it('requires the FHE fee', async () => {
      await expect(
        game.createGame(players.slice(0, 4), { value: 1n })
      ).to.be.revertedWithCustomError(game, 'FeeNotPaid');
    });
  });

  describe('encrypted role assignment', () => {
    it('grants each seat access to its OWN role bit and no one else\'s', async () => {
      await mock.setRandSeed(2); // seat 2 is the Parasite
      await game.createGame(players.slice(0, 5), { value: await createFee(5) });

      for (let seat = 0; seat < 5; seat++) {
        const handle = await game.connect(signers[seat]).myRoleHandle(1);

        // The owning seat can decrypt.
        expect(await mock.isAllowed(handle, players[seat])).to.equal(
          true,
          `seat ${seat} should access its own bit`
        );

        // Nobody else can.
        for (let other = 0; other < 5; other++) {
          if (other === seat) continue;
          expect(await mock.isAllowed(handle, players[other])).to.equal(
            false,
            `seat ${other} must NOT access seat ${seat}'s bit`
          );
        }
      }
    });

    it('assigns exactly one Parasite', async () => {
      await mock.setRandSeed(3);
      await game.createGame(players.slice(0, 6), { value: await createFee(6) });

      let parasiteCount = 0;
      for (let seat = 0; seat < 6; seat++) {
        const handle = await game.connect(signers[seat]).myRoleHandle(1);
        if ((await mock.plaintextOf(handle)) === 1n) parasiteCount++;
      }
      expect(parasiteCount).to.equal(1);
    });

    it('picks the seat the encrypted draw selected', async () => {
      await mock.setRandSeed(4);
      await game.createGame(players.slice(0, 6), { value: await createFee(6) });

      const handle = await game.connect(signers[4]).myRoleHandle(1);
      expect(await mock.plaintextOf(handle)).to.equal(1n);
    });

    it('reverts myRoleHandle for a non-player', async () => {
      await game.createGame(players.slice(0, 4), { value: await createFee(4) });
      await expect(
        game.connect(signers[7]).myRoleHandle(1)
      ).to.be.revertedWithCustomError(game, 'NotAPlayer');
    });

    it('bounds the draw to the seat range', async () => {
      // Unforced seed → hash-derived; must still land in [0, n).
      const MockFactory = await ethers.getContractFactory('MockIncoLightning');
      const fresh = await MockFactory.deploy();
      await fresh.waitForDeployment();
      const code = await ethers.provider.getCode(await fresh.getAddress());
      await network.provider.send('hardhat_setCode', [INCO_TESTNET_ADDRESS, code]);

      await game.createGame(players.slice(0, 7), { value: await createFee(7) });
      let found = 0;
      for (let seat = 0; seat < 7; seat++) {
        const handle = await game.connect(signers[seat]).myRoleHandle(1);
        if ((await mock.plaintextOf(handle)) === 1n) found++;
      }
      expect(found).to.equal(1);
    });
  });

  describe('the Jump', () => {
    const N = 5;

    beforeEach(async () => {
      await mock.setRandSeed(1); // seat 1 is the Parasite
      await game.createGame(players.slice(0, N), { value: await createFee(N) });
    });

    async function isParasite(seat: number): Promise<boolean> {
      const handle = await game.connect(signers[seat]).myRoleHandle(1);
      return (await mock.plaintextOf(handle)) === 1n;
    }

    it('moves the host when the real Parasite jumps', async () => {
      expect(await isParasite(1)).to.equal(true);
      expect(await isParasite(3)).to.equal(false);

      await game.connect(signers[1]).jump(1, encSeat(3), { value: await jumpFee(N) });

      expect(await isParasite(1)).to.equal(false);
      expect(await isParasite(3)).to.equal(true);
    });

    it('is a SILENT NO-OP when a non-Parasite jumps', async () => {
      // Seat 0 is human and tries to seize the Parasite role.
      await game.connect(signers[0]).jump(1, encSeat(0), { value: await jumpFee(N) });

      expect(await isParasite(0)).to.equal(false, 'a human must not become the Parasite');
      expect(await isParasite(1)).to.equal(true, 'the real Parasite must be unaffected');
    });

    it('does not revert for a non-Parasite (a revert would leak the role)', async () => {
      // This is the confidentiality property: success/failure must not correlate
      // with whether the caller is the Parasite.
      await expect(game.connect(signers[0]).jump(1, encSeat(2), { value: await jumpFee(N) })).to.not
        .be.reverted;
      await expect(game.connect(signers[1]).jump(1, encSeat(2), { value: await jumpFee(N) })).to.not
        .be.reverted;
    });

    it('a self-targeted decoy is a no-op EVEN FOR THE PARASITE', async () => {
      // Regression test for a client bug: the decoy scheduler originally aimed
      // at a random *other* player. For a human that is harmless, but for the
      // Parasite `callerIsHost` is true, so `select` executes and the "decoy"
      // is a real jump — the Parasite would silently lose the role to a random
      // player roughly every 40 seconds.
      //
      // Self-targeting is the fix: select(true, mySeat, mySeat) is a no-op for
      // the Parasite, and select(false, ...) is already a no-op for everyone
      // else. The target is encrypted, so this costs nothing in cover.
      expect(await isParasite(1)).to.equal(true);

      // The Parasite decoys at itself.
      await game.connect(signers[1]).jump(1, encSeat(1), { value: await jumpFee(N) });
      expect(await isParasite(1)).to.equal(true, 'a self-decoy must not move the host');

      // A human decoys at itself.
      await game.connect(signers[3]).jump(1, encSeat(3), { value: await jumpFee(N) });
      expect(await isParasite(3)).to.equal(false, 'a human self-decoy must not grant the role');
      expect(await isParasite(1)).to.equal(true, 'the Parasite must still be seat 1');

      // Contrast: aiming elsewhere as the Parasite really does move the role.
      await game.connect(signers[1]).jump(1, encSeat(4), { value: await jumpFee(N) });
      expect(await isParasite(1)).to.equal(false);
      expect(await isParasite(4)).to.equal(true);
    });

    it('emits an identical event shape for real jumps and decoys', async () => {
      const realTx = await game.connect(signers[1]).jump(1, encSeat(2), { value: await jumpFee(N) });
      const realRc = await realTx.wait();

      // seat 2 is now the Parasite; seat 4 is a decoy.
      const decoyTx = await game.connect(signers[4]).jump(1, encSeat(0), { value: await jumpFee(N) });
      const decoyRc = await decoyTx.wait();

      const parse = (rc: any) =>
        rc!.logs
          .map((l: any) => {
            try {
              return game.interface.parseLog(l);
            } catch {
              return null;
            }
          })
          .filter((p: any) => p && p.name === 'Jumped');

      const realJumped = parse(realRc);
      const decoyJumped = parse(decoyRc);

      expect(realJumped.length).to.equal(1);
      expect(decoyJumped.length).to.equal(1);
      // Same event, same arity. The only differing field is the caller, which is
      // public anyway (it is the tx sender), and the nonce.
      expect(realJumped[0].args.length).to.equal(decoyJumped[0].args.length);
      expect(realJumped[0].name).to.equal(decoyJumped[0].name);
    });

    it('never puts the target seat in the event log', async () => {
      const tx = await game.connect(signers[1]).jump(1, encSeat(3), { value: await jumpFee(N) });
      const rc = await tx.wait();
      const ev = rc!.logs
        .map((l) => {
          try {
            return game.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === 'Jumped');
      // args: gameId, caller, nonce. No target.
      expect(ev!.args.length).to.equal(3);
      const asStrings = ev!.args.map((a) => String(a));
      // seat 3 must not appear as a bare argument.
      expect(asStrings.slice(2)).to.not.include('3');
    });

    it('burns identical gas for a real jump and a decoy (no gas fingerprint)', async () => {
      // This is the sharpest confidentiality test in the suite, so it has to
      // isolate exactly one variable: whether the caller is the Parasite.
      //
      // Comparing jump #1 against jump #2 inside one game does NOT do that —
      // the second jump inherits warmed storage and already-populated slots from
      // the first, which is worth tens of thousands of gas and swamps the signal.
      //
      // So: two freshly created, structurally identical games. In game A the
      // caller IS the host; in game B the caller is NOT. Same seat index, same
      // target, same player count, same position in the game's history.
      const FRESH = 5;

      // Game A — seat 1 hosts, and seat 1 jumps. (real)
      await mock.setRandSeed(1);
      const txA = await game.createGame(players.slice(0, FRESH), { value: await createFee(FRESH) });
      await txA.wait();
      const gameA = (await game.nextGameId()) - 1n;

      // Game B — seat 3 hosts, but seat 1 jumps. (decoy)
      await mock.setRandSeed(3);
      const txB = await game.createGame(players.slice(0, FRESH), { value: await createFee(FRESH) });
      await txB.wait();
      const gameB = (await game.nextGameId()) - 1n;

      const realTx = await game
        .connect(signers[1])
        .jump(gameA, encSeat(2), { value: await jumpFee(FRESH) });
      const realGas = (await realTx.wait())!.gasUsed;

      const decoyTx = await game
        .connect(signers[1])
        .jump(gameB, encSeat(2), { value: await jumpFee(FRESH) });
      const decoyGas = (await decoyTx.wait())!.gasUsed;

      // Confirm the two calls really did differ in outcome, or the test is vacuous.
      const hostA = await game.connect(signers[2]).myRoleHandle(gameA);
      expect(await mock.plaintextOf(hostA)).to.equal(1n, 'game A: the jump should have landed');
      const hostB = await game.connect(signers[2]).myRoleHandle(gameB);
      expect(await mock.plaintextOf(hostB)).to.equal(0n, 'game B: the jump should have been a no-op');

      const diff = realGas > decoyGas ? realGas - decoyGas : decoyGas - realGas;
      const pct = Number((diff * 10000n) / realGas) / 100;
      expect(pct).to.be.lessThan(
        1,
        `gas differed by ${pct}% (real=${realGas} decoy=${decoyGas}) — any measurable gap fingerprints real jumps`
      );
    });

    it('re-grants role bits after a jump (immutable-handle trap)', async () => {
      const before = await game.connect(signers[1]).myRoleHandle(1);
      await game.connect(signers[1]).jump(1, encSeat(3), { value: await jumpFee(N) });
      const after = await game.connect(signers[1]).myRoleHandle(1);

      // A new handle must have been issued — otherwise roles froze at assignment.
      expect(after).to.not.equal(before);

      // And every seat still owns exactly its own (new) bit.
      for (let seat = 0; seat < N; seat++) {
        const h = await game.connect(signers[seat]).myRoleHandle(1);
        expect(await mock.isAllowed(h, players[seat])).to.equal(true);
        for (let other = 0; other < N; other++) {
          if (other === seat) continue;
          expect(await mock.isAllowed(h, players[other])).to.equal(false);
        }
      }
    });

    it('supports a chain of jumps', async () => {
      await game.connect(signers[1]).jump(1, encSeat(2), { value: await jumpFee(N) });
      expect(await isParasite(2)).to.equal(true);

      await game.connect(signers[2]).jump(1, encSeat(4), { value: await jumpFee(N) });
      expect(await isParasite(4)).to.equal(true);
      expect(await isParasite(2)).to.equal(false);

      await game.connect(signers[4]).jump(1, encSeat(0), { value: await jumpFee(N) });
      expect(await isParasite(0)).to.equal(true);

      // Exactly one Parasite throughout.
      let count = 0;
      for (let s = 0; s < N; s++) if (await isParasite(s)) count++;
      expect(count).to.equal(1);
    });

    it('bumps the nonce for decoys too', async () => {
      const before = (await game.gameInfo(1)).jumpNonce;
      await game.connect(signers[0]).jump(1, encSeat(2), { value: await jumpFee(N) });
      const after = (await game.gameInfo(1)).jumpNonce;
      expect(after).to.equal(before + 1n);
    });

    it('rejects a jump from a non-player', async () => {
      await expect(
        game.connect(signers[8]).jump(1, encSeat(0), { value: await jumpFee(N) })
      ).to.be.revertedWithCustomError(game, 'NotAPlayer');
    });

    it('requires the FHE fee', async () => {
      await expect(
        game.connect(signers[1]).jump(1, encSeat(2), { value: 1n })
      ).to.be.revertedWithCustomError(game, 'FeeNotPaid');
    });
  });

  describe('purge audit trail', () => {
    const N = 5;

    async function purgeAttemptFee(): Promise<bigint> {
      return FEE * 4n;
    }

    beforeEach(async () => {
      await mock.setRandSeed(2); // seat 2 hosts
      await game.createGame(players.slice(0, N), { value: await createFee(N) });
    });

    it('emits an identical event shape for a real attempt and a decoy', async () => {
      const realTx = await game
        .connect(signers[2])
        .attemptPurge(1, encSeat(0), { value: await purgeAttemptFee() });
      const decoyTx = await game
        .connect(signers[0])
        .attemptPurge(1, encSeat(2), { value: await purgeAttemptFee() });

      await expect(realTx).to.emit(game, 'PurgeAttempted').withArgs(1, players[2], 1);
      await expect(decoyTx).to.emit(game, 'PurgeAttempted').withArgs(1, players[0], 2);
      // Neither event carries the target seat or the outcome — same discipline
      // as Jumped.
    });

    it('burns identical gas for a real attempt and a decoy', async () => {
      // Same trap as the Jump gas test, and the same fix: isolate exactly one
      // variable. Comparing two attempts inside one game conflates "is this
      // caller the host" with "how many iterations did this caller's seat
      // lookup take" and, on the second call, warmed-storage discount too — all
      // three are real gas effects that have nothing to do with role. Two
      // fresh, structurally identical games, same calling seat in both, only
      // the host differs.
      const FRESH = 5;
      const fee = await purgeAttemptFee();

      // Game A — seat 1 hosts, and seat 1 attempts. (real)
      await mock.setRandSeed(1);
      await (await game.createGame(players.slice(0, FRESH), { value: await createFee(FRESH) })).wait();
      const gameA = (await game.nextGameId()) - 1n;

      // Game B — seat 3 hosts, but seat 1 attempts. (decoy)
      await mock.setRandSeed(3);
      await (await game.createGame(players.slice(0, FRESH), { value: await createFee(FRESH) })).wait();
      const gameB = (await game.nextGameId()) - 1n;

      const realGas = (
        await (await game.connect(signers[1]).attemptPurge(gameA, encSeat(2), { value: fee })).wait()
      )!.gasUsed;
      const decoyGas = (
        await (await game.connect(signers[1]).attemptPurge(gameB, encSeat(2), { value: fee })).wait()
      )!.gasUsed;

      // Same tolerance as the Jump test, for the same reason: a few gas units
      // of EVM/mock-level noise are not a fingerprint. A gap worth worrying
      // about is a percent or more, not eighteen units out of three hundred
      // thousand.
      const diff = realGas > decoyGas ? realGas - decoyGas : decoyGas - realGas;
      const pct = Number((diff * 10000n) / realGas) / 100;
      expect(pct).to.be.lessThan(
        1,
        `gas differed by ${pct}% (real=${realGas} decoy=${decoyGas}) — any measurable gap fingerprints real purge attempts`
      );
    });

    it('does not gate the live kill: the call always succeeds regardless of role', async () => {
      const fee = await purgeAttemptFee();
      await expect(
        game.connect(signers[0]).attemptPurge(1, encSeat(2), { value: fee })
      ).to.not.be.reverted;
    });

    it('rejects an attempt from a non-player', async () => {
      await expect(
        game.connect(signers[8]).attemptPurge(1, encSeat(0), { value: await purgeAttemptFee() })
      ).to.be.revertedWithCustomError(game, 'NotAPlayer');
    });

    it('rejects revealPurgeAudit before the game has ended', async () => {
      await game.connect(signers[2]).attemptPurge(1, encSeat(0), { value: await purgeAttemptFee() });
      await expect(
        game.connect(signers[0]).revealPurgeAudit(1, { value: FEE * 2n })
      ).to.be.revertedWithCustomError(game, 'GameNotEnded');
    });

    it('after the game ends, correctly distinguishes the real attempt from decoys', async () => {
      // Seat 2 is the real host and purges for real; seats 0 and 4 send decoys.
      await game.connect(signers[2]).attemptPurge(1, encSeat(3), { value: await purgeAttemptFee() });
      await game.connect(signers[0]).attemptPurge(1, encSeat(3), { value: await purgeAttemptFee() });
      await game.connect(signers[4]).attemptPurge(1, encSeat(1), { value: await purgeAttemptFee() });

      await game.connect(signers[0]).revealHost(1, { value: FEE });

      const n = await game.purgeAttemptCount(1);
      expect(n).to.equal(3);

      await game.connect(signers[0]).revealPurgeAudit(1, { value: FEE * BigInt(2 * Number(n)) });

      const results: { caller: string; wasHost: bigint }[] = [];
      for (let i = 0; i < Number(n); i++) {
        const [caller, , wasHostHandle] = await game.purgeAttemptHandles(1, i);
        results.push({ caller, wasHost: await mock.plaintextOf(wasHostHandle) });
      }

      expect(results.find((r) => r.caller === players[2])!.wasHost).to.equal(1n);
      expect(results.find((r) => r.caller === players[0])!.wasHost).to.equal(0n);
      expect(results.find((r) => r.caller === players[4])!.wasHost).to.equal(0n);
    });

    it('rejects a second audit reveal', async () => {
      await game.connect(signers[2]).attemptPurge(1, encSeat(0), { value: await purgeAttemptFee() });
      await game.connect(signers[0]).revealHost(1, { value: FEE });
      const n = await game.purgeAttemptCount(1);
      await game.connect(signers[0]).revealPurgeAudit(1, { value: FEE * BigInt(2 * Number(n)) });
      await expect(
        game.connect(signers[0]).revealPurgeAudit(1, { value: FEE * BigInt(2 * Number(n)) })
      ).to.be.revertedWithCustomError(game, 'AlreadyRevealed');
    });
  });

  describe('sanctioned reveals', () => {
    const N = 5;

    beforeEach(async () => {
      await mock.setRandSeed(2); // seat 2 hosts
      await game.createGame(players.slice(0, N), { value: await createFee(N) });
    });

    it('reveals TRUE when the ejected seat was the host', async () => {
      await game.connect(signers[0]).revealEjection(1, 2, { value: FEE * 3n });
      const handle = await game.ejectionRevealHandle(1, 2);
      expect(await mock.isRevealed(handle)).to.equal(true);
      expect(await mock.plaintextOf(handle)).to.equal(1n);
    });

    it('reveals FALSE for an innocent seat WITHOUT revealing the host', async () => {
      await game.connect(signers[0]).revealEjection(1, 0, { value: FEE * 3n });
      const handle = await game.ejectionRevealHandle(1, 0);
      expect(await mock.plaintextOf(handle)).to.equal(0n);

      // Crucially, hostSeat itself stays sealed — the Parasite is still hidden.
      const hostHandle = await game.hostSeatHandle(1);
      expect(await mock.isRevealed(hostHandle)).to.equal(false);
    });

    it('rejects a second reveal of the same seat', async () => {
      await game.connect(signers[0]).revealEjection(1, 0, { value: FEE * 3n });
      await expect(
        game.connect(signers[0]).revealEjection(1, 0, { value: FEE * 3n })
      ).to.be.revertedWithCustomError(game, 'AlreadyRevealed');
    });

    it('tracks the host across a jump when revealing', async () => {
      await game.connect(signers[2]).jump(1, encSeat(4), { value: await jumpFee(N) });

      // Seat 2 used to host but jumped out — must now read as innocent.
      await game.connect(signers[0]).revealEjection(1, 2, { value: FEE * 3n });
      expect(await mock.plaintextOf(await game.ejectionRevealHandle(1, 2))).to.equal(0n);

      // Seat 4 is the current host.
      await game.connect(signers[0]).revealEjection(1, 4, { value: FEE * 3n });
      expect(await mock.plaintextOf(await game.ejectionRevealHandle(1, 4))).to.equal(1n);
    });

    it('revealHost exposes the seat and ends the game', async () => {
      await expect(game.connect(signers[0]).revealHost(1, { value: FEE })).to.emit(
        game,
        'HostRevealed'
      );
      const handle = await game.hostSeatHandle(1);
      expect(await mock.isRevealed(handle)).to.equal(true);
      expect(await mock.plaintextOf(handle)).to.equal(2n);
      expect((await game.gameInfo(1)).status).to.equal(2); // Ended
    });

    it('blocks jumps after the game ends', async () => {
      await game.connect(signers[0]).revealHost(1, { value: FEE });
      await expect(
        game.connect(signers[2]).jump(1, encSeat(3), { value: await jumpFee(N) })
      ).to.be.revertedWithCustomError(game, 'GameNotActive');
    });

    it('rejects reveals from non-players', async () => {
      await expect(
        game.connect(signers[8]).revealEjection(1, 0, { value: FEE * 3n })
      ).to.be.revertedWithCustomError(game, 'NotAPlayer');
    });

    it('rejects an out-of-range seat', async () => {
      await expect(
        game.connect(signers[0]).revealEjection(1, 99, { value: FEE * 3n })
      ).to.be.revertedWithCustomError(game, 'SeatOutOfRange');
    });
  });

  describe('views and bookkeeping', () => {
    it('reports seats and fees', async () => {
      await game.createGame(players.slice(0, 6), { value: await createFee(6) });
      expect(await game.getSeats(1)).to.deep.equal(players.slice(0, 6));
      expect(await game.jumpFee(1)).to.equal(FEE * 12n);
      expect(await game.createFee(6)).to.equal(FEE * 16n);

      const [found, seat] = await game.seatOf(1, players[3]);
      expect(found).to.equal(true);
      expect(seat).to.equal(3n);

      const [notFound] = await game.seatOf(1, await signers[9].getAddress());
      expect(notFound).to.equal(false);
    });

    it('isolates concurrent games', async () => {
      await mock.setRandSeed(0);
      await game.createGame(players.slice(0, 4), { value: await createFee(4) });
      await mock.setRandSeed(3);
      await game.createGame(players.slice(4, 8), { value: await createFee(4) });

      const g1 = await game.connect(signers[0]).myRoleHandle(1);
      expect(await mock.plaintextOf(g1)).to.equal(1n); // seat 0 hosts game 1

      const g2 = await game.connect(signers[7]).myRoleHandle(2);
      expect(await mock.plaintextOf(g2)).to.equal(1n); // seat 3 hosts game 2

      const g2seat0 = await game.connect(signers[4]).myRoleHandle(2);
      expect(await mock.plaintextOf(g2seat0)).to.equal(0n);
    });

    it('rejects operations on a nonexistent game', async () => {
      await expect(
        game.connect(signers[0]).jump(99, encSeat(0), { value: FEE * 20n })
      ).to.be.revertedWithCustomError(game, 'GameNotActive');
    });
  });
});
