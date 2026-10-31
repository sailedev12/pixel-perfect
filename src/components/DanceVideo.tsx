import { useEffect, useRef } from 'react';
import { dance } from '../lib/dance';
import { BREAK, DROP, danceVideo } from '../lib/danceVideo';

// The dancer's motion: a rendered video of the particle girl. It's never shown itself; the particle stage reads
// its frames and builds her out of sand (see emitFromVideo in danceScene.ts). Two copies of the video play in
// turn so its dance section can loop seamlessly, and which part plays is worked out from the song's clock.
const SRC = '/video/dancer.mp4';

// Moments in the video (seconds).
const LOOP_A = 3.27; // she's fully formed and dancing; this pose matches...
const LOOP_B = 8.27; // ...this one, so the dance loops between them
const VID_END = 10.4; // from LOOP_B to here she blows away
const L = LOOP_B - LOOP_A;
const XF = 0.3; // crossfade at the loop seam

// Moments in the song (seconds into the clip).
const START = 0.35; // the video starts as the cabinet's dots arrive
// (BREAK: the bass drops out and she blows away; DROP: it slams back and she snaps back. See danceVideo.ts.)
// On the drop she snaps straight back into her dance, in the pose she blew away from, at dancing speed from the very
// first frame (no fast-forwarded reforming, which looked like she was rushing to catch up with the beat). Her sand
// sweeps in over SNAP seconds.
const SNAP = 0.35;
// The first dance section fits exactly 4 loops, so it ends on the pose the blow-away starts from.
const D1 = START + LOOP_A;
const R1 = (4 * L) / (BREAK - D1);
const BREAK_RATE = (VID_END - LOOP_B) / (DROP - 0.1 - BREAK);
// After the drop: one loop, then she blows away as the song ends (OUTRO), with time to finish before the clip does.
const OUTRO = 28.7;
const R2 = L / (OUTRO - DROP);

const smooth = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

interface Play { v: number; rate: number; alpha: number }

/** What each of the two videos should show at song time t: where in the video, how fast, how visible. */
function plan(t: number): [Play | null, Play | null] {
  if (t < START) return [null, null];
  // Forming at the start.
  if (t < D1) return [{ v: t - START, rate: 1, alpha: smooth((t - START) / 0.4) }, null];
  // Blowing away in the break (carrying on from the last loop's video, which ends on the right pose).
  if (t >= BREAK && t < DROP) {
    const v = Math.min(VID_END - 0.05, LOOP_B + (t - BREAK) * BREAK_RATE);
    return [null, { v, rate: BREAK_RATE, alpha: 1 - smooth((t - (DROP - 0.45)) / 0.35) }];
  }
  // Blowing away at the end.
  if (t >= OUTRO) {
    const v = Math.min(VID_END - 0.05, LOOP_B + (t - OUTRO) * 1.3);
    return [{ v, rate: 1.3, alpha: 1 - smooth((v - (VID_END - 0.9)) / 0.8) }, null];
  }
  // Dancing: loop after loop, the next copy fading in over the last moment of each one.
  const [start, rate] = t < BREAK ? [D1, R1] : [DROP, R2];
  const k = (t - start) * rate, i = Math.floor(k / L), ph = k - i * L;
  const out: [Play | null, Play | null] = [null, null];
  const cur: Play = { v: LOOP_A + ph, rate, alpha: 1 };
  out[i % 2] = cur;
  if (ph > L - XF) {
    const a = smooth((ph - (L - XF)) / XF);
    out[(i + 1) % 2] = { v: LOOP_A - (L - ph), rate, alpha: a };
    cur.alpha = 1 - a;
  }
  if (t >= DROP && t < DROP + SNAP) for (const p of out) if (p) p.alpha *= smooth((t - DROP) / SNAP);
  return out;
}

export default function DanceVideo({ on }: { on: boolean }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const vids = [a.current!, b.current!];
    if (!on) {
      for (const v of vids) v.pause();
      danceVideo.el = null;
      danceVideo.alpha = 0;
      danceVideo.unformed = 0;
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = dance.time();
      const p = plan(t);
      // A copy that isn't showing waits, ready, where it will start next: her first pose (for the drop) during the
      // break, otherwise the start of the next loop. That way it never fades in on a frame that's still loading.
      const park = t >= BREAK && t < DROP ? LOOP_A : LOOP_A - XF;
      vids.forEach((v, i) => {
        const want = p[i];
        if (!want) {
          if (!v.paused) v.pause();
          if (!v.seeking && Math.abs(v.currentTime - park) > 0.05) v.currentTime = park;
          return;
        }
        if (Math.abs(v.playbackRate - want.rate) > 0.01) v.playbackRate = want.rate;
        // Stay in step with the song: jump only if it has drifted noticeably, and never while a jump is still
        // loading (jumping again then would keep it stuck loading forever).
        if (!v.seeking && Math.abs(v.currentTime - want.v) > 0.35 * Math.max(1, want.rate)) v.currentTime = want.v;
        if (v.paused) void v.play().catch(() => {});
      });
      // Tell the particle stage which copy is most visible, so particles come off the right one.
      const best = (p[0]?.alpha ?? 0) >= (p[1]?.alpha ?? 0) ? 0 : 1;
      danceVideo.el = p[best] ? vids[best] : null;
      danceVideo.alpha = p[best]?.alpha ?? 0;
      // How far she is from fully formed: blowing away at the end of the video, or rising out of the column at its
      // start (on the drop, and when she first appears).
      const v = p[best]?.v ?? 0;
      danceVideo.unformed = p[best] ? Math.max(smooth((v - (LOOP_B + 0.25)) / 0.6), 1 - smooth((v - (LOOP_A - 1.5)) / 1.3)) : 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  return (
    <div className={on ? 'dance-video on' : 'dance-video'} aria-hidden="true">
      <video ref={a} src={SRC} muted playsInline preload="auto" />
      <video ref={b} src={SRC} muted playsInline preload="auto" />
    </div>
  );
}
