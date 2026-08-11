'use client';

import { useEffect, useRef, useState } from 'react';
import { TASK_DEFS, type TaskId } from '@parasite/shared';
import { useDialog } from '@/hooks/useDialog';

/**
 * Task minigames.
 *
 * Four interaction shapes across the five tasks — hold, click-sequence,
 * click-targets, and slider-align. The spec asks for variety and visible
 * progress rather than mechanical depth, so each is short and readable.
 *
 * Completion is reported upward; the SERVER re-checks proximity before
 * accepting it, so a player cannot complete a task by opening this modal and
 * walking away.
 */
export default function TaskModal(props: {
  taskId: TaskId;
  onComplete: () => void;
  onClose: () => void;
}) {
  const def = TASK_DEFS.find((t) => t.id === props.taskId)!;

  // This one IS dismissible — cancelling a task is a legal move — so Escape
  // closes it, matching the backdrop click that was already here.
  const dialogRef = useDialog({ onClose: props.onClose });

  return (
    <div className="overlay" onClick={props.onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-heading"
        tabIndex={-1}
        style={{ maxWidth: 470 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="task-heading">{def.name}</h2>
        {def.kind === 'hold' && (
          <HoldTask durationMs={'durationMs' in def ? def.durationMs : 4000} onDone={props.onComplete} />
        )}
        {def.kind === 'sequence' && (
          <SequenceTask steps={'steps' in def ? def.steps : 4} onDone={props.onComplete} />
        )}
        {def.kind === 'clicks' && (
          <ClickTask steps={'steps' in def ? def.steps : 5} onDone={props.onComplete} />
        )}
        {def.kind === 'slider' && (
          <SliderTask steps={'steps' in def ? def.steps : 3} onDone={props.onComplete} />
        )}
        <button className="btn" onClick={props.onClose} style={{ marginTop: 12 }}>
          Cancel <span className="muted">(Esc)</span>
        </button>
      </div>
    </div>
  );
}

/** Hold the button to fill the bar. Releasing early decays progress. */
function HoldTask({ durationMs, onDone }: { durationMs: number; onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const holding = useRef(false);
  const fired = useRef(false);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      setPct((p) => {
        const next = holding.current
          ? Math.min(100, p + (dt / durationMs) * 100)
          : Math.max(0, p - (dt / durationMs) * 55);
        if (next >= 100 && !fired.current) {
          fired.current = true;
          setTimeout(onDone, 180);
        }
        return next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, onDone]);

  return (
    <>
      <p>Hold to run the analysis. Let go and the sample destabilises.</p>
      <div
        className="mg-bar"
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="mg-fill" style={{ width: `${pct}%` }} />
      </div>
      {/*
        Keyboard parity: the pointer path is press-and-hold, so Space/Enter held
        down has to mean the same thing. Without the key handlers this task was
        impossible to complete without a mouse.
      */}
      <button
        className="btn btn-lg"
        style={{ width: '100%' }}
        onMouseDown={() => (holding.current = true)}
        onMouseUp={() => (holding.current = false)}
        onMouseLeave={() => (holding.current = false)}
        onTouchStart={() => (holding.current = true)}
        onTouchEnd={() => (holding.current = false)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            holding.current = true;
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') holding.current = false;
        }}
        onBlur={() => (holding.current = false)}
      >
        {pct >= 100 ? 'Complete' : 'Hold'}
      </button>
    </>
  );
}

/** Press the lit cell, in order. */
function SequenceTask({ steps, onDone }: { steps: number; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const cells = Array.from({ length: steps }, (_, i) => i);

  return (
    <>
      <p>Reseat the conduit couplings in sequence.</p>
      <div className="mg-grid">
        {cells.map((i) => (
          <button
            key={i}
            className={`mg-cell${i === at ? ' hot' : ''}${i < at ? ' done' : ''}`}
            disabled={i !== at}
            aria-label={`Coupling ${i + 1} of ${steps}${i < at ? ', seated' : ''}`}
            onClick={() => {
              const next = at + 1;
              setAt(next);
              if (next >= steps) setTimeout(onDone, 180);
            }}
          >
            {i < at ? '✔' : i + 1}
          </button>
        ))}
      </div>
      <div className="muted" role="status">
        {at}/{steps} couplings seated
      </div>
    </>
  );
}

/** Click the samples as they light up in random spots. */
function ClickTask({ steps, onDone }: { steps: number; onDone: () => void }) {
  const [got, setGot] = useState(0);
  const [pos, setPos] = useState({ x: 40, y: 40 });

  const move = () => {
    setPos({ x: 8 + Math.random() * 76, y: 8 + Math.random() * 62 });
  };

  return (
    <>
      <p>Collect the bioluminescent specimens before they retract.</p>
      <div
        style={{
          position: 'relative',
          height: 190,
          background: 'var(--inset)',
          border: '1px solid var(--edge)',
          borderRadius: 8,
          overflow: 'hidden',
          margin: '13px 0',
        }}
      >
        {/*
          48px, not the 40px it was: this is the smallest hit target in the game
          and the one under the most time pressure. It keeps focus between moves
          because only its position changes, never its identity in the DOM.
        */}
        <button
          className="mg-cell hot"
          aria-label={`Collect specimen (${got} of ${steps} collected)`}
          style={{
            position: 'absolute',
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            width: 48,
            height: 48,
            minHeight: 48,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
          }}
          onClick={() => {
            const next = got + 1;
            setGot(next);
            if (next >= steps) setTimeout(onDone, 160);
            else move();
          }}
        >
          <span aria-hidden="true">✦</span>
        </button>
      </div>
      <div className="muted" role="status">
        {got}/{steps} collected
      </div>
    </>
  );
}

/** Drag each slider into the target band. */
function SliderTask({ steps, onDone }: { steps: number; onDone: () => void }) {
  const [targets] = useState(() =>
    Array.from({ length: steps }, () => 25 + Math.floor(Math.random() * 50))
  );
  const [vals, setVals] = useState(() => Array.from({ length: steps }, () => 0));
  const aligned = vals.map((v, i) => Math.abs(v - targets[i]!) <= 4);
  const allDone = aligned.every(Boolean);
  const fired = useRef(false);

  useEffect(() => {
    if (allDone && !fired.current) {
      fired.current = true;
      setTimeout(onDone, 240);
    }
  }, [allDone, onDone]);

  return (
    <>
      <p>Align each sensor to its resonance band.</p>
      {targets.map((t, i) => (
        <div key={i} style={{ marginBottom: 11 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted" id={`sensor-label-${i}`}>
              Sensor {i + 1}
            </span>
            {/* aria-live: "LOCKED" is the only feedback that the slider hit its
                band, and a screen-reader user cannot see the pill change. */}
            <span className={aligned[i] ? 'pill ok' : 'pill'} role="status">
              {aligned[i] ? 'LOCKED' : `target ${t}`}
            </span>
          </div>
          <input
            className="mg-slider"
            type="range"
            min={0}
            max={100}
            value={vals[i]}
            aria-labelledby={`sensor-label-${i}`}
            aria-valuetext={
              aligned[i] ? `${vals[i]}, locked on target` : `${vals[i]}, target ${t}`
            }
            onChange={(e) => {
              const next = [...vals];
              next[i] = Number(e.target.value);
              setVals(next);
            }}
          />
        </div>
      ))}
    </>
  );
}
