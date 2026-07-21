# LSAT Sherlock

A local-first, story-driven LSAT practice app described in [planning/Final PRD.md](planning/Final%20PRD.md). It includes Google authentication, a mandatory resumable diagnostic, deterministic scoring, adaptive detective cases, XP, pace gating, session summaries, an evidence archive, spaced-repetition cold cases, Professor Quill boss encounters, and account-backed progress. Diagnostic, daily, review, and boss evidence files open inside an animated, persistent Lantern Bureau storyline with recurring characters, locations, dialogue, and outcome scenes. Each session is planned as one connected arc rather than a set of unrelated micro-cases.

Session planning, cinematic story beats, written-explanation grading, and controlled hints are powered through TrueFoundry with `gpt-5.6-luna` at `xhigh` reasoning effort. The verified Qbank answer key still determines correctness; the model plans narrative and coaches reasoning but never decides whether an answer is correct.

The diagnostic and daily cases are resumable. “Save & exit” commits the active timer and pauses the session, so time away is excluded. Every question offers an explanation box—required on selected diagnostic items and optional-but-graded everywhere else. Completing the diagnostic unlocks a dedicated Lantern Bureau story introduction before the first adaptive shift.

## Run locally

Requirements: Python 3.11+ and Node 20.19+ (or Node 22.12+).

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
Set-Location frontend
npm install
Copy-Item .env.example .env
Set-Location ..
```

The local backend defaults already enable development sign-in, SQLite, Qbank seeding, and unreviewed development content. A `backend/.env` file is optional; create it when configuring Google sign-in or when you want to override those defaults. Configure TrueFoundry as described below before copying blank environment templates over an existing setup.

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

Use the `localhost` URL above in the browser: CORS, cookies, and the documented Google origin are configured for `http://localhost:5173`, not `http://127.0.0.1:5173`.

Confirm that the API seeded the parsed Qbank and found the AI configuration:

```bash
curl http://localhost:5000/v1/health
```

```powershell
Invoke-RestMethod http://localhost:5000/v1/health
```

`questions` should be greater than zero, while `coaching.ready` reports whether TrueFoundry is configured. With `AUTO_SEED=true`, the API seeds Logical Reasoning and Reading Comprehension records from `Qbankparsing/lsat_questions.json` on first startup.

## Configure Google sign-in

Create a Google OAuth 2.0 Web client, add `http://localhost:5173` as an authorized JavaScript origin, and set the same client ID in `backend/.env`:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Restart the API. The frontend reads the public client ID from the API; the backend independently verifies every Google credential before creating its own HttpOnly session.

For shared or production environments, set a strong `SECRET_KEY`, use PostgreSQL through `DATABASE_URL`, set `DEV_AUTH_ENABLED=false`, `AUTO_SEED=false`, `ALLOW_UNREVIEWED_QUESTIONS=false`, and configure exact frontend/API origins.

### Google sign-in on AWS or another deployed host

Google Identity Services requires HTTPS for non-localhost JavaScript origins. Do not use a plain-HTTP EC2 public hostname as the production OAuth origin. Put the application behind HTTPS—normally a custom domain with CloudFront/ALB and ACM, or a reverse proxy with a trusted certificate—then add the exact frontend origin to the Google OAuth Web client:

```text
https://app.example.com
```

In Google Cloud Console, open **APIs & Services → Credentials → OAuth 2.0 Client IDs**, edit the Web client, and add that value under **Authorized JavaScript origins**. The sign-in button used here does not require a redirect URI. Restart the API after setting the same public client ID in the deployed backend.

Use `backend/.env.production.example` as the production configuration template. If one HTTPS host reverse-proxies `/v1` to Flask while serving the frontend, use `frontend/.env.production.example`; production builds also default to same-origin `/v1` when `VITE_API_URL` is omitted. If the API uses a separate host, set `VITE_API_URL=https://api.example.com/v1` and keep `FRONTEND_ORIGIN` set to the exact frontend origin.

## TrueFoundry cinematic story and reasoning coach

Set `TFY_URL` and `TFY_API_KEY` in `backend/.env` or the repository-root `.env`:

```dotenv
TFY_URL=https://your-truefoundry-endpoint.example/v1
TFY_API_KEY=your-key
```

`backend/.env` is loaded first and therefore wins when the same variable appears in both files. In particular, blank `TFY_URL=` or `TFY_API_KEY=` entries in `backend/.env` mask populated values in the root `.env`; either fill them in there or remove those duplicate blank entries. Restart the API after changing environment files, then check `/v1/health` as shown above.

