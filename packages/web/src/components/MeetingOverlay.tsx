'use client';

import { useEffect, useState } from 'react';
import type { MeetingState, PublicPlayer, Seat } from '@parasite/shared';
import { useDialog } from '@/hooks/useDialog';

const SKIN_SRC = [
  '/sprites/human-0.png',
  '/sprites/human-1.png',
  '/sprites/human-2.png',
  '/sprites/human-3.png',
];

/**
 * Emergency meeting overlay: discussion → voting → result.
 *
 * The result stage is where the game's one sanctioned role disclosure surfaces:
 * "X was / was not The Parasite", which comes from an on-chain `e.reveal` of a
 * single derived bit. Until that reveal lands the UI says so explicitly rather
 * than guessing.
 */
export default function MeetingOverlay(props: {
  meeting: MeetingState;
  players: PublicPlayer[];
  mySeat: Seat | null;
  onVote: (target: Seat | 'skip') => void;
  roleMode: 'inco' | 'simulated';
}) {
  const { meeting, players, mySeat, onVote, roleMode } = props;
  const [now, setNow] = useState(Date.now());

  // No onClose: a meeting is mandatory, so Escape must not dismiss it. The hook
  // still contains Tab within the dialog and moves focus in on open.
  const dialogRef = useDialog();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((meeting.endsAt - now) / 1000));
  const urgent = secondsLeft <= 10;
  const me = players.find((p) => p.seat === mySeat);
  const myVote = mySeat !== null ? meeting.votes[mySeat] : undefined;
  const alive = players.filter((p) => p.alive);
  const votesIn = Object.keys(meeting.votes).length;

  // Hoisted to a local so TypeScript narrows the discriminated union; reading
  // `meeting.reason.callerSeat` through the property chain defeats narrowing.
  const why = meeting.reason;
  const nameOf = (seat: Seat) => players.find((p) => p.seat === seat)?.name ?? 'Someone';
  const reason =
    why.kind === 'emergency'
      ? `${nameOf(why.callerSeat)} called an emergency meeting`
      : `${nameOf(why.reporterSeat)} reported ${nameOf(why.victimSeat)}'s body`;

  return (
    <div className="overlay">
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-heading"
        tabIndex={-1}
      >
        <h2 id="meeting-heading">Emergency Meeting</h2>
        <p>{reason}</p>

        {/*
          The countdown ticks four times a second, so it is aria-hidden — a live
          region here would talk over the entire meeting. The stage label beside
          it carries the announcement instead, and only changes twice.
        */}
        {meeting.stage === 'discussion' && (
          <>
            <div className={`timer${urgent ? ' urgent' : ''}`} aria-hidden="true">
              {secondsLeft}s
            </div>
            <p style={{ textAlign: 'center' }} role="status">
              Discussion. Voting opens in {secondsLeft} seconds.
            </p>
          </>
        )}

        {meeting.stage === 'voting' && (
          <>
            <div className={`timer${urgent ? ' urgent' : ''}`} aria-hidden="true">
              {secondsLeft}s
            </div>
            <p className="sr-only" role="status">
              Voting is open. {secondsLeft} seconds remaining.
            </p>
            <div className="vote-grid" role="group" aria-label="Cast your vote">
              {alive.map((p) => (
                <button
                  key={p.seat}
                  className={`vote-card${myVote === p.seat ? ' voted' : ''}`}
                  disabled={!me?.alive || myVote !== undefined}
                  aria-pressed={myVote === p.seat}
                  onClick={() => onVote(p.seat)}
                >
                  <img src={SKIN_SRC[p.skin % 4]} alt="" />
                  <span>
                    {p.name}
                    {p.seat === mySeat ? ' (you)' : ''}
                  </span>
                </button>
              ))}
              <button
                className={`vote-card${myVote === 'skip' ? ' voted' : ''}`}
                disabled={!me?.alive || myVote !== undefined}
                aria-pressed={myVote === 'skip'}
                onClick={() => onVote('skip')}
              >
                <span
                  aria-hidden="true"
                  style={{ fontSize: 22, width: 38, textAlign: 'center' }}
                >
                  ⊘
                </span>
                <span>Skip vote</span>
              </button>
            </div>
            <div className="muted" role="status">
              {votesIn}/{alive.length} votes in
              {!me?.alive && ' · the dead cannot vote'}
            </div>
          </>
        )}

        {meeting.stage === 'result' && meeting.result && (
          <ResultView result={meeting.result} players={players} roleMode={roleMode} />
        )}
      </div>
    </div>
  );
}

function ResultView(props: {
  result: NonNullable<MeetingState['result']>;
  players: PublicPlayer[];
  roleMode: 'inco' | 'simulated';
}) {
  const { result, players, roleMode } = props;

  if (result.ejectedSeat === null) {
    return (
      <div className="banner crew" role="status">
        {result.tie ? 'The vote was tied. Nobody was ejected.' : 'Nobody was ejected.'}
      </div>
    );
  }

  const ejected = players.find((p) => p.seat === result.ejectedSeat);
  const name = ejected?.name ?? `Seat ${result.ejectedSeat}`;

  return (
    <>
      {/*
        The ejection result arrives asynchronously — the reveal is an on-chain
        read that lands a moment after the banner first renders — so this is a
        live region rather than static text.
      */}
      <div
        className={`banner ${result.ejectedWasParasite ? 'parasite' : 'crew'}`}
        role="status"
      >
        {result.ejectedWasParasite === null ? (
          <>
            {name} was ejected.
            <br />
            <span className="muted">
              {roleMode === 'inco'
                ? 'Decrypting the ejection reveal from Inco…'
                : 'Resolving…'}
            </span>
          </>
        ) : result.ejectedWasParasite ? (
          <>{name} was The Parasite.</>
        ) : (
          <>{name} was not The Parasite.</>
        )}
      </div>

      {roleMode === 'inco' && (
        <div className="mono-note">
          This single bit — &ldquo;was this seat the host?&rdquo; — is the only role
          information the contract ever reveals during play. It is computed as
          <code> e.eq(hostSeat, ejectedSeat)</code> and published with
          <code> e.reveal</code>. The host seat itself stays encrypted, so a
          &ldquo;not the Parasite&rdquo; result leaves the Parasite hidden among
          everyone still alive.
        </div>
      )}
    </>
  );
}
