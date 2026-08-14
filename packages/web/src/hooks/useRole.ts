'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import type { RoomState, Seat } from '@parasite/shared';
import {
  PARASITE_GAME_ABI,
  PARASITE_GAME_ADDRESS,
  BASE_SEPOLIA_RPC,
} from '@/lib/contract';
import { decryptMyRole, encryptSeat, revealEjectedSeat, type ChainWalletClient } from '@/lib/incoOracle';

export type RoleMode = 'inco' | 'simulated';

/**
 * How often a non-Parasite client re-checks whether it has become the new
 * host, in Inco mode. See the "periodically re-check" effect below for why
 * this can't just be event-triggered off every Jumped log.
 */
const ROLE_RECHECK_MS = 45_000;

export interface RoleState {
  mode: RoleMode;
  /** null until the role is known to this client. */
  isParasite: boolean | null;
  /** Human-readable status for the HUD. */
  status: string;
  busy: boolean;
  error: string | null;
}

/**
 * The client half of the confidentiality design.
 *
 * ── Inco mode (a contract address is configured) ─────────────────────────────
 * The role is read by calling `myRoleHandle` (msg.sender-scoped) and then
 * `attestedDecrypt`, which requires this wallet's EIP-712 signature. Nothing
 * else in the system — not the server, not other clients — can perform that
 * decrypt.
 *
 * Jumps go on-chain as `jump(gameId, encryptedSeat)`. Crucially, this hook also
 * emits DECOY jumps from non-Parasite players on a jitter, because a contract
 * that is safe to call is not enough on its own: if only the Parasite ever sent
 * a jump transaction, the *existence* of the transaction would identify them.
 * The contract makes decoys free of effect; this makes them free of suspicion.
 *
 * ── Simulated mode (no contract address) ─────────────────────────────────────
 * Falls back to a server-derived role so the game is playable without a wallet.
 * The HUD always states which mode is live — see RoleBadge.
 */
