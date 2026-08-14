'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, createWalletClient, custom, http, type PublicClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { RoomState, Seat } from '@parasite/shared';
import {
  PARASITE_GAME_ABI,
  PARASITE_GAME_ADDRESS,
  BASE_SEPOLIA_RPC,
} from '@/lib/contract';
import { decryptMyRole, encryptSeat, revealEjectedSeat, type ChainWalletClient } from '@/lib/incoOracle';

export type RoleMode = 'inco' | 'simulated';

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
}) {
  const { state, mySeat, address, simulatedRole, onToast } = opts;

  const mode: RoleMode = PARASITE_GAME_ADDRESS ? 'inco' : 'simulated';
  const [role, setRole] = useState<RoleState>({
    mode,
    isParasite: null,
    status: mode === 'inco' ? 'Awaiting encrypted role…' : 'Awaiting role…',
    busy: false,
    error: null,
  });

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

  /** Read the public "was this seat the Parasite" bit after an ejection. */
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

  return { role, submitJump, submitPurgeAttempt, readEjectionReveal };
}
