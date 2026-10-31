import type { GameId, GameResult } from '../games/types';

// Personal bests live in this browser only. They are a convenience, not a ranking:
// anyone can edit localStorage. Shared rankings need the server (see docs/score-verification.md).

const bestKey = (id: GameId, rulesVersion: number) => `pp:best:${id}:v${rulesVersion}`;

export function getBest(id: GameId, rulesVersion: number): number {
  try {
    const n = Number(localStorage.getItem(bestKey(id, rulesVersion)) ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Saves the run if it beats the personal best. 0 means "no best yet".
 * `lowerIsBetter` is for games scored by time. Runs that didn't finish (`completed: false`) never count.
 */
export function recordResult(result: GameResult, lowerIsBetter = false) {
  const prev = getBest(result.gameId, result.rulesVersion);
  if (result.completed === false || result.score <= 0) return { best: prev, isNewBest: false, counted: false };
  const isNewBest = prev === 0 || (lowerIsBetter ? result.score < prev : result.score > prev);
  if (isNewBest) {
    try {
      localStorage.setItem(bestKey(result.gameId, result.rulesVersion), String(result.score));
    } catch {
      // Private mode or storage blocked: the best just isn't remembered.
    }
  }
  return { best: isNewBest ? result.score : prev, isNewBest, counted: true };
}

export function getMuted(): boolean {
  try {
    return localStorage.getItem('pp:muted') === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem('pp:muted', muted ? '1' : '0');
  } catch {
    // Ignore: mute still works for this visit.
  }
}
