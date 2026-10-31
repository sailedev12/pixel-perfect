// Dance mode: the dots become an anime-style girl dancing to the song, floating in a field of glowing orbs,
// with a pulsing floor ring, sparks off her hands on the big beats, and a camera that moves with the music.
//
// How it works: a 3D skeleton is posed every frame from a routine of key poses timed to the beat. Arms are
// placed by where the hands should be (two-bone IK), legs by where the feet stand. About 90,000 dots, spaced
// evenly about 5 mm apart (finer on her face and hands), cover her body, face, hair and clothes. They're drawn as
// solid dots that hide what's behind them, so she looks like one solid figure made of particles, lit like a CGI
// character (key light, violet fill, pink rim, highlights). Clothes get their pattern from the dots' colors: a
// ribbed crop top, a plaid pleated skirt that drapes over her legs, striped thigh-high socks, sneakers. Her hair
// is a cap, bangs and side locks stretched between strands that swing with physics, and two thick twin-tails.
import { DANCE_LENGTH, dance } from '../../lib/dance';
import { BREAK, DROP, danceVideo } from '../../lib/danceVideo';
import { Dust, Scene, clamp01, type Env } from '../scene';
import type { Aura } from '../renderer';
import { SH, SW, scan, type ScanResult } from './sandScan';

// The dancer is now the reference video (see components/DanceVideo.tsx), layered over this scene. Her particle
// body below is kept but switched off; this scene still draws the orbs and dust around her.
const PARTICLE_GIRL = false;

// ---- the song's timing (measured from the clip) ----
/** Beats per minute of the song. */
export const BPM = 115;
/** Seconds into the clip of the first beat of a bar (beat 0). The music lifts at beat 12, the bass drops out
 *  for beats 41-43 and slams back on beat 44; the clip fades out from about beat 51. */
export const BEAT0 = 1.322;

// ---- how finely she's made ----
/** Distance between neighbouring dots on her body, in meters (finer on her face and hands, coarser in her hair). */
const SP = 0.0052, FACE_SP = 0.0032, HAND_SP = 0.0034, HAIR_SP = 0.006;
/** How big each dot is, in meters: a little bigger than the gaps, so she looks solid and nothing shows through. */
const DOT = SP * 1.5;
// Hair strands (simulated): bangs, side locks, back, and the two twin-tails.
const N_BANG = 16, N_SIDE = 8, N_BACK = 36, N_TWIN = 26;
const STRANDS = N_BANG + N_SIDE + N_BACK + N_TWIN * 2;
const NODES = 14;
const ORBS = 2600, RING = 1400, SPARKS = 700, DUST = 500;
// Big soft out-of-focus lights drifting in front of her (just before the dust).
const FRONT = 70;
// Sand on the video dancer (it reuses the first of her old body's dots): how many grains at most, how many are
// born each frame (static on her, and grains blowing off her edges), and the size of the little copy of the video
// used to find her body.
const EMIT = 76000, STREAMS_PER_FRAME = 70, FLICKER_PER_FRAME = 7600;
// The last POOL_N of those grains make the floor: a symbolic ring of sand around her (the video's own puddle is left
// out; FLOOR_ROW is where the floor is, as a fraction of the video's height).
const POOL_N = 4500, FLOOR_ROW = 0.885;
// Where the floor sits across the video (a column of the little copy): where her feet are while she dances. It's
// fixed, so the floor never slides, not even when she blows away and her sand drifts off sideways.
const FLOOR_COL = 181;
/** The widest her two legs together ever really are (columns in the little copy of the video). While she's
 *  still forming she's a wide blurry column; capping keeps the video's puddle out of the sand then too. */
const LEGS_MAX = 36;
// After her sand grains, COLUMN dots make the glowing column where she appears: the cabinet's dots stream into it
// (only these travel; her sand forms in place), and it fades as she takes shape out of it.
const COLUMN = 15000;
/** How much her stomach and waist are slimmed at the narrowest point (0.2 = a fifth narrower). */
const WAIST_PINCH = 0.2;

// Color classes. Her body, hair and clothes are solid (they hide what's behind them); the rest glow.
const C_SKIN = 0, C_HAIR = 1, C_CLOTH = 2, C_ORB = 3, C_RING = 4, C_DUST = 5, C_SPARK = 6, C_ASH = 7, C_SAND = 8, C_SAND_GLOW = 9, C_BOKEH = 10;
// Her own dots get a soft halo too: the same blurry glow the cabinet has.
// Sand has no glow: fine grains like the cabinet's static.
const GLOW = [1.7, 1.7, 1.7, 3.2, 1.6, 0, 2.2, 1.8, 0, 2.6, 0];
const SOLID = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
/**
 * The camera's shots while she dances, one per phrase (2 bars), in turn: how far it's zoomed in, where it's moved to
 * (across and down, as a fraction of the screen's height), and how far it's tilted, at the start and end of the
 * phrase. Between phrases it whips over to the next shot with a quick springy move.
 */
type Shot2d = { z: [number, number]; x: [number, number]; y: [number, number]; r: [number, number] };
const SHOTS_2D: Shot2d[] = [
  { z: [1.02, 1.12], x: [0, 0], y: [0, 0.01], r: [0, 0] }, // a slow push in on her whole body
  { z: [1.42, 1.48], x: [-0.06, 0.06], y: [0.13, 0.13], r: [0.02, 0.02] }, // close on her top half, sliding across
  { z: [1.08, 1.1], x: [0.08, 0.03], y: [-0.02, -0.02], r: [-0.045, -0.035] }, // off to one side, tilted
  { z: [1.24, 1.2], x: [0, 0], y: [0.05, 0.05], r: [0.03, -0.03] }, // a mid shot, the tilt swinging across
  { z: [1.3, 1.36], x: [0.05, -0.04], y: [0.08, 0.1], r: [-0.02, 0.015] }, // closer, drifting the other way
];
/**
 * Near the end, just before she blows away, the camera circles her once: the world (the orbs behind her, the floor
 * ring, the lights in front) swings all the way around while she keeps facing the camera, like a dancer on a
 * turntable with the camera going round with her. (She's a flat video, so this is how a full 360 can look right.)
 */
const ORBIT_AT = 26.2, ORBIT_LEN = 2.3;
/** How far round the orbit is at song time t (0 to a full turn), easing in and out. */
const orbitAt = (t: number) => { const k = clamp01((t - ORBIT_AT) / ORBIT_LEN); return Math.PI * 2 * k * k * (3 - 2 * k); };
/** Camera springiness: how strongly it pulls toward its shot, and how much it's held back (a slight overshoot). */
const CAM_K = 22, CAM_D = 2 * 0.72 * Math.sqrt(CAM_K);

/** Colors of the lights drifting in front of her: her neon pink, gold, lilac, and the floor's cyan. */
const BOKEH: V3[] = [[255, 120, 200], [255, 200, 110], [190, 150, 255], [110, 220, 255]];

type V3 = [number, number, number];
type M3 = number[]; // 3x3 rotation, row-major

// Base colors (before lighting): all in one purple family, like the reference renders.
const SKIN: V3 = [172, 132, 232];
const TOP: V3 = [116, 62, 198];
const BAND: V3 = [196, 140, 255];
const SKIRT_C: V3 = [104, 52, 186];
const HEM: V3 = [200, 156, 255];
const SHORTS: V3 = [70, 40, 130];
const WARMER: V3 = [188, 176, 222];
const SHOE_C: V3 = [206, 184, 246];
const SOLE: V3 = [236, 222, 255];
const HAIR_ROOT: V3 = [118, 64, 200];
const HAIR_TIP: V3 = [166, 100, 240];
const TIE: V3 = [232, 184, 255];
const POOL: V3 = [150, 84, 240];
const ORB_W: V3 = [255, 252, 240];
const ORB_Y: V3 = [255, 226, 120];
const ORB_P: V3 = [255, 170, 230];
const GOLD: V3 = [255, 216, 120];
// Lights: a soft violet ambient, a warm white key light, a violet fill from the other side, and a pink rim.
const AMB: V3 = [0.26, 0.19, 0.38];
const KEY: V3 = [0.9, 0.82, 0.92];
const FILL: V3 = [0.45, 0.28, 0.85];
const RIM: V3 = [190, 120, 255];

// ---------- small 3D helpers (used per joint, not per dot) ----------
const rotY = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotX = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotZ = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mul = (A: M3, B: M3): M3 => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
};
/** Yaw, then pitch, then roll. */
const euler = (yaw: number, pitch: number, roll: number) => mul(mul(rotY(yaw), rotX(pitch)), rotZ(roll));
const app = (M: M3, x: number, y: number, z: number): V3 => [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
/** The inverse rotation (world direction into the frame's own axes). */
const appT = (M: M3, x: number, y: number, z: number): V3 => [M[0] * x + M[3] * y + M[6] * z, M[1] * x + M[4] * y + M[7] * z, M[2] * x + M[5] * y + M[8] * z];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const gauss = (x: number, c: number, w: number) => Math.exp(-((x - c) / w) * ((x - c) / w));
/** 1 right on the beat, falling away after it. */
const hit = (b: number, sharp = 2) => Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * b), sharp);

// ---------- the pose: every number that describes her body at one moment ----------
// Each arm: where the wrist goes (x out from her side, y up from her waist, z forward), which way the elbow
// points, which way the palm faces, wrist bend, how curled the fingers are, and whether the index and
// middle fingers stay straight (point, peace sign).
const ARM = 13;
const P = {
  x: 0, y: 1, z: 2, yaw: 3, pitch: 4, roll: 5,
  cYaw: 6, cPitch: 7, cRoll: 8,
  hYaw: 9, hPitch: 10, hRoll: 11,
  L: 12, R: 12 + ARM,
  lfX: 38, lfZ: 39, lfY: 40, rfX: 41, rfZ: 42, rfY: 43,
  lKnee: 44, rKnee: 45, face: 46, look: 47,
} as const;
const NP = 48;
type Pose = Float32Array;

// Arm shapes (x is measured outward from her side, so the same shape works for either arm).
//                  wrist x, y, z       elbow toward       palm faces       bend  curl index middle
const RELAX = [0.2, -0.17, 0.03, 0.3, 0, -1, -1, 0, 0.15, 0.1, 0.35, 0, 0];
const HAIRHAND = [0.05, 0.63, -0.04, 1, 0.7, 0.1, -0.2, -1, 0, 0.2, 0.45, 0, 0];
const UP = [0.1, 0.8, 0.04, 1, 0, 0, -1, 0, 0.3, 0, 0.2, 0, 0];
const CHIN = [0.06, 0.37, 0.15, 0.3, -1, 0.3, 0, 0, -1, 0.3, 0.55, 0, 0];
const SIDE = [0.55, 0.3, 0.06, 0, -1, -0.3, 0, -1, 0.2, 0, 0.25, 0, 0];
const SIDE_LO = [0.5, 0.08, 0.08, 0, -1, -0.2, 0, -1, 0, 0, 0.2, 0, 0];
const LOOK_HAND = [0.06, 0.33, 0.32, 0.6, -1, 0, 0, 1, 0.2, 0.2, 0.3, 0, 0];

/** Sets one arm (side 1 = her left, -1 = her right) to shape A, or partway from A to B, plus a nudge. */
function arm(o: Pose, side: number, A: number[], B: number[] = A, k = 0, dx = 0, dy = 0, dz = 0) {
  const base = side > 0 ? P.L : P.R;
  for (let i = 0; i < ARM; i++) o[base + i] = mix(A[i], B[i], k);
  o[base] += dx; o[base + 1] += dy; o[base + 2] += dz;
}

function basePose(o: Pose) {
  o.fill(0);
  arm(o, 1, RELAX);
  arm(o, -1, RELAX);
  o[P.lfX] = 0.1; o[P.rfX] = -0.1;
  o[P.y] = -0.015;
  o[P.look] = 0.6;
}

/** Weight on one leg (w = 1 her left, -1 her right): that hip lifts, the other knee softens, shoulders counter. */
function weight(o: Pose, w: number, dip = 0) {
  o[P.x] += 0.045 * w;
  o[P.roll] += 0.11 * w;
  o[P.cRoll] += -0.08 * w;
  o[P.hRoll] += 0.04 * w;
  const fl = Math.max(0, -w), fr = Math.max(0, w);
  o[P.lfY] += 0.03 * fl; o[P.lfZ] += 0.045 * fl; o[P.lfX] -= 0.035 * fl;
  o[P.rfY] += 0.03 * fr; o[P.rfZ] += 0.045 * fr; o[P.rfX] += 0.035 * fr;
  o[P.y] += -dip - 0.012 * Math.abs(w);
}

// ---------- the routine ----------
// One continuous dance, written as key poses on the beat. Between keys every joint glides along a smooth curve
// (so nothing jumps from one move to the next), and a steady groove runs underneath the whole song: a bounce on
// every beat, a little head nod, breathing.

/** Standing with her weight on one leg (w = 1 her left, -1 her right). */
function stand(o: Pose, w: number, look = 0.8) {
  basePose(o);
  weight(o, w);
  o[P.look] = look;
}

type Key = [number, (o: Pose) => void];

/** Both arms up high, swaying together and waving (s = 1 or -1 picks the side). */
function wave(o: Pose, s: number) {
  stand(o, 0.6 * s, 0.4);
  arm(o, 1, UP, UP, 0, 0.09 * s);
  arm(o, -1, UP, UP, 0, -0.09 * s);
  o[P.L + 9] = 0.4 * s; o[P.R + 9] = -0.4 * s;
  o[P.hRoll] += 0.08 * s;
}

/** The sway with one hand at her chin and (later) the other behind her head (s = which hand leads). */
function sway(o: Pose, w: number, chin: number, behind: number) {
  stand(o, w, 0.5);
  if (chin) arm(o, chin, CHIN);
  if (behind) arm(o, behind, HAIRHAND);
}

/** The break: looking down at her hand as she starts to blow away. */
function sad(o: Pose) {
  stand(o, -0.3, 0);
  arm(o, -1, LOOK_HAND);
  o[P.hPitch] = 0.32;
  o[P.hYaw] = -0.22;
  o[P.cPitch] = 0.05;
}

