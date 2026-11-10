/* ==========================================================================
   Stillwater — application shell.
   Owns the clock, the settings store and the frame graph. The expensive parts
   (physics, shaders, renderer) live in their own modules.
   ========================================================================== */
import { $, clamp, loadStored, saveStored, hourLabel } from './util.js';
import { createContext, Renderer } from './gl.js';
import { Physics, Camera, BODY_TYPES } from './physics.js';
import { SkyModel } from './sky.js';
import { moodById, SCENE_PRESETS } from './palettes.js';
import { buildRadial, Panel, toast, Hint } from './ui.js';

const DEFAULTS = {
  /* scene */
  sea: 38, time: 58, weather: 18, mood: 'dusk', preset: 'golden',
  /* water */
  clarity: 62, chop: 1, sparkle: 78, detail: 82,
  /* light */
  exposure: 100,
  /* toggles */
  reflection: true, refraction: true, stars: false, aurora: false,
  caustic: false, foam: true,
  /* motion */
  orbit: false, spray: true, slowmo: false,
  speed: 100, gravity: 100, bounce: 100, distance: 132,
  /* bodies */
  body: 0, size: 1, dropHeight: 46,
  /* atmosphere */
  grain: true, vignette: true,
  /* performance */
  qualityScale: 1, hud: true
};

const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);

/** Settings that a scene preset defines; editing one leaves the preset. */
const PRESET_KEYS = new Set(['sea', 'time', 'weather', 'mood', 'clarity', 'sparkle', 'chop']);

class App {
  constructor() {
    this.canvas = $('#gl');
    this.settings = Object.assign({}, DEFAULTS, loadStored());
    this.forceQuiet = false;
    this.hudHidden = false;
    this.pointerIdle = 0;
    this.autoRevealed = false;

    this.gl = createContext(this.canvas);
    if (!this.gl) {
      $('#fail').style.display = 'flex';
      $('#boot')?.remove();
      throw new Error('WebGL2 unavailable');
    }

    this.renderer = new Renderer(this.canvas, this.gl);
    this.physics = new Physics();
    this.camera = new Camera(this.canvas);
    this.sky = new SkyModel();
    this.applyExposureUniforms();

    this.renderScale = Math.min(MAX_DPR, 1.25);
    this.scaleCeiling = Math.max(0.65, Math.min(MAX_DPR * 1.2, MAX_DPR * this.settings.qualityScale));
    this.w = 0; this.h = 0;

    this.fps = 60; this.ema = 16.7;
    this.lastT = performance.now();
    this.statAccum = 0;
    this.particlesEnabled = true;

    this.camera.fov = 52;
    this.camera.tDist = this.settings.distance / 10;
    this.camera.dist = this.camera.tDist;
    this.sky.time = this.sky.timeT = this.settings.time;
    this.sky.weather = this.sky.weatherT = this.settings.weather;

    this.setupUI();
    this.bindInput();
    this.applySettings(true);
    this.spawnOpening();
    this.resize();

    $('#boot')?.classList.add('done');
    setTimeout(() => $('#boot')?.remove(), 900);

    requestAnimationFrame(t => { this.lastT = t; this.frame(t); });
    setTimeout(() => {
      if (!this.forceQuiet && !this.panel.isOpen()) {
        this.hint.show('drag to orbit <span class="dot"></span> tap the water to release a body <span class="dot"></span> <kbd>F</kbd> for quiet mode', 9000);
      }
    }, 1400);
  }

