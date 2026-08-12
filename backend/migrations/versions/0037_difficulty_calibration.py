"""Give the question bank a difficulty that can be absent.

Every question in the bank carried `questions.difficulty = 3`. Not a default
that had never been overwritten — a literal 3 written by the ingest path onto
all 6,886 rows, on a column declared `nullable=False, default=3`. Two things
read it: a serialised field in the history payload, and the coaching prompt,
which told a language model "difficulty: 3" about every question ever asked.
Nothing in the adaptive path read it at all.

This revision does three things.

**The column is renamed to `published_difficulty` and emptied.** It now means
one thing only: a difficulty the *publisher* stated. The upstream datasets state
none, so it is NULL on every row, and the rename is what stops the next reader
assuming otherwise. `research/11-measurement-implementation-spec.md` § 5 asked
for exactly this — "an item enters with difficulty = NULL meaning uncalibrated…
a hardcoded 3 is worse than a null, because it silently poisons any downstream
targeting with fake information" — and it was never done.

No data is lost by emptying it. The value being discarded is the same constant
on every row, so there is nothing in it to preserve; `test_migration_preserves_data`
holds every other column to the opposite standard.

**`question_calibrations` and `learner_ratings` hold the estimate instead.** An
online Elo rating, one update per response, with the evidence behind it on the
row: how many responses, how much Fisher information, where they came from, and
how much of the exposure was independent of difficulty. See
`app/calibration.py`. Both tables start empty and stay empty until somebody
answers something, which is the correct state for a bank nobody has answered.

**`session_items.exposure_policy` and `attempts.exposure_policy` record how the
question was chosen.** 'blind' for every existing row, and that is not a
backfill guess: selection has never read difficulty, so exposure has in fact
been independent of it for the entire history of this application.

Revision ID: 0037_difficulty_calibration
Revises: 0036_sectioned_exam
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_difficulty_calibration"
down_revision = "0036_sectioned_exam"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {entry["name"] for entry in inspector.get_columns(table)}


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade():
    questions = _columns("questions")
    if "difficulty" in questions and "published_difficulty" not in questions:
        with op.batch_alter_table("questions") as batch_op:
            batch_op.alter_column(
                "difficulty",
                new_column_name="published_difficulty",
                existing_type=sa.Integer(),
                existing_nullable=False,
                existing_server_default=None,
                nullable=True,
            )
        # The whole column was one constant. Emptying it is what makes "we have
        # no published rating for this item" a fact the schema can express.
        op.execute(sa.text("UPDATE questions SET published_difficulty = NULL"))
    elif "published_difficulty" not in questions:
        with op.batch_alter_table("questions") as batch_op:
            batch_op.add_column(sa.Column("published_difficulty", sa.Integer(), nullable=True))

    if not _has_table("question_calibrations"):
        op.create_table(
            "question_calibrations",
            sa.Column(
                "question_id",
                sa.String(length=80),
                sa.ForeignKey("questions.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("rating", sa.Float(), nullable=False, server_default="0"),
            sa.Column("information", sa.Float(), nullable=False, server_default="0"),
            sa.Column("responses", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("correct", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("blind_rating", sa.Float(), nullable=False, server_default="0"),
            sa.Column("blind_information", sa.Float(), nullable=False, server_default="0"),
            sa.Column("blind_responses", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("targeted_responses", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="uncalibrated"),
            sa.Column("origin", sa.String(length=20), nullable=False, server_default="responses"),
            sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_response_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_question_calibrations_status", "question_calibrations", ["status"])
        op.create_index("ix_question_calibrations_origin", "question_calibrations", ["origin"])

    if not _has_table("learner_ratings"):
        op.create_table(
            "learner_ratings",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("scope", sa.String(length=60), nullable=False),
            sa.Column("rating", sa.Float(), nullable=False, server_default="0"),
            sa.Column("information", sa.Float(), nullable=False, server_default="0"),
            sa.Column("responses", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("correct", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "scope", name="uq_learner_rating_scope"),
        )
        op.create_index("ix_learner_ratings_user_id", "learner_ratings", ["user_id"])

    if "exposure_policy" not in _columns("session_items"):
        with op.batch_alter_table("session_items") as batch_op:
            batch_op.add_column(
                sa.Column("exposure_policy", sa.String(length=12), nullable=False, server_default="blind")
            )

    if "exposure_policy" not in _columns("attempts"):
        with op.batch_alter_table("attempts") as batch_op:
            batch_op.add_column(
                sa.Column("exposure_policy", sa.String(length=12), nullable=False, server_default="blind")
            )
        op.create_index("ix_attempts_exposure_policy", "attempts", ["exposure_policy"])


def downgrade():
    op.drop_index("ix_attempts_exposure_policy", table_name="attempts")
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("exposure_policy")
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("exposure_policy")
    op.drop_index("ix_learner_ratings_user_id", table_name="learner_ratings")
    op.drop_table("learner_ratings")
    op.drop_index("ix_question_calibrations_origin", table_name="question_calibrations")
    op.drop_index("ix_question_calibrations_status", table_name="question_calibrations")
    op.drop_table("question_calibrations")
    # Back to a non-null column, which needs a value in every row, and the only
    # value it ever held was 3.
    op.execute(sa.text("UPDATE questions SET published_difficulty = 3 WHERE published_difficulty IS NULL"))
    with op.batch_alter_table("questions") as batch_op:
        batch_op.alter_column(
            "published_difficulty",
            new_column_name="difficulty",
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=False,
        )
