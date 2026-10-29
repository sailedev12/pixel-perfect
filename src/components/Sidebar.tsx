import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Games' },
  { to: '/leaderboards', label: 'Leaderboards' },
  { to: '/live', label: 'Live' },
  { to: '/you', label: 'You' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const listRef = useRef<HTMLUListElement>(null);
  const [mark, setMark] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Playing a game counts as being in Games.
  const activeIndex = TABS.findIndex((t) => (t.to === '/' ? pathname === '/' || pathname.startsWith('/play/') : pathname.startsWith(t.to)));

  // A highlight slides to the active tab instead of jumping.
  useLayoutEffect(() => {
    const measure = () => {
      const li = listRef.current?.children[activeIndex] as HTMLElement | undefined;
      setMark(li ? { x: li.offsetLeft, y: li.offsetTop, w: li.offsetWidth, h: li.offsetHeight } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIndex]);

  return (
    <nav className="sidebar" aria-label="Main">
      <NavLink to="/" className="logo" aria-label="Pixel Perfect home">
        <LogoMark />
        <span>Pixel Perfect</span>
      </NavLink>
      <ul className="tabs" ref={listRef}>
        {TABS.map((t, i) => {
          const active = i === activeIndex;
          return (
            <li key={t.to}>
              <NavLink to={t.to} className={active ? 'tab active' : 'tab'} aria-current={active ? 'page' : undefined}>
                <span className="tab-dot" aria-hidden="true" />
                {t.label}
              </NavLink>
            </li>
          );
        })}
        {mark && (
          <li
            className="tab-mark"
            aria-hidden="true"
            style={{ transform: `translate(${mark.x}px, ${mark.y}px)`, width: mark.w, height: mark.h }}
          />
        )}
      </ul>
    </nav>
  );
}

function LogoMark() {
  const dots: [number, number, string][] = [
    [4, 4, '#ff4d2e'],
    [10, 4, '#ffb020'],
    [16, 4, '#3ddc97'],
    [4, 10, '#3fa7ff'],
    [10, 10, '#ffffff'],
    [16, 10, '#b57bff'],
    [10, 16, '#ff5fa2'],
  ];
  return (
    <svg className="logo-mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {dots.map(([x, y, c], i) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={c} style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </svg>
  );
}
