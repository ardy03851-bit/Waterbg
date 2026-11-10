# Waterbg

A cozy, glassmorphic ocean background app with WebGL2 Gerstner-wave physics.

## Features

- **Gerstner-wave ocean** with interactive ripples, foam, refraction & reflection
- **6 ball types** with rigid-body physics (beach ball, basketball, tennis, wood, bowling, steel)
- **Spray particles** and splash simulation
- **Glassmorphic UI** — animated, serious, icon-driven settings panel
- **Many settings** across 5 categories: Sea, Sky, Balls, Graphics, Camera
- **Fullscreen UI-hide mode** — click the Fullscreen button to remove all UI; click anywhere to bring it back
- **Adaptive resolution** — stays smooth on any device
- **Auto-spawn, auto-orbit, slow-mo** and more

## File structure

```
index.html    — HTML + GLSL shaders
css/style.css — Glassmorphic styling & animations
js/app.js     — Physics, rendering, UI logic
```

## Controls

| Action | How |
|--------|-----|
| Drop ball | Tap/click the sea, or press "Drop ball" |
| Grab & fling | Touch/click a ball and drag |
| Orbit camera | Drag one finger/mouse |
| Zoom | Pinch or scroll wheel |
| Fullscreen hide | Click "Fullscreen" (UI vanishes; click anywhere to return) |
| Open settings | The dock panel — switch tabs with the icon buttons |

## Performance

Adaptive resolution lowers the render scale when frame rate drops and raises it when there's headroom. A "Low / High / Auto" resolution override is under Graphics → Resolution.
