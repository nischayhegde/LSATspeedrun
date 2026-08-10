"""What happens when the coaching model returns something unreadable.

A malformed reply failed the whole call with a JSONDecodeError in production,
41 seconds in. The attempt still settled and paid out behind a "coaching
unavailable" notice, so a student lost nothing — which is also why the platform
error metric read zero and nobody saw it. These cases pin both halves of the
fix: what can be read back out of an imperfect reply, and the fact that a reply
that genuinely cannot be read says so loudly.
"""

import json
import logging

import pytest

from app import create_app
from app.coaching import (
    CoachingProviderError,
    _chat,
    _decode_json_object,
    coaching_diagnostics,
)


VALID = {"explanation_grade": 70, "reasoning_summary": "A clear read of the stem."}


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "https://coaching.invalid/v1",
            "TFY_API_KEY": "test-key",
        }
    )
    with application.app_context():
        yield application


class _Response:
    """The shape `_chat` reads out of the gateway, with one content string."""

    def __init__(self, content, finish_reason="stop"):
        self._content = content
        self._finish_reason = finish_reason

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "model": "test-model",
            "usage": {"total_tokens": 11},
            "choices": [{"message": {"content": self._content}, "finish_reason": self._finish_reason}],
        }


# --------------------------------------------------------------------------
# Reading an imperfect reply
# --------------------------------------------------------------------------


def test_a_clean_object_is_reported_as_clean_so_salvage_is_not_claimed():
    parsed, how = _decode_json_object(json.dumps(VALID))
    assert parsed == VALID
    assert how == "clean"


def test_a_fenced_object_is_unwrapped():
    parsed, how = _decode_json_object("```json\n" + json.dumps(VALID) + "\n```")
    assert parsed == VALID
    assert how == "fenced"


def test_surrounding_prose_does_not_lose_the_object():
    reply = "Sure — here is the analysis you asked for:\n" + json.dumps(VALID) + "\nHope that helps!"
    parsed, how = _decode_json_object(reply)
    assert parsed == VALID
    assert how == "embedded"


def test_a_reply_truncated_mid_object_keeps_the_fields_that_arrived():
    parsed, how = _decode_json_object('{"explanation_grade": 70, "reasoning_summary": "A clear read"')
    assert how == "truncated"
    assert parsed["explanation_grade"] == 70
    assert parsed["reasoning_summary"] == "A clear read"


def test_a_reply_truncated_mid_string_drops_only_the_unfinished_value():
    parsed, how = _decode_json_object('{"explanation_grade": 70, "reasoning_summary": "A clear read of the ste')
    assert how == "truncated"
    assert parsed["explanation_grade"] == 70


def test_a_reply_truncated_inside_a_nested_object_still_reads():
    reply = '{"explanation_grade": 70, "answer_analysis": {"correct_answer_explanation": "It completes the task"'
    parsed, how = _decode_json_object(reply)
    assert how == "truncated"
    assert parsed["answer_analysis"]["correct_answer_explanation"] == "It completes the task"


def test_a_reply_truncated_mid_token_steps_back_to_the_last_whole_field():
    # `"explanation_grade": 7` is a complete token by luck, so the cut is made
    # somewhere no closing brace can rescue: a half-written key.
    parsed, how = _decode_json_object('{"explanation_grade": 70, "reasoning_su')
    assert how == "truncated"
    assert parsed == {"explanation_grade": 70}


@pytest.mark.parametrize(
    "reply",
    [
        "",
        "   ",
        "I'm sorry, I can't help with that.",
        "[1, 2, 3]",
        '"just a string"',
    ],
)
def test_a_reply_with_no_object_in_it_is_reported_as_unreadable(reply):
    parsed, how = _decode_json_object(reply)
    assert parsed is None
    assert how == ""


def test_a_lone_object_wrapped_in_an_array_is_unwrapped():
    # A single-element array is the object with brackets around it, which is
    # the same class of defect as prose around it.
    parsed, how = _decode_json_object('[{"explanation_grade": 70}]')
    assert parsed == {"explanation_grade": 70}
    assert how == "embedded"


@pytest.mark.parametrize(
    "reply",
    [
        '[{"explanation_grade": 70}, {"explanation_grade": 20}]',
        'first {"explanation_grade": 70} then {"explanation_grade": 20}',
        '{"explanation_grade": 70} {"explanation_grade": 20}',
    ],
)
def test_two_candidate_objects_are_refused_rather_than_guessed_between(reply):
    # Salvage may recover a reply, never choose a grade on the model's behalf.
    parsed, _ = _decode_json_object(reply)
    assert parsed is None


