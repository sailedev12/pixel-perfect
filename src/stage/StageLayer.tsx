import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { stage, type SceneName } from './stage';

const sceneFor = (path: string): SceneName => {
  if (path === '/') return 'cabinet';
  if (path.startsWith('/leaderboards')) return 'board';
  if (path.startsWith('/live')) return 'live';
  if (path.startsWith('/you')) return 'you';
  if (path.startsWith('/play')) return 'off';
  return 'ambient';
};

/** The one particle canvas that sits behind every page and morphs between tabs. */
export default function StageLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    stage.mount(ref.current!);
    return () => stage.unmount();
  }, []);

  useEffect(() => {
    stage.show(sceneFor(pathname));
  }, [pathname]);

  return (
    <div className="stage-layer">
      <canvas ref={ref} className="stage-canvas" aria-hidden="true" />
    </div>
  );
}
