'use client';

import { useEffect, useState } from 'react';
import { playParasiteReveal } from '@/lib/sfx';

/**
 * Full-screen, unmissable "YOU ARE THE PARASITE" moment — deliberately much
 * louder than the quiet RoleBadge update in the top bar. Fires once per
 * HUMAN/unknown → PARASITE transition (game start, or a mid-game jump
 * landing on this client) — never the reverse: losing the role just clears
 * the badge quietly, "you're safe now" does not need the same drama as
 * "you are now the threat."
 *
 * Self-dismisses after a few seconds; a click, tap, or keypress dismisses
 * early so it never traps a player who needs to act.
 */
export default function RoleRevealOverlay({ onDone }: { onDone: () => void }) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    playParasiteReveal();

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setClosing(true);
      setTimeout(onDone, 260);
    };

    const autoTimer = setTimeout(dismiss, 3200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(autoTimer);
      window.removeEventListener('keydown', onKey);
    };
    // Fire-once on mount: this component is only ever mounted for the
    // duration of one reveal, keyed by the parent on each new trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`role-reveal${closing ? ' closing' : ''}`}
      role="alert"
      aria-label="You are now the Parasite. Nobody else knows."
      onClick={() => {
        setClosing(true);
        setTimeout(onDone, 260);
      }}
    >
      <div className="role-reveal-noise" aria-hidden="true" />
      <div className="role-reveal-body">
        <span className="role-reveal-eyebrow">infection detected</span>
        <h1 className="role-reveal-title">YOU ARE THE PARASITE</h1>
        <p className="role-reveal-sub">
          Nobody else knows. Not even whoever infected you. Move carefully.
        </p>
      </div>
    </div>
  );
}
