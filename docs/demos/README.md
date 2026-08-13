# Product demo GIFs

Short, real-app loops for product pages, release notes, and the repository README.

| Demo | What it shows |
| --- | --- |
| ![Dashboard metrics](dashboard-metrics.gif) | Mega-litigation accuracy, projected score, pace, review recovery, and detailed evidence. |
| ![Strategy methods](strategy-methods.gif) | Personalized LR/RC method comparisons and the evidence behind each recommendation. |
| ![Money and upgrades](game-money-upgrades.gif) | The firm treasury, office-tier requirements, and purchasing an upgrade that increases case payouts. |
| ![Practice exam](practice-exam.gif) | The one-sitting mega-litigation gate, timer, and first exam question. |
| ![Answer feedback loop](answer-feedback-loop.gif) | Selecting an answer, writing reasoning, rating confidence, and receiving the verified verdict. |
| ![LLM reasoning feedback](llm-reasoning-feedback.gif) | The learner’s explanation, the coach’s first-error diagnosis, the clean reasoning process, and why each key choice succeeds or fails. |
| ![3D office](game-office.gif) | The living 3D headquarters and its orbit camera. |
| ![Career map](game-career-map.gif) | The career route, rival-firm layer, and animated world navigation. |

## Recreate the set

From the repository root, prepare the deterministic local learner:

```powershell
$env:DEV_AUTH_ENABLED='true'
.\.venv\Scripts\python.exe -m flask --app backend\run.py db upgrade
.\.venv\Scripts\python.exe backend\scripts\seed_demo_learner.py --apply --replace
```

Run the API on port 5001 and Vite on port 5173, then capture:

```powershell
$env:PORT='5001'
.\.venv\Scripts\python.exe backend\run.py

# In a second terminal
Set-Location frontend
npm run dev

# In a third terminal, also from frontend
npm run capture:demos
```

The capture uses an installed Chrome or Edge browser. Set `BROWSER_EXECUTABLE` when neither browser is in its standard location. `DEMO_BASE_URL`, `DEMO_OUTPUT_DIR`, `DEMO_WIDTH`, and `DEMO_HEIGHT` are optional overrides.

Set `DEMO_ONLY` to a filename or stem, such as `llm-reasoning-feedback`, to refresh one GIF without recapturing the complete set.

The answer loop records one local practice attempt. Re-run the demo learner seeder afterward when you want the exact baseline fixture restored.
