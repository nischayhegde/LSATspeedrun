# `app-art` is a downstream copy of `frontend/src/art/`

**Never edit these files to make them better.** They are a port, not a fork. The
deck exists to show the real game's art, and the moment a file here diverges in
substance from its upstream original, the deck stops being evidence of anything.
Every change belongs upstream in `frontend/src/art/`, after which this folder is
re-copied and the fix-ups below are re-applied.

## What was copied

- `frontend/src/art/**` → `deck/src/app-art/**` (including `rig/`), wholesale.
- `frontend/src/types.ts` → `deck/src/app-art/types.ts`.
- ~~`frontend/public/art/**` → `deck/public/art/**`~~ — **no longer copied, and
  do not restore it.** This was 218 files and about 18 MB of `.webp` catalog card
  art, and across a full 24-slide walk plus every presenter-only key it was
  requested exactly zero times. The reason is that the only module which builds
  those URLs is `assets.ts`, and nothing reachable from the deck's entry point
  calls the functions that do:

  - `structures.tsx` imports `tierSiteArt` and `rivalSiteArt`, and **nothing
    imports `structures.tsx`**.
  - `office-three.tsx` does import `assets.ts`, but only `clientCastSeed`, which
    is an FNV-1a hash over a name and never touches `BASE`.

  So every URL builder is tree-shaken, and a production bundle contains no `art/`
  path template at all — the only `/art` substring left in it is `/article/`,
  inside a citation URL on slide 2. There is also no `import.meta.glob`, no
  dynamic import built from a string, and no CSS `url()` anywhere in the deck
  that could reach the directory at runtime.

  The copy was never what made the demo slides work: those are iframes onto
  `demoConfig.appOrigin`, so the app serves its own art from its own origin.
  `frontend/public/art/**` is untouched and must stay that way.

Copied from the working tree at commit `0f47beb5` ("Read a wrapped pavement
round the seam in order, not backwards and then forwards"), **including
uncommitted working-tree changes** to `map-agents.ts`, `office-three.tsx` and
the then-untracked `office-room-batch.ts` — `map-agents.ts` and
`office-three.tsx` were being edited upstream while this port was being made and
were re-synced afterwards. Re-copying from a later commit is expected to be a
clean overwrite plus the fix-ups below.

To confirm the port has not drifted, diff it against upstream: the only
differences should be the ones listed here.

```sh
diff -r frontend/src/art deck/src/app-art
```

`types.ts` is already dependency-free upstream — it has no imports at all — so
it was copied verbatim with nothing trimmed.

## Fix-ups applied

### 1. Import path rewrites (11 files)

`'../types'` → `'./types'`, because the file that was one level up in the app is
a sibling here. Nothing else about those import lines changed.

`catalog-asset-render.tsx`, `map-crowd-rig.ts`, `map-three-scene.tsx`,
`office-floors.tsx`, `office-manifest.ts`, `office-three.tsx`, `office.tsx`,
`people.tsx`, `player-cosmetics.ts`, `stylized-character.tsx`,
`stylized-counsel.ts`.

### 2. Deleted from the port

- `unified-empire-map.tsx` and `unified-empire-map.css` — the app's map *UI
  wrapper* (region rail, district cards, retainer purchase). It depends on
  `../api`, `../components`, `../sound`, `../rival-war-room` and
  `../art-2d/marks`, none of which are ported, and the deck drives
  `MapThreeScene` directly from `deck/src/scenes/map-scene.tsx`. Its region↔tier
  table and its point-building logic were read and reproduced honestly in
  `deck/src/scenes/synthetic-state.ts`; if the app's regions change, that file
  is what needs updating.
- `office-earnings.css` — only `office-earnings-readout.tsx` imported it, and
  that file is now a stub.

### 3. Stubbed

- `office-earnings-readout.tsx` — replaced with a `null`-rendering component
  that keeps the module's exported shape (`OfficeReadoutTarget`,
  `OfficeEarningsReadout`), because `office-three.tsx` mounts it. The real one
  is a live hover price card wired to the API; the deck has no API and does not
  want a price card floating over the room on stage. Reason is restated at the
  top of the stub.

### 4. `@ts-expect-error` directives for `noUnusedLocals` / `noUnusedParameters`

The deck's `tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`; the
frontend's does not. So 14 declarations that are legal upstream are errors here.
Every one is dead code that upstream tolerates, and **deleting it would be
exactly the divergence this file exists to prevent** — so each site instead
carries one added comment line and the code itself is byte-identical:

```
// @ts-expect-error deck port: unused upstream, kept verbatim — see PORT.md
```

`@ts-expect-error` rather than `@ts-ignore` on purpose: if upstream starts using
one of these, the directive becomes stale and the deck's build says so (TS2578)
instead of silently swallowing a real error. Find them all with
`rg "deck port: unused upstream" deck/src/app-art`.

| File | Declaration |
| --- | --- |
| `catalog-asset-render.tsx` | `glass` |
| `map-agents.ts` | `private readonly halfWidth` |
| `map-clearance.ts` | `cellIndex` |
| `map-three-scene.tsx` | `ringFrontage` (import), `RoofForm` (type import), `createBuoy`, `createLighthouse`, `side` (parameter), `createHarborWorkboat`, `createHarborFuelDepot`, `placeWater`, `pace` |
| `office-three.tsx` | `interpolateAngle`, `catMoveDirection` |

The right long-term fix is for whoever owns `deck/tsconfig.json` to set
`"noUnusedLocals": false, "noUnusedParameters": false`, at which point all 14
lines can be deleted in one pass.

### 5. Added (not ported)

Two stylesheets the deck needs because it does not port the app's page chrome.
They contain only the rules that make each scene's canvas fill its host box,
lifted from `art.css` and `unified-empire-map.css`:

- `office-scene-host.css`
- `map-scene-host.css`

### 6. `renderer.forceContextLoss()` on the office teardown

One line added to `office-three.tsx`'s cleanup, and the only fix-up here that
changes behaviour rather than types, imports or hosting.

`renderer.dispose()` releases three.js's own GPU objects but not the WebGL
context behind the canvas; the browser reclaims that only when the canvas is
collected, which is not deterministic and in practice is late. Upstream mounts
the office once per page load, so a context that lingers until GC costs nothing
and the omission is invisible there. The deck mounts and unmounts the same
component every time the presenter moves through the demo slides, and a
rehearsal is many passes — so contexts accumulate against Chrome's per-page
limit, and when that limit is reached Chrome discards the **oldest** live
context, which is the shared stage's, created at boot.

The symptom is therefore reported against the wrong object: a navigation stress
run logged `deck: WebGL context lost — reload the deck` from `scenes/stage.ts`
while the leak was here. On stage it would mean a dead 3D background for the
rest of the talk, with no recovery but a reload.

`map-three-scene.tsx` already calls `forceContextLoss()` in its own teardown and
`scenes/map-scene.tsx` documents it as the required pattern, so this brings the
office in line with its sibling rather than inventing anything.

**This belongs upstream too** — `frontend/src/art/office-three.tsx` has the same
single-`dispose()` teardown. It is lower severity there for the reason above, but
it is the same bug, and once it is fixed upstream this fix-up can be dropped.

## What was deliberately *not* changed

`import.meta.env.DEV` is used in several files and works unchanged under Vite,
including `office-manifest.ts`'s module-load `console.error` self-check of the
staff roster. That check runs in the deck's dev server too, which is a feature:
if the roster ever goes inconsistent, the deck says so as loudly as the app does.

No reformatting, no refactors, no renames. If a diff against
`frontend/src/art/` shows anything not listed above, it is a bug.
