import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import TypeText from '../components/TypeText';
import { GAMES } from '../games/registry';
import { formatScoreFor } from '../lib/format';
import { getBest } from '../lib/scores';

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export default function YouPage() {
  return (
    <div className="page page-side">
      <div className="eyebrow">
        <TypeText text="YOU" delay={100} speed={30} />
      </div>
      <h1 className="page-title">
        <TypeText text="Your personal bests" delay={160} speed={18} />
      </h1>
      <p className="muted ui-fade" style={delay(250)}>
        Saved in this browser only. Accounts and a public profile come with the online leaderboard.
      </p>
      <div className="table-wrap ui-fade" style={delay(320)}>
        <table>
          <thead>
            <tr>
              <th scope="col">GAME</th>
              <th scope="col" className="num">BEST</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {GAMES.map((g, i) => {
              const best = getBest(g.id, g.rulesVersion);
              return (
                <tr key={g.id} className="ui-fade" style={delay(380 + i * 70)}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="swatch" style={{ background: g.color }} />
                      {g.name}
                    </span>
                  </td>
                  <td className="num">{best > 0 ? formatScoreFor(g, best) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {g.available ? <Link to={`/play/${g.id}`}>Play</Link> : <span className="muted">Soon</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
