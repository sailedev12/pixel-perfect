import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import DanceVideo from '../components/DanceVideo';
import { dance } from '../lib/dance';
import { stage, type SceneName } from './stage';

const sceneFor = (path: string): SceneName => {
  if (path === '/') return 'cabinet';
  if (path.startsWith('/leaderboards')) return 'board';
  if (path.startsWith('/live')) return 'live';
  if (path.startsWith('/you')) return 'you';
  return 'ambient';
};

/** The one particle canvas that sits behind every page and morphs between tabs. */
export default function StageLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [dancing, setDancing] = useState(dance.on);

  useEffect(() => {
    stage.mount(ref.current!);
    return () => stage.unmount();
  }, []);

  useEffect(() => dance.subscribe(setDancing), []);

  // Going to another page ends the dance.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else dance.stop();
  }, [pathname]);

  // Before the page paints: start the morph, then (while she dances) let the canvas cover the whole window,
  // sidebar included. In that order, the dots on screen are frozen first and stay put as the canvas grows.
  useLayoutEffect(() => {
    if (dancing) stage.show('dance', false);
    // Playing a game happens on the cabinet's screen, so /play shows the cabinet too, without its menu clicks.
    else stage.show(pathname.startsWith('/play') ? 'cabinet' : sceneFor(pathname), pathname === '/');
    layer.current?.classList.toggle('full', dancing);
  }, [pathname, dancing]);

  return (
    <div ref={layer} className="stage-layer">
      <canvas ref={ref} className="stage-canvas" aria-hidden="true" />
      <DanceVideo on={dancing} />
    </div>
  );
}
