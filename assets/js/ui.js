/* ==========================================================================
   Interface: radial menu, settings panel, HUD lifecycle.
   The panel is generated from a small schema below, so a new control is a
   data change rather than a markup change.
   ========================================================================== */
import { $, $$, icon, hourLabel, ICONS } from './util.js';
import { BODY_TYPES } from './physics.js';
import { MOODS, SCENE_PRESETS } from './palettes.js';

/* -------------------------------------------------------------------------
   Radial menu — twelve entries on one orbit.
   Five open panels, seven are direct actions.
   ------------------------------------------------------------------------- */
export const RADIAL = [
  { id: 'scene', icon: 'waves', label: 'Scene' },
  { id: 'water', icon: 'droplet', label: 'Water' },
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'bodies', icon: 'sphere', label: 'Bodies' },
  { id: 'motion', icon: 'motion', label: 'Motion' },
  { id: 'drop', icon: 'sparkle', label: 'Release' },
  { id: 'splash', icon: 'wind', label: 'Splash' },
  { id: 'rain', icon: 'cloud', label: 'Driftfall' },
  { id: 'capture', icon: 'camera', label: 'Capture' },
  { id: 'clear', icon: 'trash', label: 'Clear' },
  { id: 'surprise', icon: 'dice', label: 'Surprise' },
  { id: 'quiet', icon: 'expand', label: 'Quiet' }
];

export function buildRadial(root, { onSelect }) {
  root.innerHTML = `
    <div class="radial-ring"></div>
    <div class="radial-sweep"></div>
    <div class="radial-options" role="toolbar" aria-label="Scene controls">
      ${RADIAL.map((item, i) => `
        <button class="radial-option" style="--i:${i + 1}" data-id="${item.id}"
                type="button" aria-label="${item.label}">
          ${icon(item.icon)}
          <span class="tip">${item.label}</span>
        </button>`).join('')}
    </div>
    <button class="radial-trigger" type="button" aria-expanded="false" aria-label="Open controls">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="bar bar-top" d="M4 7h16"/>
        <path class="bar bar-mid" d="M4 12h16"/>
        <path class="bar bar-bot" d="M4 17h16"/>
      </svg>
    </button>
    <div class="radial-caption" aria-hidden="true"></div>`;

  const trigger = $('.radial-trigger', root);
  const caption = $('.radial-caption', root);
  root.style.setProperty('--options', RADIAL.length);

  const labelFor = id => (RADIAL.find(r => r.id === id) || {}).label || '';
  const setOpen = open => {
    root.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Close controls' : 'Open controls');
    if (!open) caption.textContent = '';
  };
  const setActive = id => {
    const idx = RADIAL.findIndex(r => r.id === id);
    if (idx < 0) return;
    root.style.setProperty('--selected', idx + 1);
    $$('.radial-option', root).forEach(el => {
      const on = el.dataset.id === id;
      el.dataset.active = on ? 'true' : 'false';
      el.setAttribute('aria-current', on ? 'true' : 'false');
    });
    if (!root.classList.contains('open')) caption.textContent = labelFor(id);
  };
  const highlight = id => {
    const idx = RADIAL.findIndex(r => r.id === id);
    if (idx < 0) return;
    root.style.setProperty('--selected', idx + 1);
    caption.textContent = labelFor(id);
  };

  trigger.addEventListener('click', () => setOpen(!root.classList.contains('open')));
  $$('.radial-option', root).forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      setOpen(false);
      onSelect(id);
    });
    el.addEventListener('pointerenter', () => highlight(el.dataset.id));
    el.addEventListener('focus', () => highlight(el.dataset.id));
  });
  root.addEventListener('pointerleave', () => {
    const cur = root.style.getPropertyValue('--selected');
    const idx = parseInt(cur, 10) - 1;
    if (idx >= 0) caption.textContent = labelFor(RADIAL[idx].id);
  });

  document.addEventListener('pointerdown', e => {
    if (root.classList.contains('open') && !root.contains(e.target)) setOpen(false);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && root.classList.contains('open')) setOpen(false);
  });

  return { setOpen, setActive, isOpen: () => root.classList.contains('open'), trigger };
}

