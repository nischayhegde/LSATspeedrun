# Cloud sweep brief

The user's framing: the cloud run is meant to **wrap up the app**. Everything is
gone through, verified, optimised, and finished. Local work has stopped and been
merged so this can start from one branch.

Start from `integration/all-features`, NOT `main`. That branch is ~125 commits
ahead of `origin/main` and carries months of work. An agent starting from `main`
would "fix" a great deal that is already fixed.

---

## Priority 0. The office window view

The user's words: it "doesn't seem realistic and optimized enough with the 3d
theme", and they want "more of a cool outlook into the rest of the city",
incredibly optimised.

- `frontend/src/art/office-window-view.ts` builds the backdrop from flat-shaded
  masses reflecting the firm's current district.
- Already rebuilt once. The first version rendered dim from a flawed tonal
  premise; the rebuild brightened palettes, restored a sky-brightest value order,
  fixed a coverage bug, made elevation rise with tier, and scaled to the frame.
- A moot-court panel used to be mounted inside the glazing, hiding a fifth of the
  opening. It was moved to clear wall. Do not put anything back over the glass.
- COUPLING, do not break: the office light rig derives its hemisphere colour, key
  colour and direction, and both rect-area fills from the same daylight and sun
  vector the window view is built from. `buildOfficeWindowView` returns the sun
  direction in room space.
- Constraints: the office is heavily batched (room 976 to 477 draw calls, cast 58
  to 6.8 per body). Do not break batching or add shader permutations. Measure
  draw calls, triangles and first-frame time both sides.

## Priority 1. Whole-app wrap-up

The user's own list:

- **UI/UX verified across the app**, then optimised further.
- **Add more WebGL/three.js or other high-yield elements** where they genuinely
  help. Judgement required: this app already carries heavy 3D and a long history
  of performance regressions. Tasteful motion and better information design often
  beat a canvas. Anything added must be measured.
- **A full, comprehensive mobile pass.** Every feature present and usable on a
  phone, including Focus Mode.
- **Office and Firm tab interactions**: streamline the UI/UX further, make it more
  aesthetic, and add depth to the interactions where it earns its keep.
- **Maps tabs verified.**
- **A real QA session** across the app.
- **Tutorial rewritten to go in depth** on: Firm tab interactions, how strategy
  implementation works on questions, and a full mock exam introduction.
- **Any remaining major technical problems, especially performance.**

## Priority 1a. Responsiveness and mobile, stated twice by the user

**Every viewport, no awkwardness.** The site must look genuinely aesthetic and
fully responsive at any width, not merely functional at three tested
breakpoints. Go and look at the in-between widths, which is where this app has
repeatedly broken: the account menu was pushed off-screen at narrow desktop, the
nav overlapped at 1120px, a client portrait sat 86px wide in a 68px column with
its caption lying across the text beside it, and a header badge wrapped. Each was
found by looking, none by reasoning. Check the awkward middle sizes, tablets,
landscape phones, and very wide monitors.

**The mobile app must carry every new feature.** There is an Expo app under
`mobile/`. Establish first whether it wraps the web app in a WebView or
implements surfaces natively, because that determines whether new features arrive
for free or must be built. Either way, verify rather than assume, including Focus
Mode, which the user has called out before.

## Priority 1b. Documentation, explicitly requested

- **A mermaid diagram** describing the paradigm of how the app works and how
  routing works. It should be genuinely useful to someone new, not decorative.
  Routing is non-trivial here: routes were split out of a single large module
  into per-route chunks, stylesheets are split per route and injected after the
  entry sheet, and routes were deliberately de-suspended so an already-loaded
  module renders directly instead of flashing a fallback. A diagram that misses
  that misses the interesting part.
- **A markdown file describing the app and its functions in detail.** Cover the
  game loop and how it connects to the study mechanics: cases, clients, the firm
  and its tiers, districts and standing counsel, connections, the office and its
  two floors, the maps, strategy enforcement and the per-section recommendation
  system, mock exams, projected score, spaced review, and Focus Mode.
- **Fully update `README.md`.** It is stale, still opens with "LSAT Tycoon"
  against the current "Lawyer Tycoon" branding, and does not describe what the
  app has become.

## Priority 1c. Refactoring and de-bloating, explicitly requested

