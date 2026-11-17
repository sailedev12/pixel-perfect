import { createLoop } from '../loop';
import { mulberry32, randomSeed } from '../rng';
import type { ArcadeGame, GameAction, GameContext, GameResult } from '../types';

// Coil: a snake that moves to music. Two things set it apart:
// - Lasso: close a loop with your body and everything inside it is captured at once, worth more the more you
//   wrap (2 things: each counts double, 3: triple...).
// - On the beat: the snake steps in time with the music. Turning on the kick drum builds a combo that multiplies
//   every point; turning off the beat breaks it. The better you play, the more the music builds up.
// Everything runs on the game's own ticks, so a run can be rebuilt from its seed and inputs.
// It's seen from a chase camera floating behind the head (left and right steer, like driving), with the world
// drawn as neon sand, and a small map in the corner for lining up loops.

// Rules version 2. Changing any number in this block changes how scores compare,
// so bump `rulesVersion` (here and in the registry) when you do.
const RULES = 2;
const COLS = 24;
const ROWS = 24;
const CELL = 20;
const W = COLS * CELL;
const H = ROWS * CELL;
const START_LEN = 5;
const SLOWEST = 9; // ticks per step at the start (a beat every 4 steps: 100 beats a minute)
const FASTEST = 5; // ticks per step at top speed (180 beats a minute)
const SPEED_UP_EVERY = 6; // pellets per speed-up (eaten or captured)
const PELLETS_ON_BOARD = 3;
const PELLET_POINTS = 10;
const BONUS_POINTS = 50;
const BONUS_EVERY = 5; // a gold core appears after every 5th pellet
const BONUS_TICKS = 360; // and lasts 6 seconds
const STEPS_PER_BEAT = 4;
const BEAT_WINDOW = 7; // how close to the kick (in ticks, either side) a turn counts as on the beat
const COMBO_PER_LEVEL = 3; // on-beat turns per step up in multiplier
const MAX_MULT = 4;
const MAX_QUEUED_TURNS = 3;
// A turn pressed just after the snake went straight into a cell (within the first third of the step, at most this
// many ticks) still turns at that cell, as if pressed in time.
const LATE_GRACE = 3;

const FOOD = '#ff5fa2';
const GOLD = '#ffd166';
const TICKS_PER_SECOND = 60;

// Directions: 0 up, 1 right, 2 down, 3 left.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIR_FOR: Partial<Record<GameAction, number>> = { up: 0, right: 1, down: 2, left: 3 };

// The music: a four-bar loop (A minor, F, C, G), one chord a bar.
const ROOTS = [110, 87.31, 130.81, 98];
const CHORD = [[1, 1.189, 1.498, 2], [1, 1.26, 1.498, 2], [1, 1.26, 1.498, 2], [1, 1.26, 1.498, 2]];

type State = 'ready' | 'playing' | 'dying' | 'done';
interface Cell {
  x: number;
  y: number;
}
// Pop-ups and sparks live in the 3D world (x across, y up, z down the board; a cell is 1 wide).
interface Popup {
  text: string;
  x: number;
  y: number;
  z: number;
  t: number;
  color: string;
  big: boolean;
}
interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  color: string;
}

