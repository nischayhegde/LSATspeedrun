# LSAT Firm Tycoon Scene Bible

## Environment, Interaction, and Pixel-Art Requirements

**Status:** Companion specification to the LSAT Firm Tycoon PRD<br>
**Version:** 1.0<br>
**Date:** July 22, 2026<br>
**Scope:** Comprehensive scene catalog and art-production scaffold; not an implementation plan

---

## 1. Scene-system thesis

Scenes are the physical expression of progression. They should make the player feel that real learning work has transformed a borrowed desk into a functioning law firm.

The scene system is not a story campaign and not a free-roam role-playing map. It is a fast, scene-based interface in which:

- Every location has a clear product function.
- Every important upgrade produces a visible environmental change.
- Characters embody useful systems such as tutoring, scheduling, review, and analytics.
- Case flavor remains procedural and brief.
- Canonical LSAT text and reasoning controls remain accessible HTML outside the pixel renderer.
- A player can reach the next useful question within one or two actions.

### Scene promise

> Each room should answer one of three questions: What work can I do, what did I learn, or what did I build?

---

## 2. Interaction model

### 2.1 Scene-based navigation

- The player selects a visible hotspot or navigation destination.
- The avatar may walk a short automated path to the destination for charm.
- The player does not need directional controls to reach core functionality.
- Repeated destinations become directly accessible from persistent navigation.
- Scene transitions target 300–700 milliseconds after assets are cached.
- A “skip transitions” accessibility preference removes automated walking.

### 2.2 Hotspot behavior

Every hotspot has:

- A visible pixel-art object or doorway
- Hover, focus, and selected states
- A text label available to screen readers
- An equivalent action in an accessible hotspot list
- A notification marker only when action is useful
- A disabled explanation when the feature is not yet unlocked

Hotspots should not require pixel-perfect clicking. Interactive bounds should be larger than the visible sprite.

### 2.3 Scene states

Reusable scene states are:

- **Calm:** ordinary office activity
- **Recommended work:** one clear destination receives a subtle pulse
- **Case active:** current matter materials appear on desks and boards
- **Tutor required:** mentor or conference-room indicator becomes visible
- **Review due:** portfolio or appeals indicator appears
- **Reward available:** upgrade/shop indicator appears
- **Rank-up ready:** office signage and partner-door lighting change
- **Low motion:** character movement becomes static pose changes
- **Offline/fallback:** HTML navigation remains available without the scene renderer

### 2.4 Ambient movement

Ambient motion creates life without competing with reading:

- Staff walk short bounded paths.
- Screens flicker subtly.
- Printers, elevators, lamps, plants, rain, traffic, and clocks animate slowly.
- Characters stop high-motion loops when a question opens.
- No continuous camera movement during reading or reasoning.
- Celebration sequences last no more than three seconds and are skippable.

---

## 3. Visual progression tiers

The same core firm should evolve across ranks. Reusing layouts and prop families makes progression visible and keeps asset production manageable.

| Tier | Career stage | Firm condition | Visual identity |
|---|---|---|---|
| Tier 0 | Legal Intern | Borrowed corner in a shared legal-services office | Folding furniture, boxes, old monitor, fluorescent light |
| Tier 1 | Junior Associate | Small personal office and shared reception | Clean but modest furniture, first sign, daylight window |
| Tier 2 | Associate | Boutique suite with staff bullpen | Coordinated colors, library wall, meeting room, active staff |
| Tier 3 | Senior Associate | Full office floor with practice groups | Multiple rooms, better materials, skyline, specialized work areas |
| Tier 4 | Partner | Prestigious headquarters | Custom branding, boardroom, art, larger staff, refined lighting |
| Tier 5 | Managing Partner | Regional tower or flagship firm | Executive floor, city presence, portfolio gallery, expansion map |

### 3.1 Progression rules

- A rank-up changes at least one room layout, one architectural material, and one staff behavior.
- Purchases fill in the detail between rank-wide changes.
- Earlier purchased items should migrate to the upgraded office when sensible.
- Players can retain a preferred lower-tier visual theme after unlocking higher tiers.
- Rank does not determine educational mastery; it represents accumulated product progression.

---

## 4. Master scene catalog

