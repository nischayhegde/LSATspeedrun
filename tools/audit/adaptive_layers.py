"""What is deciding what a student sees, and whether the draws are still draws.

Two readings, and they answer different questions.

**The census** needs no database. It prints every layer in
`app.experiments.LAYERS` — what decision it makes, what signal it reads, what it
does when that signal is missing, which arms it draws and who draws them. This
is the machine-readable half of `docs/learning-system.md`, and the two are meant
to be read against each other: a layer in one and not the other is the drift the
registry exists to expose.

    python3 tools/audit/adaptive_layers.py

**The health check** needs a database, and it is the one worth running.

    python3 tools/audit/adaptive_layers.py --database-url sqlite:///backend/instance/app.db

It reports each layer's realised arm share **per student**, not pooled, because
pooled is the instrument that failed. The strategy trial's control arm read
25.0% across the bank while individual heavy users sat near 2%: the pooled
number was correct and useless, since it is an average over students and the
quantity that broke was per student. `min_student_share` is the number to read.
`--reading` adds the intention-to-treat outcome comparison per layer, which is a
different and much slower-filling thing.

Report-only. Nothing here writes, and a broken allocation is repaired by fixing
the draw and starting a new `design_version`, never by rewriting rows whose
propensity an estimator has already trusted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.experiments import (  # noqa: E402
    HEALTH_MIN_DRAWS,
    LAYERS,
    assignment_health,
    layer_reading,
    registry_reading,
)


def print_census() -> None:
    print(f"\n{len(LAYERS)} adaptive layers declared\n")
    for entry in registry_reading():
        arms = ", ".join(f"{arm} {share:.0%}" for arm, share in entry["arms"].items())
        # A calibrated layer has a unit — it is what the exposure *would* be —
        # but calling it "randomised per student" would be the one thing the
        # registry is careful not to claim about it.
        unit = (
            f"randomised per {entry['unit']}"
            if entry["instrument"] == "holdout"
            else f"not randomised; a holdout would be per {entry['unit']}"
        )
        print(f"  {entry['layer']}  [{entry['status']}]  {unit}")
        print(f"      decides   {entry['question']}")
        print(f"      reads     {entry['signal']}")
        print(f"      if absent {entry['without_signal']}")
        print(f"      arms      {arms}   (off: {entry['off_arm']})")
        print(f"      drawn by  {entry['assigned_by']}   design {entry['design_version']}")
        if entry["instrument"] != "holdout":
            print(f"      read by   {entry['instrument']}, not by a comparison group")
        else:
            print(f"      read on   {entry['outcome_window']} answers"
                  + (f", split by {entry['strata']}, never pooled" if entry["strata"] else ""))
        if entry["population"]:
            print(f"      over      {entry['population']}")
        print()


def print_health(layer_key: str, *, reading: bool) -> None:
    health = assignment_health(layer_key)
    print(f"\n  {layer_key}")
    print(f"      students {health['students']}   draws {health['draws']}")
    if not health["draws"]:
        print("      no draws recorded yet — nothing to check")
        return
    print(f"      design versions {health['design_versions']}")
    # Below one means a caller found a way to hand the same encounter to two
    # draws, which is the coarsening that broke the strategy trial.
    print(f"      min exposures per draw {health['min_exposures_per_draw']}")
    for arm in health["arms"]:
        measured = arm["students_measured"]
        detail = (
            f"min {arm['min_student_share']}  median {arm['median_student_share']}  "
            f"max {arm['max_student_share']}  off-design {arm['students_off_design']}/{measured}"
            if measured
            else f"no student has {HEALTH_MIN_DRAWS} draws yet"
        )
        print(
            f"      {arm['arm']:<14} design {arm['design_share']:<6} "
            f"pooled {arm['pooled_share']}   {detail}"
        )
    if reading:
        print("      reading " + json.dumps(layer_reading(layer_key), default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", help="read recorded assignments from this database")
    parser.add_argument("--reading", action="store_true", help="also print the outcome comparison")
    parser.add_argument("--layer", help="one layer key instead of all of them")
    args = parser.parse_args()

    print_census()
    if not args.database_url:
        print("  (no --database-url, so no assignments were read)\n")
        return

    from app import create_app

    application = create_app({"SQLALCHEMY_DATABASE_URI": args.database_url, "AUTO_SEED": False})
    keys = [args.layer] if args.layer else list(LAYERS)
    print("REALISED ALLOCATION, PER STUDENT")
    with application.app_context():
        for key in keys:
            if LAYERS[key].assigned_by != "app/experiments.py":
                print(f"\n  {key}\n      drawn by {LAYERS[key].assigned_by}; not recorded here")
                continue
            print_health(key, reading=args.reading)
    print()


if __name__ == "__main__":
    main()
