"""Question difficulty: an online Elo rating, with provenance attached to it.

What this replaces
------------------
Nothing. That is the point. Every one of the 6,886 questions in the bank
carried `difficulty = 3`, written by `seed._upsert_row` and read by exactly two
things: a serialized field in `history.py`, and the coaching prompt, which was
told "difficulty: 3" on every question it has ever seen. No part of the
adaptive path read it — not `select_random_questions`, not
`_weight_toward_focus`, not `scheduling.interleave`, not
`strategies.assign_strategy_trial`, not `plan_forced_arms`, not
`due_for_review`. This is therefore an absent feature rather than a broken one,
and the first thing built here is the honest empty state: a question nobody has
answered has **no difficulty at all**, not a three.

Do not confuse this with `ReviewQueueItem.difficulty`, which does vary and is a
different quantity entirely — the D of the FSRS DSR memory model, one student's
retrieval difficulty for one card. See `app/scheduling.py`. The value here is a
property of the *item*, shared by everybody, and is measured in logits.

Is there an official rating instead?
------------------------------------
Asked first, because a published rating would beat any estimate this file can
produce. The answer is no, and the check is recorded in
`docs/question-difficulty.md`: the bank is the whole of `tasksource/lsat-lr` and
`tasksource/lsat-rc`, whose upstream schema is five fields — `context`,
`id_string`, `answers`, `label`, `question` — with no difficulty column at any
revision, and whose own upstream (Zhong et al.'s LSAT scrape, PrepTests
1991-2016) never carried one either. LSAC has published per-item 1-5 ratings for
exactly six PrepTests, in *SuperPrep* and *SuperPrep II*; five of those six are
in this bank, which is 388 items of 6,886, and the ratings exist only as prose
in two copyrighted books. `Question.published_difficulty` is the column that
would hold such a rating. It is NULL on every row and nothing in this file ever
writes it.

Why Elo and not Item Response Theory
------------------------------------
`research/11-measurement-implementation-spec.md` § 6 specifies a Rasch JMLE fit,
and that is the right endpoint. It is not reachable from here. A stable Rasch
item estimate wants on the order of 100-200 responses per item; across 6,886
items that is roughly a million responses before the bank is calibrated, and
that corpus does not exist. An estimator that produces nothing until then
produces nothing, which is the state this app has been in since it was built.

The Elo rating system, applied to items rather than to chess players, converges
toward the same quantity the Rasch difficulty parameter estimates, costs one
arithmetic update per response instead of a batch refit, and says something
after the first response. The precedent is Klinkenberg, Straatemeier & van der
Maas, "Computer adaptive practice of maths ability using a new item response
model for on the fly ability and difficulty estimation" (Computers & Education
57, 2011), which is the Math Garden system: Elo run online over millions of
child-item matches, with the ratings used for adaptive item selection. Elo's
equivalence to stochastic-approximation estimation of a Rasch model is the
reason this is a staging post toward § 6 rather than a detour away from it —
when the responses exist, the ratings here are the starting values for the fit.

The model
---------
One response is a match between a student and a question:

    p = c + (1 − c) · σ(θ − b)

θ is the student's ability in that section, b the item's difficulty, both in
logits, and c the floor a five-choice multiple-choice question cannot go below.
Plain Elo sets c = 0, which claims a hard enough item is answered correctly
never; the observed floor on a five-choice item is a fifth, and ignoring it
makes every hard item's rating run away upward as it keeps being "surprised" by
guesses. c = 1/(number of choices).

The update is gradient ascent on the log-likelihood of that response, which for
c > 0 is not quite Elo's (y − p):

    ∂logL/∂z = (y − p) · q/p       where q = σ(z), z = θ − b

    θ ← θ + K_θ · (y − p) · q/p
    b ← b − K_b · (y − p) · q/p

At c = 0, q = p and the factor is 1, so this reduces exactly to Elo. At c = 0.2
a correct answer on an item the student had a 22% chance of is treated as the
weak evidence it is, because most of that 22% was the guess.

K, and why the two sides differ
-------------------------------
Every response also carries Fisher information about z:

    I = (1 − c) · q² · (1 − q) / p

which is q(1−q) at c = 0, the Rasch case, and which correctly discounts a
response from a student so far above or below the item that the answer was a
foregone conclusion. Accumulating it gives both the standard error, 1/√ΣI, and
the step size:

    K = 1 / (prior precision + ΣI)

That is the stochastic Newton step rather than a tuned constant, and it is the
same idea Glicko adds to Elo: carry the uncertainty and let it set how far each
response is allowed to move the rating. A brand-new item moves a long way on its
first response and barely at all on its two-hundredth, without a hand-picked
schedule deciding when that happens. Measured against a fixed-K schedule on the
simulation in `scripts/calibration_lab.py` — 400 items, 9,600 responses, 2PL
generator — it is worth 0.006 nats of held-out log loss and 0.010 of AUC, which
is small but free.

The two sides differ in one respect. The item's K decays without limit, because
an item's difficulty is a fixed property and two hundred responses in there is
nothing left to learn from one more. The student's information is **capped**, so
their K never falls below 1/(1 + cap), because ability is *not* fixed — the
entire product is an attempt to change it — and a rating that stops moving stops
tracking the person. In Kalman terms the cap is standing in for process noise.

What "calibrated" is allowed to mean
------------------------------------
`status` is a statement about evidence rather than a label: an item with four
responses is `provisional` and no consumer may target on it; an item with fifty
and an SE under 0.30 logits is `calibrated`. The SE is optimistic — it treats θ
as known when θ is itself estimated, and Elo is noisier than maximum likelihood
— so the thresholds below are set conservatively and the number is published
rather than hidden.

Selection bias, which is the failure mode that matters
------------------------------------------------------
The moment difficulty influences *which* questions a student sees, hard items
are answered mostly by strong students and the rating stops measuring the item.
The defence is the one this codebase already uses for the strategy trial: keep a
known fraction of assignment random, and record the propensity on the row rather
than reconstructing it later. `exposure_draw` below is deliberately the same
construction as the control draw in `strategies.assign_strategy_trial` — a
stable hash against a fixed threshold — so that a selector which starts reading
difficulty keeps a quarter of its slots difficulty-blind by contract.

Two ratings are therefore kept per item, not one. `rating` learns from every
response. `blind_rating` learns only from responses whose exposure was
difficulty-independent. Today they are identical, because nothing targets and
every response is blind. The day they diverge is the day the naive rating has
been distorted by the selector, and the size of the gap is the size of the
distortion — a measurement rather than a worry.
"""

