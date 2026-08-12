"""Migration 0037 renames the district ledger event and moves nothing else.

The word "retainer" meant two opposite things: a client retainer pays a per-case
fee, a district appointment pays nothing and buys standing. Every string a
player reads was moved to "counsel" earlier; the ledger event key was left
behind because it is in the database rather than in source.

This test plants the old key, runs the chain, and requires three things: the key
changed, the money did not, and the reverse works. The middle one is the point.
A ledger row is the audit trail for cash that has already left the account, so a
rename that touched `amount` or `balance_after` would silently rewrite a
player's history, and the surrounding suite would not notice — nothing else
reads `kind`.
"""

from __future__ import annotations

import logging

import pytest
from flask_migrate import downgrade, upgrade
from sqlalchemy import text

from app import MIGRATIONS_DIR, create_app
from app.extensions import db

# Foreign keys are enforced on every SQLite connection, so the ledger row needs
# a real user behind it. `_plant` fills whatever else the schema insists on at
# this revision, which keeps this test from needing an edit every time an
# unrelated NOT NULL column lands on `users`.
from tests.test_migration_preserves_data import _plant

BEFORE = "0036_sectioned_exam"
AFTER = "0037_district_counsel"


@pytest.fixture
def restored_logging():
    """`migrations/env.py` calls `fileConfig`, which mutes loggers it does not name."""
    before = {
        name: item.disabled
        for name, item in logging.Logger.manager.loggerDict.items()
        if isinstance(item, logging.Logger)
    }
    yield
    for name, disabled in before.items():
        item = logging.Logger.manager.loggerDict.get(name)
        if isinstance(item, logging.Logger):
            item.disabled = disabled


def _kinds(connection) -> dict[str, tuple[str, int, int]]:
    rows = connection.execute(
        text("select id, kind, amount, balance_after from ledger_entries order by id")
    ).all()
    return {row[0]: (row[1], row[2], row[3]) for row in rows}


def test_the_district_event_is_renamed_and_the_money_is_left_alone(
    tmp_path, monkeypatch, restored_logging
):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'ledger.db'}")
    monkeypatch.delenv("DATABASE_SECRET_ARN", raising=False)
    monkeypatch.setenv("AUTO_SEED", "false")
    monkeypatch.setenv("FLASK_ENV", "development")

    app = create_app(instance_path=str(tmp_path))
    with app.app_context():
        upgrade(directory=str(MIGRATIONS_DIR), revision=BEFORE)

        with db.engine.begin() as connection:
            _plant(connection, "users", {"id": "u-led", "email": "led@localhost.test"})
            # The row under test, plus a client-side event that uses the other
            # meaning of the word and must be left exactly as it is.
            for entry_id, kind, source, amount, balance in (
                ("l-district", "district_retainer", "u-led:chancery_row", -900, 4_100),
                ("l-client", "case_settlement", "u-led:case-1", 2_400, 6_500),
            ):
                _plant(
                    connection,
                    "ledger_entries",
                    {
                        "id": entry_id,
                        "user_id": "u-led",
                        "kind": kind,
                        "source_id": source,
                        "amount": amount,
                        "balance_after": balance,
                    },
                )

        upgrade(directory=str(MIGRATIONS_DIR), revision=AFTER)

        with db.engine.connect() as connection:
            after = _kinds(connection)
        assert after == {
            "l-district": ("district_counsel", -900, 4_100),
            "l-client": ("case_settlement", 2_400, 6_500),
        }

        downgrade(directory=str(MIGRATIONS_DIR), revision=BEFORE)

        with db.engine.connect() as connection:
            back = _kinds(connection)
        assert back == {
            "l-district": ("district_retainer", -900, 4_100),
            "l-client": ("case_settlement", 2_400, 6_500),
        }


@pytest.fixture()
def memory_app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    with application.app_context():
        yield application


def test_signing_a_district_writes_the_new_key(memory_app):
    """The code and the migration have to agree on the spelling.

    Two independent spellings would split a player's history across both keys
    with nothing to notice it, because nothing outside `game.py` reads `kind`.
    """
    from app.game import secure_district
    from app.models import LedgerEntry, PlayerProfile, User, utcnow

    user = User(email=f"c{utcnow().timestamp()}@example.test", display_name="Counsel")
    db.session.add(user)
    db.session.flush()
    profile = PlayerProfile(
        user_id=user.id,
        lawyer_name="Alex Morgan",
        firm_name="Morgan Legal",
        character_gender="female",
        cash=500_000,
    )
    db.session.add(profile)
    db.session.commit()

    secure_district(profile, "chancery_row")
    kinds = {entry.kind for entry in LedgerEntry.query.filter_by(user_id=user.id).all()}

    assert "district_counsel" in kinds
    assert "district_retainer" not in kinds
