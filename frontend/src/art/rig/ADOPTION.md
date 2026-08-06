# Adopting the humanoid rig on the remaining character surfaces

The office scene (`office-three.tsx`) was the first consumer. The portrait
(`stylized-character.tsx`) and the office's seated client have since converted
too, so the only character surface still on hand-written motion is the map's
pedestrians — see the bottom of this note for what that adoption needs.

## What this system is, in one paragraph

The art is unchanged. `buildStylizedCounsel` still produces exactly the meshes,
materials and silhouettes it always has; `bindHumanoidSkeleton` reinterprets the
joint groups it already contains as a Mixamo-named humanoid hierarchy, and
`HumanoidActor` drives those joints from authored clips through an
`AnimationMixer`. Nothing under a joint is touched — `scripts/rig-evidence.ts`
fingerprints all 62 meshes of a character and asserts they are byte-identical
after animating, so this is enforced rather than promised.

## The shape of an integration

```ts
const rig = buildStylizedCounsel(gender, level, { role, paletteSeed })
rig.root.scale.setScalar(0.46)
holder.add(rig.root)
scene.add(holder)
holder.updateWorldMatrix(true, true)   // before constructing the actor

const actor = new HumanoidActor(rig, { seed, state: 'idle', reduced })
director.add(actor, 'reception', seed)

// per frame, after the consumer has positioned and rotated `holder`
director.update(delta)
assignHumanoidLod(actors, camera, { fullBudget: 4, mediumBudget: 8 })
actor.setGroundSpeed(metresPerSecondThisFrame)
actor.update(delta)

// on teardown
actor.dispose()
```

Four ordering rules, all of which have already caused a bug once:

1. **Bind after the rig is in the scene graph and its world matrix is fresh.**
   The skeleton measures its own limb lengths from the bind pose.
2. **Position and rotate the character before calling `update`.** Foot planting
   works in world space and needs the body's final placement for this frame.
3. **Feed `setGroundSpeed` the speed the body is *actually* travelling**, measured
   from the distance it moved, not a nominal constant. This is the entire fix for
   foot sliding: the clip is time-scaled so one stride covers one step. Passing a
   speed that does not match the body's real motion reintroduces the skating.
4. **Call `dispose`.** The mixer caches bindings against the root object.

## Trap one: scale

