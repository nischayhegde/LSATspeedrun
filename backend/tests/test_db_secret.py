"""The database password rotates underneath a running process.

RDS manages the master password and rotates it every seven days without warning
anything that is already connected. These tests pin the behaviour that keeps the
API alive across a rotation: the password is read per connection, and a refusal
for bad credentials re-reads the secret instead of surfacing as a 500.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine

from app.db_secret import (
    DatabaseSecret,
    attach_rotation_recovery,
    connect_with_current_password,
    is_auth_failure,
)


class FakeAuthError(Exception):
    """Stands in for psycopg's error, which carries a SQLSTATE."""

    def __init__(self, sqlstate: str = "28P01", message: str = "nope") -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


class RecordingDialect:
    """Accepts a connection only when handed one of the passwords it knows."""

    def __init__(self, accepted: str) -> None:
        self.accepted = accepted
        self.attempts: list[str] = []

    def connect(self, *_cargs, **cparams):
        password = cparams.get("password")
        self.attempts.append(password)
        if password != self.accepted:
            raise FakeAuthError(message=f'password authentication failed for user "lsatapp"')
        return f"connection({password})"


def rotating_loader(passwords: list[str]) -> tuple[callable, list[int]]:
    """A secret whose password changes each time it is re-read."""

    calls = [0]

    def load() -> dict:
        index = min(calls[0], len(passwords) - 1)
        calls[0] += 1
        return {"username": "lsatapp", "password": passwords[index], "host": "db.internal", "port": 5432}

    return load, calls


def test_the_secret_is_read_once_until_a_refresh_is_asked_for():
    load, calls = rotating_loader(["first", "second"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)

    assert secret.password() == "first"
    assert secret.password() == "first"
    assert calls[0] == 1, "a cached secret must not cost a Secrets Manager call per connection"

    assert secret.password(refresh=True) == "second"
    assert calls[0] == 2


def test_a_rotated_password_is_picked_up_on_the_next_connection():
    """The failure that took the sandbox down: the cached password is stale."""

    load, calls = rotating_loader(["stale", "rotated"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)
    dialect = RecordingDialect(accepted="rotated")

    connection = connect_with_current_password(secret, dialect, (), {})

    assert connection == "connection(rotated)"
    assert dialect.attempts == ["stale", "rotated"], "it should try the cache, then re-read and retry"
    assert calls[0] == 2


def test_a_healthy_connection_does_not_re_read_the_secret():
    load, calls = rotating_loader(["current", "unused"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)
    dialect = RecordingDialect(accepted="current")

    assert connect_with_current_password(secret, dialect, (), {}) == "connection(current)"
    assert dialect.attempts == ["current"]
    assert calls[0] == 1


def test_a_password_that_is_still_wrong_after_refreshing_surfaces():
    load, _ = rotating_loader(["wrong", "also-wrong"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)
    dialect = RecordingDialect(accepted="something-else")

    with pytest.raises(FakeAuthError):
        connect_with_current_password(secret, dialect, (), {})
    assert dialect.attempts == ["wrong", "also-wrong"], "exactly one retry, not a loop"


def test_failures_that_are_not_about_credentials_are_not_retried():
    """A network outage must not be mistaken for a rotation."""

    load, calls = rotating_loader(["current", "unused"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)

    class UnreachableDialect:
        def __init__(self) -> None:
            self.attempts = 0

        def connect(self, *_cargs, **_cparams):
            self.attempts += 1
            raise TimeoutError("could not connect to server: Connection timed out")

    dialect = UnreachableDialect()
    with pytest.raises(TimeoutError):
        connect_with_current_password(secret, dialect, (), {})
    assert dialect.attempts == 1
    assert calls[0] == 1, "a timeout is not a reason to re-read the secret"


@pytest.mark.parametrize(
    "error,expected",
    [
        (FakeAuthError(sqlstate="28P01"), True),
        (FakeAuthError(sqlstate="28000"), True),
        (FakeAuthError(sqlstate="08006", message="connection failure"), False),
        (Exception('connection failed: FATAL:  password authentication failed for user "lsatapp"'), True),
        (Exception("could not translate host name"), False),
    ],
)
def test_auth_failures_are_told_apart_from_other_failures(error, expected):
    assert is_auth_failure(error) is expected


def test_auth_failure_is_found_through_a_wrapped_exception():
    """SQLAlchemy wraps the driver error, so the cause chain has to be walked."""

    try:
        try:
            raise FakeAuthError(sqlstate="28P01", message="inner")
        except FakeAuthError as inner:
            raise RuntimeError("sqlalchemy wrapper") from inner
    except RuntimeError as wrapped:
        assert is_auth_failure(wrapped) is True


def test_an_incomplete_secret_is_rejected_rather_than_used():
    secret = DatabaseSecret(
        "arn:aws:secretsmanager:us-east-1:1:secret:x",
        loader=lambda: {"username": "lsatapp"},
    )
    with pytest.raises(RuntimeError, match="incomplete"):
        secret.password()


def test_the_url_prefers_the_environment_over_the_secret_body():
    load, _ = rotating_loader(["pw"])
    secret = DatabaseSecret(
        "arn:aws:secretsmanager:us-east-1:1:secret:x",
        host="override.host",
        port="6543",
        name="overridden",
        loader=load,
    )
    url = secret.url()
    assert "override.host" in url
    assert "6543" in url
    assert "overridden" in url
    assert "sslmode=require" in url
    assert url.startswith("postgresql+psycopg://")


def test_attaching_registers_a_connect_listener():
    load, _ = rotating_loader(["pw"])
    secret = DatabaseSecret("arn:aws:secretsmanager:us-east-1:1:secret:x", loader=load)
    engine = create_engine("postgresql+psycopg://lsatapp:pw@db.internal:5432/lsatspeedrun")

    # `do_connect` belongs to DialectEvents, so the listener lands on the dialect
    # even though it is registered against the engine. Assert where it actually
    # ends up, otherwise this passes while hooking nothing.
    assert not engine.dialect.dispatch.do_connect
    attach_rotation_recovery(engine, secret)
    assert engine.dialect.dispatch.do_connect
