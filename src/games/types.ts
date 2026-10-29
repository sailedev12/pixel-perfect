import type { Sfx } from './audio';

export type GameId = 'updraft' | 'coil' | 'neon-maze' | 'starfall';

/** Inputs the player screen forwards to a game, from keys, taps or the on-screen pad. */
export type GameAction = 'primary' | 'up' | 'down' | 'left' | 'right';

/** One finished run. gameId + rulesVersion keep scores from different games or rule sets apart. */
export interface GameResult {
  gameId: GameId;
  rulesVersion: number;
  score: number;
  /** Simulated play time, from the first input to the end of the run. */
  durationMs: number;
  /** Fixed-step updates the run took. */
  ticks: number;
  /** Seed for the run's random level layout. */
  seed: number;
  /** Tick numbers of each input, so a server could replay the run later. */
  inputs: number[];
  endedAt: string;
}

export interface GameCallbacks {
  onReady(): void;
  onScore(score: number): void;
  onGameOver(result: GameResult): void;
}

export interface GameContext {
  /** Already sized by the player: width = definition width x pixel scale. */
  canvas: HTMLCanvasElement;
  sfx: Sfx;
  callbacks: GameCallbacks;
}

/** The interface every game implements so the shared player screen can run it. */
export interface ArcadeGame {
  readonly id: GameId;
  readonly rulesVersion: number;
  /** Begin a fresh run (clean start, no continues). */
  start(): void;
  /** Throw away the current run and begin a fresh one. */
  restart(): void;
  pause(): void;
  resume(): void;
  input(action: GameAction, pressed: boolean): void;
  /** Stop the loop and drop references; the game can't be used afterwards. */
  destroy(): void;
}

export type GameFactory = (ctx: GameContext) => ArcadeGame;

export interface GameDefinition {
  id: GameId;
  name: string;
  blurb: string;
  color: string;
  rulesVersion: number;
  /** Internal resolution; the player keeps this aspect ratio. */
  width: number;
  height: number;
  available: boolean;
  /** 'tap' = the whole stage is the button; 'dpad' adds arrow buttons; 'dpad+fire' adds a fire button too. */
  mobileControls: 'tap' | 'dpad' | 'dpad+fire';
  /** Keys that drive each action while the stage has focus. */
  keys: Partial<Record<GameAction, string[]>>;
  instructions: string[];
  controls: [string, string][];
  scoreUnit: string;
  load(): Promise<GameFactory>;
}
