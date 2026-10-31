// The LED scoreboard (Leaderboards tab). The stage morphs the previous scene's dots onto the
// LED grid; then the results light up row by row. Switching games wipes left to right.
import { GAMES } from '../../games/registry';
import { SAMPLE_LEADERBOARDS } from '../../data/sample';
import { formatScoreFor } from '../../lib/format';
import { getBest } from '../../lib/scores';
import { uiSound } from '../../lib/uiSound';
import { GLYPHS } from '../font5x7';
import { Scene, clamp01, hexToRgb, type Env, type RGB } from '../scene';

interface BoardGame {
  name: string;
  color: string;
  unit: string;
  rows: { player: string; score: string }[];
  you: string;
}

const COLS = 168;
const ROWS = 128;
const NL = COLS * ROWS;
const PITCH = 0.012;
const DEPTH = 3.2;
const HALF_W = (COLS * PITCH) / 2;
const HALF_H = (ROWS * PITCH) / 2;

// LED content classes (what the grid says).
const OFF = 0, HEAD = 1, GOLD = 2, WHITE = 3, DIM = 4, YOU = 5, SAMPLE = 6;
// Scene color classes: 0 = unlit LED, 1 = frame, 2.. = lit LED classes (content class + 1).
const C_OFF = 0, C_FRAME = 1;

function boardData(): BoardGame[] {
  return GAMES.map((g) => {
    const best = getBest(g.id, g.rulesVersion);
    return {
      name: g.name,
      color: g.color,
      unit: g.scoreUnit,
      rows: SAMPLE_LEADERBOARDS[g.id].map((e) => ({ player: e.player, score: formatScoreFor(g, e.score) })),
      you: best > 0 ? formatScoreFor(g, best) : '-',
    };
  });
}

function buildContent(g: BoardGame) {
  const grid = new Uint8Array(NL);
  const put = (txt: string, col: number, row: number, cls: number, scale = 1, align: 'left' | 'right' = 'left') => {
    const s = txt.toUpperCase();
    const adv = 6 * scale;
    let x0 = align === 'right' ? col - (s.length * adv - scale) + 1 : col;
    for (const ch of s) {
      const gl = GLYPHS[ch] ?? GLYPHS[' '];
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++) {
          if (gl[r][c] !== '#') continue;
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const cc = x0 + c * scale + dx;
              const rr = row + r * scale + dy;
              if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) grid[rr * COLS + cc] = cls;
            }
        }
      x0 += adv;
    }
  };
  const line = (row: number, cls: number, dotted = false) => {
    for (let c = 2; c <= 166; c++) if (!dotted || c % 2 === 0) grid[row * COLS + c] = cls;
  };

  put(g.name, 2, 3, HEAD, 2);
  put('TOP 10', 166, 3, DIM, 1, 'right');
  put('#', 2, 22, DIM);
  put('PLAYER', 20, 22, DIM);
  // Sample rankings are labeled; games without any say so instead of showing made-up players.
  if (g.rows.length) put('SAMPLE DATA', 64, 22, SAMPLE);
  else {
    put('NO ONLINE SCORES YET', 25, 60, DIM);
    put('THEY NEED THE SERVER', 25, 72, DIM);
  }
  put(g.unit, 166, 22, DIM, 1, 'right');
  line(30, DIM);
  g.rows.slice(0, 10).forEach((r, i) => {
    const row = 33 + i * 8;
    const cls = i === 0 ? GOLD : WHITE;
    put(String(i + 1), 14, row, cls, 1, 'right');
    put(('@' + r.player).slice(0, 13), 20, row, cls);
    put(r.score, 166, row, cls, 1, 'right');
  });
  line(114, DIM, true);
  put('YOU · THIS DEVICE', 20, 118, YOU);
  put(g.you, 166, 118, YOU, 1, 'right');
  return grid;
}

