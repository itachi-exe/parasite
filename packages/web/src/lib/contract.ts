/**
 * Contract ABI + addresses for ParasiteGame.
 *
 * Hand-written rather than imported from the Hardhat artifacts so the web app
 * has no build-order dependency on the contracts package.
 */

export const PARASITE_GAME_ABI = [
  {
    type: 'function',
    name: 'createGame',
    stateMutability: 'payable',
    inputs: [{ name: 'players', type: 'address[]' }],
    outputs: [{ name: 'gameId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'jump',
    stateMutability: 'payable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'targetSeatInput', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'attemptPurge',
    stateMutability: 'payable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'targetSeatInput', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealPurgeAudit',
    stateMutability: 'payable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealEjection',
    stateMutability: 'payable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'seat', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealHost',
    stateMutability: 'payable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'myRoleHandle',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'ejectionRevealHandle',
    stateMutability: 'view',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'seat', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'hostSeatHandle',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getSeats',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'gameInfo',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'creator', type: 'address' },
      { name: 'playerCount', type: 'uint256' },
      { name: 'jumpNonce', type: 'uint64' },
      { name: 'hostRevealed', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'seatOf',
    stateMutability: 'view',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'who', type: 'address' },
    ],
    outputs: [
      { name: 'found', type: 'bool' },
      { name: 'seat', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'jumpFee',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createFee',
    stateMutability: 'view',
    inputs: [{ name: 'n', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextGameId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'purgeAttemptFee',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'purgeAttemptCount',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'purgeAttemptHandles',
    stateMutability: 'view',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [
      { name: 'caller', type: 'address' },
      { name: 'targetSeat', type: 'bytes32' },
      { name: 'wasHost', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'purgeAuditFee',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'GameCreated',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'playerCount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Jumped',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PurgeAttempted',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PurgeAuditRevealed',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'count', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const PARASITE_GAME_ADDRESS =
  (process.env.NEXT_PUBLIC_PARASITE_GAME_ADDRESS?.trim() as `0x${string}` | undefined) || null;

export const BASE_SEPOLIA_RPC =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC?.trim() || 'https://sepolia.base.org';

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL?.trim() || 'http://127.0.0.1:9101';