/* -------------------------------------------------------------------------
   Schema
   ------------------------------------------------------------------------- */
const seaWord = v => (v < 12 ? 'Glass' : v < 30 ? 'Calm' : v < 50 ? 'Ripple' : v < 70 ? 'Swell' : v < 88 ? 'Rough' : 'Storm');
const weatherWord = v => (v < 15 ? 'Clear' : v < 40 ? 'Fair' : v < 65 ? 'Clouding' : v < 85 ? 'Overcast' : 'Squall');
const detailWord = v => (v < 25 ? 'Low' : v < 55 ? 'Medium' : v < 82 ? 'High' : 'Ultra');
const pct = v => `${Math.round(v)}%`;

const SLIDERS = {
  scene: [
    { key: 'sea', label: 'Sea state', min: 0, max: 100, fmt: seaWord },
    { key: 'time', label: 'Hour', min: 0, max: 100, fmt: hourLabel },
    { key: 'weather', label: 'Weather', min: 0, max: 100, fmt: weatherWord }
  ],
  water: [
    { key: 'clarity', label: 'Clarity', min: 0, max: 100, fmt: pct },
    { key: 'chop', label: 'Chop', min: 50, max: 150, fmt: v => `${(v / 100).toFixed(2)}×` },
    { key: 'sparkle', label: 'Glitter', min: 0, max: 100, fmt: pct },
    { key: 'detail', label: 'Surface detail', min: 0, max: 100, fmt: detailWord },
    { key: 'foamDensity', label: 'Foam', min: 0, max: 180, fmt: pct },
    { key: 'splashPower', label: 'Splash force', min: 0, max: 200, fmt: pct },
    { key: 'exposure', label: 'Exposure', min: 60, max: 130, fmt: v => `${(v / 100).toFixed(2)}×` }
  ],
  motion: [
    { key: 'speed', label: 'Time flow', min: 10, max: 100, fmt: v => `${(v / 100).toFixed(2)}×` },
    { key: 'gravity', label: 'Gravity', min: 40, max: 160, fmt: v => `${(v / 100).toFixed(2)} g` },
    { key: 'bounce', label: 'Restitution', min: 20, max: 120, fmt: pct },
    { key: 'distance', label: 'Camera distance', min: 60, max: 340, fmt: v => `${Math.round(v)}` }
  ],
  bodies: [
    { key: 'size', label: 'Sphere scale', min: 40, max: 200, fmt: v => `${(v / 100).toFixed(1)}×` },
    { key: 'dropHeight', label: 'Release height', min: 20, max: 140, fmt: v => `${(v / 10).toFixed(1)} m` }
  ],
  light: []
};

const TOGGLES = {
  scene: [
    { key: 'reflection', label: 'Planar reflection', hint: 'Mirror bodies in the surface' },
    { key: 'refraction', label: 'Refraction', hint: 'Bend what lies beneath the waterline' },
    { key: 'stars', label: 'Stars', hint: 'Appear once the sun is down' },
    { key: 'aurora', label: 'Aurora', hint: 'Slow ribbons over the horizon' },
    { key: 'grain', label: 'Film grain', hint: 'A little texture over the frame' },
    { key: 'vignette', label: 'Vignette', hint: 'Darken the corners' }
  ],
  water: [
    { key: 'foam', label: 'Foam', hint: 'Breaking crests, wakes and object trails' },
    { key: 'wake', label: 'Body wakes', hint: 'The V a moving body drags behind it' },
    { key: 'caustic', label: 'Caustic shimmer', hint: 'Light refocused by the surface' }
  ],
  motion: [
    { key: 'orbit', label: 'Horizon drift', hint: 'The camera turns by itself, slowly' },
    { key: 'spray', label: 'Sea spray', hint: 'The fine mist thrown up by the water' },
    { key: 'slowmo', label: 'Slow motion', hint: 'Quarter-speed simulation' },
    { key: 'hud', label: 'Performance readout', hint: 'Frame rate, resolution, bodies' }
  ],
  bodies: [],
  light: [{ key: 'hud', label: 'Performance readout', hint: 'Frame rate, resolution, bodies' }]
};