| ID | Scene | Primary function | Educational role | Earliest tier | Priority |
|---|---|---|---|---:|---|
| S01 | Shared Office / Starter Desk | Home hub | Shows next useful learning action | 0 | MVP |
| S02 | Reception and Docket Board | Choose cases | Curated adaptive practice choices | 0 | MVP |
| S03 | Client Intake Room | Preview short cases | Establishes learning objective and case contract | 0 | Beta |
| S04 | Universal Case Workspace | Answer questions | Canonical question and reasoning loop | 0 | MVP |
| S05 | Mentor Conference | Step-based tutoring | Guided reasoning and repair | 0 | MVP state |
| S06 | Case Resolution Table | Complete cases | Learning summary before rewards | 0 | MVP |
| S07 | Firm Shop / Design Studio | Buy upgrades | Converts learning rewards into visible progress | 0 | MVP |
| S08 | Research Library | Explore skills and explanations | Deep review and concept reference | 1 | Beta |
| S09 | Investigation Lab | Logical Reasoning case skin | Argument structure and trap analysis | 1 | Beta |
| S10 | Due Diligence Deal Room | Reading Comprehension case skin | Passage mapping and viewpoint analysis | 1 | Beta |
| S11 | Appeals Chamber | Spaced review | Repair and recover prior misses | 1 | Beta |
| S12 | Skills Academy | Diagnostic and mastery checks | Measures guided-to-independent transfer | 1 | Beta |
| S13 | Staff Bullpen | View and assign staff | Makes learning supports legible | 2 | Beta |
| S14 | Hiring and Interview Room | Recruit staff | Unlocks workflow and tutor styles | 2 | Beta |
| S15 | Operations Office | Manage workload | Weekly target, case capacity, review schedule | 2 | Beta |
| S16 | Practice Group Hall | Allocate specialization | Organizes balanced skill development | 2 | Later |
| S17 | Mock Courtroom | Optional timed hearings | Accuracy-under-time transfer | 2 | Later |
| S18 | Portfolio Gallery | Review achievements and cases | Historical reasoning and recovery evidence | 2 | Beta |
| S19 | Records Room | Search detailed history | Filters attempts, briefs, tutor turns, and content | 1 | Beta |
| S20 | Capital Allocation Boardroom | Invest firm resources | VC-style management without buying mastery | 3 | Later |
| S21 | Partner Office | Rank and milestone planning | Long-range goals and advanced analytics | 3 | Later |
| S22 | Client Site / Field Office | Procedural case variety | Alternate case presentation without changing content | 2 | Later |
| S23 | Courthouse Steps | Major-case entry and results | Frames milestone matters and timed sets | 2 | Later |
| S24 | Break Room / Café | Staff flavor and cosmetics | Optional decompression; no progression requirement | 2 | Later |
| S25 | City Directory | Fast scene selector | Makes firm expansion visible | 3 | Later |
| S26 | Rooftop / Skyline | Milestone reflection | Shows firm scale and weekly learning summary | 3 | Later |
| S27 | Managing Partner Floor | Endgame hub | Firm-wide portfolio and expansion | 5 | Future |
| S28 | Content Review Office | Internal admin scene | Question-bank QA and publication workflow | Internal | Internal |

---

## 5. Detailed scene specifications

## S01. Shared Office / Starter Desk

### Purpose

The primary home screen and emotional baseline. It must make the player feel small but capable, then become the clearest visual record of growth.

### Initial composition

- Narrow room or borrowed corner with a 10×8-tile playable visual area
- Scuffed wall, fluorescent fixture, one small window or no window
- Folding desk, secondhand chair, cardboard file box, old computer
- Shared printer and coat rack at the room edge
- Mentor desk partially visible to imply supervision
- One blank wall reserved for the first firm sign

### Hotspots

- Desk: resume current case
- Inbox tray: open recommended case
- Filing box: open Portfolio/history
- Wall calendar: weekly RVQ target
- Door: open Reception/Docket
- Computer: Skills and account utilities
- Empty wall: preview the first firm-sign upgrade

### Characters

- Player avatar at the desk
- Mentor working nearby
- Occasional paralegal cameo before hiring

### Upgrade progression

1. Proper desk
2. Ergonomic chair
3. Desk lamp
4. Bookshelf
5. Framed certificate or learning milestone
6. Firm nameplate
7. Plant
8. Modern computer
9. Rug and coordinated palette
10. Window-office transition at rank-up

### Animation states

- Idle typing, thinking, page turning
- Inbox receives a file when a recommended case appears
- Lamp turns on when a case is active
- A completed-case folder moves to the filing box
- First purchase installs immediately with a short dust/sparkle effect

### Learning connection

The most prominent prompt is always the next useful learning action, not the shop. Weekly RVQs appear as a paper stack or wall-calendar progress strip.

---

## S02. Reception and Docket Board

### Purpose

The case-selection scene. It turns adaptive recommendations into a small, understandable docket.

### Composition

- Reception desk on one side
- Three large case slots on a physical board or wall display
- Waiting chairs with procedural client sprites
- Doors or signs for active practice groups
- Clock and queue ticket display used only as atmosphere
- Firm logo and rank plaque behind reception

### Docket slots

1. Recommended educational case
2. Shorter alternative
3. Different-skill alternative

Each physical folder expands into an accessible DOM card showing question count, estimated time, skill focus, tutor depth, review mix, rewards, and bonuses.

### Hotspots

- Three case folders
- Active-case folder
- Appeals tray for due review
- Receptionist for case explanation
- Practice-group directory
- Office door

### Characters

- Case coordinator or receptionist
- Up to three waiting clients
- Paralegal crossing between Reception and Records

### Upgrade progression

- Corkboard → whiteboard → digital docket wall
- Folding chairs → furnished waiting area
- Printed sign → custom brand wall
- One practice-group doorway → multiple labeled doors
- Manual file tray → organized intake system

### Animation states

- Recommended folder receives a restrained highlight
- Due-review file slides into the Appeals tray
- Accepted file receives a stamp and moves to the player
- Client exits after case resolution

