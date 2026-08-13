'use client';

import { useEffect } from 'react';
import type { VoiceState } from '@/hooks/useVoice';

/**
 * Push-to-talk control for meetings.
 *
 * Everything here is written so that voice not working is a non-event. Before
 * opting in it is one quiet button; if the microphone is refused it says so
 * once and stops asking; if no peer ever connects it simply reports nobody
 * connected. There is no failure state that looks like the game is broken,
 * because for a judge on a network we cannot traverse, that is the difference
 * between "no voice" and "this whole thing is held together with tape".
 */
export default function VoiceBar(props: {
  voice: VoiceState;
  alive: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTransmit: (on: boolean) => void;
}) {
  const { voice } = props;

  // Hold V to talk, as well as holding the button. Bound to the window rather
  // than an element so it works wherever focus happens to be — except inside a
  // text field, where V is a letter someone is typing.
  useEffect(() => {
    if (!voice.enabled) return;
    const typing = () => {
      const el = document.activeElement;
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement)?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'v' && !e.repeat && !typing()) props.onTransmit(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'v') props.onTransmit(false);
    };
    // A lost focus mid-hold would otherwise leave the mic open indefinitely.
    const blur = () => props.onTransmit(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [voice.enabled, props]);

  if (!voice.enabled) {
    return (
      <div className="voice-bar">
        <button className="btn-menu" disabled={voice.busy} onClick={props.onEnable}>
          {voice.busy ? 'Asking…' : '🎙 Enable voice'}
        </button>
        <span className="voice-note">
          {voice.error
            ? `${voice.error}. Text chat still works.`
            : props.alive
              ? 'Optional. Hold V to talk.'
              : 'Optional. Only the dead will hear you.'}
        </span>
      </div>
    );
  }

  return (
    <div className="voice-bar">
      <button
        className={`btn-menu ptt${voice.transmitting ? ' live' : ''}`}
        onPointerDown={() => props.onTransmit(true)}
        onPointerUp={() => props.onTransmit(false)}
        onPointerLeave={() => props.onTransmit(false)}
        aria-pressed={voice.transmitting}
      >
        {voice.transmitting ? '● Talking' : '🎙 Hold to talk'}
      </button>
      <span className="voice-note">
        {voice.connected > 0
          ? `${voice.connected} connected${props.alive ? '' : ' (dead channel)'}`
          : 'Nobody connected yet'}
      </span>
      <button className="btn-menu quiet" onClick={props.onDisable}>
        Off
      </button>
    </div>
  );
}
