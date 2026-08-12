"""What each adaptive layer's measurement costs, in observations.

Registering a layer is cheap. Filling its comparison is not, and the second
number is the one that decides whether a layer is measurable at this app's
scale or only nominally measured. This script computes it from the registry's
own shares rather than from anybody's recollection, so the figures in
`docs/learning-system.md` and in the FSRS decision can be re-derived.

    python3 tools/audit/measurement_cost.py

The arithmetic, stated once so the assumptions are arguable rather than buried.

**The two-proportion sample.** To detect a difference δ between two arms whose
outcome sits near p, at 80% power and the conventional 5% two-sided level, each
arm needs about

    n = 2 · (1.96 + 0.84)² · p(1−p) / δ²  ≈  15.7 · p(1−p) / δ²

independent observations. It is quadratic in δ, which is the whole story: a
three-point effect costs four times a six-point one.

**Clustering.** Only one of these layers randomises per answer. A layer drawn
per run collects several correlated answers under one draw, and a layer drawn
per student collects hundreds. The usual correction multiplies the requirement
by the design effect 1 + (m − 1)·ICC, where m is answers per draw and ICC is
how alike two answers under one draw are. This is where the FSRS number comes
from and it is not a rounding detail: at 100 answers per student and an ICC of
0.2, one student is worth about five independent answers, not a hundred.

**The holdback.** Both arms have to fill, and the smaller one governs. A
quarter holdback means total observations are roughly the control arm's
requirement divided by 0.25.

**Eligibility.** A layer only enrols encounters where its arms could differ.
`strategy_selection` skips the coverage phase and single-candidate questions;
`run_ordering` skips runs with no reviews or no fresh material. The eligible
share below is an estimate and is labelled as one.

Every effect size here is a judgement, and the honest thing is that they are
the least defensible inputs in the file. They are set to what the layer would
have to achieve to be worth keeping rather than to what anyone expects, because
a layer that moves accuracy by less than the number below is not a layer worth
one run in four.
"""

from __future__ import annotations

import os
import sys
import textwrap

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from app.experiments import LAYERS  # noqa: E402


# 2·(z_{0.975} + z_{0.80})² ≈ 15.7
POWER_CONSTANT = 15.7


def per_arm(rate: float, effect: float) -> float:
    return POWER_CONSTANT * rate * (1 - rate) / (effect**2)


def design_effect(answers_per_draw: float, icc: float) -> float:
    return 1 + (answers_per_draw - 1) * icc


class Cost:
    def __init__(
        self,
        layer: str,
        *,
        outcome: str,
        rate: float,
        effect: float,
        answers_per_draw: float,
        icc: float,
        eligible_share: float,
        draws_per_student: float,
        holdback_override: float | None = None,
        cells: int = 1,
        note: str = "",
    ):
        self.layer = layer
        self.outcome = outcome
        self.rate = rate
        self.effect = effect
        self.answers_per_draw = answers_per_draw
        self.icc = icc
        self.eligible_share = eligible_share
        self.draws_per_student = draws_per_student
        self.holdback_override = holdback_override
        # How many independent comparisons the layer's question actually
        # contains. One, for a layer that asks "does this help?". Twenty-eight
        # for a layer that ranks fourteen approaches in two sections, and
        # leaving that at one is how the strategy trial came to look affordable.
        self.cells = cells
        self.note = note

    @property
    def spec(self):
        return LAYERS[self.layer]

    @property
    def holdback(self) -> float:
        # A layer that is not running a holdout has no off-arm share to read,
        # so the counterfactual share is supplied. That is the whole point of
        # the line for `review_scheduling`: the cost of the trial nobody is
        # running is the reason nobody is running it.
        if self.holdback_override is not None:
            return self.holdback_override
        return self.spec.share(self.spec.off_arm)

    def report(self) -> dict:
        independent = per_arm(self.rate, self.effect)
        inflated = independent * design_effect(self.answers_per_draw, self.icc)
        control_answers = inflated
        control_draws = control_answers / self.answers_per_draw
        total_draws = control_draws / self.holdback if self.holdback else float("inf")
        eligible_answers = total_draws * self.answers_per_draw
        all_answers = eligible_answers / self.eligible_share if self.eligible_share else float("inf")
        students = total_draws / self.draws_per_student if self.draws_per_student else float("inf")
        return {
            "independent_per_arm": independent,
            "design_effect": design_effect(self.answers_per_draw, self.icc),
            "control_answers": control_answers,
            "total_draws": total_draws,
            "answers_to_watch": all_answers,
            "students": students,
        }


