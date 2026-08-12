"""Offline replay, synthetic responses, and the predictive check, with no database.

Three things live here, kept together because the whole point is that they share
one code path:

* `replay` runs the *production* estimator — `app.calibration.Match`, the same
  arithmetic `services.submit_attempt` calls — over a list of responses.
* `simulate` invents responses from a generative model that is deliberately
  **not** the one the estimator assumes.
* `evaluate` scores predictions on held-out responses against baselines.

The second of those is the one worth being suspicious about. A simulation that
generates data from the estimator's own model and then reports that the
estimator fits it has measured nothing except that the arithmetic was typed in
twice — and this project has been burned by exactly that shape of instrument
more than once. So the generator differs from the estimator on three axes at
once, each of which is a real property of LSAT response data:

* **Discrimination varies per item.** The generator is 2PL, a_i log-normal
  around 1. The estimator is Rasch/Elo, which assumes every item discriminates
  identically. This is the misspecification that matters most, and it is real:
  items differ in how sharply they separate students.
* **The guessing floor varies per item.** The generator draws c_i in
  [0.12, 0.26]; the estimator assumes exactly 1/5 for every five-choice item.
* **Ability is not stationary.** Students improve as they answer, which is the
  entire premise of the product, and neither Rasch nor Elo models it. The item
  ratings have to stay stable while the thing they are being measured against
  moves underneath them.

If the rating still predicts held-out responses under all three, the predictive
claim is about the estimator rather than about the simulation.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from app.calibration import (
    INITIAL_RATING,
    Match,
    clamp_rating,
    expected_correct,
    guess_floor,
    standard_error,
    status_for,
)


# --- Responses --------------------------------------------------------------


@dataclass(frozen=True)
class Response:
    """One answered question, stripped to what the estimator reads."""

    learner: str
    item: str
    scope: str
    correct: bool
    choices: int = 5
    exposure: str = "blind"


@dataclass
class ItemState:
    rating: float = INITIAL_RATING
    information: float = 0.0
    responses: int = 0
    correct: int = 0

    @property
    def error(self) -> float | None:
        return standard_error(self.information)

    @property
    def status(self) -> str:
        return status_for(self.responses, self.information)


@dataclass
class LearnerState:
    rating: float = INITIAL_RATING
    information: float = 0.0
    responses: int = 0
    correct: int = 0


@dataclass
class ReplayResult:
    items: dict[str, ItemState] = field(default_factory=dict)
    learners: dict[tuple[str, str], LearnerState] = field(default_factory=dict)

    def centre(self) -> float:
        rated = [state.rating for state in self.items.values() if state.responses]
        return sum(rated) / len(rated) if rated else 0.0


def replay(
    responses: list[Response], *, unbiased_only: bool = False, fixed_k: float | None = None
) -> ReplayResult:
    """Run the production update over a response stream, in order.

    `unbiased_only` skips responses whose exposure depended on difficulty, which
    is what `QuestionCalibration.blind_rating` does online. Running the same
    stream both ways is how the size of a selection bias is measured rather
    than argued about.

    `fixed_k` replaces the information-scaled step with plain Elo's constant, on
    both sides. It exists so the choice of step rule can be measured rather than
    argued for: the production rule has to beat the constant it replaced on the
    same corpus, or it is complexity with a citation attached.
    """
    result = ReplayResult()
    for response in responses:
        if unbiased_only and response.exposure == "targeted":
            continue
        item = result.items.setdefault(response.item, ItemState())
        key = (response.learner, response.scope)
        learner = result.learners.setdefault(key, LearnerState())
        guess = guess_floor(response.choices)
        match = Match(learner.rating, item.rating, response.correct, guess)
        if fixed_k is None:
            learner.rating = match.next_theta(learner.information)
            item.rating = match.next_difficulty(item.information)
        else:
            learner.rating = clamp_rating(learner.rating + fixed_k * match.delta)
            item.rating = clamp_rating(item.rating - fixed_k * match.delta)
        learner.information += match.information
        learner.responses += 1
        learner.correct += int(response.correct)
        item.information += match.information
        item.responses += 1
        item.correct += int(response.correct)
    return result


# --- The generative model, which is not the estimator's ---------------------


@dataclass
class TrueItem:
    difficulty: float
    discrimination: float
    guess: float


@dataclass
class Simulation:
    responses: list[Response]
    truth: dict[str, TrueItem]
    abilities: dict[str, float]


def simulate(
    *,
    items: int = 400,
    learners: int = 120,
    responses_per_learner: int = 80,
    seed: int = 20260812,
    ability_sd: float = 0.9,
    difficulty_sd: float = 1.0,
    learning_per_response: float = 0.003,
    targeting: float = 0.0,
    random_holdout: float = 0.0,
    scope: str = "Logical Reasoning",
) -> Simulation:
    """Invent a response corpus under 2PL-with-guessing and drifting ability.

    `targeting` is the share of exposures chosen *because* of the item's current
    estimated difficulty — the selection bias this whole apparatus is defended
    against. `random_holdout` is the share of those targeted slots forced back
    to a uniform draw, which is what `calibration.exposure_draw` reserves.
    """
    rng = random.Random(seed)
    truth = {
        f"q{index}": TrueItem(
            difficulty=rng.gauss(0.0, difficulty_sd),
            # Log-normal around 1, clipped: the Rasch model the estimator
            # implements says every one of these is exactly 1.
            discrimination=min(2.0, max(0.5, math.exp(rng.gauss(0.0, 0.35)))),
            # The estimator assumes 0.2 for every five-choice item.
            guess=rng.uniform(0.12, 0.26),
        )
        for index in range(items)
    }
    abilities = {f"u{index}": rng.gauss(0.0, ability_sd) for index in range(learners)}
    item_ids = list(truth)

    # The selector's own view of difficulty, which is what a targeting policy
    # would actually have to use: an estimate built as it goes, not the truth.
    estimate = {item_id: ItemState() for item_id in item_ids}
    learner_estimate: dict[str, LearnerState] = {}

    order: list[tuple[str, int]] = [
        (learner, index) for learner in abilities for index in range(responses_per_learner)
    ]
    rng.shuffle(order)

    responses: list[Response] = []
    answered: dict[str, int] = {learner: 0 for learner in abilities}
    for learner, _ in order:
        seen = answered[learner]
        theta = abilities[learner] + learning_per_response * seen
        state = learner_estimate.setdefault(learner, LearnerState())

        exposure = "blind"
        if targeting and rng.random() < targeting:
            if random_holdout and rng.random() < random_holdout:
                exposure = "random"
                item_id = rng.choice(item_ids)
            else:
                exposure = "targeted"
                # Pick, from a small random slate, whichever item the selector
                # currently believes is closest to this student's estimated
                # ability. This is the textbook adaptive rule and the textbook
                # way to poison an item estimate.
                slate = rng.sample(item_ids, k=min(12, len(item_ids)))
                item_id = min(slate, key=lambda value: abs(estimate[value].rating - state.rating))
        else:
            item_id = rng.choice(item_ids)

        true_item = truth[item_id]
        probability = true_item.guess + (1 - true_item.guess) * _logistic(
            true_item.discrimination * (theta - true_item.difficulty)
        )
        correct = rng.random() < probability
        responses.append(
            Response(learner=learner, item=item_id, scope=scope, correct=correct, exposure=exposure)
        )
        answered[learner] = seen + 1

        # Advance the selector's own estimate so targeting uses what it would
        # really have had at that moment.
        item_state = estimate[item_id]
        match = Match(state.rating, item_state.rating, correct, guess_floor(5))
        state.rating = match.next_theta(state.information)
        state.information += match.information
        state.responses += 1
        item_state.rating = match.next_difficulty(item_state.information)
        item_state.information += match.information
        item_state.responses += 1

    return Simulation(responses=responses, truth=truth, abilities=abilities)


def _logistic(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    value = math.exp(z)
    return value / (1.0 + value)


# --- Scoring ----------------------------------------------------------------


def log_loss(predictions: list[float], outcomes: list[bool]) -> float:
    total = 0.0
    for probability, outcome in zip(predictions, outcomes):
        clipped = min(max(probability, 1e-6), 1 - 1e-6)
        total -= math.log(clipped) if outcome else math.log(1 - clipped)
    return total / len(predictions)


def brier(predictions: list[float], outcomes: list[bool]) -> float:
    return sum((p - int(y)) ** 2 for p, y in zip(predictions, outcomes)) / len(predictions)


def auc(predictions: list[float], outcomes: list[bool]) -> float | None:
    """Mann-Whitney rank AUC, ties handled by mid-rank. None if one class only."""
    positives = sum(outcomes)
    negatives = len(outcomes) - positives
    if not positives or not negatives:
        return None
    order = sorted(range(len(predictions)), key=lambda index: predictions[index])
    ranks = [0.0] * len(predictions)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and predictions[order[end + 1]] == predictions[order[position]]:
            end += 1
        average = (position + end) / 2 + 1
        for index in range(position, end + 1):
            ranks[order[index]] = average
        position = end + 1
    positive_ranks = sum(rank for rank, outcome in zip(ranks, outcomes) if outcome)
    return (positive_ranks - positives * (positives + 1) / 2) / (positives * negatives)


def spearman(left: list[float], right: list[float]) -> float | None:
    if len(left) < 3:
        return None
    left_ranks = _ranks(left)
    right_ranks = _ranks(right)
    n = len(left)
    mean = (n + 1) / 2
    numerator = sum((a - mean) * (b - mean) for a, b in zip(left_ranks, right_ranks))
    denominator = math.sqrt(
        sum((a - mean) ** 2 for a in left_ranks) * sum((b - mean) ** 2 for b in right_ranks)
    )
    return numerator / denominator if denominator else None


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and values[order[end + 1]] == values[order[position]]:
            end += 1
        average = (position + end) / 2 + 1
        for index in range(position, end + 1):
            ranks[order[index]] = average
        position = end + 1
    return ranks


def score(name: str, predictions: list[float], outcomes: list[bool]) -> dict:
    return {
        "model": name,
        "log_loss": round(log_loss(predictions, outcomes), 5),
        "brier": round(brier(predictions, outcomes), 5),
        "auc": (lambda value: round(value, 4) if value is not None else None)(auc(predictions, outcomes)),
        "n": len(outcomes),
    }


# --- The predictive check ---------------------------------------------------


def _logit(p: float) -> float:
    clipped = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(clipped / (1 - clipped))


def split(responses: list[Response], *, holdout: float = 0.3, seed: int = 7) -> tuple[list[Response], list[Response]]:
    """Hold out a random share of responses, keeping the rest in order.

    Random rather than a time cut, deliberately. A time cut confounds "the
    rating predicts" with "the student improved over the period", and ability
    drift is in the generator on purpose. The fit set is still consumed in its
    original order, so the online estimator sees a realistic stream.
    """
    rng = random.Random(seed)
    fit: list[Response] = []
    test: list[Response] = []
    for response in responses:
        (test if rng.random() < holdout else fit).append(response)
    return fit, test


def evaluate(
    responses: list[Response],
    *,
    holdout: float = 0.3,
    seed: int = 7,
    min_item_responses: int = 0,
    fixed_k_arms: tuple[float, ...] = (),
) -> dict:
    """Fit on part of the corpus, then ask whether the ratings predict the rest.

    The comparison that decides the question is `elo` against `learner`. The
    `learner` baseline knows exactly who is answering and nothing at all about
    what they are answering; anything the item rating is worth has to show up as
    the gap between those two. `item_rate` is the honest strong baseline —
    per-item percent-correct, the difficulty measure anybody would reach for
    first — and beating *it* is what justifies estimating ability at all.
    """
    fit, test = split(responses, holdout=holdout, seed=seed)
    if min_item_responses:
        counts: dict[str, int] = {}
        for response in fit:
            counts[response.item] = counts.get(response.item, 0) + 1
        test = [response for response in test if counts.get(response.item, 0) >= min_item_responses]
    if not test:
        return {"error": "no holdout responses survived the filter", "fit": len(fit), "holdout": 0}

    state = replay(fit)
    centre = state.centre()
    # Same responses, same order, same arithmetic apart from the step rule.
    fixed = {value: replay(fit, fixed_k=value) for value in fixed_k_arms}
    fixed_centres = {value: arm.centre() for value, arm in fixed.items()}

    total = sum(response.correct for response in fit)
    base_rate = total / len(fit) if fit else 0.5

    type_rate: dict[str, tuple[int, int]] = {}
    learner_rate: dict[tuple[str, str], tuple[int, int]] = {}
    item_rate: dict[str, tuple[int, int]] = {}
    for response in fit:
        for table, key in (
            (type_rate, response.scope),
            (learner_rate, (response.learner, response.scope)),
            (item_rate, response.item),
        ):
            correct, seen = table.get(key, (0, 0))
            table[key] = (correct + int(response.correct), seen + 1)

    def smoothed(table, key, prior: float, strength: float = 4.0) -> float:
        correct, seen = table.get(key, (0, 0))
        return (correct + prior * strength) / (seen + strength)

    outcomes = [response.correct for response in test]
    predictions: dict[str, list[float]] = {name: [] for name in (
        "global", "question_scope", "learner", "item_rate", "learner_x_item_rate", "elo"
    )}
    predictions.update({f"elo_fixed_k_{value:g}": [] for value in fixed_k_arms})
    for response in test:
        learner_p = smoothed(learner_rate, (response.learner, response.scope), base_rate)
        item_p = smoothed(item_rate, response.item, base_rate)
        predictions["global"].append(base_rate)
        predictions["question_scope"].append(smoothed(type_rate, response.scope, base_rate))
        predictions["learner"].append(learner_p)
        predictions["item_rate"].append(item_p)
        # Log-linear combination of two marginals against the grand mean; the
        # standard way to put two rates together without fitting anything.
        combined = _logit(learner_p) + _logit(item_p) - _logit(base_rate)
        predictions["learner_x_item_rate"].append(1 / (1 + math.exp(-combined)))

        item = state.items.get(response.item)
        learner = state.learners.get((response.learner, response.scope))
        theta = learner.rating if learner else INITIAL_RATING
        difficulty = item.rating if item else centre
        predictions["elo"].append(
            expected_correct(theta, difficulty, guess_floor(response.choices))
        )
        for value, arm in fixed.items():
            arm_item = arm.items.get(response.item)
            arm_learner = arm.learners.get((response.learner, response.scope))
            predictions[f"elo_fixed_k_{value:g}"].append(
                expected_correct(
                    arm_learner.rating if arm_learner else INITIAL_RATING,
                    arm_item.rating if arm_item else fixed_centres[value],
                    guess_floor(response.choices),
                )
            )

    rows = [score(name, values, outcomes) for name, values in predictions.items()]
    by_name = {row["model"]: row for row in rows}

    # Per-item: does a rating fitted on the fit set order the items the way the
    # holdout responses do? Restricted to items with enough holdout responses
    # for their observed rate to mean anything.
    holdout_by_item: dict[str, list[bool]] = {}
    for response in test:
        holdout_by_item.setdefault(response.item, []).append(response.correct)
    pairs = [
        (state.items[item_id].rating, 1 - sum(values) / len(values))
        for item_id, values in holdout_by_item.items()
        if item_id in state.items and len(values) >= 8
    ]
    rank = spearman([left for left, _ in pairs], [right for _, right in pairs]) if len(pairs) >= 3 else None

    return {
        "fit": len(fit),
        "holdout": len(test),
        "items": len(state.items),
        "learners": len(state.learners),
        "base_rate": round(base_rate, 4),
        "models": rows,
        "elo_vs_learner_log_loss": round(by_name["learner"]["log_loss"] - by_name["elo"]["log_loss"], 5),
        "elo_vs_item_rate_log_loss": round(
            by_name["learner_x_item_rate"]["log_loss"] - by_name["elo"]["log_loss"], 5
        ),
        "rating_vs_holdout_difficulty_spearman": round(rank, 4) if rank is not None else None,
        "items_in_rank_check": len(pairs),
    }


def percent_correct_recovery(
    responses: list[Response], truth: dict[str, TrueItem], *, minimum: int = 8
) -> dict:
    """The same question asked of raw percent-correct, which is the naive rival.

    "Hard" measured as "few people got it right" is what anybody reaches for
    first, and it is the measure that selection bias actually destroys: once
    hard items are served mostly to strong students, their percent-correct rises
    and they stop looking hard. Reported next to the model-based rating so the
    difference is visible rather than asserted.
    """
    seen: dict[str, list[int]] = {}
    for response in responses:
        seen.setdefault(response.item, []).append(int(response.correct))
    ids = [
        item_id
        for item_id, values in seen.items()
        if len(values) >= minimum and item_id in truth
    ]
    if len(ids) < 3:
        return {"items": len(ids)}
    observed = [1 - sum(seen[item_id]) / len(seen[item_id]) for item_id in ids]
    actual = [truth[item_id].difficulty for item_id in ids]
    return {"items": len(ids), "spearman": round(spearman(observed, actual) or 0.0, 4)}


def recovery(state: ReplayResult, truth: dict[str, TrueItem], *, minimum: int = 1) -> dict:
    """How close the ratings came to the difficulties that generated the data.

    Only available in simulation, and only meaningful with the caveat that the
    generator is 2PL: a Rasch estimator cannot recover a 2PL difficulty exactly,
    so a correlation below 1 is expected rather than a defect. The rank
    correlation is the number to read.
    """
    centre = state.centre()
    ids = [
        item_id
        for item_id, item in state.items.items()
        if item.responses >= minimum and item_id in truth
    ]
    if len(ids) < 3:
        return {"items": len(ids)}
    estimated = [state.items[item_id].rating - centre for item_id in ids]
    actual = [truth[item_id].difficulty for item_id in ids]
    mean_estimated = sum(estimated) / len(estimated)
    mean_actual = sum(actual) / len(actual)
    covariance = sum((a - mean_estimated) * (b - mean_actual) for a, b in zip(estimated, actual))
    spread = math.sqrt(
        sum((a - mean_estimated) ** 2 for a in estimated) * sum((b - mean_actual) ** 2 for b in actual)
    )
    errors = [a - b for a, b in zip(estimated, actual)]
    return {
        "items": len(ids),
        "pearson": round(covariance / spread, 4) if spread else None,
        "spearman": round(spearman(estimated, actual) or 0.0, 4),
        "bias": round(sum(errors) / len(errors), 4),
        "rmse": round(math.sqrt(sum(error**2 for error in errors) / len(errors)), 4),
        "mean_responses_per_item": round(
            sum(state.items[item_id].responses for item_id in ids) / len(ids), 1
        ),
    }
