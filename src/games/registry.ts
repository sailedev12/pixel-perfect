import type { GameDefinition, GameFactory } from './types';

const notYet = (): Promise<GameFactory> => Promise.reject(new Error('This game is not built yet.'));

export const GAMES: GameDefinition[] = [
  {
    id: 'updraft',
    name: 'Updraft',
    blurb: 'Flap through the gaps. One hit ends the run.',
    color: '#ffb020',
    rulesVersion: 1,
    width: 360,
    height: 640,
    available: true,
    mobileControls: 'tap',
    keys: { primary: [' ', 'ArrowUp', 'w', 'W'] },
    instructions: [
      'Flap to stay in the air and fly through the gaps between the pillars.',
      'Every pillar you pass is worth 1 point.',
      'Touching a pillar or the ground ends the run. There are no continues.',
    ],
    controls: [
      ['Space, ↑ or W', 'Flap'],
      ['Click or tap', 'Flap'],
    ],
    scoreUnit: 'Score',
    load: () => import('./updraft/updraft').then((m) => m.createUpdraft),
  },
  {
    id: 'coil',
    name: 'Coil',
    blurb: 'A snake that keeps growing. Do not bite yourself.',
    color: '#3ddc97',
    rulesVersion: 1,
    width: 480,
    height: 480,
    available: false,
    mobileControls: 'dpad',
    keys: { up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S'], left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'] },
    instructions: [],
    controls: [],
    scoreUnit: 'Score',
    load: notYet,
  },
  {
    id: 'neon-maze',
    name: 'Neon Maze',
    blurb: 'Clear the maze before the hunters corner you.',
    color: '#ff4d2e',
    rulesVersion: 1,
    width: 448,
    height: 496,
    available: false,
    mobileControls: 'dpad',
    keys: { up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S'], left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'] },
    instructions: [],
    controls: [],
    scoreUnit: 'Score',
    load: notYet,
  },
  {
    id: 'starfall',
    name: 'Starfall',
    blurb: 'Hold the line against wave after wave. Three lives.',
    color: '#3fa7ff',
    rulesVersion: 1,
    width: 480,
    height: 640,
    available: false,
    mobileControls: 'dpad+fire',
    keys: { left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'], primary: [' ', 'ArrowUp', 'w', 'W'] },
    instructions: [],
    controls: [],
    scoreUnit: 'Score',
    load: notYet,
  },
];

export function getGame(id: string | undefined) {
  return GAMES.find((g) => g.id === id);
}
