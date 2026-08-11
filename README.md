# Lawyer Tycoon

An LSAT trainer wearing a business simulation. You do not answer a question, you
file a case: you pick an answer and write, in at least 120 characters, the
reasoning that decided it. **The answer determines whether you win the case. The
explanation determines what the win is worth.**

That asymmetry is the whole design. A guessed right answer and an argued right
answer are both correct and are not both worth the same, so the fastest way to
get rich is to get good at explaining your reasoning — which is also the thing
that raises an LSAT score.

Everything that matters is settled server-side. Correctness comes from a
verified answer key. Cash, reputation, purchases, rent, streaks and exam timing
are all decided by the API; a client sends its answer and its argument and
nothing else.

| | |
|---|---|
| **What it does, in detail** | [`docs/GAME-LOOP.md`](docs/GAME-LOOP.md) |
| **How it is put together** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **What protects it** | [`docs/SECURITY.md`](docs/SECURITY.md) |
| **What has been measured** | [`tools/perf/FINDINGS.md`](tools/perf/FINDINGS.md) |

---

## The study side

Real LSAT questions — 6,886 of them, Logical Reasoning and Reading
Comprehension — sat four ways:

- **Practice runs** of 1–50 questions. Answer, write the reasoning, get the
  verdict immediately and coaching a moment later.
- **The mega-litigation**, a 77-item mock exam in three timed sections
  (two Logical Reasoning of 25, one Reading Comprehension of 27 — the modal
  shape of a modern LSAT). Administered like the real thing: the clock is a
  column on the server, sections are sat in order, there is no pause, and
  answers go on a sheet that can be revised until the bell.
- **Blind review** of the questions you were unsure of, untimed and unscored.
- **A review queue** driven by [FSRS-6](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm),
  the Difficulty–Stability–Retrievability model, which replaced a fixed
  1/3/7/21-day ladder that knew nothing about the item and told a student
  sprinting before their test date to come back on Thursday.

Every explanation is read by a frontier model that grades it 0–100, names the
**first** broken step rather than the wrong final answer, and explains why each
of the five choices works or fails. It never decides correctness — that is
settled from the verified key before the model is called — and nothing waits on
it: if it never arrives, the case still settles from the key at a reduced
multiplier.

A projected 120–180 score is reported with an uncertainty band built from LSAC's
own published standard error of measurement and the equating spread measured
across 59 published conversion charts.

## The game side

15 office tiers from a Wooden Shack to a Planetary Justice Nexus, across 14
regions. 107 firm assets — 35 upgrades, 30 staff, 14 connections, 14 rivals and
14 cosmetics. 69 client archetypes, 38 districts and 14 rival firms on a career
map. Eight story chapters and 19 quests, all keyed to *validated* wins — correct
with well-argued reasoning — so the narrative cannot be advanced by guessing.

The office and the career world are live Three.js scenes. The economy runs
continuously: rent accrues, reputation decays, passive income banks, and an
empire that stops working starts costing money.

---

## Layout

| | |
|---|---|
| `backend/` | Flask, SQLAlchemy, Alembic. The learning domain, the economy, the exam clock, the coaching jobs. |
| `frontend/` | React 19, Vite, TypeScript, Three.js. Nine per-route chunks with per-route stylesheets. |
| `mobile/` | Expo/React Native shell over the same responsive web app, authenticating with a bearer token rather than a cookie. |
| `deploy/` | CloudFormation for the AWS sandbox: EC2, RDS PostgreSQL, SQS, CloudFront. |
| `tools/perf/`, `tools/css-split/` | The measurement rigs. An authenticated load harness with a signed-out control, and compressed-serving tools. |
| `docs/`, `planning/` | Architecture, game loop, security, and design references. |

On native iOS and Android, `/office` and `/map` rotate to landscape
automatically and other routes return to portrait. Mobile Safari shows a
dismissible orientation guide instead, because a website cannot force a device
to rotate.

## Question data

