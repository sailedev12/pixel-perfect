// One canvas behind every page. It shows a scene per tab and morphs the same particles
// from one scene into the next (cabinet <-> leaderboard board <-> ambient dust).
//
// To keep the morph fluid and hard to notice:
// - each dot travels to a nearby spot in the new scene (both scenes are sorted by position
//   and paired up), instead of flying across the screen;
// - both scenes keep animating while the dots travel, so nothing freezes;
// - every dot starts moving the moment the tab changes (fast start, long soft landing),
//   drifting along a smooth flow field on the way, so there's no visible pause or sequence;
// - drawing happens on the graphics card (see renderer.ts), so switching doesn't stutter.
import { uiSound } from '../lib/uiSound';
import { createRenderer, type Aura, type Frame, type Renderer } from './renderer';
import { AmbientScene } from './scenes/ambientScene';
import { BoardScene } from './scenes/boardScene';
import { CabinetScene } from './scenes/cabinetScene';
import { LiveScene } from './scenes/liveScene';
import { YouScene } from './scenes/youScene';
import { DanceScene } from './scenes/danceScene';
import { Scene, StaticScene, clamp01, type Env, type RGB } from './scene';

export type SceneName = 'cabinet' | 'board' | 'live' | 'you' | 'ambient' | 'dance' | 'off';

const MAX = 110000;
/** Most a dot waits before setting off; kept small so the change feels instant. */
const SPREAD = 0.2;
/** Moves at full speed straight away, then glides to a stop. */
const easeOut = (k: number) => { const m = 1 - k; return 1 - m * m * m; };
/** Starts gently, speeds up, glides to a stop: no sudden jolt when the morph begins. */
const easeInOut = (k: number) => { const m = 2 - 2 * k; return k < 0.5 ? 4 * k * k * k : 1 - (m * m * m) / 2; };
const WAVE_SPEED = 900; // px per second
const WAVE_LIFE = 0.9; // seconds
const WHITE: RGB = [255, 255, 255];
/** A sine table for the morph's flow field (much cheaper than Math.sin on 100,000 dots a frame). */
const SIN_N = 4096, SIN_K = SIN_N / (Math.PI * 2);
const SIN = Float32Array.from({ length: SIN_N }, (_, i) => Math.sin(i / SIN_K));
const fastSin = (v: number) => SIN[(v * SIN_K) & (SIN_N - 1)];

/**
 * A scene that keeps playing while the canvas changes size (the dancer covers the whole window). It goes on laying
 * itself out for the canvas it was made for and is shifted to stay in the same place on screen, so when the dancer
 * is summoned the cabinet keeps flickering and drifts apart into her, instead of freezing at the click.
 */
class Held extends Scene {
  readonly count: number;
  constructor(private inner: Scene, private W: number, private H: number, private rect: DOMRect) {
    super();
    this.count = inner.count;
    this.alloc(this.count);
    this.rgb = inner.rgb;
    this.glow = inner.glow;
    this.solid = inner.solid;
    this.depth = inner.depth;
    this.rgbPer = inner.rgbPer;
    // Start from exactly what's on screen now.
    this.x.set(inner.x);
    this.y.set(inner.y);
    this.s.set(inner.s);
    this.a.set(inner.a);
    this.c.set(inner.c);
  }
  private tick = 0;
  update(env: Env) {
    // Every other frame is plenty: its dots are on their way out, and the frame time goes to the dancer forming.
    if (this.tick++ % 2) return;
    const S = this.inner;
    S.update({ ...env, W: this.W, H: this.H, canvasRect: this.rect, pointer: [-1e4, -1e4] });
    const dx = this.rect.left - env.canvasRect.left, dy = this.rect.top - env.canvasRect.top;
    for (let i = 0; i < this.count; i++) { this.x[i] = S.x[i] + dx; this.y[i] = S.y[i] + dy; }
    this.s.set(S.s);
    this.a.set(S.a);
    this.c.set(S.c);
    this.rgbPer = S.rgbPer;
    this.depth = S.depth;
    this.aura = S.aura && { ...S.aura, x: S.aura.x + dx, y: S.aura.y + dy };
    this.underglow = S.underglow && { ...S.underglow, x: S.underglow.x + dx, y: S.underglow.y + dy };
  }
  deactivate() {
    this.inner.deactivate();
  }
}

