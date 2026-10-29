// Live tab: a broadcast beacon made of dots. A pulsing red core sends out signal arcs and
// ripples, with "ON AIR" underneath, sitting in the top-right corner behind the page.
import { Dust, Scene, hexToRgb, textPoints, type Env } from '../scene';

const CORE = 600, ARC = 2400, RINGS = 3, RING = 500, TEXT = 1200, DUST = 2000;
const C_RED = 0, C_HOT = 1, C_WHITE = 2, C_DIM = 3;

export class LiveScene extends Scene {
  readonly count = CORE + ARC + RINGS * RING + TEXT + DUST;
  private seed = new Float32Array(this.count);
  private arcPos = new Float32Array(ARC * 2); // angle, ring index
  private text: number[] = [];
  private dust: Dust;

  constructor() {
    super();
    this.alloc(this.count);
    this.rgb = ['#ff3b2e', '#ff8a6b', '#f2f2f2', '#5a5a5a'].map(hexToRgb);
    this.glow = [0, 0, 0, 0];
    this.trail = 0.45;
    for (let i = 0; i < this.count; i++) this.seed[i] = Math.random();
    for (let i = 0; i < ARC; i++) {
      const side = i % 2 ? 0 : Math.PI;
      this.arcPos[i * 2] = side + (Math.random() - 0.5) * (Math.PI / 2.2);
      this.arcPos[i * 2 + 1] = i % 3;
    }
    this.text = textPoints('ON AIR', 1);
    this.dust = new Dust(this.count - DUST, DUST, (i) => (i % 9 === 0 ? C_RED : C_DIM));
    const fonts = document.fonts;
    if (fonts?.ready) void fonts.ready.then(() => { this.text = textPoints('ON AIR', 1); });
  }

  update(env: Env) {
    const { now, W, H, still } = env;
    const t = still ? 0 : now / 1000;
    const narrow = W < 760;
    const cx = W * (narrow ? 0.78 : 0.8);
    const cy = H * (narrow ? 0.14 : 0.24);
    const r0 = Math.min(W, H) * (narrow ? 0.09 : 0.11);
    const X = this.x, Y = this.y, S = this.s, A = this.a, C = this.c, sd = this.seed;
    let j = 0;

    // Core: a filled dot that beats like a recording light.
    const beat = 1 + 0.12 * Math.max(0, Math.sin(t * 3.2)) ** 6;
    for (let i = 0; i < CORE; i++, j++) {
      const a = sd[j] * 6.2832, r = Math.sqrt(sd[(j * 7) % this.count]) * r0 * 0.2 * beat;
      X[j] = cx + Math.cos(a + t * 0.6) * r;
      Y[j] = cy + Math.sin(a + t * 0.6) * r;
      S[j] = 1.7;
      A[j] = 0.9;
      C[j] = r < r0 * 0.1 ? C_HOT : C_RED;
    }

    // Signal arcs on both sides, lighting up outward in turn.
    for (let i = 0; i < ARC; i++, j++) {
      const ang = this.arcPos[i * 2], k = this.arcPos[i * 2 + 1];
      const r = r0 * (0.42 + k * 0.3) + (sd[j] - 0.5) * r0 * 0.04;
      const pulse = Math.max(0, Math.sin(t * 2.4 - k * 0.9));
      X[j] = cx + Math.cos(ang) * r;
      Y[j] = cy + Math.sin(ang) * r;
      S[j] = 1.4;
      A[j] = 0.18 + 0.75 * pulse * pulse;
      C[j] = pulse > 0.6 ? C_HOT : C_RED;
    }

    // Ripples spreading out and fading.
    for (let ring = 0; ring < RINGS; ring++) {
      const p = (t * 0.42 + ring / RINGS) % 1;
      const r = r0 * (0.25 + p * 1.6);
      for (let i = 0; i < RING; i++, j++) {
        const a = (i / RING) * 6.2832 + sd[j] * 0.02;
        X[j] = cx + Math.cos(a) * r;
        Y[j] = cy + Math.sin(a) * r;
        S[j] = 1.2;
        A[j] = (1 - p) * 0.35;
        C[j] = C_RED;
      }
    }

    // "ON AIR" underneath, with a slight shimmer.
    const pts = this.text, n = pts.length / 2 || 1, tw = r0 * 1.7;
    for (let i = 0; i < TEXT; i++, j++) {
      const q = ((sd[j] * n) | 0) * 2;
      X[j] = cx + (pts[q] ?? 0) * tw + Math.sin(t * 3 + i) * 0.4;
      Y[j] = cy + r0 * 1.55 + (pts[q + 1] ?? 0) * tw;
      S[j] = 1.4;
      A[j] = 0.75 + 0.25 * Math.sin(t * 4 + sd[j] * 6);
      C[j] = C_WHITE;
    }

    this.dust.update(this, env);
    // Red backlight that beats with the core.
    this.aura = { x: cx, y: cy, r: r0 * 2.6, rgb: [255, 59, 46], a: 0.08 + 0.6 * (beat - 1) };
  }
}