/** Slider value <-> stored value (they are not always the same scale). */
const toModel = (key, raw) => {
  if (key === 'size') return raw / 100;
  if (key === 'dropHeight') return raw / 10;
  if (key === 'chop') return raw / 100;
  if (key === 'speed' || key === 'gravity' || key === 'bounce' || key === 'exposure') return raw;
  return raw;
};
const toSlider = (key, model) => {
  if (key === 'size') return Math.round(model * 100);
  if (key === 'dropHeight') return Math.round(model * 10);
  if (key === 'chop') return Math.round(model * 100);
  return Math.round(model);
};

const META = {
  scene: ['I', 'The water and the hour'],
  water: ['II', 'Surface, depth and light'],
  light: ['III', 'Palette of the sky'],
  bodies: ['IV', 'What floats, what sinks'],
  motion: ['V', 'Time, gravity, camera']
};

/* -------------------------------------------------------------------------
   Panel
   ------------------------------------------------------------------------- */
export class Panel {
  constructor(root, api) {
    this.root = root;
    this.api = api;
    this.section = 'scene';
  }

  open(section) {
    if (section) this.section = section;
    this.render();
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
  }
  close() {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
  }
  isOpen() { return this.root.classList.contains('open'); }
  toggle(section) {
    if (this.isOpen() && (!section || section === this.section)) this.close();
    else this.open(section);
  }

  render() {
    const S = this.api.settings;
    const sec = this.section;
    const meta = META[sec] || META.scene;
    let body = '';

    if (sec === 'scene') {
      body += `<div class="group-label">Presets</div>
        <div class="presets">
          ${SCENE_PRESETS.map(p => `
            <button class="preset" type="button" data-preset="${p.id}" data-active="false">
              <span class="swatchband" style="background:${presetBand(p)}"></span>
              <b>${p.name}</b><small>${p.blurb}</small>
            </button>`).join('')}
        </div>`;
      body += `<div class="group-label">Conditions</div>` + this.sliderMarkup('scene', S);
      body += `<div class="group-label">Rendering</div>` + this.toggleMarkup('scene', S);
      body += `<div class="actions">
        <button class="btn" type="button" data-action="screenshot">${icon('camera')}Capture</button>
        <button class="btn" type="button" data-action="randomize">${icon('dice')}Surprise me</button>
      </div>`;
    } else if (sec === 'light') {
      body += `<div class="group-label">Mood</div>
        <div class="swatches">
          ${MOODS.map(m => `
            <button class="swatch" type="button" data-mood="${m.id}" aria-pressed="false">
              <span class="orb" style="background:${moodOrb(m)}"></span>
              <span class="sw-name">${m.name}</span>
              <span class="sw-sub">${m.blurb}</span>
            </button>`).join('')}
        </div>
        <div class="group-label">Exposure</div>
        <label class="slider" data-key="exposure">
          <span class="lab">Exposure <b>${(S.exposure / 100).toFixed(2)}×</b></span>
          <div class="trackwrap">
            <input type="range" min="60" max="130" value="${Math.round(S.exposure)}" data-slider="exposure">
            <div class="ticks">${ticks()}</div>
          </div>
        </label>
        <div class="group-label">Night</div>` + this.toggleMarkup('light', S);
    } else if (sec === 'bodies') {
      body += `<div class="group-label">Object</div>
        <div class="swatches">
          ${BODY_TYPES.map((t, i) => `
            <button class="swatch" type="button" data-body="${i}" aria-pressed="false">
              <span class="orb" style="background:${t.sw}"></span>
              <span class="sw-name">${t.name}</span>
              <span class="sw-sub">${t.sub}</span>
            </button>`).join('')}
        </div>
        <div class="group-label">Scale</div>
        ${this.sliderMarkup('bodies', S)}
        <div class="actions">
          <button class="btn primary" type="button" data-action="drop">${icon('droplet')}Release</button>
          <button class="btn" type="button" data-action="shuffle">${icon('dice')}Random five</button>
          <button class="btn" type="button" data-action="clear">${icon('trash')}Clear</button>
        </div>`;
    } else {
      body += this.sliderMarkup(sec, S);
      if (sec === 'motion') {
        body += `<div class="group-label">Resolution</div>
          <div class="segmented" data-seg="quality">
            ${['Eco', 'Balanced', 'Fine', 'Max'].map((q, i) => `
              <button type="button" data-quality="${[0.62, 0.85, 1, 1.18][i]}" aria-pressed="false">${q}</button>`).join('')}
          </div>
          <div class="panel-note">Resolution adapts to the frame rate; this sets the ceiling.</div>`;
      }
      const toggles = TOGGLES[sec] || [];
      if (toggles.length) body += `<div class="group-label">Motion</div>` + this.toggleMarkup(sec, S);
    }

    this.root.innerHTML = `
      <div class="panel-head">
        <div class="panel-title">
          <span class="eyebrow">Environment / ${meta[0]}</span>
          <h2>${meta[1]}</h2>
        </div>
        <div class="panel-head-actions">
          <button class="icon-btn" type="button" data-panel-min aria-label="Quiet mode" title="Quiet mode (F)">${icon('expand')}</button>
          <button class="icon-btn" type="button" data-panel-close aria-label="Close panel">${icon('close')}</button>
        </div>
      </div>
      <div class="panel-body">${body}</div>
      <div class="panel-foot">${icon('keyboard')} F quiet · Space release · drag to orbit</div>`;

    this.wire();
    this.refresh();
  }

