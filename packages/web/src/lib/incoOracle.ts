'use client';

import type { WalletClient, Transport, Chain, Account, PublicClient } from 'viem';
import { PARASITE_GAME_ABI } from './contract';

/**
 * Client-side Inco integration.
 *
 * ── The confidentiality boundary ─────────────────────────────────────────────
 *
 * Everything in this file runs in the PLAYER'S browser with the PLAYER'S wallet.
 * That is the whole point: `attestedDecrypt` requires an EIP-712 signature from
 * an address the contract granted access to, so only the owning player can turn
 * their role handle into a plaintext bit. The game server never sees a private
 * key and never receives a role — it only learns the single public bit a player
 * chooses to publish after an ejection vote.
 *
 * If this code ran server-side the confidentiality claim would collapse, so it
 * is marked 'use client' and only ever imported from client components.
 */

/** Loaded lazily: the SDK pulls in WASM/crypto that must not run during SSR. */
async function loadLightning() {
  const { Lightning } = await import('@inco/lightning-js/lite');
  return Lightning;
}

export type ChainWalletClient = WalletClient<Transport, Chain, Account>;

let cached: Promise<Awaited<ReturnType<typeof buildLightning>>> | null = null;

async function buildLightning(rpcUrl: string) {
  const Lightning = await loadLightning();
  return Lightning.baseSepoliaTestnet({ hostChainRpcUrls: [rpcUrl] });
}

/**
 * One Lightning instance per page load. It fetches the network public key and
 * covalidator endpoints over the network, so rebuilding it per call would add a
 * round trip to every jump.
 */
export function getLightning(rpcUrl: string) {
  if (!cached) {
    cached = buildLightning(rpcUrl).catch((err) => {
      cached = null; // let the next attempt retry rather than caching a failure
      throw err;
    });
  }
  return cached;
}

/**
 * Encrypt a seat index for `jump(gameId, targetSeatInput)`.
 *
 * The ciphertext is bound to (player address, dapp address) by Inco, so a
 * captured input cannot be replayed by another account or against another
 * contract.
 */
export async function encryptSeat(opts: {
  rpcUrl: string;
  seat: number;
  accountAddress: `0x${string}`;
  dappAddress: `0x${string}`;
}): Promise<`0x${string}`> {
  const lightning = await getLightning(opts.rpcUrl);
  const { handleTypes } = await import('@inco/lightning-js');
  return (await lightning.encrypt(BigInt(opts.seat), {
    accountAddress: opts.accountAddress,
    dappAddress: opts.dappAddress,
    handleType: handleTypes.euint256,
  })) as `0x${string}`;
}

const ZERO_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Read and decrypt the caller's own role bit.
 *
 * `myRoleHandle` is `msg.sender`-scoped in the contract, so this cannot be used
 * to read anyone else's handle — and even if a handle leaked, the covalidator
 * would refuse to decrypt it for a non-granted address.
 *
 * @returns true if this player is the Parasite host.
 */
export async function decryptMyRole(opts: {
  rpcUrl: string;
  publicClient: PublicClient;
  walletClient: ChainWalletClient;
  contractAddress: `0x${string}`;
  gameId: bigint;
}): Promise<boolean> {
  const handle = (await opts.publicClient.readContract({
    address: opts.contractAddress,
    abi: PARASITE_GAME_ABI,
    functionName: 'myRoleHandle',
    args: [opts.gameId],
    account: opts.walletClient.account,
  })) as `0x${string}`;

  if (handle === ZERO_HANDLE) {
    throw new Error('No role handle for this address — are you seated in this game?');
  }

  const lightning = await getLightning(opts.rpcUrl);
  const [attestation] = await lightning.attestedDecrypt(opts.walletClient, [handle]);
  if (!attestation) throw new Error('Covalidator returned no attestation for the role handle.');
  return toBool(attestation.plaintext.value);
}

/**
 * Read the PUBLIC reveal for an ejected seat.
 *
 * Unlike `decryptMyRole` this needs no wallet signature: `revealEjection` called
 * `e.allowPublic`, so `attestedReveal` works for anyone. This is the one role
 * bit the game intentionally makes public, and only for a seat that has already
 * been voted out.
 */
export async function revealEjectedSeat(opts: {
  rpcUrl: string;
  publicClient: PublicClient;
  contractAddress: `0x${string}`;
  gameId: bigint;
  seat: number;
}): Promise<boolean> {
  const handle = (await opts.publicClient.readContract({
    address: opts.contractAddress,
    abi: PARASITE_GAME_ABI,
    functionName: 'ejectionRevealHandle',
    args: [opts.gameId, BigInt(opts.seat)],
  })) as `0x${string}`;

  if (handle === ZERO_HANDLE) {
    throw new Error('Ejection reveal has not been requested on-chain for that seat yet.');
  }

  const lightning = await getLightning(opts.rpcUrl);
  const [attestation] = await lightning.attestedReveal([handle]);
  if (!attestation) throw new Error('Covalidator returned no attestation for the ejection reveal.');
  return toBool(attestation.plaintext.value);
}

/**
 * The SDK's plaintext value is intentionally loosely typed across handle types
 * (bool/uint/address all flow through the same attestation shape), so normalise
 * defensively rather than trusting one representation.
 */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v.startsWith('0x')) return BigInt(v) !== 0n;
    return Number(v) !== 0;
  }
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return toBool((value as Record<string, unknown>).value);
  }
  throw new Error(`Unrecognised plaintext shape from covalidator: ${String(value)}`);
}
