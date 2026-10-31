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
- `src/stage/` – the shared particle background: the floating cabinet (Games), the LED scoreboard (Leaderboards), Live and You pieces, and the GPU renderer.
- `src/games/` – the games and what they share:
  - `types.ts` – the interface every game implements (start, restart, pause, resume, input, destroy, plus ready / score / game-over callbacks).
  - `registry.ts` – the list of games, their rules version, controls and instructions.
  - `loop.ts` – fixed-timestep loop, so games run the same speed at any refresh rate.
  - `updraft/` – Updraft, the Flappy-style game.
  - `coil/` – Coil, the snake game.
  - `hexgl/` + `frame/` – HexGL, a ported game that runs in its own page inside the player (see below).
- `src/stage/scenes/danceScene.ts` + `src/lib/dance.ts` – dance mode (the button in the top-right corner): the dots become a dancer for 30 seconds of music.
- `src/data/sample.ts` – **sample** leaderboard and live data. Everything shown from it is labeled "Sample data".
- `src/lib/scores.ts` – personal bests, saved in the browser (localStorage).

## Ported games (other people's games)

HexGL by Thibaut Despoulain is included as-is in `public/games/hexgl/` (MIT License), so it's served at
`/games/hexgl/` locally and on Vercel. The player shows it in a sandboxed iframe, and a small bridge script
(`public/games/hexgl/pixel-perfect-bridge.js`) reports the race clock and result back. Credits, license and
what we changed are in `public/games/hexgl/PIXEL-PERFECT.md` and on the game's page. To port another HTML5
game: put it under `public/games/<name>/`, add a bridge script that posts `ready` / `gameover` messages, and
register it with `frameGame()` in `registry.ts`.

## Music

Dance mode plays a 30-second clip (0:30 to 1:00) of **LLow – i can hear you [NCS Release]**, in
`public/audio/llow-i-can-hear-you.mp3`. Music provided by NoCopyrightSounds (https://ncs.io); the credit is
shown on screen while it plays. The dance is timed to the clip at 115 BPM (`BPM` and `BEAT0` in `danceScene.ts`).

## Adding a game

1. Write `src/games/<name>/<name>.ts` exporting a function that takes a `GameContext` and returns an `ArcadeGame`.
2. Add it to `registry.ts` and set `available: true`.
3. Every result must include `gameId` and `rulesVersion`. If you change a game's rules, bump its `rulesVersion` so old and new scores are never mixed.

## Status

- Done: site shell, particle stage (cabinet, scoreboard, Live, You), game player, Updraft, Coil, HexGL (ported), dance mode.
- Next: Neon Maze (maze chase), Starfall (space shooter).
- Later: online leaderboard (server), see `docs/score-verification.md`.
