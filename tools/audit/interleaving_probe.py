"""What the sequencer and the bandit actually produce, measured on the real bank.

Report-only. This builds practice runs by calling the application's own
`create_study_session`, then reads the runs back and describes their shape. It
does not change any application code and it should be pointed at a *copy* of a
database, because building a run writes rows.

    cp /tmp/lsat-perf/app.db /tmp/ilaudit/audit.db
    DATABASE_URL=sqlite:////tmp/ilaudit/audit.db \
      .venv/bin/python tools/audit/interleaving_probe.py --runs 40

Why it drives the real function rather than reimplementing the logic: the
interesting question is not what `interleave` does to a list, which can be read
off the source, but what a *student* is served — after review selection, the
passage blocking, the focus bias, and the passage-mate clustering have all had
their say. Several of those interact.

Three cohorts are simulated, because the failure modes differ at each end:

* `cold`     — a brand new account. No attempts, no review queue, no focus.
* `mid`      — enough history for the review queue to be non-empty and for the
               bandit to be past its coverage phase on some approaches.
* `saturated`— the seeded demo student, ~900 attempts.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("AUTO_SEED", "false")
os.environ.setdefault("FLASK_ENV", "development")

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    Attempt,
    PlayerProfile,
    Question,
    ReviewQueueItem,
    SessionItem,
    StudySession,
    User,
    utcnow,
)
from app import scheduling, services, strategies  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--size", type=int, default=10)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def make_student(label: str) -> User:
    user = User(email=f"{label}-{utcnow().timestamp()}@audit.test", display_name=label)
    db.session.add(user)
    db.session.flush()
    db.session.add(
        PlayerProfile(
            user_id=user.id,
            lawyer_name="Audit",
            firm_name="Audit LLP",
            character_gender="female",
            cash=100_000,
        )
    )
    db.session.commit()
    return user


def give_history(user: User, answered: int, wrong_share: float = .4) -> None:
    """Answer `answered` questions, so the review queue and the bandit have input.

    Written straight to the tables rather than through the API: this is about
    the *state* the sequencer reads, and going through submission would also
    invoke coaching, the economy and the job queue.
    """
    questions = Question.query.filter(Question.source.like(f"{services.SOURCE_PREFIX}%")).limit(answered * 2).all()
    random.shuffle(questions)
    session = StudySession(
        user_id=user.id,
        mode="practice",
        status="completed",
        total_items=answered,
        target_minutes=user.target_minutes or 60,
    )
    db.session.add(session)
    db.session.flush()
    for position, question in enumerate(questions[:answered]):
        item = SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=position,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        correct = random.random() > wrong_share
        keys = strategies._candidate_keys(question)
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"audit-{user.id}-{position}",
                selected_label=question.correct_answer if correct else "A",
                is_correct=correct,
                server_elapsed_ms=120_000,
                confidence=3,
                strategy_key=random.choice(keys) if keys else None,
                strategy_variant=strategies.VARIANT_PROMPT,
                strategy_propensity=1 - strategies.CONTROL_PROBABILITY,
            )
        )
        card = ReviewQueueItem(user_id=user.id, question_id=question.id)
        db.session.add(card)
    db.session.commit()


def longest_same_type_run(types: list[str]) -> int:
    best = current = 1
    for index in range(1, len(types)):
        current = current + 1 if types[index] == types[index - 1] else 1
        best = max(best, current)
    return best


def describe(label: str, user: User, runs: int, size: int) -> dict:
    review_positions: list[float] = []
    review_counts: list[int] = []
    adjacent_same_type = 0
    adjacent_pairs = 0
    adjacent_same_section = 0
    longest_runs: list[int] = []
    section_mix: list[float] = []
    keys = Counter()
    variants = Counter()
    per_question_keys: dict[str, set] = defaultdict(set)
    candidate_widths = Counter()
    served = Counter()
    slot_variants: dict[tuple, set] = defaultdict(set)
    review_slots = Counter()
    slot_total = Counter()
    arm_on_repeat = Counter()
    arm_on_fresh = Counter()

    for _ in range(runs):
        for stale in services.list_resumable_sessions(user):
            stale.status = "abandoned"
        db.session.commit()

        session = services.create_study_session(user, count=size)
        items = (
            SessionItem.query.filter_by(session_id=session.id)
            .order_by(SessionItem.position)
            .all()
        )
        questions = {q.id: q for q in Question.query.filter(Question.id.in_([i.question_id for i in items]))}
        ordered = [questions[i.question_id] for i in items]
        seen_before = {
            question_id
            for (question_id,) in db.session.query(SessionItem.question_id)
            .join(Attempt, Attempt.session_item_id == SessionItem.id)
            .filter(Attempt.user_id == user.id)
            .all()
        }

        types = [q.question_type or "?" for q in ordered]
        sections = [q.section for q in ordered]
        for index in range(1, len(ordered)):
            adjacent_pairs += 1
            adjacent_same_type += types[index] == types[index - 1]
            adjacent_same_section += sections[index] == sections[index - 1]
        longest_runs.append(longest_same_type_run(types))
        section_mix.append(sum(s == "Reading Comprehension" for s in sections) / len(sections))

        repeats = [pos for pos, q in enumerate(ordered) if q.id in seen_before]
        review_counts.append(len(repeats))
        for pos in repeats:
            review_positions.append(pos / max(1, len(ordered) - 1))

        for item in items:
            keys[item.strategy_key] += 1
            variants[item.strategy_variant] += 1
            per_question_keys[item.question_id].add(item.strategy_key)
            served[item.question_id] += 1
            control = item.strategy_variant in strategies.CONTROL_VARIANTS
            if item.question_id in seen_before:
                arm_on_repeat["control" if control else "prompt"] += 1
            else:
                arm_on_fresh["control" if control else "prompt"] += 1
            slot_variants[(item.question_id, item.position)].add(item.strategy_variant)
            review_slots[item.position] += item.question_id in seen_before
            slot_total[item.position] += 1
        for question in ordered:
            candidate_widths[len(strategies._candidate_keys(question))] += 1

        session.status = "abandoned"
        db.session.commit()

    return {
        "label": label,
        "runs": runs,
        "review_per_run": sum(review_counts) / len(review_counts),
        "review_position_mean": (sum(review_positions) / len(review_positions)) if review_positions else None,
        "review_in_first_third": (
            sum(p < 1 / 3 for p in review_positions) / len(review_positions) if review_positions else None
        ),
        "same_type_adjacency": adjacent_same_type / max(1, adjacent_pairs),
        "same_section_adjacency": adjacent_same_section / max(1, adjacent_pairs),
        "longest_same_type_run": sum(longest_runs) / len(longest_runs),
        "rc_share": sum(section_mix) / len(section_mix),
        "keys": keys,
        "variants": variants,
        "candidate_widths": candidate_widths,
        "served": served,
        # A (question, slot) pair that recurs across runs and always lands in
        # the same arm is a deterministic assignment, not a fresh draw.
        "repeated_pairs": sum(1 for pair, arms in slot_variants.items() if len(arms) == 1 and served[pair[0]] > 1),
        "repeated_pairs_varying": sum(1 for pair, arms in slot_variants.items() if len(arms) > 1),
        "distinct_questions": len(served),
        "served_more_than_once": sum(1 for count in served.values() if count > 1),
        "review_by_slot": {slot: review_slots[slot] / slot_total[slot] for slot in sorted(slot_total)},
        "arm_on_repeat": arm_on_repeat,
        "arm_on_fresh": arm_on_fresh,
    }


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    app = create_app()
    with app.app_context():
        bank = Question.query.filter(Question.source.like(f"{services.SOURCE_PREFIX}%")).count()
        print(f"bank: {bank} eligible questions\n")

        cohorts = []
        cold = make_student("cold")
        cohorts.append(("cold (0 answered)", cold))

        mid = make_student("mid")
        give_history(mid, 60)
        cohorts.append(("mid (60 answered)", mid))

        existing = User.query.filter_by(email="perf@localhost.test").first()
        if existing:
            cohorts.append(("saturated (seeded demo)", existing))

        rows = [describe(label, user, args.runs, args.size) for label, user in cohorts]

        head = f"{'cohort':26} {'rev/run':>8} {'rev pos':>8} {'rev<1/3':>8} {'same-type':>10} {'same-sect':>10} {'run len':>8} {'RC share':>9}"
        print(head)
        print("-" * len(head))
        for row in rows:
            fmt = lambda v, spec=".2f": "—" if v is None else format(v, spec)  # noqa: E731
            print(
                f"{row['label']:26} {row['review_per_run']:8.2f} {fmt(row['review_position_mean']):>8}"
                f" {fmt(row['review_in_first_third']):>8} {row['same_type_adjacency']:10.2f}"
                f" {row['same_section_adjacency']:10.2f} {row['longest_same_type_run']:8.2f} {row['rc_share']:9.2f}"
            )

        for row in rows:
            print(f"\n  {row['label']}")
            print(f"    variants        {dict(row['variants'])}")
            print(f"    candidate width {dict(sorted(row['candidate_widths'].items()))}")
            top = row["keys"].most_common(8)
            print(f"    approaches      {top}")
            total = sum(row["keys"].values())
            if top and total:
                print(f"    leader share    {top[0][1] / total:.1%} of assignments went to {top[0][0]}")
            controls = sum(row["variants"].get(v, 0) for v in strategies.CONTROL_VARIANTS)
            print(f"    control share   {controls}/{total} = {controls / total:.1%} (design says 25%)")
            print(
                f"    repeats         {row['served_more_than_once']} of {row['distinct_questions']}"
                f" distinct questions served more than once"
            )
            print(
                f"    arm stability   {row['repeated_pairs']} recurring (question, slot) pairs always got the"
                f" same arm; {row['repeated_pairs_varying']} ever varied"
            )
            print(f"    review by slot  {', '.join(f'{k}:{v:.0%}' for k, v in row['review_by_slot'].items())}")
            for what in ("arm_on_fresh", "arm_on_repeat"):
                arms = row[what]
                seen = sum(arms.values())
                if seen:
                    print(f"    {what:15} {arms['control']}/{seen} control = {arms['control'] / seen:.1%}")

        db.session.rollback()


if __name__ == "__main__":
    main()