function buildFrame() {
  const R = Math.random;
  const pts: number[] = [];
  const rectLine = (hw: number, hh: number, n: number) => {
    const per = 4 * (hw + hh);
    for (let k = 0; k < n; k++) {
      let d = R() * per;
      if (d < 2 * hw) { pts.push(-hw + d, hh); continue; }
      d -= 2 * hw;
      if (d < 2 * hh) { pts.push(hw, hh - d); continue; }
      d -= 2 * hh;
      if (d < 2 * hw) { pts.push(hw - d, -hh); continue; }
      d -= 2 * hw;
      pts.push(-hw, -hh + d);
    }
  };
  rectLine(HALF_W + 0.05, HALF_H + 0.05, 1300);
  rectLine(HALF_W + 0.08, HALF_H + 0.08, 900);
  for (const [bx, by] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    for (let k = 0; k < 40; k++) {
      const a = R() * 6.2832, r = Math.sqrt(R()) * 0.018;
      pts.push(bx * (HALF_W + 0.065) + Math.cos(a) * r, by * (HALF_H + 0.065) + Math.sin(a) * r);
    }
  }
  for (const px of [-0.55, 0.55]) for (let k = 0; k < 260; k++) pts.push(px + (R() < 0.5 ? -0.025 : 0.025), -(HALF_H + 0.08) - R() * 0.8);
  return new Float32Array(pts);
}

const ND = 500; // dust drifting up around the board

export class BoardScene extends Scene {
  readonly count: number;
  /** Where the page wants the board, in page coordinates. Set by the Leaderboards page. */
  rectProvider: (() => DOMRect | null) | null = null;

  private games = boardData();
  private gi = 0;
  private cur = buildContent(this.games[0]);
  private prev = new Uint8Array(NL);
  private frame = buildFrame();
  private FR: number;
  private t0 = 0;
  private switchAt = -1e9;
  private edgeRgb: RGB = hexToRgb(GAMES[0].color);
  // Static that clears when the pointer is over the board, like the cabinet.
  private stat = 1;
  private box = [0, 0, 0, 0];
  private flickerUntil = 0;
  private nextFlicker = 3000;
  private bbox: [number, number, number, number] = [0, 0, 0, 0];
  private gUntil = 0;
  private gRow = 0;
  private gDx = 0;
  private nextG = 0;
  private dSeed = new Float32Array(ND);
  private dX = new Float32Array(ND);
  private dSpeed = new Float32Array(ND);

  constructor() {
    super();
    this.FR = this.frame.length / 2;
    this.count = NL + this.FR + ND;
    this.alloc(this.count);
    this.rgb = [[43, 43, 43], [255, 255, 255], [255, 255, 255], hexToRgb('#ffd166'), hexToRgb('#f2f2f2'), hexToRgb('#6e6e6e'), [255, 255, 255], hexToRgb('#ff9a3c')];
    this.glow = [0, 0, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4];
    // Frame and dust particles go after the LEDs; their class never changes.
    this.c.fill(C_FRAME, NL);
    // A light touch, so the scores stay readable under the cursor.
    this.cursorForce = 0.3;
    for (let i = 0; i < ND; i++) {
      this.dSeed[i] = Math.random();
      this.dX[i] = (Math.random() * 2 - 1) * (HALF_W + 0.1);
      this.dSpeed[i] = 0.6 + Math.random() * 0.8;
    }
  }

  /** Which game the board shows. */
  get game() {
    return this.gi;
  }

  setGame(index: number) {
    if (index === this.gi) return;
    this.prev = this.cur;
    this.gi = index;
    this.cur = buildContent(this.games[index]);
    this.switchAt = performance.now();
    uiSound.blips();
  }

  activate(now: number) {
    this.t0 = now;
    this.switchAt = -1e9;
    // Pick up a personal best set since last time.
    this.games = boardData();
    this.cur = buildContent(this.games[this.gi]);
    uiSound.blips(0.45);
  }

