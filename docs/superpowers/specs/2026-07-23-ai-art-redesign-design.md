# LSAT Tycoon — AI-Generated Art & Animation Redesign

Date: 2026-07-23
Status: Approved for implementation (user directive; autonomous session)

## Goal

Replace the parametric SVG art system with stunning, semi-realistic cartoon raster art
matching `artexamples/` (realistic proportions, clean linework, painterly cel shading,
warm navy-and-gold lawyer palette), with a rich animation layer. User asked for wide
variety across characters, firms, and upgrades, and "amazing" animations.

## Approaches considered

1. **Upgrade the SVG system** — keep vectors, improve shading. Rejected: cannot reach
   the painterly fidelity of the examples.
2. **Full AI-raster pipeline (chosen)** — generate every art surface with the
   TrueFoundry gateway; animate with CSS/JS layers.
3. **Hybrid raster scenes + SVG people** — rejected: style clash between painterly
   rooms and vector characters.

## Generation pipeline

- Gateway: `https://trilogy.truefoundry.cloud/api/llm/images/generations` (keys in
  `backend/.env`, used at build time only — no runtime dependency).
- **Painted scenes** (offices, map terrains, cutscene backdrops, upgrade/connection
  cards): `gemini-3-pro-image-preview` — best style match to examples.
- **Transparent sprites** (players, staff, client busts, rival owners, judge, map
  building markers): `gpt-image-1.5` with `background: "transparent"` (verified: true
  alpha). Prompts forbid outer glow; post-process cleans stray low-alpha haze, crops,
  and exports WebP.
- Script: `scratchpad/genart.py`, parallel workers, retry + failure log, deterministic
  output names. Assets land in `frontend/public/art/<group>/<key>.webp`.

## Asset manifest (~190 images)

| Group | Count | Format |
|---|---|---|
| Office interiors, tiers 0–14 | 15 | 16:9 painted |
| Map terrains (city/nation/world/continent/space) | 5 | 16:9 painted |
| Cutscene backdrops (8 story scenes) | 8 | 16:9 painted |
| Tier building markers | 15 | transparent |
| Rival HQ markers (14 architectures) | 14 | transparent |
| Upgrade cards (every catalog upgrade) | 35 | 4:3 painted |
| Connection cards | 14 | 4:3 painted |
| Staff (every named staff member, unique design) | 30 | transparent full-body |
| Client busts (22 icon kinds) | 22 | transparent bust |
| Rival owner busts | 14 | transparent bust |
| Player: 2 genders × 6 wardrobe stages (tier-mapped) | 12 | transparent full-body |
| Judge (neutral, pleased) | 2 | transparent bust |

Variety: every staff member, client, owner, upgrade, and building gets an individually
authored prompt (distinct ethnicity/age/outfit/props/architecture/mood).

## Code changes (frontend only — backend untouched)

- `frontend/src/art/assets.ts` (new): typed path helpers, tier→stage mapping.
- Rewrite as `<img>`-based components with **unchanged exported APIs**:
  `art/people.tsx` (Person/Bust), `art/office.tsx` (OfficeRoom),
  `art/terrains.tsx` (TerrainArt), `art/structures.tsx` (SiteArt).
- `game-art.tsx`: cutscene backdrops and upgrade/connection vignettes switch to
  images; exported API to pages.tsx/components.tsx unchanged.
- `art.css`: rewritten animation system — ken-burns scene drift, pointer parallax
  (CSS vars set by React handlers), god rays, drifting dust motes, rain/star/nebula
  overlays per scene, character idle breathing + entrance pop, hover 3D tilt + gold
  sheen sweep on cards, floating map nodes with pulsing HQ beacon, cutscene letterbox
  + cast slide-in, owned/locked state effects, `prefers-reduced-motion` support.
- Old SVG figure code is deleted (git history preserves it); `palette.ts` kept only if
  still referenced.

## Interaction rules

Click-based gamification unchanged — all clickable zones/buttons keep their layout
classes (`.world-person`, `.empire-node`, `.world-zone`, labels via `.wp-label`).

## Verification

`npm run build` (typecheck), then dev servers + Playwright screenshot pass over login,
onboarding, office, firm tabs, empire map sections, and a cutscene; visual review
against `artexamples/`.
