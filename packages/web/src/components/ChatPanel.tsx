'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Seat } from '@parasite/shared';

/**
 * Room chat.
 *
 * Used in two places with the same component: the lobby, where it is idle
 * banter, and the meeting, where it is the actual game. Deduction happens in
 * the argument, so a social-deduction game without a place to argue is missing
 * its main mechanic.
 *
 * Ghost lines are only ever *delivered* to dead players — the server fans them
 * out per-socket rather than to the room (see GameServer.sendChat), so a living
 * player's client never receives one. This component's ghost styling is for
 * the dead reading their own channel, not a filter standing between the living
 * and information they were sent anyway.
 */
export default function ChatPanel(props: {
  messages: ChatMessage[];
  mySeat: Seat | null;
  /** False for the dead during a meeting, and for anyone the server would refuse. */
  canSend: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  // Follow new messages, but only if the reader has not scrolled up to re-read
  // something — yanking the view away mid-sentence during a meeting is worse
  // than missing the newest line.
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [props.messages]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    props.onSend(t);
    setDraft('');
  };

  return (
    <div className="chat">
      <div
        className="chat-log"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Room chat"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {props.messages.length === 0 && (
          <p className="chat-empty">No one has said anything yet.</p>
        )}
        {props.messages.map((m, i) => (
          <p
            key={`${m.at}-${m.seat}-${i}`}
            className={`chat-line${m.ghost ? ' ghost' : ''}${m.seat === props.mySeat ? ' mine' : ''}`}
          >
            <span className="chat-who">
              {m.name}
              {m.ghost ? ' (dead)' : ''}
            </span>{' '}
            <span className="chat-text">{m.text}</span>
          </p>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={draft}
          maxLength={140}
          disabled={!props.canSend}
          placeholder={props.canSend ? (props.placeholder ?? 'Say something') : 'You cannot speak'}
          aria-label="Chat message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Stop the game seeing anything typed here. Phaser is mounted
            // during a meeting and treats W/A/S/D as movement, so without this
            // the character would walk while the player argued.
            e.stopPropagation();
            if (e.key === 'Enter') submit();
          }}
        />
        <button className="btn-menu" disabled={!props.canSend || !draft.trim()} onClick={submit}>
          Send
        </button>
      </div>
    </div>
  );
}
