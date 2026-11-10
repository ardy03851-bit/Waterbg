/* ==========================================================================
   Small shared helpers: DOM, math, matrices, storage, tiny event bus.
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const DEG = Math.PI / 180;

/* Matrix helpers (column-major, matching GL) */
export const M4 = {
  persp(fovy, asp, n, f) {
    const o = new Float32Array(16), t = 1 / Math.tan(fovy / 2);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  },
  look(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]),
      -(yx * e[0] + yy * e[1] + yz * e[2]),
      -(zx * e[0] + zy * e[1] + zz * e[2]), 1
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
};

/* ---------- persistence ---------- */
const KEY = 'stillwater.settings.v2';

export function loadStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
export function saveStored(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* private mode */ }
}

/* ---------- event bus ---------- */
export function bus() {
  const map = new Map();
  return {
    on(evt, fn) { (map.get(evt) || map.set(evt, new Set()).get(evt)).add(fn); return () => map.get(evt).delete(fn); },
    emit(evt, payload) { const s = map.get(evt); if (s) s.forEach(fn => fn(payload)); }
  };
}

/* ---------- misc ---------- */
export const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function formatNumber(n) { return String(Math.round(n)); }

/** Slider 0..100 -> a 24h clock string between 03:00 and 21:00. */
export function hourLabel(v) {
  const h = 3 + (clamp(v, 0, 100) / 100) * 18;
  let hh = Math.floor(h);
  let mm = Math.round(((h - hh) * 60) / 15) * 15;
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* SVG icon set — 1.5px hairlines, matching the interface weight. */
export const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sliders: '<path d="M4 8h10m4 0h2M4 16h4m4 0h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.9 1.5-2.6 2.7-2.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="8" cy="9" r="1.1"/><circle cx="12" cy="7" r="1.1"/><circle cx="16" cy="9" r="1.1"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.8 4a6.8 6.8 0 0 0 10.2 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  waves: '<path d="M2 8.5c2-2 3.5-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0M2 14c2-2 3.5-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0M2 19.5c2-2 3.5-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18"/>',
  droplet: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/>',
  motion: '<path d="M4 17c4-10 12-10 16 0"/><circle cx="12" cy="17" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.9 13h9.2l.9-13"/>',
  sparkle: '<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>',
  gauge: '<path d="M4 18a8.5 8.5 0 1 1 16 0"/><path d="M12 13.5 15.5 9"/><circle cx="12" cy="14" r="1.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="15" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="9" cy="15" r="1.1"/>',
  reset: '<path d="M4 5v5h5"/><path d="M5.6 14a7 7 0 1 0 .8-6.2L4 10"/>',
  eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  keyboard: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
  thermometer: '<path d="M12 14.5V5a2 2 0 1 1 4 0v9.5a4.5 4.5 0 1 1-4 0Z"/><circle cx="14" cy="17" r="1.6"/>',
  cloud: '<path d="M7 18a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.4 1.2A3.5 3.5 0 0 1 17.5 18H7Z"/>'
};
export const icon = (name, cls = '') =>
  `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
