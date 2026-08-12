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
from app import scheduling, services  # noqa: E402

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
    parser.add_argument(
        "--sizes",
        type=int,
        nargs="+",
        default=list(range(1, 13)),
        help="run sizes to sweep, so the reachability boundary is visible rather than assumed",
    )
    parser.add_argument(
        "--sweep-cases",
        type=int,
        default=60,
        help="runs built per cohort per size in the sweep",
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
            attempt = Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"rc-play-{item.id}",
                selected_label="A",
                is_correct=correct,
                server_elapsed_ms=120_000,
                confidence=3,
            )
            db.session.add(attempt)
            card = ReviewQueueItem.query.filter_by(
                user_id=user.id, question_id=item.question_id
            ).first()
            if card is not None:
                # The state transition the app performs on every graded answer
                # to a queued question. Skipping it — which this probe did at
                # first — means no card is ever recalled, every card's
                # retrievability decays to zero, and the queue reads as 281 of
                # 281 overdue no matter how the student is doing. Any signal
                # taken off the queue is then measured against a student who
                # cannot exist.
                attempt.session_item = item
                services._advance_review(card, attempt)
            elif not correct:
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
    seconds = 0
    lengths = []
    # Per-position review rate and per-run RC share. Both are distributions, and
    # both are reported as distributions rather than means, because the two
    # failures worth catching here are invisible in an average: a position that
    # is always a repeat, and a student whose section mix has collapsed.
    review_at_slot = Counter()
    runs_at_slot = Counter()
    rc_counts_per_run = []
    review_per_run_counts = []
    profiles = []
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
        # The pace budget the run was actually written with, rather than a
        # model of it. `_target_time_seconds` charges 330s for the first
        # question on a passage, 135s for each one after it and 150s for a
        # Logical Reasoning question, so this is the whole of what the section
        # mix costs in wall-clock time.
        seconds += sum(item.target_time_seconds for item in items)
        rc_counts_per_run.append(rc)
        in_run = 0
        for item in items:
            # `from_review_queue` is what the run itself recorded, which is the
            # flag the rest of the app reads. Falling back to "have they ever
            # answered this" would also count a reading case's own passage-mates,
            # which are not review slots in any sense a student could learn.
            # Argument cases only. A reading case is one passage served in the
            # passage's own order and has no review *slots* to speak of, so
            # folding it into this histogram averages two different things and
            # hides the one that can carry a positional cue.
            if rc == 0:
                runs_at_slot[item.position] += 1
                review_at_slot[item.position] += item.from_review_queue
            in_run += item.from_review_queue
            if item.question_id in seen_before:
                review_questions += 1
                rc_review += sections[item.question_id] == RC
        review_per_run_counts.append(in_run)
        session.status = "abandoned"
        db.session.commit()

    # Absent on any revision before run sequencing was personalised, which is
    # how this probe is pointed at the previous behaviour to get a baseline.
    profile = getattr(services, "sequencing_profile", None)
    profile = profile(user.id, size) if profile else None
    profiles.append(profile)
    return {
        "rc_share": rc_questions / max(1, total_questions),
        "runs_with_rc": runs_with_rc,
        "cases": cases,
        "mean_length": statistics.mean(lengths),
        "shortest": min(lengths),
        "longest": max(lengths),
        "review_per_run": review_questions / cases,
        "rc_review_share": rc_review / max(1, review_questions),
        "seconds_per_question": seconds / max(1, total_questions),
        "minutes_per_run": seconds / cases / 60,
        "profile": profile,
        "flagged_review_per_run": statistics.mean(review_per_run_counts),
        "slot_review_rate": {
            slot: review_at_slot[slot] / runs_at_slot[slot] for slot in sorted(runs_at_slot)
        },
        "rc_share_windows": _windows(rc_counts_per_run, lengths),
    }


WINDOW = 20


