// HexGL by Thibaut Despoulain, ported in as-is (see public/games/hexgl/PIXEL-PERFECT.md).
import { frameGame } from '../frame/frameGame';

export const createHexGL = frameGame({
  id: 'hexgl',
  rulesVersion: 1,
  // pixel=2: the game draws at half size and is scaled up with hard pixel edges (the arcade-screen look).
  src: '/games/hexgl/index.html?pixel=2',
  title: 'HexGL racing game',
  bridge: 'pixel-perfect-hexgl',
  liveScore: (msg) => (msg.type === 'time' && typeof msg.ms === 'number' ? msg.ms : null),
  toResult(msg, base) {
    const time = typeof msg.timeMs === 'number' ? msg.timeMs : null;
    // Only a finished time-attack race without the game's built-in "godmode" counts.
    const completed = msg.finished === true && time !== null && msg.godmode !== true && msg.mode === 'timeattack';
    return {
      ...base,
      score: completed ? time : 0,
      durationMs: completed ? time : 0,
      completed,
      details: {
        finished: msg.finished === true,
        lapTimes: Array.isArray(msg.lapTimes) ? msg.lapTimes : [],
        godmode: msg.godmode === true,
        difficulty: msg.difficulty,
        quality: msg.quality,
        track: msg.track,
      },
    };
  },
});
