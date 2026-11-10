/* ==========================================================================
   Physics: Gerstner wave model, rigid-body spheres, spray particles and the
   interactive ripple field. Everything here is renderer-agnostic.
   ========================================================================== */
import { clamp, M4 } from './util.js';

const G = 9.81, RHO_W = 1000, RHO_A = 1.2;

export const BODY_TYPES = [
  { name: 'Beach', sub: 'hollow · rides high', r: 0.62, rho: 0.012, e: 0.72, ic: 0.667,
    sw: 'conic-gradient(#d91420,#f5f5f0,#1040d9,#f9cc1a,#f5f5f0,#12a037,#d91420)' },
  { name: 'Rubber', sub: 'light · bouncy', r: 0.46, rho: 0.085, e: 0.80, ic: 0.667,
    sw: 'radial-gradient(circle at 35% 30%,#fbb066,#d9600f 55%,#6e2c04)' },
  { name: 'Tennis', sub: 'floats · fuzzy', r: 0.30, rho: 0.37, e: 0.72, ic: 0.667,
    sw: 'radial-gradient(circle at 35% 30%,#e8f56a,#b5d11c 55%,#5e7108)' },
  { name: 'Timber', sub: 'half-submerged', r: 0.40, rho: 0.62, e: 0.45, ic: 0.4,
    sw: 'radial-gradient(circle at 35% 30%,#d9a45f,#9a6428 55%,#4a2a0c)' },
  { name: 'Stone', sub: 'sinks slowly', r: 0.32, rho: 1.35, e: 0.22, ic: 0.4,
    sw: 'radial-gradient(circle at 35% 30%,#7c4bd0,#2a0f78 55%,#05031c)' },
  { name: 'Steel', sub: 'sinks fast', r: 0.28, rho: 7.8, e: 0.30, ic: 0.4,
    sw: 'linear-gradient(135deg,#f4f7fb,#8f9aab 40%,#e9eef6 55%,#4c5666)' }
];

const H_STEP = 1 / 240;

export class Physics {
  constructor() {
    /* --- wave model (shared by GPU and CPU) --- */
    this.windAngle = 1.1;
    this.WL = [26, 17, 11.5, 7.2, 4.6, 3.0, 2.0, 1.3];
    this.WOFF = [0, 0.35, -0.4, 0.8, -0.9, 1.3, -1.5, 2.0];
    this.waves = this.WL.map((L, i) => {
      const k = (2 * Math.PI) / L;
      const a = this.windAngle + this.WOFF[i];
      return { L, k, om: Math.sqrt(G * k), dx: Math.sin(a), dz: Math.cos(a), ph: i * 2.399, A: 0, q: 0, qk: 0 };
    });
    this.waveDirs = new Float32Array(32);
    this.waveQ = new Float32Array(8);
    this.a0 = 0.3;
    this.chop = 1;          // horizontal wave steepness multiplier
    this.windSpeed = 0;
    this.gravityScale = 1;  // 1 = earth
    this.restitution = 1;   // scales every body's bounce

    /* --- bodies --- */
    this.balls = [];
    this.maxBalls = 26;
    this.sizeMul = 1;
    this.grab = null;

    /* --- particles --- */
    this.MAXP = 2600;
    this.PX = new Float32Array(this.MAXP); this.PY = new Float32Array(this.MAXP);
    this.PZ = new Float32Array(this.MAXP); this.PVX = new Float32Array(this.MAXP);
    this.PVY = new Float32Array(this.MAXP); this.PVZ = new Float32Array(this.MAXP);
    this.PLife = new Float32Array(this.MAXP); this.PSize = new Float32Array(this.MAXP);
    this.PMax = new Float32Array(this.MAXP);
    this.pCount = 0;
    this.particleData = new Float32Array(this.MAXP * 5);

    /* --- ripple field --- */
    this.RN = 192;
    this.RR = 14;
    this.rA = new Float32Array(this.RN * this.RN);
    this.rB = new Float32Array(this.RN * this.RN);
    this.cur = this.rA; this.prv = this.rB;
    this.foam = new Float32Array(this.RN * this.RN);
    this.ripData = new Float32Array(this.RN * this.RN * 2);
    this.damp = new Float32Array(this.RN * this.RN);
    for (let y = 0; y < this.RN; y++) for (let x = 0; x < this.RN; x++) {
      const d = Math.min(x, y, this.RN - 1 - x, this.RN - 1 - y);
      const e = d >= 14 ? 1 : 0.84 + 0.16 * (d / 14);
      this.damp[y * this.RN + x] = 0.9985 * e;
    }
    this.cellSz = (2 * this.RR) / this.RN;
    this.RC2 = Math.pow(1.8 / 120 / this.cellSz, 2);

    /* --- state --- */
    this.time = 0;
    this.steps = 0;
    this.timeScale = 1;
    this._s0 = { h: 0, vx: 0, vy: 0, vz: 0, ax: 0, az: 0 };
    this._s1 = { h: 0, vx: 0, vy: 0, vz: 0, ax: 0, az: 0 };
  }

