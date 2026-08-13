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

**Types are measured against the rest of their own section, not against the
student.** The section-mix knob already leans on the gap between a student's
Logical Reasoning and Reading Comprehension accuracy. If this module compared
each type to the student's overall rate, a student who is uniformly weaker at
Reading Comprehension would have every Reading Comprehension type flagged, and
the two mechanisms would push the same student in the same direction on the same
evidence. Comparing a type against its own section leaves that gradient entirely
to the section knob and picks up only what is unusual *within* a section. It is
also what `diagnostic_focus` already did, one level up: it compares against the
run's own accuracy rather than a fixed bar.

"The rest of" is load-bearing and was not free. A baseline containing the type's
own answers is a baseline the type moves: it shrinks the gap by however much of
the section the type is, and it makes the two rates correlated, so the interval
in `_half_width` is computed on a covariance it ignores. Both errors point the
same way and together they roughly doubled the evidence a real weakness needed.

That per-section reading only holds if it survives the trip to the selector, so
the section travels with the type in `FocusType` rather than being computed here
and dropped one call later. It used to be dropped: `rolling_focus` returned bare
names, and both consumers — the fill in `services._weight_toward_focus` and the
coverage runway in `strategies.assign_strategy_trial` — matched on the name.
Four names exist in both sections, so a weakness this module was careful to
scope to Logical Reasoning arrived at the selector meaning both sections, which
is the gradient the paragraph above hands to the section knob, handed back.


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

* the prior is the student's **own accuracy in the rest of that section**, per
  the section argument above, rather than the population's;
* the sample size is Kish's effective *n*, not a raw count, because the weights
  above are unequal and four decayed answers should not claim four answers'
  precision.

Shrinkage alone turned out not to be enough, because it is not answering the
right question: it asks how far off the baseline an estimate should be allowed
to move, not whether the move is distinguishable from zero. A rare type at 25%
on four answers still lands nine points below a 66% section after shrinking. So
a type must also clear its own 95% interval — the discipline the cohort readings
in `strategies` already apply — and below `MIN_EFFECTIVE_SAMPLE` it is not
considered at all, because no interval is trustworthy at four observations.

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
commonest Logical Reasoning types takes placeholders from 11.5% of an untargeted
run to 4.5% of a targeted one, a 61% relative reduction, and takes weak types
from 20.6% of a run to 62.4%.

    python3 tools/audit/type_targeting.py --runs 1000 --seed 7

That reduction sits just inside the 60% the fill ratio allows rather than well
under it, and it is where it is because the fill now spends its quota on
material it can use. Before `FocusType` carried the section, the same invocation
reported 9.6% placeholders and only 47.0% weak types: the quota was going on
Reading Comprehension passages selected because they happened to contain a
question named "Inference". Targeting a Logical-Reasoning-only type reported
3.9%, and the gap between the two was that pull-in. It is closed rather than
narrowed: `--weak-type Assumption`, which exists only in Logical Reasoning, and
`--weak-type Inference`, which does not, now report 4.4% and 4.6% — the same
number twice, where they used to differ by 5.7 points.

That pull-in was never reachable through `create_study_session`; see
`services._weight_toward_focus`, which is where the reachability argument
belongs and where the fix is. It mattered anyway, because "no RC block is ever
in a pool that also has focus types" was true by accident of two call sites and
was not written down or tested anywhere.

Targeting a *Reading Comprehension* type is the asymmetric case, and worth
stating because it is only expressible now that a weakness names its section.
A reading sitting first picks a passage that carries the weak type, then
fills from those questions — all the matches the passage has, then the rest.
That is how a weak RC type becomes most of the sitting when the passage
contains them, rather than a 60% quota pretended across mixed types. The
placeholder share still goes up relative to an argument case, because the
passage arrives with its other types; what does not hold is the old
assumption that a whole-passage fill cannot prefer a type at all.


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
from typing import NamedTuple

from .models import Attempt, Question, SessionItem, utcnow
from .question_types import SOURCE_PLACEHOLDER, SOURCE_UNRECORDED
from .scoring import EVIDENCE_WEIGHT, PRIOR_STRENGTH, RECENCY_HALF_LIFE_DAYS


