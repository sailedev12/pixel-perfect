import { createLoop } from '../loop';
import { mulberry32, randomSeed } from '../rng';
import type { ArcadeGame, GameContext, GameResult } from '../types';

// Rules version 1. Changing any number in this block changes how scores compare,
// so bump `rulesVersion` in the registry when you do.
const W = 360;
const H = 640;
const GROUND = 560;
const BIRD_X = 96;
const R = 11;
const GRAVITY = 1500; // px/s²
const FLAP = -430; // px/s
const MAX_FALL = 620; // px/s
const SPEED = 140; // px/s
const PILLAR_W = 62;
const GAP = 158;
const SPACING = 214;
const GAP_MIN = 130;
const GAP_MAX = GROUND - 130;

const COLOR = '#ffb020';
const TICKS_PER_SECOND = 60;

// Temporary pixel-art flyer, 8 x 7 cells.
const SPRITE = ['..bbbb..', '.bbbbeb.', 'bbbbbepk', 'wwwbbbkk', 'bwwwbbb.', '.bbbbbb.', '..bbbb..'];
const SPRITE_COLORS: Record<string, string> = { b: COLOR, e: '#ffffff', p: '#000000', k: '#ff4d2e', w: '#ffd98a' };
const CELL = 3;

type State = 'ready' | 'playing' | 'dying' | 'done';
interface Pillar {
  x: number;
  prevX: number;
  gapY: number;
  scored: boolean;
}

