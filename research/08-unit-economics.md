# 08 — Unit Economics and Business Model

**Status:** working analysis, written incrementally
**Date:** 2 August 2026
**Question:** does the recommended **$19/month** price survive a full cost pass-through?

---

## 0. Executive summary

**Short answer: $19/month survives comfortably *without* an LSAC content license and does not
survive *with* one — and the reason is not what the brief assumed.**

Three findings invert the working hypothesis:

1. 🟢 **LLM inference is not the problem. It is ~$1.29 per active user-month** (expected case),
   about **6.8% of a $19 subscription.** The brief assumed "frontier-model grading." The code is
   configured to `gpt-5.6-luna` — the *cheapest* model in the GPT-5.6 family, and one whose price
   was cut **80% on 30 July 2026**, three days before this analysis. The Method Lab is, on current
   configuration, close to free. See §2.
2. 🔴 **Content licensing is the entire problem, and it is a problem of *amortization*, not
   headline price.** The LSAC coaching fee is **$38 per student per _year_**. Against a customer
   who stays the ~3 months an LSAT cycle actually lasts, that is **$12.67 per user-month — 67% of a
   $19 subscription** before a single other cost. See §1.
3. 🟢 **Infrastructure is a rounding error above ~100 users** (~$0.29–0.80/user-month) but carries
   a **~$64/month fixed floor that does not scale to zero**, dominated by a NAT Gateway. See §3.

**Gross margin at $19/month:**

| Scenario | With LSAC license | Without license (original items) |
|---|---|---|
| Conservative usage | **23%** | **90%** |
| Expected usage | **19%** | **86%** |
| Heavy usage | **−18%** | **49%** |

**The single assumption that most changes the conclusion** is **average paid subscription lifetime
in months**, because it is the divisor on the $38 annual license. At a 3-month life the price fails;
at a 12-month life the same $19 yields a 69% margin. Everything else is second-order. See §5.

---

## 1. Content licensing

### 1.1 The published fee, read precisely

