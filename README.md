# Lawyer Tycoon

Lawyer Tycoon turns a serious LSAT question bank into a persistent law-firm management game:

1. Sign in, name a firm, and choose a male or female character presentation.
2. Open **Do Cases** and answer a randomly selected Logical Reasoning (LR) or Reading Comprehension (RC) question.
3. Submit the answer together with a required, question-specific explanation.
4. Receive the verified verdict, an LLM reasoning review, a transparent 1–20 score, cash, and Reputation.
5. Invest in office upgrades, staff, clients, connections, and rival acquisitions while the persistent 2D office evolves.

There is one question loop throughout the game—no alternate question modes, energy gates, or paid answer power. The verified answer key always determines correctness; the LLM only grades reasoning and explains choices. Economy settlement, timing, Reputation, streaks, purchases, passive income, and account ownership are enforced server-side.

## Question data

The repository includes a complete question-only snapshot of every split from these Hugging Face datasets:

- [tasksource/lsat-lr](https://huggingface.co/datasets/tasksource/lsat-lr): 4,520 LR questions
- [tasksource/lsat-rc](https://huggingface.co/datasets/tasksource/lsat-rc): 2,366 RC questions

The combined bank contains 6,886 questions. The six JSONL files and their checksum manifest live in
`backend/data/question_bank/`. They contain question content only—never users, attempts, AI feedback, or secrets.
`backend/app/seed.py` loads the repository snapshot first, maps zero-based labels to A–E, deduplicates RC
passages, and records the upstream dataset and split on each question. If a split file is unavailable, it falls
back to the Hugging Face Dataset Server. Only records with the Hugging Face source prefix are eligible for
practice, so historical local-bank rows cannot be selected.

Refresh the repository snapshot explicitly with:

```powershell
.\.venv\Scripts\python.exe backend\scripts\snapshot_question_bank.py
```

The snapshot manifest pins the observed upstream revisions and records the row count and SHA-256 digest of each
file, making it possible to detect an incomplete or changed archive.

The upstream dataset cards do not currently declare a license. Confirm that your intended use complies with the dataset terms and applicable LSAT content rights before publishing or commercial deployment.

## Local setup

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd frontend
npm install
```

Start the API:

```powershell
cd backend
..\.venv\Scripts\python.exe -m flask --app run.py db upgrade
..\.venv\Scripts\python.exe run.py
```

Always run the Alembic upgrade before starting a new code version. Runtime startup deliberately does not call
`db.create_all()` outside tests, because doing so against an older stamped database can make later migrations
collide. In development, `AUTO_SEED=true` by default, so startup inserts any missing repository questions after
the schema is current. You can seed or refresh the database explicitly:

```powershell
cd backend
..\.venv\Scripts\python.exe -m flask --app run.py seed
..\.venv\Scripts\python.exe -m flask --app run.py seed --force
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173. To use the local-development sign-in button, explicitly set
`DEV_AUTH_ENABLED=true`; it defaults off and is rejected when `FLASK_ENV=production`.

## Configuration

The backend reads `backend/.env`, followed by a root `.env` for values not already set.

```dotenv
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
TFY_URL=https://your-truefoundry-endpoint.example/v1
TFY_API_KEY=your-key
DATABASE_URL=
PRACTICE_SESSION_SIZE=10
HUGGINGFACE_REQUEST_INTERVAL_SECONDS=1.1
AUTO_SEED=true
DEV_AUTH_ENABLED=false
AI_JOBS_MODE=sync
```

Google authentication is verified server-side. The backend issues its own HttpOnly session cookie and requires a matching CSRF token on state-changing requests.

`TFY_URL` may be an OpenAI-compatible API base or a full `/chat/completions` URL. Post-answer coaching uses `gpt-5.6-luna` at `xhigh` reasoning effort and returns:

- A substantive grade mapped to Invalid, Weak, Good, or Excellent
- A reasoning verdict and first-error repair
- An explanation of the verified answer
- An explanation of every answer choice
- A next-step suggestion

The model receives the canonical passage or stimulus, stem, choices, verified key, selected answer, and student reasoning. Student text is treated as untrusted quoted data. Model output is schema-validated and cannot change correctness.

For production, `AUTO_SEED` defaults to false. Run the seed command as a deployment task after migrating the database.
`QUESTION_BANK_DIR` normally needs no configuration; it defaults to `backend/data/question_bank`. Set it only to
use a snapshot stored elsewhere. Setting it to an empty value disables the local copy and uses Hugging Face.

The Dataset Server enforces a per-minute request limit. Both the fallback importer and snapshot refresh utility
throttle page requests and honor `Retry-After`; refreshing the archive can take roughly three to five minutes on
a shared IP.

## Game persistence and API

`PlayerProfile`, owned assets, client contracts, daily progress, immutable case settlements, and the cash ledger
all reference the authenticated user account. A unique settlement and ledger source prevent browser retries or
SQS/Lambda redelivery from paying the same case twice.

The active API surface includes:

- `POST /v1/auth/google`, `POST /v1/auth/dev`, `POST /v1/auth/logout`
- `GET /v1/me`
- `GET /v1/game`, create/edit profile, purchases, firm advancement, client activation, passive collection, and daily rewards
- `POST /v1/study-sessions`, `GET /v1/study-sessions/current`
- `GET /v1/study-sessions/:id`, pause/resume, draft, submit, and answer-review acknowledgement endpoints
- `POST /v1/attempts/:id/coaching`
- `GET /v1/attempts/:id/reward`
- `GET /v1/jobs/:id` for asynchronous coaching
- `GET /v1/study-sessions/:id/summary`
- `GET /v1/health`

Older migration-managed databases may still contain unused legacy columns or tables. They are intentionally not mapped or accessed by the current runtime so existing user and attempt data can be retained safely.

## Deploy the AWS sandbox

From `main`, one command validates, commits, pushes, and deploys every non-ignored workspace change:

```powershell
.\deploy-sandbox.ps1 -CommitMessage "Deploy Lawyer Tycoon updates"
```

The command runs backend tests and the production frontend build, builds and uploads an immutable Lambda artifact,
updates CloudFormation, waits for a successful EC2 bootstrap signal and migrations, verifies Lambda → TrueFoundry
while SQS is paused, then verifies the real SQS → Lambda → TrueFoundry → Tycoon settlement path after enablement.
Both checks use disposable accounts that are removed afterward. It never force-pushes and refuses
diverged branches or staged secret-like files. Review `git status` first because all non-ignored changes are committed
to `main`. It uses the configured Git identity, falls back to `AWS Sandbox Deploy` when one is missing, and accepts
`-GitUserName` and `-GitUserEmail` overrides.

The command requires the existing `lsatspeedrun-sandbox` stack, GitHub push access, AWS CLI, and the managed
`sbsandbox` credentials supplied by `sb-aws-creds`.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
```

The tests cover onboarding and account isolation, required reasoning, random Hugging Face-only selection, exact score gates, verified-answer authority, immutable exactly-once settlements, purchases, passive-income caps, asynchronous coaching, and all-choice explanations.
