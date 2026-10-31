import { SAMPLE_LEADERBOARDS } from '../data/sample';
import type { GameDefinition } from '../games/types';
import { formatScoreFor } from '../lib/format';

/** One game's leaderboard. Rankings are sample data until the server exists; the device best is real. */
export default function Leaderboard({ game, best, limit = 10 }: { game: GameDefinition; best: number; limit?: number }) {
  const rows = SAMPLE_LEADERBOARDS[game.id].slice(0, limit);
  const fmt = (n: number) => formatScoreFor(game, n);
  return (
    <section className="card" aria-labelledby={`lb-${game.id}`}>
      <div className="board-head">
        <h3 id={`lb-${game.id}`}>{game.name} leaderboard</h3>
        {rows.length > 0 ? (
          <span className="sample-badge" title="Made-up players and scores for the mockup">SAMPLE DATA</span>
        ) : (
          <span className="sample-badge">THIS DEVICE ONLY</span>
        )}
      </div>
      {rows.length > 0 ? (
        <ol className="board">
          {rows.map((r, i) => (
            <li key={r.player} className={i === 0 ? 'first' : undefined}>
              <span className="rank">{i + 1}</span>
              <span>@{r.player}</span>
              <span className="score">{fmt(r.score)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>No online rankings yet: they need the server. Your own best is below.</p>
      )}
      <ol className="board" aria-label="Your best">
        <li>
          <span className="rank">—</span>
          <span className="you">You · this device</span>
          <span className="score">{best > 0 ? fmt(best) : '—'}</span>
        </li>
      </ol>
      <p className="muted" style={{ fontSize: 12 }}>
        {game.lowerIsBetter ? 'Lower times are better. ' : ''}Real rankings arrive with the online leaderboard. Your best is saved in this browser only.
      </p>
    </section>
  );
}
