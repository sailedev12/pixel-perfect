import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import Segmented from '../components/Segmented';
import TypeText from '../components/TypeText';
import { GAMES } from '../games/registry';
import { SAMPLE_LEADERBOARDS } from '../data/sample';
import { getBest } from '../lib/scores';
import { formatScoreFor } from '../lib/format';
import { stage } from '../stage/stage';

// The page text arrives while the particles are still settling into the board.
const UI_DELAY = 120;
const delay = (ms: number) => ({ '--d': `${UI_DELAY + ms}ms` }) as CSSProperties;

export default function LeaderboardsPage() {
  const slotRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => stage.board?.game ?? 0);
  const game = GAMES[index];
  const rows = SAMPLE_LEADERBOARDS[game.id];
  const best = getBest(game.id, game.rulesVersion);

  // The board itself is drawn by the shared particle stage; tell it where to sit.
  useEffect(() => {
    const board = stage.board;
    if (!board) return;
    board.rectProvider = () => slotRef.current?.getBoundingClientRect() ?? null;
    return () => {
      board.rectProvider = null;
    };
  }, []);

  const pick = (i: number) => {
    setIndex(i);
    stage.board?.setGame(i);
  };

  return (
    <div className="lb-page">
      <div className="lb-head">
        <div>
          <div className="eyebrow">
            <TypeText text="LEADERBOARDS" delay={UI_DELAY} speed={14} />
          </div>
          <h1 className="page-title">
            <TypeText text="Who's on top" delay={UI_DELAY + 80} speed={20} />
          </h1>
        </div>
        <Segmented
          className="ui-fade"
          style={delay(150)}
          label="Game"
          options={GAMES.map((g) => ({ id: g.id, label: g.name }))}
          value={game.id}
          onChange={(id) => pick(GAMES.findIndex((g) => g.id === id))}
        />
      </div>

      <div className="lb-stage" ref={slotRef} />

      <div className="lb-foot ui-fade" style={delay(300)}>
        {rows.length ? (
          <>
            <span className="sample-badge">SAMPLE DATA</span>
            <span className="muted" style={{ fontSize: 13 }}>
              These players and scores are made up. Real rankings need the online leaderboard. Your best is from this browser.
            </span>
          </>
        ) : (
          <>
            <span className="sample-badge">THIS DEVICE ONLY</span>
            <span className="muted" style={{ fontSize: 13 }}>
              No online rankings for {game.name} yet: they need the server. Your best is from this browser.
              {game.lowerIsBetter ? ' Lower times are better.' : ''}
            </span>
          </>
        )}
        {game.available ? (
          <Link className="btn primary" to={`/play/${game.id}`} style={{ marginLeft: 'auto' }}>
            Play {game.name}
          </Link>
        ) : (
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {game.name} is coming soon
          </span>
        )}
      </div>

      {/* The board is drawn on a canvas, so the same results are here for screen readers. */}
      <table className="sr-only" aria-live="polite">
        <caption>{game.name} leaderboard, sample data</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col">{game.scoreUnit}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.player}>
              <td>{i + 1}</td>
              <td>@{r.player}</td>
              <td>{formatScoreFor(game, r.score)}</td>
            </tr>
          ))}
          <tr>
            <td>-</td>
            <td>You, this device</td>
            <td>{best > 0 ? formatScoreFor(game, best) : 'none yet'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
