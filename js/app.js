/* ── Waterbg · Application logic ──
   Sea, sky, ball physics, ripples, spray, render passes.
   UI lives here (glassmorphic, icon-driven, settings-rich). */

'use strict';

const $ = id => document.getElementById(id);

/* ============================================================
   Error reporting
   ============================================================ */
function showErr(m) {
  const e = $('err');
  e.style.display = 'flex';
  e.textContent += m + '\n';
}
window.addEventListener('error', ev => showErr(String(ev.message)));

/* ============================================================
   WebGL context
   ============================================================ */
const canvas = $('gl');
const gl = canvas.getContext('webgl2', {
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
if (!gl) {
  $('fail').style.display = 'flex';
  throw new Error('WebGL2 unsupported');
}

/* ============================================================
   Math helpers
   ============================================================ */
const G = 9.81, RHO_W = 1000, RHO_A = 1.2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const M4 = {
  persp(fovy, asp, n, f) {
    const o = new Float32Array(16), t = 1 / Math.tan(fovy / 2);
    o[0] = t / asp; o[5] = t;
    o[10] = (f + n) / (n - f); o[11] = -1;
    o[14] = 2 * f * n / (n - f);
    return o;
  },
  look(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz);
    zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz);
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]),
      -(yx * e[0] + yy * e[1] + yz * e[2]),
      -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
};

/* ============================================================
   Shader constants (defined inline in index.html before this file)
   ============================================================ */
// HDR, COMMON, WATER_VS, WATER_FS, SKY_VS, SKY_FS, BALL_VS, BALL_FS, PART_VS, PART_FS

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    showErr('Shader error: ' + gl.getShaderInfoLog(s));
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    showErr('Link error: ' + gl.getProgramInfoLog(p));
    throw new Error(gl.getProgramInfoLog(p));
  }
  p.u = {};
  return p;
}
function L(p, n) {
  let v = p.u[n];
  if (v === undefined) { v = gl.getUniformLocation(p, n); p.u[n] = v; }
  return v;
}

const pWater = program(WATER_VS, WATER_FS);
const pSky = program(SKY_VS, SKY_FS);
const pBall = program(BALL_VS, BALL_FS);
const pPart = program(PART_VS, PART_FS);

/* ============================================================
   Detail texture (ridged normals + fbm alpha)
   ============================================================ */
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
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
function makeDetailTexture() {
  const S = 256, rid = new Float32Array(S * S), fb = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      let a = 0, b = 0, amp = 0.5, tot = 0;
      for (let o = 0; o < 5; o++) {
        const per = 4 << o, x = i / S * per, y = j / S * per;
        const n = vnoise(x, y, per, 11 + o * 7);
        a += amp * (1 - Math.abs(2 * n - 1));
        b += amp * vnoise(x, y, per, 101 + o * 13);
        tot += amp; amp *= 0.5;
      }
      rid[j * S + i] = a / tot;
      fb[j * S + i] = b / tot;
    }
  }
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S); let ss = 0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const ip = (i + 1) % S, im = (i + S - 1) % S;
      const jp = (j + 1) % S, jm = (j + S - 1) % S;
      const dx = rid[j * S + ip] - rid[j * S + im];
      const dy = rid[jp * S + i] - rid[jm * S + i];
      gx[j * S + i] = dx; gy[j * S + i] = dy;
      ss += dx * dx + dy * dy;
    }
  }
  const sc = 0.35 / Math.sqrt(ss / (2 * S * S));
  let mean = 0;
  for (let i = 0; i < S * S; i++) mean += fb[i];
  mean /= S * S;
  let sd = 0;
  for (let i = 0; i < S * S; i++) sd += (fb[i] - mean) * (fb[i] - mean);
  sd = Math.sqrt(sd / (S * S));
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    let nx = -gx[i] * sc, ny = 1, nz = -gy[i] * sc;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    data[i * 4] = (nx * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = clamp((fb[i] - mean) / (3.2 * sd) + 0.5, 0, 1) * 255;
  }
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
}
const texDetail = makeDetailTexture();

/* ============================================================
   Geometry
   ============================================================ */
const GN = 288;
const waterVAO = gl.createVertexArray(); let waterIdxCount = 0;
(function () {
  const n1 = GN + 1;
  const pos = new Float32Array(n1 * n1 * 2);
  for (let j = 0; j < n1; j++)
    for (let i = 0; i < n1; i++) {
      pos[(j * n1 + i) * 2] = -1 + 2 * i / GN;
      pos[(j * n1 + i) * 2 + 1] = -1 + 2 * j / GN;
    }
  const idx = new Uint32Array(GN * GN * 6);
  let k = 0;
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  waterIdxCount = idx.length;
  gl.bindVertexArray(waterVAO);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
})();

const sphereVAO = gl.createVertexArray(); let sphereIdxCount = 0;
(function () {
  const LA = 36, LO = 56, v = [], idx = [];
  for (let a = 0; a <= LA; a++) {
    const th = a / LA * Math.PI;
    for (let o = 0; o <= LO; o++) {
      const ph = o / LO * Math.PI * 2;
      v.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  }
  for (let a = 0; a < LA; a++) {
    for (let o = 0; o < LO; o++) {
      const i = a * (LO + 1) + o, j = i + LO + 1;
      idx.push(i, j, i + 1, i + 1, j, j + 1);
    }
  }
  sphereIdxCount = idx.length;
  gl.bindVertexArray(sphereVAO);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
})();

const emptyVAO = gl.createVertexArray();

/* ============================================================
   Particles (spray)
   ============================================================ */
const MAXP = 3200;
const PX = new Float32Array(MAXP), PY = new Float32Array(MAXP), PZ = new Float32Array(MAXP);
const PVX = new Float32Array(MAXP), PVY = new Float32Array(MAXP), PVZ = new Float32Array(MAXP);
const PLife = new Float32Array(MAXP), PSize = new Float32Array(MAXP), PMax = new Float32Array(MAXP);
let pCount = 0;
const partData = new Float32Array(MAXP * 5);
const partVAO = gl.createVertexArray(), partBuf = gl.createBuffer();
gl.bindVertexArray(partVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
gl.bufferData(gl.ARRAY_BUFFER, partData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
gl.bindVertexArray(null);

/* ============================================================
   Ocean wave model (shared by GPU shader and CPU physics)
   ============================================================ */
const WIND_ANG = 1.1;
const WL = [26, 17, 11.5, 7.2, 4.6, 3.0, 2.0, 1.3];
const WOFF = [0, 0.35, -0.4, 0.8, -0.9, 1.3, -1.5, 2.0];
const wv = WL.map((Lw, i) => {
  const k = 2 * Math.PI / Lw, a = WIND_ANG + WOFF[i];
  return { L: Lw, k, om: Math.sqrt(G * k), dx: Math.sin(a), dz: Math.cos(a), ph: i * 2.399, A: 0, q: 0, qk: 0 };
});
const uWArr = new Float32Array(32), uQArr = new Float32Array(8);
let waveA0 = 0.3;
function updateWaves(s) {
  for (let i = 0; i < 8; i++) {
    const w = wv[i];
    w.A = w.L * 0.016 * (0.25 + 1.25 * s);
    w.q = 0.085 * (0.35 + 0.65 * s);
    w.qk = w.q / w.k;
    uWArr[i * 4] = w.dx; uWArr[i * 4 + 1] = w.dz;
    uWArr[i * 4 + 2] = w.k; uWArr[i * 4 + 3] = w.A;
    uQArr[i] = w.q;
  }
  waveA0 = wv[0].A;
}
function waveSample(x, z, t, full, out) {
  let px = x, pz = z;
  const its = full ? 3 : 2;
  for (let it = 0; it < its; it++) {
    let sx = 0, sz = 0;
    for (let i = 0; i < 8; i++) {
      const w = wv[i];
      const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.om * t + w.ph);
      sx += w.dx * w.qk * c;
      sz += w.dz * w.qk * c;
    }
    px = x - sx; pz = z - sz;
  }
  let h = 0, vx = 0, vy = 0, vz = 0, ax = 0, az = 0;
  for (let i = 0; i < 8; i++) {
    const w = wv[i];
    const th = w.k * (w.dx * px + w.dz * pz) - w.om * t + w.ph;
    const sn = Math.sin(th);
    h += w.A * sn;
    if (full) {
      const c = Math.cos(th);
      const vh = w.qk * w.om * sn;
      vx += w.dx * vh; vz += w.dz * vh;
      vy -= w.A * w.om * c;
      const ah = -w.qk * w.om * w.om * c;
      ax += w.dx * ah; az += w.dz * ah;
    }
  }
  out.h = h; out.vx = vx; out.vy = vy; out.vz = vz; out.ax = ax; out.az = az;
}
function approxH(x, z, t) {
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const w = wv[i];
    h += w.A * Math.sin(w.k * (w.dx * x + w.dz * z) - w.om * t + w.ph);
  }
  return h;
}

/* ============================================================
   Interactive ripple + foam simulation
   ============================================================ */
const RN = 192, RR = 14;
const rA = new Float32Array(RN * RN), rB = new Float32Array(RN * RN);
let cur = rA, prv = rB;
const foamArr = new Float32Array(RN * RN), ripData = new Float32Array(RN * RN * 2);
const dampArr = new Float32Array(RN * RN);
(function () {
  for (let y = 0; y < RN; y++) {
    for (let x = 0; x < RN; x++) {
      const d = Math.min(x, y, RN - 1 - x, RN - 1 - y);
      const e = d >= 14 ? 1 : 0.84 + 0.16 * (d / 14);
      dampArr[y * RN + x] = 0.9985 * e;
    }
  }
})();
const cellSz = 2 * RR / RN, RC2 = Math.pow(1.8 / 120 / cellSz, 2);
function rippleStep() {
  for (let y = 1; y < RN - 1; y++) {
    let i = y * RN + 1;
    for (let x = 1; x < RN - 1; x++, i++) {
      const c = cur[i];
      const lap = cur[i - 1] + cur[i + 1] + cur[i - RN] + cur[i + RN] - 4 * c;
      prv[i] = (2 * c - prv[i] + RC2 * lap) * dampArr[i];
      foamArr[i] *= 0.9972;
    }
  }
  const t = cur; cur = prv; prv = t;
}
function addRipple(wx, wz, rad, amt) {
  const gx = (wx / (2 * RR) + 0.5) * RN - 0.5;
  const gz = (wz / (2 * RR) + 0.5) * RN - 0.5;
  const rc = rad / cellSz;
  const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(RN - 2, Math.ceil(gx + rc));
  const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(RN - 2, Math.ceil(gz + rc));
  const r2 = rc * rc;
  for (let zi = z0; zi <= z1; zi++) {
    for (let xi = x0; xi <= x1; xi++) {
      const dx = xi - gx, dz = zi - gz, d2 = (dx * dx + dz * dz) / r2;
      if (d2 >= 1) continue;
      let w = 1 - d2; w *= w;
      const i = zi * RN + xi;
      let v = cur[i] + amt * w;
      cur[i] = v > 0.7 ? 0.7 : v < -0.7 ? -0.7 : v;
    }
  }
}
function addFoam(wx, wz, rad, amt) {
  const gx = (wx / (2 * RR) + 0.5) * RN - 0.5;
  const gz = (wz / (2 * RR) + 0.5) * RN - 0.5;
  const rc = rad / cellSz;
  const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(RN - 2, Math.ceil(gx + rc));
  const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(RN - 2, Math.ceil(gz + rc));
  const r2 = rc * rc;
  for (let zi = z0; zi <= z1; zi++) {
    for (let xi = x0; xi <= x1; xi++) {
      const dx = xi - gx, dz = zi - gz, d2 = (dx * dx + dz * dz) / r2;
      if (d2 >= 1) continue;
      const i = zi * RN + xi;
      const v = foamArr[i] + amt * (1 - d2);
      foamArr[i] = v > 1.2 ? 1.2 : v;
    }
  }
}
const texRip = gl.createTexture();
gl.activeTexture(gl.TEXTURE7);
gl.bindTexture(gl.TEXTURE_2D, texRip);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, RN, RN, 0, gl.RG, gl.FLOAT, ripData);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
function uploadRipple() {
  for (let i = 0; i < RN * RN; i++) {
    ripData[i * 2] = cur[i];
    ripData[i * 2 + 1] = foamArr[i];
  }
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, texRip);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RN, RN, gl.RG, gl.FLOAT, ripData);
}