from __future__ import annotations

import hashlib
import math
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Iterator

from .extensions import db
from .models import LearnerRating, Question, QuestionCalibration, utcnow


# --- The response model -----------------------------------------------------

# Fallback for the guessing floor when the choices are not loaded. Every
# question in this bank has five, and `_validated_record` in `seed.py` refuses
# anything with fewer than two.
DEFAULT_CHOICE_COUNT = 5

# Both ratings start here. Zero is not a claim that an unseen item is average —
# an unseen item has no row at all and no rating. It is the origin the scale is
# defined from, and `scale_centre` re-centres reads on the bank's own mean so a
# slow common-mode drift in the origin cannot move the bands.
INITIAL_RATING = 0.0

# Prior precision, 1/σ₀². σ₀ = 1 logit on both sides: a published LSAT bank's
# item difficulties span roughly ±2 logits, and an unseen student is assumed
# no more than a standard deviation from the middle. Its only job is to keep the
# first response's step finite, so it is not a sensitive constant.
ITEM_PRIOR_PRECISION = 1.0
LEARNER_PRIOR_PRECISION = 1.0

# The most information a student's ability rating is ever allowed to accumulate,
# which floors their step size at 1/(1 + 9) = 0.1. An SE of 1/√10 ≈ 0.32 logits
# is as well as this claims to know an ability that is genuinely moving; past
# that point extra confidence would only make the rating slower to notice that
# somebody has improved. Items have no such cap because they do not improve.
LEARNER_INFORMATION_CAP = 9.0

