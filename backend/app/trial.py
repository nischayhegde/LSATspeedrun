"""The trial calendar: the learner's real test date, kept as a court date.

The LSAT sitting the learner has already told onboarding about (`users.target_score`
and `users.target_test_date`) is the firm's trial date. Everything here is a
reading of those two columns plus the existing projection in `scoring.py`; no
new schema, no second notion of a deadline, and no invented score model.

The one piece of real arithmetic is `_cases_to_close_gap`, and it is inverted
directly out of the estimator the dashboard already shows rather than being a
rule of thumb. `scoring.shrink_toward_prior` reports

    p_hat = (K*p_prior + S*p_obs) / (K + S)

for prior strength K and evidence weight S. Two consequences fall out of it and
they are the whole design:

  * If the learner keeps answering at their observed rate p_obs, the estimate
    converges to p_obs and no further. So a target above p_obs is not a matter
    of doing more cases -- it needs a better answer rate, and saying "N more
    cases" would be a lie. That is the `accuracy_gap` branch.
  * If p_obs already clears the target, the remaining distance is pure
    shrinkage, and the S that closes it can be solved for exactly. That is the
    `evidence_gap` branch, and it is the one that produces a weekly case count.

Recency decay is not ignored, because over a three-month run-up it dominates:
`scoring._weight` halves a case's contribution every 30 days, so evidence
gathered today is worth about a quarter of its face value by test day. Both the
existing balance and the newly-added cases are discounted accordingly, which is
why the weekly number does not collapse to nothing on a long runway.

The tone is a deliberate constraint. A countdown that a learner reads as "you
are behind" every single day is a reason to close the app, so the phases below
are named after ordinary steps in a case's life, the pacing line always states a
concrete next action, and a passed or missing date degrades into an invitation
rather than an error.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from .models import DailyProgress, PlayerProfile, User
from .scoring import (
    EVIDENCE_GRADES,
    EVIDENCE_WEIGHT,
    FORM_ITEMS,
    PRIOR_ACCURACY,
    PRIOR_STRENGTH,
    RAW_TO_SCALED,
    RECENCY_HALF_LIFE_DAYS,
)

# Named for what a firm would actually be doing that far from a hearing. The
# player is never told they are "behind schedule" by a phase name.
TRIAL_PHASES: tuple[tuple[int, str, str], ...] = (
    (0, "Trial", "The hearing is today. Nothing left to file."),
    (3, "Eve of trial", "Papers are in. Keep the hand in, keep it light."),
    (14, "Final preparation", "Run the arguments you already know cold."),
    (42, "Pre-trial conference", "The shape of the case is set. Tighten the weak sections."),
    (84, "Pre-trial motions", "Enough runway to change the outcome. This is where the work counts."),
    (10_000, "Discovery", "Early days. Build the record; the pace can be gentle."),
)

# The evidence grade the plan aims the learner at. Below `directional` the
# projection is still visibly borrowing from the population prior, so promising
# a target score off it would be promising something the model has not measured.
TARGET_EVIDENCE_SAMPLE = next(
    threshold for threshold, name in EVIDENCE_GRADES if name == "directional"
)
# What one more case is worth in evidence at the moment it is answered. Coached
# practice is the ordinary case loop and therefore the honest default; a learner
# who sits mega-litigations earns evidence faster and the plan will say so once
# their history shows it.
DEFAULT_CASE_WEIGHT = EVIDENCE_WEIGHT["coached_practice"]
# A weekly ask above this stops being a plan and becomes a reason to give up.
# When the honest number exceeds it the plan says so in words instead of
# printing an intimidating figure.
MAX_SUSTAINABLE_WEEKLY_CASES = 60
PACE_TOLERANCE = 0.85


def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _phase(days_remaining: int) -> tuple[str, str]:
    for threshold, name, note in TRIAL_PHASES:
        if days_remaining <= threshold:
            return name, note
    return TRIAL_PHASES[-1][1], TRIAL_PHASES[-1][2]


def _accuracy_for_scaled(target_scaled: int) -> float:
    """Lowest form accuracy that reaches ``target_scaled`` on the median chart.

    Inverts `scoring.RAW_TO_SCALED`, the same table the projection converts
    through, so the target and the estimate are read off one ruler.
    """
    for raw, scaled in enumerate(RAW_TO_SCALED):
        if scaled >= target_scaled:
            return raw / FORM_ITEMS
    return 1.0


def _retention(days: float) -> float:
    """Average share of its face value that a case answered during the next
    ``days`` still carries on the last of them.

    Cases arrive roughly evenly across the run-up and each decays at
    `scoring.RECENCY_HALF_LIFE_DAYS`, so the mean surviving weight is the
    integral of 2^(-t/H) over the window divided by its length. Ignoring this
    understates the required pace by more than half on a 90-day runway.
    """
    if days <= 0:
        return 1.0
    decay = math.log(2) / RECENCY_HALF_LIFE_DAYS
    return (1 - math.exp(-decay * days)) / (decay * days)


def _cases_to_close_gap(
    *,
    observed_accuracy: float,
    effective_sample: float,
    required_accuracy: float,
    days_remaining: int,
    case_weight: float,
) -> tuple[int | None, float]:
    """Cases needed so the *shrunk* estimate reaches ``required_accuracy``.

    Returns ``(cases, surviving_balance)``. ``cases`` is None when the learner's
    own answer rate is at or below the target, i.e. when no amount of practice
    at the current rate gets there and the honest answer is an accuracy gap.
    """
    survived = effective_sample * 0.5 ** (days_remaining / RECENCY_HALF_LIFE_DAYS)
    if observed_accuracy <= required_accuracy:
        return None, survived
    # (K*p_prior + (S + d)*p_obs) / (K + S + d) >= p_req, solved for d.
    numerator = (
        required_accuracy * (PRIOR_STRENGTH + survived)
        - PRIOR_STRENGTH * PRIOR_ACCURACY
        - survived * observed_accuracy
    )
    needed_weight = max(0.0, numerator / (observed_accuracy - required_accuracy))
    per_case = max(1e-6, case_weight * _retention(days_remaining))
    return math.ceil(needed_weight / per_case), survived


def _cases_for_evidence(
    *, effective_sample: float, days_remaining: int, case_weight: float
) -> int:
    """Cases needed for the projection to stop calling itself provisional."""
    survived = effective_sample * 0.5 ** (days_remaining / RECENCY_HALF_LIFE_DAYS)
    shortfall = max(0.0, TARGET_EVIDENCE_SAMPLE - survived)
    per_case = max(1e-6, case_weight * _retention(days_remaining))
    return math.ceil(shortfall / per_case)


def _recent_weekly_pace(profile_id: str, *, now: datetime) -> int:
    """Cases settled in the trailing seven days, from the existing daily rows."""
    since = (now - timedelta(days=6)).date()
    rows = (
        DailyProgress.query.with_entities(DailyProgress.cases_completed)
        .filter(
            DailyProgress.profile_id == profile_id,
            DailyProgress.activity_date >= since,
        )
        .all()
    )
    return sum(int(count or 0) for (count,) in rows)


def _observed_case_weight(projection: dict) -> float:
    """How much evidence this learner's own recent cases have been worth each.

    Read back out of the projection rather than re-queried: `effective_sample`
    is already Σw over their attempts and `observed_attempts` is the count, so
    the ratio is their realised mix of coached, uncoached, and diagnostic work,
    net of how stale it is. Falls back to the coached rate before there is
    enough history for the ratio to mean anything.
    """
    attempts = int(projection.get("observed_attempts") or 0)
    if attempts < 10:
        return DEFAULT_CASE_WEIGHT
    sample = float(projection.get("effective_sample") or 0)
    # Ratio of decayed weight to raw count understates a *fresh* case, which is
    # what the learner is about to answer. Clamp up to the coached floor.
    return max(DEFAULT_CASE_WEIGHT, min(1.0, sample / attempts))


def trial_plan(
    user: User,
    *,
    projection: dict,
    profile: PlayerProfile | None = None,
    now: datetime | None = None,
) -> dict:
    """The trial calendar for one learner: countdown, phase, and weekly pace."""
    now = now or datetime.now(timezone.utc)
    today = now.date()
    test_date = _as_date(user.target_test_date)
    target_score = int(user.target_score) if user.target_score else None

    base = {
        "test_date": test_date.isoformat() if test_date else None,
        "target_score": target_score,
        "days_remaining": None,
        "weeks_remaining": None,
        "phase": None,
        "phase_note": None,
        "pace": None,
        "streak": int(profile.daily_streak_current or 0) if profile else 0,
    }

    if test_date is None:
        return {
            **base,
            "status": "unscheduled",
            "headline": "No trial date on the calendar",
            "detail": (
                "Set the date you sit the LSAT and the firm will work backwards from it "
                "to a weekly caseload."
            ),
        }

    days_remaining = (test_date - today).days
    if days_remaining < 0:
        return {
            **base,
            "status": "passed",
            "days_remaining": days_remaining,
            "headline": f"Trial date passed {abs(days_remaining)} day{'s' if abs(days_remaining) != 1 else ''} ago",
            "detail": (
                "The calendar has cleared. Set your next sitting to put a new date on it — "
                "your record and your firm carry over unchanged."
            ),
        }

    phase, phase_note = _phase(days_remaining)
    weeks_remaining = max(1.0, days_remaining / 7)
    recent = _recent_weekly_pace(profile.id, now=now) if profile is not None else 0
    common = {
        **base,
        "days_remaining": days_remaining,
        "weeks_remaining": round(weeks_remaining, 1),
        "phase": phase,
        "phase_note": phase_note,
    }
    day_word = "day" if days_remaining == 1 else "days"
    headline = (
        "Trial today" if days_remaining == 0 else f"{days_remaining} {day_word} to trial"
    )

    if not projection.get("available"):
        return {
            **common,
            "status": "no_evidence",
            "headline": headline,
            "detail": (
                "Run a set of cases and the calendar will turn your target score into a "
                "weekly caseload."
            ),
        }
    if not target_score:
        return {
            **common,
            "status": "no_target",
            "headline": headline,
            "detail": (
                "Set a target score and the calendar will work out the weekly caseload "
                "that reaches it by this date."
            ),
        }

    projected = int(projection["scaled_score"])
    upper = int(projection.get("upper_bound") or projected)
    observed_accuracy = float(projection.get("observed_accuracy") or 0)
    effective_sample = float(projection.get("effective_sample") or 0)
    case_weight = _observed_case_weight(projection)
    required_accuracy = _accuracy_for_scaled(target_score)

    evidence_cases = _cases_for_evidence(
        effective_sample=effective_sample,
        days_remaining=days_remaining,
        case_weight=case_weight,
    )
    gap_cases, _ = _cases_to_close_gap(
        observed_accuracy=observed_accuracy,
        effective_sample=effective_sample,
        required_accuracy=required_accuracy,
        days_remaining=days_remaining,
        case_weight=case_weight,
    )

    if gap_cases is None:
        # The learner's own answer rate does not reach the target, so the number
        # that matters is accuracy, not volume. The weekly figure still holds
        # the projection steady while they work on it, which is what the review
        # queue and strategy lab are for.
        weekly = max(3, math.ceil(evidence_cases / weeks_remaining))
        shortfall = max(0, round((required_accuracy - observed_accuracy) * FORM_ITEMS))
        status = "accuracy_gap"
        detail = (
            f"At your current answer rate the projection settles near {projected}. "
            f"Reaching {target_score} means about {shortfall} more question"
            f"{'s' if shortfall != 1 else ''} right out of every {FORM_ITEMS} — that is a "
            "review-and-technique problem, not a volume one."
        )
    else:
        total_cases = max(evidence_cases, gap_cases)
        weekly = math.ceil(total_cases / weeks_remaining)
        if weekly > MAX_SUSTAINABLE_WEEKLY_CASES:
            status = "tight"
            weekly = MAX_SUSTAINABLE_WEEKLY_CASES
            detail = (
                f"Reaching {target_score} by this date would take more cases a week than "
                "anyone sustains. Treat this as the ceiling, and consider whether a later "
                "sitting serves you better."
            )
        else:
            weekly = max(3, weekly)
            status = "on_plan"
            detail = (
                f"{weekly} case{'s' if weekly != 1 else ''} a week between now and then puts "
                f"the projection at {target_score} with the evidence to stand behind it."
            )

    if upper >= target_score and projected >= target_score:
        status = "target_met" if status != "tight" else status
        detail = (
            f"The projection is already at {projected}. This pace is what keeps it there "
            "through to the date."
        )

    if recent >= weekly:
        pace_state = "ahead"
        pace_note = f"You cleared {recent} in the last seven days. Comfortably on schedule."
    elif recent >= weekly * PACE_TOLERANCE:
        pace_state = "on_track"
        pace_note = f"You cleared {recent} in the last seven days. That is on schedule."
    elif recent > 0:
        pace_state = "behind"
        pace_note = f"You cleared {recent} in the last seven days; the plan asks for {weekly}."
    else:
        pace_state = "idle"
        pace_note = "No cases in the last seven days. One run is enough to restart the clock."

    return {
        **common,
        "status": status,
        "headline": headline,
        "detail": detail,
        "projected_score": projected,
        "pace": {
            "weekly_target": weekly,
            "recent_week": recent,
            "state": pace_state,
            "note": pace_note,
            "evidence_cases": evidence_cases,
            "gap_cases": gap_cases,
            "case_weight": round(case_weight, 2),
        },
    }
