# Demo choreography — 4-to-5-minute cut

Everything here is load-bearing for the talk. Two audiences: the presenter, who
follows the click order, and the script agent, who budgets spoken words around
the second counts.

The governing constraint: the audience must see the real product, and must never
see the product *wait*. Every wait in the original path has been moved off the
stage into a seeding command.

---

## 1. One command before every rehearsal and before the talk

```bash
cd deck && npm run reset-demo
```

That runs, in order:

| Step | What it does | Time |
| --- | --- | --- |
| `stage_demo.py --apply` | Pins the question, pre-pastes the reasoning, rewinds the question timer, silences the guided tour server-side (§10), re-grades the verdict twin through the real model | ~20-40s |
| `prepare-demo.mjs --skip-seed` | Resolves **all six** pinned values and writes them into `demo.config.ts`, then proves a framed page stays signed in | ~10-20s |

`--skip-seed` is not optional. `prepare-demo.mjs` runs the seeder by default, and
the seeder builds fresh practice runs — so the previous ordering staged the demo
and then immediately replaced the sessions it had just staged. Run the seeder on
its own if the database is empty.

All six are resolved, which is also new. `stage_demo.py` rebuilds the graded
verdict twin under a new id every time it grades, and `prepare-demo.mjs` used to
pin only `liveSessionId` — so `reset-demo` reliably left `verdictSessionId`
pointing at a session it had just deleted, breaking the payoff beat with the
command whose job is to make the demo work. The twin is now found by what it is
rather than by its id: the paused run holding an already-graded attempt.

`backend/scripts/repin_demo_session.py` is the check for all six, and it is a
check only. It used to take `--write` and re-pin `liveSessionId` alone, which is
the worst of the six to fix in isolation: the ordinary case slide comes back, so
the command appears to have worked, while the centrepiece keeps pointing at a
deleted session and silently plays an undriven case instead. It now reads all six
back, names the dead ones, exits non-zero, and prints `reset-demo`.

**It cannot be made to re-pin, and that is worth knowing before you try.** Four of
the six are not pins that drifted but staging that no longer exists — after a
re-seed there is no solo case carrying pre-written reasoning and no
fifteen-question driven run to point at — and the two answer keys cannot be read
back over the API by anything, because `serialize_question` omits
`correct_answer` on purpose.

**Without a coaching gateway** (`TFY_API_KEY`, `TFY_URL`) `reset-demo` still runs
to completion and still pins all six. Whether the driven case comes back *graded*
depends on whether anyone has captured a grade — see §3a. If nobody has, it stages
ungraded and says so. It used to raise `CoachingProviderError` partway through,
*after* deleting the previous verdict — leaving the demo worse than it found it,
from the command every other recovery path points at.

Between rehearsals, when the verdict text has not changed and you only need the
case rewound:

```bash
cd deck && npm run stage-demo:fast   # ~6s, skips the model call
```

`stage-demo:fast` leaves the previously graded verdict in place, so it is the
one to use in a tight rehearsal loop. Run the full `reset-demo` at least once on
the machine and network you will present from.

> It did not always. `--no-model` was implemented as "build a fresh twin, skip
> the grading", which deleted the good verdict and left an ungraded one under a
> new id — so the command documented as the safe rehearsal loop was emptying the
> payoff slide and staling the pinned id on every run. It now keeps an existing
> graded twin for the pinned question and reports `mechanism: kept`.

**Why a reset is needed at all.** Each rehearsal consumes the seeded state: the
case gets answered, and the per-question timer keeps counting from the moment
anything reads the session — so an un-reset case can walk on stage showing
forty minutes elapsed on one question. `stage_demo.py` is idempotent and rewinds
all of it.

> `prepare-demo.mjs` previously gave `/v1/study-sessions/current` a 4-second
> budget. That endpoint measures 6-14s locally and has been seen at 19s, so it
> failed silently and fell back to a pinned id — which is how a stale session id
> reached the stage. The budget is now 30s.

---

## 2. Answer key — read these words exactly

Pinned question, and it is pinned by id rather than chosen adaptively, so it is
the same on every run.

| Field | Value |
| --- | --- |
| Question id | `hf-lsat-lr:199809_3-LR2_8_9` |
| Section / type | Logical Reasoning — **Assumption** |
| Stem | "The argument depends on assuming which one of the following?" |
| **Correct answer** | **(C)** |
| Choice (C) text | "Forecasts of scientific and technological discoveries, or forecasts of their effects, are not entirely reliable." |
| **Strategy shown** | **Prephrase Before Choices** (`prephrase`) |
| Strategy one-liner | "Decide what the right answer has to do before you read the choices." |

**Stimulus, in brief.** Scientific and technological discoveries have
considerable effects on how any society develops. Therefore predictions about
the future of societies where discovery is *particularly frequent* are
particularly untrustworthy.

**Why (C) is correct, in one sentence.** The argument only works if the
discoveries themselves cannot be reliably forecast — if you could predict the
next twenty breakthroughs, a high-discovery society would be *easier* to
forecast, not harder.

**The trap worth naming if there is time.** (A) is about discoveries having
harmful consequences; the argument is about whether predictions can be
*trusted*, not whether they *hurt*. (E) sets up a comparison between two
societies, which the argument never needs.

### What the AI says about the pre-pasted reasoning

Generated by the real coaching model (`gpt-5.6-luna`) and stored. These are the
words that will be on screen:

