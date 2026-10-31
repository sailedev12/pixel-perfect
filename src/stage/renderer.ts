// Draws the stage's particles. WebGL puts the work on the graphics card, which keeps tens of
// thousands of dots smooth and lets us add a neon "bloom" glow; the 2D canvas version is a
// fallback for browsers without WebGL.

export interface Frame {
  n: number;
  x: Float32Array;
  y: Float32Array;
  s: Float32Array;
  a: Float32Array;
  /** Colors as 0-255 per channel. */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Glow size multiplier per dot (0 = none). */
  glow: Float32Array;
  glowAlpha: number;
  /** Distance from the camera, 0 (near) to 1 (far, the default). Nearer dots hide farther ones. */
  z: Float32Array;
  /** 1 for solid dots, which hide whatever is behind them; 0 for glowing ones, which add light. */
  solid: Uint8Array;
}

/** A big soft colored light behind a scene's main piece. Position and radius in CSS pixels. */
export interface Aura {
  x: number;
  y: number;
  r: number;
  /** Vertical radius, for a flattened glow like light pooling on a floor; defaults to `r`. */
  ry?: number;
  rgb: [number, number, number];
  a: number;
}

export interface Renderer {
  resize(w: number, h: number, dpr: number): void;
  /** Darkens the previous frame; 1 clears it, lower values leave trails. */
  fade(amount: number): void;
  draw(f: Frame): void;
  /** Shows the finished frame on screen, with glow, up to two soft lights and the arcade-screen look. */
  present(time: number, auras: (Aura | null)[]): void;
}

/** How strong the neon glow is. */
const BLOOM = 0.85;

const POINT_VERT = `
attribute vec2 aPos;
attribute float aSize;
attribute float aDepth;
attribute vec4 aCol;
uniform vec2 uRes;
uniform float uDpr;
varying vec4 vCol;
varying float vRound;
void main() {
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, aDepth * 2.0 - 1.0, 1.0);
  float px = aSize * uDpr;
  gl_PointSize = max(1.0, px);
  // Dots smaller than a pixel get dimmer instead of disappearing.
  vCol = vec4(aCol.rgb, aCol.a * min(1.0, px * px));
  // Big dots (soft orbs, out-of-focus lights) are drawn as soft round discs; small ones stay crisp squares.
  vRound = clamp((px - 8.0) / 8.0, 0.0, 1.0);
}`;
const POINT_FRAG = `
precision mediump float;
varying vec4 vCol;
varying float vRound;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vCol.a * mix(1.0, 1.0 - smoothstep(0.45, 1.0, r), vRound);
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;
const QUAD_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FADE_FRAG = `
precision mediump float;
uniform float uAlpha;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uAlpha); }`;
// Final pass: scene + glow + backlight, then the arcade-screen look (slight color split toward
// the edges, faint scanlines, darker corners).
const SCREEN_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uGain;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uAuraPos[2];
uniform vec2 uAuraR[2];
uniform vec3 uAuraCol[2];
uniform float uAuraA[2];
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  vec2 off = d * length(d) * 0.012;
  vec3 c;
  c.r = texture2D(uTex, vUv + off).r;
  c.g = texture2D(uTex, vUv).g;
  c.b = texture2D(uTex, vUv - off).b;
  c += texture2D(uBloom, vUv).rgb * uGain;
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  for (int i = 0; i < 2; i++) {
    vec2 q = (px - uAuraPos[i]) / max(uAuraR[i], vec2(1.0));
    c += uAuraCol[i] * exp(-dot(q, q) * 2.2) * uAuraA[i];
  }
  c *= 0.93 + 0.07 * sin(gl_FragCoord.y * 1.6);
  c *= mix(0.6, 1.0, clamp(1.0 - dot(d, d) * 1.1, 0.0, 1.0));
  c *= 0.992 + 0.008 * sin(uTime * 47.0);
  gl_FragColor = vec4(c, 1.0);
}`;
// Keeps only the bright parts, so dim grid dots don't glow.
const BRIGHT_FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(0.3, 0.85, l), 1.0);
}`;
const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
  c += (texture2D(uTex, vUv + uStep).rgb + texture2D(uTex, vUv - uStep).rgb) * 0.1945946;
  c += (texture2D(uTex, vUv + uStep * 2.0).rgb + texture2D(uTex, vUv - uStep * 2.0).rgb) * 0.1216216;
  c += (texture2D(uTex, vUv + uStep * 3.0).rgb + texture2D(uTex, vUv - uStep * 3.0).rgb) * 0.054054;
  c += (texture2D(uTex, vUv + uStep * 4.0).rgb + texture2D(uTex, vUv - uStep * 4.0).rgb) * 0.016216;
  gl_FragColor = vec4(c, 1.0);
}`;

