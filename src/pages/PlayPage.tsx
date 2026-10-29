import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import { Sfx } from '../games/audio';
import { getGame } from '../games/registry';
import type { ArcadeGame, GameAction, GameDefinition } from '../games/types';
import { getBest, getMuted, recordResult } from '../lib/scores';
import { uiSound } from '../lib/uiSound';
import { formatScore } from '../data/sample';

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

// Pixel density of the game canvas relative to the game's own resolution.
const RENDER_SCALE = 2;
// After a game over, ignore keys briefly so a held flap key doesn't restart instantly.
const RESTART_GUARD_MS = 600;

function Player({ def }: { def: GameDefinition }) {
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ArcadeGame | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const overAt = useRef(0);
  const restartBtn = useRef<HTMLButtonElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [score, setScore] = useState(0);
  const [lastScore, setLastScore] = useState(0);
  const [best, setBest] = useState(() => getBest(def.id, def.rulesVersion));
  const [newBest, setNewBest] = useState(false);
  const [muted, setMutedState] = useState(getMuted);
  const [fullscreen, setFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  // Load and create the game; tear everything down when leaving.
  useEffect(() => {
    let cancelled = false;
    const sfx = new Sfx(getMuted());
    sfxRef.current = sfx;
    const canvas = canvasRef.current!;
    canvas.width = def.width * RENDER_SCALE;
    canvas.height = def.height * RENDER_SCALE;

    def
      .load()
      .then((create) => {
        if (cancelled) return;
        gameRef.current = create({
          canvas,
          sfx,
          callbacks: {
            onReady: () => { if (!cancelled) setPhase('instructions'); },
            onScore: (s) => { if (!cancelled) setScore(s); },
            onGameOver: (result) => {
              if (cancelled) return;
              // Results carry gameId + rulesVersion; later this is also where a ranked run is sent to the server.
              const out = recordResult(result);
              overAt.current = performance.now();
              setLastScore(result.score);
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
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [def]);

  // Keep the game's aspect ratio inside whatever space is available.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const ar = def.width / def.height;
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      const w = Math.floor(Math.min(bw, bh * ar));
      setStageSize({ w, h: Math.floor(w / ar) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [def]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Move focus to the button that matters for each phase.
  useEffect(() => {
    if (phase === 'instructions') startBtn.current?.focus();
    if (phase === 'playing') stageRef.current?.focus();
    if (phase === 'over') {
      const id = window.setTimeout(() => restartBtn.current?.focus(), RESTART_GUARD_MS);
      return () => window.clearTimeout(id);
    }
  }, [phase]);

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
    stageRef.current?.focus();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen().catch(() => {});
    stageRef.current?.focus();
  };

  const actionFor = (key: string): GameAction | null => {
    for (const [action, keys] of Object.entries(def.keys) as [GameAction, string[]][]) if (keys.includes(key)) return action;
    return null;
  };

  const onKey = (pressed: boolean) => (e: KeyboardEvent<HTMLDivElement>) => {
    // Buttons inside the stage handle their own Enter/Space.
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const action = actionFor(e.key);
    if (action || e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    if (!pressed) {
      if (action && phase === 'playing') gameRef.current?.input(action, false);
      return;
    }
    if (phase === 'playing' && action) {
      if (!e.repeat) gameRef.current?.input(action, true);
    } else if (phase === 'instructions' && (e.key === 'Enter' || action === 'primary')) {
      start();
    } else if (phase === 'over' && !e.repeat && (e.key === 'Enter' || e.key === 'r' || e.key === 'R' || action === 'primary')) {
      restart();
    }
  };

  const onStagePointer = (pressed: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'playing' || def.mobileControls !== 'tap') return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    gameRef.current?.input('primary', pressed);
  };

  const padPress = (action: GameAction, pressed: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (phase === 'playing') gameRef.current?.input(action, pressed);
  };

  return (
    <div className="player" ref={shellRef}>
      <div className="player-bar">
        <button type="button" className="btn" onClick={exit}>
          ← Exit
        </button>
        <h1 className="player-title">
          <span className="swatch" style={{ background: def.color }} />
          {def.name}
        </h1>
        <button type="button" className="btn icon-btn" onClick={restart} disabled={phase !== 'playing' && phase !== 'over'}>
          Restart
        </button>
        <button type="button" className="btn icon-btn" onClick={toggleMute} aria-pressed={muted}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
        {canFullscreen && (
          <button type="button" className="btn icon-btn" onClick={toggleFullscreen} aria-pressed={fullscreen}>
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        )}
      </div>

      <div className="player-body">
        <div className="stage-area">
          <div className="stage-box" ref={boxRef}>
            <div
              className="stage"
              ref={stageRef}
              tabIndex={0}
              role="application"
              aria-label={`${def.name} game. ${def.controls.map(([k, a]) => `${k}: ${a}`).join('. ')}`}
              style={{ width: stageSize.w, height: stageSize.h }}
              onKeyDown={onKey(true)}
              onKeyUp={onKey(false)}
              onPointerDown={onStagePointer(true)}
              onPointerUp={onStagePointer(false)}
            >
              <canvas ref={canvasRef} />

              {phase === 'loading' && (
                <div className="overlay" role="status">
                  <div className="eyebrow">Loading {def.name}</div>
                  <div className="loader" />
                </div>
              )}

              {phase === 'error' && (
                <div className="overlay" role="alert">
                  <h2>Couldn't load the game</h2>
                  <button type="button" className="btn primary" onClick={() => window.location.reload()}>
                    Try again
                  </button>
                </div>
              )}

              {phase === 'instructions' && (
                <div className="overlay">
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
                <div className="overlay" role="dialog" aria-label="Game over">
                  <div className="eyebrow">Game over</div>
                  <div className="big-score">{formatScore(lastScore)}</div>
                  {newBest ? <div className="new-best">NEW PERSONAL BEST</div> : <div className="muted mono" style={{ fontSize: 12 }}>Best {formatScore(best)}</div>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button type="button" className="btn primary" ref={restartBtn} onClick={restart}>
                      Play again
                    </button>
                    <button type="button" className="btn" onClick={exit}>
                      Exit
                    </button>
                  </div>
                  <div className="muted mono" style={{ fontSize: 11 }}>Enter or R to play again</div>
                </div>
              )}
            </div>
          </div>

          {def.mobileControls !== 'tap' && (
            <div className="pad" aria-label="On-screen controls">
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

        <aside className="side" aria-label="Scores">
          <div className="stats">
            <div className="stat">
              <span className="eyebrow">Score</span>
              <span className="v" aria-live="off">{formatScore(score)}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Your best</span>
              <span className="v">{best > 0 ? formatScore(best) : '—'}</span>
            </div>
          </div>
          <Leaderboard game={def} best={best} />
          <div className="muted mono" style={{ fontSize: 11 }}>
            {def.id} · rules v{def.rulesVersion}
          </div>
        </aside>
      </div>
    </div>
  );
}