Session creation first produces the deterministic scheduler's selected fallback list and a bounded pool of eligible Qbank candidates (at most 96). TrueFoundry then receives an answer-safe manifest containing only candidate IDs, bounded stems/evidence excerpts, topics, question types, sections, difficulty, and backend-derived `story_fit` allowlists for canonical character/location IDs. It never receives answer choices, the answer key, canonical explanations, or trap metadata. The planner can select and order only the unique IDs in that bounded manifest; it cannot introduce a question from outside the scheduler's eligible pool.

The planner returns one strict, schema-validated arc plus a canonical location, a 3–5 character scene cast, a story role, a pre-answer setup hook, and an answer-neutral payoff hook for every selected question. Locations and characters must come from the renderable Lantern Bureau registries and from that question's broad, answer-neutral `story_fit`; invented characters and unsupported locations are rejected. Diagnostic plans are additionally checked for required section, question-type, and difficulty coverage, while daily plans retain deterministic type/difficulty diversity and interleaving. The validator also rejects wrong counts, duplicates, ineligible IDs, copied question language, internal IDs in narrative prose, answer-like language, and disconnected sequences. The accepted question order and full arc are persisted with the study session, so pause, sign-out, refresh, and resume restore the same episode and never silently re-plan it.

Session creation waits for the planning call, which usually takes under a minute in local use. A single bounded retry is allowed for a transient provider/transport failure, so an unusually slow failure can take longer. Invalid model output is not retried. If TrueFoundry is unconfigured, remains unavailable, or returns an invalid plan, the API uses the deterministic scheduler list and a connected deterministic Bureau arc. This fallback still persists with the session and preserves stable resume behavior.

For every active question, the frontend immediately presents the saved deterministic animated scene while the API requests a question-matched cinematic beat from TrueFoundry using the current session arc and beat as continuity context. Validated scenes are saved with the session and carry the planned setup/payoff forward; a per-question provider failure leaves the safe saved fallback in place and never blocks scoring. Pre-answer cinematic generation receives section and difficulty metadata plus the canonical passage, stimulus, and question stem, but deliberately omits answer choices and the answer key so the narrative cannot bias the diagnostic.

The legacy `STORY_LLM_*` settings and `flask generate-stories` command have been removed. Cinematic beats are generated per question through TrueFoundry; normal local development should not use the old offline workflow.

During daily practice, each active question supports three progressively stronger pre-answer hints. Hints are hidden during the diagnostic to protect the baseline estimate. After filing an answer, the frontend requests a structured review containing:

- A 0–100 explanation grade independent of answer correctness
- The first reasoning error and a concrete repair
- An explanation of why the verified answer works
- An explanation of why the selected wrong answer fails
- Concise analysis of every answer choice

The session planner, cinematic director, and reasoning coach are fixed server-side to `gpt-5.6-luna` with `xhigh` reasoning effort. Student reasoning and planning context are enclosed as untrusted JSON data, the provider receives no tools or secrets, output is schema-validated and length-limited, and generated hints are rejected if they reveal the keyed answer. The session plan, coaching, hints, generated story continuity, drafts, and progress are saved to the user account.

## Local troubleshooting

- If either server reports that its port is already in use, inspect the listeners with `Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5000,5173` and stop the stale process or free the port. The frontend API URL and backend CORS origin assume these exact ports.
- If `coaching.ready` is `false`, check the `backend/.env` precedence described above and restart Flask. Story scenes will still work in deterministic fallback mode, but live story enrichment, hints, and AI debriefs will not.
- If `questions` is `0`, confirm `Qbankparsing/lsat_questions.json` exists and that `AUTO_SEED=true` and `ALLOW_UNREVIEWED_QUESTIONS=true` are set for local development.
- If an older, Alembic-managed local database reports missing-column errors, back up `backend/instance/lsat_sherlock.db`, then run `..\.venv\Scripts\python -m flask --app run.py db upgrade` from the `backend` directory. The current migration head is `0010_review_cards`.

## Verify

```powershell
.\.venv\Scripts\python -m pytest
Set-Location frontend
npm run build
```

## Content notice

The included parsed bank is marked `unknown_needs_verification` / `machine_parsed_needs_review`. It is enabled only for local MVP development. Do not publish or deploy those questions until licensing and human review are complete. With `ALLOW_UNREVIEWED_QUESTIONS=false`, the scheduler serves only records marked `approved` and `published`.