### Learning connection

The Docket must state why each case was offered. Examples: “Strengthen is your current priority,” “Four appeals are due,” or “Short mixed case for today’s remaining target.”

---

## S03. Client Intake Room

### Purpose

Preview a case contract before acceptance without starting a narrative sequence.

### Composition

- Small conference table
- Client seat opposite the player
- Wall display with matter type and learning objective
- Notepad, water glasses, and closed case folder
- Window or privacy glass that improves with firm tier

### Hotspots

- Case folder: inspect question and reward contract
- Client profile: view short procedural context
- Objective board: inspect learning focus
- Accept / decline / choose shorter scope

### Case brief limits

- One title
- Two short sentences of context
- One learning objective
- No plot dependency
- No clues that reveal canonical answers
- Fully skippable after the first few uses

### Upgrade progression

- Shared meeting table → private intake room → premium conference suite
- Paper pad → tablet display
- Generic wall → branded privacy glass
- One client chair → team seating

### Learning connection

The scene translates educational metadata into a clear work contract. It never replaces section, question type, or difficulty labels with fiction.

---

## S04. Universal Case Workspace / War Room

### Purpose

The core question-answering scene. This scene must prioritize reading, structured reasoning, and accessibility over visual spectacle.

### Desktop layout

- Pixel scene occupies a restrained header or side rail
- Canonical question occupies the primary readable column
- Reasoning brief occupies a stable adjacent or sequential panel
- Tutor and case progress remain visible but secondary
- Maximum text width supports comfortable passage reading

### Pixel composition

- Player desk in foreground
- Matter board in background
- Mentor or staff slot
- Case folder, notes, lamp, and timer prop
- Environment skin based on case type

### Hotspots

- Matter board: case progress and objective
- Mentor: request or continue tutor conference
- Notes: open reasoning brief
- Clock: timing preferences and active-time detail
- Door: save and exit

### Visual states

- Pre-question brief
- Canonical reading
- Reasoning step active
- Answer submitted
- Tutor repair required
- Question completed
- Case completed

### Upgrade progression

- Desk notes → organized case binder
- Small board → large whiteboard → digital display
- Basic lamp → specialist workspace lighting
- One staff seat → team worktable
- Plain room → practice-group visual skin

### Animation states

- Staff point at the board without highlighting answer content
- Player writes during reasoning steps
- Correctness produces only a short, non-distracting reaction
- Tutor-needed state changes the mentor posture and conference indicator

### Learning connection

The workspace may hide or de-emphasize choices until required prediction steps are complete. When choices appear, they remain exact, ordered, accessible, and unaltered.

---

## S05. Mentor Conference

### Purpose

A focused tutor state for guided reasoning and repair. It can be a dedicated scene on larger screens or a workspace mode on mobile and MVP.

### Composition

- Two chairs angled toward a shared document
- Whiteboard or legal pad showing the current reasoning steps
- Mentor portrait and concise dialogue area
- Redline comparison panel for original versus repaired reasoning

### Hotspots

- Current reasoning step
- Prior step
- Hint ladder
- Redline view
- Restate reasoning
- Return to question

### Tutor animation vocabulary

- Listen
- Point to document
- Think
- Ask
- Clarify
- Confirm repair

The mentor never celebrates a wrong answer or visually signals the correct choice before deterministic grading.

### Upgrade progression

Tutor style changes through hired mentor roles, not stronger answer assistance:

- Highly guided
- Socratic
- Concise
- Visual structure
- Exam-transfer focused

### Learning connection

The visual focal point is the first reasoning divergence. The mentor asks one bounded question at a time and requires the learner to edit or restate the relevant step.

---

## S06. Case Resolution Table

### Purpose

Close the academic loop before presenting game rewards.

### Composition

- Closing table with completed file
- Learning summary panel on the left
- Reward and firm-progression panel on the right
- Character reaction area in the background
- Next-action doors or buttons along the bottom

### Required reveal order

1. RVQs completed
2. Accuracy and repaired misses
3. First-error and trap patterns
4. Review items scheduled
5. Firm Cash
6. Reputation and rank progress
7. Bonuses
8. New upgrade or case availability

### Hotspots

- Completed file: detailed case report
- Redline pages: repaired reasoning
- Cash envelope or ledger: reward breakdown
- Rank plaque: rank requirements
- Office door: return home
- Shop catalog: spend rewards
- Next folder: accept another case

### Visual variants

- Resolved strongly
- Resolved with concerns
- Resolved after tutor intervention
- Major milestone
- Rank-up ready

### Animation states

- File receives a completion stamp
- Reward count uses a short, skippable tally
- Staff react based on learning outcome, never with shame
- Rank-up celebration changes signage and lighting

### Learning connection

Rewards never appear before the learning result. A repaired mistake is treated as a successful outcome and can receive a distinct Recovery marker.

---

## S07. Firm Shop / Design Studio

### Purpose

Convert learning-earned cash into visible office, avatar, and workflow progression.

### Composition

