/* ==========================================================================
   GL core: context, programs, textures, geometry, render targets.
   Kept free of scene knowledge so the renderer and physics stay decoupled.
   ========================================================================== */
import { WATER_VS, WATER_FS, SKY_VS, SKY_FS, BALL_VS, BALL_FS, PART_VS, PART_FS } from './shaders.js';
import { clamp, lerp } from './util.js';

export function createContext(canvas) {
  const attrs = {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false
  };
  let gl = canvas.getContext('webgl2', attrs);
  if (!gl) gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  return gl;
}

/* ---------- programs ---------- */
function compileShader(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`[${label}] ${log}\n\n${numbered}`);
  }
  return s;
}

class Program {
  constructor(gl, vsSrc, fsSrc, label) {
    this.gl = gl;
    this.label = label;
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc, label + ':vs'));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, label + ':fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[${label}] link: ${gl.getProgramInfoLog(p)}`);
    }
    this.p = p;
    this.cache = new Map();
    this.unit = 0;
  }
  use() { this.gl.useProgram(this.p); return this; }
  loc(name) {
    let v = this.cache.get(name);
    if (v === undefined) { v = this.gl.getUniformLocation(this.p, name); this.cache.set(name, v); }
    return v;
  }
  u1f(n, v) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v); return this; }
  u1i(n, v) { const l = this.loc(n); if (l) this.gl.uniform1i(l, v); return this; }
  u2f(n, a, b) { const l = this.loc(n); if (l) this.gl.uniform2f(l, a, b); return this; }
  u3f(n, x, y, z) { const l = this.loc(n); if (l) this.gl.uniform3f(l, x, y, z); return this; }
  u3v(n, v) { const l = this.loc(n); if (l) this.gl.uniform3fv(l, v); return this; }
  u4v(n, v) { const l = this.loc(n); if (l) this.gl.uniform4fv(l, v); return this; }
  uf1v(n, v) { const l = this.loc(n); if (l) this.gl.uniform1fv(l, v); return this; }
  m4(n, v) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, v); return this; }
  m3(n, v) { const l = this.loc(n); if (l) this.gl.uniformMatrix3fv(l, false, v); return this; }
}

/* ---------- procedural detail texture ----------
   R = tangent-x normal, G = tangent-y normal, B = up, A = fractal value.
   Used for water capillary normals, foam breakup, cloud shapes, ball textures
   and the star field's band noise — one texture, many jobs.            */
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per;
  const y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function makeDetailTexture(gl) {
  const S = 256;
  const rid = new Float32Array(S * S), fb = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let a = 0, b = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < 5; o++) {
      const per = 4 << o, x = (i / S) * per, y = (j / S) * per;
      const n = vnoise(x, y, per, 11 + o * 7);
      a += amp * (1 - Math.abs(2 * n - 1));
      b += amp * vnoise(x, y, per, 101 + o * 13);
      tot += amp; amp *= 0.5;
    }
    rid[j * S + i] = a / tot; fb[j * S + i] = b / tot;
  }
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S);
  let ss = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const ip = (i + 1) % S, im = (i + S - 1) % S, jp = (j + 1) % S, jm = (j + S - 1) % S;
    const dx = rid[j * S + ip] - rid[j * S + im];
    const dy = rid[jp * S + i] - rid[jm * S + i];
    gx[j * S + i] = dx; gy[j * S + i] = dy; ss += dx * dx + dy * dy;
  }
  const sc = 0.35 / Math.sqrt(ss / (2 * S * S));
  let mean = 0;
  for (let i = 0; i < S * S; i++) mean += fb[i];
  mean /= S * S;
  let sd = 0;
  for (let i = 0; i < S * S; i++) sd += (fb[i] - mean) ** 2;
  sd = Math.sqrt(sd / (S * S));
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    let nx = -gx[i] * sc, ny = 1, nz = -gy[i] * sc;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    data[i * 4] = (nx * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = clamp((fb[i] - mean) / (3.2 * sd) + 0.5, 0, 1) * 255;
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  // anisotropy keeps the grazing-angle water detail from blurring out
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
  }
  return t;
}

/* ---------- geometry ---------- */
export function makeWaterGrid(gl, N) {
  const vao = gl.createVertexArray();
  const n1 = N + 1;
  const pos = new Float32Array(n1 * n1 * 2);
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    pos[(j * n1 + i) * 2] = -1 + (2 * i) / N;
    pos[(j * n1 + i) * 2 + 1] = -1 + (2 * j) / N;
  }
  const idx = new Uint32Array(N * N * 6);
  let k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length };
}