class FocusType(NamedTuple):
    """A weakness, with the section it was detected in attached to it.

    The section travels because the *signal* is per-section — a type is weak
    relative to the rest of its own section, see the module docstring — and a
    consumer that drops it asks a different question from the one that was
    answered. Four type names exist in both sections (Inference, Weaken,
    Strengthen, Principle) and Inference is the second commonest Logical
    Reasoning type, so dropping the section is not a rare edge: a weakness in
    Logical Reasoning Inference pulled Reading Comprehension passages into runs
    that had no business holding them.

    A pair rather than a bare name for exactly that reason. It is deliberately
    not a string like "Logical Reasoning:Inference", which would be one
    `split` away from the same bug.
    """

    section: str
    question_type: str

    def __str__(self) -> str:
        # What `experiments.signal_tokens` records. Qualified, because an
        # "Inference" token in that column did not say which section's
        # Inference and so could not be read back unambiguously.
        return f"{self.section}:{self.question_type}"


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
# whatever its rate.
#
# The interval in `_half_width` does the real work and this is not a second
# copy of it: it refuses the regime where a normal approximation to a binomial
# is not to be trusted at all. Three wrong out of four on a rare type is the
# case the brief names, and at that size no interval — Wald, Agresti–Coull or
# exact — is doing anything a reader should act on. Eight is where the two
# agree closely enough that the interval can be left to decide, and at eight
# answers a type has to be catastrophic rather than merely bad to clear it.
MIN_EFFECTIVE_SAMPLE = 8.0

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


class _Tally:
    """Weighted answers, summable and subtractable.

    Sums rather than a list because the interesting quantity is a *difference
    of disjoint sets* — this type against the rest of its section — and running
    sums subtract where lists would have to be re-partitioned per type.

    `accuracy` is the weighted rate. `effective` is `min(Kish, Σ recency)`,
    which is the shape `scoring._section_estimate` uses, and the reasoning is
    its. Two things weaken a sample and both have to be caught. Kish's
    n_eff = (Σw)² / Σw² catches *unequal* weighting: a handful of recent
    answers buried under a pile of stale ones does not get to claim the pile's
    precision. It is scale-invariant, so it cannot see *uniform* discounting —
    a type whose whole record is four months old would otherwise report full
    precision on evidence this module has just finished discounting. Σ recency
    is that second term, and it is recency alone rather than the full weight
    for the reason in `_weight`: a uniform coaching discount cancels in a
    difference between two rates from the same history, and a uniform
    staleness discount does not.
    """

    __slots__ = ("weight", "square", "hits", "recency", "answers")

    def __init__(self) -> None:
        self.weight = 0.0
        self.square = 0.0
        self.hits = 0.0
        self.recency = 0.0
        self.answers = 0

    def add(self, weight: float, recency: float, correct: bool) -> None:
        self.weight += weight
        self.square += weight**2
        self.recency += recency
        self.answers += 1
        if correct:
            self.hits += weight

    def without(self, other: "_Tally") -> "_Tally":
        rest = _Tally()
        rest.weight = self.weight - other.weight
        rest.square = self.square - other.square
        rest.hits = self.hits - other.hits
        rest.recency = self.recency - other.recency
        rest.answers = self.answers - other.answers
        return rest

    @property
    def accuracy(self) -> float:
        return self.hits / self.weight if self.weight > 0 else 0.0

    @property
    def effective(self) -> float:
        if self.weight <= 0 or self.square <= 0:
            return 0.0
        return min((self.weight**2) / self.square, self.recency)


