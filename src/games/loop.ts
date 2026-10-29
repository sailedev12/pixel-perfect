/**
 * Fixed-timestep loop: game logic always advances in equal steps (60 per second by default),
 * so a 60 Hz laptop and a 120 Hz phone play the same. Drawing happens once per display frame,
 * with `alpha` saying how far we are between the last two steps (for smooth motion).
 */
export function createLoop(step: (dtMs: number) => void, render: (alpha: number) => void, hz = 60) {
  const dt = 1000 / hz;
  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  const frame = (now: number) => {
    if (!running) return;
    // Cap long gaps (tab switch, breakpoint) so the game doesn't jump ahead.
    const delta = Math.min(now - last, 250);
    last = now;
    acc += delta;
    while (acc >= dt && running) {
      step(dt);
      acc -= dt;
    }
    if (!running) return;
    render(acc / dt);
    raf = requestAnimationFrame(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      acc = 0;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get running() {
      return running;
    },
  };
}
