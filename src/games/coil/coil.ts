import { createLoop } from '../loop';
import { mulberry32, randomSeed } from '../rng';
import type { ArcadeGame, GameAction, GameContext, GameResult } from '../types';

// Rules version 1. Changing any number in this block changes how scores compare,
// so bump `rulesVersion` in the registry when you do.
const COLS = 24;
const ROWS = 24;
const CELL = 20;
const W = COLS * CELL;
const H = ROWS * CELL;
const START_LEN = 4;
const SLOWEST = 9; // ticks per step at the start (about 6.7 steps a second)
const FASTEST = 4; // ticks per step at top speed (15 a second)
const SPEED_UP_EVERY = 4; // pellets eaten per speed-up
const PELLET_POINTS = 10;
const BONUS_POINTS = 50;
const BONUS_EVERY = 5; // a bonus core appears after every 5th pellet
const BONUS_TICKS = 300; // and lasts 5 seconds
const MAX_QUEUED_TURNS = 2;

const COLOR = '#3ddc97';
const FOOD = '#ff5fa2';
const GOLD = '#ffd166';
const TICKS_PER_SECOND = 60;

// Directions: 0 up, 1 right, 2 down, 3 left.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIR_FOR: Partial<Record<GameAction, number>> = { up: 0, right: 1, down: 2, left: 3 };

type State = 'ready' | 'playing' | 'dying' | 'done';
interface Cell {
  x: number;
  y: number;
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
  let food: Cell = { x: 0, y: 0 };
  let bonus: (Cell & { ticks: number }) | null = null;
  let pellets = 0;
  let score = 0;
  let playTicks = 0;
  let sinceStep = 0;
  let time = 0;
  let deathTimer = 0;
  let seed = 0;
  let rand = Math.random;
  let inputs: number[] = [];

  const interval = () => Math.max(FASTEST, SLOWEST - Math.floor(pellets / SPEED_UP_EVERY));
  const occupied = (x: number, y: number) =>
    snake.some((s) => s.x === x && s.y === y) || (food.x === x && food.y === y) || (!!bonus && bonus.x === x && bonus.y === y);

  /** A random empty cell. Uses the run's seed, so the layout can be rebuilt from it. */
  const freeCell = (): Cell => {
    for (let tries = 0; tries < 2000; tries++) {
      const x = Math.floor(rand() * COLS), y = Math.floor(rand() * ROWS);
      if (!occupied(x, y)) return { x, y };
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!occupied(x, y)) return { x, y };
    return { x: -1, y: -1 };
  };

