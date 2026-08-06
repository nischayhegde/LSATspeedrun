# Repository question snapshot

This directory contains the complete question-only snapshot used by LSAT Tycoon. It includes all train,
validation, and test rows from `tasksource/lsat-lr` and `tasksource/lsat-rc`. Each JSONL line is one unchanged
upstream row; `manifest.json` records source revisions, row counts, and SHA-256 checksums.

It intentionally contains no users, sessions, attempts, AI feedback, credentials, or other application data.
The API seeds its `questions`, `question_choices`, and `passages` tables from these files. If a snapshot file is
missing, seeding falls back to the Hugging Face Dataset Server for that split.

Refresh the snapshot from the repository root with:

```powershell
.\.venv\Scripts\python.exe backend\scripts\snapshot_question_bank.py
```

The upstream dataset cards do not currently declare a license. Confirm that your use complies with the dataset
terms and applicable LSAT content rights before distributing or commercializing this material.