def _windows(rc_counts: list[int], lengths: list[int]) -> list[float]:
    """RC share over each consecutive stretch of WINDOW runs.

    The distribution, not the mean, because a mean of a third could hide a
    student who sees almost no reading.

    Measured over stretches of twenty runs rather than over single runs. A
    single run is now entirely one section or entirely the other, by design, so
    its RC share is 0% or 100% and the spread of that says nothing. Twenty runs
    is about a week of ordinary play, which is the shortest window over which
    "how much reading am I getting" is a question a student could actually ask.
    """
    shares = []
    for start in range(0, len(rc_counts) - WINDOW + 1, WINDOW):
        window_rc = sum(rc_counts[start : start + WINDOW])
        window_total = sum(lengths[start : start + WINDOW])
        shares.append(window_rc / max(1, window_total))
    return shares or [sum(rc_counts) / max(1, sum(lengths))]


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
            f"{'range':>8} {'rev/run':>8} {'RC of rev':>10} {'s/q':>7} {'min/run':>8}"
        )
        print(head)
        print("-" * len(head))
        rows = []
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
                f"{row['rc_review_share']:>9.1%} {row['seconds_per_question']:>7.1f} "
                f"{row['minutes_per_run']:>8.1f}"
            )
            rows.append((label, row))

        print("\n\nPersonalisation, per cohort. The whole point is that these differ.\n")
        for label, row in rows:
            profile = row["profile"]
            print(f"  {label}")
            if profile is None:
                print("    (this revision does not personalise; fixed shares for everyone)")
            windows = row["rc_share_windows"]
            print(
                f"    RC per {WINDOW} runs  min {min(windows):.0%}, median "
                f"{statistics.median(windows):.0%}, max {max(windows):.0%} "
                f"over {len(windows)} windows"
            )
            slots = row["slot_review_rate"]
            print(
                "    repeat by slot  "
                + ", ".join(f"{slot}:{rate:.0%}" for slot, rate in slots.items())
            )
            print(f"    flagged repairs {row['flagged_review_per_run']:.2f} a run")
            if profile is None:
                continue
            print(
                f"    signals         {profile.overdue} of {profile.tracked} cards overdue; "
                f"LR {profile.lr_accuracy:.3f} against RC {profile.rc_accuracy:.3f} "
                f"(gap {profile.lr_accuracy - profile.rc_accuracy:+.3f})"
            )
            print(
                f"    review share    {profile.review_share:.3f} "
                f"(floor {services.REVIEW_SHARE_FLOOR:.3f}, centre {services.REVIEW_SHARE:.3f}, "
                f"ceiling {services.REVIEW_SHARE_CEILING:.3f})"
            )
            print(
                f"    reading share   {profile.reading_case_share:.3f} "
                f"(default {services.RC_CASE_SHARE:.3f}, "
                f"bounds {services.RC_CASE_SHARE - services.RC_CASE_SHARE_SPREAD:.3f}"
                f"-{services.RC_CASE_SHARE + services.RC_CASE_SHARE_SPREAD:.3f})"
            )
        print(
            f"\ntarget is the bank's own {rc_share:.1%}; see services.RC_CASE_SHARE for why "
            "a third of cases is the setting that produces it"
        )

        # The boundary, measured rather than assumed. A reading case is one
        # passage, so there is some run length below which it cannot be built,
        # and the failure when that happens is silent: the run comes back the
        # right length, full of arguments, with a third of the exam missing.
        # Printing the share at every size is what makes the edge visible, and
        # `requestable` is the answer to "and can anything actually ask for it".
        minimum = getattr(services, "RC_CASE_MIN_SITTING", None)
        print(f"\n\n{args.sweep_cases} runs per cohort at each size\n")
        head = (
            f"{'size':>5} {'requestable':>12} {'cold RC':>9} {'mid RC':>9} "
            f"{'cold runs w/ RC':>17} {'mid runs w/ RC':>16} {'q/run':>8}"
        )
        print(head)
        print("-" * len(head))
        for size in args.sizes:
            cold = make_student(f"sweep-cold-{size}")
            mid_student = make_student(f"sweep-mid-{size}")
            give_history(mid_student, 60)
            cold_row = probe_cases(cold, args.sweep_cases, size)
            mid_row = probe_cases(mid_student, args.sweep_cases, size)
            # Whether the API would let anything start a general run this long.
            # A type-filtered drill is exempt at any length, because it has
            # already declared its scope and has no section to drop.
            allowed = "yes" if minimum is None or size >= minimum else "refused"
            print(
                f"{size:>5} {allowed:>12} {cold_row['rc_share']:>8.1%} {mid_row['rc_share']:>8.1%} "
                f"{f'{cold_row['runs_with_rc']} of {args.sweep_cases}':>17} "
                f"{f'{mid_row['runs_with_rc']} of {args.sweep_cases}':>16} "
                f"{cold_row['mean_length']:>8.2f}"
            )
        if minimum is not None:
            print(
                f"\nsizes below {minimum} are refused by the API and by create_app, so the 0% "
                "rows are unreachable rather than merely unlikely"
            )
        db.session.rollback()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
