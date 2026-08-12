"""Does the strategy trial's control arm still freeze on repeated questions?

    python3 tools/audit/control_arm_exposure.py

`docs/audits/interleaving-audit.md` §2.6 reported that the arm was a hash of
(student, question, slot, style, key), so a review question returning to the
same slot redrew the same arm forever. It gave one number for one simulated
saturated student: 2.0% control on repeats against 25% by design.

That number does not reproduce, and this script is why. Nothing was wrong with
the audit's mechanism — it is real and this script demonstrates it directly —
but a single student's realised share is a property of where their particular
(student, question, slot) triples happen to fall in the hash space, and it can
land anywhere. The audit's own §7 says as much about its cohort-level figures.
So the finding needed a measurement that does not depend on one draw, and this
is that measurement, taken two ways:

*Agreement.* Of the (question, slot) pairs a student meets more than once, what
share get the same arm every time? This is the mechanism, stated so that it
cannot come out differently for a lucky student. Under the old seed it is 100%
by construction. Under the new one it is whatever repeated coin flips give.

*Spread.* Across many simulated students, what is the range of realised control
shares? A working randomisation keeps every student near the design. A frozen
one scatters them, and the pooled average stays at a healthy quarter the whole
time, which is why nothing noticed.

Both seeds are computed here, side by side, on the same synthetic traffic. No
database and no application context: `_stable_fraction` and CONTROL_PROBABILITY
are the entire mechanism under test.
"""

from __future__ import annotations

import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from app.strategies import CONTROL_PROBABILITY, _stable_fraction  # noqa: E402


STUDENTS = 200
RUNS_PER_STUDENT = 20
RUN_LENGTH = 10
# Half of every run is review, and per §1.4 of the audit the review half is a
# small recirculating set. Twelve cards is a realistic queue for a student who
# has answered a few hundred questions.
QUEUE = 12
BANK = 400


def _old_seed(user: str, question: str, position: int) -> str:
    """(student, question, slot, style). Style was always "cases"."""
    return f"control:{user}:{question}:{position}:cases"


def _new_seed(user: str, question: str, position: int, run: str) -> str:
    """The same, plus the run the encounter happened in."""
    return f"control:{user}:{question}:{position}:{run}"


def _is_control(seed: str) -> bool:
    return _stable_fraction(seed) < CONTROL_PROBABILITY


def _traffic(student: int, queue: int):
    """One student's encounters: (question, slot, run), reviews recirculating."""
    for run in range(RUNS_PER_STUDENT):
        for position in range(RUN_LENGTH):
            if position % 2:
                # A review slot, drawn from the student's small queue. The
                # modular walk is what makes the same card return to the same
                # slot, which is the condition the audit identified.
                question = f"q{student}-review-{(run + position) % queue}"
            else:
                question = f"q-fresh-{(student * 977 + run * 31 + position) % BANK}"
            yield question, position, f"run-{student}-{run}"


def _measure(label: str, queue: int) -> dict:
    per_student_share = []
    frozen_pairs = 0
    repeated_pairs = 0
    controls = 0
    draws = 0
    for student in range(STUDENTS):
        user = f"student-{student}"
        arms = defaultdict(list)
        for question, position, run in _traffic(student, queue):
            seed = (
                _old_seed(user, question, position)
                if label == "old"
                else _new_seed(user, question, position, run)
            )
            arms[(question, position)].append(_is_control(seed))
        student_draws = [arm for values in arms.values() for arm in values]
        per_student_share.append(sum(student_draws) / len(student_draws))
        controls += sum(student_draws)
        draws += len(student_draws)
        for values in arms.values():
            if len(values) > 1:
                repeated_pairs += 1
                frozen_pairs += len(set(values)) == 1
    return {
        "pooled": controls / draws,
        "min": min(per_student_share),
        "max": max(per_student_share),
        "stdev": statistics.pstdev(per_student_share),
        "frozen": frozen_pairs / repeated_pairs if repeated_pairs else 0.0,
        "repeated_pairs": repeated_pairs,
        "off_by_a_third": sum(
            1
            for share in per_student_share
            if abs(share - CONTROL_PROBABILITY) > CONTROL_PROBABILITY / 3
        ),
    }


def main() -> None:
    report = {label: _measure(label, QUEUE) for label in ("old", "new")}
    print("CONTROL ARM, BEFORE AND AFTER THE EXPOSURE FIX")
    print(
        f"  {STUDENTS} simulated students, {RUNS_PER_STUDENT} runs of {RUN_LENGTH}, "
        f"a {QUEUE}-card review queue recirculating through the odd slots."
    )
    print(f"  Design control share: {CONTROL_PROBABILITY:.0%}\n")
    header = f"  {'':<34}{'old seed':>12}{'new seed':>12}"
    print(header)
    rows = (
        ("pooled control share", "pooled", "{:.1%}"),
        ("lowest student's share", "min", "{:.1%}"),
        ("highest student's share", "max", "{:.1%}"),
        ("spread across students (sd)", "stdev", "{:.3f}"),
        ("students off design by a third", "off_by_a_third", "{:.0f}"),
        ("repeat pairs frozen in one arm", "frozen", "{:.1%}"),
    )
    for title, key, fmt in rows:
        print(
            f"  {title:<34}{fmt.format(report['old'][key]):>12}"
            f"{fmt.format(report['new'][key]):>12}"
        )

    print(
        f"\n  {report['old']['repeated_pairs']:,} (question, slot) pairs recurred at least once."
    )
    print(
        "\n  The pooled share is correct under both, and identical under both. That is the\n"
        "  first finding, and it is the reason nothing noticed for as long as it did: an\n"
        "  aggregate cannot see this failure at all."
    )
    print(
        "\n  The second is that at a twelve-card queue the spread barely moves either, and\n"
        "  the audit's 2.0% does not reproduce. The severity is not a constant. It is a\n"
        "  function of how concentrated the recirculating review set is, because that is\n"
        "  what decides how many independent coins a student's realised share is made of.\n"
    )

    print("  SEVERITY AGAINST QUEUE SIZE, OLD SEED")
    print(
        f"  {'queue':>7}{'coins':>9}{'lowest':>10}{'highest':>10}{'sd':>8}"
        f"{'off design':>13}   (new seed sd)"
    )
    for queue in (2, 3, 4, 6, 12, 24, 60):
        old = _measure("old", queue)
        new = _measure("new", queue)
        # Distinct (question, slot) pairs a student meets: five review slots
        # over `queue` cards, capped by the number of encounters, plus the
        # fresh half, which never repeats enough to matter.
        coins = min(queue, RUNS_PER_STUDENT) * (RUN_LENGTH // 2) + RUNS_PER_STUDENT * (
            RUN_LENGTH // 2
        )
        print(
            f"  {queue:>7}{coins:>9}{old['min']:>10.1%}{old['max']:>10.1%}{old['stdev']:>8.3f}"
            f"{old['off_by_a_third']:>10} /{STUDENTS}   {new['stdev']:.3f}"
        )
    print(
        "\n  A student whose review queue has collapsed to two or three cards they keep\n"
        "  failing is the case the audit found, and there the realised share does swing\n"
        "  to single figures. That student is not a curiosity: they are the one\n"
        "  practising hardest, they generate the most rows, and their control arm is the\n"
        "  one that starves. The new seed's column is flat across the whole sweep, which\n"
        "  is the property being bought.\n"
    )
    print(
        "  `experiments.assignment_health` and `strategies.strategy_selection_health`\n"
        "  check the per-student figure rather than the pooled one for exactly this\n"
        "  reason, and they report the minimum rather than the mean."
    )


if __name__ == "__main__":
    main()