`backend/data/question_bank/` holds a pinned, checksum-manifested snapshot:

- [tasksource/lsat-lr](https://huggingface.co/datasets/tasksource/lsat-lr) — 4,520 Logical Reasoning questions
- [tasksource/lsat-rc](https://huggingface.co/datasets/tasksource/lsat-rc) — 2,366 Reading Comprehension questions

The loader uses the snapshot first and falls back to the Hugging Face Dataset
Server when a split is unavailable. **The upstream dataset cards declare no
license.** Confirm dataset terms and LSAT content rights before publication or
commercial use.

Refresh the snapshot only deliberately:

```bash
.venv/bin/python backend/scripts/snapshot_question_bank.py
```

---

## Local development

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

Windows PowerShell uses `python -m venv .venv` and `.\.venv\Scripts\python.exe`
wherever this README says `.venv/bin/python`.

Start the API:

```bash
cd backend
../.venv/bin/python -m flask --app run.py db upgrade
../.venv/bin/python -m flask --app run.py seed
../.venv/bin/python run.py
```

Start the web app in another terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Local sign-in needs `DEV_AUTH_ENABLED=true`. Production refuses to boot with it
set, and also refuses to boot without a real `SECRET_KEY` — see
[`docs/SECURITY.md`](docs/SECURITY.md). Configuration examples are in
`backend/.env.example`, `frontend/.env.example` and their `.production`
counterparts. Real `.env` files of any name are gitignored; this repository is
public.

### Expo app

Set `EXPO_PUBLIC_WEB_APP_URL` in `mobile/.env` to the deployed HTTPS URL, a
simulator URL, or your development machine's LAN URL, then:

```bash
cd mobile
npm install
npx expo start --lan
```

A physical phone cannot reach the computer's `127.0.0.1`. `mobile/README.md` has
the emulator URLs, native build commands and authentication caveats.

---

## Verification

Every command below was run against this commit. The expected result is stated
so a red one is recognisable as a regression rather than as normal noise.

```bash
# 402 passed
.venv/bin/python -m pytest -q

# the security suite alone: 26 attacks, all refused
.venv/bin/python -m pytest backend/tests/test_security.py -q

cd frontend
npm run build            # clean
npm run lint             # clean
npx tsc -b               # clean
npm run check:office-manifest
# Office manifest verified: 107 mapped assets (35 upgrades, 30 staff,
# 14 connections, 14 rivals, 14 cosmetics), 30 role-assigned staff stations,
# 6 reusable floor plans, 15 distinct furnished environments,
# and 35 visible upgrade states.

cd ../mobile
npm run typecheck        # clean
npx expo-doctor          # 18/18 checks passed
```

One known-red command, left red on purpose:

```bash
cd frontend
npx tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters
```

It reports 20 unused declarations across nine files, seventeen of them in scene
and page modules owned by other work in flight. They are enumerated with exact
locations in `.qa-report.md` rather than deleted mid-flight.

## Deployment

The guarded AWS sandbox workflow validates, commits, pushes, migrates, deploys
and smoke-tests the current `main`:

```powershell
.\deploy-sandbox.ps1 -CommitMessage "Deploy Lawyer Tycoon updates"
```

It needs the existing sandbox stack, GitHub access, the AWS CLI and managed
sandbox credentials. **Review `git status` first**, because the command stages
every non-ignored change in the workspace.

Because it stages everything, it refuses to continue if the new files it swept
in come to 25 MB or more, and prints the largest. That normally means scratch is
missing from `.gitignore` — add it there rather than raising the limit. If a
release genuinely carries that much new material, `-MaxNewFileMegabytes` raises
it. The check runs before anything is pushed or any AWS resource is touched.

The stack under `deploy/` describes itself as a sandbox and should be read that
way: it reaches its origin over plaintext HTTP and exposes the instance on
`0.0.0.0/0`. [`docs/SECURITY.md`](docs/SECURITY.md) says what has to change
before it is a production deployment.