/* ============================================================
   Render targets
   ============================================================ */
let scene = null, refl = null, rW = 0, rH = 0;
function makeTargets(w, h) {
  if (scene) {
    gl.deleteFramebuffer(scene.fb);
    gl.deleteTexture(scene.color);
    gl.deleteTexture(scene.depth);
  }
  if (refl) {
    gl.deleteFramebuffer(refl.fb);
    gl.deleteTexture(refl.color);
    gl.deleteRenderbuffer(refl.depth);
  }
  gl.activeTexture(gl.TEXTURE7);
  scene = { fb: gl.createFramebuffer(), color: gl.createTexture(), depth: gl.createTexture() };
  gl.bindTexture(gl.TEXTURE_2D, scene.color);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, scene.depth);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene.color, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, scene.depth, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) showErr('Scene FBO incomplete');
  rW = Math.max(2, w >> 1); rH = Math.max(2, h >> 1);
  refl = { fb: gl.createFramebuffer(), color: gl.createTexture(), depth: gl.createRenderbuffer() };
  gl.bindTexture(gl.TEXTURE_2D, refl.color);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rW, rH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindRenderbuffer(gl.RENDERBUFFER, refl.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rW, rH);
  gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, refl.color, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, refl.depth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) showErr('Reflection FBO incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ============================================================
   Sky / time of day
   ============================================================ */
let sea = 0.38, seaT = 0.38, sunV = 0.58;
const sky = {
  sun: [0, 1, 0], sunCol: [1, 1, 1], zenith: [0, 0, 0], horizon: [0, 0, 0],
  glow: [0, 0, 0], ambLum: 1, sunLum: 3, cloudLo: 0.6, storm: 0,
};
function updateSky() {
  const eps = 0.03 + sunV * 1.22;
  const day = sstep(0.02, 0.6, eps);
  const s = sea;
  const az = -0.5, ce = Math.cos(eps);
  sky.sun = [Math.sin(az) * ce, Math.sin(eps), -Math.cos(az) * ce];
  let z = lerp3([0.05, 0.08, 0.26], [0.09, 0.24, 0.62], day);
  let h = lerp3([0.85, 0.38, 0.2], [0.62, 0.77, 0.92], Math.pow(day, 0.7));
  const gz = [0.12, 0.14, 0.17], gh = [0.33, 0.36, 0.40];
  z = lerp3(z, gz.map(v => v * (0.4 + day)), s * 0.65);
  z = z.map(v => v * (1 - 0.3 * s));
  h = lerp3(h, gh.map(v => v * (0.5 + 0.5 * day)), s * 0.5);
  sky.zenith = z;
  sky.horizon = h;
  const gk = (1 - day * 0.8) * 0.9;
  sky.glow = [1.0 * gk, 0.5 * gk, 0.22 * gk].map(v => v * (1 - 0.6 * s));
  const inten = 2.9 * (0.4 + 0.6 * sstep(0, 0.3, eps)) * (1 - 0.72 * s);
  const c = lerp3([1, 0.42, 0.16], [1, 0.94, 0.84], sstep(0.05, 0.5, eps));
  sky.sunCol = c.map(v => v * inten);
  sky.sunLum = inten;
  sky.ambLum = (0.3 + 0.7 * day) * (1 - 0.35 * s);
  sky.cloudLo = 0.64 - 0.26 * s;
  sky.storm = s;
}
function setSky(p) {
  gl.uniform1f(L(p, 'uTime'), simT);
  gl.uniform1f(L(p, 'uStorm'), sky.storm);
  gl.uniform1f(L(p, 'uAmbLum'), sky.ambLum);
  gl.uniform1f(L(p, 'uSunLum'), sky.sunLum);
  gl.uniform1f(L(p, 'uCloudLo'), sky.cloudLo);
  gl.uniform1f(L(p, 'uExp'), 0.88);
  gl.uniform3fv(L(p, 'uSun'), sky.sun);
  gl.uniform3fv(L(p, 'uSunCol'), sky.sunCol);
  gl.uniform3fv(L(p, 'uZenith'), sky.zenith);
  gl.uniform3fv(L(p, 'uHorizon'), sky.horizon);
  gl.uniform3fv(L(p, 'uGlow'), sky.glow);
}

/* ============================================================
   Ball types & rigid-body physics
   ============================================================ */
const TYPES = [
  { name: 'Beach ball', sub: 'hollow · floats high', r: 0.62, rho: 0.012, e: 0.72, ic: 0.667 },
  { name: 'Basketball', sub: 'light · bouncy', r: 0.46, rho: 0.085, e: 0.80, ic: 0.667 },
  { name: 'Tennis ball', sub: 'floats · fuzzy', r: 0.30, rho: 0.37, e: 0.72, ic: 0.667 },
  { name: 'Wood', sub: 'half-submerged', r: 0.40, rho: 0.62, e: 0.45, ic: 0.4 },
  { name: 'Bowling', sub: 'sinks slowly', r: 0.32, rho: 1.35, e: 0.22, ic: 0.4 },
  { name: 'Steel', sub: 'sinks fast', r: 0.28, rho: 7.8, e: 0.30, ic: 0.4 },
];

let selType = 0, sizeMul = 1, timeScale = 1;
const balls = [];
const MAXBALLS = 40;

function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}
function spawnBall(x, y, z, ti, vx = 0, vy = 0, vz = 0) {
  const T = TYPES[ti];
  const r = T.r * sizeMul;
  const V = 4 / 3 * Math.PI * r * r * r;
  const m = T.rho * RHO_W * V;
  const q = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
  qNorm(q);
  const b = {
    x, y, z, vx, vy, vz,
    wx: (Math.random() - 0.5) * 5, wy: (Math.random() - 0.5) * 5, wz: (Math.random() - 0.5) * 5,
    q, r, V, m, im: 1 / m, I: T.ic * m * r * r,
    type: ti, e: T.e, pf: 0, wh: 0, grab: null, dead: false, frac: 0,
    rot: new Float32Array(9),
  };
  balls.push(b);
  while (balls.length > MAXBALLS) {
    const o = balls.shift();
    if (grab && grab.ball === o) grab = null;
  }
  return b;
}