| Field | Value |
| --- | --- |
| Explanation grade | **95** |
| Verdict | **strong** |
| First error | none |

> **Got right:** "You correctly focused on the conclusion's reliability claim
> rather than on whether discoveries cause harm."
>
> **Debrief:** "Your reasoning found the exact gap between discoveries affecting
> society and predictions becoming unreliable."

A high grade is deliberate. The beat being sold is "it grades the *reasoning*,
not the letter", and a 95 with a specific compliment demonstrates that better
than a low score, which reads as a strawman.

---

## 3. Per-demo second counts

Total live-demo time: **82 seconds** (1:22) across 6 live slides, plus one still.
Budget spoken words against these numbers, not against the old ones.

**Slides are identified by id, never by index.** A slide was inserted earlier in
the deck and every index shifted; anything below written as "slide 12" would now
be wrong. Ids do not move.

| Slide id | Route | Seconds | Beats |
| --- | --- | --- | --- |
| `demo-case-answer` | `{autoplay}` | **30** | 5 |
| `demo-case-verdict-review` | `/progress?tab=answers` | **12** | 3 |
| `demo-mega-litigation` | `/progress` | **14** | 3 |
| `demo-clients-walk-in` | `/office` | **9** | 2 |
| `demo-office-transformation` | `/office?officeTier=0` | **9** | 3 |
| `demo-map-and-firm` | `/map` | **8** | 2 |
| `demo-focus-mode` | *still only* — `demo-focus-mode.png` | **6** budget, **0** live | — |

`demo-focus-mode` is no longer a live embed. It carries `stillOnly` and paints
`demo-focus-mode.png`, so it costs no load and cannot fail. See §7.

### `demo-case-answer` — the case, 30s

*The beat-by-beat table below describes the superseded hand-driven cut. The slide
now plays itself, and the current choreography is in `src/slides/index.ts`.*

Reasoning is already in the box. **Alan never types.**

| s | Action |
| --- | --- |
| 0-4 | Point at the strategy brief. Say its name: **Prephrase Before Choices**. Do not read its three steps. Then click **Use it**. |
| 4-9 | Drag-highlight exactly one clause in the stimulus. One drag. |
| 9-12 | Select **(C)**. Do not read the other four choices. |
| 12-18 | Scroll the pre-filled reasoning into view. Read its **first clause only**. |
| 18-20 | Click confidence 4. **Do not submit** — advance the slide. |

**The "Use it" click is required, not decoration.** Until the strategy brief is
answered the app disables the answer choices, the reasoning box and the
confidence row — so skipping it leaves the presenter unable to do anything else
on this slide. It cannot be pre-staged: the choice is local state in
`case-flow.tsx` with no draft field behind it, so there is nothing for
`stage_demo.py` to write. `verify-demo-continuity.mjs` performs this click and
fails if the case stays locked afterwards.

It is also the on-message beat — "the strategy is inside the question" is a slide
of its own (`pov-strategy-inside-the-question`), and this is the room watching
that claim be true.

Submitting would create a fresh attempt and put a 20-40 second model call on
stage. The verdict you want is already waiting on the next slide.

### `demo-case-verdict-review` — the verdict, 12s

*The beat-by-beat table below describes the superseded hand-driven cut. The
current choreography is in `src/slides/index.ts`.*

Advancing points the same iframe *element* at a different session — the
pre-graded one — so the app **does reload**, briefly. It is a warm, already
authenticated reload rather than a cold start: the element survives, so the
session cookie and the open connection are kept and no login can appear. The
presenter should have a line to speak over it; do not wait in silence.

Once it lands, the coaching panel has no spinner, because the feedback is
already stored and there is nothing to fetch.

> Earlier revisions of this file claimed "nothing reloads" across this seam.
> That was wrong: the two slides point at different session ids, and the deck
> and the app are on different origins, so the deck cannot navigate the iframe
> client-side. See §5 for why that trade is still worth taking.

| s | Action |
| --- | --- |
| 0-4 | Read the verdict line in one sentence. Do not itemize answer, explanation and time points. |
| 4-10 | Open the coaching panel. Point at the **95** and read one clause of the "got right" line. |
| 10-14 | Click **Dashboard**. Land on the history with the reasoning attached. Do not scroll. |

---

## 3a. The coach on a machine with no gateway

**What blocks the coach is not a login.** `app/coaching.py::_chat` posts to
`TFY_URL` with `Authorization: Bearer <TFY_API_KEY>`, both read from
`current_app.config` in the Flask process. It is a server-to-server call made by
the backend; the signed-in account only decides *which attempt* gets graded.
Handing over an account, or seeding one harder, changes nothing — a VM without
those two variables cannot grade, and a laptop with them grades whoever is
signed in.

**What the beat actually needs is a stored grade, not a live one.** By
presentation time it is already a read: `run_attempt_coaching` returns
`feedback_json["coaching"]` verbatim once `coaching_status` is `completed`,
calling nothing (§5). So `stage_demo.py --capture-coaching` pins a grade that a
real run produced, into `backend/scripts/demo_fixtures/coaching.json`, and
staging replays it whenever the coach refuses.

```bash
cd deck && npm run capture-coaching     # needs a working gateway, once
git add backend/scripts/demo_fixtures/coaching.json && git commit
```

After that, any machine — no key, no network to the gateway — stages
`demo-case-answer` with the same coached text, in about a second.

