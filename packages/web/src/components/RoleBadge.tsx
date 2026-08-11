'use client';

import type { RoleState } from '@/hooks/useRole';

/**
 * Top-bar role indicator — visible only to this player.
 *
 * Always states which backend produced the role. A player must never be left
 * guessing whether their "secret" is actually protected, so SIMULATED is shown
 * as prominently as INCO rather than hidden in a settings page.
 */
export default function RoleBadge({ role }: { role: RoleState }) {
  const known = role.isParasite !== null;
  const cls = !known ? '' : role.isParasite ? ' parasite' : ' human';

  const label = role.busy ? 'DECRYPTING…' : known ? (role.isParasite ? 'PARASITE' : 'HUMAN') : '—';
  const mode = role.mode === 'inco' ? 'INCO ENCRYPTED' : 'SIMULATED · NOT ENCRYPTED';
  const explanation =
    role.mode === 'inco'
      ? 'Decrypted in your browser from an Inco ciphertext only your wallet can open.'
      : 'Simulated role from the game server. NOT encrypted.';

  return (
    <div
      className={`role-badge${cls}`}
      title={explanation}
      /*
        role=status, not a bare div: the badge starts as "—", flips to
        "DECRYPTING…" and then to the real role as the ciphertext comes back.
        Without a live region that transition is silent.
      */
      role="status"
      aria-label={`Your role: ${label}. ${mode}. ${explanation}`}
    >
      <span className="role-dot" aria-hidden="true" />
      <span className="role-text" aria-hidden="true">
        <span className="role-main">{label}</span>
        <span className={`role-mode ${role.mode === 'inco' ? 'inco' : 'sim'}`}>{mode}</span>
      </span>
    </div>
  );
}
