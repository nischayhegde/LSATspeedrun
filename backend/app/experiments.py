"""The measurement spine: one way to switch an adaptive layer on for some
students and off for others, and one place that records what was drawn.

This app decides what a student sees through several independent layers — when
a question returns, what order a run runs in, what shape a sitting takes, how
much of a run is review, which approach is suggested, and soon what difficulty
is aimed at. Every one of them is plausible. Exactly one of them, the strategy
trial, has ever been *measurable*, and it got that property by hand: its own
randomisation, its own propensity column, its own estimator. Nothing else can
be turned off for a comparison group, so if a student's results do not improve
there is no way to say which layer is responsible. This module is the missing
half of every layer after the first: the part that can say "off, for a quarter
of runs, and here is the record".

It is deliberately small. Three ideas.

**A layer is declared, not discovered.** `LAYERS` below is the whole list of
adaptive machinery in the product, including the layers this module does not
assign, so there is one place to read what the system is doing to a student and
whether each part of it is measured. A layer that is not in the registry is not
in the system; adding one is a dictionary entry.

**An assignment needs an exposure, and the exposure has a type.** This is the
whole lesson of the defect found in the strategy trial (see
`strategies.assign_strategy_trial`). Its arm was a hash of
`(student, question, slot, style)` — which is a perfectly good randomisation
across the space of those four things, and which is *not* a randomisation
across encounters, because a review question returning to the same slot draws
the same arm forever. Bank-wide it measured 25% control, exactly as designed.
For an individual heavy user it collapsed to 2%. The recorded propensity said
0.25 while the mechanism's actual probability, conditional on what the hash
could see, was 0 or 1.

The rule that prevents this is: *the draw must vary over the same thing the
estimand is about*. If a layer's effect is a property of a run, a new draw
happens once per run and never again inside it; if it is a property of one
encounter with a question, the draw happens once per encounter. So a layer
declares its `unit`, an assignment takes an `Exposure` whose `kind` must match
that unit, and the `Exposure` constructors are the only way to build one. A
caller cannot pass "the student" where "this run" is required, because the
argument is not a string.

Being unable to make the mistake at the call site is not the same as being
unable to make it at all, so the second guard is a measurement:
`assignment_health` reports the *realised* arm share per student, not
bank-wide, and the number of distinct exposures behind those draws. The old
scheme would have shown draws far outnumbering exposures and a control share
near zero for the heaviest accounts, on the very first run of the probe.

**The recorded propensity is the realised one.** The row keeps the probability
of the arm that was actually drawn, computed from the shares in force at the
moment of the draw, together with the design version those shares belong to. A
later inverse-propensity or CACE fit reads that column; it must therefore be
the truth about this draw rather than the design's intention, and it must not
change under it when a share is retuned later.

What this module deliberately does *not* do:

* It does not decide anything about learning. A layer asks whether it is on;
  what it does when it is on is the layer's business.
* It does not sample outcomes. `layer_reading` joins assignments to the answers
  that were filed under them, and that is the only analysis here.
* It does not replace the strategy trial. That trial is registered below and
  keeps its own draw, because it randomises per question inside a run and its
  columns already carry a propensity. The intended end state is that its
  control draw becomes one call to `assign` — the shape is already identical —
  and that is a merge, not a rewrite. See `docs/learning-system.md`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from flask import current_app

from .extensions import db
from .models import Attempt, LayerAssignment, Question, SessionItem, StudySession
from .scoring import PRIOR_STRENGTH, shrink_toward_prior

# What a draw is allowed to vary over, which is the same thing as what the
# layer's effect is a property of.
UNIT_STUDENT = "student"
UNIT_RUN = "run"
UNIT_ITEM = "item"
UNITS = (UNIT_STUDENT, UNIT_RUN, UNIT_ITEM)

# When the effect is expected, and therefore which answers the reading is over.
# `Layer.outcome_window` documents the difference between them; it is the
# distinction most likely to turn a benefit into a reported harm.
WINDOW_IMMEDIATE = "immediate"
WINDOW_DELAYED = "delayed"
WINDOW_LATER_ENCOUNTERS = "later_encounters"
WINDOWS = (WINDOW_IMMEDIATE, WINDOW_DELAYED, WINDOW_LATER_ENCOUNTERS)

# How the `signal` column is packed. A separator that cannot occur in a
# question type, and a length that matches the column so a long signal is
# truncated here rather than by the database.
SIGNAL_SEPARATOR = "|"
SIGNAL_MAX_LENGTH = 240


@dataclass(frozen=True)
class Exposure:
    """The encounter a draw belongs to.

    A value rather than a string so that a layer randomised per run cannot be
    handed a student id by a caller who thought that was the same thing. It is
    not the same thing: it is the difference between a trial and a single coin
    flip reported as a trial, and that substitution is exactly the defect this
    module exists to make unrepeatable.

    `token` is what the hash varies over and what is written to the row, so it
    must identify the encounter uniquely within the layer and the student. The
    run's id does; a question's position in the run does not, on its own, which
    is why `item` takes both.
    """

    kind: str
    token: str

    @classmethod
    def student(cls, user_id: str) -> "Exposure":
        """One draw per student, for a layer whose effect is a property of the
        student's whole experience — a persistent setting rather than something
        re-decided per sitting. The student stays in their arm."""
        return cls(UNIT_STUDENT, str(user_id))

    @classmethod
    def run(cls, session_id: str) -> "Exposure":
        """One draw per run. The run's own id, because it is the only thing
        that distinguishes this sitting from the next one with the same
        student, the same length and the same questions in it."""
        return cls(UNIT_RUN, str(session_id))

    @classmethod
    def item(cls, session_id: str, position: int) -> "Exposure":
        """One draw per encounter with a question. Both parts are load-bearing:
        the position alone repeats every run, and the run alone cannot tell two
        questions in the same run apart."""
        return cls(UNIT_ITEM, f"{session_id}:{position}")


@dataclass(frozen=True)
class Layer:
    """One adaptive mechanism, and how it is measured.

    `arms` maps arm name to design share. `off_arm` names the arm in which the
    layer does nothing, which is what makes the comparison interpretable: every
    layer here is measured against its own absence rather than against another
    layer.

    `assigned_by` is where the draw happens. For most layers that is this
    module. For the strategy trial it is `app/strategies.py`, and saying so is
    the point of registering it: the registry is a census of adaptive machinery
    rather than a census of this module's customers. Where it reads "nothing
    draws this", the layer is shipped and unmeasured, and `arms` describes the
    comparison that would be run rather than one that is running.

    `design_version` moves whenever the arms or their shares move. Rows carry
    it, and nothing pools two versions, because a share retuned midway is two
    experiments rather than a longer one.

    `instrument` is how the layer is read, and it is not always a holdout. One
    layer here is measured by calibration instead, because its off arm would
    have to be shipped to a quarter of students for the life of the experiment
    and the experiment cannot finish at this app's scale. Declaring that in the
    registry rather than leaving the layer in `unmeasured` is the difference
    between "nobody got to it" and "here is the instrument, and here is why it
    is not a randomisation".

    `outcome_window` is *when* the effect is expected to show, and which
    answers therefore count. Three values, and the difference between them is
    not a refinement — for two of the layers here the immediate reading is
    expected to point the wrong way, so a layer read in the wrong window will
    report a real benefit as a harm, with a large sample and great confidence.

    * `immediate` — the answers given inside the assigned run.
    * `delayed` — the answers given when *those same questions* come back
      through the review queue in some later run. Retention of the material
      the run contained, which is what interleaving claims to change.
    * `later_encounters` — the answers given on *later first encounters with
      the same question type*, which is what weak-type targeting claims to
      change. Not the same window as `delayed` and not a stricter version of
      it: practising a type is supposed to help the student at the type, not
      at the particular questions they practised on, and reading it through
      the review queue would compare arms on a set of cards the treated arm
      itself created more of.

    `strata` names a variable the reading must never pool over. Reading
    Comprehension and Logical Reasoning are the case: the repository's own
    evidence file predicts an effect in one and a null in the other, so a
    pooled figure would average them and understate both. Setting this makes
    the split the default rather than something an analyst remembers.

    `population` is which answers the reading is over, and for the layers that
    declare it the definition depends on something true only at the moment of
    the draw. Weak-type targeting is read on later encounters with *the types
    this student was weak at when the run was built*, and that list is not
    reconstructible afterwards, because the whole point of the rolling signal
    is that it moves as the student improves. So the draw records it — see
    `assign`'s `signal` argument — and the reading restricts to it. Without
    that the field is a comment and the reading quietly averages over every
    type the student happened to meet.
    """

    key: str
    unit: str
    question: str
    signal: str
    without_signal: str
    arms: dict[str, float]
    off_arm: str
    design_version: str
    assigned_by: str = "app/experiments.py"
    status: str = "live"
    outcome_join: str = "session"
    instrument: str = "holdout"
    outcome_window: str = "immediate"
    strata: str | None = None
    population: str | None = None

    def share(self, arm: str) -> float:
        total = sum(self.arms.values())
        return (self.arms.get(arm, 0.0) / total) if total > 0 else 0.0

    @property
    def restricted_by_signal(self) -> bool:
        """Whether the reading keeps only answers matching the recorded signal.

        A layer this module draws and reads through `layer_assignments`, and
        which declares a population, is one whose population is defined by
        what its signal said at the draw. That is the only kind of population
        this module can enforce; layers that draw elsewhere (`outcome_join`)
        state theirs for the estimator that does read them.
        """
        return self.outcome_join == "session" and bool(self.population)


# Every adaptive layer in the product, in five states:
#
#   live       drawn, recorded, and estimable today
#   calibrated read by a proper scoring rule rather than by a holdout, because
#              the holdout was judged indefensible — see `review_scheduling`
#   seam       registered and waiting for the code it wraps to land
#   planned    the signal it needs does not exist yet
#   unmeasured shipped and deciding, with nothing drawing an off arm for it
#
# `unmeasured` is the uncomfortable state and it is why the list includes
# layers this module does not touch. A census that only counted what was
# already measured would report a fully measured system, which is exactly the
# kind of instrument that agrees with whoever points it. This registry has had
# three entries in that state; the three of them are the substance of this
# change, and no entry is in it now. Two became `live` and one became
# `calibrated`, which is a weaker instrument honestly labelled rather than a
# holdout nobody believes in.
#
# A holdback of a quarter is the same figure the strategy trial's control arm
# uses, and for the same reason: it is the smallest share that fills a
# comparison group at a usable rate without the off arm becoming most of the
# product. The cost is real and worth stating plainly — one run in four is
# built by the simpler rule — and it buys the only thing that can ever
# distinguish a layer that helps from a layer that feels like it should.
LAYERS: dict[str, Layer] = {
    layer.key: layer
    for layer in (
        Layer(
            key="weak_type_targeting",
            unit=UNIT_RUN,
            question="Does steering fresh questions toward the types this student is "
            "weak at beat drawing them from the whole bank?",
            signal="`type_focus.rolling_focus`: types whose recency-weighted accuracy "
            "over the student's first encounters sits at least five points below their "
            "own accuracy on the rest of that section, after shrinkage, by a margin the "
            "interval clears.",
            without_signal="A student with no type standing out below the rest of its "
            "section gets an empty list, and the run is drawn as if the layer were off. "
            "Those runs are not part of the comparison.",
            arms={"targeted": 0.75, "untargeted": 0.25},
            off_arm="untargeted",
            # Bumped from the version that read `focus.diagnostic_focus`. Not a
            # change to the arms or the draw: the signal underneath the treated
            # arm is a different quantity, so runs assigned before and after are
            # not comparable and must not be pooled.
            #
            # The old signal read one run — the last completed mega-litigation —
            # and returned the types that came in under that run's own average.
            # A student consistently poor at necessary-assumption questions over
            # two hundred ordinary cases was not noticed as weak at that
            # category by anything, and a student who had improved was still
            # being fed what their last sitting said. The new signal reads every
            # first encounter, decays it, weights the mega-litigation's answers
            # highest, and shrinks each type toward the student's own accuracy
            # in that section.
            #
            # This subsumes the old mechanism rather than joining it. There is
            # one weak-type layer, and `app/type_focus.py` argues why a second
            # arm comparing the two signals would not be worth its observations.
            design_version="2026-08-12-rolling",
            # Not immediate, and for the reason `run_ordering` is not: serving
            # more of a student's weakest type makes the run it is served in
            # *harder* — that is what a weakness means — so an immediate
            # reading would report a working treatment as a harm, with a large
            # sample and great confidence.
            #
            # Not `delayed` either, which is the less obvious half. That window
            # reads the assigned run's own questions coming back through the
            # review queue, and here it would be a trap: the targeted arm
            # serves more weak-type questions, a student misses more of them,
            # so the treated arm *creates* the cards it is then measured on.
            # The comparison would be over two differently-composed sets of
            # material and would not be a comparison. What targeting claims is
            # that the student gets better at the type, not at the questions
            # they drilled, so the outcome is later first encounters with those
            # types — new questions, never seen, of the category the run leaned
            # into.
            outcome_window="later_encounters",
            # Interference is real here and is not solved. A student's runs
            # alternate arms, so a later encounter follows a mixture of
            # targeted and untargeted runs and the window credits it to the
            # most recent assignment only. That dilutes toward the null: a
            # positive reading is trustworthy and a null one is ambiguous
            # between "no effect" and "contaminated". Per-student exposure
            # would remove it and costs what `review_scheduling` costs, which
            # is why it is not what this does; `tools/audit/measurement_cost.py`
            # carries both figures.
            #
            # The population is enforced rather than described. The draw writes
            # the weak types down (`assign(..., signal=...)`) because the list
            # is not recoverable later — the signal moves as the student
            # improves, which is the whole point of it — and the reading
            # restricts to answers on those types. Without that the arms would
            # be compared on every type the student happened to meet, most of
            # which neither arm touched, and the treatment would be diluted by
            # the bank.
            population="first encounters with a type the student was weak at "
            "when the run was built",
        ),
        Layer(
            key="run_sequencing",
            unit=UNIT_RUN,
            question="Does shaping a run to the student — review share, section mix — "
            "beat the fixed half-review, one-in-three-reading default?",
            signal="Queue pressure (share of tracked cards below target retention) and "
            "the gap between the two sections' shrunk accuracies.",
            without_signal="A cold account has no queue and no section gap, so the "
            "personalised shape and the fixed one coincide; the draw still happens and "
            "the comparison simply carries no contrast until there is history.",
            arms={"personalised": 0.75, "fixed": 0.25},
            off_arm="fixed",
            design_version="2026-08-12",
            status="seam",
        ),
        Layer(
            key="difficulty_targeting",
            unit=UNIT_RUN,
            question="Does aiming a run's questions at a difficulty derived from the "
            "student's own accuracy beat drawing difficulty as it falls?",
            signal="A per-question difficulty estimate. Owned by the difficulty work; "
            "this layer consumes it and does not produce it.",
            without_signal="Every question in the bank is difficulty 3 today, so the "
            "signal is absent for the whole bank and the layer must stay off until it "
            "is not. A layer with a constant signal is not adaptive, it is a constant.",
            arms={"targeted": 0.75, "uniform": 0.25},
            off_arm="uniform",
            design_version="2026-08-12",
            status="planned",
        ),
        Layer(
            key="review_scheduling",
            unit=UNIT_STUDENT,
            question="Does FSRS-6 — memory state per card, queue ordered by "
            "retrievability — return a question at a better moment than the fixed "
            "1/3/7/21-day ladder it replaced?",
            signal="Per-card stability and difficulty, updated from a grade derived "
            "from correctness, pace, confidence, explanation quality and whether the "
            "answer was changed. See `app/scheduling.py`.",
            without_signal="A card with no stability reports retrievability 0 and "
            "sorts to the front, which is the right place for a question just missed. "
            "The scheduler has no state to be missing — only state it has not gathered.",
            arms={"fsrs": 1.0, "ladder": 0.0},
            off_arm="ladder",
            design_version="2026-08-12-calibration",
            assigned_by="nobody: this layer is calibrated, not randomised",
            status="calibrated",
            instrument="calibration",
            # Why the holdout is not here, in the place a reader looking for it
            # will look. Two independent reasons, and either alone is enough.
            #
            # The arithmetic. The exposure has to be per student, because a
            # schedule cannot coherently flip between runs — a card put on a
            # 21-day interval by one arm is still on it when the next run
            # starts, so a per-run draw would measure a blend of both
            # schedulers and call it neither. Per student means the sample
            # grows at the rate accounts are opened, not at the rate questions
            # are answered, and the answers inside one account are heavily
            # correlated. `tools/audit/measurement_cost.py` puts the holdout at
            # roughly three and a half thousand students for a three-point
            # difference in review accuracy. This app does not have them, and
            # will not for a long time.
            #
            # The cost. The off arm is not a milder version of the treatment,
            # it is a scheduler the team believes is worse, shipped to a
            # quarter of students for the entire life of a trial that cannot
            # finish. Nobody can be released from it early either, for the same
            # reason the exposure is per student. That is a control arm nobody
            # would believe in and it should not be shipped.
            #
            # What is here instead is stronger than it sounds. FSRS predicts a
            # retrievability for every card at the moment it is served, so the
            # scheduler makes a falsifiable claim on every single review and
            # the claim can be scored against what happened without any
            # comparison group at all. See `scheduling.review_calibration`. The
            # part most likely to be wrong here is not FSRS — it is
            # `derive_grade`, which is this app's own invention, mapping pace,
            # confidence, explanation quality and whether the answer was
            # changed onto the four grades FSRS expects. A wrong grade mapping
            # produces wrong stabilities, and wrong stabilities show up as a
            # calibration curve that is displaced or flat. A flat one is a null
            # result for the whole layer, obtainable at a few thousand reviews
            # rather than a few thousand students.
        ),
        Layer(
            key="run_ordering",
            unit=UNIT_RUN,
            question="Does distributing review items through a run, and separating "
            "same-type questions, beat serving reviews first — measured on those "
            "questions' next return, and never pooled across the two sections?",
            signal="Which questions came from the review queue, and each question's "
            "type. See `scheduling.interleave`.",
            without_signal="A run with no review items, or one type-filtered by the "
            "student, is returned untouched, and no arm is drawn for it. The "
            "de-blocking pass is skipped outright on a filtered drill because the "
            "student asked for the block.",
            arms={"interleaved": 0.75, "front_loaded": 0.25},
            off_arm="front_loaded",
            design_version="2026-08-12",
            outcome_window="delayed",
            strata="section",
            # Both of these fields are load-bearing and both were arrived at
            # from the repository's own evidence file rather than from taste.
            #
            # `outcome_window="delayed"`. Rohrer's result, and the whole
            # desirable-difficulty literature under it, is about performance on
            # a *later* test. Interleaved practice reliably looks worse while
            # it is happening: the student is switching between question types
            # instead of grooving one, so within-run accuracy goes down even
            # where retention goes up. Reading this layer on the answers given
            # inside the assigned run would therefore report a working
            # treatment as a harmful one, confidently, with a large sample. The
            # reading is taken on the same questions' next return through the
            # review queue instead. That window is still available on
            # `immediate` for anyone who wants to see the trade rather than
            # only the payoff, and both are reported.
            #
            # `strata="section"`. `research/01-learning-science.md` carries
            # Brunmair and Richter's meta-analysis: interleaving at g = 0.42
            # overall, and g = 0.01 — a null — on expository text, with the
            # repository's own note beside it saying Reading Comprehension is
            # the case where interleaving buys nothing. A pooled figure would
            # average a Logical Reasoning effect against a Reading
            # Comprehension null and understate both, so this layer does not
            # have a pooled figure. The prediction is on the record before the
            # first observation, which is the only time a prediction is worth
            # anything.
        ),
        Layer(
            key="strategy_selection",
            unit=UNIT_ITEM,
            question="Given that an approach is offered, does choosing *which* one by "
            "the student's own record beat choosing uniformly among the candidates?",
            signal="Per-approach posterior accuracy, pace, calibration and explanation "
            "quality over that student's prompt-arm attempts; and a longer coverage "
            "runway on the types the last mega-litigation marked weak.",
            without_signal="Under the coverage target the draw is already uniform over "
            "the least-sampled candidates, so a cold student is getting the off arm by "
            "default — which is why this gap has never shown up as a bug. No arm is "
            "drawn there, nor on a question with a single candidate, where the two "
            "arms would pick the same approach and add a row that dilutes.",
            arms={"ranked": 0.75, "uniform": 0.25},
            off_arm="uniform",
            design_version="2026-08-12",
            assigned_by="app/strategies.py",
            outcome_join="attempt_columns",
            population="questions in the prompt arm of `strategy_offer`",
            # The nesting, which is the whole difficulty of this layer.
            #
            # A student in the control arm of `strategy_offer` is shown no
            # approach, so "which approach" has no effect on them and reading
            # this layer over everybody would dilute it by exactly the control
            # share. The analysis population is therefore the treated arm only,
            # which `population` above declares and
            # `strategies.strategy_selection_health` checks per student rather
            # than in a pooled share, because a pooled share is precisely the
            # instrument that cannot see this go wrong.
            #
            # The mechanism is not nested, and that is deliberate. The obvious
            # implementation — draw this arm only when the offer arm came out
            # `prompt` — breaks the offer trial. `_section_reading` compares a
            # given approach's prompt rows against that same approach's control
            # rows, so a control row carries the approach that *would* have
            # been offered. If the treated rows' approaches were chosen by a
            # mixture of ranked and uniform while the control rows' were chosen
            # by ranked alone, the two arms would no longer be labelled by the
            # same process: approach A on the treated side would include
            # occasions where A is not this student's leader, and approach A on
            # the control side would not. The comparison stops being about the
            # offer.
            #
            # So the draw happens on every eligible question, in both offer
            # arms, and the two randomisations are independent by construction
            # — `assign_strategy_trial` no longer feeds the chosen approach
            # into the offer arm's hash, which it used to. Independent draws
            # mean restricting to the treated arm does not disturb this layer's
            # own randomisation, and identical labelling means this layer does
            # not disturb the offer trial's. Both estimates stay clean, which
            # the nested-mechanism version cannot manage.
        ),
        Layer(
            key="strategy_offer",
            unit=UNIT_ITEM,
            question="Does suggesting a named approach on a question beat suggesting "
            "nothing?",
            signal="The student's own record per approach, and the question's candidate "
            "approaches.",
            without_signal="A question with no matching approach carries no trial at "
            "all; the mega-litigation is deliberately left clean.",
            arms={"prompt": 0.75, "control": 0.25},
            off_arm="control",
            # The shares have not moved. The mechanism has: the arm used to be
            # a hash that included the chosen approach, and no longer is, so
            # that it is independent of `strategy_selection` above. Same
            # propensity, different draw, and a draw is what a version names.
            design_version="2026-08-12",
            assigned_by="app/strategies.py",
            outcome_join="attempt_columns",
        ),
        Layer(
            key="strategy_forcing",
            unit=UNIT_ITEM,
            question="Does insisting on an approach beat merely suggesting it?",
            signal="Per-stratum information need: how thin the current estimate is and "
            "how often the offer is declined there.",
            without_signal="A run whose strata are all well measured draws no pool, and "
            "its questions carry a null forcing propensity — no counterfactual, so no "
            "part in the comparison.",
            arms={"required": 0.2, "optional": 0.8},
            off_arm="optional",
            design_version="strategies.py",
            assigned_by="app/strategies.py",
            outcome_join="attempt_columns",
        ),
    )
}


def layer(key: str) -> Layer:
    try:
        return LAYERS[key]
    except KeyError:  # pragma: no cover - a typo in a call site, caught in tests
        raise KeyError(f"unknown adaptive layer {key!r}; add it to experiments.LAYERS") from None


@dataclass(frozen=True)
class Assignment:
    """What one draw decided, and how much of a draw it was.

    `randomised` is False when the layer was switched off by configuration. In
    that case the arm is the off arm, the propensity is 1, and nothing is
    written down, because a deployment-wide switch is not a draw and an
    analysis must never see it as one — a row claiming propensity 1 on the off
    arm would look like a pool of size one and quietly weight itself to
    nothing.
    """

    layer: str
    arm: str
    propensity: float
    exposure: str
    randomised: bool

    @property
    def on(self) -> bool:
        return self.arm != LAYERS[self.layer].off_arm


def _stable_fraction(value: str) -> float:
    """A uniform draw in [0, 1) from a string.

    The same construction `strategies` uses, kept identical on purpose: two
    hashing schemes in one codebase is two things to verify, and this one is
    already audited.
    """
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64 - 1)


def _configured(key: str) -> dict:
    """Per-layer overrides from app config, if a deployment has set any.

    Two keys are honoured, `enabled` and `holdback`, and both exist for
    operational reasons rather than experimental ones: a layer that misbehaves
    has to be stoppable without a deploy, and a holdback has to be narrowable
    once a question has been answered. Changing a holdback is a new design and
    the caller is expected to move `design_version` with it; the report refuses
    to pool versions precisely so a forgotten bump shows up as two arms rather
    than being silently averaged.
    """
    configured = current_app.config.get("ADAPTIVE_LAYERS") or {}
    value = configured.get(key) or {}
    return value if isinstance(value, dict) else {}


def _arm_shares(spec: Layer) -> dict[str, float]:
    override = _configured(spec.key).get("holdback")
    if override is None:
        return dict(spec.arms)
    holdback = max(0.0, min(1.0, float(override)))
    on_arms = {arm: share for arm, share in spec.arms.items() if arm != spec.off_arm}
    total = sum(on_arms.values()) or 1.0
    shares = {arm: share / total * (1.0 - holdback) for arm, share in on_arms.items()}
    shares[spec.off_arm] = holdback
    return shares


def _draw(spec: Layer, subject_id: str, exposure: Exposure) -> tuple[str, float]:
    """Which arm, and the probability that arm had of being drawn.

    A single pass over the arms in declared order against one uniform variate.
    The probability returned is the realised one — the drawn arm's share of the
    weight actually in force for this draw — so a deployment that has narrowed
    a holdback does not leave older rows claiming a share nobody was drawn
    under.

    The hash includes the layer key, so two layers assigned on the same
    exposure are independent draws rather than the same coin read twice. It
    includes the subject, so arms are not correlated across students. It
    includes the exposure, which is the part that makes it a draw at all.
    """
    shares = _arm_shares(spec)
    total = sum(shares.values())
    if total <= 0:  # pragma: no cover - a registry with every share zeroed
        return spec.off_arm, 1.0
    target = _stable_fraction(f"{spec.key}:{subject_id}:{exposure.token}") * total
    cumulative = 0.0
    for arm, share in shares.items():
        cumulative += share
        if target < cumulative:
            return arm, share / total
    last = list(shares)[-1]
    return last, shares[last] / total


def _check_callable(spec: Layer, exposure: Exposure) -> None:
    if spec.instrument != "holdout":
        raise ValueError(
            f"layer {spec.key!r} is read by {spec.instrument}, not by a holdout; "
            "it has no arm to draw"
        )
    if exposure.kind != spec.unit:
        raise ValueError(
            f"layer {spec.key!r} is randomised per {spec.unit}, so it needs an "
            f"Exposure.{spec.unit}(...); got Exposure.{exposure.kind}(...)"
        )
    if not exposure.token:
        raise ValueError(f"layer {spec.key!r} was given an empty exposure")


def draw(layer_key: str, subject_id: str, *, exposure: Exposure) -> Assignment:
    """This layer's arm for this encounter, without writing a row.

    The same hash, the same share overrides and the same realised propensity as
    `assign`; the only difference is where the answer is kept. Some layers
    already have somewhere better to keep it than `layer_assignments`: the
    strategy trial's arms live in columns on the question that was served, next
    to the outcome they will be compared on, so an analysis joins nothing. For
    those, a central row would be a second copy to keep consistent and — since
    the strategy layers draw once per question — ten extra statements on the
    path that builds a run, which is already the most expensive request in the
    app.

    What must not vary between those layers and the rest is the *convention*:
    one hashing scheme, one definition of the recorded propensity, one place a
    holdback override is honoured. That is what this function is for. A caller
    that keeps its own arm still gets its arm from here.

    The caller is then responsible for recording `arm` and `propensity`
    somewhere an estimator can find them, and for the layer declaring
    `outcome_join="attempt_columns"` so the census says where that is.
    """
    spec = layer(layer_key)
    _check_callable(spec, exposure)
    if not _configured(spec.key).get("enabled", True):
        return Assignment(spec.key, spec.off_arm, 1.0, exposure.token, randomised=False)
    arm, propensity = _draw(spec, subject_id, exposure)
    return Assignment(spec.key, arm, propensity, exposure.token, randomised=True)


def assign(
    layer_key: str,
    subject_id: str,
    *,
    exposure: Exposure,
    session_id: str | None = None,
    signal: str | None = None,
) -> Assignment:
    """Draw this layer's arm for this student on this encounter, and record it.

    `exposure` is keyword-only and has no default, which is the same decision
    `assign_strategy_trial` reached the hard way: a draw that cannot say which
    encounter it belongs to is not a draw. Its `kind` must match the layer's
    declared unit, so the fact that a layer is randomised per run rather than
    per student is enforced where the mistake would be made rather than
    documented where it would be read afterwards.

    Asking twice with the same exposure returns the same answer, and returns it
    from the recorded row rather than by recomputing: a student is never
    flipped mid-run, and a share retuned between the two calls cannot rewrite
    what already happened.

    `session_id` is the run the assignment applies to, stored so outcomes can
    be joined without reconstructing anything. For a run-unit layer it is the
    exposure itself; for a student-unit layer it is the run the draw was first
    needed in, and is only ever a breadcrumb. There is no foreign key on it on
    purpose: the id is minted before the row it names exists, which is what
    lets the draw precede question selection.

    `signal` is what the layer's signal said at the moment of the draw, packed
    by `signal_tokens` into a sorted, separated string. It is here because a
    layer's declared population is otherwise a comment: `weak_type_targeting`
    claims to be read on later encounters with the types the student was weak
    at *when this run was built*, and that list is not recoverable afterwards,
    since the whole point of the rolling signal is that it moves as the student
    improves. Recorded once, at the only moment it is true, and read back by
    `layer_reading` as the set the population is restricted to. The spine gives
    the tokens no meaning beyond set membership.
    """
    spec = layer(layer_key)
    if spec.outcome_join != "session":
        # A registry entry is a description, not a switch. The strategy layers
        # keep their arms in columns beside the outcome and draw them through
        # `draw` above; writing a second copy here would leave two records of
        # one draw and no rule about which an estimator should believe.
        raise ValueError(
            f"layer {spec.key!r} records its arm on {spec.outcome_join}, and is drawn "
            f"by {spec.assigned_by} through experiments.draw(); assign() would write a "
            "second, competing copy of the same draw"
        )
    _check_callable(spec, exposure)
    if not _configured(spec.key).get("enabled", True):
        return Assignment(spec.key, spec.off_arm, 1.0, exposure.token, randomised=False)

    existing = LayerAssignment.query.filter_by(
        layer=spec.key, subject_id=subject_id, exposure=exposure.token
    ).one_or_none()
    if existing is not None:
        return Assignment(
            spec.key, existing.arm, existing.propensity, existing.exposure, randomised=True
        )

    arm, propensity = _draw(spec, subject_id, exposure)
    db.session.add(
        LayerAssignment(
            layer=spec.key,
            subject_id=subject_id,
            unit=spec.unit,
            exposure=exposure.token,
            arm=arm,
            propensity=propensity,
            design_version=spec.design_version,
            session_id=session_id or (exposure.token if spec.unit == UNIT_RUN else None),
            signal=signal,
        )
    )
    return Assignment(spec.key, arm, propensity, exposure.token, randomised=True)


# ---------------------------------------------------------------------------
# Reading the record back
#
# Two questions, and they are not the same question. "Did the layer help?" is
# `layer_reading`. "Was the draw a draw?" is `assignment_health`, and it is the
# one that has actually caught something: a mechanism can be measured
# faithfully for months against an allocation that stopped being random, and
# the estimate will be confidently wrong rather than obviously broken.
# ---------------------------------------------------------------------------


def _hajek(rows: list[tuple[bool, float]]) -> float:
    """Σ(y/π) / Σ(1/π) over one arm.

    The same estimator `strategies._arm_rate` applies to the strategy trial,
    with the same treatment of a missing or nonsensical propensity: unit
    weight, rather than dropping the observation, because dropping rows from an
    intention-to-treat estimate on the basis of a bookkeeping gap is how an
    unbiased estimate becomes a selected one.
    """
    if not rows:
        return 0.0
    weights = [1.0 / propensity if propensity and 0 < propensity <= 1 else 1.0 for _, propensity in rows]
    total = sum(weights)
    if total <= 0:  # pragma: no cover
        return 0.0
    return sum(weight for weight, (correct, _) in zip(weights, rows) if correct) / total


def contrast_sample(treated: int, control: int) -> float:
    """Effective per-arm sample behind a difference of two proportions.

    Dominated by the smaller arm: 1/(1/n₁ + 1/n₀). Two hundred treated runs
    against four controls is a four-observation comparison wearing a large
    number, and this is the quantity that says so.

    `strategies._contrast_sample` is now a call to this, so there is one copy.
    """
    if treated <= 0 or control <= 0:
        return 0.0
    return 1.0 / (1.0 / treated + 1.0 / control)


def _shrink_toward(rate: float, sample: int, centre: float) -> float:
    if sample <= 0:
        return centre
    return (PRIOR_STRENGTH * centre + sample * rate) / (PRIOR_STRENGTH + sample)


def _naive(value):
    """Comparable datetimes out of a store that may or may not keep the zone."""
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo is not None else value


def signal_tokens(values) -> str:
    """A layer's signal, packed for the `signal` column.

    Sorted so that the same set written on two runs is the same string, and
    truncated to fit the column rather than raising: a signal too long to
    record is a reading problem and not a reason to refuse a student a run.
    Truncation drops whole tokens from the end, so what survives is always a
    valid subset — a reading restricted to it is narrower than intended, never
    wrong.
    """
    text = ""
    for token in sorted({str(value) for value in values if value}):
        candidate = f"{text}{SIGNAL_SEPARATOR}{token}" if text else token
        if len(candidate) > SIGNAL_MAX_LENGTH:
            break
        text = candidate
    return text


def signal_set(value: str | None) -> frozenset[str]:
    """`signal_tokens` read back. The only meaning the spine gives the column."""
    return frozenset(part for part in (value or "").split(SIGNAL_SEPARATOR) if part)


def _immediate_rows(spec: Layer, user_id: str | None) -> list[tuple]:
    """Answers given inside the run the arm was drawn for.

    Restricted to the layer's declared population where it has one. For
    weak-type targeting the immediate reading is the *cost* side of the trade —
    a run leaning into your worst type is harder — and it is only that if it is
    read over the same answers the later window is read over. Pooled across
    every type in the run it would mostly be measuring the bank.
    """
    query = (
        db.session.query(
            LayerAssignment.arm,
            LayerAssignment.propensity,
            LayerAssignment.subject_id,
            Attempt.is_correct,
            Question.section,
            Question.question_type,
            LayerAssignment.signal,
        )
        .join(StudySession, StudySession.id == LayerAssignment.session_id)
        .join(SessionItem, SessionItem.session_id == StudySession.id)
        .join(Question, Question.id == SessionItem.question_id)
        .join(Attempt, Attempt.session_item_id == SessionItem.id)
        .filter(
            LayerAssignment.layer == spec.key,
            LayerAssignment.design_version == spec.design_version,
        )
    )
    if user_id:
        query = query.filter(LayerAssignment.subject_id == user_id)
    rows = []
    for arm, propensity, subject, correct, section, question_type, signal in query.all():
        if spec.restricted_by_signal and question_type not in signal_set(signal):
            continue
        rows.append((arm, propensity, subject, bool(correct), section))
    return rows


def _delayed_rows(spec: Layer, user_id: str | None) -> list[tuple]:
    """Answers given when the assigned run's questions came *back*.

    The delayed test the interleaving literature actually measures, assembled
    out of what the app already stores rather than out of a new experiment:
    a question served in an assigned run, returning through the review queue in
    some later run, and answered there. The arm credited is the most recent
    assigned run that served the question before the answer, because that is
    the treatment closest in time to the outcome — and because crediting the
    first one would keep charging a run from three weeks ago for orderings the
    student has met four times since.

    Two properties this has to hold, and both are enforced below rather than
    assumed. Each returning answer is credited to exactly one assignment, so no
    outcome is counted twice under two arms. And the answer must fall in a
    different run from the assignment, so the interval is a real one; an
    immediate re-ask inside the same sitting is the other window's business.

    The interval is whatever FSRS chose, so this is not a fixed-delay test and
    should not be described as one. It is unbiased for all that: the scheduler
    does not know the arm, so the delay it picks cannot be correlated with it.
    """
    served = (
        db.session.query(
            LayerAssignment.subject_id,
            LayerAssignment.arm,
            LayerAssignment.propensity,
            LayerAssignment.session_id,
            SessionItem.question_id,
            StudySession.started_at,
        )
        .join(StudySession, StudySession.id == LayerAssignment.session_id)
        .join(SessionItem, SessionItem.session_id == StudySession.id)
        .filter(
            LayerAssignment.layer == spec.key,
            LayerAssignment.design_version == spec.design_version,
        )
    )
    if user_id:
        served = served.filter(LayerAssignment.subject_id == user_id)
    exposures: dict[tuple[str, str], list[tuple]] = {}
    for subject, arm, propensity, run_id, question_id, started in served.all():
        exposures.setdefault((subject, question_id), []).append(
            (_naive(started), run_id, arm, propensity)
        )
    if not exposures:
        return []
    for entries in exposures.values():
        entries.sort(key=lambda entry: (entry[0] is None, entry[0]))

    returns = (
        db.session.query(
            Attempt.user_id,
            SessionItem.question_id,
            SessionItem.session_id,
            Attempt.created_at,
            Attempt.is_correct,
            Question.section,
        )
        .join(SessionItem, SessionItem.id == Attempt.session_item_id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(SessionItem.from_review_queue.is_(True))
    )
    if user_id:
        returns = returns.filter(Attempt.user_id == user_id)

    rows = []
    for subject, question_id, run_id, answered_at, correct, section in returns.all():
        entries = exposures.get((subject, question_id))
        if not entries:
            continue
        answered = _naive(answered_at)
        prior = [
            entry
            for entry in entries
            if entry[1] != run_id and entry[0] is not None and answered is not None and entry[0] < answered
        ]
        if not prior:
            continue
        _, _, arm, propensity = prior[-1]
        rows.append((arm, propensity, subject, bool(correct), section))
    return rows


def _later_encounter_rows(spec: Layer, user_id: str | None) -> list[tuple]:
    """First encounters, in a later run, with a type the assigned run leaned into.

    The outcome weak-type targeting actually claims. A run in the targeted arm
    serves more of the student's weakest types; if that works, the student is
    better at *those types* afterwards, on questions they have never seen. So
    the answers read here are new questions, of a type the assignment's
    recorded signal named, answered in a run that started after the assigned
    one.

    Three choices, all of which change the number:

    **New questions only.** `from_review_queue` is excluded, which is the
    difference between this window and `delayed`. Returns are cards the
    treated arm created more of, by serving more questions the student was
    likely to miss; comparing arms on them compares two differently-composed
    sets of material. It is also the exclusion `type_focus` makes on the input
    side, for the same reason, and making it on one side only would be strange.

    **Credited to the most recent preceding assignment that named the type.**
    Assignments that did not name the type neither targeted it nor withheld
    it — the type was not in their population — so they are not candidates to
    credit, and skipping them is not selection on an outcome: which *arm* a run
    drew is random and independent of which types its signal held. Runs where
    the type was named are the trial for that type, and the closest one in time
    is the treatment the outcome belongs to.

    **One credit per answer**, as in `_delayed_rows`, so no outcome is counted
    twice under two arms.

    A later run that is itself assigned still supplies outcomes for the run
    before it, and that is where most of the observations come from rather than
    an edge case: a student's sittings are the only place fresh questions of
    the type appear. It costs nothing in bias. The later run's own arm changes
    *how many* questions of the type it serves, not which of them the student
    gets right — the fill biases composition and draws from the same pool — so
    the arms end up with unequal sample sizes and unbiased rates. Interference
    from that run's own treatment is the separate problem the registry entry
    states plainly and does not solve; it dilutes toward the null.
    """
    served = (
        db.session.query(
            LayerAssignment.subject_id,
            LayerAssignment.arm,
            LayerAssignment.propensity,
            LayerAssignment.session_id,
            LayerAssignment.signal,
            StudySession.started_at,
        )
        .join(StudySession, StudySession.id == LayerAssignment.session_id)
        .filter(
            LayerAssignment.layer == spec.key,
            LayerAssignment.design_version == spec.design_version,
        )
    )
    if user_id:
        served = served.filter(LayerAssignment.subject_id == user_id)

    # (student, type) -> the assignments that named that type, oldest first.
    targeted: dict[tuple[str, str], list[tuple]] = {}
    for subject, arm, propensity, run_id, signal, started in served.all():
        for question_type in signal_set(signal):
            targeted.setdefault((subject, question_type), []).append(
                (_naive(started), run_id, arm, propensity)
            )
    if not targeted:
        return []
    for entries in targeted.values():
        entries.sort(key=lambda entry: (entry[0] is None, entry[0]))

    encounters = (
        db.session.query(
            Attempt.user_id,
            SessionItem.session_id,
            Attempt.created_at,
            Attempt.is_correct,
            Question.section,
            Question.question_type,
        )
        .join(SessionItem, SessionItem.id == Attempt.session_item_id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(SessionItem.from_review_queue.is_(False))
    )
    if user_id:
        encounters = encounters.filter(Attempt.user_id == user_id)

    rows = []
    for subject, run_id, answered_at, correct, section, question_type in encounters.all():
        entries = targeted.get((subject, question_type))
        if not entries:
            continue
        answered = _naive(answered_at)
        if answered is None:
            continue
        prior = [
            entry
            for entry in entries
            if entry[1] != run_id and entry[0] is not None and entry[0] < answered
        ]
        if not prior:
            continue
        _, _, arm, propensity = prior[-1]
        rows.append((arm, propensity, subject, bool(correct), section))
    return rows


def outcome_rows(layer_key: str, *, window: str | None = None, user_id: str | None = None) -> list[tuple]:
    """The answers a reading of this layer is over, one tuple each.

    `(arm, propensity, subject, correct, section)`, which is everything an
    estimate of this layer needs and nothing else. Public because a layer with
    a question of its own regroups them: `type_focus.rolling_population_reading`
    splits the same rows by how much history the student had, since a layer
    whose treatment needs a weakness to act on behaves differently at the two
    ends of that. Regrouping the spine's rows rather than re-deriving them is
    what keeps the cohort view and the layer reading the same measurement.
    """
    spec = layer(layer_key)
    window = window or spec.outcome_window
    if window not in WINDOWS:
        raise ValueError(f"unknown outcome window: {window!r}")
    readers = {
        WINDOW_IMMEDIATE: _immediate_rows,
        WINDOW_DELAYED: _delayed_rows,
        WINDOW_LATER_ENCOUNTERS: _later_encounter_rows,
    }
    return readers[window](spec, user_id)


def summarise(layer_key: str, rows: list[tuple]) -> dict:
    """`layer_reading`'s arithmetic over any subset of `outcome_rows`."""
    return _summarise(layer(layer_key), rows)