**On the presenting machine this is worth having for a different reason.** With
a gateway configured nothing changes: the live call still runs first and its
result still wins. The capture is what stands behind it if the gateway is down,
rate-limited or unbilled on presentation morning, which today means `reset-demo`
quietly restages the centrepiece ungraded.

**Nothing in the staging path composes coaching text.** A capture is replayed
only when the question id, the selected label, the sha256 of the reasoning and
the prompt version all still match, because a grade shown against reasoning it
was not given is fabricated whatever its words are. `--capture-coaching` refuses
to run without a working coach rather than inventing something. If no capture
matches, the case stages ungraded and says so, exactly as before. The folder's
`README.md` carries the rules.

Nothing in the payload is keyed to a session, attempt or user id — only to
choice labels — so unlike the six values in §1 there is nothing to re-point
after a re-seed. The question is pinned by a stable bank id and both reasoning
texts are constants in `stage_demo.py`, so a database rebuilt from nothing
presents the capture with the same inputs it was taken against.

---

## 4. What is deterministic, and what is not

**Pinned and safe:**

- *The question.* Written by id onto the open session's current item, not chosen
  by the adaptive selector.
- *The strategy.* `strategy_key` is written directly, so the same brief appears
  every run. `prephrase` also carries the shortest gate in the catalogue — one
  text field rather than a multi-step sequence.
- *The gate.* Downgraded from `full` to `light`. At `full` the app **hides the
  answer choices** until a prediction is typed, which is on-stage typing. At
  `light` the real strategy card still shows — the audience sees the mechanic —
  but the choices are already unlocked. Verified: `blocking: false`,
  `hides_choices: false`.
- *The verdict text.* Stored on the attempt, so it cannot vary between the
  rehearsal and the talk.

**Not pinned, and what it would take:**

- *The other seven questions in the open session* are still adaptively chosen.
  They are never shown, but if the presenter overshoots and submits, the next
  question is whatever the selector picks. Pinning the whole session would mean
  writing all eight items by id.
- *The per-question elapsed timer* starts whenever anything reads the session,
  including preflight. It will show a small non-zero value on stage. Rewound to
  zero by every reset; there is no way to freeze it without touching
  `backend/app/`, which this work does not own.

---

## 5. How the model latency was removed

The mechanism, since it matters that this is not a mock: **the real coaching
pipeline is run ahead of time and its output is stored on the attempt.**

`stage_demo.py` creates a twin case session, answers it with the same reasoning
paragraph, and calls `generate_attempt_coaching()` — the same function the live
submit path calls. The validated result is written to `attempt.feedback_json`
with `coaching_status = "completed"`.

`routes.py` already short-circuits on exactly that state:

```python
saved = (attempt.feedback_json or {}).get("coaching")
if attempt.coaching_status == "completed" and saved:
    return ...   # no model call
```

So the deck reads a database row. No backend code was changed, the UI is the
real feedback UI, and the words are real model output — they were simply
generated last night instead of in front of the room. Measured generation cost
when it *was* on the critical path: **19-38 seconds**.

The twin session is left `paused` with its `pending_attempt_id` set, rather than
`completed`. A completed session serves no item and its URL lands on a summary;
a paused session holding a pending attempt serves the post-submit verdict screen,
which is the screen `demo-case-verdict-review` needs.

### The cost of this, stated plainly

`demo-case-verdict-review` points at a *different* session id from
`demo-case-answer`, and the deck and the app are on different origins (`:5180`
and `:5173`), so the deck cannot reach into the iframe's history to navigate it
client-side — a route change can only be done by reassigning `src`, which
reloads the app.

So two seams now cost one warm app boot each, where they previously cost
nothing:

- `demo-case-answer` → `demo-case-verdict-review`
- `demo-case-verdict-review` → `demo-mega-litigation`

`verify-demo-continuity.mjs` has been updated to expect exactly one navigation
across each, and to fail on two or more. What it still holds is the invariant
that matters: the iframe **element** must survive, so the session cookie and the
warm connection are kept and no login can appear.

The trade is one reload of a warm, already-authenticated app against a 19-38
second model call in front of the room. That is worth taking, but it is a trade,
not a free win: **rehearse the advance into `demo-case-verdict-review`
specifically**, confirm the loading cover hides the boot rather than flashing
white, and give the presenter a line to speak across it.

> **That script has now actually been run, which it never had been.** It was
> written around the autoplay choreography and left unexecuted because running it
> means an autoplay run, so every assertion in it was unexercised and a green
> result from it meant nothing. First live run: **28 checks, all passing**, one
> warm reload across each seam, the element surviving throughout, and the case
> reaching its verdict in 19.6s against its 30s budget. Nothing was wrong in the
> deck. Three things were wrong in the script, and all three were of the kind that
> makes a report say less than it knows:
>
> - Every `note:` it gathered went into `report.json` and was **never printed**.
>   Thin headroom, a wrong question on top of the Answer Log, a first tile the
>   presenter would have to scroll to — all filed out of sight under a green
>   summary. They are printed now, under their own heading after the checks.
> - Its screenshots were named `12-`, `13-` and `14-` for slides that sit at 13,
>   14 and 15, which is the thing its own header opens by forbidding. Named by id
>   now.
> - Its timing check could not tell a slow deck from a busy laptop while telling
>   the reader to "suspect machine load first". It failed at 33.8s on a machine at
>   load 31, minutes after the same code ran in 18.2s. It now samples the load
>   average and **voids** the measurement instead of failing it when the machine is
>   over 1.5 per core — a red that means "your laptop was busy" is how a check
>   stops being read.
>
> Measured spread across four runs, same code, same machine: 18.2, 19.6, 25.1 and
> 33.8 seconds, the last two under heavy load. The 30s budget holds on a quiet
> machine with about 10s to spare.

