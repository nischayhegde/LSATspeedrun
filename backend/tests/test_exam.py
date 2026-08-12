"""The mega-litigation administered the way the LSAT is administered.

Section timing and hard stops are exactly the kind of logic that rots without
being noticed: nothing visibly breaks when a clock quietly becomes advisory, or
when a section that should be shut turns out to be writable, or when closing a
section twice grades it twice. Each of those is a silent corruption of the one
measurement this app anchors its score projection on, so each has a test here.

Ground truth for every rule asserted below is the LSAC Candidate Agreement
(2026-2027) § 15 and the LSAC LSAT FAQ, quoted at the assertions that rest on
them.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import update

from app import create_app
from app.extensions import db
from app.models import (
    Attempt,
    Passage,
    Question,
    QuestionChoice,
    SessionItem,
    SessionSection,
    StudySession,
    User,
    utcnow,
)
from app.exam import BOUNDARY_GRACE_SECONDS
from app.seed import SOURCE_PREFIX


LR_PER_SECTION = 6
RC_PASSAGES = 2
RC_PER_PASSAGE = 3


def _add_lr(index: int) -> None:
    question_id = f"hf-lsat-lr:exam-{index}"
    db.session.add(
        Question(
            id=question_id,
            section="Logical Reasoning",
            question_type="Inference",
            difficulty=3,
            stimulus=f"Argument stimulus {index}.",
            stem=f"Which answer is best for LR question {index}?",
            correct_answer="C",
            source=f"{SOURCE_PREFIX}lr · train",
            license_status="upstream_terms_apply",
            review_status="published",
        )
    )
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label}",
                position=position,
            )
        )


def _add_rc(passage_index: int, index: int) -> None:
    passage_id = f"exam-passage-{passage_index}"
    if not db.session.get(Passage, passage_id):
        db.session.add(
            Passage(
                id=passage_id,
                canonical_text=f"Reading passage {passage_index}, long enough to carry a set.",
                passage_type="Reading Comprehension",
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
        )
    question_id = f"hf-lsat-rc:exam-{passage_index}-{index}"
    db.session.add(
        Question(
            id=question_id,
            passage_id=passage_id,
            section="Reading Comprehension",
            question_type="Main Point",
            difficulty=3,
            stimulus=None,
            stem=f"Which answer is best for RC question {passage_index}-{index}?",
            correct_answer="C",
            source=f"{SOURCE_PREFIX}rc · train",
            license_status="upstream_terms_apply",
            review_status="published",
        )
    )
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label}",
                position=position,
            )
        )


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
            # A form runs at the production default rather than with gates
            # switched off, because "a timed form arms no gate" is one of the
            # things under test and turning them off would prove it vacuously.
            "STRATEGY_ENFORCEMENT_ENABLED": True,
        }
    )
    with application.app_context():
        for index in range(LR_PER_SECTION * 2):
            _add_lr(index)
        for passage_index in range(RC_PASSAGES):
            for index in range(RC_PER_PASSAGE):
                _add_rc(passage_index, index)
        db.session.commit()
    return application


def login(client, email: str) -> dict[str, str]:
    assert client.post("/v1/auth/dev", json={"email": email, "display_name": "Sitter"}).status_code == 200
    return {"X-CSRF-Token": client.get_cookie("lsat_csrf").value}


def create_game(client, headers) -> None:
    response = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Alex Morgan", "firm_name": "Morgan Legal", "character_gender": "female"},
        headers=headers,
    )
    assert response.status_code == 201, response.json


def start_form(client, headers) -> dict:
    create_game(client, headers)
    started = client.post("/v1/diagnostics", headers=headers)
    assert started.status_code == 201, started.json
    return started.json["session"]


def read(client, headers, session_id: str) -> dict:
    return client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]


def sheet_items(form: dict) -> list[str]:
    return [entry["item_id"] for entry in form["exam"]["answer_sheet"]]


def _end_intermission(session_id: str) -> None:
    """Wind a running intermission back so the next section can be begun."""
    db.session.execute(
        update(StudySession)
        .where(StudySession.id == session_id)
        .values(intermission_started_at=utcnow() - timedelta(hours=1))
    )
    db.session.commit()


def _expire_running_section(session_id: str) -> None:
    """Move the running section's bell into the past, leaving its status alone.

    Written straight to the column so the sitting stays exactly as the student
    left it: what each caller is testing is what the *next* request does when it
    finds the clock already spent.
    """
    db.session.execute(
        update(SessionSection)
        .where(SessionSection.session_id == session_id, SessionSection.status == "in_progress")
        .values(deadline_at=utcnow() - timedelta(minutes=1))
    )
    db.session.commit()


# --- Timing is the server's ---------------------------------------------------


def test_the_section_clock_is_wall_clock_and_a_reload_does_not_pause_it(app):
    """Closing the tab is not a pause, and reopening it does not buy time back.

    This is the property a browser-side countdown cannot have, and the reason
    the deadline lives on a row. The client is handed `remaining_ms`; it never
    supplies it.
    """
    client = app.test_client()
    headers = login(client, "wall-clock@example.test")
    session = start_form(client, headers)
    session_id = session["id"]
    first_read = read(client, headers, session_id)["remaining_ms"]

    with app.app_context():
        # Twenty minutes pass with nobody looking at the form.
        section = SessionSection.query.filter_by(session_id=session_id, status="in_progress").one()
        db.session.execute(
            update(SessionSection)
            .where(SessionSection.id == section.id)
            .values(
                started_at=utcnow() - timedelta(minutes=20),
                deadline_at=utcnow() + timedelta(minutes=15),
            )
        )
        db.session.commit()

    after = read(client, headers, session_id)
    assert first_read > 30 * 60 * 1000
    assert 14 * 60 * 1000 < after["remaining_ms"] <= 15 * 60 * 1000
    # And there is no way to stop it, at any stage of the sitting.
    assert client.post(f"/v1/study-sessions/{session_id}/pause", headers=headers).json["error"]["code"] == "diagnostic_no_pause"
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)
    assert read(client, headers, session_id)["exam"]["stage"] == "awaiting_section"
    assert client.post(f"/v1/study-sessions/{session_id}/pause", headers=headers).json["error"]["code"] == "diagnostic_no_pause"


def test_an_expired_section_is_closed_by_the_next_request_not_by_a_sweeper(app):
    """Nothing runs in the background, so the next reader does the closing."""
    client = app.test_client()
    headers = login(client, "no-sweeper@example.test")
    session_id = start_form(client, headers)["id"]

    with app.app_context():
        db.session.execute(
            update(SessionSection)
            .where(SessionSection.session_id == session_id, SessionSection.status == "in_progress")
            .values(deadline_at=utcnow() - timedelta(seconds=1))
        )
        db.session.commit()
        # Still open as far as the database is concerned: nobody has looked.
        assert SessionSection.query.filter_by(session_id=session_id, status="in_progress").count() == 1

    read(client, headers, session_id)

    with app.app_context():
        assert SessionSection.query.filter_by(session_id=session_id, status="in_progress").count() == 0
        assert SessionSection.query.filter_by(session_id=session_id, ended_reason="expired").count() == 1


def test_a_section_closed_twice_is_graded_once(app):
    """Reachable from the bell and from the student's own hand, so it must be safe."""
    client = app.test_client()
    headers = login(client, "closed-twice@example.test")
    session = start_form(client, headers)
    session_id = session["id"]
    for item_id in sheet_items(read(client, headers, session_id)):
        client.put(
            f"/v1/study-sessions/{session_id}/answers/{item_id}",
            json={"selected_label": "C"},
            headers=headers,
        )
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)

    with app.app_context():
        from app import exam

        record = db.session.get(StudySession, session_id)
        section = record.sections[0]
        graded = Attempt.query.count()
        assert graded == section.question_count
        exam.close_section(section, reason="submitted")
        assert Attempt.query.count() == graded

    again = client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)
    assert again.json["error"]["code"] == "no_section_running"