  /* ---------------- waves ---------------- */
  setSea(state) {
    // state 0..1 — amplitude and steepness scale together, as on real water
    for (let i = 0; i < 8; i++) {
      const w = this.waves[i];
      const a = this.windAngle + this.WOFF[i];
      w.dx = Math.sin(a); w.dz = Math.cos(a);
      w.A = w.L * 0.0155 * (0.22 + 1.32 * state);
      w.q = 0.082 * (0.32 + 0.68 * state) * this.chop;
      w.qk = w.q / w.k;
      this.waveDirs[i * 4] = w.dx;
      this.waveDirs[i * 4 + 1] = w.dz;
      this.waveDirs[i * 4 + 2] = w.k;
      this.waveDirs[i * 4 + 3] = w.A;
      this.waveQ[i] = w.q;
    }
    this.a0 = this.waves[0].A;
    const ws = 2.5 + 11 * state;
    this.windSpeed = ws;
    this.windX = Math.sin(this.windAngle) * ws;
    this.windZ = Math.cos(this.windAngle) * ws;
  }

  waveSample(x, z, t, full, out) {
    let px = x, pz = z;
    const its = full ? 3 : 2;
    for (let it = 0; it < its; it++) {
      let sx = 0, sz = 0;
      for (let i = 0; i < 8; i++) {
        const w = this.waves[i];
        const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.om * t + w.ph);
        sx += w.dx * w.qk * c; sz += w.dz * w.qk * c;
      }
      px = x - sx; pz = z - sz;
    }
    let h = 0, vx = 0, vy = 0, vz = 0, ax = 0, az = 0;
    for (let i = 0; i < 8; i++) {
      const w = this.waves[i];
      const th = w.k * (w.dx * px + w.dz * pz) - w.om * t + w.ph;
      const sn = Math.sin(th);
      h += w.A * sn;
      if (full) {
        const c = Math.cos(th);
        const vh = w.qk * w.om * sn;
        vx += w.dx * vh; vz += w.dz * vh; vy -= w.A * w.om * c;
        const ah = -w.qk * w.om * w.om * c;
        ax += w.dx * ah; az += w.dz * ah;
      }
    }
    out.h = h; out.vx = vx; out.vy = vy; out.vz = vz; out.ax = ax; out.az = az;
  }

  approxH(x, z, t) {
    let h = 0;
    for (let i = 0; i < 3; i++) {
      const w = this.waves[i];
      h += w.A * Math.sin(w.k * (w.dx * x + w.dz * z) - w.om * t + w.ph);
    }
    return h;
  }

  /* ---------------- ripples ---------------- */
  rippleStep() {
    const { RN, cur, prv, damp, foam } = this;
    const C = this.RC2;
    for (let y = 1; y < RN - 1; y++) {
      let i = y * RN + 1;
      for (let x = 1; x < RN - 1; x++, i++) {
        const c = cur[i];
        const lap = cur[i - 1] + cur[i + 1] + cur[i - RN] + cur[i + RN] - 4 * c;
        prv[i] = (2 * c - prv[i] + C * lap) * damp[i];
        foam[i] *= 0.9972;
      }
    }
    this.cur = prv; this.prv = cur;
  }

  addRipple(wx, wz, rad, amt) {
    const RN = this.RN;
    const gx = (wx / (2 * this.RR) + 0.5) * RN - 0.5;
    const gz = (wz / (2 * this.RR) + 0.5) * RN - 0.5;
    const rc = rad / this.cellSz;
    const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(RN - 2, Math.ceil(gx + rc));
    const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(RN - 2, Math.ceil(gz + rc));
    if (x1 < x0 || z1 < z0) return;
    const r2 = rc * rc;
    for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) {
      const dx = xi - gx, dz = zi - gz, d2 = (dx * dx + dz * dz) / r2;
      if (d2 >= 1) continue;
      let w = 1 - d2; w *= w;
      const i = zi * RN + xi;
      const v = this.cur[i] + amt * w;
      this.cur[i] = v > 0.7 ? 0.7 : v < -0.7 ? -0.7 : v;
    }
  }

  addFoam(wx, wz, rad, amt) {
    const RN = this.RN;
    const gx = (wx / (2 * this.RR) + 0.5) * RN - 0.5;
    const gz = (wz / (2 * this.RR) + 0.5) * RN - 0.5;
    const rc = rad / this.cellSz;
    const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(RN - 2, Math.ceil(gx + rc));
    const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(RN - 2, Math.ceil(gz + rc));
    if (x1 < x0 || z1 < z0) return;
    const r2 = rc * rc;
    for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) {
      const dx = xi - gx, dz = zi - gz, d2 = (dx * dx + dz * dz) / r2;
      if (d2 >= 1) continue;
      const i = zi * RN + xi;
      const v = this.foam[i] + amt * (1 - d2);
      this.foam[i] = v > 1.2 ? 1.2 : v;
    }
  }

  /** Copy the ripple + foam fields into the interleaved upload buffer. */
  packRipples() {
    const n = this.RN * this.RN, d = this.ripData, c = this.cur, f = this.foam;
    for (let i = 0; i < n; i++) { d[i * 2] = c[i]; d[i * 2 + 1] = f[i]; }
    return d;
  }

  /* ---------------- bodies ---------------- */
  spawn(x, y, z, type, vx = 0, vy = 0, vz = 0) {
    const T = BODY_TYPES[type];
    const r = T.r * this.sizeMul;
    const V = (4 / 3) * Math.PI * r * r * r;
    const m = T.rho * RHO_W * V;
    const q = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    qNorm(q);
    const b = {
      x, y, z, vx, vy, vz,
      wx: (Math.random() - 0.5) * 5, wy: (Math.random() - 0.5) * 5, wz: (Math.random() - 0.5) * 5,
      q, r, V, m, im: 1 / m, I: T.ic * m * r * r,
      type, e: T.e, pf: 0, wh: this.approxH(x, z, this.time), grab: null, dead: false, frac: 0
    };
    this.balls.push(b);
    while (this.balls.length > this.maxBalls) {
      const o = this.balls.shift();
      if (this.grab && this.grab.ball === o) this.grab = null;
    }
    return b;
  }

  clear() { this.balls.length = 0; this.grab = null; }

  emit(x, y, z, vx, vy, vz, size, life) {
    if (this.pCount >= this.MAXP) return;
    const i = this.pCount++;
    this.PX[i] = x; this.PY[i] = y; this.PZ[i] = z;
    this.PVX[i] = vx; this.PVY[i] = vy; this.PVZ[i] = vz;
    this.PSize[i] = size; this.PLife[i] = life; this.PMax[i] = life;
  }

  splash(b, speed) {
    const n = Math.min(150, Math.floor(10 + speed * 14 * b.r * 2));
    const rho = b.r * 0.85;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832;
      const out = (0.25 + Math.random()) * speed * 0.22;
      const up = (0.5 + Math.random() * 1.1) * speed * 0.4;
      this.emit(
        b.x + Math.cos(a) * rho, b.wh + 0.02, b.z + Math.sin(a) * rho,
        Math.cos(a) * out + b.vx * 0.2, up, Math.sin(a) * out + b.vz * 0.2,
        (0.03 + Math.random() * 0.07) * (0.5 + b.r), 0.9 + Math.random() * 0.9
      );
    }
    const nj = Math.floor(speed * 3);
    for (let i = 0; i < nj; i++) {
      const a = Math.random() * 6.28;
      this.emit(b.x, b.wh, b.z, Math.cos(a) * 0.4, speed * (0.35 + Math.random() * 0.35), Math.sin(a) * 0.4,
        0.035 + Math.random() * 0.04, 1.0 + Math.random() * 0.8);
    }
    this.addFoam(b.x, b.z, b.r * 1.7, Math.min(1.2, speed * 0.22));
  }

  particlesStep(dt, maxP) {
    const PX = this.PX, PY = this.PY, PZ = this.PZ, PVX = this.PVX, PVY = this.PVY, PVZ = this.PVZ;
    const PLife = this.PLife, PSize = this.PSize, PMax = this.PMax;
    const dr = 1 - 0.5 * dt;
    for (let i = this.pCount - 1; i >= 0; i--) {
      PLife[i] -= dt;
      PVY[i] -= G * this.gravityScale * dt; PVX[i] *= dr; PVZ[i] *= dr;
      PX[i] += PVX[i] * dt; PY[i] += PVY[i] * dt; PZ[i] += PVZ[i] * dt;
      if (PLife[i] <= 0 || PY[i] < this.approxH(PX[i], PZ[i], this.time)) {
        if (PLife[i] > 0 && Math.random() < 0.3) this.addRipple(PX[i], PZ[i], 0.13, -0.012);
        const l = --this.pCount;
        if (i !== l) {
          PX[i] = PX[l]; PY[i] = PY[l]; PZ[i] = PZ[l];
          PVX[i] = PVX[l]; PVY[i] = PVY[l]; PVZ[i] = PVZ[l];
          PLife[i] = PLife[l]; PSize[i] = PSize[l]; PMax[i] = PMax[l];
        }
      }
    }
    if (this.pCount > maxP) this.pCount = maxP;
  }

  /** Pack live particles into the interleaved vertex buffer. */
  packParticles() {
    const d = this.particleData;
    const n = this.pCount;
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const lf = this.PLife[i] / this.PMax[i];
      d[o] = this.PX[i]; d[o + 1] = this.PY[i]; d[o + 2] = this.PZ[i];
      d[o + 3] = this.PSize[i] * (0.6 + 0.4 * lf);
      d[o + 4] = Math.min(1, this.PLife[i] / 0.35) * 0.75;
    }
    return n;
  }

  capV(h, b) {
    let d = h - (b.y - b.r);
    if (d <= 0) return 0;
    if (d > 2 * b.r) d = 2 * b.r;
    return Math.PI * d * d * (3 * b.r - d) / 3;
  }

  stepBall(b, dt) {
    const r = b.r, t = this.time, o = 0.65 * r;
    const S0 = this._s0, S1 = this._s1;
    this.waveSample(b.x, b.z, t, true, S0);
    this.waveSample(b.x + o, b.z, t, false, S1); const h1 = S1.h;
    this.waveSample(b.x - o, b.z, t, false, S1); const h2 = S1.h;
    this.waveSample(b.x, b.z + o, t, false, S1); const h3 = S1.h;
    this.waveSample(b.x, b.z - o, t, false, S1); const h4 = S1.h;
    b.wh = S0.h;
    const Vs = (this.capV(S0.h, b) + this.capV(h1, b) + this.capV(h2, b) + this.capV(h3, b) + this.capV(h4, b)) / 5;
    const frac = Vs / b.V; b.frac = frac;
    const dAvg = clamp((S0.h + h1 + h2 + h3 + h4) / 5 - (b.y - r), 0, 2 * r);
    const meff = b.m + 0.5 * RHO_W * Vs;

    const gAcc = G * this.gravityScale;
    let ay = (-b.m * gAcc + RHO_W * gAcc * Vs) / meff;
    let ax = (RHO_W * Vs * S0.ax) / meff, az = (RHO_W * Vs * S0.az) / meff;
    const dist = Math.hypot(b.x, b.z);
    if (dist > 10) { const k = (dist - 10) * 0.9; ax -= (b.x / dist) * k; az -= (b.z / dist) * k; }
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
      const f = Math.min(0.85, (0.5 * RHO_W * 0.47 * As * sp * dt) / meff);
      b.vx -= ux * f; b.vy -= uy * f; b.vz -= uz * f;
      const rcy = -r + dAvg * 0.5;
      const Jx = -b.m * ux * f, Jz = -b.m * uz * f;
      b.wx += (0.6 * (rcy * Jz)) / b.I;
      b.wz += (0.6 * (-rcy * Jx)) / b.I;
      const wm = Math.hypot(b.wx, b.wy, b.wz);
      const fr = Math.min(0.5, (0.5 * RHO_W * 0.12 * Math.pow(r, 5) * wm * frac * dt) / b.I) + 0.5 * frac * dt;
      b.wx *= 1 - fr; b.wy *= 1 - fr; b.wz *= 1 - fr;
    }
    {
      const ux = b.vx - this.windX, uy = b.vy, uz = b.vz - this.windZ;
      const sp = Math.hypot(ux, uy, uz), airF = 1 - Math.sqrt(frac);
      const A = Math.PI * r * r * airF;
      const f = Math.min(0.5, (0.5 * RHO_A * 0.47 * A * sp * dt) / meff);
      b.vx -= ux * f; b.vy -= uy * f; b.vz -= uz * f;
      if (airF > 0.01) {
        const k = (0.5 * RHO_A * Math.PI * r * r * r * airF) / b.m;
        let mx = k * (b.wy * uz - b.wz * uy), my = k * (b.wz * ux - b.wx * uz), mz = k * (b.wx * uy - b.wy * ux);
        const ml = Math.hypot(mx, my, mz);
        if (ml > 25) { const s = 25 / ml; mx *= s; my *= s; mz *= s; }
        b.vx += mx * dt; b.vy += my * dt; b.vz += mz * dt;
      }
    }
    if (b.grab) { const d = 1 - 3 * dt; b.wx *= d; b.wy *= d; b.wz *= d; }
    const vm = Math.hypot(b.vx, b.vy, b.vz);
    if (vm > 40) { const s = 40 / vm; b.vx *= s; b.vy *= s; b.vz *= s; }

    if (b.pf < 0.003 && frac >= 0.003 && b.vy < -1.0) this.splash(b, -b.vy);
    b.pf = frac;

    const dpen = S0.h - (b.y - r);
    if (dpen > 0 && dpen < 2 * r) {
      const dy = b.y - S0.h;
      const rho = Math.max(Math.sqrt(Math.max(r * r - dy * dy, 0)), 0.06);
      this.addRipple(b.x, b.z, rho * 1.25 + 0.12, b.vy * dt * 0.35);
      const ux = b.vx - S0.vx, uz = b.vz - S0.vz, sp = Math.hypot(ux, uz);
      if (sp > 0.4) {
        const dx = ux / sp, dz = uz / sp;
        this.addRipple(b.x + dx * rho * 0.9, b.z + dz * rho * 0.9, rho * 0.8 + 0.1, sp * dt * 0.22);
        this.addRipple(b.x - dx * rho * 0.9, b.z - dz * rho * 0.9, rho * 0.8 + 0.1, -sp * dt * 0.22);
      }
      if (sp > 1.4 || Math.abs(b.vy) > 2) {
        this.addFoam(b.x, b.z, rho * 1.4 + 0.1, Math.min(1, (sp + Math.abs(b.vy)) * 0.45) * dt * 10);
      }
      if (sp > 3 && frac < 0.95 && Math.random() < sp * dt * 4) {
        const a = Math.random() * 6.28;
        this.emit(b.x + Math.cos(a) * rho, S0.h, b.z + Math.sin(a) * rho,
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

  collide() {
    const balls = this.balls, n = balls.length;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const rs = a.r + b.r, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rs * rs || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        const pen = rs - d, tot = a.im + b.im;
        a.x -= nx * pen * a.im / tot; a.y -= ny * pen * a.im / tot; a.z -= nz * pen * a.im / tot;
        b.x += nx * pen * b.im / tot; b.y += ny * pen * b.im / tot; b.z += nz * pen * b.im / tot;
        const ra = a.r, rb = b.r;
        const vax = a.vx + (a.wy * nz - a.wz * ny) * ra;
        const vay = a.vy + (a.wz * nx - a.wx * nz) * ra;
        const vaz = a.vz + (a.wx * ny - a.wy * nx) * ra;
        const vbx = b.vx - (b.wy * nz - b.wz * ny) * rb;
        const vby = b.vy - (b.wz * nx - b.wx * nz) * rb;
        const vbz = b.vz - (b.wx * ny - b.wy * nx) * rb;
        const rx = vbx - vax, ry = vby - vay, rz = vbz - vaz;
        const rn = rx * nx + ry * ny + rz * nz;
        if (rn >= 0) continue;
        let e = Math.min(a.e, b.e) * this.restitution;
        if (a.frac > 0.5 || b.frac > 0.5) e *= 0.35;
        const jn = (-(1 + e) * rn) / tot;
        a.vx -= jn * nx * a.im; a.vy -= jn * ny * a.im; a.vz -= jn * nz * a.im;
        b.vx += jn * nx * b.im; b.vy += jn * ny * b.im; b.vz += jn * nz * b.im;
        const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
        const tm = Math.hypot(tx, ty, tz);
        if (tm > 1e-5) {
          const dx2 = tx / tm, dy2 = ty / tm, dz2 = tz / tm;
          const den = tot + (ra * ra) / a.I + (rb * rb) / b.I;
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
          if (Math.abs(a.y - hy) < a.r * 1.5) this.addFoam((a.x + b.x) / 2, (a.z + b.z) / 2, 0.5, 0.4);
        }
      }
    }
  }

  /** Advance by real seconds. Fixed 240 Hz sub-steps, ripple at 120 Hz. */
  advance(dtReal, { maxSteps = 10 } = {}) {
    const scaled = dtReal * this.timeScale;
    this._acc = (this._acc || 0) + scaled;
    let steps = 0;
    while (this._acc >= H_STEP && steps < maxSteps) {
      this.time += H_STEP;
      this.steps++;
      for (let i = 0; i < this.balls.length; i++) this.stepBall(this.balls[i], H_STEP);
      for (let i = this.balls.length - 1; i >= 0; i--) {
        if (this.balls[i].dead) {
          if (this.grab && this.grab.ball === this.balls[i]) this.grab = null;
          this.balls.splice(i, 1);
        }
      }
      this.collide();
      if ((this.steps & 1) === 0) this.rippleStep();
      this._acc -= H_STEP;
      steps++;
    }
    if (steps >= maxSteps) this._acc = 0;
    this.particlesStep(scaled, this.MAXP);
    return scaled;
  }
}

