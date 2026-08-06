# Current App Audit — LSAT Speedrun

**Audit date:** Sunday, August 2, 2026
**Auditor scope:** Read-only code + database audit. No application code was modified.
**Repo:** `/Users/alan/LSATspeedrun` @ branch `main`
**Purpose:** Establish precisely and honestly what the app *actually does today*, so the launch plan is grounded in the real system rather than in the documentation's description of it.

Every claim below cites a file and line range so it can be verified. Where docs and code disagree, the code wins and the disagreement is noted.

---

## 0. Scale of the thing (measured, not estimated)

Backend Python, `backend/app/`:

| File | Lines | Role |
|---|---:|---|
| `game.py` | 1,669 | Tycoon economy, clients, assets, settlement, catalog |
| `services.py` | 1,390 | **All learning logic** — sessions, selection, SRS, metrics |
| `routes.py` | 878 | API surface (~50 endpoints) |
| `strategies.py` | 530 | Strategy catalog + A/B bandit |
| `models.py` | 492 | Data model |
| `story.py` | 383 | Chapters, quests, rival ops |
| `seed.py` | 293 | Question bank ingest |
| `coaching.py` | 252 | LLM coaching layer |
| `jobs.py` | 207 | Async AI job plumbing |
| `__init__.py`, `auth.py`, `extensions.py` | 340 | App wiring |
| **Total** | **6,434** | |

Frontend, `frontend/src/` (11,295 lines) plus `frontend/src/art/` (10,429 lines) = **21,724 lines**.

| File | Lines | Game or Study? |
|---|---:|---|
| `art/map-three-scene.tsx` | 3,789 | Game (3D empire map) |
| `mobile.css` | 3,159 | Mixed |
| `art/office-three.tsx` | 2,681 | Game (3D office) |
| `styles.css` | 2,353 | Mixed |
| `pages.tsx` | 1,622 | Mixed (all pages incl. practice) |
| `components.tsx` | 1,126 | Mixed |
| `sound.tsx` | 941 | Game |
| `art/art.css` | 935 | Game |
| `art/catalog-asset-render.tsx` | 623 | Game |
| `art/stylized-character.tsx` | 613 | Game |
| `game-art.tsx` | 613 | Game |
| `types.ts` | 502 | Shared |
| `art/stylized-counsel.ts` | 446 | Game |
| `art/unified-empire-map.tsx` + css | 587 | Game |
| `guided-tour.tsx` + css | 502 | Onboarding |
| remainder | ~1,200 | Mixed |

**Unambiguously game-only frontend code: 11,983 lines of 21,724 = 55.2%.** Adding `game.py` + `story.py` (2,052 of 6,434 backend lines) gives a whole-codebase figure of **49.8% game layer**. The other half includes auth, routing, API plumbing, and shared CSS, so the code genuinely dedicated to *learning* is well under a third of the project.

For calibration: the entire spaced-repetition implementation is **30 lines** (`services.py:888-917`). The 3D office scene is **2,681 lines**.

---

## 1. The complete learning loop, end to end

### 1.1 Cold start

`serialize_user` (`services.py:116-138`) computes `next_route`:

```130:138:backend/app/services.py
    if not user.game_profile:
        next_route = "/onboarding"
    elif active:
        next_route = f"/cases/{active.id}"
    elif diagnostic:
        next_route = f"/cases/{diagnostic.id}"
    else:
        next_route = "/progress"
```

A user with no `PlayerProfile` is routed to `/onboarding`. This is not optional: `submit_attempt` hard-fails without a game profile —

```978:979:backend/app/services.py
    if not user.game_profile:
        raise ValueError("onboarding_required")
```

— and so does `create_study_session` (`services.py:443-445`). **You cannot answer a single LSAT question in this app without first creating a lawyer character with a name, firm name, and gender.** That is a load-bearing coupling of the game layer to the study layer, not a cosmetic one.

### 1.2 The five modes

Practice styles are a fixed set (`services.py:19-35`):

```19:35:backend/app/services.py
PRACTICE_STYLES = {"deep", "speedrun", "infinite", "review"}
FEEDBACK_POLICIES = {"immediate", "delayed"}
STYLE_FEEDBACK_POLICY = {
    "deep": "immediate",
    "speedrun": "delayed",
    "infinite": "immediate",
    "review": "immediate",
}
EVIDENCE_CLASS = {
    "deep": "coached_practice",
    "speedrun": "timed_unseen",
    "infinite": "fluency",
    "review": "spaced_review",
    "diagnostic": "diagnostic",
}
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
REASONING_MIN_CHARS = {"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}
```

| Mode | Internal key | Items | Feedback | Written reasoning | Coaching | Evidence class | Game economy |
|---|---|---|---|---|---|---|---|
| Method Lab (deep) | `deep` | 10 (`PRACTICE_SESSION_SIZE`) | Immediate, blocking | **Required, ≥120 chars** | Yes, per item | `coached_practice` | **Yes — settlement fires** |
| Sprint (speedrun) | `speedrun` | 10 | **Delayed** to end of session | Required, ≥40 chars | Yes (post hoc) | `timed_unseen` | No |
| Infinite | `infinite` | Endless (1 appended per answer) | Immediate | Required, ≥40 chars | Yes | `fluency` | No |
| Review | `review` | ≤10 due cards | Immediate | **Required, ≥120 chars** | Yes | `spaced_review` | No |
| Diagnostic | `diagnostic` (mode, not style) | **75** (`DIAGNOSTIC_SESSION_SIZE`) | Delayed | **Not required** (`requires_reasoning=False`) | No mid-form | `diagnostic` | No |

Feedback policy is **not user-selectable** — passing a `feedback_policy` that disagrees with the style's mandated one raises `invalid_feedback_policy` (`services.py:453-458`). This is a good design decision and worth protecting.

Note a subtlety the docs don't state: `requires_reasoning=True` is hardcoded for *every* practice item (`services.py:500`), so Sprint — the mode whose whole point is speed under test conditions — still forces a 40-character written justification on every question. That is a meaningful contaminant of the `timed_unseen` evidence class, which is the class the readiness gate depends on (§4.6).

### 1.3 Item timing targets

`_target_time_seconds` (`services.py:174-190`) and the duplicate inline logic in `create_study_session` (`services.py:490-493`):

- Logical Reasoning: **150s** flat.
- Reading Comprehension, first question on a passage: **330s** (passage read + question).
- Reading Comprehension, continuing the same passage: **135s**.

These are reasonable per-item budgets. They are *not* section-level budgets, so a student is never actually under the real LSAT's 35-minutes-for-27-questions constraint except in the diagnostic.

### 1.4 Answer submission

`submit_attempt` (`services.py:972-1080`) does, in order:

1. Idempotency check on `Idempotency-Key` (`:981-989`) — properly implemented, including cross-user conflict detection.
2. Blocks if a debrief is unacknowledged (`:990-991`).
3. Validates the item is the *current* one (`:995-997`) — no skipping ahead, no going back.
4. Freezes the tycoon case context (`:1000-1006`).
5. Validates choice, reasoning length, confidence 1–5, strategy decision (`:1008-1033`).
6. **Clamps elapsed time to [1s, 15min]** (`:1034`) — this silently destroys the tail of the response-time distribution.
7. Grades against `question.correct_answer`, updates `SkillProgress` (`:1035-1036`).
8. Writes the `Attempt` row.
9. `_schedule_review(attempt)` (`:1062`) — SRS placement with the explanation grade still missing.
10. Advances `current_index`, sets `pending_attempt_id` iff feedback is immediate (`:1070-1071`).
11. If infinite, appends one more item; else if the session is exhausted, completes it and computes the summary (`:1072-1078`).

Then, separately, `POST /attempts/<id>/coaching` triggers `run_attempt_coaching` (`services.py:1115-1167`), which calls the LLM, settles the economy, writes the explanation grade, and **re-runs `_schedule_review`** now that the grade exists (`:1142-1154`).

### 1.5 What is recorded per answer

The full `Attempt` row (`models.py:154-197`). See §7 for the complete field inventory and the gap analysis.

---

## 2. Question selection logic

### The critical finding: selection is random, with one exclusion filter and no difficulty, adaptivity, or weakness targeting whatsoever.

Here is the entire selection function for Sprint, Method Lab, and Infinite:

```327:341:backend/app/services.py
def select_random_questions(
    count: int,
    question_type: str | None = None,
    *,
    user_id: str | None = None,
) -> list[Question]:
    query = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%"))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    eligible = query.all()
    if not eligible:
        return []
    unseen = [question for question in eligible if not user_id or question.id not in _seen_question_ids(user_id)]
    pool = unseen if len(unseen) >= count else unseen + [question for question in eligible if question not in unseen]
    return random.sample(pool, k=min(count, len(pool)))
```

That is the whole thing. `random.sample` over the unseen pool. Observations:

