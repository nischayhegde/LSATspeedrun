> **BEFORE YOU MEASURE: restart the dev server, and take your control in the
> same session on the untouched tree.** An unmodified tree reads .0021 on a
> fresh server and .0109 on one that has hot-reloaded, and two cold servers can
> disagree the same way. Replicates within one server lifetime agree to four
> digits and are not evidence of anything on their own. `lib.mjs` prints a HOT
> SERVER warning when it can tell. Full write-up at the top of
> `.map-generator-notes.md`.

# Map scene handoff

Files I modified, relative to HEAD (nothing else):

- `frontend/src/art/map-three-scene.tsx`
- `frontend/src/art/map-urban-plan.ts`

Note that `map-three-scene.tsx` also carries the **previous** agent's uncommitted
river/canal/guard work, which I inherited and did not revert. `mine-vs-HEAD.patch`
is therefore both agents' changes combined; my own edits are the four described
below.

Harness changes (all in `.maps/`, outside the app):
`collide.mjs` (extended), `footway-audit.mjs` (new), `retainer.mjs` (new).

---

## 1. The finding that matters: the collision harness was blind to buildings

`.maps/collide.mjs` built its static-collision grid with:

```js
if (child.isInstancedMesh || child.isSkinnedMesh) return
```

and `renderPlannedBuildings` puts every planned building through
`buildFacadeGroup`, which returns a group of `InstancedMesh`. **Every planned
building in every region was excluded from the only test that measured walkers
inside buildings.**

This retroactively explains the result that shut down the previous attempt: the
`keepRecordsClear` / building-clearance arm "agreed with its control to the last
digit" because the only thing it moves is planned buildings, and the metric
could not see them. That was a false negative, not a null result. **The
hypothesis was never actually tested.** Do not treat it as ruled out.

`collide.mjs` now collects the facade batches as oriented boxes (exact, not
AABB — buildings carry an arbitrary `rotationY`) and reports:

- `walkerFacadeShare` — walkers inside planned buildings (new)
- `walkerStaticShare` — unchanged definition, so old baselines stay comparable
- `walkerAnyShare` — the honest headline

Verified non-perturbing: on the Old Quarter the extended harness reproduced the
recorded `walkerStaticShare` of `0.0874` and `wrongSideFrames` of `12` exactly.

### True baselines nobody had

| | Old Quarter | The Circuit | Sovereign Arc |
|---|---|---|---|
| in planned buildings | 20.5% | 22.1% | 23.8% |
| in other static | 8.7% | 21.3% | 7.1% |
| **in any solid** | **27.9%** | **42.2%** | **30.9%** |

The previously reported 8.74% / 20.6% were roughly a third of the real figure.
On the Old Quarter at least one walker was inside a building in **551 of 600
frames**, which is why the user kept seeing it.

## 2. Root cause, found arithmetically not by search

`blocksFromGrid` in `map-urban-plan.ts` inset each block by **half the
carriageway**:

```js
const minX = west.position + STREET_WIDTH[west.streetClass] / 2
```

Its own docstring claimed this put "the carriageway genuinely between blocks".
It did — but not the pavement. `recordStreetNetwork` centres the footway at
`width/2 + KERB_TO_PAVEMENT (.28)` with `STREET_PAVEMENT_HALF (.09)` either
side, so the entire walkable band sits between **.19 and .37 inside the block**
that the buildings then fill. Every grid pavement in the game ran through the
frontages beside it, and a walker bound to its polyline had no way out.

This is the footway-routing-layer cause the brief predicted, though the fix is
at the plot line rather than in the polyline.

## 3. What I changed

1. `map-urban-plan.ts`: added `STREET_VERGE` / `streetHalfPaved()`, and
   `blocksFromGrid` now insets by half the *paved* width. Alleys have no kerb
   so their verge is 0.
2. `map-three-scene.tsx`: the drawn apron now uses `streetHalfPaved()` too
   (numerically identical to the old `width + .74`) so paving and plot line
   cannot drift apart.
3. `map-three-scene.tsx`: `claim()` in the Old Quarter takes an optional
   footprint, and the courthouse is now scaled and offset to the plot it gets.
   See "negative results" below — this was needed.
4. `map-three-scene.tsx`: `blocksFromGrid(..., { verge: false })` for The
   Circuit's villages only, keeping the old plot line there. See below.

### Measured result, 600 deterministic frames