- Catalog desk with samples
- Miniature office preview or live room preview
- Tailor/brand designer NPC
- Tabs represented by shelves: furniture, décor, technology, avatar, branding

### Hotspots

- Catalog categories
- Live preview
- Owned-item storage
- Firm colors and logo
- Avatar mirror
- Purchase ledger

### Purchase categories

- Furniture
- Lighting
- Wall and floor treatments
- Plants and art
- Technology
- Firm branding
- Avatar clothing and accessories
- Portfolio displays

### Upgrade progression

- Catalog expands with rank
- Higher tiers add coherent themes, not simply more expensive clutter
- Players may save room presets
- Functional items disclose workflow effects separately from cosmetic effects

### Learning guardrails

- Shop never appears mid-question.
- There is no limited-time pressure in MVP.
- No randomized purchases.
- No item changes answer scoring or bypasses reasoning.

---

## S08. Research Library

### Purpose

Provide deeper concept review, validated explanations, tutor references, and saved learning resources.

### Composition

- Bookshelves organized by Logical Reasoning and Reading Comprehension
- Central reading table
- Research Assistant desk
- Index terminal
- Locked legacy shelf for clearly labeled out-of-format content

### Hotspots

- Skill shelves
- Search terminal
- Saved tutor notes
- Validated explanation index
- Legacy-content shelf
- Recommended reading stack

### Upgrade progression

- Single shelf → wall library → multi-room research center
- Card catalog → searchable terminal
- Folding table → team research table
- Research Assistant appears after hiring

### Learning connection

Library content is reference material, not a substitute for practice. Every concept page should link directly to an appropriate case or appeal.

---

## S09. Investigation Lab

### Purpose

A Logical Reasoning-specific workspace skin that emphasizes argument reconstruction.

### Composition

- Argument board with neutral boxes and arrows
- Interview table
- Evidence trays used only as abstract structure props
- Investigator NPC
- Magnifier, recorder, and pinboard motifs without noir darkness

### Hotspots

- Conclusion marker
- Premise stack
- Gap board
- Trap-pattern index
- Investigator pattern report

### Upgrade progression

- Corkboard → structured wall system → digital argument mapper
- One evidence tray → organized case lanes
- Handwritten trap list → searchable recurring-pattern dashboard

### Learning connection

The board can visualize learner-entered structure after the learner supplies it. It must never pre-label the conclusion, gap, or correct answer for an active question.

---

## S10. Due Diligence Deal Room

### Purpose

A Reading Comprehension and VC-influenced workspace for reviewing longer records, viewpoints, and passage structure.

### Composition

- Long table with document sets
- Wall display for passage map
- Transaction timeline and stakeholder columns
- Research Assistant and optional client-team seats
- Bright glass-room visual tone

### Hotspots

- Passage-role map
- Viewpoint table
- Scope and degree notes
- Supporting-line bookmarks
- Deal folder and question queue

### Upgrade progression

- Small conference room → dedicated deal room → capital-markets suite
- Paper binders → indexed digital record
- One staff seat → multi-specialist review team

### Learning connection

Questions sharing a passage remain bundled when educationally appropriate. The room rewards extracting multiple reasoning opportunities from one reading investment.

---

## S11. Appeals Chamber

### Purpose

Turn missed questions and spaced review into visible recovery work rather than punishment.

### Composition

- Quiet chamber with prior and revised briefs
- Two-column redline display
- Appeals tray showing due questions
- Investigator and mentor seats
- Recovery seal collection

### Hotspots

- Due appeals
- Original reasoning
- Repaired reasoning
- Tutor feedback
- Next review date
- Recovery bonus contract

### Visual states

- No appeals due: calm cleared desk
- Appeals due: organized stack, not an alarming badge
- Recovered: file moves to a higher shelf
- Lapsed again: file returns with revised tutor recommendation

### Learning connection

The scene emphasizes the changed reasoning step, not memorization of the answer label. Immediate repeats receive no mastery claim without later retention evidence.

---

## S12. Skills Academy

### Purpose

Host diagnostics, periodic mastery audits, tutor-mode transitions, and guided-to-independent transfer.

### Composition

- Training room with several stations
- Skill map on a wall display
- Mentor at a demonstration board
- Practice booth for independent work
- Assessment room for diagnostic sets

### Hotspots

- Baseline diagnostic
- Skill drills
- Mastery audit
- Tutor-mode explanation
- Confidence calibration
- Modern-exam coverage map

### Upgrade progression

- Shared training corner → dedicated academy → professional development center
- New stations unlock as the learner gains enough evidence

### Learning connection

Skill evidence is shown separately from Reputation. Academy status cannot be bought and never decreases the player’s firm rank.

---

## S13. Staff Bullpen

### Purpose

Show the hired team at work and make each staff member’s workflow function legible.

### Composition

- Shared desks for support roles
- Assignment board
- Staff lockers and personalized props
- Walking path to Reception, Records, and case rooms

### Hotspots

- Individual staff desks
- Assignment board
- Staff role details
- Cosmetic desk personalization
- Current case support status

### Upgrade progression

