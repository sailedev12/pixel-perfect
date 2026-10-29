// You tab: a player badge made of dots. A tilted ring spins around "P1" with a second
// ring turning the other way and sparks orbiting, in the top-right corner behind the page.
import { Dust, Scene, hexToRgb, textPoints, type Env } from '../scene';

const RING = 1800, INNER = 900, TEXT = 1500, SPARKS = 300, DUST = 2000;
const COLORS = ['#ff4d2e', '#ffb020', '#3ddc97', '#3fa7ff', '#b57bff', '#ff5fa2', '#f2f2f2', '#ffd166', '#5a5a5a'];
const C_WHITE = 6, C_GOLD = 7, C_DIM = 8;
const DEPTH = 3.2;

export class YouScene extends Scene {
  readonly count = RING + INNER + TEXT + SPARKS + DUST;
  private seed = new Float32Array(this.count);
  private text: number[] = [];
  private dust: Dust;

  constructor() {
    super();
    this.alloc(this.count);
    this.rgb = COLORS.map(hexToRgb);
    this.glow = COLORS.map(() => 0);
    this.trail = 0.4;
    for (let i = 0; i < this.count; i++) this.seed[i] = Math.random();
    this.text = textPoints('P1', 1);
    this.dust = new Dust(this.count - DUST, DUST, (i) => (i % 8 === 0 ? i % 6 : C_DIM));
    const fonts = document.fonts;
    if (fonts?.ready) void fonts.ready.then(() => { this.text = textPoints('P1', 1); });
  }

  update(env: Env) {
    const { now, W, H, still } = env;
    const t = still ? 0 : now / 1000;
    const narrow = W < 760;
    const cx = W * (narrow ? 0.78 : 0.8);
    const cy = H * (narrow ? 0.14 : 0.26);
    const r0 = Math.min(W, H) * (narrow ? 0.1 : 0.13);
    const X = this.x, S = this.s, A = this.a, C = this.c, Y = this.y, sd = this.seed;
    let j = 0;

    // A ring tilted toward the viewer, spinning; colour runs around it.
    const tilt = 0.8 + Math.sin(t * 0.4) * 0.12;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const ring = (n: number, radius: number, speed: number, thick: number, colorShift: number) => {
      for (let i = 0; i < n; i++, j++) {
        const a = (i / n) * 6.2832 + t * speed;
        const rr = radius + (sd[j] - 0.5) * thick;
        const x = Math.cos(a) * rr, z0 = Math.sin(a) * rr;
        const y = -z0 * ct, z = z0 * st;
        const f = DEPTH / (DEPTH + z / r0);
        X[j] = cx + x * f;
        Y[j] = cy + y * f;
        S[j] = 1.5 * f;
        A[j] = 0.35 + 0.6 * (1 - (z / rr + 1) / 2);
        C[j] = Math.floor((((i / n) * 6 + colorShift + t * 0.3) % 6 + 6) % 6);
      }
    };
    ring(RING, r0, 0.5, r0 * 0.06, 0);
    ring(INNER, r0 * 0.72, -0.8, r0 * 0.02, 3);

    // "P1" in the middle, gold on top fading to white.
    const pts = this.text, n = pts.length / 2 || 1, tw = r0 * 0.9;
    for (let i = 0; i < TEXT; i++, j++) {
      const q = ((sd[j] * n) | 0) * 2;
      const py = pts[q + 1] ?? 0;
      X[j] = cx + (pts[q] ?? 0) * tw;
      Y[j] = cy + py * tw + Math.sin(t * 2 + (pts[q] ?? 0) * 8) * 1.2;
      S[j] = 1.5;
      A[j] = 0.9;
      C[j] = py < -0.02 ? C_GOLD : C_WHITE;
    }

    // Sparks orbiting at different distances.
    for (let i = 0; i < SPARKS; i++, j++) {
      const rr = r0 * (1.15 + sd[j] * 0.5);
      const a = sd[(j * 3) % this.count] * 6.2832 + t * (0.3 + sd[j] * 0.6);
      X[j] = cx + Math.cos(a) * rr;
      Y[j] = cy + Math.sin(a) * rr * 0.55;
      S[j] = 1.3;
      A[j] = 0.25 + 0.5 * Math.max(0, Math.sin(t * 2 + sd[j] * 20));
      C[j] = C_GOLD;
    }

    this.dust.update(this, env);
    // Backlight slowly cycling through the ring's colors.
    const ph = (t * 0.15) % 6, k = ph % 1, c0 = this.rgb[Math.floor(ph)], c1 = this.rgb[(Math.floor(ph) + 1) % 6];
    this.aura = { x: cx, y: cy, r: r0 * 2.4, rgb: [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k], a: 0.09 };
  }
}