  sliderMarkup(sec, S) {
    return (SLIDERS[sec] || []).map(s => `
      <label class="slider" data-key="${s.key}">
        <span class="lab">${s.label} <b>${s.fmt(sec === 'bodies' && s.key === 'dropHeight' ? S[s.key] * 10 : sec === 'bodies' && s.key === 'size' ? S[s.key] * 100 : S[s.key])}</b></span>
        <div class="trackwrap">
          <input type="range" min="${s.min}" max="${s.max}" value="${toSlider(s.key, S[s.key])}" data-slider="${s.key}">
          <div class="ticks">${ticks()}</div>
        </div>
      </label>`).join('');
  }

  toggleMarkup(sec, S) {
    return (TOGGLES[sec] || []).map(t => `
      <div class="setting">
        <div class="setting-copy"><b>${t.label}</b><small>${t.hint}</small></div>
        <button class="switch" type="button" data-toggle="${t.key}" role="switch"
                aria-checked="${!!S[t.key]}" aria-label="${t.label}"></button>
      </div>`).join('');
  }

  refresh() {
    const S = this.api.settings;
    const root = this.root;

    $$('[data-slider]', root).forEach(input => {
      const key = input.dataset.slider;
      input.value = toSlider(key, S[key]);
      paintRange(input);
      const holder = input.closest('.slider');
      const out = holder && $('.lab b', holder);
      if (out) out.textContent = labelFor(key, S[key]);
    });
    $$('[data-toggle]', root).forEach(el => {
      el.setAttribute('aria-checked', String(!!S[el.dataset.toggle]));
    });
    $$('[data-mood]', root).forEach(el => {
      el.setAttribute('aria-pressed', String(el.dataset.mood === S.mood));
    });
    $$('[data-body]', root).forEach(el => {
      el.setAttribute('aria-pressed', String(+el.dataset.body === S.body));
    });
    $$('[data-quality]', root).forEach(el => {
      el.setAttribute('aria-pressed', String(Math.abs(+el.dataset.quality - S.qualityScale) < 0.01));
    });
    $$('[data-preset]', root).forEach(el => {
      el.dataset.active = String(el.dataset.preset === S.preset);
    });
  }