const STRIDE = 8; // x, y, size, depth, r, g, b, a

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
  depth?: WebGLRenderbuffer;
}

class GLRenderer implements Renderer {
  private gl: WebGLRenderingContext;
  private points: WebGLProgram;
  private fadeP: WebGLProgram;
  private screenP: WebGLProgram;
  private brightP: WebGLProgram;
  private blurP: WebGLProgram;
  private buf: WebGLBuffer;
  private quad: WebGLBuffer;
  private data = new Float32Array(0);
  private w = 1;
  private h = 1;
  private dpr = 1;
  // The scene (kept between frames for trails) and two small textures for the glow.
  private scene: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.points = link(gl, POINT_VERT, POINT_FRAG);
    this.fadeP = link(gl, QUAD_VERT, FADE_FRAG);
    this.screenP = link(gl, QUAD_VERT, SCREEN_FRAG);
    this.brightP = link(gl, QUAD_VERT, BRIGHT_FRAG);
    this.blurP = link(gl, QUAD_VERT, BLUR_FRAG);
    this.buf = gl.createBuffer()!;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const gl = this.gl;
    for (const t of [this.scene, this.bloomA, this.bloomB]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
    }
    const fw = gl.drawingBufferWidth, fh = gl.drawingBufferHeight;
    this.scene = this.target(fw, fh, true);
    const bw = Math.max(1, Math.round(fw / 4)), bh = Math.max(1, Math.round(fh / 4));
    this.bloomA = this.target(bw, bh);
    this.bloomB = this.target(bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  fade(amount: number) {
    const gl = this.gl;
    this.bind(this.scene);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.fadeP);
    gl.uniform1f(gl.getUniformLocation(this.fadeP, 'uAlpha'), amount);
    this.drawQuad(this.fadeP);
  }

