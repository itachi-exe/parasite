'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_PLAYERS,
  TASKS_PER_PLAYER,
  TASK_DEFS,
  TASK_STATIONS,
  TASK_INTERACT_RADIUS,
  JUMP_RANGE,
  PURGE_RANGE,
  REPORT_BODY_RADIUS,
  AREAS,
  areaAt,
  distance,
  type SkinId,
  type TaskId,
  type Seat,
} from '@parasite/shared';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useRole } from '@/hooks/useRole';
import { PARASITE_GAME_ADDRESS } from '@/lib/contract';
import Lobby from './Lobby';
import TaskList from './TaskList';
import CrewList from './CrewList';
import TaskModal from './TaskModal';
import MeetingOverlay from './MeetingOverlay';
import AlertBanner, { type AlertPayload } from './AlertBanner';
import MiniMap from './MiniMap';
import GameStage from './GameStage';
import RoleBadge from './RoleBadge';
import EndOverlay from './EndOverlay';

/**
 * Top-level game client. Owns composition and the local-only concerns
 * (which task modal is open, which nearby target is selected); all authoritative
 * state comes from the socket, and all role state from useRole.
 */
export default function GameClient() {
  const sock = useGameSocket();
  const [joined, setJoined] = useState(false);
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [openTask, setOpenTask] = useState<TaskId | null>(null);
  const [myTasksDone, setMyTasksDone] = useState<TaskId[]>([]);
  const [showMap, setShowMap] = useState(true);
  const [jumping, setJumping] = useState(false);

  const { state, mySeat, positions } = sock;

  const { role, submitJump, readEjectionReveal } = useRole({
    state,
    mySeat,
    address: wallet,
    simulatedRole: sock.simulatedRole,
    onToast: sock.pushToast,
  });

  const isParasite = role.isParasite === true;
  const me = state?.players.find((p) => p.seat === mySeat) ?? null;

  // Every player gets all five tasks. The Parasite's are fake (see TaskList).
  const myTasks = useMemo(() => TASK_DEFS.map((t) => t.id), []);

  useEffect(() => {
    if (state?.phase === 'lobby') setMyTasksDone([]);
  }, [state?.phase]);

  const connectWallet = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<string[]> } })
      .ethereum;
    if (!eth) {
      sock.pushToast('warn', 'No injected wallet found. Install MetaMask for Inco mode.');
      return;
    }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts?.[0]) setWallet(accounts[0] as `0x${string}`);
    } catch {
      sock.pushToast('warn', 'Wallet connection rejected.');
    }
  }, [sock]);

  const handleJoin = useCallback(
    async (opts: { code: string; name: string; skin: SkinId }) => {
      try {
        await sock.join({ ...opts, address: wallet });
        setJoined(true);
      } catch {
        /* toast already surfaced by the hook */
      }
    },
    [sock, wallet]
  );

  // ── Proximity, computed from the fast position channel ─────────────────────
  const myPos = mySeat !== null ? positions.get(mySeat) : undefined;

  const nearestTask = useMemo(() => {
    if (!myPos || !me?.alive || state?.phase !== 'playing') return null;
    for (const id of myTasks) {
      if (myTasksDone.includes(id)) continue;
      const st = TASK_STATIONS[id];
      if (distance(myPos, st) <= TASK_INTERACT_RADIUS) return id;
    }
    return null;
  }, [myPos, me?.alive, state?.phase, myTasks, myTasksDone]);

  const nearestPlayer = useMemo(() => {
    if (!myPos || mySeat === null || !me?.alive || !state) return null;
    let best: { seat: Seat; d: number } | null = null;
    for (const p of state.players) {
      if (p.seat === mySeat || !p.alive) continue;
      const pos = positions.get(p.seat) ?? p;
      const d = distance(myPos, pos);
      if (!best || d < best.d) best = { seat: p.seat, d };
    }
    return best;
  }, [myPos, mySeat, me?.alive, state, positions]);

  const nearestBody = useMemo(() => {
    if (!myPos || !me?.alive || !state) return null;
    for (const b of state.bodies) {
      if (distance(myPos, b) <= REPORT_BODY_RADIUS) return b.seat;
    }
    return null;
  }, [myPos, me?.alive, state]);

  // Human-readable name of the area under the local player, for the canvas's
  // screen-reader alternative. Derived from the id so the memo only produces a
  // new string when the player actually crosses into a different area.
  const myAreaId = myPos ? areaAt(myPos.x, myPos.y) : null;
  const myArea = useMemo(
    () =>
      myAreaId && myAreaId !== 'path'
        ? (AREAS.find((a) => a.id === myAreaId)?.name ?? null)
        : null,
    [myAreaId]
  );

  // ── Ejection reveal: a client performs the on-chain read, not the server ───
  useEffect(() => {
    const pending = state?.meeting;
    if (!pending || pending.stage !== 'result') return;
    const seat = pending.result?.ejectedSeat;
    if (seat === null || seat === undefined) return;
    if (pending.result?.ejectedWasParasite !== null) return;
    if (role.mode !== 'inco') return;

    let cancelled = false;
    (async () => {
      const wasParasite = await readEjectionReveal(seat);
      if (cancelled || wasParasite === null) return;
      sock.submitEjectionReveal(wasParasite);
    })();
    return () => {
      cancelled = true;
    };
  }, [state?.meeting, role.mode, readEjectionReveal, sock]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const doTaskComplete = useCallback(async () => {
    if (!openTask) return;
    if (isParasite) {
      // The Parasite's tasks are fake: never report them, or the Parasite would
      // be helping the crew win. The UI still plays the minigame so a shoulder
      // surfer sees nothing unusual.
      setMyTasksDone((d) => [...d, openTask]);
      setOpenTask(null);
      sock.pushToast('info', 'Task faked. Nothing was submitted.');
      return;
    }
    await sock.completeTask(openTask);
    setMyTasksDone((d) => (d.includes(openTask) ? d : [...d, openTask]));
    setOpenTask(null);
  }, [openTask, isParasite, sock]);

  const doJump = useCallback(async () => {
    if (!nearestPlayer || nearestPlayer.d > JUMP_RANGE) {
      sock.pushToast('warn', 'Nobody in range to jump into.');
      return;
    }
    setJumping(true);
    try {
      // Server-side cooldown check first, so a rejected jump does not cost gas.
      const ack = await sock.jumpAnnounce(nearestPlayer.seat);
      if (!ack.ok) {
        sock.pushToast('warn', ack.error ?? 'Jump refused.');
        return;
      }
      if (role.mode === 'inco') {
        await submitJump(nearestPlayer.seat, false);
        sock.pushToast('info', 'Jump submitted to Inco. You are now in their body.');
      } else {
        sock.pushToast(
          'warn',
          'SIMULATED MODE: the jump is not on-chain and host transfer is not applied.'
        );
      }
    } catch (err) {
      sock.pushToast('error', err instanceof Error ? err.message : 'Jump failed.');
    } finally {
      setJumping(false);
    }
  }, [nearestPlayer, sock, role.mode, submitJump]);

  // The banner takes names, not seats, so it can be read without the roster.
  const alertPayload: AlertPayload | null = useMemo(() => {
    const a = sock.lastAlert;
    if (!a) return null;
    const nameOf = (seat: Seat) =>
      state?.players.find((p) => p.seat === seat)?.name ?? 'someone';
    return a.reason.kind === 'body'
      ? {
          kind: 'body',
          victim: nameOf(a.reason.victimSeat),
          actor: nameOf(a.reason.reporterSeat),
          nonce: a.nonce,
        }
      : { kind: 'emergency', actor: nameOf(a.reason.callerSeat), nonce: a.nonce };
  }, [sock.lastAlert, state?.players]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const phase = state?.phase ?? 'lobby';
  const inLobby = !joined || phase === 'lobby';

  const taskTotal = state ? Math.max(1, (state.players.length - 1) * TASKS_PER_PLAYER) : 1;
  const taskDone = state?.taskProgress.done ?? 0;
  const pct = Math.round((taskDone / (state?.taskProgress.total || taskTotal)) * 100);

  return (
    <div className="shell">
      <header className="panel topbar">
        <div className="brand">
          <span className="brand-title">PARASITE</span>
          <span className="brand-sub">VIRELIA RESEARCH OUTPOST</span>
        </div>

        <div className="topbar-spacer" />

        <div className="progress-wrap">
          <div className="progress-label">
            <span id="task-progress-label">OUTPOST TASKS</span>
            <span>
              {taskDone}/{state?.taskProgress.total ?? taskTotal}
            </span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-labelledby="task-progress-label"
            aria-valuemin={0}
            aria-valuemax={state?.taskProgress.total ?? taskTotal}
            aria-valuenow={taskDone}
            aria-valuetext={`${taskDone} of ${state?.taskProgress.total ?? taskTotal} outpost tasks complete`}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <RoleBadge role={role} onConnectWallet={connectWallet} />
      </header>

      <TaskList
        myTasks={myTasks}
        done={myTasksDone}
        activeTask={nearestTask}
        isParasite={isParasite}
      />

      <div className="stage">
        {/*
          Phaser is mounted only while a round is actually in progress.
          Its keyboard manager calls preventDefault() on W/A/S/D and the
          arrows globally, and no combination of addKey(enableCapture=false),
          clearCaptures() or manager.preventDefault would stop it — so while
          the lobby was open those four letters never reached the name or
          outpost-code fields. "Solo" arrived as "olo", "Okafor" as "Okfor".
          Not mounting the game under a screen that is asking the player to
          type is both the fix and the more sensible arrangement: the title
          screen draws its own canvas and has no use for a game loop.
        */}
        {!inLobby && (
        <GameStage
          state={state}
          mySeat={mySeat}
          positions={positions}
          isParasite={isParasite}
          onInput={sock.sendInput}
          inputEnabled={phase === 'playing' && !!me?.alive && !openTask}
        />
        )}
        {/*
          The canvas is an opaque <canvas> to assistive tech — a player using one
          has no way to know where they are standing. This is its text
          alternative: the current area plus whatever is in reach. It updates only
          when the *area* changes, not per frame, so it does not chatter.
        */}
        <p className="sr-only" role="status">
          {myArea ? `In ${myArea}.` : 'Between areas.'}
          {nearestTask
            ? ` ${TASK_DEFS.find((t) => t.id === nearestTask)!.name} is in reach.`
            : ''}
          {nearestBody !== null ? ' There is a body here.' : ''}
        </p>
        {showMap && state && (
          <MiniMap
            players={state.players}
            mySeat={mySeat}
            bodies={state.bodies}
            room={myArea}
          />
        )}
      </div>

      {state && (
        <CrewList players={state.players} mySeat={mySeat} isParasite={isParasite} />
      )}

      <footer className="panel actionbar">
        <button
          className="btn"
          aria-pressed={showMap}
          onClick={() => setShowMap((v) => !v)}
        >
          {/*
            Icon + label + keybind tab, per DESIGN.md §3. The visible label is
            aria-hidden and each button carries its own aria-label, because the
            glyph and the key tab are decoration to a screen reader — it needs
            the sentence, not "🗺 MAP TAB".
          */}
          <span className="ico" aria-hidden="true">🗺</span>
          <span aria-hidden="true">MAP</span>
          <span className="key" aria-hidden="true">TAB</span>
        </button>

        <button
          className="btn"
          disabled={!nearestTask || phase !== 'playing'}
          aria-label={
            nearestTask
              ? `Use ${TASK_DEFS.find((t) => t.id === nearestTask)!.name}`
              : 'Use — walk to a task station first'
          }
          onClick={() => nearestTask && setOpenTask(nearestTask)}
        >
          <span className="ico" aria-hidden="true">✦</span>
          <span aria-hidden="true">USE</span>
          <span className="key" aria-hidden="true">E</span>
        </button>

        <button
          className="btn btn-danger"
          disabled={nearestBody === null || phase !== 'playing'}
          aria-label={
            nearestBody === null ? 'Report — no body nearby' : 'Report the body'
          }
          onClick={() => nearestBody !== null && sock.reportBody(nearestBody)}
        >
          <span className="ico" aria-hidden="true">⚑</span>
          <span aria-hidden="true">REPORT</span>
          <span className="key" aria-hidden="true">R</span>
        </button>

        {/* Moved down out of the top bar: calling a meeting is an action, and it
            sat in the header only because the header used to span the screen. */}
        <button
          className="btn btn-danger"
          disabled={
            phase !== 'playing' || !me?.alive || (me?.emergencyMeetingsLeft ?? 0) <= 0
          }
          aria-label={`Call an emergency meeting. ${me?.emergencyMeetingsLeft ?? 0} remaining.`}
          onClick={() => sock.callMeeting()}
        >
          <span className="ico" aria-hidden="true">◈</span>
          <span aria-hidden="true">MEET</span>
          <span className="key" aria-hidden="true">{me?.emergencyMeetingsLeft ?? 0} LEFT</span>
        </button>

        {/*
          The Jump button is rendered for EVERY living player, not just the
          Parasite. A button that only appeared for the Parasite would leak the
          role to anyone glancing at a screen — and in Inco mode a human pressing
          it sends a real transaction that the contract turns into a no-op, which
          is exactly the decoy traffic the design depends on.
        */}
        <button
          className="btn btn-parasite"
          disabled={
            phase !== 'playing' ||
            !me?.alive ||
            jumping ||
            !nearestPlayer ||
            nearestPlayer.d > JUMP_RANGE
          }
          aria-busy={jumping}
          aria-label={
            nearestPlayer && nearestPlayer.d <= JUMP_RANGE
              ? `Jump into ${state?.players.find((p) => p.seat === nearestPlayer.seat)?.name ?? 'the nearest scientist'}`
              : 'Jump — nobody in range'
          }
          onClick={doJump}
        >
          <span className="ico" aria-hidden="true">⇌</span>
          <span aria-hidden="true">{jumping ? '…' : 'JUMP'}</span>
          <span className="key" aria-hidden="true">F</span>
        </button>

        {isParasite && (
          <button
            className="btn btn-danger"
            disabled={
              phase !== 'playing' ||
              !me?.alive ||
              !nearestPlayer ||
              nearestPlayer.d > PURGE_RANGE
            }
            aria-label={
              nearestPlayer && nearestPlayer.d <= PURGE_RANGE
                ? `Purge ${state?.players.find((p) => p.seat === nearestPlayer.seat)?.name ?? 'the nearest scientist'}`
                : 'Purge — nobody in range'
            }
            onClick={() => nearestPlayer && sock.purge(nearestPlayer.seat)}
          >
            <span className="ico" aria-hidden="true">☣</span>
            <span aria-hidden="true">PURGE</span>
            <span className="key" aria-hidden="true">Q</span>
          </button>
        )}

        {/*
          The movement hint is gone — every control now carries its own key on a
          tab, so the only thing left worth saying is who is actually in reach,
          and that belongs next to the buttons that act on them.
        */}
        <span className="hint" role="status">
          {nearestPlayer && nearestPlayer.d <= JUMP_RANGE
            ? `${state?.players.find((p) => p.seat === nearestPlayer.seat)?.name} is in range`
            : ''}
        </span>
      </footer>

      <AlertBanner alert={alertPayload} />

      {/* Overlays */}
      {inLobby && (
        <Lobby
          chat={sock.chat}
          onSendChat={sock.sendChat}
          mySeat={mySeat}
          state={state}
          connected={sock.connected}
          joined={joined}
          isHost={!!state && !!me && state.hostId === me.id}
          roleMode={role.mode}
          contractAddress={PARASITE_GAME_ADDRESS}
          walletAddress={wallet}
          onConnectWallet={connectWallet}
          onJoin={handleJoin}
          onStart={() => sock.startGame()}
        />
      )}

      {openTask && (
        <TaskModal
          taskId={openTask}
          onComplete={doTaskComplete}
          onClose={() => setOpenTask(null)}
        />
      )}

      {state?.meeting && phase === 'meeting' && (
        <MeetingOverlay
          chat={sock.chat}
          onSendChat={sock.sendChat}
          meeting={state.meeting}
          players={state.players}
          mySeat={mySeat}
          onVote={(t) => sock.castVote(t)}
          roleMode={role.mode}
        />
      )}

      {sock.end && <EndOverlay end={sock.end} players={state?.players ?? []} />}

      {/*
        Toasts carry the only feedback for a refused jump, a kick, or a purge —
        losing them to a screen reader loses the reason the game just said no.
        Polite, not assertive: the stream mixes routine notices ("Task faked")
        with real errors, and interrupting on every one of them is worse than a
        short wait.
      */}
      <div className="toasts" role="log" aria-live="polite" aria-atomic="false">
        {sock.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
