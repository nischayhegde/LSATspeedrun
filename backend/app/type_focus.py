"""Which question types this student is actually weak at, from all their work.

The product's promise, as a student reads it, is that the app notices the kinds
of question they keep getting wrong and serves them more of those. That is not
what `focus.diagnostic_focus` does. It reads **one** run — the last completed
mega-litigation — and returns the types that came in under that run's own
average. A student who is consistently poor at necessary-assumption questions
across two hundred ordinary cases is not noticed as weak at that *category* by
anything: FSRS brings back the individual questions they missed, which is real
and valuable and is a different thing, and nothing goes and finds them more of
the type.

This module is the signal the promise describes. It reads every answer the
student has filed, weights it, and returns the types that are weak relative to
what that student does in the rest of the same section.

It could not have been written before the type fix. 45.8% of the bank carried a
`question_type` equal to its own section name, so for nearly half of all
questions there was no category to be weak at. `app/question_types.py` took that
to 12.5%, and §"Placeholders" below is about the remainder.


## What it does not double-count, and why that took deciding

Three mechanisms in this app already respond to a wrong answer, and a fourth
that responds to the same wrong answer for the third time is not personalisation
but a gain control wound up too far. `services._review_share` states the
principle for its own knob: accuracy is left out of it because a wrong answer
already put the card in the queue and already accelerated its decay, so counting
it again "would make the knob react roughly twice as hard as intended to exactly
the students it should be gentlest with". Two applications of that here.

**Review returns are excluded from the rate.** A question comes back through the
queue *because* it was missed. Scoring those returns as evidence about the type
would let one hard question brand its whole category and keep re-branding it
every time it recirculated — the wrong answer counted once in creating the card,
again in its decay rate, and a third time in the type's accuracy. So the rolling
rate reads first encounters only. There is a second, independent reason:
accuracy on a set of questions selected for having been failed is not a sample
of anything, it is a sample conditioned on failure.

**Types are measured against their own section, not against the student.** The
section-mix knob already leans on the gap between a student's Logical Reasoning
and Reading Comprehension accuracy. If this module compared each type to the
student's overall rate, a student who is uniformly weaker at Reading
Comprehension would have every Reading Comprehension type flagged, and the two
mechanisms would push the same student in the same direction on the same
evidence. Comparing a type against its own section's baseline leaves that
gradient entirely to the section knob and picks up only what is unusual *within*
a section. It is also what `diagnostic_focus` already did, one level up: it
compares against the run's own accuracy rather than a fixed bar.


## Recent, not total

Both are computable and they answer different questions. Total accuracy asks
"has this student ever been bad at this"; recent accuracy asks "are they bad at
it now". Only the second is a reason to spend a run slot, because a student who
has genuinely improved should stop being fed their old weakness — and under a
total rate they never would, since the early bad answers never leave.

So answers are weighted by `scoring._weight`'s two factors, and for its reasons
rather than for consistency's sake:

* **Recency**, exponential with a 30-day half-life. An answer from three months
  ago counts an eighth of a fresh one.
* **Evidence class**, diagnostic 1.0 against coached practice 0.55. This is what
  survives of `diagnostic_focus`: the mega-litigation is still the best evidence
  in the file, because it is the one surface that does not pay, prompt or coach.
  It is now *weighted* highest rather than being the only thing read, so a
  student who has never sat one is no longer invisible and a student whose last
  one was in March is no longer frozen at what it said.

Both effects are already implemented in `app/scoring.py` and are imported rather
than restated.


## Small samples

Three wrong out of four on a rare type is not evidence, and the house pattern
for saying so is `scoring.shrink_toward_prior` — used for the projected score
and for the per-section strategy rankings. Same estimator here, with two
changes that follow from what is being estimated:

* the prior is the student's **own accuracy in that section**, per the section
  argument above, rather than the population's;
* the sample size is Kish's effective *n*, not a raw count, because the weights
  above are unequal and four decayed answers should not claim four answers'
  precision.

A type with little recent evidence therefore sits on top of its section baseline
and is never weak. That is the correct behaviour and not a limitation: the
absence of evidence that a student is weak at something is not a reason to spend
their practice on it.


## Placeholders

12.5% of the bank still carries a `question_type` equal to its section name, and
that residue must neither become invisible nor get over-served.

A placeholder is not a category, so it cannot be a weakness: "you are weak at
Logical Reasoning generally" is what the section knob is for, and targeting a
bucket that holds an eighth of the bank is not targeting. `PLACEHOLDER_SOURCES`
keeps them out of the weak list, both as a type that can be returned and as
evidence about any other type.

They are not excluded from *practice*, though, which is the other half. The
targeted fill draws a bounded share of the fresh budget from weak types and the
rest from the ordinary pool, where placeholders appear at whatever rate the bank
gives them. So their share of a run falls by at most the targeted share and
never to zero. `tools/audit/type_targeting.py` measures that under both arms
rather than leaving it to this paragraph: on the shipped bank, targeting the two
commonest Logical Reasoning types takes placeholders from 10.5% of an untargeted
run to 4.6% of a targeted one, a 56% relative reduction against the 60% the fill
ratio allows.


## Relationship to the layer already registered

This **subsumes** `weak_type_targeting` rather than sitting beside it. Same
layer, same key, same arms, same off arm; the signal underneath it changes and
the registry records a new `design_version`. Two mechanisms both claiming to
target weakness is the duplication this branch exists to end.

It is deliberately not registered as a third arm against the diagnostic-only
signal. That comparison is answerable and it is not worth what it costs: the old
signal is a special case of this one — the mega-litigation's answers are in this
window, weighted highest — so the trial would be spending the app's scarce
observation budget discovering whether reading more evidence beats reading less.
What is genuinely uncertain is whether type targeting helps at all, and that arm
already exists.

The change does cost the layer its history. `design_version` moves to
`2026-08-12-rolling` and nothing pools the two, because runs before and after
were treated on different signals. That is the honest bookkeeping and it is
cheap here: `tools/audit/measurement_cost.py` puts this layer at roughly 47,000
answers across about 100 students, against 469,000 for the strategy trial, which
has to fill twenty-eight cells rather than one. The eligible population also got
much larger — the old signal required a completed mega-litigation, so a student
who had never sat one was ineligible forever.
"""