  /* --------------------------------------------------------------------
     UI
     -------------------------------------------------------------------- */
  setupUI() {
    this.panel = new Panel($('#panel'), {
      settings: this.settings,
      set: (k, v) => this.set(k, v),
      chooseMood: id => this.chooseMood(id),
      applyPreset: id => this.applyPreset(id),
      action: name => this.action(name),
      quiet: on => this.quiet(on),
      syncCameraFromSettings: () => this.syncCameraFromSettings()
    });

    this.radial = buildRadial($('#radial'), {
      onSelect: id => this.onRadial(id)
    });

    this.hint = new Hint($('#hint'));

    $('#bQuiet').addEventListener('click', () => this.quiet(true));
    $('#reveal').addEventListener('click', () => this.unquiet());
    $('#bFullscreen').addEventListener('click', () => this.enterImmersive());

    // Idle cursor in quiet mode
    window.addEventListener('pointermove', () => {
      this.pointerIdle = 0;
      document.body.classList.remove('pointer-idle');
    }, { passive: true });

    // Double-clicking the stage toggles fullscreen
    this.canvas.addEventListener('dblclick', () => this.toggleStage());
  }

  onRadial(id) {
    if (id === 'drop') { this.action('drop'); return; }
    if (id === 'rain') { this.action('driftfall'); return; }
    if (id === 'quiet') { this.quiet(true); return; }
    this.radial.setActive(id);
    if (this.panel.isOpen() && this.panel.section === id) this.panel.close();
    else this.panel.open(id);
  }

  /* --------------------------------------------------------------------
     Settings
     -------------------------------------------------------------------- */
  set(key, value) {
    const prev = this.settings[key];
    if (prev === value) return;
    this.settings[key] = value;
    // touching any of the preset's own controls means we are no longer in it
    if (PRESET_KEYS.has(key)) this.settings.preset = null;
    this.applySettings();
    if (this.panel.isOpen()) this.panel.refresh();
    saveStored(this.settings);
  }

  /** Exposure is a presentation value, so it rides on the shared sky state. */
  applyExposureUniforms() {
    this.sky.exposureBias = clamp(this.settings.exposure / 100, 0.5, 1.4);
  }

  /** The camera is also driven by drag/scroll, so pull its distance back in. */
  syncCameraFromSettings() {
    this.camera.tDist = this.settings.distance / 10;
  }

  chooseMood(id) {
    this.settings.mood = id;
    this.applySettings();
    if (this.panel.isOpen()) this.panel.refresh();
    saveStored(this.settings);
    toast(`Mood · ${moodById(id).name}`);
  }

  applyPreset(id) {
    const p = SCENE_PRESETS.find(x => x.id === id);
    if (!p) return;
    Object.assign(this.settings, p.patch, { preset: id });
    if (p.patch.stars !== undefined) this.settings.stars = p.patch.stars;
    if (p.patch.mood) this.settings.mood = p.patch.mood;
    this.applySettings();
    if (this.panel.isOpen()) this.panel.render();
    saveStored(this.settings);
    toast(`${p.name}`);
  }

  applySettings(initial) {
    const S = this.settings;

    // physics
    this.physics.sizeMul = S.size;
    this.physics.chop = S.chop;
    this.physics.timeScale = S.slowmo ? 0.28 : S.speed / 100;
    this.physics.gravityScale = S.gravity / 100;
    this.physics.restitution = S.bounce / 100;
    this.physics.setSea(S.sea / 100);

    // sky targets
    this.applyExposureUniforms();
    this.sky.setMood(moodById(S.mood));
    this.sky.target({ time: S.time, weather: S.weather, stars: S.stars, aurora: S.aurora });

    // camera
    this.camera.idleSpin = S.orbit;
    if (initial) {
      this.camera.tDist = S.distance / 10;
      this.camera.dist = this.camera.tDist;
    }

    // interface accent follows the mood
    const M = moodById(S.mood);
    const root = document.documentElement.style;
    root.setProperty('--accent', M.accent);
    root.setProperty('--warm', M.accent);
    root.setProperty('--accent-rgb', M.accentRGB);

    this.qualityScale = S.qualityScale;
    this.scaleCeiling = Math.max(0.65, Math.min(MAX_DPR * 1.2, MAX_DPR * S.qualityScale));
    this.particlesEnabled = S.spray;

    document.body.classList.toggle('no-grain', !S.grain);
    document.body.classList.toggle('no-vignette', !S.vignette);
    this.updateReadout();
  }

