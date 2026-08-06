"""Record enforced strategy use rather than self-reported strategy use.

`attempts.strategy_applied` has always been a student ticking a box to say they
used the suggested approach. These columns are the observable version of the
same claim, produced by the gates in `app/enforcement.py`:

* `session_items.strategy_enforcement_level` — how hard the gate on that
  question was, decided at serve time.
* `attempts.strategy_gate_status` — satisfied, skipped, attested, or unenforced.
* `attempts.strategy_artifact_json` — what the student actually produced.
* `attempts.strategy_gate_ms` — time inside the gate, kept apart from
  `server_elapsed_ms` so enforcement does not corrupt pace, exactly as
  `strategy_prompt_ms` already does for the prompt itself.
* `attempts.strategy_enforcement_version` — which revision of the required
  operations produced the artifact, so an analysis never pools two different
  treatments.
* `attempts.strategy_artifact_quality` — an advisory model score, nullable and
  never consulted by scoring or the economy.

Nothing is backfilled. Every existing attempt predates enforcement, and giving
those rows a gate status would assert something about them that was never
observed. They keep a null status, which reads correctly as "no gate existed".

Revision ID: 0028_strategy_enforcement
Revises: 0027_projection_and_memory_model
"""

from alembic import op
import sqlalchemy as sa


revision = "0028_strategy_enforcement"
down_revision = "0027_projection_and_memory_model"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        if not _has_column("session_items", "strategy_enforcement_level"):
            batch_op.add_column(
                sa.Column("strategy_enforcement_level", sa.String(length=12), nullable=False, server_default="none")
            )

    with op.batch_alter_table("attempts") as batch_op:
        if not _has_column("attempts", "strategy_gate_status"):
            batch_op.add_column(sa.Column("strategy_gate_status", sa.String(length=20), nullable=True))
        if not _has_column("attempts", "strategy_enforcement_level"):
            batch_op.add_column(sa.Column("strategy_enforcement_level", sa.String(length=12), nullable=True))
        if not _has_column("attempts", "strategy_enforcement_version"):
            batch_op.add_column(sa.Column("strategy_enforcement_version", sa.String(length=30), nullable=True))
        if not _has_column("attempts", "strategy_artifact_json"):
            batch_op.add_column(sa.Column("strategy_artifact_json", sa.JSON(), nullable=True))
        if not _has_column("attempts", "strategy_gate_ms"):
            batch_op.add_column(sa.Column("strategy_gate_ms", sa.Integer(), nullable=False, server_default="0"))
        if not _has_column("attempts", "strategy_artifact_quality"):
            batch_op.add_column(sa.Column("strategy_artifact_quality", sa.Float(), nullable=True))

    op.create_index("ix_attempts_strategy_gate_status", "attempts", ["strategy_gate_status"])


def downgrade():
    op.drop_index("ix_attempts_strategy_gate_status", table_name="attempts")
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("strategy_artifact_quality")
        batch_op.drop_column("strategy_gate_ms")
        batch_op.drop_column("strategy_artifact_json")
        batch_op.drop_column("strategy_enforcement_version")
        batch_op.drop_column("strategy_enforcement_level")
        batch_op.drop_column("strategy_gate_status")
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("strategy_enforcement_level")