class Stage {
  cabinet!: CabinetScene;
  board!: BoardScene;
  private ambient!: AmbientScene;
  private live!: LiveScene;
  private you!: YouScene;
  private dance!: DanceScene;
  /** Seconds each dot takes to travel in the current morph. */
  private dur = 1.1;
  /** Seconds over which the dots set off, one after another. */
  private spread = SPREAD;
  // Where the canvas sits on the page, so dots frozen mid-morph stay put when it changes size.
  private rectL = 0;
  private rectT = 0;

  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private lastNow = 0;
  private lastEnv: Env | null = null;
  private pointer: [number, number] = [-1e4, -1e4];
  private still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  private wanted: SceneName = 'ambient';
  private wantedInteractive = false;

  private active: Scene | null = null;
  private from: Scene | null = null;
  private tStart = 0;
  private steadySince = 0;

  // Morph pairing: dot i travels from from-scene particle mapA[i] to active-scene particle mapB[i].
  private N = 0;
  private mapA = new Int32Array(MAX);
  private mapB = new Int32Array(MAX);
  private firstA = new Uint8Array(MAX);
  private firstB = new Uint8Array(MAX);
  private noise = new Float32Array(MAX);
  // Scratch space for sorting dots when pairing (kept, so starting a morph allocates nothing big).
  private sortBuf = { key: new Uint32Array(MAX), tmp: new Uint32Array(MAX), cnt: new Uint32Array(8192) };
  /** Seconds each dot waits before setting off in the current morph. */
  private wait = new Float32Array(MAX);
  private phase = new Float32Array(MAX);