const KEYS: Key[] = [
  // Waiting with her head down; she lifts it as the music comes in.
  [-3, (o) => { stand(o, -0.6, 0); o[P.hPitch] = 0.35; }],
  [-1, (o) => { stand(o, -0.6, 0.3); o[P.hPitch] = 0.2; }],
  // Swaying, one hand at her chin, then the other hand up behind her head.
  [0, (o) => sway(o, -0.8, -1, 0)],
  [1, (o) => sway(o, 0.8, -1, 0)],
  [2, (o) => { sway(o, -0.8, 0, 0); arm(o, -1, CHIN, HAIRHAND, 0.6); }],
  [3, (o) => { sway(o, 0.8, 0, -1); arm(o, 1, RELAX, CHIN, 0.6); }],
  [4, (o) => sway(o, -0.8, 1, -1)],
  [5, (o) => sway(o, 0.8, 1, -1)],
  [6, (o) => { stand(o, -0.7, 0.5); arm(o, -1, HAIRHAND, UP, 0.5); arm(o, 1, CHIN, UP, 0.4); }],
  [7, (o) => { stand(o, 0.7, 0.4); arm(o, 1, UP); arm(o, -1, UP); }],
  // Both arms up high, waving.
  ...[8, 9, 10, 11, 12, 13, 14, 15].map((b): Key => [b, (o) => wave(o, b % 2 ? -1 : 1)]),
  // Arms swinging out to the sides.
  [16, (o) => { stand(o, 0.8, 0.5); arm(o, 1, SIDE); }],
  [17, (o) => { stand(o, -0.4, 0.5); arm(o, 1, SIDE, UP, 0.3); arm(o, -1, RELAX, SIDE, 0.3); }],
  [18, (o) => { stand(o, -0.8, 0.5); arm(o, -1, SIDE); }],
  [19, (o) => { stand(o, 0.4, 0.5); arm(o, -1, SIDE, UP, 0.3); arm(o, 1, RELAX, SIDE, 0.3); }],
  [20, (o) => { stand(o, 0.8, 0.5); arm(o, 1, SIDE); arm(o, -1, SIDE); }],
  [21, (o) => { stand(o, -0.8, 0.5); arm(o, 1, SIDE, SIDE_LO, 0.6); arm(o, -1, SIDE, SIDE_LO, 0.6); }],
  [22, (o) => sway(o, 0.8, 1, 0)],
  [23, (o) => sway(o, -0.8, 1, 0)],
  // The sway again, the other way round.
  [24, (o) => sway(o, 0.8, 1, 0)],
  [25, (o) => { sway(o, -0.8, 0, 0); arm(o, 1, CHIN, HAIRHAND, 0.6); }],
  [26, (o) => { sway(o, 0.8, 0, 1); arm(o, -1, RELAX, CHIN, 0.6); }],
  [27, (o) => sway(o, -0.8, -1, 1)],
  [28, (o) => sway(o, 0.8, -1, 1)],
  [29, (o) => sway(o, -0.8, -1, 1)],
  [30, (o) => { stand(o, 0.7, 0.5); arm(o, 1, HAIRHAND, UP, 0.5); arm(o, -1, CHIN, UP, 0.4); }],
  [31, (o) => { stand(o, -0.7, 0.4); arm(o, 1, UP); arm(o, -1, UP); }],
  // Arms up and waving again, building up.
  ...[32, 33, 34, 35, 36, 37, 38, 39].map((b): Key => [b, (o) => wave(o, b % 2 ? -1 : 1)]),
  [40, (o) => { stand(o, -0.3, 0.3); arm(o, -1, UP, LOOK_HAND, 0.6); }],
  // The break: she looks at her hand as she fades away on the wind...
  [41, (o) => sad(o)],
  [43.9, (o) => sad(o)],
  // ...and snaps back on the drop, arms up.
  [44.3, (o) => { stand(o, 0, 0.5); arm(o, 1, UP); arm(o, -1, UP); }],
  [45, (o) => wave(o, 1)],
  [46, (o) => wave(o, -1)],
  [47, (o) => wave(o, 1)],
  [48, (o) => { stand(o, -0.8, 0.5); arm(o, 1, SIDE); arm(o, -1, SIDE); }],
  [49, (o) => { stand(o, 0.8, 0.5); arm(o, 1, SIDE); arm(o, -1, CHIN); }],
  [50, (o) => { stand(o, -0.8, 0.5); arm(o, -1, SIDE); arm(o, 1, CHIN); }],
  // Ending: hand behind her head, the other at her chin.
  [51, (o) => sway(o, 0.7, 1, 0)],
  [52, (o) => sway(o, -0.7, 1, -1)],
  [54, (o) => sway(o, 0.5, 1, -1)],
  [58, (o) => sway(o, 0.5, 1, -1)],
];
const KEY_POSES = KEYS.map(([, f]) => { const o = new Float32Array(NP); f(o); return o; });

/** How hard she grooves at each point in the song (0 = still). */
function energyAt(b: number) {
  if (b < 0) return 0.7 * smooth(b + 1);
  if (b < 8) return 0.7;
  if (b < 41) return 1;
  if (b < 44) return 0.15;
  if (b < 52) return 1;
  return 1 - 0.7 * smooth((b - 52) / 2);
}

/** The pose at beat b: a smooth curve through the key poses, plus the groove on top. */
function poseAt(b: number, o: Pose) {
  const n = KEYS.length;
  let i = 0;
  while (i < n - 2 && b >= KEYS[i + 1][0]) i++;
  const t1 = KEYS[i][0], t2 = KEYS[i + 1][0];
  const t0 = i > 0 ? KEYS[i - 1][0] : t1 - 1, t3 = i + 2 < n ? KEYS[i + 2][0] : t2 + 1;
  const P0 = KEY_POSES[Math.max(0, i - 1)], P1 = KEY_POSES[i], P2 = KEY_POSES[i + 1], P3 = KEY_POSES[Math.min(n - 1, i + 2)];
  const s = clamp01((b - t1) / (t2 - t1)), s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const span = t2 - t1;
  for (let k = 0; k < NP; k++) {
    // Catmull-Rom: each joint passes through every key with a matching speed on both sides of it.
    const m1 = ((P2[k] - P0[k]) / (t2 - t0)) * span, m2 = ((P3[k] - P1[k]) / (t3 - t1)) * span;
    o[k] = h00 * P1[k] + h10 * m1 + h01 * P2[k] + h11 * m2;
  }
  // The groove: a dip on every beat, a nod, a little chest bounce, and breathing.
  const e = energyAt(b), d = hit(b, 2);
  o[P.y] += -0.03 * e * d;
  o[P.hPitch] += 0.045 * e * d;
  o[P.cPitch] += 0.022 * e * d + 0.01 * Math.sin(b * 1.3);
  o[P.cRoll] += 0.015 * e * Math.sin(Math.PI * b);
}

// ---------- camera shots, one per stretch of the song ----------
interface Shot { at: number; yaw: number; yawSpeed: number; pitch: number; dist: number; lookY: number; roll: number; }
const SHOTS: Shot[] = [
  { at: -9, yaw: 0.0, yawSpeed: 0, pitch: 0.04, dist: 4.0, lookY: 0.95, roll: 0 },
  { at: 0, yaw: 0.12, yawSpeed: -0.015, pitch: 0.05, dist: 3.4, lookY: 0.97, roll: 0 },
  { at: 8, yaw: -0.1, yawSpeed: 0.015, pitch: 0.03, dist: 3.2, lookY: 1.02, roll: 0 },
  { at: 16, yaw: 0.18, yawSpeed: -0.01, pitch: 0.04, dist: 3.4, lookY: 0.97, roll: 0 },
  { at: 24, yaw: -0.15, yawSpeed: 0.012, pitch: 0.05, dist: 3.1, lookY: 1.0, roll: 0 },
  { at: 32, yaw: 0.05, yawSpeed: 0, pitch: 0.04, dist: 3.0, lookY: 1.02, roll: 0 },
  { at: 40, yaw: 0.0, yawSpeed: 0, pitch: 0.04, dist: 3.6, lookY: 0.98, roll: 0 }, // wide enough to see her blow away
  { at: 44, yaw: 0.0, yawSpeed: 0, pitch: 0.04, dist: 3.2, lookY: 1.0, roll: 0 },
  { at: 51, yaw: 0.1, yawSpeed: -0.01, pitch: 0.04, dist: 3.6, lookY: 0.97, roll: 0 },
];

// ---------- body shape ----------
// Torso cross-sections from the bottom of the hips to the base of the neck:
// height above the hip joints, half-width, front depth, back depth. Below WAIST it moves with the hips.
const TORSO_PROFILE: [number, number, number, number][] = [
  [-0.11, 0.12, 0.07, 0.08],
  [-0.05, 0.165, 0.085, 0.1],
  [0.02, 0.163, 0.08, 0.09],
  [0.09, 0.135, 0.074, 0.074],
  [0.14, 0.11, 0.068, 0.07],
  [0.2, 0.116, 0.072, 0.075],
  [0.27, 0.128, 0.078, 0.082],
  [0.36, 0.14, 0.076, 0.08],
  [0.42, 0.152, 0.068, 0.074],
  [0.46, 0.115, 0.052, 0.058],
  [0.49, 0.055, 0.038, 0.042],
];
const WAIST = 0.13;
const H0 = -0.11, H1 = 0.49;

function profileAt(h: number, out: number[]) {
  const T = TORSO_PROFILE;
  let i = 1;
  while (i < T.length - 1 && h > T[i][0]) i++;
  const k = smooth((h - T[i - 1][0]) / (T[i][0] - T[i - 1][0]));
  out[0] = mix(T[i - 1][1], T[i][1], k);
  out[1] = mix(T[i - 1][2], T[i][2], k);
  out[2] = mix(T[i - 1][3], T[i][3], k);
}

const prof = [0, 0, 0];
/** Distance from the torso's center line at height h in direction (cv, sv): cv = sideways, sv = forward. */
function torsoRadius(h: number, cv: number, sv: number) {
  profileAt(h, prof);
  const wx = prof[0], d = sv > 0 ? prof[1] : prof[2];
  // A slightly squared-off ellipse.
  const ax = Math.abs(cv), az = Math.abs(sv);
  let r = 1 / Math.pow(Math.pow(ax / wx, 2.3) + Math.pow(az / d, 2.3), 1 / 2.3);
  if (sv > 0) {
    // Bust: two soft rounded shapes, fuller underneath.
    const hb = h < 0.295 ? gauss(h, 0.295, 0.042) : gauss(h, 0.295, 0.06);
    r += 0.036 * hb * (gauss(cv, 0.5, 0.27) + gauss(cv, -0.5, 0.27)) * sv;
    // A soft tummy, a little dip at the navel, and collarbones.
    r += 0.006 * gauss(h, 0.06, 0.05) * sv - 0.004 * gauss(h, 0.12, 0.012) * gauss(cv, 0, 0.12);
    r += 0.004 * gauss(h, 0.43, 0.012) * (gauss(cv, 0.42, 0.22) + gauss(cv, -0.42, 0.22)) * sv;
  } else {
    // Bottom, and the groove of the spine.
    r += 0.032 * gauss(h, -0.035, 0.055) * (gauss(cv, 0.45, 0.3) + gauss(cv, -0.45, 0.3)) * -sv;
    if (h > 0.1) r -= 0.006 * gauss(cv, 0, 0.12) * -sv;
    // Shoulder blades.
    r += 0.008 * gauss(h, 0.36, 0.05) * (gauss(cv, 0.45, 0.22) + gauss(cv, -0.45, 0.22)) * -sv;
  }
  return r;
}

// Limb cross-sections: radius at u along the bone (0 top, 1 bottom) in direction (cv = sideways, sv = forward).
const front = (sv: number) => (sv > 0 ? sv * sv : 0);
const back = (sv: number) => (sv < 0 ? sv * sv : 0);
const thighR = (u: number, _cv: number, sv: number) =>
  mix(0.092, 0.055, smooth(u)) + 0.004 * Math.sin(Math.PI * u) * front(sv) + 0.004 * gauss(u, 0.35, 0.25) * back(sv) + 0.007 * gauss(u, 0.96, 0.04) * front(sv);
const shinR = (u: number, _cv: number, sv: number) =>
  mix(0.054, 0.034, Math.min(1, u * 1.08)) + 0.016 * gauss(u, 0.28, 0.17) * back(sv) + 0.006 * gauss(u, 0.03, 0.05) * front(sv) - 0.003 * gauss(u, 0.5, 0.25) * front(sv);
const uarmR = (u: number, _cv: number, sv: number) =>
  mix(0.041, 0.031, u) + 0.008 * gauss(u, 0.08, 0.11) + 0.003 * gauss(u, 0.45, 0.2) * front(sv) + 0.004 * gauss(u, 0.98, 0.04) * back(sv);
const farmR = (u: number, _cv: number, sv: number) =>
  (mix(0.036, 0.024, Math.pow(u, 0.9)) + 0.005 * gauss(u, 0.22, 0.15)) * (1 - 0.25 * smooth((u - 0.6) / 0.4) * sv * sv);
// The neck widens into the shoulders (the trapezius slope) at its base.
/** Long sleeves: a little looser than the arm, with a ruffled off-shoulder band near the top and a soft cuff. */
const sleeveUp = (u: number, cv: number, sv: number) => uarmR(u, cv, sv) + (u > 0.17 ? 0.004 : 0) + 0.007 * gauss(u, 0.21, 0.035);
const sleeveFore = (u: number, cv: number, sv: number) => farmR(u, cv, sv) + 0.005 + 0.009 * smooth((u - 0.7) / 0.3);
/** Slouchy leg warmers bunched around her ankles. */
const shinWarm = (u: number, cv: number, sv: number) => shinR(u, cv, sv) + (u > 0.66 ? 0.014 * smooth((u - 0.66) / 0.06) + 0.005 * Math.abs(Math.sin(u * 75)) : 0);
const neckR = (u: number, cv: number) => 0.047 - 0.006 * u + 0.03 * Math.pow(Math.max(0, 1 - u / 0.35), 2) * cv * cv;
type Radius = (u: number, cv: number, sv: number) => number;

/**
 * Her colors from head (0) to toe (1), like a neon arcade sign: hot pink hair, a warm gold top, a coral skirt,
 * lilac legs fading into glowing white sneakers (like the reference renders), blending into each other.
 */
const NEON: [number, V3][] = [
  [0.0, [255, 70, 170]],
  [0.24, [255, 90, 160]],
  [0.33, [255, 196, 90]],
  [0.46, [255, 170, 70]],
  [0.52, [255, 96, 96]],
  [0.64, [255, 110, 120]],
  [0.7, [206, 168, 255]],
  [0.88, [186, 150, 255]],
  [0.9, [228, 212, 255]],
  [1.0, [250, 244, 255]],
];
function neon(y: number): V3 {
  if (y <= 0) return NEON[0][1];
  for (let i = 1; i < NEON.length; i++) {
    if (y <= NEON[i][0]) {
      const k = smooth((y - NEON[i - 1][0]) / (NEON[i][0] - NEON[i - 1][0])), a = NEON[i - 1][1], b = NEON[i][1];
      return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
    }
  }
  return NEON[NEON.length - 1][1];
}

/** Thickness of a twin-tail along its length (k = 0 at the tie, 1 at the tip). */
const tailR = (k: number) => 0.046 * Math.pow(Math.sin(Math.PI * Math.min(1, k * 0.92 + 0.1)), 0.6) + 0.004;

// Head size (half-sizes).
const HX = 0.082, HY = 0.104, HZ = 0.093;

// Fingers: index, middle, ring, pinky (offset across the palm toward the thumb, length, thickness), then the thumb.
const FINGERS: [number, number, number][] = [[0.024, 0.07, 0.0085], [0.008, 0.077, 0.0088], [-0.008, 0.072, 0.0084], [-0.023, 0.058, 0.0074], [0, 0.052, 0.0095]];

interface Seg { a: V3; ax: V3; len: number; sd: V3; fr: V3; }
function seg(a: V3, b: V3, ref: V3): Seg {
  const v = sub(b, a);
  const l = len(v) || 0.001;
  const ax = scl(v, 1 / l);
  let sd = cross(ax, ref);
  if (len(sd) < 0.05) sd = cross(ax, [1, 0, 0]);
  sd = norm(sd);
  return { a, ax, len: l, sd, fr: cross(sd, ax) };
}

interface ArmJ { S: V3; el: V3; wr: V3; d: V3; n: V3; t: V3; curl: number; idx: number; mid: number; up: Seg; fore: Seg; }
interface LegJ { ank: V3; fwd: V3; thigh: Seg; shin: Seg; }

// Kinds of body dots, stored in this order (each kind in one block).
const enum K { Head, Cap, Neck, Torso, Skirt, UArmL, FArmL, HandL, UArmR, FArmR, HandR, ThighL, ShinL, ShoeL, ThighR, ShinR, ShoeR, Bangs, Side, Back, Tail, Tie, N }

/** Points spread evenly over a sphere (a Fibonacci spiral). */
function sphere(n: number, f: (x: number, y: number, z: number) => void) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * ga;
    f(Math.cos(a) * r, y, Math.sin(a) * r);
  }
}