def _shrink(accuracy: float, effective: float, baseline: float) -> float:
    """`scoring.shrink_toward_prior`, with the rest of the section as the prior.

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


def _half_width(type_tally: _Tally, peers: _Tally) -> float:
    """95% half-width on the gap between a type and the rest of its section.

    Shrinkage handles thin evidence by pulling an estimate toward the baseline,
    and on its own it is not enough here. A rare type at 25% on four answers
    still lands nine points below a 66% section after shrinking, which clears
    any margin small enough to be useful — and four answers at 25% is not
    evidence that a student is weak at anything. The margin cannot fix that
    without also refusing real weaknesses on ordinary samples.

    So the gap has to clear its own uncertainty as well as the margin, which is
    the same discipline `strategies._half_width` applies to the cohort readings
    and for the same reason: a threshold on sample size answers "is this worth
    printing" and not "is this distinguishable from zero".

    **The rest of the section, not the whole of it**, and that is not a detail.
    A type compared against a baseline that contains its own answers is
    compared against something it moves: the two rates are positively
    correlated, the variance of the difference is overstated by ignoring the
    covariance, and the gap itself is shrunk by however much of the section the
    type is. Both errors point the same way, and together they roughly doubled
    the evidence a real weakness needed — a 25-point gap wanted about 33
    effective answers on the type rather than about 16. Disjoint sets make the
    variance below correct rather than conservative, and it is the same
    comparison a student would make by hand.
    """
    if type_tally.effective <= 0 or peers.effective <= 0:
        return 1.0
    return 1.96 * ((_variance(type_tally) + _variance(peers)) ** 0.5)


def _variance(tally: _Tally) -> float:
    """Agresti–Coull rather than Wald, because one side of this is always small.

    The textbook p̂(1−p̂)/n is unreliable at the sample sizes a single question
    type has, and it fails in the direction that matters: at four answers and
    one right it reports a narrow interval around 25%, because p̂(1−p̂) is
    small when p̂ is extreme, and the fewer answers there are the more extreme
    p̂ tends to be. Wald therefore calls a rare type a weakness on exactly the
    evidence the module docstring says is not evidence.

    Agresti–Coull is the standard repair — two notional successes and two
    notional failures, so the estimate the interval is built on is pulled off
    the extremes before it is squared — and it is the same shrinkage idea this
    file already uses for the point estimate, applied to the spread.
    """
    padded = tally.effective + 4
    rate = (tally.accuracy * tally.effective + 2) / padded
    return rate * (1 - rate) / padded


def _answers(user_id: str | None):
    """First encounters, for one student or for everybody.

    One query. Six columns and now the student, joined in the database rather
    than walked through the ORM, for the reason `focus.diagnostic_focus_detail`
    records: this runs on the question-serving path and a lazy load per answer
    put 162 of 174 statements on one request.
    """
    query = (
        Attempt.query.with_entities(
            Attempt.user_id,
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
            # First encounters only. See the module docstring: a review return
            # is selected for having been failed, so its accuracy is not a
            # sample of the type, and counting it would be the third time one
            # wrong answer moved something.
            SessionItem.from_review_queue.is_(False),
        )
    )
    if user_id is not None:
        query = query.filter(Attempt.user_id == user_id)
    return query.all()


def rolling_focus_detail(user_id: str, *, now=None) -> dict:
    """The student's weak question types, from all of their first encounters."""
    now = now or utcnow()
    return _detail(_answers(user_id), now)


