# Stillwater

A quiet, animated sea you can leave running in the background: Gerstner-wave
water with planar reflections and refraction, buoyant rigid bodies, and a
restrained interface built around one radial menu.

Open `index.html` (or serve the folder) — no build step, no dependencies.

```
python3 -m http.server 8080
```

## Using it

| | |
|---|---|
| Drag | orbit the camera |
| Scroll / pinch | dolly |
| Tap the water | release a body |
| Drag a body | pick it up and throw it |
| Double click / double tap | hide or restore the interface |
| Right click | open the radial menu |

**Keyboard** — `F` quiet mode · `H` hide interface · `Space` release ·
`R` driftfall · `C` clear · `S` capture a frame · `P` surprise me ·
`M` slow motion · `O` horizon drift · `1`–`5` open a panel section.

Fullscreen lives in the top bar; it enters fullscreen *and* quiet mode, so the
screen holds nothing but water. A click brings the interface back.

## Files

```
index.html              shell + markup
assets/css/style.css    tokens, panel, radial menu, HUD states
assets/js/app.js        frame graph, settings store, input, actions
assets/js/gl.js         WebGL2 programs, detail texture, geometry, targets
assets/js/shaders.js    all GLSL (sky, water, bodies, spray)
assets/js/physics.js    Gerstner waves, rigid bodies, ripples, camera
assets/js/sky.js        time of day + weather → lighting uniforms
assets/js/ui.js         radial menu + schema-driven settings panel
assets/js/palettes.js   moods and scene presets
assets/js/util.js       math, matrices, storage, icons
```

## Notes on performance

* Resolution is adaptive: the render scale is lowered when the rolling frame
  time passes ~23 ms and raised again under ~15.5 ms, with the *Resolution*
  segmented control in **Motion** setting the ceiling.
* Interactive ripples are applied per fragment (with a two-step parallax
  search) rather than by displacing the water mesh, so the wave grid stays at
  320² while the surface still reads as liquid up close.
* Planar reflections render at half resolution; refraction renders at full
  resolution and can be switched off per device.
* Balls are uploaded as per-draw uniforms and drawn as one instanced-free
  batch; particles use a single interleaved VBO updated with
  `bufferSubData`.

## Accessibility

Reduced-motion preferences disable the grain animation and shorten every
transition. Controls are real buttons with `aria-pressed` / `aria-checked`,
the panel is reachable from the toolbar, and `Escape` always backs out.
