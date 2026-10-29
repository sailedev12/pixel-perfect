// The floating particle arcade cabinet (Games tab).
// Idle: it drifts on its own, made of static-y dots. Hover: the static clears.
// Click: the camera flies into the screen, which shows a game menu built from dots.
import { GAMES } from '../../games/registry';
import { SAMPLE_LEADERBOARDS, formatScore } from '../../data/sample';
import { uiSound } from '../../lib/uiSound';
import { Scene, clamp01, ease, gauss, hexToRgb, type Env, type RGB } from '../scene';

export type CabinetMode = 'idle' | 'menu' | 'board';

interface CabinetGame {
  id: string;
  name: string;
  color: string;
  available: boolean;
  unit: string;
  top: { player: string; score: string }[];
}
interface Handlers {
  onPlay?(id: string): void;
  onModeChange?(mode: CabinetMode): void;
}
type V3 = [number, number, number];
type Hit = [string, [number, number, number, number]];

const DEPTH = 3.2;
const NS = 8000, NM = 1600, NSN = 900;
// Color classes.
const EDGE = 0, PANEL = 1, ACCENT = 2, SGOLD = 3, SWHITE = 4, SDIM = 5, MARQUEE = 6, SNOW = 7;
/** The bottom of the cabinet fades smoothly to black (1 = fully visible). */
const bottomFade = (y: number) => {
  if (y >= -0.22) return 1;
  const k = Math.max(0, (y + 0.62) / 0.4);
  return k * k * (3 - 2 * k);
};

const R = Math.random;

// Cabinet side profile as (y, z) pairs; z negative faces the viewer.
const PF: [number, number][] = [[-0.62, -0.36], [-0.12, -0.36], [-0.06, -0.52], [0, -0.31], [0.64, -0.22], [0.66, -0.3], [0.95, -0.3], [0.98, 0.42], [-0.62, 0.42]];
const HW = 0.5;
const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const SB = lerp2(PF[3], PF[4], 0.06);
const ST = lerp2(PF[3], PF[4], 0.94);
const scr = (u: number, v: number): V3 => {
  const yz = lerp2(SB, ST, 1 - v);
  return [-0.42 + 0.84 * u, yz[0], yz[1] - 0.012];
};

