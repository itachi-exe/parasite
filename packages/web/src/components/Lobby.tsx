'use client';

import { useState } from 'react';
import { MIN_PLAYERS, MAX_PLAYERS, type RoomState, type SkinId } from '@parasite/shared';

const SKIN_SRC = [
  '/sprites/human-0.png',
  '/sprites/human-1.png',
  '/sprites/human-2.png',
  '/sprites/human-3.png',
];

export default function Lobby(props: {
  state: RoomState | null;
  connected: boolean;
  joined: boolean;
  isHost: boolean;
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
  walletAddress: string | null;
  onConnectWallet: () => void;
  onJoin: (opts: { code: string; name: string; skin: SkinId }) => void;
  onStart: () => void;
}) {
  const {
    state,
    connected,
    joined,
    isHost,
    roleMode,
    contractAddress,
    walletAddress,
    onConnectWallet,
    onJoin,
    onStart,
  } = props;

  const [name, setName] = useState('');
  const [code, setCode] = useState('VIRELIA');
  const [skin, setSkin] = useState<SkinId>(0);

  const count = state?.players.length ?? 0;
  const canStart = count >= MIN_PLAYERS && count <= MAX_PLAYERS;

  return (
    <div className="overlay">
      <div className="modal">
        <h2>PARASITE</h2>
        <p>
          Virelia Research Outpost · one of you is not what they appear to be.
          <br />
          Hidden roles are encrypted with Inco Lightning FHE — nobody, not even the
          game server, can read them.
        </p>

        {!joined ? (
          <>
            <div className="field">
              <label htmlFor="lobby-name">Name</label>
              <input
                id="lobby-name"
                value={name}
                maxLength={16}
                placeholder="Dr. Okafor"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && connected) onJoin({ code, name, skin });
                }}
              />
            </div>

            <div className="field">
              <label htmlFor="lobby-code">Outpost code</label>
              <input
                id="lobby-code"
                value={code}
                maxLength={12}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>

            <div className="field">
              <label>Choose your scientist</label>
              <div className="skins">
                {SKIN_SRC.map((src, i) => (
                  <button
                    key={src}
                    className={`skin${skin === i ? ' sel' : ''}`}
                    onClick={() => setSkin(i as SkinId)}
                    aria-label={`Scientist ${i + 1}`}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="row">
              <button
                className="btn btn-lg"
                disabled={!connected}
                onClick={() => onJoin({ code, name, skin })}
              >
                {connected ? 'Join outpost' : 'Connecting…'}
              </button>
              {roleMode === 'inco' && (
                <button className="btn" onClick={onConnectWallet}>
                  {walletAddress
                    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                    : 'Connect wallet'}
                </button>
              )}
            </div>

            {!connected && (
              <div className="mono-note">
                Cannot reach the game server. Start it with <code>npm run dev:server</code>{' '}
                (or <code>npm run dev</code> to run both).
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
              <strong style={{ letterSpacing: '0.1em' }}>
                {count} / {MAX_PLAYERS} scientists
              </strong>
              <span className={count >= MIN_PLAYERS ? 'pill ok' : 'pill'}>
                {count >= MIN_PLAYERS ? 'READY' : `NEED ${MIN_PLAYERS - count} MORE`}
              </span>
            </div>

            <div className="vote-grid" style={{ marginTop: 12 }}>
              {state?.players.map((p) => (
                <div key={p.seat} className="vote-card" style={{ cursor: 'default' }}>
                  <img src={SKIN_SRC[p.skin % 4]} alt="" />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>

            {isHost ? (
              <button className="btn btn-lg" disabled={!canStart} onClick={onStart}>
                {canStart ? 'Begin the expedition' : `Need ${MIN_PLAYERS}+ players`}
              </button>
            ) : (
              <div className="muted">Waiting for the lobby host to start…</div>
            )}

            <div className="mono-note">
              Once the expedition starts, <strong>nobody else can join</strong> and nobody
              can leave — enforced on the server, not just here. Open this page in{' '}
              {MIN_PLAYERS} browser tabs to test solo.
            </div>
          </>
        )}

        <div className="mono-note">
          {roleMode === 'inco' ? (
            <>
              <span className="pill ok">INCO MODE</span> Roles and the Jump run on Base
              Sepolia at <code>{contractAddress}</code>. Your role is decrypted in your
              browser with your wallet — the server never sees it.
            </>
          ) : (
            <>
              <span className="pill bad">SIMULATED MODE</span> No contract configured, so
              roles are assigned by the game server and are{' '}
              <strong>not encrypted</strong>. The game is fully playable, but the
              confidentiality guarantee is absent. Deploy the contract and set{' '}
              <code>NEXT_PUBLIC_PARASITE_GAME_ADDRESS</code> to enable real Inco mode.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
