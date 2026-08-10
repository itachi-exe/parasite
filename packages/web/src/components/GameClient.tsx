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
            <span>OUTPOST TASKS</span>
            <span>
              {taskDone}/{state?.taskProgress.total ?? taskTotal}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <RoleBadge role={role} />

        <button
          className="btn btn-danger"
          disabled={
            phase !== 'playing' || !me?.alive || (me?.emergencyMeetingsLeft ?? 0) <= 0
          }
          onClick={() => sock.callMeeting()}
        >
          Emergency ({me?.emergencyMeetingsLeft ?? 0})
        </button>
      </header>

      <TaskList
        myTasks={myTasks}
        done={myTasksDone}
        activeTask={nearestTask}
        isParasite={isParasite}
      />

      <div className="stage">
        <GameStage
          state={state}
          mySeat={mySeat}
          positions={positions}
          isParasite={isParasite}
          onInput={sock.sendInput}
          inputEnabled={phase === 'playing' && !!me?.alive && !openTask}
        />
        {showMap && state && (
          <MiniMap players={state.players} mySeat={mySeat} bodies={state.bodies} />
        )}
      </div>

      {state && (
        <CrewList players={state.players} mySeat={mySeat} isParasite={isParasite} />
      )}

      <footer className="panel actionbar">
        <button className="btn" onClick={() => setShowMap((v) => !v)}>
          Map
        </button>

        <button
          className="btn"
          disabled={!nearestTask || phase !== 'playing'}
          onClick={() => nearestTask && setOpenTask(nearestTask)}
        >
          Use{nearestTask ? ` · ${TASK_DEFS.find((t) => t.id === nearestTask)!.name}` : ''}
        </button>

        <button
          className="btn btn-danger"
          disabled={nearestBody === null || phase !== 'playing'}
          onClick={() => nearestBody !== null && sock.reportBody(nearestBody)}
        >
          Report
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
          onClick={doJump}
        >
          {jumping ? 'Jumping…' : 'Jump'}
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
            onClick={() => nearestPlayer && sock.purge(nearestPlayer.seat)}
          >
            Purge
          </button>
        )}

        <span className="hint">
          WASD / arrows to move
          {nearestPlayer && nearestPlayer.d <= JUMP_RANGE
            ? ` · ${state?.players.find((p) => p.seat === nearestPlayer.seat)?.name} is in range`
            : ''}
        </span>
      </footer>

      {/* Overlays */}
      {inLobby && (
        <Lobby
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
          meeting={state.meeting}
          players={state.players}
          mySeat={mySeat}
          onVote={(t) => sock.castVote(t)}
          roleMode={role.mode}
        />
      )}

      {sock.end && <EndOverlay end={sock.end} players={state?.players ?? []} />}

      <div className="toasts">
        {sock.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