# A run is eight to ten questions and a heavy student answers a few hundred.
# Accuracy on LSAT practice sits near 60% across this bank.
COSTS = [
    Cost(
        "weak_type_targeting",
        outcome="accuracy on later first encounters with the targeted types",
        # Weak types are below their section by construction — that is what
        # being on the list means — so the base rate is not the bank's 60%.
        rate=0.50,
        # Bigger than the other layers' three points, and deliberately so. A
        # targeted run gives up 60% of its fresh material to two or three
        # types; a treatment that dear has to move them by four points to be
        # worth the coverage it costs.
        effect=0.04,
        # Not the whole run. The reading is over answers on the targeted types
        # in later runs, and a following run holds two or three of those.
        answers_per_draw=3,
        icc=0.10,
        # Answers in the population over all answers filed: roughly a third of
        # a run is a targeted type, and about seven students in ten have a
        # weakness the rolling signal will name at any given time.
        eligible_share=0.25,
        draws_per_student=40,
        note=(
            "Cheaper since the signal changed. The old one read the last "
            "mega-litigation, so a student who had never sat one was ineligible "
            "forever and the rest were re-read only when they sat another; the "
            "rolling signal makes almost every student with history eligible. "
            "Interference is unpriced here and dilutes toward the null, so treat "
            "this as the count for a positive finding rather than for a null one."
        ),
    ),
    Cost(
        "run_ordering",
        outcome="accuracy when the run's questions next return through the queue",
        rate=0.60,
        effect=0.03,
        # Reviews are at most half a run, and only those come back to be
        # scored, so the delayed window collects fewer answers per draw than
        # the run holds.
        answers_per_draw=4,
        icc=0.10,
        eligible_share=0.6,  # runs with both reviews and fresh material
        draws_per_student=40,
        note=(
            "Per section, never pooled, so the Logical Reasoning figure below has to "
            "be met inside the Logical Reasoning stratum alone — roughly two thirds "
            "of answers — and the Reading Comprehension stratum needs the same again."
        ),
    ),
    Cost(
        "strategy_selection",
        outcome="accuracy on the offered question",
        rate=0.60,
        # Best-of-k against uniform-over-k, where k is two or three and the
        # approaches differ by a few points at most. Two points is generous.
        effect=0.02,
        answers_per_draw=1,
        icc=0.0,
        # Treated arm only (75%), past the coverage phase, more than one
        # candidate.
        eligible_share=0.75 * 0.5,
        draws_per_student=300,
    ),
    Cost(
        "strategy_offer",
        outcome="accuracy on the question the offer was made on",
        rate=0.60,
        effect=0.03,
        answers_per_draw=1,
        icc=0.0,
        eligible_share=1.0,
        draws_per_student=300,
        cells=28,
        note=(
            "PER CELL. The trial does not ask whether prompting helps in general; it "
            "ranks approaches, so the figure above has to be met for each of the 14 "
            "approaches in each of the 2 sections. `strategies.strategy_population_"
            "reading` is the pooled estimate that at least makes one cell fillable; "
            "the per-student version needs it 28 times over, per student."
        ),
    ),
    Cost(
        "review_scheduling",
        outcome="accuracy on review returns",
        rate=0.60,
        effect=0.03,
        # A student under one scheduler for the life of the trial. This is the
        # line that decides the layer.
        answers_per_draw=100,
        icc=0.20,
        eligible_share=1.0,
        draws_per_student=1,
        holdback_override=0.25,
        note=(
            "THE TRIAL THAT IS NOT RUNNING. Exposure would have to be per student, "
            "because a schedule cannot coherently flip between runs, and the students "
            "figure below is why the holdout was judged indefensible."
        ),
    ),
]


