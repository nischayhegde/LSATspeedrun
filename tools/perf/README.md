# An authenticated performance harness

Every browser performance tool in this repository has, until now, measured
`/login`. Not by choice: the tools serve a built `dist` from a private port with
no API behind it, `/v1/me` answers 401, `Protected` bounces, and the run records
whatever `/login` does. Three routes were never measured at all, and a whole QA
sweep was thrown away when it turned out every row in it was `/login` compared
against `/login`.

This directory is the way in. It stands up a backend of the harness's own, on
its own throwaway database, and hands a Playwright page a real session — and
then *proves* on every route that the session survived, so a green result cannot
be silently fake.

## The three pieces

- **`harness-backend.sh`** — creates `.harness/harness.db` (SQLite, migrated,
  question bank seeded, `seed_demo.py` account installed) and runs the API on
  **127.0.0.1:5810**. It is a throwaway: nothing here touches the database the
  live demo on 5273/5333 is using, and `--reset` deletes and rebuilds it.
- **`authed.mjs`** — the reusable library. Signs in through `POST /v1/auth/dev`,
  carries both cookies into a Playwright context, resolves `/cases/:id` to a real
  session id, and exports `proveSignedIn()`.
- **`authed-check.mjs`** — the proof, standalone. Loads every route with a
  session and reports, per route, where it landed and what `/v1/me` said.

`prod-serve.mjs` in `../css-split/` gained one option for this: `api` may now be
a URL, in which case `/v1/*` is proxied there instead of answered with a 401.

## Running it

```sh
# once per machine, ~40 s
tools/perf/harness-backend.sh --reset      # build the database
tools/perf/harness-backend.sh              # run the API on 5810 (foreground)

# then, in another shell, against any built dist
node tools/perf/authed-check.mjs frontend/dist
node tools/css-split/waterfall.mjs frontend/dist --auth --route /firm
node tools/css-split/fcp-ab.mjs /tmp/base /tmp/head --auth --route /cases/:id
```

`--auth` is what makes a tool authenticated: it points the static server's
`/v1/*` at 5810, signs in, and refuses to record a number if the proof fails.
`/cases/:id` is a literal string the tools accept; it is replaced with the
seeded account's real open session.

## Why the proof has to be in the harness

The failure this is built against does not look like a failure. `POST
/v1/auth/dev` answers with **two** `Set-Cookie` headers, `lsat_session` and
`lsat_csrf`. A proxy that copies upstream headers into a plain object keeps only
the last one, so the `HttpOnly` session cookie is dropped — and sign-in still
*appears* to work, because the response body carries the user and the app
navigates. The next `/v1/me` 401s and the app returns to `/login`. See
`.qa-report.md` S4-7; the corrected server is `.qa-tmp/serve2.mjs`, and
`getSetCookie()` is what this one uses.

So `proveSignedIn()` checks three independent things per route, and throws
rather than returning a number if any of them fails:

1. the final URL is the route asked for, not `/login`;
2. `/v1/me` fetched from inside the page answers 200 with the expected email;
3. the document is not the sign-in screen (no `Enter local development firm`).

## The load average is part of the result

The same production build on this machine measured 1.9 s largest paint at load
25 and 8.8 s at load 68. Every helper here records `loadavg` at the start and
end of a run and prints it with the numbers; a run whose load moved by more than
a few points while it was being taken is not comparable with one taken quietly.
