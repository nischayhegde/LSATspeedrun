# LSAT Sherlock

A local-first MVP of the story-driven LSAT practice app described in [planning/Final PRD.md](planning/Final%20PRD.md). It includes Google authentication, a resumable diagnostic, deterministic scoring, adaptive detective cases, XP, pace gating, session summaries, and account-backed progress.

## Run locally

Requirements: Python 3.11+ and Node 20+.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
Set-Location frontend
npm install
Copy-Item .env.example .env
```

Start the API from the repository root:

```powershell
.\.venv\Scripts\python backend\run.py
```

Then start the web app in another terminal:

```powershell
Set-Location frontend
npm run dev
```

Open http://localhost:5173. The development sign-in button works without external credentials. Progress is stored in `backend/instance/lsat_sherlock.db`.

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

## Verify

```powershell
.\.venv\Scripts\python -m pytest
Set-Location frontend
npm run build
```

## Content notice

The included parsed bank is marked `unknown_needs_verification` / `machine_parsed_needs_review`. It is enabled only for local MVP development. Do not publish or deploy those questions until licensing and human review are complete. With `ALLOW_UNREVIEWED_QUESTIONS=false`, the scheduler serves only records marked `approved` and `published`.
