'use client';

import { useEffect, useRef, useState } from 'react';

export type AlertKind = 'body' | 'emergency' | 'purged';

export interface AlertPayload {
  kind: AlertKind;
  /** Who found it / who called it. */
  actor?: string;
  /** Who it happened to. */
  victim?: string;
  /** Bumped by the caller so the same kind can fire twice in a row. */
  nonce: number;
}

const COPY: Record<AlertKind, { title: string; tone: string }> = {
  body: { title: 'BODY FOUND', tone: 'danger' },
  emergency: { title: 'EMERGENCY MEETING', tone: 'warn' },
  purged: { title: 'SOMEONE WAS PURGED', tone: 'danger' },
};

/**
 * The loud moment.
 *
 * Body-found and emergency calls were surfacing as a 4-second toast in the
 * corner — the same treatment as "Task faked. Nothing was submitted." A body
 * turning up is the hinge the entire round swings on, and the reference this
 * project is measured against gives it the whole screen (DESIGN.md §8).
 *
 * Deliberately *not* a dialog: it steals no focus, traps nothing and cannot be
 * interacted with. It is an announcement that plays and leaves, and the meeting
 * overlay — which IS a dialog — arrives underneath it. Making this focusable
 * would mean two focus traps fighting over the same moment.
 */
export default function AlertBanner(props: { alert: AlertPayload | null }) {
  const { alert } = props;
  const [shown, setShown] = useState<AlertPayload | null>(null);
  const lastNonce = useRef<number | null>(null);

  useEffect(() => {
    // Guard on the nonce, not on object identity. The payload is rebuilt by a
    // useMemo whose deps include the player list, so it gets a fresh identity
    // on every state snapshot — keying the effect on the object itself re-fired
    // the banner mid-meeting and covered the vote grid with it.
    if (!alert || alert.nonce === lastNonce.current) return;
    lastNonce.current = alert.nonce;
    setShown(alert);
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
  }, [alert]);

  if (!shown) return null;
  const copy = COPY[shown.kind];

  return (
    <div className={`alert-banner ${copy.tone}`} role="alert" aria-live="assertive">
      <div className="alert-streak" />
      <div className="alert-inner">
        <span className="alert-title">{copy.title}</span>
        {(shown.victim || shown.actor) && (
          <span className="alert-sub">
            {shown.kind === 'body' && shown.victim
              ? `${shown.victim} — reported by ${shown.actor ?? 'someone'}`
              : shown.kind === 'emergency'
                ? `called by ${shown.actor ?? 'someone'}`
                : (shown.victim ?? '')}
          </span>
        )}
      </div>
    </div>
  );
}