  const reset = () => {
    seed = randomSeed();
    rand = mulberry32(seed);
    state = 'ready';
    dir = 1;
    queue = [];
    const cy = Math.floor(ROWS / 2), cx = Math.floor(COLS / 2);
    snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
    prev = snake.map((s) => ({ ...s }));
    food = { x: -1, y: -1 };
    bonus = null;
    food = freeCell();
    pellets = 0;
    score = 0;
    playTicks = 0;
    sinceStep = 0;
    deathTimer = 0;
    inputs = [];
    callbacks.onScore(0);
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
      rulesVersion: 1,
      score,
      durationMs: Math.round((playTicks * 1000) / TICKS_PER_SECOND),
      ticks: playTicks,
      seed,
      inputs: inputs.slice(),
      endedAt: new Date().toISOString(),
    };
    callbacks.onGameOver(result);
  };

  /** Moves the snake one cell. */
  const advance = () => {
    // Take the next queued turn, if any.
    while (queue.length) {
      const next = queue.shift()!;
      if (next !== dir && (next + 2) % 4 !== dir) {
        dir = next;
        break;
      }
    }
    const head = snake[0];
    const nx = head.x + DX[dir], ny = head.y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die();
    const eating = nx === food.x && ny === food.y;
    // The tail moves out of the way this step unless the snake is growing.
    const body = eating ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) return die();

    const before = score;
    prev = snake.map((s) => ({ ...s }));
    snake.unshift({ x: nx, y: ny });
    if (eating) {
      pellets++;
      score += PELLET_POINTS;
      sfx.tone(660, 70, 'square', 0.04, 990);
      food = freeCell();
      if (pellets % BONUS_EVERY === 0 && !bonus) {
        const c = freeCell();
        bonus = { ...c, ticks: BONUS_TICKS };
      }
    } else snake.pop();
    if (bonus && nx === bonus.x && ny === bonus.y) {
      score += BONUS_POINTS;
      bonus = null;
      sfx.tone(880, 80, 'square', 0.04);
      sfx.tone(1320, 80, 'square', 0.04, undefined, 70);
      sfx.tone(1760, 120, 'square', 0.035, undefined, 140);
    }
    if (score !== before) callbacks.onScore(score);
  };

  const step = (dtMs: number) => {
    const s = dtMs / 1000;
    time += s;
    if (state === 'playing') {
      playTicks++;
      if (bonus && --bonus.ticks <= 0) bonus = null;
      if (++sinceStep >= interval()) {
        sinceStep = 0;
        advance();
      }
    } else if (state === 'dying') {
      deathTimer -= s;
      if (deathTimer <= 0) finish();
    }
  };

  const render = (alpha: number) => {
    if (destroyed) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // Dot grid and border.
    g.fillStyle = '#161616';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) g.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
    g.strokeStyle = 'rgba(61,220,151,0.35)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, H - 2);

    // Score, big and faint behind the play area.
    if (started && state !== 'ready') {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.font = '700 120px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(score), W / 2, H / 2);
    }

    // Food: a pulsing pink pellet.
    const pulse = 1 + Math.sin(time * 6) * 0.12;
    g.save();
    g.shadowColor = FOOD;
    g.shadowBlur = 14;
    g.fillStyle = FOOD;
    const fs = (CELL - 8) * pulse;
    g.fillRect(food.x * CELL + (CELL - fs) / 2, food.y * CELL + (CELL - fs) / 2, fs, fs);
    g.restore();

    // Bonus core: a gold diamond with a ring that shrinks as time runs out.
    if (bonus) {
      const cx = bonus.x * CELL + CELL / 2, cy = bonus.y * CELL + CELL / 2;
      const left = bonus.ticks / BONUS_TICKS;
      g.save();
      g.globalAlpha = left < 0.3 && Math.sin(time * 20) < 0 ? 0.35 : 1;
      g.shadowColor = GOLD;
      g.shadowBlur = 16;
      g.fillStyle = GOLD;
      g.translate(cx, cy);
      g.rotate(Math.PI / 4 + time * 2);
      g.fillRect(-5, -5, 10, 10);
      g.restore();
      g.strokeStyle = 'rgba(255,209,102,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      g.stroke();
    }

    // Snake, sliding smoothly between cells.
    const p = state === 'playing' ? Math.min(1, (sinceStep + alpha) / interval()) : 1;
    const flash = state === 'dying' && Math.sin(time * 40) > 0;
    for (let i = snake.length - 1; i >= 0; i--) {
      const a = prev[i] ?? snake[i], b = snake[i];
      const x = (a.x + (b.x - a.x) * p) * CELL, y = (a.y + (b.y - a.y) * p) * CELL;
      const k = 1 - i / Math.max(1, snake.length);
      const pad = i === 0 ? 1 : 2.5;
      g.fillStyle = flash ? '#ff4d2e' : i === 0 ? '#b6ffe0' : `rgba(61,220,151,${0.45 + 0.55 * k})`;
      if (i === 0) {
        g.save();
        g.shadowColor = COLOR;
        g.shadowBlur = 16;
        g.fillRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2);
        g.restore();
        // Eyes, looking where it's going.
        g.fillStyle = '#000';
        const ex = DX[dir], ey = DY[dir];
        const cx = x + CELL / 2 + ex * 4, cy = y + CELL / 2 + ey * 4;
        g.fillRect(cx - ey * 4 - 1.5, cy - ex * 4 - 1.5, 3, 3);
        g.fillRect(cx + ey * 4 - 1.5, cy + ex * 4 - 1.5, 3, 3);
      } else g.fillRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2);
    }

    if (state === 'ready' && started) {
      g.fillStyle = Math.sin(time * 6) > -0.3 ? '#ededed' : '#555';
      g.font = '500 14px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ARROWS · WASD · SWIPE TO MOVE', W / 2, H / 2 + 70);
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
    rulesVersion: 1,
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
      if (state === 'ready') {
        // Can't start by reversing into your own body.
        if ((d + 2) % 4 === dir) return;
        state = 'playing';
        sinceStep = interval() - 1;
      }
      if (state !== 'playing') return;
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (d === last || (d + 2) % 4 === last || queue.length >= MAX_QUEUED_TURNS) return;
      queue.push(d);
      inputs.push(playTicks, d);
    },
    destroy() {
      destroyed = true;
      loop.stop();
      snake = [];
    },
  };
}
