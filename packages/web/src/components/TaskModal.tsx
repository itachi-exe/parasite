'use client';

import { useEffect, useRef, useState } from 'react';
import { TASK_DEFS, type TaskId } from '@parasite/shared';

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

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="modal" style={{ maxWidth: 470 }} onClick={(e) => e.stopPropagation()}>
        <h2>{def.name}</h2>
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
          Cancel
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
      <div className="mg-bar">
        <div className="mg-fill" style={{ width: `${pct}%` }} />
      </div>
      <button
        className="btn btn-lg"
        style={{ width: '100%' }}
        onMouseDown={() => (holding.current = true)}
        onMouseUp={() => (holding.current = false)}
        onMouseLeave={() => (holding.current = false)}
        onTouchStart={() => (holding.current = true)}
        onTouchEnd={() => (holding.current = false)}
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
      <div className="muted">
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
          background: '#06231a',
          border: '1px solid var(--edge)',
          borderRadius: 8,
          overflow: 'hidden',
          margin: '13px 0',
        }}
      >
        <button
          className="mg-cell hot"
          style={{
            position: 'absolute',
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            width: 40,
            height: 40,
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
          ✦
        </button>
      </div>
      <div className="muted">
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
            <span className="muted">Sensor {i + 1}</span>
            <span className={aligned[i] ? 'pill ok' : 'pill'}>
              {aligned[i] ? 'LOCKED' : `target ${t}`}
            </span>
          </div>
          <input
            className="mg-slider"
            type="range"
            min={0}
            max={100}
            value={vals[i]}
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
