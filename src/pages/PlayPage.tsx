import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import { Sfx } from '../games/audio';
import { GAMES, getGame } from '../games/registry';
import type { ArcadeGame, GameAction, GameDefinition } from '../games/types';
import { formatScoreFor } from '../lib/format';
import { quadBox, quadToMatrix3d } from '../lib/quad';
import { getBest, getMuted, recordResult } from '../lib/scores';
import { uiSound } from '../lib/uiSound';
import { stage } from '../stage/stage';

export default function PlayPage() {
  const { gameId } = useParams();
  const def = getGame(gameId);
  if (!def || !def.available) {
    return (
      <div className="page">
        <div className="eyebrow">Games</div>
        <h1 className="page-title">{def ? `${def.name} is coming soon.` : 'That game does not exist.'}</h1>
        <p className="muted">
          <Link to="/">Back to the games</Link>
        </p>
      </div>
    );
  }
  // key: a different game gets a completely fresh player.
  return <Player key={def.id} def={def} />;
}

type Phase = 'loading' | 'instructions' | 'playing' | 'over' | 'error';
type Box = { x: number; y: number; w: number; h: number };

// Our own canvas games draw at 75% of their size and are shown with hard pixel edges (the arcade-screen look).
const PIXEL_SCALE = 0.75;
// After a game over, ignore keys briefly so a held flap key doesn't restart instantly.
const RESTART_GUARD_MS = 600;
// How far a finger has to move on the screen to count as a swipe.
const SWIPE_MIN_PX = 24;
// Below this width there's no room for the UI around the cabinet, so games start zoomed in.
const NARROW_PX = 900;

const getFx = () => {
  try {
    return localStorage.getItem('pp:fx') !== '0';
  } catch {
    return true;
  }
};

