"""The strategy trial, read across every student at once.

    python3 tools/audit/strategy_trial_population.py [path/to/app.db]

`strategy_performance(user_id)` is the only reading of this trial in the
application, and every query inside it filters on that student. The file's own
comments say a per-student verdict needs thousands of observations and honour
that by never claiming one. So the app has been running a randomised trial
whose per-student output it knows is unusable, while never computing the
estimate the same randomisation fully supports.

Nothing about the randomisation needed repairing for this. Arms are drawn
independently per encounter, the propensity is written on the row,
intention-to-treat is held throughout, and prompt and control labels are kept
apart. The only thing missing was a query without a `WHERE user_id =` clause,
and this is that query. It changes no behaviour, has no route, and is not
cached: it prints.

Two estimates per cell rather than one. The plain pooled difference is already
unbiased, because the trial randomises within a student. The within-student
version — each student's own prompt-minus-control, averaged, weighted by how
much comparison each supplies — is what a lopsided arm mix on the heaviest
account cannot move. They should agree closely, and the gap between them is
printed because a divergence is a finding about the allocation rather than
about the approach.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from app import create_app  # noqa: E402
from app.strategies import (  # noqa: E402
    MIN_CONTRAST_SAMPLE,
    strategy_population_reading,
    strategy_selection_health,
    strategy_selection_reading,
)


def _database_uri() -> str:
    if len(sys.argv) > 1:
        return f"sqlite:///{os.path.abspath(sys.argv[1])}"
    return os.environ.get("DATABASE_URL") or "sqlite:///" + os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "backend", "instance", "app.db")
    )


def _points(value, sign: bool = True) -> str:
    if value is None:
        return "—"
    return f"{value:+.1f}" if sign else f"{value:.1f}"


def _cell(result: dict) -> str:
    return (
        f"  {result['title'][:34]:<34} "
        f"{result['sample']:>6} with  {result['control_sample']:>6} without  "
        f"{result['students']:>4} students  "
        f"eff {result['contrast_sample']:>7.1f}  "
        f"pooled {_points(result['pooled_lift']):>6} ± {_points(result['half_width'], sign=False):>4}  "
        f"within {_points(result['within_student_lift']):>6}  "
        f"gap {_points(result['estimator_gap'], sign=False):>5}"
        f"{'  SEPARATES' if result['separates_from_zero'] else ''}"
    )


def main() -> None:
    app = create_app({"SQLALCHEMY_DATABASE_URI": _database_uri(), "AUTO_SEED": False})
    with app.app_context():
        reading = strategy_population_reading()
        print("THE OFFER TRIAL, POOLED ACROSS STUDENTS")
        print(
            f"  {reading['students']} students, {reading['trials']} trialled answers. "
            f"A cell is measured at an effective sample of {MIN_CONTRAST_SAMPLE}, and "
            "separates when its 95% interval clears zero."
        )
        print(f"  {reading['basis']}\n")
        for section in reading["sections"]:
            print(
                f"{section['section']}   {section['trials']} answers, "
                f"{section['students']} students, baseline {section['baseline_accuracy']}%"
            )
            if not section["results"]:
                print("  nothing tried here yet\n")
                continue
            for result in section["results"]:
                print(_cell(result))
            measured = section["measured"]
            leading = section["leading"]
            print(f"  measured: {', '.join(measured) if measured else 'none yet'}")
            print(f"  ahead:    {', '.join(leading) if leading else 'none'}\n")

        selection = strategy_selection_reading()
        print("WHICH APPROACH: RANKED AGAINST UNIFORM")
        print(f"  population: {selection['population']}")
        for section in selection["sections"]:
            print(
                f"  {section['short_label']}  ranked {section['ranked_sample']:>6}  "
                f"uniform {section['uniform_sample']:>6}  eff {section['contrast_sample']:>7.1f}  "
                f"pooled {_points(section['pooled_lift']):>6} ± {_points(section['half_width'], sign=False):>4}  "
                f"within {_points(section['within_student_lift']):>6}"
                f"{'  SEPARATES' if section['separates_from_zero'] else ''}"
            )

        health = strategy_selection_health()
        print("\n  arm health (the check a pooled share cannot make)")
        print(
            f"    pooled uniform share {health['pooled_uniform_share']} against a design of "
            f"{health['design_uniform_share']}"
        )
        print(
            f"    per student: min {health['min_uniform_share']}, max {health['max_uniform_share']}, "
            f"{health['students_off_design']} of {health['students_measured']} off design"
        )
        print(
            f"    independence: largest per-student gap between the uniform share inside the "
            f"prompt arm and inside the control arm is {health['max_arm_gap']} "
            f"over {health['students_with_both_offer_arms']} students"
        )


if __name__ == "__main__":
    main()