export function makeSphere(gl, LA = 40, LO = 64) {
  const v = [], idx = [];
  for (let a = 0; a <= LA; a++) {
    const th = (a / LA) * Math.PI;
    for (let o = 0; o <= LO; o++) {
      const ph = (o / LO) * Math.PI * 2;
      v.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  }
  for (let a = 0; a < LA; a++) for (let o = 0; o < LO; o++) {
    const i = a * (LO + 1) + o, j = i + LO + 1;
    idx.push(i, j, i + 1, i + 1, j, j + 1);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length };
}

export function makeParticleBuffers(gl, max) {
  const data = new Float32Array(max * 6);
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, buf, data };
}

/* ---------- render targets ---------- */
function colorTex(gl, w, h, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/**
 * Three targets:
 *  scene  — colour + depth of above-water geometry (for refraction)
 *  refl   — half-res mirrored geometry (planar reflection overlay)
 *  sceneHi— full-res copy used only when the refraction path is enabled
 */
export class Targets {
  constructor(gl) { this.gl = gl; this.scene = null; this.refl = null; this.w = 0; this.h = 0; }

  resize(w, h, { reflection = true, refraction = true } = {}) {
    const gl = this.gl;
    if (this.w === w && this.h === h && this.reflection === reflection && this.refraction === refraction) return;
    this.dispose();
    this.w = w; this.h = h; this.reflection = reflection; this.refraction = refraction;

    if (refraction) {
      const color = colorTex(gl, w, h, gl.NEAREST);
      const depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (ok) this.scene = { fb, color, depth };
    }
    if (reflection) {
      const rw = Math.max(2, w >> 1), rh = Math.max(2, h >> 1);
      const color = colorTex(gl, rw, rh, gl.LINEAR);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (ok) this.refl = { fb, color, depth, w: rw, h: rh };
    }
  }

  dispose() {
    const gl = this.gl;
    if (this.scene) {
      gl.deleteFramebuffer(this.scene.fb);
      gl.deleteTexture(this.scene.color);
      gl.deleteTexture(this.scene.depth);
      this.scene = null;
    }
    if (this.refl) {
      gl.deleteFramebuffer(this.refl.fb);
      gl.deleteTexture(this.refl.color);
      gl.deleteRenderbuffer(this.refl.depth);
      this.refl = null;
    }
  }
}

/* ---------- scene renderer ---------- */
export class Renderer {
  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.pWater = new Program(gl, WATER_VS, WATER_FS, 'water');
    this.pSky = new Program(gl, SKY_VS, SKY_FS, 'sky');
    this.pBall = new Program(gl, BALL_VS, BALL_FS, 'ball');
    this.pPart = new Program(gl, PART_VS, PART_FS, 'particle');
    this.texDetail = makeDetailTexture(gl);
    // 1x1 transparent black: stands in for disabled render targets so the
    // shader's mix()/alpha tests degrade to "nothing reflected" cleanly
    this.texBlank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texBlank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.water = makeWaterGrid(gl, 320);
    this.sphere = makeSphere(gl, 40, 64);
    this.empty = gl.createVertexArray();
    this.targets = new Targets(gl);
    this.rot = new Float32Array(9);
    this.ext = {
      hdr: !!gl.getExtension('EXT_color_buffer_float'),
      aniso: !!gl.getExtension('EXT_texture_filter_anisotropic')
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  makeParticleBuffers(max) { return makeParticleBuffers(this.gl, max); }

  /* upload the lighting block once per program; uniform locations are cached */
  applySky(p, sky, simT) {
    p.u1f('uTime', simT);
    p.u1f('uStorm', sky.storm);
    p.u1f('uAmbLum', sky.ambLum);
    p.u1f('uSunLum', sky.sunLum);
    p.u1f('uCloudLo', sky.cloudLo);
    p.u1f('uExp', sky.exposure);
    p.u1f('uNight', sky.night);
    p.u1f('uStars', sky.stars);
    p.u1f('uAurora', sky.aurora);
    p.u3v('uSun', sky.sun);
    p.u3v('uSunCol', sky.sunCol);
    p.u3v('uZenith', sky.zenith);
    p.u3v('uHorizon', sky.horizon);
    p.u3v('uGlow', sky.glow);
  }

  /* ---- individual passes ---- */
  drawSky(camera, sky, simT) {
    const gl = this.gl, p = this.pSky.use();
    this.applySky(p, sky, simT);
    p.u3v('uCamF', camera.f);
    p.u3v('uCamR', camera.r);
    p.u3v('uCamU', camera.u);
    p.u2f('uTanAsp', camera.tanH, camera.aspect);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  drawBalls(balls, camera, sky, simT, mode, mirror) {
    if (!balls.length) return;
    const gl = this.gl, p = this.pBall.use();
    this.applySky(p, sky, simT);
    p.m4('uVP', camera.vp);
    p.u1f('uMode', mode);
    p.u1f('uMirror', mirror);
    gl.bindVertexArray(this.sphere.vao);
    const m = this.rot;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const q = b.q, x = q[0], y = q[1], z = q[2], w = q[3];
      m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + w * z); m[2] = 2 * (x * z - w * y);
      m[3] = 2 * (x * y - w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z + w * x);
      m[6] = 2 * (x * z + w * y); m[7] = 2 * (y * z - w * x); m[8] = 1 - 2 * (x * x + y * y);
      p.u3f('uPos', b.x, b.y, b.z);
      p.u1f('uR', b.r);
      p.m3('uRot', m);
      p.u1f('uType', b.type);
      p.u1f('uPlane', b.wh);
      const e = camera.eye;
      p.u3f('uCamEff', e[0], mirror ? 2 * b.wh - e[1] : e[1], e[2]);
      gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  drawParticles(count, data, buf, vao, camera, sky, simT) {
    if (!count) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 6);
    const p = this.pPart.use();
    this.applySky(p, sky, simT);
    p.m4('uVP', camera.vp);
    p.u1f('uPx', camera.height / (2 * camera.tanH));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /* Bodies are handed to the water shader so it can press a bowl into the
     surface around them, raise a meniscus and trail a wake. The nearest
     ones win: beyond a dozen the effect is invisible anyway.            */
  packBalls(balls, camera, max = 16) {
    const A = this.ballA || (this.ballA = new Float32Array(max * 4));
    const B = this.ballB || (this.ballB = new Float32Array(max * 4));
    const sel = this._ballSel || (this._ballSel = []);
    sel.length = 0;
    for (let i = 0; i < balls.length; i++) sel.push(i);
    const tx = camera.target[0], tz = camera.target[2];
    sel.sort((p, q) => {
      const a = balls[p], b = balls[q];
      const da = (a.x - tx) * (a.x - tx) + (a.z - tz) * (a.z - tz);
      const db = (b.x - tx) * (b.x - tx) + (b.z - tz) * (b.z - tz);
      return da - db;
    });
    const n = Math.min(balls.length, max);
    for (let i = 0; i < n; i++) {
      const b = balls[sel[i]];
      const rvx = b.rvx === undefined ? b.vx : b.rvx;
      const rvz = b.rvz === undefined ? b.vz : b.rvz;
      A[i * 4] = b.x; A[i * 4 + 1] = b.z; A[i * 4 + 2] = b.r; A[i * 4 + 3] = b.sub || 0;
      B[i * 4] = rvx; B[i * 4 + 1] = rvz; B[i * 4 + 2] = Math.hypot(rvx, rvz); B[i * 4 + 3] = b.wake || 0;
    }
    return n;
  }

  drawWater(camera, sky, simT, waveUniforms, ripples, opts) {
    const gl = this.gl, p = this.pWater.use();
    this.applySky(p, sky, simT);
    p.m4('uVP', camera.vp);
    p.u3v('uCam', camera.eye);
    p.u3v('uCamR', camera.r);
    p.u3v('uCamF', camera.f);
    p.u4v('uW', waveUniforms.dirs);
    p.uf1v('uQ', waveUniforms.q);
    p.u1f('uRipR', ripples.radius);
    p.u1f('uRipN', ripples.size);
    p.u1f('uA0', waveUniforms.a0);
    p.u1f('uClarity', opts.clarity);
    p.u1f('uSparkle', opts.sparkle);
    p.u1f('uDetailAmt', opts.detail);
    p.u1f('uCaustic', opts.caustic);
    p.u1f('uFoamAmt', opts.foamAmt);
    p.u1f('uWake', opts.wake);
    p.u2f('uRes', camera.width, camera.height);
    p.u2f('uNF', camera.near, camera.far);
    const nb = this.packBalls(opts.balls || [], camera, 16);
    p.u4v('uBallA', this.ballA);
    p.u4v('uBallB', this.ballB);
    p.u1i('uBallCount', nb);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texDetail);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ripples.texture);
    const t = this.targets;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t.scene ? t.scene.color : this.texBlank);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, t.scene ? t.scene.depth : this.texBlank);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t.refl ? t.refl.color : this.texBlank);
    p.u1i('uDetail', 0); p.u1i('uRip', 1); p.u1i('uScene', 2); p.u1i('uSceneD', 3); p.u1i('uRefl', 4);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindVertexArray(this.water.vao);
    gl.drawElements(gl.TRIANGLES, this.water.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}
