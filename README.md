# Stillwater

A quiet, animated sea you can leave running in the background: Gerstner-wave
water with planar reflections and refraction, buoyant rigid bodies, and a
soft neumorphic interface built around one radial menu.

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
`X` splash · `R` driftfall · `C` clear · `S` capture a frame · `P` surprise me ·
`M` slow motion · `O` horizon drift · `1`–`5` open a panel section.

Fullscreen lives in the top bar; it enters fullscreen *and* quiet mode, so the
screen holds nothing but water. A click brings the interface back.

## The water

The surface is a Gerstner wave field, but almost everything interesting happens
per fragment, on top of it:

* **Bodies push the water.** Every body in the water presses a bowl into the
  surface, raises a meniscus where the water climbs its flank, and shades the
  water underneath it. The nearest sixteen bodies are handed to the shader
  every frame.
* **Wakes.** A body that is moving drags a Kelvin V behind it, with a foam
  trail that is carried off and broken up by the waves.
* **Splashes.** An impact throws a crown of heavy drops, a column that falls
  back, and a cloud of fine mist that hangs for a moment afterwards. Leaving
  the surface throws a smaller, upward splash. The body then feels the wave
  it just made, so it rides the water it disturbed.
* **Foam is a field, not a decal.** It is advected along the orbital flow of
  the waves, spread, and faded, so a wake drifts and dissolves instead of
  sitting where it was drawn.
* **Whitecaps** form where the wave surface actually folds, and only near the
  top of a crest.
* **Refraction** bends the three colours by slightly different amounts, so
  submerged bodies fringe at the edges.

## The interface

Neumorphism: every surface is cut from the same soft grey and lit from two
directions. Buttons start engraved and lift when you point at them; panels and
menus are carved in. The quick actions sit on a twelve-part ring, well clear
of the corner of the screen, and name the section you are pointing at.

## Files

```
index.html              shell + markup
assets/css/style.css    tokens, panel, radial menu, HUD states
assets/js/app.js        frame graph, settings store, input, actions
assets/js/gl.js         WebGL2 programs, detail texture, geometry, targets
assets/js/shaders.js    all GLSL (sky, water, bodies, spray)
assets/js/physics.js    Gerstner waves, rigid bodies, foam field, camera
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
* Foam transport runs on the CPU at 60 Hz over the 192² field, on a coarse
  32² grid of orbital velocities.

## Accessibility

Reduced-motion preferences disable the grain animation and shorten every
transition. Controls are real buttons with `aria-pressed` / `aria-checked`,
the panel is reachable from the toolbar, and `Escape` always backs out.
