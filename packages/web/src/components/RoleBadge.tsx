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
 * as the game being broken rather than as an action being required — so when a
 * connect handler is available the badge becomes a button that asks for one.
 */
export default function RoleBadge({
  role,
  onConnectWallet,
}: {
  role: RoleState;
  onConnectWallet?: () => void;
}) {
  const known = role.isParasite !== null;
  const cls = !known ? '' : role.isParasite ? ' parasite' : ' human';

  const needsWallet = role.mode === 'inco' && !known && !role.busy;
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
      className={`role-badge${cls}`}
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
    </div>
  );
}