def _detail(rows, now) -> dict:
    """The whole computation, over already-fetched answers.

    Separate from the query so `rolling_population_reading` can run it per
    student over one scan. The cohort view has to be the same arithmetic the
    selector reads rather than a second implementation of it, or the report
    describes a mechanism the app does not have.
    """
    by_section: dict[str, _Tally] = defaultdict(_Tally)
    by_type: dict[tuple[str, str], _Tally] = defaultdict(_Tally)
    placeholder_answers = 0
    for row in rows:
        weight, recency = _weight(row.created_at, row.evidence_class, now)
        if weight <= 0:
            continue
        placeholder = (
            row.question_type_source in PLACEHOLDER_SOURCES
            and row.question_type == row.section
        )
        # Placeholder answers still count toward the section: they are real
        # answers in that section, and leaving them out would draw the bar
        # every type is measured against over a biased subset.
        by_section[row.section].add(weight, recency, row.is_correct)
        if placeholder:
            placeholder_answers += 1
            continue
        by_type[(row.section, row.question_type)].add(weight, recency, row.is_correct)

    # Reported rather than compared against. The per-type comparison uses the
    # section *minus that type*; see `_half_width`.
    baselines = {
        section: tally.accuracy if tally.effective else 0.0
        for section, tally in by_section.items()
    }

    scored = []
    for (section, question_type), tally in by_type.items():
        if tally.effective < MIN_EFFECTIVE_SAMPLE:
            continue
        peers = by_section[section].without(tally)
        baseline = peers.accuracy if peers.effective else 0.0
        shrunk = _shrink(tally.accuracy, tally.effective, baseline)
        half_width = _half_width(tally, peers)
        gap = round((baseline - shrunk) * 100, 1)
        scored.append(
            {
                "type": question_type,
                "section": section,
                "gap": gap,
                "shrunk_accuracy": round(shrunk * 100, 1),
                "raw_accuracy": round(tally.accuracy * 100, 1),
                # The rest of the section, which is what the gap is measured
                # against and what a student comparing by hand would use.
                "section_baseline": round(baseline * 100, 1),
                "effective_sample": round(tally.effective, 1),
                "answers": tally.answers,
                "half_width": round(half_width * 100, 1),
                # Two conditions, and they refuse different things. The margin
                # refuses a gap too small to be worth run slots even if it is
                # real. The interval refuses a gap too uncertain to be called a
                # gap at all — three wrong out of four on a rare type clears
                # any margin and is not evidence of anything.
                "separates": (baseline - tally.accuracy) > half_width,
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
        "first_encounters": sum(tally.answers for tally in by_section.values()),
        "placeholder_answers": placeholder_answers,
        "half_life_days": RECENCY_HALF_LIFE_DAYS,
    }


def rolling_focus(user_id: str) -> list[FocusType]:
    """The weak types, each carrying the section it was found in.

    Section-qualified because that is what the selector needs and this function
    has exactly one production caller, which is the selector. The unqualified
    names are still on `rolling_focus_detail`, which is what the student-facing
    reading uses, and each entry there has carried its `section` all along.
    """
    return [FocusType(entry["section"], entry["type"]) for entry in rolling_focus_detail(user_id)["weak"]]


# How much history a student has, in first encounters, and what the signal can
# do at each depth. The boundaries are not arbitrary and they are not tuned:
# they come out of the arithmetic above. There are 27 targetable types in the
# shipped bank, so a student's answers divide roughly that many ways, and a
# type needs about ten of them before a five-point gap can clear its own
# interval.
#
#   cold        below 30      fewer than two answers per type; the signal is
#               correct to say nothing, and this is the state the layer must
#               not pretend to serve
#   warming     30 to 149     a few types are readable, most are not
#   established 150 to 499    the signal is doing what it was built to do
#   saturated   500 and up    every type is readable, so a weakness that
#               survives here is a real one, and one that has gone has gone
HISTORY_BANDS = (
    ("cold", 0, 30),
    ("warming", 30, 150),
    ("established", 150, 500),
    ("saturated", 500, None),
)


def _band(first_encounters: int) -> str:
    for name, low, high in HISTORY_BANDS:
        if first_encounters >= low and (high is None or first_encounters < high):
            return name
    return HISTORY_BANDS[-1][0]  # pragma: no cover


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 1)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 1)