- Two cramped desks → organized bullpen → department pods
- Staff acquire visual tools corresponding to unlocked workflow functions
- Promotions change outfit accents and desk props, not educational authority

### Learning connection

Assignments influence organization, case choice, analytics, or tutor style. Staff do not generate answers or passive mastery.

---

## S14. Hiring and Interview Room

### Purpose

Recruit staff and choose workflow specialization.

### Composition

- Interview table
- Candidate chair
- Résumé board showing role effects
- Recruiter NPC after unlock
- Window or hallway showing the active firm tier

### Hotspots

- Candidate cards
- Role comparison
- Staff preview
- Hire contract
- Roster capacity

### Candidate design

Candidates differ through:

- Visual identity
- Personality and concise dialogue
- Tutor or workflow style
- Cosmetic preferences

They do not have randomized academic power levels. The player chooses a workflow fit, not a loot rarity.

---

## S15. Operations Office

### Purpose

Manage weekly RVQ targets, review obligations, case capacity, and staff workflow.

### Composition

- Office Manager desk
- Calendar wall
- Capacity board
- Review schedule
- Firm operations ledger

### Hotspots

- Weekly RVQ target
- Case-capacity upgrades
- Review calendar
- Notification preferences
- Session-length defaults
- Workload summary

### Learning guardrails

- No daily streak punishment
- No energy meter
- No impossible catch-up countdown
- Time estimates remain supporting information
- Case capacity controls choice variety, not permission to study

---

## S16. Practice Group Hall

### Purpose

Visualize specialization investments and balanced educational coverage.

### Composition

- Hallway or directory with practice-group doors
- Shared central progress map
- Group plaques and staffed rooms
- Locked rooms shown as planned expansion, not mystery boxes

### Hotspots

- Investigations
- Appellate Review
- Transactions
- Public Interest
- Litigation
- Balanced-firm overview

### Upgrade progression

- Door sign
- Dedicated room
- Staff assignment
- Specialized visual skin
- Advanced case-choice slot

### Learning connection

Investing in a group improves case organization and aesthetics but cannot let the player permanently avoid weak sections or question types.

---

## S17. Mock Courtroom

### Purpose

Host optional timed hearings after the learner has shown sufficient untimed accuracy.

### Composition

- Small courtroom or moot-court room
- Judge or evaluator sprite
- Counsel tables
- Visible but restrained clock
- Spectator area populated by staff at higher tiers

### Hotspots

- Hearing brief
- Timing rules
- Accuracy threshold
- Start/pause conditions
- Post-hearing review

### Visual states

- Practice hearing
- Section simulation
- Paused accommodation state
- Review required
- Hearing resolved

### Learning connection

Timed performance never replaces reasoning review. The scene unlocks only after sufficient evidence and presents speed as transfer under constraint, not a currency race.

---

## S18. Portfolio Gallery

### Purpose

Make major learning milestones and resolved cases visible in the firm environment.

### Composition

- Gallery wall
- Framed case covers
- Shelves with milestone objects
- Firm timeline
- Recovery display

### Hotspots

- Major case displays
- Rank milestones
- Skill-growth milestones
- Recovery records
- Firm history

### Display rules

- Objects represent earned learning milestones, not random drops.
- Displays link to the underlying case report or aggregate evidence.
- Aesthetic prestige does not claim real legal qualification.

---

## S19. Records Room

### Purpose

Provide detailed, searchable access to attempts, case files, reasoning briefs, and tutor feedback.

### Composition

- Compact filing room or digital records office
- Search desk
- Organized shelves by case state
- Paralegal station

### Hotspots

- Search and filters
- Recent cases
- Incorrect answers
- Correct answers with weak reasoning
- Tutor redlines
- Scheduled appeals

### Upgrade progression

- Cardboard boxes → labeled cabinets → searchable digital archive
- Paralegal improves saved filters and summary views

### Learning connection

The Portfolio Gallery celebrates; the Records Room investigates. Detailed history remains functional HTML with robust filtering.

---

## S20. Capital Allocation Boardroom

### Purpose

Express the VC/management fantasy through deliberate investment in the firm.

### Composition

- Boardroom table
- Capital plan display
- Practice-group investment cards
- Office-expansion model
- Staff leads at available seats

### Hotspots

- Cash allocation
- Practice-group budgets
- Office expansion
- Staff capacity
- Upgrade roadmap
- Scenario preview

### Investment categories

- Client intake capacity
- Research organization
- Tutor-style options
- Case-choice variety
- Office expansion
- Visual customization

### Guardrails

- Capital cannot buy mastery, answers, or rank directly.
- Every investment shows its workflow and visual effect.
- No investment produces substantial passive learning progression.

---

## S21. Partner Office

### Purpose

Provide long-range planning, advanced analytics, and rank milestones once the firm is established.

### Composition

- Large desk
- City-facing window
- Firm strategy wall
- Practice-group reports
- Selected portfolio objects

### Hotspots

- Rank requirements
- Long-term RVQ and skill trends
- Firm strategy
- Major matters
- Office theme
- Managing Partner requirements

### Learning connection

The office should pair firm progress with honest academic evidence. It must not hide weak-skill data behind prestige.

