"""Solver battery for generated RC items: blind-solvability and defensibility.

Reproduces the test that condemned LLM-written Logical Reasoning in
`04-item-generation.md`, where 19 of 24 items were solved by four independent
models with the stimulus deleted. The same battery is run here against
generated Reading Comprehension, using four genuinely independent model
families rather than repeated samples of one, so the comparison is like-for-like.

Conditions:
  blind  stem and five choices only, passage deleted. A correct answer here is
         a surface cue: the item can be solved without reading anything.
  full   passage included. This is the sanity check; an item that the models
         cannot solve WITH the passage is likely broken rather than hard.

The gap between the two is the quantity of interest. Blind at chance with full
well above chance means the passage is doing the work.

A third pass (`--defensibility`) asks a strong model to look for a second
defensible answer, which `04` identified as the harder failure mode and which
surface statistics cannot detect.

Usage:
    python rcgen_eval.py --items /tmp/rcgen/items_bal.jsonl --out /tmp/rcgen/eval.json
    python rcgen_eval.py --items ... --defensibility --out /tmp/rcgen/defensibility.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rcgen_llm import chat, spend_summary  # noqa: E402

SOLVERS = ["claude-haiku-4-5", "gemini-2.5-flash", "llama4-maverick", "qwen3-32b"]
LETTERS = "ABCDE"

BLIND_SYSTEM = """You are taking a reading comprehension test, but the passage is missing.

You are given only the question and the five answer choices. Choose the answer
you judge most likely to be the credited response. You must pick one; guessing
from the wording of the choices is expected and is the point of the exercise.

Return JSON: {"answer": "A"} using a single letter A-E."""

FULL_SYSTEM = """You are taking a reading comprehension test.

Read the passage and answer the question. Exactly one choice is correct.

Return JSON: {"answer": "A"} using a single letter A-E."""

DEFENSIBILITY_SYSTEM = """You are a test-development reviewer checking a Reading Comprehension item
for the flaw that most often makes an item unusable: more than one defensible answer.

The item's intended correct answer is given. Your job is adversarial. For each
of the other four choices, decide whether a well-prepared, careful test taker
could argue for it using the passage text. Do not be generous: a choice is
defensible only if the passage genuinely supports it, not merely if it sounds
reasonable.

Also judge whether the intended answer is in fact supported by the passage.

