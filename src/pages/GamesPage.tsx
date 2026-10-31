import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GAMES } from '../games/registry';
import { stage } from '../stage/stage';
import type { CabinetMode } from '../stage/scenes/cabinetScene';

export default function GamesPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CabinetMode>('idle');

  // The cabinet itself lives on the shared particle stage behind this page.
  useEffect(() => stage.cabinet?.setHandlers({ onPlay: (id) => navigate(`/play/${id}`), onModeChange: setMode }), [navigate]);

  return (
    <div className="games-page">
      <h1 className="sr-only">Games</h1>
      <div className="game-strip ui-fade" style={{ '--d': '250ms' } as CSSProperties}>
        <div className="chips">
          {GAMES.map((g) =>
            g.available ? (
              <Link key={g.id} className="chip" to={`/play/${g.id}`}>
                <span className="swatch" style={{ background: g.color }} />
                Play {g.name}
              </Link>
            ) : (
              <span key={g.id} className="chip soon">
                <span className="swatch" style={{ background: g.color }} />
                {g.name} <em>soon</em>
              </span>
            ),
          )}
        </div>
        <div className="hint">{mode === 'idle' ? 'hover the cabinet to tune it in · click to step inside' : 'click a game to play it'}</div>
      </div>
    </div>
  );
}