---

## S22. Client Site / Field Office

### Purpose

Add visual variety to cases without requiring an explorable city or generated storyline.

### Variants

- Startup conference room
- Public-interest office
- University archive
- Regulatory hearing room
- Community center
- Corporate records room

### Rules

- Variants are selected from safe case metadata.
- They do not imply the canonical LSAT question is a real legal matter.
- No environmental clue suggests an answer.
- The same Universal Case Workspace UI overlays every variant.

---

## S23. Courthouse Steps

### Purpose

Frame milestone matters, hearings, rank reviews, and major completion moments.

### Composition

- Broad courthouse steps
- Firm staff assembled in small groups
- City traffic and flags
- Case folder handoff point
- Day, rain, and evening variants

### Hotspots

- Enter hearing
- Review milestone brief
- View accommodation/timing rules
- Return to firm

### Learning guardrails

The courthouse is ceremonial. It never makes normal practice feel inferior or blocks the learner from ordinary cases.

---

## S24. Break Room / Café

### Purpose

Optional staff flavor, cosmetic display, and a calm pause between cases.

### Composition

- Coffee counter
- Small tables
- Staff notice board
- Vending machine and plant shelf

### Hotspots

- Short staff comments
- Cosmetic room items
- Accessibility reminders
- Study-break suggestion

### Guardrails

- No mandatory relationship grind
- No progression rewards for repeated dialogue
- No random gifts or energy restoration mechanic
- The user can ignore this room completely

---

## S25. City Directory

### Purpose

Provide fast navigation and show the firm’s expanding footprint without free-roam movement.

### Composition

- Stylized district map
- Firm building
- Courthouse
- Client-site icons
- Training and archive icons
- Future expansion lots

### Hotspots

- Every unlocked scene
- Current case destination
- Recommended destination
- Firm expansion preview

### Interaction

Selecting a destination triggers a short transit card or immediate load. The player does not walk through streets.

---

## S26. Rooftop / Skyline

### Purpose

Offer a quiet milestone and weekly-summary scene with a clear view of firm growth.

### Composition

- Rooftop terrace
- City skyline
- Firm sign
- Bench and plants
- Time-of-day matched to local preference when available

### Hotspots

- Weekly RVQ summary
- Rank timeline
- Screenshot/photo mode
- Firm visual themes
- Return to office

### Guardrails

This is a reflective scene, not a plot location. Summaries remain factual and do not use manipulative streak language.

---

## S27. Managing Partner Floor

### Purpose

Long-term endgame hub for firm-wide portfolio management and expansion.

### Composition

- Executive reception
- Boardroom
- Practice-group wings
- Portfolio gallery
- Regional expansion display

### Future mechanics

- Open a second office
- Mentor junior fictional staff
- Build specialized firm layouts
- Curate advanced case portfolios
- Long-range mastery and retention programs

The scene should not ship until the lower-rank loop is proven satisfying.

---

## S28. Content Review Office

### Purpose

An internal admin environment for managing the 6,000–12,000-question import and review workflow.

### Composition

- Import-batch board
- Duplicate-review queue
- Licensing desk
- Human-QA stations
- Publication console

### Hotspots

- New batch
- Parser failures
- Exact duplicates
- Near-duplicate candidates
- Missing keys or choices
- Passage-link failures
- License quarantine
- Sample QA
- Publish eligible records

### Why it matters

This scene is not learner-facing, but the docket metaphor can make a large content-operations workload easier to understand. Every action must still use ordinary admin controls, audit logs, and role-based authorization.

---

## 6. Scene flow by activity

### 6.1 Normal case flow

```text
Starter Office
  → Reception / Docket
  → optional Client Intake
  → Universal Case Workspace
  → Mentor Conference when triggered
  → Case Resolution
  → Starter Office or Firm Shop
```

### 6.2 Review flow

```text
Starter Office review indicator
  → Appeals Chamber
  → Universal Case Workspace
  → Redline repair
  → Case Resolution with Recovery bonus
  → Records Room / Portfolio
```

### 6.3 Firm-management flow

```text
Starter Office
  → Firm Shop for individual purchases
  → Staff Bullpen / Hiring for staffing
  → Operations for targets and capacity
  → Capital Allocation Boardroom for higher-tier investments
```

### 6.4 Mastery flow

```text
Skills Academy
  → guided assessment
  → independent transfer case
  → optional Mock Courtroom hearing
  → Partner Office analytics
```

---

## 7. Reusable scene modules

### 7.1 Architecture modules

- Wall segment
- Window segment
- Door and doorway
- Floor tile families
- Ceiling and lighting layer
- Baseboard and trim
- Reception counter
- Desk families
- Conference table families
- Shelf and cabinet families
- Sign and plaque system

### 7.2 Functional prop modules

- Case folder
- Docket board
- Calendar
- Whiteboard
- Argument-map board
- Passage-map board
- Review tray
- Reward ledger
- Computer terminal
- Search terminal
- Staff assignment board
- Rank plaque
- Firm logo panel

### 7.3 Decorative modules