Return JSON:
{"intended_is_supported": true,
 "other_defensible_indices": [],
 "verdict": "clean" | "ambiguous" | "intended_unsupported",
 "note": "at most 25 words"}"""


def parse_letter(obj) -> int | None:
    if not isinstance(obj, dict):
        return None
    val = obj.get("answer")
    if isinstance(val, int) and 0 <= val < 5:
        return val
    if isinstance(val, str) and val.strip():
        ch = val.strip()[0].upper()
        if ch in LETTERS:
            return LETTERS.index(ch)
    return None


def solve(item: dict, model: str, blind: bool) -> int | None:
    payload = {
        "question": item["question"],
        "choices": {LETTERS[i]: a for i, a in enumerate(item["answers"])},
    }
    if not blind:
        payload = {"passage": item["context"], **payload}
    try:
        obj, _ = chat(
            BLIND_SYSTEM if blind else FULL_SYSTEM,
            payload,
            tag=f"{'blind' if blind else 'full'}_{model}",
            model=model, max_tokens=1500, reasoning_effort=None,
        )
    except Exception:
        return None
    return parse_letter(obj)


def check_defensibility(item: dict, model: str) -> dict:
    payload = {
        "passage": item["context"],
        "question": item["question"],
        "choices": {LETTERS[i]: a for i, a in enumerate(item["answers"])},
        "intended_answer": LETTERS[item["label"]],
    }
    try:
        obj, _ = chat(DEFENSIBILITY_SYSTEM, payload, tag="defensibility",
                      model=model, max_tokens=2500, reasoning_effort=None)
    except Exception as exc:  # noqa: BLE001
        return {"verdict": "error", "note": str(exc)[:60]}
    return obj


def run_battery(items: list[dict], workers: int) -> dict:
    jobs = [(it, m, blind) for it in items for m in SOLVERS for blind in (True, False)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        picks = list(pool.map(lambda j: solve(*j), jobs))

    by: dict[tuple[str, bool], dict[str, int | None]] = defaultdict(dict)
    for (it, m, blind), pick in zip(jobs, picks):
        by[(m, blind)][it["item_id"]] = pick

    per_model = {}
    for m in SOLVERS:
        for blind in (True, False):
            res = by[(m, blind)]
            scored = [(iid, p) for iid, p in res.items() if p is not None]
            correct = sum(1 for iid, p in scored
                          if p == next(i["label"] for i in items if i["item_id"] == iid))
            per_model[f"{m}|{'blind' if blind else 'full'}"] = {
                "n_answered": len(scored),
                "accuracy": round(correct / len(scored), 4) if scored else None,
            }

    # Per-item consensus: how many of the four solvers got it blind.
    blind_hits, full_hits = {}, {}
    for it in items:
        blind_hits[it["item_id"]] = sum(
            1 for m in SOLVERS if by[(m, True)].get(it["item_id"]) == it["label"])
        full_hits[it["item_id"]] = sum(
            1 for m in SOLVERS if by[(m, False)].get(it["item_id"]) == it["label"])

    n = len(items)
    blind_mean = statistics.fmean(per_model[f"{m}|blind"]["accuracy"] or 0 for m in SOLVERS)
    full_mean = statistics.fmean(per_model[f"{m}|full"]["accuracy"] or 0 for m in SOLVERS)

    return {
        "n_items": n,
        "solvers": SOLVERS,
        "per_model": per_model,
        "mean_blind_accuracy": round(blind_mean, 4),
        "mean_full_accuracy": round(full_mean, 4),
        "passage_lift": round(full_mean - blind_mean, 4),
        "chance": 0.2,
        "blind_consensus_distribution": {
            f"solved_by_{k}_of_4": sum(1 for v in blind_hits.values() if v == k) for k in range(5)
        },
        "items_solved_blind_by_all_4": round(
            sum(1 for v in blind_hits.values() if v == 4) / n, 4),
        "items_solved_blind_by_majority": round(
            sum(1 for v in blind_hits.values() if v >= 3) / n, 4),
        "items_no_solver_blind": round(sum(1 for v in blind_hits.values() if v == 0) / n, 4),
        "items_solved_full_by_all_4": round(
            sum(1 for v in full_hits.values() if v == 4) / n, 4),
        "items_no_solver_full": round(sum(1 for v in full_hits.values() if v == 0) / n, 4),
        "per_item": {
            iid: {"blind": blind_hits[iid], "full": full_hits[iid]} for iid in blind_hits
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--items", required=True)
    ap.add_argument("--out")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--defensibility", action="store_true")
    ap.add_argument("--judge", default="claude-haiku-4-5")
    args = ap.parse_args()

    items = [json.loads(l) for l in Path(args.items).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        items = items[: args.limit]

    if args.defensibility:
        print(f"defensibility review of {len(items)} items with {args.judge}")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            verdicts = list(pool.map(lambda it: check_defensibility(it, args.judge), items))
        counts = Counter(v.get("verdict", "error") for v in verdicts)
        n = len(items)
        result = {
            "n_items": n, "judge": args.judge,
            "verdicts": dict(counts),
            "clean_rate": round(counts.get("clean", 0) / n, 4),
            "ambiguous_rate": round(counts.get("ambiguous", 0) / n, 4),
            "intended_unsupported_rate": round(counts.get("intended_unsupported", 0) / n, 4),
            "flagged": [
                {"item_id": it["item_id"], "type": it.get("question_type"),
                 "verdict": v.get("verdict"), "note": v.get("note"),
                 "others": v.get("other_defensible_indices")}
                for it, v in zip(items, verdicts) if v.get("verdict") != "clean"
            ][:40],
        }
    else:
        print(f"solving {len(items)} items x {len(SOLVERS)} models x 2 conditions "
              f"= {len(items) * len(SOLVERS) * 2} calls")
        result = run_battery(items, args.workers)

    printable = {k: v for k, v in result.items() if k not in {"per_item", "flagged"}}
    print(json.dumps(printable, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")
    print("spend:", json.dumps(spend_summary()["by_tag"], indent=2))


if __name__ == "__main__":
    main()
