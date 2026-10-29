/** Tiny synth for sound effects, so the games need no audio files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private destroyed = false;

  constructor(private muted: boolean) {}

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  /** Plays one tone. `slideTo` bends the pitch; `delayMs` schedules it later without timers. */
  tone(freq: number, durMs: number, type: OscillatorType = 'square', volume = 0.06, slideTo?: number, delayMs = 0) {
    if (this.muted || this.destroyed) return;
    const c = this.context();
    if (!c) return;
    const t0 = c.currentTime + delayMs / 1000;
    const t1 = t0 + durMs / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t1);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }

  destroy() {
    this.destroyed = true;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }

  private context() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
}
