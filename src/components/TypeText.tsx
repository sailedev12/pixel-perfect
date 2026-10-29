import { useEffect, useState } from 'react';

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Types its text out one character at a time after `delay` ms, with a block cursor. */
export default function TypeText({ text, delay = 0, speed = 38 }: { text: string; delay?: number; speed?: number }) {
  const [n, setN] = useState(() => (reduced() ? text.length : 0));
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced()) {
      setN(text.length);
      return;
    }
    setN(0);
    setTyping(false);
    let i = 0;
    let tick = 0;
    const start = window.setTimeout(() => {
      setTyping(true);
      tick = window.setInterval(() => {
        i++;
        setN(i);
        if (i >= text.length) window.clearInterval(tick);
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(tick);
    };
  }, [text, delay, speed]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, n)}
        {typing && n < text.length && <span className="caret" />}
      </span>
    </>
  );
}