def test_the_accommodation_multiplier_stretches_every_clock_on_the_form(app):
    client = app.test_client()
    headers = login(client, "accommodated@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/diagnostics", json={"accommodation_multiplier": 1.5}, headers=headers
    ).json["session"]

    sections = session["exam"]["sections"]
    assert {section["time_limit_seconds"] for section in sections} == {round(1.5 * 35 * 60)}
    assert sections[1]["break_seconds"] == round(1.5 * 10 * 60)
    assert session["target_minutes"] == round(3 * 1.5 * 35 * 60 / 60)


# --- Working inside a section -------------------------------------------------


def test_time_on_a_question_is_the_sum_of_every_visit_to_it(app):
    """Free navigation only tells the truth if returning is measured too."""
    client = app.test_client()
    headers = login(client, "revisits@example.test")
    session_id = start_form(client, headers)["id"]
    items = sheet_items(read(client, headers, session_id))

    def spend(position: int, seconds: int) -> None:
        client.post(f"/v1/study-sessions/{session_id}/focus/{position}", headers=headers)
        with app.app_context():
            item = SessionItem.query.filter_by(session_id=session_id, position=position).one()
            db.session.execute(
                update(SessionItem)
                .where(SessionItem.id == item.id)
                .values(timer_started_at=utcnow() - timedelta(seconds=seconds))
            )
            db.session.commit()

    spend(0, 30)
    spend(1, 10)
    # Back to the first question for a second look.
    spend(0, 45)
    client.put(
        f"/v1/study-sessions/{session_id}/answers/{items[0]}",
        json={"selected_label": "C"},
        headers=headers,
    )
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)

    with app.app_context():
        attempt = (
            Attempt.query.join(SessionItem)
            .filter(SessionItem.session_id == session_id, SessionItem.position == 0)
            .one()
        )
        # Thirty seconds, then forty-five more, not just the last visit.
        assert 70_000 < attempt.server_elapsed_ms < 80_000


