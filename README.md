# LSAT Speedrun

LSAT Speedrun is a deliberately simple practice app:

1. Create an account or sign in with Google.
2. Start a ten-question practice session.
3. Answer randomly selected Logical Reasoning (LR) and Reading Comprehension (RC) questions.
4. Review the verified answer, an optional LLM grade of your written reasoning, and an explanation of every answer choice.

There is no diagnostic, story mode, adaptive scheduler, spaced-repetition queue, or game progression. The answer key determines correctness; the LLM only grades reasoning and explains choices.

## Question data

The app loads all splits from these Hugging Face datasets:

- [tasksource/lsat-lr](https://huggingface.co/datasets/tasksource/lsat-lr): 4,520 LR questions
- [tasksource/lsat-rc](https://huggingface.co/datasets/tasksource/lsat-rc): 2,366 RC questions

The combined bank contains 6,886 questions. `backend/app/seed.py` downloads train, validation, and test rows through the Hugging Face Dataset Server, maps zero-based labels to A–E, deduplicates RC passages, and records the upstream dataset and split on each question. Only records with the Hugging Face source prefix are eligible for practice, so historical local-bank rows cannot be selected.

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
..\.venv\Scripts\python.exe run.py
```

In development, `AUTO_SEED=true` by default. The first API startup downloads and inserts the Hugging Face datasets, which can take a little while. You can seed or refresh explicitly:

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

Open http://localhost:5173. A local-development sign-in button is enabled unless `DEV_AUTH_ENABLED=false`.

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
DEV_AUTH_ENABLED=true
AI_JOBS_MODE=sync
```

Google authentication is verified server-side. The backend issues its own HttpOnly session cookie and requires a matching CSRF token on state-changing requests.

`TFY_URL` may be an OpenAI-compatible API base or a full `/chat/completions` URL. Post-answer coaching uses `gpt-5.6-luna` at `xhigh` reasoning effort and returns:

- An optional 0–100 grade for the student's written reasoning
- A reasoning verdict and first-error repair
- An explanation of the verified answer
- An explanation of every answer choice
- A next-step suggestion

The model receives the canonical passage or stimulus, stem, choices, verified key, selected answer, and student reasoning. Student text is treated as untrusted quoted data. Model output is schema-validated and cannot change correctness.

For production, `AUTO_SEED` defaults to false. Run the seed command as a deployment task after migrating the database.

The Dataset Server enforces a per-minute request limit. The importer throttles page requests and honors `Retry-After`; a complete first import can take roughly three to five minutes on a shared IP.

## API

The active API surface is intentionally small:

- `POST /v1/auth/google`, `POST /v1/auth/dev`, `POST /v1/auth/logout`
- `GET /v1/me`
- `POST /v1/study-sessions`, `GET /v1/study-sessions/current`
- `GET /v1/study-sessions/:id`, pause/resume, draft, submit, and answer-review acknowledgement endpoints
- `POST /v1/attempts/:id/coaching`
- `GET /v1/jobs/:id` for asynchronous coaching
- `GET /v1/study-sessions/:id/summary`
- `GET /v1/health`

Older migration-managed databases may still contain unused legacy columns or tables. They are intentionally not mapped or accessed by the current runtime so existing user and attempt data can be retained safely.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
```

The tests cover direct post-login practice access, random Hugging Face-only selection, removal of diagnostic/story endpoints, dataset schema mapping, verified answer scoring, LLM reasoning grades, and all-choice explanations.
