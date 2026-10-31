/*
 * Pixel Perfect bridge for HexGL.
 * Added by Pixel Perfect; not part of the original game. It leaves the gameplay alone and only:
 *  - tells the site's game player when the game has loaded,
 *  - reports the race clock while racing and the result when a race ends,
 *  - mutes or unmutes the game's sound when the player's sound button is pressed,
 *  - wakes the game's audio after the first click or key press (browsers keep audio
 *    asleep until then, and HexGL was written before that rule existed).
 * Messages only go to, and are only accepted from, this same website.
 */
(function () {
  var origin = window.location.origin;
  var embedded = window.parent && window.parent !== window;
  var muted = false;

  function send(msg) {
    if (!embedded) return;
    msg.source = 'pixel-perfect-hexgl';
    window.parent.postMessage(msg, origin);
  }

  function audioContext() {
    return window.bkcore && bkcore.Audio ? bkcore.Audio._ctx : null;
  }

  function applyMute() {
    var ctx = audioContext();
    if (!ctx) return;
    if (muted) ctx.suspend();
    else ctx.resume();
  }

  function wakeAudio() {
    if (!muted) applyMute();
  }
  window.addEventListener('pointerdown', wakeAudio, true);
  window.addEventListener('keydown', wakeAudio, true);
  window.addEventListener('touchstart', wakeAudio, true);

  // Pixel look (optional, ?pixel=N): HexGL draws at 1/N of the window size and the picture is scaled back up
  // with hard pixel edges. It only changes how the picture looks, not how the game plays.
  var pixel = Math.max(1, Math.min(4, Number(new URLSearchParams(window.location.search).get('pixel')) || 1));
  if (pixel > 1) {
    var css = document.createElement('style');
    css.textContent = 'canvas { image-rendering: pixelated; image-rendering: crisp-edges; }';
    document.head.appendChild(css);
    var OriginalHexGL = bkcore.hexgl.HexGL;
    var PixelHexGL = function (opts) {
      opts.width = Math.round((opts.width || window.innerWidth) / pixel);
      opts.height = Math.round((opts.height || window.innerHeight) / pixel);
      OriginalHexGL.call(this, opts);
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
    };
    PixelHexGL.prototype = OriginalHexGL.prototype;
    bkcore.hexgl.HexGL = PixelHexGL;
  }

  // Race result: HexGL calls displayScore two seconds after the race ends (finished or destroyed).
  var HexGL = bkcore.hexgl.HexGL;
  var originalDisplayScore = HexGL.prototype.displayScore;
  HexGL.prototype.displayScore = function (finishTime, lapTimes) {
    var gp = this.gameplay;
    var finished = !!gp && gp.result === gp.results.FINISH;
    send({
      type: 'gameover',
      finished: finished,
      timeMs: finished ? Math.round(finishTime) : null,
      lapTimes: finished && lapTimes ? lapTimes.map(Math.round) : [],
      godmode: !!this.godmode,
      difficulty: this.difficulty,
      quality: this.quality,
      mode: this.mode,
      track: this.track ? this.track.name : null
    });
    return originalDisplayScore.apply(this, arguments);
  };

  // Live race clock, a few times a second, once the countdown is over.
  var Gameplay = bkcore.hexgl.Gameplay;
  var originalUpdate = Gameplay.prototype.update;
  var lastSent = 0;
  Gameplay.prototype.update = function () {
    var out = originalUpdate.apply(this, arguments);
    if (this.active && this.step === 4 && this.mode === 'timeattack') {
      var now = Date.now();
      if (now - lastSent > 200) {
        lastSent = now;
        send({ type: 'time', ms: Math.round(this.timer.time.elapsed), lap: this.lap });
      }
    }
    return out;
  };

  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== window.parent) return;
    var d = e.data || {};
    if (d.type === 'mute') {
      muted = !!d.muted;
      applyMute();
    }
  });

  send({ type: 'ready' });
})();
