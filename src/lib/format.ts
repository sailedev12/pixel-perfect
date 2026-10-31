import type { GameDefinition } from '../games/types';

export const formatNumber = (n: number) => n.toLocaleString('en-US');

/** A race time in milliseconds as m:ss.mmm (e.g. 1:32.450). */
export function formatRaceTime(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const rest = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
}

/** A score the way its game wants it shown. */
export function formatScoreFor(def: GameDefinition, score: number) {
  return def.formatScore ? def.formatScore(score) : formatNumber(score);
}
