import type { CSSProperties } from 'react';
import TypeText from '../components/TypeText';
import { getGame } from '../games/registry';
import { SAMPLE_LIVE, formatScore } from '../data/sample';

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export default function LivePage() {
  return (
    <div className="page page-side">
      <div className="eyebrow">
        <TypeText text="LIVE" delay={100} speed={30} />
      </div>
      <h1 className="page-title">
        <TypeText text="Record attempts, live" delay={160} speed={18} />
      </h1>
      <p className="muted ui-fade" style={delay(250)}>
        Watching other players chase records arrives in a later release. This is what the page will hold.
      </p>
      <div className="ui-fade" style={delay(300)}>
        <span className="sample-badge">SAMPLE DATA</span>
      </div>
      <div className="live-grid">
        {SAMPLE_LIVE.map((r, i) => {
          const g = getGame(r.game)!;
          return (
            <article key={r.player} className="card ui-fade" style={delay(350 + i * 90)}>
              <div className="thumb">[ stream · {g.name} ]</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="live-dot" aria-hidden="true" />@{r.player}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {g.name} · {formatScore(r.watching)} watching
                  </div>
                </div>
                <div className="mono" style={{ color: g.color, fontSize: 14 }}>{r.pace}</div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