The user wants the codebase cleanly refactored and stripped of bloat, and the app
"fully ready for production" at the end of this run.

Refactoring here must be BEHAVIOUR-PRESERVING and verified as such. This app has
a long history of confident changes that turned out to alter behaviour, so a
refactor that cannot be shown to preserve behaviour is a liability. Use the test
suite (376 backend tests), typecheck, build, and screenshots of affected surfaces.

Do not redo work already done, and read before assuming:

- `pages.tsx` was already deleted and split into ten route modules.
- CSS is already split per route: 153 dead selectors and 15.7 kB removed,
  `mobile.css` split into eight route sheets, entry sheet down from 70.0 to
  48.5 kB gzip.
- The main JS bundle went 550.9 to 328.8 kB, and React was split from the entry
  chunk. Critical-path bytes went 633 kB to 293 kB.
- 3D scenes are heavily batched and geometry is cached. Do not undo this in the
  name of tidiness.

Where bloat plausibly remains, though verify rather than trust this list: very
large single modules, particularly the map scene builder and the office scene;
duplicated logic between the office, firm and map surfaces; unused dependencies;
dead backend code paths; and repeated patterns across the ten route modules that
have drifted apart. There are also many QA harnesses under `tools/`, which are
deliberately kept, but they may contain genuine duplication worth consolidating.

Judgement: a refactor that makes the code prettier while adding risk to a
production deploy is a bad trade this late. Prefer removing what is provably
unused, consolidating what is provably duplicated, and leaving working code that
is merely inelegant. Say what you chose not to touch and why.

## Priority 1d. Responsiveness at every viewport, and the mobile app

The user: the site should look "incredibly aesthetic" with "0 awkwardness at any
viewport", fully responsive. Not just phone and desktop, but the awkward widths
in between, and landscape.

Known history, so this is not started from nothing: a nav overflow at ≤1120px
was fixed by restructuring the header, an account menu overflowed at narrow
desktop widths, a badge wrapped until it was given nowrap, a client portrait was
86px in a 68px column because `art.css` won the cascade, and a class of landscape
thumb-target bugs was fixed in an earlier mobile pass. That pattern, a fix that
works at 390 and 1440 while breaking at 1180, is the one to hunt.

The user has pre-approved a specific remedy: **if nav overflow is still bad at
any width, use a hamburger menu for desktop responsiveness.** Take that as
authorised rather than asking. Note the nav has already been through two rounds
of this: desktop items were consolidated into an account dropdown to clear
overflow, then the Focus control was pulled back out into the nav strip because
demoting it to that dropdown made it undiscoverable. So a hamburger must not hide
the controls people reach for constantly, in particular Focus.

Separately there is a real mobile app in `mobile/`, an Expo client, distinct from
the responsive web layout. The user wants EVERY new feature reflected there, and
has asked for this several times. Check it honestly rather than assuming the web
responsive pass covers it: strategy enforcement, blind review, the whiteboard,
Focus Mode, the live ledger, the office earnings readout, meta litigation, the
progress and projection surfaces, and the firm tab's counsel and connections
work all landed after earlier mobile passes.

## Priority 1e. The 3D scenes and human animation, held to the highest standard

The user singles this out: 3D scenes and human animation must be "incredibly
dynamic, aesthetically stunning, very realistic". They have explicitly said the
agents may take as much time as needed to do this properly.

What already exists, so you improve rather than restart:

- Characters are a skeletal rig, converted from procedural drivers specifically
  to fix stiffness. There is a weight engine with smootherstep crossfades.
- The office has four seated idle clips (writing, typing, reading, sorting
  papers) and walking NPCs were deliberately REMOVED, because the user judged
  robust walking unfixable across every layout and preferred natural seated
  behaviour. Do not reintroduce walking staff without asking.
- Seated leg IK plants feet; a compounding pelvis bug that made characters float
  was fixed to 9 mm worst case.
- Portraits have four idle states and eleven gestures. A `prefers-reduced-motion`
  bug that froze the gesture clock at t=0, making every one-shot gesture
  invisible, was fixed by freezing at t=.5s instead.
- Map crowds use the same seeded character models as the office.
- The whole look is an illustrated style via `IllustratedRenderPass`, referenced
  from `abeto.co`, tuned differently for maps, office and portraits. Keep it.
