import type { GameId } from '../games/types';

// SAMPLE DATA. These players and scores are made up for the mockup.
// Every place that shows them must say so. Replace with the server leaderboard later.

export interface SampleEntry {
  player: string;
  score: number;
}

export const SAMPLE_LEADERBOARDS: Record<GameId, SampleEntry[]> = {
  updraft: [
    { player: 'vexa', score: 214 },
    { player: 'ardent', score: 198 },
    { player: 'kilo_byte', score: 176 },
    { player: 'pixelwitch', score: 161 },
    { player: 'm0th', score: 149 },
    { player: 'neonfox', score: 133 },
    { player: 'sunny.exe', score: 120 },
    { player: 'gridlock', score: 104 },
    { player: 'quietcoin', score: 97 },
    { player: 'lumen', score: 88 },
  ],
  coil: [
    { player: 'lumen', score: 1840 },
    { player: 'gridlock', score: 1610 },
    { player: 'vexa', score: 1475 },
    { player: 'quietcoin', score: 1290 },
    { player: 'm0th', score: 1150 },
  ],
  'neon-maze': [
    { player: 'vexa', score: 128490 },
    { player: 'ardent', score: 127250 },
    { player: 'kilo_byte', score: 119002 },
    { player: 'pixelwitch', score: 110488 },
    { player: 'm0th', score: 106631 },
  ],
  // Ported games get no made-up rankings: their board shows only your own best until the server exists.
  hexgl: [],
  starfall: [
    { player: 'ardent', score: 391504 },
    { player: 'vexa', score: 340211 },
    { player: 'lumen', score: 337780 },
    { player: 'neonfox', score: 312045 },
    { player: 'm0th', score: 299802 },
  ],
};

export const SAMPLE_LIVE = [
  { player: 'vexa', game: 'updraft' as GameId, watching: 1204, pace: '103%' },
  { player: 'kilo_byte', game: 'starfall' as GameId, watching: 386, pace: '97%' },
  { player: 'm0th', game: 'neon-maze' as GameId, watching: 212, pace: '99%' },
];

export const formatScore = (n: number) => n.toLocaleString('en-US');
