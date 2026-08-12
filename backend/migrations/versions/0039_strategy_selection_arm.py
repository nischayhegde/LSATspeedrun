"""Record which approach was chosen by the record and which by a coin.

SINGLE HEAD. `down_revision` was `0038_question_type_source`, added on the same
branch, and a sibling did land on 0038 first: `0037_passage_paragraphs` revises
it, so this chain now continues from there instead. The file keeps its 0039
name — the revision id is what alembic reads, and renaming would strand any
database already stamped. Nothing here depends on ordering beyond being after
the tables it alters exist.

Two nullable columns on `session_items` and the same two on `attempts`, mirrored
the way every other strategy arm on those tables already is: the item carries
what was decided when the run was built, the attempt carries a copy taken when
the question was answered, and an analysis reads the attempt.

Nullable, and null means something specific rather than "old row". The
`strategy_selection` arm is only drawn where the two arms could disagree — past
the coverage target, on a question with more than one candidate approach. A
question that has neither has no counterfactual and takes no part in the
comparison, which is the same rule `strategy_forcing_propensity` next door
already follows. Rows written before this migration are null for the ordinary
reason as well, and both readings are correct: they were not in the trial.

No backfill, and there could not be one. The arm is a draw; a value invented
here would be a guess written into a column an estimator weights by.
"""

from alembic import op
import sqlalchemy as sa


revision = "0039_strategy_selection_arm"
down_revision = "0037_passage_paragraphs"
branch_labels = None
depends_on = None


COLUMNS = (
    ("strategy_selection_arm", lambda: sa.Column("strategy_selection_arm", sa.String(length=12), nullable=True)),
    ("strategy_selection_propensity", lambda: sa.Column("strategy_selection_propensity", sa.Float(), nullable=True)),
)


def _has_column(table: str, column: str) -> bool:
    return any(entry["name"] == column for entry in sa.inspect(op.get_bind()).get_columns(table))


def upgrade():
    for table in ("session_items", "attempts"):
        with op.batch_alter_table(table) as batch_op:
            for name, column in COLUMNS:
                if not _has_column(table, name):
                    batch_op.add_column(column())
    if not any(
        index["name"] == "ix_attempts_strategy_selection_arm"
        for index in sa.inspect(op.get_bind()).get_indexes("attempts")
    ):
        op.create_index(
            "ix_attempts_strategy_selection_arm", "attempts", ["strategy_selection_arm"]
        )


def downgrade():
    op.drop_index("ix_attempts_strategy_selection_arm", table_name="attempts")
    for table in ("session_items", "attempts"):
        with op.batch_alter_table(table) as batch_op:
            for name, _column in COLUMNS:
                batch_op.drop_column(name)
