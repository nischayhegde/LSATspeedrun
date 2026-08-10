# Live demo runbook

> ## PANIC BUTTON
> **Press `S`.** Every demo instantly becomes a still image and the deck keeps working.
> Press `S` again to go back to live. If you would rather never risk it, open the deck as
> `http://localhost:5180/?stills=1` and present entirely from stills — the talk is unchanged.
> *Verified working 2026-08-10 11:58.*

**Account:** `student@localhost.test` (dev login, no password)
**Seeded case session:** `2e5ef6d0-429c-40d1-a205-3e8392b1d864`
**Deck URL:** `http://localhost:5180` — spelled **`localhost`**, never `127.0.0.1`

---

## READ THIS FIRST: the session id goes stale

Every run of `seed_demo.py` **deletes the open case and stages a new one with a new id**.
On 2026-08-10 this happened three times in ninety minutes because other work on this machine
re-ran the seeder. When it happens, slide 12 shows a login screen or an error.

**Before every rehearsal and again before the real thing, run this. It takes two seconds:**

```bash
cd /Users/alan/LSATspeedrun && .venv/bin/python backend/scripts/repin_demo_session.py --write
```

It prints the open session, rewrites `deck/demo.config.ts`, and the deck hot-reloads.
Then just reload the deck tab. Without `--write` it only reports, and exits non-zero if stale.

---

## 1. Startup

Four processes, four terminal tabs, in this order. Leave them all running.

### 1a. Backend — port 5001

```bash
cd /Users/alan/LSATspeedrun/backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py
```

**Healthy:** log lines ending with `Running on http://127.0.0.1:5001`.
Port **5001**, not the Flask default 5000 — the frontend proxy targets 5001 and nothing else.
(macOS AirPlay already holds 5000, so a backend on the default port will look fine and serve nothing.)

Confirm:

```bash
curl -s http://127.0.0.1:5001/v1/health
```
**Healthy:** `{"status":"ok", ... "questions":{"lr":4520,"rc":2366,"total":6886}}`

### 1b. Seed the demo account — only if needed

**Skip this if the account is already seeded.** It takes about **8 minutes**, and it
invalidates the session id pinned in the deck.

```bash
cd /Users/alan/LSATspeedrun/backend && DEV_AUTH_ENABLED=true ../.venv/bin/python scripts/seed_demo.py --apply
```

**Healthy:** progress on stderr (`… 70/75 sessions, 872 attempts`) then a large JSON report
whose `live_demo.url` is `http://localhost:5173/cases/<id>`.
**Always follow it with the re-pin command from the top of this file.**

### 1c. Product frontend — port 5173

```bash
cd /Users/alan/LSATspeedrun/frontend && npm run dev
```
**Healthy:** `➜  Local:   http://localhost:5173/`

### 1d. Deck — port 5180

```bash
cd /Users/alan/LSATspeedrun/deck && npm run dev
```
**Healthy:** `➜  Local:   http://localhost:5180/`

### 1e. Sign in — once per browser profile, and it is not optional

1. Open **`http://localhost:5173/login`**.
2. Click **“Enter local development firm”**. You land on the dashboard as Local Student.
3. On that same tab press **Cmd-Opt-J** and paste:

```js
localStorage.setItem('lsat-tycoon:guided-tour:v6', 'complete')
```

Step 3 must run on the **5173** origin, not on the deck's. It stops the first-run tour
from opening inside a slide.

---

## 2. Two-minute pre-flight

Run this one block. It checks all four processes and the pinned session at once.

```bash
cd /Users/alan/LSATspeedrun
curl -s -o /dev/null -w "backend  5001 %{http_code}\n" http://127.0.0.1:5001/v1/health
curl -s -o /dev/null -w "frontend 5173 %{http_code}\n" http://localhost:5173/
curl -s -o /dev/null -w "deck     5180 %{http_code}\n" http://localhost:5180/
.venv/bin/python backend/scripts/repin_demo_session.py
```

**Healthy:**

```
backend  5001 200
frontend 5173 200
deck     5180 200
open session   2e5ef6d0-429c-40d1-a205-3e8392b1d864  (question 2 of 8)
strategy brief yes
pinned in deck 2e5ef6d0-429c-40d1-a205-3e8392b1d864

OK — the deck is pinned to the open session.
```

