# LSAT Tycoon

LSAT Tycoon is an LSAT learning platform wrapped in a persistent lawyer-tycoon world. Verified answer keys determine correctness; coaching explains the reasoning but cannot override the result. Learning evidence, rewards, purchases, rent, and reputation are settled by the server.

## Current experience

The learning loop separates distinct kinds of evidence instead of treating every answer alike:

- **Diagnostic** establishes a neutral, sectioned baseline with test-like timing and delayed results.
- **Sprint** delivers 10 timed, answer-only questions with feedback held until the run ends.
- **Deep Practice / Method Lab** requires explicit reasoning and gives immediate coaching.
- **Infinite** continues until the learner ends the run, with a concise post-answer explanation.
- **Review** repairs scheduled errors and confidence mismatches.
- **Daily Docket** sequences due review, unseen timed work, and a focused debrief.
- **Strategy trials** periodically compare LSAT methods and surface learner-specific results in performance analytics.

The game layer contains 15 office tiers across five career environments, 35 upgrades, 30 staff roles, 14 connections, 14 rivals, and 69 client archetypes. Eight story chapters and 19 optional quests support the progression without replacing practice. The office and career map are live Three.js scenes; the economy includes server-side rewards, passive income, rent, arrears, and inactivity-based reputation pressure.

## Architecture

- `backend/` — Flask, SQLAlchemy, Alembic, coaching jobs, and the game/learning domain.
- `frontend/` — React 19, Vite, TypeScript, Three.js, responsive web UI, and shared case flow.
- `mobile/` — lightweight Expo/React Native WebView shell that uses the same responsive web app and account state.
- `deploy/` — AWS EC2, PostgreSQL, SQS, and Lambda deployment infrastructure.
- `docs/` and `planning/` — learning strategy, product, scene, and visual design references.

On native iOS and Android, `/office` and `/map` rotate to landscape automatically; other routes return to portrait. Mobile Safari shows a dismissible orientation guide because websites cannot force device rotation.

## Question data

`backend/data/question_bank/` contains a pinned, checksum-manifested snapshot of 6,886 questions:

- [tasksource/lsat-lr](https://huggingface.co/datasets/tasksource/lsat-lr): 4,520 LR questions
- [tasksource/lsat-rc](https://huggingface.co/datasets/tasksource/lsat-rc): 2,366 RC questions

The loader uses this snapshot first and falls back to the Hugging Face Dataset Server when a split is unavailable. The upstream dataset cards do not currently declare a license. Confirm dataset terms and LSAT content rights before publication or commercial use.

Refresh the snapshot only when intended:

```bash
.venv/bin/python backend/scripts/snapshot_question_bank.py
```

Windows PowerShell: `.\.venv\Scripts\python.exe backend\scripts\snapshot_question_bank.py`.

## Local development

Create the environment and install dependencies from the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

Windows PowerShell uses `python -m venv .venv` and `.\.venv\Scripts\python.exe` in place of `.venv/bin/python`.

Start the API:

```bash
cd backend
../.venv/bin/python -m flask --app run.py db upgrade
../.venv/bin/python run.py
```

Start the web app in another terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Local sign-in requires `DEV_AUTH_ENABLED=true`; production rejects that setting. Configuration examples live in `backend/.env.example`, `frontend/.env.example`, and their production counterparts.

### Expo app

Set `EXPO_PUBLIC_WEB_APP_URL` in `mobile/.env` to the deployed HTTPS URL, simulator URL, or development computer's LAN URL, then run:

```bash
cd mobile
npm install
npx expo start --lan
```

A physical phone cannot use the computer's `127.0.0.1`. See `mobile/README.md` for emulator URLs, native build commands, and authentication caveats.

## Verification

```bash
.venv/bin/python -m pytest -q
cd frontend
npm run build
npm run check:office-manifest
npx tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters
cd ../mobile
npm run typecheck
npx expo-doctor
```

## Deployment

The guarded AWS sandbox workflow validates, commits, pushes, migrates, deploys, and smoke-tests the current `main` branch:

```powershell
.\deploy-sandbox.ps1 -CommitMessage "Deploy LSAT Tycoon updates"
```

It requires the existing sandbox stack, GitHub access, AWS CLI, and managed sandbox credentials. Review `git status` first because the command includes all non-ignored workspace changes.
