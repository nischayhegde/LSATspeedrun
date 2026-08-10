"""Record on the passage whether it prints two passages as one set.

`comparative_matrix` is the one approach in the catalogue built for a format the
bank never labels: every Reading Comprehension passage carries the literal
`passage_type` "Reading Comprehension" and no `question_type` has ever contained
the word "comparative". The approach was made reachable by inferring the format
from the passage text on every request, which worked and left two problems that
this column closes.

The first is that the answer never changes. Whether a set prints two passages is
fixed the moment the text is stored, so deciding it per request is work with a
constant result, on a path that runs for every question served.

The second is that read-time inference had to reach the sets whose headings it
could not match by reading the *question stems* — a stem saying "both passages"
stood in for a heading pair the regex missed. That put the decision on the
question instead of on the set, so one question could be comparative while its
siblings on the same two passages were not, and a single-passage question whose
stem happened to name "Passage A" was comparative on its own.

Both go away here. The format is decided once, from the passage, and stored.

The backfill marks 32 of the 349 passages in the bank, carrying 200 of its 2,366
Reading Comprehension questions. That number is checkable rather than merely
plausible: Comparative Reading was introduced on the June 2007 LSAT and every
Reading Comprehension section since has had exactly one comparative set in four.
This bank holds 77 dated US forms. All 30 dated June 2007 or later come out with
exactly one comparative set, all 47 before it come out with none, and the two
remaining sets are on the two LSAT India forms, one each. There is no form the
detection gives two, and none from 2007 on that it gives zero.

The heading pattern below is a point-in-time copy of `_COMPARATIVE_HEADINGS` in
`app/strategies.py` rather than an import of it, so that this revision keeps
producing the same rows if that module is later changed. The negative lookahead
where a word boundary would be more obvious is deliberate: six of the thirty-two
sets stored the heading with the following space eaten ("Passage AUntil
recently, conservationists"), and `\b` cannot match between "A" and "U". Those
six are the difference between all thirty post-2007 forms having a comparative
set and only twenty-four of them having one.

Revision ID: 0034_comparative_passages
Revises: 0033_merge_blind_review
"""

import re

from alembic import op
import sqlalchemy as sa


revision = "0034_comparative_passages"
down_revision = "0033_merge_blind_review"
branch_labels = None
depends_on = None


HEADINGS = re.compile(r"Passage A(?![a-z])[\s\S]{100,}?Passage B(?![a-z])")


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    if not _has_column("passages", "comparative"):
        with op.batch_alter_table("passages") as batch_op:
            batch_op.add_column(
                sa.Column("comparative", sa.Boolean(), nullable=False, server_default=sa.false())
            )

    bind = op.get_bind()
    passages = sa.table(
        "passages",
        sa.column("id", sa.String),
        sa.column("canonical_text", sa.Text),
        sa.column("passage_type", sa.String),
        sa.column("comparative", sa.Boolean),
    )
    # Read and matched in Python rather than pushed into the database as a LIKE:
    # neither SQLite nor Postgres shares the regex this detection is defined by,
    # and 349 passages is small enough that correctness is the only thing worth
    # optimising for. Marked in one statement per matching row and left alone
    # otherwise, so the column's server default carries every passage that is
    # not a comparative set.
    rows = bind.execute(
        sa.select(passages.c.id, passages.c.canonical_text, passages.c.passage_type)
    ).fetchall()
    for row in rows:
        labelled = "compar" in (row.passage_type or "").lower()
        if labelled or HEADINGS.search(row.canonical_text or ""):
            bind.execute(
                passages.update().where(passages.c.id == row.id).values(comparative=True)
            )


def downgrade():
    with op.batch_alter_table("passages") as batch_op:
        batch_op.drop_column("comparative")
