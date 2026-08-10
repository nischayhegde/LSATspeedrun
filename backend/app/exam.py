"""The mega-litigation as an actual LSAT administration.

Until now the full-length form was one continuous run under one whole-form
countdown, answered strictly in order, with no way back to a question once it
was submitted. That is not what sitting an LSAT is. This module makes the form
a sequence of separately timed sections and gives the server the only clock
that counts.

What the real test does, and what is modelled here
--------------------------------------------------

The 2026-2027 LSAT is "four (4) separately timed, thirty-five (35) minute
sections" — two scored Logical Reasoning, one scored Reading Comprehension, and
one unscored variable section that is indistinguishable from the rest (LSAC,
*Specifications of the LSAT*; *FAQ § Test Format and Test Sections*). This form
omits the variable section on instruction, so it runs the three scored ones:
Logical Reasoning, Reading Comprehension, Logical Reasoning. There is no Logic
Games section on the current test and none in this bank, so nothing is missing.

Three rules from the Candidate Agreement (2026-2027, § 15) are what this module
exists to enforce:

* "During the time allotted for each section of the Test, you may work only on
  that section of the Test." — a student cannot reach into a section that has
  not started or one that has finished.
* "Once time expires for each section of the Test, you must stop working and no
  additional inputs may be made." — a section ends hard. What is blank at the
  bell stays blank.
* Within the running section, the student may move freely: the test interface
  has a question bar, a flag, and a five-minute warning, and answers may be
  changed until the bell. Free navigation is part of the test, not a courtesy.

"The LSAT includes a 10-minute intermission between the second and third
sections" (LSAC FAQ), so this form does too — after its own second section,
which is where LSAC puts it.

Where this deliberately departs
-------------------------------

**A section must be started, not merely arrived at.** On test day a proctor
starts the next section and a student who wanders off has their session
terminated. Auto-starting section three ten minutes after section two would
mean a student who shut a laptop returns to a 0-of-25 section, which is not a
measurement of anything. So the next section is *armed* and waits for a click.
Once clicked it cannot be stopped, which is the property that matters.

**A boundary does not wait forever.** A form left sitting at a section boundary
past `BOUNDARY_GRACE_SECONDS` is closed out, its remaining sections recorded as
abandoned with every question blank. Without this, "one sitting" would be a
label rather than a fact, and a form started on Monday and finished on Friday
would enter the score projection as though it were a timed administration.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .extensions import db
from .models import Attempt, SessionItem, SessionSection, StudySession, utcnow

# Every section on the real test is thirty-five minutes regardless of how many
# questions it holds (LR sections run 24-26, RC 26-28). The budget is a
# property of the section, not of its length, so it is not pro-rated here
# either.
SECTION_SECONDS = 35 * 60
INTERMISSION_SECONDS = 10 * 60
# Zero-based: the break falls after the second section, as LSAC specifies.
INTERMISSION_AFTER_SECTION = 1
# The test interface warns at five minutes. The client renders it; this is the
# threshold it is handed so the two never disagree.
WARNING_SECONDS = 5 * 60
# How long a form may sit at a section boundary before the sitting is over.
# Generous enough to absorb a lost connection, a dead battery, or a student who
# takes twenty minutes over a ten-minute break; short enough that the run is
# still recognisably one sitting.
BOUNDARY_GRACE_SECONDS = 60 * 60

STAGE_AWAITING = "awaiting_section"
STAGE_IN_SECTION = "in_section"
STAGE_INTERMISSION = "intermission"
STAGE_COMPLETED = "completed"

REASON_SUBMITTED = "submitted"
REASON_EXPIRED = "expired"
REASON_ABANDONED = "abandoned"


class ExamError(ValueError):
    """A request that the administration's own rules refuse."""


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _ms_between(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds() * 1000))


# --- Reading the form's state -------------------------------------------------


def is_sectioned(session: StudySession) -> bool:
    """Whether this run is administered as sections.

    False for practice, for blind reviews, and for mega-litigations created
    before this existed — those keep the single whole-form deadline they were
    started under. A student mid-form when this ships finishes the form they
    began, which is the only honest way to change the rules of a timed test.
    """
    if session.mode != "diagnostic":
        return False
    return bool(session.sections)