function emit(x, y, z, vx, vy, vz, size, life) {
  if (pCount >= MAXP) return;
  const i = pCount++;
  PX[i] = x; PY[i] = y; PZ[i] = z;
  PVX[i] = vx; PVY[i] = vy; PVZ[i] = vz;
  PSize[i] = size; PLife[i] = life; PMax[i] = life;
}
function splash(b, speed) {
  const n = Math.min(190, Math.floor(12 + speed * 16 * b.r * 2));
  const rho = b.r * 0.85;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.2832;
    const out = (0.25 + Math.random()) * speed * 0.22;
    const up = (0.5 + Math.random() * 1.1) * speed * 0.4;
    emit(
      b.x + Math.cos(a) * rho, b.wh + 0.02, b.z + Math.sin(a) * rho,
      Math.cos(a) * out + b.vx * 0.2, up, Math.sin(a) * out + b.vz * 0.2,
      (0.03 + Math.random() * 0.07) * (0.5 + b.r), 0.9 + Math.random() * 0.9
    );
  }
  const nj = Math.floor(speed * 3);
  for (let i = 0; i < nj; i++) {
    const a = Math.random() * 6.28;
    emit(b.x, b.wh, b.z,
      Math.cos(a) * 0.4, speed * (0.35 + Math.random() * 0.35), Math.sin(a) * 0.4,
      0.035 + Math.random() * 0.04, 1.0 + Math.random() * 0.8);
  }
  addFoam(b.x, b.z, b.r * 1.7, Math.min(1.2, speed * 0.22));
}
function particlesStep(dt) {
  for (let i = pCount - 1; i >= 0; i--) {
    PLife[i] -= dt;
    PVY[i] -= G * dt;
    const dr = 1 - 0.5 * dt;
    PVX[i] *= dr; PVZ[i] *= dr;
    PX[i] += PVX[i] * dt;
    PY[i] += PVY[i] * dt;
    PZ[i] += PVZ[i] * dt;
    if (PLife[i] <= 0 || PY[i] < approxH(PX[i], PZ[i], simT)) {
      if (PLife[i] > 0 && Math.random() < 0.3) addRipple(PX[i], PZ[i], 0.13, -0.012);
      const l = --pCount;
      if (i !== l) {
        PX[i] = PX[l]; PY[i] = PY[l]; PZ[i] = PZ[l];
        PVX[i] = PVX[l]; PVY[i] = PVY[l]; PVZ[i] = PVZ[l];
        PLife[i] = PLife[l]; PSize[i] = PSize[l]; PMax[i] = PMax[l];
      }
    }
  }
}