export function createCoil({ canvas, sfx, callbacks }: GameContext): ArcadeGame {
  const g = canvas.getContext('2d')!;
  const scale = canvas.width / W;

  let state: State = 'ready';
  let started = false;
  let destroyed = false;
  let snake: Cell[] = [];
  let prev: Cell[] = [];
  let dir = 1;
  let queue: number[] = [];
  let pellets: Cell[] = [];
  let bonus: (Cell & { ticks: number }) | null = null;
  let eaten = 0; // pellets eaten or captured
  let grow = 0; // cells still to grow
  let score = 0;
  let playTicks = 0;
  let sinceStep = 0;
  let stepIndex = 0;
  let lastBeatTick = 0;
  let combo = 0;
  let bestCombo = 0;
  let captures = 0;
  let bestLasso = 0;
  let time = 0;
  let deathTimer = 0;
  let seed = 0;
  let rand = Math.random;
  let inputs: number[] = [];
  // Effects (only for drawing).
  let beatFlash = 0;
  let lassoCells: Cell[] = [];
  let lassoT = 0;
  let currentT = 0;
  let popups: Popup[] = [];
  let sparks: Spark[] = [];
  const outside = new Uint8Array(COLS * ROWS);
  // The state just before the last step, if it went straight (for a turn pressed a hair late).
  let undo: { dir: number; snake: Cell[]; prev: Cell[]; pellets: Cell[]; bonus: (Cell & { ticks: number }) | null; eaten: number; grow: number; score: number; captures: number; bestLasso: number } | null = null;
  // The camera's heading (radians, 0 = up the board), easing toward the snake's after each turn.
  let camYaw = Math.PI / 2;
  let yawTarget = Math.PI / 2;

  const interval = () => Math.max(FASTEST, SLOWEST - Math.floor(eaten / SPEED_UP_EVERY));
  const mult = () => Math.min(MAX_MULT, 1 + Math.floor(combo / COMBO_PER_LEVEL));
  const at = (list: Cell[], x: number, y: number) => list.findIndex((c) => c.x === x && c.y === y);

  /**
   * Marks every cell that can reach the edge of the board without crossing the snake. Cells that can't are
   * inside a loop of its body. (Touching a wall doesn't close a loop: only the body does.)
   */
  const findOutside = () => {
    outside.fill(0);
    const blocked = new Uint8Array(COLS * ROWS);
    for (const s of snake) blocked[s.y * COLS + s.x] = 1;
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      const i = y * COLS + x;
      if (!blocked[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    };
    for (let x = 0; x < COLS; x++) { push(x, 0); push(x, ROWS - 1); }
    for (let y = 0; y < ROWS; y++) { push(0, y); push(COLS - 1, y); }
    while (stack.length) {
      const i = stack.pop()!, x = i % COLS, y = (i / COLS) | 0;
      if (x > 0) push(x - 1, y);
      if (x < COLS - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < ROWS - 1) push(x, y + 1);
    }
  };

  const occupied = (x: number, y: number) =>
    at(snake, x, y) >= 0 || at(pellets, x, y) >= 0 || (!!bonus && bonus.x === x && bonus.y === y);

  /** A random empty cell outside any loop. Uses the run's seed, so the layout can be rebuilt from it. */
  const freeCell = (): Cell => {
    findOutside();
    const ok = (x: number, y: number) => outside[y * COLS + x] === 1 && !occupied(x, y);
    for (let tries = 0; tries < 2000; tries++) {
      const x = Math.floor(rand() * COLS), y = Math.floor(rand() * ROWS);
      if (ok(x, y)) return { x, y };
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (ok(x, y)) return { x, y };
    return { x: -1, y: -1 };
  };

  const fillPellets = () => {
    while (pellets.length < PELLETS_ON_BOARD) {
      const c = freeCell();
      if (c.x < 0) break;
      pellets.push(c);
    }
  };

  const reset = () => {
    seed = randomSeed();
    rand = mulberry32(seed);
    state = 'ready';
    dir = 1;
    queue = [];
    camYaw = yawTarget = (dir * Math.PI) / 2;
    const cy = Math.floor(ROWS / 2), cx = Math.floor(COLS / 2);
    snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
    prev = snake.map((s) => ({ ...s }));
    pellets = [];
    bonus = null;
    fillPellets();
    eaten = 0;
    grow = 0;
    score = 0;
    playTicks = 0;
    sinceStep = 0;
    stepIndex = 0;
    lastBeatTick = 0;
    combo = 0;
    bestCombo = 0;
    captures = 0;
    bestLasso = 0;
    deathTimer = 0;
    inputs = [];
    beatFlash = 0;
    lassoCells = [];
    lassoT = 0;
    currentT = 0;
    popups = [];
    sparks = [];
    callbacks.onScore(0);
  };

  const pop = (text: string, c: Cell, color: string, big = false) =>
    popups.push({ text, x: c.x + 0.5, y: 1.1, z: c.y + 0.5, t: big ? 1.2 : 0.7, color, big });

  const burst = (c: Cell, color: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 4;
      sparks.push({ x: c.x + 0.5, y: 0.4, z: c.y + 0.5, vx: Math.cos(a) * v, vy: 2 + Math.random() * 4, vz: Math.sin(a) * v, t: 0.5 + Math.random() * 0.5, color });
    }
  };

  const die = () => {
    state = 'dying';
    deathTimer = 0.7;
    sfx.tone(220, 320, 'sawtooth', 0.07, 55);
  };

  const finish = () => {
    state = 'done';
    loop.stop();
    render(1);
    sfx.tone(330, 220, 'triangle', 0.07, 110, 100);
    const result: GameResult = {
      gameId: 'coil',
      rulesVersion: RULES,
      score,
      durationMs: Math.round((playTicks * 1000) / TICKS_PER_SECOND),
      ticks: playTicks,
      seed,
      inputs: inputs.slice(),
      endedAt: new Date().toISOString(),
      details: { captures, bestLasso, bestCombo },
    };
    callbacks.onGameOver(result);
  };

  /** One step of the music: the snake moves on 16th notes, the kick is on every 4th. Layers build with the combo. */
  const music = (stepNo: number) => {
    const pos = stepNo % 16, bar = Math.floor(stepNo / 16) % 4, root = ROOTS[bar], level = mult();
    const stepMs = (interval() * 1000) / TICKS_PER_SECOND;
    if (pos % 4 === 0) sfx.tone(150, 140, 'sine', 0.13, 42); // kick
    if (level >= 2 && pos % 4 === 2) sfx.noise(40, 0.025); // hi-hat on the off-beat
    if (level >= 2 && pos % 2 === 1) sfx.noise(18, 0.008, 9000); // and a faint shaker
    if (level < 3) { if (pos % 4 === 0) sfx.tone(root, stepMs * 3.2, 'sawtooth', 0.028); } // bass on the beat
    else if (pos % 2 === 0) sfx.tone(pos % 4 === 0 ? root : root * 2, stepMs * 1.6, 'sawtooth', 0.03); // bass in 8ths
    if (level >= 4) sfx.tone(root * 4 * CHORD[bar][pos % 4], stepMs * 0.9, 'square', 0.014); // arpeggio
  };

  /** Moves the snake one cell. */
  const advance = () => {
    // Take the next queued turn, if any.
    while (queue.length) {
      const next = queue.shift()!;
      if (next !== dir && (next + 2) % 4 !== dir) {
        // The camera swings round with the turn (a quarter turn left or right).
        yawTarget += ((next - dir + 4) % 4 === 1 ? 1 : -1) * (Math.PI / 2);
        dir = next;
        break;
      }
    }
    const head = snake[0];
    const nx = head.x + DX[dir], ny = head.y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die();
    const ate = at(pellets, nx, ny);
    if (ate >= 0) grow++;
    // The tail moves out of the way this step unless the snake is growing.
    const body = grow > 0 ? snake : snake.slice(0, -1);
    if (at(body, nx, ny) >= 0) return die();

    const before = score;
    prev = snake.map((s) => ({ ...s }));
    snake.unshift({ x: nx, y: ny });
    if (grow > 0) { grow--; prev.push({ ...prev[prev.length - 1] }); } else snake.pop();
    const m = mult();
    const startEaten = eaten;

    if (ate >= 0) {
      pellets.splice(ate, 1);
      eaten++;
      score += PELLET_POINTS * m;
      sfx.tone(ROOTS[Math.floor(stepIndex / 16) % 4] * 6, 70, 'square', 0.04, ROOTS[Math.floor(stepIndex / 16) % 4] * 9);
      if (m > 1) pop(`+${PELLET_POINTS * m}`, { x: nx, y: ny }, FOOD);
    }
    if (bonus && nx === bonus.x && ny === bonus.y) {
      score += BONUS_POINTS * m;
      pop(`+${BONUS_POINTS * m}`, bonus, GOLD);
      bonus = null;
      sfx.tone(880, 80, 'square', 0.04);
      sfx.tone(1320, 80, 'square', 0.04, undefined, 70);
      sfx.tone(1760, 120, 'square', 0.035, undefined, 140);
    }

    // Lasso: anything now shut inside a loop of the body is captured, all at once.
    findOutside();
    const caught: Cell[] = [];
    let base = 0, goldCaught: Cell | null = null;
    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      if (!outside[p.y * COLS + p.x]) { caught.push(p); base += PELLET_POINTS; pellets.splice(i, 1); grow++; eaten++; }
    }
    if (bonus && !outside[bonus.y * COLS + bonus.x]) { goldCaught = bonus; caught.push(bonus); base += BONUS_POINTS; bonus = null; }
    if (caught.length) {
      const n = caught.length, pts = base * n * m;
      score += pts;
      captures++;
      bestLasso = Math.max(bestLasso, n);
      // The loop's inside lights up, a current runs round the body, and what was caught bursts.
      lassoCells = [];
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!outside[y * COLS + x] && at(snake, x, y) < 0) lassoCells.push({ x, y });
      lassoT = 0.7;
      currentT = 0.5;
      for (const c of caught) burst(c, c === goldCaught ? GOLD : FOOD, 14);
      const mid = caught[0];
      pop(n > 1 ? `LASSO ×${n}  +${pts}` : `LASSO +${pts}`, mid, '#b6ffe0', true);
      const r = ROOTS[Math.floor(stepIndex / 16) % 4];
      for (let i = 0; i < Math.min(5, n + 2); i++) sfx.tone(r * 4 * CHORD[0][i % 4] * (i >= 4 ? 2 : 1), 120, 'triangle', 0.045, undefined, i * 55);
    }

    // A gold core after every 5th pellet.
    if (Math.floor(eaten / BONUS_EVERY) > Math.floor(startEaten / BONUS_EVERY) && !bonus) {
      const c = freeCell();
      if (c.x >= 0) bonus = { ...c, ticks: BONUS_TICKS };
    }
    fillPellets();
    if (score !== before) callbacks.onScore(score);
  };

  const step = (dtMs: number) => {
    const s = dtMs / 1000;
    time += s;
    beatFlash = Math.max(0, beatFlash - s * 4);
    lassoT = Math.max(0, lassoT - s);
    currentT = Math.max(0, currentT - s);
    camYaw += (yawTarget - camYaw) * 0.32;
    for (const p of popups) { p.t -= s; p.y += s * (p.big ? 0.6 : 1); }
    popups = popups.filter((p) => p.t > 0);
    for (const k of sparks) {
      k.t -= s; k.vy -= 9 * s;
      k.x += k.vx * s; k.y += k.vy * s; k.z += k.vz * s;
      if (k.y < 0) { k.y = 0; k.vy *= -0.4; k.vx *= 0.7; k.vz *= 0.7; }
    }
    sparks = sparks.filter((k) => k.t > 0);
    if (state === 'playing') {
      playTicks++;
      if (bonus && --bonus.ticks <= 0) bonus = null;
      if (++sinceStep >= interval()) {
        sinceStep = 0;
        const beat = stepIndex % STEPS_PER_BEAT === 0;
        undo = queue.length ? null : {
          dir, snake: snake.map((c) => ({ ...c })), prev: prev.map((c) => ({ ...c })), pellets: pellets.map((c) => ({ ...c })),
          bonus: bonus && { ...bonus }, eaten, grow, score, captures, bestLasso,
        };
        advance();
        if ((state as State) === 'playing') {
          if (beat) { lastBeatTick = playTicks; beatFlash = 1; }
          music(stepIndex);
          stepIndex++;
        }
      }
    } else if (state === 'dying') {
      deathTimer -= s;
      if (deathTimer <= 0) finish();
    }
  };

  /** Ticks until the next kick, and since the last one. */
  const beatTiming = () => {
    const toStep = interval() - sinceStep;
    const stepsToBeat = (STEPS_PER_BEAT - (stepIndex % STEPS_PER_BEAT)) % STEPS_PER_BEAT;
    return { next: toStep + stepsToBeat * interval(), since: playTicks - lastBeatTick };
  };

  // ---------- drawing: a chase camera behind the head, the world as neon sand ----------
  const FOCAL = W * 0.82;
  const CAM_BACK = 5.6, CAM_UP = 4.4, LOOK_AHEAD = 4.5;
  // Beyond the walls the floor carries on for OUTER cells each way, and far out a ring of sand dunes: the board is
  // the same size, but it sits in a big world.
  const OUTER = 30;
  const DUNES = Array.from({ length: 220 }, (_, i) => {
    const a = (i / 220) * Math.PI * 2;
    return [a, 3 + 4 * Math.abs(Math.sin(a * 3.1)) + 3 * Math.abs(Math.sin(a * 7.7 + 1)) + 1.5 * Math.sin(a * 17.3)];
  });
  // The camera (position, forward, right, up) and the last projected point (screen x, y, and depth).
  let cX = 0, cY = 0, cZ = 0, fX = 0, fY = 0, fZ = 1, rX = 1, rZ = 0, uX = 0, uY = 1, uZ = 0;
  let sx = 0, sy = 0, sz = 0;
  const project = (x: number, y: number, z: number) => {
    const dx = x - cX, dy = y - cY, dz = z - cZ;
    sz = dx * fX + dy * fY + dz * fZ;
    if (sz < 0.3) return false;
    sx = W / 2 + ((dx * rX + dz * rZ) / sz) * FOCAL;
    sy = H / 2 - ((dx * uX + dy * uY + dz * uZ) / sz) * FOCAL;
    return true;
  };
  /** Far things fade into the dark. */
  const fog = (d: number) => Math.max(0, Math.min(1, 1.3 - d / 48));
  /** One grain of sand: a square dot, smaller and dimmer with distance. */
  const grain = (x: number, y: number, z: number, size: number, r: number, gg: number, b: number, a: number) => {
    if (!project(x, y, z)) return;
    const px = Math.max(1, (size * FOCAL) / sz), al = a * fog(sz);
    if (al < 0.02) return;
    g.fillStyle = `rgba(${r},${gg},${b},${al})`;
    g.fillRect(sx - px / 2, sy - px / 2, px, px);
  };
  // The snake's body is a tube of sand, like the dancer: each grain has a fixed spot on it (how far along its
  // segment, its angle round the tube, how deep, how sandy its colour, when it twinkles), so the body keeps its
  // shape as it slides and only shimmers.
  const BODY_GRAINS = 120;
  const BODY = Array.from({ length: 4096 }, (_, i) => {
    const h = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
    return { along: h(1), ang: Math.PI * (h(2) * 1.5 - 0.25), depth: 0.72 + 0.28 * Math.sqrt(h(3)), sand: h(4), tw: h(5) * 6.28 };
  });
  // Soft round sand dots, drawn once per colour and stamped (much cheaper than a gradient per grain).
  const dots = new Map<string, HTMLCanvasElement>();
  const dot = (r: number, gg: number, b: number) => {
    const key = `${r >> 4},${gg >> 4},${b >> 4}`;
    let c = dots.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d')!, grad = x.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, `rgba(${r},${gg},${b},0.9)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, 16, 16);
      dots.set(key, c);
    }
    return c;
  };
  /** One soft sand dot in the world (round, glowing at its centre). */
  const sandDot = (x: number, y: number, z: number, size: number, img: HTMLCanvasElement, a: number) => {
    if (!project(x, y, z)) return;
    const al = a * fog(sz);
    if (al < 0.02) return;
    const px = Math.max(1.5, (size * FOCAL) / sz);
    g.globalAlpha = Math.min(1, al);
    g.drawImage(img, sx - px, sy - px, px * 2, px * 2);
  };
  // Loose sand blowing off the body as it moves (only for the look; not part of the game).
  let dust: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; img: HTMLCanvasElement }[] = [];
  let lastRender = 0;

  const render = (alpha: number) => {
    if (destroyed) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const m = mult();

    // The camera: behind and above the head, looking ahead of it; it bobs on the kick.
    const p = state === 'playing' ? Math.min(1, (sinceStep + alpha) / interval()) : 1;
    const h0 = prev[0] ?? snake[0], h1 = snake[0];
    const hx = h0.x + (h1.x - h0.x) * p + 0.5, hz = h0.y + (h1.y - h0.y) * p + 0.5;
    const ffx = Math.sin(camYaw), ffz = -Math.cos(camYaw);
    cX = hx - ffx * CAM_BACK; cZ = hz - ffz * CAM_BACK; cY = CAM_UP + 0.14 * beatFlash;
    {
      const dx = hx + ffx * LOOK_AHEAD - cX, dy = -cY, dz = hz + ffz * LOOK_AHEAD - cZ, l = Math.hypot(dx, dy, dz);
      fX = dx / l; fY = dy / l; fZ = dz / l;
      const rl = Math.hypot(fZ, fX);
      rX = -fZ / rl; rZ = fX / rl;
      uX = -rZ * fY; uY = rZ * fX - rX * fZ; uZ = rX * fY;
    }

    g.globalCompositeOperation = 'lighter';

    // The horizon: a soft glow where the floor meets the sky, and sand dunes far out all around.
    if (project(hx + ffx * 400, 0, hz + ffz * 400)) {
      const hy = sy, grad = g.createLinearGradient(0, hy - 46, 0, hy + 30);
      grad.addColorStop(0, 'rgba(61,220,151,0)');
      grad.addColorStop(0.6, `rgba(61,220,151,${0.2 + 0.08 * beatFlash})`);
      grad.addColorStop(1, 'rgba(61,220,151,0)');
      g.fillStyle = grad;
      g.fillRect(0, hy - 46, W, 76);
    }
    for (const [a, top] of DUNES) {
      const dx = COLS / 2 + Math.cos(a) * 95, dz = ROWS / 2 + Math.sin(a) * 95;
      // (Not faded by distance like everything else: they're meant to be seen far away.)
      for (let y = 0; y < top; y += 0.9) {
        if (!project(dx, y, dz)) continue;
        const px = Math.max(1.2, (0.7 * FOCAL) / sz);
        g.fillStyle = `rgba(120,210,180,${0.42 * (1 - y / (top + 1))})`;
        g.fillRect(sx - px / 2, sy - px / 2, px, px);
      }
    }

    // The floor outside the walls: the same squares, dimmer and cooler, running off into the distance.
    {
      const far = new Path2D();
      const seg = (x0: number, z0: number, x1: number, z1: number) => {
        if (!project(x0, 0, z0)) return;
        const ax = sx, ay = sy;
        if (!project(x1, 0, z1)) return;
        far.moveTo(ax, ay);
        far.lineTo(sx, sy);
      };
      for (let z = -OUTER; z <= ROWS + OUTER; z++) for (let x = -OUTER; x < COLS + OUTER; x += 3) {
        if (z >= 0 && z <= ROWS && x >= 0 && x + 3 <= COLS) continue;
        seg(x, z, x + 3, z);
      }
      for (let x = -OUTER; x <= COLS + OUTER; x++) for (let z = -OUTER; z < ROWS + OUTER; z += 3) {
        if (x >= 0 && x <= COLS && z >= 0 && z + 3 <= ROWS) continue;
        seg(x, z, x, z + 3);
      }
      g.strokeStyle = 'rgba(80,170,180,0.22)';
      g.lineWidth = 1;
      g.stroke(far);
    }

    // The floor: clear square tiles (their edges as lines, brightest near you), a sand dot at every corner, and
    // a ripple rolling out from the head on every kick.
    const ripple = (1 - beatFlash) * 11;
    g.lineWidth = 1;
    const bands = [0, 0, 0, 0].map(() => new Path2D());
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      if (!project(x0, 0, z0)) return;
      const ax = sx, ay = sy, d = sz;
      if (!project(x1, 0, z1)) return;
      const band = Math.min(3, Math.floor(Math.min(d, sz) / 9));
      bands[band].moveTo(ax, ay);
      bands[band].lineTo(sx, sy);
    };
    for (let z = 0; z <= ROWS; z++) for (let x = 0; x < COLS; x++) edge(x, z, x + 1, z);
    for (let x = 0; x <= COLS; x++) for (let z = 0; z < ROWS; z++) edge(x, z, x, z + 1);
    bands.forEach((path, i) => { g.strokeStyle = `rgba(61,220,151,${[0.5, 0.32, 0.18, 0.08][i] * (1 + 0.5 * beatFlash)})`; g.stroke(path); });
    for (let z = 0; z <= ROWS; z++) for (let x = 0; x <= COLS; x++) {
      const d = Math.hypot(x - hx, z - hz);
      const wave = beatFlash * Math.exp(-(((d - ripple) / 1.3) ** 2));
      grain(x, 0, z, 0.06 + 0.06 * wave, 130 + 110 * wave, 230, 180 + 60 * wave, 0.45 + 0.55 * wave);
    }

    // Where you can turn: the squares to your left, right and ahead of the square you're heading into light up,
    // green where you can go, red where you'd crash. A turn you've lined up lights its square brightly.
    if (state === 'playing' || state === 'ready') {
      const heading = queue.length ? queue[queue.length - 1] : dir, c = snake[0];
      const tile = (x: number, z: number, fill: string, line: string | null) => {
        const q: number[] = [];
        for (const [ox, oz] of [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]]) { if (!project(x + ox, 0.01, z + oz)) return; q.push(sx, sy); }
        g.beginPath();
        g.moveTo(q[0], q[1]); g.lineTo(q[2], q[3]); g.lineTo(q[4], q[5]); g.lineTo(q[6], q[7]);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        if (line) { g.strokeStyle = line; g.lineWidth = 2; g.stroke(); }
      };
      const blocked = (x: number, z: number) => x < 0 || z < 0 || x >= COLS || z >= ROWS || at(snake.slice(0, grow > 0 ? snake.length : -1), x, z) >= 0;
      const turned = queue.length > 0 ? queue[0] : -1;
      for (const [d, side] of [[(heading + 3) % 4, 1], [(heading + 1) % 4, 1], [heading, 0]] as [number, number][]) {
        const x = c.x + DX[d], z = c.y + DY[d], bad = blocked(x, z);
        if (bad && (x < 0 || z < 0 || x >= COLS || z >= ROWS)) continue; // (the wall shows itself)
        const chosen = d === turned;
        if (bad) tile(x, z, 'rgba(255,77,46,0.42)', 'rgba(255,77,46,0.85)');
        else if (chosen) tile(x, z, 'rgba(61,220,151,0.6)', 'rgba(182,255,224,1)');
        else tile(x, z, `rgba(61,220,151,${side ? 0.3 : 0.12})`, side ? 'rgba(61,220,151,0.65)' : null);
      }
    }

    // The walls: glowing fences of dots, so you see them coming.
    const wa = 0.55 + 0.35 * beatFlash;
    for (let t = 0; t <= COLS; t += 0.5) {
      for (const hy of [0.15, 0.45, 0.75, 1.05, 1.35]) {
        grain(t, hy, 0, 0.07, 61, 220, 151, wa);
        grain(t, hy, ROWS, 0.07, 61, 220, 151, wa);
        grain(0, hy, t, 0.07, 61, 220, 151, wa);
        grain(COLS, hy, t, 0.07, 61, 220, 151, wa);
      }
    }

    // The inside of a just-closed loop lights up on the floor.
    if (lassoT > 0) {
      g.fillStyle = `rgba(182,255,224,${0.3 * (lassoT / 0.7)})`;
      for (const c of lassoCells) {
        const q: number[] = [];
        for (const [ox, oz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { if (!project(c.x + ox, 0.01, c.y + oz)) break; q.push(sx, sy); }
        if (q.length < 8) continue;
        g.beginPath();
        g.moveTo(q[0], q[1]); g.lineTo(q[2], q[3]); g.lineTo(q[4], q[5]); g.lineTo(q[6], q[7]);
        g.closePath();
        g.fill();
      }
    }

    // Contact shadows: a dark patch on the floor under each body segment and each pellet, so they sit on the floor.
    g.globalCompositeOperation = 'source-over';
    {
      const shadow = (x: number, z: number, r: number) => {
        const q: number[] = [];
        for (let k = 0; k < 10; k++) { const an = (k / 10) * Math.PI * 2; if (!project(x + Math.cos(an) * r, 0.005, z + Math.sin(an) * r)) return; q.push(sx, sy); }
        g.beginPath();
        g.moveTo(q[0], q[1]);
        for (let k = 2; k < q.length; k += 2) g.lineTo(q[k], q[k + 1]);
        g.closePath();
        g.fill();
      };
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < snake.length; i++) {
        const a = prev[i] ?? snake[i], b = snake[i];
        shadow(a.x + (b.x - a.x) * p + 0.5, a.y + (b.y - a.y) * p + 0.5, 0.42);
      }
      for (const f of pellets) shadow(f.x + 0.5, f.y + 0.5, 0.3);
    }
    g.globalCompositeOperation = 'lighter';

    // Pellets: glowing pink orbs bobbing above the floor, swelling on the kick.
    for (const f of pellets) {
      if (!project(f.x + 0.5, 0.42 + 0.06 * Math.sin(time * 3 + f.x), f.y + 0.5)) continue;
      const r = (0.32 * FOCAL * (1 + 0.25 * beatFlash)) / sz, fa = fog(sz);
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
      grad.addColorStop(0, `rgba(255,220,240,${fa})`);
      grad.addColorStop(0.25, `rgba(255,95,162,${0.9 * fa})`);
      grad.addColorStop(1, 'rgba(255,95,162,0)');
      g.fillStyle = grad;
      g.fillRect(sx - r * 2.2, sy - r * 2.2, r * 4.4, r * 4.4);
      grain(f.x + 0.5, 0.01, f.y + 0.5, 0.5, 255, 95, 162, 0.12); // its glow on the floor
    }

    // Gold core: a spinning diamond, blinking as its time runs out.
    if (bonus) {
      const left = bonus.ticks / BONUS_TICKS;
      if (!(left < 0.3 && Math.sin(time * 20) < 0)) {
        const bx = bonus.x + 0.5, bz = bonus.y + 0.5, spin = time * 2.5;
        const pts: number[] = [];
        const add = (x: number, y: number, z: number) => { if (project(x, y, z)) pts.push(sx, sy); };
        add(bx, 0.85, bz);
        for (let k = 0; k < 4; k++) add(bx + Math.cos(spin + (k * Math.PI) / 2) * 0.3, 0.5, bz + Math.sin(spin + (k * Math.PI) / 2) * 0.3);
        add(bx, 0.15, bz);
        if (pts.length === 12) {
          g.fillStyle = 'rgba(255,209,102,0.55)';
          for (const [i1, i2] of [[1, 3], [2, 4]]) {
            g.beginPath();
            g.moveTo(pts[0], pts[1]); g.lineTo(pts[i1 * 2], pts[i1 * 2 + 1]); g.lineTo(pts[10], pts[11]); g.lineTo(pts[i2 * 2], pts[i2 * 2 + 1]);
            g.closePath();
            g.fill();
          }
        }
        grain(bx, 0.01, bz, 0.6, 255, 209, 102, 0.15);
      }
    }

    // The snake: each segment a little cluster of neon sand, sliding between cells. After a lasso, a bright
    // current runs from head to tail; at x4 it glows gold.
    const flash = state === 'dying' && Math.sin(time * 40) > 0;
    const runAt = currentT > 0 ? (1 - currentT / 0.5) * snake.length : -99;
    const hot = m >= MAX_MULT ? [255, 209, 102] : [61, 220, 151];
    // The body's spine: the middle of each segment, sliding between cells, with a smooth curve through them
    // (so corners bend instead of snapping) and an extra point ahead of the head for its snout.
    const n = snake.length;
    const spX: number[] = [], spZ: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = prev[i] ?? snake[i], b = snake[i];
      spX.push(a.x + (b.x - a.x) * p + 0.5);
      spZ.push(a.y + (b.y - a.y) * p + 0.5);
    }
    const along = (t: number, out: number[]) => {
      const i = Math.min(n - 1, Math.max(0, Math.floor(t))), u = Math.min(1, t - i);
      const i0 = Math.max(0, i - 1), i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2);
      // Catmull-Rom through the segment middles.
      const cr = (q0: number, q1: number, q2: number, q3: number) =>
        0.5 * (2 * q1 + (q2 - q0) * u + (2 * q0 - 5 * q1 + 4 * q2 - q3) * u * u + (3 * q1 - q0 - 3 * q2 + q3) * u * u * u);
      out[0] = cr(spX[i0], spX[i], spX[i2], spX[i3]);
      out[1] = cr(spZ[i0], spZ[i], spZ[i2], spZ[i3]);
    };
    // How thick the body is along its length: a rounded head, a little neck, then tapering to a fine tail.
    const thick = (t: number) => {
      const f = t / Math.max(1, n - 1);
      return (t < 0.6 ? 0.3 + 0.08 * Math.sin((t / 0.6) * Math.PI * 0.5 + Math.PI * 0.5) : 0.3) * (f > 0.55 ? 1 - 0.7 * ((f - 0.55) / 0.45) ** 1.4 : 1);
    };
    // Dying: the body crumbles, its sand spilling out and falling to the floor.
    const crumble = state === 'dying' || state === 'done' ? Math.min(1, 1 - deathTimer / 0.7) : 0;
    const P = [0, 0], Q = [0, 0];
    for (let i = n - 1; i >= 0; i--) {
      const zap = Math.max(0, 1 - Math.abs(i - runAt) / 3);
      const k = 1 - i / Math.max(1, n);
      let r = hot[0], gg = hot[1], bb = hot[2], al = 0.55 + 0.45 * k;
      if (i === 0) { r = 182; gg = 255; bb = 224; al = 1; }
      if (zap > 0) { r = 255; gg = 255; bb = 255; al = 0.7 + 0.3 * zap; }
      if (flash) { r = 255; gg = 77; bb = 46; al = 1; }
      // Two shades of sand per segment: the neon colour, and a warm sand colour mixed into it.
      const neon = dot(r, gg, bb), warm = dot((r + 2 * 236) / 3, (gg + 2 * 206) / 3, (bb + 2 * 160) / 3);
      // Fewer, slightly bigger grains far away (they blur together there anyway).
      along(i, P);
      if (!project(P[0], 0.3, P[1])) continue;
      const near = sz;
      // A soft glow inside the segment gives the sand a body to sit in (like the haze around the dancer).
      if (crumble === 0) {
        const gr2 = (0.5 * FOCAL) / sz, ga = 0.2 * al * fog(sz);
        const grad = g.createRadialGradient(sx, sy, 0, sx, sy, gr2);
        grad.addColorStop(0, `rgba(${r},${gg},${bb},${ga})`);
        grad.addColorStop(1, `rgba(${r},${gg},${bb},0)`);
        g.globalAlpha = 1;
        g.fillStyle = grad;
        g.fillRect(sx - gr2, sy - gr2, gr2 * 2, gr2 * 2);
      }
      const count = near < 9 ? BODY_GRAINS : near < 18 ? 70 : 36, size = near < 9 ? 0.045 : near < 18 ? 0.055 : 0.07;
      for (let j = 0; j < count; j++) {
        const gr = BODY[(i * BODY_GRAINS + j) & 4095];
        // The head segment reaches forward to a snout; the others run back to the next segment.
        const t = i === 0 ? gr.along - 0.6 : i + gr.along;
        if (t < 0) {
          const ext = -t; // ahead of the head, along its heading
          P[0] = spX[0] + DX[dir] * ext * (1 - p) + (spX[0] - (spX[1] ?? spX[0])) * ext * p;
          P[1] = spZ[0] + DY[dir] * ext * (1 - p) + (spZ[0] - (spZ[1] ?? spZ[0])) * ext * p;
        } else along(Math.min(n - 1, t), P);
        along(Math.min(n - 1, Math.max(0, t) + 0.05), Q);
        let tx = P[0] - Q[0], tz = P[1] - Q[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const R = thick(Math.max(0, t)) * (t < 0 ? Math.cos((-t / 0.6) * Math.PI * 0.5) * 0.9 + 0.1 : 1);
        const cs = Math.cos(gr.ang), sn = Math.sin(gr.ang), rad = R * gr.depth;
        let gx = P[0] - tz * cs * rad, gy = R + sn * rad, gz = P[1] + tx * cs * rad;
        // The grains breathe a little with the kick.
        gy += 0.03 * beatFlash * sn;
        if (crumble > 0) {
          // Spill outward and fall.
          gx += -tz * cs * crumble * 0.9 * gr.depth;
          gz += tx * cs * crumble * 0.9 * gr.depth;
          gy = Math.max(0.02, gy - crumble * crumble * 1.4 * (0.6 + gr.depth));
        }
        // Lit from above, and each grain twinkles now and then.
        const lit = 0.35 + 0.65 * (0.5 + 0.5 * sn), tw = 0.75 + 0.25 * Math.sin(time * 5 + gr.tw);
        sandDot(gx, gy, gz, size * (0.8 + 0.5 * gr.sand), gr.sand < 0.45 ? warm : neon, al * lit * tw * (1 - 0.6 * crumble));
      }
    }
    // Eyes on the head, looking where it's going.
    if (crumble === 0) {
      const eye = dot(255, 255, 255);
      const fx2 = DX[dir], fz2 = DY[dir];
      for (const sgn of [-1, 1]) sandDot(hx + fx2 * 0.22 - fz2 * 0.16 * sgn, 0.55, hz + fz2 * 0.22 + fx2 * 0.16 * sgn, 0.07, eye, 1);
    }
    // Loose sand blowing off the body as it slides, drifting back and settling on the floor.
    {
      const now = time, dt = Math.min(0.05, Math.max(0, now - lastRender));
      lastRender = now;
      if (state === 'playing' && dt > 0) {
        for (let s2 = 0; s2 < 3; s2++) {
          along(Math.random() * (n - 1), P);
          const R = thick(0) * 0.8, an = Math.random() * Math.PI;
          dust.push({
            x: P[0] + Math.cos(an) * R * (Math.random() - 0.5) * 2, y: 0.1 + Math.random() * 0.5, z: P[1] + Math.sin(an) * R * (Math.random() - 0.5) * 2,
            vx: (Math.random() - 0.5) * 0.6, vy: 0.3 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.6,
            t: 0.6 + Math.random() * 0.6, img: Math.random() < 0.5 ? dot(hot[0], hot[1], hot[2]) : dot(236, 206, 160),
          });
        }
      }
      for (const d of dust) {
        d.t -= dt; d.vy -= 2.2 * dt;
        d.x += d.vx * dt; d.y = Math.max(0.01, d.y + d.vy * dt); d.z += d.vz * dt;
        sandDot(d.x, d.y, d.z, 0.03, d.img, Math.min(1, d.t * 1.5) * 0.7);
      }
      dust = dust.filter((d) => d.t > 0);
      if (dust.length > 400) dust = dust.slice(-400);
    }
    g.globalAlpha = 1;
    // A soft glow around the head.
    if (project(hx, 0.4, hz)) {
      const r = (0.6 * FOCAL) / sz;
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, `rgba(${m >= MAX_MULT ? '255,209,102' : '61,220,151'},${0.35 + 0.25 * beatFlash})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
    }

    // The beat ring: a circle on the floor closing in on the head, landing on the kick.
    if (state === 'playing') {
      const { next } = beatTiming(), f = Math.min(1, (next - alpha) / (interval() * STEPS_PER_BEAT));
      const rad = 0.55 + 1.8 * f;
      g.strokeStyle = `rgba(182,255,224,${0.15 + 0.55 * (1 - f)})`;
      g.lineWidth = 1.5;
      g.beginPath();
      let ok = true;
      for (let k = 0; k <= 28 && ok; k++) {
        const an = (k / 28) * Math.PI * 2;
        ok = project(hx + Math.cos(an) * rad, 0.02, hz + Math.sin(an) * rad);
        if (k === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      if (ok) g.stroke();
    }

    // Sparks.
    for (const k of sparks) {
      const [r, gg, b] = k.color === GOLD ? [255, 209, 102] : [255, 95, 162];
      grain(k.x, k.y, k.z, 0.08, r, gg, b, Math.min(1, k.t * 2));
    }

    g.globalCompositeOperation = 'source-over';
    // Pop-ups, floating up from where they happened.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const q of popups) {
      if (!project(q.x, q.y, q.z)) continue;
      g.globalAlpha = Math.min(1, q.t * 2.5);
      g.fillStyle = q.color;
      g.font = q.big ? '700 18px "JetBrains Mono", monospace' : '600 12px "JetBrains Mono", monospace';
      g.fillText(q.text, Math.min(W - 80, Math.max(80, sx)), Math.max(14, sy));
    }
    g.globalAlpha = 1;

    // The multiplier and combo, top left.
    if (started && state !== 'ready' && (m > 1 || combo > 0)) {
      g.textAlign = 'left';
      g.fillStyle = m >= MAX_MULT ? GOLD : '#b6ffe0';
      g.font = '700 20px "JetBrains Mono", monospace';
      g.fillText(`×${m}`, 14, 22);
      g.fillStyle = 'rgba(182,255,224,0.6)';
      g.font = '500 11px "JetBrains Mono", monospace';
      g.fillText(`${combo} ON BEAT`, 14, 42);
    }

    // The map, top right: the whole board from above, for lining up loops.
    const MM = 104, mx = W - MM - 10, my = 10, mc = MM / COLS;
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.fillRect(mx, my, MM, MM);
    g.strokeStyle = `rgba(61,220,151,${0.35 + 0.4 * beatFlash})`;
    g.lineWidth = 1;
    g.strokeRect(mx + 0.5, my + 0.5, MM - 1, MM - 1);
    if (lassoT > 0) {
      g.fillStyle = `rgba(182,255,224,${0.5 * (lassoT / 0.7)})`;
      for (const c of lassoCells) g.fillRect(mx + c.x * mc, my + c.y * mc, mc, mc);
    }
    g.fillStyle = FOOD;
    for (const f of pellets) g.fillRect(mx + f.x * mc + 0.5, my + f.y * mc + 0.5, mc - 1, mc - 1);
    if (bonus) { g.fillStyle = GOLD; g.fillRect(mx + bonus.x * mc, my + bonus.y * mc, mc, mc); }
    g.fillStyle = flash ? '#ff4d2e' : m >= MAX_MULT ? 'rgba(255,209,102,0.85)' : 'rgba(61,220,151,0.85)';
    for (let i = 1; i < snake.length; i++) g.fillRect(mx + snake[i].x * mc, my + snake[i].y * mc, mc, mc);
    g.fillStyle = '#fff';
    g.fillRect(mx + snake[0].x * mc - 0.5, my + snake[0].y * mc - 0.5, mc + 1, mc + 1);

    if (state === 'ready' && started) {
      g.textAlign = 'center';
      g.fillStyle = Math.sin(time * 6) > -0.3 ? '#ededed' : '#555';
      g.font = '500 14px "JetBrains Mono", monospace';
      g.fillText('↑ TO GO  ·  ← → TO STEER', W / 2, H * 0.3);
      g.fillStyle = '#8a8a8a';
      g.font = '500 12px "JetBrains Mono", monospace';
      g.fillText('TURN ON THE KICK · LOOP AROUND PELLETS', W / 2, H * 0.3 + 24);
    }
  };

  const loop = createLoop(step, render, TICKS_PER_SECOND);

  reset();
  render(1);
  queueMicrotask(() => {
    if (!destroyed) callbacks.onReady();
  });

  return {
    id: 'coil',
    rulesVersion: RULES,
    start() {
      if (destroyed) return;
      reset();
      started = true;
      loop.start();
    },
    restart() {
      if (destroyed) return;
      loop.stop();
      reset();
      started = true;
      loop.start();
    },
    pause() {
      loop.stop();
    },
    resume() {
      if (!destroyed && started && state !== 'done') loop.start();
    },
    input(action, pressed) {
      if (!pressed || !loop.running) return;
      const d = DIR_FOR[action];
      if (d === undefined) return;
      // Steering is relative, like driving: left and right turn a quarter from the way you're heading (after any
      // turns already queued). Up goes straight on; it starts the run.
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (state === 'ready') {
        // The first move starts the music on a kick.
        if (d === 2) return;
        state = 'playing';
        sinceStep = interval() - 1;
        if (d === 1 || d === 3) { const nd = (dir + (d === 1 ? 1 : 3)) % 4; queue.push(nd); inputs.push(playTicks, nd); }
        else inputs.push(playTicks, dir);
        return;
      }
      if (state !== 'playing' || (d !== 1 && d !== 3) || queue.length >= MAX_QUEUED_TURNS) return;
      const nd = (last + (d === 1 ? 1 : 3)) % 4;
      queue.push(nd);
      inputs.push(playTicks, nd);
      // Pressed a hair late, just after going straight into a cell? Then turn at that cell after all.
      if (undo && queue.length === 1 && sinceStep < Math.min(LATE_GRACE, Math.floor(interval() / 3))) {
        const u = undo;
        undo = null;
        dir = u.dir; snake = u.snake; prev = u.prev; pellets = u.pellets; bonus = u.bonus;
        eaten = u.eaten; grow = u.grow; score = u.score; captures = u.captures; bestLasso = u.bestLasso;
        advance();
        callbacks.onScore(score);
      }
      // On the beat? Close enough to the last kick or the next one builds the combo; otherwise it breaks.
      const { next, since } = beatTiming();
      const head = snake[0];
      if (Math.min(next, since) <= BEAT_WINDOW) {
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        if (combo % COMBO_PER_LEVEL === 0 && mult() > 1) pop(`×${mult()}`, head, mult() >= MAX_MULT ? GOLD : '#b6ffe0', true);
        else pop('ON BEAT', head, '#b6ffe0');
      } else {
        if (combo >= COMBO_PER_LEVEL) pop('OFF BEAT', head, '#ff4d2e');
        combo = 0;
      }
    },
    destroy() {
      destroyed = true;
      loop.stop();
      snake = [];
    },
  };
}
