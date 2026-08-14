'use client';

/**
 * Tiny procedural sound-effect layer. No external audio assets — everything
 * is synthesized on the fly with the Web Audio API, matching the rest of
 * this project's no-external-assets approach.
 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers start contexts suspended until a user gesture; the reveal is
  // always triggered from game state that only changes after the player has
  // already interacted with the page (joining, moving, pressing a button),
  // so resume() here is safe rather than blocked.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * The "you are the Parasite" sting: two closely-detuned sawtooth oscillators
 * beating against each other (the classic queasy/dissonant effect) over a
 * descending sub-bass drop. About 2.4s, synthesized, no asset file.
 */
export function playParasiteReveal(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;

  const master = ac.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.32, now + 0.06);
  master.gain.linearRampToValueAtTime(0.22, now + 1.2);
  master.gain.linearRampToValueAtTime(0, now + 2.4);
  master.connect(ac.destination);

  // Two close, detuned oscillators beating against each other.
  for (const f of [110, 116.5]) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, now + 2.0);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.5, now);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 2.4);
  }

  // Sub-bass drop underneath for weight.
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(28, now + 1.6);
  const subGain = ac.createGain();
  subGain.gain.setValueAtTime(0.55, now);
  subGain.gain.linearRampToValueAtTime(0, now + 1.8);
  sub.connect(subGain);
  subGain.connect(master);
  sub.start(now);
  sub.stop(now + 1.8);
}