/** Builds up the body's dots, one kind at a time. */
class Builder {
  kind: number[] = [];
  a: number[] = []; b: number[] = []; c: number[] = [];
  na: number[] = []; nb: number[] = []; nc: number[] = [];
  col: number[] = [];
  spec: number[] = [];
  cls: number[] = [];
  restY: number[] = [];
  start = new Array<number>(K.N + 1).fill(0);
  private current = -1;
  begin(k: K) { this.start[k] = this.kind.length; this.current = k; }
  end() { this.start[K.N] = this.kind.length; }
  dot(a: number, b: number, c: number, na: number, nb: number, nc: number, col: V3, spec: number, cls: number, restY: number) {
    this.kind.push(this.current);
    this.a.push(a); this.b.push(b); this.c.push(c);
    this.na.push(na); this.nb.push(nb); this.nc.push(nc);
    this.col.push(col[0], col[1], col[2]);
    this.spec.push(spec);
    this.cls.push(cls);
    this.restY.push(restY);
  }
  /**
   * A tube (neck, arm, leg): rings down its length, each with dots spaced evenly around it.
   * Stores u, radius, slope (radius change along it) and the direction around it.
   */
  tube(R: Radius, length: number, sp: number, paint: (u: number, cv: number, sv: number) => [V3, number, number], restY: (u: number) => number, rounded = true, u0 = 0, u1 = 1) {
    const rings = Math.max(4, Math.round((length * (u1 - u0)) / sp));
    const S = 48, rr = new Float32Array(S + 1);
    for (let i = 0; i < rings; i++) {
      // u runs a little past the joints at either end (u0 < 0, u1 > 1) so neighbouring parts overlap.
      const u = u0 + ((i + 0.5) / rings) * (u1 - u0);
      // Rounded ends.
      const capk = !rounded ? 1 : u < 0.06 ? Math.sqrt(1 - Math.pow((0.06 - u) / 0.06, 2)) * 0.6 + 0.4 : u > 0.94 ? Math.sqrt(1 - Math.pow((u - 0.94) / 0.06, 2)) * 0.6 + 0.4 : 1;
      let per = 0;
      for (let s = 0; s <= S; s++) {
        const a = (s / S) * Math.PI * 2;
        rr[s] = R(clamp01(u), Math.cos(a), Math.sin(a)) * capk;
        if (s) per += Math.abs(rr[s] + rr[s - 1]) * 0.5 * ((Math.PI * 2) / S);
      }
      const n = Math.max(6, Math.round(per / sp));
      const offset = (i * 0.618) % 1;
      for (let k = 0; k < n; k++) {
        const a = ((k + offset) / n) * Math.PI * 2;
        const cv = Math.cos(a), sv = Math.sin(a);
        const uc = clamp01(u);
        const r = R(uc, cv, sv) * capk;
        const slope = (R(Math.min(1, uc + 0.02), cv, sv) - R(Math.max(0, uc - 0.02), cv, sv)) / 0.04;
        const [col, spec, cls] = paint(uc, cv, sv);
        this.dot(u, r, slope, cv, sv, 0, col, spec, cls, restY(uc));
      }
    }
  }
}

export class DanceScene extends Scene {
  readonly count: number;
  // Morphing in: the orbs fly out first, then she builds up from her feet to her head.
  morphIn = 1.4;
  morphSpread = 0.9;
  morphEase = 'inOut' as const;
  morphDelay: Float32Array;

  // Her body's dots, worked out once (see Builder): kind, shape numbers, surface direction, color, shine, class.
  private nBody: number;
  private start: number[];
  private ka: Float32Array; private kb: Float32Array; private kc: Float32Array;
  private kna: Float32Array; private knb: Float32Array; private knc: Float32Array;
  private kcol: Float32Array;
  private kspec: Float32Array;
  private kcls: Uint8Array;
  private seed: Float32Array;
  private dust: Dust;

  private pose = new Float32Array(NP);
  private cam = { yaw: 0, pitch: 0.02, dist: 4.2, lookY: 0.95, roll: 0, zoom: 1 };
  private camOrbit = 0;
  private beatPrev = -1;
  private kick = 0;
  private bassAvg = 0;
  private started = 0;
  private lastT = 0;

  // Skirt: swing (lags behind her hips like cloth) and flare (when she spins).
  private skirtSpin = 0;
  private sk = [0, 0];
  private skv = [0, 0];
  private prevPelvis: V3 = [0, 0.9, 0];
  private prevFacing: V3 = [0, 0, 1];

  // Hair strands: rest shape in the head's frame, stiffness, and simulated points.
  private sRest = new Float32Array(STRANDS * NODES * 3);
  private sStiff = new Float32Array(STRANDS);
  private hp = new Float32Array(STRANDS * NODES * 3);
  private hq = new Float32Array(STRANDS * NODES * 3);
  private goal = new Float32Array(STRANDS * NODES * 3);
  private segLen = new Float32Array(STRANDS);
  private hairReady = false;
  private tailStart = [0, 0];
  // Each twin-tail's center line and its frame, worked out every frame from its strands.
  private tc = [new Float32Array(NODES * 3), new Float32Array(NODES * 3)];
  private tn1 = [new Float32Array(NODES * 3), new Float32Array(NODES * 3)];
  private tn2 = [new Float32Array(NODES * 3), new Float32Array(NODES * 3)];

  // Sparks: position, speed, age.
  private sp = new Float32Array(SPARKS * 3);
  private sv = new Float32Array(SPARKS * 3);
  private sl = new Float32Array(SPARKS).fill(9);
  private nextSpark = 0;
  private hands: V3[] = [];
  // How brightly the gathering shape glows right now (worked out once a frame).
  private gatherGlow = 0;
  // True for the first few seconds after she's summoned, while the cabinet's dots are still arriving.
  private gathering = false;
  // Grains on her feet get a stronger, fuzzier static, so her feet shimmer into the rest of her.
  private eFoot = new Uint8Array(EMIT);

  // Sand on the video dancer: position (screen pixels), speed, age, lifetime, kind (0 blows off, 1 static on her), color.
  private ex = new Float32Array(EMIT);
  private ey = new Float32Array(EMIT);
  private evx = new Float32Array(EMIT);
  private evy = new Float32Array(EMIT);
  private eAge = new Float32Array(EMIT).fill(99);
  private eLife = new Float32Array(EMIT).fill(1);
  private eKind = new Uint8Array(EMIT);
  private eLit = new Float32Array(EMIT);
  private eCol = new Float32Array(EMIT * 3);
  private nextEmit = 0;
  // Where her body is lit in a tiny copy of the current video frame (see sandScan.ts), read in a worker.
  private lit: Int32Array = new Int32Array(SW * SH);
  private litB: Float32Array = new Float32Array(SW * SH);
  // Spare arrays for the next reading to fill (null while they're away in the worker).
  private spareLit: Int32Array | null = new Int32Array(SW * SH);
  private spareLitB: Float32Array | null = new Float32Array(SW * SH);
  private worker: Worker | null = null;
  private workerFailed = false;
  private scanBusy = false;
  private scanned: ScanResult | null = null;
  private lastVidT = -1;
  // Without a worker, the video is copied here instead.
  private sample: CanvasRenderingContext2D | null = null;
  // Her neon color on each row of the little copy of the video.
  private rowCol = new Float32Array(SH * 3);
  // Each waiting dot's neon color in the gathering column (by its height there).
  private gatherCol = new Float32Array(0);
  // Each static grain's brightness, worked out when it's born.
  private eAmp = new Float32Array(EMIT);
  private nLit = 0;
  // The camera: zoom, move across and down (pixels), tilt (radians), and how fast each is changing; plus a shake.
  private camZ = 1;
  private camX = 0;
  private camY = 0;
  private camR = 0;
  private camV = [0, 0, 0, 0];
  private shake = 0;
  private lastBar = -1;
  private dropHit = false;
  // How visible the dance floor is: it fades in and out with her, but stays put through her fake-out.
  private floorVis = 0;
  private vidRect = { x: 0, y: 0, w: 1, h: 1 };
  private rng = 0x9e3779b9;
  // Her top and bottom in the little copy of the video (rows), for coloring her from head to toe.
  private topRow = 0;
  private botRow = SH;
  // Where her feet are (columns in the little copy of the video), for centering the pool under her.
  private footX = SW / 2;
  private footW = 20;
  // Where her body's middle is on each row (for slimming her waist toward it).
  private rowMid = new Float32Array(SH);
  // Each floor grain's own random angle and spread (picked independently, so they never line up into bands).
  private poolAng = Float32Array.from({ length: POOL_N }, () => Math.random() * Math.PI * 2);
  private poolRad = Float32Array.from({ length: POOL_N }, () => Math.sqrt(Math.random()));