function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}

/* ==========================================================================
   Camera — orbit with inertia, dolly, and a soft floor above the water.
   ========================================================================== */
export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.yaw = 0; this.pitch = 0.22; this.dist = 13;
    this.tYaw = 0; this.tPitch = 0.22; this.tDist = 13;
    this.target = [0, 0.35, 0];
    this.eye = [0, 3, 13];
    this.f = [0, 0, -1]; this.r = [1, 0, 0]; this.u = [0, 1, 0];
    this.vp = null;
    this.tanH = 0.466;
    this.aspect = 1;
    this.width = 1; this.height = 1;
    this.near = 0.1; this.far = 3000;
    this.fov = 52;
    this.idleSpin = false;
    this._spin = 0;
  }

  update(dt, physics) {
    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.dist += (this.tDist - this.dist) * (1 - Math.exp(-dt * 7));
    if (this.idleSpin) {
      this._spin += dt * 0.035;
      this.tYaw = this._spin;
    }
    const cp = Math.cos(this.pitch);
    this.eye = [
      this.target[0] + this.dist * Math.sin(this.yaw) * cp,
      this.target[1] + this.dist * Math.sin(this.pitch),
      this.target[2] + this.dist * Math.cos(this.yaw) * cp
    ];
    if (physics) {
      const s = physics._s1;
      physics.waveSample(this.eye[0], this.eye[2], physics.time, false, s);
      const minY = s.h + 0.55;
      if (this.eye[1] < minY) this.eye[1] = minY;
    }
    let fx = this.target[0] - this.eye[0], fy = this.target[1] - this.eye[1], fz = this.target[2] - this.eye[2];
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    this.f = [fx, fy, fz];
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    this.r = [rx, 0, rz];
    this.u = [0 * fz - rz * fy, rz * fx - rx * fz, rx * fy - 0 * fx];
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth || 1);
    this.aspect = this.canvas.width / this.canvas.height;
    this.tanH = Math.tan((this.fov * Math.PI) / 360) * Math.max(1, 1.14 / this.aspect);
    const proj = M4.persp(2 * Math.atan(this.tanH), this.aspect, this.near, this.far);
    this.vp = M4.mul(proj, M4.look(this.eye, this.target, [0, 1, 0]));
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    return dpr;
  }

  ray(px, py, rect) {
    const { width: vw, height: vh, left, top } = rect;
    const nx = ((px - left) / vw) * 2 - 1;
    const ny = 1 - ((py - top) / vh) * 2;
    const d = [
      this.f[0] + nx * this.tanH * this.aspect * this.r[0] + ny * this.tanH * this.u[0],
      this.f[1] + ny * this.tanH * this.u[1],
      this.f[2] + nx * this.tanH * this.aspect * this.r[2] + ny * this.tanH * this.u[2]
    ];
    const l = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  pickBall(balls, px, py, rect) {
    const d = this.ray(px, py, rect);
    let best = null, bt = 1e9;
    for (const b of balls) {
      const ox = this.eye[0] - b.x, oy = this.eye[1] - b.y, oz = this.eye[2] - b.z;
      const R = b.r * 1.25 + 0.06;
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

  /** Point on the water plane under the cursor, clamped to the play area. */
  waterPoint(px, py, rect) {
    const d = this.ray(px, py, rect);
    let x, z;
    if (d[1] < -0.002) {
      const t = -(this.eye[1] + 0.0) / d[1];
      x = this.eye[0] + d[0] * t;
      z = this.eye[2] + d[2] * t;
    } else {
      x = this.eye[0] + d[0] * 10;
      z = this.eye[2] + d[2] * 10;
    }
    const rr = Math.hypot(x, z);
    if (rr > 10.5) { x *= 10.5 / rr; z *= 10.5 / rr; }
    return [x, z];
  }
}