- **No difficulty targeting.** Impossible anyway — see §8: every one of the 6,886 questions in the database has `difficulty = 3`. The column exists (`models.py:72`) and is passed to the LLM coach (`coaching.py:101`), but it carries zero information.
- **No automatic weakness targeting.** `SkillProgress` is written on every attempt (`services.py:817-837`) and surfaced in the dashboard, but **no selection function ever reads it.** The only reads of `SkillProgress` are in `_update_skill`, `run_attempt_coaching`, and serialization. The app knows the student is bad at Flaw questions and then hands them a random question anyway.
  - **One narrow exception, and it's worth knowing about:** the dashboard's "Weakest-Link Signal" panel exposes a manual focus drill. Clicking it calls `startFocus` with the recommended `question_type` (`pages.tsx:75-78`), which flows through to the `question_type` filter in `select_random_questions`. So a *type-filtered* practice run exists — but it is **3 questions long**, opt-in, buried on the dashboard, based on the n≥3 recommendation criticized in §4.4, and available nowhere in the practice lobby. This is the seed of a real adaptive loop, already wired end to end. It just isn't used.
- **No interleaving logic.** The random draw incidentally interleaves types, which is pedagogically fine, but it is an accident rather than a design.
- **No blocking or spacing by type.** No guarantee a 10-item Sprint contains more than one question type, or fewer than 10 of the same one.
- **The `question_type` filter is exposed but almost unused.** `create_study_session` accepts it (`services.py:438`) and `routes.py:509-556` exposes it, but exactly one call site in the entire frontend sends it — the 3-question focus drill above.
- **Performance problem:** `_seen_question_ids(user_id)` (`services.py:315-324`) runs a full join query, and it is called *inside a list comprehension over all 6,886 eligible questions* (`services.py:339`). That is 6,886 database round-trips per session creation. It works today because the dev DB is small and SQLAlchemy caches, but it is an O(N) query pattern that will be visible at launch.
- The unseen-exhaustion fallback (`:340`) is correct in spirit — once you run out of unseen items it pads with seen ones — but `question not in unseen` is an O(N²) list scan over Question objects.

### Diagnostic selection is different and better

`select_diagnostic_questions` (`services.py:344-394`) builds a three-block form: LR / intact-RC / LR, targeting ⅔ LR and ⅓ RC, and critically **keeps RC passage groups intact** (`:355-364`) so a passage's questions are never split across a form. Section minutes are computed at `:383`:

```383:383:backend/app/services.py
        minutes = 35 if len(block) >= 18 else max(8, round(len(block) * 1.55))
```

This is a genuine attempt at a test-like form and is the strongest selection code in the app. It is still random *within* section, and the 2:1 LR:RC ratio does not match the current 2-scored-section LSAT (1 LR + 1 RC + 1 unscored variable), but the structural intent is sound.

### Review selection

```397:408:backend/app/services.py
def _questions_due_for_review(user_id: str, count: int) -> list[Question]:
    due = (
        ReviewQueueItem.query.filter(
            ReviewQueueItem.user_id == user_id,
            ReviewQueueItem.status == "due",
            ReviewQueueItem.due_at <= utcnow(),
        )
        .order_by(ReviewQueueItem.due_at.asc())
        .limit(count)
        .all()
    )
    return [item.question for item in due]
```

Oldest-due-first. Correct and simple.

---

## 3. The spaced repetition implementation

### 3.1 The intervals

```34:34:backend/app/services.py
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
```

Four fixed intervals: 1 day, 3 days, 7 days, 21 days. After index 4 the card is `mastered` and scheduled 21 days out but never re-surfaces (`status != "due"` excludes it from `_questions_due_for_review`).

### 3.2 Entry into the queue

`_entry_reason` (`services.py:873-885`) — the first matching condition wins:

```873:885:backend/app/services.py
def _entry_reason(attempt: Attempt, band: str | None) -> str | None:
    """First matching reason this attempt belongs in the review queue."""
    confidence = attempt.confidence or 3
    slow = attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
    if not attempt.is_correct:
        return "high_confidence_error" if confidence >= 4 else "incorrect"
    if band in {"Invalid", "Weak"}:
        return "unsupported_correct"
    if confidence <= 2:
        return "low_confidence_correct"
    if slow:
        return "slow_correct"
    return None
```

This is genuinely good design. Five distinct reasons, including two that most SRS systems miss entirely: *correct but couldn't justify it* (`unsupported_correct`) and *correct but guessed* (`low_confidence_correct`). Confidence-plus-correctness quadrant logic is a real pedagogical idea, correctly implemented.

### 3.3 Advancement and reset

```888:917:backend/app/services.py
def _advance_review(existing: ReviewQueueItem, attempt: Attempt, band: str | None, from_index: int) -> None:
    """Move a review card along the ladder according to answer and explanation."""
    if not attempt.is_correct:
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "repeat_error"
        existing.due_at = utcnow()
        return
    if band == "Invalid":
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow()
        return
    if band == "Weak":
        existing.status = "due"
        existing.interval_index = from_index
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow() + timedelta(days=1)
        return
    next_index = from_index + (2 if band == "Excellent" else 1)
    if next_index > len(REVIEW_INTERVAL_DAYS):
        existing.status = "mastered"
        existing.interval_index = len(REVIEW_INTERVAL_DAYS)
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[-1])
    else:
        existing.status = "due"
        existing.interval_index = next_index
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[next_index - 1])
```

Explanation-grade bands come from `explanation_band` in `game.py` and map to the LLM's 0–100 grade: Invalid 0–24, Weak 25–49, Good 50–79, Excellent 80–100 (`coaching.py:212`).

So the effective grade→schedule map is:

| Outcome | Effect |
|---|---|
| Wrong | Reset to index 0, due immediately |
| Right + Invalid explanation | Reset to index 0, due immediately |
| Right + Weak explanation | Hold at current index, due in 1 day |
| Right + Good explanation | +1 index |
| Right + **Excellent** explanation | **+2 indices** (skip a step) |

**Using explanation quality — not just correctness — to drive interval advancement is the single most interesting idea in this codebase.** It is a defensible operationalization of "did you actually learn it, or did you get lucky," and no mainstream SRS does it. It should be protected.

### 3.4 The two-phase grade problem, and how it's handled

`_schedule_review` runs twice: once at submit (grade missing) and once after coaching lands. The code handles this correctly via `pre_grade_interval_index` (`models.py:463`):

```939:944:backend/app/services.py
        from_index = existing.pre_grade_interval_index
        if from_index is None:
            from_index = existing.interval_index
        existing.pre_grade_interval_index = from_index if pending else None
        existing.grade_pending = pending
        _advance_review(existing, attempt, band, from_index)
```

This is careful, correct work — the provisional advance is recomputed from the pre-grade index rather than compounded. Whoever wrote this understood the failure mode.

### 3.5 How it compares to SM-2 / FSRS

| Capability | SM-2 | FSRS | LSAT Speedrun |
|---|---|---|---|
| Per-card ease/difficulty factor | Yes (EF, 1.3–2.5) | Yes (D) | **No** — every card advances identically |
| Per-card stability/memory state | Implicit | Yes (S) | **No** |
| Retrievability-based scheduling | No | Yes (R) | **No** |
| Graded recall (again/hard/good/easy) | Yes (0–5) | Yes (1–4) | Partially — via explanation band, a genuine innovation |
| Interval growth | Multiplicative, unbounded | Model-driven | **Fixed 4-step ladder, hard ceiling at 21 days** |
| Fuzz / load balancing | Optional | Yes | **No** — everything due the same day dumps at once |
| Lapse handling | EF penalty, partial reset | Stability penalty | **Full reset to 0** — maximally punitive |
| Terminal state | None (keeps growing) | None | **"mastered" at ~32 days total, never seen again** |

Concretely missing, in rough order of impact:

1. **The ladder tops out at 21 days.** A student studying for a 3-month cycle will "master" cards in month one and never see them again. There is no 60-day or 120-day interval. For an exam on a fixed future date, this is exactly backwards.
2. **No per-item difficulty.** A card the student has failed four times advances on the identical schedule as one they've never missed. `interval_index` is the *only* per-card state; there is no lapse counter, no ease factor. (`ReviewQueueItem` has no `lapses` column — `models.py:449-468`.)
3. **Full reset on every lapse.** SM-2 drops the ease factor; FSRS reduces stability. Here, a miss on a 21-day card sends it back to "due right now," identical to a card missed on day one. This produces leech cards that cycle forever with no escape hatch.
4. **No review load cap or scheduling fuzz.** `_questions_due_for_review` takes 10; if 60 are due, 50 silently wait. There is no "you have 60 due" backlog management and no jitter to prevent day-clustering.
5. **The `review` style never *adds* cards.** Note `services.py:935-945`: in review sessions, if the card isn't already in the queue the function returns early. Correct, but it means a wrong answer during review can never create a *new* related card.
6. **Review is capped at 10 items** by `PRACTICE_SESSION_SIZE`, and the daily docket caps the *displayed* target at 5 (`services.py:739`). A student with real backlog cannot clear it.

**Verdict on SRS: the entry-reason logic and the explanation-grade coupling are genuinely above-average ideas. The scheduler underneath them is a 30-line fixed ladder that is not a competitive SRS and will visibly fail any user studying longer than ~5 weeks.**

---

## 4. The measurement stack

Everything below lives in `performance_snapshot` (`services.py:1241-1390`), which powers the `/performance` dashboard.

### 4.1 The `summarize` primitive