`HumanoidProportions` are measured in the character's own local units, but the
floor is in world space. `HumanoidActor` reconciles the two through
`worldScale`, refreshed every frame. If you add a calculation that crosses
between the two, be explicit about which side it is on — the failure mode is not
an obvious unit error, it is the feet quietly sliding again, and only at some
scales. `scripts/rig-verify.ts` runs the whole foot-planting suite at both 1.0
(the portrait's scale) and the office's 0.46; add your scale if it differs
materially.

## Trap two: the holder's Y is the floor, and a role is a place not a person

Two contracts that only became explicit after the office pass, both of which
will bite a new consumer immediately.

**`HumanoidActor` treats the holder's world Y as the floor.** The constructor
lowers the pelvis by the rig's measured sole offset so the soles rest at the
holder's origin, and every grounding constraint — foot planting, the sole
clamp, the fold solve — measures against that plane. So place the holder *on*
the ground, at `y = terrainHeightAt(x, z)`, and never at hip height or at a
guessed shoe offset. Anything else and the whole cast floats or wades.

**Behaviour roles describe posture, not job title.** `deskWork`, `client` and
`seatedGuest` are seated repertoires: hand one to a character standing in open
floor and the scheduler will, quite correctly by its own lights, put them into
`seatedType`, which is a fully committed sitting pose played by a body with no
chair under it. That single mismatch is what the office looked like when its
owner said a character "quite literally doesn't stand straight" — the posture
was fine and the character was in the wrong place for it. If a character can
leave the thing it is sitting at, move its role with it:

```ts
director.setRole(actor, 'reception')   // standing repertoire, away from desk
director.suspend(actor, true)          // and hold the director off entirely
                                       // while *you* are driving the body
```

`suspend` should cover the whole journey, not just the frames the feet are
moving. Tying it to "is currently walking" hands the body back to the scheduler
on every yield and every wait for someone to pass.

## Trap three: reduced motion

An actor constructed with `reduced: true` settles into a held pose sampled from
its current clip and then stops. It must never be left in the bind pose, which
is a T-pose-ish rest that no state ever displays. Pass the flag at construction
rather than skipping `update`. Every subsequent `setState` and `playGesture`
lands its finished pose on the very next frame and then holds it dead still;
both halves are asserted in `rig-verify.ts`, because a held pose that drifts is
just a slow animation, which is the thing the preference asks not to happen.

## Trap four: a gesture and a state change at the same moment

Two things to know here. First, `playGesture('swimEnter')` immediately followed
by `setState('swim')` is the
normal way to run an authored transition, and it used to produce the single
largest pop in the system. `setState` now detects that an override gesture owns
the body and parks the incoming state at zero weight until the gesture finishes,
rather than crossfading it up underneath. Do not work around this by delaying
the `setState` — call them together, in either order.

Second, changing state directly between sitting and standing — `setState('idle')`
from `seatedIdle`, with no `standUp` beat — is allowed but needs a much longer
fade than a normal crossfade, and `TRANSITIONS` gives it 0.95s. The reason is
that the legs are not blending two poses: the hips travel half a hip-height
vertically while the foot solver holds the feet in place, so the knee angle
follows the body's *height* rather than the fade weight, and that relationship
is steep near full extension. At a normal 0.34s fade the knees arrive at
standing almost instantly and then stop dead, which is a visible velocity
cliff. Prefer the authored beat; the long fade is a safety net.

## Verification

`scripts/rig-verify.ts` is the regression suite (headless, no WebGL needed) and
`scripts/rig-evidence.ts` is the art-parity fingerprint. Run both after touching
anything under `rig/`:

```sh
node --import <tsx-loader> scripts/rig-verify.ts
node --import <tsx-loader> scripts/rig-evidence.ts
```

`scripts/rig-motion-capture.mjs` does the same continuity measurement from a
real WebGL loop against `rig-harness.html`, and writes frame strips alongside
the numbers; `scripts/portrait-capture.mjs` does it for the portrait card in the
running app. Both need a dev server and the cached Chromium.

One note if you add a continuity check of your own: score a frame by how far it
departs from the straight line between its neighbours, not by how far it exceeds
their median. Fast motion is not a fault, and a median test flags every
legitimate acceleration — a walk settling into an idle dips and then speeds up
as the last leg swing plays out, and every frame of that is continuous.
`worstDiscontinuity` in `rig-verify.ts` does it correctly and `verifyDetector`
proves it still fires on an injected one-frame jump.

## States and beats

Looping states: `idle`, `idleWeightShift`, `idleRelaxed`, `walk`, `swim`,
`seatedIdle`, `seatedType`, `confer`, `reviewDocument`, `presentBoard`.

One-shot beats come in two kinds, and the difference is the whole reason the
idle stopped reading as a mannequin:

- **Override** (`sitDown`, `standUp`, `celebrate`, `swimEnter`, `swimExit`) —
  whole-body events that genuinely replace what the body was doing. They fade
  the base state out and back.
- **Additive** (everything else: `nod`, `glance`, `breathDeep`, `weightSettle`,
  `cuffAdjust`, `postureReset`, `considerTilt`, `handFlex`, `acknowledge`,
  `courtBow`, plus the `…Mirrored` variants) — deltas layered over a base state
  that keeps running underneath, so the character carries on breathing and
  shifting its weight while it nods.

`playGesture(name, { amplitude, timeScale, fade })`. `amplitude` and `timeScale`
are load-bearing rather than conveniences: a repertoire fired in random order
still reads as a loop if each beat is identical every time, because what an
audience recognises is the shape of a motion. `HumanoidBehaviorDirector` picks
both per occurrence and actively spreads each draw away from recent performances
of the same beat, which is why there is no `professional-wave` any more — a
single repeated wave is precisely the failure this replaced.

## The `swim` clip — API for the map's ocean traversal

The Treaty Sea traversal is wired to a clip named `swim`. That name is a fixed
interface; it is exported from `humanoid-clips.ts` as part of the shared library
and reachable as a `HumanoidState`.

```ts
// entering the water
actor.playGesture('swimEnter')     // authored dive/push-off, ~1.1s
actor.setState('swim')             // call in the same tick; see trap three

// each frame while crossing
actor.setGroundSpeed(distanceMovedThisFrame / delta)
actor.update(delta)

// leaving the water
actor.playGesture('swimExit')      // authored climb-out, ~1.2s
actor.setState('idle')             // again, same tick
```

Behaviour and contract:

- `setGroundSpeed` drives the swim exactly as it drives the walk. `swim` declares
  how far one stroke carries the body (2.15 hip-heights), so the clip is
  time-scaled to make the body advance one stroke per cycle. `actor.naturalSwimSpeed`
  is the speed at which the clip plays at rate 1.0 — about 2.26 world units/s at
  scale 1, and proportional to scale. Route your traversal at or near it and the
  stroke rate will look right; feed it a mismatched constant and the arms will
  windmill against the body's motion the same way legs skate on land.
- **The clip poses the body prone by itself.** Mean hip pitch is 82°, and the
  root track drops the hips 0.78 hip-heights so the waterline sits mid-torso.
  Do not add your own pitch or Y offset on the holder — you will double it.
  Position the holder exactly as you would for a walking pedestrian.
- `grounded` is 0 throughout `swim`, `swimEnter` and `swimExit`, so foot planting
  is disabled automatically. There is no need to change LOD to avoid it.
- The stroke is a front crawl: arms alternate (−0.98 correlation between the
  shoulders), the spine counter-rotates with the lead arm (0.62 correlation), the
  legs flutter at a bit over two beats per arm cycle, and the head turns 23° to
  breathe every ~1.5 strokes. Those numbers are asserted in `rig-verify.ts`, so
  if you retune the clip the checks will tell you which relationship you broke.
- Reduced motion holds a mid-stroke prone pose rather than freezing at the dive.

## Surface-by-surface

### `map-agents.ts` / `map-crowd-rig.ts` — pedestrians

**Still unconverted, deliberately.** These files are being rewritten
concurrently, so this is an adoption path rather than an edit. Everything the
rig needs is already exported from `./rig`; nothing further has to be added on
this side.

- Share one `HumanoidBehaviorDirector` across the whole map.
- Set `fullBudget` low. Pedestrians are small on screen; `medium` LOD (joint
  clamping but no foot IK) is nearly indistinguishable at map zoom and is
  roughly a third of the cost. `assignHumanoidLod` handles the grading.
- Feed `setGroundSpeed` from the path follower's actual per-frame displacement.
  Map routes are usually parameterised by normalised progress, so the speed is
  not constant along the path and a fixed value will skate on the fast sections.
- The clip library is a module-level singleton, so a hundred pedestrians share
  one 447 KB set of clips. Do not build clips per actor.
- For the ocean legs, use the `swim` API above.
- Pedestrians stand and walk, so `reception` is the right role for most of
  them; `investigation` and `diplomatic` give two more standing repertoires if
  you want visible variety in a crowd. Do not use the seated roles — see trap
  two.

### Navigation and steering — `nav-floor.ts`

Exported from `./rig` alongside the rig itself, because the two are the same
problem seen from either end: the gait clip is time-scaled by the speed the
body actually achieved, so the thing that decides that speed has to be able to
report it honestly. A path follower that teleports, or that lerps along a
straight line between waypoints, hands `setGroundSpeed` a number that does not
describe the body's motion, and the feet skate no matter how good the clip is.

```ts
import { NavField, NavAgent, scanObstacleRects, mergeRects } from './rig'

// Once, after the scene is built. Obstacles are derived from the scene graph
// rather than hand-listed, so they cannot drift from the art.
const rects = mergeRects(scanObstacleRects(scene, { minY: 0.1, maxY: 1.4 }))
const field = new NavField({ bounds, obstacles: rects, cell: 0.16 })

// Per body.
const agent = new NavAgent({ radius, maxSpeed, acceleration, turnRate })
agent.place(x, z, heading)
agent.passRadius = passRadius        // see below
agent.setPath(field.findPath(agent, destination, agent.passRadius))

// Per frame, for bodies that are travelling.
agent.update(delta, field, neighbours)   // neighbours: {x, z, radius}[]
holder.position.set(agent.x, floorY, agent.z)
actor.setGroundSpeed(agent.speed)
```

Four things worth knowing before you wire it up, each of which cost a day here:

- **`radius` and `passRadius` are different quantities.** Two people occupy
  space that genuinely cannot overlap; a person and a desk overlap constantly,
  because the desk's footprint is an axis-aligned box around a mesh that is
  narrower than its bounds. Hold furniture to the full shoulder half-width and
  aisles a person would walk down without noticing become impassable.
  `field.connectedRadius(points, max, min)` returns the widest radius at which
  a given set of places still share one walkable region; the office asks for
  that at load and uses it as `passRadius`, keeping the full `radius` for
  body-to-body separation.
- **Check what `findPath` actually returns.** When a destination is walled off
  it answers with the closest reachable point rather than nothing, which is the
  right answer for a body that has to go somewhere but the wrong basis for
  committing to a destination. If the errand has a facing or a purpose attached
  to arrival, test that the last point of the route is near the point you asked
  for before committing to it.
- **Have a stall watchdog.** A valid path is not a guarantee of progress: two
  bodies can meet in an aisle wide enough for one, each yield into the other's
  next waypoint, and hold there indefinitely with neither path complete.
  Measure ground actually covered and abandon the route if it stops changing.
- **`field.debugRegions(radius)` and `field.clearanceAt(x, z)`** are the two
  calls worth exposing to a headless harness. "Walks through furniture" then
  becomes a number — clearance minus radius, sampled per frame — rather than an
  impression from one screenshot.

### `stylized-character.tsx` — portrait and celebration

**Converted.** Previously a few hundred lines of per-frame trigonometry with a
`professional-wave` idle, which is the animation the owner was looking at when
they called it a mannequin.

The throttle that blocked this is resolved rather than worked around. The
surface used to run its whole frame at 20–31 fps; animation stepping and
painting are now separate concerns. Actors step every frame at full rate, so
crossfade easing and gesture timing always get 60 samples a second, while the
canvas repaint stays throttled — except while `actor.isTransitioning` or
`actor.isPlayingGesture` is true, when it goes to full rate for the duration.
Static cards therefore cost what they always did and moving ones are smooth.

Runs at `medium` LOD: the feet are usually out of frame so foot IK is skipped,
but joint clamping stays on, because an elbow through a jacket is visible at any
size. Renders at scale 1. Gaze, blink and the contact shadow are still driven
outside the rig — they are not joints — and layer on top of the actor's pose.

### The office client / hero counsel

**Converted**, with one constraint worth knowing before you touch it. The
client's visible arms are *not* its own: the standing rig's long arm chain looked
detached folded into a chair, so both shoulders are hidden and a purpose-built
seated arm silhouette is parented to the station instead. Those arms do not
follow the torso, so any beat that swings a shoulder tears them off the body.

That is what the `seatedGuest` behaviour role is for: `seatedIdle` only, with a
filler repertoire of head and torso beats and nothing in it that moves an arm.
`seatedType` is deliberately excluded despite being the obvious second state for
someone at a desk. If the arms are ever rebuilt as real rig limbs, switch the
role to `client` and the fuller repertoire comes back for free.

Runs at `medium` LOD; the seated clips carry `grounded: 0` so foot planting is
off regardless, and `medium` also skips the world-matrix rebuilds it would need.

`folder` and `mug` are still driven by hand, on a slow period of their own that
shares no factor with any clip's. The actor does not know props exist, and a
folder that twitched in time with its owner's breathing would look worse than
two rhythms that read as independent.

### `map-three-scene.tsx` — pedestrians and the map counsel

**Not converted.** This file is owned by another worker and nothing here has
been applied to it. Everything the conversion needs is exported and in use by
two other surfaces, so it is an integration rather than a build.

The whole API surface, for a walking body:

```ts
import {
  HumanoidActor, HumanoidBehaviorDirector, assignHumanoidLod,
  type BehaviorRole, type HumanoidState,
} from './rig'

// once
const director = new HumanoidBehaviorDirector()

// per pedestrian, after the rig is parented and its matrix is fresh
holder.add(rig.root); scene.add(holder); holder.updateWorldMatrix(true, true)
const actor = new HumanoidActor(rig, { seed, state: 'walk', reduced })
director.add(actor, 'reception', seed)

// per frame, after the pedestrian has been moved for this frame
director.update(delta)
assignHumanoidLod(actors, camera, { fullBudget: 2, mediumBudget: 6 })
actor.setGroundSpeed(distanceMovedThisFrame / delta)
actor.update(delta)

// teardown
actor.dispose()
```

Points specific to a map, as opposed to a room:

- **The clip library is shared and needs nothing added.** `walk` time-scales
  itself from `setGroundSpeed`, so a crowd at different speeds needs one clip
  and no per-agent tuning. Standing states worth having in a street scene are
  `idle`, `idleRelaxed`, `idleAlert`, `idleWeightShift`, and `confer` for two
  bodies stopped together.
- **The existing pathfinder can stay.** Nothing in `HumanoidActor` requires
  `NavAgent`; the contract is one number per frame. The single hard requirement
  is rule 3 above — `setGroundSpeed` must be the speed the body genuinely
  covered, derived from its own position delta. A follower that lerps between
  waypoints and reports a nominal speed will skate, and the skate will be
  blamed on the clip.
- **`holder.position.y` is the floor.** For terrain that is not flat, move the
  holder to the ground height under the body; the actor plants feet relative to
  its holder, not to y=0.
- **Budget.** A pedestrian is not a portrait. `assignHumanoidLod` with a small
  `fullBudget` keeps foot IK on the two or three bodies nearest the camera and
  gives everyone else clip playback plus joint clamping, which is where almost
  all of the cost is. `frozen` holds a pose for nothing at all.
- **`prefers-reduced-motion`** is per-actor via the `reduced` option; pass the
  media query result rather than gating the update loop, so a reduced-motion
  viewer still gets a correctly posed body rather than a bind pose.

Behaviour roles are posture repertoires, not job titles, and the existing set
is `deskWork | reception | investigation | diplomatic | client | seatedGuest |
portrait | portraitHero`. There is no street-specific role: use `reception`,
which is the one purely upright repertoire with no prop constraint on the
hands. Do **not** give a walking body `deskWork` or either seated role — their
filler beats include sitting down, and the body will do exactly that in the
middle of a street. If the map wants its own repertoire later, a role is three
table entries in `humanoid-behavior.ts` (`REPERTOIRE`, `FILLERS`,
`SIGNATURES`) and no change to any clip.
