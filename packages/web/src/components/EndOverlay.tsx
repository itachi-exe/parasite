'use client';

import type { EndState, PublicPlayer } from '@parasite/shared';
import { useDialog } from '@/hooks/useDialog';

import { portraitPath } from '../game/presentation';

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
export default function EndOverlay(props: { end: EndState; players: PublicPlayer[]; roleMode?: 'inco' | 'simulated' }) {
  const { end, players, roleMode = 'simulated' } = props;

  // No onClose: the game is over, there is nothing to dismiss back to.
  const dialogRef = useDialog();

  const crewWon = end.winner === 'crew';
  const parasite =
    end.revealedParasiteSeat !== null
      ? players.find((p) => p.seat === end.revealedParasiteSeat)
      : null;

  return (
    <div className="overlay">
      <div
        className="modal"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="end-heading"
        aria-describedby="end-reason"
        tabIndex={-1}
        style={{ textAlign: 'center' }}
      >
        <h2 id="end-heading" className={`end-title ${crewWon ? 'crew' : 'parasite'}`}>
          {crewWon ? 'THE OUTPOST SURVIVED' : 'THE PARASITE WON'}
        </h2>
        <p id="end-reason">{REASON_TEXT[end.reason]}</p>

        {/*
          There was a "Reveal the Parasite" button here. It set a state nothing
          read — no click path existed, because the final reveal is resolved by
          the server in simulated mode and there is no wire event for a client to
          submit one in Inco mode. Publishing that event is a protocol change and
          out of scope for a polish pass, so the dead control is replaced with an
          honest description of what the game is waiting for. A button that looks
          tappable and does nothing is worse than no button.
        */}
        {!crewWon && !parasite && (
          <div className="mono-note" role="status">
            {roleMode === 'inco' ? 'Waiting for the on-chain host reveal.' : 'Waiting for the final host reveal.'}
          </div>
        )}

        {!crewWon && parasite && (
          <div className="banner parasite" role="status">
            <img
              src={portraitPath(parasite.seat, parasite.skin, 'parasite')}
              alt=""
              style={{ width: 64, height: 64, objectFit: 'contain', verticalAlign: 'middle' }}
            />{' '}
            {parasite.name} was the Parasite.
          </div>
        )}

        {crewWon && (
          <div className="mono-note">
            {roleMode === 'inco' ? 'The host seat remains encrypted unless publicly revealed.' : 'Local practice round. Roles were not encrypted.'}
          </div>
        )}

        {/* Was "Refresh the page to return to the lobby" — an instruction the UI
            can simply carry out. */}
        <button
          className="btn btn-lg"
          style={{ marginTop: 16 }}
          onClick={() => window.location.reload()}
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
