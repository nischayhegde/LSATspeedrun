"""Rejoin the two revisions that both claimed 0022 as their parent.

Two branches were authored against `0022_mega_litigation_deadline` in parallel:
`0023_blind_review` upstream, and `0023_focus_mode_and_propensity` here, which
this repo then built nine more revisions on top of. Nothing about them actually
conflicts — blind review only touches `study_sessions`, while focus mode only
touches `users`, `session_items` and `attempts` — but two heads is still a hard
failure, and `flask db upgrade` refuses to run at all rather than pick one.

The sandbox database was already stamped `0023_blind_review` by a deploy from
upstream's tree, so deleting that revision was not an option: the database had
genuinely run it, and a chain that omits it would describe a history that never
happened. This merge point lets that database walk the branch it missed
(`0023_focus_mode_and_propensity` through `0032_district_retainers`) and arrive
at a single head, while a database built from empty gets both branches in
either order.

Deliberately empty. The two parents already did the work; this revision exists
only to make the graph converge.

Note for anyone reading `models.py` and finding this confusing: the blind review
*feature* was excluded from this branch, so `StudySession` does not declare
`diagnostic_session_id` or `blind_review_required`. The columns exist in the
database and nothing reads them. That is intentional and is not drift to
"repair" — dropping them would break the sandbox database's applied history
again.

Revision ID: 0033_merge_blind_review
Revises: 0023_blind_review, 0032_district_retainers
"""

revision = "0033_merge_blind_review"
down_revision = ("0023_blind_review", "0032_district_retainers")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