- Cast and room are batched hard: 58 to 6.8 draws per body, room 976 to 477.

The user has repeatedly reported animation as "snappy", "jittery" or "not fluid",
and several fixes were reported as landed while they still saw the problem. Some
of that was stale browser state, but not all. Judge by watching the app, at
several tiers and on several maps, not by reading the code. Where motion is still
mechanical, fix the motion rather than the report.

## Priority 2. Office roofs missing at high tiers

User reported some offices appear to have no roof, including higher tiers.
Verify it is real, work out whether it follows from how tiers are built, and fix
it for high-tier firms. Note the maxed office seats 30 staff across a Practice
Floor and a Chambers floor with a UI switch, so a roof may be deliberately
omitted on one floor for camera clearance, or genuinely absent from tier
geometry. Those have different fixes.

## Priority 3. Smaller known items

- `README.md` still says "LSAT Tycoon". The app is "Lawyer Tycoon" everywhere
  else, including the deploy script's health check.
- Firm tab Staff panel scrolls at ~33ms median against 16.7ms on Districts.
  Fourteen animated three.js figures keep running off-screen. Predates recent work.
- `retainer` to `counsel` data migration. The UI now says "standing counsel" for
  districts and reserves "retainer" for clients, but the stored
  `district["retainer"]` field and `district_retainer` ledger event keep the old
  name. No player sees either.
- Twelve of 38 districts (all of Treaty Sea and Global Compact) have no map
  landmark, so no pin, camera flight, district brief or contact figure. Five of 14
  connections open only those districts. Needs twelve landmark entries authored in
  the scene planner and joined to the district catalog, the same work already done
  for the other three regions.

## Maps: decisions the user has already made

**1. Fix the walker beam. This is the top map task.** `WALKER_HALF_BEAM` is .16
while the drawn walker's half-beam is .23 to .26, so every setback in every map
reserves ground for a person two thirds the real width. The mechanism is
confirmed: The Circuit's worst site is way 35, narrowed to a .05 half-width,
running .15 m from a farmhouse, walked by a .25 body. The change is about four
characters plus a comment. It was written and reverted unproven when the local
worker was stopped, so it needs measuring, roughly twenty minutes. It is the
cheapest large win available and may unstick some of the nine Old Quarter
parcels for free.

**2. Halve the crowd scale. The user has decided this.** The crowd is currently
drawn at roughly twice the architecture's scale: walkers 1.6 tall against a
storey of .74, a shop door of .82, and a parade canopy at .96 on .94 posts. The
user chose to shrink the people rather than raise the buildings. Expect this to
interact with the beam fix, since a smaller walker needs less clearance, so
measure them as separate arms rather than together, and re-derive the beam from
the final drawn body rather than assuming the .23 to .26 figure still holds.
Check it visually as well as numerically: characters must still read properly in
the map cameras players actually use, and this affects every district.

## Maps: inherited leads

Full detail is in `.map-generator-notes.md` and `.map-crossing-notes.md`. Read
them before touching anything; several expensive dead ends are recorded with
numbers, and re-running them costs hours.

- **Measurement was broken until now.** The harness armed its synthetic clock at
  `realNow() - 10000`, so frame deltas rounded differently in every server
  lifetime and the crowd made different decisions. Fixed. Correct baselines are
  Old Quarter .0109, The Circuit .0086, Sovereign Arc .0219. The .0021 quoted
  throughout the older notes was the other mode of a coin flip, so historical
  comparisons there are not trustworthy.
- **One object holds most of the Old Quarter's hits**: 119 of 147 at an unnamed
  instanced object at (-32, 40), past the built edge, not a tree, probably an
  instanced cottage in an outlying hamlet.
- **Sovereign Arc**: three unnamed sites hold 176 of 217 hits; separately, 204 of
  209 classified tram contacts are walkers on way 67 of street 8, a pavement
  running ALONG the tram alignment for 2.8 m. Siting fault, not crossing timing.
- **Nine Old Quarter parcels are unsitable**, blocked by the ward lanes rather
  than the avenues. Narrowing the headquarters was authorised, tried three ways,
  and lost every time. Mechanism: a wide building blocks its pavement outright so
  nobody walks there, while a narrow one on a stuck parcel leaves a walkable
  sliver the crowd brushes. Any fix that leaves a sliver measures worse.
