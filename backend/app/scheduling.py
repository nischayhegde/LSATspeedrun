"""Review scheduling: FSRS-6 memory state, retrievability ordering, interleaving.

What this replaces
------------------
A fixed (1, 3, 7, 21)-day ladder, advanced one rung per clean answer. Two
problems with it. It knew nothing about the item — a question the student has
missed four times and one they nearly had both sat on rung 0 — and it was
purely calendar-gated, so a student sprinting the week before a test date was
told to come back on Thursday. This project had already rejected calendar-gated
mastery for exactly that reason.

The algorithm, and why this one
-------------------------------
**FSRS (Free Spaced Repetition Scheduler)**, the DSR three-component model of
memory: every item carries Difficulty, Stability, and Retrievability, where
stability S is defined as the number of days for recall probability to fall
from 100% to 90%, and retrievability R is read off a power-law forgetting curve.
Implemented here at FSRS-6, transcribed from the reference implementation
(https://github.com/open-spaced-repetition/py-fsrs, `fsrs/scheduler.py`) and
the published specification
(https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).
The model's research lineage runs through Ye et al., "A Stochastic Shortest
Path Algorithm for Optimizing Spaced Repetition Scheduling" (ACM SIGKDD 2022),
and Wozniak's two-component model of long-term memory before it.

Considered and rejected:

* **Half-life regression** — Settles & Meeder, "A Trainable Spaced Repetition
  Model for Language Learning" (ACL 2016), the Duolingo model, p = 2^(-Δ/h)
  with h = 2^(θ·x). Elegant and objectively-gradable, which suits this app,
  but it is a *trained* model: its whole value is fitting θ on a large review
  log. Duolingo fit it on hundreds of millions of reviews. There is no such
  corpus here, and an untrained HLR is just an exponential guess.
* **DASH** — Lindsey, Shroyer, Pashler & Mozer, "Improving Students' Long-Term
  Knowledge Retention Through Personalized Review" (Psychological Science,
  2014), in the Mozer/Pashler multiscale-context tradition. Strong classroom
  evidence, but it is likewise a fitted hierarchical Bayesian model needing
  per-student and per-item data this app does not have on day one.

FSRS wins on exactly the property that matters here: it ships with published,
community-optimized default parameters that work without any local training
data, and it degrades gracefully into a trained model later if a review log
ever accumulates. `DEFAULT_PARAMETERS` below are the FSRS-6 defaults verbatim.

The missing input, and how it is supplied
------------------------------------------
FSRS expects a self-rated grade (1 Again / 2 Hard / 3 Good / 4 Easy). This app
deliberately shows the student no scheduler at all — no ratings prompt, no deck,
no due counts to manage; they press practice and get questions. So the grade is
*derived* from signals already captured on every attempt: correctness, elapsed
time against the item's target, the 1-5 confidence rating, the graded
explanation quality, and whether the answer was changed. See `derive_grade`.
That mapping is the one genuinely bespoke part of this file, and it is
defensible: the Again/Hard/Good/Easy scale is a self-report of *retrieval
difficulty*, and retrieval latency, self-rated confidence, and whether the
student could justify the answer are all direct observations of the same thing.

Effort, not the calendar
------------------------
`due_at` is still written, because a date is the natural way to store "when
does this fall below target retention". But nothing reads it as a gate.
`due_for_review` ranks the whole queue by current retrievability, lowest first,
and hands back as many as the session asked for. A student who wants to work
right now always gets their weakest material; the schedule decides the
*order*, never the permission.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import joinedload

from .extensions import db
from .models import Attempt, Question, ReviewQueueItem, utcnow


# --- FSRS-6, verbatim from the reference implementation ---------------------
# py-fsrs `fsrs/scheduler.py`: DEFAULT_PARAMETERS, w[0..20]. w20 is the
# trainable forgetting-curve decay (FSRS_DEFAULT_DECAY = 0.1542).
DEFAULT_PARAMETERS = (
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
)
W = DEFAULT_PARAMETERS
DECAY = -W[20]
# factor is chosen so that R(S, S) = 0.9 exactly — the definition of stability.
FACTOR = 0.9 ** (1 / DECAY) - 1
MIN_DIFFICULTY = 1.0
MAX_DIFFICULTY = 10.0
STABILITY_MIN = 0.001
MAX_INTERVAL_DAYS = 365

# The retention the schedule targets. FSRS's own default is 0.90; this app aims
# a little higher because an LSAT student is cramming toward a dated exam, not
# maintaining a language deck for years — recalling 92% of reviewed items is
# worth the extra repetitions.
DESIRED_RETENTION = 0.92

GRADE_AGAIN, GRADE_HARD, GRADE_GOOD, GRADE_EASY = 1, 2, 3, 4


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def retrievability(stability: float | None, elapsed_days: float) -> float:
    """R(t, S) = (1 + FACTOR · t/S)^DECAY — probability of recall right now.

    A card with no stability yet has never been graded under this model, so
    nothing is known about it; 0.0 puts it at the front of the queue, which is
    the right place for a question the student has just missed.
    """
    if not stability or stability <= 0:
        return 0.0
    return (1 + FACTOR * max(0.0, elapsed_days) / stability) ** DECAY


def interval_days(stability: float, retention: float = DESIRED_RETENTION) -> float:
    """I(r, S) = (S / FACTOR) · (r^(1/DECAY) − 1); days until R falls to r."""
    return (stability / FACTOR) * (retention ** (1 / DECAY) - 1)


def initial_stability(grade: int) -> float:
    """S_0(G) = w[G−1]."""
    return max(STABILITY_MIN, W[grade - 1])


def initial_difficulty(grade: int, clamp: bool = True) -> float:
    """D_0(G) = w4 − e^(w5·(G−1)) + 1."""
    difficulty = W[4] - math.exp(W[5] * (grade - 1)) + 1
    return _clamp_difficulty(difficulty) if clamp else difficulty


def _clamp_difficulty(difficulty: float) -> float:
    return min(max(difficulty, MIN_DIFFICULTY), MAX_DIFFICULTY)


def next_difficulty(difficulty: float, grade: int) -> float:
    """Difficulty update with FSRS-6 linear damping and mean reversion.

    Damping — (10 − D)·ΔD/9 — makes an already-hard item resist getting harder,
    and mean reversion pulls every item slowly back toward an easy anchor, so one
    bad day cannot permanently mark a question as impossible.

    That anchor is deliberately *unclamped*: D_0(4) evaluates to −4.77, well below
    the [1, 10] range difficulty is otherwise held to. It looks like a bug and is
    not — the reference implementation passes `clamp=False` here, so clamping it
    to 1.0 would silently diverge this scheduler's intervals from FSRS's. At the
    default w7 of 0.001 the pull is tiny either way; it stops being tiny if w7 is
    ever fitted upward.
    """
    delta = -(W[6] * (grade - 3))
    damped = difficulty + (10.0 - difficulty) * delta / 9.0
    reverted = W[7] * initial_difficulty(GRADE_EASY, clamp=False) + (1 - W[7]) * damped
    return _clamp_difficulty(reverted)


def next_recall_stability(difficulty: float, stability: float, retention: float, grade: int) -> float:
    """S' after a successful recall. Larger when R was low — the spacing effect:
    retrieving something you had nearly forgotten strengthens it far more than
    retrieving something you just saw."""
    hard_penalty = W[15] if grade == GRADE_HARD else 1
    easy_bonus = W[16] if grade == GRADE_EASY else 1
    return stability * (
        1
        + math.exp(W[8])
        * (11 - difficulty)
        * (stability ** -W[9])
        * (math.exp((1 - retention) * W[10]) - 1)
        * hard_penalty
        * easy_bonus
    )


def next_forget_stability(difficulty: float, stability: float, retention: float) -> float:
    """S' after a lapse. Capped by the short-term term so a forgotten card
    cannot come back with a longer interval than it had."""
    long_term = (
        W[11]
        * (difficulty ** -W[12])
        * (((stability + 1) ** W[13]) - 1)
        * math.exp((1 - retention) * W[14])
    )
    short_term = stability / math.exp(W[17] * W[18])
    return min(long_term, short_term)


def next_state(
    stability: float | None,
    difficulty: float | None,
    elapsed_days: float,
    grade: int,
) -> tuple[float, float]:
    """One FSRS step: (S, D) before -> (S, D) after, given a grade."""
    if stability is None or difficulty is None:
        return initial_stability(grade), initial_difficulty(grade)
    retention = retrievability(stability, elapsed_days)
    updated_difficulty = next_difficulty(difficulty, grade)
    if grade == GRADE_AGAIN:
        updated_stability = next_forget_stability(difficulty, stability, retention)
    else:
        updated_stability = next_recall_stability(difficulty, stability, retention, grade)
    return max(STABILITY_MIN, updated_stability), updated_difficulty


# --- Deriving a grade without ever asking the student -----------------------
# Weights over the three usable correct-answer signals. Explanation quality
# carries the most because it is the only one that separates "knew it" from
# "guessed it and happened to be right" — and on this app it is graded by the
# coach against the student's own written reasoning, not self-reported.
PACE_WEIGHT = 0.30
CONFIDENCE_WEIGHT = 0.25
EXPLANATION_WEIGHT = 0.45
# Changing an answer is hesitation, and hesitation is evidence the retrieval was
# not clean even when the final answer was right.
ANSWER_CHANGED_PENALTY = 0.15
# Calibrated against `game.explanation_band`, whose Invalid band is a score
# below 0.25. A fast, confident, correct answer scores 0.4875 before the
# explanation term, so a `GOOD_THRESHOLD` of 0.60 is exactly what it takes for
# an Invalid write-up to still land on Hard — which is the app's whole position
# on unsupported correctness: getting it right without being able to say why is
# not evidence of knowing it. An ungraded explanation defaults to 0.5 and keeps
# such an answer on Good.
EASY_THRESHOLD = 0.80
GOOD_THRESHOLD = 0.60


def _pace_component(elapsed_ms: int, target_seconds: int) -> float:
    """Retrieval latency as a proxy for retrieval strength, on the item's own
    target time so a 330s RC question is not judged against a 150s LR one."""
    target_ms = max(1, target_seconds * 1000)
    ratio = elapsed_ms / target_ms
    if ratio <= 0.6:
        return 1.0
    if ratio <= 1.0:
        return 0.7
    if ratio <= 1.5:
        return 0.35
    return 0.0


def derive_grade(attempt: Attempt) -> int:
    """Map this app's observed signals onto the FSRS 1-4 grade scale.

    A miss is always Again: whatever else was true, the item was not retrieved.
    A correct answer is scored on how *cleanly* it was retrieved, which is what
    the self-rating would have been reporting.
    """
    if not attempt.is_correct:
        return GRADE_AGAIN

    item = attempt.session_item
    pace = _pace_component(attempt.server_elapsed_ms, item.target_time_seconds)
    # Both of these default to the midpoint when absent rather than to a
    # flattering value: an ungraded explanation is unknown, not excellent.
    confidence = ((attempt.confidence - 1) / 4) if attempt.confidence else 0.5
    explanation = attempt.explanation_score if attempt.explanation_score is not None else 0.5

    score = PACE_WEIGHT * pace + CONFIDENCE_WEIGHT * confidence + EXPLANATION_WEIGHT * explanation
    if attempt.answer_changed:
        score -= ANSWER_CHANGED_PENALTY

    if score >= EASY_THRESHOLD:
        return GRADE_EASY
    if score >= GOOD_THRESHOLD:
        return GRADE_GOOD
    return GRADE_HARD


def elapsed_days_for(card: ReviewQueueItem, now: datetime | None = None) -> float:
    # `now` is normalised as well as the reference, because a caller may hand
    # over a timestamp read back off a row rather than one it just made, and
    # SQLite returns those without a zone.
    now = _aware(now) if now else utcnow()
    reference = card.last_reviewed_at or card.created_at
    if reference is None:
        return 0.0
    return max(0.0, (now - _aware(reference)).total_seconds() / 86_400)


def apply_review(card: ReviewQueueItem, attempt: Attempt, *, now: datetime | None = None) -> int:
    """Advance one card's memory state from one graded attempt.

    Returns the grade used, so callers can record it. Idempotency is the
    caller's problem: this function is a pure state transition and will happily
    apply the same review twice if asked.
    """
    now = now or utcnow()
    grade = derive_grade(attempt)
    elapsed = elapsed_days_for(card, now)
    stability, difficulty = next_state(card.stability, card.difficulty, elapsed, grade)
    card.stability = stability
    card.difficulty = difficulty
    card.reps = (card.reps or 0) + 1
    if grade == GRADE_AGAIN:
        card.lapses = (card.lapses or 0) + 1
    card.last_grade = grade
    card.last_reviewed_at = now
    if grade == GRADE_AGAIN:
        # FSRS would put a lapse into a minutes-scale relearning step. This app
        # has no sub-session scheduling, so a relearning card is simply
        # available immediately — see `card_retrievability`.
        card.due_at = now
    else:
        card.due_at = now + timedelta(days=min(MAX_INTERVAL_DAYS, max(0.0, interval_days(stability))))
    # `interval_index` is kept only so the older ladder-shaped reads (and any
    # historical row) stay interpretable. Nothing schedules from it any more.
    card.interval_index = min(4, card.reps)
    return grade


# --- Calibration: the scheduler scored against its own predictions ----------
#
# `review_scheduling` is the one layer in `app/experiments.py` with no holdout,
# and the reason is on its registry entry rather than here. In short: the
# exposure would have to be per student, because a card put on a 21-day
# interval by one arm is still on it when the next run starts; per-student
# means the sample grows at the rate accounts are opened rather than the rate
# questions are answered; and the off arm is not a milder treatment but a
# scheduler the team believes is worse, shipped for the whole life of a trial
# that cannot finish. `tools/audit/measurement_cost.py` puts it near three and
# a half thousand students. That is a control arm nobody would believe in.
#
# What is here instead is not a consolation prize. FSRS is a *predictive*
# model: at the moment a card is served it says, in a number, how likely the
# student is to recall it. That is a falsifiable claim on every single review,
# and scoring it needs no comparison group at all — a student on their own
# supplies both the prediction and the outcome.
#
# It also happens to point at the part most likely to be wrong. FSRS itself is
# fitted on hundreds of millions of reviews and is not this app's invention.
# `derive_grade` is: it maps correctness, pace, confidence, explanation quality
# and whether the answer was changed onto the four grades FSRS expects, with
# weights chosen here. Wrong grades give wrong stabilities, and wrong
# stabilities give a calibration curve that is displaced or flat.
#
# Displaced and flat are different findings and the reading separates them. A
# curve that is monotone but sits below the diagonal means the grades are too
# generous and the intervals too long — a tuning problem. A flat curve means
# the per-card memory state carries no information about recall at all, which
# is a null result for the whole layer, and one no holdout was needed to get.


def predicted_recall(card: ReviewQueueItem, now: datetime | None = None) -> float | None:
    """FSRS's own claim about this card, right now, or None if it makes none.

    Deliberately the raw forgetting curve rather than `card_retrievability`.
    That function reports 0.0 for a relearning card because 0.0 is where a
    just-missed question belongs in a queue; here the question is what the
    model predicts, and overriding the prediction before scoring it would make
    the score a test of the override.

    None where there is no memory state yet. A card the model has never graded
    is one it has not made a claim about, and scoring it against an invented
    0.0 would fill the bottom bucket with first encounters and make the whole
    curve look well calibrated for a reason that has nothing to do with FSRS.
    """
    if not card.stability or card.stability <= 0:
        return None
    if card.last_reviewed_at is None:
        return None
    return retrievability(card.stability, elapsed_days_for(card, now))


# Buckets of predicted recall. Uneven on purpose: the schedule aims at
# `DESIRED_RETENTION`, so almost every review lands high and even buckets would
# put nine reviews in ten into one of them. The narrow bands at the top are
# where the scheduler actually operates and where being wrong costs the most.
CALIBRATION_BANDS = ((0.0, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 0.92), (0.92, 0.96), (0.96, 1.01))


def in_relearning(card: ReviewQueueItem) -> bool:
    """True while the last answer on this card was wrong.

    FSRS's own relearning steps are the equivalent: a lapsed card is not
    returned to the long-term schedule until it has been recalled once.
    """
    return card.last_grade == GRADE_AGAIN


def card_retrievability(card: ReviewQueueItem, now: datetime | None = None) -> float:
    """Retrievability as the queue should read it.

    Relearning cards report 0 rather than the ~1.0 the forgetting curve would
    give a card reviewed ten seconds ago. Their stability is genuinely near
    zero and the honest reading of "you just got this wrong" is *maximally
    weak*, not *freshly reviewed*. Without this a missed question would sort
    behind well-known material and read as "not due" on the dashboard.
    """
    if in_relearning(card):
        return 0.0
    return retrievability(card.stability, elapsed_days_for(card, now))


def due_for_review(user_id: str, count: int, *, now: datetime | None = None) -> list[Question]:
    """The `count` weakest questions in this student's queue, right now.

    Deliberately *not* `WHERE due_at <= now`. Ordering is by current
    retrievability, lowest first, so the student who opens the app at 6am on
    exam eve is handed the material they are closest to forgetting instead of
    being told nothing is due. Items already above the retention target still
    sort last and will not displace anything genuinely weak, which is the
    behaviour the old date gate was really trying to buy.
    """
    if count <= 0:
        return []
    now = now or utcnow()
    cards = ReviewQueueItem.query.filter(
        ReviewQueueItem.user_id == user_id,
        ReviewQueueItem.status != "retired",
    ).all()
    ranked = sorted(
        cards,
        key=lambda card: (card_retrievability(card, now), _aware(card.due_at) if card.due_at else now),
    )
    # Ranking touches every card; only the weakest `count` are handed back, so
    # their questions are fetched in one statement rather than one lazy load
    # apiece. The passage rides along because the technique assignment that
    # follows reads it on every Reading Comprehension question.
    weakest = ranked[:count]
    by_id = {
        question.id: question
        for question in Question.query.options(joinedload(Question.passage)).filter(
            Question.id.in_([card.question_id for card in weakest])
        )
    }
    return [by_id[card.question_id] for card in weakest if card.question_id in by_id]


def queue_pressure(user_id: str, *, now: datetime | None = None) -> dict:
    """How much of the queue has actually decayed below target retention.

    This is the honest replacement for a "due today" count: a number the
    student can read as "this much is slipping", not as a chore list with a
    date attached.
    """
    now = now or utcnow()
    cards = ReviewQueueItem.query.filter_by(user_id=user_id).all()
    below = 0
    weakest = 1.0
    for card in cards:
        value = card_retrievability(card, now)
        below += value < DESIRED_RETENTION
        weakest = min(weakest, value)
    return {
        "tracked": len(cards),
        "below_target": below,
        "weakest_retrievability": round(weakest, 3) if cards else None,
        "desired_retention": DESIRED_RETENTION,
    }


# --- Interleaving -----------------------------------------------------------
# Rohrer, Dedrick & Stershic, "Interleaved practice improves mathematics
# learning", Journal of Educational Psychology 107(3), 900-908 (2015): 126
# seventh-graders, identical problems, only the ordering differed. Interleaved
# beat blocked 80% vs 64% one day later (d = 0.42) and 74% vs 42% thirty days
# later (d = 0.79).
# http://uweb.cas.usf.edu/~drohrer/pdfs/Rohrer_et_al_2015JEdPsych.pdf
#
# The mechanism matters for how this is implemented: blocking lets the student
# infer the strategy from the assignment's position rather than from the
# problem. Front-loading every review item at the start of a run reproduces
# exactly that — the first four questions are "the ones I got wrong", which is
# itself a hint. Distributing them, and separating same-type items, removes it.
#
# Which is a result about *mathematics problems*, and this app serves two
# sections rather than one.
#
# `research/01-learning-science.md` carries Brunmair and Richter's
# meta-analysis (Psychological Bulletin 145(11), 2019) of the whole
# interleaving literature: g = 0.42 overall, g = 0.34 for mathematics — Rohrer
# above — and g = 0.01, a null, for expository text. Word lists come out at
# g = −0.39, where blocking wins outright. The moderator is whether the
# categories being practised are similar enough to be confusable: Strengthen
# against Weaken against Assumption against Flaw is close to the best case the
# meta-analysis reports, and reading four questions about one passage is not a
# category-discrimination task at all. The repository's own note beside that
# entry says it in one line: Reading Comprehension is the case where
# interleaving buys nothing.
#
# Reading Comprehension has in fact always been blocked here, because a
# passage's questions travel together so the run reads the passage once. That
# was a cost decision about re-reading 450 words, and it happened to land on
# the same answer the evidence gives. Landing on the right answer for an
# unrelated reason is not the same as having decided, and the difference shows
# up the moment someone optimises the cost away.
#
# So it is a decision now, named below, cited, and reachable from the layer
# that measures it. `run_ordering` in `app/experiments.py` reports the two
# sections separately and never pools them, which is what makes the prediction
# falsifiable rather than decorative: if Reading Comprehension turns out to
# have an interleaving effect after all, that stratum is where it appears.

# Sections whose questions are ordered by their passage and never by
# type-discrimination. One entry, and the entry is a claim about the material
# rather than about the code.
BLOCKED_SECTIONS = ("Reading Comprehension",)


def is_blocked_section(question) -> bool:
    return getattr(question, "section", None) in BLOCKED_SECTIONS


def front_load(reviews: list, fresh: list) -> list:
    """Reviews first, then fresh material, in the order each arrived.

    The off arm of `run_ordering`, and the app's own behaviour until
    `interleave` replaced it. Kept as a named function rather than written
    inline at the call site so the comparison is between two orderings the
    codebase can both point at, and so the thing being measured is not a
    concatenation somebody could tidy away without noticing it was an arm.
    """
    return list(reviews) + list(fresh)


def _blocks(questions: list) -> list[list]:
    """Group consecutive questions that share a reading passage.

    Interleaving is about not letting the student infer the method from the
    running order. It is *not* about making them re-read a passage four times,
    so passage-mates travel as one unit and are placed together.
    """
    grouped: list[list] = []
    for question in questions:
        passage_id = getattr(question, "passage_id", None)
        if grouped and passage_id and getattr(grouped[-1][-1], "passage_id", None) == passage_id:
            grouped[-1].append(question)
        else:
            grouped.append([question])
    return grouped


def cluster_passage_mates(questions: list) -> list:
    """Bring same-passage questions next to each other, changing nothing else.

    `due_for_review` ranks the queue by retrievability, so two due questions on
    one passage almost never come back adjacent — and `interleave` only keeps
    *already adjacent* passage-mates together. Moving them next to their first
    appearance means the run reads that passage once instead of twice.

    Deliberately does **not** pull in passage-mates that are not themselves due.
    Two reasons. A review repeat is a re-read of a passage the student has
    already worked, not a fresh 450 words, so the cost this guards against on
    the practice path is much smaller here. And the review slots are a fixed
    fraction of the run: filling them with material the scheduler did not choose
    would displace questions the student is actually closest to forgetting,
    which is the one thing the queue exists to get right.
    """
    grouped: dict[str, list] = {}
    for question in questions:
        passage_id = getattr(question, "passage_id", None)
        grouped.setdefault(passage_id or f"solo:{id(question)}", []).append(question)
    return [question for block in grouped.values() for question in block]


def interleave(reviews: list, fresh: list, *, question_type=None) -> list:
    """Distribute review items evenly through the fresh ones, then de-block.

    Two passes over passage-preserving blocks. The first spreads reviews across
    the run at even fractional positions instead of stacking them at the front.
    The second swaps any block that repeats the previous block's question type
    with the next differently-typed one, so a run does not accidentally block
    by skill either.
    """
    if not reviews:
        return list(fresh)
    if not fresh:
        return list(reviews)

    review_blocks, fresh_blocks = _blocks(reviews), _blocks(fresh)
    total = len(review_blocks) + len(fresh_blocks)
    # Even fractional spacing: with 3 reviews in a run of 10 they land at
    # roughly positions 1, 4, and 7 rather than 0, 1, 2.
    slots = {round((index + 0.5) * total / len(review_blocks)) for index in range(len(review_blocks))}
    sequence: list[list] = []
    for position in range(total):
        if position in slots and review_blocks:
            sequence.append(review_blocks.pop(0))
        elif fresh_blocks:
            sequence.append(fresh_blocks.pop(0))
        elif review_blocks:
            sequence.append(review_blocks.pop(0))
    ordered = _separate_same_type(sequence, question_type=question_type)
    return [question for block in ordered for question in block]


def _separate_same_type(sequence: list[list], *, question_type=None) -> list[list]:
    """Break up consecutive same-question-type blocks where an alternative exists.

    Skipped entirely for a type-filtered drill: the student explicitly asked
    for twenty Assumption questions, and shuffling types into that would be
    overriding them, not helping.

    Skipped for a blocked section's blocks too, and for a different reason.
    This pass is the type-discrimination half of interleaving — the half
    Brunmair and Richter measure at g = 0.01 on expository text. Applying it to
    Reading Comprehension would move passages around to buy a benefit the
    evidence says is not there. The review-distribution half above still
    applies to Reading Comprehension, because that half is about not leaking
    "these are the ones you got wrong" and has nothing to do with category
    discrimination. See `BLOCKED_SECTIONS`.
    """
    if question_type:
        return sequence
    result = list(sequence)
    movable = [not any(is_blocked_section(question) for question in block) for block in result]
    for index in range(1, len(result)):
        if not movable[index]:
            continue
        previous_type = result[index - 1][-1].question_type
        if result[index][0].question_type != previous_type:
            continue
        swap_with = next(
            (
                candidate
                for candidate in range(index + 1, len(result))
                if movable[candidate] and result[candidate][0].question_type != previous_type
            ),
            None,
        )
        if swap_with is not None:
            result[index], result[swap_with] = result[swap_with], result[index]
            movable[index], movable[swap_with] = movable[swap_with], movable[index]
    return result


def review_calibration(user_id: str | None = None) -> dict:
    """Score the scheduler against what it predicted, per band and overall.

    Three readings, and they answer three different questions.

    `bands` is the calibration curve: for reviews the model put at 90-96%, how
    many were actually right? A well-calibrated scheduler tracks the diagonal.
    Systematically below it means the grades feeding `derive_grade` are too
    generous and every interval is a little too long.

    `brier` is the mean squared error of the prediction, which is the standard
    proper scoring rule for exactly this and the quantity FSRS's own optimiser
    minimises. Lower is better; it is reported next to `brier_baseline`,
    because on its own it is unreadable.

    `brier_baseline` is what a model that knows nothing per card would score:
    predict the overall review accuracy for every card, every time. This is the
    comparison that makes the whole reading a test rather than a description.
    If FSRS cannot beat a constant, then the per-card stability and difficulty
    it maintains carry no information about whether the student will recall the
    card — which is a negative result about the layer, obtained without ever
    withholding the scheduler from anybody.

    `skill` is the fraction of the baseline's error the model removes. Zero is
    a flat curve. Negative means the memory state is actively misleading.

    Report-only, and it needs a column that only exists going forward: the
    prediction has to be written down at review time, because the card's state
    has moved on by the time anyone asks. Reviews answered before that column
    landed carry null and are not in this reading.
    """
    query = db.session.query(Attempt.predicted_retrievability, Attempt.is_correct).filter(
        Attempt.predicted_retrievability.isnot(None)
    )
    if user_id:
        query = query.filter(Attempt.user_id == user_id)
    rows = [(float(predicted), bool(correct)) for predicted, correct in query.all()]

    reviews = len(rows)
    if not reviews:
        return {
            "instrument": "calibration",
            "reviews": 0,
            "bands": [],
            "brier": None,
            "brier_baseline": None,
            "skill": None,
            "note": (
                "No scored reviews yet. The prediction is recorded when a review is "
                "answered, so this fills at the rate the queue is worked."
            ),
        }

    observed = sum(1 for _predicted, correct in rows if correct) / reviews
    brier = sum((predicted - correct) ** 2 for predicted, correct in rows) / reviews
    baseline = sum((observed - correct) ** 2 for _predicted, correct in rows) / reviews

    bands = []
    for low, high in CALIBRATION_BANDS:
        values = [row for row in rows if low <= row[0] < high]
        bands.append(
            {
                "band": f"{int(low * 100)}–{min(100, int(high * 100))}%",
                "reviews": len(values),
                "mean_predicted": round(
                    sum(predicted for predicted, _correct in values) / len(values) * 100, 1
                )
                if values
                else None,
                "realised": round(
                    sum(1 for _predicted, correct in values if correct) / len(values) * 100, 1
                )
                if values
                else None,
            }
        )
    for band in bands:
        band["gap"] = (
            round(band["realised"] - band["mean_predicted"], 1)
            if band["reviews"] and band["mean_predicted"] is not None
            else None
        )

    filled = [band for band in bands if band["reviews"]]
    return {
        "instrument": "calibration",
        "reviews": reviews,
        "observed_accuracy": round(observed * 100, 1),
        "bands": bands,
        "brier": round(brier, 4),
        "brier_baseline": round(baseline, 4),
        "skill": round((baseline - brier) / baseline, 3) if baseline > 0 else None,
        # The flat-curve test, stated as a number rather than left to the eye.
        # A scheduler whose lowest-predicted band comes back at the same rate
        # as its highest-predicted one is not ranking anything.
        "band_spread": round(filled[-1]["realised"] - filled[0]["realised"], 1)
        if len(filled) > 1
        else None,
        "basis": (
            "the retrievability FSRS predicted at review time against what happened, "
            "scored by Brier against a constant-rate baseline"
        ),
    }
