"""Surgical text fixes on a lived-in demo.db. Does not reseed or touch users."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPLACEMENTS = (
    ("Then??,", "Then,"),
    ("Then??", "Then,"),
    ("Passage AUntil", "Passage A Until"),
    ("Passage BUntil", "Passage B Until"),
)


def _shift_offsets(offsets, replacements: list[tuple[int, int]]) -> list[int]:
    """Move stored paragraph starts that sit after a length-changing edit.

    An offset that lands on the edit itself is left alone: the part still
    opens at that character, just on the repaired text.
    """
    shifted = []
    for offset in offsets:
        delta = sum(change for position, change in replacements if offset > position)
        shifted.append(offset + delta)
    return shifted


def _apply(text: str, offsets_raw, needle: str, replacement: str):
    if needle not in text:
        return text, offsets_raw, 0
    hits = []
    start = 0
    while True:
        index = text.find(needle, start)
        if index < 0:
            break
        hits.append(index)
        start = index + len(needle)
    new_text = text.replace(needle, replacement)
    delta = len(replacement) - len(needle)
    if offsets_raw in (None, "", "null"):
        return new_text, offsets_raw, len(hits)
    offsets = json.loads(offsets_raw) if isinstance(offsets_raw, str) else list(offsets_raw)
    return new_text, json.dumps(_shift_offsets(offsets, [(pos, delta) for pos in hits])), len(hits)


def patch(database: Path) -> dict[str, int]:
    con = sqlite3.connect(str(database))
    cur = con.cursor()
    found = {needle: 0 for needle, _ in REPLACEMENTS}
    rows = list(cur.execute("SELECT id, canonical_text, paragraph_offsets FROM passages"))
    updated = 0
    for passage_id, text, offsets in rows:
        original = text or ""
        new_text = original
        new_offsets = offsets
        dirty = False
        for needle, replacement in REPLACEMENTS:
            new_text, new_offsets, hits = _apply(new_text, new_offsets, needle, replacement)
            if hits:
                found[needle] += hits
                dirty = True
        if not dirty:
            continue
        cur.execute(
            "UPDATE passages SET canonical_text = ?, paragraph_offsets = ? WHERE id = ?",
            (new_text, new_offsets, passage_id),
        )
        updated += 1
    con.commit()
    leftover = {}
    for needle, _ in REPLACEMENTS:
        leftover[needle] = cur.execute(
            "SELECT count(*) FROM passages WHERE canonical_text LIKE ?",
            (f"%{needle}%",),
        ).fetchone()[0]
        leftover[f"q:{needle}"] = cur.execute(
            "SELECT count(*) FROM questions WHERE stimulus LIKE ? OR stem LIKE ?",
            (f"%{needle}%", f"%{needle}%"),
        ).fetchone()[0]
    users = cur.execute("SELECT count(*) FROM users").fetchone()[0]
    sessions = cur.execute("SELECT count(*) FROM study_sessions").fetchone()[0]
    then_row = cur.execute(
        "SELECT instr(canonical_text, 'Then, subjected'), instr(canonical_text, 'Then??') "
        "FROM passages WHERE id = 'hf-rc-passage:31a04c1373882e47bdeba8f2'"
    ).fetchone()
    con.close()
    return {
        "updated_passages": updated,
        "users": users,
        "sessions": sessions,
        "then_subjected_at": then_row[0] if then_row else None,
        "then_qq_at": then_row[1] if then_row else None,
        **{f"found:{k}": v for k, v in found.items()},
        **{f"leftover:{k}": v for k, v in leftover.items()},
    }


if __name__ == "__main__":
    path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else Path(__file__).resolve().parents[1] / "instance" / "demo.db"
    )
    print(path.resolve())
    print(patch(path.resolve()))