- Plants
- Rugs
- Lamps
- Wall art
- Books
- Stationery
- Coffee items
- Awards
- Personal staff props
- Seasonal non-commercial décor

### 7.4 Character modules

- Base body
- Skin tones
- Hair and headwear
- Business-casual clothing
- Formal clothing
- Shoes
- Accessories
- Role props
- Emote icons

Reusable modules should produce coherent combinations through tagged palettes and style families.

---

## 8. Upgrade-to-scene mapping

| Upgrade | Scene impact | Functional impact |
|---|---|---|
| Proper desk | Starter Office and Workspace | Cosmetic only |
| Research shelf | Office and Library | Faster access to saved concept references |
| Organized intake system | Reception | Adds a visible alternate case choice |
| Case whiteboard | Workspace | Improves reasoning-step overview |
| Paralegal desk | Bullpen and Records | Unlocks saved filters and case organization |
| Investigator station | Investigation Lab | Unlocks recurring-trap reports |
| Conference room | Client Intake | Opens detailed case preview |
| Appeal cabinet | Appeals Chamber | Improves review-queue organization |
| Firm signage | Office and Reception | Branding customization |
| Practice-group suite | Hall and Workspace | Adds specialized case skin and choice slot |
| Capital model | Boardroom | Unlocks multi-project investment preview |
| Portfolio wall | Office and Gallery | Displays learning milestones |

No functional effect changes deterministic scoring or lowers reasoning requirements.

---

## 9. Character placement and behavior

### 9.1 Mentor Attorney

- Starter Office, Mentor Conference, Skills Academy, Mock Courtroom
- Reads, writes, points, listens, and walks between a small set of anchors
- Changes tutor posture based on current step, never based on hidden answer content

### 9.2 Paralegal

- Reception, Staff Bullpen, Records Room, Resolution
- Carries files, organizes trays, updates the docket, and retrieves saved records
- Makes resume and history functionality visually understandable

### 9.3 Investigator

- Investigation Lab, Appeals Chamber, Resolution
- Works with pattern boards and recurring-trap reports
- Appears only after enough learner history exists to support pattern claims

### 9.4 Research Assistant

- Library, Due Diligence Deal Room, Staff Bullpen
- Organizes passage maps and validated references
- Never pre-annotates an active canonical question

### 9.5 Office Manager

- Operations Office, Reception, Capital Allocation Boardroom
- Represents targets, capacity, notifications, and upgrade planning

### 9.6 Clients and procedural NPCs

- Intake Room, Reception, Client Site, Courthouse Steps
- Use short, reusable animation sets
- Provide matter tone without long dialogue or plot continuity
- Never represent a real person without permission

---

## 10. Lighting, palette, and atmosphere

### 10.1 Global visual tone

- Optimistic professional fantasy
- Warm neutrals with rank-specific accent colors
- Clear separation between interactive props and background detail
- Avoid an overwhelmingly dark noir palette
- Avoid visual similarity to any specific existing game franchise

### 10.2 Tier palettes

| Tier | Core materials | Accent direction |
|---|---|---|
| 0 | Worn gray, beige, cardboard, old laminate | Muted blue |
| 1 | Light wood, cream walls, black metal | Cobalt |
| 2 | Walnut, soft green, glass, organized textiles | Teal or emerald |
| 3 | Dark wood, brass, stone, skyline blue | Gold and navy |
| 4 | Custom stone, premium wood, art lighting | User-selected firm colors |
| 5 | Architectural glass, garden elements, skyline | Fully branded palette |

### 10.3 Time and weather

- Optional dawn, day, evening, and night lighting
- Rain and snow appear only as window/background effects
- Weather never changes difficulty or access
- Local time can inform atmosphere only with user permission and a manual override

---

## 11. Sprite and animation requirements

### 11.1 Character sprite set

Minimum launch actions:

- Idle front, back, and side
- Walk four directions
- Sit/work
- Read
- Write
- Think
- Point
- Listen
- Small celebration
- Concern/review

### 11.2 Animation constraints

- Idle loops: 2–4 frames
- Walk cycles: 4–6 frames per direction
- Work/reaction loops: 3–6 frames
- Target 8–12 frames per second for a classic pixel feel
- Avoid more than six prominent animated actors in one scene
- Pause or reduce animations when document reading begins

### 11.3 Object animations

- Folder slide/open/stamp
- Lamp on/off
- Printer page
- Elevator door
- Whiteboard update
- Calendar page
- Reward ledger entry
- Sign installation
- Plant or curtain movement

---

## 12. Responsive and accessible presentation

### 12.1 Desktop

- Scene may occupy a full hub view or 30–40% of a case-workspace layout.
- Question text receives the widest and most stable column.
- Hotspots support mouse, keyboard, and touch.

### 12.2 Tablet

- Scene becomes a shorter top panel.
- Hotspot list may appear beneath it.
- Reasoning and question panels stack when necessary.

### 12.3 Mobile web

- Scene header targets 140–220 pixels high.
- Canonical question and reasoning controls use the full viewport width.
- Management scenes use cards beneath the art rather than tiny hotspots.
- Character dialogue never overlays question text.
- Canvas may be collapsed without losing functionality.