```1249:1262:backend/app/services.py
    def summarize(values: list[Attempt]) -> dict:
        reasoning = [attempt.explanation_score * 100 for attempt in values if attempt.explanation_score is not None]
        pace_values = [attempt for attempt in values if not attempt.session_item.timer_compromised]
        pace_hits = [
            attempt.server_elapsed_ms <= attempt.session_item.target_time_seconds * 1000
            for attempt in pace_values
        ]
        return {
            "attempts": len(values),
            "accuracy": round(sum(attempt.is_correct for attempt in values) / max(1, len(values)) * 100),
            "average_seconds": round(sum(attempt.server_elapsed_ms for attempt in pace_values) / max(1, len(pace_values)) / 1000),
            "pace_adherence": round(sum(pace_hits) / max(1, len(pace_hits)) * 100),
            "reasoning": round(sum(reasoning) / len(reasoning)) if reasoning else None,
        }
```

| Metric | Formula | Honest assessment |
|---|---|---|
| `accuracy` | correct / n × 100 | **Meaningful**, but see §4.2 — it's percent-correct on a random draw from an unequated bank with no difficulty control, so it is not comparable across students or across time within a student. Drift in the random draw's difficulty is indistinguishable from learning. |
| `average_seconds` | mean server elapsed, excluding timer-compromised items | **Meaningful.** Honest exclusion of paused items is good. Undermined by the 15-minute clamp at `:1034`. |
| `pace_adherence` | % of items under the hardcoded target (150/330/135s) | **Semi-meaningful.** Measures a real thing against an arbitrary yardstick. The targets are reasonable but not empirically derived. |
| `reasoning` | mean LLM explanation grade × 100 | **Unvalidated.** This is an LLM's 0–100 judgment against a prose rubric (`coaching.py:212`). No inter-rater reliability, no human calibration, no drift monitoring across model versions. `COACHING_MODEL` is a hardcoded string (`__init__.py:109`); if it changes, every historical grade becomes incomparable and nothing records which prompt version produced which score beyond `PROMPT_VERSION` in the blob. |

### 4.2 First-attempt deduplication — a genuinely good decision

```1264:1270:backend/app/services.py
    # One first attempt per question prevents memorized repeats from inflating the
    # headline evidence while review attempts remain available in their own class.
    first_by_question: dict[str, Attempt] = {}
    for attempt in attempts:
        first_by_question.setdefault(attempt.session_item.question_id, attempt)
    first_attempts = list(first_by_question.values())
```

Headline accuracy uses only the first encounter with each item. This is the right call and prevents the most obvious way a self-reported metric inflates. Protect this.

### 4.3 The "speedrun index" — a made-up number

```1274:1274:backend/app/services.py
    overall["speedrun_index"] = round(overall["accuracy"] * .55 + reasoning_value * .25 + overall["pace_adherence"] * .20)
```

**This is the headline composite the product is named after, and its weights are arbitrary.** There is no comment, no derivation, no reference in `FEATURES.md` or `planning/PRODUCT.md` justifying 0.55 / 0.25 / 0.20. Specific problems:

- The three inputs are on different scales with different variances and are correlated (accuracy and reasoning grade especially), so the weighted sum has no defensible interpretation.
- `reasoning_value` **defaults to 0 when ungraded** (`:1273`). A brand-new student whose coaching hasn't returned yet has 25% of their headline number pinned to zero. Their index climbs when coaching lands, with no learning having occurred.
- It is not on the LSAT scale, not monotonic in any LSAT-relevant quantity, and not comparable to anything external.
- It will be read by users as a score. It is not one.

### 4.4 Skill priority — also arbitrary

```1293:1293:backend/app/services.py
    skill["priority"] = round(skill["accuracy"] * .65 + (skill["reasoning"] or 0) * .2 + skill["pace_adherence"] * .15)
```

Same criticism, different weights (0.65/0.20/0.15 vs 0.55/0.25/0.20 — no explanation for why the weighting differs between the two composites). Then:

```1361:1361:backend/app/services.py
    recommendation_skill = next((skill for skill in skills if skill["attempts"] >= 3), None)
```

**The app's single "what should I work on" recommendation is based on a minimum of three attempts.** Three items. The 95% CI on a proportion from n=3 spans essentially the whole range. This recommendation is noise, and it's the most action-guiding number on the dashboard.

Worse, since the priority is dominated by accuracy on n=3 and **selection never acts on it anyway** (§2), the recommendation is advice the app itself refuses to follow.

### 4.5 Evidence classes

```1284:1284:backend/app/services.py
    overall["evidence"] = "baseline" if len(attempts) < 10 else "emerging" if len(attempts) < 30 else "directional" if len(attempts) < 80 else "stable"
```

Thresholds 10 / 30 / 80. Round numbers, no derivation. To be fair, this is an *epistemic humility* label rather than a claim, and having one at all is better than most competitors. But "stable" at 80 attempts is generous — the standard error on accuracy at n=80 is still ±5.5 percentage points.

The `evidence_class` partition itself (`services.py:1341-1344`) — segmenting attempts into `coached_practice` / `timed_unseen` / `fluency` / `spaced_review` / `diagnostic` — is a **good idea, well executed.** Not mixing coached practice into your headline performance number is exactly right.

### 4.6 The readiness gate

```1345:1350:backend/app/services.py
    test_values = [attempt for attempt in first_attempts if attempt.evidence_class in {"timed_unseen", "diagnostic"}]
    test_performance = summarize(test_values)
    lr_samples = sum(attempt.session_item.question.section == "Logical Reasoning" for attempt in test_values)
    rc_samples = sum(attempt.session_item.question.section == "Reading Comprehension" for attempt in test_values)
    completed_diagnostics = StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").count()
    readiness_status = "ready" if lr_samples >= 40 and rc_samples >= 20 and completed_diagnostics else "forming"
```

40 LR + 20 RC + ≥1 diagnostic → "ready". Assessment:

- The **thresholds are arbitrary** (40/20 are round numbers) but land in a defensible neighborhood. 60 items is about half a real LSAT.
- The gate is honest about *what* it gates: nothing is claimed until you have data. Good.
- **But `timed_unseen` is contaminated.** Sprint items force written reasoning (§1.2), which is not a test-like condition, and Sprint has no section timer. So the "test-like" evidence pool isn't test-like.
- Nothing downstream actually changes when status flips to "ready" except a label. There is no score projection behind the gate.

### 4.7 The score projection — deliberately absent

```1337:1338:backend/app/services.py
            "projection_available": False,
            "projection_note": "A scaled score is withheld until the form has a validated conversion.",
```

`projection_available` is a **hardcoded `False`**. There is no code path that ever sets it true. The app cannot and does not predict an LSAT score.

This is **intellectually honest and I want to credit it explicitly** — the easy, dishonest move (invent a conversion table) was available and was not taken. It is also, precisely, the founder's third worry made concrete in code: *the app has written down that it cannot do this.*

### 4.8 Deltas

```1271:1278:backend/app/services.py
    recent = summarize(attempts[-20:])
    previous = summarize(attempts[-40:-20]) if len(attempts) > 20 else None
    ...
    overall["accuracy_delta"] = recent["accuracy"] - previous["accuracy"] if has_comparison else None
```

Last-20 vs previous-20, raw difference, no confidence interval, no significance test. At n=20 per window, the standard error of a difference in proportions near 60% is roughly ±15 percentage points. **Nearly every delta this dashboard shows is noise, and it is presented as change.** This is the metric most likely to make a student change their study plan for no reason.

Also note `recent = attempts[-20:]` uses *all* attempts, not first-attempts, so review repeats of previously-missed questions inflate the recent window relative to the deduplicated overall figure.

---

## 5. The strategy A/B system

### 5.1 The catalog

14 named strategies (`strategies.py:70-242`) — 8 LR, 6 RC — each with a title, a student-facing plain title, three steps, a "best for" line, and **real source citations** to LSAC, 7Sage, and PowerScore (`strategies.py:9-34`). The plain-language rewrites ("Negate the answer" / "Flip a choice around. If the argument falls apart without it, that choice was required.") are well done.

### 5.2 When trials fire

```311:312:backend/app/strategies.py
    if practice_style not in {"deep", "infinite"} or position % 4 != 2:
        return None
```

Only in Method Lab and Infinite, only on positions 2, 6, 10, … — **one item in four**. Diagnostics and Sprints are deliberately kept clean. This is correct experimental hygiene.

For a standard 10-item Method Lab session, positions 2 and 6 qualify → **2 trials per session**, of which 25% become controls → **~1.5 prompted observations per session.**

### 5.3 Candidate selection

`_candidate_keys` (`strategies.py:259-300`) picks 2–5 plausible strategies for the item using **keyword matching on the stem and stimulus**:

```284:289:backend/app/strategies.py
    causal_stimulus = any(
        token in stimulus
        for token in ("cause", "caused", "causal", "resulted in", "led to", "due to", "responsible for")
    )
    if "cause" in task_language or (causal_stimulus and any(token in task_language for token in ("strengthen", "weaken", "flaw", "explain"))):
        candidates.insert(0, "causal_audit")
```

Substring matching. `" all "` and `" no "` as conditional-logic markers (`:292-293`) will fire constantly on false positives. This is crude but low-stakes — a mismatched strategy suggestion is a minor annoyance, not a wrong answer.

**One of the 14 strategies is unreachable.** `comparative_matrix` requires the substring `"compar"` in either the question type or the passage type (`strategies.py:265`). No seeded question type contains it, and all 349 passages are typed simply `Reading Comprehension` (§8.4). So the strategy is in the catalog, shown to students, and **can never be assigned in a trial.** `FEATURES.md:803-805` independently flags this, which is further evidence the docs are honest.

