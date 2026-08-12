"""How much Reading Comprehension a fresh practice budget can actually reach.

Report-only. Companion to `interleaving_probe.py`, which measures whole sessions
through `create_study_session`; this one measures the narrower question the
interleaving audit's §1.4 table asks, by calling `select_random_questions`
directly at a range of fresh budgets. The audit took that table with "a handful
of lines over `select_random_questions`" and did not keep the script, so this is
that script, written down so the before-and-after can be compared on the same
instrument.

Point it at a *copy* of a database. Selection itself writes nothing, but the
cohort setup does.

    cp /tmp/ilaudit/audit.db /tmp/ilaudit/probe.db
    DATABASE_URL=sqlite:////tmp/ilaudit/probe.db \
      .venv/bin/python tools/audit/rc_reachability_probe.py --runs 40

Two things are reported per budget, because they answer different questions:

* **RC share** — of everything selected across all runs, how much was Reading
  Comprehension. This is the volume number, against a bank that is 34.4% RC.
* **runs containing any RC** — how many individual runs had at least one RC
  question. A student experiences this one. A 20% share delivered as "one run in
  five is entirely RC" is a different product from "every run is a fifth RC",
  and only the second is interleaving.

The fresh budget is not the sitting size. `create_study_session` asks the review
scheduler for `session_size // 2` first and passes the remainder here, so a
six-question sitting has a fresh budget of 3 as soon as the student has a review
queue — which is from about their tenth answered question onward.

Two measurements are reported, and the second is the one that answers the
question now:

* **by fresh budget** — the audit's §1.4 table, `select_random_questions`
  called directly. This is a measurement of the general filler, and it does not
  improve when Reading Comprehension is given a case shape of its own, because
  the filler is not where RC comes from any more. It is kept because a
  regression here would still matter: it is what a type-filtered drill uses.
* **by case** — whole runs built through `create_study_session`, which is what
  a student is actually served. This is where a case-shaped section shows up.

Cohorts match `interleaving_probe.py`: a cold account, and one with enough
history that the review queue is non-empty, since the defect only bites once
there is a queue.
"""

from __future__ import annotations

import argparse
import os
import random
import statistics
import sys
from collections import Counter
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
from app import services  # noqa: E402

RC = "Reading Comprehension"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=40, help="calls per budget (the audit used 40)")
    parser.add_argument("--cases", type=int, default=200, help="whole runs built per cohort")
    parser.add_argument("--size", type=int, default=6, help="requested sitting size")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--budgets",
        type=int,
        nargs="+",
        default=[2, 3, 5, 6, 7, 10, 12],
        help="fresh budgets to probe",
    )
    return parser.parse_args()


def bank_shape() -> tuple[int, float, dict[int, int]]:
    """Bank size, RC share of it, and the passage-size histogram.

    The histogram is the reason the share is what it is, so it is printed with
    it rather than left in a document somebody has to go and find.
    """
    total = Question.query.filter(Question.source.like(f"{services.SOURCE_PREFIX}%")).count()
    rc = (
        Question.query.filter(Question.source.like(f"{services.SOURCE_PREFIX}%"))
        .filter(Question.section == RC)
        .count()
    )
    sizes = Counter()
    for (passage_id,) in (
        db.session.query(Question.passage_id)
        .filter(Question.source.like(f"{services.SOURCE_PREFIX}%"))
        .filter(Question.passage_id.isnot(None))
    ):
        sizes[passage_id] += 1
    return total, rc / total, Counter(sizes.values())


def probe(budget: int, runs: int) -> dict:
    rc_questions = 0
    total_questions = 0
    runs_with_rc = 0
    lengths = []
    for _ in range(runs):
        selected = services.select_random_questions(budget)
        rc = sum(1 for question in selected if question.section == RC)
        rc_questions += rc
        total_questions += len(selected)
        runs_with_rc += rc > 0
        lengths.append(len(selected))
    return {
        "budget": budget,
        "rc_share": rc_questions / max(1, total_questions),
        "runs_with_rc": runs_with_rc,
        "runs": runs,
        "mean_length": statistics.mean(lengths),
        "max_length": max(lengths),
    }


def make_student(label: str) -> User:
    """Same setup as `interleaving_probe.make_student`, so cohorts are comparable."""
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


def give_history(user: User, answered: int, wrong_share: float = 0.4) -> None:
    """Answer `answered` questions so the review queue is non-empty.

    Written straight to the tables, as `interleaving_probe` does: this is about
    the state the sequencer reads, and going through submission would drag in
    coaching, the economy and the job queue.

    Deliberately drawn across the *whole* bank rather than through the selector,
    so the history is section-representative. A history built by the selector
    would be all Logical Reasoning, which would hide whether Reading
    Comprehension review cards can come back at all.
    """
    # Sampled at random across the whole bank rather than off the top of it.
    # The rows arrive in seed order, which is every Logical Reasoning file and
    # then every Reading Comprehension one, so a `LIMIT` produces a history with
    # no RC in it — and a queue with no RC cards cannot show whether RC cards
    # come back, which is half of what this measures.
    ids = [
        question_id
        for (question_id,) in db.session.query(Question.id).filter(
            Question.source.like(f"{services.SOURCE_PREFIX}%")
        )
    ]
    random.shuffle(ids)
    questions = Question.query.filter(Question.id.in_(ids[:answered])).all()
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
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"rc-audit-{user.id}-{position}",
                selected_label=question.correct_answer if correct else "A",
                is_correct=correct,
                server_elapsed_ms=120_000,
                confidence=3,
            )
        )
        db.session.add(ReviewQueueItem(user_id=user.id, question_id=question.id))
    db.session.commit()


