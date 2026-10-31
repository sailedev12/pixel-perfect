// Runs a ported game (someone else's HTML5 game, hosted under public/games/) inside the shared
// game player. The game keeps its own page, menus and controls in an iframe; a small bridge script
// inside it reports ready / clock / race result back here with postMessage.
import type { ArcadeGame, GameContext, GameId, GameResult } from '../types';

interface BridgeMessage {
  source?: string;
  type?: string;
  [key: string]: unknown;
}

export interface FrameGameOptions {
  id: GameId;
  rulesVersion: number;
  /** The game's page, e.g. '/games/hexgl/index.html'. */
  src: string;
  title: string;
  /** The `source` name the game's bridge script puts on its messages. */
  bridge: string;
  /** Turns the bridge's game-over message into a result. */
  toResult(msg: BridgeMessage, base: Pick<GameResult, 'gameId' | 'rulesVersion' | 'seed' | 'inputs' | 'ticks' | 'endedAt'>): GameResult;
  /** Pulls the live score (or clock) out of a bridge message, if it carries one. */
  liveScore?(msg: BridgeMessage): number | null;
}

export function frameGame(opts: FrameGameOptions) {
  return ({ canvas, callbacks, muted }: GameContext): ArcadeGame => {
    const stage = canvas.parentElement!;
    canvas.style.display = 'none';

    const frame = document.createElement('iframe');
    frame.className = 'game-frame';
    frame.title = opts.title;
    // Scripts and same-origin storage only: no pop-ups, no navigating the site, no forms.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
    stage.insertBefore(frame, canvas);

    let destroyed = false;
    let readyOnce = false;
    // After a result, ignore the clock until the next run starts.
    let over = false;
    let isMuted = muted;

    const post = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage(msg, window.location.origin);

    const onMessage = (e: MessageEvent) => {
      if (destroyed || e.source !== frame.contentWindow || e.origin !== window.location.origin) return;
      const msg = e.data as BridgeMessage;
      if (!msg || msg.source !== opts.bridge) return;
      if (msg.type === 'ready') {
        post({ type: 'mute', muted: isMuted });
        if (!readyOnce) {
          readyOnce = true;
          callbacks.onReady();
        }
      } else if (msg.type === 'gameover') {
        if (over) return;
        over = true;
        const result = opts.toResult(msg, {
          gameId: opts.id,
          rulesVersion: opts.rulesVersion,
          seed: 0,
          inputs: [],
          ticks: 0,
          endedAt: new Date().toISOString(),
        });
        callbacks.onGameOver(result);
      } else {
        if (over) return;
        const live = opts.liveScore?.(msg);
        if (live !== null && live !== undefined) callbacks.onScore(live);
      }
    };
    window.addEventListener('message', onMessage);

    const load = () => {
      over = false;
      frame.src = `${opts.src}${opts.src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    };
    load();

    return {
      id: opts.id,
      rulesVersion: opts.rulesVersion,
      start() {
        callbacks.onScore(0);
        frame.focus();
        frame.contentWindow?.focus();
      },
      restart() {
        // The original game restarts by reloading its page, so do the same: a clean start every time.
        callbacks.onScore(0);
        load();
        frame.focus();
      },
      pause() {},
      resume() {},
      input() {},
      setMuted(m) {
        isMuted = m;
        post({ type: 'mute', muted: m });
      },
      focus() {
        frame.focus();
        frame.contentWindow?.focus();
      },
      destroy() {
        destroyed = true;
        window.removeEventListener('message', onMessage);
        // Unloading the page stops its loop, sound and listeners.
        frame.src = 'about:blank';
        frame.remove();
        canvas.style.display = '';
      },
    };
  };
}