---

## 6. Fallback stills — which still stands in for which route

`deck/public/stills/` is the on-stage fallback when a demo route fails, and it is
committed. **The app is under active development, so these drift.** A drifted
still is worse than a visible failure, because it silently misleads the room.

> ### Read this before running any recapture
>
> **Always open the regenerated PNGs and look at them, and commit them before
> you regenerate again.** This is not boilerplate caution — it is written down
> because it has already gone wrong once, on 2026-08-10.
>
> An early version of `recapture-stills.mjs` ran while the backend went down
> mid-run and wrote the app's "Connection interrupted" card over **five** good
> stills. Every file was plausible in a directory listing; the only tell was
> that five unrelated screens had landed at an identical 87 KB. They were
> recovered with `git checkout -- deck/public/stills/`, and that recovery was
> only possible because the files had been committed a couple of hours earlier.
>
> Two lessons worth keeping:
>
> - **git is the recovery path.** Commit stills you are happy with promptly. A
>   recapture run is destructive by nature and there is no other copy.
> - **The tool that maintains the fallback can corrupt the fallback**, and these
>   files are precisely what the talk falls back on when everything else has
>   already failed. The script now inspects each frame and refuses to write an
>   error card, a login screen, a spinner or an empty page — but that check is a
>   list of known failures, not a proof, so the eyeball step stays.

