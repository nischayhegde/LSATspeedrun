"""`scripts/simulate_economy_curve.py` must survive whatever is at the database path.

Separate from `test_game_catalog.py`, which asserts what the curve *says*. This
asserts that it says anything at all.

The script reads the per-case time budget out of `backend/instance/` at import
so the conversion cannot drift away from `services._target_time_seconds`
unnoticed. Three test modules import the script, so a read that raises does not
fail one test — it interrupts collection and takes all three modules with it,
including tests that never touch a database. That is what used to happen: the
`try` guarded `connect` alone, and sqlite3 opens lazily, so every real failure
landed on the first `execute` unguarded.

A verification run lost its first attempt to this.
"""

from __future__ import annotations

import sqlite3

import pytest

from scripts.simulate_economy_curve import FALLBACK_SECONDS_PER_CASE, seconds_per_case


def _empty_file(tmp_path):
    """A file at the path that is not a database in any sense."""
    path = tmp_path / "empty.db"
    path.touch()
    return path


def _unmigrated(tmp_path):
    """A real SQLite database that has never had a migration run against it.

    The ordinary state of a fresh checkout whose `instance/` directory was
    created by something other than `flask db upgrade`.
    """
    path = tmp_path / "unmigrated.db"
    sqlite3.connect(path).close()
    return path


def _migrated_but_unplayed(tmp_path):
    """Schema present, nobody has answered a practice question yet."""
    path = tmp_path / "unplayed.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE questions (id TEXT PRIMARY KEY, section TEXT);
        CREATE TABLE study_sessions (id INTEGER PRIMARY KEY, mode TEXT);
        CREATE TABLE session_items (
            session_id INTEGER, question_id TEXT, target_time_seconds INTEGER
        );
        """
    )
    connection.commit()
    connection.close()
    return path


def _corrupt(tmp_path):
    """Something else entirely, sitting where the database should be."""
    path = tmp_path / "corrupt.db"
    path.write_text("this is not a database")
    return path


def _absent(tmp_path):
    return tmp_path / "nothing-here.db"


@pytest.mark.parametrize(
    "build, expected_reason",
    [
        (_absent, "no database at"),
        (_empty_file, "has not been migrated"),
        (_unmigrated, "has not been migrated"),
        (_migrated_but_unplayed, "no practice items served yet"),
        (_corrupt, "unreadable"),
    ],
)
def test_an_unusable_database_falls_back_instead_of_raising(tmp_path, build, expected_reason):
    """Every way of having nothing to measure returns the documented constant.

    "I could not measure it" and "there is nothing to measure" are the same
    answer, because the measurement is an optional refinement: the fallback is
    the shipped figure and the one the pace band was tuned against. What differs
    between them is the provenance, which the report prints, so the reasons are
    distinguished — a database that has merely not been migrated is ordinary,
    and one that is unreadable is a real problem worth chasing.
    """
    seconds, source = seconds_per_case(build(tmp_path))
    assert seconds == FALLBACK_SECONDS_PER_CASE
    assert expected_reason in source, source


def test_a_populated_database_is_measured_rather_than_assumed():
    """The fallback must not be so total that it swallows a working read.

    A test that only proved "never raises" would pass against a function that
    returned the constant unconditionally, which would silently disconnect the
    curve from `_target_time_seconds` — the exact drift the database read exists
    to prevent.
    """
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "played.db"
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE questions (id TEXT PRIMARY KEY, section TEXT);
            CREATE TABLE study_sessions (id INTEGER PRIMARY KEY, mode TEXT);
            CREATE TABLE session_items (
                session_id INTEGER, question_id TEXT, target_time_seconds INTEGER
            );
            INSERT INTO questions VALUES ('q1', 'Logical Reasoning'), ('q2', 'Reading Comprehension');
            INSERT INTO study_sessions VALUES (1, 'practice');
            INSERT INTO session_items VALUES (1, 'q1', 150), (1, 'q1', 150), (1, 'q2', 330);
            """
        )
        connection.commit()
        connection.close()

        seconds, source = seconds_per_case(path)

    # Two Logical Reasoning items at 150s and one Reading Comprehension at 330s.
    assert seconds == pytest.approx((150 + 150 + 330) / 3)
    assert "3 served practice items" in source
    assert seconds != FALLBACK_SECONDS_PER_CASE


def test_reading_the_budget_does_not_leak_a_connection(tmp_path):
    """`with connection` is a transaction block; it does not close the handle.

    Harmless at one call per import, and not harmless in a loop.
    """
    path = _migrated_but_unplayed(tmp_path)
    for _ in range(200):
        seconds_per_case(path)