From `research/03-content-licensing.md` §"LSAC rate card", sourced to LSAC's official licensing page
(live page 403s; verified via the [20 May 2024 Wayback capture](https://web.archive.org/web/20240520051533/https://www.lsac.org/contact/official-lsat-content-licensing)
and current 2026 search retrievals showing identical figures):

| Line item | Fee | Who pays |
|---|---|---|
| **Coaching License** | **$38 per student per year** (nonprofit: $19 if prep is free to the student) | Us |
| **LawHub Advantage** | **$124/year** | The **student**, directly to LSAC |
| Public Marketing License | $5,000/year — only if real items appear in public marketing | Us, optional |
| Processing Fee, Student Subscription Fee, others | Unpublished; named in LSAC's *TestMax* pleading | Us, unknown |
| Counsel to review the CLA | $2,000–$10,000 one-time | Us |

⚪ **The brief's framing — "three months at $19 is $57 revenue against a $38 content cost" — is
directionally right but mechanically wrong, and the correction makes it worse, not better.** The $38
is annual, so a *single* student who stays 12 months costs $38 total, not $152. But the fee is
**per student**, charged on enrollment, and it does **not** refund when a student churns at month 3.
So the fee behaves as a **fixed acquisition-time cost per student**, and the monthly burden is
entirely determined by how long that student stays.

### 1.2 Amortized cost per active user-month

```
licensing cost per user-month = $38 / (average paid lifetime in months)
```

| Average paid lifetime | Licensing $/user-month | As % of $19 |
|---|---|---|
| 2 months | $19.00 | 100% |
| **3 months (LSAT cycle — expected)** | **$12.67** | **67%** |
| 4 months | $9.50 | 50% |
| 6 months | $6.33 | 33% |
| 12 months | $3.17 | 17% |

⚪ **Why 3 months is the right expected case (labeled estimate).** An LSAT preparation cycle is
conventionally 3–4 months of concentrated study aimed at a single administration. `research/05`
records that every competitor subscription page in this market carries a "how do I cancel" FAQ, and
notes students "hate paying monthly for a study period of unknown length." Monthly-billed test-prep
is a structurally short-lived subscription. **I use 3 months as expected, 2 as conservative, 6 as
optimistic.** This is an estimate; no source in the corpus measures actual LSAT-prep subscription
tenure, and it is the highest-value number to go measure.

### 1.3 Two structural mitigations that the fee's shape invites

Because $38 is **annual and per-student**, not per-month, the correct response is not to cut cost —
it is to **change the billing shape so the customer's cash arrives before they churn**:

- **Annual or cycle-length pricing.** A single $38 charge against a 12-month prepaid plan is 17% of
  revenue; against month-to-month it is 67%. This is the single highest-leverage pricing decision
  available, and it costs nothing to implement.
- **Gate the license on paid conversion.** The CLA requires every student served official content to
  hold an active LawHub Advantage link, which already forces a hard gate. Ensure the $38 is
  triggered by *paid* enrollment, not signup — otherwise every free-trial tire-kicker costs $38.
  🔴 **This is a contract-negotiation item to raise explicitly with LSAC**, and its answer changes
  the free-trial design in §8 completely.

---

## 2. LLM inference on the core loop

### 2.1 What the code actually does

Verified by reading `backend/app/coaching.py`, `backend/app/jobs.py`,
`backend/app/services.py`, and `backend/app/__init__.py`:

| Parameter | Value | Source |
|---|---|---|
| Model | **`gpt-5.6-luna`** | `backend/app/__init__.py:109` |
| Reasoning effort | **`xhigh`** (maximum) | `backend/app/__init__.py:110` |
| `max_completion_tokens` | **5,000** | `coaching.py:53` |
| Response format | `json_object` | `coaching.py:69` |
| Provider | TrueFoundry OpenAI-compatible gateway | `coaching.py:39–41` |
| Retries | **up to 3 attempts** (`AI_JOB_MAX_ATTEMPTS`) | `__init__.py:113`, `jobs.py:147` |
| Trigger rate | **every practice item** | `services.py:500, 852` — `requires_reasoning=True` |
| Exempt | diagnostics only (`requires_reasoning=False`) | `services.py:547` |
| Minimum explanation | 120 chars (deep/review), 40 chars (speedrun/infinite) | `services.py:35` |

**The brief's premise that this is "frontier-model grading" is incorrect, and that is the single
most important cost fact in this document.** `gpt-5.6-luna` is the *cheapest* tier of the GPT-5.6
family, not the flagship. Note also that the bare alias `gpt-5.6` routes to **Sol**, the flagship —
the code explicitly avoids that. Whoever wrote line 109 made a ~25× cost decision correctly.

### 2.2 Current published pricing

Per 1M tokens, standard short-context, after OpenAI's **30 July 2026** price cut
([CNBC](https://www.cnbc.com/2026/07/30/open-ai-price-cut-gpt.html);
[Vellum](https://www.vellum.ai/blog/gpt-5-6-sol-terra-luna-explained);
[CometAPI](https://www.cometapi.com/gpt-5-6-pricing/);
[DevTk](https://devtk.ai/en/blog/gpt-5-6-api-pricing-guide-2026/)):

| Model | Input | Cached input | Output | vs Luna |
|---|---|---|---|---|
| **`gpt-5.6-luna`** ← in use | **$0.20** | $0.02 | **$1.20** | 1× |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 | 10× |
| `gpt-5.6-sol` (= alias `gpt-5.6`) | $5.00 | $0.50 | $30.00 | 25× |

Luna was cut **80%** (from $1.00/$6.00) on 30 July 2026; Terra 20%; Sol unchanged. ⚪ **Rate-change
risk is live and asymmetric** — these prices are 3 days old as of writing, and an 80% cut can be
partially reversed. Model the business at pre-cut Luna ($1.00/$6.00) as a stress case; see §5.

⚪ **Caveat on `reasoning_effort: "xhigh"`.** Hidden reasoning tokens are billed at the **output**
rate ([Originality.AI](https://originality.ai/blog/gpt-5-6-sol-vs-luna-vs-terra-pricing-calculator)),
so `xhigh` is a direct multiplier on the largest line. It is also bounded here by
`max_completion_tokens: 5000`, which caps worst-case output — see the truncation risk in §2.5.

### 2.3 Tokens per coaching call — derived from the code, not guessed

**Input.** The request is one system prompt plus a JSON payload (`coaching.py:240–248`):

| Component | Tokens (est.) | Basis |
|---|---|---|
| System prompt | ~1,150 | `coaching.py:191–229`, ~4,400 chars, fixed on every call |
| Question JSON — LR | ~350 | stimulus + stem + 5 choices |
| Question JSON — RC | ~800 | adds full `passage.canonical_text` (~450 words), **re-sent per item** |
| Student reasoning | ~70 | 40–120 char floor, 4,000 char cap; realistic 150–400 chars |
| `recent_reasoning_samples` (5 prior) | ~350 | `coaching.py:230–239`, 5 × ~70 |
| JSON/wrapper overhead | ~40 | |
| **Weighted total (60% LR / 40% RC)** | **~2,100** | low ~1,700 · high ~6,000 |

**Output.** Visible JSON is bounded by the validator's per-field character caps
(`coaching.py:160–186`): 420 + 420 + 360 + 360 + 700 + 700 + (5 × 520) + 360 + 600 + 500 ≈ **7,020
chars ≈ 1,800 tokens** absolute maximum. Realistically models do not max every field: **~1,100
visible tokens.** Add `xhigh` reasoning tokens, estimated **~1,800**, hard-capped with visible output
at 5,000.

| Case | Input | Output | Cost/call |
|---|---|---|---|
| Low | 1,700 | 1,800 | (1,700 × $0.20 + 1,800 × $1.20) / 1M = **$0.0025** |
| **Expected** | **2,100** | **2,900** | (2,100 × $0.20 + 2,900 × $1.20) / 1M = **$0.0039** |
| High | 6,000 | 5,000 (capped) | (6,000 × $0.20 + 5,000 × $1.20) / 1M = **$0.0072** |

**Retry multiplier.** Validation in `_validate_coaching` is strict — it rejects the response if the
verdict is outside the enum, the grade is non-numeric, or **any single answer choice goes
unexplained** (`coaching.py:157`). Each rejection re-bills a full call, up to 3 attempts. ⚪ Assume
**1.05× / 1.10× / 1.25×** (low/expected/high). This is an estimate; the true retry rate is
measurable from `AiJob.attempt_count` and should be.

| Case | Effective cost per graded item |
|---|---|
| Low | **$0.0026** |
| **Expected** | **$0.0043** |
| High | **$0.0090** |

### 2.4 Cost per active student-month

⚪ Usage tiers are estimates. `PRACTICE_SESSION_SIZE` defaults to 10 items
(`__init__.py:87`) and up to 8 runs may be queued at once (`PRACTICE_QUEUE_MAX`), so sessions are
short and repeatable — a serious student drills daily.

| Usage tier | Items/month | Inference $/user-month |
|---|---|---|
| Conservative (~2 sessions/wk) | 100 | **$0.26** |
| **Expected (~10 items/day)** | **300** | **$1.29** |
| Heavy (~30 items/day) | 900 | **$8.10** |
| 🔴 Extreme power user | 2,000 | **$18.00** |

**Two conclusions:**

- 🟢 **The mean is trivially affordable.** $1.29 against $19 is 6.8%. There is no inference crisis.
- 🔴 **The tail is not.** A single 2,000-item/month user consumes ~95% of a $19 subscription in
  inference alone. This is an argument for a **volume cap**, not for a cheaper model. See §4.

### 2.5 Two code-level risks worth flagging (no changes made)

- ⚪ **Truncation → retry → cost loop.** If `xhigh` reasoning consumes the 5,000-token budget, the
  visible JSON truncates, fails `json.loads`, and retries — up to 3 full-price calls that still fail.
  Worth monitoring; the cost is real but the reliability cost is larger.
- ⚪ **RC passages are re-sent on every item and never cached.** Consecutive RC items share one
  passage, and the ~1,150-token system prompt is identical on every call. Prompt caching gives a 90%
  input discount, but at Luna's $0.20 input rate the entire saving is **~$0.0003/call** — about
  **$0.09 per user-month**. **Not worth engineering.** Optimize licensing, not tokens.

---

## 3. Infrastructure

### 3.1 What `deploy/ec2/cloudformation.yaml` provisions

| Resource | Configuration | Line |
|---|---|---|
| EC2 web | **t3.micro**, Spot (`one-time`), 16 GB gp3 | 12, 597, 613 |
| RDS | **db.t4g.micro** PostgreSQL, 20 GB gp3 (autoscale 50), **Single-AZ**, 1-day backup | 381–392 |
| **NAT Gateway** | 1×, with Elastic IP | 212, 228 |
| SQS | 1 main (270s visibility) + 1 DLQ | 410–434 |
| Lambda AI worker | python3.11, **1024 MB**, 240s timeout, **BatchSize 1** | 515–562 |
| CloudFront | **PriceClass_100** | 806–839 |
| Secrets Manager | 1 RDS master secret (`ManageMasterUserPassword`) | 385, 463 |
| CloudWatch Logs | 7-day retention | 573 |

### 3.2 Fixed monthly floor (us-east-1, on-demand, 730 hrs)

| Line item | Rate | $/month |
|---|---|---|
| 🔴 **NAT Gateway** | $0.045/hr + $0.045/GB | **$32.85** |
| EC2 t3.micro (on-demand $0.0104/hr) | | $7.59 |
| — *same on Spot (~70% discount, est.)* | | *~$2.30* |
| EBS gp3, 16 GB | $0.08/GB-mo | $1.28 |
| RDS db.t4g.micro | $0.016/hr | $11.68 |
| RDS gp3 storage, 20 GB | $0.115/GB-mo | $2.30 |
| RDS backup (1-day, ≤100% of provisioned) | free | $0.00 |
| Public IPv4 addresses (~2) | $0.005/hr each | $7.30 |
| Secrets Manager | $0.40/secret-mo | $0.40 |
| CloudWatch Logs, SQS, S3, CloudFront | within free tiers at low volume | ~$1.00 |
| **Total fixed floor** | | **~$64/month** (~$59 on Spot) |

RDS rates: [Holori us-east-1 table](https://calculator.holori.com/aws/rds) ($0.0160/hr db.t4g.micro
PostgreSQL = $11.68/mo), [gp3 $0.115/GB-mo](https://go-cloud.io/amazon-rds-pricing/),
[backup free to 100% of provisioned](https://www.usage.ai/blogs/aws/reserved-instances/rds/pricing-calculator/).
Official rate cards: [EC2](https://aws.amazon.com/ec2/pricing/on-demand/),
[RDS](https://aws.amazon.com/rds/postgresql/pricing/), [NAT Gateway](https://aws.amazon.com/vpc/pricing/),
[Lambda](https://aws.amazon.com/lambda/pricing/), [SQS](https://aws.amazon.com/sqs/pricing/),
[CloudFront](https://aws.amazon.com/cloudfront/pricing/).

🔴 **The NAT Gateway is 51% of the idle bill and the single most wasteful line item.** It exists to
give the private-subnet Lambda outbound access to the TrueFoundry endpoint. At 0 users it costs
$32.85/month to do nothing. VPC endpoints, or simply running the Lambda outside the VPC with an
RDS Proxy or public-subnet path, would remove most of it. ⚪ Not a change I made; flagged for the
infra owner.

### 3.3 Run rate at 0 / 100 / 1,000 / 10,000 users

⚪ **All four are estimates.** Assumes expected usage (300 graded items/user-month) and Lambda
invocations that *block* on the LLM call — 1 GB × ~25 s ≈ 25 GB-s ≈ **$0.00042 per item**, which is
~10% of the LLM cost itself and pure idle-wait.

| | **0 users** | **100 users** | **1,000 users** | **10,000 users** |
|---|---|---|---|---|
| Graded items/month | 0 | 30,000 | 300,000 | 3,000,000 |
| Fixed floor (NAT, IPs, secrets) | $41 | $41 | $41 | $74 |
| Compute (EC2 → ALB + fleet) | $8 | $8 | $52 | $146 |
| RDS (scaling class + storage) | $14 | $14 | $59 | $326 |
| Lambda (idle-wait dominated) | $0 | $13 | $126 | $1,260 |
| CloudFront / SQS / logs / transfer | $1 | $4 | $17 | $119 |
| **Total $/month** | **~$64** | **~$80** | **~$295** | **~$1,925** |
| **$/user/month** | — | **$0.80** | **$0.29** | **$0.19** |

Scaling assumptions: at 1,000 users, EC2 → 2× t3.small behind an ALB and RDS → db.t4g.medium with
100 GB; at 10,000, EC2 → 4× t3.medium, RDS → db.m6g.large **Multi-AZ** with 500 GB, NAT in 2 AZs.

🟡 **A non-cost scaling constraint worth naming:** `AI_JOBS_MODE` defaults to `sync`
(`__init__.py:111`), which makes the Flask process block on a 15–45 s LLM call. On a single t3.micro
this exhausts worker threads at a handful of concurrent students. The SQS/Lambda path exists and
must be the production default — this is a *capacity* bug, not a cost bug, but it caps you well
below 100 users if left on.

🟢 **Conclusion: infrastructure never threatens the price.** It is $0.19–0.80/user-month above 100
users. The only infrastructure problem is the $64 fixed floor at zero revenue.

---

## 4. Gross margin at $19/month

### 4.1 Fully loaded cost per active user-month

Payment processing at Stripe's standard US card rate, **2.9% + $0.30**
([Stripe pricing](https://stripe.com/pricing)) = **$0.85** on a $19 charge.

**With an LSAC coaching license (3-month average lifetime):**

| Cost line | Conservative | Expected | Heavy |
|---|---|---|---|
| Licensing ($38 ÷ 3 months) | $12.67 | $12.67 | $12.67 |
| LLM inference | $0.26 | $1.29 | $8.10 |
| Infrastructure | $0.80 | $0.50 | $0.80 |
| Payment processing | $0.85 | $0.85 | $0.85 |
| **Total COGS** | **$14.58** | **$15.31** | **$22.42** |
| **Gross profit on $19** | **$4.42** | **$3.69** | **−$3.42** |
| **Gross margin** | **23%** | **19%** | **🔴 −18%** |

**Without a license (original items only):**

| Cost line | Conservative | Expected | Heavy | Extreme (2,000 items) |
|---|---|---|---|---|
| Licensing | $0 | $0 | $0 | $0 |
| LLM inference | $0.26 | $1.29 | $8.10 | $18.00 |
| Infrastructure | $0.80 | $0.50 | $0.80 | $0.80 |
| Payment processing | $0.85 | $0.85 | $0.85 | $0.85 |
| **Total COGS** | **$1.91** | **$2.64** | **$9.75** | **$19.65** |
| **Gross margin** | **90%** | **86%** | **49%** | **🔴 −3%** |

### 4.2 Does $19 survive?

**Licensed: no.** A 19% gross margin is not a software business. The benchmark for a venture-scale
or even bootstrap-sustainable SaaS is 70–80%+; the median public SaaS company runs ~75%. At 19%,
each subscriber generates **$3.69/month of gross profit**, so a 3-month customer produces **$11.07
of lifetime gross profit** — which must then cover all customer acquisition, all salaries, and the
$2k–$10k of CLA counsel. **Any CAC above about $11 makes the business unprofitable per customer**,
and paid acquisition in test prep does not clear that bar.

**Unlicensed: yes, easily — but §1 of `research/03` says that product is illegal to ship with the
current bank, and `research/05` says an original-item product is the least credible thing in this
market.** The 86% margin is real and it is the margin of a *different, weaker* product.

### 4.3 What price does survive?

Solving for price *P* with licensed expected-case costs (fixed COGS $14.46 + 2.9% + $0.30):

| Target gross margin | Required price |
|---|---|
| Break-even (0%) | **$15.20** |
| 50% | **$31.34** |
| **70% (healthy SaaS)** | **$54.46** |
| 80% | **$86.32** |

Cross-referencing `research/05`'s competitor map — 7Sage $69, Demon $99, Blueprint $99, Lawgic
$40–60, LSAT Lab $65 — **a licensed product needs to price at $40–65/month, which is exactly where
the market already clears.** That is not a coincidence. The incumbent price band is not margin
gouging; **it is what the LSAC license costs plus a normal software margin.** $19/month is not a
disruptive insight, it is a pricing error that assumes away the license.

**The three coherent business models, and there are only three:**

| Model | Price | Content | Margin | Verdict |
|---|---|---|---|---|
| **A. Licensed, market-priced** | **$49/mo** or **$349/yr** | Official (licensed) | ~65–70% | 🟢 The real business |
| **B. Unlicensed, original items** | $19/mo | Original only | ~86% | 🟡 Legal, thin credibility |
| **C. Licensed at $19/mo** | $19/mo | Official (licensed) | ~19% | 🔴 Does not work |

⚪ Model A at **$349/year** is materially better than $49/month: it collects 12 months of cash
against a single $38 license charge, taking licensing from 67% of revenue to 13% and lifting gross
margin to ~80%. **If you take one recommendation from this document, take that one.**

---

## 5. The Method Lab question

### 5.1 Quantified

`research/05-market-and-competition.md` is unambiguous that written-reasoning grading is the
franchise:

> *"Every product in this market gives you an explanation after you commit to an answer. **Not one of
> them evaluates the student's own reasoning.** … The only existing way to get this is human tutoring
> at $150-220/hour. The Method Lab automates the most expensive line item in the category. …
> **This is the product. Everything else is packaging.**"* — §8, "What is genuinely underserved"

**The brief's hypothesis was that this differentiator is also the largest variable cost. It is not,
and it is not close.**

| Cost line | $/user-month (expected) | % of $19 | % of $49 |
|---|---|---|---|
| Content licensing | $12.67 | 66.7% | 25.9% |
| **Method Lab inference** | **$1.29** | **6.8%** | **2.6%** |
| Payment processing | $0.85 | 4.5% | 3.5% |
| Infrastructure | $0.50 | 2.6% | 1.0% |

**Licensing costs 9.8× what the Method Lab costs.** Optimizing inference to zero would move gross
margin at $19 from 19% to 26%. Fixing licensing amortization moves it from 19% to 69%.

### 5.2 The differentiation math, stated properly

The market price for evaluated written reasoning is **$150–220/hour of human tutoring**
(`research/05`: 7Sage $1,099/5hr, Demon $499/mo for 2 hrs 1:1). A 300-item month, with a human
spending a conservative 3 minutes reading and critiquing each written explanation, is **15 hours of
tutor time = $2,250–$3,300.**

We deliver the same artifact for **$1.29.**

⚪ That is a **~2,000× cost advantage** on the category's most expensive line item, and it is the
entire strategic case for the company. It survives at every usage tier tested, including the
2,000-item extreme user ($18.00 vs ~$7,500 of tutor time). **Nothing in this analysis should be read
as pressure to reduce Method Lab coverage.**

### 5.3 The five levers, and what each costs in differentiation

| Lever | Saves | Differentiation cost | Verdict |
|---|---|---|---|
| **Soft volume cap ~1,000 graded items/mo** | caps tail at $9.00 | ~zero (above 95th pct.) | 🟢 **Do this** |
| Batch/Flex API tier (50% off: $0.10/$0.60) | $0.65/user-mo | Real — delays feedback | 🟡 Conditional |
| Lower `reasoning_effort` from `xhigh` | ~$0.50/user-mo | Unknown, hits grading quality | 🔴 Don't |
| Meter Method Lab by tier (e.g. 150 items) | varies | High — teaches avoidance | 🔴 Don't |
| Premium-gate Method Lab entirely | varies | Catastrophic | 🔴 Never |

**Soft volume cap — recommended.** Set a cap around **1,000 graded items/month**, above the heavy
tier (900) and far above expected (300). Degrade gracefully rather than blocking: queue overflow
items at lower priority. This converts an unbounded liability into a bounded one for essentially no
product cost, because a student doing 1,000+ items a month is not being served better by item 1,001.
🔴 **Without a cap, one extreme user costs $18.00/month against $19.00 of revenue.**

**Batch/Flex — conditional.** Flex processing halves Luna to **$0.10/$0.60**
([DevTk pricing table](https://devtk.ai/en/blog/gpt-5-6-api-pricing-guide-2026/)), and the coaching
path is *already* asynchronous through SQS and Lambda (`jobs.py`), so the architecture tolerates
latency. But `research/05` records that immediate reasoning feedback is the pedagogical point.
⚪ **Use Flex only for the review-queue and blind-review paths where the student is not waiting;
keep Standard for live Method Lab.** Saves perhaps $0.40/user-month — real but not urgent.

**Do not lower `reasoning_effort`.** This is the inversion that matters: `xhigh` is the most
expensive setting available and it costs **$0.50/user-month** more than a mid setting. Grading
quality *is* the product. Spending fifty cents to protect the only defensible thing the company owns
is the easiest trade in this document. 🟢 **Keep `xhigh`.**

**Never premium-gate it.** `research/05` §6 warns that the fatal outcome is being sorted into the
"commodity app tier" — anonymous apps shipping "drills + AI tutor + streaks + SRS" with reviews that
are *"actively negative."* An entry tier with the Method Lab removed **is** that product. Gating the
differentiator behind the top tier means the tier most people see is the one with no differentiator.

### 5.4 The one Method Lab decision that actually threatens the price

Not usage. **Model choice.** Because inference scales linearly with the model tier:

| Model | $/graded item | $/user-mo @ 300 items | Margin @ $19, unlicensed |
|---|---|---|---|
| **`gpt-5.6-luna`** (current) | $0.0043 | **$1.29** | **86%** |
| `gpt-5.6-terra` (10×) | $0.0429 | $12.87 | 25% |
| `gpt-5.6-sol` (25×) | $0.1073 | $32.16 | 🔴 **−76%** |

🔴 **"Let's upgrade the coaching model for better grading quality" is a pricing decision disguised
as an engineering decision.** Moving to Sol at $19/month is instantly and catastrophically
unprofitable, licensed or not. Note that the bare alias `gpt-5.6` **routes to Sol** — a one-word
config edit at `__init__.py:109` would silently multiply COGS 25×. ⚪ **Recommend a hard budget
alert on inference spend per user before any model change is considered.**

---

## 6. Sensitivity analysis

Ranked by how much each assumption moves gross margin at $19/month. Baseline: licensed, expected
usage, 3-month lifetime = **19%**.

### 6.1 Assumption 1 — average paid subscription lifetime (the dominant variable)

This is the divisor on the $38 annual license.

| Lifetime | Licensing $/mo | Total COGS | **Gross margin @ $19** |
|---|---|---|---|
| 2 months | $19.00 | $21.64 | 🔴 **−14%** |
| **3 months (expected)** | $12.67 | $15.31 | **19%** |
| 4 months | $9.50 | $12.14 | 36% |
| 6 months | $6.33 | $8.97 | 53% |
| 12 months | $3.17 | $5.81 | 🟢 **69%** |

**Swing: 83 percentage points.** Nothing else in this document comes close.

⚪ **Published support for the short end.** Business of Apps' 2026 education-app benchmarks report
that **"just over half of all subscribers to education apps stick around after the first renewal"**
([Business of Apps](https://www.businessofapps.com/data/education-app-benchmarks/)). A ~50% month-2
survival implies an average monthly-billed lifetime near **2 months**, not 3. **The conservative
case may be the realistic one**, which would put a licensed $19 product *below break-even*.

### 6.2 Assumption 2 — whether a license is obtained at all

| | Gross margin @ $19 |
|---|---|
| Licensed (3-mo life) | 19% |
| Unlicensed, original items | 🟢 86% |

**Swing: 67 percentage points**, and it is binary. But it is not a free choice: `research/03`
concludes that shipping the current 6,886-item bank unlicensed carries a cease-and-desist within
**3–9 months** of traction and that LSAC won a personal judgment against a solo developer in 2025.
The 86% margin is only available on a *genuinely original* item bank — a different, weaker product.

### 6.3 Assumption 3 — LLM price stability

Luna's price is **three days old** as of writing. Stress-testing a reversion to pre-cut rates
($1.00/$6.00, i.e. 5×):

| Luna rate | Inference $/user-mo | Margin @ $19 licensed | Margin @ $19 unlicensed |
|---|---|---|---|
| Current ($0.20/$1.20) | $1.29 | 19% | 86% |
| Pre-30-July ($1.00/$6.00) | $6.45 | 🔴 **−8%** | 59% |

**Swing: 27 points.** ⚪ **This is larger than most people would guess and it is entirely outside our
control.** A single vendor price change on 30 July 2026 moved this business from unviable to viable
at $19 unlicensed. Do not build a business whose viability depends on a three-day-old price cut
holding — either price with headroom, or keep the volume cap tight enough that a 5× reversion is
survivable.

### 6.4 Assumptions that barely matter

| Assumption | Range tested | Margin swing |
|---|---|---|
| Infrastructure cost/user | $0.19 → $0.80 | 3 points |
| Retry multiplier | 1.05× → 1.25× | <1 point |
| Prompt caching on system prompt + RC passages | on/off | <0.5 point |
| Lambda idle-wait (moving off blocking invocations) | $0.13 → $0 | <1 point |

🟢 **Do not spend engineering time here.** The entire infrastructure line is smaller than the
month-to-month noise in the licensing assumption.

---

## 7. Break-even math

### 7.1 Fixed monthly costs

| Line | Licensed | Unlicensed |
|---|---|---|
| AWS floor (§3.2) | $64 | $64 |
| LSAC Public Marketing License ($5,000/yr, only if real items in marketing) | $417 | $0 |
| CLA counsel ($6,000 amortized over 12 mo) | $500 | $0 |
| **Fixed, founders unpaid** | **$981** | **$64** |
| One founder salary at $8,000/mo | $8,981 | $8,064 |

### 7.2 Subscribers required to break even

Gross profit per active user-month, expected usage:

| Model | Price | GP/user-mo | Break-even, founders unpaid | Break-even, one salary |
|---|---|---|---|---|
| 🔴 Licensed @ $19/mo | $19 | $3.69 | **266 subs** | **2,434 subs** |
| 🟢 Licensed @ $49/mo | $49 | $32.82 | **30 subs** | **274 subs** |
| 🟢 Licensed @ $349/yr | $29.08/mo eq. | $23.25 | **43 subs** | **387 subs** |
| 🟡 Unlicensed @ $19/mo | $19 | $16.36 | **4 subs** | **493 subs** |

⚪ Estimates. Excludes CAC, which `research/05` suggests can be near-zero via r/LSAT organic — the
one genuinely favourable input in this analysis.

**Read the first row carefully.** A licensed product at $19 needs **2,434 concurrent paying
subscribers** to support a single salary. At $38/student/yr that is $92,500/yr to LSAC — roughly the
scale `research/03` infers for **TestMax, an established national brand**. 🔴 **The $19 licensed
model requires incumbent scale to pay one person.**

### 7.3 The scenario where licensing is never obtained

This is the near-term reality: `research/03` says a license takes *"weeks to a few months"* and
certainly not the 1.5 weeks available before the ~12 August launch. So the **launch product ships
original items only**, whether or not that is the destination.

| | Conservative | Expected | Heavy | Extreme |
|---|---|---|---|---|
| COGS/user-mo | $1.91 | $2.64 | $9.75 | $19.65 |
| **Gross margin @ $19** | **90%** | **86%** | **49%** | 🔴 **−3%** |
| Break-even subs (founders unpaid, $64 fixed) | 4 | 4 | 7 | ∞ |

🟢 **At launch, $19/month works.** The economics of the unlicensed original-item product are
genuinely good, and the only thing that breaks them is an uncapped power user. **This is the
strongest argument in the document for the §5.3 volume cap: it is the one change that makes the
launch price safe.**

🔴 **The trap is the transition.** The day the LSAC license is signed, COGS jumps from $2.64 to
$15.31 and margin collapses from 86% to 19% — with no corresponding price change, because the
$19 price will already have been published, anchored, and defended on Reddit.

⚪ **Therefore: the licensing decision and the pricing decision are the same decision, and the
pricing one gets made first.** Either launch at $19 and pre-announce that official-content access
is a separate, higher-priced tier, or launch at a price that already has the license priced in.
Launching at $19 unlicensed and later adding the license at $19 is the one path that cannot work.

### 7.4 The combination that fails

| | Unlicensed | Licensed |
|---|---|---|
| **$19/mo** | 🟡 86% — works, weak product | 🔴 **19% — fails** |
| **$49/mo** | 🟢 95% — overpriced for the product | 🟢 **67% — works** |

**It is not licensing that breaks the business, and it is not the $19 price. It is the two
together.** Licensing at $49 produces $32.82/user-month of gross profit — **double** the $16.36 an
unlicensed $19 product produces — so the license is worth buying, *provided the price moves with it.*

🟢 **`research/00-implementation-plan.md` §3.5 already reaches this conclusion independently**
("ship … on 12 August as a reasoning-feedback and companion product … **Re-price and re-launch into
the $49–69 band when the licence lands**"). This document supplies the arithmetic that was missing:
the re-price is not optional positioning, it is **the difference between a 19% and a 67% gross
margin**, and the $49–69 band is almost exactly what the license mathematically requires.

---

## 8. Launch success definition

Nothing in the corpus defines launch success. Below are proposed targets, each benchmarked to a
published figure. Launch is ~12 August 2026, into the **October 7–10** and **November 11–14**
administrations (`research/05` §6).

### 8.1 The published benchmarks

| Benchmark | Figure | Source |
|---|---|---|
| Education app **Day 30 retention** | **2%** | [Business of Apps, Education App Benchmarks 2026](https://www.businessofapps.com/data/education-app-benchmarks/) |
| Education app D1 / D7 / D30 | ~14–15% / ~6% / **2–3%** | [Phiture, compiling Adjust/AppsFlyer/Statista/BoA](https://phiture.com/mobilegrowthstack/managing-retention-rate-benchmarks-and-expectations/) |
| Education/EdTech D1 / D7 / D30 | 23.4% / 10.6% / **5.9%** | [Adjust *State of App Growth* 2026, via RocketShip HQ](https://www.rocketshiphq.com/adjust-state-of-app-growth-2025-summary/) |
| EdTech **freemium → paid** | **2.6%** | [FirstPageSage, 80+ SaaS clients, 2022–2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) |
| EdTech **visitor → freemium signup** | **13.9%** | FirstPageSage (as above) |
| Consumer freemium → paid, typical | **2–4%** (Evernote 2%, Dropbox 2.5%, Typeform 3%) | [Forman, PLG benchmarks](https://grahamforman.medium.com/key-product-led-growth-plg-measures-and-benchmarks-for-k12-b2b-edtech-companies-7082ffe6c358) |
| **Duolingo** free→paid, S-1 (June 2021) | **4%** of active users (1.5M paid), up from 3% | Forman, citing Duolingo S-1 |
| **Duolingo** free→paid (2024) | **~7.7%** (8M subs / 103.6M MAU) | [Duolingo FY2024 reported figures](https://robocitrus.com/en/blog/duolingo-monetarisierung-analyse) |
| EdTech **trial → paid** | Median **12–20%**; top quartile 25–40%; bottom quartile <8% | [Lifecycle Architect, EdTech Trial-to-Paid Benchmarks 2026](https://lifecyclearchitect.com/benchmarks/edtech-trial-to-paid-rate-benchmarks/) |
| — no-credit-card, time-limited trial | Median **12–18%** | Lifecycle Architect (as above) |
| — credit-card-required trial | Median 40–60%, but far fewer trial starts | Lifecycle Architect (as above) |
| Education app **first-renewal survival** | **"Just over half"** | Business of Apps (as above) |
| Average education app subscription price | **$8.13/mo · $56.09/yr** | Business of Apps (as above) |
| LSAT registrants, 2025-26 | **~202,500** (+~6% YoY) | `research/05` §6 |

### 8.2 Why our targets should sit *above* category average

⚪ Three structural reasons, stated so the targets can be argued with:

1. **The category benchmarks are dominated by casual mobile education apps** — free language and
   trivia apps with no deadline. LSAT students have a **fixed exam date**, a **~$10,000-per-point
   scholarship incentive** (`research/05`, LSAT Demon's framing), and have often already paid LSAC
   $124 for LawHub. Intent is not comparable.
2. **This is a web product with organic Reddit distribution**, not an app-store install funnel. The
   app-store benchmarks include a large mass of accidental, zero-intent installs we will not have.
3. **Conversely, the audience is tiny and skeptical.** ~202,500 registrants/year total, and
   `research/05` documents that r/LSAT actively warns against unofficial-question products.

**Net: target 2–4× the category benchmark on retention and conversion, and treat the category
benchmark itself as the kill threshold.**

### 8.3 Proposed targets — first 8 weeks (12 Aug – 7 Oct 2026)

| Metric | Definition | 🔴 Kill | 🟡 **Target** | 🟢 Strong | Benchmark anchor |
|---|---|---|---|---|---|
| **Signups** | accounts created | 400 | **1,000** | 2,500 | 0.5% of ~202,500 annual registrants; implies ~7,200 site visits at FirstPageSage's 13.9% visitor→signup |
| **Activation** | completed diagnostic **and** ≥3 graded Method Lab explanations, within 7 days | 25% | **40%** | 55% | vs education-app D1 of 14–23%; activation is intent-gated and should beat D1 |
| **Week-4 retention** | ≥1 graded attempt in days 22–28 of the signup cohort | 8% | **15%** | 25% | vs D30 of **2%** (BoA) / **5.9%** (Adjust) — target is 2.5–7× category |
| **Free → paid** | paid subscription started within 30 days of signup | 3% | **6%** | 10% | vs EdTech freemium 2.6%, Duolingo 4% at S-1, 7.7% in 2024 |
| **Trial → paid** (if 7-day no-CC trial) | | 10% | **18%** | 28% | vs EdTech no-CC trial median **12–18%** |
| **Month-2 renewal** | paid subs surviving first renewal | 45% | **60%** | 70% | vs education-app *"just over half"* |
| **Paying subscribers at 90 days** | | 30 | **75** | 200 | derived from the above |
| **Method Lab depth** | median graded explanations per activated user in month 1 | 15 | **40** | 100 | no published benchmark — this is the differentiator's usage proxy and must be tracked |

⚪ Every figure above is a proposal, not a finding. The two most likely to be wrong are **signups**
(no published LSAT-specific funnel data exists) and **week-4 retention** (our 15% target is
aggressive against a 2% category benchmark, justified only by the deadline-driven-intent argument).

### 8.4 What these targets are worth — and the honest conclusion

At **target** (75 paying subs at 90 days, unlicensed, $19/mo):

- MRR ≈ **$1,425**
- Gross profit ≈ **$1,227/month** (86% margin)
- Covers the $64 AWS floor **19×**
- Covers a single $8,000/month salary: **no — 15% of it**

🔴 **Launch success as defined above does not produce a salary, and no realistic version of it does
in 2026.** Break-even with one salary needs **493 subscribers** unlicensed (§7.2) — 6.5× the target.
**Success at this launch means proving retention and conversion, not revenue.** That should be
stated explicitly to whoever is funding the time, because the alternative is judging an
evidence-gathering launch by a revenue standard it cannot meet.

🟡 **The one metric that should override all others** is **week-4 retention**, because §6.1 showed
subscription lifetime is the single largest driver of viability under a license. Week-4 retention is
the earliest observable proxy for it. **If week-4 retention lands near the 2% category benchmark
rather than the 15% target, the licensed business is not viable at any price this market will bear,
and that is worth knowing in September rather than next year.**

---

## 9. Pricing structure

### 9.1 How competitors structure it

From `research/05` §2:

| Competitor | Shape | Trial / free entry | Fee-waiver |
|---|---|---|---|
| 7Sage | $69/mo, **$599/yr**; $129 Live; $299 Coach | Free trial | **$1/month** |
| LSAT Demon | $99/$179/$499 monthly | Free tier | 80% off (≈$19.80) |
| Blueprint | $99/$149–179 monthly + $1,299–1,999 one-time courses | — | — |
| LSAT Lab | Free tier (2 official PTs) → $65/$125/$425 | Free tier + **10-day no-questions refund** | 50% off |
| PowerScore | **$120 one-time books**; $35/mo analytics; $99/mo on-demand | **Free 7-day trial, no credit card** | — |
| Lawgic Prep (2026) | **$40–60/mo, single tier, everything included** | — | — |
| LSATMax | ~$500–5,000 **one-time, lifetime** | — | — |

⚪ **Four structural reads:**

1. **Monthly subscription is the default, and tiers ladder on *human contact*, not features.** Every
   upper tier in this market sells live classes or 1:1 hours. We have no humans to sell, so the
   standard tiering axis is unavailable to us. That is a genuine argument for a single tier.
2. **One-time pricing persists and works.** PowerScore sells $120 of books to people who will not pay
   $69/mo. `research/05`: *"Price sensitivity in this market is about commitment shape, not just
   amount — students hate paying monthly for a study period of unknown length."*
3. **A free tier or no-CC trial is the norm**, not a differentiator. Its absence is conspicuous.
4. **Fee-waiver pricing is a de facto industry requirement** and the cheapest credibility available.

### 9.2 Recommended structure at launch (unlicensed, original items)

| SKU | Price | Effective $/mo | Margin | Role |
|---|---|---|---|---|
| Free | $0 | — | — | Diagnostic, review queue, metered Method Lab |
| Monthly | **$19** | $19.00 | 86% | Default, low commitment |
| 🟢 **Cycle Pass (4 months)** | **$59** | $14.75 | 84% | **Primary CTA** — matches the real study period |
| Annual | **$149** | $12.42 | 79% | Anchor; prepays the future license |
| Fee-waiver | **$1/mo** | — | negative | Credibility (see warning below) |

**Why a 4-month Cycle Pass is the most important addition.** Students buy an *exam cycle*, not a
month. A cycle SKU (a) matches the mental model, (b) collects cash before the churn point that
§6.1 identifies as the dominant risk, and (c) is the only structure that survives the licensing
transition without a price rise — $59 against a $38 license is 64% margin where $19/mo against the
same license is 19%.

🔴 **Fee-waiver warning, unlicensed vs licensed.** At $1/month the program is free goodwill today.
**Under an LSAC license it costs $38/year per student against $12/year of revenue — a $26 loss per
fee-waiver student.** 7Sage and LSAT Demon eat exactly this cost for standing in the community.
⚪ **Cap the program by headcount from day one**, or pursue the separate nonprofit entity that
`research/03` §4.6 and `research/00` both flag, which qualifies for LSAC's **$19/student** nonprofit
rate — but only if the prep is genuinely free to the student.

### 9.3 Trial design

**Recommend: permanent free tier + no-credit-card gate, not a time-limited trial.**

- EdTech no-CC trials convert at a **12–18% median**; CC-required trials convert at **40–60%** but
  produce far fewer starts ([Lifecycle Architect](https://lifecyclearchitect.com/benchmarks/edtech-trial-to-paid-rate-benchmarks/)).
  In a market where `research/05` documents active suspicion of unfamiliar products, **demanding a
  card up front is the wrong trade** — we need volume of skeptics through the funnel, not
  self-selected converts.
- Follow `research/00`'s inversion: **make the rigor free and the volume paid.** Free = full
  diagnostic, review queue, and a metered Method Lab allowance. Paid = unlimited drilling and
  unlimited Method Lab. *"The free tier's job is to make skeptics say 'this is legit,' not 'this is
  cute.'"*
- ⚪ Meter the free tier at roughly **20 graded Method Lab items**, enough to experience the
  differentiator twice over. At $0.0043/item that is **$0.086 of inference per free signup** —
  1,000 free signups cost **$86**. Free-tier inference is a marketing expense, and a cheap one.
- 🟢 **Add a score-increase guarantee.** `research/05` §"Score guarantees": neither 7Sage nor LSAT
  Demon offers one, and r/LSAT reads LSAT Lab's as evidence of conviction (*"so they trust their
  curriculum that much"*). Copy Blueprint's *mechanism* — completion requirement, diagnostic floor,
  minimum subscription length — which also conveniently **lengthens subscription lifetime**, the
  variable §6.1 identifies as dominant. A guarantee is a retention instrument wearing a trust badge.

### 9.4 The licensing transition, priced

🔴 **The single most avoidable mistake available is publishing $19 as the price of official content.**

| | Launch (unlicensed) | Post-license |
|---|---|---|
| Monthly | $19 | **$49** |
| Cycle Pass (4 mo) | $59 | **$179** |
| Annual | $149 | **$349** |
| Gross margin (expected) | 86% | ~67–80% |

⚪ **Grandfather founding members at the launch price and say so loudly.** This converts the
re-pricing problem into a launch urgency mechanic, costs little at the volumes in §8.3 (75 subs ×
$30/mo of forgone price = $2,250/mo at worst, and only if all of them stay), and buys goodwill in
the exact community whose word-of-mouth is the distribution channel.

⚪ **Note the free tier resolves a legal constraint for free.** The CLA forbids serving official
content to students without an active LawHub Advantage subscription (`research/03`: *"only for
students who have an active student subscription"*). So the free tier **must** serve original items
only. The legal constraint and the ideal funnel design point the same way: **free = original items,
paid = official items.** That is a rare piece of luck and should be designed for now, not later.

### 9.5 Price-point sanity check

The average education-app subscription is **$8.13/month** ([Business of Apps](https://www.businessofapps.com/data/education-app-benchmarks/)).
$19 sits **2.3×** above it — consistent with `research/05`'s argument that *"the low end of this
market signals 'anonymous App Store app,' and a few dollars of separation is cheap insurance."*
🟢 **$19 is well-chosen as an unlicensed price.** It is simply not a licensed price.

---

## 10. Recommendations, ranked

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| 1 | **Do not ship a licensed product at $19.** Licensed pricing is $49/mo or $349/yr. | Decision | 🔴 Existential |
| 2 | **Add a 4-month Cycle Pass and make annual the primary CTA.** Collects cash before churn; turns licensing from 67% of revenue into 13–25%. | Days | 🔴 Existential |
| 3 | **Cap Method Lab at ~1,000 graded items/user-month (soft).** Makes the launch price safe against the extreme-user tail. | Days | 🟡 High |
| 4 | **Instrument subscription lifetime and week-4 retention from day one.** It is the dominant variable in every model here and nobody has measured it. | Days | 🔴 Existential |
| 5 | **Confirm with LSAC whether the $38 triggers on signup or on paid enrollment.** Changes free-tier design entirely. | One email | 🟡 High |
| 6 | **Keep `gpt-5.6-luna` and keep `reasoning_effort: xhigh`.** Add a budget alarm before any model change; the `gpt-5.6` alias routes to Sol at 25× cost. | Hours | 🟡 High |
| 7 | **Set `AI_JOBS_MODE=async` in production.** A capacity ceiling, not a cost problem, but it caps you below 100 users. | Hours | 🟡 High |
| 8 | **Cap the fee-waiver program by headcount** before a license exists; each such student costs $26/yr net once licensed. | Hours | 🟢 Medium |
| 9 | **Add a score-increase guarantee with a minimum-subscription-length condition.** Trust signal *and* lifetime extender. | Days | 🟢 Medium |
| 10 | **Remove the NAT Gateway** (VPC endpoints or Lambda outside the VPC). Halves the idle bill. | Days | ⚪ Low |
| 11 | **Do not optimize prompt tokens or caching.** Saves <$0.10/user-month. | — | ⚪ None |

---

## 11. Source log

**LLM pricing** (all accessed 2 Aug 2026)
- [Vellum — GPT-5.6 Sol/Terra/Luna explained](https://www.vellum.ai/blog/gpt-5-6-sol-terra-luna-explained) — post-cut rates, reasoning-token billing
- [CometAPI — GPT-5.6 pricing](https://www.cometapi.com/gpt-5-6-pricing/) — full rate table incl. cached/long-context
- [DevTk — GPT-5.6 API pricing guide 2026](https://devtk.ai/en/blog/gpt-5-6-api-pricing-guide-2026/) — Batch/Flex and Fast tier rates
- [Layer3Labs — GPT-5.6 API pricing](https://www.layer3labs.io/guides/gpt-5-6-api-pricing) — 30 July 2026 price-cut deltas
- [Originality.AI — Sol vs Luna vs Terra calculator](https://originality.ai/blog/gpt-5-6-sol-vs-luna-vs-terra-pricing-calculator) — reasoning tokens billed at output rate
- [CNBC — OpenAI price cut, 30 July 2026](https://www.cnbc.com/2026/07/30/open-ai-price-cut-gpt.html) — primary event
- ⚪ *Caveat: these are secondary aggregators. Verify against OpenAI's live pricing page before committing.*

**AWS pricing** (all accessed 2 Aug 2026)
- [AWS EC2 On-Demand](https://aws.amazon.com/ec2/pricing/on-demand/) · [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/) · [VPC/NAT Gateway](https://aws.amazon.com/vpc/pricing/) · [Lambda](https://aws.amazon.com/lambda/pricing/) · [SQS](https://aws.amazon.com/sqs/pricing/) · [CloudFront](https://aws.amazon.com/cloudfront/pricing/) — official rate cards
- [Holori RDS calculator, us-east-1](https://calculator.holori.com/aws/rds) — db.t4g.micro PostgreSQL $0.0160/hr
- [go-cloud — Amazon RDS pricing 2026](https://go-cloud.io/amazon-rds-pricing/) — gp3 $0.115/GB-mo
- [Usage.ai — RDS pricing calculator](https://www.usage.ai/blogs/aws/reserved-instances/rds/pricing-calculator/) — backup free to 100% of provisioned
- [selfhost.dev — AWS RDS cost breakdown 2026](https://selfhost.dev/blog/aws-rds-cost-breakdown-2026/) · [CloudBurn — RDS pricing](https://cloudburn.io/blog/amazon-rds-pricing) — instance-class tables

**Edtech benchmarks** (all accessed 2 Aug 2026)
- [Business of Apps — Education App Benchmarks 2026](https://www.businessofapps.com/data/education-app-benchmarks/)
- [Adjust *State of App Growth* 2026, via RocketShip HQ](https://www.rocketshiphq.com/adjust-state-of-app-growth-2025-summary/)
- [Phiture — retention benchmarks](https://phiture.com/mobilegrowthstack/managing-retention-rate-benchmarks-and-expectations/)
- [FirstPageSage — SaaS freemium conversion rates](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [Lifecycle Architect — EdTech trial-to-paid benchmarks 2026](https://lifecyclearchitect.com/benchmarks/edtech-trial-to-paid-rate-benchmarks/)
- [Forman — PLG measures and benchmarks](https://grahamforman.medium.com/key-product-led-growth-plg-measures-and-benchmarks-for-k12-b2b-edtech-companies-7082ffe6c358) — Duolingo S-1, Evernote, Dropbox, Typeform
- [Duolingo FY2024 monetization analysis](https://robocitrus.com/en/blog/duolingo-monetarisierung-analyse) · [Duolingo Q4 2023 earnings call](https://www.fool.com/earnings/call-transcripts/2024/02/28/duolingo-duol-q4-2023-earnings-call-transcript/)
- [Stripe pricing](https://stripe.com/pricing) — 2.9% + $0.30

**Internal**
- `backend/app/__init__.py` (109–113), `backend/app/coaching.py`, `backend/app/jobs.py`,
  `backend/app/services.py` (35, 500, 547, 852, 1012–1016), `deploy/ec2/cloudformation.yaml`
- `research/03-content-licensing.md` (§4.1, §4.5, rate card), `research/05-market-and-competition.md`
  (§2, §8, pricing recommendation), `research/00-implementation-plan.md` (§3.3, §3.5, §9 item 3)

---

## 12. What would change my mind

⚪ Stated so this document can be falsified rather than believed:

1. **Measured subscription lifetime ≥6 months.** Would move licensed margin at $19 from 19% to 53%
   and make the current recommendation merely suboptimal rather than wrong. I consider this
   unlikely — Business of Apps' ~50% first-renewal survival points the other way — but it is
   measurable within 60 days of launch and it is the single most valuable measurement available.
2. **LSAC charging the $38 per *paying* student per year with proration or a volume floor.** The
   corpus confirms no published minimum but says nothing about proration. A prorated fee would cut
   the dominant cost line roughly in half.
3. **Actual token usage materially below my estimate.** My per-call estimate (~2,100 in / ~2,900 out)
   is derived from field caps and prompt length, not measured. The `AiJob` table and the provider
   `usage` object returned at `coaching.py:90` already capture the truth. **One SQL query replaces
   the whole of §2.3 with facts** — do that before trusting these numbers.