from __future__ import annotations

from collections import defaultdict

from .models import Attempt, Question, SessionItem, utcnow
from .question_types import SOURCE_PLACEHOLDER, SOURCE_UNRECORDED
from .scoring import EVIDENCE_WEIGHT, PRIOR_STRENGTH, RECENCY_HALF_LIFE_DAYS


# A row whose type came from either of these is not making a claim about a
# category. `section_placeholder` says the rules did not match and the section
# name was written instead; `unrecorded` is a row typed before provenance was
# kept, which cannot be distinguished from a placeholder and so is treated as
# one when the type happens to equal the section.
PLACEHOLDER_SOURCES = {SOURCE_PLACEHOLDER, SOURCE_UNRECORDED}

# Matching `focus.MAX_FOCUS_TYPES`, and for its reason: few enough types that a
# run still covers the rest of the test.
MAX_FOCUS_TYPES = 5

# How far below its section a type has to sit, after shrinkage, before it is
# worth spending run slots on. Five points is about the smallest gap that
# survives the shrinkage on a realistic per-type sample, so a smaller threshold
# would not admit more types, it would only admit noisier ones.
WEAKNESS_MARGIN = 0.05

# The floor on effective sample below which a type is not considered at all,
# whatever its rate. Shrinkage already handles thin evidence by pulling it to
# the baseline, so this is a second line rather than the main one — it stops a
# type with a single decayed answer appearing in the reported evidence at all.
MIN_EFFECTIVE_SAMPLE = 1.0

DEFAULT_EVIDENCE_WEIGHT = EVIDENCE_WEIGHT["coached_practice"]