Every file in `public/stills/` is named by exactly one slide, and the table
below is the whole directory. That is a property worth keeping rather than a
coincidence: `public/` is copied into `dist/` verbatim, so a still no slide
names is not merely untidy, it is downloaded by every machine that opens the
deck. Four files failed that test and were deleted on 2026-08-11 — see
[Four stills that were not fallbacks](#four-stills-that-were-not-fallbacks).

| Still | `--only` key | Stands in for | Used by |
| --- | --- | --- | --- |
| `demo-case-answered.png` | `case-answered` | `{autoplay}` at rest: (C) credited, stamp down, coach's reading in shot | `demo-case-answer` — see below |
| `demo-answer-log.png` | `answer-log` | `/progress?tab=answers`, first tile open | `demo-case-verdict-review` — see below |
| `demo-progress.png` | `progress` | `/progress` | `demo-mega-litigation` |
| `demo-office.png` | `office` | `/office` | `demo-clients-walk-in` |
| `demo-office-tier0.png` | `office-tier0` | `/office?officeTier=0` | `demo-office-transformation` |
| `demo-map.png` | `map` | `/map` | `demo-map-and-firm` |
| `demo-focus-mode.png` | `focus-mode` | `/office` **with Focus Mode on** | `demo-focus-mode` — its only content |
| `demo-office-tier14.png` | `office-tier14` | `/office?officeTier=14&officeAll=1` | `demo-office-transformation` — the *after* half of its toggle |

#### Four stills that were not fallbacks

3.8 MB of the directory was reachable from no slide, and had been shipped in
every build since the deck was first tracked. A deployment audit found it; this
note is here because two of the four were documented as deliberate and were not.

- **`scene-office-tier0.png`, `scene-office-tier14.png`** (2.4 MB). This table
  used to call them "deck art, not fallbacks". They were neither. `73e9f3e`
  committed them as byte-identical copies of `demo-office-tier0.png` and
  `demo-office-tier14.png` — its own manifest says so — and `54d0356` then
  recaptured the originals, leaving these two as stale duplicates of an earlier
  capture of a still that is in use. Nothing has ever loaded them.
- **`demo-case.png`** (810 KB). The opening frame of the case: partner tip up,
  choices dimmed. `demo-case-answer` used to fall back to it and moved to
  `demo-case-answered.png` when the slide became the driven one, because the
  opening frame stops three seconds into a thirty-second story.
  `verify-demo-continuity.mjs` still asserts the slide does not name it.
- **`demo-firm-upgrades.png`** (533 KB). `/firm?tab=upgrades`. No slide has ever
  named it.

The last two were also entries in `recapture-stills.mjs`, which is how they
survived being noticed: an unused row in that table is not inert, it is a
generator that writes the orphan back on the next full run. The rows went with
the files, and each leaves a comment naming the route to restore if a future cut
wants the frame.

### Recapturing them

```bash
cd deck
node scripts/recapture-stills.mjs                     # all of them
node scripts/recapture-stills.mjs --only=map,office   # just the drifted ones
node scripts/recapture-stills.mjs --list              # keys and routes
```

Needs the app on `:5173`, the backend on `:5001`, and a seeded account
(`npm run reset-demo`). Roughly 15s per still, most of it deliberate settling
time for the 3D scenes; `case-answered` takes about 35s on its own, because it
waits out a full autoplay run.

Three details in there are load-bearing:

- **It refuses to write a bad frame.** Each capture is inspected before it
  replaces anything: an error card, the login screen, a spinner, or a near-empty
  document all abort that one still and leave the existing file alone. This is
  not hypothetical — an earlier version of this script wrote the app's
  "Connection interrupted" card over five good stills when the backend went down
  mid-run, and every file looked plausible in a directory listing. A missing
  recapture is obvious; a fallback showing an error screen to the room is not.
- **It captures at the embed's layout, not the projector's.** The page is laid
  out at 1152x648 — 16:9, just inside the 1150px legibility cap the stage
  applies to live embeds — and scaled up to 1920x1080 output. Same layout as the
  live embed, so the fallback does not visibly reflow at the moment of failure,
  but projector-native pixels.
- **Focus Mode is turned on for one capture and always turned back off**, in a
  `finally`. Leaving it on would gate the office, firm and map routes, so every
  game slide in the talk would open on the "put away" screen. If the script ever
  reports that it could not restore it, fix that before presenting.

To **check** a still against the route it stands in for without regenerating it,
shoot the deck twice and compare by eye:

```bash
node scripts/shoot.mjs --out=.deck-shots/live            # live embeds
node scripts/shoot.mjs --stills --out=.deck-shots/canned # forced to stills
```

Check `demo-case-answered.png` after any change to the case UI, and the office
and map stills after any change to a game scene — those are the ones under
active development.

> `demo-answer-log.png` is the one still that needs a click to exist. The
> attempt drawer has no URL — the router has no per-attempt route and the panel
> takes no parameter — so its entry in `recapture-stills.mjs` carries a
> `prepare` step that opens the first tile and scrolls to the pair of headings
> the slide points at, and a `require` list the frame is checked against before
> the bytes are kept. That check exists because this file's predecessor on that
> slide, `demo-progress.png`, rendered perfectly and showed the top of the
> dashboard instead of the review drawer: a still can be wrong without being
> broken, and a fallback that quietly stops making the slide's point is the
> worst of the three states it can be in.

> `demo-case-answered.png` is the one still whose capture takes half a minute:
> its `prepare` step lets the app's own autoplay driver play the whole sequence
> and waits for the page to stop changing, because driving it from the script
> would race it for the same controls. That replay goes through the attempt's
> idempotency key, so it writes no new row and cannot displace the tile slide 14
> depends on — but re-run `stage-demo:fast` afterwards anyway and look.
>
> Two things about its framing are worth knowing before touching it, because
> each produced a plausible-looking wrong frame first:
>
> - **The app scrolls itself when the verdict lands**, smoothly, and there is
>   nothing to await on. A `prepare` step that scrolled as soon as its selectors
>   appeared won that race on one run and lost it on the next — the same code
>   produced two different pictures, one of them with the credited choice pulled
>   off the top edge. `frameOn` waits for the document's scroll offset to go
>   quiet, sets the frame, then re-checks that the frame held.
> - **`header.app-header` is sticky and opaque, and 68px of the top of every
>   capture is behind it.** An element scrolled under it is inside the viewport by
>   every geometric measure and invisible in the photograph, so the first frame
>   that passed a strict "fully in the viewport" check still had (C) hidden behind
>   the header. Both the framing and the `require` check now measure that band and
>   treat it as off screen.

> All eight stills were regenerated on 2026-08-10 and each was eyeballed. Two
> were materially wrong before that: `demo-progress.png` was not the dashboard at
> all, and `demo-office-tier0.png` / `demo-office-tier14.png` were byte-identical
> copies of the deck's own scene art rather than captures of the app. Recapturing
> also took `demo-map.png` from 8.9 MB to 2.2 MB and `demo-office.png` from
> 7.2 MB to 2.7 MB, since the originals carried a 2x device scale factor.

---

## 7. `demo-focus-mode` is now a still — and why this frame

Accepted and done. `demo-focus-mode` was the weakest second-for-second beat in
the deck: pointed at `/progress`, it was the third visit to that route in a
four-minute talk and cost a live navigation to show the room something it had
already seen twice. It now carries `stillOnly` and paints a single frame, which
returns its seconds and removes a failure surface. The point is still spoken.

**The frame is `demo-focus-mode.png`, and it is not the dashboard.** It is
`/office` with Focus Mode on, which renders the app's focus gate. It was chosen
to carry one sentence — *the game never gates practice* — rather than merely to
show a screen, and it earns that sentence three ways at once:

- The **nav has collapsed to Dashboard and Practice**. The audience can see for
  themselves that what got taken away is the game, not the practice.
- The panel reads *"The Office is put away… Focus Mode keeps the app to the
  Dashboard and Practice — the two screens that raise a score."*
- The footnote reads *"Focus Mode is a preference, never a lock."* That is the
  claim, in the product's own words, on screen while it is spoken.

The score, case count and streak are all still in the header, so progress
visibly survives the game being switched off — which is the direction of
dependency the deck argues for: practice drives game progress, never the reverse.

`demo-progress.png` would not have carried any of that, and in fact did not even
show the dashboard before it was recaptured.

### Verifying it, and one loose end

```bash
node scripts/verify-still-only.mjs
```

That advances into the slide from the live demo run — not by deep link, which
would miss the defect — and asserts the still is alone on screen, that a real
live demo slide still embeds, that `?stills=1` still wins, and that the
unreachable-origin fallback still engages. It also compares `public/stills/`
against every slide's `still:` in both directions, before opening a browser.

It defaults to `http://localhost:5180`, the dev server. It used to be written
here with `--base=http://localhost:5185`, which is neither the dev server nor
the preview server (5181) — and the script's own default was the same 5185, so
following this line and ignoring it failed identically, on a connection refusal,
before the first check.

It exists because `stillOnly` needs **two** things to be true, and only one of
them is obvious. `demo-frame.tsx` withholds the slot so the stage cannot position
an embed over the still; `demo-stage.tsx` must *also* count `stillOnly` as a
reason to show a still, or it treats the slide as live and navigates the
surviving iframe anyway. Before the second half was added, the live `/progress`
app was painted pixel-for-pixel on top of the focus-mode still — the slide
headlined "Or delete all of it." was showing the audience a dashboard.

**Closed:** the slide's `route` was `/progress` while the still was captured at
`/office`, so the frame's caption contradicted its own picture. It is `/office`
now. Because the slide is `stillOnly` that cannot cause a load, and it matters
more than it did: the status lamp is presenter-only now (§9), so the caption and
the eyebrow are the only cues the audience gets about what they are looking at.

The office and map demos (26s combined) are worth their clock: they are the only
place the game layer is visible, and a still cannot show the tier transition that
is the whole point of `demo-office-transformation`.

---

## 8. Shooting a screenshot pass against the live demos

**Read this before judging the deck from screenshots.** A 24-slide pass once
reported that all six live-demo slides "load the app's sign-in landing page
instead of their deep-linked routes", with 24 console errors from `401`s. The
deck was fine. The harness was signed out and on the wrong spelling of
localhost, and the resulting shots looked entirely plausible: a real screenshot
of a real app, correctly framed, with the right URL printed in the chrome above
it. Nothing in the image said "this is a login screen".

### The one command

```bash
cd deck && node scripts/shoot.mjs                    # all 24 slides
cd deck && node scripts/shoot.mjs --slides=demo-case-answer,demo-map-and-firm
```

It defaults to `http://localhost:5180`, signs itself in, and suppresses the app's
guided tour. If it cannot do those things it stops and says so rather than
producing a set of misleading pictures.

### What has to be true, and what happens when it is not

Measured one variable at a time on `demo-case-answer`. The first four rows are the
original measurement, taken before the deck could sign itself in; the last row is
the same test after §10, and it is the one that matters now:

| Deck origin | Profile signed in | Deck self-signs-in | Embed lands on | API 401s |
| --- | --- | --- | --- | --- |
| `127.0.0.1:5180` | no | no | `/login` | 6 |
| `localhost:5180` | no | no | `/login` | 6 |
| `127.0.0.1:5180` | yes | no | `/login` | 6 |
| `localhost:5180` | yes | no | `/cases/<session>` | 0 |
| **`localhost:5180`** | **no** | **yes** | **`/cases/<session>`** | **2, then recovers** |

1. **The deck must be served from `localhost`, never `127.0.0.1`.** They are the
   same server and, to a browser, different *sites*. The app's session cookies
   are `SameSite=Lax`, so on the dotted spelling they are not sent into the demo
   iframes and every embed bounces to `/login` — and no amount of signing in fixes
   it, as row three shows. This is the one condition that is still fatal.
   `shoot.mjs` refuses to run against any other host and prints the corrected
   command, and the deck's dev server now binds the name `localhost`, so the wrong
   spelling refuses the connection instead of serving a broken deck.

   The four `/login` rows are what the *old* behaviour measured. Since
   2026-08-11 a hostname mismatch pins every demo to its still rather than
   framing a page that will bounce: `demo.config.ts` computes `useStills` from
   the same host comparison the table is about, so the rows now read "still"
   wherever they read `/login` for an origin reason. That is a better failure,
   not a fixed one — the room sees photographs of the product instead of the
   product — and it exists mainly to stop a deck opened anywhere else from
   embedding whatever answers on that machine's 5173.
2. **Nothing has to sign in any more.** This was the second necessary condition and
   the actual cause of the false alarm: Playwright starts with an empty cookie jar,
   so every ad-hoc harness in that run was signed out. It is no longer a condition
   at all — the deck establishes its own session during preflight (§10), which is
   what the last row of the table measures. `shoot.mjs` still posts to
   `/v1/auth/dev` itself, which only makes it faster: it skips the couple of `401`s
   and the one embed reload the deck would otherwise recover from. `--no-auth`
   leaves that to the deck.
3. **The servers must be up and the demo staged.** App on `:5173`, backend on
   `:5001` with `DEV_AUTH_ENABLED=true`, and `npm run reset-demo` run first so
   `demo.config.ts` points at sessions that exist (§1). `DEV_AUTH_ENABLED` is now
   load-bearing rather than convenient — without it the deck cannot sign itself in
   and every embed is a login screen.

### The loud signal

`shoot.mjs` reads inside each embed and, if it finds the app's sign-in page,
marks that slide `NOAUTH`, prints a banner naming every affected slide, and exits
non-zero. A signed-out demo slide can no longer be mistaken for a working one, by
a person or by an agent summarising a report.

The same principle runs the other way, which is why a clean pass prints
`[2 cancelled nav]` beside a slide rather than counting two failed requests. On a
cold profile the warm-up frames and the post-sign-in embed reload each cancel a
navigation, and a report that files those under "failed requests: 6" is a report
whose numbers get skimmed — which is how the real signal gets missed.

This class of bug — *a screenshot that looks right and is not* — has now
appeared three times in three disguises: a still that was actually the live app
painted over it (§7), five corrupted stills that all weighed a plausible 87 KB,
and this. Prefer a check that reads the pixels or the DOM over one that checks a
file exists.

### Ad-hoc harnesses

If you must write your own, the only rule left is the origin: serve and open the
deck as `localhost:5180`. `shoot.mjs` is the reference. `verify-demo-continuity.mjs`
also signs in explicitly, which is why it passed honestly on the same afternoon the
screenshot pass failed honestly — both reports were true.

One thing to know: the start card warms the app's `/office` and `/map` routes in
hidden iframes, tagged `?deck-warm=1`. A harness that finds the embed by origin
alone can pick one of those up and measure it instead of the slide's embed, so
exclude any frame whose URL contains `deck-warm`. Every script here that finds a
frame by origin does. The ones that find it by selector — `.demo-stage-frame` is
only ever the slide's embed — are immune by construction and do not need the
guard.

The other rule, which used to be undocumented because it was never true anywhere
but one laptop: get Playwright from `scripts/playwright-env.mjs`. Each harness
carried its own hardcoded module path under `/private/tmp` and its own macOS-only
Chromium lookup, so none of them ran on anything else. `launchChromium()` resolves
both, preferring the repository's own `node_modules/playwright` and letting
Playwright find the browser it downloaded. `DECK_PLAYWRIGHT` and `DECK_CHROME`
still override, as overrides rather than as the only way through.

---

## 9. Presenter-only chrome — `?hud`

Two affordances exist for the person driving and are **off by default**:

- the **status lamp** in the demo frame's title bar (`live` / `stills` /
  `connecting` / `app not running` / `no seeded session`)