### 5.4 The bandit

```326:353:backend/app/strategies.py
    seed = f"{user_id}:{question.id}:{position}:{practice_style}"
    minimum = min((len(grouped[key]) for key in candidates), default=0)
    under_sampled = [key for key in candidates if len(grouped[key]) == minimum]
    if minimum < 3:
        index = int(_stable_fraction(f"coverage:{seed}") * len(under_sampled)) % len(under_sampled)
        key = under_sampled[index]
    else:
        def score(candidate: str) -> float:
            values = grouped[candidate]
            correct = sum(value.is_correct for value in values)
            posterior_accuracy = (correct + 1) / (len(values) + 2)
            ...
            return posterior_accuracy * .50 + explanation_mean * .30 + pace * .14 + calibrated * .06

        ranked = sorted(candidates, key=lambda candidate: (score(candidate), -len(grouped[candidate]), candidate), reverse=True)
        explore = _stable_fraction(f"explore:{seed}") < .30
        key = ranked[1 if explore and len(ranked) > 1 else 0]

    variant = "control" if _stable_fraction(f"control:{seed}:{key}") < .25 else "prompt"
```

Structure: forced-coverage phase until every candidate has ≥3 observations, then greedy-with-30%-exploration on a Laplace-smoothed composite. 25% of assignments become invisible controls. Assignment is deterministic via SHA-256 seed — **reproducible and auditable, which is a real strength.**

Problems:

- **The scoring composite uses yet another set of arbitrary weights** (0.50/0.30/0.14/0.06, or 0.76/0.18/0.06 when no explanation grade exists — `:347`). Third distinct hand-tuned weight vector in the codebase.
- **"Exploration" is just picking rank 2.** Not Thompson sampling, not UCB, not ε-greedy over the full set. If there are 3+ candidates, ranks 3+ are never explored once the coverage phase ends.
- **`calibrated` is a strange metric:** `(confidence <= 3) or is_correct` (`:343`). Answering everything at confidence 3 scores a perfect 1.0 on "calibration." It's gameable and near-constant.
- Because seeds include `question.id`, the same student on the same question always gets the same assignment — fine — but the "control" draw is also keyed on the chosen strategy, so control probability is not independent of the bandit's choice.

### 5.5 The comparison, and the statistical validity problem

```468:469:backend/app/strategies.py
        status = "forming" if sample < 4 or control_sample < 2 else "directional" if sample < 8 or control_sample < 4 else "supported"
        lift = accuracy - control_accuracy if sample and control_sample else None
```

**A strategy is declared `supported` — and shown to the student as "confirmed" — at 8 prompted observations vs. 4 controls.**

This is not statistically valid, and the gap is not close. Concretely:

- n=8 vs n=4 on a binary outcome. The minimum detectable difference at 80% power and α=0.05 for two proportions near 0.6 is roughly **60 percentage points**. Anything the app can detect at this sample size is an effect size that does not exist in LSAT strategy instruction.
- **No significance test of any kind is computed.** `lift` is a raw difference of two percentages. There is no p-value, no confidence interval, no Bayesian posterior on the difference.
- **`supported` does not depend on the lift being positive or even nonzero.** Read `_result_copy` (`strategies.py:365-424`): `verdict = "confirmed" if status == "supported"`, then `helping = (lift or 0) > 0`. A lift of **+1 point** on 8-vs-4 yields the literal user-facing sentence *"Negating the answer is helping you. Keep using it when it comes up."* A lift of −1 yields *"...is not helping you. Feel free to skip it when it comes up."* **The app will confidently tell students to abandon effective LSAT strategies on the basis of a one-question difference.**
- **14 strategies tested simultaneously with no multiple-comparison correction.** At these thresholds, spurious "confirmed" verdicts are the expected outcome, not the exception.
- The comparison isn't even apples-to-apples: prompted items are matched to controls only by *candidate eligibility*, not by question difficulty (which doesn't exist), question type, or position in session. And the prompted arm is filtered to `strategy_applied is True` (`:443`) — a **self-selected** subgroup — while controls are everyone. Students who chose to apply a strategy differ systematically from those who didn't. This is a selection-biased comparison, not a randomized one, even though the randomization machinery is right there.

And the user-facing copy makes a claim the data cannot support:

```528:528:backend/app/strategies.py
            "An approach is only called confirmed after at least eight questions with it and four without. This measures your own practice, not your score."
```

The second sentence is a good hedge. The first sentence presents 8-vs-4 as if it were a rigorous bar.

**Verdict: the A/B system is well-engineered plumbing (deterministic assignment, real controls, clean isolation of measurement surfaces) wired to thresholds that are off by roughly two orders of magnitude in sample size. As shipped, it is the single largest credibility risk in the product** — a reviewer with any statistics background will find this in ten minutes, and it is exactly the kind of thing that makes "too gamified to be taken seriously" become "makes claims it can't back."

---

## 6. The gamification surface

### 6.1 Complete inventory of game mechanics

Measured from `backend/app/game.py` (1,669 lines) and `backend/app/story.py` (383 lines):

| Mechanic | Scale | Where it lives |
|---|---|---|
| **Currency (cash)** | Starts at $250, `BigInteger` | `game.py:34`, `models.py:223` |
| **Reputation** | 0–100 float, decays after 48h away | `game.py:40`, `models.py:224` |
| **Office tiers** | **14 tiers** | `game.py:47` `FIRM_TIERS` |
| **Upgrades** | **28 purchasable** | `game.py:81` |
| **Staff** | **24 hireable** | `game.py:147` |
| **Connections** | **10** | `game.py:204` |
| **Rivals** | **10** | `game.py:237` |
| **Cosmetics** | **14** | `game.py:274` |
| **Clients** | **27**, each with fee multipliers and unlock gates | `game.py:309` |
| **Story chapters** | **24**, with branching choices | `story.py:7` |
| **Quests** | **19** | `story.py:115` |
| **Rival operations** | **5** | `story.py:138` |
| **Ethics / Heat / Influence / Intel** | 4 hidden RPG stats | `models.py:281-284` |
| **Streaks** | current + best, feeds payout bonus | `models.py:226-227` |
| **Daily rewards** | milestones at 5/10/20 cases, ×1/×3/×8 | `game.py:35` |
| **Passive income** | Accrues offline from owned assets | `game.py:753`, `game.py:1215` |
| **Rent / arrears** | Daily rent, offline rent at ⅕ rate, 3-day arrears cap | `game.py:39-43` |
| **Reputation decay** | −N/day after 48h inactivity | `game.py:40, 545` |
| **Ledger** | Full double-entry-ish transaction log | `models.py:398-411` |
| **Achievements** | Derived | `game.py:791` |
| **Sound engine** | 941 lines, procedural WebAudio, **unmuted by default** (`sound.tsx:112`) | `sound.tsx` |
| **3D scenes** | Three.js office (2,681 ln) + empire map (3,789 ln) | `art/office-three.tsx`, `art/map-three-scene.tsx` |
| **Opposing counsel** | Procedurally generated rival lawyer with taunt lines per question | `components.tsx:818-828`, `art/stylized-counsel.ts` |
| **Guided tour** | 7 steps, all 7 pointing at navigation/chrome | `guided-tour.tsx:42-104` |
| **Cutscenes** | Story chapter popups | `game-art.tsx:145` |

That is **93 catalog entries with a `key`** in `game.py` alone, plus 48 story objects. For comparison, the app has **14 study strategies** and **4 review intervals**.

### 6.2 The click path to a question — counted

**New user, first question:**

1. `/login` → Google sign-in *(1 click)*
2. Redirect to `/onboarding` (forced — `services.py:130-131`)
3. Pick character gender *(1 click)*
4. Type lawyer name *(typing; prefilled from Google display name)*
5. Type **firm name** *(typing; required, min 2 chars — `pages.tsx:548`)*
6. Click "Open the doors" *(1 click)*
7. Land on `/progress` (the performance dashboard, which is empty)
8. Navigate to `/cases` *(1 click)*
9. Optionally pick a mode; Sprint is the default *(0 clicks)*
10. Click "Start 10-question Sprint" *(1 click)*
11. Question 1 renders.

**Five clicks plus two mandatory text fields, one of which is fictional-firm-naming.** There is no "skip" on onboarding and no guest/anonymous path. The `GuidedTour` may also fire on top of this (7 steps).

**Returning user, best case:** `/cases` is in the primary nav (`components.tsx:123`), so it is **2 clicks** — nav → Start. That is genuinely fast and comparable to any drilling app.

But note the default landing page for a returning user with no active session is `/progress`, not `/cases` (`services.py:129`).

### 6.3 How much game layer is unavoidable *inside* the question screen

This is the most important — and most surprising — finding in this section, and it is **good news the founder may not be aware of**:

```558:559:frontend/src/components.tsx
  const compactReview = session.practice_style !== 'deep'
  const learningOnly = session.practice_style !== 'deep'
```

`learningOnly` is true for **Sprint, Infinite, and Review**. When it's true, `QuestionFlow` renders a plain "learning mode banner" instead of the tycoon chrome (`components.tsx:801-829`). The client portrait, the base fee, and the opposing-counsel taunt bubble **only appear in Method Lab (`deep`)**.