  update(env: Env) {
    const { now, W, H, still, canvasRect, pointer } = env;
    const t = still ? 99 : (now - this.t0) / 1000;
    const ks = still ? 99 : (now - this.switchAt) / 1000;
    const R = Math.random;

    const tgt = hexToRgb(this.games[this.gi].color);
    const e = this.edgeRgb;
    for (let c = 0; c < 3; c++) e[c] += (tgt[c] - e[c]) * 0.08;
    this.rgb[C_FRAME] = this.rgb[HEAD + 1] = this.rgb[YOU + 1] = [e[0], e[1], e[2]];

    // Fit the board inside the area the page reserved for it. Until the page has laid out,
    // guess the same area; glide toward the real one so nothing jumps.
    let tx: number, ty: number, tw: number, th: number;
    const r = this.rectProvider?.();
    if (r && r.width > 0) {
      tx = r.left - canvasRect.left;
      ty = r.top - canvasRect.top;
      tw = r.width;
      th = r.height;
    } else {
      const narrow = W < 760;
      tx = narrow ? 16 : 40;
      ty = narrow ? 150 : 110;
      tw = W - tx * 2;
      th = H - ty - (narrow ? 120 : 76);
    }
    const box = this.box;
    if (box[2] === 0 || still) box.splice(0, 4, tx, ty, tw, th);
    else {
      box[0] += (tx - box[0]) * 0.18;
      box[1] += (ty - box[1]) * 0.18;
      box[2] += (tw - box[2]) * 0.18;
      box[3] += (th - box[3]) * 0.18;
    }
    const [rx, ry, rw, rh] = box;
    const sFinal = Math.min((rw * 0.93) / (2 * HALF_W + 0.2), (rh * 0.93) / (2 * HALF_H + 0.2));
    // A gentle settle while the dots are still arriving, then a slow float like the cabinet.
    const fly = 1 - Math.pow(1 - clamp01(t / 1.4), 3);
    const time = still ? 0 : now / 1000;
    let S = sFinal * (0.94 + 0.06 * fly) * (1 + Math.sin(time * 0.5) * 0.006);
    if (ks < 0.6) S *= 1 - 0.02 * Math.sin((Math.PI * ks) / 0.6);
    const yaw = 0.1 * (1 - fly) + Math.sin(time * 0.33) * 0.05;
    const pitch = 0.06 * (1 - fly) + Math.sin(time * 0.41 + 1) * 0.035;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cx = rx + rw / 2 + Math.sin(time * 0.27) * rw * 0.006;
    const cy = ry + rh / 2 + Math.sin(time * 0.6) * rh * 0.01;
    let px = 0, py = 0, pf = 1;
    const proj = (x: number, y: number) => {
      const x1 = x * cyw, z1 = x * syw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      pf = DEPTH / (DEPTH + z2);
      px = cx + x1 * pf * S;
      py = cy - y2 * pf * S;
    };
    this.trail = 0.6;

    // Hovering the board tunes out the static.
    const b = this.bbox;
    const hovering = pointer[0] >= b[0] && pointer[0] <= b[2] && pointer[1] >= b[1] && pointer[1] <= b[3];
    // Lighter static than the cabinet so the scores stay readable.
    this.stat += ((hovering ? 0 : 0.6) - this.stat) * (still ? 1 : 0.07);
    const s = still ? 0 : this.stat;
    if (!still && s > 0.3 && now > this.nextG) {
      this.gRow = (R() * ROWS) | 0;
      this.gDx = (R() - 0.5) * 10;
      this.gUntil = now + 80 + R() * 120;
      this.nextG = now + 900 + R() * 1800;
    }
    const glitch = now < this.gUntil ? this.gDx * s : 0;
    // The game name flickers now and then, like a neon sign.
    if (!still && now > this.nextFlicker) {
      this.flickerUntil = now + 200 + R() * 300;
      this.nextFlicker = now + 4000 + R() * 6000;
    }
    const signLevel = now < this.flickerUntil && R() < 0.5 ? 0.15 : 1;

    const X = this.x, Y = this.y, SZ = this.s, A = this.a, C = this.c;
    const ledPx = PITCH * S;
    const offSize = Math.max(0.8, ledPx * 0.5);
    const core = Math.max(1, ledPx * 0.78);
    const jit = ledPx * 0.9 * s;
    const cur = this.cur, prev = this.prev;
    for (let i = 0; i < NL; i++) {
      const col = i % COLS, row = (i - col) / COLS;
      proj((col - (COLS - 1) / 2) * PITCH, ((ROWS - 1) / 2 - row) * PITCH);
      // Static: every LED shivers a little; a few streak sideways; a band glitches now and then.
      let jx = 0, jy = 0;
      if (s > 0.01) {
        jx = (R() - 0.5) * jit;
        jy = (R() - 0.5) * jit;
        if (R() < 0.025 * s) jx += (R() - 0.5) * ledPx * 14 * s;
      }
      if (glitch && Math.abs(row - this.gRow) < 4) jx += glitch * ledPx;
      X[i] = px + jx;
      Y[i] = py + jy;
      // A slow bright band sweeps down the board.
      const sheen = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(row * 0.07 - time * 2.2));
      // Switching games: the old text dims out and the new one glows in, sweeping left to right.
      let cls = cur[i];
      let a = 1;
      if (ks < 0.8) {
        const local = ks - (col / COLS) * 0.35;
        if (local < 0.18) { cls = prev[i]; a = local < 0 ? 1 : 1 - local / 0.18; } else a = clamp01((local - 0.18) / 0.25);
      }
      // The results are faintly there from the start and brighten as the dots land.
      a *= clamp01((t - 0.35 - (row / ROWS) * 0.35) / 0.6);
      if (cls !== OFF) {
        C[i] = cls + 1;
        A[i] = (0.2 + 0.75 * a) * sheen * (1 - s * 0.35 * R()) * (cls === HEAD ? signLevel : 1);
        SZ[i] = core * (0.7 + 0.3 * a);
      } else {
        C[i] = C_OFF;
        // Unlit LEDs: only every other one shows, which keeps the grid light to draw.
        A[i] = (col + row) % 2 ? 0 : sheen * (1 - s * 0.5 * R());
        SZ[i] = offSize;
      }
    }
    const F = this.frame;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < this.FR; k++) {
      proj(F[k * 2], F[k * 2 + 1]);
      const i = NL + k;
      X[i] = px + (s > 0.01 ? (R() - 0.5) * jit : 0);
      Y[i] = py + (s > 0.01 ? (R() - 0.5) * jit : 0);
      SZ[i] = 1.4 * pf;
      A[i] = 0.75 * (1 - s * 0.4 * R());
      if (k < 1300) {
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    this.bbox = [x0, y0, x1, y1];
    // Backlight behind the board in the game's color.
    this.aura = { x: cx, y: cy, r: Math.max(rw, rh) * 0.6, rgb: [e[0], e[1], e[2]], a: 0.07 + 0.015 * Math.sin(time * 1.1) };
    // A softer pool of light under the board's bottom edge.
    this.underglow = { x: cx, y: cy + rh * 0.5, r: rw * 0.5, ry: rh * 0.14, rgb: [e[0], e[1], e[2]], a: 0.12 + 0.03 * Math.sin(time * 1.7) };

    // Dust rising from the posts and drifting off the top edge.
    for (let k = 0; k < ND; k++) {
      const p = ((still ? 0 : now) * 0.00006 * this.dSpeed[k] + this.dSeed[k]) % 1;
      const y = -(HALF_H + 0.9) + p * (2 * HALF_H + 1.3);
      proj(this.dX[k] + Math.sin(p * 9 + k) * 0.04, y);
      const i = NL + this.FR + k;
      X[i] = px;
      Y[i] = py;
      SZ[i] = 1.2 * pf;
      A[i] = Math.sin(p * Math.PI) * 0.35;
    }
  }
}