def sections_of(session: StudySession) -> list[SessionSection]:
    return sorted(session.sections, key=lambda section: section.section_index)


def active_section(session: StudySession) -> SessionSection | None:
    for section in sections_of(session):
        if section.status == "in_progress":
            return section
    return None


def next_pending_section(session: StudySession) -> SessionSection | None:
    for section in sections_of(session):
        if section.status == "pending":
            return section
    return None


def section_of_position(session: StudySession, position: int) -> SessionSection | None:
    for section in sections_of(session):
        if section.start_position <= position <= section.end_position:
            return section
    return None


def intermission_ends_at(session: StudySession) -> datetime | None:
    started = _aware(session.intermission_started_at)
    if not started:
        return None
    closed = [section for section in sections_of(session) if section.break_seconds and section.ended_at]
    seconds = closed[-1].break_seconds if closed else INTERMISSION_SECONDS
    return started + timedelta(seconds=seconds)


def boundary_ready_at(session: StudySession) -> datetime | None:
    """When the next section became — or becomes — startable.

    Also the instant the abandonment grace period starts counting from, which
    is why an unstarted form counts from its creation: a form nobody ever began
    is a boundary like any other.
    """
    if active_section(session) or not next_pending_section(session):
        return None
    ends = intermission_ends_at(session)
    if ends:
        return ends
    closed = [section for section in sections_of(session) if section.ended_at]
    if closed:
        return _aware(closed[-1].ended_at)
    return _aware(session.started_at)


def stage(session: StudySession) -> str:
    if session.status == "completed":
        return STAGE_COMPLETED
    if active_section(session):
        return STAGE_IN_SECTION
    ends = intermission_ends_at(session)
    if ends and utcnow() < ends and next_pending_section(session):
        return STAGE_INTERMISSION
    return STAGE_AWAITING


def remaining_ms(session: StudySession) -> int | None:
    """Milliseconds left on whichever clock is currently running.

    The section's, while one is running; the intermission's, during the break;
    None at a boundary that is waiting on the student, because nothing there is
    counting down against them.
    """
    section = active_section(session)
    if section and section.deadline_at:
        return _ms_between(utcnow(), _aware(section.deadline_at))
    if stage(session) == STAGE_INTERMISSION:
        return _ms_between(utcnow(), intermission_ends_at(session))
    return None


# --- Building the form --------------------------------------------------------


def build_sections(session: StudySession, plan: list[dict], *, multiplier: float = 1.0) -> list[SessionSection]:
    """Lay a form's blocks out as separately timed sections.

    `plan` is what `select_diagnostic_questions` already produces: contiguous
    blocks with a label, a start and an end, RC passages kept whole inside
    theirs. All this adds is a clock on each one and a break after the second.
    """
    rows: list[SessionSection] = []
    last_index = len(plan) - 1
    for order, block in enumerate(plan):
        breaks = (
            INTERMISSION_SECONDS
            if order == INTERMISSION_AFTER_SECTION and order < last_index
            else 0
        )
        rows.append(
            SessionSection(
                session_id=session.id,
                section_index=int(block["index"]),
                label=str(block["label"]),
                section_type=(
                    "Reading Comprehension"
                    if "Reading" in str(block["label"])
                    else "Logical Reasoning"
                ),
                start_position=int(block["start"]),
                end_position=int(block["end"]),
                question_count=int(block["questions"]),
                time_limit_seconds=max(60, round(SECTION_SECONDS * multiplier)),
                break_seconds=round(breaks * multiplier),
            )
        )
    for row in rows:
        db.session.add(row)
    return rows


def section_target_seconds(section: SessionSection) -> int:
    """The even split of one section's clock across its own questions.

    What "on pace" means inside a section, and the number the results screen
    measures each question against. It is honest in a way the old whole-form
    split was not: a student who spends four minutes on an RC question has
    overspent that *section's* budget, which is the budget that can actually
    run out on them.
    """
    return max(30, round(section.time_limit_seconds / max(1, section.question_count)))


