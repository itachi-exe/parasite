'use client';

import { useState } from 'react';
import type { EndState, PublicPlayer } from '@parasite/shared';

const SKIN_SRC = [
  '/sprites/human-0.png',
  '/sprites/human-1.png',
  '/sprites/human-2.png',
  '/sprites/human-3.png',
];

const REASON_TEXT: Record<EndState['reason'], string> = {
  'crew-tasks': 'All outpost tasks were completed.',
  'crew-ejected-parasite': 'The Parasite was voted out.',
  'parasite-outnumber': 'The Parasite overwhelmed the survivors.',
  aborted: 'The expedition was aborted.',
};

/**
 * Game-over screen. Shows the winner and, for the Parasite win, the final host
 * seat that the contract reveals on-chain at game over.
 */
export default function EndOverlay(props: { end: EndState; players: PublicPlayer[] }) {
  const { end, players } = props;
  const [showReveal, setShowReveal] = useState(false);

  const crewWon = end.winner === 'crew';
  const parasite = end.revealedParasiteSeat !== null ? players.find((p) => p.seat === end.revealedParasiteSeat) : null;

  return (
    <div className="overlay">
      <div className="modal" style={{ textAlign: 'center' }}>
        <h2 style={{ color: crewWon ? '#2f9fd6' : '#7cff4f' }}>
          {crewWon ? 'THE OUTPOST SURVIVED' : 'THE PARASITE WON'}
        </h2>
        <p>{REASON_TEXT[end.reason]}</p>

        {!crewWon && !parasite && (
          <>
            <button className="btn" onClick={() => setShowReveal(true)}>
              Reveal the Parasite
            </button>
            <p className="muted" style={{ marginTop: 9 }}>
              The host seat is revealed on-chain with e.reveal at game over.
            </p>
          </>
        )}

        {!crewWon && parasite && (
          <div className={`banner ${crewWon ? 'crew' : 'parasite'}`}>
            <img
              src={parasite.skin !== undefined ? SKIN_SRC[parasite.skin % 4] : '/sprites/parasite.png'}
              alt=""
              style={{ width: 64, height: 64, objectFit: 'contain', verticalAlign: 'middle' }}
            />{' '}
            {parasite.name} was the Parasite.
          </div>
        )}

        {crewWon && (
          <div className="mono-note">
            The Parasite&apos;s host seat is still encrypted on-chain. Only a game-over
            reveal would publish it.
          </div>
        )}

        <p className="muted" style={{ marginTop: 14 }}>
          Refresh the page to return to the lobby.
        </p>
      </div>
    </div>
  );
}
