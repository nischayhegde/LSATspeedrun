"""Record where each passage divides, and where those divisions came from.

Every one of the 349 Reading Comprehension passages in this bank arrived as a
single unbroken run of prose. Not one contains a newline, a carriage return, a
tab, a doubled space, a line separator or a non-breaking space — checked against
the pinned snapshots rather than the database, so the breaks were lost upstream of
this application and there was never anything here to parse them out of.

Two of the six Reading Comprehension approaches are built on that missing
structure. `enforcement.split_paragraphs` found no break and returned the whole
passage as one unit, so "give each paragraph its job in three to twelve words"
asked for a single note covering three thousand characters, and
`paragraph_function`'s variety check — which needs more than one segment before it
has anything to compare — was skipped on every question in the section. The
technique was not described badly; it was defeated.

`paragraph_offsets` holds character positions in `canonical_text`, the first
always 0. Positions rather than a second copy of the prose, so a segmentation
cannot drift from the text it describes, and `passage_structure.offsets_are_usable`
rejects any list that no longer fits its passage in favour of one undivided part.

`paragraph_source` is the provenance, and it exists because the two kinds of
boundary do not deserve equal trust. "authored" means the text carried real breaks
and they were believed. "derived_cohesion_v1" means this application found them by
lexical cohesion, which on the only boundaries in this bank that are genuinely
known — the Passage A/B seam on the 32 comparative sets, with the headings
stripped so the segmenter cannot see them — locates the region of a real boundary
far better than chance (26 of 32 within one sentence, which chance matched in 1 of
300 draws) and does not pin the exact sentence better than chance (11 of 32
against 7.9 expected). Topical, then, and not authored, which is why the gate copy
now asks what each "part" of the passage is doing.

## No backfill here, deliberately

This revision adds the two columns and stops. Null on both reads as no
segmentation, which is exactly the one-part behaviour that shipped before them, so
an un-backfilled database is degraded rather than broken.

The rows are written by `app/seed.py` at ingest, beside `comparative`, and into an
existing database by `scripts/derive_passage_paragraphs.py --apply`. Keeping the
derivation out of the migration is a departure from 0034, which copied its heading
regex in so the revision would keep producing identical rows, and the reason is
that the same trick does not survive here: this derivation is three hundred lines
of lexical scoring, and a point-in-time copy of it inside a migration would be a
second implementation to keep correct. Data this uncertain also wants to be looked
at before it is written — `--verify` scores the segmenter and `--sample` prints
whole passages to read — and a migration that runs on deploy is the wrong place
for a step whose whole point is that somebody checked it.

Revision ID: 0037_passage_paragraphs
Revises: 0036_sectioned_exam
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_passage_paragraphs"
down_revision = "0036_sectioned_exam"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    with op.batch_alter_table("passages") as batch_op:
        if not _has_column("passages", "paragraph_offsets"):
            batch_op.add_column(sa.Column("paragraph_offsets", sa.JSON(), nullable=True))
        if not _has_column("passages", "paragraph_source"):
            batch_op.add_column(sa.Column("paragraph_source", sa.String(length=40), nullable=True))


def downgrade():
    with op.batch_alter_table("passages") as batch_op:
        batch_op.drop_column("paragraph_source")
        batch_op.drop_column("paragraph_offsets")
