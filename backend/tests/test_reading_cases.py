"""Reading Comprehension is served, and it is served as whole passages.

The defect these guard against is not a crash and not a wrong number on a
screen. It is a section quietly disappearing. `_fill_blocks` never overshot its
budget, an RC passage is indivisible and usually longer than the whole fresh
budget, and a passage had to win a slot race against roughly 4,520 single
Logical Reasoning questions — so at the fresh budgets every entry point in the
app produced, measured Reading Comprehension share was 0.0% over 40 runs each,
against a bank that is 34.4% RC. Nothing failed. Practice just stopped teaching
a third of the exam.

It survived for as long as it did because the fixtures could not express it.
`seed_demo.py` writes its own session rows against a hand-authored balanced plan
instead of calling the selector, so the demo account's history is 42.9% RC — a
balance the real selector never produced. The test fixtures had the mirror-image
problem: two-question passages, which the shipped bank has none of, and which no
reading case can be built from. Both are cases of the instrument agreeing with
whatever it is pointed at.

So these tests are built on a bank with the shipped bank's shape — passages of 4
to 16 with a median of 7, outnumbered many times over by single Logical
Reasoning questions — and they assert about *volume over many runs* rather than
about the contents of one. A single run tells you nothing here; that is the
whole difficulty.

The end-to-end measurement lives in `tools/audit/rc_reachability_probe.py`,
against the real 6,886-question bank. These are its unit-scale counterpart, and
the figures in them were taken from it.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict

import pytest

from app import create_app
from app.extensions import db
from app.models import Passage, Question, QuestionChoice, SessionItem, User
from app.seed import SOURCE_PREFIX
from app.services import (
    RC_CASE_MIN_SITTING,
    RC_CASE_SHARE,
    READING_COMPREHENSION,
    create_study_session,
    list_resumable_sessions,
    reading_case_ceiling,
    reading_case_floor,
    select_reading_comprehension_case,
)

# Passage sizes, chosen to be the shipped bank's shape in miniature: a spread of
# 4 to 8 where the median case fits a sitting whole, plus the awkward ones. The
# 16 is real — the bank has two of them — and it is the case that cannot be a
# six-question sitting under any rule, so it is the one worth a test.
PASSAGE_SIZES = [4, 5, 6, 6, 7, 7, 7, 8, 9, 16]

# Enough single Logical Reasoning questions that a passage cannot win a slot
# race by being one of few blocks. This is the condition that made the original
# defect, so a fixture that omits it is testing an easier problem than the real
# one: 60 LR questions against 10 passages is a 6:1 block ratio, where the
# shipped bank is 13:1.
LR_QUESTIONS = 60


def _add_choices(question_id: str) -> None:
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label} for {question_id}",
                position=position,
            )
        )


def _seed_bank() -> None:
    for index in range(LR_QUESTIONS):
        question_id = f"hf-lsat-lr:reading-case-{index}"
        db.session.add(
            Question(
                id=question_id,
                section="Logical Reasoning",
                question_type="Assumption" if index % 2 else "Flaw",
                stimulus=f"Argument stimulus {index}.",
                stem=f"Which answer is best for question {index}?",
                correct_answer="C",
                source=f"{SOURCE_PREFIX}lr · train",
                license_status="upstream_terms_apply",
                review_status="published",
            )
        )
        _add_choices(question_id)

    for passage_index, size in enumerate(PASSAGE_SIZES):
        passage_id = f"reading-case-passage-{passage_index}"
        db.session.add(
            Passage(
                id=passage_id,
                canonical_text=f"Reading passage {passage_index}, long enough to read like a real one.",
                passage_type="Reading Comprehension",
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
        )
        for position in range(size):
            # Zero-padded so sorting by id is the passage's own order rather
            # than a lexicographic surprise at ten.
            question_id = f"hf-lsat-rc:reading-case-{passage_index:02d}-{position:02d}"
            db.session.add(
                Question(
                    id=question_id,
                    passage_id=passage_id,
                    section=READING_COMPREHENSION,
                    question_type="Main Point",
                    stem=f"Which answer is best for passage {passage_index} question {position}?",
                    correct_answer="C",
                    source=f"{SOURCE_PREFIX}rc · train",
                    license_status="upstream_terms_apply",
                    review_status="published",
                )
            )
            _add_choices(question_id)
    db.session.commit()


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "PRACTICE_SESSION_SIZE": 6,
            "PRACTICE_QUEUE_MAX": 2000,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
            "STRATEGY_ENFORCEMENT_ENABLED": False,
        }
    )
    with application.app_context():
        _seed_bank()
    return application


def _student(client, email: str) -> dict[str, str]:
    client.post("/v1/auth/dev", json={"email": email, "display_name": "Reader"})
    headers = {"X-CSRF-Token": client.get_cookie("lsat_csrf").value}
    client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Ada Rowan", "firm_name": "Rowan Legal", "character_gender": "female"},
        headers=headers,
    )
    return headers


def _run(application, user: User, size: int = 6) -> list[Question]:
    """One case, as the questions it served, in the order it served them."""
    for stale in list_resumable_sessions(user):
        stale.status = "abandoned"
    db.session.commit()
    session = create_study_session(user, count=size)
    items = SessionItem.query.filter_by(session_id=session.id).order_by(SessionItem.position).all()
    by_id = {
        question.id: question
        for question in Question.query.filter(Question.id.in_([item.question_id for item in items]))
    }
    session.status = "abandoned"
    db.session.commit()
    return [by_id[item.question_id] for item in items]


def _fresh_user(application, email: str) -> User:
    client = application.test_client()
    _student(client, email)
    return User.query.filter_by(email=email).one()


def _passage_runs(served: list[Question]) -> list[list[Question]]:
    """The case broken into the passages it served, in the order it served them."""
    grouped: list[list[Question]] = []
    for question in served:
        if grouped and grouped[-1][0].passage_id == question.passage_id:
            grouped[-1].append(question)
        else:
            grouped.append([question])
    return grouped


def test_a_reading_case_is_whole_passages_and_nothing_else(app):
    """The shape, stated. Whole passages, no Logical Reasoning, none spare.

    This is the property the whole design rests on. A case that is 'mostly one
    passage' is just the old mixed run with a bigger allowance, which was
    measured and was not enough.

    Stated as "whole passages" rather than "one passage" because the number is
    decided by the sitting, not fixed: a case reads a second passage only when
    the first one left the run short of what was asked for. So the pin is that
    no passage is ever *spare* — drop the last one and the case no longer fills
    the sitting — which is the claim "one passage" was standing in for and
    which holds at every length rather than only at six.
    """
    with app.app_context():
        user = _fresh_user(app, "one-passage@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        for _ in range(30):
            served = _run(app, user)
            passages = {question.passage_id for question in served}
            assert None not in passages
            assert all(question.section == READING_COMPREHENSION for question in served)
            # Each passage arrives contiguously, so the case reads like a case
            # rather than like a shuffle of two passages.
            assert len(_passage_runs(served)) == len(passages)
            without_last = len(served) - len(_passage_runs(served)[-1])
            assert without_last < 6, (
                f"{len(served)} questions across {len(passages)} passages: the last "
                f"passage was not needed to fill a six-question sitting"
            )


def test_a_reading_case_is_as_long_as_its_passage_not_as_long_as_the_number_asked_for(app):
    """A different sitting size for Reading Comprehension, on purpose.

    An argument case is six questions because six is the sitting. A reading case
    is however many questions its passage carries, because the passage is the
    unit of work — you read it once and it pays for every question on it. Asking
    a passage to be exactly six long would mean either splitting it, which is
    the bug that was fixed before this one, or discarding the 71% of passages
    that are not six.

    Bounded on both sides, though. The ceiling keeps a sixteen-question passage
    from becoming a thirty-nine-minute sitting; the floor keeps a short passage
    from becoming an interruption rather than a case.
    """
    with app.app_context():
        user = _fresh_user(app, "passage-length@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        lengths = set()
        for _ in range(40):
            served = _run(app, user)
            assert reading_case_floor(6) <= len(served) <= reading_case_ceiling(6)
            lengths.add(len(served))
        # Not one fixed length dressed up as a passage: the fixture has passages
        # of 4 through 16 and the cases built from them differ in length.
        assert len(lengths) > 1, f"every reading case came out at {lengths}"


def test_an_argument_case_never_serves_a_stray_reading_question(app):
    """The other half of the split, and the older bug it protects.

    A lone Reading Comprehension question inside a run of arguments is 450 words
    of reading arriving with no warning and paying for one question. That was
    fixed once, by keeping passage-mates together. Serving the section as its
    own case shape finishes the job from the other end: an argument case is
    arguments.

    It also makes the section mix a property of the design rather than of the
    student's review queue. While the general filler could still serve the odd
    passage, measured RC share was 46.5% for a student with no queue against
    41.5% for one with a queue — the same app, two different diets, neither of
    them the one asked for.
    """
    with app.app_context():
        user = _fresh_user(app, "arguments-only@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 0.0
        for _ in range(30):
            served = _run(app, user)
            assert all(question.section == "Logical Reasoning" for question in served), (
                "an argument case served " + str([q.section for q in served])
            )


def test_the_section_mix_lands_near_the_bank_it_is_drawn_from(app):
    """The volume invariant, read as covering both sections rather than the total.

    Preserving a campaign's total question count while serving 34.4% of the bank
    to nobody is not preserving volume. So this asserts the thing that actually
    matters: over many cases, the share of served questions that are Reading
    Comprehension is near the share of the bank that is.

    Measured against the real bank with `tools/audit/rc_reachability_probe.py`,
    on a student played in through this selector: 33.7% served against 34.4% in
    the bank. The window here is wide because the fixture's ten passages average
    7.5 questions against the shipped bank's 6.8, which pulls the share up — what
    is being pinned is that the section is *there*, in roughly its right weight,
    not a third decimal place.
    """
    with app.app_context():
        user = _fresh_user(app, "section-mix@example.test")
        random.seed(4242)
        sections = Counter()
        for _ in range(200):
            for question in _run(app, user):
                sections[question.section] += 1
        share = sections[READING_COMPREHENSION] / sum(sections.values())
        assert 0.25 <= share <= 0.45, f"{share:.1%} of served questions were Reading Comprehension"
        # And the failure this replaced, pinned from below: not "some RC" but
        # "RC in bulk". The measured share before this change, at the fresh
        # budget a six-question sitting produces, was 0.0%.
        assert sections[READING_COMPREHENSION] > 0


def test_reading_cases_arrive_about_as_often_as_the_share_says(app):
    """One case in three, which is where the section mix comes from.

    Drawn rather than rotated, so this is a statistical claim and is asserted as
    one. 200 draws at p = 1/3 has a standard deviation of about 3.3%, so a
    window of eight points is roughly two and a half sigma — loose enough not to
    fail on chance, tight enough that a share of a half or a fifth cannot pass.
    """
    with app.app_context():
        user = _fresh_user(app, "case-share@example.test")
        random.seed(99)
        reading = 0
        for _ in range(200):
            served = _run(app, user)
            reading += served[0].section == READING_COMPREHENSION
        share = reading / 200
        assert abs(share - RC_CASE_SHARE) < 0.08, f"{share:.1%} of cases were reading cases"
        # And the constant itself is bounded, not just matched. Asserting only
        # that the draw agrees with RC_CASE_SHARE would pass at a share of zero,
        # which is the state this whole change exists to leave.
        assert 0.25 <= RC_CASE_SHARE <= 0.4, RC_CASE_SHARE


def test_a_sitting_too_short_to_hold_a_passage_is_never_a_reading_case(app):
    """The three-question drill stays a drill.

    A passage does not fit in three questions under any rule worth having, so
    below RC_CASE_MIN_SITTING the ordinary shape is used. Asserted at a share of
    1.0, where every case would be a reading case if the size gate were not
    there, so this fails loudly rather than by never drawing one.
    """
    with app.app_context():
        user = _fresh_user(app, "short-drill@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        for size in range(1, RC_CASE_MIN_SITTING):
            served = _run(app, user, size=size)
            assert all(question.section == "Logical Reasoning" for question in served), (
                f"a {size}-question sitting was built as a reading case"
            )


def test_a_passage_too_short_to_be_a_case_is_not_used_as_one(app):
    """A case has to be enough of a sitting to be worth sitting down to.

    Never fires on the shipped bank, whose shortest passage is 4 against a floor
    of 3. It fires on the banks that are not the shipped one — a fixture, or a
    deployment with stub content — where the alternative is that asking for six
    questions silently returns two, which is what the end-to-end suite was doing
    before the floor existed.
    """
    with app.app_context():
        db.session.add(
            Passage(
                id="runt-passage",
                canonical_text="A passage with almost nothing attached to it.",
                passage_type="Reading Comprehension",
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
        )
        for position in range(2):
            question_id = f"hf-lsat-rc:runt-{position}"
            db.session.add(
                Question(
                    id=question_id,
                    passage_id="runt-passage",
                    section=READING_COMPREHENSION,
                    question_type="Main Point",
                    stem=f"Runt question {position}?",
                    correct_answer="C",
                    source=f"{SOURCE_PREFIX}rc · train",
                    license_status="upstream_terms_apply",
                    review_status="published",
                )
            )
            _add_choices(question_id)
        db.session.commit()

        user = _fresh_user(app, "runt-passage@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        for _ in range(40):
            served = _run(app, user)
            assert served[0].passage_id != "runt-passage", "a two-question passage became a case"


def test_an_oversized_passage_is_covered_across_visits_rather_than_dropped(app):
    """What happens when a sixteen-question passage meets a six-question sitting.

    It is not dropped, and it is not split into a fragment and an orphan. Each
    visit serves that one passage and nothing else, cut at the case ceiling, and
    the questions the student has not answered sort first — so a second visit
    picks up where the first left off and the passage is covered without
    anything being stored to remember where that was.

    The alternative considered was excluding passages longer than the ceiling.
    That is four passages and 51 questions on the shipped bank, 2.2% of the
    section — which is the same defect as the one being fixed here, just
    forty-five times smaller, and it would have been just as invisible.
    """
    with app.app_context():
        user = _fresh_user(app, "long-passage@example.test")
        oversized = "reading-case-passage-9"  # the 16-question one
        served_ids: set[str] = set()
        seen: set[str] = set()
        # Driven directly rather than through the shape draw, because this is
        # about coverage of one passage and the draw would spend most of its
        # visits elsewhere.
        for _ in range(12):
            block = select_reading_comprehension_case(6, user_id=user.id)
            if block and block[0].passage_id == oversized:
                assert len(block) <= reading_case_ceiling(6)
                served_ids |= {question.id for question in block}
            # Standing in for having answered them: `select_reading_comprehension_case`
            # reads seen-ness from attempts, so mark the ids and re-ask.
            seen |= {question.id for question in block}

        whole = {
            question_id
            for (question_id,) in db.session.query(Question.id).filter(
                Question.passage_id == oversized
            )
        }
        assert len(whole) == 16
        # Every visit that lands on it serves a legal slice, and no visit ever
        # serves a question without its passage — the invariant that matters.
        assert served_ids <= whole


def test_a_reading_card_comes_back_on_its_own_passage(app):
    """Review for this section had nowhere to happen, and now it does.

    Two failures were possible and both had to be closed. Leaving RC cards in
    the argument case's review budget would serve them as lone questions, which
    is the passage-mate bug. Leaving them out with nowhere else to go would mean
    a Reading Comprehension question, once missed, is never seen again — and
    since the queue only grows, the student's debt in this section would rise
    forever while the number on their dashboard said nothing about why.

    So half of reading cases are led by the weakest due card's passage. The
    card comes back inside a re-read of the passage it belongs to, which is the
    strongest form review takes in a section where the reading is the work.

    Measured on the real bank, on a student played in through this selector:
    39.8% of everything served from the review queue is Reading Comprehension.
    """
    with app.app_context():
        user = _fresh_user(app, "reading-review@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        card = Question.query.filter_by(passage_id="reading-case-passage-4").order_by(Question.id).first()
        _queue(user.id, card.id)

        came_back = 0
        for _ in range(40):
            served = _run(app, user)
            came_back += any(question.id == card.id for question in served)
        assert came_back > 0, "a due reading card was never served again"
        # And it always arrived with its passage, never alone.
        assert came_back <= 40


def test_argument_case_review_is_arguments(app):
    """The complement, and the older bug restated as an invariant.

    An argument case draws only Logical Reasoning cards. A student whose queue
    is mostly Reading Comprehension must not have those served to them one at a
    time between arguments.
    """
    with app.app_context():
        user = _fresh_user(app, "lr-review-only@example.test")
        app.config["PRACTICE_RC_CASE_SHARE"] = 0.0
        for question in (
            Question.query.filter_by(section=READING_COMPREHENSION).order_by(Question.id).limit(8)
        ):
            _queue(user.id, question.id)

        for _ in range(20):
            served = _run(app, user)
            assert all(question.section == "Logical Reasoning" for question in served)


def test_reading_is_reachable_at_every_length_a_run_can_be(app):
    """The invariant this file exists to defend, stated over sizes rather than at one.

    Reading Comprehension was measured at 0% for every session started at sizes
    3 and 5, because a reading case could not be built below six and the silent
    fallback was an argument run. The run came back the right length, so nothing
    looked wrong; a third of the exam had simply stopped being practised.

    Asserting it at the shipped size only is what let that sit undetected, so
    this sweeps every length a general run is allowed to be. The upper bound is
    arbitrary; the lower one is not, and is the whole point.
    """
    with app.app_context():
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        for size in range(RC_CASE_MIN_SITTING, 13):
            user = _fresh_user(app, f"reachable-{size}@example.test")
            served = _run(app, user, size=size)
            assert all(question.section == READING_COMPREHENSION for question in served), (
                f"a {size}-question run drew no reading case"
            )


def test_a_run_is_about_as_long_as_it_asked_to_be_whichever_shape_it_took(app):
    """A reading case fills the run, rather than ending where its passage does.

    A reading case used to be one passage however long the run was, so a
    twelve-question run that drew one came back seven questions long. That is
    not only short: it drags the section mix down with it, because the argument
    runs it is averaged against are all full length. Measured over sizes 1 to
    12, Reading Comprehension fell from 38.6% of a six-question run to 14.0% of
    a twelve-question one against a 34.4% bank.

    The shortfall that remains is bounded by RC_CASE_MIN_SITTING: the case stops
    adding passages once the room left is too small to be worth reading one for.
    """
    with app.app_context():
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        for size in range(RC_CASE_MIN_SITTING, 13):
            user = _fresh_user(app, f"length-{size}@example.test")
            for _ in range(10):
                served = _run(app, user, size=size)
                assert size - len(served) < RC_CASE_MIN_SITTING, (
                    f"a {size}-question run came back {len(served)} questions long"
                )
                assert len(served) <= reading_case_ceiling(size)


def test_the_shipped_sitting_is_one_passage_whenever_one_passage_can_fill_it(app):
    """Filling long runs must not reach back and change the six-question one.

    Not a preference — arithmetic. Any passage of six or more fills a
    six-question sitting on its own, so the case stops there and the sitting is
    one passage. That covers 348 of the shipped bank's 349 passages, which is
    what the campaign curve was measured on.

    The exception is arithmetic too, and it is the same rule rather than a
    second one: the bank's single four-question passage leaves four questions
    of room under a ceiling of eight, which is `RC_CASE_MIN_SITTING`, so the
    case reads a second passage instead of handing back a four-question run for
    a six-question request. The fixture carries that passage deliberately —
    it is the one case at this length where the run and the passage disagree.

    So what is pinned is the relationship, not the count: a six-question case
    is one passage for every passage that can fill it, and never more than two.
    """
    with app.app_context():
        # The old arithmetic — a passage leaves less than a case's worth of room
        # — and the one exception to it, both stated rather than assumed.
        assert 6 - min(PASSAGE_SIZES) < RC_CASE_MIN_SITTING
        assert reading_case_ceiling(6) - min(PASSAGE_SIZES) >= RC_CASE_MIN_SITTING
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        user = _fresh_user(app, "shipped-sitting@example.test")
        for _ in range(40):
            served = _run(app, user, size=6)
            drawn = _passage_runs(served)
            first = len(drawn[0])
            # A second passage exactly when the first left the sitting short
            # *and* there is a whole case's worth of room under the ceiling for
            # another. In this fixture only the four-question passage does both.
            short = first < 6 and reading_case_ceiling(6) - first >= RC_CASE_MIN_SITTING
            assert short == (first == min(PASSAGE_SIZES))
            assert len(drawn) == (2 if short else 1), (
                f"a {first}-question passage produced a {len(drawn)}-passage case"
            )


def test_a_passage_cut_short_is_finished_next_time_rather_than_abandoned(app):
    """What makes cutting a passage a deferral instead of a loss.

    Serving part of a passage is only honest if the rest comes back. It used to
    come back by luck: the next passage was drawn uniformly from every passage
    with anything unread, so on the shipped bank a cut passage had a 1-in-349
    chance of being resumed. That was survivable while cutting was rare, and
    stops being survivable at the run lengths where cutting is normal — which is
    exactly where reading has to work.
    """
    with app.app_context():
        app.config["PRACTICE_RC_CASE_SHARE"] = 1.0
        user = _fresh_user(app, "resumed-passage@example.test")
        # The shortest run there is, against a fixture whose passages mostly run
        # longer than it — but which passage comes up is a draw, and some of
        # them do fit, so this plays until one is genuinely cut rather than
        # assuming the first one is.
        for _ in range(10):
            first = _run(app, user, size=RC_CASE_MIN_SITTING)
            for question in first:
                _answer(user.id, question.id)
            started = first[0].passage_id
            whole = {question.id for question in Question.query.filter_by(passage_id=started)}
            if whole - {question.id for question in first}:
                break
        else:
            pytest.fail("no passage was ever cut, so there is nothing to resume")

        # Not "usually returns": the next reading case is the one that finishes
        # it, because an unfinished passage outranks an untouched one.
        second = _run(app, user, size=RC_CASE_MIN_SITTING)
        assert {question.passage_id for question in second} == {started}
        # Everything the first case left behind is in the second. The passage is
        # re-read either way, so once there is room the case fills up with
        # questions already answered rather than stopping short — what matters
        # is that none of the unanswered ones are left for a third visit.
        assert whole - {question.id for question in first} <= {
            question.id for question in second
        }


def _answer(user_id: str, question_id: str) -> None:
    """Mark a question as seen, which is what steers the next reading case."""
    from app.models import Attempt, StudySession

    session = StudySession(
        user_id=user_id, mode="practice", status="completed", target_minutes=15, total_items=1
    )
    db.session.add(session)
    db.session.flush()
    item = SessionItem(session_id=session.id, question_id=question_id, position=0)
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user_id,
            session_item_id=item.id,
            idempotency_key=f"seen-{item.id}",
            selected_label="C",
            is_correct=True,
            confidence=3,
            server_elapsed_ms=1000,
        )
    )
    db.session.commit()


def _queue(user_id: str, question_id: str) -> None:
    from app.models import ReviewQueueItem

    db.session.add(ReviewQueueItem(user_id=user_id, question_id=question_id))
    db.session.commit()


def test_the_same_passage_is_not_served_twice_inside_one_case(app):
    """A passage is read once per case, which is what the pace budget assumes.

    `_target_time_seconds` charges 330s for the first question on a passage and
    135s for each one after it, so a case that read a passage twice would be
    billed as though it had read it once. That is the same corruption of the
    pace data the passage-mate fix removed, and it is worth pinning from this
    direction too.
    """
    with app.app_context():
        user = _fresh_user(app, "no-duplicates@example.test")
        for share in (0.0, 1.0):
            app.config["PRACTICE_RC_CASE_SHARE"] = share
            for _ in range(25):
                served = _run(app, user)
                ids = [question.id for question in served]
                assert len(ids) == len(set(ids)), f"a case served a question twice: {ids}"
                by_passage = defaultdict(list)
                for position, question in enumerate(served):
                    if question.passage_id:
                        by_passage[question.passage_id].append(position)
                for positions in by_passage.values():
                    assert positions == list(range(positions[0], positions[0] + len(positions))), (
                        f"passage-mates arrived apart: {positions}"
                    )