  // The frame handed to the renderer (also what a half-finished morph is frozen from).
  private out: Frame = {
    n: 0,
    x: new Float32Array(MAX),
    y: new Float32Array(MAX),
    s: new Float32Array(MAX),
    a: new Float32Array(MAX),
    r: new Float32Array(MAX),
    g: new Float32Array(MAX),
    b: new Float32Array(MAX),
    glow: new Float32Array(MAX),
    glowAlpha: 0,
    z: new Float32Array(MAX).fill(1),
    solid: new Uint8Array(MAX),
  };
  // Click shockwaves.
  private waves: { x: number; y: number; t: number }[] = [];
  private introAt = -1e9;
  private morphDrawn = false;
  // Cursor swirl offsets per dot.
  private offX = new Float32Array(MAX);
  private offY = new Float32Array(MAX);

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.noise[i] = Math.random();
      this.phase[i] = Math.random() * Math.PI * 2;
    }
  }

  mount(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    if (!this.cabinet) {
      this.cabinet = new CabinetScene();
      this.board = new BoardScene();
      this.ambient = new AmbientScene();
      this.live = new LiveScene();
      this.you = new YouScene();
      this.dance = new DanceScene();
    }
    this.renderer = createRenderer(canvas);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    // Track the pointer on the whole window, so scenes react to hover even under page text.
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    this.active = null;
    this.from = null;
    this.show(this.wanted, this.wantedInteractive);
    // Run the other scenes once in the background, so the first visit to each tab doesn't stutter
    // while the browser prepares their code.
    window.setTimeout(() => {
      if (!this.canvas) return;
      const env = this.env(performance.now(), 16);
      for (const s of [this.cabinet, this.board, this.live, this.you, this.dance]) if (s !== this.active) s.update(env);
      // And the morph into the dancer once, so summoning her runs ready code instead of stalling on the click.
      this.dance.warm();
      if (!this.from) {
        this.pair(this.cabinet, this.dance);
        this.fillMorph(this.cabinet, this.dance, 0.5);
        this.morphDrawn = false;
      }
    }, 1500);
  }

  unmount() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro?.disconnect();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onDown);
    document.documentElement.removeEventListener('pointerleave', this.onLeave);
    this.canvas?.removeEventListener('click', this.onClick);
    this.active?.deactivate();
    this.active = null;
    this.from = null;
    this.canvas = null;
    this.renderer = null;
  }

  /** `interactive`: whether clicks on the canvas reach the scene (the cabinet menu on the Games tab). */
  show(name: SceneName, interactive = name === 'cabinet') {
    this.wanted = name;
    this.wantedInteractive = interactive;
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.style.pointerEvents = interactive ? 'auto' : 'none';

    if (name === 'off') {
      // The game player needs the CPU; stop drawing entirely.
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.from = null;
      this.active?.deactivate();
      this.active = null;
      canvas.style.visibility = 'hidden';
      return;
    }
    canvas.style.visibility = 'visible';

    const scenes = { cabinet: this.cabinet, board: this.board, live: this.live, you: this.you, ambient: this.ambient, dance: this.dance };
    const next = scenes[name];
    const now = performance.now();
    if (next === this.active) {
      if (!this.raf) this.start();
      return;
    }
    if (this.active) uiSound.whoosh();
    let from: Scene;
    if (this.from && this.active && this.morphDrawn) {
      from = this.snapshot();
      if (this.from.live) this.from.deactivate();
      this.active.deactivate();
    } else if (this.from && this.active) {
      // A morph that hasn't drawn a frame yet: start again from where it began.
      from = this.from;
      this.active.deactivate();
    } else if (this.active) {
      // The dancer fills the whole window, so the canvas changes size. Going in, the cabinet keeps playing where it
      // was while it turns into her; coming out, what is on screen is frozen in place.
      const c = this.canvas!;
      from = next === this.dance ? new Held(this.active, this.W, this.H, c.getBoundingClientRect())
        : this.active === this.dance ? this.snapshot() : this.active;
    } else {
      from = this.scatter();
    }
    // Leaving or entering the dancer takes longer than a tab change.
    this.dur = Math.max(next.morphIn, this.active?.morphIn ?? 0);
    this.spread = next.morphDelay ? next.morphSpread : this.active?.morphDelay ? this.active.morphSpread : SPREAD;
    this.from = from;
    this.active = next;
    next.activate(now);
    // Work out where the new scene's dots start, so each old dot can be paired with a nearby one.
    next.update({ ...(this.lastEnv ?? this.env(now, 16)), now });
    this.pair(from, next);
    this.tStart = now;
    this.morphDrawn = false;
    if (!this.raf) this.start();
  }

  private start() {
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private resize() {
    const c = this.canvas;
    if (!c) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = c.clientWidth || 1;
    this.H = c.clientHeight || 1;
    const r = c.getBoundingClientRect();
    if (this.from && !this.from.live) {
      const dx = this.rectL - r.left, dy = this.rectT - r.top;
      for (let i = 0; i < this.from.count; i++) { this.from.x[i] += dx; this.from.y[i] += dy; }
    }
    this.rectL = r.left;
    this.rectT = r.top;
    c.width = Math.round(this.W * this.dpr);
    c.height = Math.round(this.H * this.dpr);
    this.renderer?.resize(this.W, this.H, this.dpr);
  }

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas!.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.W / (r.width || 1)), (e.clientY - r.top) * (this.H / (r.height || 1))];
  }
  private onMove = (e: PointerEvent) => {
    if (!this.canvas) return;
    this.pointer = this.local(e);
    if (!this.from) this.active?.pointer('move', this.pointer);
  };
  private onDown = (e: PointerEvent) => {
    if (!this.canvas || this.still) return;
    const [px, py] = this.local(e);
    if (px < 0 || py < 0 || px > this.W || py > this.H) return;
    this.waves.push({ x: px, y: py, t: performance.now() });
    if (this.waves.length > 4) this.waves.shift();
  };
  private onLeave = () => {
    this.pointer = [-1e4, -1e4];
    this.active?.pointer('leave', this.pointer);
  };
  private onClick = (e: MouseEvent) => {
    if (!this.from) this.active?.pointer('click', this.local(e));
  };

  private env(now: number, dt: number): Env {
    return { now, dt, W: this.W, H: this.H, canvasRect: this.canvas!.getBoundingClientRect(), pointer: this.pointer, still: this.still };
  }

  /** First load: every dot starts on one bright horizontal line, like an old screen switching on. */
  private scatter() {
    const s = new StaticScene(MAX);
    for (let i = 0; i < MAX; i++) {
      const u = Math.random() - 0.5;
      s.x[i] = this.W / 2 + u * this.W * 0.8;
      s.y[i] = this.H / 2 + (Math.random() - 0.5) * 3;
      s.s[i] = 1.4;
      // Brightest in the middle of the line, fading at the ends.
      s.a[i] = this.still ? 0 : 0.9 * (1 - Math.abs(u) * 1.6);
    }
    this.introAt = performance.now();
    return s;
  }

  /** Pairs each dot of A with a nearby dot of B: both are ordered along a zig-zag of thin rows, then matched by rank. */
  private pair(A: Scene, B: Scene) {
    const [b0, b1] = B.morphOnly ?? [0, B.count];
    const nB = b1 - b0;
    const N = Math.max(A.count, nB);
    this.N = N;
    const band = 10;
    // Orders dots by (row, position along the row) with a counting sort in two passes of 13 bits each: a few
    // milliseconds for 100,000 dots, so the click that starts a morph doesn't hitch.
    const { key, tmp, cnt } = this.sortBuf;
    const order = (S: Scene, from: number, to: number) => {
      const n = to - from;
      const idx = new Uint32Array(n);
      for (let m = 0; m < n; m++) {
        const i = from + m;
        const row = Math.max(0, Math.min(4095, Math.floor(S.y[i] / band) + 2048));
        const x = Math.max(0, Math.min(8191, Math.round(row % 2 ? this.W - S.x[i] : S.x[i]) + 2048));
        key[i] = row * 8192 + x;
        idx[m] = i;
      }
      for (const shift of [0, 13]) {
        cnt.fill(0);
        for (let i = 0; i < n; i++) cnt[(key[idx[i]] >>> shift) & 8191]++;
        for (let b = 0, sum = 0; b < 8192; b++) { const c = cnt[b]; cnt[b] = sum; sum += c; }
        for (let i = 0; i < n; i++) { const d = idx[i]; tmp[cnt[(key[d] >>> shift) & 8191]++] = d; }
        idx.set(tmp.subarray(0, n));
      }
      return idx;
    };
    const sa = order(A, 0, A.count), sb = order(B, b0, b1);
    let pa = -1, pb = -1;
    for (let i = 0; i < N; i++) {
      const ra = Math.floor((i * A.count) / N), rb = Math.floor((i * nB) / N);
      this.mapA[i] = sa[ra];
      this.mapB[i] = sb[rb];
      this.firstA[i] = ra !== pa ? 1 : 0;
      this.firstB[i] = rb !== pb ? 1 : 0;
      pa = ra;
      pb = rb;
    }
    // Each dot sets off at its own moment: in the order the scene asks for, or at random.
    const { wait, mapA, mapB, noise, spread } = this, dA = A.morphDelay, dB = B.morphDelay;
    for (let i = 0; i < N; i++) {
      const ia = mapA[i] < A.count ? mapA[i] : 0, ib = mapB[i] < B.count ? mapB[i] : 0;
      wait[i] = dB ? dB[ib] * spread : dA ? (1 - dA[ia]) * spread : noise[i] * SPREAD;
    }
  }

  /** Freezes the half-finished morph so a new one can start from exactly what's on screen. */
  private snapshot() {
    const o = this.out;
    const n = o.n;
    const s = new StaticScene(n);
    s.x.set(o.x.subarray(0, n));
    s.y.set(o.y.subarray(0, n));
    s.s.set(o.s.subarray(0, n));
    s.a.set(o.a.subarray(0, n));
    const per = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      per[i * 3] = o.r[i];
      per[i * 3 + 1] = o.g[i];
      per[i * 3 + 2] = o.b[i];
    }
    s.rgbPer = per;
    return s;
  }

  private frame = (now: number) => {
    const renderer = this.renderer;
    if (!renderer || !this.active) {
      this.raf = 0;
      return;
    }
    const dt = Math.min(50, now - this.lastNow);
    this.lastNow = now;
    if (!this.from && this.active.paused) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const env = this.env(now, dt);
    this.lastEnv = env;

    if (this.from?.live) this.from.update(env);
    this.active.update(env);
    if (this.canvas) this.canvas.style.cursor = this.from ? 'default' : this.active.cursor;

    let morphing = false;
    if (this.from) {
      const T = (now - this.tStart) / 1000;
      if (this.still || T > this.dur + this.spread) {
        if (this.from.live) this.from.deactivate();
        this.from = null;
        this.steadySince = now;
      } else {
        this.fillMorph(this.from, this.active, T);
        morphing = true;
      }
    }
    // Trails and glow blend in after a morph instead of switching on.
    const settle = morphing ? 0 : clamp01((now - this.steadySince) / 600);
    if (!morphing) this.fillSteady(this.active, settle);
    this.swirl(this.active.cursorForce, dt, now);
    renderer.fade(morphing ? 0.38 : 0.38 + (this.active.trail - 0.38) * settle);
    renderer.draw(this.out);
    renderer.present(now / 1000, [this.light('aura', now, morphing), this.light('underglow', now, morphing)]);

    this.raf = requestAnimationFrame(this.frame);
  };

  /** A scene light: the active scene's, blended from the old one's during a morph; the backlight also flashes white on power-on. */
  private light(which: 'aura' | 'underglow', now: number, morphing: boolean): Aura | null {
    const B = this.active?.[which] ?? null;
    let out: Aura | null = B;
    if (morphing && this.from) {
      const A = this.from[which];
      const k = easeOut(clamp01((now - this.tStart) / 1000 / (this.dur + this.spread)));
      if (A && B) {
        const ar = A.ry ?? A.r, br = B.ry ?? B.r;
        out = { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, r: A.r + (B.r - A.r) * k, ry: ar + (br - ar) * k, a: A.a + (B.a - A.a) * k, rgb: [A.rgb[0] + (B.rgb[0] - A.rgb[0]) * k, A.rgb[1] + (B.rgb[1] - A.rgb[1]) * k, A.rgb[2] + (B.rgb[2] - A.rgb[2]) * k] };
      } else if (A || B) {
        const S = (A ?? B)!;
        out = { ...S, a: S.a * (A ? 1 - k : k) };
      }
    }
    const flash = which === 'aura' ? 1 - clamp01((now - this.introAt) / 900) : 0;
    if (flash > 0) {
      const f = flash * flash;
      out = { x: this.W / 2, y: this.H / 2, r: Math.max(this.W, this.H) * 0.5, rgb: [255, 255, 255], a: 0.22 * f + (out?.a ?? 0) * (1 - f) };
    }
    return out;
  }

  /** Dots near the cursor swirl around it and ease back when it leaves; clicks send out ripples. */
  private swirl(force: number, dt: number, now: number) {
    this.waves = this.waves.filter((w) => now - w.t < WAVE_LIFE * 1000);
    const waves = this.waves.map((w) => {
      const age = (now - w.t) / 1000;
      return { x: w.x, y: w.y, r: age * WAVE_SPEED, k: (1 - age / WAVE_LIFE) * 2.4 };
    });
    const band = 70;
    const o = this.out;
    const [px, py] = this.pointer;
    const R = Math.min(this.W, this.H) * 0.11;
    const R2 = R * R;
    const push = R * 0.32 * force;
    const ease = 1 - Math.pow(0.86, dt / 16.7);
    const { offX, offY } = this;
    const near = px > -1e3 && force > 0 && !this.still;
    for (let i = 0; i < o.n; i++) {
      let tx = 0, ty = 0;
      if (near) {
        const dx = o.x[i] - px, dy = o.y[i] - py, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const fall = (1 - d / R) * (1 - d / R);
          // Mostly around the cursor (tangent), a little away from it.
          tx = ((dx / d) * 0.55 - (dy / d) * 1.0) * fall * push;
          ty = ((dy / d) * 0.55 + (dx / d) * 1.0) * fall * push;
        }
      }
      offX[i] += (tx - offX[i]) * ease;
      offY[i] += (ty - offY[i]) * ease;
      // Ripple: a kick outward as the ring passes; the swirl easing pulls dots back.
      for (const w of waves) {
        const dx = o.x[i] - w.x, dy = o.y[i] - w.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const gap = Math.abs(d - w.r);
        if (gap < band) {
          const p = (1 - gap / band) * w.k;
          offX[i] += (dx / d) * p;
          offY[i] += (dy / d) * p;
        }
      }
      o.x[i] += offX[i];
      o.y[i] += offY[i];
    }
  }

  private fillSteady(S: Scene, glowFade: number) {
    const o = this.out;
    const n = S.count;
    o.n = n;
    o.glowAlpha = glowFade;
    o.x.set(S.x);
    o.y.set(S.y);
    o.s.set(S.s);
    o.a.set(S.a);
    for (let i = 0; i < n; i++) {
      const c = S.c[i];
      if (S.rgbPer) {
        o.r[i] = S.rgbPer[i * 3];
        o.g[i] = S.rgbPer[i * 3 + 1];
        o.b[i] = S.rgbPer[i * 3 + 2];
      } else {
        const col = S.rgb[c] ?? [255, 255, 255];
        o.r[i] = col[0];
        o.g[i] = col[1];
        o.b[i] = col[2];
      }
      o.glow[i] = S.glow[c] || 0;
      o.solid[i] = S.solid[c] || 0;
      o.z[i] = S.depth ? S.depth[i] : 1;
    }
  }

  private fillMorph(A: Scene, B: Scene, T: number) {
    const N = this.N;
    const o = this.out;
    const { mapA, mapB, firstA, firstB, phase, wait } = this;
    o.glowAlpha = 0;
    const amp = Math.min(this.W, this.H) * 0.045;
    // Everything this loop reads, pulled out once: it runs for ~100,000 dots every frame of the morph, and reading
    // through the scenes each time made it the slowest thing on screen.
    const nA = A.count, nB = B.count, dur = this.dur;
    const Ax = A.x, Ay = A.y, As = A.s, Aa = A.a, Ac = A.c, Ap = A.rgbPer, Ag = A.rgb, Ad = A.depth, Asolid = A.solid;
    const Bx = B.x, By = B.y, Bs = B.s, Ba = B.a, Bc = B.c, Bp = B.rgbPer, Bg = B.rgb, Bd = B.depth, Bsolid = B.solid;
    const inOut = B.morphEase === 'inOut';
    const T16 = T * 1.6, T12 = T * 1.2;
    for (let i = 0; i < N; i++) {
      const ia = mapA[i] < nA ? mapA[i] : 0;
      const ib = mapB[i] < nB ? mapB[i] : 0;
      const a0 = firstA[i] ? Aa[ia] : 0;
      const a1 = firstB[i] ? Ba[ib] : 0;
      // Hidden at both ends, so hidden all the way: nothing more to work out.
      if (a0 === 0 && a1 === 0) { o.a[i] = 0; o.solid[i] = 0; continue; }
      const u = (T - wait[i]) / dur;
      const k = u <= 0 ? 0 : u >= 1 ? 1 : inOut ? easeInOut(u) : easeOut(u);
      const xa = Ax[ia], ya = Ay[ia];
      const x = xa + (Bx[ib] - xa) * k;
      const y = ya + (By[ib] - ya) * k;
      // Smooth flow field: neighbours drift together, like a current.
      if (k > 0 && k < 1) {
        const f = 4 * k * (1 - k) * amp, ph = phase[i] * 0.35;
        o.x[i] = x + fastSin(y * 0.011 + T16 + ph) * f;
        o.y[i] = y + fastSin(x * 0.011 - T12 + ph + Math.PI / 2) * f;
      } else {
        o.x[i] = x;
        o.y[i] = y;
      }
      o.s[i] = As[ia] + (Bs[ib] - As[ia]) * k;
      o.a[i] = a0 + (a1 - a0) * k;
      let r0, g0, b0, r1, g1, b1;
      if (Ap) { r0 = Ap[ia * 3]; g0 = Ap[ia * 3 + 1]; b0 = Ap[ia * 3 + 2]; }
      else { const c = Ag[Ac[ia]] ?? WHITE; r0 = c[0]; g0 = c[1]; b0 = c[2]; }
      if (Bp) { r1 = Bp[ib * 3]; g1 = Bp[ib * 3 + 1]; b1 = Bp[ib * 3 + 2]; }
      else { const c = Bg[Bc[ib]] ?? WHITE; r1 = c[0]; g1 = c[1]; b1 = c[2]; }
      o.r[i] = r0 + (r1 - r0) * k;
      o.g[i] = g0 + (g1 - g0) * k;
      o.b[i] = b0 + (b1 - b0) * k;
      o.glow[i] = 0;
      // Dots on their way to a solid surface: dim while flying (so tens of thousands of them don't add up to a
      // white blur), then solid once they've landed. Dots leaving a solid surface glow as they fly off.
      const toSolid = Bd && Bsolid[Bc[ib]] && firstB[i];
      if (toSolid && k > 0.8) {
        o.solid[i] = 1;
        o.z[i] = Bd[ib];
        o.a[i] = Ba[ib] > 0.004 ? 1 : 0; // dots on her far side stay hidden
      } else {
        o.solid[i] = 0;
        o.z[i] = 1;
        if (toSolid) o.a[i] *= 0.12 + 0.3 * (1 - k);
        else if (Ad && Asolid[Ac[ia]]) o.a[i] *= 0.12 + 0.3 * k;
      }
    }
    // The new scene's dots that don't travel: drawn just as they are, appearing where they are.
    let n = N;
    if (B.morphOnly) {
      const [b0, b1] = B.morphOnly;
      for (let j = 0; j < nB && n < MAX; j++) {
        if (j === b0) { j = b1 - 1; continue; }
        if (Ba[j] === 0) continue; // not showing right now
        o.x[n] = Bx[j]; o.y[n] = By[j]; o.s[n] = Bs[j]; o.a[n] = Ba[j];
        if (Bp) { o.r[n] = Bp[j * 3]; o.g[n] = Bp[j * 3 + 1]; o.b[n] = Bp[j * 3 + 2]; }
        else { const c = Bg[Bc[j]] ?? WHITE; o.r[n] = c[0]; o.g[n] = c[1]; o.b[n] = c[2]; }
        o.glow[n] = 0;
        o.solid[n] = Bd && Bsolid[Bc[j]] ? 1 : 0;
        o.z[n] = Bd ? Bd[j] : 1;
        n++;
      }
    }
    o.n = n;
    this.morphDrawn = true;
  }
}

export const stage = new Stage();