Anything other than `200` → that process is down; restart it from section 1.
`STALE` → run the same command with `--write`.

Then, in the browser:

1. Open **`http://localhost:5180/#/demo-case-answer`**.
2. The frame's title bar lamp must read **LIVE** (green). `APP NOT RUNNING` means the
   frontend is down and you are looking at a still. `STILLS` means `S` is toggled on.
3. You should see the question, **not** a login screen.

If you see a login screen, you are on the wrong host — check the address bar says
`localhost:5180`, not `127.0.0.1:5180`.

---

## 3. Click paths

Slide numbers are 1-based, matching the presenter view (`?notes`).

### Slide 12 — `demo-case-answer` — the case question  *(P0)*

Route: `/cases/2e5ef6d0-429c-40d1-a205-3e8392b1d864`

**What is already on screen when you arrive** — you do not have to set any of it up:

- **Case 3 of 8**, matter “Resolve the Paradox”, client **Property developer**,
  **$910** base fee, opposing counsel Sterling Vex. Questions 1 and 2 are already answered.
- The strategy brief **“Prephrase Before Choices”** (plain title: *Guess before you look*)
  with its three steps: *Name the question task · Predict the needed effect · Use choices to verify, not invent*.
- **The answer choices are hidden.** This is deliberate — it is the blocking strategy gate.
- A running clock (target 2:30).

**Numbered click path:**

1. Point at the strategy brief. Say its name. **Do not read the three steps aloud.**
2. The gate says *“The choices are hidden. Say what the credited answer has to do, then they unlock.”*
   Your two controls are **“Use it”** and **“Drop the approach”**. Click **“Use it”**.
3. Type a prediction into **“What does the right answer have to do?”**
   It needs **at least six words / 30 characters** or it will refuse.
   Something like: `It has to state the assumption the argument needs to survive.`
4. Click **“Unlock the choices”**. The choices appear and the prediction locks —
   you cannot edit it, which is the point worth saying out loud.
5. Select an answer choice.
6. The reasoning box needs **120 characters minimum**. Type or paste a couple of sentences.
7. Set the **confidence** control.
8. Submit. **Stay on this slide.**

> The prompt-reading time is measured separately and does not count against pace —
> the `timing_note` in the UI says so if anyone asks.

### Slides 12 → 13 — THE ONE THING THAT WILL BURN YOU  *(known defect)*

**Confirmed live on 2026-08-10 11:58.** Slide 12 frames `/cases/<id>`. Slide 13 frames
`/progress` — a *different* URL in a *fresh* iframe, and the deck destroys the old one on
transition. **Advancing loses the answered question and the coaching panel. There is no
going back: pressing left arrow reloads the case from the top.**

Do all of this **before** you touch the right arrow:

1. Submit the answer (slide 12, step 8 above).
2. Read the verdict line and the score breakdown, **still on slide 12**.
3. Open the **coaching panel** and read one clause of the line naming where the reasoning
   first went wrong, **still on slide 12**.
4. Click **Dashboard** in the app's own nav bar, **inside the slide-12 frame**.
   The app is now on `/progress` — which is exactly where slide 13 opens.
5. *Now* press the right arrow. The audience sees no change, because both frames are showing
   the same page. That is what makes the seam invisible.

If you advance early, press **`S`** and finish the section on the still.

### Slide 13 — `demo-case-verdict-review` — the dashboard  *(P0)*

Route: `/progress`. Loads populated: headline metrics, skill breakdown, projection/readiness,
and the review queue. Verified loading authenticated inside the deck's iframe.

### Slide 18 — `demo-clients-walk-in` — `/office`  *(P1)*

Point at the seated client in the waiting area. Verified rendering.

### Slide 19 — `demo-office-transformation` — the two tier overrides  *(P1)*

- `/office?officeTier=0` — rundown Wooden Shack
- `/office?officeTier=14&officeAll=1` — full Planetary Justice Nexus (renders the
  **Chambers** / **Practice Floor** directory with 14 and 16 seated)

Both verified rendering. These DEV query params **only work under `npm run dev`** — never
against a production build. The tier-14 scene is the heaviest thing in the deck; give it a
couple of seconds before you start talking over it.