def play_in(user: User, cases: int, size: int, wrong_share: float = 0.4) -> None:
    """Answer `cases` runs built by the selector, so the queue is what play makes it.

    Answers are written straight to the tables for the same reason
    `give_history` does it: submission would drag in coaching, the economy and
    the job queue, none of which the sequencer reads.
    """
    for _ in range(cases):
        for stale in services.list_resumable_sessions(user):
            stale.status = "abandoned"
        db.session.commit()
        session = services.create_study_session(user, count=size)
        items = (
            SessionItem.query.filter_by(session_id=session.id).order_by(SessionItem.position).all()
        )
        for item in items:
            correct = random.random() > wrong_share
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"rc-play-{item.id}",
                    selected_label="A",
                    is_correct=correct,
                    server_elapsed_ms=120_000,
                    confidence=3,
                )
            )
            if not correct and not ReviewQueueItem.query.filter_by(
                user_id=user.id, question_id=item.question_id
            ).first():
                db.session.add(ReviewQueueItem(user_id=user.id, question_id=item.question_id))
        session.status = "completed"
        db.session.commit()


def probe_cases(user: User, cases: int, size: int) -> dict:
    """What whole runs actually contain, built through the real entry point."""
    rc_questions = 0
    total_questions = 0
    runs_with_rc = 0
    review_questions = 0
    rc_review = 0
    lengths = []
    seen_before = {
        question_id
        for (question_id,) in db.session.query(SessionItem.question_id)
        .join(Attempt, Attempt.session_item_id == SessionItem.id)
        .filter(Attempt.user_id == user.id)
    }
    for _ in range(cases):
        for stale in services.list_resumable_sessions(user):
            stale.status = "abandoned"
        db.session.commit()

        session = services.create_study_session(user, count=size)
        items = (
            SessionItem.query.filter_by(session_id=session.id).order_by(SessionItem.position).all()
        )
        sections = {
            question_id: section
            for question_id, section in db.session.query(Question.id, Question.section).filter(
                Question.id.in_([item.question_id for item in items])
            )
        }
        rc = sum(1 for item in items if sections[item.question_id] == RC)
        rc_questions += rc
        total_questions += len(items)
        runs_with_rc += rc > 0
        lengths.append(len(items))
        for item in items:
            if item.question_id in seen_before:
                review_questions += 1
                rc_review += sections[item.question_id] == RC
        session.status = "abandoned"
        db.session.commit()
    return {
        "rc_share": rc_questions / max(1, total_questions),
        "runs_with_rc": runs_with_rc,
        "cases": cases,
        "mean_length": statistics.mean(lengths),
        "shortest": min(lengths),
        "longest": max(lengths),
        "review_per_run": review_questions / cases,
        "rc_review_share": rc_review / max(1, review_questions),
    }


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    app = create_app()
    with app.app_context():
        total, rc_share, passage_sizes = bank_shape()
        print(f"bank: {total} eligible questions, {rc_share:.1%} Reading Comprehension")
        print(
            "passage sizes: "
            + ", ".join(f"{size}x{count}" for size, count in sorted(passage_sizes.items()))
        )
        print(f"\n{args.runs} calls to select_random_questions per budget\n")
        head = f"{'fresh budget':>13} {'RC share':>10} {'runs with any RC':>18} {'q/run':>8} {'longest':>8}"
        print(head)
        print("-" * len(head))
        for budget in args.budgets:
            row = probe(budget, args.runs)
            print(
                f"{row['budget']:>13} {row['rc_share']:>9.1%} "
                f"{f'{row['runs_with_rc']} of {row['runs']}':>18} "
                f"{row['mean_length']:>8.2f} {row['max_length']:>8}"
            )
        print(f"\nfor reference, the bank is {rc_share:.1%} Reading Comprehension")

        print(f"\n\n{args.cases} runs of size {args.size} built through create_study_session\n")
        head = (
            f"{'cohort':<22} {'RC share':>9} {'runs with any RC':>18} {'q/run':>8} "
            f"{'range':>8} {'rev/run':>8} {'RC of rev':>10}"
        )
        print(head)
        print("-" * len(head))
        cohorts = [("cold (0 answered)", make_student("cold"), None)]
        mid = make_student("mid")
        give_history(mid, 60)
        cohorts.append(("mid (60 answered)", mid, None))
        # A student whose history was produced by the selector rather than by a
        # random draw over the bank. This is the one that says whether the
        # design is stable under its own output, and it is the only cohort whose
        # review queue has the shape real play produces — Reading Comprehension
        # cards clustered several to a passage, because a passage is served
        # whole, rather than scattered one apiece across sixty passages.
        warmed = make_student("warmed")
        cohorts.append(("warmed (played in)", warmed, "play"))
        for label, user, warm in cohorts:
            if warm:
                play_in(user, args.cases, args.size)
            row = probe_cases(user, args.cases, args.size)
            print(
                f"{label:<22} {row['rc_share']:>8.1%} "
                f"{f'{row['runs_with_rc']} of {row['cases']}':>18} {row['mean_length']:>8.2f} "
                f"{f'{row['shortest']}-{row['longest']}':>8} {row['review_per_run']:>8.2f} "
                f"{row['rc_review_share']:>9.1%}"
            )
        print(
            f"\ntarget is the bank's own {rc_share:.1%}; see services.RC_CASE_SHARE for why "
            "a third of cases is the setting that produces it"
        )
        db.session.rollback()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