# Ratings are clamped well outside anything a real item reaches. This is a guard
# against a pathological run of updates, not a modelling choice: a bank of LSAT
# items spans roughly ±2 logits.
RATING_LIMIT = 6.0


# --- Provenance -------------------------------------------------------------

# How much evidence stands behind the value. Ordered.
STATUS_UNCALIBRATED = "uncalibrated"
STATUS_PROVISIONAL = "provisional"
STATUS_ESTIMATED = "estimated"
STATUS_CALIBRATED = "calibrated"
STATUS_ORDER = (STATUS_UNCALIBRATED, STATUS_PROVISIONAL, STATUS_ESTIMATED, STATUS_CALIBRATED)

# Where the evidence came from. Kept apart from `status` on purpose: "fifty
# responses" and "fifty responses from a demo seeder" are the same amount of
# evidence and not the same evidence. This project has been bitten by an
# instrument agreeing with whatever it was pointed at more than once, most
# recently by a demo seeder that bypassed the real selector, so a synthetic
# rating has to be unable to pass itself off as an earned one.
ORIGIN_RESPONSES = "responses"
ORIGIN_SIMULATED = "simulated"
ORIGIN_IMPORTED = "imported"
ORIGIN_OFFICIAL = "official"
ORIGINS = frozenset({ORIGIN_RESPONSES, ORIGIN_SIMULATED, ORIGIN_IMPORTED, ORIGIN_OFFICIAL})
# Origins whose evidence came from somebody actually sitting the question.
TRUSTED_ORIGINS = frozenset({ORIGIN_RESPONSES, ORIGIN_OFFICIAL, ORIGIN_IMPORTED})

# Set for the duration of a synthetic run, so that a writer which goes through
# the ordinary attempt path cannot produce ratings that look earned. A
# ContextVar rather than a module global because a request-handling process
# must never inherit one request's marker into the next.
_ambient_origin: ContextVar[str | None] = ContextVar("calibration_origin", default=None)


@contextmanager
def responses_marked(origin: str) -> Iterator[None]:
    """Declare that every response recorded inside this block is `origin`.

    For writers that answer questions through the real code path — the demo
    seeders call `services.submit_attempt`, which is the point of them — and so
    cannot pass an origin down to `record_response` themselves. Wrapping the run
    is the whole obligation:

        with calibration.responses_marked(calibration.ORIGIN_SIMULATED):
            seed_demo(email)

    The alternative was letting a seeder's forty thousand invented answers
    accumulate under `responses` and be indistinguishable from a cohort's. This
    project has already shipped a demo seeder that bypassed the real selector
    and test fixtures describing a bank that could not exist; an instrument that
    cannot tell its own dry run from the real thing is the same mistake with
    better arithmetic.
    """
    if origin not in ORIGINS:
        raise ValueError(f"unknown origin: {origin}")
    token = _ambient_origin.set(origin)
    try:
        yield
    finally:
        _ambient_origin.reset(token)


# Below twelve responses the standard error is above ~0.6 logits, which is most
# of a band, so the value is directional at best.
ESTIMATED_MIN_RESPONSES = 12
# Fifty responses at a well-matched difficulty puts the information-based SE
# near 0.28. Both conditions must hold: fifty responses from students who were
# never going to miss the item carry very little information about it.
CALIBRATED_MIN_RESPONSES = 50
CALIBRATED_MAX_STANDARD_ERROR = 0.30

# Band edges in logits, relative to the mean of the rated items. Five bands, to
# match the only published scale this material has ever been given (LSAC's own
# 1-5 in the SuperPrep books), so that if those 388 ratings are ever transcribed
# the two are comparable.
BAND_EDGES = (-1.2, -0.4, 0.4, 1.2)


# --- Exposure policy --------------------------------------------------------

