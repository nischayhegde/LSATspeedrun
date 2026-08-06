"""Remember that the closing record has been read, on the account.

The epilogue is a full-screen, once-ever layer. Its "already read" marker lived
only in the browser's localStorage, so a player who finished the campaign was
handed the entire final record again the moment they opened the app on a second
device, in a private window, or after clearing site data — on whatever route
they happened to be going to.

`player_story_states.epilogue_read_at` fixes that the same way
`users.guided_tour_completed_at` fixed it for first-use orientation: the
acknowledgement belongs to the account, not to one browser profile.

Existing players start NULL, which reads as "not yet acknowledged here". Anyone
who has already closed it keeps their local marker and is not re-shown it, and
the first close on any device records it for good.

Revision ID: 0030_epilogue_acknowledgement
Revises: 0029_rival_campaign_casework
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_epilogue_acknowledgement"
down_revision = "0029_rival_campaign_casework"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    if _has_column("player_story_states", "epilogue_read_at"):
        return
    with op.batch_alter_table("player_story_states") as batch_op:
        batch_op.add_column(sa.Column("epilogue_read_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("player_story_states") as batch_op:
        batch_op.drop_column("epilogue_read_at")