### Slide 20 — `demo-map-and-firm` — `/map`  *(P1)*

Verified: five regions, *Old Quarter 5/5*, Level 5 of 15. The slide's own script then has you
navigate to `/firm` **inside the frame** — there is no separate firm slide.

### The live purchase — `/firm?tab=upgrades`  *(P1)*

**`trophy_shelf` is NOT visible when the tab first opens.** It is a cosmetic, and the
Upgrades tab lands on a different sub-tab.

1. Go to `/firm?tab=upgrades`.
2. Click the **Decor** sub-tab.
3. **ADVOCACY TROPHY SHELF** — *“Advocacy prizes and bar honors, lit well enough to be read
   from the doorway.”* — shows **Requirements Met** and **$67,000**.
4. Click **Purchase**.

Treasury is **$6,660,313** against a $67,000 item, so it cannot fail on funds.
It is also the cheapest affordable thing in the catalog, so it is unmistakable.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Iframe shows the login screen** | Deck opened on `127.0.0.1` or `file://`. Cookies are `SameSite=Lax`, and the browser treats `127.0.0.1` and `localhost` as different sites. | Open the deck as `http://localhost:5180`. **Confirmed by testing:** framing from `127.0.0.1` bounces to `/login` every time; from `localhost` it stays signed in. |
| **Login screen, and the address bar is already `localhost`** | This browser profile was never signed in, or cookies were cleared. | Redo section 1e in this profile. |
| **Login screen on one slide only, others fine** | Intermittent race on first load. Seen once in eight loads on `/progress`. | Reload the deck tab. It has not recurred in eight further loads. |
| **Case slide errors / “session not found”** | Session id stale — someone re-ran the seeder. | `.venv/bin/python backend/scripts/repin_demo_session.py --write`, reload the tab. |
| **Case slide loads but shows no strategy brief** | The session was consumed — someone answered question 3 already. | Re-run the seeder (section 1b, ~8 min), then re-pin. If there is no time, press **`S`** and use the still. |
| **Guided tour overlay inside a slide** | The tour localStorage key is not set on the 5173 origin. | Section 1e step 3. It is per-origin and per-browser-profile. |
| **Lamp reads `APP NOT RUNNING`, still image shown** | Frontend dev server is down. This is the safety net working correctly. | Restart 1c, reload the deck. |
| **Backend on the wrong port** | Started without `PORT=5001`; it binds 5000, where macOS AirPlay Receiver also listens. | Stop it, restart with `PORT=5001`. Verify with the `curl` in 1a. |
| **`EADDRINUSE` on 5001 / 5173 / 5180** | A previous run is still alive — quite possibly already the one you want. | Check first: `lsof -nP -iTCP:5001 -sTCP:LISTEN`. If it is healthy, use it. |
| **Everything is on fire** | — | Press **`S`**. Present from stills. Nobody will know. |

---

## 5. What was actually verified, and when

Checked on **2026-08-10, 11:15–12:00**, by loading each route in a real Chromium iframe
served from a `localhost` page — the same shape as the deck — and by driving the deck itself.

| Check | Result |
| --- | --- |
| `/cases/<id>` framed, authenticated, brief + reasoning box + confidence present | **pass** |
| `/progress` framed, authenticated, populated | **pass** (3/3 on retest; 1 flake in 8 first-run loads) |
| `/firm?tab=upgrades` → Decor → trophy shelf $67,000, Purchase | **pass** |
| `/office`, `?officeTier=0`, `?officeTier=14&officeAll=1` | **pass** |
| `/map` | **pass** |
| Deck slide 12 frames `/cases/<id>`, lamp LIVE | **pass** |
| Advancing 12 → 13 destroys the case iframe, loads `/progress` | **defect confirmed** |
| `?stills=1` → no iframes, `/stills/demo-case.png`, STILLS badge | **pass** |
| Health-check swap on a dead app origin → still + `APP NOT RUNNING` | **pass** |
| Framing from `127.0.0.1` instead of `localhost` | **bounces to login, as documented** |

Not verified: the guided-tour overlay could not be reproduced even in a profile that had
never set the key, so set it anyway — it costs one line and the failure mode is a 21-step
overlay on a projector.