# --- Running the clock --------------------------------------------------------


def _bank_item_time(item: SessionItem | None, at: datetime) -> None:
    """Stop an item's timer and keep what it measured.

    `at` is never "now" blindly: when a section expired unattended, the time
    that counts stops at the bell rather than at whenever somebody next
    happened to load the page.
    """
    if not item or not item.timer_started_at:
        return
    item.active_elapsed_ms = (item.active_elapsed_ms or 0) + _ms_between(_aware(item.timer_started_at), at)
    item.timer_started_at = None
    item.paused_at = None


def _current_item(session: StudySession) -> SessionItem | None:
    return SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()


def _move_cursor(session: StudySession, position: int, now: datetime) -> None:
    """Bank the question being left and start the one being arrived at.

    The clock moves here rather than in serialization because under free
    navigation a move is a request in its own right: waiting for the next read
    to start a timer would give away however long the round trip took, on every
    hop, and a student who bounces between four questions would be credited
    with less time than they spent.
    """
    if position == session.current_index:
        current = _current_item(session)
        if current and not current.timer_started_at and not current.completed_at:
            current.timer_started_at = now
            current.timer_activated_at = current.timer_activated_at or now
        return
    _bank_item_time(_current_item(session), now)
    session.current_index = position
    arriving = _current_item(session)
    if arriving and not arriving.completed_at:
        arriving.served_at = arriving.served_at or now
        arriving.timer_activated_at = arriving.timer_activated_at or now
        arriving.timer_started_at = now
        arriving.paused_at = None


def _items_of(section: SessionSection) -> list[SessionItem]:
    return (
        SessionItem.query.filter(
            SessionItem.session_id == section.session_id,
            SessionItem.position >= section.start_position,
            SessionItem.position <= section.end_position,
        )
        .order_by(SessionItem.position.asc())
        .all()
    )


def start_section(session: StudySession, section_index: int) -> SessionSection:
    """Begin a section's thirty-five minutes. There is no way to stop them."""
    if session.status != "in_progress":
        raise ExamError("session_complete")
    if active_section(session):
        raise ExamError("section_already_running")
    pending = next_pending_section(session)
    if not pending:
        raise ExamError("no_section_pending")
    if pending.section_index != section_index:
        # Reaching forward past a section is the thing the administration
        # forbids most plainly, so it is refused by name rather than silently
        # redirected to the section the student was owed.
        raise ExamError("section_out_of_order")
    ends = intermission_ends_at(session)
    if ends and utcnow() < ends:
        raise ExamError("intermission_in_progress")

    now = utcnow()
    pending.status = "in_progress"
    pending.started_at = now
    pending.deadline_at = now + timedelta(seconds=pending.time_limit_seconds)
    session.intermission_started_at = None
    # Mirrored onto the session so every existing read path — routing, the
    # resumable-session list, serialization — keeps seeing one field that means
    # "the clock this run is under". The section row is the authority; this is
    # written here and in `close_section`, nowhere else.
    session.deadline_at = pending.deadline_at
    session.current_index = pending.start_position
    _move_cursor(session, pending.start_position, now)
    db.session.commit()
    return pending


