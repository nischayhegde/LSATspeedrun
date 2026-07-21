# LSAT Sherlock

A local-first, story-driven LSAT practice app described in [planning/Final PRD.md](planning/Final%20PRD.md). It includes Google authentication, a mandatory resumable diagnostic, deterministic scoring, adaptive detective cases, XP, pace gating, session summaries, an evidence archive, spaced-repetition cold cases, Professor Quill boss encounters, and account-backed progress.

Written explanations and controlled hints are powered through TrueFoundry with `gpt-5.6-luna` at `xhigh` reasoning effort. The verified Qbank answer key still determines correctness; the model grades reasoning and provides coaching only.

## Run locally

Requirements: Python 3.11+ and Node 20+.

macOS/Linux:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
cd frontend
npm install
cp .env.example .env
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
Set-Location frontend
npm install
Copy-Item .env.example .env
```

Start the API from the repository root:

```bash
./.venv/bin/python backend/run.py
```

```powershell
.\.venv\Scripts\python backend\run.py
```

Then start the web app in another terminal:

```powershell
Set-Location frontend
npm run dev
```

Open http://localhost:5173. The development sign-in button works without external credentials. Progress is stored in `backend/instance/lsat_sherlock.db`.

The API defaults to port `5000`. To avoid a local port conflict (notably macOS AirPlay Receiver), choose another port and update `frontend/.env` to match:

```bash
PORT=5001 ./.venv/bin/python backend/run.py
```

```dotenv
VITE_API_URL=http://localhost:5001/v1
```

## Learning and progression flow

After sign-in, users must choose a study target and complete the diagnostic before the rest of the application unlocks. The diagnostic establishes the score estimate, skill baseline, and adaptive scheduler inputs.

- **Daily cases:** adaptive sets prioritize weak skills while interleaving stronger ones.
- **Evidence Archive:** browse and filter every filed answer, then reopen the original question, selected answer, verified key, written reasoning, timing, and saved coaching.
- **Cold Cases:** missed questions enter a spaced-repetition queue. Correct recoveries move the question through increasingly longer review intervals.
- **Professor Quill encounters:** every eight completed daily cases unlocks a five-question boss set emphasizing the user's weakest, highest-difficulty skills and awarding bonus XP.
- **Reasoning coach:** controlled hints and post-answer analysis are persisted, so archived reviews do not require another model call.

For an existing database, apply schema migrations before starting the API:

```bash
PYTHONPATH=backend ./.venv/bin/python -m flask --app run db --directory backend/migrations upgrade
```

## Configure Google sign-in

Create a Google OAuth 2.0 Web client, add `http://localhost:5173` as an authorized JavaScript origin, and set the same client ID in `backend/.env`:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Restart the API. The frontend reads the public client ID from the API; the backend independently verifies every Google credential before creating its own HttpOnly session.

For shared or production environments, set a strong `SECRET_KEY`, use PostgreSQL through `DATABASE_URL`, set `DEV_AUTH_ENABLED=false`, `AUTO_SEED=false`, `ALLOW_UNREVIEWED_QUESTIONS=false`, and configure exact frontend/API origins.

## Optional AI story generation

Story mode always has a deterministic fallback, so scoring and session creation never wait for an LLM. To pre-generate cached frames with an OpenAI-compatible chat-completions provider, set these values in `backend/.env`:

```dotenv
STORY_LLM_BASE_URL=https://your-provider.example/v1
STORY_LLM_API_KEY=your-key
STORY_LLM_MODEL=your-model
```

Then run:

```powershell
Set-Location backend
..\.venv\Scripts\flask --app run.py generate-stories --limit 25
```

Only section, type, and difficulty metadata are sent. Student reasoning is never sent by this job, generated HTML is stripped, and the original question content and answer key remain separate.

## TrueFoundry reasoning coach

The API reads `TFY_URL` and `TFY_API_KEY` from either the repository-root `.env` or `backend/.env`. When configured, each active question supports three progressively stronger pre-answer hints. After filing an answer, the frontend requests a structured review containing:

- A 0–100 explanation grade independent of answer correctness
- The first reasoning error and a concrete repair
- An explanation of why the verified answer works
- An explanation of why the selected wrong answer fails
- Concise analysis of every answer choice

The model and reasoning effort are fixed server-side to `gpt-5.6-luna` and `xhigh`. Student reasoning is enclosed as untrusted JSON data, the provider receives no tools or secrets, output is schema-validated and length-limited, and generated hints are rejected if they reveal the keyed answer. Coaching and hint records are saved to the user account.

## Verify

```powershell
.\.venv\Scripts\python -m pytest
Set-Location frontend
npm run build
```

## Content notice

The included parsed bank is marked `unknown_needs_verification` / `machine_parsed_needs_review`. It is enabled only for local MVP development. Do not publish or deploy those questions until licensing and human review are complete. With `ALLOW_UNREVIEWED_QUESTIONS=false`, the scheduler serves only records marked `approved` and `published`.