def rolling_population_reading(*, now=None) -> dict:
    """What the signal and the layer are doing across the whole cohort.

    A per-student reading cannot answer the question that decides whether this
    layer is worth its holdback, because the interesting behaviour is at the
    two ends of the history distribution and no single student is at both.

    **The cold end.** A student with no per-type history has no weakness, gets
    no draw, and is not in the trial. That is the correct behaviour and it is
    also a cost: if most of the cohort is cold, the layer is measuring a small
    corner of the product and the trial will not fill. `bands` says which it
    is, in students, rather than leaving it to be assumed.

    **The saturated end.** A student with hundreds of answers may have improved
    past the weakness that first triggered targeting. Two readings of that,
    and they are different claims:

    * `median_gap` per band is descriptive. Weakness here is relative to the
      student's own section, so there is always a worst type and the share of
      students with *a* weakness does not fall as they improve. What falls is
      how far below the rest of their section it sits.
    * `signal_persistence` reads the recorded signals directly: of the types
      named on a student's first assignment, how many are still named on their
      last. This is the closest thing to the layer's own success criterion that
      does not require a comparison, and it is *not* one — types leave the list
      for reasons other than the treatment, and the arm split below is what
      separates those.

    **The trial.** `bands[...]["trial"]` is `experiments.summarise` over the
    same rows `layer_reading` uses, regrouped by the band the student is in
    now. Regrouped, not re-derived: one arithmetic, two groupings. It is not a
    stratified estimate — banding on a student's *current* history is banding
    on something the treatment could have moved, so read it as where the
    evidence is accumulating rather than as an effect per band.

    Read-only. Nothing here changes what any student is served.
    """
    from . import experiments

    now = now or utcnow()
    by_user: dict[str, list] = defaultdict(list)
    for row in _answers(None):
        by_user[row.user_id].append(row)

    details = {user_id: _detail(rows, now) for user_id, rows in by_user.items()}
    bands: dict[str, dict] = {
        name: {"band": name, "students": 0, "with_weakness": 0, "gaps": [], "weak_counts": []}
        for name, _low, _high in HISTORY_BANDS
    }
    student_band = {}
    for user_id, detail in details.items():
        name = _band(detail["first_encounters"])
        student_band[user_id] = name
        entry = bands[name]
        entry["students"] += 1
        entry["weak_counts"].append(len(detail["weak"]))
        if detail["weak"]:
            entry["with_weakness"] += 1
            entry["gaps"].append(detail["weak"][0]["gap"])

    rows = experiments.outcome_rows("weak_type_targeting")
    by_band: dict[str, list] = defaultdict(list)
    for row in rows:
        by_band[student_band.get(row[2], "cold")].append(row)

    reading = []
    for name, low, high in HISTORY_BANDS:
        entry = bands[name]
        students = entry["students"]
        reading.append(
            {
                "band": name,
                "first_encounters": f"{low}+" if high is None else f"{low}–{high - 1}",
                "students": students,
                "with_weakness": entry["with_weakness"],
                "share_with_weakness": round(entry["with_weakness"] / students, 2)
                if students
                else None,
                "median_weak_types": _median(entry["weak_counts"]),
                # The widest gap each student carries, so this is "how far
                # below their own section is the worst thing about them".
                "median_gap": _median(entry["gaps"]),
                "trial": experiments.summarise("weak_type_targeting", by_band.get(name, [])),
            }
        )

    return {
        "students": len(details),
        "bands": reading,
        "signal_persistence": _signal_persistence(),
        "basis": (
            "one scan of every first encounter, run through the same estimator the "
            "selector reads, banded by how much history the student has now"
        ),
    }


def _signal_persistence() -> dict:
    """How much of a student's first recorded weakness is still recorded.

    Descriptive and not causal, and the docstring above says why. It is here
    because it is the only reading in the file that can distinguish "the signal
    moves as the student improves" — the claim this module is built on — from
    "the signal named three types in March and still names them".
    """
    from .experiments import LAYERS, signal_set
    from .models import LayerAssignment

    spec = LAYERS["weak_type_targeting"]
    rows = (
        LayerAssignment.query.with_entities(
            LayerAssignment.subject_id,
            LayerAssignment.signal,
            LayerAssignment.created_at,
        )
        .filter(
            LayerAssignment.layer == spec.key,
            LayerAssignment.design_version == spec.design_version,
        )
        .order_by(LayerAssignment.created_at)
        .all()
    )
    by_user: dict[str, list] = defaultdict(list)
    for subject, signal, _created in rows:
        by_user[subject].append(signal_set(signal))

    retained = []
    for signals in by_user.values():
        if len(signals) < 2 or not signals[0]:
            continue
        retained.append(len(signals[0] & signals[-1]) / len(signals[0]))
    return {
        "students": len(retained),
        "median_retained": _median([value * 100 for value in retained]),
        "note": (
            "Share of the types named on a student's first assignment still named on "
            "their last. Descriptive: a type leaves the list for reasons other than "
            "the treatment, and only the arm split separates those."
        ),
    }