- the **demo budget bar**, the depleting rule and second count

Both are instruments, not information for the room. A chip reading `STILLS` on a
projector is honest and still reads as a debug badge; a countdown tells the
audience only that the demo is timed. They follow the precedent the debug HUD
set: opt in with `?hud`, so nothing operational is on screen unless it was asked
for.

```
http://localhost:5180/            the room sees this
http://localhost:5180/?hud        rehearse with this
```

**The presenter has not lost the live-versus-still signal.** The presenter view
(`P`) now carries a `showing` line for any demo slide — `live app`, or
`still · <filename>` — coloured green or gold, driven by the same
`describeSurface()` the frame itself uses so the two cannot disagree. That screen
is not the projected one. `verify-demo-continuity.mjs` asserts both directions:
the lamp and the bar are absent by default, and `?hud` brings them back with the
lamp reading `stills` on the `?stills=1` path.

One consequence, already handled: on `demo-focus-mode` the audience's only cue
that the frame is frozen is the eyebrow ("Act V — the switch", never "live") and
the route caption, which is why that caption had to be corrected to `/office`.

---

## 10. Nobody signs in — the invisible-state defect and its fix

The startup sequence is three steps: backend, frontend, deck. **There is no
sign-in step, and there must never be one again.**

### What was actually wrong