def _weight(created_at, evidence_class: str | None, now) -> tuple[float, float]:
    """`scoring._weight`'s two factors, returned separately rather than multiplied.

    `scoring` multiplies them because it is estimating one absolute quantity —
    what this student would score on a form — and both factors discount that in
    the same way. This module is estimating a *difference* between two rates
    drawn from the same history, and the two factors do not behave the same way
    under a difference. Splitting them is the only interesting thing in this
    file's arithmetic.

    **Recency** discounts both the estimate and its credibility. A record from
    four months ago is genuinely less informative about which type the student
    is weak at *today*, and no amount of relative comparison recovers that.

    **Evidence class** discounts the estimate and not the sample. Coached
    practice tells you less about exam performance, which is why `scoring`
    charges it 0.55 — but here the type and the section baseline it is compared
    against are measured under the same mixture of conditions, so most of the
    discount cancels in the difference. It still tilts the point estimate,
    because the tilt is real and directional: strategy prompts are matched to
    question type, so a student can look fine at Flaw questions in practice
    largely because the app keeps handing them `flaw_abstraction`, and the
    mega-litigation is the one surface where that is not happening.

    Charging the full product to the sample size as well cost roughly 45% of
    the precision on every type, on both sides of a comparison where it does
    not apply, and turned "twenty answers at 25% against a 55% section" into
    not-evidence. Returns (full weight, recency).
    """
    if created_at.tzinfo is None:
        from datetime import timezone

        created_at = created_at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - created_at).total_seconds() / 86_400)
    recency = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
    evidence = EVIDENCE_WEIGHT.get(evidence_class, DEFAULT_EVIDENCE_WEIGHT)
    return recency * evidence, recency


def _summarise(weighted: list[tuple[float, float, bool]]) -> tuple[float, float]:
    """Weighted accuracy, and effective sample as `min(Kish, Σ recency)`.

    Two things weaken a sample and both have to be caught, which is the shape
    `scoring._section_estimate` uses and the reasoning is its.

    Kish's n_eff = (Σw)² / Σw² catches *unequal* weighting: a handful of recent
    answers buried under a pile of stale ones does not get to claim the pile's
    precision. It is scale-invariant, so it cannot see *uniform* discounting —
    a type whose whole record is four months old would otherwise report full
    precision on evidence this module has just finished discounting.

    Σ recency is the second term, and it is recency alone rather than the full
    weight for the reason in `_weight`: a uniform coaching discount cancels in
    a difference between two rates from the same history, and a uniform
    staleness discount does not.
    """
    total = sum(weight for weight, _recency, _correct in weighted)
    if total <= 0:
        return 0.0, 0.0
    square = sum(weight**2 for weight, _recency, _correct in weighted)
    kish = (total**2) / square if square else 0.0
    accuracy = sum(weight for weight, _recency, correct in weighted if correct) / total
    fresh = sum(recency for _weight, recency, _correct in weighted)
    return accuracy, min(kish, fresh)


def _shrink(accuracy: float, effective: float, baseline: float) -> float:
    """`scoring.shrink_toward_prior`, with the section as the prior.

    Same estimator — (κ·prior + n·p̂) / (κ + n) — and the same κ, so a type needs
    the same weight of evidence to move off its baseline that a student needs to
    move off the population's. What changes is what it shrinks *toward*, and
    that is the whole section argument in the module docstring: shrinking a type
    toward the population would import the student's section gradient into a
    per-type signal that is supposed to be orthogonal to it.
    """
    if effective <= 0:
        return baseline
    return (PRIOR_STRENGTH * baseline + effective * accuracy) / (PRIOR_STRENGTH + effective)


def _half_width(
    accuracy: float, effective: float, baseline: float, section_effective: float
) -> float:
    """95% half-width on the raw gap between a type and its section.

    Shrinkage handles thin evidence by pulling an estimate toward the baseline,
    and on its own it is not quite enough here. A rare type at 25% on four
    answers still lands nine points below a 66% section after shrinking, which
    clears any margin small enough to be useful — and four answers at 25% is
    not evidence that a student is weak at anything. The margin cannot fix that
    without also refusing real weaknesses on ordinary samples.

    So the gap has to clear its own uncertainty as well as the margin, which is
    the same discipline `strategies._half_width` applies to the cohort readings
    and for the same reason: a threshold on sample size answers "is this worth
    printing" and not "is this distinguishable from zero".

    Slightly conservative by construction: the section baseline includes the
    type's own answers, so the two rates are positively correlated and the true
    standard error of their difference is a little smaller than this. Erring
    toward refusing a weakness is the right direction — the cost of missing one
    is that a run is drawn as it always was.
    """
    if effective <= 0 or section_effective <= 0:
        return 1.0
    variance = accuracy * (1 - accuracy) / effective + baseline * (1 - baseline) / section_effective
    return 1.96 * (variance**0.5)


