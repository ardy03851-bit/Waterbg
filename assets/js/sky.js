/* ==========================================================================
   Sky model: maps the mood + time + weather sliders onto the lighting
   uniforms that every shader shares. Values are eased so dragging a slider
   never snaps the scene.
   ========================================================================== */
import { clamp, lerp3, sstep, damp } from './util.js';

export class SkyModel {
  constructor() {
    this.state = {
      sun: [0, 1, 0],
      sunCol: [1, 1, 1],
      zenith: [0.05, 0.2, 0.5],
      horizon: [0.6, 0.75, 0.9],
      glow: [0, 0, 0],
      ambLum: 1,
      sunLum: 3,
      cloudLo: 0.6,
      storm: 0,
      night: 0,
      stars: 0,
      aurora: 0,
      exposure: 0.9
    };
    // eased copies of the raw sliders
    this.time = 52; this.timeT = 52;
    this.weather = 20; this.weatherT = 20;
    this.starsAmt = 1; this.auroraAmt = 0;
    this.mood = null;
    this.exposureBias = 1;
  }

  setMood(mood) { this.mood = mood; }

  /** target values; call every frame */
  target({ time, weather, night, stars, aurora }) {
    this.timeT = time;
    this.weatherT = weather;
    this.starsAmt = stars ? 1 : 0;
    this.auroraAmt = aurora ? 1 : 0;
  }

  update(dt, mood) {
    this.mood = mood || this.mood;
    this.time = damp(this.time, this.timeT, 6, dt);
    this.weather = damp(this.weather, this.weatherT, 4, dt);

    const M = this.mood;
    const t = this.time / 100;                 // 0 = night, 1 = midday
    const s = clamp(this.weather / 100, 0, 1); // 0 = clear, 1 = storm

    // solar elevation: -0.12 rad at t=0 up to ~1.18 rad at t=1
    const eps = -0.16 + t * 1.42;
    const day = sstep(-0.05, 0.42, eps);
    const az = -0.5;
    const ce = Math.cos(eps);
    const sun = [Math.sin(az) * ce, Math.sin(eps), -Math.cos(az) * ce];

    // night is driven by the sun's elevation regardless of the mood, so the
    // "stars" checkbox and the time slider never disagree
    const night = clamp(1 - sstep(-0.14, 0.10, eps), 0, 1);

    let zen = lerp3(M.zenithNight, M.zenithDay, day);
    let hor = lerp3(M.horizonNight, M.horizonDay, Math.pow(day, 0.75));
    // overcast dulls everything toward a flat grey
    const greyZ = [0.20, 0.225, 0.25], greyH = [0.42, 0.45, 0.47];
    zen = lerp3(zen, greyZ.map(v => v * (0.22 + 0.78 * day)), s * 0.62);
    hor = lerp3(hor, greyH.map(v => v * (0.3 + 0.7 * day)), s * 0.55);
    // night mutes the palette slightly so stars read
    zen = zen.map(v => v * (1 - 0.15 * night));
    hor = hor.map(v => v * (1 - 0.10 * night));

    const glowBase = (1 - day * 0.85) * 0.95 * (1 - 0.55 * s) + night * 0.05;
    const glow = M.glow.map(v => v * glowBase);

    const sunInten = 3.0 * (0.22 + 0.78 * sstep(-0.02, 0.30, eps)) * (1 - 0.74 * s);
    const sunTint = lerp3(M.sunWarm, M.sunCool, sstep(0.04, 0.52, eps));
    const moon = night * 0.34;
    const sunCol = sunTint.map(v => v * sunInten + 0.18 * moon);

    const st = this.state;
    st.sun = sun; st.sunCol = sunCol; st.zenith = zen; st.horizon = hor; st.glow = glow;
    st.sunLum = sunInten + moon * 2.2;
    st.ambLum = (0.20 + 0.80 * day) * (1 - 0.30 * s) + 0.05;
    st.cloudLo = 0.66 - 0.34 * s;
    st.storm = s;
    st.night = night;
    st.stars = night * this.starsAmt * (1 - 0.55 * s);
    st.aurora = night * this.auroraAmt * (1 - s);
    // exposure is a presentation choice owned by the app
    st.exposure = 0.78 * (this.exposureBias || 1);

    return st;
  }
}
