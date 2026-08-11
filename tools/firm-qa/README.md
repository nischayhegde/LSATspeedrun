# Firm tab QA harness

The probes behind `.firm-polish.md`. They were written in `/private/tmp/lsat-firm`
under `.qa-run/`, which was scratch and is now ignored; the harnesses are kept
here for the same reason `tools/map-qa/` is, so they survive one worktree.

`seed_firm.py` is the one to start with: it builds the tier-7 firm every claim in
the write-up was checked against — 420 cases, 7 of 11 Old Quarter districts
signed, 14 connections owned — by running the real game module, so cash, ledger
and gates stay consistent with what the server will report. The rest drive a
browser against that state: `probe.mjs` reads rendered text back (a `<select>`'s
contents and 11px body copy are not things a screenshot can honestly evidence),
`shoot.mjs` takes the two-width screenshot matrix, and the others each answer one
question named in their header comment.

Assumptions they carry from the session that wrote them, none of them portable:

- Playwright is imported by absolute path from the root `node_modules`, and the
  scene harnesses (`crest.mjs`, `map-landing.mjs`) need headed system Chrome —
  headless Chromium's software rasteriser cannot get a frame out of the 3D scenes.
- The app is on `127.0.0.1:4372` and the API on `127.0.0.1:5372`, with dev login
  as `firm-qa@localhost.test`.
- `seed_firm.py` puts `/private/tmp/lsat-firm/backend` on `sys.path`, and the
  shooters write into that worktree's `.qa-run/shots/`. Both need repointing
  anywhere else.