Confirmed on the backend too — `_freeze_current_case` refuses to attach economy context to anything but deep practice:

```204:218:backend/app/services.py
def _freeze_current_case(item: SessionItem, user: User) -> bool:
    """Adopt only the visible unfinished case into the tycoon economy."""
    if (
        item.session.mode == "diagnostic"
        or item.session.practice_style != "deep"
        ...
    ):
        return False
```

**So a student who picks Sprint gets: a section tag, the question type, a progress counter, a timer with target, the passage/stimulus, five choices, a confidence selector, and a 40-character reasoning box. No money, no client, no rival lawyer.** That screen would not embarrass anyone. The gamification is already segregated by mode, and that architectural decision is worth a great deal.

What *is* unavoidable:

- **Character creation before any question** (§6.2) — hard blocker in `submit_attempt:978`.
- **The `/office`, `/firm`, `/map` nav items** are always in the header (`components.tsx:121-127`). 3 of 5 primary nav destinations are pure game.
- **Sound is on by default** (`sound.tsx:112` — `muted: false`) and plays on navigation, selection, tab changes, page turns, and verdicts. There is a control in the header, but the first-run experience is noisy.
- **The vocabulary is game vocabulary everywhere.** Sessions are "cases," the practice lobby is the "docket," the dashboard header says "HQ LEVEL," `/progress` is labeled "Training," questions completed is `cases_completed`.
- **The diagnostic reminder banner** appears app-wide until you take the diagnostic (`components.tsx:273-275`).
- **Story cutscenes** can fire on `/office` (`pages.tsx:722`).

### 6.4 Honest read

The founder's worry — *"too gamified to be taken seriously"* — is **half right, and it's the half that's cheap to fix.**

- The *practice experience itself* is already clean in 3 of 5 modes. That is the expensive part and it's done.
- The *framing* — mandatory character creation, "Open the doors," firm naming, 3D office, default-on sound, "cases" everywhere, 3 of 5 nav slots pointing at a tycoon game — is what a skeptical prospective law student sees in the first 60 seconds, and it reads as a game with LSAT questions in it rather than an LSAT tool with a game attached.
- The ratio backs this up: **~49% of the codebase is game layer, versus 30 lines of spaced repetition and zero lines of adaptive selection.**

The credibility problem is not that gamification exists. It's that the gamification is *more sophisticated than the pedagogy*, and a discerning user will feel that even if they can't articulate it.

---

## 7. What data is and isn't recorded

### 7.1 Captured per attempt (`models.py:154-197`)

| Field | Notes |
|---|---|
| `selected_label` | The chosen letter |
| `is_correct` | Against the verified key |
| `reasoning_text` | Up to 4,000 chars |
| `confidence` | 1–5, CHECK-constrained |
| `answer_changed` | Boolean — did they switch |
| `strategy_key`, `strategy_variant`, `strategy_applied`, `strategy_prompt_ms` | Full A/B provenance |
| `evidence_class` | Which of 5 practice contexts |
| `explanation_score` | LLM grade, normalized 0–1 |
| `server_elapsed_ms` | Authoritative timing |
| `client_elapsed_ms` | **Column exists; always written as `None`** (`services.py:1053`) |
| `feedback_json` | Full coaching blob including per-choice explanations |
| `coaching_status`, `coaching_model`, `coached_at` | Coaching provenance |
| `capm_points`, `pace_scored`, `xp_earned` | **Dead columns — always 0** (`services.py:1054-1056`) |
| `idempotency_key` | Exactly-once |

Per session item (`models.py:124-151`): position, section index, `requires_reasoning`, target time, `timer_compromised`, `served_at`, `active_elapsed_ms`, pause timestamps, drafts.

Per session (`models.py:98-121`): mode, practice style, feedback policy, status, target minutes, accommodation multiplier, section plan, `summary_json`, `results_seen_at`, `summary_seen_at`.

**Credit where due: `timer_compromised`, `evidence_class`, `answer_changed`, and confidence are all things most competitors don't capture.** The instrumentation *intent* is above average.

### 7.2 What is missing — the actionable list

Ordered by how much it blocks serious measurement or score prediction.

1. **Item difficulty parameters (IRT `a`, `b`, `c`).** The `difficulty` column exists but is **uniformly 3 for all 6,886 items** (verified in the DB). Without a per-item difficulty, accuracy is uninterpretable, adaptivity is impossible, and no score conversion can ever be built. **This is the single biggest data gap and it blocks nearly everything else.**
2. **Answer-choice-level selection counts.** `selected_label` is stored per attempt, but there is no aggregate per-item distractor table. You cannot compute item discrimination, spot miskeyed items, or identify which distractor is the trap — even though the coaching layer already writes a per-choice explanation for every item.
3. **Per-item exposure counts.** No `times_served` on `Question`. `_seen_question_ids` recomputes per user by joining attempts (`services.py:315-324`). No global exposure control, so nothing prevents item overexposure or supports item retirement.
4. **Response-time distribution, unclamped.** `server_elapsed_ms` is clamped to [1s, 15min] at `services.py:1034`. The tail is gone. There is also no per-item *normative* time (only the hardcoded 150/330/135), so "slow" is relative to a guess.
5. **Review-interval outcome logging.** `ReviewQueueItem` stores only current `interval_index` and `due_at` (`models.py:449-468`). There is **no history table**: no record of what interval a card was at when it was reviewed, whether it was recalled, or how long since last review. Without this you can never fit an FSRS-style model or even validate that the 1/3/7/21 ladder works.
6. **Lapse count per card.** No `lapses` column. Leeches are invisible.
7. **Section-level fatigue signals.** Nothing records position-within-session accuracy decay, time-of-day, session-number-that-day, or cumulative minutes before the item. `section_index` exists but only the diagnostic sets it non-zero.
8. **Scroll / reading behavior on RC passages.** Nothing. For RC the passage read time is bundled into the first question's elapsed time, so you cannot separate reading speed from question-answering speed — a first-order diagnostic distinction for RC.
9. **Eliminated-choice data.** No "cross out" tracking. `answer_changed` is a single boolean, not a sequence.
10. **Item-level flag/report from students.** No way for a user to report a bad item, and given the bank is machine-parsed from Hugging Face, bad items will exist.
11. **A/B trial pre-registration and outcome table.** Trials are reconstructed by querying `Attempt` (`strategies.py:428-433`). There is no `StrategyTrial` row, so an assignment that never produced an attempt is invisible and the denominator can't be verified.
12. **Coaching-grade provenance for reproducibility.** `coaching_model` is stored on the attempt, but `PROMPT_VERSION` only lives inside the JSON blob. No index, no migration story if the rubric changes.
13. **Anything resembling a scaled score history.** No `ScoreEstimate` table, no timeline of predicted score. `projection_available` is hardcoded `False` (`services.py:1337`).
14. **Cohort/normative data.** Everything is within-user. There is no aggregate item statistics table, so even with 10,000 users the app would derive nothing from them.

---

## 8. Content inventory

### 8.1 What's actually in the bank (measured from `backend/instance/lsat_sherlock.db`)

**6,886 questions, 349 passages, 34,430 answer choices** (exactly 5 per question, no exceptions).

| Section | Questions | % |
|---|---:|---:|
| Logical Reasoning | 4,520 | 65.6% |
| Reading Comprehension | 2,366 | 34.4% |

**Logic Games: zero.** Verified directly —

```sql
select count(*) from questions where section like '%Game%' or question_type like '%Game%' or question_type like '%Analytic%';
-- 0
select distinct section from questions;
-- Logical Reasoning
-- Reading Comprehension
```

The app contains **no obsolete Logic Games content**. This is correct for the post-August-2024 LSAT and is a real (if accidental) advantage — the upstream `tasksource` datasets simply never included AR.

### 8.2 Question type breakdown — and the labeling problem

| Section | Type | Count |
|---|---|---:|
| LR | **"Logical Reasoning" (untyped)** | **1,784** |
| LR | Flaw | 652 |
| LR | Assumption | 432 |
| LR | Principle | 336 |
| LR | Inference | 319 |
| LR | Resolve the Paradox | 269 |
| LR | Weaken | 261 |
| LR | Strengthen | 178 |
| LR | Main Conclusion | 113 |
| LR | Parallel Reasoning | 93 |
| LR | Argument Structure | 83 |
| RC | **"Reading Comprehension" (untyped)** | **1,373** |
| RC | Inference | 465 |
| RC | Main Point | 291 |
| RC | Analogy | 88 |
| RC | Author's Perspective | 75 |
| RC | Function | 74 |

**3,157 of 6,886 questions (45.9%) have no real question type** — they carry a placeholder equal to their section name. Consequences:

- The `SkillProgress` dashboard's largest "skill" for most users will be a bucket literally named "Logical Reasoning," which tells the student nothing.
- `_skill_breakdown` (`services.py:1170-1181`) and the skill priority ranking are computed over these buckets, so nearly half the data lands in a meaningless category.
- The strategy bandit's `_candidate_keys` falls back to keyword matching on the stem partly *because* the type label is so often absent (`strategies.py:259-300`).

Sub-type coverage is also thin where it matters: **93 Parallel Reasoning** and **83 Argument Structure** items across the whole bank. A student who is weak on Parallel Reasoning cannot get sustained practice on it even if weakness targeting existed.