def close_section(section: SessionSection, *, reason: str, at: datetime | None = None) -> None:
    """End a section permanently and mark its answer sheet.

    Everything the student put on the sheet becomes an attempt here, all at
    once, which is the moment the form is allowed to know whether they were
    right. Everything they left blank stays blank: it is recorded as an
    unanswered question rather than as a wrong answer, because that is what it
    is, and the form score already counts blanks against the total.
    """
    # Imported here rather than at module scope: `services` owns grading and
    # imports this module for the clock, so the dependency runs one way at
    # import time and both ways only while a section is being closed.
    from .services import finalize_diagnostic, grade_exam_answer

    session = section.session
    if section.status == "completed":
        return
    deadline = _aware(section.deadline_at)
    ended_at = at or utcnow()
    if deadline and ended_at > deadline:
        ended_at = deadline

    items = _items_of(section)
    current = _current_item(session)
    if current and section.start_position <= current.position <= section.end_position:
        _bank_item_time(current, ended_at)
    for item in items:
        # Belt and braces: an item the student navigated away from already had
        # its time banked, but a crash between navigation and commit would
        # otherwise leave a timer running forever.
        _bank_item_time(item, ended_at)

    unanswered = 0
    for item in items:
        item.completed_at = item.completed_at or ended_at
        if item.draft_selected_label:
            grade_exam_answer(session, item, ended_at=ended_at)
        else:
            unanswered += 1

    section.status = "completed"
    section.ended_at = ended_at
    section.ended_reason = reason
    section.unanswered_count = unanswered
    session.deadline_at = None

    following = next_pending_section(session)
    if following and section.break_seconds:
        session.intermission_started_at = ended_at
    if following:
        session.current_index = following.start_position
        db.session.commit()
        return

    session.current_index = session.total_items
    db.session.commit()
    finalize_diagnostic(session, completed_at=ended_at)


def _abandon_remaining(session: StudySession, at: datetime) -> None:
    """Close out a sitting that was walked away from at a boundary."""
    pending = [section for section in sections_of(session) if section.status == "pending"]
    for section in pending:
        for item in _items_of(section):
            item.completed_at = item.completed_at or at
        section.status = "completed"
        section.ended_at = at
        section.ended_reason = REASON_ABANDONED
        section.unanswered_count = section.question_count
    session.deadline_at = None
    session.intermission_started_at = None
    session.current_index = session.total_items
    session.ended_by_user = False
    db.session.commit()

    from .services import finalize_diagnostic

    finalize_diagnostic(session, completed_at=at)


def enforce_exam_clock(session: StudySession) -> bool:
    """Bring a form up to date with the wall clock. Returns True if it is over.

    Called at the top of every path that can touch a mega-litigation, which is
    what makes the clock server-authoritative rather than advisory: a section
    that expired while the tab was shut is already closed by the time the next
    request can see it, and nothing sweeps in the background to make that true.
    """
    if not is_sectioned(session) or session.status == "completed":
        return session.status == "completed"

    now = utcnow()
    running = active_section(session)
    if running and running.deadline_at and _aware(running.deadline_at) <= now:
        close_section(running, reason=REASON_EXPIRED, at=_aware(running.deadline_at))
        if session.status == "completed":
            return True

    ready = boundary_ready_at(session)
    if ready and now > ready + timedelta(seconds=BOUNDARY_GRACE_SECONDS):
        _abandon_remaining(session, ready + timedelta(seconds=BOUNDARY_GRACE_SECONDS))
        return True
    return session.status == "completed"


def submit_section(session: StudySession, section_index: int) -> SessionSection:
    """End a section early, at the student's own hand. Identical in effect to the bell."""
    if enforce_exam_clock(session):
        raise ExamError("session_complete")
    running = active_section(session)
    if not running:
        raise ExamError("no_section_running")
    if running.section_index != section_index:
        raise ExamError("section_not_running")
    close_section(running, reason=REASON_SUBMITTED)
    return running


# --- Working inside a section -------------------------------------------------


def _writable_item(session: StudySession, item_id: str) -> tuple[SessionSection, SessionItem]:
    running = active_section(session)
    if not running:
        raise ExamError("no_section_running")
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if not item:
        raise ExamError("invalid_session_item")
    if not (running.start_position <= item.position <= running.end_position):
        raise ExamError("item_outside_active_section")
    return running, item


def focus_item(session: StudySession, position: int) -> SessionItem:
    """Move the student to another question in the section they are in.

    Banking the question they are leaving is the whole point: per-question time
    is only meaningful under free navigation if every visit is measured, and a
    question returned to three times should read as the sum of the three.
    """
    if enforce_exam_clock(session):
        raise ExamError("session_complete")
    running = active_section(session)
    if not running:
        raise ExamError("no_section_running")
    if not (running.start_position <= position <= running.end_position):
        raise ExamError("item_outside_active_section")
    _move_cursor(session, position, utcnow())
    db.session.commit()
    return _current_item(session)


