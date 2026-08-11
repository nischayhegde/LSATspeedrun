# Captured coaching grades

`coaching.json` holds real grades the coaching model produced, so that the
payoff beat of the deck can be staged on a machine with no LLM gateway.

It is written by `stage_demo.py --capture-coaching` and read by `stage_demo.py`
whenever the gateway refuses. If the file is not here, nothing changes: the case
stages ungraded exactly as it did before, and says so.

## Why this exists

The coaching call is made by the **backend** to an LLM gateway, authenticated
with `TFY_API_KEY` against `TFY_URL` (`app/coaching.py::_chat`). It is a
server-to-server call and has nothing to do with who is signed in, so no account
credential makes it work on a machine without those two variables — and that is
every machine but the presenting laptop.

At presentation time the grade is already a stored read: `run_attempt_coaching`
returns `feedback_json["coaching"]` verbatim once `coaching_status` is
`completed`, calling nothing. So the beat does not need a gateway. It needs a
stored grade. This is where one is kept.

On the presenting machine that is also worth having, for a different reason: a
gateway that is down, rate-limited or unbilled on presentation morning means
`npm run reset-demo` — the command every recovery path points at — restages the
centrepiece ungraded.

## The rule

**Every grade in here is output the model actually produced. Nothing in here is
written by hand.**

The slide this feeds argues that the grade is the product. A composed grade on
that slide would be a lie told by the thing being sold, so there is no
hand-written fallback anywhere in the staging path and there must never be one.
`--capture-coaching` refuses to run without a working gateway for exactly this
reason: it has nothing to capture, and it will not invent one.

## Capturing one

On a machine where the coach works — i.e. `TFY_API_KEY` and `TFY_URL` are set
and `/v1/health` reports `coaching.ready: true`:

```bash
cd deck && npm run capture-coaching   # stages as usual, and pins what it grades
git add backend/scripts/demo_fixtures/coaching.json && git commit
```

Then any machine, with no key, reproduces that exact coached text.

## What makes it safe to replay

A capture records what it is a grade *of*, and is only replayed when all four
still match:

| field | why it is in the fingerprint |
| --- | --- |
| `question_id` | a grade of a different question is not this grade |
| `selected_label` | the analysis is written around the answer that was picked |
| `reasoning_sha256` | a grade of text the room is not reading is fabricated, however real its words |
| `prompt_version` | a rubric change makes an old grade a grade under different rules |

Nothing in the payload is keyed to a session, attempt or user id — only to
choice labels — so unlike the six values `reset-demo` re-pins, there is nothing
here to re-point after a re-seed. `DEMO_QUESTION_ID` is a stable id from the
tracked question bank, and the two reasoning texts are constants in
`stage_demo.py`, so a database rebuilt from nothing produces the same inputs and
the capture still describes them.

One input is not repo-tracked and is worth knowing about: the prompt includes up
to five of the account's other written explanations as anti-reuse samples, so
re-capturing against a different database can produce different words. That does
not make a capture untrue — it is still the model's real grade of this reasoning
on this question — but it is why this is a capture rather than something anyone
should expect to reproduce byte for byte.

## Beats

| `beat` | reasoning constant | used by |
| --- | --- | --- |
| `solo` | `SOLO_REASONING` | `demo-case-answer`, the driven one-question run — the beat that matters |
| `verdict-twin` | `DEMO_REASONING` | the pre-graded twin at `{verdictSession}`, which no slide requests today |