function buildBody() {
  const segLen = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const perim: [[number, number], [number, number], number][] = [];
  let L = 0;
  for (let i = 0; i < PF.length; i++) {
    const a = PF[i], b = PF[(i + 1) % PF.length];
    L += segLen(a, b);
    perim.push([a, b, L]);
  }
  const onPerim = () => {
    const d = R() * L;
    for (const p of perim) if (d <= p[2]) return lerp2(p[0], p[1], 1 - (p[2] - d) / segLen(p[0], p[1]));
    return PF[0];
  };
  const inside = (y: number, z: number) => {
    let c = false;
    for (let i = 0, j = PF.length - 1; i < PF.length; j = i++) {
      const [yi, zi] = PF[i];
      const [yj, zj] = PF[j];
      if (zi > z !== zj > z && y < ((yj - yi) * (z - zi)) / (zj - zi) + yi) c = !c;
    }
    return c;
  };
  const pts: number[] = [];
  const cls: number[] = [];
  const push = (c: number, x: number, y: number, z: number) => { pts.push(x, y, z); cls.push(c); };
  for (let i = 0; i < 1700; i++) { const p = onPerim(); push(EDGE, R() < 0.5 ? -HW : HW, p[0], p[1]); }
  for (let i = 0; i < 900; i++) { const v = PF[(R() * PF.length) | 0]; push(EDGE, (R() * 2 - 1) * HW, v[0], v[1]); }
  for (let i = 0; i < 1000; i++) {
    let y: number, z: number;
    do { y = -0.62 + R() * 1.6; z = -0.52 + R() * 0.94; } while (!inside(y, z));
    push(PANEL, R() < 0.5 ? -HW : HW, y, z);
  }
  for (let i = 0; i < 260; i++) push(PANEL, (R() * 2 - 1) * HW, -0.62 + R() * 0.5, -0.36);
  for (let i = 0; i < 160; i++) {
    const t = R() * 4, w = 0.1, y0 = -0.5, y1 = -0.32;
    let x: number, y: number;
    if (t < 1) { x = -w + 2 * w * t; y = y0; } else if (t < 2) { x = w; y = y0 + (y1 - y0) * (t - 1); } else if (t < 3) { x = w - 2 * w * (t - 2); y = y1; } else { x = -w; y = y1 - (y1 - y0) * (t - 3); }
    push(EDGE, x, y, -0.365);
  }
  for (let i = 0; i < 420; i++) {
    const t = R() * 4, f = t % 1;
    const uv = t < 1 ? [f, 0] : t < 2 ? [1, f] : t < 3 ? [1 - f, 1] : [0, 1 - f];
    const p = scr(-0.02 + uv[0] * 1.04, -0.03 + uv[1] * 1.06);
    push(ACCENT, p[0], p[1], p[2]);
  }
  const pm = lerp2(PF[2], PF[3], 0.5);
  for (let i = 0; i < 90; i++) push(ACCENT, -0.24 + gauss() * 0.004, pm[0] + R() * 0.11, pm[1] + gauss() * 0.004);
  for (let i = 0; i < 120; i++) {
    const a = R() * 6.2832, b = Math.acos(2 * R() - 1);
    push(ACCENT, -0.24 + 0.035 * Math.sin(b) * Math.cos(a), pm[0] + 0.13 + 0.035 * Math.cos(b), pm[1] + 0.035 * Math.sin(b) * Math.sin(a));
  }
  for (let i = 0; i < 200; i++) { const k = (R() * 4) | 0, a = R() * 6.2832; push(EDGE, 0.02 + k * 0.1 + Math.cos(a) * 0.03, pm[0] + 0.012, pm[1] + Math.sin(a) * 0.03); }
  return { pts: new Float32Array(pts), cls: new Uint8Array(cls) };
}