# --------------------------------------------------------------------------
# Retrying, and being audible when it does not help
# --------------------------------------------------------------------------


def test_an_unreadable_reply_is_retried_once_and_the_second_reply_is_used(app, monkeypatch):
    replies = [_Response("not json at all"), _Response(json.dumps(VALID))]
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(kwargs)
        return replies[len(calls) - 1]

    monkeypatch.setattr("app.coaching.requests.post", fake_post)
    parsed, metadata = _chat("system", {"a": 1})
    assert parsed == VALID
    assert metadata["model"] == "test-model"
    assert len(calls) == 2, "the unreadable first reply should have been asked again"


def test_a_salvageable_reply_is_used_without_paying_for_a_second_call(app, monkeypatch):
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(kwargs)
        return _Response("Here you go:\n" + json.dumps(VALID))

    monkeypatch.setattr("app.coaching.requests.post", fake_post)
    parsed, _ = _chat("system", {"a": 1})
    assert parsed == VALID
    assert len(calls) == 1, "a reply that could be read must not trigger a retry"


def test_two_unreadable_replies_fail_the_call_rather_than_inventing_coaching(app, monkeypatch):
    monkeypatch.setattr("app.coaching.requests.post", lambda *a, **k: _Response("nope", finish_reason="length"))
    with pytest.raises(CoachingProviderError):
        _chat("system", {"a": 1})


def test_an_unreadable_reply_is_logged_at_error_so_it_reaches_a_dashboard(app, monkeypatch, caplog):
    monkeypatch.setattr("app.coaching.requests.post", lambda *a, **k: _Response("nope", finish_reason="length"))
    with caplog.at_level(logging.WARNING):
        with pytest.raises(CoachingProviderError):
            _chat("system", {"a": 1})
    errors = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert errors, "an unreadable reply must not be reported below ERROR"
    message = errors[-1].getMessage()
    assert "coaching.response_unreadable" in message, "the event token is what a metric filter counts"
    assert "finish_reason=length" in message, "truncation must be distinguishable from prose"


def test_the_failing_reply_itself_is_never_written_to_the_log(app, monkeypatch, caplog):
    secret = "the student wrote something private here"
    monkeypatch.setattr("app.coaching.requests.post", lambda *a, **k: _Response(secret))
    with caplog.at_level(logging.WARNING):
        with pytest.raises(CoachingProviderError):
            _chat("system", {"a": 1})
    assert all(secret not in record.getMessage() for record in caplog.records)


def test_a_salvaged_reply_is_still_reported_so_drift_is_not_hidden(app, monkeypatch, caplog):
    monkeypatch.setattr(
        "app.coaching.requests.post",
        lambda *a, **k: _Response("Certainly!\n" + json.dumps(VALID)),
    )
    with caplog.at_level(logging.WARNING):
        _chat("system", {"a": 1})
    assert any("coaching.response_salvaged" in record.getMessage() for record in caplog.records)


def test_a_transport_failure_is_not_retried_and_is_logged_at_error(app, monkeypatch, caplog):
    import requests

    calls = []

    def fake_post(*args, **kwargs):
        calls.append(1)
        raise requests.ConnectionError("refused")

    monkeypatch.setattr("app.coaching.requests.post", fake_post)
    with caplog.at_level(logging.WARNING):
        with pytest.raises(CoachingProviderError):
            _chat("system", {"a": 1})
    assert len(calls) == 1, "an outage must not be retried into a second call"
    assert any("coaching.transport_failed" in record.getMessage() for record in caplog.records)


def test_the_failure_counts_are_reported_for_a_check_that_does_not_read_logs(app, monkeypatch):
    before = coaching_diagnostics().get("unreadable", 0)
    monkeypatch.setattr("app.coaching.requests.post", lambda *a, **k: _Response("nope"))
    with pytest.raises(CoachingProviderError):
        _chat("system", {"a": 1})
    assert coaching_diagnostics()["unreadable"] == before + 1


def test_health_reports_the_coaching_failure_counts(app):
    client = app.test_client()
    body = client.get("/v1/health").get_json()
    assert "response_failures" in body["coaching"]