def thousands(value: float) -> str:
    if value == float("inf"):
        return "never"
    return f"{round(value):,}"


def main() -> None:
    print("MEASUREMENT COST PER LAYER")
    print("80% power, 5% two-sided, from the registry's own arm shares.\n")
    for cost in COSTS:
        spec = cost.spec
        result = cost.report()
        print(f"{spec.key}  [{spec.status}, drawn per {spec.unit}]")
        print(f"  outcome            {cost.outcome}")
        print(
            f"  effect sought      {cost.effect * 100:.0f} points on a {cost.rate * 100:.0f}% base rate"
        )
        print(f"  holdback           {cost.holdback:.0%}")
        print(
            f"  clustering         {cost.answers_per_draw:g} answer(s) per draw, ICC {cost.icc:.2f}"
            f"  → design effect {result['design_effect']:.1f}×"
        )
        print(
            f"  per arm, ideal     {thousands(result['independent_per_arm'])} independent answers"
        )
        print(f"  off arm, realised  {thousands(result['control_answers'])} answers")
        print(f"  draws to fill      {thousands(result['total_draws'])} {spec.unit}s")
        print(f"  answers to watch   {thousands(result['answers_to_watch'])}")
        print(f"  students needed    {thousands(result['students'])}")
        if cost.note:
            wrapped = textwrap.wrap(cost.note, width=76)
            print(f"  note               {wrapped[0]}")
            for line in wrapped[1:]:
                print(f"                     {line}")
        print()

    print("CHEAPEST FIRST, BY ANSWERS TO WATCH")
    print(
        "  Whose question gets answered first, if the app grows one bank of traffic\n"
        "  and every layer draws from it at once. Multiplied by the number of cells the\n"
        "  layer's question really contains, which is where the strategy trial's\n"
        "  affordability went.\n"
    )
    ranked = sorted(COSTS, key=lambda cost: cost.report()["answers_to_watch"] * cost.cells)
    for cost in ranked:
        result = cost.report()
        cells = f"   × {cost.cells} cells" if cost.cells > 1 else ""
        print(
            f"  {cost.layer:<22}"
            f"{thousands(result['answers_to_watch'] * cost.cells):>10} answers"
            f"{thousands(result['students'] * cost.cells):>8} students{cells}"
        )
    print()

    print("CALIBRATION, FOR THE LAYER THAT HAS NO HOLDOUT")
    print(
        "  review_scheduling is read by `scheduling.review_calibration` instead. A band\n"
        "  of the calibration curve is a single proportion rather than a difference of\n"
        "  two, so it needs (1.96/w)² · p(1−p) reviews for a half-width w."
    )
    for width in (0.05, 0.02):
        band = (1.96 / width) ** 2 * 0.92 * 0.08
        print(
            f"  ±{width * 100:.0f} points on the 92% band   {thousands(band)} reviews in that band"
            f"  → about {thousands(band * 4)} reviews in total across the curve"
        )
    holdout = next(cost for cost in COSTS if cost.layer == "review_scheduling").report()
    print(
        f"\n  Against {thousands(holdout['students'])} students for the holdout above. The calibration reading is\n"
        "  three orders of magnitude cheaper, needs no control group, and can return a\n"
        "  null — a flat curve means the per-card memory state carries no information\n"
        "  about recall, which is a negative result about the whole layer."
    )


if __name__ == "__main__":
    main()
