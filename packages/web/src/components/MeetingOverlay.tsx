'use client';

import { useEffect, useState } from 'react';
import type { MeetingState, PublicPlayer, Seat } from '@parasite/shared';

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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((meeting.endsAt - now) / 1000));
  const me = players.find((p) => p.seat === mySeat);
  const myVote = mySeat !== null ? meeting.votes[mySeat] : undefined;
  const alive = players.filter((p) => p.alive);

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
      <div className="modal">
        <h2>Emergency Meeting</h2>
        <p>{reason}</p>

        {meeting.stage === 'discussion' && (
          <>
            <div className="timer">{secondsLeft}s</div>
            <p style={{ textAlign: 'center' }}>Discussion. Voting opens when the timer ends.</p>
          </>
        )}

        {meeting.stage === 'voting' && (
          <>
            <div className="timer">{secondsLeft}s</div>
            <div className="vote-grid">
              {alive.map((p) => (
                <button
                  key={p.seat}
                  className={`vote-card${myVote === p.seat ? ' voted' : ''}`}
                  disabled={!me?.alive || myVote !== undefined}
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
                onClick={() => onVote('skip')}
              >
                <span style={{ fontSize: 22, width: 38, textAlign: 'center' }}>⊘</span>
                <span>Skip vote</span>
              </button>
            </div>
            <div className="muted">
              {Object.keys(meeting.votes).length}/{alive.length} votes in
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
      <div className="banner crew">
        {result.tie ? 'The vote was tied. Nobody was ejected.' : 'Nobody was ejected.'}
      </div>
    );
  }

  const ejected = players.find((p) => p.seat === result.ejectedSeat);
  const name = ejected?.name ?? `Seat ${result.ejectedSeat}`;

  return (
    <>
      <div className={`banner ${result.ejectedWasParasite ? 'parasite' : 'crew'}`}>
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