# The selector never looked at difficulty, so exposure was independent of it.
# Every response recorded to date is this.
EXPOSURE_BLIND = "blind"
# A difficulty-aware selector deliberately drew this slot at random. Unbiased by
# construction, and the slice a distorted rating is checked against.
EXPOSURE_RANDOM = "random"
# Chosen because of what its difficulty is. Informative for the student, biased
# for the estimate.
EXPOSURE_TARGETED = "targeted"
UNBIASED_EXPOSURES = frozenset({EXPOSURE_BLIND, EXPOSURE_RANDOM})
EXPOSURE_POLICIES = frozenset({EXPOSURE_BLIND, EXPOSURE_RANDOM, EXPOSURE_TARGETED})

# The share of slots a difficulty-aware selector must leave random. A quarter,
# the same fraction `strategies.CONTROL_PROBABILITY` reserves, for the same
# reason and at the same cost: it is enough to keep the estimate identifiable
# and small enough that the student barely notices.
RANDOM_HOLDOUT_SHARE = 0.25


def _stable_fraction(value: str) -> float:
    """A uniform [0, 1) draw that is the same every time for the same string.

    The same construction as `strategies._stable_fraction`, duplicated rather
    than imported: that module is the strategy trial's and this is not it, and a
    randomisation scheme two features share by accident is one that can be
    changed for one of them by accident.
    """
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64 - 1)


def exposure_draw(user_id: str, session_id: str, position: int) -> dict:
    """Decide whether one slot in a run is difficulty-blind or difficulty-aware.

    **Nothing in this repository calls this yet, and that is the current
    scope boundary rather than an oversight.** Question selection does not read
    difficulty; when it starts to, this is the draw that has to sit in front of
    it, and `SessionItem.exposure_policy` is the column the answer belongs in.

    The contract for a consumer, in full:

    1. Call this once per slot, before choosing the question for it.
    2. On `random`, choose the question exactly as it is chosen today, with no
       reference to difficulty whatsoever.
    3. On `targeted`, choose freely.
    4. Write the returned policy to `SessionItem.exposure_policy`. `submit_attempt`
       copies it onto the attempt and `record_response` routes the update.

    Skipping step 4 does not break anything visibly, which is why it is worth
    stating: it silently converts a targeted response into a blind one, poisons
    `blind_rating` with the exact bias `blind_rating` exists to detect, and the
    poisoning is undetectable afterwards.
    """
    fraction = _stable_fraction(f"calibration-exposure:{user_id}:{session_id}:{position}")
    random_slot = fraction < RANDOM_HOLDOUT_SHARE
    return {
        "policy": EXPOSURE_RANDOM if random_slot else EXPOSURE_TARGETED,
        "propensity": RANDOM_HOLDOUT_SHARE if random_slot else 1 - RANDOM_HOLDOUT_SHARE,
    }


# --- The arithmetic, with no database in it ---------------------------------


def guess_floor(choice_count: int | None) -> float:
    """c, the probability a student who knows nothing still answers correctly."""
    count = choice_count if choice_count and choice_count > 1 else DEFAULT_CHOICE_COUNT
    return 1.0 / count


def logistic(z: float) -> float:
    # Split at zero so neither branch can overflow `exp` on an extreme rating.
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    value = math.exp(z)
    return value / (1.0 + value)


def expected_correct(theta: float, difficulty: float, guess: float = 0.0) -> float:
    """P(correct) for this student on this item: c + (1 − c)·σ(θ − b)."""
    return guess + (1.0 - guess) * logistic(theta - difficulty)


def _gradient_factor(theta: float, difficulty: float, guess: float) -> float:
    """q/p — how much of the observed outcome is attributable to knowing it.

    One at c = 0, and it falls toward zero as the item gets hard enough that a
    correct answer is mostly the guess talking.
    """
    if guess <= 0:
        return 1.0
    q = logistic(theta - difficulty)
    p = guess + (1.0 - guess) * q
    return q / p if p > 0 else 0.0


