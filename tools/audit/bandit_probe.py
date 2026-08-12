"""What the strategy bandit actually reaches, measured rather than read.

Report-only, and it writes to whatever database it is pointed at, so point it
at a copy:

    DATABASE_URL=sqlite:////tmp/ilaudit/audit.db \
      .venv/bin/python tools/audit/bandit_probe.py

Three questions, each answered by running `assign_strategy_trial` itself rather
than by reasoning about it.

1. Once the coverage phase is over, which *ranks* of the candidate list are
   still reachable? The exploit branch picks `ranked[0]`, or `ranked[1]` on a
   30% explore draw. If nothing below rank 1 is ever chosen, an approach that
   fell to third place on its first three observations can never be revisited.
2. How wide is the candidate list in practice? "Two to five eligible
   strategies" is the design; the bank decides the realised distribution.
3. Is the 25% control arm 25% *for one student*? The arm is a threshold on a
   hash that now includes the exposure — the id of the run the question was met
   in — so a question recurring at the same slot draws afresh each run, while a
   single encounter asked twice still answers the same. Both halves are measured
   here, because the second is the property the fix had to keep.
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("AUTO_SEED", "false")
os.environ.setdefault("FLASK_ENV", "development")

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Attempt, Question, SessionItem, StudySession, User, utcnow  # noqa: E402
from app import services, strategies  # noqa: E402


def observe(user_id: str, session_id: str, question: Question, key: str, index: int, correct: bool) -> None:
    item = SessionItem(
        session_id=session_id,
        question_id=question.id,
        position=index,
        target_time_seconds=150,
    )
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user_id,
            session_item_id=item.id,
            idempotency_key=f"bandit-{user_id}-{key}-{index}",
            selected_label="A",
            is_correct=correct,
            server_elapsed_ms=100_000,
            confidence=3,
            strategy_key=key,
            strategy_variant=strategies.VARIANT_PROMPT,
            strategy_propensity=1 - strategies.CONTROL_PROBABILITY,
        )
    )


def main() -> None:
    app = create_app()
    with app.app_context():
        print("candidate-list width across the whole bank")
        widths = Counter()
        by_section = {"Logical Reasoning": Counter(), "Reading Comprehension": Counter()}
        questions = Question.query.filter(Question.source.like(f"{services.SOURCE_PREFIX}%")).all()
        for question in questions:
            width = len(strategies._candidate_keys(question))
            widths[width] += 1
            by_section[question.section][width] += 1
        total = sum(widths.values())
        for width in sorted(widths):
            print(f"   {width} candidates: {widths[width]:6}  {widths[width] / total:6.1%}")
        for section, counter in by_section.items():
            print(f"   {section}: {dict(sorted(counter.items()))}")

        print("\nwhich ranks are reachable once coverage is satisfied")
        # A question with a wide candidate list, so ranks 2+ exist to be missed.
        wide = max(questions, key=lambda q: len(strategies._candidate_keys(q)))
        candidates = strategies._candidate_keys(wide)
        print(f"   probe question {wide.id} ({wide.section}) has {len(candidates)} candidates: {candidates}")

        user = User(email=f"bandit-{utcnow().timestamp()}@audit.test", display_name="bandit")
        db.session.add(user)
        db.session.flush()
        session = StudySession(
            user_id=user.id, mode="practice", status="completed", total_items=0, target_minutes=60
        )
        db.session.add(session)
        db.session.flush()

        # Clear coverage on every candidate, with a deliberately different true
        # accuracy per candidate so the ranking is unambiguous.
        index = 0
        for rank, key in enumerate(candidates):
            correct_count = strategies.BASE_COVERAGE_TRIALS - min(rank, strategies.BASE_COVERAGE_TRIALS - 1)
            for trial in range(strategies.BASE_COVERAGE_TRIALS):
                observe(user.id, session.id, wide, key, index, trial < correct_count)
                index += 1
        db.session.commit()

        chosen = Counter()
        for position in range(400):
            trial = strategies.assign_strategy_trial(
                user.id, wide, "cases", position, exposure=f"run-{position}"
            )
            chosen[trial["key"]] += 1
        print(f"   over 400 draws at one question: {dict(chosen)}")
        never = [key for key in candidates if key not in chosen]
        print(f"   never offered: {never or 'none'}")

        print("\ncontrol-arm share for one student at one question")
        arms = Counter()
        for position in range(400):
            trial = strategies.assign_strategy_trial(
                user.id, wide, "cases", position, exposure=f"run-{position}"
            )
            arms["control" if trial["variant"] in strategies.CONTROL_VARIANTS else "prompt"] += 1
        share = arms["control"] / sum(arms.values())
        print(f"   across 400 distinct slots: {share:.1%} control (design says {strategies.CONTROL_PROBABILITY:.0%})")

        # The same question at the same slot, met once per run across 40 runs.
        # The exposure has to vary for this to be 40 encounters rather than one
        # asked 40 times, which is the distinction the arm is now drawn over.
        repeat = Counter()
        for index in range(40):
            trial = strategies.assign_strategy_trial(
                user.id, wide, "cases", 3, exposure=f"run-{index}"
            )
            repeat["control" if trial["variant"] in strategies.CONTROL_VARIANTS else "prompt"] += 1
        print(f"   the same question at the same slot, once per run over 40 runs: {dict(repeat)}")

        # And the same exposure asked twice must not change its answer, or a
        # student could be flipped part-way through a question.
        held = {
            (
                strategies.assign_strategy_trial(
                    user.id, wide, "cases", 3, exposure="run-7"
                )["variant"]
            )
            for _ in range(20)
        }
        print(f"   one exposure asked 20 times: {len(held)} distinct arm(s) (1 is correct)")

        db.session.rollback()


if __name__ == "__main__":
    main()
