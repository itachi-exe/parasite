'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  RoomState,
  PositionsPayload,
  Seat,
  SkinId,
  TaskId,
  MeetingResult,
  MeetingReason,
  EndState,
  ChatMessage,
} from '@parasite/shared';
import { SERVER_URL } from '@/lib/contract';
import { replacePositions, replaceSnapshot } from '../game/bridge';

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'error';
  text: string;
}

export interface UseGameSocket {
  connected: boolean;
  state: RoomState | null;
  mySeat: Seat | null;
  toasts: Toast[];
  lastMeetingResult: MeetingResult | null;
  end: EndState | null;
  /** SIMULATED MODE ONLY: role handed to this socket by the server. */
  simulatedRole: boolean | null;
  /**
   * Why the last meeting started, plus a nonce so two body reports in a row
   * are two distinct events rather than one unchanged object.
   */
  lastAlert: { reason: MeetingReason; nonce: number } | null;
  /** Room chat, oldest first, capped so a long game cannot grow without bound. */
  chat: ChatMessage[];
  sendChat: (text: string) => void;
  /** Exposed for useVoice, which needs to speak the signalling protocol. */
  socket: Socket | null;
  /** Live positions, updated at the server tick rate between full snapshots. */
  positions: Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>;
  join: (opts: { code: string; name: string; skin: SkinId; address: string | null }) => Promise<void>;
  startGame: () => Promise<void>;
  sendInput: (ax: number, ay: number, fx?: number, fy?: number) => void;
  completeTask: (taskId: TaskId) => Promise<void>;
  callMeeting: () => Promise<void>;
  reportBody: (victimSeat: Seat) => Promise<void>;
  castVote: (target: Seat | 'skip') => Promise<void>;
  purge: (targetSeat: Seat) => Promise<void>;
  jumpAnnounce: (targetSeat: Seat) => Promise<{ ok: boolean; error?: string }>;
  submitEjectionReveal: (wasParasite: boolean) => void;
  reportChainGameId: (chainGameId: string) => Promise<{ ok: boolean; error?: string }>;
  pushToast: (kind: Toast['kind'], text: string) => void;
}

/**
 * Owns the Socket.io connection and mirrors the server's authoritative state.
 *
 * Positions stay in a ref-backed Map that ThreeScene reads every frame.
 * Body sight updates also refresh React's proximity controls.
 */
export function useGameSocket(): UseGameSocket {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastMeetingResult, setLastMeetingResult] = useState<MeetingResult | null>(null);
  const [end, setEnd] = useState<EndState | null>(null);
  const [simulatedRole, setSimulatedRole] = useState<boolean | null>(null);
  const [lastAlert, setLastAlert] = useState<{ reason: MeetingReason; nonce: number } | null>(
    null
  );
  const alertNonce = useRef(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const positions = useRef(
    new Map<Seat, { x: number; y: number; dir: -1 | 1; moving: boolean }>()
  );
  const toastId = useRef(0);

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 8,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => {
      positions.current.clear();
      setState(null);
      setConnected(false);
    });
    socket.on('connect_error', () => setConnected(false));

    socket.on('you', (p: { id: string; seat: Seat }) => setMySeat(p.seat));

    socket.on('state', (s: RoomState) => {
      setState(s);
      replaceSnapshot(positions.current, s);
      if (s.end) setEnd(s.end);
      if (s.phase === 'lobby') {
        setEnd(null);
        setLastMeetingResult(null);
        setSimulatedRole(null);
        setChat([]);
      }
    });

    socket.on(
      'positions',
      (payload: PositionsPayload) => {
        replacePositions(positions.current, payload);
        // Bodies and proximity controls must refresh on movement/turns, not only game events.
        setState((s) => s ? { ...s, bodies: payload.b } : s);
      }
    );

    socket.on('simulatedRole', (p: { isParasite: boolean }) => setSimulatedRole(p.isParasite));

    // The banner listens to this. `meetingStarted` already carries who reported
    // what, so the loud moment needs no new wire traffic.
    socket.on('meetingStarted', (p: { reason: MeetingReason; endsAt: number }) => {
      setLastAlert({ reason: p.reason, nonce: ++alertNonce.current });
    });
    socket.on('chat', (m: ChatMessage) => setChat((c) => [...c.slice(-79), m]));
    socket.on('meetingResult', (r: MeetingResult) => setLastMeetingResult(r));
    socket.on('gameEnded', (e: EndState) => setEnd(e));
    socket.on('toast', (t: { kind: Toast['kind']; text: string }) => pushToast(t.kind, t.text));
    socket.on('playerPurged', () => pushToast('warn', 'Someone was purged.'));
    socket.on('kicked', (p: { reason: string }) => pushToast('error', p.reason));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pushToast]);

  /** Promise wrapper around an acked emit. */
  const emitAck = useCallback(
    <T,>(event: string, payload?: unknown): Promise<T> =>
      new Promise((resolve) => {
        const s = socketRef.current;
        if (!s) return resolve({ ok: false, error: 'Not connected.' } as T);
        if (payload === undefined) s.emit(event as never, resolve as never);
        else s.emit(event as never, payload as never, resolve as never);
      }),
    []
  );

  const join = useCallback(
    async (opts: { code: string; name: string; skin: SkinId; address: string | null }) => {
      const res = await emitAck<{ ok: boolean; error?: string; state?: RoomState; you?: { seat: Seat } }>(
        'join',
        opts
      );
      if (!res.ok) {
        pushToast('error', res.error ?? 'Could not join.');
        throw new Error(res.error ?? 'join failed');
      }
      if (res.you) setMySeat(res.you.seat);
      if (res.state) {
        replaceSnapshot(positions.current, res.state);
        setState(res.state);
      }
    },
    [emitAck, pushToast]
  );

  const simpleAction = useCallback(
    async (event: string, payload?: unknown, successMsg?: string) => {
      const res = await emitAck<{ ok: boolean; error?: string }>(event, payload);
      if (!res.ok) pushToast('warn', res.error ?? 'That did not work.');
      else if (successMsg) pushToast('info', successMsg);
    },
    [emitAck, pushToast]
  );

  return {
    connected,
    state,
    mySeat,
    toasts,
    lastMeetingResult,
    end,
    simulatedRole,
    lastAlert,
    chat,
    socket: socketRef.current,
    sendChat: (text: string) => {
      const t = text.trim();
      if (t) socketRef.current?.emit('sendChat', { text: t } as never);
    },
    positions: positions.current,
    join,
    startGame: () => simpleAction('startGame'),
    sendInput: (ax, ay, fx, fy) => socketRef.current?.emit('input', { ax, ay, fx, fy, seq: Date.now() } as never),
    completeTask: (taskId) => simpleAction('completeTask', { taskId }),
    callMeeting: () => simpleAction('callMeeting'),
    reportBody: (victimSeat) => simpleAction('reportBody', { victimSeat }),
    castVote: (target) => simpleAction('castVote', { target }),
    purge: (targetSeat) => simpleAction('purge', { targetSeat }),
    jumpAnnounce: (targetSeat) =>
      emitAck<{ ok: boolean; error?: string }>('jumpAnnounce', { targetSeat }),
    submitEjectionReveal: (wasParasite) =>
      socketRef.current?.emit('submitEjectionReveal', { wasParasite } as never),
    reportChainGameId: (chainGameId) =>
      emitAck<{ ok: boolean; error?: string }>('reportChainGameId', { chainGameId }),
    pushToast,
  };
}