The screenshot false alarm in §8 was a harness artifact, and stopping there would
have missed the real defect underneath it. The demos worked on this machine
because *this browser profile* had been signed in by hand at some earlier point,
and the runbook's step 4 asked the presenter to do exactly that: open the app's
login page, click **Enter local development firm**, then paste a localStorage key
into a devtools console to stop the guided tour opening over the demos.

Both were **invisible per-profile state**. Neither survives a fresh profile, a
different browser, a guest window, a cleared cookie jar, or a borrowed
projector-connected laptop — which is a fair description of presentation morning.
The deck would have looked perfect through eleven slides and then shown an
audience a login screen, and the presenter's only recourse would have been to sign
in on the projector.

That is the same shape as the three bugs in §7 and §8: *something that looks right
and is not*, deferred to the worst possible moment.

### The two fixes

**The session.** `StartGate` runs `runPreflight()` on mount — on a deep link as
well as from the start card, since a presenter who reloads mid-talk needs it just
as much. When `/v1/me` answers `401`, the preflight posts to `/v1/auth/dev`
through the deck's own `/demo-api` proxy. Three properties make that work:

- **Same-origin**, so no CORS: the proxy is why these calls are possible at all
  (see the long note in `vite.config.ts`).
- **Cookies ignore the port.** The `Set-Cookie` lands on host `localhost`, so a
  request made by the deck on `:5180` signs in the app on `:5173`. This is the
  same mechanism that makes the `localhost`/`127.0.0.1` distinction fatal, used
  deliberately.
- **`/v1/auth/dev` is in `AUTH_EXEMPT_PATHS`** and returns `404` unless
  `DEV_AUTH_ENABLED` is set, so it cannot exist in production.

It is idempotent by construction: it is only reached when `/me` has already
answered `401`, so a reload is a no-op rather than a second `AuthSession` row.

**The guided tour.** `GuidedTour` opens for any account that has not finished it,
checking `oriented || dismissed` — the server's `guided_tour_completed` or a
localStorage key. The runbook used the local half, which is per-profile. So
`stage_demo.py` now sets the server half (`guided_tour_completed_at`), which holds
for every browser at once and needs nobody to remember anything. It reports
`guided_tour: silenced now | already silenced`.

### The race, and the epoch that closes it

The deck mounts behind the start card from the first frame, so a demo iframe can
load *before* the sign-in lands, take a `/login` page, and sit on it — the URL it
was asked for never changed, so nothing would reload it.

`DemoStatus.authEpoch` is bumped when the preflight signs in. `demo-stage.tsx`
compares it against the epoch the frame's contents were loaded under, and treats a
mismatch as "the same URL will answer differently now". This is the only case in
which the stage reloads a frame whose URL it believes to be correct. On a cold
profile the cost is two `401`s and one reload, both while the title card is up. On
a warm profile the epoch never changes and nothing happens.