def test_reading_comprehension_questions_stay_under_their_passage_and_in_order(app):
    """A passage is never split, and its set is never interleaved with another.

    True of practice already; it has to stay true here, where a section is
    exactly one reading section and shuffling would make the reading time
    meaningless.
    """
    client = app.test_client()
    headers = login(client, "passages@example.test")
    session_id = start_form(client, headers)["id"]

    with app.app_context():
        record = db.session.get(StudySession, session_id)
        reading = next(
            section for section in record.sections if section.section_type == "Reading Comprehension"
        )
        items = (
            SessionItem.query.filter(
                SessionItem.session_id == session_id,
                SessionItem.position >= reading.start_position,
                SessionItem.position <= reading.end_position,
            )
            .order_by(SessionItem.position)
            .all()
        )
        passage_order = [item.question.passage_id for item in items]
        assert len(items) == RC_PASSAGES * RC_PER_PASSAGE
        assert all(passage_order)
        # Every passage appears as one unbroken run.
        runs = [passage_order[0]]
        for passage_id in passage_order[1:]:
            if passage_id != runs[-1]:
                runs.append(passage_id)
        assert len(runs) == len(set(runs)) == RC_PASSAGES
        # And no reading question escaped into a Logical Reasoning section.
        for section in record.sections:
            if section.section_type == "Reading Comprehension":
                continue
            strays = SessionItem.query.join(Question).filter(
                SessionItem.session_id == session_id,
                SessionItem.position >= section.start_position,
                SessionItem.position <= section.end_position,
                Question.section == "Reading Comprehension",
            )
            assert strays.count() == 0


# --- What a sitting reports ---------------------------------------------------