  action(name) {
    switch (name) {
      case 'drop': this.release(); break;
      case 'shuffle': this.shuffle(); break;
      case 'clear': this.physics.clear(); toast('Water cleared'); break;
      case 'driftfall': this.driftfall(); break;
      case 'randomize': this.randomize(); break;
      case 'screenshot': this.capture(); break;
      case 'slowmo': this.set('slowmo', !this.settings.slowmo); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'quiet': this.quiet(true); break;
    }
  }

  /* --------------------------------------------------------------------
     Scene actions
     -------------------------------------------------------------------- */
  release() {
    const S = this.settings;
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 3.2;
    this.physics.spawn(
      Math.cos(a) * rr, S.dropHeight / 10 + 1.2, Math.sin(a) * rr,
      S.body, 0, -0.3, 0
    );
    this.hint.hide();
  }

  shuffle() {
    const S = this.settings;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 6;
        this.physics.spawn(
          Math.cos(a) * rr, S.dropHeight / 10 + 2 + Math.random() * 2, Math.sin(a) * rr,
          Math.floor(Math.random() * BODY_TYPES.length)
        );
      }, i * 130);
    }
    toast('Five bodies');
  }

  driftfall() {
    const S = this.settings;
    let i = 0;
    const timer = setInterval(() => {
      const a = Math.random() * Math.PI * 2, rr = 1 + Math.random() * 8;
      this.physics.spawn(
        Math.cos(a) * rr, S.dropHeight / 10 + 3 + Math.random() * 4, Math.sin(a) * rr,
        Math.floor(Math.random() * BODY_TYPES.length), 0, -1, 0
      );
      if (++i >= 9) clearInterval(timer);
    }, 150);
    toast('Driftfall');
  }

  randomize() {
    const moods = ['dusk', 'temperate', 'overcast', 'nocturne', 'ember'];
    const patch = {
      sea: 18 + Math.random() * 68,
      time: 8 + Math.random() * 84,
      weather: Math.random() * 70,
      mood: moods[Math.floor(Math.random() * moods.length)],
      clarity: 30 + Math.random() * 65,
      chop: 0.8 + Math.random() * 0.45,
      sparkle: 40 + Math.random() * 60,
      exposure: 88 + Math.random() * 26,
      preset: null
    };
    Object.assign(this.settings, patch);
    this.applySettings();
    if (this.panel.isOpen()) this.panel.render();
    saveStored(this.settings);
    toast(`Randomised · ${moodById(patch.mood).name}`);
  }

  capture() {
    // The canvas is not preserved, so re-render into the same frame before reading.
    this.render(0);
    const url = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    a.href = url;
    a.download = `stillwater-${moodById(this.settings.mood).id}-${stamp}.png`;
    a.click();
    toast('Frame captured');
  }

  /* --------------------------------------------------------------------
     Interface visibility
     -------------------------------------------------------------------- */
  /** Quiet mode: everything fades out, the water stays interactive. */
  quiet(on) {
    this.forceQuiet = on;
    document.body.classList.toggle('quiet', on);
    if (on) {
      this.panel.close();
      this.radial.setOpen(false);
      this.hint.hide();
      document.body.classList.remove('hud-hidden');
      this.hudHidden = false;
      toast('Quiet mode · press F to return', 2300);
    } else {
      document.body.classList.remove('pointer-idle');
    }
  }
  unquiet() {
    if (this.forceQuiet) this.quiet(false);
    if (this.hudHidden) this.toggleHUD();
  }

  /** Hiding the interface by hand leaves a small tab to bring it back. */
  toggleHUD() {
    this.hudHidden = !this.hudHidden;
    document.body.classList.toggle('hud-hidden', this.hudHidden);
    if (this.hudHidden) {
      this.panel.close();
      this.radial.setOpen(false);
      toast('Interface hidden · click the tab', 2200);
    } else {
      toast('Interface');
    }
  }

  /** Reveal everything after a period of pointer stillness (quiet mode). */
  nudgeInterface() {
    if (this.forceQuiet) {
      this.unquiet();
      toast('Interface · F to hide again');
    }
  }

  /** Double-tap (or double-click) the stage: hide the interface, or restore it. */
  toggleStage() {
    if (this.forceQuiet) this.unquiet();
    else this.quiet(true);
  }

  /** Fullscreen + quiet mode: nothing but water. Click to come back. */
  enterImmersive() {
    this.toggleFullscreen(true);
    this.quiet(true);
    toast('Fullscreen · click the water to return', 2600);
  }

  toggleFullscreen(silent) {
    const el = document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFs) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el).catch(() => {});
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document).catch(() => {});
    }
    if (!silent) toast(isFs ? 'Leaving fullscreen' : 'Fullscreen');
  }

  /* --------------------------------------------------------------------
     Input
     -------------------------------------------------------------------- */
  bindInput() {
    const canvas = this.canvas;
    const ptrs = new Map();
    let pinch0 = 0, pinchDist0 = 13;
    this.dragMoved = false;

    const rectOf = () => {
      const r = canvas.getBoundingClientRect();
      return { left: r.left || 0, top: r.top || 0, width: r.width || window.innerWidth, height: r.height || window.innerHeight };
    };

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
      this.dragMoved = false;
      canvas.classList.add('dragging');
      this.hint.hide();
      if (ptrs.size === 1 && e.button !== 2) {
        const hit = this.camera.pickBall(this.physics.balls, e.clientX, e.clientY, rectOf());
        if (hit) {
          this.physics.grab = { ball: hit.ball, pid: e.pointerId, depth: hit.t };
          this.setGrabTarget(e.clientX, e.clientY);
        }
      } else if (ptrs.size > 1) {
        this.releaseGrab();
        const [a, b] = [...ptrs.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        pinchDist0 = this.camera.tDist;
      }
    });

    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) { p.moved = true; this.dragMoved = true; }
      const g = this.physics.grab;
      if (g && g.pid === e.pointerId) { this.setGrabTarget(e.clientX, e.clientY); return; }
      if (ptrs.size === 1 && p.moved) {
        this.camera.tYaw -= dx * 0.0055;
        this.camera.tPitch = clamp(this.camera.tPitch + dy * 0.0042, 0.02, 1.42);
        this.camera.idleSpin = false;
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 10) this.camera.tDist = clamp((pinchDist0 * pinch0) / Math.max(d, 10), 3.2, 44);
      }
    });

    let lastTap = 0;
    const endPtr = e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const wasGrab = this.physics.grab && this.physics.grab.pid === e.pointerId;
      if (wasGrab) this.releaseGrab();
      else if (ptrs.size === 1 && !p.moved && performance.now() - p.t < 420 && e.type === 'pointerup') {
        const now = performance.now();
        if (e.pointerType === 'touch' && now - lastTap < 340) {
          // double tap: toggle quiet mode instead of dropping a second body
          lastTap = 0;
          ptrs.delete(e.pointerId);
          if (ptrs.size === 0) canvas.classList.remove('dragging');
          this.toggleStage();
          return;
        }
        lastTap = now;
        if (!this.forceQuiet) this.spawnAtPointer(p.x, p.y);
        else this.unquiet();
      }
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch0 = 0;
      if (ptrs.size === 0) canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endPtr);
    canvas.addEventListener('pointercancel', endPtr);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.camera.tDist = clamp(this.camera.tDist * Math.exp(e.deltaY * 0.0011), 3.2, 44);
      this.settings.distance = this.camera.tDist * 10;
      if (this.panel.isOpen() && this.panel.section === 'motion') this.panel.refresh();
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.radial.setOpen(true);
    });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(n =>
      document.addEventListener(n, e => e.preventDefault()));
    document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

    // keyboard
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (document.body.classList.contains('quiet')) this.unquiet();
        else if (document.body.classList.contains('hud-hidden')) this.toggleHUD();
        else this.panel.close();
        return;
      }
      if (e.repeat) return;
      if (k === 'f') { document.body.classList.contains('quiet') ? this.unquiet() : this.quiet(true); }
      else if (k === 'h') this.toggleHUD();
      else if (k === ' ') { e.preventDefault(); this.action('drop'); }
      else if (k === 'r') this.action('driftfall');
      else if (k === 'c') this.action('clear');
      else if (k === 's') this.action('screenshot');
      else if (k === 'p') this.action('randomize');
      else if (k === 'm') this.set('slowmo', !this.settings.slowmo);
      else if (k === 'o') this.set('orbit', !this.settings.orbit);
      else if (k === '1' || k === '2' || k === '3' || k === '4' || k === '5') {
        const ids = ['scene', 'water', 'light', 'bodies', 'motion'];
        this.onRadial(ids[+k - 1]);
      }
    });
  }

  setGrabTarget(px, py) {
    const g = this.physics.grab;
    if (!g) return;
    const d = this.camera.ray(px, py, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    g.ball.grab = {
      x: this.camera.eye[0] + d[0] * g.depth,
      y: this.camera.eye[1] + d[1] * g.depth,
      z: this.camera.eye[2] + d[2] * g.depth
    };
  }

  releaseGrab() {
    const g = this.physics.grab;
    if (!g) return;
    const b = g.ball;
    b.grab = null;
    b.wx += (b.vz * 0.4) / b.r * 0.3;
    b.wz -= (b.vx * 0.4) / b.r * 0.3;
    this.physics.grab = null;
  }

  spawnAtPointer(px, py) {
    const r = this.canvas.getBoundingClientRect();
    const [x, z] = this.camera.waterPoint(px, py, {
      left: r.left || 0, top: r.top || 0,
      width: r.width || window.innerWidth, height: r.height || window.innerHeight
    });
    this.physics.spawn(x, this.settings.dropHeight / 10 + 1.4, z, this.settings.body, 0, -0.2, 0);
    // a small disturbance where the cursor touched, so taps feel connected
    this.physics.addRipple(x, z, 0.5, 0.06);
  }

  spawnOpening() {
    this.physics.sizeMul = this.settings.size;
    this.physics.spawn(-2.4, 3.8, 1.1, 0);
    this.physics.spawn(0.7, 5.4, -0.5, 1);
    this.physics.spawn(2.8, 6.6, 0.9, 5);
    this.physics.spawn(1.0, 7.2, 3.4, 3);
  }

  /* --------------------------------------------------------------------
     Frame
     -------------------------------------------------------------------- */
  resize() {
    const w = Math.max(2, Math.round(window.innerWidth * this.renderScale));
    const h = Math.max(2, Math.round(window.innerHeight * this.renderScale));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.renderer.targets.resize(w, h, {
      reflection: this.settings.reflection,
      refraction: this.settings.refraction
    });
    this.canvasW = window.innerWidth;
    this.canvasH = window.innerHeight;
  }

  updateReadout() {
    this.readoutEl = this.readoutEl || $('#readout');
    if (!this.readoutEl) return;
    this.readoutEl.style.display = this.settings.hud ? 'flex' : 'none';
  }

  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const dtMs = now - this.lastT;
    this.lastT = now;
    if (!(dtMs > 0)) return;
    const dt = Math.min(dtMs / 1000, 0.05);
    this.ema = this.ema * 0.93 + Math.min(dtMs, 90) * 0.07;

    this.adaptResolution(dt);
    this.resize();

    this.sky.update(dt, moodById(this.settings.mood));
    this.physics.advance(dt);
    this.camera.update(dt, this.physics);
    this.render(dt);

    // idle cursor fade, and a gentle nudge of the interface after stillness
    this.pointerIdle += dt;
    if (this.forceQuiet && this.pointerIdle > 2.0) document.body.classList.add('pointer-idle');
    if (!this.forceQuiet) this.autoRevealed = false;

    if (this.forceQuiet && this.pointerIdle > 45 && !this.autoRevealed) {
      this.autoRevealed = true;
      toast('Click anywhere to bring the interface back', 2600);
    }

    this.statAccum += dt;
    if (this.statAccum > 0.35) {
      this.statAccum = 0;
      this.updateStats();
    }
  }

  adaptResolution() {
    this.scaleCeiling = Math.max(0.65, Math.min(MAX_DPR * 1.2, MAX_DPR * this.qualityScale));
    if (this.ema > 23 && this.renderScale > 0.62) {
      this.renderScale = Math.max(0.62, this.renderScale - 0.09);
      this.ema = 19;
    } else if (this.ema < 15.5 && this.renderScale < this.scaleCeiling) {
      this.renderScale = Math.min(this.scaleCeiling, this.renderScale + 0.035);
      this.ema = 16.5;
    }
  }

  updateStats() {
    this.fps = Math.round(1000 / Math.max(this.ema, 1));
    const el = this.readoutEl || (this.readoutEl = $('#readout'));
    if (!el) return;
    el.innerHTML =
      `<span>${Math.min(this.fps, 144)}<b> fps</b></span>` +
      `<i></i><span>${Math.round(this.renderScale * 100)}<b>%</b></span>` +
      `<i></i><span>${this.physics.balls.length}<b> bodies</b></span>`;
    const clock = $('#brandClock');
    if (clock) clock.textContent = hourLabel(this.settings.time);
  }

  render() {
    const gl = this.gl;
    const R = this.renderer;
    const sky = this.sky.state;
    const cam = this.camera;
    const t = this.sky.time; // shader clock uses simulation time
    const simT = this.physics.time;

    /* pass 1 — mirrored geometry (planar reflection) */
    if (this.settings.reflection && R.targets.refl) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.targets.refl.fb);
      gl.viewport(0, 0, R.targets.refl.w, R.targets.refl.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      R.drawBalls(this.physics.balls, cam, sky, simT, 1, 1);
    }

    /* pass 2 — above-water geometry with depth (refraction source) */
    if (this.settings.refraction && R.targets.scene) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.targets.scene.fb);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      R.drawBalls(this.physics.balls, cam, sky, simT, 1, 0);
    }

    /* pass 3 — main */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    R.drawSky(cam, sky, simT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    R.drawWater(cam, sky, simT, {
      dirs: this.physics.waveDirs,
      q: this.physics.waveQ,
      a0: this.physics.a0
    }, {
      radius: this.physics.RR,
      size: this.physics.RN,
      texture: this.rippleTex || (this.rippleTex = this.makeRippleTexture())
    }, {
      clarity: this.settings.clarity / 100,
      sparkle: this.settings.sparkle / 100,
      detail: 0.35 + 1.3 * (this.settings.detail / 100),
      caustic: this.settings.caustic ? 1 : 0
    });

    /* above-water bodies */
    R.drawBalls(this.physics.balls, cam, sky, simT, 0, 0);

    /* spray */
    if (this.particlesEnabled && this.physics.pCount > 0) {
      const n = this.physics.packParticles();
      if (!this.pBuffers) this.pBuffers = this.renderer.makeParticleBuffers(this.physics.MAXP);
      R.drawParticles(n, this.physics.particleData, this.pBuffers.buf, this.pBuffers.vao, cam, sky, simT);
    }

    this.uploadRipples();
  }

  makeRippleTexture() {
    const gl = this.gl, RN = this.physics.RN;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, RN, RN, 0, gl.RG, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  uploadRipples() {
    const gl = this.gl;
    const data = this.physics.packRipples();
    const RN = this.physics.RN;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.rippleTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RN, RN, gl.RG, gl.FLOAT, data);
  }
}

/* --------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------- */
try {
  window.__stillwater = new App();
} catch (err) {
  const e = document.getElementById('err');
  if (e) {
    e.style.display = 'flex';
    e.textContent = String(err && err.stack ? err.stack : err);
  }
  console.error(err);
}