### 12.4 Accessibility equivalents

- Every scene has a text heading and purpose.
- Every hotspot has a DOM button or link.
- Notifications have text equivalents.
- Animation can be reduced or disabled.
- Colorblind-safe markers accompany palette signals.
- Screen readers receive current scene state but not decorative prop noise.

---

## 13. Audio direction

Audio is optional and off or restrained by default during reading.

### Recommended sound families

- Soft office ambience
- Page turn
- Pencil or keyboard
- Folder stamp
- Door and elevator
- Short purchase confirmation
- Short rank-up theme
- Calm resolution cue

### Audio guardrails

- No repeating alert sound for due reviews.
- No ticking clock in ordinary cases.
- Timed hearings provide a silent visual option.
- All sounds have independent volume control.
- The app remains fully understandable muted.

---

## 14. Scene production priority

### P0 — First playable loop

1. Shared Office / Starter Desk
2. Reception and Docket Board
3. Universal Case Workspace
4. Mentor Conference as a Workspace state
5. Case Resolution Table
6. Firm Shop / Design Studio

This is five independently rendered MVP scenes plus one embedded tutor state; the Mentor Conference does not increase the PRD's five-scene MVP scope. These can be produced from three primary tilesets: modest office, learning workspace, and interface/shop.

### P1 — Educational depth and early firm growth

7. Client Intake Room
8. Appeals Chamber
9. Research Library
10. Investigation Lab
11. Due Diligence Deal Room
12. Skills Academy
13. Staff Bullpen
14. Hiring and Interview Room
15. Operations Office
16. Records Room

### P2 — Mature tycoon layer

17. Practice Group Hall
18. Mock Courtroom
19. Portfolio Gallery
20. Capital Allocation Boardroom
21. Partner Office
22. Courthouse Steps

### P3 — World expansion

23. Client Sites
24. Break Room / Café
25. City Directory
26. Rooftop / Skyline
27. Managing Partner Floor

### Internal

28. Content Review Office

---

## 15. Asset-production checklist per scene

Every scene specification handed to an artist should include:

- Scene ID and version
- Product purpose
- Rank/tier variants
- Base dimensions and camera crop
- Tileset dependencies
- Background, midground, foreground, and lighting layers
- Hotspot coordinates and accessible labels
- Required NPC anchors
- Prop list
- Upgrade slots
- Calm, active, reward, and reduced-motion states
- Desktop, tablet, and mobile crops
- Animation list
- Sound list
- Empty/loading/failure state
- Localization-safe text surfaces
- Performance budget
- Source files and export naming

### Suggested file naming

```text
scene_s01_starter_office_tier0_v001.png
scene_s01_starter_office_tier0_collision_v001.json
props_office_basic_v001.png
char_mentor_base_idle_front_v001.png
anim_folder_stamp_v001.png
```

---

## 16. Scene analytics

Track product utility rather than decorative clicks:

- scene_entered
- scene_exited
- hotspot_selected
- recommended_hotspot_selected
- scene_transition_skipped
- scene_collapsed
- reduced_motion_enabled
- upgrade_previewed
- upgrade_applied
- case_selected_from_docket
- tutor_entered_from_scene
- portfolio_opened_from_scene

Guardrail metrics:

- Time from Office entry to question start
- Percentage of study time in management scenes
- Docket choice comprehension
- Hotspot misclick or abandonment rate
- Scene-render failure rate
- Mobile scene-collapse rate

---

## 17. Scene acceptance criteria

### Functional

- Every scene has one clear primary action.
- Every critical hotspot has an accessible DOM equivalent.
- The player can reach a recommended case within two actions from the Office.
- Scene failure does not block the learning workflow.
- Purchases and rank changes persist across sessions.

### Visual

- Rank progression is understandable without reading a number.
- Upgrades produce visible, correctly layered changes.
- Interactive props remain distinguishable at supported sizes.
- Characters are expressive without copying an existing franchise.
- Canonical question text remains visually dominant during casework.

### Educational

- No scene reveals or suggests an answer.
- No staff animation claims knowledge unsupported by learner data.
- Tutor-required and review-due states are informative rather than punitive.
- Management time remains below the PRD’s 20% guardrail.
- A learner can disable all decorative movement without losing meaning.

---

## 18. Recommended art prototypes

Before full production, create these six frames:

1. Tier 0 Starter Office before any upgrade
2. Tier 0 Starter Office immediately after the first desk upgrade
3. Tier 2 Boutique Office with Paralegal and Investigator
4. Reception/Docket with three offered case folders
5. Universal Case Workspace during a reasoning brief
6. Case Resolution with a repaired miss and a newly affordable upgrade

These frames test the essential promise: learning work creates visible firm growth without compromising the question experience.

---

## 19. Final scene directive

The world should feel inhabited, collectible, and increasingly prestigious, but it exists to return the player to meaningful reasoning. The Starter Office, Docket, Workspace, Mentor, Resolution, and Shop form the essential visual loop. Every additional room must either improve learning workflow, express earned growth, or clarify firm management. If a proposed scene does none of those things, it should not be built.
