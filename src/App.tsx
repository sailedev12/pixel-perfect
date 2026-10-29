import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import GamesPage from './pages/GamesPage';
import LeaderboardsPage from './pages/LeaderboardsPage';
import LivePage from './pages/LivePage';
import YouPage from './pages/YouPage';
import PlayPage from './pages/PlayPage';
import NotFound from './pages/NotFound';
import StageLayer from './stage/StageLayer';
import SoundToggle from './components/SoundToggle';

/** How long the old page's text takes to fade out before the new page's text fades in. */
const FADE_OUT_MS = 160;

export default function App() {
  const location = useLocation();
  // The particles react to the new URL straight away (StageLayer reads it directly);
  // the page text cross-fades a moment behind.
  const [shown, setShown] = useState(location);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (location.pathname === shown.pathname) {
      setShown(location);
      return;
    }
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(location);
      setLeaving(false);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(id);
  }, [location, shown.pathname]);

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        <StageLayer />
        <SoundToggle />
        <div className={leaving ? 'page-shell leaving' : 'page-shell'}>
          <Routes location={shown}>
            <Route path="/" element={<GamesPage />} />
            <Route path="/leaderboards" element={<LeaderboardsPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/you" element={<YouPage />} />
            <Route path="/play/:gameId" element={<PlayPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
