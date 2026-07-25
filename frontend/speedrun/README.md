# LSAT Speedrun

A standalone product prototype for the LSAT.ai PRD. It does not import, mount, or call the existing Lawyer Tycoon application. It has its own Vite entrypoint and runs on port `5174`.

## Stack

- React 19 and TypeScript
- Vite 7
- Lucide React icons
- Plain responsive CSS with keyboard-visible focus treatment and reduced-motion support
- Local React state for the demo flows; no account, score, or attempt data leaves the browser

## Run locally

The repository's existing `frontend/node_modules` satisfies this standalone app during local development.

```bash
cd /Users/alan/LSATspeedrun/frontend/speedrun
npm run dev
```

Open `http://127.0.0.1:5174`.

Use `npm run build` to typecheck and produce a production bundle.

## Included product flows

- Daily recommendation and readiness home
- 5-question timed Speedrun player with flagging, answer review, results, and separate learning/game results
- Guided, step-based tutor with a hint ladder and transfer scheduling
- Problem-type lessons and an active warmup
- Local competitive league, ranked eligibility framing, challenges, and private league entry points
- Light cosmetic Firm progression with explicit no-pay-to-win guardrails
- Confidence-aware analytics, skill evidence, score estimate range, and uncertainty guidance
- Current-format full mock and section-sprint surface

## Question data boundary

The demo currently uses five original sample questions packaged in `src/speedrun-app.tsx` so it can run completely independently. It may later read the repository's existing `backend/data/question_bank/` snapshot through a dedicated Speedrun content service, but it should not bundle or republish that dataset until its use rights are confirmed. The existing repository notes that the upstream dataset cards do not currently declare a license.

The LSAT-format estimate displayed in the prototype is illustrative only. It is not an official LSAT score, admissions prediction, or psychometrically validated claim.
