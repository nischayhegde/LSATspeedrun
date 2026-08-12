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
from .models import Attempt, LayerAssignment, SessionItem, StudySession
from .scoring import PRIOR_STRENGTH, shrink_toward_prior

# What a draw is allowed to vary over, which is the same thing as what the
# layer's effect is a property of.
UNIT_STUDENT = "student"
UNIT_RUN = "run"
UNIT_ITEM = "item"
UNITS = (UNIT_STUDENT, UNIT_RUN, UNIT_ITEM)


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

    def share(self, arm: str) -> float:
        total = sum(self.arms.values())
        return (self.arms.get(arm, 0.0) / total) if total > 0 else 0.0


# Every adaptive layer in the product, in four states:
#
#   live       drawn, recorded, and estimable today
#   seam       registered and waiting for the code it wraps to land
#   planned    the signal it needs does not exist yet
#   unmeasured shipped and deciding, with nothing drawing an off arm for it
#
# The last state is the uncomfortable one and it is why the list includes
# layers this module does not touch. A census that only counted what was
# already measured would report a fully measured system, which is exactly the
# kind of instrument that agrees with whoever points it. Three of the eight
# entries below are `unmeasured`: that is the honest headline, and each of them
# names the reason in its own `without_signal`.
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
            question="Does steering fresh questions toward the types a mega-litigation "
            "marked weak beat drawing them from the whole bank?",
            signal="`focus.diagnostic_focus`: the question types the last diagnostic "
            "scored worst on.",
            without_signal="No diagnostic, no focus types, and the run is drawn as if "
            "the layer were off. Those runs are not part of the comparison.",
            arms={"targeted": 0.75, "untargeted": 0.25},
            off_arm="untargeted",
            design_version="2026-08-12",
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
            arms={"fsrs": 0.75, "ladder": 0.25},
            off_arm="ladder",
            design_version="unmeasured",
            assigned_by="nothing draws this",
            status="unmeasured",
        ),
        Layer(
            key="run_ordering",
            unit=UNIT_RUN,
            question="Does distributing review items through a run, and separating "
            "same-type questions, beat serving reviews first?",
            signal="Which questions came from the review queue, and each question's "
            "type. See `scheduling.interleave`.",
            without_signal="A run with no review items, or one type-filtered by the "
            "student, is returned untouched. The de-blocking pass is skipped outright "
            "on a filtered drill because the student asked for the block.",
            arms={"interleaved": 0.75, "front_loaded": 0.25},
            off_arm="front_loaded",
            design_version="unmeasured",
            assigned_by="nothing draws this",
            status="unmeasured",
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
            "default — which is why this gap has never shown up as a bug.",
            arms={"ranked": 0.75, "uniform": 0.25},
            off_arm="uniform",
            design_version="unmeasured",
            assigned_by="app/strategies.py",
            status="unmeasured",
            outcome_join="attempt_columns",
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
            design_version="strategies.py",
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


def assign(
    layer_key: str,
    subject_id: str,
    *,
    exposure: Exposure,
    session_id: str | None = None,
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
    """
    spec = layer(layer_key)
    if spec.assigned_by != "app/experiments.py":
        # A registry entry is a description, not a switch. The census carries
        # layers this module does not draw so the holes are visible, and the
        # cost of that honesty is that `LAYERS` now contains keys which look
        # callable and are not: drawing `review_scheduling` here would write
        # rows under a design nothing implements and leave an analysis reading
        # arms no student was ever in.
        raise ValueError(
            f"layer {spec.key!r} is drawn by {spec.assigned_by}, not here; "
            "it is registered so the census is complete, not so it can be assigned"
        )
    if exposure.kind != spec.unit:
        raise ValueError(
            f"layer {spec.key!r} is randomised per {spec.unit}, so it needs an "
            f"Exposure.{spec.unit}(...); got Exposure.{exposure.kind}(...)"
        )
    if not exposure.token:
        raise ValueError(f"layer {spec.key!r} was given an empty exposure")
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

    Identical to `strategies._contrast_sample`, which is one copy too many. The
    duplication is deliberate and temporary: that function is private to a file
    another change is actively rewriting, and importing across that seam now
    would trade a two-line repetition for a merge conflict in an estimator. The
    merge note asks for the strategy module to import this one.
    """
    if treated <= 0 or control <= 0:
        return 0.0
    return 1.0 / (1.0 / treated + 1.0 / control)


def _shrink_toward(rate: float, sample: int, centre: float) -> float:
    if sample <= 0:
        return centre
    return (PRIOR_STRENGTH * centre + sample * rate) / (PRIOR_STRENGTH + sample)


def layer_reading(layer_key: str, *, user_id: str | None = None) -> dict:
    """What the record says about one layer, per arm, on the answers filed under it.

    Intention-to-treat, and only that. Membership is the arm the run was
    assigned, never what the run turned out to contain: a personalised run that
    happened to come out looking like a default one still counts as
    personalised, because the alternative — reclassifying on what was
    delivered — selects on an outcome of the assignment and stops being a
    comparison.

    Both arms are shrunk toward the pooled rate rather than reported raw. The
    centre is the null: if the layer changes nothing, that is where both arms
    sit, so a thin comparison reports something near zero rather than something
    dramatic. It moves off the null in proportion to evidence, which for a
    layer whose holdback is a quarter of runs takes a while, and saying so is
    more useful than a number that swings on the third run.

    Returns arms in registry order with their own samples, so a reader can see
    a comparison that has not filled yet as an empty denominator rather than as
    a difference of zero.
    """
    spec = layer(layer_key)
    if spec.outcome_join != "session":
        return {
            "layer": spec.key,
            "status": spec.status,
            "assigned_by": spec.assigned_by,
            "measured_elsewhere": True,
            "note": (
                "This layer draws and records its own arms on `attempts`; read it "
                "through `strategies.strategy_performance`."
            ),
        }

    query = (
        db.session.query(
            LayerAssignment.arm,
            LayerAssignment.propensity,
            LayerAssignment.subject_id,
            Attempt.is_correct,
        )
        .join(StudySession, StudySession.id == LayerAssignment.session_id)
        .join(SessionItem, SessionItem.session_id == StudySession.id)
        .join(Attempt, Attempt.session_item_id == SessionItem.id)
        .filter(
            LayerAssignment.layer == spec.key,
            LayerAssignment.design_version == spec.design_version,
        )
    )
    if user_id:
        query = query.filter(LayerAssignment.subject_id == user_id)
    rows = query.all()

    by_arm: dict[str, list[tuple[bool, float]]] = {arm: [] for arm in spec.arms}
    subjects: dict[str, set[str]] = {arm: set() for arm in spec.arms}
    for arm, propensity, subject, correct in rows:
        by_arm.setdefault(arm, []).append((bool(correct), propensity))
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
        "layer": spec.key,
        "status": spec.status,
        "question": spec.question,
        "design_version": spec.design_version,
        "unit": spec.unit,
        "arms": arms,
        "answers": answers,
        "baseline_accuracy": round(centre * 100, 1),
        "adjusted_lift": round((treated_rate - control_rate) * 100, 1) if effective else None,
        "contrast_sample": round(effective, 1),
        "basis": "intention-to-treat over the assigned arm, Hájek-weighted by the "
        "recorded propensity, both arms shrunk toward no difference",
    }


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
        }
        for spec in LAYERS.values()
    ]
