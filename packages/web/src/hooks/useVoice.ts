'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

/**
 * Push-to-talk voice, meshed between peers on the same channel.
 *
 * Deliberately built so that failure is invisible. Voice is opt-in, and if a
 * peer connection never establishes — a NAT that needs a TURN relay we do not
 * run, a denied microphone, a browser without WebRTC — the game carries on
 * exactly as it did before with text chat intact. Nothing turns red. A judge
 * who cannot get audio should see a game with no voice, not a broken game.
 *
 * The living and the dead are separate channels, and that is enforced by the
 * server refusing to relay signalling across them (see GameServer.voiceSignal):
 * a living player's browser is never offered a connection to a dead one, so
 * there is no stream to leak. Muting the dead client-side would have meant the
 * audio was already there.
 *
 * Mesh, not an SFU. At the 4-6 players this is scoped to that is a handful of
 * connections each; it would not hold at ten, and an SFU is not a thing to
 * stand up the day before a deadline.
 */

const ICE: RTCConfiguration = {
  // Public STUN only. TURN would need a relay server we do not have, which is
  // exactly why a failed connection has to be survivable rather than fatal.
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

export interface VoiceState {
  /** The player asked for voice and the mic was granted. */
  enabled: boolean;
  /** Mic is live this instant (push-to-talk held). */
  transmitting: boolean;
  /** Peers we have an open audio connection to. */
  connected: number;
  /** Set only when the player did something we could not honour. */
  error: string | null;
  busy: boolean;
}

export function useVoice(socket: Socket | null, alive: boolean) {
  const [state, setState] = useState<VoiceState>({
    enabled: false,
    transmitting: false,
    connected: 0,
    error: null,
    busy: false,
  });

  const stream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const audio = useRef(new Map<string, HTMLAudioElement>());
  const enabled = useRef(false);

  const recount = useCallback(() => {
    let n = 0;
    for (const pc of peers.current.values()) {
      if (pc.connectionState === 'connected') n++;
    }
    setState((s) => ({ ...s, connected: n }));
  }, []);

  /** Build (or fetch) the connection to one peer. */
  const peerFor = useCallback(
    (id: string): RTCPeerConnection => {
      const existing = peers.current.get(id);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE);
      peers.current.set(id, pc);

      for (const track of stream.current?.getTracks() ?? []) {
        pc.addTrack(track, stream.current!);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) socket?.emit('voiceSignal', { to: id, data: { ice: e.candidate } } as never);
      };

      pc.ontrack = (e) => {
        let el = audio.current.get(id);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          audio.current.set(id, el);
        }
        el.srcObject = e.streams[0] ?? null;
        // Autoplay can be refused before any user gesture; the opt-in click is
        // that gesture, so this normally succeeds. If it does not, stay quiet.
        void el.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        recount();
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          pc.close();
          peers.current.delete(id);
          audio.current.get(id)?.pause();
          audio.current.delete(id);
          recount();
        }
      };

      return pc;
    },
    [socket, recount]
  );

  const teardown = useCallback(() => {
    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    for (const el of audio.current.values()) el.pause();
    audio.current.clear();
    for (const t of stream.current?.getTracks() ?? []) t.stop();
    stream.current = null;
    enabled.current = false;
    setState({ enabled: false, transmitting: false, connected: 0, error: null, busy: false });
  }, []);

  const enable = useCallback(async () => {
    if (!socket || enabled.current) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      stream.current = ms;
      // Start muted: push-to-talk, not hot mic. Nobody should be broadcasting
      // their room the instant they opt in.
      for (const t of ms.getAudioTracks()) t.enabled = false;
      enabled.current = true;
      setState((s) => ({ ...s, enabled: true, busy: false }));
      socket.emit('voiceJoin' as never);
    } catch {
      // Denied, no device, or no getUserMedia at all. Say so once, quietly.
      setState((s) => ({
        ...s,
        busy: false,
        enabled: false,
        error: 'Microphone unavailable',
      }));
    }
  }, [socket]);

  const disable = useCallback(() => {
    socket?.emit('voiceLeave' as never);
    teardown();
  }, [socket, teardown]);

  /** Push-to-talk. */
  const setTransmitting = useCallback((on: boolean) => {
    for (const t of stream.current?.getAudioTracks() ?? []) t.enabled = on;
    setState((s) => (s.transmitting === on ? s : { ...s, transmitting: on }));
  }, []);

  // ── Signalling ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onPeers = async (p: { peers: { id: string }[] }) => {
      // Existing members call the newcomer, so both sides never offer at once.
      for (const { id } of p.peers) {
        const pc = peerFor(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voiceSignal', { to: id, data: { sdp: offer } } as never);
      }
    };

    const onJoined = (p: { id: string }) => {
      // Wait for their offer rather than racing them with ours.
      peerFor(p.id);
    };

    const onLeft = (p: { id: string }) => {
      peers.current.get(p.id)?.close();
      peers.current.delete(p.id);
      audio.current.get(p.id)?.pause();
      audio.current.delete(p.id);
      recount();
    };

    const onSignal = async (p: { from: string; data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } }) => {
      const pc = peerFor(p.from);
      try {
        if (p.data?.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(p.data.sdp));
          if (p.data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voiceSignal', { to: p.from, data: { sdp: answer } } as never);
          }
        } else if (p.data?.ice) {
          await pc.addIceCandidate(new RTCIceCandidate(p.data.ice));
        }
      } catch {
        // A malformed or out-of-order signal kills one peer, never the feature.
      }
    };

    socket.on('voicePeers', onPeers as never);
    socket.on('voicePeerJoined', onJoined as never);
    socket.on('voicePeerLeft', onLeft as never);
    socket.on('voiceSignal', onSignal as never);
    return () => {
      socket.off('voicePeers', onPeers as never);
      socket.off('voicePeerJoined', onJoined as never);
      socket.off('voicePeerLeft', onLeft as never);
      socket.off('voiceSignal', onSignal as never);
    };
  }, [socket, peerFor, recount]);

  /*
   * Dying moves you to the other channel.
   *
   * Every existing connection is torn down and renegotiated, because the peers
   * on the living channel must stop receiving this microphone the moment it
   * belongs to a ghost — and the server will not relay across channels, so the
   * rejoin naturally lands in the right place.
   */
  useEffect(() => {
    if (!enabled.current || !socket) return;
    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    for (const el of audio.current.values()) el.pause();
    audio.current.clear();
    recount();
    socket.emit('voiceLeave' as never);
    socket.emit('voiceJoin' as never);
  }, [alive, socket, recount]);

  useEffect(() => teardown, [teardown]);

  return { voice: state, enableVoice: enable, disableVoice: disable, setTransmitting };
}