function Player({ def }: { def: GameDefinition }) {
  const navigate = useNavigate();
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ArcadeGame | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const overAt = useRef(0);
  const swipeFrom = useRef<[number, number] | null>(null);
  const restartBtn = useRef<HTMLButtonElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [score, setScore] = useState(0);
  const [lastScore, setLastScore] = useState(0);
  const [lastCompleted, setLastCompleted] = useState(true);
  const [best, setBest] = useState(() => getBest(def.id, def.rulesVersion));
  const [newBest, setNewBest] = useState(false);
  const [muted, setMutedState] = useState(getMuted);
  const [full, setFull] = useState(() => window.innerWidth < NARROW_PX);
  const [fx, setFx] = useState(getFx);
  const [box, setBox] = useState<Box | null>(null);
  // The whole cabinet screen and the cabinet's left/right edges, for placing cards and UI.
  const [frame, setFrame] = useState<{ screen: Box; left: number; right: number; W: number; H: number } | null>(null);
  const [powered, setPowered] = useState(false);
  const fmt = (n: number) => formatScoreFor(def, n);

  // Put the game on the cabinet's screen; take it off again when leaving.
  useEffect(() => {
    const index = GAMES.findIndex((g) => g.id === def.id);
    stage.cabinet?.setPlay(index, def.width / def.height);
    return () => stage.cabinet?.setPlay(null);
  }, [def]);

  useEffect(() => {
    stage.cabinet?.setFull(full);
  }, [full]);

  // Every frame, bend the game element onto wherever the cabinet's screen is drawn.
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const cab = stage.cabinet;
      const quad = cab?.fittedQuad();
      const el = screenRef.current;
      if (quad && el) {
        el.style.transform = quadToMatrix3d(def.width, def.height, quad);
        const b = quadBox(quad);
        const sq = cab!.screenQuad();
        const sb = sq ? quadBox(sq) : b;
        const body = cab!.bodyBox;
        const key = [b.x, b.y, b.w, b.h, sb.x, sb.y, sb.w, body.x0, body.x1].map(Math.round).join(',');
        if (key !== lastKey) {
          lastKey = key;
          setBox(b);
          setFrame({ screen: sb, left: body.x0, right: body.x1, W: cab!.view.W, H: cab!.view.H });
        }
        // The screen powers on once the camera has arrived.
        if (cab!.settled) setPowered(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [def]);

  // Load and create the game; tear everything down when leaving.
  useEffect(() => {
    let cancelled = false;
    const sfx = new Sfx(getMuted());
    sfxRef.current = sfx;
    const canvas = canvasRef.current!;
    canvas.width = Math.round(def.width * PIXEL_SCALE);
    canvas.height = Math.round(def.height * PIXEL_SCALE);

    def
      .load()
      .then((create) => {
        if (cancelled) return;
        gameRef.current = create({
          canvas,
          muted: getMuted(),
          sfx,
          callbacks: {
            onReady: () => { if (!cancelled) setPhase('instructions'); },
            onScore: (s) => { if (!cancelled) setScore(s); },
            onGameOver: (result) => {
              if (cancelled) return;
              // Results carry gameId + rulesVersion; later this is also where a ranked run is sent to the server.
              const out = recordResult(result, def.lowerIsBetter);
              overAt.current = performance.now();
              setLastScore(result.score);
              setLastCompleted(out.counted);
              setScore(out.counted ? result.score : 0);
              setBest(out.best);
              setNewBest(out.isNewBest);
              setPhase('over');
            },
          },
        });
      })
      .catch(() => { if (!cancelled) setPhase('error'); });

    const onVisibility = () => {
      if (document.hidden) gameRef.current?.pause();
      else gameRef.current?.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      gameRef.current?.destroy();
      gameRef.current = null;
      sfx.destroy();
      sfxRef.current = null;
    };
  }, [def]);

  // Move focus to the button that matters for each phase.
  useEffect(() => {
    if (!powered) return;
    if (phase === 'instructions') startBtn.current?.focus();
    if (phase === 'playing') {
      // Ported games take keyboard focus inside their own frame.
      if (gameRef.current?.focus) gameRef.current.focus();
      else screenRef.current?.focus();
    }
    if (phase === 'over') {
      const id = window.setTimeout(() => restartBtn.current?.focus(), RESTART_GUARD_MS);
      return () => window.clearTimeout(id);
    }
  }, [phase, powered]);

  const refocus = () => {
    if (phase === 'playing' && gameRef.current?.focus) gameRef.current.focus();
    else screenRef.current?.focus();
  };

  const start = useCallback(() => {
    if (!gameRef.current) return;
    setScore(0);
    setNewBest(false);
    gameRef.current.start();
    setPhase('playing');
  }, []);

  const restart = useCallback(() => {
    if (!gameRef.current) return;
    if (performance.now() - overAt.current < RESTART_GUARD_MS) return;
    setScore(0);
    setNewBest(false);
    gameRef.current.restart();
    setPhase('playing');
  }, []);

  const exit = () => navigate('/');

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    uiSound.setMuted(m);
    sfxRef.current?.setMuted(m);
    gameRef.current?.setMuted?.(m);
    refocus();
  };

  const toggleZoom = () => {
    setFull((f) => !f);
    window.setTimeout(refocus, 50);
  };

  const toggleFx = () => {
    const v = !fx;
    setFx(v);
    try {
      localStorage.setItem('pp:fx', v ? '1' : '0');
    } catch {
      // Not remembered; fine.
    }
    refocus();
  };

  const actionFor = (key: string): GameAction | null => {
    for (const [action, keys] of Object.entries(def.keys) as [GameAction, string[]][]) if (keys.includes(key)) return action;
    return null;
  };

  const onKey = (pressed: boolean) => (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const action = actionFor(e.key);
    if (action || e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    if (!pressed) {
      if (action && phase === 'playing') gameRef.current?.input(action, false);
      return;
    }
    if (phase === 'playing' && action) {
      if (!e.repeat) gameRef.current?.input(action, true);
    } else if (phase === 'instructions' && (e.key === 'Enter' || action)) {
      start();
    } else if (phase === 'over' && !e.repeat && (e.key === 'Enter' || e.key === 'r' || e.key === 'R' || action === 'primary')) {
      restart();
    }
  };

  const onScreenPointer = (pressed: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'playing' || def.mobileControls === 'own') return;
    e.preventDefault();
    if (def.mobileControls === 'tap') {
      gameRef.current?.input('primary', pressed);
      return;
    }
    // Direction games: a swipe on the screen steers.
    if (pressed) {
      swipeFrom.current = [e.clientX, e.clientY];
      return;
    }
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (!from) return;
    const dx = e.clientX - from[0], dy = e.clientY - from[1];
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    const action: GameAction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    gameRef.current?.input(action, true);
    gameRef.current?.input(action, false);
  };

  const padPress = (action: GameAction, pressed: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (phase === 'playing') gameRef.current?.input(action, pressed);
  };

  // Cards use the whole cabinet screen (roomier than a narrow game); zoomed in, the game's area.
  const cardBox = !full && frame ? frame.screen : box;
  // The side panels sit just outside the cabinet's screen (the cabinet itself runs off the page at this zoom).
  const sideRight = (frame ? frame.screen.x + frame.screen.w : box ? box.x + box.w : 0) + 20;
  const sideWidth = Math.max(150, Math.min(280, (frame?.W ?? window.innerWidth) - sideRight - 16));
  const boxStyle: CSSProperties | undefined = cardBox ? { left: cardBox.x, top: cardBox.y, width: cardBox.w, height: cardBox.h } : undefined;
  // Scanlines sized to the game, so there are about 240 of them whatever its resolution.
  const screenStyle = { width: def.width, height: def.height, '--scan': `${def.height / 240}px` } as CSSProperties;

  const controls = (
    <>
      <button type="button" className="btn" onClick={exit}>
        ← Exit
      </button>
      <button type="button" className="btn" onClick={restart} disabled={phase !== 'playing' && phase !== 'over'}>
        Restart
      </button>
      <button type="button" className="btn" onClick={toggleMute} aria-pressed={muted}>
        {muted ? 'Sound off' : 'Sound on'}
      </button>
      <button type="button" className="btn" onClick={toggleFx} aria-pressed={fx} title="Pixel and scanline effect">
        {fx ? 'Pixel FX on' : 'Pixel FX off'}
      </button>
      <button type="button" className="btn primary zoom-btn" onClick={toggleZoom} aria-pressed={full}>
        {full ? '⤡ Zoom out' : '⤢ Zoom in'}
      </button>
    </>
  );

  return (
    <div className={`play ${full ? 'is-full' : 'is-cabinet'}`}>
      <h1 className="sr-only">{def.name}</h1>

      {/* The game itself, bent onto the cabinet's screen every frame. */}
      <div
        ref={screenRef}
        className={`cab-screen${powered ? ' on' : ''}${fx ? ' fx' : ''}`}
        style={screenStyle}
        tabIndex={0}
        role="application"
        aria-label={`${def.name} game. ${def.controls.map(([k, a]) => `${k}: ${a}`).join('. ')}`}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
        onPointerDown={onScreenPointer(true)}
        onPointerUp={onScreenPointer(false)}
      >
        <div className="cab-inner">
          <canvas ref={canvasRef} />
          <div className="crt" aria-hidden="true" />
        </div>
      </div>

      {box && powered && (
        <>
          {phase !== 'playing' && (
            <div className="screen-overlay" style={boxStyle}>
              {phase === 'loading' && (
                <div className="overlay-card" role="status">
                  <div className="eyebrow">Loading {def.name}</div>
                  <div className="loader" />
                </div>
              )}
              {phase === 'error' && (
                <div className="overlay-card" role="alert">
                  <h2>Couldn't load the game</h2>
                  <button type="button" className="btn primary" onClick={() => window.location.reload()}>
                    Try again
                  </button>
                </div>
              )}
              {phase === 'instructions' && (
                <div className="overlay-card">
                  <div className="eyebrow">How to play</div>
                  <h2>{def.name}</h2>
                  <ul>
                    {def.instructions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className="keys">
                    {def.controls.map(([k, a]) => (
                      <span key={k} style={{ display: 'contents' }}>
                        <kbd>{k}</kbd>
                        <span>{a}</span>
                      </span>
                    ))}
                  </div>
                  <button type="button" className="btn primary" ref={startBtn} onClick={start}>
                    Start
                  </button>
                </div>
              )}
              {phase === 'over' && (
                <div className="overlay-card" role="dialog" aria-label="Game over">
                  <div className="eyebrow">{def.lowerIsBetter ? (lastCompleted ? 'Your time' : 'Race over') : 'Game over'}</div>
                  {/* Points games always show their score (even 0); only an unfinished race has no time. */}
                  {lastCompleted || !def.lowerIsBetter ? (
                    <div className="big-score">{fmt(lastScore)}</div>
                  ) : (
                    <>
                      <h2>No time recorded</h2>
                      <p className="muted" style={{ maxWidth: 320, fontSize: 13 }}>The run ended before the finish, so it doesn't count toward your best.</p>
                    </>
                  )}
                  {newBest ? <div className="new-best">NEW PERSONAL BEST</div> : <div className="muted mono" style={{ fontSize: 12 }}>Best {best > 0 ? fmt(best) : '—'}</div>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button type="button" className="btn primary" ref={restartBtn} onClick={restart}>
                      Play again
                    </button>
                    <button type="button" className="btn" onClick={exit}>
                      Exit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!full ? (
            <>
              {/* The UI pops in around the cabinet. */}
              <div className="hud hud-left ui-pop" style={{ left: (frame?.screen.x ?? box.x) - 20, top: box.y + box.h * 0.45 }}>
                <span className="eyebrow">{def.scoreUnit}</span>
                <span className="hud-big">{fmt(score)}</span>
                <span className="eyebrow">Your best</span>
                <span className="hud-mid">{best > 0 ? fmt(best) : '—'}</span>
                <span className="muted mono" style={{ fontSize: 10 }}>{def.id} · rules v{def.rulesVersion}</span>
              </div>
              <div className={`hud hud-right ui-pop${sideWidth < 240 ? " narrow" : ""}`} style={{ left: sideRight, top: box.y + box.h * 0.45, width: sideWidth, '--d': '120ms' } as CSSProperties}>
                <Leaderboard game={def} best={best} limit={5} />
                {def.credits && (
                  <p className="muted hud-credits">
                    {def.name} by {def.credits.author} ·{' '}
                    <a href={def.credits.licenseUrl} target="_blank" rel="noreferrer">{def.credits.license}</a> ·{' '}
                    <a href={def.credits.sourceUrl} target="_blank" rel="noreferrer">source</a>
                    {def.credits.ourCopyUrl && (
                      <>
                        {' · '}
                        <a href={def.credits.ourCopyUrl} target="_blank" rel="noreferrer">our copy</a>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="hud hud-bottom ui-pop" style={{ left: box.x + box.w / 2, top: Math.min((frame?.H ?? window.innerHeight) - 64, (frame ? frame.screen.y + frame.screen.h : box.y + box.h) + 22), '--d': '220ms' } as CSSProperties}>
                {controls}
              </div>
            </>
          ) : (
            <>
              <div className="hud hud-corner ui-pop">
                <span className="eyebrow">{def.scoreUnit}</span>
                <span className="hud-mid">{fmt(score)}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>best {best > 0 ? fmt(best) : '—'}</span>
              </div>
              <div className="hud hud-bar ui-pop" style={{ '--d': '100ms' } as CSSProperties}>
                {controls}
              </div>
            </>
          )}
        </>
      )}

      {(def.mobileControls === 'dpad' || def.mobileControls === 'dpad+fire') && phase === 'playing' && (
        <div className="pad play-pad" aria-label="On-screen controls">
          <span />
          <button type="button" aria-label="Up" onPointerDown={padPress('up', true)} onPointerUp={padPress('up', false)} onPointerLeave={padPress('up', false)}>↑</button>
          {def.mobileControls === 'dpad+fire' ? (
            <button type="button" aria-label="Fire" onPointerDown={padPress('primary', true)} onPointerUp={padPress('primary', false)} onPointerLeave={padPress('primary', false)}>●</button>
          ) : (
            <span />
          )}
          <button type="button" aria-label="Left" onPointerDown={padPress('left', true)} onPointerUp={padPress('left', false)} onPointerLeave={padPress('left', false)}>←</button>
          <button type="button" aria-label="Down" onPointerDown={padPress('down', true)} onPointerUp={padPress('down', false)} onPointerLeave={padPress('down', false)}>↓</button>
          <button type="button" aria-label="Right" onPointerDown={padPress('right', true)} onPointerUp={padPress('right', false)} onPointerLeave={padPress('right', false)}>→</button>
        </div>
      )}
    </div>
  );
}