export function useRole(opts: {
  state: RoomState | null;
  mySeat: Seat | null;
  address: `0x${string}` | null;
  /**
   * SIMULATED MODE ONLY: the role the server privately sent this socket.
   * Always null in Inco mode, where the role is decrypted from chain instead.
   */
  simulatedRole: boolean | null;
  onToast: (kind: 'info' | 'warn' | 'error', text: string) => void;
  /** Fires once on every HUMAN/unknown → PARASITE transition (game start or a
   *  mid-game jump landing on this client) — the trigger for the unmissable
   *  full-screen reveal, as opposed to the quiet RoleBadge update. */
  onRoleReveal?: () => void;
  /** Fires once on every PARASITE → HUMAN transition (jumping away). */
  onRoleLost?: () => void;
}) {
  const { state, mySeat, address, simulatedRole, onToast, onRoleReveal, onRoleLost } = opts;

  const mode: RoleMode = PARASITE_GAME_ADDRESS ? 'inco' : 'simulated';
  const [role, setRole] = useState<RoleState>({
    mode,
    isParasite: null,
    status: mode === 'inco' ? 'Awaiting encrypted role…' : 'Awaiting role…',
    busy: false,
    error: null,
  });

  // ── Edge-triggered reveal/lost callbacks ────────────────────────────────────
  /**
   * Single source of truth for "did my role just change." Both modes funnel
   * through the same `role` state above (simulated via the effect below,
   * Inco via the decrypt effect and the periodic re-check further down), so
   * watching `role.isParasite` here catches every path without duplicating
   * the edge-detection in each mode's own effect.
   */
  const prevIsParasite = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevIsParasite.current;
    prevIsParasite.current = role.isParasite;
    if (role.isParasite === true && prev !== true) onRoleReveal?.();
    else if (role.isParasite === false && prev === true) onRoleLost?.();
  }, [role.isParasite, onRoleReveal, onRoleLost]);

  const publicClient = useRef<PublicClient | null>(null);
  const decoyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const purgeDecoyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGameId = useRef<string | null>(null);

  if (!publicClient.current && typeof window !== 'undefined') {
    publicClient.current = createPublicClient({
      chain: baseSepolia,
      transport: http(BASE_SEPOLIA_RPC),
    }) as PublicClient;
  }

  const walletClient = useCallback((): ChainWalletClient | null => {
    if (typeof window === 'undefined') return null;
    const eth = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!eth || !address) return null;
    return createWalletClient({
      chain: baseSepolia,
      account: address,
      transport: custom(eth as never),
    }) as ChainWalletClient;
  }, [address]);

  const chainGameId = state?.chainGameId ?? null;

  // ── Simulated mode: the server hands each socket its own role ──────────────
  useEffect(() => {
    if (mode !== 'simulated') return;
    if (simulatedRole === null) return;
    setRole({
      mode,
      isParasite: simulatedRole,
      status: simulatedRole ? 'PARASITE' : 'HUMAN',
      busy: false,
      error: null,
    });
  }, [mode, simulatedRole]);

  // ── Inco mode: decrypt my own role from chain once the game starts ─────────
  useEffect(() => {
    if (mode !== 'inco') return;
    if (!chainGameId || mySeat === null) return;
    if (lastGameId.current === chainGameId) return;
    lastGameId.current = chainGameId;

    let cancelled = false;

    (async () => {
      const wc = walletClient();
      if (!wc || !publicClient.current || !PARASITE_GAME_ADDRESS) {
        setRole((r) => ({
          ...r,
          status: 'Connect a wallet to decrypt your role',
          error: 'no wallet',
        }));
        return;
      }

      setRole((r) => ({ ...r, busy: true, status: 'Decrypting role via Inco…' }));
      try {
        const isParasite = await decryptMyRole({
          rpcUrl: BASE_SEPOLIA_RPC,
          publicClient: publicClient.current,
          walletClient: wc,
          contractAddress: PARASITE_GAME_ADDRESS,
          gameId: BigInt(chainGameId),
        });
        if (cancelled) return;
        setRole({
          mode,
          isParasite,
          status: isParasite ? 'PARASITE' : 'HUMAN',
          busy: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRole((r) => ({ ...r, busy: false, status: 'Role decrypt failed', error: msg }));
        onToast('error', `Could not decrypt your role: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chainGameId, mySeat, mode, walletClient, onToast]);

  // ── Inco mode: periodically re-check for a role change while still human ───
  /**
   * The one-shot decrypt above only ever runs once per chainGameId, so a
   * player who becomes the new host mid-game via someone else's jump was
   * never told — the client that PERFORMS a real jump already re-decrypts
   * its own role right after (see submitJump below), but the RECEIVING end
   * of that transfer has no trigger at all otherwise.
   *
   * This can't be "re-decrypt on every Jumped event": decryptMyRole calls
   * attestedDecrypt, which requires a fresh EIP-712 signature every time (the
   * SDK does not cache), and decoy jump traffic already fires from every
   * living player every 25-60s — wiring a decrypt to each event would mean a
   * wallet popup every few seconds for everyone. Instead this polls on its
   * own slower, independent cadence, and only while this client is not
   * already known to be the Parasite (someone who already knows they're the
   * host needs no polling — jumping AWAY from the role is already handled by
   * submitJump's own post-jump re-check).
   *
   * Honest trade-off: a new host can take up to ROLE_RECHECK_MS to find out,
   * and pays one extra wallet signature prompt per interval until they do.
   * That's the cost of decoy and real jumps staying indistinguishable
   * on-chain — the alternative (event-triggered) would be far noisier.
   */
  useEffect(() => {
    if (mode !== 'inco') return;
    if (!chainGameId || mySeat === null || state?.phase !== 'playing') return;
    if (role.isParasite !== false) return; // unknown or already Parasite: nothing to poll for

    let cancelled = false;
    const timer = setInterval(async () => {
      const wc = walletClient();
      if (!wc || !publicClient.current || !PARASITE_GAME_ADDRESS) return;
      try {
        const isParasite = await decryptMyRole({
          rpcUrl: BASE_SEPOLIA_RPC,
          publicClient: publicClient.current,
          walletClient: wc,
          contractAddress: PARASITE_GAME_ADDRESS,
          gameId: BigInt(chainGameId),
        });
        if (cancelled || !isParasite) return; // still human: nothing to update
        setRole((r) => ({ ...r, isParasite: true, status: 'PARASITE' }));
      } catch {
        // Silent: this is a background poll, not a user-initiated action —
        // surfacing an error toast for a routine re-check would be noise.
      }
    }, ROLE_RECHECK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chainGameId, mySeat, state?.phase, role.isParasite, walletClient]);

  // ── Decoy jump traffic ─────────────────────────────────────────────────────
  /**
   * Every living player periodically sends a jump transaction, whether or not
   * they are the Parasite. The contract turns non-Parasite jumps into no-ops
   * (via e.select) so this is harmless — and it is what makes the real jump
   * unobservable, since a jump tx no longer implies anything about the sender.
   *
   * Only runs in Inco mode: in simulated mode there is no chain to observe.
   */
  useEffect(() => {
    if (mode !== 'inco') return;
    if (!chainGameId || mySeat === null || state?.phase !== 'playing') return;
    if (role.isParasite === null) return; // wait until we know, so we don't decoy blind

    const schedule = () => {
      // Jitter hard: a fixed interval would itself be a fingerprint if the
      // Parasite's real jumps ever interrupted the cadence.
      const delay = 25_000 + Math.random() * 35_000;
      decoyTimer.current = setTimeout(async () => {
        // ⚠️ A decoy MUST target the sender's OWN seat.
        //
        // The contract computes `hostSeat = select(callerIsHost, target, hostSeat)`.
        // For a non-Parasite that is a no-op whatever the target is — but for the
        // Parasite `callerIsHost` is TRUE, so a decoy aimed at a random player is
        // a REAL jump and would silently hand the role away every ~40 seconds.
        // Targeting your own seat collapses to `select(true, mySeat, mySeat)`,
        // which is a no-op for the Parasite and still a no-op for everyone else.
        //
        // This costs nothing in cover: the target is encrypted, so an observer
        // cannot tell a self-target from any other, and the tx is byte-identical.
        await submitJump(mySeat, true).catch(() => {});
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (decoyTimer.current) clearTimeout(decoyTimer.current);
      decoyTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chainGameId, mySeat, state?.phase, role.isParasite]);

  // ── Decoy purge-attempt traffic ─────────────────────────────────────────────
  /**
   * attemptPurge() never causes a kill by itself — the live kill is still
   * driven entirely by the unauthenticated Socket.io call, exactly as before.
   * It only WRITES AN AUDIT RECORD. So on its own, sending one only when a real
   * purge happens would make the caller of that public event the tell: an
   * observer watching the mempool during the live round would see "address X
   * just sent attemptPurge" and, since only the real killer ever presses that
   * button, learn who the Parasite is in real time — before revealPurgeAudit
   * ever runs, defeating the entire point of sealing the audit until game end.
   *
   * Same fix as the decoy Jump traffic: every living player periodically sends
   * one too. Unlike a decoy Jump, a decoy purge attempt can target literally
   * anything — attemptPurge never mutates hostSeat, so there is no equivalent
   * of "a wrongly-aimed decoy is secretly a real action" to avoid. That is what
   * makes this simpler than the Jump decoy despite doing the same job.
   */
  useEffect(() => {
    if (mode !== 'inco') return;
    if (!chainGameId || mySeat === null || state?.phase !== 'playing') return;
    if (role.isParasite === null) return;

    const schedule = () => {
      const delay = 20_000 + Math.random() * 30_000;
      purgeDecoyTimer.current = setTimeout(async () => {
        await submitPurgeAttempt(mySeat, true).catch(() => {});
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (purgeDecoyTimer.current) clearTimeout(purgeDecoyTimer.current);
      purgeDecoyTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chainGameId, mySeat, state?.phase, role.isParasite]);

  /**
   * Send a jump transaction.
   *
   * `decoy` only affects local UX (whether we surface errors to the player); the
   * transaction itself is byte-identical either way, which is the entire point.
   */
  const submitJump = useCallback(
    async (targetSeat: Seat, decoy = false) => {
      if (mode !== 'inco' || !chainGameId || !PARASITE_GAME_ADDRESS || !address) return;
      const wc = walletClient();
      if (!wc || !publicClient.current) return;

      const gameId = BigInt(chainGameId);
      const ciphertext = await encryptSeat({
        rpcUrl: BASE_SEPOLIA_RPC,
        seat: targetSeat,
        accountAddress: address,
        dappAddress: PARASITE_GAME_ADDRESS,
      });

      const fee = (await publicClient.current.readContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'jumpFee',
        args: [gameId],
      })) as bigint;

      await wc.writeContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'jump',
        args: [gameId, ciphertext],
        value: fee,
        chain: baseSepolia,
        account: wc.account,
      });

      if (!decoy) {
        // Re-read our own role: if we jumped, we are no longer the host.
        const isParasite = await decryptMyRole({
          rpcUrl: BASE_SEPOLIA_RPC,
          publicClient: publicClient.current,
          walletClient: wc,
          contractAddress: PARASITE_GAME_ADDRESS,
          gameId,
        }).catch(() => null);
        if (isParasite !== null) {
          setRole((r) => ({
            ...r,
            isParasite,
            status: isParasite ? 'PARASITE' : 'HUMAN',
          }));
        }
      }
    },
    [mode, chainGameId, address, walletClient]
  );

  /**
   * Record a purge attempt on-chain. Never causes a kill and never changes
   * anyone's role — the live kill is still the pre-existing, instant,
   * unauthenticated Socket.io call; this only writes the audit record that
   * lets a cheating client be caught after the fact (see the PURGE AUDIT TRAIL
   * section in ParasiteGame.sol for the full reasoning).
   *
   * `decoy` only affects local UX (whether a failure is surfaced); the
   * transaction is byte-identical either way, which is the entire point.
   */
  const submitPurgeAttempt = useCallback(
    async (targetSeat: Seat, decoy = false) => {
      if (mode !== 'inco' || !chainGameId || !PARASITE_GAME_ADDRESS || !address) return;
      const wc = walletClient();
      if (!wc || !publicClient.current) return;

      const gameId = BigInt(chainGameId);
      const ciphertext = await encryptSeat({
        rpcUrl: BASE_SEPOLIA_RPC,
        seat: targetSeat,
        accountAddress: address,
        dappAddress: PARASITE_GAME_ADDRESS,
      });

      const fee = (await publicClient.current.readContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'purgeAttemptFee',
        args: [gameId],
      })) as bigint;

      await wc.writeContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'attemptPurge',
        args: [gameId, ciphertext],
        value: fee,
        chain: baseSepolia,
        account: wc.account,
      });
      void decoy; // symmetry with submitJump's signature; nothing to branch on
    },
    [mode, chainGameId, address, walletClient]
  );

  /**
   * Inco mode, lobby host only: create the game on-chain and return the
   * resulting game id.
   *
   * This is the one step nothing else in the system ever performed — see
   * GameServer.ts's `reportChainGameId` handler for where the id goes next.
   * Without it, `chainGameId` stays null forever and no client can ever
   * decrypt a role: every player's badge sits at WAITING permanently, not
   * just slowly.
   *
   * The contract's `createGame` returns the id as a function return value,
   * but that return value is only reachable from a *simulated* call — a real
   * `writeContract` submission gives back a transaction hash, not the return
   * value. So this waits for the receipt and reads the id back out of the
   * `GameCreated` event instead, which is the authoritative source either way.
   */
  const submitCreateGame = useCallback(
    async (players: `0x${string}`[]): Promise<string> => {
      if (mode !== 'inco' || !PARASITE_GAME_ADDRESS || !address) {
        throw new Error('Not in Inco mode, or no wallet connected.');
      }
      const wc = walletClient();
      if (!wc || !publicClient.current) throw new Error('Wallet not available.');

      const fee = (await publicClient.current.readContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'createFee',
        args: [BigInt(players.length)],
      })) as bigint;

      const hash = await wc.writeContract({
        address: PARASITE_GAME_ADDRESS,
        abi: PARASITE_GAME_ABI,
        functionName: 'createGame',
        args: [players],
        value: fee,
        chain: baseSepolia,
        account: wc.account,
      });

      const receipt = await publicClient.current.waitForTransactionReceipt({ hash });

      const [created] = parseEventLogs({
        abi: PARASITE_GAME_ABI,
        eventName: 'GameCreated',
        logs: receipt.logs,
      });
      const gameId = created?.args?.gameId;
      if (gameId === undefined) {
        throw new Error('createGame succeeded on-chain, but no GameCreated event was found.');
      }
      return gameId.toString();
    },
    [mode, address, walletClient]
  );

  /** Read the public "was this seat the Parasite" bit after an ejection. */
  const readEjectionReveal = useCallback(
    async (seat: Seat): Promise<boolean | null> => {
      if (mode !== 'inco' || !chainGameId || !PARASITE_GAME_ADDRESS || !publicClient.current) {
        return null;
      }
      try {
        return await revealEjectedSeat({
          rpcUrl: BASE_SEPOLIA_RPC,
          publicClient: publicClient.current,
          contractAddress: PARASITE_GAME_ADDRESS,
          gameId: BigInt(chainGameId),
          seat,
        });
      } catch {
        return null;
      }
    },
    [mode, chainGameId]
  );

  return { role, submitJump, submitPurgeAttempt, submitCreateGame, readEjectionReveal };
}