def _summarise(spec: Layer, rows: list[tuple]) -> dict:
    """One arm-by-arm reading over an already-selected set of answers.

    Both arms are shrunk toward the pooled rate rather than reported raw. The
    centre is the null: if the layer changes nothing, that is where both arms
    sit, so a thin comparison reports something near zero rather than something
    dramatic. It moves off the null in proportion to evidence, which for a
    layer whose holdback is a quarter of runs takes a while, and saying so is
    more useful than a number that swings on the third run.

    Arms come back in registry order with their own samples, so a reader can
    see a comparison that has not filled yet as an empty denominator rather
    than as a difference of zero.
    """
    by_arm: dict[str, list[tuple[bool, float]]] = {arm: [] for arm in spec.arms}
    subjects: dict[str, set[str]] = {arm: set() for arm in spec.arms}
    for arm, propensity, subject, correct, _section in rows:
        by_arm.setdefault(arm, []).append((correct, propensity))
        subjects.setdefault(arm, set()).add(subject)

    answers = sum(len(values) for values in by_arm.values())
    pooled = (
        sum(1 for values in by_arm.values() for correct, _ in values if correct) / answers
        if answers
        else 0.0
    )
    centre = shrink_toward_prior(pooled, answers)

    arms = []
    for arm in spec.arms:
        values = by_arm.get(arm, [])
        arms.append(
            {
                "arm": arm,
                "is_off_arm": arm == spec.off_arm,
                "answers": len(values),
                "students": len(subjects.get(arm, ())),
                "accuracy": round(_hajek(values) * 100, 1) if values else None,
                "adjusted_accuracy": round(
                    _shrink_toward(_hajek(values), len(values), centre) * 100, 1
                )
                if values
                else None,
            }
        )

    treated = sum(entry["answers"] for entry in arms if not entry["is_off_arm"])
    control = sum(entry["answers"] for entry in arms if entry["is_off_arm"])
    treated_rate = _shrink_toward(
        _hajek([row for arm in spec.arms if arm != spec.off_arm for row in by_arm.get(arm, [])]),
        treated,
        centre,
    )
    control_rate = _shrink_toward(_hajek(by_arm.get(spec.off_arm, [])), control, centre)
    effective = contrast_sample(treated, control)
    return {
        "arms": arms,
        "answers": answers,
        "baseline_accuracy": round(centre * 100, 1),
        "adjusted_lift": round((treated_rate - control_rate) * 100, 1) if effective else None,
        "contrast_sample": round(effective, 1),
    }