def test_a_sitting_reports_each_section_against_its_own_length(app):
    """A section the clock ended is scored over all its questions, blanks included.

    Reporting the accuracy of the questions that got answered is how a student
    is told they scored 100% on a section they only got two thirds of the way
    through, which is the number that stops them fixing it.
    """
    client = app.test_client()
    headers = login(client, "sitting-report@example.test")
    session_id = start_form(client, headers)["id"]

    # Section one: right at the start, wrong at the end, and the last two left
    # blank when the bell goes.
    form = read(client, headers, session_id)
    items = sheet_items(form)
    for offset, item_id in enumerate(items[:-2]):
        client.put(
            f"/v1/study-sessions/{session_id}/answers/{item_id}",
            json={"selected_label": "C" if offset < 2 else "A", "flagged": offset == 3},
            headers=headers,
        )
    client.put(
        f"/v1/study-sessions/{session_id}/answers/{items[-1]}",
        json={"flagged": True},
        headers=headers,
    )
    with app.app_context():
        db.session.execute(
            update(SessionSection)
            .where(SessionSection.session_id == session_id, SessionSection.status == "in_progress")
            .values(deadline_at=utcnow() - timedelta(seconds=1))
        )
        db.session.commit()

    finished = read(client, headers, session_id)
    with app.app_context():
        from app.services import calculate_session_summary

        record = db.session.get(StudySession, session_id)
        report = calculate_session_summary(record)["exam"]["sections"][0]

    assert finished["exam"]["sections"][0]["ended_reason"] == "expired"
    assert report["questions"] == LR_PER_SECTION
    assert report["answered"] == LR_PER_SECTION - 2
    assert report["unanswered"] == 2
    assert report["correct"] == 2
    assert report["ran_out_of_time"] is True
    # Over the whole section, and over what was attempted, side by side.
    assert report["accuracy"] == round(100 * 2 / LR_PER_SECTION)
    assert report["answered_accuracy"] == round(100 * 2 / (LR_PER_SECTION - 2))
    # Where it fell apart: the opening half scored, the closing half did not.
    assert report["opening"] == {"questions": 3, "correct": 2}
    assert report["closing"] == {"questions": 3, "correct": 0}
    # A question flagged and never returned to is the triage that did not pay off.
    assert report["flagged"] == 2
    assert report["flagged_unanswered"] == 1


def test_a_form_arms_no_strategy_prompt_and_leaves_the_estimator_alone(app):
    """A timed form is a measurement, so nothing intervenes in it.

    Mandatory approaches — the "standing order" arm, with a server-granted exit
    after two refusals or ninety seconds — cost time and change behaviour. Both
    are the point in practice and both are contamination here: ninety seconds
    is four percent of a thirty-five-minute section, and a form is the one
    surface whose accuracy the score projection is anchored on.

    Suppression is free of cost to the trial, and the reason is structural
    rather than lucky. `prompt_required` is a sub-arm of the prompt side, so
    the headline prompt-versus-control draw is a separate draw that a form
    never enters: the propensity of being offered a technique at all stays at
    0.75 in every stratum whatever forms get sat, because the questions on a
    form are not drawn from that pool either.

    The forcing contrast is the one that could have been damaged, and it is not
    damaged here because a form's questions never join its pool rather than
    leaving it. `plan_forced_arms` writes a propensity onto the losers of the
    draw as well as the winners — that is what identifies it — and it is only
    ever called for a practice run. So an exam row carries a null stratum and a
    null `forcing_propensity`, and `_pooled` excludes it on that null.

    That is the difference the design turns on: an excluded row that says on
    its face "this was never in a pool" is honest, and a row that was in a pool
    and then quietly stopped appearing would be a biased sample. Both are
    asserted below, on the item and on the attempt copied from it.
    """
    client = app.test_client()
    headers = login(client, "no-prompt@example.test")
    session = start_form(client, headers)
    session_id = session["id"]

    assert session["current_item"]["strategy_trial"] is None
    assert session["current_item"]["strategy_gate"] is None
    assert session["current_item"]["strategy_neutral"] is None
    assert session["current_item"]["requires_reasoning"] is False

    for item_id in sheet_items(read(client, headers, session_id)):
        client.put(
            f"/v1/study-sessions/{session_id}/answers/{item_id}",
            json={"selected_label": "C"},
            headers=headers,
        )
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)

    with app.app_context():
        from app.strategies import assign_strategy_trial, strategy_performance

        user = User.query.filter_by(email="no-prompt@example.test").one()
        items = SessionItem.query.filter_by(session_id=session_id).all()
        assert {item.strategy_key for item in items} == {None}
        assert {item.strategy_variant for item in items} == {None}
        assert {item.strategy_enforcement_level for item in items} == {"none"}
        # Never in either pool, and saying so. A null here is the row's own
        # account of why it takes no part in the comparison; a form's questions
        # are not drawn for the prompt arm, so `plan_forced_arms` — which is
        # only ever called for a practice run — never sees them.
        assert {item.strategy_stratum for item in items} == {None}
        assert {item.strategy_forcing_propensity for item in items} == {None}

        attempts = Attempt.query.join(SessionItem).filter(SessionItem.session_id == session_id).all()
        assert attempts
        assert {attempt.strategy_key for attempt in attempts} == {None}
        assert {attempt.strategy_gate_status for attempt in attempts} == {None}
        # Copied through to the attempt, which is the table the contrasts read.
        assert {attempt.strategy_stratum for attempt in attempts} == {None}
        assert {attempt.strategy_forcing_propensity for attempt in attempts} == {None}

        # And a form's attempts are invisible to the estimator, which reads
        # only rows that carry a strategy key.
        assert strategy_performance(user.id)["results"] == []