export class CabinetScene extends Scene {
  readonly count: number;
  mode: CabinetMode = 'idle';
  private handlers: Handlers = {};
  private games: CabinetGame[] = GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    available: g.available,
    unit: g.scoreUnit,
    top: SAMPLE_LEADERBOARDS[g.id].map((e) => ({ player: e.player, score: formatScore(e.score) })),
  }));
  private selected = 0;
  private body = buildBody();
  private NB: number;
  private off = document.createElement('canvas');

  private sPos = new Float32Array(NS * 3); private sFrom = new Float32Array(NS * 3); private sTo = new Float32Array(NS * 3);
  private mPos = new Float32Array(NM * 3); private mFrom = new Float32Array(NM * 3); private mTo = new Float32Array(NM * 3);
  private lagS = new Float32Array(NS); private swS = new Float32Array(NS * 3); private seedS = new Float32Array(NS);
  private lagM = new Float32Array(NM); private swM = new Float32Array(NM * 3);

  private sKey: string | null = null; private sMode: CabinetMode | null = null; private sGame = -1; private mKey: string | null = null;
  private nG = 0; private nW = 0; private sStart = -1e9; private sDur = 1100; private sBurst = 0.16; private mStart = -1e9;
  private edgeRgb: RGB = hexToRgb('#ff4d2e');
  private fT = 0; private stat = 1; private hoverId: string | null = null; private hovering = false;
  private gUntil = 0; private gY = 0; private gDx = 0; private nextG = 0;
  private bbox: [number, number, number, number] = [0, 0, 0, 0];
  private hits: Hit[] = [];
  private pointerPos: [number, number] = [-1e4, -1e4];
  private cam = { S: 400, yaw: -0.32, pitch: 0.12, roll: 0, ox: 0, oy: 80 };
  private flickerUntil = 0;
  private nextFlicker = 2500;
  private firstFrame = true;

  constructor() {
    super();
    this.NB = this.body.cls.length;
    this.count = this.NB + NS + NM + NSN;
    this.alloc(this.count);
    this.rgb = ['#ff4d2e', '#8a8a8a', '#f2f2f2', '#ffd166', '#f4f4f4', '#9a9a9a', '#ff4d2e', '#d9d9d9'].map(hexToRgb);
    this.glow = [0, 0, 0, 0, 0, 0, 0, 0];
    this.trail = 0.42;
    for (let i = 0; i < NS; i++) { this.lagS[i] = R(); this.seedS[i] = R() * 6.2832; this.swS[i * 3] = gauss(); this.swS[i * 3 + 1] = gauss(); this.swS[i * 3 + 2] = Math.abs(gauss()); }
    for (let i = 0; i < NM; i++) { this.lagM[i] = R(); this.swM[i * 3] = gauss(); this.swM[i * 3 + 1] = gauss(); this.swM[i * 3 + 2] = Math.abs(gauss()); }
    const fonts = document.fonts;
    if (fonts?.ready) void fonts.ready.then(() => { this.sKey = ''; this.mKey = ''; });
  }

  setHandlers(h: Handlers) {
    this.handlers = h;
    return () => { if (this.handlers === h) this.handlers = {}; };
  }

  setMode(m: CabinetMode, game?: number) {
    if (m !== this.mode) {
      if (this.mode === 'idle') uiSound.zoomIn();
      else if (m === 'idle') uiSound.zoomOut();
      else uiSound.tick();
    }
    this.mode = m;
    if (game !== undefined) this.selected = game;
    this.handlers.onModeChange?.(m);
  }

  activate() {
    this.firstFrame = true;
    this.stat = 1;
    if (this.mode !== 'idle') {
      this.mode = 'idle';
      this.handlers.onModeChange?.('idle');
    }
  }

  deactivate() {
    this.pointerPos = [-1e4, -1e4];
    this.hovering = false;
    this.hoverId = null;
  }

  pointer(type: 'move' | 'leave' | 'click', p: [number, number]) {
    if (type === 'move') { this.pointerPos = p; return; }
    if (type === 'leave') { this.pointerPos = [-1e4, -1e4]; return; }
    const inRect = (b: [number, number, number, number]) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
    if (this.mode === 'idle') {
      if (inRect(this.bbox)) this.setMode('menu');
      return;
    }
    const h = this.hits.find((x) => inRect(x[1]))?.[0];
    if (!h) return;
    if (h[0] === 'g') this.setMode('board', +h.slice(1));
    else if (h === 'exit') this.setMode('idle');
    else if (h === 'back') this.setMode('menu');
    else if (h === 'play') this.handlers.onPlay?.(this.games[this.selected].id);
  }

  private hitsFor(m: CabinetMode): [string, number, number, number, number][] {
    const BOT: [number, number] = [500 / 570, 556 / 570];
    if (m === 'menu') return [...this.games.map((_, i): [string, number, number, number, number] => ['g' + i, 0.03, (110 + i * 92) / 570, 0.97, (190 + i * 92) / 570]), ['exit', 0.02, BOT[0], 0.3, BOT[1]]];
    if (m === 'board') return this.games[this.selected].available ? [['back', 0.02, BOT[0], 0.3, BOT[1]], ['play', 0.7, BOT[0], 0.98, BOT[1]]] : [['back', 0.02, BOT[0], 0.3, BOT[1]]];
    return [];
  }

  private pick(arr: number[]) {
    const k = ((R() * (arr.length / 2)) | 0) * 2;
    return [arr[k], arr[k + 1]];
  }

  private screenTargets(m: CabinetMode, g: number, hl: number) {
    const off = this.off;
    off.width = 840;
    off.height = 570;
    const c = off.getContext('2d', { willReadFrequently: true })!;
    c.clearRect(0, 0, 840, 570);
    c.textBaseline = 'middle';
    const T = (txt: string, x: number, y: number, cl: 'g' | 'w' | 'b', size: number, w = 700, align: CanvasTextAlign = 'left') => {
      c.fillStyle = cl === 'g' ? '#f00' : cl === 'w' ? '#0f0' : '#00f';
      c.font = `${w} ${size}px "JetBrains Mono", monospace`;
      c.textAlign = align;
      c.fillText(txt, x, y);
    };
    const d = this.games[g];
    if (m === 'idle') {
      T('PIXEL', 420, 120, 'g', 110, 700, 'center');
      T('PERFECT', 420, 245, 'w', 92, 700, 'center');
      T('INSERT COIN', 420, 420, 'b', 62, 700, 'center');
    } else if (m === 'menu') {
      T('SELECT GAME', 40, 50, 'b', 30, 500);
      c.fillStyle = '#00f';
      c.fillRect(40, 84, 760, 3);
      this.games.forEach((x, i) => {
        const y = 150 + i * 92, on = i === hl;
        const cl = on ? 'g' : x.available ? 'w' : 'b';
        T((on ? '> ' : '  ') + x.name.toUpperCase(), 40, y, cl, 44);
        T(x.available ? 'PLAY' : 'SOON', 800, y, cl, 36, 700, 'right');
      });
      T('< EXIT', 40, 528, 'b', 30, 500);
    } else {
      T(d.name.toUpperCase(), 420, 52, 'g', 50, 700, 'center');
      T('SAMPLE SCORES', 40, 112, 'b', 26, 500);
      T(d.unit.toUpperCase(), 800, 112, 'b', 26, 500, 'right');
      c.fillStyle = '#00f';
      c.fillRect(40, 134, 760, 3);
      d.top.slice(0, 5).forEach((r, i) => {
        const y = 180 + i * 66, cl = i === 0 ? 'g' : 'w';
        T(String(i + 1), 52, y, cl, 42);
        T(r.player.toUpperCase().slice(0, 10), 140, y, cl, 42);
        T(r.score, 800, y, cl, 42, 700, 'right');
      });
      T('< BACK', 40, 528, 'b', 32, 500);
      if (d.available) T('PLAY >', 800, 528, 'g', 36, 700, 'right');
      else T('COMING SOON', 800, 528, 'b', 30, 500, 'right');
    }
    const px = c.getImageData(0, 0, 840, 570).data;
    const gold: number[] = [], white: number[] = [], dim: number[] = [];
    for (let y = 0; y < 570; y += 2) for (let x = 0; x < 840; x += 2) {
      const o = (y * 840 + x) * 4;
      if (px[o + 3] < 120) continue;
      (px[o] > 128 ? gold : px[o + 1] > 128 ? white : dim).push(x / 840, y / 570);
    }
    const tot = (gold.length + white.length + dim.length) / 2 || 1;
    const nG = Math.round((NS * gold.length) / 2 / tot), nW = Math.round((NS * white.length) / 2 / tot);
    const out = new Float32Array(NS * 3);
    for (let i = 0; i < NS; i++) {
      const src = i < nG ? gold : i < nG + nW ? white : dim;
      const uv = src.length ? this.pick(src) : [R(), R()];
      out.set(scr(uv[0], uv[1]), i * 3);
    }
    return { out, nG, nW };
  }

  private marqueeTargets(name: string) {
    const off = this.off;
    off.width = 920;
    off.height = 250;
    const c = off.getContext('2d', { willReadFrequently: true })!;
    c.clearRect(0, 0, 920, 250);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let fs = 130;
    c.font = `800 ${fs}px Inter, Arial, sans-serif`;
    while (c.measureText(name).width > 860 && fs > 30) { fs -= 6; c.font = `800 ${fs}px Inter, Arial, sans-serif`; }
    c.fillText(name, 460, 130);
    const px = c.getImageData(0, 0, 920, 250).data;
    const pts: number[] = [];
    for (let y = 0; y < 250; y += 2) for (let x = 0; x < 920; x += 2) if (px[(y * 920 + x) * 4 + 3] > 120) pts.push(x / 920, y / 250);
    const out = new Float32Array(NM * 3);
    for (let i = 0; i < NM; i++) { const uv = pts.length ? this.pick(pts) : [R(), R()]; out.set([-0.46 + 0.92 * uv[0], 0.94 - 0.27 * uv[1], -0.312], i * 3); }
    return out;
  }

  update(env: Env) {
    const { now, dt, W, H, still } = env;
    const mode = this.mode;
    const zoomed = mode !== 'idle';
    const g = this.selected;
    const cam = this.cam;

    // Camera: idle floats on its own; zoomed squares up on the screen.
    const sIdle = Math.min(W * 0.49, H * 0.47);
    const sZoom = Math.min((W * 0.88) / (0.84 * 1.1), (H * 0.66) / (0.57 * 1.1));
    this.fT += still ? 0 : dt * (zoomed ? 0 : 0.25 + 0.75 * this.stat);
    const fT = this.fT;
    const t = {
      S: sIdle,
      yaw: -0.32 + Math.sin(fT * 0.00023) * 0.22,
      pitch: 0.12,
      roll: Math.sin(fT * 0.0005) * 0.035,
      ox: (Math.sin(fT * 0.00031) * 60 + Math.sin(fT * 0.00077) * 18) * (sIdle / 430),
      oy: 0.18 * sIdle + Math.sin(fT * 0.00043) * 22 * (sIdle / 430),
    };
    if (zoomed) {
      t.S = sZoom;
      t.yaw = 0;
      t.pitch = -0.14;
      t.roll = 0;
      const c = scr(0.5, 0.5);
      const cpz = Math.cos(t.pitch), spz = Math.sin(t.pitch);
      const y2 = c[1] * cpz - c[2] * spz, z2 = c[1] * spz + c[2] * cpz, f = DEPTH / (DEPTH + z2);
      t.ox = -c[0] * f * t.S;
      t.oy = y2 * f * t.S;
    }
    const lk = still || this.firstFrame ? 1 : 0.075;
    this.firstFrame = false;
    (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { cam[k] += (t[k] - cam[k]) * lk; });
    const zf = clamp01((cam.S - sIdle) / Math.max(1, sZoom - sIdle));
    const zoomDone = zoomed && Math.abs(cam.S - t.S) < t.S * 0.04;

    // Screen contents follow the mode; hovering a menu row highlights it.
    const hl = mode === 'menu' && this.hoverId && this.hoverId[0] === 'g' ? +this.hoverId.slice(1) : g;
    const key = `${mode}|${g}|${mode === 'menu' ? hl : ''}`;
    if (key !== this.sKey) {
      const r = this.screenTargets(mode, g, hl);
      const small = this.sMode === mode && (mode !== 'board' || this.sGame === g);
      if (this.sKey === null) { this.sPos.set(r.out); this.sStart = -1e9; } else { this.sStart = now; this.sDur = small ? 450 : 1100; this.sBurst = small ? 0.04 : 0.16; }
      this.sFrom.set(this.sPos); this.sTo.set(r.out); this.nG = r.nG; this.nW = r.nW; this.sKey = key; this.sMode = mode; this.sGame = g;
    }
    const focus = mode === 'menu' ? hl : g;
    const mName = zoomed ? this.games[focus].name.toUpperCase() : 'PIXEL PERFECT';
    if (mName !== this.mKey) {
      const out = this.marqueeTargets(mName);
      if (this.mKey === null) { this.mPos.set(out); this.mStart = -1e9; } else this.mStart = now;
      this.mFrom.set(this.mPos); this.mTo.set(out); this.mKey = mName;
    }
    const tgt = hexToRgb(zoomed ? this.games[focus].color : '#ff4d2e');
    const e = this.edgeRgb;
    for (let c = 0; c < 3; c++) e[c] += (tgt[c] - e[c]) * 0.06;
    this.rgb[EDGE] = this.rgb[MARQUEE] = [e[0], e[1], e[2]];
    this.rgb[SDIM] = mode === 'idle' ? [244, 244, 244] : [154, 154, 154];

    // Static: full when idle, clears when hovered or zoomed in.
    const pt = this.pointerPos;
    const b = this.bbox;
    this.hovering = !zoomed && pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
    this.stat += ((!zoomed && !this.hovering ? 1 : 0) - this.stat) * (still ? 1 : 0.08);
    const s = this.stat;
    if (!still && s > 0.4 && now > this.nextG) { this.gY = -0.5 + R() * 1.4; this.gDx = (R() - 0.5) * 0.14; this.gUntil = now + 90 + R() * 120; this.nextG = now + 700 + R() * 1600; }
    const glitch = now < this.gUntil ? this.gDx * s : 0;
    const gY = this.gY;

    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
    const S = cam.S, cx = W / 2 + cam.ox, cy = H / 2 + cam.oy;
    let px = 0, py = 0, pf = 1;
    const proj = (x: number, y: number, z: number) => {
      const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      pf = DEPTH / (DEPTH + z2);
      const qx = x1 * pf * S, qy = -y2 * pf * S;
      px = cx + qx * cr - qy * sr;
      py = cy + qx * sr + qy * cr;
    };

    const X = this.x, Y = this.y, SZ = this.s, A = this.a, C = this.c;
    let w = 0;
    const emit = (x: number, y: number, z: number, a: number, size: number, cls: number) => {
      if (s > 0.01) {
        x += (R() - 0.5) * 0.03 * s; y += (R() - 0.5) * 0.03 * s; z += (R() - 0.5) * 0.03 * s;
        if (R() < 0.12 * s) x += (R() - 0.5) * 0.25 * s;
        a *= 1 - s * 0.6 * R();
      }
      if (glitch && Math.abs(y - gY) < 0.05) x += glitch;
      proj(x, y, z);
      X[w] = px; Y[w] = py; SZ[w] = size * pf; A[w] = a; C[w] = cls;
      w++;
    };

    // Body.
    let x0 = 1e9, y0 = 1e9, x1b = -1e9, y1b = -1e9;
    const BP = this.body.pts, BC = this.body.cls;
    const alphas = [0.85, 0.22, 0.7];
    for (let i = 0; i < this.NB; i++) {
      const q = i * 3, cls = BC[i];
      const y = BP[q + 1];
      let a = alphas[cls] * (1 - 0.55 * zf);
      a *= bottomFade(y);
      // The control panel sits in front of the screen; fade it out while zoomed in.
      if (BP[q + 2] < -0.33) a *= 1 - zf;
      if (cls === EDGE && i % 10 === 0) {
        proj(BP[q], y, BP[q + 2]);
        if (px < x0) x0 = px;
        if (px > x1b) x1b = px;
        if (py < y0) y0 = py;
        if (py > y1b) y1b = py;
      }
      emit(BP[q], y, BP[q + 2], a, 1.3, cls);
    }
    this.bbox = [x0 - 10, y0 - 10, x1b + 10, y1b + 10];

    // Screen.
    const sk = still ? 9 : (now - this.sStart) / this.sDur;
    const blink = mode === 'idle' && Math.sin(now * 0.006) < -0.2 ? 0.08 : 1;
    const { sFrom, sTo, sPos, lagS, swS, seedS, nG, nW, sBurst } = this;
    for (let i = 0; i < NS; i++) {
      const cls = i < nG ? SGOLD : i < nG + nW ? SWHITE : SDIM;
      let a = 0.85;
      if (cls === SDIM) a *= blink;
      const q = i * 3;
      const k = sk >= 1.6 ? 1 : ease(clamp01((sk - lagS[i] * 0.4) / 0.6));
      const bu = Math.sin(k * Math.PI) * sBurst;
      const x = sFrom[q] + (sTo[q] - sFrom[q]) * k + swS[q] * bu * 0.6;
      const y = sFrom[q + 1] + (sTo[q + 1] - sFrom[q + 1]) * k + swS[q + 1] * bu * 0.6 + Math.sin(now * 0.002 + seedS[i]) * 0.0012;
      const z = sFrom[q + 2] + (sTo[q + 2] - sFrom[q + 2]) * k - swS[q + 2] * bu;
      sPos[q] = x; sPos[q + 1] = y; sPos[q + 2] = z;
      emit(x, y, z, a * (0.82 + 0.18 * Math.sin(y * 90 + now * 0.006)), 1.6, cls);
    }

    // Marquee. Now and then it flickers like a neon sign with a loose wire.
    if (!still && !zoomed && now > this.nextFlicker) {
      this.flickerUntil = now + 220 + R() * 380;
      this.nextFlicker = now + 3000 + R() * 5000;
    }
    const signLevel = now < this.flickerUntil && R() < 0.5 ? 0.12 : 1;
    const mk = still ? 9 : (now - this.mStart) / 1100;
    const { mFrom, mTo, mPos, lagM, swM } = this;
    for (let i = 0; i < NM; i++) {
      const q = i * 3;
      const k = mk >= 1.6 ? 1 : ease(clamp01((mk - lagM[i] * 0.4) / 0.6));
      const bu = Math.sin(k * Math.PI) * 0.14;
      const x = mFrom[q] + (mTo[q] - mFrom[q]) * k + swM[q] * bu * 0.6;
      const y = mFrom[q + 1] + (mTo[q + 1] - mFrom[q + 1]) * k + swM[q + 1] * bu * 0.6;
      const z = mFrom[q + 2] + (mTo[q + 2] - mFrom[q + 2]) * k - swM[q + 2] * bu;
      mPos[q] = x; mPos[q + 1] = y; mPos[q + 2] = z;
      emit(x, y, z, 0.95 * (1 - 0.4 * zf) * signLevel, 1.5, MARQUEE);
    }

    // TV snow around the cabinet while it's untuned, fading out toward the bottom like the body.
    for (let i = 0; i < NSN; i++) {
      const y = -0.62 + R() * 1.68;
      proj((R() * 2 - 1) * 0.62, y, (R() * 2 - 1) * 0.5);
      X[w] = px; Y[w] = py; SZ[w] = 1.2; A[w] = s * 0.35 * R() * bottomFade(y); C[w] = SNOW;
      w++;
    }

    // Clickable regions on the screen, in canvas pixels.
    this.hits = zoomDone
      ? this.hitsFor(mode).map((h): Hit => {
          proj(...scr(h[1], h[2]));
          const ax = px, ay = py;
          proj(...scr(h[3], h[4]));
          return [h[0], [Math.min(ax, px), Math.min(ay, py), Math.max(ax, px), Math.max(ay, py)]];
        })
      : [];
    const hover = zoomed ? this.hits.find((h) => pt[0] >= h[1][0] && pt[0] <= h[1][2] && pt[1] >= h[1][1] && pt[1] <= h[1][3])?.[0] ?? null : null;
    if (hover && hover !== this.hoverId) uiSound.tick();
    this.hoverId = hover;
    this.cursor = this.hovering || this.hoverId ? 'pointer' : 'default';

    // Neon backlight behind the cabinet in its edge color, breathing slowly; dimmer when zoomed in.
    const breathe = Math.sin(still ? 0 : now * 0.0013);
    this.aura = {
      x: cx,
      y: cy - 0.18 * S,
      r: S * 1.35,
      rgb: [e[0], e[1], e[2]],
      a: (0.14 + 0.04 * breathe) * (1 - 0.6 * zf) * (0.6 + 0.4 * signLevel),
    };
  }
}