def layer_reading(layer_key: str, *, user_id: str | None = None, window: str | None = None) -> dict:
    """What the record says about one layer, per arm, on the answers filed under it.

    Intention-to-treat, and only that. Membership is the arm the run was
    assigned, never what the run turned out to contain: a personalised run that
    happened to come out looking like a default one still counts as
    personalised, because the alternative — reclassifying on what was
    delivered — selects on an outcome of the assignment and stops being a
    comparison.

    Two things this function will not do, both of them because doing them
    quietly is how a measurement comes out backwards.

    It will not read a layer in a window the layer did not declare, unless
    asked in as many words. `window` defaults to `spec.outcome_window`. For
    `run_ordering` that is `delayed`, because interleaving is expected to cost
    accuracy while it is happening and repay it later; for
    `weak_type_targeting` it is `later_encounters`, because a run leaning into
    your worst type is harder while you are sitting it. Either immediate
    reading is available by passing `window="immediate"`, and comes back
    labelled with the declared window beside it, so the trade is visible rather
    than deniable.

    It will not read a layer outside the population it declared. Where the
    population is defined by the signal at the moment of the draw, the reading
    keeps only answers matching what was recorded there — every window, not
    just the declared one, so the cost and the benefit are measured over the
    same answers.

    It will not report a pooled lift for a layer that declares `strata`. The
    per-stratum readings are there instead. For interleaving the strata are the
    two sections and the reason is on the record in advance: the repository's
    evidence file predicts a real Logical Reasoning effect against a Reading
    Comprehension null, and one number covering both would understate each.
    """
    spec = layer(layer_key)
    if spec.instrument != "holdout":
        return {
            "layer": spec.key,
            "status": spec.status,
            "instrument": spec.instrument,
            "measured_elsewhere": True,
            "note": (
                "This layer has no arms to read. It is scored against its own "
                "predictions; see `scheduling.review_calibration`."
            ),
        }
    if spec.outcome_join != "session":
        return {
            "layer": spec.key,
            "status": spec.status,
            "assigned_by": spec.assigned_by,
            "measured_elsewhere": True,
            "note": (
                "This layer draws through `experiments.draw` and records its own arms "
                "on `attempts`; read it through `strategies.strategy_performance` and "
                "`strategies.strategy_selection_reading`."
            ),
        }

    window = window or spec.outcome_window
    rows = outcome_rows(spec.key, window=window, user_id=user_id)
    overall = _summarise(spec, rows)

    strata = []
    if spec.strata == "section":
        by_section: dict[str, list[tuple]] = {}
        for row in rows:
            by_section.setdefault(row[4] or "unknown", []).append(row)
        strata = [
            {"stratum": section, **_summarise(spec, values)}
            for section, values in sorted(by_section.items())
        ]

    reading = {
        "layer": spec.key,
        "status": spec.status,
        "question": spec.question,
        "design_version": spec.design_version,
        "unit": spec.unit,
        "window": window,
        "declared_window": spec.outcome_window,
        "population": spec.population,
        "population_enforced": spec.restricted_by_signal,
        "strata_by": spec.strata,
        "strata": strata,
        **overall,
        "basis": "intention-to-treat over the assigned arm, Hájek-weighted by the "
        "recorded propensity, both arms shrunk toward no difference",
    }
    if window != spec.outcome_window:
        reading["window_note"] = (
            f"Read in the {window} window; this layer declares {spec.outcome_window}. "
            "The declared window is the one its effect is expected in."
        )
    if spec.strata:
        # The pooled number is withheld rather than merely discouraged. A
        # figure present in a payload gets read, and this one would average an
        # effect against a null.
        reading["adjusted_lift"] = None
        reading["pooled_lift_withheld"] = (
            f"This layer is stratified by {spec.strata} and has no pooled lift. Pooling "
            "would average a Logical Reasoning effect against a Reading Comprehension "
            "null — predicted at g = 0.01 for expository text in "
            "`research/01-learning-science.md` — and understate both."
        )
    return reading