def test_the_section_is_handed_over_whole_and_only_while_it_is_running(app):
    """Free navigation has to be free of the clock, so the section arrives at once.

    One fetch per hop would charge a student time for going back to check
    number four, which the real test does not do. The counterpart rule is that
    a section not yet begun is not something they are allowed to have read, so
    this hands over the running one and nothing else.
    """
    client = app.test_client()
    headers = login(client, "section-papers@example.test")
    session_id = start_form(client, headers)["id"]

    delivered = client.get(f"/v1/study-sessions/{session_id}/section", headers=headers)
    assert delivered.status_code == 200
    papers = delivered.json["items"]
    assert [paper["number"] for paper in papers] == list(range(1, LR_PER_SECTION + 1))
    assert all(paper["question"]["choices"] for paper in papers)
    assert {paper["selected_label"] for paper in papers} == {None}
    # The next section's questions are not in it, at any price.
    assert len(papers) == LR_PER_SECTION

    # An answer marked on the sheet comes back on the paper, so a reload lands
    # a student on the section as they left it rather than on a blank one.
    client.put(
        f"/v1/study-sessions/{session_id}/answers/{papers[2]['id']}",
        json={"selected_label": "C", "flagged": True},
        headers=headers,
    )
    again = client.get(f"/v1/study-sessions/{session_id}/section", headers=headers).json["items"]
    assert again[2]["selected_label"] == "C"
    assert again[2]["flagged"] is True

    # Between sections there is nothing to hand over. "During the time allotted
    # for each section of the Test, you may work only on that section" — LSAC
    # Candidate Agreement 2026-2027, § 15.
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)
    closed = client.get(f"/v1/study-sessions/{session_id}/section", headers=headers)
    assert closed.status_code == 409
    assert closed.json["error"]["code"] == "no_section_running"


def test_a_finished_form_refuses_writes_and_accepts_the_submit_that_finished_it(app):
    """A reply describes what happened to the request that asked for it.

    The distinction is deliberate and it is easy to get backwards. Recording an
    answer on a finished form did not record anything, so a 200 carrying the
    finished session would be a lie a client cannot detect — it looks exactly
    like a successful write of a different shape. Ending a section, though, is
    the one verb whose goal is that the section be over: when the bell beats
    the student to it by a second the request got precisely what it asked for,
    and answering that with an error would make the ordinary race — hitting the
    button as the clock runs out — look like a failure.
    """
    client = app.test_client()
    headers = login(client, "finished-form@example.test")
    session_id = start_form(client, headers)["id"]
    last_item = sheet_items(read(client, headers, session_id))[-1]

    with app.app_context():
        # The first section's bell went, and then the sitting was walked away
        # from for longer than a boundary is held open — so the next request
        # finds a form with nothing left to sit and closes the whole thing out.
        db.session.execute(
            update(SessionSection)
            .where(SessionSection.session_id == session_id, SessionSection.status == "in_progress")
            .values(deadline_at=utcnow() - timedelta(seconds=BOUNDARY_GRACE_SECONDS + 60))
        )
        db.session.commit()

    # Submitting into that is the request whose goal has already been met.
    ended = client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)
    assert ended.status_code == 200, ended.json
    assert ended.json["session"]["status"] == "completed"
    assert ended.json["summary"]

    refused = client.put(
        f"/v1/study-sessions/{session_id}/answers/{last_item}",
        json={"selected_label": "C"},
        headers=headers,
    )
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "session_complete"
    assert "saved" not in refused.json

    moved = client.post(f"/v1/study-sessions/{session_id}/focus/0", headers=headers)
    assert moved.status_code == 409
    assert moved.json["error"]["code"] == "session_complete"

    with app.app_context():
        # And nothing was written: the sheet is as the bell left it.
        assert db.session.get(SessionItem, last_item).draft_selected_label is None


