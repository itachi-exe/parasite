'use client';

import type { RoleState } from '@/hooks/useRole';

/**
 * Top-bar role indicator, visible only to this player.
 *
 * Always states which backend produced the role. A player must never be left
 * guessing whether their "secret" is actually protected, so SIMULATED is shown
 * as prominently as INCO rather than hidden in a settings page.
 *
 * In Inco mode the role is a ciphertext only the player's own wallet can open,
 * so with no wallet connected there is genuinely nothing to show. That state
 * used to render as a bare placeholder that sat there indefinitely, which reads
 * as the game being broken rather than as an action being required, so when a
 * connect handler is available the badge becomes a button that asks for one.
 *
 * Once connected, there was previously no way back out of that state short of
 * revoking the site from the wallet extension itself. `onDisconnectWallet`
 * closes that gap: a small control appears alongside the badge whenever a
 * wallet address is attached, letting a player forget the wrong account (or
 * just disconnect) without leaving the page.
 */
export default function RoleBadge({
  role,
  walletAddress,
  onConnectWallet,
  onDisconnectWallet,
}: {
  role: RoleState;
  walletAddress?: string | null;
  onConnectWallet?: () => void;
  onDisconnectWallet?: () => void;
}) {
  const known = role.isParasite !== null;
  const cls = !known ? '' : role.isParasite ? ' parasite' : ' human';

  // A wallet being connected has to rule this out, or the badge gets stuck
  // showing "CONNECT WALLET" (with no way to disconnect) for the whole
  // stretch between connecting and the game actually starting, since nothing
  // decrypts until there is a chain game id to decrypt against — and again
  // after any failed decrypt, since that also leaves `known` false.
  const needsWallet = role.mode === 'inco' && !known && !role.busy && !walletAddress;
  const mode = role.mode === 'inco' ? 'INCO ENCRYPTED' : 'SIMULATED, NOT ENCRYPTED';
  const explanation =
    role.mode === 'inco'
      ? 'Decrypted in your browser from an Inco ciphertext only your wallet can open.'
      : 'Simulated role from the game server. NOT encrypted.';

  const label = role.busy
    ? 'DECRYPTING'
    : known
      ? role.isParasite
        ? 'PARASITE'
        : 'HUMAN'
      : needsWallet
        ? 'CONNECT WALLET'
        : 'WAITING';

  const body = (
    <>
      <span className="role-dot" aria-hidden="true" />
      <span className="role-text" aria-hidden="true">
        <span className="role-main">{label}</span>
        <span className={`role-mode ${role.mode === 'inco' ? 'inco' : 'sim'}`}>{mode}</span>
      </span>
    </>
  );

  // Connected: a wallet is attached, whether or not the role has resolved
  // yet. Only case with anything to disconnect from.
  const canDisconnect = role.mode === 'inco' && !!walletAddress && !!onDisconnectWallet;

  if (needsWallet && onConnectWallet) {
    return (
      <button
        type="button"
        className={`role-badge needs-wallet${cls}`}
        title={`${explanation} Connect a wallet to decrypt it.`}
        onClick={onConnectWallet}
        aria-label={`Your role is encrypted. Connect a wallet to decrypt it. ${explanation}`}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={`role-badge${cls}${canDisconnect ? ' has-wallet' : ''}`}
      title={explanation}
      /*
        role=status, not a bare div: the badge starts unresolved, flips to
        DECRYPTING and then to the real role as the ciphertext comes back.
        Without a live region that transition is silent.
      */
      role="status"
      aria-label={`Your role: ${label}. ${mode}. ${explanation}`}
    >
      {body}
      {canDisconnect && (
        <button
          type="button"
          className="role-disconnect"
          onClick={(e) => {
            e.stopPropagation();
            onDisconnectWallet!();
          }}
          title={`Disconnect ${walletAddress!.slice(0, 6)}…${walletAddress!.slice(-4)}`}
          aria-label={`Disconnect wallet ${walletAddress}`}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
