// Dance mode: a 30-second clip of a song plays while the stage's dots become a dancer.
// This keeps the song's clock (so her moves land on the beat) and how loud the bass is right now.
// Song: LLow - i can hear you [NCS Release]. Music provided by NoCopyrightSounds (credit shown on screen).

const SRC = '/audio/llow-i-can-hear-you.mp3';
/** Length of the clip in seconds (cut from 0:30 to 1:00 of the song). */
export const DANCE_LENGTH = 30;
/** Fade in and out, in seconds. */
const FADE_IN = 0.6, FADE_OUT = 1.2;

type Listener = (on: boolean) => void;

let on = false;
let el: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let startedAt = 0;
let stopTimer = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn(on);
}

function setup() {
  if (el) return;
  el = new Audio(SRC);
  el.preload = 'auto';
  el.addEventListener('ended', () => dance.stop());
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    const src = ctx.createMediaElementSource(el);
    gain = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    bins = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(gain).connect(ctx.destination);
  } catch {
    // Without Web Audio the song still plays; the bass reading just stays at 0.
    ctx = null;
  }
}

export const dance = {
  get on() {
    return on;
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** Gets the song and its audio graph ready ahead of time (on hover), so the click itself has less to do. */
  prepare() {
    setup();
  },
  start() {
    if (on) return;
    setup();
    window.clearTimeout(stopTimer);
    on = true;
    startedAt = performance.now();
    if (el) {
      el.currentTime = 0;
      if (ctx && gain) {
        void ctx.resume();
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + FADE_IN);
      }
      void el.play().catch(() => {});
    }
    emit();
  },
  stop() {
    if (!on) return;
    on = false;
    const a = el;
    if (a && ctx && gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + FADE_OUT);
      stopTimer = window.setTimeout(() => a.pause(), FADE_OUT * 1000);
    } else a?.pause();
    emit();
  },
  /** Seconds into the clip. Follows the audio when it's playing, so the moves stay in sync. */
  time() {
    if (el && !el.paused && el.currentTime > 0) return el.currentTime;
    return (performance.now() - startedAt) / 1000;
  },
  /** Jumps to a moment in the clip (used when testing the routine). */
  seek(seconds: number) {
    if (el) el.currentTime = seconds;
    startedAt = performance.now() - seconds * 1000;
  },
  /** How loud the low end is right now, 0 to 1. */
  bass() {
    if (!analyser || !bins || !on) return 0;
    analyser.getByteFrequencyData(bins);
    // Roughly 40-200 Hz: the kick and the bass line.
    let sum = 0;
    for (let i = 1; i <= 5; i++) sum += bins[i];
    // Quiet parts sit around 0.3 and loud kicks reach about 0.9, so stretch that range to 0-1.
    return Math.min(1, Math.max(0, (sum / (5 * 255) - 0.3) / 0.6));
  },
};
