# Lighting pass on `feat/lighting`

Four commits on top of `cf85eff`:

| commit | what |
| --- | --- |
| `6241444` | the harness: metrics, stills, GPU timing |
| `7266072` | contact shading in the shared composite (all three scene families) |
| `b1f9782` | the sky halo follows the sun the district is lit by |
| `896199d` | the office rig derives from the weather outside its own window |
| `2b8ed11` | faces take the contact term at a face's strength |

Everything is measured at 1600x1000, pixel ratio 2, against a dev server
(`:5411`) that was never restarted, so the crowd-population warning does not
apply to anything compared here.

## What changed, and why

### All three families: contact shading

Nothing in these scenes could block a light. The office casts no shadows at all
— the key has `castShadow` off, and the point lights were consolidated
specifically so that none would need a shadow map — and outdoors a single sun
map is filled in by a hemisphere, which by construction gives the strip of
pavement in the angle of a wall exactly as much sky as the middle of the road.
So a bookcase put no darkness in the gap behind it, a desk laid none under
itself, and a district of a thousand objects stood on one evenly lit plane.

The depth buffer the composite already samples for its contours answers the
same question. Occlusion is eight more taps in a shader that runs once, rather
than a shadow map per light and the batching those would cost.

Three details that are deliberate:

- **Applied to linear radiance, before the grade.** It is a light that is
  missing, not a darkening of the picture. Applying it after tone mapping
  greys the midtones instead of deepening the crevice.
- **Multiplied by a colour, not a scalar.** A crevice loses the wide sky light
  and keeps the short bounce, so it goes warm under stone and cool under teal
  plaster. Each district names its own tint. Treaty Sea's is weak because water
  is a second sky; Global Compact's is weaker still because a night sky has
  little to take away.
- **Fixed tap rosette, no blur pass.** The noise a rotated pattern needs
  blurring away is screen-locked, so a moving camera would drag static speckle
  across the world — the one thing the paper grain is arranged not to do.
  Undersampling a fixed pattern shows up as a soft error instead, and a soft
  error is a wash.

The grain still runs before quantisation, and no blend layer was added
anywhere.

### Maps: the sky belongs to the sun

The sky gradient carried its own glow on a clock of its own, so the brightest
part of the sky drifted independently of the direction the buildings were lit
from. The halo is now read off the sun vector.

**Be honest about this one:** from the cameras a player actually uses, the dome
is barely in frame — the follow camera looks down at roofs, and even the survey
view is a sliver of sky in the top corners. The before/after survey stills are
near-identical. What the change is really worth is (a) the sun direction is now
one fact shared by the sky, the shadows and the office window, and (b) the dome
left the per-frame uniform update, since it no longer animates.

The sun shadow radius went from the default to 2, which is the softness a sun
seen through atmosphere has.

### Office: lit by the weather outside its own window

The window view is built from the district the firm sits in, but the rig
lighting the room was authored against nothing in particular — a grey harbour
afternoon outside could sit next to a warm key inside. The hemisphere sky
colour, the key colour and direction, and the two rect-area fills now all
derive from the same `daylight` and sun vector the exterior view is built from.
`buildOfficeWindowView` returns the sun direction in the room's local space to
make that possible.

No lights were added, none were split, and the consolidated point lights and
the z-fighting fix are untouched.

### Portraits: the same term, far weaker

A figure has almost nothing that genuinely occludes anything: a chin over a
collar, an arm against a ribcage, the inside of a lapel. At the rooms' strength
that short list turns into grime in every fold of the suit and a bruise under
the jaw. Portraits take `occlusion .42` (rooms are `.92`–`1.0`), a radius of
`.11` world units against a figure three units tall, and a warm tint, because
the light reaching the underside of a chin has bounced off a collar.

Only the office hero owns a composite; the smaller busts share a pooled
renderer and never see the illustrated pass, so the hero is the surface this
was judged on.

## Stills

Pixel-aligned pairs, one built scene photographed twice with the term toggled:

| surface | off | on | difference |
| --- | --- | --- | --- |
| Old Quarter | `.light-shots/final/map-city-off.png` | `map-city-on.png` | `diff-map-city.png` |
| The Circuit | `map-nation-off.png` | `map-nation-on.png` | `diff-map-nation.png` |
| Treaty Sea | `map-ocean-off.png` | `map-ocean-on.png` | `diff-map-ocean.png` |
| Sovereign Arc | `map-continent-off.png` | `map-continent-on.png` | `diff-map-continent.png` |
| Global Compact | `map-orbit-off.png` | `map-orbit-on.png` | `diff-map-orbit.png` |
| Office tier 0 | `office0-off.png` | `office0-on.png` | `diff-office0.png` |
| Office tier 11 | `office11-off.png` | `office11-on.png` | `diff-office11.png` |
| Hero portrait | `.light-shots/portraits/office-panel-off.png` | `office-panel-on.png` | `panel-diff.png` |

