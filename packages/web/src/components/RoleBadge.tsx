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

  return (
    <div
      className={`role-badge${cls}`}
      title={
        role.mode === 'inco'
          ? 'Decrypted in your browser from an Inco ciphertext only your wallet can open.'
          : 'Simulated role from the game server. NOT encrypted.'
      }
    >
      <span className="role-dot" />
      <span className="role-text">
        <span className="role-main">
          {role.busy ? 'DECRYPTING…' : known ? (role.isParasite ? 'PARASITE' : 'HUMAN') : '—'}
        </span>
        <span className={`role-mode ${role.mode === 'inco' ? 'inco' : 'sim'}`}>
          {role.mode === 'inco' ? 'INCO ENCRYPTED' : 'SIMULATED · NOT ENCRYPTED'}
        </span>
      </span>
    </div>
  );
}