  draw(f: Frame) {
    const gl = this.gl;
    let glowCount = 0, solidCount = 0;
    for (let i = 0; i < f.n; i++) {
      if (f.a[i] <= 0.004) continue;
      if (f.solid[i]) solidCount++;
      if (f.glowAlpha > 0 && f.glow[i] > 0) glowCount++;
    }
    const total = f.n + glowCount;
    if (this.data.length < total * STRIDE) this.data = new Float32Array(Math.ceil(total * 1.2) * STRIDE);
    const d = this.data;
    let o = 0;
    const put = (i: number, size: number, a: number) => {
      d[o] = f.x[i]; d[o + 1] = f.y[i]; d[o + 2] = size; d[o + 3] = f.z[i];
      d[o + 4] = f.r[i] / 255; d[o + 5] = f.g[i] / 255; d[o + 6] = f.b[i] / 255; d[o + 7] = a;
      o += STRIDE;
    };
    // Solid dots first (they fill in the depth), then the glowing ones, which hide behind them.
    if (solidCount) for (let i = 0; i < f.n; i++) if (f.solid[i] && f.a[i] > 0.004) put(i, f.s[i], f.a[i]);
    const solidEnd = o / STRIDE;
    if (glowCount) for (let i = 0; i < f.n; i++) if (f.glow[i] > 0 && f.a[i] > 0.004) put(i, f.s[i] * f.glow[i], f.a[i] * 0.06 * f.glowAlpha);
    for (let i = 0; i < f.n; i++) if (!f.solid[i] && f.a[i] > 0.004) put(i, f.s[i], f.a[i]);

    this.bind(this.scene);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.points);
    gl.uniform2f(gl.getUniformLocation(this.points, 'uRes'), this.w, this.h);
    gl.uniform1f(gl.getUniformLocation(this.points, 'uDpr'), this.dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, o), gl.DYNAMIC_DRAW);
    const F = 4;
    const aPos = gl.getAttribLocation(this.points, 'aPos');
    const aSize = gl.getAttribLocation(this.points, 'aSize');
    const aDepth = gl.getAttribLocation(this.points, 'aDepth');
    const aCol = gl.getAttribLocation(this.points, 'aCol');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aSize);
    gl.enableVertexAttribArray(aDepth);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE * F, 0);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, STRIDE * F, 2 * F);
    gl.vertexAttribPointer(aDepth, 1, gl.FLOAT, false, STRIDE * F, 3 * F);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, STRIDE * F, 4 * F);
    if (solidEnd > 0) {
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.POINTS, 0, solidEnd);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, solidEnd, o / STRIDE - solidEnd);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aSize);
    gl.disableVertexAttribArray(aDepth);
    gl.disableVertexAttribArray(aCol);
  }

  present(time: number, auras: (Aura | null)[]) {
    const gl = this.gl;
    const A = this.bloomA!, B = this.bloomB!;
    gl.disable(gl.BLEND);
    // 1. Bright parts, shrunk to a quarter size.
    this.bind(A);
    gl.useProgram(this.brightP);
    this.useTex(this.brightP, this.scene!.tex);
    this.drawQuad(this.brightP);
    // 2. Blur sideways, then up and down.
    for (const [from, to, sx, sy] of [[A, B, 1.6 / A.w, 0], [B, A, 0, 1.6 / A.h]] as [Target, Target, number, number][]) {
      this.bind(to);
      gl.useProgram(this.blurP);
      this.useTex(this.blurP, from.tex);
      gl.uniform2f(gl.getUniformLocation(this.blurP, 'uStep'), sx, sy);
      this.drawQuad(this.blurP);
    }
    // 3. Everything together on screen.
    this.bind(null);
    const p = this.screenP;
    gl.useProgram(p);
    this.useTex(p, this.scene!.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uBloom'), 1);
    gl.uniform1f(gl.getUniformLocation(p, 'uGain'), BLOOM);
    gl.uniform2f(gl.getUniformLocation(p, 'uSize'), this.w, this.h);
    gl.uniform1f(gl.getUniformLocation(p, 'uTime'), time);
    const pos: number[] = [], rad: number[] = [], col: number[] = [], al: number[] = [];
    for (let i = 0; i < 2; i++) {
      const a = auras[i] ?? null;
      pos.push(a?.x ?? 0, a?.y ?? 0);
      rad.push(a?.r ?? 1, a?.ry ?? a?.r ?? 1);
      col.push((a?.rgb[0] ?? 0) / 255, (a?.rgb[1] ?? 0) / 255, (a?.rgb[2] ?? 0) / 255);
      al.push(a?.a ?? 0);
    }
    gl.uniform2fv(gl.getUniformLocation(p, 'uAuraPos'), pos);
    gl.uniform2fv(gl.getUniformLocation(p, 'uAuraR'), rad);
    gl.uniform3fv(gl.getUniformLocation(p, 'uAuraCol'), col);
    gl.uniform1fv(gl.getUniformLocation(p, 'uAuraA'), al);
    this.drawQuad(p);
  }

  private target(w: number, h: number, withDepth = false): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (!withDepth) return { tex, fb, w, h };
    // A depth buffer, so solid dots can hide what's behind them.
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    return { tex, fb, w, h, depth };
  }

  private bind(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight);
  }

  private useTex(p: WebGLProgram, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
  }

  private drawQuad(p: WebGLProgram) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }
}

class Canvas2DRenderer implements Renderer {
  private w = 1;
  private h = 1;
  private dpr = 1;
  constructor(private ctx: CanvasRenderingContext2D) {}
  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }
  fade(amount: number) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(0,0,0,${amount})`;
    ctx.fillRect(0, 0, this.w, this.h);
  }
  draw(f: Frame) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    let last = -1;
    for (let i = 0; i < f.n; i++) {
      const a = f.a[i];
      if (a <= 0.004) continue;
      // Colors rounded to 32 levels so the fill color changes less often.
      const key = ((f.r[i] >> 3) << 10) | ((f.g[i] >> 3) << 5) | (f.b[i] >> 3);
      if (key !== last) {
        last = key;
        ctx.fillStyle = `rgb(${f.r[i] | 0},${f.g[i] | 0},${f.b[i] | 0})`;
      }
      const sz = f.s[i];
      ctx.globalAlpha = a;
      ctx.fillRect(f.x[i] - sz / 2, f.y[i] - sz / 2, sz, sz);
    }
  }
  present() {
    // No glow or screen effects without WebGL.
  }
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (gl) {
    try {
      return new GLRenderer(gl);
    } catch {
      // Fall through to 2D.
    }
  }
  return new Canvas2DRenderer(canvas.getContext('2d')!);
}

function link(gl: WebGLRenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}