def response_information(theta: float, difficulty: float, guess: float = 0.0) -> float:
    """Fisher information about b carried by one response: (1−c)·q²·(1−q)/p."""
    q = logistic(theta - difficulty)
    p = guess + (1.0 - guess) * q
    if p <= 0:
        return 0.0
    return (1.0 - guess) * q * q * (1.0 - q) / p


def item_step_size(information: float) -> float:
    """1/(precision so far) — the Newton step, not a tuned constant."""
    return 1.0 / (ITEM_PRIOR_PRECISION + max(0.0, information))


def learner_step_size(information: float) -> float:
    """The same, floored, because the quantity being tracked keeps moving."""
    return 1.0 / (LEARNER_PRIOR_PRECISION + min(max(0.0, information), LEARNER_INFORMATION_CAP))


def _clamp_rating(value: float) -> float:
    return min(max(value, -RATING_LIMIT), RATING_LIMIT)


class Match:
    """One student-question match, resolved but not yet written anywhere.

    Exists so the update can be unit-tested and replayed offline — by the
    backfill, by the validation harness, by the simulator — without a database
    or a Flask context anywhere near it.
    """

    __slots__ = ("theta", "difficulty", "guess", "expected", "surprise", "information")

    def __init__(self, theta: float, difficulty: float, is_correct: bool, guess: float = 0.0):
        self.theta = theta
        self.difficulty = difficulty
        self.guess = guess
        self.expected = expected_correct(theta, difficulty, guess)
        self.surprise = (1.0 if is_correct else 0.0) - self.expected
        self.information = response_information(theta, difficulty, guess)

    def _delta(self) -> float:
        return self.surprise * _gradient_factor(self.theta, self.difficulty, self.guess)

    def next_theta(self, information: float) -> float:
        """The student's rating after this match. `information` is theirs, before it."""
        return _clamp_rating(self.theta + learner_step_size(information) * self._delta())

    def next_difficulty(self, information: float) -> float:
        """The item's rating after this match. `information` is the item's, before it."""
        return _clamp_rating(self.difficulty - item_step_size(information) * self._delta())


def standard_error(information: float | None) -> float | None:
    """1/√ΣI, or None when nothing has been observed.

    Optimistic by construction — it treats the student's ability as known, and
    Elo's stochastic approximation is noisier than the maximum-likelihood
    estimator this is the SE of. Published rather than hidden, and the status
    thresholds allow for it.
    """
    if not information or information <= 0:
        return None
    return 1.0 / math.sqrt(information)


def status_for(responses: int, information: float | None) -> str:
    """The provenance ladder, from counts alone. No judgement, no rounding up."""
    if responses <= 0:
        return STATUS_UNCALIBRATED
    error = standard_error(information)
    if (
        responses >= CALIBRATED_MIN_RESPONSES
        and error is not None
        and error <= CALIBRATED_MAX_STANDARD_ERROR
    ):
        return STATUS_CALIBRATED
    if responses >= ESTIMATED_MIN_RESPONSES:
        return STATUS_ESTIMATED
    return STATUS_PROVISIONAL


def band_for(centred_rating: float) -> int:
    """1 (easiest) to 5 (hardest), on a rating already centred on the bank."""
    return 1 + sum(1 for edge in BAND_EDGES if centred_rating > edge)


# --- The database side ------------------------------------------------------


def _scope(question: Question) -> str:
    """Which ability a question is matched against.

    Per section rather than one number per student. Reading Comprehension and
    Logical Reasoning are different enough that a single θ would make an item
    look hard because the student is weak at the *other* section, which is
    exactly the confound this file exists to remove from the item.
    """
    return question.section or "Logical Reasoning"


def learner_rating(user_id: str, scope: str, *, create: bool = False) -> LearnerRating | None:
    row = LearnerRating.query.filter_by(user_id=user_id, scope=scope).first()
    if row or not create:
        return row
    row = LearnerRating(user_id=user_id, scope=scope, rating=INITIAL_RATING)
    db.session.add(row)
    return row