def test_the_dashboard_reads_the_administration_and_not_a_reconstruction(app):
    """The section read-out is only offered for a form that had sections.

    A sitting from before them had no bell and no halves, so there is nothing
    to back-fill and a panel of zeroes would claim there was.
    """
    client = app.test_client()
    headers = login(client, "dash-report@example.test")
    session_id = start_form(client, headers)["id"]
    section_count = len(read(client, headers, session_id)["exam"]["sections"])

    # Two right at the top of each section and then the bell, which is both the
    # cheaper walk and the more interesting one: it gives the panel the states
    # it exists to show rather than three clean hundreds.
    for index in range(section_count):
        form = read(client, headers, session_id)
        if form["exam"]["stage"] != "in_section":
            with app.app_context():
                _end_intermission(session_id)
            started = client.post(f"/v1/study-sessions/{session_id}/sections/{index}/start", headers=headers)
            assert started.status_code == 200, started.json
            form = read(client, headers, session_id)
        for entry in form["exam"]["answer_sheet"][:2]:
            client.put(
                f"/v1/study-sessions/{session_id}/answers/{entry['item_id']}",
                json={"selected_label": "C"},
                headers=headers,
            )
        with app.app_context():
            _expire_running_section(session_id)
        read(client, headers, session_id)

    assert read(client, headers, session_id)["status"] == "completed"
    report = client.get("/v1/performance", headers=headers).json["performance"]["diagnostic"]["exam"]
    assert report["administered"] is True
    assert len(report["sections"]) == section_count
    for section in report["sections"]:
        assert section["correct"] == 2
        assert section["answered"] == 2
        assert section["unanswered"] == section["questions"] - 2
        assert section["ran_out_of_time"] is True
        # Answering only what was reachable is not the same as being right
        # about the section, and the panel shows both numbers for that reason.
        assert section["accuracy"] == round(100 * 2 / section["questions"])
        assert section["answered_accuracy"] == 100
        # The halves partition the section, so the falloff bar cannot lie about
        # how much of it each half stands for.
        assert section["opening"]["questions"] + section["closing"]["questions"] == section["questions"]
    assert report["sections_expired"] == section_count
    assert report["unanswered"] == sum(entry["unanswered"] for entry in report["sections"])


def test_a_form_pays_nothing_and_attaches_no_case(app):
    """Kept from the old whole-form design, because sections do not change it."""
    client = app.test_client()
    headers = login(client, "no-economy@example.test")
    session_id = start_form(client, headers)["id"]
    for item_id in sheet_items(read(client, headers, session_id)):
        client.put(
            f"/v1/study-sessions/{session_id}/answers/{item_id}",
            json={"selected_label": "C"},
            headers=headers,
        )
    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session_id).all()
        assert {item.game_context_json for item in items} == {None}
        attempts = Attempt.query.join(SessionItem).filter(SessionItem.session_id == session_id).all()
        assert all(attempt.settlement is None for attempt in attempts)
        assert all(attempt.capm_points == 0 and attempt.xp_earned == 0 for attempt in attempts)
        # No confidence prompt on a timed form: it is not part of the
        # administration and it costs clock the student is measured on.
        assert {attempt.confidence for attempt in attempts} == {None}