# A student's realised share of an arm may differ from the design's share by
# chance, and on few draws it differs a lot: ten runs at a quarter holdback
# lands on exactly 2.5 expected control runs, so seeing zero is ordinary. This
# is the fewest draws at which a realised share is worth reading at all, and
# `assignment_health` reports the shortfall count only over students above it.
HEALTH_MIN_DRAWS = 20
# How far a student's realised share may sit from the design before it is worth
# a look. Wide, because the point of the check is to catch a mechanism that has
# stopped drawing, not to police sampling noise: the failure it exists for
# showed a designed 25% arriving at 2%.
HEALTH_TOLERANCE = 0.5


def assignment_health(layer_key: str) -> dict:
    """Whether this layer's draws are still draws, measured per student.

    The check the strategy trial needed and did not have. Its control arm read
    25.0% across the bank while individual heavy users sat near 2%, because the
    hash could not tell two encounters with the same question apart and a
    repeated question re-drew the same arm forever. An aggregate is exactly the
    wrong instrument for that failure: it is an average over students, and the
    quantity that broke is per student.

    Three readings, and each would have caught it on its own:

    * `exposures_per_draw` — distinct exposure tokens over total draws, per
      student. A caller who passes something coarser than the unit (the same
      run token twice, a student id where a run was wanted) drives this below
      one. It cannot go below one here, because the exposure is the row's
      uniqueness key, which is the structural half of the guard; it is reported
      so that a *future* caller who works around that cannot do it quietly.
    * `realised_share` per arm, summarised across students rather than pooled
      over them. The minimum is the number that matters.
    * `students_off_design` — how many students with enough draws sit further
      than `HEALTH_TOLERANCE` from the design share.

    Report-only. Nothing here changes an assignment; a broken allocation is
    repaired by fixing the draw and starting a new design version, never by
    rewriting rows whose propensity an estimator has already trusted.
    """
    spec = layer(layer_key)
    rows = (
        db.session.query(
            LayerAssignment.subject_id,
            LayerAssignment.arm,
            LayerAssignment.exposure,
            LayerAssignment.design_version,
        )
        .filter(LayerAssignment.layer == spec.key)
        .all()
    )
    per_student: dict[str, dict] = {}
    versions: dict[str, int] = {}
    for subject, arm, exposure, version in rows:
        entry = per_student.setdefault(subject, {"draws": 0, "arms": {}, "exposures": set()})
        entry["draws"] += 1
        entry["arms"][arm] = entry["arms"].get(arm, 0) + 1
        entry["exposures"].add(exposure)
        versions[version] = versions.get(version, 0) + 1

    students = len(per_student)
    total = sum(entry["draws"] for entry in per_student.values())
    arms = []
    for arm in spec.arms:
        design = spec.share(arm)
        shares = [
            entry["arms"].get(arm, 0) / entry["draws"]
            for entry in per_student.values()
            if entry["draws"] >= HEALTH_MIN_DRAWS
        ]
        pooled = sum(entry["arms"].get(arm, 0) for entry in per_student.values())
        arms.append(
            {
                "arm": arm,
                "design_share": round(design, 3),
                "pooled_share": round(pooled / total, 3) if total else None,
                "students_measured": len(shares),
                "min_student_share": round(min(shares), 3) if shares else None,
                "median_student_share": round(sorted(shares)[len(shares) // 2], 3) if shares else None,
                "max_student_share": round(max(shares), 3) if shares else None,
                "students_off_design": sum(
                    1 for share in shares if abs(share - design) > HEALTH_TOLERANCE * design
                ),
            }
        )
    reuse = [
        len(entry["exposures"]) / entry["draws"]
        for entry in per_student.values()
        if entry["draws"]
    ]
    return {
        "layer": spec.key,
        "unit": spec.unit,
        "students": students,
        "draws": total,
        "design_versions": versions,
        "min_exposures_per_draw": round(min(reuse), 3) if reuse else None,
        "arms": arms,
        "min_draws_for_a_student_reading": HEALTH_MIN_DRAWS,
    }


def registry_reading() -> list[dict]:
    """The census: every adaptive layer, what it reads, and how it is measured.

    Written for a person rather than for a query. `docs/learning-system.md` is
    the prose version of this list, and the two are meant to be checked against
    each other — a layer added to one and not the other is the state this
    module exists to make visible.
    """
    return [
        {
            "layer": spec.key,
            "status": spec.status,
            "unit": spec.unit,
            "question": spec.question,
            "signal": spec.signal,
            "without_signal": spec.without_signal,
            "arms": spec.arms,
            "off_arm": spec.off_arm,
            "assigned_by": spec.assigned_by,
            "design_version": spec.design_version,
            "instrument": spec.instrument,
            "outcome_window": spec.outcome_window,
            "strata": spec.strata,
            "population": spec.population,
        }
        for spec in LAYERS.values()
    ]
