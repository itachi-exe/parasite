'use client';

import { useState } from 'react';
import { MIN_PLAYERS, MAX_PLAYERS, type RoomState, type SkinId, type Seat } from '@parasite/shared';
import { useDialog } from '@/hooks/useDialog';
import MenuBackdrop from './MenuBackdrop';
import ChatPanel from './ChatPanel';

import { portraitPath } from '../game/presentation';

const SKIN_SRC = [0, 1, 2, 3].map((skin) => portraitPath(0, skin));

const SKIN_NAME = ['Amber', 'Indigo', 'Rust', 'Slate'];

type Sheet = null | 'join' | 'how';

/**
 * Title screen and lobby.
 *
 * Structured after the menu the owner supplied as a reference: full-bleed
 * scene, status chip top-left, settings top-right, a stacked display logo over
 * a single dominant primary action, quieter secondary actions beneath it, and a
 * status card in the lower-right corner. Nothing here reproduces that game's
 * art or wordmark — the layout grammar is the borrowed part, and it is borrowed
 * because it is *good*: one obvious thing to press, everything else subordinate.
 *
 * PLAY opens the join sheet rather than joining immediately, which is what
 * gives the title screen room to be a title screen instead of a form.
 */
export default function Lobby(props: {
  chat: import('@parasite/shared').ChatMessage[];
  onSendChat: (text: string) => void;
  mySeat: Seat | null;
  state: RoomState | null;
  connected: boolean;
  joined: boolean;
  isHost: boolean;
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
  walletAddress: string | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
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
    onDisconnectWallet,
    onJoin,
    onStart,
  } = props;

  const [name, setName] = useState('');
  const [code, setCode] = useState('VIRELIA');
  const [skin, setSkin] = useState<SkinId>(0);
  const [joining, setJoining] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

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

  // ── Waiting room ──────────────────────────────────────────────────────────
  // Once joined, the title screen has done its job and gets out of the way.
  if (joined) {
    return (
      <div className="menu">
        <MenuBackdrop />
        <div className="menu-scrim" />
        <div className="waitroom" role="region" aria-label="Lobby">
          <h2 className="waitroom-title">VIRELIA {code}</h2>

          <div className="waitroom-head" role="status">
            <strong>
              {count} / {MAX_PLAYERS} scientists
            </strong>
            <span className={count >= MIN_PLAYERS ? 'pill ok' : 'pill'}>
              {count >= MIN_PLAYERS ? 'READY' : `NEED ${MIN_PLAYERS - count} MORE`}
            </span>
          </div>

          <ul className="crew-strip">
            {state?.players.map((p) => (
              <li key={p.seat} className={`crew-chip${p.isBot ? ' bot' : ''}`}>
                <img src={portraitPath(p.seat, p.skin)} alt="" />
                <span>
                  {p.name}
                  {p.isBot ? ' (bot)' : ''}
                </span>
              </li>
            ))}
          </ul>

          {isHost ? (
            <button className="btn-play" disabled={!canStart} onClick={onStart}>
              {canStart ? 'Begin the expedition' : `Need ${MIN_PLAYERS}+ players`}
            </button>
          ) : (
            <div className="muted">Waiting for the lobby host to start…</div>
          )}

          <ChatPanel
            messages={props.chat}
            mySeat={props.mySeat}
            canSend={true}
            placeholder="Say hello"
            onSend={props.onSendChat}
          />

          <p className="mono-note">
            Once the expedition launches, <strong>the outpost seals</strong>. Nobody
            topside can join, and nobody down here leaves the surface.
          </p>
        </div>
      </div>
    );
  }

  // ── Title screen ──────────────────────────────────────────────────────────
  return (
    <div className="menu">
      <MenuBackdrop />
      <div className="menu-scrim" />

      {/* Top-left: what the reference uses for account state. Ours carries the
          only status a player can act on — whether the server is reachable. */}
      <div className="menu-status" role="status" aria-live="polite" aria-busy={!connected}>
        <span className={`dot${connected ? ' live' : ''}`} aria-hidden="true" />
        <span>{connected ? 'OUTPOST ONLINE' : 'CONNECTING…'}</span>
        {!connected && <span className="connection-skeleton" aria-hidden="true" />}
      </div>

      <button
        className="menu-icon-btn"
        aria-label="How to play"
        aria-expanded={sheet === 'how'}
        onClick={() => setSheet(sheet === 'how' ? null : 'how')}
      >
        ?
      </button>

      <div className="menu-stack">
        {/* Stacked display logo. Three lines, mirroring the reference's
            three-word lockup, with the game's name carrying the weight. */}
        <h1 className="logo" aria-label="Host the Parasite">
          <span className="logo-sm" aria-hidden="true">HOST</span>
          <span className="logo-sm alt" aria-hidden="true">THE</span>
          <span className="logo-lg" aria-hidden="true">PARASITE</span>
        </h1>

        <p className="tagline">
          Virelia Research Outpost. One of you is not what they appear to be
        </p>

        <button
          className="btn-play"
          disabled={!connected}
          onClick={() => setSheet('join')}
        >
          {connected ? 'Play' : 'Connecting…'}
        </button>

        <div className="menu-secondary">
          <button className="btn-menu" onClick={() => setSheet('how')}>
            How to play
          </button>
          {roleMode === 'inco' && (
            <button
              className="btn-menu"
              onClick={walletAddress ? onDisconnectWallet : onConnectWallet}
              title={walletAddress ? 'Click to disconnect' : undefined}
            >
              {walletAddress
                ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                : 'Connect wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Lower-right card — the reference's "pet of the week" slot. The mode
          banner is the most important thing a judge or player can read about
          this build, so it gets the corner that already draws the eye. */}
      <aside className={`mode-card${roleMode === 'inco' ? ' inco' : ''}`}>
        <header>{roleMode === 'inco' ? 'INCO MODE' : 'SIMULATED MODE'}</header>
        <div className="mode-body">
          {roleMode === 'inco' ? (
            <>
              Roles and the Jump run on Base Sepolia. Your role is decrypted in your
              browser. The server never sees it.
            </>
          ) : (
            <>
              No contract configured, so roles come from the game server and are{' '}
              <strong>not encrypted</strong>. Fully playable; the confidentiality
              guarantee is absent.
            </>
          )}
        </div>
      </aside>

      {sheet === 'join' && (
        <JoinSheet
          name={name}
          code={code}
          skin={skin}
          joining={joining}
          connected={connected}
          onName={setName}
          onCode={setCode}
          onSkin={setSkin}
          onClose={() => setSheet(null)}
          onSubmit={submitJoin}
        />
      )}

      {sheet === 'how' && (
        <HowSheet
          roleMode={roleMode}
          contractAddress={contractAddress}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** The join form, unchanged in substance — only its container moved. */
function JoinSheet(props: {
  name: string;
  code: string;
  skin: SkinId;
  joining: boolean;
  connected: boolean;
  onName: (v: string) => void;
  onCode: (v: string) => void;
  onSkin: (v: SkinId) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const dialogRef = useDialog({ onClose: props.onClose });
  const submit = () => void props.onSubmit();

  return (
    <div className="overlay" onClick={props.onClose}>
      <div
        className="modal sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-heading"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="join-heading">Join the expedition</h2>

        <div className="field">
          <label htmlFor="lobby-name">Name</label>
          <input
            id="lobby-name"
            value={props.name}
            maxLength={16}
            placeholder="Dr. Cipher"
            autoComplete="off"
            aria-describedby="lobby-name-help"
            onChange={(e) => props.onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
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
            value={props.code}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="lobby-code-help"
            onChange={(e) => props.onCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <span className="field-help" id="lobby-code-help">
            Whoever's joining this expedition needs the exact same outpost code.
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
                aria-checked={props.skin === i}
                className={`skin${props.skin === i ? ' sel' : ''}`}
                onClick={() => props.onSkin(i as SkinId)}
                aria-label={SKIN_NAME[i] ?? `Scientist ${i + 1}`}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-play"
          disabled={!props.connected || props.joining}
          aria-busy={props.joining}
          onClick={submit}
        >
          {props.joining ? 'Joining…' : 'Join outpost'}
        </button>

        {!props.connected && (
          <div className="mono-note" role="status">
            Cannot reach the game server. Start it with <code>npm run dev:server</code>{' '}
            (or <code>npm run dev</code> to run both).
          </div>
        )}
      </div>
    </div>
  );
}

/** Rules, and what Inco mode actually changes. */
function HowSheet(props: {
  roleMode: 'inco' | 'simulated';
  contractAddress: string | null;
  onClose: () => void;
}) {
  const dialogRef = useDialog({ onClose: props.onClose });

  return (
    <div className="overlay" onClick={props.onClose}>
      <div
        className="modal sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-heading"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="how-heading">How to play</h2>

        <ul className="how-list">
          <li>
            <strong>Move</strong> with WASD or the arrow keys. Everyone starts as a
            scientist; one of you is the Parasite.
          </li>
          <li>
            <strong>Scientists</strong> finish tasks at the marked stations. Complete
            them all and the outpost survives.
          </li>
          <li>
            <strong>The Parasite</strong> purges scientists, and can Jump into another
            body to keep moving through the crew unnoticed.
          </li>
          <li>
            <strong>Anyone</strong> can call an emergency meeting or report a body. Then
            you argue, and you vote.
          </li>
          <li>
            The Jump button is shown to <em>everyone</em>, on purpose. A button only the
            Parasite could see would give the role away over a shoulder.
          </li>
        </ul>

        <div className="mono-note">
          {props.roleMode === 'inco' ? (
            <>
              <span className="pill ok">INCO MODE</span> Roles and the Jump run on Base
              Sepolia at <code>{props.contractAddress}</code>. Your role is decrypted in
              your browser with your wallet. The server never sees it.
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

        <button className="btn-menu" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
