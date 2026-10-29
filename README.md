# Pixel Perfect

A community arcade site: original browser games, public leaderboards, and (later) live record attempts.

## Run it

In a terminal, inside this folder:

```
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

To test on your phone: phone and computer on the same Wi-Fi, then open the "Network" address `npm run dev` prints.

Check for type errors with `npm run typecheck`.

## What's where

- `src/pages/` – the four tabs (Games, Leaderboards, Live, You) and the game player (`PlayPage.tsx`).
- `src/cabinet/cabinet.ts` – the floating particle arcade cabinet on the Games page.
- `src/games/` – the games and what they share:
  - `types.ts` – the interface every game implements (start, restart, pause, resume, input, destroy, plus ready / score / game-over callbacks).
  - `registry.ts` – the list of games, their rules version, controls and instructions.
  - `loop.ts` – fixed-timestep loop, so games run the same speed at any refresh rate.
  - `updraft/` – Updraft, the Flappy-style game.
- `src/data/sample.ts` – **sample** leaderboard and live data. Everything shown from it is labeled "Sample data".
- `src/lib/scores.ts` – personal bests, saved in the browser (localStorage).

## Adding a game

1. Write `src/games/<name>/<name>.ts` exporting a function that takes a `GameContext` and returns an `ArcadeGame`.
2. Add it to `registry.ts` and set `available: true`.
3. Every result must include `gameId` and `rulesVersion`. If you change a game's rules, bump its `rulesVersion` so old and new scores are never mixed.

## Status

- Done: site shell, cabinet home, game player, Updraft.
- Next: Coil (snake), Neon Maze (maze chase), Starfall (space shooter).
- Later: online leaderboard (server), see `docs/score-verification.md`.