  wire() {
    const root = this.root;
    const api = this.api;

    $('[data-panel-close]', root)?.addEventListener('click', () => this.close());
    $('[data-panel-min]', root)?.addEventListener('click', () => api.quiet(true));

    $$('[data-slider]', root).forEach(input => {
      const key = input.dataset.slider;
      input.addEventListener('input', () => {
        const model = toModel(key, +input.value);
        api.set(key, model);
        paintRange(input);
        const holder = input.closest('.slider');
        const out = holder && $('.lab b', holder);
        if (out) out.textContent = labelFor(key, model);
        if (key === 'distance') api.syncCameraFromSettings?.();
      });
    });

    $$('[data-toggle]', root).forEach(el => {
      el.addEventListener('click', () => api.set(el.dataset.toggle, !api.settings[el.dataset.toggle]));
    });
    $$('[data-mood]', root).forEach(el => {
      el.addEventListener('click', () => api.chooseMood(el.dataset.mood));
    });
    $$('[data-body]', root).forEach(el => {
      el.addEventListener('click', () => api.set('body', +el.dataset.body));
    });
    $$('[data-quality]', root).forEach(el => {
      el.addEventListener('click', () => api.set('qualityScale', +el.dataset.quality));
    });
    $$('[data-preset]', root).forEach(el => {
      el.addEventListener('click', () => api.applyPreset(el.dataset.preset));
    });
    $$('[data-action]', root).forEach(el => {
      el.addEventListener('click', () => api.action(el.dataset.action));
    });
  }
}

function labelFor(key, v) {
  if (key === 'size') return `${v.toFixed(1)}×`;
  if (key === 'dropHeight') return `${v.toFixed(1)} m`;
  if (key === 'distance') return `${Math.round(v)}`;
  if (key === 'chop') return `${(v).toFixed(2)}×`;
  if (key === 'exposure') return `${(v / 100).toFixed(2)}×`;
  if (key === 'sea') return seaWord(v);
  if (key === 'weather') return weatherWord(v);
  if (key === 'time') return hourLabel(v);
  if (key === 'detail') return detailWord(v);
  if (key === 'speed') return `${(v / 100).toFixed(2)}×`;
  if (key === 'gravity') return `${(v / 100).toFixed(2)} g`;
  if (key === 'bounce') return `${Math.round(v)}%`;
  return pct(v);
}

const ticks = () => Array.from({ length: 9 }, () => '<span></span>').join('');

export function paintRange(input) {
  const min = +input.min, max = +input.max;
  const p = ((+input.value - min) / (max - min)) * 100;
  input.style.setProperty('--p', p.toFixed(2) + '%');
}

function moodOrb(m) {
  const h = m.horizonDay.map(v => Math.min(255, Math.round(v * 255)));
  const z = m.zenithDay.map(v => Math.min(255, Math.round(v * 255)));
  return `linear-gradient(160deg, rgb(${z.join(',')}) 0%, rgb(${h.join(',')}) 62%, ${m.accent} 100%)`;
}
function presetBand(p) {
  const m = MOODS.find(x => x.id === p.patch.mood) || MOODS[1];
  const h = m.horizonDay.map(v => Math.min(255, Math.round(v * 255)));
  const z = m.zenithDay.map(v => Math.min(255, Math.round(v * 255)));
  return `linear-gradient(120deg, rgb(${z.join(',')}) 0%, rgb(${h.join(',')}) 55%, ${m.accent} 100%)`;
}

/* -------------------------------------------------------------------------
   Toast + hint
   ------------------------------------------------------------------------- */
let toastTimer = 0;
export function toast(msg, ms = 1700) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export class Hint {
  constructor(el) {
    this.el = el;
    this.timer = 0;
  }
  show(html, ms = 9000) {
    if (!this.el) return;
    this.el.innerHTML = html;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    if (ms) this.timer = setTimeout(() => this.hide(), ms);
  }
  hide() {
    this.el?.classList.remove('show');
    clearTimeout(this.timer);
  }
}

export { ICONS };