def section_papers(session: StudySession) -> list[dict]:
    """Every question in the running section, handed over in one go.

    A student on the real test has the whole section in front of them and turns
    to any question in it instantly. Fetching one question per hop would make
    going back to check number four a network round trip on a clock that is
    running — the navigation would cost time the administration does not charge.
    So the section is delivered when it starts and the client renders locally.

    Only the running section, and only while it is running: a section that has
    not begun is not something the student is allowed to have read yet, which is
    the rule this endpoint exists to keep rather than to work around.
    """
    from .services import serialize_question

    running = active_section(session)
    if not running:
        raise ExamError("no_section_running")
    return [
        {
            "id": item.id,
            "position": item.position,
            "number": item.position - running.start_position + 1,
            "selected_label": item.draft_selected_label,
            "flagged": bool(item.flagged),
            "target_time_seconds": item.target_time_seconds,
            "question": serialize_question(item.question),
        }
        for item in _items_of(running)
    ]


def record_answer(
    session: StudySession,
    item_id: str,
    *,
    selected_label: str | None,
    flagged: bool | None = None,
) -> SessionItem:
    """Write an answer onto the sheet, or take one off it.

    Nothing is graded here and nothing is final. A real section is a sheet the
    student fills in and revises until the bell; grading happens once, when the
    section closes, which is also the only reason the app can hold answers back
    without pretending to.
    """
    if enforce_exam_clock(session):
        raise ExamError("session_complete")
    running, item = _writable_item(session, item_id)
    if selected_label is not None:
        label = str(selected_label).strip().upper()
        if label and label not in {choice.label for choice in item.question.choices}:
            raise ExamError("invalid_choice")
        label = label or None
        if item.draft_selected_label and label and label != item.draft_selected_label:
            item.answer_revisions = (item.answer_revisions or 0) + 1
        item.draft_selected_label = label
        item.draft_updated_at = utcnow()
    if flagged is not None:
        item.flagged = bool(flagged)
    # Answering is also a navigation: the student is demonstrably on this
    # question, so it is where the clock should be pointing.
    _move_cursor(session, item.position, utcnow())
    db.session.commit()
    return item


# --- Reporting ----------------------------------------------------------------


def serialize_section(section: SessionSection) -> dict:
    from .services import _iso_utc

    return {
        "index": section.section_index,
        "label": section.label,
        "section_type": section.section_type,
        "questions": section.question_count,
        "start_position": section.start_position,
        "end_position": section.end_position,
        "time_limit_seconds": section.time_limit_seconds,
        "break_seconds": section.break_seconds,
        "status": section.status,
        "started_at": _iso_utc(section.started_at),
        "deadline_at": _iso_utc(section.deadline_at),
        "ended_at": _iso_utc(section.ended_at),
        "ended_reason": section.ended_reason,
        "unanswered": section.unanswered_count,
        "target_time_seconds": section_target_seconds(section),
    }


def answer_sheet(session: StudySession, section: SessionSection) -> list[dict]:
    """What the question bar draws: answered, flagged, nothing else.

    Deliberately silent on correctness. Nothing in a running section knows
    whether an answer is right, and nothing after it does either until the
    blind review releases the key.
    """
    return [
        {
            "position": item.position,
            "item_id": item.id,
            "number": item.position - section.start_position + 1,
            "answered": bool(item.draft_selected_label),
            "flagged": bool(item.flagged),
            "passage_id": item.question.passage_id,
        }
        for item in _items_of(section)
    ]


