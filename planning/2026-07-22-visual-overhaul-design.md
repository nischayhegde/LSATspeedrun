# Visual Overhaul 2.0 — "Premium Storybook Vector"

Date: 2026-07-22 · Scope: frontend only (no game-balance/backend changes; a separate agent owns balancing)

## Problem

The game's art is CSS-pixel-art built from stacked `<i>` elements: characters read as neckless
bobbleheads, the empire map floats office towers in outer space, text bottoms out at 8–10px
Courier New, and scenes are fuzzy blocks under `image-rendering: pixelated`.

## Direction

Flat-vector illustrated SVG with cel shading and warm cinematic lighting — the world of a
prestige law firm (walnut, brass, marble, navy tailoring) rather than an arcade. One parametric
art system drives every scene so the whole game reads as one hand.

### Tokens

- Palette: ink `#182027`, navy `#102735`, walnut `#6b4630`, brass `#c89b4b` / highlight `#e8c87c`,
  night `#0d1526→#1c2c47`, ocean `#0e3a58→#17557d`, space `#060a18` with starlight `#dfe9ff`.
- Type: display **Fraunces** (600–900) for headings/cutscenes; body stays Inter;
  HUD labels **Archivo** 650–800 caps with 0.12em tracking. `--font-pixel` is redefined to the
  Archivo stack so ~100 existing HUD usages upgrade at once. Minimum UI text floor raised to ~11.5px.
- Signature: the redrawn cast — fashion-illustration humans (~7.5 heads tall, necks, tailored
  tier outfits) — and the five-biome empire map.

## Components (new `src/art/`)

1. `palette.ts` — shared colors, skin/hair/suit ramps, per-tier outfit table.
2. `people.tsx` — `Person` (full body; front/back/profile views, CSS walk cycle on limb groups,
   tier outfits, 7 variants, 11 accessories, moods) and `Bust` (head-and-shoulders portrait with
   real facial features for clients/judge/rival owners).
3. `structures.tsx` — tier buildings 0–14, rival HQs by architecture family, **flagship ships**
   (world-map firms sail; tiers 7–9 + rivals 7–9), **space stations** (orbital ring t12, lunar
   embassy dome t13, justice-nexus constellation t14 + space rivals) so nothing "floats in space"
   unexplained.
4. `office.tsx` — layered office room SVG that transforms by tier (shack planks → paneled
   walnut → marble → glass → orbital ring window), detailed furniture, window skyline with
   weather/daylight, upgrade set-pieces, ambient motes, the cat.
5. `art.css` — all new styles + walk/idle/bob/twinkle animations (all behind
   `prefers-reduced-motion`) + legibility overrides.

`game-art.tsx` is rewritten to use these but keeps its exported API
(`OfficeScene`, `ExplorableOffice`, `EmpireWorldMap`, `ClientPortrait`, `JudgePortrait`,
`CutsceneArtwork`, `PixelAssetArtwork`, `MiniAvatar`) so pages/components barely change.

## Map redesign

Five biomes, each a full SVG panorama; sites stay as HTML buttons above the art:

- **City** (t0–4): morning street grid, park, courthouse, fountain; era-styled buildings.
- **Nation** (t5–6): dusk coastline, harbor cranes, bridge, rail.
- **World** (t7–9): open-ocean panorama — firms as flagship vessels on shipping-lane arcs.
- **Continent** (t10–11): aerial coast campus + the Oceanic Citadel floating offshore.
- **Beyond Earth** (t12–14): starfield with Earth limb and Moon; ring station, lunar dome,
  crystalline nexus; shuttle traffic. Terrain fits the viewport (no dead 1800px scroll plane).

## UI bugs fixed alongside

- `FirmPage` reads its tab from `window.location.search` once → switch to `useSearchParams`.
- Office greeting says "Evening" from noon → Morning/Afternoon/Evening.
- Walker movement uses a 90ms linear snap → smoother eased step.
- 8–10px text raised to a legible floor; `--muted` contrast bumped.
- `image-rendering: pixelated` removed from vector scenes.

## Out of scope

Backend, game data, balancing numbers, question flow logic.
