"""Refresh the repository-local LSAT question snapshot from Hugging Face."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import requests


DATASET_API_URL = "https://huggingface.co/api/datasets"
ROWS_API_URL = "https://datasets-server.huggingface.co/rows"
DATASETS = ("tasksource/lsat-lr", "tasksource/lsat-rc")
SPLITS = ("train", "validation", "test")
PAGE_SIZE = 100
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "question_bank"


def request_json(url: str, *, params: dict | None = None) -> dict:
    for attempt in range(8):
        response = requests.get(url, params=params, timeout=60)
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            try:
                delay = max(1.0, float(retry_after)) if retry_after else min(90.0, 10.0 * (attempt + 1))
            except ValueError:
                delay = min(90.0, 10.0 * (attempt + 1))
            print(f"Rate limited; retrying in {delay:.1f}s", flush=True)
            time.sleep(delay)
            continue
        if response.status_code >= 500 and attempt < 7:
            time.sleep(min(30.0, 2.0**attempt))
            continue
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"Unexpected response from {url}")
        return payload
    raise RuntimeError(f"No successful response from {url}")


def dataset_revision(dataset: str) -> str:
    payload = request_json(f"{DATASET_API_URL}/{dataset}")
    revision = payload.get("sha")
    if not isinstance(revision, str) or not revision:
        raise RuntimeError(f"Hugging Face did not return a revision for {dataset}")
    return revision


def write_split(dataset: str, split: str, destination: Path, interval: float) -> tuple[int, str]:
    offset = 0
    total = None
    digest = hashlib.sha256()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as snapshot:
        while total is None or offset < total:
            payload = request_json(
                ROWS_API_URL,
                params={
                    "dataset": dataset,
                    "config": "default",
                    "split": split,
                    "offset": offset,
                    "length": PAGE_SIZE,
                },
            )
            wrappers = payload.get("rows")
            total = payload.get("num_rows_total")
            if not isinstance(wrappers, list) or not isinstance(total, int):
                raise RuntimeError(f"Unexpected rows response for {dataset} ({split})")
            if not wrappers and offset < total:
                raise RuntimeError(f"Incomplete rows response for {dataset} ({split})")
            for wrapper in wrappers:
                row = wrapper.get("row") if isinstance(wrapper, dict) else None
                if not isinstance(row, dict):
                    raise RuntimeError(f"Invalid row for {dataset} ({split}) at offset {offset}")
                encoded = (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
                    "utf-8"
                )
                snapshot.write(encoded)
                digest.update(encoded)
            offset += len(wrappers)
            print(f"{dataset} {split}: {offset}/{total}", flush=True)
            if offset < total and interval:
                time.sleep(interval)
    return offset, digest.hexdigest()


def refresh(output: Path, interval: float) -> None:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    revisions_before = {dataset: dataset_revision(dataset) for dataset in DATASETS}
    manifest: dict = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Hugging Face Dataset Server",
        "datasets": {},
        "total_questions": 0,
    }
    with TemporaryDirectory(prefix="question-bank-", dir=output.parent) as temporary:
        staging = Path(temporary)
        for dataset in DATASETS:
            slug = dataset.rsplit("/", 1)[-1]
            dataset_manifest = {
                "url": f"https://huggingface.co/datasets/{dataset}",
                "revision": revisions_before[dataset],
                "splits": {},
                "total_questions": 0,
            }
            for split in SPLITS:
                relative_path = Path(slug) / f"{split}.jsonl"
                rows, sha256 = write_split(dataset, split, staging / relative_path, interval)
                dataset_manifest["splits"][split] = {
                    "path": relative_path.as_posix(),
                    "questions": rows,
                    "sha256": sha256,
                }
                dataset_manifest["total_questions"] += rows
                manifest["total_questions"] += rows
            manifest["datasets"][dataset] = dataset_manifest

        revisions_after = {dataset: dataset_revision(dataset) for dataset in DATASETS}
        if revisions_after != revisions_before:
            raise RuntimeError("An upstream dataset changed during the snapshot; run the command again")
        manifest_path = staging / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        output.mkdir(parents=True, exist_ok=True)
        for source in staging.rglob("*"):
            if source.is_file():
                relative_path = source.relative_to(staging)
                destination = output / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, destination)

    print(f"Saved {manifest['total_questions']} questions to {output}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--request-interval", type=float, default=1.1)
    args = parser.parse_args()
    if args.request_interval < 0:
        parser.error("--request-interval cannot be negative")
    refresh(args.output, args.request_interval)


if __name__ == "__main__":
    main()
