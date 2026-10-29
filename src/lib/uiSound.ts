// Soft interface sounds (tab whoosh, board blips, menu ticks), synthesized so there are no
// audio files. Shares the mute setting with the game player.
import { getMuted, setMuted } from './scores';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = getMuted();
// Browsers only allow sound after the person has clicked or pressed a key.
let unlocked = false;
const listeners = new Set<(m: boolean) => void>();

if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function audio() {
  if (muted || !unlocked) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Filtered noise sweeping between two pitches: an airy whoosh. */
function sweep(from: number, to: number, dur: number, vol: number) {
  const c = audio();
  if (!c || !noise) return;
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const uiSound = {
  /** Switching tabs. */
  whoosh() {
    sweep(380, 2200, 0.55, 0.05);
  },
  /** The scoreboard lighting up. */
  blips(delay = 0) {
    tone(660, delay + 0.05, 0.12, 0.025);
    tone(880, delay + 0.12, 0.12, 0.025);
    tone(1320, delay + 0.19, 0.18, 0.02);
  },
  /** Moving between menu rows. */
  tick() {
    tone(1900, 0, 0.03, 0.012, 'square');
  },
  zoomIn() {
    sweep(260, 1800, 0.45, 0.05);
    tone(110, 0, 0.25, 0.05, 'triangle');
  },
  zoomOut() {
    sweep(1800, 260, 0.45, 0.045);
  },
  get muted() {
    return muted;
  },
  setMuted(m: boolean) {
    muted = m;
    setMuted(m);
    listeners.forEach((fn) => fn(m));
  },
  subscribe(fn: (m: boolean) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