const S0 = { h: 0, vx: 0, vy: 0, vz: 0, ax: 0, az: 0 };
const S1 = { h: 0, vx: 0, vy: 0, vz: 0, ax: 0, az: 0 };
let simT = 0, stepCount = 0, windX = 0, windZ = 0;
function capV(h, b) {
  let d = h - (b.y - b.r);
  if (d <= 0) return 0;
  if (d > 2 * b.r) d = 2 * b.r;
  return Math.PI * d * d * (3 * b.r - d) / 3;
}
let grab = null;
function stepBall(b, dt) {
  const r = b.r, t = simT, o = 0.65 * r;
  waveSample(b.x, b.z, t, true, S0);
  waveSample(b.x + o, b.z, t, false, S1); const h1 = S1.h;
  waveSample(b.x - o, b.z, t, false, S1); const h2 = S1.h;
  waveSample(b.x, b.z + o, t, false, S1); const h3 = S1.h;
  waveSample(b.x, b.z - o, t, false, S1); const h4 = S1.h;
  b.wh = S0.h;
  const Vs = (capV(S0.h, b) + capV(h1, b) + capV(h2, b) + capV(h3, b) + capV(h4, b)) / 5;
  const frac = Vs / b.V;
  b.frac = frac;
  const dAvg = clamp((S0.h + h1 + h2 + h3 + h4) / 5 - (b.y - r), 0, 2 * r);
  const meff = b.m + 0.5 * RHO_W * Vs;
  let ay = (-b.m * G + RHO_W * G * Vs) / meff;
  let ax = RHO_W * Vs * S0.ax / meff;
  let az = RHO_W * Vs * S0.az / meff;
  const dist = Math.hypot(b.x, b.z);
  if (dist > 10) {
    const k = (dist - 10) * 0.9;
    ax -= b.x / dist * k;
    az -= b.z / dist * k;
  }
  if (b.grab) {
    const g = b.grab;
    ax += 150 * (g.x - b.x) - 20 * b.vx;
    ay += 150 * (g.y - b.y) - 20 * b.vy;
    az += 150 * (g.z - b.z) - 20 * b.vz;
  }
  b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
  if (frac > 0.0005) {
    const ux = b.vx - S0.vx, uy = b.vy - S0.vy, uz = b.vz - S0.vz;
    const sp = Math.hypot(ux, uy, uz);
    const As = Math.PI * r * r * Math.sqrt(frac);
    const f = Math.min(0.85, 0.5 * RHO_W * 0.47 * As * sp * dt / meff);
    b.vx -= ux * f; b.vy -= uy * f; b.vz -= uz * f;
    const rcy = -r + dAvg * 0.5;
    const Jx = -b.m * ux * f, Jz = -b.m * uz * f;
    b.wx += 0.6 * (rcy * Jz) / b.I;
    b.wz += 0.6 * (-rcy * Jx) / b.I;
    const wm = Math.hypot(b.wx, b.wy, b.wz);
    const fr = Math.min(0.5, 0.5 * RHO_W * 0.12 * Math.pow(r, 5) * wm * frac * dt / b.I) + 0.5 * frac * dt;
    b.wx *= 1 - fr; b.wy *= 1 - fr; b.wz *= 1 - fr;
  }
  {
    const ux = b.vx - windX, uy = b.vy, uz = b.vz - windZ;
    const sp = Math.hypot(ux, uy, uz);
    const airF = 1 - Math.sqrt(frac);
    const A = Math.PI * r * r * airF;
    const f = Math.min(0.5, 0.5 * RHO_A * 0.47 * A * sp * dt / meff);
    b.vx -= ux * f; b.vy -= uy * f; b.vz -= uz * f;
    if (airF > 0.01) {
      const k = 0.5 * RHO_A * Math.PI * r * r * r * airF / b.m;
      let mx = k * (b.wy * uz - b.wz * uy);
      let my = k * (b.wz * ux - b.wx * uz);
      let mz = k * (b.wx * uy - b.wy * ux);
      const ml = Math.hypot(mx, my, mz);
      if (ml > 25) { const s = 25 / ml; mx *= s; my *= s; mz *= s; }
      b.vx += mx * dt; b.vy += my * dt; b.vz += mz * dt;
    }
  }
  if (b.grab) {
    const d = 1 - 3 * dt;
    b.wx *= d; b.wy *= d; b.wz *= d;
  }
  const vm = Math.hypot(b.vx, b.vy, b.vz);
  if (vm > 40) { const s = 40 / vm; b.vx *= s; b.vy *= s; b.vz *= s; }
  if (b.pf < 0.003 && frac >= 0.003 && b.vy < -1.0) splash(b, -b.vy);
  b.pf = frac;
  const dpen = S0.h - (b.y - r);
  if (dpen > 0 && dpen < 2 * r) {
    const dy = b.y - S0.h;
    const rho = Math.max(Math.sqrt(Math.max(r * r - dy * dy, 0)), 0.06);
    addRipple(b.x, b.z, rho * 1.25 + 0.12, b.vy * dt * 0.35);
    const ux = b.vx - S0.vx, uz = b.vz - S0.vz;
    const sp = Math.hypot(ux, uz);
    if (sp > 0.4) {
      const dx = ux / sp, dz = uz / sp;
      addRipple(b.x + dx * rho * 0.9, b.z + dz * rho * 0.9, rho * 0.8 + 0.1, sp * dt * 0.22);
      addRipple(b.x - dx * rho * 0.9, b.z - dz * rho * 0.9, rho * 0.8 + 0.1, -sp * dt * 0.22);
    }
    if (sp > 1.4 || Math.abs(b.vy) > 2) addFoam(b.x, b.z, rho * 1.4 + 0.1, Math.min(1, (sp + Math.abs(b.vy)) * 0.45) * dt * 10);
    if (sp > 3 && frac < 0.95 && Math.random() < sp * dt * 4) {
      const a = Math.random() * 6.28;
      emit(b.x + Math.cos(a) * rho, S0.h, b.z + Math.sin(a) * rho,
        b.vx * 0.4 + Math.cos(a) * 0.6, 0.8 + Math.random() * sp * 0.25, b.vz * 0.4 + Math.sin(a) * 0.6,
        0.025 + Math.random() * 0.03, 0.6 + Math.random() * 0.5);
    }
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const q = b.q, hx = 0.5 * dt;
  const dqx = b.wx * q[3] + b.wy * q[2] - b.wz * q[1];
  const dqy = -b.wx * q[2] + b.wy * q[3] + b.wz * q[0];
  const dqz = b.wx * q[1] - b.wy * q[0] + b.wz * q[3];
  const dqw = -b.wx * q[0] - b.wy * q[1] - b.wz * q[2];
  q[0] += dqx * hx; q[1] += dqy * hx; q[2] += dqz * hx; q[3] += dqw * hx;
  qNorm(q);
  if (!isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz) || dist > 28 || b.y < -24) b.dead = true;
}
function collide() {
  const n = balls.length;
  for (let i = 0; i < n; i++) {
    const a = balls[i];
    for (let j = i + 1; j < n; j++) {
      const b = balls[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const rs = a.r + b.r, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rs * rs || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
      const pen = rs - d, tot = a.im + b.im;
      a.x -= nx * pen * a.im / tot;
      a.y -= ny * pen * a.im / tot;
      a.z -= nz * pen * a.im / tot;
      b.x += nx * pen * b.im / tot;
      b.y += ny * pen * b.im / tot;
      b.z += nz * pen * b.im / tot;
      const ra = a.r, rb = b.r;
      const vax = a.vx + (a.wy * nz - a.wz * ny) * ra;
      const vay = a.vy + (a.wz * nx - a.wx * nz) * ra;
      const vaz = a.vz + (a.wx * ny - a.wy * nx) * ra;
      const vbx = b.vx - (b.wy * nz - b.wz * ny) * rb;
      const vby = b.vy - (b.wz * nx - b.wx * nz) * rb;
      const vbz = b.vz - (b.wx * ny - b.wy * nx) * rb;
      const rx = vbx - vax, ry = vby - vay, rz = vbz - vaz;
      const rn = rx * nx + ry * ny + rz * nz;
      if (rn < 0) {
        let e = Math.min(a.e, b.e);
        if (a.frac > 0.5 || b.frac > 0.5) e *= 0.35;
        const jn = -(1 + e) * rn / tot;
        a.vx -= jn * nx * a.im; a.vy -= jn * ny * a.im; a.vz -= jn * nz * a.im;
        b.vx += jn * nx * b.im; b.vy += jn * ny * b.im; b.vz += jn * nz * b.im;
        const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
        const tm = Math.hypot(tx, ty, tz);
        if (tm > 1e-5) {
          const dx2 = tx / tm, dy2 = ty / tm, dz2 = tz / tm;
          const den = tot + ra * ra / a.I + rb * rb / b.I;
          const jt = Math.min(0.3 * jn, tm / den);
          a.vx += jt * dx2 * a.im; a.vy += jt * dy2 * a.im; a.vz += jt * dz2 * a.im;
          b.vx -= jt * dx2 * b.im; b.vy -= jt * dy2 * b.im; b.vz -= jt * dz2 * b.im;
          const fx = jt * dx2, fy = jt * dy2, fz = jt * dz2;
          a.wx += (ny * ra * fz - nz * ra * fy) / a.I;
          a.wy += (nz * ra * fx - nx * ra * fz) / a.I;
          a.wz += (nx * ra * fy - ny * ra * fx) / a.I;
          b.wx += (ny * rb * fz - nz * rb * fy) / b.I;
          b.wy += (nz * rb * fx - nx * rb * fz) / b.I;
          b.wz += (nx * rb * fy - ny * rb * fx) / b.I;
        }
        if (jn * Math.min(a.im, b.im) > 0.8) {
          const hy = (a.wh + b.wh) * 0.5;
          if (Math.abs(a.y - hy) < a.r * 1.5) addFoam((a.x + b.x) / 2, (a.z + b.z) / 2, 0.5, 0.4);
        }
      }
    }
  }
}

const H = 1 / 240;
function physicsStep() {
  simT += H;
  stepCount++;
  for (let i = 0; i < balls.length; i++) stepBall(balls[i], H);
  for (let i = balls.length - 1; i >= 0; i--) {
    if (balls[i].dead) {
      if (grab && grab.ball === balls[i]) grab = null;
      balls.splice(i, 1);
    }
  }
  collide();
  if ((stepCount & 1) === 0) rippleStep();
}

/* ============================================================
   Camera & input
   ============================================================ */
const cam = { yaw: 0.0, pitch: 0.24, dist: 13, tYaw: 0.0, tPitch: 0.24, tDist: 13, target: [0, 0.3, 0] };
let eye = [0, 3, 13], camF = [0, 0, -1], camR = [1, 0, 0], camU = [0, 1, 0];
let VP = null, tanH = 0.466, aspect = 1;
function computeCamera() {
  const cp = Math.cos(cam.pitch);
  eye = [
    cam.target[0] + cam.dist * Math.sin(cam.yaw) * cp,
    cam.target[1] + cam.dist * Math.sin(cam.pitch),
    cam.target[2] + cam.dist * Math.cos(cam.yaw) * cp,
  ];
  waveSample(eye[0], eye[2], simT, false, S1);
  const minY = S1.h + 0.5;
  if (eye[1] < minY) eye[1] = minY;
  let fx = cam.target[0] - eye[0], fy = cam.target[1] - eye[1], fz = cam.target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  camF = [fx, fy, fz];
  camR = [-fz, 0, fx];
  const rl = Math.hypot(camR[0], camR[2]);
  camR[0] /= rl; camR[2] /= rl;
  camU = [
    camR[1] * fz - camR[2] * fy,
    camR[2] * fx - camR[0] * fz,
    camR[0] * fy - camR[1] * fx,
  ];
  aspect = canvas.width / canvas.height;
  tanH = 0.466 * Math.max(1, 1.15 / aspect);
  const proj = M4.persp(2 * Math.atan(tanH), aspect, 0.1, 3000);
  VP = M4.mul(proj, M4.look(eye, cam.target, [0, 1, 0]));
}
function rayFrom(px, py) {
  const nx = (px / innerWidth) * 2 - 1, ny = 1 - (py / innerHeight) * 2;
  const d = [
    camF[0] + nx * tanH * aspect * camR[0] + ny * tanH * camU[0],
    camF[1] + ny * tanH * camU[1],
    camF[2] + nx * tanH * aspect * camR[2] + ny * tanH * camU[2],
  ];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}
function pickBall(px, py) {
  const d = rayFrom(px, py);
  let best = null, bt = 1e9;
  for (const b of balls) {
    const ox = eye[0] - b.x, oy = eye[1] - b.y, oz = eye[2] - b.z;
    const R = b.r * 1.2 + 0.06;
    const bb = ox * d[0] + oy * d[1] + oz * d[2];
    const c = ox * ox + oy * oy + oz * oz - R * R;
    const disc = bb * bb - c;
    if (disc < 0) continue;
    let t = -bb - Math.sqrt(disc);
    if (t < 0) t = -bb + Math.sqrt(disc);
    if (t > 0 && t < bt) { bt = t; best = b; }
  }
  return best ? { ball: best, t: bt } : null;
}
function spawnAtPointer(px, py) {
  const d = rayFrom(px, py);
  let x, z;
  if (d[1] < -0.002) {
    const t = -(eye[1] - 0.0) / d[1];
    x = eye[0] + d[0] * t;
    z = eye[2] + d[2] * t;
  } else {
    x = eye[0] + d[0] * 10;
    z = eye[2] + d[2] * 10;
  }
  const rr = Math.hypot(x, z);
  if (rr > 10) { x *= 10 / rr; z *= 10 / rr; }
  spawnBall(x + (Math.random() - 0.5) * 0.2, 4.2 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.2, selType, 0, 0, 0);
}

const ptrs = new Map();
let pinch0 = 0, pinchDist0 = 13, downT = 0, tapStart = null, lastHintHide = false;

function hideHint() {
  if (lastHintHide) return;
  lastHintHide = true;
  const h = $('hint');
  if (h) h.style.opacity = 0;
}
function setGrabTarget(x, y) {
  if (!grab) return;
  const d = rayFrom(x, y);
  grab.ball.grab = {
    x: eye[0] + d[0] * grab.depth,
    y: eye[1] + d[1] * grab.depth,
    z: eye[2] + d[2] * grab.depth,
  };
}
function releaseGrab() {
  if (grab) {
    grab.ball.grab = null;
    const b = grab.ball;
    b.wx += (b.vz) * 0.4 / b.r * 0.3;
    b.wz -= (b.vx) * 0.4 / b.r * 0.3;
    grab = null;
  }
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
  hideHint();
  canvas.style.cursor = 'grabbing';
  if (ptrs.size === 1) {
    const hit = pickBall(e.clientX, e.clientY);
    if (hit) { grab = { ball: hit.ball, pid: e.pointerId, depth: hit.t }; setGrabTarget(e.clientX, e.clientY); }
  } else {
    releaseGrab();
    const [a, b] = [...ptrs.values()];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    pinchDist0 = cam.tDist;
  }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) p.moved = true;
  if (grab && grab.pid === e.pointerId) { setGrabTarget(e.clientX, e.clientY); return; }
  if (ptrs.size === 1 && p.moved) {
    cam.tYaw -= dx * 0.0055 * (uiState.sens / 100);
    cam.tPitch = clamp(cam.tPitch + dy * 0.0045 * (uiState.sens / 100), 0.02, 1.45);
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 10) cam.tDist = clamp(pinchDist0 * pinch0 / Math.max(d, 10), 3.5, 45);
  }
});
function endPtr(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const wasGrab = grab && grab.pid === e.pointerId;
  if (wasGrab) releaseGrab();
  else if (ptrs.size === 1 && !p.moved && performance.now() - p.t < 400 && e.type === 'pointerup') {
    spawnAtPointer(p.x, p.y);
  }
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch0 = 0;
  if (ptrs.size === 0) canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.tDist = clamp(cam.tDist * Math.exp(e.deltaY * 0.0012), 3.5, 45);
}, { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ============================================================
   UI state & settings
   ============================================================ */
const uiState = {
  sens: 100,
  showStats: true,
  autoSpawn: false,
  autoOrbit: false,
  reflection: true,
  refraction: true,
  particles: true,
  vignette: true,
  perfMode: 'auto',   // auto | low | high
  waveHeight: 0.38,
  wind: 1.0,
  foam: 1.0,
  waterDeep: '#06121c',
  waterShallow: '#1e3a5f',
  skyTime: 0.58,
  clouds: 0.6,
  sunIntensity: 1.0,
  gravity: 1.0,
  bounciness: 1.0,
  spawnRate: 1.0,
  maxBalls: 40,
  resolution: 1.5,
};

let seaT = 0.38, sunV = 0.58;

/* ── Icon SVGs ── */
const ICON = {
  sea: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a4.95 4.95 0 0 1 2-1.37 5 5 0 0 1 4.48 0 5 5 0 0 1 4.48 0A5 5 0 0 1 18 20a4.95 4.95 0 0 1 2-1.37 5 5 0 0 1 4.48 0 5 5 0 0 1 4.48 0A5 5 0 0 1 22 20h-2a4.95 4.95 0 0 0-2-1.37 5 5 0 0 0-4.48 0 5 5 0 0 0-4.48 0A5 5 0 0 0 8 20a4.95 4.95 0 0 0-2-1.37 5 5 0 0 0-4.48 0A5 5 0 0 0 2 20z"></path></svg>`,
  sky: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v20M20 12H4"></path></svg>`,
  ball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h20M12 2v20M16.24 7.76l1.41 1.41M7.76 16.24l1.41 1.41"></path></svg>`,
  graphics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><path d="M2 17l11 5M22 17l-11 5"></path></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="12" cy="12" r="3"></circle></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a5 5 0 0 0 5-5v-1a5 5 0 0 0-10 0v1a5 5 0 0 0 5 5z"></path></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V6M5 21v-4M19 21v-4M9 21v-2M15 21v-2"></path><path d="M5 21a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1zM19 21a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1z"></path></svg>`,
  slow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v14M17 6H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z"></path></svg>`,
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 12 21 12"></polyline><path d="M19 6v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m10 0L9 12"></path></svg>`,
  fullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 3h-3a2 2 0 0 0-2 2v3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0 0-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  hide: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  show: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"></path><path d="M12 1v4M12 19v4M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h4M19 12h4M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>`,
  power: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h3.69a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="17" x2="12.01" y2="17"></line><line x1="9" y1="21" x2="9.01" y2="21"></line><line x1="15" y1="21" x2="15.01" y2="21"></line></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"></path></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v20M20 12H4M12 18l-1.41 1.41M6.34 17.66l-1.41 1.41M18 6l-1.41 1.41M17.66 6.34l-1.41 1.41M12 6l1.41 1.41M6.34 6.34l1.41 1.41M18 18l-1.41 1.41M17.66 17.66l-1.41 1.41"></path></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.02 9.02a9 9 0 0 0-8.5-8.5C10.22 3.07 8 4.97 8 8c0 1.13.29 2.18.76 3.11l-.21 2.14a2 2 0 0 0 0 .25 2 2 0 0 0 1.15 1.95l2.14.21a9 9 0 0 0 8.5 8.5c4.76-2.25 6.65-7.37 5.61-12.87z"></path></svg>`,
  waves: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a4.95 4.95 0 0 1 2-1.37 5 5 0 0 1 4.48 0 5 5 0 0 1 4.48 0A5 5 0 0 1 18 20a4.95 4.95 0 0 1 2-1.37 5 5 0 0 1 4.48 0 5 5 0 0 1 4.48 0A5 5 0 0 1 22 20h-2a4.95 4.95 0 0 0-2-1.37 5 5 0 0 0-4.48 0 5 5 0 0 0-4.48 0A5 5 0 0 0 8 20a4.95 4.95 0 0 0-2-1.37 5 5 0 0 0-4.48 0A5 5 0 0 0 2 20z"></path></svg>`,
  droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a5 5 0 0 0 5-5v-1a5 5 0 0 0-10 0v1a5 5 0 0 0 5 5z"></path></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.41 1.41M20.12 6.12l-1.41 1.41M21 12h-3M20.12 17.88l-1.41 1.41M12 21l-1.41-1.41M3.88 6.12l1.41 1.41M3 12h3M3.88 17.88l1.41-1.41"></path></svg>`,
  gauge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.33 13.5A9 9 0 0 1 16.17 3h0M6.67 13.5A9 9 0 0 0 7.83 17h0M13.5 10.33A9 9 0 0 1 3 16.17v0M13.5 13.5A9 9 0 0 1 17 7.83h0M16.17 21a9 9 0 0 0 7.83-7.83h0M21 13.5A9 9 0 0 0 13.5 21v0M7.83 3A9 9 0 0 0 3 7.83h0M21 17a9 9 0 0 0-7.83-7.83v0"></path></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 5M20.49 15A9 9 0 0 1 5.64 18.36L23 19"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 12 21 12"></polyline><path d="M19 6v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m10 0L9 12"></path></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 3h-3a2 2 0 0 0-2 2v3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>`,
  contract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 3h-3a2 2 0 0 0-2 2v3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>`,
};

/* ============================================================
   UI construction
   ============================================================ */
let chipsContainer = null;
function setFill(el) {
  el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
}

/* ── Slider builder ── */
function makeSlider(id, label, min, max, step, value, fmt, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  wrap.innerHTML = `
    <span class="lab"><span>${label}</span><span class="val" id="v${id}">${fmt(value)}</span></span>
    <input id="s${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
  `;
  const inp = wrap.querySelector('input');
  const valEl = wrap.querySelector('.val');
  setFill(inp);
  inp.oninput = () => {
    setFill(inp);
    valEl.textContent = fmt(inp.valueAsNumber);
    onChange(inp.valueAsNumber);
  };
  return wrap;
}

/* ── Toggle builder ── */
function makeToggle(id, label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'toggle';
  wrap.innerHTML = `
    <span>${label}</span>
    <input type="checkbox" id="t${id}" ${checked ? 'checked' : ''}>
    <span class="track"></span>
  `;
  wrap.querySelector('input').onchange = () => onChange(wrap.querySelector('input').checked);
  return wrap;
}

/* ── Settings tabs ── */
const tabs = [
  { id: 'sea', icon: ICON.waves, label: 'Sea' },
  { id: 'sky', icon: ICON.sky, label: 'Sky' },
  { id: 'balls', icon: ICON.ball, label: 'Balls' },
  { id: 'graphics', icon: ICON.graphics, label: 'Graphics' },
  { id: 'camera', icon: ICON.camera, label: 'Camera' },
];

let activeTab = 'sea';

function buildTabContent(tabId) {
  const sec = document.createElement('div');
  sec.className = 'tab-panel' + (tabId === activeTab ? ' active' : '');
  sec.id = 'tab-' + tabId;

  if (tabId === 'sea') {
    sec.innerHTML = `
      <div class="section-head"><svg>${ICON.waves}</svg><h3>Ocean</h3></div>
      <div class="grid-2">
        ${makeSlider('waveHeight', 'Wave height', 0, 1, 0.01, uiState.waveHeight, v => (v * 100).toFixed(0) + '%', v => { uiState.waveHeight = v; seaT = v; }).outerHTML}
        ${makeSlider('wind', 'Wind', 0, 2, 0.05, uiState.wind, v => v.toFixed(1) + '×', v => { uiState.wind = v; }).outerHTML}
        ${makeSlider('foam', 'Foam', 0, 2, 0.05, uiState.foam, v => v.toFixed(1) + '×', v => { uiState.foam = v; }).outerHTML}
        ${makeSlider('storm', 'Storm', 0, 1, 0.01, uiState.sea / 1, v => (v * 100).toFixed(0) + '%', v => {}).outerHTML}
      </div>
      <div class="section-head" style="margin-top:14px"><svg>${ICON.droplet}</svg><h3>Water color</h3></div>
      <div class="grid-2">
        <div class="ctl">
          <span class="lab"><span>Deep</span></span>
          <input id="cDeep" type="color" value="${uiState.waterDeep}">
        </div>
        <div class="ctl">
          <span class="lab"><span>Shallow</span></span>
          <input id="cShallow" type="color" value="${uiState.waterShallow}">
        </div>
      </div>
    `;
  } else if (tabId === 'sky') {
    sec.innerHTML = `
      <div class="section-head"><svg>${ICON.sky}</svg><h3>Atmosphere</h3></div>
      <div class="grid-2">
        ${makeSlider('skyTime', 'Time of day', 0, 1, 0.01, uiState.skyTime, v => (v * 100).toFixed(0) + '%', v => { uiState.skyTime = v; sunV = v; }).outerHTML}
        ${makeSlider('clouds', 'Clouds', 0, 1, 0.01, uiState.clouds, v => (v * 100).toFixed(0) + '%', v => { uiState.clouds = v; }).outerHTML}
        ${makeSlider('sunIntensity', 'Sun intensity', 0, 3, 0.05, uiState.sunIntensity, v => v.toFixed(1) + '×', v => { uiState.sunIntensity = v; }).outerHTML}
        ${makeToggle('night', 'Night mode', false, c => {}).outerHTML}
      </div>
    `;
  } else if (tabId === 'balls') {
    sec.innerHTML = `
      <div class="section-head"><svg>${ICON.ball}</svg><h3>Spheres</h3></div>
      <div class="grid-3">
        ${makeSlider('ballSize', 'Size', 25, 300, 5, 100, v => (v / 100).toFixed(2) + '×', v => { sizeMul = v / 100; }).outerHTML}
        ${makeSlider('gravity', 'Gravity', 0, 3, 0.05, uiState.gravity, v => v.toFixed(1) + '×', v => { uiState.gravity = v; }).outerHTML}
        ${makeSlider('bounciness', 'Bounciness', 0, 2, 0.05, uiState.bounciness, v => v.toFixed(1) + '×', v => { uiState.bounciness = v; }).outerHTML}
        ${makeSlider('maxBalls', 'Max balls', 5, 80, 5, uiState.maxBalls, v => v, v => { uiState.maxBalls = v; while (balls.length > v) balls.pop(); }).outerHTML}
        ${makeSlider('spawnRate', 'Auto-spawn rate', 0, 5, 0.1, uiState.spawnRate, v => v.toFixed(1) + '/s', v => { uiState.spawnRate = v; }).outerHTML}
      </div>
      <div style="margin-top:8px">${makeToggle('autoSpawn', 'Auto-spawn balls', uiState.autoSpawn, c => { uiState.autoSpawn = c; }).outerHTML}</div>
    `;
  } else if (tabId === 'graphics') {
    sec.innerHTML = `
      <div class="section-head"><svg>${ICON.graphics}</svg><h3>Rendering</h3></div>
      <div class="grid-2">
        ${makeToggle('reflection', 'Reflections', uiState.reflection, c => { uiState.reflection = c; }).outerHTML}
        ${makeToggle('refraction', 'Refraction', uiState.refraction, c => { uiState.refraction = c; }).outerHTML}
        ${makeToggle('particles', 'Spray particles', uiState.particles, c => { uiState.particles = c; }).outerHTML}
        ${makeToggle('vignette', 'Vignette', uiState.vignette, c => { uiState.vignette = c; }).outerHTML}
        ${makeToggle('showStats', 'Show stats', uiState.showStats, c => { uiState.showStats = c; $('stats').style.display = c ? 'block' : 'none'; }).outerHTML}
        <div class="ctl">
          <span class="lab"><span>Resolution</span></span>
          <select id="sPerf" style="margin-top:24px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid var(--stroke);color:inherit;font:500 12px inherit">
            <option value="auto">Auto (adaptive)</option>
            <option value="low">Low (0.75×)</option>
            <option value="high">High (1.5×)</option>
          </select>
        </div>
      </div>
    `;
  } else if (tabId === 'camera') {
    sec.innerHTML = `
      <div class="section-head"><svg>${ICON.camera}</svg><h3>View</h3></div>
      <div class="grid-2">
        ${makeSlider('sens', 'Sensitivity', 20, 200, 5, uiState.sens, v => v + '%', v => { uiState.sens = v; }).outerHTML}
        ${makeToggle('autoOrbit', 'Auto-orbit', uiState.autoOrbit, c => { uiState.autoOrbit = c; }).outerHTML}
      </div>
    `;
  }

  return sec;
}

/* Build the dock UI */
function buildDock() {
  const dock = $('dock');
  dock.innerHTML = '';

  // Header with settings toggle
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,#7dd3fc,#3b82f6);display:grid;place-items:center">
        <svg width="16" height="16" fill="none" stroke="#02111c" stroke-width="2.4" stroke-linecap="round"><path d="M2 14c2.5-3 4.5-3 7 0s4.5 3 7 0 4.5-3 6 0"/><circle cx="12" cy="6" r="2.4" fill="#02111c" stroke="none"/></svg>
      </div>
      <div>
        <div style="font:700 13px/1 inherit;letter-spacing:0.3px">Waterbg</div>
        <div style="font:500 10px/1 inherit;opacity:0.6">Cozy ocean physics</div>
      </div>
    </div>
    <button class="btn ghost" id="bFullscreen" style="padding:6px 12px;min-height:auto;font-size:12px">${ICON.expand}<span style="display:none">Fullscreen</span></button>
  `;
  dock.appendChild(head);

  // Ball type chips
  chipsContainer = document.createElement('div');
  chipsContainer.className = 'chips';
  chipsContainer.id = 'chips';
  TYPES.forEach((T, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' on' : '');
    const hue = (i * 60) % 360;
    const grad = `linear-gradient(135deg, hsl(${hue},70%,60%), hsl(${(hue+40)%360},70%,50%))`;
    b.innerHTML = `<span class="sw" style="background:${grad}"></span><span>${T.name}<small>${T.sub}</small></span>`;
    b.onclick = () => {
      selType = i;
      [...chipsContainer.children].forEach((c, k) => c.classList.toggle('on', k === i));
    };
    chipsContainer.appendChild(b);
  });
  dock.appendChild(chipsContainer);

  // Tabs
  const tabsBar = document.createElement('div');
  tabsBar.className = 'panel-tabs';
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.className = 'tab' + (t.id === activeTab ? ' on' : '');
    b.innerHTML = t.icon + t.label;
    b.onclick = () => {
      activeTab = t.id;
      [...tabsBar.children].forEach((c, k) => c.classList.toggle('on', k === tabs.indexOf(t)));
      [...dock.querySelectorAll('.tab-panel')].forEach(p => p.style.display = 'none');
      const active = $('tab-' + t.id);
      if (active) active.style.display = 'block';
    };
    tabsBar.appendChild(b);
  });
  dock.appendChild(tabsBar);

  // Tab panels
  tabs.forEach(t => dock.appendChild(buildTabContent(t.id)));

  // Action row
  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.innerHTML = `
    <button class="btn primary" id="bDrop">${ICON.drop} Drop ball</button>
    <button class="btn" id="bRain">${ICON.rain} Ball rain</button>
    <button class="btn" id="bSlow">${ICON.slow} Slow-mo</button>
    <button class="btn" id="bClear">${ICON.trash} Clear</button>
    <button class="btn ghost wide" id="bFullscreenBig">${ICON.fullscreen} Fullscreen</button>
  `;
  dock.appendChild(acts);

  // Sliders row (sea state / sun quick controls)
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <label class="ctl">
      <span class="lab">Sea <b id="vSeaQuick">${seaName(seaT * 100)}</b></span>
      <input id="sSeaQuick" type="range" min="0" max="100" value="${Math.round(seaT * 100)}">
    </label>
    <label class="ctl">
      <span class="lab">Sun <b id="vSunQuick">${sunName(sunV * 100)}</b></span>
      <input id="sSunQuick" type="range" min="0" max="100" value="${Math.round(sunV * 100)}">
    </label>
  `;
  dock.appendChild(row);

  // Wire up quick controls
  const sSeaQuick = $('sSeaQuick');
  const sSunQuick = $('sSunQuick');
  const vSeaQuick = $('vSeaQuick');
  const vSunQuick = $('vSunQuick');
  sSeaQuick.oninput = () => {
    const v = sSeaQuick.value / 100;
    seaT = v;
    uiState.waveHeight = v;
    vSeaQuick.textContent = seaName(sSeaQuick.value);
    // Sync sea slider if on sea tab
    const sWh = $('sWaveHeight');
    if (sWh) { sWh.value = v; setFill(sWh); $('vWaveHeight').textContent = (v * 100).toFixed(0) + '%'; }
  };
  setFill(sSeaQuick);
  sSunQuick.oninput = () => {
    const v = sSunQuick.value / 100;
    sunV = v;
    uiState.skyTime = v;
    vSunQuick.textContent = sunName(sSunQuick.value);
    const sSt = $('sSkyTime');
    if (sSt) { sSt.value = v; setFill(sSt); $('vSkyTime').textContent = (v * 100).toFixed(0) + '%'; }
  };
  setFill(sSunQuick);

  // Wire up all sliders from built DOM (deferred)
  requestAnimationFrame(() => {
    wireSlider('WaveHeight', uiState.waveHeight, v => { uiState.waveHeight = v; seaT = v; }, v => (v * 100).toFixed(0) + '%', 0, 1, 0.01);
    wireSlider('Wind', uiState.wind, v => { uiState.wind = v; }, v => v.toFixed(1) + '×', 0, 2, 0.05);
    wireSlider('Foam', uiState.foam, v => { uiState.foam = v; }, v => v.toFixed(1) + '×', 0, 2, 0.05);
    wireSlider('SkyTime', uiState.skyTime, v => { uiState.skyTime = v; sunV = v; }, v => (v * 100).toFixed(0) + '%', 0, 1, 0.01);
    wireSlider('Clouds', uiState.clouds, v => { uiState.clouds = v; }, v => (v * 100).toFixed(0) + '%', 0, 1, 0.01);
    wireSlider('SunIntensity', uiState.sunIntensity, v => { uiState.sunIntensity = v; }, v => v.toFixed(1) + '×', 0, 3, 0.05);
    wireSlider('BallSize', 100, v => { sizeMul = v / 100; }, v => (v / 100).toFixed(2) + '×', 25, 300, 5);
    wireSlider('Gravity', uiState.gravity, v => { uiState.gravity = v; }, v => v.toFixed(1) + '×', 0, 3, 0.05);
    wireSlider('Bounciness', uiState.bounciness, v => { uiState.bounciness = v; }, v => v.toFixed(1) + '×', 0, 2, 0.05);
    wireSlider('MaxBalls', uiState.maxBalls, v => { uiState.maxBalls = v; while (balls.length > v) balls.pop(); }, v => v, 5, 80, 5);
    wireSlider('SpawnRate', uiState.spawnRate, v => { uiState.spawnRate = v; }, v => v.toFixed(1) + '/s', 0, 5, 0.1);
    wireSlider('Sens', uiState.sens, v => { uiState.sens = v; }, v => v + '%', 20, 200, 5);

    // Color pickers
    const cDeep = $('cDeep');
    const cShallow = $('cShallow');
    if (cDeep) cDeep.oninput = () => { uiState.waterDeep = cDeep.value; };
    if (cShallow) cShallow.oninput = () => { uiState.waterShallow = cShallow.value; };

    // Resolution select
    const sPerf = $('sPerf');
    if (sPerf) {
      sPerf.value = uiState.perfMode;
      sPerf.onchange = () => { uiState.perfMode = sPerf.value; };
    }
  });
}

function wireSlider(id, initVal, onChange, fmt, min, max, step) {
  const s = $('s' + id);
  const v = $('v' + id);
  if (!s || !v) return;
  s.value = initVal;
  setFill(s);
  v.textContent = fmt(initVal);
  s.oninput = () => {
    setFill(s);
    v.textContent = fmt(s.valueAsNumber);
    onChange(s.valueAsNumber);
  };
}

/* ============================================================
   Fullscreen / UI-hide mode
   ============================================================ */
let fullscreenActive = false;

function enterFullscreen() {
  fullscreenActive = true;
  const shell = document.querySelector('.ui-shell');
  const dock = $('dock');
  const fab = $('fab');
  const hint = $('hint');
  const stats = $('stats');
  if (shell) shell.classList.add('hidden');
  if (dock) dock.classList.add('hidden');
  if (fab) fab.classList.remove('show');
  if (hint) hint.style.opacity = '0';
  if (stats) stats.style.opacity = '0';
  const fsHint = $('fsHint');
  if (fsHint) fsHint.classList.add('visible');
  // Auto-hide hint after 3s
  setTimeout(() => { if (fsHint) fsHint.classList.remove('visible'); }, 3000);
}

function exitFullscreen() {
  fullscreenActive = false;
  const shell = document.querySelector('.ui-shell');
  const dock = $('dock');
  const fab = $('fab');
  const fsHint = $('fsHint');
  if (shell) shell.classList.remove('hidden');
  if (dock) dock.classList.remove('hidden');
  if (fsHint) fsHint.classList.remove('visible');
}

// Click on canvas to exit fullscreen UI-hide
canvas.addEventListener('click', e => {
  // Only exit if UI is hidden and click wasn't on a UI element
  if (fullscreenActive && !e.target.closest('.ui-shell')) {
    exitFullscreen();
  }
});

// Fullscreen buttons
function setupFullscreenBtn(btnId) {
  const btn = $(btnId);
  if (!btn) return;
  btn.onclick = e => {
    e.stopPropagation();
    if (fullscreenActive) exitFullscreen();
    else enterFullscreen();
  };
}

/* ============================================================
   Rendering
   ============================================================ */
function drawBalls(mode, mirror) {
  if (balls.length === 0) return;
  gl.useProgram(pBall);
  setSky(pBall);
  gl.uniformMatrix4fv(L(pBall, 'uVP'), false, VP);
  gl.uniform1f(L(pBall, 'uMode'), mode);
  gl.uniform1f(L(pBall, 'uMirror'), mirror);
  gl.bindVertexArray(sphereVAO);
  for (const b of balls) {
    const q = b.q, x = q[0], y = q[1], z = q[2], w = q[3], m = b.rot;
    m[0] = 1 - 2 * (y * y + z * z);
    m[1] = 2 * (x * y + w * z);
    m[2] = 2 * (x * z - w * y);
    m[3] = 2 * (x * y - w * z);
    m[4] = 1 - 2 * (x * x + z * z);
    m[5] = 2 * (y * z + w * x);
    m[6] = 2 * (x * z + w * y);
    m[7] = 2 * (y * z - w * x);
    m[8] = 1 - 2 * (x * x + y * y);
    gl.uniform3f(L(pBall, 'uPos'), b.x, b.y, b.z);
    gl.uniform1f(L(pBall, 'uR'), b.r);
    gl.uniformMatrix3fv(L(pBall, 'uRot'), false, m);
    gl.uniform1f(L(pBall, 'uType'), b.type);
    gl.uniform1f(L(pBall, 'uPlane'), b.wh);
    gl.uniform3f(L(pBall, 'uCamEff'), eye[0], mirror ? 2 * b.wh - eye[1] : eye[1], eye[2]);
    gl.drawElements(gl.TRIANGLES, sphereIdxCount, gl.UNSIGNED_SHORT, 0);
  }
  gl.bindVertexArray(null);
}

function render() {
  const W = canvas.width, Hh = canvas.height;
  computeCamera();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texDetail);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);
  gl.depthMask(true);

  // Reflection pass (mirrored balls)
  if (uiState.reflection) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb);
    gl.viewport(0, 0, rW, rH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawBalls(1, 1);
  }

  // Scene pass (colour + depth for refraction)
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawBalls(1, 0);

  // Main pass
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);

  gl.useProgram(pSky);
  setSky(pSky);
  gl.uniform3fv(L(pSky, 'uCamF'), camF);
  gl.uniform3fv(L(pSky, 'uCamR'), camR);
  gl.uniform3fv(L(pSky, 'uCamU'), camU);
  gl.uniform2f(L(pSky, 'uTanAsp'), tanH, aspect);
  gl.bindVertexArray(emptyVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST);

  gl.useProgram(pWater);
  setSky(pWater);
  gl.uniformMatrix4fv(L(pWater, 'uVP'), false, VP);
  gl.uniform3fv(L(pWater, 'uCam'), eye);
  gl.uniform3fv(L(pWater, 'uCamR'), camR);
  gl.uniform3fv(L(pWater, 'uCamF'), camF);
  gl.uniform4fv(L(pWater, 'uW'), uWArr);
  gl.uniform1fv(L(pWater, 'uQ'), uQArr);
  gl.uniform1f(L(pWater, 'uRipR'), RR);
  gl.uniform1f(L(pWater, 'uRipN'), RN);
  gl.uniform1f(L(pWater, 'uA0'), waveA0);
  gl.uniform2f(L(pWater, 'uRes'), W, Hh);
  gl.uniform2f(L(pWater, 'uNF'), 0.1, 3000);
  gl.uniform1i(L(pWater, 'uRip'), 1);
  gl.uniform1i(L(pWater, 'uScene'), 2);
  gl.uniform1i(L(pWater, 'uSceneD'), 3);
  gl.uniform1i(L(pWater, 'uRefl'), 4);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texRip);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, scene.color);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, scene.depth);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, refl.color);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(waterVAO);
  gl.drawElements(gl.TRIANGLES, waterIdxCount, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);

  // Balls above the surface
  drawBalls(0, 0);

  // Spray
  if (uiState.particles && pCount > 0) {
    for (let i = 0; i < pCount; i++) {
      const o = i * 5;
      partData[o] = PX[i];
      partData[o + 1] = PY[i];
      partData[o + 2] = PZ[i];
      const lf = PLife[i] / PMax[i];
      partData[o + 3] = PSize[i] * (0.6 + 0.4 * lf);
      partData[o + 4] = Math.min(1, PLife[i] / 0.35) * 0.75;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, partData, 0, pCount * 5);
    gl.useProgram(pPart);
    setSky(pPart);
    gl.uniformMatrix4fv(L(pPart, 'uVP'), false, VP);
    gl.uniform1f(L(pPart, 'uPx'), Hh / (2 * tanH));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(partVAO);
    gl.drawArrays(gl.POINTS, 0, pCount);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

/* ============================================================
   Main loop with adaptive resolution
   ============================================================ */
const maxPR = Math.min(window.devicePixelRatio || 1, 2);
let pr = Math.min(maxPR, 1.5), prCeil = maxPR, curW = 0, curH = 0;
function resize() {
  let targetPR = pr;
  if (uiState.perfMode === 'low') targetPR = 0.75;
  else if (uiState.perfMode === 'high') targetPR = 1.5;
  // adaptive: clamp to prCeil which adjusts based on FPS
  targetPR = Math.min(targetPR, prCeil);
  const w = Math.max(2, Math.floor(innerWidth * targetPR));
  const h = Math.max(2, Math.floor(innerHeight * targetPR));
  if (w !== curW || h !== curH) {
    curW = w; curH = h;
    canvas.width = w;
    canvas.height = h;
    makeTargets(w, h);
  }
}

let lastT = performance.now(), acc = 0, ema = 16.7, frameN = 0, lastStat = 0, cool = 0, ceilTimer = 0, fpsShown = 60;
let autoSpawnTimer = 0, autoOrbitAngle = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rdtMs = now - lastT;
  lastT = now;
  if (!(rdtMs > 0)) return;
  const dt = Math.min(rdtMs / 1000, 0.05);
  ema = ema * 0.94 + Math.min(rdtMs, 100) * 0.06;
  frameN++; cool--; ceilTimer += dt;

  // Adaptive resolution
  if (cool <= 0 && frameN > 40 && uiState.perfMode === 'auto') {
    if (ema > 20.5 && pr > 0.65) {
      prCeil = Math.max(0.7, pr - 0.05);
      pr = Math.max(0.65, pr - 0.12);
      cool = 60;
      resize();
    } else if (ema < 17.6 && pr < prCeil - 0.001) {
      pr = Math.min(prCeil, pr + 0.06);
      cool = 120;
      resize();
    }
  }
  if (ceilTimer > 25) {
    ceilTimer = 0;
    prCeil = Math.min(maxPR, prCeil + 0.1);
  }
  resize();

  // Sea / sky
  sea += (seaT - sea) * Math.min(1, dt * 1.6);
  updateWaves(sea);
  updateSky();
  const ws = (2.5 + 11 * sea) * uiState.wind;
  windX = Math.sin(WIND_ANG) * ws;
  windZ = Math.cos(WIND_ANG) * ws;

  // Camera
  if (uiState.autoOrbit) {
    autoOrbitAngle += dt * 0.15;
    cam.tYaw = autoOrbitAngle;
    cam.tDist = 14 + Math.sin(autoOrbitAngle * 0.7) * 2;
  }
  cam.yaw += (cam.tYaw - cam.yaw) * Math.min(1, dt * 10);
  cam.pitch += (cam.tPitch - cam.pitch) * Math.min(1, dt * 10);
  cam.dist += (cam.tDist - cam.dist) * Math.min(1, dt * 8);

  // Physics
  const physDt = dt * timeScale * uiState.gravity;
  acc += physDt;
  let steps = 0;
  while (acc >= H && steps < 12) {
    physicsStep();
    acc -= H;
    steps++;
  }
  if (steps >= 12) acc = 0;
  particlesStep(dt * timeScale);
  uploadRipple();
  render();

  // Auto-spawn
  if (uiState.autoSpawn && uiState.spawnRate > 0) {
    autoSpawnTimer += dt;
    const interval = 1 / Math.max(0.1, uiState.spawnRate);
    if (autoSpawnTimer >= interval) {
      autoSpawnTimer = 0;
      const ang = Math.random() * Math.PI * 2;
      const rad = 4 + Math.random() * 6;
      spawnBall(Math.cos(ang) * rad, 6 + Math.random() * 4, Math.sin(ang) * rad, Math.floor(Math.random() * TYPES.length), 0, 0, 0);
    }
  }

  // Stats
  if (now - lastStat > 500) {
    lastStat = now;
    fpsShown = Math.round(1000 / ema);
    const el = $('stats');
    if (el) {
      el.innerHTML = Math.min(fpsShown, 120) + ' fps · ' + balls.length + ' balls<br>render ' + pr.toFixed(2) + '× · sea ' + Math.round(sea * 100) + '%';
      el.style.display = uiState.showStats ? 'block' : 'none';
    }
  }
}

resize();
requestAnimationFrame(t => { lastT = t; frame(t); });

/* ── Initial balls ── */
spawnBall(-2.2, 3.6, 1.0, 0, 0, 0, 0);
spawnBall(0.6, 5.2, -0.4, 1, 0, 0, 0);
spawnBall(2.6, 6.4, 0.8, 5, 0, 0, 0);

/* ============================================================
   UI event wiring
   ============================================================ */
function seaName(v) {
  return v < 12 ? 'Glassy' : v < 30 ? 'Calm' : v < 50 ? 'Moderate' : v < 72 ? 'Rough' : v < 90 ? 'Very rough' : 'Storm';
}
function sunName(v) {
  return v < 12 ? 'Sunset' : v < 30 ? 'Golden hour' : v < 62 ? 'Afternoon' : 'Midday';
}

// Button handlers
$('bDrop').onclick = () => { hideHint(); spawnBall((Math.random() - 0.5) * 3, 4.5, (Math.random() - 0.5) * 3, selType); };
$('bRain').onclick = () => { hideHint(); for (let i = 0; i < 10; i++) { setTimeout(() => { const t = selType; spawnBall((Math.random() - 0.5) * 11, 5 + Math.random() * 5, (Math.random() - 0.5) * 11, Math.floor(Math.random() * TYPES.length)); }, i * 110); } };
$('bClear').onclick = () => { balls.length = 0; grab = null; };
$('bSlow').onclick = e => {
  timeScale = timeScale === 1 ? 0.2 : 1;
  e.currentTarget.classList.toggle('on', timeScale !== 1);
};

// Fullscreen buttons
setupFullscreenBtn('bFullscreen');
setupFullscreenBtn('bFullscreenBig');

// FAB (mobile)
const fab = $('fab');
if (fab) {
  fab.onclick = () => {
    $('dock').classList.remove('hidden');
    fab.classList.remove('show');
  };
}

// Circular radial menu wiring
const menuInput = $('waterbgMenuInput');
const menuOptions = document.querySelectorAll('#waterbgMenu .option .option-input');
let currentSelType = selType;

function closeMenu() {
  if (menuInput) menuInput.checked = false;
}

menuOptions.forEach((inp, idx) => {
  inp.addEventListener('change', () => {
    closeMenu();
    switch (idx + 1) {
      case 1: // Drop ball
        hideHint();
        spawnBall((Math.random() - 0.5) * 3, 4.5, (Math.random() - 0.5) * 3, currentSelType);
        break;
      case 2: // Ball rain
        hideHint();
        for (let i = 0; i < 10; i++) {
          setTimeout(() => {
            const t = Math.floor(Math.random() * TYPES.length);
            spawnBall((Math.random() - 0.5) * 11, 5 + Math.random() * 5, (Math.random() - 0.5) * 11, t);
          }, i * 110);
        }
        break;
      case 3: // Ball type — cycle
        currentSelType = (currentSelType + 1) % TYPES.length;
        selType = currentSelType;
        if (chipsContainer) {
          [...chipsContainer.children].forEach((c, k) => c.classList.toggle('on', k === currentSelType));
        }
        break;
      case 4: // Sea state — cycle presets
        seaT = (seaT + 0.25) % 1.05;
        if (seaT > 1) seaT = 0;
        uiState.waveHeight = seaT;
        const sWh = $('sWaveHeight');
        if (sWh) { sWh.value = seaT; setFill(sWh); $('vWaveHeight').textContent = (seaT * 100).toFixed(0) + '%'; }
        const vSeaQuick = $('vSeaQuick');
        const sSeaQuick = $('sSeaQuick');
        if (vSeaQuick) vSeaQuick.textContent = seaName(Math.round(seaT * 100));
        if (sSeaQuick) { sSeaQuick.value = Math.round(seaT * 100); setFill(sSeaQuick); }
        break;
      case 5: // Sky time — cycle presets
        sunV = (sunV + 0.25) % 1.05;
        if (sunV > 1) sunV = 0;
        uiState.skyTime = sunV;
        const sSt = $('sSkyTime');
        if (sSt) { sSt.value = sunV; setFill(sSt); $('vSkyTime').textContent = (sunV * 100).toFixed(0) + '%'; }
        const vSunQuick = $('vSunQuick');
        const sSunQuick = $('sSunQuick');
        if (vSunQuick) vSunQuick.textContent = sunName(Math.round(sunV * 100));
        if (sSunQuick) { sSunQuick.value = Math.round(sunV * 100); setFill(sSunQuick); }
        break;
      case 6: // Graphics — toggle reflections
        uiState.reflection = !uiState.reflection;
        break;
      case 7: // Reset camera
        cam.tYaw = 0;
        cam.tPitch = 0.24;
        cam.tDist = 13;
        cam.target = [0, 0.3, 0];
        break;
      case 8: // Fullscreen toggle
        if (fullscreenActive) exitFullscreen();
        else enterFullscreen();
        break;
    }
  });
});

// Hint
setTimeout(hideHint, 14000);

// Fullscreen hint click-to-show
const fsHint = $('fsHint');
if (fsHint) {
  fsHint.addEventListener('click', e => {
    e.stopPropagation();
    exitFullscreen();
  });
}

// Resize listener
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