### 8.3 Difficulty

```sql
select difficulty, count(*) from questions group by 1;
-- 3|6886
```

**Every item is difficulty 3.** The default in `models.py:72` was never overwritten by the seeder. The column is inert.

### 8.4 RC passage structure

349 passages, all typed `Reading Comprehension` (no `comparative` flag is ever set, which means the `comparative_matrix` strategy's passage-type check at `strategies.py:265` can only ever fire on the `question_type` half of its condition).

Questions per passage: mostly 5–8 (40 passages with 5, 98 with 6, 125 with 7, 81 with 8), plus a handful of outliers (two passages with 16 questions, one with 4). Realistic LSAT sets are 5–8 questions, so this is good.

### 8.5 Exhaustion math

`select_random_questions` prefers unseen items per user (`services.py:339-340`). Time to first forced repeat:

| Questions/day | Days to exhaust 6,886 | Practical read |
|---:|---:|---|
| 10 | 689 | Never a problem |
| 20 | 344 | ~11 months — fine |
| 30 | 230 | ~7.5 months — fine |
| 50 | 138 | ~4.5 months — fine for most prep cycles |
| 100 | 69 | ~2.3 months — a serious user on a 3-month cycle **will** exhaust it |
| 150 | 46 | Exhausted inside 7 weeks |

**Overall bank size is adequate; the composition is not.** The binding constraint arrives far sooner at the type level. A student who wants to drill Parallel Reasoning exhausts all 93 in **under two weeks** at 10/day of that type — and today they can't even request that, since the `question_type` filter is not wired to the UI (§9).

Also note the exhaustion fallback silently degrades: once `unseen` is smaller than the requested count, the pool becomes unseen + *all* seen items and `random.sample` draws from the union — so a student near exhaustion starts getting repeats mixed into "fresh" Sprints with no notice, and those repeats **are excluded from headline accuracy** by the first-attempt dedup (`services.py:1264-1269`) but **are included in the `recent` 20-attempt window** (`services.py:1271`). That asymmetry will make the recent-vs-overall delta drift upward for no reason.

### 8.6 Provenance and licensing status (current state as recorded in code)

Every question comes from two Hugging Face datasets (`seed.py:23`, `manifest.json`):

- `tasksource/lsat-lr` @ revision `57716ef1…` — 4,520 items
- `tasksource/lsat-rc` @ revision `f0923a19…` — 2,366 items

The snapshot is checksummed per split (SHA-256 in `manifest.json`), which is genuinely good engineering hygiene.

Every row is stamped:

```229:229:backend/app/seed.py
    question.license_status = "upstream_terms_apply"
```

and the bank's own README states plainly:

> The upstream dataset cards do not currently declare a license. Confirm that your use complies with the dataset terms and applicable LSAT content rights before distributing or commercializing this material.

That is **100% of the content in the app, with 1.5 weeks to a public launch, sitting on an undeclared license and almost certainly derived from copyrighted LSAC material.** The code is honest about this; the launch plan needs to be too. (The content-licensing workstream owns the resolution; this audit just confirms the exposure is total rather than partial — there is no clean-licensed subset to fall back to.)

Note also `review_status = "published"` on all 6,886 rows despite the model's default being `machine_parsed_needs_review` (`models.py:79`) — meaning something bulk-promoted machine-parsed content to "published" without human review. There is no per-item review workflow anywhere in the codebase.

---

## 9. Technical debt and half-built things (learning-relevant only)

There are **no `TODO`/`FIXME`/`HACK` comments anywhere in `backend/app` or `frontend/src`.** The codebase is unusually clean in that respect, and the comments that do exist are substantive explanations of *why*, not narration. This is a well-maintained project. The debt below is structural, not sloppy.

### 9.1 Dead columns still on the hot path

| Field | Status |
|---|---|
| `Attempt.capm_points` | Written as literal `0` (`services.py:1054`), read nowhere. Vestige of a removed scoring system. |
| `Attempt.pace_scored` | Written as literal `False` (`services.py:1055`), read nowhere. |
| `Attempt.xp_earned` | Written as literal `0` (`services.py:1056`), read nowhere. |
| `Attempt.client_elapsed_ms` | Explicitly written as `None` (`services.py:1053`). **The frontend has the client-side clock and never sends it.** This is a free, already-modeled channel for detecting tab-switching and clock tampering, sitting unused. |
| `ReviewQueueItem.learner_rule` | Defined (`models.py:460`), **never written or read anywhere.** This was clearly meant to hold the student's own "if/then" transfer rule — the coaching layer already generates exactly this in `next_step_hint` (`coaching.py:209`). A wrong-answer journal is 80% built and 0% connected. |
| `User.story_intro_seen` | Defined (`models.py:29`), never used. |

### 9.2 Orphaned database tables

The live database contains four tables with **no corresponding SQLAlchemy model**, left behind by migrations `0001`, `0002`, and `0010`:

```
review_cards       0 rows   -- superseded by review_queue_items
story_progress     3 rows   -- superseded by player_story_states
hint_events        0 rows   -- a hint system that was removed
case_frames        0 rows   -- removed
```

`story_progress` still holds 3 rows of live-looking data. Harmless today, but it means a migration was written without a data cleanup, and `hint_events` suggests a hint/scaffolding feature was built and then deleted.

### 9.3 Backend features not surfaced in the UI

1. **Accommodation multipliers.** `create_diagnostic_session` supports 1.0×, 1.5×, and 2.0× time (`services.py:519-520`), plumbed all the way through section plans and per-item targets. The frontend hardcodes `api.startDiagnostic(1)` (`pages.tsx:65`). **Testing-accommodations support is fully built on the backend and completely invisible.** This is a real accessibility and market-segment feature that is one dropdown away from shipping.
2. **`question_type`-filtered practice** — only reachable via the 3-question dashboard drill (§2).
3. **Async coaching via SQS/Lambda.** `jobs.py` (207 lines) plus `routes.py:809-813` implement a full durable job queue with dedup keys and retry counts. `AI_JOBS_MODE` defaults to `"sync"` (`__init__.py:111`). At launch, every coaching request is a **synchronous, blocking, 120-second-timeout LLM call** (`coaching.py:80`) with `reasoning_effort: "xhigh"` (`__init__.py:110`). This is a latency and cost bomb under concurrency, and the fix is already written and switched off.
4. **`StudySession.results_seen_at`** is set by an endpoint but nothing reads it; only `summary_seen_at` drives the daily docket (`services.py:730-732`).

### 9.4 Structural issues in the learning path

1. **Duplicated target-time logic.** `_target_time_seconds` (`services.py:174-190`), the inline block in `create_study_session` (`:490-493`), and `_append_infinite_item` (`:843-845`) each recompute the same 150/330/135 rule independently. Three copies, already slightly divergent in how they look up the previous item.
2. **N+1 query in question selection.** `_seen_question_ids` is called inside a comprehension over all eligible questions (`services.py:339`) — 6,886 invocations per session start.
3. **`performance_snapshot` loads every attempt the user has ever made** (`services.py:1242-1247`) and recomputes everything in Python on every dashboard load. No caching, no materialized rollups. At 5,000 attempts this becomes seconds.
4. **`calculate_session_summary` is recomputed on read** when `summary_json` is absent (`services.py:1309`, `:1329`) inside a loop over 10 sessions.
5. **Coaching failure has no retry surface for the student.** If `CoachingProviderError` fires, `coaching_status` becomes `"failed"` (`services.py:1134-1138`) — and in **Method Lab that also means the economy never settles**, because `settle_attempt` only runs inside `run_attempt_coaching`. A student can be left with an unpaid case and no explanation.
6. **`session_review` is called inside `daily_docket_snapshot`** just to count priority items (`services.py:727`), pulling every attempt and question for the day's sprint on every docket load.

### 9.5 Test coverage

77 backend tests (`test_flow.py` 64, `test_game_catalog.py` 10, `test_migration_integrity.py` 3) across 3,022 lines. Substantial. **There are no frontend tests.**

### 9.6 Documentation accuracy

`FEATURES.md` (59 KB) is **accurate and unusually self-critical.** It states plainly:

> **No adaptive difficulty.** Every seeded question has `difficulty = 3`, so selection is uniform random within the eligible pool… The `difficulty` column exists and is passed to the coach, but nothing varies it. *(FEATURES.md:800-802)*

and

> …difficulty targeting and no adaptive sequencing. That is not an oversight in the selector so much as a limitation of the data. *(FEATURES.md:81-83)*

`docs/LSAT_STRATEGY_EXPERIMENTS.md` is likewise careful, explicitly refusing to claim a 170 guarantee and laying out a four-tier evidence hierarchy. **The documentation is not stale and is not overselling.** The founder already knows most of what's in this audit; what the docs don't do is quantify the consequences (§4, §5, §8.2).

---

## 10. The honest verdict on the three worries

### Worry 1: *"It's too gamified to be taken seriously."*

**Partially true, and it's the cheap half.**

What the code supports: the *question-answering experience* is already de-gamified in Sprint, Infinite, and Review (`components.tsx:558-559`, `services.py:204-218`). Those three screens are clean, professional, and would not embarrass anyone. That is the hard architectural work and it's already done.

What the code also supports: **you cannot answer one question without naming a fictional law firm.** Sound is on by default. Three of five nav slots are pure tycoon game. The codebase is ~49% game layer. There are 93 game catalog entries and 14 study strategies. There are 2,681 lines rendering a 3D office and 30 lines of spaced repetition.

The real risk is not the game. It's the **ratio**. A prospective student who looks closely finds that the most sophisticated system in the product is the rent-accrual model, and that will register as unserious regardless of how clean the question screen is.

**Fixable in days, not weeks**: an optional/skippable onboarding, sound off by default, `/cases` as the default landing route, and neutral labels available. None of that requires touching the game.

### Worry 2: *"The iterative practice loop may not be pedagogically effective."*

**The loop is well-designed at the top and hollow underneath.**

Genuinely effective components, in the code:
- Forced written justification before the answer counts (`services.py:1012-1016`) — retrieval + generation, exactly right.
- Confidence capture and the confidence×correctness quadrant driving review entry (`services.py:873-885`) — this is calibration training and almost nobody does it.
- Delayed feedback in Sprint (`services.py:22-26`) — deliberate desirable difficulty.
- Explanation quality, not just correctness, gating SRS advancement (`services.py:908`) — a real idea.
- Evidence-class segregation so coached practice never contaminates the headline number (`services.py:1341-1344`).
- Per-choice explanation of all five options on every coached item (`coaching.py:157-158` *enforces* it).

What is hollow underneath:
- **Question selection is `random.sample`.** No difficulty, no adaptivity, no automatic weakness targeting. The loop measures a weakness and then does nothing with it.
- **The SRS is a 4-step fixed ladder that tops out at 21 days**, with no per-card difficulty, no lapse tracking, full reset on miss, and a hard 10-item-per-session cap. It will fail any student on a cycle longer than ~5 weeks.
- **Half the bank has no question type**, so "practice your weak types" is impossible for 46% of items even in principle.
- **Nothing closes the loop.** `learner_rule` — the field designed to hold the student's own transfer rule — is never written, even though the coach generates exactly that text on every item.

So: the *epistemics* of the loop are unusually good, and the *machinery* is unusually thin. A student who uses Method Lab diligently is doing genuinely effective things — writing explanations, getting graded on them, revisiting misses. They are just doing those things on a random sequence of items with a naive review schedule. That will produce real improvement, but far less than the design implies and with no way to know how much.

### Worry 3: *"It cannot benchmark or predict real LSAT improvement."*

**Correct, unambiguously, and the code already says so.**

```1337:1338:backend/app/services.py
            "projection_available": False,
            "projection_note": "A scaled score is withheld until the form has a validated conversion.",
```

`projection_available` is a hardcoded `False` with no code path that sets it true. There is no scaled score, no percentile, no projection, no score-history table.

And it *cannot* be built on the current data, for four independent blocking reasons:

1. **No item difficulty.** All 6,886 items are `difficulty = 3`. Without item parameters there is no equating, no IRT, no scaled score. This alone is fatal.
2. **No normative data.** Nothing aggregates across users. Even with 10,000 users the schema derives nothing from them.
3. **The diagnostic form isn't a form.** 75 randomly drawn items in a 2:1 LR:RC split with per-item timers and no section clock. It's a sample, not a test.
4. **The one composite that looks like a score — `speedrun_index` — is three metrics blended with arbitrary weights** (`services.py:1274`), one of which defaults to zero when coaching is pending.

What the app *can* honestly claim today: within-user, first-attempt-deduplicated accuracy on an unequated random draw, segmented by practice context, with an explicit evidence-strength label. That is a real and defensible thing. It is not a score, and the readiness gate (40 LR + 20 RC + 1 diagnostic — `services.py:1350`) gates a *label*, not a projection.

**The honest framing for launch is that the app measures practice, not readiness.** The code is already written that way; the marketing must match it.

---

## Current-state summary table

| Subsystem | What it actually does | Rating | One-line justification |
|---|---|---|---|
| **Question selection** | `random.sample` over unseen items; optional type filter used in one 3-question drill | **Poor** | No difficulty, no adaptivity, no automatic weakness targeting — `services.py:327-341` is the whole algorithm |
| **Spaced repetition — entry logic** | 5 reason codes incl. `unsupported_correct` and `low_confidence_correct` | **Strong** | Confidence×correctness×explanation-quality gating is better than most commercial SRS (`services.py:873-885`) |
| **Spaced repetition — scheduler** | Fixed 1/3/7/21 ladder, full reset on miss, "mastered" at ~32 days | **Poor** | 30 lines, no per-card state, hard ceiling; breaks for any cycle >5 weeks (`services.py:888-917`) |
| **Practice modes** | 5 modes with enforced feedback policies and evidence classes | **Strong** | Server-enforced policy, clean measurement-surface isolation (`services.py:19-33`, `453-458`) |
| **Written-explanation requirement** | Enforced server-side with per-mode minimums | **Strong** | Real retrieval practice; can't be skipped (`services.py:1012-1016`) |
| **LLM coaching** | Per-choice explanation of all 5 options, first-error diagnosis, 0–100 grade | **Good** | Well-guarded prompt, strict validation, injection-aware; but unvalidated grading and sync-by-default |
| **Diagnostic** | 75 items, LR/RC/LR blocks, intact passages, delayed feedback, no coaching | **Fair** | Structurally sound form-building; not equated, not a real test, 2:1 ratio doesn't match current LSAT |
| **Performance metrics** | Accuracy, pace, reasoning, deltas, evidence classes | **Fair** | First-attempt dedup and evidence segregation are excellent; deltas at n=20 are noise |
| **`speedrun_index`** | `0.55·acc + 0.25·reasoning + 0.20·pace` | **Poor** | Arbitrary weights, no derivation, defaults reasoning to 0, reads as a score but isn't |
| **Weakness recommendation** | Lowest composite skill, min 3 attempts | **Poor** | n=3 is noise, and selection ignores it anyway (`services.py:1361`) |
| **Score prediction** | Hardcoded `False` | **Absent (honestly)** | Genuinely cannot be built on current data; refusing to fake it is the right call |
| **Strategy A/B — plumbing** | Deterministic hashed assignment, 25% control, sparse trials, clean surfaces | **Strong** | Reproducible and auditable; measurement hygiene is real (`strategies.py:303-356`) |
| **Strategy A/B — statistics** | "Confirmed" at n=8 vs n=4, no significance test, 14 simultaneous comparisons | **Dangerous** | Will confidently tell students to abandon good strategies on a 1-question difference (`strategies.py:468`, `385-386`) |
| **Game economy** | 14 tiers, 93 catalog items, rent, reputation, streaks, passive income | **Strong (as a game)** | Genuinely well-built: ledger, idempotent settlement, exactly-once constraints |
| **Story / quests** | 24 chapters, 19 quests, 5 rival ops, 4 hidden stats | **Strong (as a game)** | Substantial authored content |
| **Game/study separation** | Economy only touches `deep` mode; other modes render clean | **Strong** | Enforced on both client (`components.tsx:558`) and server (`services.py:204-218`) |
| **Onboarding** | Mandatory character + firm creation before any question | **Poor** | Hard blocker at `services.py:978`; no guest or skip path |
| **Data model** | Rich per-attempt capture: confidence, evidence class, timer integrity, strategy provenance | **Good** | Above-average instrumentation intent, with 6 dead columns and key gaps (§7.2) |
| **Content bank** | 6,886 items, no Logic Games, 5 choices each, checksummed | **Fair** | Adequate volume, correct sections; uniform difficulty and 46% untyped are crippling |
| **Content licensing** | 100% Hugging Face, `upstream_terms_apply`, no declared upstream license | **Critical risk** | Total exposure, no clean subset, 1.5 weeks to launch |
| **Code quality** | Zero TODOs, substantive comments, 77 backend tests, honest docs | **Strong** | This is a well-engineered codebase — the problems are of emphasis, not craft |
| **Performance/scale** | N+1 in selection, full-history recompute on dashboard, sync LLM calls | **Fair** | Fine today, will hurt at launch traffic; async path already written but off |

---

## The 15 highest-leverage gaps

Ranked by (learning-quality impact + credibility impact) ÷ cost. File paths and rough effort included.

### 1. Fix the A/B "confirmed" thresholds before launch
**Files:** `backend/app/strategies.py:468`, `:365-424`, `:528`
**Cost: 2–4 hours.** Raise thresholds substantially (n≥30/30 as a floor), add a proper interval or Bayesian posterior on the lift, require the interval to exclude zero before saying "confirmed," and change "is helping you" / "feel free to skip it" to something a statistician wouldn't wince at. Also fix the selection bias: compare *assigned-prompt* vs *control*, not *applied-prompt* vs control. **This is the single fastest way to remove the biggest credibility landmine, and it is a same-day change.**

### 2. Add item difficulty parameters
**Files:** `backend/app/models.py:72`, `backend/app/seed.py:225-229`, new backfill script
**Cost: 3–10 days depending on method.** Everything downstream is blocked on this: adaptivity, weakness targeting, score conversion, item quality control. Interim options that don't require calibration data: (a) LLM-estimated difficulty on all 6,886 items — a few hours of compute, imperfect but nonzero information; (b) proxy features (stimulus length, choice-text similarity, question type) — a day; (c) accumulate real p-values from live attempts and backfill — free but slow. **Do (a) now and (c) continuously.**

### 3. Extend the SRS ladder and add per-card state
**Files:** `backend/app/services.py:34`, `:888-917`; `backend/app/models.py:449-468`
**Cost: 2–3 days.** Add intervals beyond 21 days (1/3/7/16/35/70/120), add `lapses` and `ease`/`stability` columns, replace full-reset-on-miss with a graded penalty, add a leech threshold, and log every review outcome to a new history table so a real model can be fitted later. The entry-reason logic is already good — this is only the scheduler.

### 4. Backfill real question types on the 3,157 untyped items
**Files:** database + a new script alongside `backend/scripts/snapshot_question_bank.py`
**Cost: 1–2 days.** 46% of the bank is labeled with its own section name. This breaks skill breakdown, weakness targeting, focused drills, and the strategy bandit's candidate matching. An LLM classification pass against a fixed LR/RC taxonomy is straightforward and independently verifiable on a sample.

### 5. Kill or rebuild `speedrun_index`
**Files:** `backend/app/services.py:1274`, `:1293`; `frontend/src/pages.tsx`
**Cost: 2 hours to remove, 1–2 days to replace.** Either delete it, or replace it with something with a stated derivation and a visible uncertainty band. Right now the product's namesake metric is three numbers multiplied by guesses.

### 6. Wire weakness targeting into actual selection
**Files:** `backend/app/services.py:327-341`, `:433-508`
**Cost: 1–2 days.** `SkillProgress` is already written, the `question_type` filter already works, and the 3-question focus drill already proves the path. Make Sprint and Method Lab draw a configurable proportion (say 40%) from the student's weakest types with interleaving, rather than uniform random. Depends on #4 to be meaningful.

### 7. Add confidence intervals to every dashboard delta
**Files:** `backend/app/services.py:1271-1283`; `frontend/src/pages.tsx:58-380`
**Cost: 1 day.** The last-20-vs-previous-20 deltas are pure noise presented as change. Either show a band, or suppress the delta until the window is large enough. The app already has an `evidence` label — extend that discipline to the deltas.

### 8. Make onboarding skippable and default sound to off
**Files:** `frontend/src/pages.tsx:483-555`, `backend/app/services.py:978`, `:443-445`, `frontend/src/sound.tsx:112`, `frontend/src/components.tsx:121-127`
**Cost: 1–2 days.** Auto-generate a lawyer/firm name and let the student edit it later; land returning users on `/cases`; ship with `muted: true`. This directly attacks worry #1 for a couple of days of work and touches no game logic.

### 9. Turn on async coaching before launch
**Files:** `backend/app/__init__.py:111`, `backend/app/jobs.py`, `backend/app/routes.py:809-813`
**Cost: 0.5–2 days (mostly infra).** Every coaching call today is a synchronous 120-second-timeout LLM request at `xhigh` reasoning effort. The queue is already built. This is a launch-stability issue, not a nice-to-have.

### 10. Build the review-outcome history table
**Files:** `backend/app/models.py` (new model), `backend/app/services.py:919-970`
**Cost: 1 day.** Log `(user, question, interval_index, scheduled_gap_days, actual_gap_days, correct, explanation_grade, timestamp)` on every review. Without this, no one can ever validate or improve the SRS — and it costs almost nothing to start collecting now, before launch generates the data you'd want retroactively.

### 11. Connect `learner_rule` to the wrong-answer journal
**Files:** `backend/app/models.py:460`, `backend/app/services.py:919-970`, `backend/app/coaching.py:209`, `frontend/src/components.tsx`
**Cost: 1–2 days.** The column exists, the coach already generates a one-line if/then transfer rule on every item, and nothing connects them. Let the student write or accept a rule when a card enters review, then show it at the top of the card on its next appearance. This is the highest-pedagogical-value item on the list per hour of work.

### 12. Capture answer-choice-level and exposure statistics
**Files:** `backend/app/models.py` (new aggregate table), `backend/app/services.py:1038-1060`
**Cost: 1–2 days.** Per-item, per-choice selection counts plus a `times_served` counter. Gives you item discrimination, miskey detection, distractor analysis, and exposure control — and it's the raw material for empirically-derived difficulty (#2c).

### 13. Add a real section-timed practice test mode
**Files:** `backend/app/services.py:344-394`, `:511-552`; frontend
**Cost: 3–5 days.** The diagnostic is the closest thing and it's per-item timed. A genuine 35-minute section clock, no reasoning requirement, correct current-LSAT structure (1 LR + 1 RC scored), is what "benchmark" actually requires. Also fix the 2:1 LR:RC ratio.

### 14. Surface the accommodation multipliers
**Files:** `frontend/src/pages.tsx:65`, `frontend/src/api.ts:122-125`
**Cost: 2–4 hours.** Fully built on the backend (`services.py:519-548`), invisible in the UI. One dropdown. Accessibility win and a genuine market differentiator for essentially free.

### 15. Fix the selection N+1 and dashboard recompute
**Files:** `backend/app/services.py:315-341`, `:1241-1247`, `:727`
**Cost: 0.5–1 day.** `_seen_question_ids` called 6,886 times per session start; `performance_snapshot` loads the user's entire attempt history on every dashboard render; `daily_docket_snapshot` calls `session_review` just to count. All three are straightforward fixes and all three will be visible under launch load.

---

## What's already good and should be protected

This codebase contains real engineering and several genuinely original pedagogical ideas. Nothing below should be rewritten in the rush to fix the list above.

**1. The explanation-grade → SRS-interval coupling** (`services.py:888-917`). Using *how well you justified it* rather than just *whether you got it right* to decide when you see a card again is, as far as I know, not done by any mainstream SRS. Excellent explanations skip a step; invalid ones reset the card even when the answer was correct. This is the most defensible original idea in the product and it should be the thing the app is known for.

**2. The five review entry reasons** (`services.py:873-885`). `high_confidence_error`, `incorrect`, `unsupported_correct`, `low_confidence_correct`, `slow_correct`. Catching "right for the wrong reason" and "right but guessed" is calibration training that almost no competitor does. Keep all five.

**3. Evidence-class segregation** (`services.py:27-33`, `:1341-1344`). Partitioning attempts into coached / timed-unseen / fluency / spaced-review / diagnostic, and computing separate metrics per class, is exactly the discipline a measurement system needs. Keep this and build the eventual score model on `timed_unseen` only.

**4. First-attempt deduplication for headline metrics** (`services.py:1264-1269`). Prevents the most obvious inflation path. Extend it to the `recent` window (currently it isn't applied there) rather than removing it.

**5. Server-enforced feedback policy** (`services.py:453-458`). Delayed feedback in Sprint cannot be turned off by the client. Desirable difficulty enforced at the API boundary — correct design.

**6. Refusing to fake a score** (`services.py:1337-1338`). `projection_available: False` with an explicit note. This is the single most trust-building line in the product. Do not ship a projection until it's real.

**7. The game/study architectural separation** (`components.tsx:558-559`, `services.py:204-218`). Economy context attaches only to `deep` practice, enforced on both client and server. Three of five modes render a completely clean study screen. This is the expensive part of "de-gamify the serious modes" and it's already done — the remaining work is framing, not architecture.

**8. Timer integrity tracking** (`models.py:138`, `services.py:555-575`, `:1251`). `timer_compromised` is set on pause and excludes the item from pace statistics. Most apps just let paused time silently corrupt their timing data.

**9. The coaching prompt and its validator** (`coaching.py:110-186`, `:191-229`). Prompt-injection-aware, refuses to let the model override the verified key, enforces that *every* choice is explained (`:157-158`), clamps all strings, validates enum membership. This is careful, defensive work on the riskiest surface in the app.

**10. Idempotency and exactly-once settlement** (`models.py:166`, `:352-395`, `:401`). Idempotency keys on attempts, unique constraints on settlements and ledger entries, CHECK constraints on score ranges and reputation bounds. The economy cannot double-pay. This rigor should be borrowed for the learning-side tables.

**11. The diagnostic's intact-passage form building** (`services.py:344-394`). Grouping RC questions by passage and never splitting a set is a detail most implementations get wrong.

**12. The deterministic, auditable A/B assignment** (`strategies.py:254-256`, `:303-356`). SHA-256-seeded assignment means any trial can be reproduced and verified after the fact. The *statistics* on top are broken (gap #1), but the *plumbing* is better than most production experiment systems. Fix the thresholds; keep the machinery.

**13. The strategy catalog's sourcing** (`strategies.py:9-34`, `docs/LSAT_STRATEGY_EXPERIMENTS.md`). Real citations to LSAC, 7Sage, and PowerScore, with an explicit evidence hierarchy and an explicit refusal to promise a 170. The plain-language rewrites are genuinely well-written.

**14. Documentation honesty** (`FEATURES.md:80-83`, `:800-802`). The docs volunteer the app's own worst limitations, accurately. That is rare and valuable, and it means this audit largely confirms rather than surprises.

**15. Content provenance discipline** (`backend/data/question_bank/manifest.json`, `seed.py:225-229`). Pinned dataset revisions, SHA-256 per split, license status stamped on every row, and a README that states the licensing risk in plain language. The licensing problem is severe, but nobody hid it.

---

*End of audit. Every claim above was verified against the code or the live development database at `backend/instance/lsat_sherlock.db` on 2026-08-02. No application code was modified.*