export function createUpdraft({ canvas, sfx, callbacks }: GameContext): ArcadeGame {
  const g = canvas.getContext('2d')!;
  const scale = canvas.width / W;

  let state: State = 'ready';
  let started = false;
  let destroyed = false;
  let y = 300;
  let prevY = 300;
  let vy = 0;
  let pillars: Pillar[] = [];
  let score = 0;
  let playTicks = 0;
  let time = 0;
  let scroll = 0;
  let prevScroll = 0;
  let deathTimer = 0;
  let flash = 0;
  let seed = 0;
  let rand = Math.random;
  let inputs: number[] = [];

  const spawnPillar = (x: number): Pillar => ({ x, prevX: x, gapY: GAP_MIN + rand() * (GAP_MAX - GAP_MIN), scored: false });

  const reset = () => {
    seed = randomSeed();
    rand = mulberry32(seed);
    state = 'ready';
    y = prevY = 300;
    vy = 0;
    score = 0;
    playTicks = 0;
    deathTimer = 0;
    flash = 0;
    inputs = [];
    pillars = [];
    for (let i = 0; i < 3; i++) pillars.push(spawnPillar(W + 120 + i * SPACING));
    callbacks.onScore(0);
  };

  const flap = () => {
    vy = FLAP;
    inputs.push(playTicks);
    sfx.tone(480, 90, 'square', 0.035, 720);
  };

  const die = () => {
    state = 'dying';
    vy = Math.min(vy, -160);
    deathTimer = 0.45;
    flash = 0.12;
    sfx.tone(180, 260, 'sawtooth', 0.07, 60);
  };

  const finish = () => {
    state = 'done';
    loop.stop();
    render(1);
    sfx.tone(330, 220, 'triangle', 0.07, 110, 120);
    const result: GameResult = {
      gameId: 'updraft',
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

  const hitsRect = (rx: number, ry: number, rw: number, rh: number) => {
    const cx = Math.max(rx, Math.min(BIRD_X, rx + rw));
    const cy = Math.max(ry, Math.min(y, ry + rh));
    const dx = BIRD_X - cx;
    const dy = y - cy;
    return dx * dx + dy * dy < R * R;
  };

  const step = (dtMs: number) => {
    const s = dtMs / 1000;
    time += s;
    prevY = y;
    prevScroll = scroll;
    for (const p of pillars) p.prevX = p.x;
    flash = Math.max(0, flash - s);

    if (state === 'ready') {
      y = 300 + Math.sin(time * 5) * 6;
      scroll += SPEED * s;
      return;
    }

    if (state === 'playing') {
      playTicks++;
      scroll += SPEED * s;
      vy = Math.min(vy + GRAVITY * s, MAX_FALL);
      y += vy * s;
      if (y < R) {
        y = R;
        vy = 0;
      }
      for (const p of pillars) p.x -= SPEED * s;
      if (pillars[0].x + PILLAR_W < -10) {
        pillars.shift();
        pillars.push(spawnPillar(pillars[pillars.length - 1].x + SPACING));
      }
      for (const p of pillars) {
        if (!p.scored && p.x + PILLAR_W < BIRD_X - R) {
          p.scored = true;
          score++;
          callbacks.onScore(score);
          sfx.tone(880, 70, 'square', 0.04);
          sfx.tone(1320, 90, 'square', 0.04, undefined, 70);
        }
      }
      if (y + R >= GROUND) {
        y = GROUND - R;
        die();
        return;
      }
      for (const p of pillars) {
        const top = p.gapY - GAP / 2;
        const bottom = p.gapY + GAP / 2;
        if (hitsRect(p.x, -100, PILLAR_W, top + 100) || hitsRect(p.x, bottom, PILLAR_W, GROUND - bottom)) {
          die();
          return;
        }
      }
      return;
    }

    if (state === 'dying') {
      vy = Math.min(vy + GRAVITY * s, MAX_FALL);
      y = Math.min(y + vy * s, GROUND - R);
      deathTimer -= s;
      if (deathTimer <= 0 && (y >= GROUND - R - 0.5 || deathTimer < -2)) finish();
    }
  };

  const drawPillar = (x: number, top: number, bottom: number) => {
    for (const [ry, rh] of [
      [0, top],
      [bottom, GROUND - bottom],
    ]) {
      g.fillStyle = '#0d0904';
      g.fillRect(x, ry, PILLAR_W, rh);
      g.fillStyle = 'rgba(255,176,32,0.32)';
      for (let dy = ry + 5; dy < ry + rh - 2; dy += 8) for (let dx = x + 5; dx < x + PILLAR_W - 2; dx += 8) g.fillRect(dx, dy, 1.5, 1.5);
      g.strokeStyle = COLOR;
      g.lineWidth = 2;
      g.strokeRect(x + 1, ry - 1, PILLAR_W - 2, rh + 2);
    }
    // Lips at the gap edges.
    g.fillStyle = COLOR;
    g.fillRect(x - 4, top - 10, PILLAR_W + 8, 10);
    g.fillRect(x - 4, bottom, PILLAR_W + 8, 10);
  };

  const render = (alpha: number) => {
    if (destroyed) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    const sc = prevScroll + (scroll - prevScroll) * alpha;

    // Background dot grid, drifting at half speed.
    g.fillStyle = '#1b1b1b';
    const bg = (sc * 0.5) % 24;
    for (let gx = -bg; gx < W; gx += 24) for (let gy = 12; gy < GROUND; gy += 24) g.fillRect(gx, gy, 1.5, 1.5);

    for (const p of pillars) {
      const x = p.prevX + (p.x - p.prevX) * alpha;
      if (x > W + 10 || x + PILLAR_W < -10) continue;
      drawPillar(x, p.gapY - GAP / 2, p.gapY + GAP / 2);
    }

    // Ground.
    g.fillStyle = '#060606';
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = COLOR;
    g.fillRect(0, GROUND, W, 2);
    g.fillStyle = '#3a2a0a';
    const gr = sc % 24;
    for (let gx = -gr; gx < W; gx += 24) g.fillRect(gx, GROUND + 14, 12, 3);

    // Flyer.
    const by = prevY + (y - prevY) * alpha;
    const tilt = state === 'ready' ? 0 : Math.max(-0.45, Math.min(1.2, vy / 520));
    g.save();
    g.translate(BIRD_X, by);
    g.rotate(tilt);
    g.shadowColor = COLOR;
    g.shadowBlur = 14;
    for (let r = 0; r < SPRITE.length; r++) {
      for (let c = 0; c < SPRITE[r].length; c++) {
        const ch = SPRITE[r][c];
        if (ch === '.') continue;
        g.fillStyle = SPRITE_COLORS[ch];
        g.fillRect(-12 + c * CELL, -10.5 + r * CELL, CELL, CELL);
      }
    }
    g.restore();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (state === 'ready') {
      if (!started) return;
      g.fillStyle = Math.sin(time * 6) > -0.3 ? '#ededed' : '#555';
      g.font = '500 14px "JetBrains Mono", monospace';
      g.fillText('TAP · CLICK · SPACE TO FLAP', W / 2, 380);
    } else {
      g.fillStyle = '#ffffff';
      g.font = '700 48px "JetBrains Mono", monospace';
      g.fillText(String(score), W / 2, 80);
    }

    if (flash > 0) {
      g.fillStyle = `rgba(255,255,255,${(flash / 0.12) * 0.6})`;
      g.fillRect(0, 0, W, H);
    }
  };

  const loop = createLoop(step, render, TICKS_PER_SECOND);

  reset();
  render(1);
  queueMicrotask(() => {
    if (!destroyed) callbacks.onReady();
  });

  return {
    id: 'updraft',
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
      if (!pressed || action !== 'primary' || !loop.running) return;
      if (state === 'ready') state = 'playing';
      if (state === 'playing') flap();
    },
    destroy() {
      destroyed = true;
      loop.stop();
      pillars = [];
    },
  };
}
