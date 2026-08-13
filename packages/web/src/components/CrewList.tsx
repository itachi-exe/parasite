'use client';

import type { PublicPlayer, Seat } from '@parasite/shared';

const SKIN_SRC = [
  '/sprites/human-0.png',
  '/sprites/human-1.png',
  '/sprites/human-2.png',
  '/sprites/human-3.png',
];

/**
 * Right panel: the crew roster, using the official chibi avatars.
 *
 * Deliberately shows NO role information for anyone other than the local player,
 * and even for them only after they have decrypted their own bit. There is no
 * code path here that could render another player's role, because the state this
 * component receives never contains one.
 */
export default function CrewList(props: {
  players: PublicPlayer[];
  mySeat: Seat | null;
  isParasite: boolean;
}) {
  const { players, mySeat, isParasite } = props;

  return (
    <section className="panel sidebar sidebar-right" aria-labelledby="crew-heading">
      <h2 className="panel-title" id="crew-heading">
        Crew {players.filter((p) => p.alive).length} alive
      </h2>
      <div className="scroll">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {players.map((p) => {
            const isMe = p.seat === mySeat;
            // Only ever reveal the Parasite art for the local player's own row.
            const src = isMe && isParasite ? '/sprites/parasite.png' : SKIN_SRC[p.skin % 4];
            return (
              <li
                key={p.seat}
                className={`crew${isMe ? ' me' : ''}${p.alive ? '' : ' dead'}`}
              >
                <img className="crew-avatar" src={src} alt="" />
                <div className="crew-info">
                  <div className="crew-name">
                    {p.name}
                    {isMe ? ' (you)' : ''}
                  </div>
                  <div className="crew-sub">
                    {p.alive ? `${p.tasksDone}/5 tasks` : 'deceased'}
                    {!p.connected && p.alive ? ' offline' : ''}
                  </div>
                </div>
                {/* "DEAD" is already in crew-sub as "deceased" for AT. */}
                {!p.alive && (
                  <span className="crew-tag" aria-hidden="true">
                    DEAD
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
