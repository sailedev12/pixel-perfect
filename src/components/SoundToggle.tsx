import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { uiSound } from '../lib/uiSound';

/** Small speaker button in the top-right corner. The game player has its own, so it hides there. */
export default function SoundToggle() {
  const { pathname } = useLocation();
  const [muted, setMuted] = useState(uiSound.muted);
  useEffect(() => uiSound.subscribe(setMuted), []);
  if (pathname.startsWith('/play')) return null;

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={!muted}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => uiSound.setMuted(!muted)}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7h3l4-3v10l-4-3H3z" />
        {muted ? (
          <path d="M13 7l3 4M16 7l-3 4" />
        ) : (
          <>
            <path d="M12.5 6.5a3.5 3.5 0 0 1 0 5" />
            <path d="M14.5 4.5a6.4 6.4 0 0 1 0 9" />
          </>
        )}
      </svg>
    </button>
  );
}
