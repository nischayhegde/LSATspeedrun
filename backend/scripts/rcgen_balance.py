"""Equalize answer-choice lengths on generated RC items.

Generation prompts the model for length parity and the model ignores it: the
first 98-item run scored `pick_longest_accuracy` 0.4286 against a 0.25 ceiling
and Cohen's *d* 0.4666 against 0.20, versus 0.1796 and 0.026 in real LSAT RC.
This is the same pattern seen in condensation, where asking for a word count
failed and measuring-then-repairing worked, so the same remedy is applied: only
the items that actually fail are sent back, with their measured numbers, to have
all five choices rewritten to a common length.

The correct answer's *content* is fixed. The model is told which choice is
correct and why, and is instructed to preserve every choice's meaning and
truth value while changing only its wording and length. Items whose repaired
version does not improve length parity are kept in their original form.

Usage:
    python rcgen_balance.py --items /tmp/rcgen/items.jsonl --out /tmp/rcgen/items_bal.jsonl
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rcgen_llm import chat, spend_summary  # noqa: E402

SYSTEM = """You are normalizing the answer choices of a standardized test item so that
choice length carries no information about which choice is correct.

In real LSAT items the correct answer has no length advantage (Cohen's d = 0.026,
and picking the longest choice scores below chance). In the item you are given,
the correct choice is conspicuously longer, which gives it away.

Rewrite ALL FIVE choices so that they are within a few words of one another and
of the target length given. Requirements, in order of importance:

1. Do not change which choice is correct. The correct choice must remain
   correct, and each distractor must remain wrong for the same reason it was
   wrong before. You are given those reasons; preserve them.
2. Do not change any choice's meaning. Change wording and length only.
3. The correct choice must NOT be the longest. It is best if it is neither the
   longest nor the shortest.
4. Shorten the correct choice by cutting hedging padding and restatement, not by
   dropping the qualification that makes it correct. Lengthen short distractors
   by making them more specific, not by adding filler.
5. Keep the trap quality of distractors: an over-strong absolute ("all",
   "never", "only") should stay in a distractor, never move to the correct one.

Return JSON with the five choices IN THE SAME ORDER as given:
{"answers": ["...", "...", "...", "...", "..."]}"""


def stats(item: dict) -> tuple[int, float, bool]:
    lens = [len(a) for a in item["answers"]]
    correct = lens[item["label"]]
    others = [l for i, l in enumerate(lens) if i != item["label"]]
    return correct, statistics.fmean(others), correct == max(lens)


def needs_repair(item: dict, slack: int = 12) -> bool:
    correct, mean_other, is_longest = stats(item)
    return is_longest or (correct - mean_other) > slack


def balance(item: dict) -> dict:
    correct_len, mean_other, _ = stats(item)
    target = round((correct_len + mean_other * 4) / 5)
    target = max(70, min(target, 200))
    payload = {
        "stem": item["question"],
        "answers": item["answers"],
        "correct_index": item["label"],
        "why_correct": item.get("why_correct"),
        "why_wrong": item.get("why_wrong"),
        "current_lengths_chars": [len(a) for a in item["answers"]],
        "target_length_chars_each": target,
        "passage": item["context"],
    }
    try:
        obj, _ = chat(SYSTEM, payload, tag="balance", max_tokens=3000)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL {item['item_id']}: {exc}", file=sys.stderr)
        return item

    new = [str(a).strip() for a in (obj.get("answers") or []) if str(a).strip()]
    if len(new) != 5:
        return item

    cand = dict(item, answers=new)

    def penalty(it: dict) -> float:
        c, m, longest = stats(it)
        return abs(c - m) + (100 if longest else 0)

    if penalty(cand) < penalty(item):
        cand["length_balanced"] = True
        return cand
    return item


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--items", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--slack", type=int, default=12)
    args = ap.parse_args()

    items = [json.loads(l) for l in Path(args.items).read_text(encoding="utf-8").splitlines() if l.strip()]
    todo = [i for i in items if needs_repair(i, args.slack)]
    print(f"{len(todo)}/{len(items)} items need length balancing")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        fixed = {id(x): y for x, y in zip(todo, pool.map(balance, todo))}
    out_items = [fixed.get(id(i), i) for i in items]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for it in out_items:
            fh.write(json.dumps(it, ensure_ascii=False) + "\n")
    slim = out.with_name(out.stem + "_slim.jsonl")
    with slim.open("w", encoding="utf-8") as fh:
        for it in out_items:
            fh.write(json.dumps({k: it[k] for k in
                                 ("context", "question", "answers", "label", "id_string")},
                                ensure_ascii=False) + "\n")
    n_changed = sum(1 for i in out_items if i.get("length_balanced"))
    print(f"wrote {out} ({n_changed} rewritten) and {slim}")
    print("spend:", json.dumps(spend_summary(), indent=2))


if __name__ == "__main__":
    main()
