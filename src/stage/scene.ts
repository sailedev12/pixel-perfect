// A scene fills arrays of particles (screen position, size, alpha, color class) every frame.
// The stage draws whichever scene is active, and when the scene changes it flies each
// particle from where it is in the old scene to its spot in the new one.

import type { Aura } from './renderer';

export type RGB = [number, number, number];

export interface Env {
  now: number;
  dt: number;
  /** Canvas size in CSS pixels. */
  W: number;
  H: number;
  canvasRect: DOMRect;
  pointer: [number, number];
  still: boolean;
}

export abstract class Scene {
  abstract readonly count: number;
  x = new Float32Array(0);
  y = new Float32Array(0);
  s = new Float32Array(0);
  a = new Float32Array(0);
  c = new Uint8Array(0);
  /** Color per class. */
  rgb: RGB[] = [];
  /** Optional color per particle (r, g, b, 0-255), used instead of `rgb` when set. */
  rgbPer: Float32Array | null = null;
  /** Glow size multiplier per class; 0 = no glow. */
  glow: number[] = [];
  /** How much the previous frame is cleared: 1 = fully, lower leaves motion trails. */
  trail = 0.4;
  /** False for frozen snapshots, which never update. */
  live = true;
  /** How strongly dots swirl away from the cursor (0 = not at all). */
  cursorForce = 1;
  /** Soft colored backlight behind the scene's main piece, updated each frame. */
  aura: Aura | null = null;
  /** A flattened neon glow pooling underneath the main piece. */
  underglow: Aura | null = null;
  cursor = 'default';

  protected alloc(n: number) {
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.s = new Float32Array(n);
    this.a = new Float32Array(n);
    this.c = new Uint8Array(n);
  }

  activate(_now: number) {}
  deactivate() {}
  abstract update(env: Env): void;
  pointer(_type: 'move' | 'leave' | 'click', _p: [number, number]) {}
}

/** A frozen set of particles: the starting point when a morph is interrupted, or the first load. */
export class StaticScene extends Scene {
  readonly count: number;
  constructor(n: number, rgb: RGB[] = [[255, 255, 255]]) {
    super();
    this.count = n;
    this.alloc(n);
    this.rgb = rgb;
    this.glow = rgb.map(() => 0);
    this.live = false;
  }
  update() {}
}

/**
 * Points inside some text, as (x, y) pairs centred on 0 and scaled so the text is `width` wide.
 * Used to build particle lettering.
 */
export function textPoints(str: string, width: number, font = '800 120px Inter, Arial, sans-serif') {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 220;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.font = font;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str, 450, 115);
  const tw = Math.min(880, g.measureText(str).width) || 1;
  const d = g.getImageData(0, 0, 900, 220).data;
  const pts: number[] = [];
  const k = width / tw;
  for (let y = 0; y < 220; y += 2) for (let x = 0; x < 900; x += 2) if (d[(y * 900 + x) * 4 + 3] > 120) pts.push((x - 450) * k, (y - 115) * k);
  return pts;
}

/** Faint dust that drifts upward across the whole canvas; fills particles [start, start + n). */
export class Dust {
  private u: Float32Array;
  private v: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private tw: Float32Array;
  constructor(private start: number, readonly n: number, private classFor: (i: number) => number) {
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.tw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.u[i] = Math.random();
      this.v[i] = Math.random();
      this.vx[i] = (Math.random() - 0.5) * 0.00001;
      this.vy[i] = -Math.random() * 0.000012 - 0.000002;
      this.tw[i] = Math.random() * 6.28;
    }
  }
  update(S: Scene, { now, dt, W, H, still }: Env, alpha = 1) {
    const step = still ? 0 : dt;
    for (let i = 0; i < this.n; i++) {
      const j = this.start + i;
      this.u[i] = (this.u[i] + this.vx[i] * step + 1) % 1;
      this.v[i] = (this.v[i] + this.vy[i] * step + 1) % 1;
      S.x[j] = this.u[i] * W;
      S.y[j] = this.v[i] * H;
      S.s[j] = 1.3;
      S.a[j] = (0.12 + 0.1 * Math.sin(now * 0.001 + this.tw[i])) * alpha;
      S.c[j] = this.classFor(i);
    }
  }
}

export const hexToRgb =(h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