def rolling_focus_detail(user_id: str, *, now=None) -> dict:
    """The student's weak question types, from all of their first encounters.

    One query. Six columns, joined in the database rather than walked through
    the ORM, for the reason `focus.diagnostic_focus_detail` records: this runs
    on the question-serving path and a lazy load per answer put 162 of 174
    statements on one request.
    """
    now = now or utcnow()
    rows = (
        Attempt.query.with_entities(
            Attempt.is_correct,
            Attempt.created_at,
            Attempt.evidence_class,
            Question.question_type,
            Question.question_type_source,
            Question.section,
        )
        .join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(
            Attempt.user_id == user_id,
            # First encounters only. See the module docstring: a review return
            # is selected for having been failed, so its accuracy is not a
            # sample of the type, and counting it would be the third time one
            # wrong answer moved something.
            SessionItem.from_review_queue.is_(False),
        )
        .all()
    )

    by_section: dict[str, list[tuple[float, float, bool]]] = defaultdict(list)
    by_type: dict[tuple[str, str], list[tuple[float, float, bool]]] = defaultdict(list)
    placeholder_answers = 0
    for row in rows:
        weight, recency = _weight(row.created_at, row.evidence_class, now)
        if weight <= 0:
            continue
        placeholder = (
            row.question_type_source in PLACEHOLDER_SOURCES
            and row.question_type == row.section
        )
        # Placeholder answers still count toward the section baseline: they are
        # real answers in that section and leaving them out would make the bar
        # every type is measured against a bar drawn over a biased subset.
        by_section[row.section].append((weight, recency, row.is_correct))
        if placeholder:
            placeholder_answers += 1
            continue
        by_type[(row.section, row.question_type)].append((weight, recency, row.is_correct))

    baselines = {}
    for section, values in by_section.items():
        accuracy, effective = _summarise(values)
        baselines[section] = accuracy if effective else 0.0

    section_samples = {
        section: _summarise(values)[1] for section, values in by_section.items()
    }

    scored = []
    for (section, question_type), values in by_type.items():
        accuracy, effective = _summarise(values)
        if effective < MIN_EFFECTIVE_SAMPLE:
            continue
        baseline = baselines.get(section, 0.0)
        shrunk = _shrink(accuracy, effective, baseline)
        half_width = _half_width(
            accuracy, effective, baseline, section_samples.get(section, 0.0)
        )
        gap = round((baseline - shrunk) * 100, 1)
        scored.append(
            {
                "type": question_type,
                "section": section,
                "gap": gap,
                "shrunk_accuracy": round(shrunk * 100, 1),
                "raw_accuracy": round(accuracy * 100, 1),
                "section_baseline": round(baseline * 100, 1),
                "effective_sample": round(effective, 1),
                "answers": len(values),
                "half_width": round(half_width * 100, 1),
                # Two conditions, and they refuse different things. The margin
                # refuses a gap too small to be worth run slots even if it is
                # real. The interval refuses a gap too uncertain to be called a
                # gap at all — three wrong out of four on a rare type clears
                # any margin and is not evidence of anything.
                "separates": (baseline - accuracy) > half_width,
            }
        )

    weak = sorted(
        (
            entry
            for entry in scored
            if entry["gap"] >= WEAKNESS_MARGIN * 100 and entry["separates"]
        ),
        key=lambda entry: (-entry["gap"], entry["type"]),
    )[:MAX_FOCUS_TYPES]
    return {
        "types": [entry["type"] for entry in weak],
        "weak": weak,
        # Everything considered, weak or not, so a student can be shown why a
        # type they think they are bad at is not on the list.
        "considered": sorted(scored, key=lambda entry: (-entry["gap"], entry["type"])),
        "section_baselines": {
            section: round(value * 100, 1) for section, value in baselines.items()
        },
        "first_encounters": sum(len(values) for values in by_section.values()),
        "placeholder_answers": placeholder_answers,
        "half_life_days": RECENCY_HALF_LIFE_DAYS,
    }


def rolling_focus(user_id: str) -> list[str]:
    return rolling_focus_detail(user_id)["types"]
