// Maps a flat w x h element onto any four screen points with a CSS matrix3d, so a game can be
// "painted" onto the particle cabinet's screen and still take clicks, taps and keys normally.
// (The classic projective-transform construction: unit square -> source, unit square -> target.)

type M3 = number[]; // 3 x 3, row-major
type Pt = [number, number];

const adj = (m: M3): M3 => [
  m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];
const mulMM = (a: M3, b: M3): M3 => {
  const c: M3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return c;
};
const mulMV = (m: M3, v: number[]) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const basisToPoints = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): M3 => {
  const m = [p1[0], p2[0], p3[0], p1[1], p2[1], p3[1], 1, 1, 1];
  const v = mulMV(adj(m), [p4[0], p4[1], 1]);
  return mulMM(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};

/** CSS transform that puts a w x h element (transform-origin 0 0) onto corners TL, TR, BL, BR. */
export function quadToMatrix3d(w: number, h: number, quad: [Pt, Pt, Pt, Pt]) {
  const [tl, tr, bl, br] = quad;
  const s = basisToPoints([0, 0], [w, 0], [0, h], [w, h]);
  const d = basisToPoints(tl, tr, bl, br);
  const t = mulMM(d, adj(s)).map((x, _, arr) => x / arr[8]);
  const m = [t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]];
  return `matrix3d(${m.map((x) => +x.toFixed(9)).join(',')})`;
}

/** The axis-aligned box around four points. */
export function quadBox(quad: [Pt, Pt, Pt, Pt]) {
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
