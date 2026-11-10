/* ==========================================================================
   Mood palettes and scene presets.
   A mood drives both the sky gradient and the interface accent, so the UI and
   the water always belong to the same photograph.
   ========================================================================== */

export const MOODS = [
  {
    id: 'dusk', name: 'Dusk', blurb: 'warm haze, low sun',
    accent: '#e0b98f', accentRGB: '224, 185, 143',
    zenithDay: [0.10, 0.20, 0.44], horizonDay: [0.92, 0.62, 0.40],
    zenithNight: [0.02, 0.045, 0.10], horizonNight: [0.10, 0.12, 0.20],
    glow: [1.0, 0.55, 0.28], sunWarm: [1.0, 0.66, 0.38], sunCool: [1.0, 0.96, 0.88],
    fogDensity: 1.0, seaTint: 'warm'
  },
  {
    id: 'temperate', name: 'Temperate', blurb: 'clean light, soft blue',
    accent: '#b7d6c8', accentRGB: '183, 214, 200',
    zenithDay: [0.055, 0.20, 0.56], horizonDay: [0.62, 0.78, 0.90],
    zenithNight: [0.015, 0.035, 0.085], horizonNight: [0.055, 0.085, 0.145],
    glow: [1.0, 0.78, 0.52], sunWarm: [1.0, 0.72, 0.44], sunCool: [1.0, 0.98, 0.92],
    fogDensity: 0.85, seaTint: 'cool'
  },
  {
    id: 'overcast', name: 'Overcast', blurb: 'silver, no horizon',
    accent: '#c3cbcf', accentRGB: '195, 203, 207',
    zenithDay: [0.26, 0.30, 0.34], horizonDay: [0.58, 0.62, 0.64],
    zenithNight: [0.035, 0.045, 0.055], horizonNight: [0.09, 0.10, 0.115],
    glow: [0.70, 0.70, 0.68], sunWarm: [0.86, 0.84, 0.78], sunCool: [0.92, 0.94, 0.94],
    fogDensity: 1.25, seaTint: 'grey'
  },
  {
    id: 'nocturne', name: 'Nocturne', blurb: 'moonlight, still air',
    accent: '#9fb6d6', accentRGB: '159, 182, 214',
    zenithDay: [0.03, 0.06, 0.16], horizonDay: [0.30, 0.40, 0.58],
    zenithNight: [0.008, 0.018, 0.048], horizonNight: [0.028, 0.048, 0.095],
    glow: [0.44, 0.58, 0.92], sunWarm: [0.72, 0.78, 1.0], sunCool: [0.82, 0.88, 1.0],
    fogDensity: 0.95, seaTint: 'cold'
  },
  {
    id: 'ember', name: 'Ember', blurb: 'late storm light',
    accent: '#dba98a', accentRGB: '219, 169, 138',
    zenithDay: [0.14, 0.10, 0.18], horizonDay: [0.86, 0.46, 0.30],
    zenithNight: [0.035, 0.022, 0.035], horizonNight: [0.12, 0.07, 0.07],
    glow: [1.0, 0.42, 0.20], sunWarm: [1.0, 0.50, 0.26], sunCool: [1.0, 0.92, 0.80],
    fogDensity: 1.15, seaTint: 'warm'
  }
];

/** Scene presets — a coherent starting point, not a random combination. */
export const SCENE_PRESETS = [
  {
    id: 'still', name: 'Still Morning', blurb: 'glassy · pale light',
    patch: { sea: 12, time: 34, weather: 8, mood: 'temperate', clarity: 86, sparkle: 70, chop: 0.75, twist: 0, caustic: 0 }
  },
  {
    id: 'golden', name: 'Golden Hour', blurb: 'low sun · long glitter',
    patch: { sea: 34, time: 78, weather: 16, mood: 'dusk', clarity: 62, sparkle: 100, chop: 0.9, twist: 6, caustic: 0 }
  },
  {
    id: 'swell', name: 'Long Swell', blurb: 'open water · deep roll',
    patch: { sea: 62, time: 52, weather: 44, mood: 'temperate', clarity: 48, sparkle: 62, chop: 1.15, twist: -8, caustic: 0 }
  },
  {
    id: 'squall', name: 'Squall Line', blurb: 'grey · breaking crests',
    patch: { sea: 84, time: 42, weather: 86, mood: 'overcast', clarity: 34, sparkle: 30, chop: 1.3, twist: 14, caustic: 0 }
  },
  {
    id: 'moon', name: 'Moonlit', blurb: 'night · slow ripples',
    patch: { sea: 26, time: 8, weather: 12, mood: 'nocturne', clarity: 74, sparkle: 84, chop: 0.85, twist: 0, caustic: 0, stars: true }
  },
  {
    id: 'ember', name: 'Ember Sea', blurb: 'storm light · warm haze',
    patch: { sea: 70, time: 88, weather: 66, mood: 'ember', clarity: 44, sparkle: 54, chop: 1.2, twist: 22, caustic: 0 }
  }
];

export const moodById = id => MOODS.find(m => m.id === id) || MOODS[1];
