"""Say where a question's type came from.

SINGLE HEAD. `down_revision` is `0037_layer_assignments`, added in the same
change. If a sibling revision lands on 0036 first, rebase both files in order.

One nullable-free column with a server default, so every existing row reads as
"unrecorded" the moment the upgrade lands: their types were written by rules
nobody kept a record of, which is a weaker claim than either "a rule matched
this stem" or "the bank labelled it", and pretending otherwise would put a
confidence on 6,886 rows that nothing supports.

**This migration does not retype anything.** Inference belongs at ingest, where
the stem is in hand and the rules can be tested, not inside a schema change
where it would run once against whatever the code said that day and never be
checked again. Applying the new types is a re-seed:

    flask db upgrade
    flask seed --force

`seed_questions` upserts by id, so a forced re-seed rewrites `question_type`
and `question_type_source` in place and touches nothing else about a row —
attempts, review cards and skill history all key off ids that do not move.

One consequence worth knowing before running it. `skill_progress` rows are
keyed by the *name* of a question type, so a question moving from "Logical
Reasoning" to "Sufficient Assumption" leaves its old skill row behind under the
old name and starts a new one. That is the correct behaviour — the old row is a
true record of answers filed against a bucket that meant "untyped" — but it
does mean the skill list grows a tail of placeholder-named rows that will stop
gaining answers. Nothing reads them except the history breakdown, where they
are honest.
"""

from alembic import op
import sqlalchemy as sa


revision = "0038_question_type_source"
down_revision = "0037_layer_assignments"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return any(entry["name"] == column for entry in sa.inspect(op.get_bind()).get_columns(table))


def upgrade():
    if _has_column("questions", "question_type_source"):
        return
    with op.batch_alter_table("questions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "question_type_source",
                sa.String(length=24),
                nullable=False,
                server_default="unrecorded",
            )
        )


def downgrade():
    with op.batch_alter_table("questions") as batch_op:
        batch_op.drop_column("question_type_source")