def question_calibration(question_id: str, *, create: bool = False) -> QuestionCalibration | None:
    row = QuestionCalibration.query.filter_by(question_id=question_id).first()
    if row or not create:
        return row
    row = QuestionCalibration(
        question_id=question_id,
        rating=INITIAL_RATING,
        blind_rating=INITIAL_RATING,
        origin=ORIGIN_RESPONSES,
    )
    db.session.add(row)
    return row


def record_response(
    user_id: str,
    question: Question,
    is_correct: bool,
    *,
    exposure: str = EXPOSURE_BLIND,
    origin: str | None = None,
    now: datetime | None = None,
) -> QuestionCalibration:
    """One match, applied to both ratings. The whole online cost of this feature.

    Two selects and at most two upserts per answered question, on a path that
    already writes an attempt, a skill row and a review card. Called from
    `services.submit_attempt` and `services.grade_exam_answer`, which are the
    only two places an attempt comes into existence.

    `origin` is how a caller that is not a student — the demo seeder, a
    simulation — says so, either as this argument or by running inside
    `responses_marked`. It is sticky in the direction of less trust: a row that
    has ever taken a simulated response can never call itself `responses` again,
    because the two cannot be unmixed afterwards.
    """
    if exposure not in EXPOSURE_POLICIES:
        raise ValueError(f"unknown exposure policy: {exposure}")
    origin = origin or _ambient_origin.get() or ORIGIN_RESPONSES
    if origin not in ORIGINS:
        raise ValueError(f"unknown origin: {origin}")
    moment = now or utcnow()
    scope = _scope(question)
    learner = learner_rating(user_id, scope, create=True)
    item = question_calibration(question.id, create=True)
    guess = guess_floor(len(question.choices) if question.choices else None)

    theta_before = learner.rating
    match = Match(theta_before, item.rating, is_correct, guess)
    learner.rating = match.next_theta(learner.information or 0.0)
    learner.information = (learner.information or 0.0) + match.information
    learner.responses = (learner.responses or 0) + 1
    learner.correct = (learner.correct or 0) + int(is_correct)
    learner.updated_at = moment

    item.rating = match.next_difficulty(item.information or 0.0)
    item.information = (item.information or 0.0) + match.information
    item.responses = (item.responses or 0) + 1
    item.correct = (item.correct or 0) + int(is_correct)
    item.last_response_at = moment
    if item.first_response_at is None:
        item.first_response_at = moment
    if origin != ORIGIN_RESPONSES or item.origin != ORIGIN_RESPONSES:
        # Sticky in the direction of less trust: once a synthetic response is in
        # the row, the row is synthetic.
        item.origin = origin if item.origin == ORIGIN_RESPONSES else item.origin

    if exposure in UNBIASED_EXPOSURES:
        # A second, independent rating fed only by exposure that could not have
        # depended on difficulty. The gap between the two is the read-out on how
        # far a targeting selector has bent the naive estimate. Built from the
        # student's rating *before* this match, exactly as the main one is, so
        # the two differ only in which responses they saw.
        blind = Match(theta_before, item.blind_rating, is_correct, guess)
        item.blind_rating = blind.next_difficulty(item.blind_information or 0.0)
        item.blind_information = (item.blind_information or 0.0) + blind.information
        item.blind_responses = (item.blind_responses or 0) + 1
    else:
        item.targeted_responses = (item.targeted_responses or 0) + 1

    item.status = status_for(item.responses, item.information)
    item.updated_at = moment
    return item


# --- Reading the signal -----------------------------------------------------


def scale_centre() -> float:
    """The mean rating of every item that has been answered at all.

    Read-time centring, because Elo's scale is only identified up to a shift:
    nothing forces the sum of item updates to cancel the sum of learner updates,
    so the origin wanders slowly as a population learns. Centring here means the
    bands cannot wander with it. One aggregate over a table with at most one row
    per answered question.
    """
    centre = db.session.query(db.func.avg(QuestionCalibration.rating)).filter(
        QuestionCalibration.responses > 0
    ).scalar()
    return float(centre or 0.0)