def section_report(session: StudySession) -> list[dict]:
    """Per-section facts a sitting produced, keyed to the section that produced them.

    Every rate here is over the section's *whole* question count rather than
    over the ones that got answered. On a timed section a blank is a result,
    not a missing observation: a student who answers twelve of twenty-five
    perfectly did not score 100%, and the number that hides that is the number
    that stops them fixing it.
    """
    reports = []
    for section in sections_of(session):
        items = _items_of(section)
        attempts = {item.position: item.attempt for item in items if item.attempt}
        answered = len(attempts)
        correct = sum(1 for attempt in attempts.values() if attempt.is_correct)
        elapsed_ms = sum(item.active_elapsed_ms or 0 for item in items)
        started, ended = _aware(section.started_at), _aware(section.ended_at)
        used_seconds = round((ended - started).total_seconds()) if started and ended else None
        half = len(items) // 2 or len(items)
        opening = [item for item in items if item.position - section.start_position < half]
        closing = [item for item in items if item.position - section.start_position >= half]

        def scored(rows: list[SessionItem]) -> int:
            return sum(1 for row in rows if row.attempt and row.attempt.is_correct)

        reports.append(
            {
                "index": section.section_index,
                "label": section.label,
                "section_type": section.section_type,
                "questions": section.question_count,
                "answered": answered,
                "unanswered": section.question_count - answered,
                "correct": correct,
                # Over the whole section, blanks included. See the docstring.
                "accuracy": round(100 * correct / max(1, section.question_count)),
                # Over what was actually attempted, so a student can see
                # whether running out of time or being wrong cost them more.
                "answered_accuracy": round(100 * correct / max(1, answered)) if answered else None,
                "time_limit_seconds": section.time_limit_seconds,
                "seconds_used": used_seconds,
                "seconds_on_questions": round(elapsed_ms / 1000),
                "ended_reason": section.ended_reason,
                "ran_out_of_time": section.ended_reason == REASON_EXPIRED,
                "flagged": sum(1 for item in items if item.flagged),
                "flagged_unanswered": sum(1 for item in items if item.flagged and not item.attempt),
                "answers_changed": sum(1 for item in items if (item.answer_revisions or 0) > 0),
                # Where inside the section the wheels came off. Both halves are
                # scored over their own whole length, so a collapse caused by
                # the clock reads as a collapse rather than as missing data.
                "opening": {"questions": len(opening), "correct": scored(opening)},
                "closing": {"questions": len(closing), "correct": scored(closing)},
            }
        )
    return reports


def exam_summary(session: StudySession) -> dict:
    """The whole administration's shape, for the results screen and the dashboard."""
    reports = section_report(session)
    return {
        "administered": True,
        "sections": reports,
        "unanswered": sum(report["unanswered"] for report in reports),
        "sections_expired": sum(1 for report in reports if report["ran_out_of_time"]),
        "sections_abandoned": sum(
            1 for section in sections_of(session) if section.ended_reason == REASON_ABANDONED
        ),
        "flagged_unanswered": sum(report["flagged_unanswered"] for report in reports),
        "answers_changed": sum(report["answers_changed"] for report in reports),
    }


def serialize_exam(session: StudySession) -> dict:
    """The administration's state, as the client is allowed to see it."""
    from .services import _iso_utc

    running = active_section(session)
    pending = next_pending_section(session)
    current_stage = stage(session)
    payload = {
        "stage": current_stage,
        "sections": [serialize_section(section) for section in sections_of(session)],
        "active_section_index": running.section_index if running else None,
        "next_section_index": pending.section_index if pending else None,
        "remaining_ms": remaining_ms(session),
        "warning_seconds": WARNING_SECONDS,
        "intermission_ends_at": _iso_utc(intermission_ends_at(session)),
        "boundary_expires_at": None,
        "answered": Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .count(),
        "answer_sheet": answer_sheet(session, running) if running else [],
    }
    ready = boundary_ready_at(session)
    if ready and current_stage in {STAGE_AWAITING, STAGE_INTERMISSION}:
        payload["boundary_expires_at"] = _iso_utc(ready + timedelta(seconds=BOUNDARY_GRACE_SECONDS))
    if running:
        payload["answered"] = sum(
            1 for item in _items_of(running) if item.draft_selected_label
        ) + Attempt.query.join(SessionItem).filter(
            SessionItem.session_id == session.id,
            SessionItem.position < running.start_position,
        ).count()
    return payload
