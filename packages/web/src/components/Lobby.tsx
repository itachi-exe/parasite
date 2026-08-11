'use client';

import { useState } from 'react';
import { MIN_PLAYERS, MAX_PLAYERS, type RoomState, type SkinId } from '@parasite/shared';
import { useDialog } from '@/hooks/useDialog';

const SKIN_SRC = [
  '/sprites/human-0.png',
  '/sprites/human-1.png',
  '/sprites/human-2.png',
  '/sprites/human-3.png',
];

const SKIN_NAME = ['Amber', 'Indigo', 'Rust', 'Slate'];

export default function Lobby(props: {
  state: RoomState | null;
  connected: boolean;
  joined: boolean;
  isHost: boolean;
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
  walletAddress: string | null;
  onConnectWallet: () => void;
  /* Returns a promise so the button can show a pending state; a plain void
     return is still accepted. */
  onJoin: (opts: { code: string; name: string; skin: SkinId }) => void | Promise<void>;
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
  const [joining, setJoining] = useState(false);

  // No onClose: the lobby is the entry point, so there is nothing behind it to
  // dismiss to.
  const dialogRef = useDialog();

  const count = state?.players.length ?? 0;
  const canStart = count >= MIN_PLAYERS && count <= MAX_PLAYERS;

  /**
   * Guards against the double-submit the bare handler allowed: joining is a
   * round trip, and the button gave no sign it was in flight.
   */
  const submitJoin = async () => {
    if (!connected || joining) return;
    setJoining(true);
    try {
      await onJoin({ code, name, skin });
    } finally {
      // The component unmounts on success, so this only matters on failure —
      // which is exactly when the button has to become usable again.
      setJoining(false);
    }
  };

  return (
    <div className="overlay">
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-heading"
        tabIndex={-1}
      >
        <h2 id="lobby-heading">PARASITE</h2>
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
                autoComplete="off"
                aria-describedby="lobby-name-help"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitJoin();
                }}
              />
              {/* The server assigns this fallback silently; saying so up front
                  beats a player wondering who "Scientist 3" is. */}
              <span className="field-help" id="lobby-name-help">
                Up to 16 characters. Leave it blank and the outpost will name you.
              </span>
            </div>

            <div className="field">
              <label htmlFor="lobby-code">Outpost code</label>
              <input
                id="lobby-code"
                value={code}
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="lobby-code-help"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitJoin();
                }}
              />
              <span className="field-help" id="lobby-code-help">
                Everyone joining the same game must type the same code.
              </span>
            </div>

            {/*
              A radiogroup rather than four buttons: a button conveys "activate
              me", not "one of these is chosen". With role=radio + aria-checked a
              screen reader announces "Amber, 1 of 4, selected", which is the
              actual state of this control.
            */}
            <div className="field">
              <span className="field-label" id="skin-label">
                Choose your scientist
              </span>
              <div className="skins" role="radiogroup" aria-labelledby="skin-label">
                {SKIN_SRC.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    role="radio"
                    aria-checked={skin === i}
                    className={`skin${skin === i ? ' sel' : ''}`}
                    onClick={() => setSkin(i as SkinId)}
                    aria-label={SKIN_NAME[i] ?? `Scientist ${i + 1}`}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="row">
              <button
                className="btn btn-lg"
                disabled={!connected || joining}
                aria-busy={joining}
                onClick={() => void submitJoin()}
              >
                {joining ? 'Joining…' : connected ? 'Join outpost' : 'Connecting…'}
              </button>
              {roleMode === 'inco' && (
                <button
                  className="btn"
                  onClick={onConnectWallet}
                  aria-label={
                    walletAddress
                      ? `Wallet connected: ${walletAddress}. Choose a different wallet.`
                      : 'Connect a wallet to decrypt your role'
                  }
                >
                  {walletAddress
                    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                    : 'Connect wallet'}
                </button>
              )}
            </div>

            {!connected && (
              <div className="mono-note" role="status">
                Cannot reach the game server. Start it with <code>npm run dev:server</code>{' '}
                (or <code>npm run dev</code> to run both).
              </div>
            )}
          </>
        ) : (
          <>
            {/*
              Polite live region: players trickle in while you are watching the
              lobby, and the count changing is the one thing you are waiting for.
            */}
            <div
              className="row"
              style={{ justifyContent: 'space-between', marginTop: 16 }}
              role="status"
            >
              <strong style={{ letterSpacing: '0.1em' }}>
                {count} / {MAX_PLAYERS} scientists
              </strong>
              <span className={count >= MIN_PLAYERS ? 'pill ok' : 'pill'}>
                {count >= MIN_PLAYERS ? 'READY' : `NEED ${MIN_PLAYERS - count} MORE`}
              </span>
            </div>

            <ul className="vote-grid" style={{ marginTop: 12, listStyle: 'none', padding: 0 }}>
              {state?.players.map((p) => (
                <li key={p.seat} className="vote-card">
                  <img src={SKIN_SRC[p.skin % 4]} alt="" />
                  <span>{p.name}</span>
                </li>
              ))}
            </ul>

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