### Fail loudly, at the start card

The `Signed in` check no longer tells anyone to go and sign in. If automatic
sign-in is refused it says the backend needs restarting with `DEV_AUTH_ENABLED=true`
and prints the command; if it fails otherwise it says every demo will show a login
screen. Both raise the panel headed **"The live demos will not work yet"** on the
start card, with a red dot, before the talk begins.

### The only honest test

```bash
cd deck && node scripts/verify-cold-start.mjs
```

Four checks, each in a browser context created seconds earlier with an empty
cookie jar, and **nothing in it signs in**. Testing this from the profile you have
been working in passes for the wrong reason, which is precisely how the original
defect stayed hidden for so long.

1. A cold browser opens the deck, and the preflight comes back clean, an
   `lsat_session` cookie exists, the case slide embeds `/cases/<session>`, and no
   guided tour is over it.
2. A cold browser deep-links straight to a demo slide, skipping the start card.
3. A reload does not sign in again and does not replace the cookie.
4. With `/auth/dev` forced to `404`, the start card refuses to look fine and names
   `DEV_AUTH_ENABLED`.

Green on 2026-08-10, all four. If this script is ever changed so that it signs
itself in, it has stopped testing anything.

### The nine seconds that step 4 also hid

That deleted runbook step did one more useful thing: it asked the presenter to
visit `/office` and `/map` once, paying Vite's cold transform of the two scene
modules — about nine seconds each against 1.4 warm — before the talk. Deleting the
step without replacing that would have moved the stall onto the office slide.

`startWarmUp` now loads both routes in hidden, off-screen iframes while the start
card is up and discards them immediately; only the dev server's transform cache is
wanted. They are tagged `?deck-warm=1` so harnesses can tell them from a real
embed, and the queue is abandoned the moment Start is pressed.

---

## 11. Verified on Linux, 2026-08-11

Everything below was run against the full stack in a Linux VM — backend on 5001
with `AUTO_SEED=true`, the app on 5173, the deck on 5180, opened as `localhost`
throughout. It is recorded because most of it had never been run anywhere but
one laptop: until `scripts/playwright-env.mjs`, every harness in `scripts/`
imported Playwright from an absolute path under `/private/tmp` and looked for a
macOS arm64 app bundle, so on any other machine they did not fail, they asked to
be configured.

**No coaching gateway was available** (`TFY_API_KEY` and `TFY_URL` are empty), so
one thing below is a known red and one claim is untested. Both are named.

| Harness | Result |
| --- | --- |
| `verify-demo-continuity.mjs` | 27 pass, 1 fail — the fail is the gateway, below |
| `verify-demo-sizing.mjs` | all 7 demo slides, no problems |
| `verify-demo-proportion.mjs` | centred and uncut on all 7, at all 4 sizes |
| `verify-cold-start.mjs` | all green from an empty cookie jar |
| `verify-still-only.mjs` | all green |
| `verify-office-toggle.mjs` | all green, both live and stills, plus an eyeball on the four frames |
| `walk.mjs` (forward, backward, 25-press mash) | no problems, renderer memory plateaus |
| Arrow-key walk of the whole deck, three times | all 7 demo slides on their routes, nothing blank, no embed outliving its slide |

### Proportion, since it was asked about specifically

Share of the viewport taken by the painted embed, measured rather than estimated.
The founders asked for "half, if not more".

| | 1366x768 | 1600x900 | 1920x1080 | 2560x1440 |
| --- | ---: | ---: | ---: | ---: |
| the six live slides | 57.5% | 61.9% | 66.2% | 71.8% |
| `demo-focus-mode` (still) | 63.1% | 65.8% | 68.6% | 72.0% |

The copy plate is 342px wide and the embed starts at x=359 at every size, so
there is 17px of clearance and the headline cannot overlap the frame. The plate's
own height varies with its copy and its bottom sits flush to the viewport edge by
design; nothing overflows.

### What the gateway would have proved, and what stands in its place

`demo-case-answer` plays itself correctly and ends wrong. The driver engages, runs
the sequence in 19.8s against a 30s budget, selects **C** — the letter pinned as
`soloAnswerKey` — and lands the SUSTAINED stamp with no grading spinner at any
point. Then the judge says *"The answer key decides correctness. The judge coaches
your explanation"* and there is no coaching, because there is no model to have
produced it.

That is worse than an empty panel. The slide's headline claim is that the grade is
about the reasoning rather than the letter, and what it currently demonstrates is
a tick beside a letter, immediately after promising otherwise. **With a gateway
configured this is a staging artefact and not a defect** — `stage_demo.py` grades
the case once, stores it on the attempt, and the beat becomes a read.

**§3a now closes this without a gateway**, and the closing was tested here even
though the grading itself could not be: on a database rebuilt from nothing with
no `TFY_*` set, `stage_demo.py` replayed a committed capture and the slide
rendered its full coached panel — verdict line, badge and all three bench notes.
The mechanism is verified end to end. What could not be produced here is the
*text*, since capturing a real grade needs the gateway once; the run above used
a local stub standing in for it, and deliberately shipped no fixture.

So the remaining gap is one command on the laptop that already has the key:
`npm run capture-coaching`, commit the result. Until someone runs it, the
paragraph above still describes what a keyless machine shows.

If you are ever in a room without the gateway *and* without a capture:
`FORCE_STILLS = true` in `demo.config.ts`, and `demo-case-answered.png` carries
the coached frame.
