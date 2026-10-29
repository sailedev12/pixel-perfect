import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** A row of toggle buttons with a highlight that slides to the selected one. */
export default function Segmented({
  options,
  value,
  onChange,
  label,
  className = '',
  style,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange(id: string): void;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const index = options.findIndex((o) => o.id === value);

  useLayoutEffect(() => {
    const measure = () => {
      const b = ref.current?.querySelectorAll('button')[index] as HTMLElement | undefined;
      setPill(b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [index]);

  return (
    <div className={`segmented sliding ${className}`} style={style} role="group" aria-label={label} ref={ref}>
      {pill && <span className="seg-pill" aria-hidden="true" style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h }} />}
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
