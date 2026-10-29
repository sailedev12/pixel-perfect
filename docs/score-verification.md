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
- Reject impossible values: negative or non-integer scores, a score too high for the run's length (for Updraft, roughly one point per 1.5 s at most), runs shorter than the minimum, duplicate submissions.
- Rate-limit submissions per account and per IP.
- Later, for top scores: replay the run on the server from `seed` + input log and check the replayed score matches.

## Limits

Scores submitted from a browser cannot be made cheat-proof. The game code runs on the player's machine, so a determined player can change it or send a made-up result. The checks above catch obvious fakes and make cheating more work. Server replays catch more, but a bot can still play perfectly. Treat the top of every board as "unverified until reviewed".
