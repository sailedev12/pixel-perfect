import type { Sfx } from './audio';

export type GameId = 'updraft' | 'coil' | 'neon-maze' | 'starfall' | 'hexgl';

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
  /**
   * False when the run ended without a valid score (for example, crashing out of a race before the finish).
   * Such runs never count as a personal best. Missing means true.
   */
  completed?: boolean;
  /** Game-specific extras, such as lap times. */
  details?: Record<string, unknown>;
}

export interface GameCallbacks {
  onReady(): void;
  onScore(score: number): void;
  onGameOver(result: GameResult): void;
}

export interface GameContext {
  /** Already sized by the player: width = definition width x pixel scale. Its parent is the stage. */
  canvas: HTMLCanvasElement;
  /** Whether sound starts muted. */
  muted: boolean;
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
  /** Optional: the player calls this when its sound button changes (games using Sfx are muted through it instead). */
  setMuted?(muted: boolean): void;
  /** Optional: move keyboard focus into the game (games that run in their own frame). */
  focus?(): void;
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
  /**
   * 'tap' = the whole stage is the button; 'dpad' adds arrow buttons; 'dpad+fire' adds a fire button too;
   * 'own' = the game handles keyboard and touch itself (ported games running in their own frame).
   */
  mobileControls: 'tap' | 'dpad' | 'dpad+fire' | 'own';
  /** Keys that drive each action while the stage has focus. */
  keys: Partial<Record<GameAction, string[]>>;
  instructions: string[];
  controls: [string, string][];
  scoreUnit: string;
  /** True for games scored by time, where a smaller number is better. */
  lowerIsBetter?: boolean;
  /** How to show a score; defaults to a number with thousands separators. */
  formatScore?(score: number): string;
  /** For games made by someone else: who, under which license, and where the source is. */
  credits?: GameCredits;
  load(): Promise<GameFactory>;
}

export interface GameCredits {
  author: string;
  authorUrl?: string;
  license: string;
  licenseUrl: string;
  /** The original source code. */
  sourceUrl: string;
  /** Our copy, including what we changed. */
  ourCopyUrl?: string;
  notes: string[];
}