  constructor() {
    super();
    this.buildStrands();
    const B = new Builder();
    if (PARTICLE_GIRL) this.buildBody(B);
    this.nBody = PARTICLE_GIRL ? B.kind.length : EMIT + COLUMN;
    if (!PARTICLE_GIRL) this.morphOnly = [EMIT, EMIT + COLUMN];
    this.start = B.start;
    this.ka = Float32Array.from(B.a); this.kb = Float32Array.from(B.b); this.kc = Float32Array.from(B.c);
    this.kna = Float32Array.from(B.na); this.knb = Float32Array.from(B.nb); this.knc = Float32Array.from(B.nc);
    this.kcol = Float32Array.from(B.col);
    this.kspec = Float32Array.from(B.spec);
    this.kcls = Uint8Array.from(B.cls);
    this.count = this.nBody + ORBS + RING + SPARKS + FRONT + DUST;
    this.alloc(this.count);
    this.rgbPer = new Float32Array(this.count * 3);
    this.depth = new Float32Array(this.count).fill(1);
    this.rgb = [SKIN, HAIR_TIP, TOP, ORB_W, POOL, [90, 90, 90], GOLD, BAND, SKIN, SKIN, SKIN];
    this.glow = GLOW;
    this.solid = SOLID;
    this.trail = 0.5; // a little motion smear on fast moves, like the reference video
    this.cursorForce = 0.15;
    this.seed = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) this.seed[i] = Math.random();
    // Arrival order: orbs and floor first, then her body from the feet up.
    this.morphDelay = new Float32Array(this.count);
    // (Her grains wait in a column where she'll stand, low ones first: the column builds from her feet up.)
    for (let i = 0; i < this.nBody; i++) {
      const up = PARTICLE_GIRL ? clamp01(B.restY[i] / 1.75) : (this.seed[i] * 53.1) % 1;
      this.morphDelay[i] = 0.22 + 0.62 * up + Math.random() * 0.12;
    }
    for (let i = this.nBody; i < this.count; i++) this.morphDelay[i] = Math.random() * 0.2;
    this.dust = new Dust(this.count - DUST, DUST, () => C_DUST);
    this.gatherCol = new Float32Array(this.nBody * 3);
    for (let i = 0; i < this.nBody; i++) {
      const c = neon(1 - ((this.seed[i] * 53.1) % 1));
      this.gatherCol.set(c, i * 3);
    }
  }

  // ---------- building her ----------

  /** Hair strands with a resting shape in the head's frame: bangs, side locks, back hair, twin-tails. */
  private buildStrands() {
    let s = 0;
    const strand = (root: V3, path: (t: number, l: number) => V3, length: number, stiff: number) => {
      this.sStiff[s] = stiff;
      this.segLen[s] = length / (NODES - 1);
      for (let i = 0; i < NODES; i++) {
        const p = add(root, path(i / (NODES - 1), length));
        const o = (s * NODES + i) * 3;
        this.sRest[o] = p[0]; this.sRest[o + 1] = p[1]; this.sRest[o + 2] = p[2];
      }
      s++;
    };
    const onHead = (x: number, y: number, z: number): V3 => { const l = Math.hypot(x, y, z); return [(x / l) * HX * 1.08, (y / l) * HY * 1.08, (z / l) * HZ * 1.08]; };
    // Bangs across the forehead, left to right, falling forward and down to the brows.
    for (let i = 0; i < N_BANG; i++) {
      const x = ((i + 0.5) / N_BANG - 0.5) * 1.6;
      strand(onHead(x, 0.66, 0.6), (t, l) => [x * 0.03 * t, -t * l, 0.02 * Math.sin(Math.PI * t) + 0.01 * t], 0.042 + 0.012 * (1 - Math.abs(x)) + 0.02 * Math.abs(x) * Math.abs(x), 0.5);
    }
    // Side locks framing her face: four each side, front to back.
    for (const side of [1, -1]) {
      for (let i = 0; i < N_SIDE / 2; i++) {
        const z = 0.5 - i * 0.18;
        strand(onHead(side * 0.9, 0.35, z), (t, l) => [side * 0.012 * Math.sin(Math.PI * t), -t * l, 0.01 + 0.015 * t], 0.34 - i * 0.02, 0.08);
      }
    }
    // Back hair, around the back of the head from one side to the other, down to her shoulder blades.
    for (let i = 0; i < N_BACK; i++) {
      const a = Math.PI * 1.5 + ((i + 0.5) / N_BACK - 0.5) * Math.PI * 1.15;
      const ox = Math.cos(a), oz = Math.sin(a);
      strand(onHead(ox, 0.5, oz), (t, l) => {
        const s0 = t * l, bulge = Math.min(s0, 0.06);
        return [ox * bulge * 0.8, -(s0 - bulge * 0.4), oz * bulge * 0.8 - 0.015 * s0];
      }, 0.34, 0.05);
    }
    // Twin-tails: tied high on each side, sweeping out and back, then falling long.
    for (let t = 0; t < 2; t++) {
      const side = t === 0 ? 1 : -1;
      this.tailStart[t] = s;
      const anchor: V3 = [side * 0.074, 0.07, -0.035];
      for (let i = 0; i < N_TWIN; i++) {
        const root = add(anchor, [(Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02]);
        const spread = (Math.random() - 0.5) * 0.03;
        strand(root, (tt, l) => {
          const s0 = tt * l;
          return [side * (0.17 * (1 - Math.exp(-s0 / 0.09)) + spread * tt), 0.035 * (1 - Math.exp(-s0 / 0.05)) - Math.max(0, s0 - 0.05) * 0.94, -0.03 - 0.1 * Math.sqrt(tt) + spread * 0.5 * tt];
        }, 0.8, 0.05);
      }
    }
  }

  private buildBody(B: Builder) {
    this.buildHead(B);
    this.buildCap(B);
    B.begin(K.Neck);
    B.tube((u, cv) => neckR(u, cv), 0.09, SP, () => [SKIN, 0.1, C_SKIN], () => 1.45, false, -0.2, 1.1);
    this.buildTorso(B);
    this.buildSkirt(B);
    for (const side of [1, -1]) {
      // Long sleeves from just below the bare shoulder, with the off-shoulder band, down to a cuff at the wrist.
      B.begin(side > 0 ? K.UArmL : K.UArmR);
      B.tube(sleeveUp, 0.265, SP, (u, cv) => {
        if (u < 0.17) return [SKIN, 0.1, C_SKIN];
        if (u < 0.25) return [BAND, 0.2, C_CLOTH];
        const rib = 0.84 + 0.16 * Math.cos(Math.acos(Math.max(-1, Math.min(1, cv))) * 22);
        return [[TOP[0] * rib, TOP[1] * rib, TOP[2] * rib], 0.15, C_CLOTH];
      }, (u) => 1.33 - 0.26 * u, false, -0.14, 1.06);
      B.begin(side > 0 ? K.FArmL : K.FArmR);
      B.tube(sleeveFore, 0.24, SP, (u, cv) => {
        if (u > 0.9) return [BAND, 0.2, C_CLOTH];
        const rib = 0.84 + 0.16 * Math.cos(Math.acos(Math.max(-1, Math.min(1, cv))) * 22);
        return [[TOP[0] * rib, TOP[1] * rib, TOP[2] * rib], 0.15, C_CLOTH];
      }, (u) => 1.07 - 0.24 * u, false, -0.06, 1.05);
      B.begin(side > 0 ? K.HandL : K.HandR);
      this.buildHand(B);
    }
    for (const side of [1, -1]) {
      // Bare legs, slouchy leg warmers at the ankles, chunky sneakers.
      B.begin(side > 0 ? K.ThighL : K.ThighR);
      B.tube(thighR, 0.43, SP, () => [SKIN, 0.1, C_SKIN], (u) => 0.9 - 0.43 * u, false, -0.03, 1.07);
      B.begin(side > 0 ? K.ShinL : K.ShinR);
      B.tube(shinWarm, 0.41, SP, (u) => {
        if (u < 0.66) return [SKIN, 0.1, C_SKIN];
        const ridge = 0.8 + 0.2 * Math.abs(Math.sin(u * 75));
        return [[WARMER[0] * ridge, WARMER[1] * ridge, WARMER[2] * ridge], 0.1, C_CLOTH];
      }, (u) => 0.47 - 0.4 * u, false, -0.07, 1.0);
      B.begin(side > 0 ? K.ShoeL : K.ShoeR);
      this.buildShoe(B);
    }
    this.buildHair(B);
    B.end();
  }

  /** The face and the parts of the head the hair doesn't cover: smooth and featureless, like the references. */
  private buildHead(B: Builder) {
    B.begin(K.Head);
    const n = Math.round((4 * Math.PI * HY * HY) / (FACE_SP * FACE_SP));
    // Only the faintest shape of a nose and chin, so the head isn't a perfect egg.
    const bump = (x: number, y: number) => 0.003 * gauss(x, 0, 0.08) * gauss(y, -0.2, 0.12) + 0.003 * gauss(y, -0.86, 0.12) * gauss(x, 0, 0.22);
    sphere(n, (sx, sy, sz) => {
      if (!((sz > 0.05 && sy < 0.55) || sy < -0.4)) return;
      let lx = sx * HX, ly = sy * HY, lz = sz * HZ;
      if (sy < 0) {
        const jaw = Math.pow(-sy, 1.4);
        lx *= 1 - 0.3 * jaw;
        if (sz > 0) lz *= 1 - 0.1 * jaw;
      }
      if (sz < 0) lz *= 1.04;
      if (sz > 0) {
        const b = bump(sx, sy) * Math.min(1, sz * 2.5);
        lx += sx * b; ly += sy * b; lz += sz * b;
      }
      const nx = sx / HX, ny = sy / HY, nz = sz / HZ, nl = Math.hypot(nx, ny, nz);
      B.dot(lx, ly, lz, nx / nl, ny / nl, nz / nl, SKIN, 0.12, C_SKIN, 1.6);
    });
  }

  /** Hair cap: a shell over the head (not the face), with combed lines from the crown. */
  private buildCap(B: Builder) {
    B.begin(K.Cap);
    const n = Math.round((4 * Math.PI * 0.1 * 0.1) / (SP * SP));
    sphere(n, (x, y, z) => {
      const face = z > 0.25 && y < 0.42 - 0.5 * x * x && Math.abs(x) < 0.82;
      if (face || y < -0.55) return;
      const k = clamp01(0.5 - y * 0.5) * 0.4;
      const comb = 0.82 + 0.18 * Math.cos(Math.atan2(x, z) * 40);
      const col: V3 = [mix(HAIR_ROOT[0], HAIR_TIP[0], k) * comb, mix(HAIR_ROOT[1], HAIR_TIP[1], k) * comb, mix(HAIR_ROOT[2], HAIR_TIP[2], k) * comb];
      B.dot(x * HX * 1.07, y * HY * 1.07, z * HZ * 1.07, x, y, z, col, 0.5, C_HAIR, 1.68);
    });
  }

  /** Torso: rows up her body, dots spaced evenly around each row. Off-shoulder crop top, bare midriff, little shorts. */
  private buildTorso(B: Builder) {
    B.begin(K.Torso);
    const S = 96, cum = new Float32Array(S + 1);
    for (let h = H0 + SP / 2; h < H1; h += h < 0.11 ? SP * 1.6 : SP) {
      cum[0] = 0;
      let prev = torsoRadius(h, 1, 0), px = prev, pz = 0;
      for (let s = 1; s <= S; s++) {
        const a = (s / S) * Math.PI * 2, cv = Math.cos(a), sv = Math.sin(a);
        const r = torsoRadius(h, cv, sv), x = cv * r, z = sv * r;
        cum[s] = cum[s - 1] + Math.hypot(x - px, z - pz);
        px = x; pz = z; prev = r;
      }
      void prev;
      const per = cum[S], n = Math.round(per / SP), off = (h * 977.3) % 1;
      let si = 0;
      for (let k = 0; k < n; k++) {
        const target = ((k + off) / n) * per;
        while (si < S - 1 && cum[si + 1] < target) si++;
        const a = ((si + (target - cum[si]) / Math.max(1e-6, cum[si + 1] - cum[si])) / S) * Math.PI * 2;
        const cv = Math.cos(a), sv = Math.sin(a);
        const r = torsoRadius(h, cv, sv);
        const slope = (torsoRadius(h + 0.008, cv, sv) - torsoRadius(h - 0.008, cv, sv)) / 0.016;
        const top = h > 0.235 && h < 0.372, band = h >= 0.372 && h < 0.405, shorts = h < 0.115;
        const rad = r + (top ? 0.004 : band ? 0.008 + 0.003 * Math.abs(Math.sin(a * 26)) : shorts ? 0.003 : 0);
        const nl = 1 / Math.hypot(cv, slope, sv);
        let col: V3 = SKIN, spec = 0.1, cls = C_SKIN;
        if (top) {
          const rib = 0.82 + 0.18 * Math.cos(a * 60);
          col = [TOP[0] * rib, TOP[1] * rib, TOP[2] * rib];
          spec = 0.12; cls = C_CLOTH;
        } else if (band) { col = BAND; spec = 0.2; cls = C_CLOTH; }
        else if (shorts) { col = SHORTS; spec = 0.1; cls = C_CLOTH; }
        B.dot(cv * rad, h, sv * rad, cv * nl, -slope * nl, sv * nl, col, spec, cls, 0.9 + h);
      }
    }
  }

  /** Skirt: a flared skater skirt with soft folds, a bright waistband and a light frilled hem. */
  private buildSkirt(B: Builder) {
    B.begin(K.Skirt);
    const rows = Math.round(0.31 / SP);
    for (let i = 0; i < rows; i++) {
      const u = (i + 0.5) / rows, h = mix(0.125, -0.175, u);
      const circ = Math.PI * 2 * (0.16 + u * u * 0.12);
      const n = Math.round(circ / SP), off = (i * 0.618) % 1;
      for (let k = 0; k < n; k++) {
        const a0 = ((k + off) / n) * Math.PI * 2, cv = Math.cos(a0), sv = Math.sin(a0);
        // Soft folds that deepen toward the hem, with extra room over the hips.
        const fold = Math.sin(a0 * 11);
        const base = Math.max(torsoRadius(0.125, cv, sv), torsoRadius(Math.max(h, -0.04), cv, sv)) + 0.01 + 0.03 * smooth(u / 0.5) * cv * cv + fold * 0.012 * Math.pow(u, 0.8);
        let col: V3 = SKIRT_C;
        if (u < 0.08) col = BAND;
        else if (u > 0.93) col = HEM;
        const shade = u < 0.08 ? 1 : 0.8 + 0.2 * fold;
        B.dot(base, h, u, a0, 0, 0, [col[0] * shade, col[1] * shade, col[2] * shade], 0.12, C_CLOTH, 0.9 + h);
      }
    }
  }

  /** A hand: palm, then four fingers and a thumb as small tubes (shaped every frame by how curled they are). */
  private buildHand(B: Builder) {
    // Palm: a flattened rounded box from the wrist to the knuckles.
    const rows = Math.round(0.084 / HAND_SP);
    for (let i = 0; i < rows; i++) {
      const u = (i + 0.5) / rows;
      const n = Math.round((Math.PI * 2 * 0.024) / HAND_SP);
      for (let k = 0; k < n; k++) {
        const a = ((k + (i * 0.618) % 1) / n) * Math.PI * 2;
        B.dot(0, u, 0, Math.cos(a), Math.sin(a), 0, SKIN, 0.15, C_SKIN, 0.75);
      }
    }
    for (let f = 0; f < 5; f++) {
      const [, l, r] = FINGERS[f];
      const rings = Math.round(l / HAND_SP), n = Math.max(6, Math.round((Math.PI * 2 * r) / HAND_SP));
      for (let i = 0; i < rings; i++) {
        const u = (i + 0.5) / rings;
        for (let k = 0; k < n; k++) {
          const a = ((k + (i * 0.618) % 1) / n) * Math.PI * 2;
          // A slightly pinker, shinier fingernail on the back of each fingertip.
          const nail = u > 0.72 && Math.sin(a) < -0.5;
          B.dot(f + 1, u, 0, Math.cos(a), Math.sin(a), 0, nail ? BAND : SKIN, nail ? 0.6 : 0.15, C_SKIN, 0.7);
        }
      }
    }
  }

  /** A chunky sneaker: a rounded box from heel to toe, lower at the toe, with a pink sole and a side stripe. */
  private buildShoe(B: Builder) {
    const rows = Math.round(0.22 / SP);
    for (let i = 0; i < rows; i++) {
      const u = (i + 0.5) / rows;
      const along = mix(-0.055, 0.165, u);
      const wd = 0.047 * Math.sqrt(Math.max(0.08, 1 - Math.pow((u - 0.42) / 0.58, 2)));
      const topH = mix(0.05, 0.0, Math.pow(u, 1.3)) + 0.018, bot = -0.076;
      const n = Math.round((2 * (2 * wd + (topH - bot))) / SP), off = (i * 0.618) % 1;
      for (let k = 0; k < n; k++) {
        const a = ((k + off) / n) * Math.PI * 2, cv = Math.cos(a), sv = Math.sin(a);
        const lx = Math.sign(cv) * Math.pow(Math.abs(cv), 0.6) * wd;
        const ly = (topH + bot) / 2 + Math.sign(sv) * Math.pow(Math.abs(sv), 0.6) * (topH - bot) / 2;
        const sole = ly < bot + 0.02;
        const stripe = Math.abs(cv) > 0.75 && Math.abs(along - 0.05) < 0.035 && Math.abs(ly - (bot + 0.04)) < 0.01;
        B.dot(along, lx, ly, cv, sv, 0, sole || stripe ? SOLE : SHOE_C, 0.4, C_CLOTH, 0.04);
      }
    }
  }

  /** Hair surfaces between neighbouring strands (bangs, side locks, back), the twin-tails, and the hair ties. */
  private buildHair(B: Builder) {
    const root = (s: number, i: number): V3 => { const o = (s * NODES + i) * 3; return [this.sRest[o], this.sRest[o + 1], this.sRest[o + 2]]; };
    const sheet = (s0: number, s1: number, sp: number) => {
      const across = Math.max(1, Math.round(Math.max(len(sub(root(s0, 0), root(s1, 0))), len(sub(root(s0, NODES - 1), root(s1, NODES - 1)))) / sp));
      const rows = Math.max(4, Math.round((this.segLen[s0] * (NODES - 1)) / sp));
      for (let r = 0; r < rows; r++) {
        const k = (r + 0.5) / rows;
        const col: V3 = [mix(HAIR_ROOT[0], HAIR_TIP[0], k), mix(HAIR_ROOT[1], HAIR_TIP[1], k), mix(HAIR_ROOT[2], HAIR_TIP[2], k)];
        for (let c = 0; c < across; c++) {
          const fr = (c + 0.5) / across;
          if (k > 0.72 && Math.abs(fr - 0.5) * 2 > 1 - (k - 0.72) / 0.28) continue;
          const streak = 0.82 + 0.18 * Math.cos((s0 + (c + 0.5) / across) * 2.6);
          B.dot(s0, s1, (c + 0.5) / across, k, 0, 0, [col[0] * streak, col[1] * streak, col[2] * streak], 0.5, C_HAIR, 1.6 - 0.4 * k);
        }
      }
    };
    B.begin(K.Bangs);
    for (let s = 0; s < N_BANG - 1; s++) sheet(s, s + 1, SP);
    B.begin(K.Side);
    for (let g = 0; g < 2; g++) for (let i = 0; i < N_SIDE / 2 - 1; i++) { const s = N_BANG + g * (N_SIDE / 2) + i; sheet(s, s + 1, SP); }
    B.begin(K.Back);
    for (let i = 0; i < N_BACK - 1; i++) { const s = N_BANG + N_SIDE + i; sheet(s, s + 1, HAIR_SP); }
    B.begin(K.Tail);
    for (let t = 0; t < 2; t++) {
      const rings = Math.round(0.8 / HAIR_SP);
      for (let i = 0; i < rings; i++) {
        const k = (i + 0.5) / rings;
        const n = Math.max(6, Math.round((Math.PI * 2 * tailR(k)) / HAIR_SP));
        const col: V3 = [mix(HAIR_ROOT[0], HAIR_TIP[0], k), mix(HAIR_ROOT[1], HAIR_TIP[1], k), mix(HAIR_ROOT[2], HAIR_TIP[2], k)];
        for (let c = 0; c < n; c++) {
          const a = ((c + (i * 0.618) % 1) / n) * Math.PI * 2;
          const streak = 0.78 + 0.22 * Math.cos(a * 9 + k * 4);
          B.dot(t, k, a, 0, 0, 0, [col[0] * streak, col[1] * streak, col[2] * streak], 0.55, C_HAIR, 1.5 - 0.6 * k);
        }
      }
    }
    B.begin(K.Tie);
    for (const side of [1, -1]) sphere(140, (x, y, z) => B.dot(side * 0.078 + x * 0.017, 0.07 + y * 0.017, -0.04 + z * 0.017, x, y, z, TIE, 0.7, C_HAIR, 1.6));
  }

  activate(now: number) {
    this.started = now;
    this.floorVis = 0;
    this.camZ = 1; this.camX = 0; this.camY = 0; this.camR = 0;
    this.camV = [0, 0, 0, 0];
    this.shake = 0; this.lastBar = -1; this.dropHit = false;
    this.hairReady = false;
    this.beatPrev = -1;
    this.kick = 0;
    this.sl.fill(9);
    this.sk = [0, 0];
    this.skv = [0, 0];
  }

  update(env: Env) {
    const { W, H, dt } = env;
    const t = dance.on ? dance.time() : (env.now - this.started) / 1000;
    const step = Math.min(0.05, Math.max(0, t - this.lastT) || dt / 1000);
    this.lastT = t;
    const beat = (t - BEAT0) * (BPM / 60);

    // ---- the music: a kick on every beat, made bigger by how loud the bass actually is ----
    const bass = dance.bass();
    this.bassAvg += (bass - this.bassAvg) * 0.05;
    if (Math.floor(beat) !== this.beatPrev && beat >= 0 && dance.on) {
      this.beatPrev = Math.floor(beat);
      this.kick = 0.6 + Math.min(0.6, Math.max(0, bass - this.bassAvg) * 4 + bass * 0.4);
      const bt = Math.floor(beat);
      if (bt === 44 && PARTICLE_GIRL) this.burst(1.8);
    }
    this.kick *= Math.pow(0.04, step);
    const energy = clamp01(0.35 + bass * 0.9);

    // ---- camera first, so she can look at it ----
    this.camera(beat, step, env.still);
    const C = this.cam;
    const yaw = C.yaw + this.camOrbit + (!PARTICLE_GIRL && dance.on ? orbitAt(t) : 0);
    const eye: V3 = [Math.sin(yaw) * Math.cos(C.pitch) * C.dist, C.lookY + Math.sin(C.pitch) * C.dist, Math.cos(yaw) * Math.cos(C.pitch) * C.dist];

    // ---- pose: a smooth curve through the routine's key poses ----
    poseAt(beat, this.pose);
    const sk = this.skeleton(this.pose, eye);

    // Skirt: flares when she turns fast, and swings behind her hips' movement.
    const fwd = sk.facing;
    const turn = Math.atan2(cross(this.prevFacing, fwd)[1], dot(this.prevFacing, fwd));
    this.prevFacing = fwd;
    this.skirtSpin += ((Math.abs(turn) / Math.max(step, 0.001)) * 0.05 - this.skirtSpin) * 0.15;
    {
      const vel = scl(sub(sk.pelvis, this.prevPelvis), 1 / Math.max(step, 0.001));
      this.prevPelvis = sk.pelvis;
      const lv = appT(sk.M0, vel[0], vel[1], vel[2]);
      for (let a = 0; a < 2; a++) {
        const target = -(a === 0 ? lv[0] : lv[2]) * 0.09;
        this.skv[a] += ((clamp(target, -0.08, 0.08) - this.sk[a]) * 160 - this.skv[a] * 10) * step;
        this.sk[a] += this.skv[a] * step;
      }
    }

    // (Her hair only matters for the made-of-dots girl.)
    if (PARTICLE_GIRL) {
      this.stepHair(sk, step);
      this.tailFrames(sk);
    }

    // ---- projection and lights ----
    const f0 = norm(sub([0, C.lookY, 0], eye));
    let rt = norm(cross(f0, [0, 1, 0]));
    let up = cross(rt, f0);
    const cr = Math.cos(C.roll), sr = Math.sin(C.roll);
    [rt, up] = [add(scl(rt, cr), scl(up, sr)), add(scl(up, cr), scl(rt, -sr))];
    // Tall phone screens get a closer view, since she is taller than she is wide.
    const focal = Math.min(H, W * (W < H ? 1.25 : 0.75)) * 1.25 * C.zoom * (1 + this.kick * 0.012);
    const cx = W / 2, cy = H * 0.5;
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const fx = f0[0], fy = f0[1], fz = f0[2], rx = rt[0], ry = rt[1], rz = rt[2], ux = up[0], uy = up[1], uz = up[2];
    // Key light from the camera's upper right; violet fill from behind on the left; highlights halfway to the camera.
    const Lk = norm(add(add(scl(rt, 0.78), scl(up, 0.55)), scl(f0, -0.3)));
    const Lf = norm(add(add(scl(rt, -0.7), scl(up, 0.1)), scl(f0, 0.6)));
    const Hh = norm(sub(Lk, f0));
    const LX = Lk[0], LY = Lk[1], LZ = Lk[2], FX = Lf[0], FY = Lf[1], FZ = Lf[2], HX_ = Hh[0], HY_ = Hh[1], HZ_ = Hh[2];
    const X = this.x, Y = this.y, S = this.s, A = this.a, Cc = this.c, rgb = this.rgbPer!, Dp = this.depth!;
    const ka = this.ka, kb = this.kb, kc = this.kc, kna = this.kna, knb = this.knb, knc = this.knc, kcol = this.kcol, kspec = this.kspec, kcls = this.kcls;
    const seed = this.seed;
    const glowUp = 1 + this.kick * 0.12;
    let j = 0;

    /**
     * One solid dot on her: hidden if it faces away; otherwise lit (key light, fill, a pink rim at the edges, a
     * highlight) and sized to cover its patch of surface, so neighbouring dots close up into a solid shape.
     */
    // The fade: from beat 41 she blows away on the wind, downwind side first, as streaks of glowing dust;
    // on the drop (beat 44) she snaps back together in about a third of a second.
    const fade = beat < 44 ? smooth((beat - 41.1) / 2.3) : 1 - clamp01((beat - 44) / 0.6);
    const wind = norm(add(scl(rt, -1), scl(up, 0.12)));
    const WX = wind[0], WY = wind[1], WZ = wind[2], pv0 = sk.pelvis[0], pv1 = sk.pelvis[1], pv2 = sk.pelvis[2];
    let dotSize = DOT;
    const solidDot = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
      if (fade > 0) {
        const sd = seed[j];
        const along = (px - pv0) * WX + (py - pv1) * WY + (pz - pv2) * WZ;
        // A ragged edge: where she breaks up wanders with height instead of a straight line.
        const thr = 0.45 * clamp01(0.5 + along / 0.7 + 0.18 * Math.sin(py * 9 + sd * 2) + 0.1 * Math.sin(py * 23)) + 0.55 * sd;
        const q = clamp01((fade * 1.4 - thr) / 0.35);
        if (q >= 1) { A[j] = 0; j++; return; }
        if (q > 0) {
          // Carried off downwind, rising a little and swirling.
          // Each grain drifts at its own speed, swirling as it goes.
          const speed = 0.55 + 0.9 * ((sd * 37.1) % 1);
          const qq = q * q, dist = (qq * 2.6 + q * 0.12) * speed;
          const swirl = Math.sin(sd * 40 + q * 5 + py * 6) * 0.35 * q + Math.sin(sd * 13 + q * 9) * 0.12 * q;
          const ax_ = px + WX * dist + ux * swirl, ay_ = py + WY * dist + 0.3 * qq + uy * swirl * 0.5, az_ = pz + WZ * dist + uz * swirl;
          const dx = ax_ - ex, dy = ay_ - ey, dz = az_ - ez, z = dx * fx + dy * fy + dz * fz;
          if (z < 0.12) { A[j] = 0; j++; return; }
          X[j] = cx + ((dx * rx + dy * ry + dz * rz) / z) * focal;
          Y[j] = cy - ((dx * ux + dy * uy + dz * uz) / z) * focal;
          S[j] = Math.max(1, (dotSize * focal) / z);
          const q3 = j * 3, glowK = 1.25 + 0.5 * (1 - q);
          rgb[q3] = Math.min(255, kcol[q3] * glowK + 20); rgb[q3 + 1] = Math.min(255, kcol[q3 + 1] * glowK + 10); rgb[q3 + 2] = Math.min(255, kcol[q3 + 2] * glowK + 30);
          A[j] = Math.pow(1 - q, 1.5) * 0.4;
          Cc[j] = C_ASH;
          Dp[j] = Math.min(1, z / 40);
          j++;
          return;
        }
      }
      const dx = px - ex, dy = py - ey, dz = pz - ez;
      const z = dx * fx + dy * fy + dz * fz;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ndv = -(nx * dx + ny * dy + nz * dz) * il;
      if (z < 0.12 || ndv < -0.08) { A[j] = 0; j++; return; }
      X[j] = cx + ((dx * rx + dy * ry + dz * rz) / z) * focal;
      Y[j] = cy - ((dx * ux + dy * uy + dz * uz) / z) * focal;
      const s = (dotSize * focal) / z;
      S[j] = s < 1 ? 1 : s > 9 ? 9 : s;
      const nl = nx * LX + ny * LY + nz * LZ, diff = nl > -0.15 ? (nl + 0.15) / 1.15 : 0;
      const nf = nx * FX + ny * FY + nz * FZ, fill = nf > 0 ? nf : 0;
      const r0 = 1 - (ndv > 0 ? ndv : 0), rim = r0 * r0 * r0;
      let nh = nx * HX_ + ny * HY_ + nz * HZ_;
      nh = nh > 0 ? nh : 0; nh *= nh; nh *= nh; nh *= nh; nh *= nh; nh *= nh;
      const q = j * 3, sp = kspec[j] * nh * 255 * glowUp;
      const lr = AMB[0] + KEY[0] * diff + FILL[0] * fill, lg = AMB[1] + KEY[1] * diff + FILL[1] * fill, lb = AMB[2] + KEY[2] * diff + FILL[2] * fill;
      // Grain: every dot a little brighter or darker than its neighbours; a few twinkle white, like the reference.
      const sd = seed[j], grain = 0.55 + 0.8 * ((sd * 7.13) % 1);
      let spark = 0;
      if ((sd * 91.7) % 1 > 0.955) { const tw = Math.sin(t * 7 + sd * 80); spark = tw > 0.55 ? (tw - 0.55) * 420 : 0; }
      const R = (kcol[q] * lr + RIM[0] * rim * 0.45) * grain + sp + spark, G = (kcol[q + 1] * lg + RIM[1] * rim * 0.45) * grain + sp + spark, Bc = (kcol[q + 2] * lb + RIM[2] * rim * 0.45) * grain + sp + spark;
      rgb[q] = R > 255 ? 255 : R; rgb[q + 1] = G > 255 ? 255 : G; rgb[q + 2] = Bc > 255 ? 255 : Bc;
      A[j] = 1;
      Cc[j] = kcls[j];
      Dp[j] = z / 40;
      j++;
    };
    /** A glowing dot (orbs, floor, sparks): adds light, hidden only when it's behind her. */
    let maxS = 3.2;
    const glowDot = (px: number, py: number, pz: number, size: number, alpha: number, cls: number, col: V3) => {
      const dx = px - ex, dy = py - ey, dz = pz - ez;
      const z = dx * fx + dy * fy + dz * fz;
      if (z < 0.12) { A[j] = 0; j++; return; }
      X[j] = cx + ((dx * rx + dy * ry + dz * rz) / z) * focal;
      Y[j] = cy - ((dx * ux + dy * uy + dz * uz) / z) * focal;
      const s = (size * 3.2) / z;
      S[j] = s < maxS ? s : maxS;
      A[j] = alpha;
      Cc[j] = cls;
      const q = j * 3;
      rgb[q] = col[0]; rgb[q + 1] = col[1]; rgb[q + 2] = col[2];
      Dp[j] = Math.min(1, z / 40);
      j++;
    };
    /** Dots carried rigidly by a frame (the head, hair cap, hair ties). */
    const rigid = (M: M3, o: V3, end: number) => {
      for (; j < end;) {
        const lx = ka[j], ly = kb[j], lz = kc[j], nx = kna[j], ny = knb[j], nz = knc[j];
        solidDot(o[0] + M[0] * lx + M[1] * ly + M[2] * lz, o[1] + M[3] * lx + M[4] * ly + M[5] * lz, o[2] + M[6] * lx + M[7] * ly + M[8] * lz,
          M[0] * nx + M[1] * ny + M[2] * nz, M[3] * nx + M[4] * ny + M[5] * nz, M[6] * nx + M[7] * ny + M[8] * nz);
      }
    };
    /** A tube along a limb segment. */
    const tube = (s: Seg, end: number) => {
      const ax = s.ax, sd = s.sd, fr = s.fr, a0 = s.a, L = s.len;
      for (; j < end;) {
        const u = ka[j], r = kb[j], slope = kc[j] / L, cv = kna[j], sv = knb[j];
        const nx0 = sd[0] * cv + fr[0] * sv, ny0 = sd[1] * cv + fr[1] * sv, nz0 = sd[2] * cv + fr[2] * sv;
        const nl = 1 / Math.sqrt(1 + slope * slope);
        solidDot(a0[0] + ax[0] * u * L + nx0 * r, a0[1] + ax[1] * u * L + ny0 * r, a0[2] + ax[2] * u * L + nz0 * r,
          (nx0 - ax[0] * slope) * nl, (ny0 - ax[1] * slope) * nl, (nz0 - ax[2] * slope) * nl);
      }
    };
    const st = this.start;

    if (PARTICLE_GIRL) {
    dotSize = FACE_SP * 1.55;
    rigid(sk.MH, sk.head, st[K.Head + 1]);
    dotSize = DOT;
    rigid(sk.MH, sk.head, st[K.Cap + 1]);
    tube(sk.neck, st[K.Neck + 1]);

    // Torso: hips move with the pelvis, chest with the chest, blended through the waist.
    {
      const M0 = sk.M0, M1 = sk.M1, pv = sk.pelvis, wv = sk.waist, end = st[K.Torso + 1];
      for (; j < end;) {
        const lx = ka[j], h = kb[j], lz = kc[j];
        const k = h < 0.1 ? 0 : h > 0.18 ? 1 : smooth((h - 0.1) / 0.08);
        let px = 0, py = 0, pz = 0;
        if (k < 1) { px = pv[0] + M0[0] * lx + M0[1] * h + M0[2] * lz; py = pv[1] + M0[3] * lx + M0[4] * h + M0[5] * lz; pz = pv[2] + M0[6] * lx + M0[7] * h + M0[8] * lz; }
        if (k > 0) {
          const hh = h - WAIST;
          const bx = wv[0] + M1[0] * lx + M1[1] * hh + M1[2] * lz, by = wv[1] + M1[3] * lx + M1[4] * hh + M1[5] * lz, bz = wv[2] + M1[6] * lx + M1[7] * hh + M1[8] * lz;
          if (k < 1) { px += (bx - px) * k; py += (by - py) * k; pz += (bz - pz) * k; } else { px = bx; py = by; pz = bz; }
        }
        const M = k < 0.5 ? M0 : M1, nx = kna[j], ny = knb[j], nz = knc[j];
        solidDot(px, py, pz, M[0] * nx + M[1] * ny + M[2] * nz, M[3] * nx + M[4] * ny + M[5] * nz, M[6] * nx + M[7] * ny + M[8] * nz);
      }
    }

    // Skirt: swings behind her hips and flares when she spins.
    {
      const M = sk.M0, pv = sk.pelvis, end = st[K.Skirt + 1];
      const flare = Math.min(0.24, this.skirtSpin * 0.26 + this.kick * 0.01);
      const twist = -this.skirtSpin * 0.35;
      const swx = this.sk[0], swz = this.sk[1], swl = (Math.abs(swx) + Math.abs(swz)) * 0.25;
      const thighs = [sk.legL.thigh, sk.legR.thigh];
      for (; j < end;) {
        const base = ka[j], h = kb[j], u = kc[j], a0 = kna[j];
        const a = a0 + twist * u, cv = Math.cos(a), sv = Math.sin(a);
        const r = base + u * u * (0.12 + flare);
        const lx = cv * r + swx * u * u, lz = sv * r + swz * u * u;
        const ly = h + u * flare * 0.5 + u * u * swl + Math.sin(a0 * 3 + t * 5) * 0.004 * u;
        // Tilted outward as it flares.
        const tilt = 0.25 + flare * 2, nl = 1 / Math.sqrt(1 + tilt * tilt * u);
        const nyl = -tilt * Math.sqrt(u) * nl * 0.5;
        let px = pv[0] + M[0] * lx + M[1] * ly + M[2] * lz, py = pv[1] + M[3] * lx + M[4] * ly + M[5] * lz, pz = pv[2] + M[6] * lx + M[7] * ly + M[8] * lz;
        // Drape over her thighs: anything that would end up inside a thigh is pushed back out of it.
        for (const T of thighs) {
          const qx = px - T.a[0], qy = py - T.a[1], qz = pz - T.a[2];
          const along = Math.max(0, Math.min(T.len * 0.85, qx * T.ax[0] + qy * T.ax[1] + qz * T.ax[2]));
          const dx = qx - T.ax[0] * along, dy = qy - T.ax[1] * along, dz = qz - T.ax[2] * along;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz), R = 0.102 - 0.03 * (along / T.len);
          if (d < R && d > 1e-5) { const k = R / d - 1; px += dx * k; py += dy * k; pz += dz * k; }
        }
        solidDot(px, py, pz,
          (M[0] * cv + M[2] * sv) * nl + M[1] * nyl, (M[3] * cv + M[5] * sv) * nl + M[4] * nyl, (M[6] * cv + M[8] * sv) * nl + M[7] * nyl);
      }
    }

    // Arms and hands.
    tube(sk.armL.up, st[K.UArmL + 1]);
    tube(sk.armL.fore, st[K.FArmL + 1]);
    dotSize = HAND_SP * 1.55;
    this.hand(sk.armL, st[K.HandL + 1], j, solidDot);
    dotSize = DOT;
    j = st[K.HandL + 1];
    tube(sk.armR.up, st[K.UArmR + 1]);
    tube(sk.armR.fore, st[K.FArmR + 1]);
    dotSize = HAND_SP * 1.55;
    this.hand(sk.armR, st[K.HandR + 1], j, solidDot);
    dotSize = DOT;
    j = st[K.HandR + 1];

    // Legs and sneakers.
    for (const [L_, thighK, shinK, shoeK] of [[sk.legL, K.ThighL, K.ShinL, K.ShoeL], [sk.legR, K.ThighR, K.ShinR, K.ShoeR]] as [LegJ, K, K, K][]) {
      tube(L_.thigh, st[thighK + 1]);
      tube(L_.shin, st[shinK + 1]);
      const f = L_.fwd, side = norm(cross([0, 1, 0], f)), upv = cross(f, side), a0 = L_.ank, end = st[shoeK + 1];
      for (; j < end;) {
        const along = ka[j], lx = kb[j], ly = kc[j], cv = kna[j], sv = knb[j];
        solidDot(a0[0] + f[0] * along + side[0] * lx + upv[0] * ly, a0[1] + f[1] * along + side[1] * lx + upv[1] * ly, a0[2] + f[2] * along + side[2] * lx + upv[2] * ly,
          side[0] * cv + upv[0] * sv, side[1] * cv + upv[1] * sv, side[2] * cv + upv[2] * sv);
      }
    }

    // Hair: surfaces stretched between neighbouring strands.
    {
      const hp = this.hp, hc = sk.head, M = sk.MH;
      const fwdH: V3 = [M[2], M[5], M[8]];
      const sheet = (end: number, frontFacing: boolean) => {
        for (; j < end;) {
          const s0 = ka[j], s1 = kb[j], fr = kc[j], k = kna[j];
          const f = k * (NODES - 1), i0 = Math.min(NODES - 2, Math.floor(f)), w = f - i0;
          const o0 = (s0 * NODES + i0) * 3, o1 = (s1 * NODES + i0) * 3;
          const ax = mix(hp[o0], hp[o0 + 3], w), ay = mix(hp[o0 + 1], hp[o0 + 4], w), az = mix(hp[o0 + 2], hp[o0 + 5], w);
          const bx = mix(hp[o1], hp[o1 + 3], w), by = mix(hp[o1 + 1], hp[o1 + 4], w), bz = mix(hp[o1 + 2], hp[o1 + 5], w);
          const px = ax + (bx - ax) * fr, py = ay + (by - ay) * fr, pz = az + (bz - az) * fr;
          let nx: number, ny: number, nz: number;
          if (frontFacing) { nx = fwdH[0]; ny = fwdH[1] + 0.3; nz = fwdH[2]; }
          else { nx = px - hc[0]; ny = (py - hc[1]) * 0.25; nz = pz - hc[2]; }
          const nl = 1 / (Math.hypot(nx, ny, nz) || 1);
          solidDot(px, py, pz, nx * nl, ny * nl, nz * nl);
        }
      };
      sheet(st[K.Bangs + 1], true);
      sheet(st[K.Side + 1], false);
      sheet(st[K.Back + 1], false);
      dotSize = HAIR_SP * 1.5;
      // Twin-tails: thick tubes of hair around each tail's center line.
      const end = st[K.Tail + 1];
      for (; j < end;) {
        const tt = ka[j], k = kb[j], a = kc[j];
        const C = this.tc[tt], N1 = this.tn1[tt], N2 = this.tn2[tt];
        const f = k * (NODES - 1), i0 = Math.min(NODES - 2, Math.floor(f)), w = f - i0, o = i0 * 3;
        const ca = Math.cos(a), sa = Math.sin(a), r = tailR(k) * (1 + 0.14 * Math.sin(a * 5 + k * 7 + tt) + 0.06 * Math.sin(a * 11 - k * 13));
        const nx = mix(N1[o], N1[o + 3], w) * ca + mix(N2[o], N2[o + 3], w) * sa;
        const ny = mix(N1[o + 1], N1[o + 4], w) * ca + mix(N2[o + 1], N2[o + 4], w) * sa;
        const nz = mix(N1[o + 2], N1[o + 5], w) * ca + mix(N2[o + 2], N2[o + 5], w) * sa;
        solidDot(mix(C[o], C[o + 3], w) + nx * r, mix(C[o + 1], C[o + 4], w) + ny * r, mix(C[o + 2], C[o + 5], w) + nz * r, nx, ny, nz);
      }
      dotSize = DOT;
      rigid(M, hc, st[K.Tie + 1]);
    }
    } else {
      // The gathering column glows softly while the cabinet's dots arrive, then fades as she forms out of it.
      const since = (env.now - this.started) / 1000;
      this.gatherGlow = 0.32 * (1 - smooth((since - 1.3) / 1.1));
      this.gathering = since < 3;
      // Particles living on the video dancer: born where her body is lit, then streaming off or flickering.
      this.emitFromVideo(env, step, t);
      this.frontLights(W, H, t);
      // The rest of her old dots gather in a column where the video forms her and fade out,
      // so the cabinet's dots stream into the spot where she appears.
      // (Only needed while the cabinet's dots are arriving; after that these dots stay hidden.)
      if (this.gathering) for (j = EMIT; j < this.nBody; j++) this.gather(j, W, H);
      j = this.nBody;
    }

    // ---- glowing orbs: a deep field of them all around (big and soft when close), and a swirl near her ----
    maxS = 14;
    for (let i = 0; i < ORBS; i++) {
      const sd = seed[j], sd2 = (sd * 13.7) % 1, sd3 = (sd * 91.3) % 1, sd4 = (sd * 371.9) % 1;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.2 + sd * 3) + sd2 * 40);
      if (i < ORBS * 0.7) {
        const ang = sd3 * 6.283 + t * 0.02 * (sd2 - 0.5);
        const rad = 1.4 + Math.pow(sd, 0.8) * 5.5;
        const y = ((sd2 * 7 + t * (0.03 + sd4 * 0.05)) % 7) - 2.2;
        const big = sd4 > 0.93 ? 2.6 : sd4 > 0.75 ? 1.6 : 1;
        glowDot(Math.cos(ang) * rad, y, Math.sin(ang) * rad, (1.3 + sd3 * 1.5) * big, (0.45 + 0.55 * tw) * (big > 2 ? 0.6 : 1) * (0.7 + 0.3 * energy) * (PARTICLE_GIRL ? 1 : 0.45), C_ORB, sd2 > 0.82 ? ORB_Y : sd2 > 0.7 ? ORB_P : ORB_W);
      } else {
        const rise = (sd2 + t * (0.05 + sd3 * 0.08)) % 1;
        const rad = (0.5 + sd * 0.9) * (1 + this.kick * 0.12 * (1 - rise)) + Math.sin(t * 0.7 + sd * 30) * 0.05;
        const ang = sd3 * 6.283 + t * (0.25 + (1 - sd) * 0.5) * (sd2 > 0.5 ? 1 : -1);
        glowDot(Math.cos(ang) * rad, rise * 2.4, Math.sin(ang) * rad, 0.8 + sd2, (0.3 + 0.6 * tw) * Math.sin(Math.PI * rise) * energy * (PARTICLE_GIRL ? 1 : 0.4), C_ORB, sd > 0.6 ? ORB_P : sd > 0.45 ? ORB_Y : ORB_W);
      }
    }
    maxS = 3.2;

    // ---- floor: a glowing pool of particles under her feet, and a soft ripple on every beat ----
    {
      const ph = ((beat % 1) + 1) % 1;
      const poolA = PARTICLE_GIRL ? 1 - 0.85 * fade : 0; // the video brings its own pool
      for (let i = 0; i < RING; i++) {
        const sd = seed[j], sd2 = (sd * 13.7) % 1, sd3 = (sd * 91.3) % 1;
        const ang = sd3 * 6.283;
        if (i < RING * 0.8) {
          const edge = 1 + 0.2 * Math.sin(ang * 5 + t * 0.5 + 1.3) + 0.1 * Math.sin(ang * 11 - t * 0.8);
          const rad = 0.46 * Math.sqrt(sd) * edge;
          const tw = 0.6 + 0.4 * Math.sin(t * (2 + sd2 * 4) + sd * 30);
          glowDot(Math.cos(ang) * rad, 0.003, Math.sin(ang) * rad, 1.4, (0.5 + 0.4 * (1 - sd)) * tw * poolA * (1 + this.kick * 0.4), C_RING, POOL);
        } else {
          const rad = 0.4 + Math.pow(ph, 0.55) * 1.6;
          glowDot(Math.cos(ang) * rad, 0.004, Math.sin(ang) * rad, 1.1, (1 - ph) * (1 - ph) * Math.min(1, this.kick + 0.2) * 0.45 * poolA, C_RING, POOL);
        }
      }
    }

    // ---- sparks thrown off her hands on the big beats ----
    this.hands = [sk.armL.wr, sk.armR.wr];
    for (let i = 0; i < SPARKS; i++) {
      const life = this.sl[i];
      if (life < 1.2) {
        const o = i * 3;
        this.sv[o + 1] -= 2.2 * step;
        this.sp[o] += this.sv[o] * step; this.sp[o + 1] += this.sv[o + 1] * step; this.sp[o + 2] += this.sv[o + 2] * step;
        this.sl[i] = life + step;
        const k = 1 - life / 1.2;
        glowDot(this.sp[o], Math.max(0, this.sp[o + 1]), this.sp[o + 2], 1.3, k * k, C_SPARK, i % 3 ? GOLD : ORB_P);
      } else {
        A[j] = 0; j++;
      }
    }

    this.dust.update(this, env, 0.8);

    // ---- lights: a soft violet backlight behind her and a lilac pool on the floor ----
    const proj = (p: V3): [number, number] | null => {
      const dx = p[0] - ex, dy = p[1] - ey, dz = p[2] - ez, z = dx * fx + dy * fy + dz * fz;
      if (z < 0.15) return null;
      return [cx + ((dx * rx + dy * ry + dz * rz) / z) * focal, cy - ((dx * ux + dy * uy + dz * uz) / z) * focal];
    };
    const chest: [number, number] | null = PARTICLE_GIRL ? proj(add(sk.waist, [0, 0.25, 0])) : [W / 2, H * 0.42];
    const feet: [number, number] | null = PARTICLE_GIRL ? proj([0, 0, 0]) : [W / 2, H * 0.86];
    const pulse = (0.1 + this.kick * 0.07 + bass * 0.05) * (PARTICLE_GIRL ? 1 : 0.45);
    this.aura = chest ? { x: chest[0], y: chest[1], r: Math.min(W, H) * 0.55, rgb: [230, 80, 255], a: pulse } : null;
    this.underglow = feet ? { x: feet[0], y: feet[1], r: Math.min(W, H) * 0.4, ry: Math.min(W, H) * 0.09, rgb: [200, 140, 255], a: (0.1 + this.kick * 0.08) * (PARTICLE_GIRL ? 1 : 0.5) } : null;
    if (!PARTICLE_GIRL) this.camera2d(env, t, step);
  }

  /**
   * Films the video dancer like a music video: a shot per phrase, whipping between them on the phrase change, a small
   * bump on every bar and on the beat, pulling back as she blows away in the break and punching in (with a shake)
   * on the drop. Everything on screen is moved by it, the lights in front of her more and the orbs behind her less,
   * so it feels like there's depth.
   */
  private camera2d(env: Env, t: number, step: number) {
    const { H } = env;
    const beat = (t - BEAT0) * (BPM / 60);
    // Where the camera wants to be right now.
    let z = 1, x = 0, y = 0, r = 0;
    if (dance.on && !env.still) {
      if (t >= BREAK && t < DROP - 0.7) { z = 0.9; y = -0.03; } // pulling back while she blows away
      // Then in close just before she snaps back, so her feet are below the screen while she reforms (they come
      // in a moment after the rest of her), and out again once they're in.
      else if (t >= DROP - 0.7 && t < DROP + 0.55) { z = 1.4; y = 0.06; }
      else if (t >= DANCE_LENGTH - 1.3) z = 0.96; // and as the song ends
      else if (t >= ORBIT_AT - 0.3 && t < ORBIT_AT + ORBIT_LEN) { z = 1.06; y = 0.02; } // wide and level for the orbit
      else if (beat >= 0) {
        // (After the drop it picks up on the tilted side shot, so the mirrored swing shows straight away.)
        const phrase = Math.floor(beat / 8), u = (beat - phrase * 8) / 8;
        const S = SHOTS_2D[(phrase + (t >= DROP ? 2 : 0)) % SHOTS_2D.length];
        // Every other time through the shots (so, after the break), they're mirrored: the camera swings the other way.
        const flip = Math.floor(phrase / SHOTS_2D.length) % 2 ? -1 : 1;
        z = mix(S.z[0], S.z[1], u); x = flip * mix(S.x[0], S.x[1], u); y = mix(S.y[0], S.y[1], u); r = flip * mix(S.r[0], S.r[1], u);
        // A bump on the first beat of every bar.
        const bar = Math.floor(beat / 4);
        if (bar !== this.lastBar) { this.lastBar = bar; this.camV[0] += 0.35; }
      }
      // The drop: punch in, and shake.
      if (t >= DROP && t < DROP + 0.5 && !this.dropHit) { this.dropHit = true; this.camV[0] += 0.9; this.shake = 1; }
    }
    const tgt = [z, x * H, y * H, r], cur = [this.camZ, this.camX, this.camY, this.camR], dt = Math.min(step, 0.05);
    for (let a = 0; a < 4; a++) {
      this.camV[a] += ((tgt[a] - cur[a]) * CAM_K - this.camV[a] * CAM_D) * dt;
      cur[a] += this.camV[a] * dt;
    }
    [this.camZ, this.camX, this.camY, this.camR] = cur;
    this.shake *= Math.pow(0.02, dt);
    const k = H / 900, sh = this.shake * this.shake;
    const zoom = this.camZ * (1 + 0.012 * this.kick);
    const shx = Math.sin(t * 61) * 9 * k * sh, shy = Math.cos(t * 47) * 7 * k * sh, rot = this.camR + Math.sin(t * 53) * 0.02 * sh;
    if (Math.abs(zoom - 1) < 1e-4 && Math.abs(this.camX) < 0.05 && Math.abs(this.camY) < 0.05 && Math.abs(rot) < 1e-5) return;

    // Move everything: around her middle, by how near each layer is to the camera.
    const R = this.vidRect;
    const px = R.x + ((FLOOR_COL + 0.5) / SW) * R.w, py = R.y + 0.5 * R.h;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const X = this.x, Y = this.y, A = this.a;
    const nb = this.nBody, orbsEnd = nb + ORBS, frontStart = this.count - DUST - FRONT, frontEnd = this.count - DUST;
    const layer = (i0: number, i1: number, d: number) => {
      const zd = 1 + (zoom - 1) * d, tx = (this.camX + shx) * d, ty = (this.camY + shy) * d;
      const a = cr * zd, b = sr * zd;
      for (let i = i0; i < i1; i++) {
        if (A[i] <= 0) continue;
        const dx = X[i] - px, dy = Y[i] - py;
        X[i] = px + dx * a - dy * b + tx;
        Y[i] = py + dx * b + dy * a + ty;
      }
    };
    layer(0, nb, 1); // her, her floor, the column she forms from
    layer(nb, orbsEnd, 0.55); // the orbs far behind her
    layer(orbsEnd, frontStart, 1);
    layer(frontStart, frontEnd, 1.6); // the lights in front of her
    layer(frontEnd, this.count, 0.75); // the dust
    // Her lights move with her.
    const move = (L: Aura | null): Aura | null => {
      if (!L) return L;
      const dx = L.x - px, dy = L.y - py;
      return { ...L, x: px + (dx * cr - dy * sr) * zoom + this.camX + shx, y: py + (dx * sr + dy * cr) * zoom + this.camY + shy, r: L.r * zoom, ry: L.ry !== undefined ? L.ry * zoom : undefined };
    };
    this.aura = move(this.aura);
    this.underglow = move(this.underglow);
  }

  /**
   * Big soft lights drifting slowly up in front of her, like out-of-focus lights close to a camera: the glowing orbs
   * behind her, brought to the front. The nearer ones are bigger, softer, dimmer and drift faster. They come and go
   * with the dance floor and glow up a little on every beat.
   */
  private frontLights(W: number, H: number, t: number) {
    const n0 = this.count - DUST - FRONT, k = H / 900, show = this.floorVis, kick = this.kick;
    const sweep = dance.on ? (orbitAt(t) / (Math.PI * 2)) * 1.6 : 0; // (across the screen during the orbit)
    for (let p = 0; p < FRONT; p++) {
      const i = n0 + p, sd = this.seed[i], s2 = (sd * 13.7) % 1, s3 = (sd * 91.3) % 1, near = (sd * 371.9) % 1;
      const speed = 0.012 + 0.03 * near;
      // Each wraps around the screen: across off the edges (unseen), and up from the bottom to the top, fading in
      // and out at either end of its climb.
      const u = (((s2 + t * speed * (s3 - 0.5) * 0.7 - sweep * (0.6 + near)) % 1) + 1) % 1, v = (s3 + t * speed) % 1;
      this.x[i] = (u * 1.2 - 0.1) * W + Math.sin(t * 0.3 + sd * 20) * 20 * k;
      this.y[i] = ((1 - v) * 1.1 - 0.05) * H;
      const tw = 0.7 + 0.3 * Math.sin(t * (0.8 + s2 * 1.5) + sd * 30);
      this.s[i] = (16 + 50 * near * near) * k * (1 + 0.06 * kick);
      this.a[i] = (0.15 - 0.08 * near) * tw * Math.sqrt(Math.sin(Math.PI * v)) * (1 + 0.5 * kick) * show;
      this.c[i] = C_BOKEH;
      this.depth![i] = 0.02;
      const c = BOKEH[Math.floor(s2 * BOKEH.length)], o = i * 3;
      this.rgbPer![o] = c[0]; this.rgbPer![o + 1] = c[1]; this.rgbPer![o + 2] = c[2];
    }
  }

  /**
   * Where a dot of hers waits when it isn't a grain of sand: a column where she stands, which the cabinet's dots
   * travel into as she appears.
   */
  private gather(j: number, W: number, H: number) {
    const sd = this.seed[j], sd2 = (sd * 53.1) % 1;
    const glow = this.gatherGlow;
    this.a[j] = glow > 0.005 ? glow * (0.5 + sd2) : 0;
    if (this.a[j] > 0) {
      this.s[j] = 1.1;
      this.c[j] = C_SAND;
      this.depth![j] = 0.5;
      const o = j * 3, g = this.gatherCol;
      this.rgbPer![o] = g[o]; this.rgbPer![o + 1] = g[o + 1]; this.rgbPer![o + 2] = g[o + 2];
    }
    this.x[j] = W / 2 + (sd - 0.5) * H * 0.12 * (1 - sd2 * 0.5);
    this.y[j] = H * (0.86 - 0.66 * sd2);
  }

  /** Starts the worker that reads the video ahead of time, so it's ready (and loaded) when she's summoned. */
  warm() {
    if (!PARTICLE_GIRL) this.startWorker();
  }

  private startWorker() {
    if (!this.worker && !this.workerFailed) {
      try {
        this.worker = new Worker(new URL('./sandScan.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<ScanResult>) => { this.scanned = e.data; this.scanBusy = false; };
        this.worker.onerror = () => {
          // No worker after all: read on this thread from now on (with fresh arrays, as the others went with it).
          this.worker?.terminate();
          this.worker = null;
          this.workerFailed = true;
          this.spareLit = new Int32Array(SW * SH);
          this.spareLitB = new Float32Array(SW * SH);
          this.scanBusy = false;
        };
      } catch {
        this.workerFailed = true;
      }
    }
  }

  /**
   * Starts reading the video's current frame. With a worker (almost always), the frame is handed over as a bitmap and
   * read there; the result comes back a frame or two later and is put to use in emitFromVideo.
   */
  private startScan(v: HTMLVideoElement) {
    this.startWorker();
    const lit = this.spareLit, litB = this.spareLitB;
    if (!lit || !litB) return;
    this.lastVidT = v.currentTime;
    const footX = this.footX, footW = this.footW, unformed = danceVideo.unformed;
    if (this.worker) {
      const w = this.worker;
      this.scanBusy = true;
      this.spareLit = null; this.spareLitB = null;
      createImageBitmap(v).then(
        (bitmap) => w.postMessage({ bitmap, footX, footW, lit, litB, unformed }, [bitmap, lit.buffer, litB.buffer]),
        () => { this.spareLit = lit; this.spareLitB = litB; this.scanBusy = false; },
      );
      return;
    }
    if (!this.sample) {
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      this.sample = c.getContext('2d', { willReadFrequently: true });
    }
    if (!this.sample) return;
    this.sample.drawImage(v, 0, 0, SW, SH);
    this.spareLit = null; this.spareLitB = null;
    this.scanned = scan(this.sample.getImageData(0, 0, SW, SH).data, footX, footW, lit, litB, unformed);
  }

  /**
   * She's made of sand, like the cabinet's static.  /**
   * She's made of sand, like the cabinet's static. Every other frame, a little copy of the (hidden) video frame
   * shows where her body is and how bright. Tens of thousands of fine grains are born on those spots, brighter
   * where she's brighter, colored like a neon arcade sign from head to toe: most live a split second and jitter in
   * place (a shifting, radioactive grain that is her body), a few blow off her edges.
   */
  private emitFromVideo(env: Env, step: number, t: number) {
    const { canvasRect } = env;
    const v = danceVideo.el, vis = danceVideo.alpha;
    // Read the video whenever it shows a new frame (off the main thread), and put each reading to use once it's in.
    if (v && v.readyState >= 2 && !this.scanBusy && !this.scanned && v.currentTime !== this.lastVidT) this.startScan(v);
    if (v && this.scanned) {
      const r = this.scanned;
      this.scanned = null;
      this.spareLit = this.lit; this.spareLitB = this.litB;
      this.lit = r.lit; this.litB = r.litB;
      this.nLit = r.n;
      for (let rw = 0; rw < SH; rw++) this.rowMid[rw] = r.rowCnt[rw] > 0 ? r.rowSum[rw] / r.rowCnt[rw] : SW / 2;
      if (r.fMax > r.fMin) { this.footX += ((r.fMin + r.fMax) / 2 - this.footX) * 0.2; this.footW += (Math.min(LEGS_MAX, r.fMax - r.fMin) - this.footW) * 0.2; }
      // Her height, eased so the colors don't jump when an arm goes up.
      if (r.bot > r.top) { this.topRow += (r.top - this.topRow) * 0.15; this.botRow += (r.bot - this.botRow) * 0.15; }
      // Her neon color on each row, head to toe.
      const span = Math.max(8, this.botRow - this.topRow);
      for (let rw = 0; rw < SH; rw++) {
        const c = neon((rw + 0.5 - this.topRow) / span);
        this.rowCol[rw * 3] = c[0]; this.rowCol[rw * 3 + 1] = c[1]; this.rowCol[rw * 3 + 2] = c[2];
      }
      const rc = v.getBoundingClientRect();
      this.vidRect = { x: rc.left - canvasRect.left, y: rc.top - canvasRect.top, w: rc.width, h: rc.height };
    }
    const R = this.vidRect, k = env.H / 900;
    // ---- hitting with the music (only while she's whole and dancing) ----
    const beat = (t - BEAT0) * (BPM / 60), live = dance.on && beat >= 0 ? 1 - danceVideo.unformed : 0;
    const kick = this.kick * live;
    // On every beat she swells a touch, from her feet (so she stays on the floor): a bass thump.
    const zoom = 1 + 0.035 * kick, fx = R.x + ((FLOOR_COL + 0.5) / SW) * R.w, fy = R.y + 0.9 * R.h;
    // On the first beat of every bar, a band of white-hot light runs up her body, feet to head, in half a second.
    const sweepK = (((beat % 4) + 4) % 4) / (0.5 * (BPM / 60));
    const sweep = sweepK < 1 ? live * (1 - 0.5 * sweepK) : 0;
    const bandRow = this.botRow - (this.botRow - this.topRow + 12) * sweepK;
    if (this.nLit > 0 && vis > 0.05) {
      const frames = Math.min(2, step * 60);
      // (And on every beat a spray of sand flies off her.)
      const streams = Math.round(STREAMS_PER_FRAME * vis * frames * (1 + 4 * kick * kick));
      const born = streams + Math.round(FLICKER_PER_FRAME * vis * frames);
      for (let b = 0; b < born; b++) {
        const i = this.nextEmit;
        this.nextEmit = (this.nextEmit + 1) % (EMIT - POOL_N);
        const pick = Math.floor(Math.random() * this.nLit), px = this.lit[pick];
        const row = Math.floor(px / SW);
        let col = (px % SW) + Math.random();
        // A slimmer stomach and waist: pulled toward her middle, most at the narrowest point, easing off above and
        // below, and only near her body (an arm reaching out stays where it is).
        const ny = (row - this.topRow) / Math.max(8, this.botRow - this.topRow);
        const pinch = WAIST_PINCH * Math.exp(-(((ny - 0.44) / 0.075) ** 2));
        if (pinch > 0.01) {
          const off = col - this.rowMid[row], near = 1 - smooth((Math.abs(off) - SW * 0.04) / (SW * 0.03));
          col = this.rowMid[row] + off * (1 - pinch * near);
        }
        this.ex[i] = fx + (R.x + (col / SW) * R.w - fx) * zoom;
        this.ey[i] = fy + (R.y + (row + Math.random()) / SH * R.h - fy) * zoom;
        this.eLit[i] = this.litB[pick];
        // (Not while she blows away or forms: then her feet are sand like the rest of her.)
        this.eFoot[i] = row >= SH * 0.81 && danceVideo.unformed < 0.5 ? 1 : 0;
        if (this.eFoot[i]) this.ex[i] += (Math.random() - 0.5) * (R.w / SW) * 2.4;
        // Her neon color at that height, with a little grain-to-grain variation; whiter where she's brightest.
        const vary = 0.8 + Math.random() * 0.4, hot = Math.max(0, this.litB[pick] - 0.85) * 1.5;
        this.eCol[i * 3] = Math.min(255, mix(this.rowCol[row * 3], 255, hot) * vary);
        this.eCol[i * 3 + 1] = Math.min(255, mix(this.rowCol[row * 3 + 1], 245, hot) * vary);
        this.eCol[i * 3 + 2] = Math.min(255, mix(this.rowCol[row * 3 + 2], 250, hot) * vary);
        this.eAmp[i] = Math.pow(this.litB[pick], 1.25);
        if (sweep > 0) {
          const band = sweep * Math.exp(-(((row - bandRow) / 11) ** 2));
          for (let c = 0; c < 3; c++) this.eCol[i * 3 + c] = mix(this.eCol[i * 3 + c], 255, 0.9 * band);
          this.eAmp[i] *= 1 + 2.2 * band;
        }
        const blow = b < streams;
        this.eKind[i] = blow ? 0 : 1;
        this.eAge[i] = 0;
        this.eLife[i] = blow ? 0.5 + Math.random() * 0.9 : 0.06 + Math.random() * 0.18;
        // Blown grains drift outward from her and a little up, slowly; static grains don't travel.
        const out = (this.ex[i] - (R.x + R.w * 0.5)) / (R.w * 0.1 + 1);
        this.evx[i] = blow ? (out * 8 + (Math.random() - 0.5) * 24) * (1 + 1.5 * kick) * k : 0;
        this.evy[i] = blow ? (-8 - Math.random() * 22) * (1 + kick) * k : 0;
        // What stays the same for the grain's whole short life is set once, here.
        this.s[i] = (0.8 + this.litB[pick] * 0.4) * k * (1 + (this.camZ - 1) * 0.8);
        this.depth![i] = 0.5;
        this.c[i] = (i & 3) === 0 ? C_SAND_GLOW : C_SAND;
        this.rgbPer![i * 3] = this.eCol[i * 3]; this.rgbPer![i * 3 + 1] = this.eCol[i * 3 + 1]; this.rgbPer![i * 3 + 2] = this.eCol[i * 3 + 2];
      }
    }
    const X = this.x, Y = this.y, S = this.s, A = this.a, Cc = this.c, rgb = this.rgbPer!, Dp = this.depth!;
    let r = this.rng;
    /** Fast random number from 0 to 1 (xorshift). */
    const rand = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
    const eAge = this.eAge, eLife = this.eLife, eLit = this.eLit, eAmp = this.eAmp, eKind = this.eKind, eFoot = this.eFoot;
    const ex = this.ex, ey = this.ey, evx = this.evx, evy = this.evy;
    const t23 = t * 2.3, t11 = t * 1.1, t19 = t * 1.9, kx = 20 * k * step, ky = 16 * k * step;
    for (let i = 0; i < EMIT - POOL_N; i++) {
      const age = (eAge[i] += step), life = eLife[i];
      if (age >= life) { A[i] = 0; continue; }
      const lit = eLit[i];
      let x = ex[i], y = ey[i];
      if (eKind[i] === 0) {
        // A gentle, grainy drift: neighbouring grains bend the same way.
        const q = age / life;
        evx[i] += (Math.sin(y * 0.03 + t23) + Math.sin(x * 0.02 - t11)) * kx;
        evy[i] += Math.cos(x * 0.025 + t19) * ky;
        x += evx[i] * step; y += evy[i] * step;
        ex[i] = x; ey[i] = y;
        A[i] = Math.min(1, q * 10) * (1 - q) * 0.5 * (0.2 + lit);
      } else {
        // Static: each grain twitches around its spot and flickers, like the cabinet's noise.
        const jit = (eFoot[i] ? 4.5 : 1.3) * k;
        x += (rand() - 0.5) * jit; y += (rand() - 0.5) * jit;
        A[i] = (rand() < 0.75 ? 0.42 : 0.16) * eAmp[i];
      }
      X[i] = x; Y[i] = y;
    }
    this.rng = r;

    // The floor fades in with her and out with her at the very end, but in between it holds steady: when she blows
    // away in the break and snaps back on the drop (her fake-out) it stays, waiting for her, and it doesn't dip when
    // the video crossfades at its loop seam either.
    this.floorVis = dance.on && t < DANCE_LENGTH - 1.5 ? Math.max(this.floorVis, vis) : vis;

    // The floor: a symbolic ring of sand around her, with nothing under her feet so they stand on their own:
    // a thin glowing outer ring with grains slowly circling it, a fainter dashed inner ring turning the other way,
    // and a soft ripple spreading out from her feet on every beat. The back of each ring hides behind her legs.
    const seed = this.seed;
    const ph = ((beat % 1) + 1) % 1, spin = dance.on ? orbitAt(t) : 0;
    const pcx = R.x + ((FLOOR_COL + 0.5) / SW) * R.w, pcy = R.y + (FLOOR_ROW + 0.03) * R.h;
    const rx = 0.19 * R.w, ry = rx * 0.2;
    // The back of the ring hides behind her legs (closing up as she fades, so the ring is whole while she's gone).
    const legX = R.x + ((clamp(this.footX, FLOOR_COL - 12, FLOOR_COL + 12) + 0.5) / SW) * R.w;
    const legs = ((this.footW / SW) * R.w * 0.75 + 4 * k) * smooth((vis - 0.2) / 0.6);
    const n0 = EMIT - POOL_N, outerEnd = n0 + POOL_N * 0.6, innerEnd = n0 + POOL_N * 0.85;
    for (let i = n0; i < EMIT; i++) {
      const sd = seed[i], p = i - n0, a0 = this.poolAng[p], u = this.poolRad[p];
      const tw = 0.6 + 0.4 * Math.sin(t * (3 + sd * 5) + sd * 40);
      let a: number, rad: number, al: number;
      if (i < outerEnd) { a = a0 + t * 0.12 + spin; rad = 1 + (u - 0.5) * 0.07; al = 0.5; }
      else if (i < innerEnd) { a = a0 - t * 0.2 + spin; rad = 0.62 + (u - 0.5) * 0.035; al = Math.sin(a * 14) > 0.2 ? 0.32 : 0; }
      else { a = a0; rad = 0.22 + Math.pow(ph, 0.6) * 0.95 + (u - 0.5) * 0.03; al = (1 - ph) * (1 - ph) * 0.4; }
      const x = pcx + Math.cos(a) * rad * rx, y = pcy + Math.sin(a) * rad * ry;
      if (Math.sin(a) < 0 && Math.abs(x - legX) < legs) al = 0;
      X[i] = x; Y[i] = y;
      A[i] = al * tw * this.floorVis;
      S[i] = 0.9 * k;
      Dp[i] = 0.5;
      Cc[i] = (i & 3) === 0 ? C_SAND_GLOW : C_SAND;
      // Cyan at the front, lilac round the back.
      const back = 0.5 - 0.5 * Math.sin(a), o = i * 3;
      rgb[o] = mix(90, 200, back); rgb[o + 1] = mix(226, 160, back); rgb[o + 2] = 255;
    }
    this.rng = r;
  }

  /** Each twin-tail's center line (the average of its strands) and a frame along it, for drawing it as a tube. */
  private tailFrames(sk: ReturnType<DanceScene['skeleton']>) {
    const side: V3 = [sk.MH[0], sk.MH[3], sk.MH[6]];
    for (let t = 0; t < 2; t++) {
      const C = this.tc[t], N1 = this.tn1[t], N2 = this.tn2[t], s0 = this.tailStart[t];
      C.fill(0);
      for (let s = s0; s < s0 + N_TWIN; s++) for (let i = 0; i < NODES * 3; i++) C[i] += this.hp[s * NODES * 3 + i] / N_TWIN;
      for (let i = 0; i < NODES; i++) {
        const a = Math.max(0, i - 1) * 3, b = Math.min(NODES - 1, i + 1) * 3;
        const T = norm([C[b] - C[a], C[b + 1] - C[a + 1], C[b + 2] - C[a + 2]]);
        let n1 = cross(T, side);
        if (len(n1) < 0.1) n1 = cross(T, [0, 0, 1]);
        n1 = norm(n1);
        const n2 = cross(T, n1);
        N1[i * 3] = n1[0]; N1[i * 3 + 1] = n1[1]; N1[i * 3 + 2] = n1[2];
        N2[i * 3] = n2[0]; N2[i * 3 + 1] = n2[1]; N2[i * 3 + 2] = n2[2];
      }
    }
  }

  /** A hand: palm, four fingers and a thumb, curled as the pose asks. */
  private hand(h: ArmJ, end: number, j0: number, solidDot: (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => void) {
    const ka = this.ka, kb = this.kb, kna = this.kna, knb = this.knb;
    const { wr, d, n, t: th } = h;
    const fingers: { base: V3; dir: V3; len: number; r: number; c: number; side: V3 }[] = [];
    for (let f = 0; f < 4; f++) {
      const [off, l, r] = FINGERS[f];
      const ext = f === 0 ? h.idx : f === 1 ? h.mid : 0;
      const spread = f === 0 ? 0.04 + 0.2 * h.idx * h.mid : f === 1 ? -0.02 - 0.2 * h.idx * h.mid : f === 2 ? -0.06 : -0.12;
      fingers.push({ base: add(add(wr, scl(d, 0.082)), scl(th, off)), dir: norm(add(d, scl(th, spread))), len: l, r, c: h.curl * (1 - ext), side: th });
    }
    const tc = h.curl;
    const tdir = norm(add(add(scl(d, 0.55), scl(th, 0.75 * (1 - tc) + 0.1)), scl(n, 0.3 + 0.55 * tc)));
    fingers.push({ base: add(add(wr, scl(d, 0.02)), scl(th, 0.03)), dir: tdir, len: FINGERS[4][1], r: FINGERS[4][2], c: tc * 0.5, side: n });
    for (let j = j0; j < end; j++) {
      const piece = ka[j], u = kb[j], cv = kna[j], sv = knb[j];
      if (piece === 0) {
        const along = 0.012 + 0.072 * u;
        const wd = 0.034 * (0.82 + 0.18 * u) * Math.sqrt(Math.max(0.15, 1 - Math.pow(2 * u - 1, 8)));
        const tk = 0.013;
        const nx = th[0] * cv * 0.5 + n[0] * sv, ny = th[1] * cv * 0.5 + n[1] * sv, nz = th[2] * cv * 0.5 + n[2] * sv, nl = 1 / (Math.hypot(nx, ny, nz) || 1);
        solidDot(wr[0] + d[0] * along + th[0] * cv * wd + n[0] * sv * tk, wr[1] + d[1] * along + th[1] * cv * wd + n[1] * sv * tk, wr[2] + d[2] * along + th[2] * cv * wd + n[2] * sv * tk, nx * nl, ny * nl, nz * nl);
      } else {
        const F = fingers[piece - 1];
        const bend = F.c * 1.75 * u;
        const ch = Math.cos(bend / 2), shh = Math.sin(bend / 2);
        const cdx = F.dir[0] * ch + n[0] * shh, cdy = F.dir[1] * ch + n[1] * shh, cdz = F.dir[2] * ch + n[2] * shh;
        const r = F.r * (1 - 0.25 * u) * (u > 0.9 ? Math.sqrt(1 - Math.pow((u - 0.9) / 0.1, 2)) * 0.6 + 0.4 : 1);
        const nx = F.side[0] * cv + n[0] * sv, ny = F.side[1] * cv + n[1] * sv, nz = F.side[2] * cv + n[2] * sv;
        solidDot(F.base[0] + cdx * F.len * u + nx * r, F.base[1] + cdy * F.len * u + ny * r, F.base[2] + cdz * F.len * u + nz * r, nx, ny, nz);
      }
    }
  }

  /** Sends sparks flying from both hands. */
  private burst(power: number) {
    for (const h of this.hands) {
      for (let n = 0; n < 50; n++) {
        const i = this.nextSpark;
        this.nextSpark = (this.nextSpark + 1) % SPARKS;
        const o = i * 3;
        this.sp[o] = h[0]; this.sp[o + 1] = h[1]; this.sp[o + 2] = h[2];
        const a = Math.random() * 6.283, e = Math.random() * 1.2 - 0.2, sp = (0.6 + Math.random() * 1.4) * power;
        this.sv[o] = Math.cos(a) * Math.cos(e) * sp;
        this.sv[o + 1] = Math.sin(e) * sp + 0.6;
        this.sv[o + 2] = Math.sin(a) * Math.cos(e) * sp;
        this.sl[i] = Math.random() * 0.2;
      }
    }
  }

  /** Glides between camera shots, with a slow orbit inside each one. */
  private camera(beat: number, step: number, still: boolean) {
    let si = 0;
    while (si + 1 < SHOTS.length && beat >= SHOTS[si + 1].at) si++;
    const s = SHOTS[si];
    const C = this.cam;
    const k = still ? 1 : 1 - Math.pow(0.18, step);
    if (!still) this.camOrbit += s.yawSpeed * step;
    let dy = s.yaw - (C.yaw + this.camOrbit);
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    C.yaw += dy * k * 0.6;
    C.pitch += (s.pitch - C.pitch) * k;
    C.dist += (s.dist - C.dist) * k;
    C.lookY += (s.lookY - C.lookY) * k;
    C.roll += (s.roll - C.roll) * k;
    // Ease in from far away at the start, and pull back at the very end.
    const t = beat / (BPM / 60) + BEAT0;
    const intro = 1 - smooth(t / 3);
    const outro = smooth((t - (DANCE_LENGTH - 2.5)) / 2.5);
    C.zoom = 1 - 0.25 * intro - 0.3 * outro;
  }

  /** Works out where every joint is for this pose. */
  private skeleton(o: Pose, eye: V3) {
    const F = rotY(o[P.face]);
    const facing = app(F, 0, 0, 1);
    const pelvis = add(app(F, o[P.x], 0, o[P.z]), [0, 0.9 + o[P.y], 0]);
    const M0 = mul(F, euler(o[P.yaw], o[P.pitch], o[P.roll]));
    const waist = add(pelvis, app(M0, 0, WAIST, 0));
    const M1 = mul(M0, euler(o[P.cYaw], o[P.cPitch], o[P.cRoll]));
    const neckBase = add(waist, app(M1, 0, 0.34, 0.005));

    // She looks toward the camera (as far as her neck turns), unless it's behind her.
    let hYaw = o[P.hYaw], hPitch = o[P.hPitch];
    {
      const dv = norm(sub(eye, add(neckBase, app(M1, 0, 0.17, 0))));
      const l = appT(M1, dv[0], dv[1], dv[2]);
      const yawTo = Math.atan2(l[0], l[2]);
      const amt = o[P.look] * clamp01((2.3 - Math.abs(yawTo)) / 0.8);
      hYaw = mix(hYaw, clamp(yawTo, -0.75, 0.75) + hYaw * 0.4, amt);
      hPitch = mix(hPitch, clamp(-Math.asin(clamp(l[1], -1, 1)), -0.35, 0.35) + hPitch * 0.6, amt * 0.6);
    }
    const MH = mul(M1, euler(hYaw, hPitch, o[P.hRoll]));
    const neckTop = add(neckBase, app(M1, 0, 0.065, 0.005));
    const head = add(neckTop, app(MH, 0, 0.098, 0.012));

    const fwd0 = app(M0, 0, 0, 1);
    const arm_ = (side: number, base: number): ArmJ => {
      const S0 = add(waist, app(M1, 0.163 * side, 0.3, -0.01));
      const T = add(waist, app(M1, o[base] * side, o[base + 1], o[base + 2]));
      const Hh = app(M1, o[base + 3] * side, o[base + 4], o[base + 5]);
      const a = 0.265, b = 0.24;
      const v = sub(T, S0);
      let d = len(v);
      const dir: V3 = d > 1e-4 ? scl(v, 1 / d) : [0, -1, 0];
      d = clamp(d, 0.06, a + b - 0.004);
      let pp = sub(Hh, scl(dir, dot(Hh, dir)));
      if (len(pp) < 1e-3) pp = app(M1, 0, 0, -1);
      pp = norm(pp);
      const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      const el = add(S0, add(scl(dir, a * cosA), scl(pp, a * sinA)));
      const wr = add(S0, scl(dir, d));
      const fd = norm(sub(wr, el));
      let N = app(M1, o[base + 6] * side, o[base + 7], o[base + 8]);
      N = sub(N, scl(fd, dot(N, fd)));
      N = len(N) < 1e-3 ? scl(norm(cross(fd, pp)), -side) : norm(N);
      const wb = o[base + 9];
      const dd = norm(add(scl(fd, Math.cos(wb)), scl(N, Math.sin(wb))));
      const nn = norm(sub(scl(N, Math.cos(wb)), scl(fd, Math.sin(wb))));
      return { S: S0, el, wr, d: dd, n: nn, t: scl(cross(dd, nn), -side), curl: o[base + 10], idx: o[base + 11], mid: o[base + 12], up: seg(S0, el, fwd0), fore: seg(el, wr, fwd0) };
    };
    const armL = arm_(1, P.L), armR = arm_(-1, P.R);

    // Legs: the feet stay where the dance puts them, the knees bend to reach (forward, or in for a cute stance).
    const leg = (side: number, fx: number, fz: number, fy: number, kneeIn: number): LegJ => {
      const hip = add(pelvis, app(M0, 0.085 * side, -0.035, 0));
      const ankT = add(app(F, fx, 0, fz), [0, 0.075 + fy, 0]);
      const a = 0.43, b = 0.41;
      const toA = sub(ankT, hip);
      const d = Math.min(a + b - 0.002, Math.max(0.1, len(toA)));
      const dir = norm(toA);
      const pole0 = norm(app(M0, (0.18 - 0.7 * kneeIn) * side, 0, 1));
      const pole = norm(sub(pole0, scl(dir, dot(pole0, dir))));
      const cosA = (a * a + d * d - b * b) / (2 * a * d);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const knee = add(hip, add(scl(dir, a * cosA), scl(pole, a * sinA)));
      const ank = add(hip, scl(dir, d));
      const fwd = norm(add(app(F, (0.2 - 0.3 * kneeIn) * side, 0, 1), [0, -fy * 2.5, 0]));
      return { ank, fwd, thigh: seg(hip, knee, fwd0), shin: seg(knee, ank, fwd0) };
    };
    const legL = leg(1, o[P.lfX], o[P.lfZ], o[P.lfY], o[P.lKnee]);
    const legR = leg(-1, o[P.rfX], o[P.rfZ], o[P.rfY], o[P.rKnee]);

    const neck = seg(neckBase, add(neckTop, app(MH, 0, 0.02, 0)), fwd0);
    return { pelvis, M0, waist, M1, head, MH, neck, facing, armL, armR, legL, legR };
  }

  /** Hair: each strand swings with physics, pulled gently toward its styled shape, sliding off her head and body. */
  private stepHair(sk: ReturnType<DanceScene['skeleton']>, dt: number) {
    const hp = this.hp, hq = this.hq, goal = this.goal, rest = this.sRest;
    const M = sk.MH, hc = sk.head;
    for (let i = 0; i < STRANDS * NODES; i++) {
      const o = i * 3, x = rest[o], y = rest[o + 1], z = rest[o + 2];
      goal[o] = hc[0] + M[0] * x + M[1] * y + M[2] * z;
      goal[o + 1] = hc[1] + M[3] * x + M[4] * y + M[5] * z;
      goal[o + 2] = hc[2] + M[6] * x + M[7] * y + M[8] * z;
    }
    if (!this.hairReady) {
      hp.set(goal);
      hq.set(goal);
      this.hairReady = true;
    }
    // Spheres for the body: chest, upper back, shoulders, hips.
    const balls: [V3, number][] = [
      [add(sk.waist, app(sk.M1, 0, 0.27, 0.035)), 0.125],
      [add(sk.waist, app(sk.M1, 0, 0.3, -0.035)), 0.135],
      [sk.armL.S, 0.065],
      [sk.armR.S, 0.065],
      [add(sk.pelvis, app(sk.M0, 0, 0.02, -0.02)), 0.17],
    ];
    const n = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 120))));
    const h = dt / n;
    const g = -9.8 * h * h;
    const rx = HX * 1.13, ry = HY * 1.13, rz = HZ * 1.13;
    for (let it = 0; it < n; it++) {
      for (let s = 0; s < STRANDS; s++) {
        const base = s * NODES * 3, sl = this.segLen[s], stiff = this.sStiff[s];
        hp[base] = hq[base] = goal[base]; hp[base + 1] = hq[base + 1] = goal[base + 1]; hp[base + 2] = hq[base + 2] = goal[base + 2];
        for (let i = 1; i < NODES; i++) {
          const o = base + i * 3;
          const vx = (hp[o] - hq[o]) * 0.965, vy = (hp[o + 1] - hq[o + 1]) * 0.965, vz = (hp[o + 2] - hq[o + 2]) * 0.965;
          hq[o] = hp[o]; hq[o + 1] = hp[o + 1]; hq[o + 2] = hp[o + 2];
          hp[o] += vx; hp[o + 1] += vy + g; hp[o + 2] += vz;
          // Pull toward the styled shape, firmly near the root, loosely at the tips.
          const k = stiff * Math.pow(1 - i / NODES, 1.5) + stiff * 0.15;
          hp[o] += (goal[o] - hp[o]) * k; hp[o + 1] += (goal[o + 1] - hp[o + 1]) * k; hp[o + 2] += (goal[o + 2] - hp[o + 2]) * k;
        }
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < NODES; i++) {
            const o = base + i * 3, q = o - 3;
            const dx = hp[o] - hp[q], dy = hp[o + 1] - hp[q + 1], dz = hp[o + 2] - hp[q + 2];
            const d = Math.hypot(dx, dy, dz) || 1e-4, k = sl / d;
            hp[o] = hp[q] + dx * k; hp[o + 1] = hp[q + 1] + dy * k; hp[o + 2] = hp[q + 2] + dz * k;
            // Off the head (an egg shape matching the head) ...
            const ox = hp[o] - hc[0], oy = hp[o + 1] - hc[1], oz = hp[o + 2] - hc[2];
            const lx = (M[0] * ox + M[3] * oy + M[6] * oz) / rx, ly = (M[1] * ox + M[4] * oy + M[7] * oz) / ry, lz = (M[2] * ox + M[5] * oy + M[8] * oz) / rz;
            const e2 = lx * lx + ly * ly + lz * lz;
            if (e2 < 1 && e2 > 1e-6) {
              const kk = 1 / Math.sqrt(e2);
              const sx = lx * kk * rx, sy = ly * kk * ry, sz = lz * kk * rz;
              hp[o] = hc[0] + M[0] * sx + M[1] * sy + M[2] * sz;
              hp[o + 1] = hc[1] + M[3] * sx + M[4] * sy + M[5] * sz;
              hp[o + 2] = hc[2] + M[6] * sx + M[7] * sy + M[8] * sz;
            }
            // ... and off her body.
            for (const [c, r] of balls) {
              const bx = hp[o] - c[0], by = hp[o + 1] - c[1], bz = hp[o + 2] - c[2];
              const d2 = bx * bx + by * by + bz * bz;
              if (d2 < r * r && d2 > 1e-8) {
                const kk = r / Math.sqrt(d2);
                hp[o] = c[0] + bx * kk; hp[o + 1] = c[1] + by * kk; hp[o + 2] = c[2] + bz * kk;
              }
            }
            if (hp[o + 1] < 0.01) hp[o + 1] = 0.01;
          }
        }
      }
    }
  }
}