| | Old Quarter | Sovereign Arc | The Circuit |
|---|---|---|---|
| in planned buildings | 20.5% → **3.4%** | 23.8% → **14.7%** | unchanged |
| in other static | 8.7% → **8.7%** | 7.1% → **7.1%** | unchanged |
| **in any solid** | 27.9% → **10.8%** | 30.9% → **21.9%** | unchanged |
| vehicles wrong-side frames | 12 → **12** | 54 → **41** | unchanged |
| vehicle solid/frame | 2.293 → **2.112** | 2.682 → 2.815 | unchanged |

Neither headline metric regressed anywhere. The Circuit is byte-identical to
before.

## 4. Negative results — please don't re-derive these

- **`keepRecordsClear` was never actually tested.** The metric could not see its
  effect. Worth re-running now that the harness can.
- **The prop-clearance pass genuinely does make walkers worse** (8.74% → 9.47%,
  20.6% → 29.2%). That result stands; it was measured against non-instanced
  geometry, which the harness always could see.
- **The authored props were largely a red herring.** The worst-site list that
  named a cafe, a farmstead and court benches was the visible tip of a much
  larger unmeasured population. The tall unattributed entries (`top` 4.12, 4.49)
  were never props at all.
- **Civic set-pieces are fragile against lattice changes.** `claim()` takes the
  nearest unclaimed ward block with no size check, and `createCourthouse` is a
  fixed 5.2 × 3.5. Shrinking blocks changed which blocks qualified as ward
  blocks, the courthouse was re-homed onto a narrower one, and its wings stood
  in the pavements — **505 of 600 frames on its own**, which showed up as
  `walkerStaticShare` 8.74% → 14.48%. Fixing the fit restored it to 8.74%
  exactly. Any future change to the block lattice will hit this class of bug.
- **The Circuit's villages regress under the same correction**: 42.2% → 51.2%.
  Diffuse, not one object — the farmstead, halt shelter and milestones stayed
  put while everything around them stepped back, and the crowd's obstacle set
  (which decides where in a pavement a walker actually stands) shifted
  underneath them. The villages need their authored props re-sited before they
  can take the corrected plot line. This is the main outstanding piece of
  pedestrian work.

## 5. Retainer visibility — partly done, NOT verified

Confirmed by reading, not yet at runtime:

- `landmarkRing` (hover) and `selectionRing` (selection) both exist and fire.
  They are thin outlines at a point, not an area tint. That is probably what the
  user half-remembers.
- The upstream memoisation in `unified-empire-map.tsx` **is** correct — it keys
  a `useMemo` off a sorted joined string, so a `game` refetch does not rebuild
  the world.
- **But buying a retainer does rebuild the entire 3D world.** `ownedLandmarks`
  changes identity on purchase and sits in the effect dependency array at
  `map-three-scene.tsx` ~9196. Confirmed by reading; worth fixing, and the fix
  may belong in `unified-empire-map.tsx`, which another agent holds.

Shipped but unverified on screen: `createRegionWash()`, a depth-tested
transparent ground disc at `WASH_Y = .095` (above all paving, below any
building). Used twice — a persistent teal `0x6cae98` wash inside
`createHeldLandmarkAccent` for owned districts, and a hover/focus wash in
`0x8fd3c4` driven by `setHoveredLandmark` and `travelToLandmark`.

Deliberately depth-tested at the default render order, unlike the rings beside
it which use `depthTest: false` at renderOrder 40-44. That is the
`labelSprite.renderOrder = 70` trap: a depth-tested overlay at order 0 cannot
reach a label. **This reasoning has not been confirmed on screen — please
screenshot it before trusting it.**

**`ownedLandmarks` populated end-to-end is still unconfirmed.** `.maps/retainer.mjs`
does this: reads `GET /v1/game`, secures an available city district through the
real `POST /v1/game/territory`, reloads, then counts `heldLandmarkAccent` groups
and reports every label's `renderOrder`. One bug fixed but not re-run: the
response is `{ game, pending_reviews }`, so territory is at `body.game.territory`.
The script is correct now; it has simply never completed a run.

## 6. Not started

- Diegetic pedestrian/vehicle spawn and despawn (brief item 6).
- Runtime verification of The Circuit's and the Arc's water and bridge soffits.
- Guard NPC and held-vs-unheld rival building screenshots.

## 7. Environment

The machine was at load average 36 with under 1% idle for this whole session.
Three separate Playwright runs died mid-flight — a browser OOM, a region click
timeout, and a page close. `collide.mjs` now flushes its report after every
region rather than once at the end, so a late failure no longer discards
earlier regions.

All numbers here come from SwiftShader, which is **not a real-GPU test**. They
are simulation-side collision counts, which do not depend on rasterisation, so
they should hold — but nothing about appearance or performance here is a GPU
result.
