"""Administer the mega-litigation in separately timed sections.

The full-length form ran as one continuous queue under one whole-form
countdown. A real LSAT is not that: it is separately timed thirty-five-minute
sections, each of which ends permanently when its own clock expires, with a
ten-minute intermission after the second one. This revision adds the rows that
make a section a real thing rather than a label on the results screen.

`session_sections` is the authority on when a section started, when it must
end, and how it ended. It exists as a table rather than as JSON on the session
because these are the columns the dashboard groups by — accuracy against the
section's own length, whether the clock ran out, how many questions were left
blank at the bell — and a JSON blob would make every one of those a full scan
plus a decode.

Nothing is backfilled, and that is deliberate. A mega-litigation already
in progress has no sections, and `exam.is_sectioned` treats the absence as
"this form runs on the whole-form deadline it was created under". A student
part-way through a sitting finishes it under the rules they started it under,
which is the only defensible way to change the rules of a timed test underneath
someone.

`session_items` gains the two facts free navigation makes measurable for the
first time. `flagged` is the test interface's own flag, kept server-side
because "flagged and never returned to" is a real read-out on how a section was
triaged and a browser-only flag would not survive a reload. `answer_revisions`
counts replacements on the sheet, which replaces a client-reported
`answer_changed` boolean with something observed.

Revision ID: 0035_sectioned_exam
Revises: 0034_comparative_passages
"""

from alembic import op
import sqlalchemy as sa


revision = "0035_sectioned_exam"
down_revision = "0034_comparative_passages"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade():
    if not _has_table("session_sections"):
        op.create_table(
            "session_sections",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "session_id",
                sa.String(length=36),
                sa.ForeignKey("study_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("section_index", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(length=60), nullable=False),
            sa.Column("section_type", sa.String(length=60), nullable=False),
            sa.Column("start_position", sa.Integer(), nullable=False),
            sa.Column("end_position", sa.Integer(), nullable=False),
            sa.Column("question_count", sa.Integer(), nullable=False),
            sa.Column("time_limit_seconds", sa.Integer(), nullable=False),
            sa.Column("break_seconds", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_reason", sa.String(length=20), nullable=True),
            sa.Column("unanswered_count", sa.Integer(), nullable=False, server_default="0"),
            sa.UniqueConstraint("session_id", "section_index", name="uq_session_section_index"),
        )
        op.create_index("ix_session_sections_session_id", "session_sections", ["session_id"])
        op.create_index("ix_session_sections_status", "session_sections", ["status"])

    if not _has_column("study_sessions", "intermission_started_at"):
        with op.batch_alter_table("study_sessions") as batch_op:
            batch_op.add_column(
                sa.Column("intermission_started_at", sa.DateTime(timezone=True), nullable=True)
            )

    with op.batch_alter_table("session_items") as batch_op:
        if not _has_column("session_items", "flagged"):
            batch_op.add_column(
                sa.Column("flagged", sa.Boolean(), nullable=False, server_default=sa.false())
            )
        if not _has_column("session_items", "answer_revisions"):
            batch_op.add_column(
                sa.Column("answer_revisions", sa.Integer(), nullable=False, server_default="0")
            )


def downgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("answer_revisions")
        batch_op.drop_column("flagged")
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_column("intermission_started_at")
    op.drop_index("ix_session_sections_status", table_name="session_sections")
    op.drop_index("ix_session_sections_session_id", table_name="session_sections")
    op.drop_table("session_sections")
