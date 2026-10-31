import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DANCE_LENGTH, dance } from '../lib/dance';

/** Hook: whether dance mode is on. */
export function useDancing() {
  const [on, setOn] = useState(dance.on);
  useEffect(() => dance.subscribe(setOn), []);
  return on;
}

/**
 * Corner button with a little dancing figure. Clicking it turns the dots into a dancer for 30 seconds of music;
 * while she dances everything else fades away, and the button becomes a quiet "stop".
 */
export default function DanceToggle() {
  const { pathname } = useLocation();
  const on = useDancing();

  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') dance.stop(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);

  // Games have the screen to themselves.
  if (pathname.startsWith('/play')) return null;

  return (
    <>
      <button
        type="button"
        className={on ? 'dance-toggle on' : 'dance-toggle'}
        aria-pressed={on}
        aria-label={on ? 'Stop the dance' : 'Play the dance'}
        title={on ? 'Stop (Esc)' : 'Dance'}
        onPointerEnter={() => dance.prepare()}
        onFocus={() => dance.prepare()}
        onClick={() => (on ? dance.stop() : dance.start())}
      >
        {on ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        ) : (
          <svg className="dancer-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="10.5" cy="3.6" r="1.7" fill="currentColor" stroke="none" />
            <path d="M10.2 6.2l-0.6 4.6" />
            <path d="M10 7.2l3.6-3" />
            <path d="M10 7.4l-3.4 1.8-1.2-2.4" />
            <path d="M7.4 10.6h4.4l-0.6 1.8h-3.2z" fill="currentColor" />
            <path d="M8.6 12.4l-1.4 5" />
            <path d="M10.6 12.4l2.2 2.6-0.4 2.6" />
          </svg>
        )}
      </button>
      {on && (
        <div className="dance-credit" role="note">
          <span className="dance-note">♪</span> LLow – i can hear you [NCS Release]
          <span className="muted"> · Music provided by </span>
          <a href="https://ncs.io" target="_blank" rel="noreferrer">NoCopyrightSounds</a>
          <span className="dance-progress" style={{ animationDuration: `${DANCE_LENGTH}s` }} />
        </div>
      )}
    </>
  );
}