- **The Circuit's banked "zero vehicle contacts" was false.**
- **Street furniture**, move-the-paving-not-the-prop, was never attempted.

## How this work comes back, which shapes how you commit

The user's intended path for everything produced here:

1. Cloud agents make their changes in their own environments, on their own branches.
2. The user merges those branches into their **local** repository and tests there.
3. From local, the work goes to `main` on `nischayhegde/LSATspeedrun`, and to the
   user's own fork.
4. Deployment follows from there, via `deploy-sandbox.ps1`.

What that means for you, concretely:

- **Push your branch.** Work that only exists in your workspace is useless to
  this pipeline. Commit incrementally and push, do not hold everything to the end.
- **Keep the branch mergeable.** Base off `integration/all-features`, and if other
  cloud agents are running in adjacent areas, stay inside your declared ownership
  so the branches do not fight. A merge in this repository has already silently
  dropped a feature by resolving in favour of one side.
- **Write merge instructions in your final report**: your branch name and head
  commit, which files you touched, anything you expect to conflict, and what the
  user should verify locally after merging. They are testing by hand, so tell
  them what to look at and what "working" looks like.
- **Do not push to `main` and do not deploy.** `main` is what CloudFormation
  builds and deploys from, and that step is the user's.
- **The repository is PUBLIC.** Never commit databases, `.env` files, credentials,
  tokens or personal data. A push was stopped tonight because a merge carried a
  47 MB dev database containing 195 user rows and 3,139 auth sessions. Check what
  you are committing, especially anything binary or large.
- Note `deploy-sandbox.ps1` runs `git add --all`, so scratch left in the tree can
  be swept into a release. There is now a guard that fails the deploy on more than
  25 MB of new files, but do not rely on it.

## What "finished" means here

The user's words: by the end of this run there should be **no doubt the app is
completely finished**. That is a claim about evidence, not effort. Treat it that
way.

Do not report an item as done unless you can point at something that would have
caught it being wrong. A screenshot of the surface, a before-and-after number
with the method stated, a test that fails without the change. "Implemented and
verified" with nothing behind it is what has repeatedly turned out to be false
in this project.

Four claims of completion made in the last day were false, and each was caught
by someone measuring rather than trusting:

- The Circuit's "zero vehicle contacts" was never replicated. It was 17, 0, 15.
- The map baseline everyone quoted, .0021, was one side of a coin flip caused by
  a clock-origin bug, and separately the audit was testing districts against
  differently sized walkers, one of them 18 cm tall.
- The office window view was "rebuilt" on a flawed tonal premise and rendered dim.
- A careful firm-tab audit missed a third meaning of "retainer" sitting in seven
  upgrade descriptions, and undersold a bug on the office wall.

So: prefer a documented negative result to an unproven fix. Several of tonight's
most valuable outputs were hypotheses killed with numbers, because they stopped
later sessions repeating them. Say plainly when a difference sits inside the
noise. Revert anything unproven rather than leaving it in the tree.

At the end, produce an honest close-out: what is done with its evidence, what was
attempted and rejected with the numbers, and what remains with an estimate. If
something cannot be finished, saying so precisely is worth more than a claim that
does not survive the user opening the app.

## Standards this project has paid for

- Measure, do not assert. Several confident claims this week were wrong, and the
  agents that caught themselves produced the most value.
- Restart the dev server, take the control in the same lifetime, never compare
  across lifetimes. A probe printing no region line has measured nothing.
- Never reintroduce `mix-blend-mode` or `backdrop-filter` over a full viewport or
  a WebGL canvas. Both destroyed scroll performance and were removed with proof.
- Grain is applied before quantisation, acting as dithering. Reversing it caused
  visible wall banding.
- Route stylesheets are split and injected after the entry sheet. Do not undo it.
- Office capacity is settled: 30 staff across two floors, never 30 in one scene.
- The economy is tuned so 3 to 6 cases equal one upgrade, roughly 1 to 2 hours of
  play. Do not add case sources or payouts without re-measuring it.
- Commit incrementally. Uncommitted work has been lost repeatedly.