Rig before/after (same occlusion in both arms, so the difference is the light):
`.light-shots/rig-before/office{0,11}-on.png` against
`.light-shots/final/office{0,11}-on.png`, and `.light-shots/rig-{before,after}/`
for the survey skies.

How much moved, mean absolute level difference over the whole canvas out of 255:

| surface | contact term | rig change |
| --- | --- | --- |
| Old Quarter | 1.57 | — |
| The Circuit | 1.45 | — |
| Treaty Sea | 0.41 | — |
| Sovereign Arc | 1.69 | — |
| Global Compact | 0.23 | — |
| Office tier 0 | 1.73 | 3.71 |
| Office tier 11 | 2.93 | 5.59 |
| Hero portrait | 0.16 (peak 14) | — |

The portrait number is small on purpose, and the difference image shows it
landing under the chin, in the lapel V, between arm and torso and under the
shoes, with nothing on the background.

Flat surfaces were checked separately on the Old Quarter: open road moves 0.01
levels, canal water 0.17, open grass 0.15, while the foot of a wall moves 1.13.
The term is finding geometry, not fogging the frame.

## Cost

### Geometry: unchanged everywhere

Identical before and after, which is the whole point — no geometry, no lights,
no shader permutations:

| surface | draw calls | triangles | programs | geometries |
| --- | --- | --- | --- | --- |
| Old Quarter | 747 | 551,688 | 38 | 344 |
| The Circuit | 380 | 199,820 | 42 | 278 |
| Treaty Sea | 149 | 54,230 | 27 | 152 |
| Sovereign Arc | 562 | 413,902 | 42 | 341 |
| Global Compact | 162 | 79,386 | 21 | 180 |
| Office tier 0 | 106 | 29,286 | 19 | 92 |
| Office tier 11 | 155 | 66,622 | 21 | 141 |

### GPU: the contact term costs about a millisecond

`EXT_disjoint_timer_query_webgl2`, arms interleaved inside one frame loop on one
built scene, so the two arms differ by exactly the toggle:

| surface | scene | + composite | + occlusion | occlusion costs |
| --- | --- | --- | --- | --- |
| Old Quarter | 6.24 ms | 8.24 ms | 9.13 ms | **0.89 ms** |
| The Circuit | 3.19 ms | 5.80 ms | 7.14 ms | **1.34 ms** |
| Treaty Sea | 1.84 ms | 5.06 ms | 6.26 ms | **1.21 ms** |
| Sovereign Arc | 11.34 ms | 14.98 ms | 16.02 ms | **1.04 ms** |
| Global Compact | 1.76 ms | 5.23 ms | 6.40 ms | **1.16 ms** |
| Office tier 11 | 6.68 ms | 9.33 ms | 9.99 ms | **0.66 ms** |

It is a per-pixel cost, so it is near-constant across scenes and scales with
canvas area rather than with scene complexity. A second run taken while the
machine was heavily loaded put the same figures between 0.70 ms and 1.73 ms by
minimum-of-60, with one contaminated outlier at 2.47 ms; the honest summary is
**about 1 ms of GPU per frame at 1600x1000**, roughly a tenth of a frame at 60 Hz
and about the same again as the composite already costs.

A scene that does not want it pays nothing: the taps are behind
`uOcclusion > 0.`, so setting the strength to zero costs one comparison.

The rig change and the sky change cost nothing measurable — same lights, same
counts, and the sky dropped an animated uniform.

### Load time

No new assets, geometry, textures or programs, and the depth texture the taps
read was already allocated for the contour pass, so nothing was added to scene
build. The harness's wall-clock first-frame numbers are not evidence either way
tonight: on identical code they swung by more than 2x in both directions between
runs (Treaty Sea 298 ms then 2003 ms, Global Compact 3450 ms then 910 ms) on a
machine running several other workers' browsers. Draw calls, triangles and
programs are the stable instruments and they did not move.

## Judgement calls worth flagging

- Tier 0 reads slightly dimmer than before, because a shack's small street-level
  window is now the source and the interior fill was pulled back to let it be
  one. Tier 11 gains a clear falloff across the back wall away from the window,
  which is the change reading correctly.
- The sky halo is close to invisible in play. It is kept because it costs less
  than what it replaced and because it puts the sun in one place, but it should
  not be sold as a visual improvement.
- Global Compact barely moves (0.23 mean) — a night sky has little ambient to
  remove, and the authored strength there is 0.34 for that reason.
