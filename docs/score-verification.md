# Scores: what's trusted and what isn't

## Today

- Personal bests are stored in the browser's localStorage, keyed by game ID and rules version.
- They are not sent anywhere. Anyone can edit them, so they are never used for public rankings.
- All leaderboard and live data on the site is sample data and is labeled that way.

## Ranked play (planned)

Rules for a ranked run:

- Fixed rules per `rulesVersion`. A rules change gets a new version, and its scores go on a separate board.
- Clean start: every run begins from `start()` / `restart()` with a new seed. No continues, no mid-run saves.
- One result per run, containing `gameId`, `rulesVersion`, `score`, `durationMs`, `ticks`, `seed` and the input log.

Server side (database credentials and anything privileged stay on the server only, never in the website code):

- Accept results only for known games and current rules versions.
- Reject impossible values: negative or non-integer scores, a score too high for the run's length, runs shorter than the minimum, duplicate submissions. Per game:
  - Updraft: roughly one point per 1.5 s at most.
  - HexGL (ported game, time in milliseconds, lower is better): only finished 3-lap time-attack races count;
    crashes and the game's "godmode" option never count. The race logic runs inside the original game, not our
    fixed-step code, so there is no seed + input log to replay yet. A server can only sanity-check times (for
    example, reject anything faster than the best legitimate laps it has seen). HexGL does record full race data
    (`RaceData.export()`); sending that with each result would be the first step toward checking times properly.
  - Coil: scores are multiples of 10. With P pellets and B bonus cores, score = 10·P + 50·B, B ≤ P / 5, and the coil can take at most one step every 4 ticks, so P ≤ ticks / 4.
- Rate-limit submissions per account and per IP.
- Later, for top scores: replay the run on the server from `seed` + input log and check the replayed score matches.

## Limits

Scores submitted from a browser cannot be made cheat-proof. The game code runs on the player's machine, so a determined player can change it or send a made-up result. The checks above catch obvious fakes and make cheating more work. Server replays catch more, but a bot can still play perfectly. Treat the top of every board as "unverified until reviewed".
