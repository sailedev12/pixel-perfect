# HexGL on Pixel Perfect

HexGL is a futuristic HTML5 racing game by **Thibaut Despoulain (BKcore)**.

- Original game: http://hexgl.bkcore.com
- Original source code: https://github.com/BKcore/HexGL
- This copy came from that repository's `master` branch (downloaded as `HexGL-master.zip`).

## License

The repository's `LICENSE` file is the **MIT License**, Copyright (c) 2015 Thibaut Despoulain, and its README
says: "Unless specified in the file, HexGL's code and resources are now licensed under the MIT License."

Some files still carry an older header naming the **Creative Commons Attribution-NonCommercial 3.0** license
(`bkcore/hexgl/*.js`, `bkcore/hexgl/tracks/Cityscape.js`, `libs/ShaderExtras.js`). Pixel Perfect is a free,
non-commercial portfolio project and credits the author, so it meets both licenses. If the site ever becomes
commercial, confirm with the author that those files are covered by the MIT relicense.

Credits from the game itself:

- Concept and development: Thibaut Despoulain (BKcore)
- Contributors: townxelliot, mahesh.kk
- HexMKI base model: Charnel
- Track texture: Nobiax
- Built with WebGL, JavaScript, CoffeeScript, Three.js

## What Pixel Perfect changed

Everything else in this folder is the original game, unchanged.

1. `index.html`
   - Removed the Google Analytics tracker.
   - The page icon now loads from this folder instead of hexgl.bkcore.com.
   - Added one script tag for `pixel-perfect-bridge.js`.
2. Added `pixel-perfect-bridge.js` (new file). It reports when the game is ready, the race clock, and the race
   result to the Pixel Perfect game player; handles the player's mute button; and wakes the game's audio after
   the first click (modern browsers require that). It does not change how the game plays.
3. Left out files the site doesn't use: `package.zip` (a zipped copy of the game), `cache.appcache` (an old
   offline-cache feature browsers have removed), `.htaccess`, `manifest.webapp` / `package.webapp` (Firefox OS
   app files) and the level editor (`libs/Editor.html`, `libs/Editor_files/`). All of them are in the original
   repository linked above. (`textures.full/` is kept: the "Very High" quality setting loads its textures from it.)

## Known leftovers in the original code

- The "Leap Motion Controller" control option needs discontinued hardware and its local helper app.
- `bkcore/hexgl/Ladder.js` (the old online Hall of Fame) is never loaded by `index.html`.
- The finish screen's Twitter / Facebook share links are only used by a layout this page doesn't include.