def signal(question: Question | None, calibration: QuestionCalibration | None = None, *, centre: float | None = None) -> dict:
    """Everything known about one question's difficulty, and how well it is known.

    The shape every consumer should read. `usable_for_targeting` is the single
    boolean a selector needs; everything else is there so that "how much do we
    actually know about this question" has an answer that is not a shrug.

    Pass `calibration` when it is already loaded (`Question.calibration` is a
    relationship, so `joinedload` it on any path that serialises more than one
    row) and `centre` when reading a page of them, so the aggregate is computed
    once rather than per row.
    """
    published = getattr(question, "published_difficulty", None) if question else None
    row = calibration if calibration is not None else (question.calibration if question else None)
    if row is None or not row.responses:
        return {
            "published": published,
            "status": STATUS_UNCALIBRATED,
            "origin": None,
            "rating": None,
            "band": None,
            "standard_error": None,
            "responses": 0,
            "correct": 0,
            "unbiased_responses": 0,
            "unbiased_rating": None,
            "selection_bias_gap": None,
            "usable_for_targeting": False,
        }
    origin = scale_centre() if centre is None else centre
    centred = row.rating - origin
    error = standard_error(row.information)
    status = row.status or status_for(row.responses, row.information)
    trustworthy_origin = row.origin in TRUSTED_ORIGINS
    unbiased_rating = (row.blind_rating - origin) if row.blind_responses else None
    return {
        "published": published,
        "status": status,
        "origin": row.origin,
        "rating": round(centred, 4),
        "band": band_for(centred) if status in {STATUS_ESTIMATED, STATUS_CALIBRATED} else None,
        "standard_error": round(error, 4) if error is not None else None,
        "responses": row.responses,
        "correct": row.correct,
        "unbiased_responses": row.blind_responses,
        "unbiased_rating": round(unbiased_rating, 4) if unbiased_rating is not None else None,
        # How far targeted exposure has moved the naive rating away from the
        # rating built only from exposure that could not depend on difficulty.
        # None until both have something to say. Zero while nothing targets.
        "selection_bias_gap": (
            round(centred - unbiased_rating, 4)
            if unbiased_rating is not None and row.targeted_responses
            else None
        ),
        "usable_for_targeting": (
            status in {STATUS_ESTIMATED, STATUS_CALIBRATED} and trustworthy_origin
        ),
    }


def bank_summary() -> dict:
    """One row per status, for "how calibrated is the bank" without a scan.

    What the honest answer looks like today: 6,886 uncalibrated, nothing else.
    """
    counts = dict(
        db.session.query(QuestionCalibration.status, db.func.count(QuestionCalibration.question_id))
        .group_by(QuestionCalibration.status)
        .all()
    )
    total = db.session.query(db.func.count(Question.id)).scalar() or 0
    rated = sum(counts.values())
    return {
        "questions": total,
        "uncalibrated": total - rated + counts.get(STATUS_UNCALIBRATED, 0),
        "provisional": counts.get(STATUS_PROVISIONAL, 0),
        "estimated": counts.get(STATUS_ESTIMATED, 0),
        "calibrated": counts.get(STATUS_CALIBRATED, 0),
        # Rows carrying at least one invented response. Reported next to the
        # status counts rather than folded into them, because a bank that looks
        # calibrated because a seeder answered it is the failure this number
        # exists to make visible.
        "synthetic": db.session.query(db.func.count(QuestionCalibration.question_id))
        .filter(QuestionCalibration.origin.notin_(tuple(TRUSTED_ORIGINS)))
        .scalar()
        or 0,
        "published": db.session.query(db.func.count(Question.id))
        .filter(Question.published_difficulty.isnot(None))
        .scalar()
        or 0,
        "centre": round(scale_centre(), 4) if rated else None,
    }
