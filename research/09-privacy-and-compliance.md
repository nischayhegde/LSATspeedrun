# 09 — Privacy, Data Protection, and Compliance Assessment

**Status:** working assessment, written for a pre-revenue commercial launch decision.
**Scope:** the code in this repository as of this writing (`backend/app/*.py`, `deploy/ec2/cloudformation.yaml`, `frontend/`), plus the data-collection plan proposed in `research/02-measurement-and-score-prediction.md`.

> ### I am not a lawyer.
> This is an engineering-grounded compliance assessment, not legal advice. Nothing here creates an attorney–client relationship. Every legal claim below is cited to a primary source (statute, regulator guidance, or provider terms) or to named practitioner commentary, so that you or your counsel can verify it independently. §13 separates the questions that genuinely need a lawyer from the ones that are settled enough to act on today without one.
>
> Two further honesty notes: (a) where the law is genuinely unsettled I say so explicitly rather than picking the convenient reading; (b) where a conclusion depends on a fact I could not verify from inside this repository — chiefly the commercial terms attached to the LLM gateway credential in `TFY_API_KEY`, and whether the deployment has EU/UK users today — I flag it as an assumption rather than burying it.

---

## 1. Executive summary

The application is closer to launch-ready on privacy than most pre-seed products in one respect (it collects strikingly little incidental data — no analytics SDKs, no ad trackers, no third-party tag manager, no payment processor yet) and materially further away in three respects that each carry real, quantifiable cost:

1. **The LLM egress path has no visible commercial or contractual basis.** `backend/app/coaching.py` posts student free-text reasoning to an OpenAI-compatible endpoint configured by `TFY_URL`. The only concrete URL in this repository for that gateway is `https://trilogy.truefoundry.cloud/api/llm/...` (`docs/superpowers/specs/2026-07-23-ai-art-redesign-design.md:24`), i.e. a **TrueFoundry AI Gateway tenant belonging to Trilogy**, an unrelated corporate entity — not a commercial account held by this business. If that is still the credential in use at launch, then the company is (i) processing paying customers' personal data through a third party it has no data processing agreement with, (ii) very likely outside the acceptable-use terms of whoever owns that tenant, and (iii) unable to answer the single most basic question a privacy policy must answer: *who else gets this data, and what do they do with it?* This is the top-ranked risk and it is also one of the cheapest to fix.
2. **There is no deletion path, no export path, and no retention limit anywhere in the system.** Verified exhaustively: there is no `DELETE` route and no account-deletion or data-export handler anywhere in `backend/app/routes.py` (or anywhere else in `backend/app/`). Every deletion-shaped call in the repo is either an internal cascade in `services.py`/`seed.py` or a developer script. The database schema is built for cascade deletion (`ondelete="CASCADE"` on essentially every user-scoped foreign key), so the hard part is already done — but nothing exposes it. Deletion and access rights are the most-enforced provisions in every US state privacy statute and are non-waivable under GDPR.
3. **The measurement plan in `research/02` wants to start collecting verified official LSAT scores, and that is the single most legally loaded field in the whole design.** It is not "special category" data under GDPR Article 9 (see §6 — this is a common overcorrection), but it very likely *is* "sensitive personal information" under some US state laws depending on how it is obtained, and it is unambiguously the kind of data that makes a thin privacy policy indefensible. The good news: there is a clean, cheap, lawful way to collect it (§11), and doing it right actually *improves* the data quality the psychometrics need.

**FERPA does not apply.** See §4 — resolved definitively, not hedged.

**On LLM training:** under OpenAI's current API terms, content submitted through the API is not used to train their models by default, with a default 30-day retention for abuse monitoring. But that protection runs to *the account holder*, and this app is not the account holder — it is a client of somebody else's gateway. See §7; this is why risk #1 outranks everything.

---

## 2. Data inventory, grounded in the real schema

Every row below is traced to a specific declaration in `backend/app/models.py` or a specific call site. Nothing here is hypothetical.

### 2.1 Directly identifying data

| Field | Location | Source | Notes |
|---|---|---|---|
| Email address | `User.email` (`models.py:24`) | Google OIDC `email` claim | Unique, indexed, `nullable=False`. Google-verified only (`routes.py:117` rejects unverified emails — good). |
| Google account ID | `User.google_sub` (`models.py:23`) | Google OIDC `sub` | Stable cross-service pseudonymous identifier. |
| Display name | `User.display_name` (`models.py:25`) | Google `name` claim | Real name in the overwhelming majority of cases. |
| Avatar URL | `User.avatar_url` (`models.py:26`) | Google `picture` claim | Points at `googleusercontent.com`; loading it in the client leaks page views to Google. |
| Session tokens | `AuthSession.token_hash` (`models.py:46`) | Server-generated | **Stored as SHA-256 only** — correct design, credit where due. |

The OAuth scope is minimal: `routes.py:69–88` reads only `sub`, `email`, `name`, `picture`. No Google API access tokens are stored, so there is no ongoing access to the user's Google account. That is a genuinely good posture and worth stating in the privacy policy.

### 2.2 Free-text user content — the highest-sensitivity payload

`Attempt.reasoning_text` (`models.py:169`) and `SessionItem.draft_reasoning_text` (`models.py:145`) store **students' unstructured written reasoning**, indefinitely, in plaintext.

This is the most sensitive data in the product and the reason deserves stating plainly: free text is unbounded. A field where a stressed test-taker explains their thinking will, across thousands of users, contain disclosures nobody designed for — health conditions ("I couldn't focus, my ADHD meds..."), disability and accommodation details, immigration status, family circumstances, mental-health states. `StudySession.accommodation_multiplier` (`models.py:108`) already implies the product knows about testing accommodations, which is adjacent to disability data. You cannot schema-constrain your way out of this; you can only govern it with retention limits, access controls, and honest disclosure.

`ReviewQueueItem.learner_rule` (`models.py:460`) is a second, smaller free-text field with the same property.

### 2.3 Behavioural and inferential data

Longitudinal, fine-grained, and — post-measurement-plan — explicitly an ability estimate:

- Per-item timing to the millisecond: `Attempt.server_elapsed_ms`, `client_elapsed_ms`, `SessionItem.active_elapsed_ms`, `timer_*` timestamps.
- Correctness, confidence self-ratings (`Attempt.confidence`, 1–5), answer-change behaviour (`answer_changed`).
- Per-skill aggregates over time: `SkillProgress` (`models.py:433`).
- LLM-assigned grades on the student's own reasoning: `Attempt.explanation_score`, `AttemptSettlement.explanation_grade`/`explanation_score`.
- Engagement and session patterns: `DailyProgress`, `PlayerProfile.last_active_at`, streaks.

Under GDPR this is squarely personal data, and the ability estimate the measurement plan proposes is a **profiling** output (GDPR Art. 4(4)). It does not amount to Art. 22 automated decision-making with legal effect — an LSAT score prediction shown to the student is advisory, not a decision *about* them by a third party — but it does raise the bar on transparency: users must be told the logic in general terms.

### 2.4 Third-party egress — what actually leaves the system

There is exactly one content egress path out of the application, and it is worth being precise about its payload because the payload is broader than "the current answer."

`backend/app/coaching.py:53–94` (`_chat`) posts to `TFY_URL` + `/chat/completions` with a bearer `TFY_API_KEY`. The request body assembled in `generate_attempt_coaching` (`coaching.py:240–248`) contains:

- The question, passage, choices and answer key (`_question_data`, `coaching.py:97–107`) — a **licensing** exposure covered in `research/03`, not a privacy one.
- `student_reasoning` — the current attempt's free text.
- **`recent_reasoning_samples` — the student's previous five free-text explanations**, pulled by a separate query (`coaching.py:230–239`).

That last item matters and is easy to miss. Each coaching call exfiltrates not one but up to **six** pieces of the student's writing, meaning a given piece of student text is transmitted to the third party repeatedly over the following days. Any "we send your answer for grading" disclosure that implies a single, current-item transmission would be inaccurate.

**What is *not* sent, to the app's credit:** no email, no name, no user ID, no session ID. The payload is content-only. This is meaningfully better than the norm and reduces (without eliminating) re-identification exposure — free text is itself identifying at the margin.

Transport path: in `AI_JOBS_MODE=sqs` the attempt ID travels via SQS to a Lambda worker (`jobs.py:49–61`, `process_ai_job`), which re-reads the attempt from the database and makes the same outbound call. So student text also transits **CloudWatch Logs** on any exception path, and `AiJob.payload_json`/`result_json` (`models.py:482–483`) persist LLM output — including the model's quotations of and commentary on the student's reasoning — as a second copy in the database with no expiry.

Other egress: Google (OAuth verification, `routes.py:104`, plus avatar hotlinking), AWS as infrastructure processor, CloudFront. **No analytics, advertising, session-replay, or A/B SDK anywhere in `frontend/`** — I checked for the usual suspects (GA/gtag, GTM, Segment, PostHog, Mixpanel, Sentry, Hotjar, Clarity, Stripe) and found only false positives in 3D-rendering and CSS code. This is a real asset: it means a cookie banner is very likely *not* required today (§8) and that position is worth defending deliberately rather than losing by accident to the first growth experiment.

### 2.5 Retention and deletion — current state

| Question | Answer |
|---|---|
| Is there a user-facing account deletion endpoint? | **No.** None in `routes.py` or anywhere in `backend/app/`. |
| Is there a data export / access endpoint? | **No.** `GET /v1/me` (`routes.py:253`) returns a profile summary only. |
| Is any retention period defined for any user data? | **No.** No TTL, no purge job, no archival policy. |
| Do expired/revoked sessions get purged? | **No.** `AuthSession` rows accumulate forever; `logout` only sets `revoked_at` (`routes.py:248`). |
| Would deletion work if exposed? | **Yes, mostly.** `ondelete="CASCADE"` is set consistently across user-scoped FKs, so `DELETE FROM users` propagates. `ReviewQueueItem.source_attempt_id`/`last_attempt_id` use `SET NULL`, which is fine. |
| What about copies outside Postgres? | Uncontrolled: `AiJob.result_json`, CloudWatch log retention (7 days for the worker, `cloudformation.yaml:573`; **unset — i.e. never expires — for other log groups**), SQS message retention (14 days / 4 days, `cloudformation.yaml:413,431`), and RDS automated backups (1 day, `cloudformation.yaml:392`). |

The gap between "the schema supports deletion" and "the user can delete" is roughly a day of work (§10) and it closes the largest category of regulatory exposure.

### 2.6 Infrastructure posture

From `deploy/ec2/cloudformation.yaml`: RDS `StorageEncrypted: true` (`:389`) and `PubliclyAccessible: false` (`:391`) — both correct and important. Against that: `BackupRetentionPeriod: 1` (`:392`) and `DeletionProtection: false` (`:393`) are availability/durability risks rather than privacy ones, but a single day of backups is thin for a system holding the only copy of customers' study history. `MultiAZ: false` (`:390`). Database credentials come from Secrets Manager with `sslmode=require` (`__init__.py:40–48`) — good.

Response headers set in `__init__.py:137–143` cover `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cache-Control: no-store`. Missing: HSTS and a Content-Security-Policy. See §8.

---

## 3. Which regimes actually apply

There is a persistent failure mode in startup compliance work where a founder reads a summary of the GDPR, panics, and spends $15,000 on a compliance programme designed for a company with 400 employees in Munich. There is an equal and opposite failure mode where a founder notes that the CCPA has a $26.6M revenue threshold, concludes that privacy law is a Series-B problem, and ships with no privacy policy at all. Both are wrong, and the second is wrong in a way that is cheap to fix and expensive to ignore.

The accurate picture is this: **the threshold-gated comprehensive privacy statutes almost certainly do not bind you today. A different, smaller, and much less discussed set of obligations binds you from your first user, and most of them are satisfied by writing one good document.**

### 3.1 The two facts that decide everything

Everything in this section turns on two questions that only you can answer:

1. **Do you have, or will you accept, users in the EU, the UK, or Switzerland?** This is a binary switch, not a spectrum. The GDPR has no revenue threshold and no volume threshold — it applies in full to a sole trader with one European user, if that user was targeted.
2. **How many US users will you have in each state in a given calendar year?** Every US state statute is volume- or revenue-gated. At pre-revenue scale you are under every gate. The gates are also much further away than founders expect: the *lowest* threshold in any US state law is 35,000 residents *of that single state* per year.

### 3.2 What binds you today, at zero revenue and near-zero users

This is the part that matters most, because it is the part that is usually missed. None of the following has a revenue or volume threshold. All of them apply to a two-person company on its launch day.

**(a) Section 5 of the FTC Act — unfair or deceptive acts or practices.** 15 U.S.C. § 45 ([statute](https://www.ftc.gov/legal-library/browse/statutes/federal-trade-commission-act)). This is the single most important compliance constraint on this business and it has no size threshold whatsoever. The FTC's theory of privacy enforcement is not that you must have any particular privacy practice; it is that **whatever you say you do, you must actually do**, and that certain practices are unfair regardless of what you disclose. The practical consequences for this codebase:

- If the privacy policy says "we delete your data on request" and §2.5 remains true (no deletion route exists), that is a deceptive practice — a straightforwardly enforceable one, with no need for the FTC to prove anyone was harmed.
- If the policy says "your data is never used to train AI models" and the LLM gateway's actual terms permit training, that is deceptive, and the fact that you did not know the gateway's terms is not a defence. See §7.
- Retroactive, materially adverse changes to a privacy policy applied to already-collected data are a standard FTC deception theory ([FTC privacy business guidance](https://www.ftc.gov/business-guidance/privacy-security/privacy-and-security)).

The FTC's enforcement posture in the AI-and-education space is not hypothetical. In the *Edmodo* matter (2023) the FTC obtained a $6M judgment (suspended) against an edtech provider, and — more relevantly for a small company — has repeatedly ordered **algorithmic disgorgement**: deletion not just of unlawfully collected data but of the models trained on it ([FTC, *Edmodo*](https://www.ftc.gov/legal-library/browse/cases-proceedings/2223050-edmodo-llc-us-v); [FTC on model deletion](https://www.ftc.gov/business-guidance/blog/2024/01/ai-companies-uphold-your-privacy-confidentiality-commitments)). For a company whose entire moat is a longitudinal dataset, "we will make you delete the dataset" is a bet-the-company remedy that scales down to very small firms.

**(b) CalOPPA — California's online privacy policy statute.** Cal. Bus. & Prof. Code § 22575 ([statute](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575)). This is the one founders miss. CalOPPA is *not* the CCPA, has no thresholds of any kind, and requires **any** operator of a commercial website or online service that collects personally identifiable information about California residents to conspicuously post a privacy policy containing specified elements: the categories of PII collected, the categories of third parties with whom it is shared, the process for a user to review and request changes to their information, how policy changes are notified, and the policy's effective date. It also requires you to disclose how you respond to Do Not Track signals. You have California users the moment you launch. **You are in scope for CalOPPA on day one, and you are currently not compliant, because there is no privacy policy in this repository at all.**

**(c) Delaware's equivalent.** 6 Del. C. § 1205C ([statute](https://delcode.delaware.gov/title6/c012c/sc02/index.html)) imposes a materially similar unconditional privacy-policy requirement, with a specific hook for operators of services directed at students. Nevada has a similar unconditional posting requirement with an opt-out-of-sale right (NRS 603A.340, [statute](https://www.leg.state.nv.us/nrs/nrs-603a.html)). A single well-drafted policy satisfies all three; the point is that the obligation exists at zero scale.

**(d) State data breach notification laws — all 50 states.** No thresholds anywhere. If the RDS instance is exfiltrated, you owe notice to residents of every affected state on statutory timelines, and several states require notice to the Attorney General above small victim counts ([NCSL summary](https://www.ncsl.org/technology-and-communication/security-breach-notification-laws)). Note the interaction with §2.6: with a 1-day RDS backup retention window and no MultiAZ, your ability to *reconstruct what was in the database at the time of a breach* — which is exactly what a breach notification requires you to state — is limited to the last 24 hours. That is a compliance problem, not merely a resilience problem.

**(e) Google's own terms, as a contract.** Using Google Sign-In binds you to the Google API Services User Data Policy, which requires (among other things) a published privacy policy, limited use of the data obtained, and secure handling ([Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)). This is contractual rather than statutory, but the enforcement mechanism — revocation of your OAuth client, i.e. every user loses the ability to log in — is faster and more painful than most regulatory processes.

### 3.3 GDPR and UK GDPR

**The threshold question is territorial scope, not size.** Article 3(2) extends the GDPR to controllers outside the Union where processing relates to (a) *offering goods or services* to data subjects in the Union, or (b) *monitoring their behaviour* within the Union ([Regulation (EU) 2016/679, Art. 3](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). The UK GDPR replicates this ([ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-fee/who-needs-to-pay/)).

The controlling interpretive document is **EDPB Guidelines 3/2018 on the territorial scope of the GDPR** ([EDPB](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-32018-territorial-scope-gdpr-article-3_en)). Its key holding for a company in your position: *mere accessibility of a website from the Union is not sufficient* to establish an offering of goods or services. The Guidelines list the factors that do establish it — use of an EU language or currency, EU-specific marketing spend, an EU top-level domain, mention of EU customers, delivery to EU addresses, EU phone numbers.

Applying that honestly to an LSAT preparation product:

- The LSAT is the admissions test for US, Canadian, and a handful of other common-law law schools ([LSAC](https://www.lsac.org/lsat)). Your natural market is North American. You will not price in euros, market in German, or run EU ad campaigns.
- Under the Guidelines' factor test, you are therefore **not "offering services to data subjects in the Union"** merely because a French national studying for the LSAT can reach your site.
- **But Article 3(2)(b) is the harder limb, and it is the one people forget.** This app does behavioural monitoring as its core function: it profiles reasoning patterns, tracks per-question timing, builds mastery estimates, and infers weaknesses. If a user is physically in the EU while that happens, the "monitoring of their behaviour as far as their behaviour takes place within the Union" language is uncomfortably on point. The EDPB reads "monitoring" to require tracking with subsequent profiling or behavioural analysis — which is a precise description of what `Attempt`, mastery estimation, and the coaching pipeline do.

**Honest assessment: this is genuinely unsettled at the margin.** The mainstream practitioner reading is that Art. 3(2)(b) monitoring still requires the monitoring to be *of persons who are in the Union* in a way the controller is aware of or targets, and that incidental profiling of a self-selected traveller does not by itself pull a purely US-facing service into the GDPR. But there is no CJEU ruling squarely on the point for a non-targeting service, and the EDPB has not disclaimed the broad reading. I am not going to pretend this is resolved.

**The practical recommendation, which costs almost nothing:**

1. Do not market to the EU/UK. Do not add EUR/GBP pricing. Keep the terms of service US-law-governed with a US forum.
2. State in the Terms that the service is offered to residents of the United States and Canada only, and that it is not directed to individuals in the EEA, UK, or Switzerland.
3. Do not geo-block. Blocking is a bad user experience and is not required by the analysis above; a jurisdictional statement in the ToS plus the absence of targeting is the standard posture and is what the EDPB factor test actually asks about.
4. Revisit this the moment you (i) take EU/UK payment, (ii) run any paid acquisition targeting Europe, or (iii) notice a material EU user population in your own logs. At that point you need an Article 27 representative (market rate roughly **$300–$1,500/year** from providers such as [DataRep](https://www.datarep.com/) or [Prighter](https://prighter.com/)), a lawful-basis analysis, a records-of-processing register under Art. 30, and probably a DPIA given the profiling.

Two GDPR-specific traps worth pre-empting, because they cost money later and nothing now:

- **Automated decision-making (Art. 22)** would apply if the product ever made a decision producing legal or similarly significant effects with no human in the loop. Score *prediction* shown to the student who requested it is not that. Selling a predicted score to a law school would be.
- **The Art. 30 record of processing** has a small-organisation carve-out (fewer than 250 employees) that is narrower than it looks — it evaporates if processing is not occasional, which yours is not. Do not rely on it. See §9.

### 3.4 CCPA / CPRA

**Does not apply to you today, and will not for a long time.** The CCPA reaches a for-profit entity doing business in California that meets *at least one* of three thresholds (Cal. Civ. Code § 1798.140(d), [statute](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140)):

| Threshold | Current value | Your position |
|---|---|---|
| Annual gross revenue in the preceding calendar year | **> $26,625,000** (CPI-adjusted from $25M effective Jan 1 2025; [CPPA adjustment notice](https://cppa.ca.gov/regulations/cpi_adjustment.html)) | Pre-revenue. Not met. |
| Buys, sells, or shares PI of **100,000+** California consumers or households annually | 100,000 | Not met, and not close. |
| Derives **50%+** of annual revenue from selling or sharing PI | 50% | Not met — you sell subscriptions, not data. Keep it that way. |

Note the statute still *prints* $25,000,000; the operative figure is the CPI-adjusted $26,625,000, and it re-adjusts in each odd-numbered year, so expect a further bump on January 1, 2027.

Three cautions:

- The revenue threshold is **global gross revenue**, not California revenue. If this business is a subsidiary of, or under common control and common branding with, a larger entity that clears $26.625M, you are swept in by § 1798.140(d)(2) regardless of your own size. Check the corporate structure before relying on the exemption.
- The 100,000-consumer threshold counts **consumers or households whose PI you buy, sell, or share** — and "share" is a defined term aimed at cross-context behavioural advertising, not ordinary vendor use. Because you run no ad pixels (§2.4), you are much further from this threshold than a typical consumer app with the same user count would be. This is a real, if accidental, structural advantage; adding a Meta pixel would forfeit it.
- Being out of scope does **not** authorise misrepresentation. If your policy claims CCPA rights you do not honour, that is FTC Act § 5 deception even though the CCPA itself does not reach you.

### 3.5 The other state comprehensive laws

Twenty states now have comprehensive consumer privacy statutes on the books, effectively all now in force, with Indiana, Kentucky, and Rhode Island having taken effect January 1, 2026 ([IAPP US State Privacy Legislation Tracker](https://iapp.org/resources/article/us-state-privacy-legislation-tracker/); [Baker Donelson, *Privacy Laws Ring in the New Year*, 2026](https://www.bakerdonelson.com/privacy-laws-ring-in-the-new-year-state-requirements-expand-across-the-us-in-2026)). For a pre-revenue direct-to-consumer product the structure is far simpler than the count suggests, because the thresholds cluster:

| Threshold band | States | When it bites |
|---|---|---|
| 100,000 residents of that state/year (or 25,000 + revenue from data sales) | VA, CO, UT (plus $25M revenue, conjunctive), IA, IN, KY, MN, NJ, OR, TN (175,000) | Realistically a post-Series-A problem. 100,000 *Californians* or 100,000 *Virginians* in one year is a very large consumer business. |
| 35,000 residents/year (or 10,000 + data-sale revenue) | CT (lowered from 100,000 to 35,000 effective mid-2026), DE, MD, NH, NJ-adjacent variants, RI | The first gates you will hit. Still implies a substantial business. |
| 50,000 residents/year | MT | — |
| **No numeric threshold — small-business exemption instead** | **TX, NE** | The genuinely different case. See below. |

**Two things about these thresholds are widely misread, and both change how much runway you actually have.**

1. **The counts are per-state residents, not total users.** "35,000 Connecticut consumers" does not mean 35,000 users. Connecticut is roughly 1.1% of the US population, so a nationally distributed user base would need to be in the low millions before it plausibly clears Connecticut's floor; California's 100,000 implies something like 850,000 US users at California's ~11.6% population share. Your runway here is measured in years, not quarters.
2. **But the counts include free users.** The statutes count consumers whose personal data you *control or process*, not consumers who pay you. A free tier that goes viral moves you toward the thresholds without producing a dollar of revenue. Set a monitoring trigger on per-state user counts rather than assuming revenue is a proxy.

**Texas and Nebraska are the ones to actually read.** The TDPSA applies to any person who conducts business in Texas or produces a product consumed by Texas residents, processes or sells personal data, **and is not a small business as defined by the US Small Business Administration** (Tex. Bus. & Com. Code § 541.002, [enrolled HB 4](https://www.capitol.state.tx.us/tlodocs/88R/billtext/pdf/HB00004F.pdf); [Texas AG summary](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act)). Nebraska's Data Privacy Act copies this structure ([Neb. Rev. Stat. § 87-1102](https://nebraskalegislature.gov/laws/statutes.php?statute=87-1102)).

You are comfortably an SBA small business today (the relevant NAICS size standards for software publishing and educational services are in the hundreds of employees or tens of millions in receipts; [SBA size standards](https://www.sba.gov/document/support-table-size-standards)). But note two things:

- **The SBA exemption has one hole, and it is directly relevant to §6.** Tex. Bus. & Com. Code § 541.107 provides that a small business "may not engage in the sale of personal data that is sensitive data without receiving prior consent from the consumer." This obligation applies *even to exempt small businesses*. So: if verified LSAT scores ever counted as sensitive data under Texas law **and** you ever sold them, you would need opt-in consent notwithstanding your exemption. As §6 concludes, test scores are not within the Texas sensitive-data definition — but the structural point stands, and it means your small-business exemption is not unconditional.
- SBA size standards incorporate **affiliation rules**. Majority investor control can aggregate a portfolio company's headcount with affiliates. Worth a five-minute check with counsel at your priced round, not before.

### 3.6 Washington's My Health My Data Act — the one no-threshold state law that could reach you

The MHMDA ([RCW 19.373](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373); [Washington AG guidance](https://www.atg.wa.gov/my-health-my-data-act)) applies to any "regulated entity" that conducts business in Washington or targets Washington consumers and determines the purpose and means of collecting "consumer health data." **There is no revenue or volume threshold, and — uniquely among US state privacy laws — it carries a private right of action** through the Washington Consumer Protection Act. Nevada's SB 370 is a close analogue without the private right of action.

"Consumer health data" is defined expansively: personal information linkable to a consumer that identifies past, present, or future physical or **mental** health status, including "bodily functions," "symptoms," and any information "derived or extrapolated" from non-health data.

On the current design this does **not** apply. You do not ask about health, and a per-question timing log is not a symptom. But two foreseeable product decisions would change that answer, and both are the kind of thing an ML-minded founder proposes at a whiteboard without thinking about statutes:

- **Inferring test anxiety, stress, or burnout from behavioural telemetry** and surfacing it as a feature. Data "derived or extrapolated" into a mental-health inference is squarely within the definition. Do not ship a "you appear to be experiencing test anxiety" feature without counsel.
- **Free-text reasoning fields that in practice collect health disclosures.** Students write things like "I have ADHD and lost focus here" or "I was on medication during this session" into open text boxes. You did not ask, but you are storing it, and §2.2 already flags the free-text corpus as the highest-sensitivity payload in the system. Under the MHMDA's "collect" definition this is arguably regulated collection. The mitigation is cheap: a line of microcopy under the reasoning box — *"Please don't include health, medical, or other sensitive personal details in your explanation"* — plus a documented policy against mining that field for health inferences. That microcopy is a UI string, not a legal programme, and it materially improves your position.

I flag MHMDA not because it applies now but because it is the only US privacy statute where a plaintiff's lawyer, not a resource-constrained AG, decides whether you get sued.

### 3.7 Canada — foreseeable, arguably targeted, and easy to miss

Worth its own subsection because the LSAT is also the admission test for Canadian law schools ([LSAC](https://www.lsac.org/lsat)). Canadian users are therefore not the "incidental traveller" case that lets you out of the GDPR analysis in §3.3 — they are a foreseeable and arguably targeted part of your market, and the §9.2 recommendation to scope the ToS to "the United States and Canada" makes that explicit.

**PIPEDA** applies to the collection, use, or disclosure of personal information in the course of commercial activity, with **no revenue or volume threshold** ([Office of the Privacy Commissioner, PIPEDA guide for businesses](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/)). Its core requirements — meaningful consent, limited collection and purpose, accuracy, safeguards, openness, individual access, and challenge of compliance — overlap almost entirely with the US baseline this document already recommends. Quebec's Law 25 goes further, adding privacy-by-default settings, data portability, and mandatory breach reporting to the Commission d'accès à l'information.

**Practical position:** if you market to Canadian applicants, treat PIPEDA as in scope and say so. The incremental work over the §12 checklist is small — principally naming a privacy contact, honouring access requests (the same endpoint as §2.5's export), and a Canadian breach-reporting line in the incident runbook. The reason to flag it is not that it is expensive but that it is the one non-US regime you probably *are* in, while the one everybody worries about (GDPR) is the one you probably are not.

### 3.8 What is not in play

For completeness, so nobody spends money here: **HIPAA** does not apply (you are not a covered entity or business associate; you are not providing healthcare). **GLBA** does not apply (you are not a financial institution; a Stripe integration does not make you one — Stripe is). **The FCRA** does not apply unless you start furnishing predicted scores to third parties making eligibility decisions, which would be a catastrophic business decision for unrelated reasons. **State student-privacy laws** like California's SOPIPA do not apply, and the statute is unusually explicit about it: § 22584(a)(7) reaches only operators with actual knowledge that a service is used *primarily* for, **and** was designed and marketed for, K–12 school purposes, and § 22584(j) states outright that the section "does not apply to general audience internet websites, general audience online services, general audience online applications, or general audience mobile applications" ([statute](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22584)). The roughly forty state student-privacy statutes modelled on SOPIPA gate on the same K–12 hook and fail for the same reason. **FERPA** — see §4, resolved.

### 3.9 Summary

| Regime | Applies today? | Trigger to re-evaluate |
|---|---|---|
| FTC Act § 5 | **Yes, from user #1** | Never stops applying |
| CalOPPA / DE / NV policy-posting laws | **Yes, from user #1** | Never stops applying |
| State breach notification (50 states) | **Yes, from user #1** | Never stops applying |
| Google API Services User Data Policy | **Yes, contractually** | Never stops applying |
| Washington MHMDA | No — unless you infer mental-health states | Any wellbeing/anxiety feature; health data in free text |
| GDPR / UK GDPR | Almost certainly not, if you do not target the EU/UK | EU marketing, EUR pricing, material EU user base |
| CCPA / CPRA | No | $26.625M global revenue, or 100k CA consumers, or corporate affiliation with a covered entity |
| TX / NE (no-threshold, SBA-exempt) | Exempt as a small business | Exceeding SBA size standards; any sale of sensitive data |
| All other state comprehensive laws | No | 35,000 residents of a single small state, or 100,000 of a large one, in one calendar year |
| Canada: PIPEDA / Quebec Law 25 | **Probably yes, if you market to Canadian applicants** | No threshold — turns on whether you target Canada (§3.7) |
| HIPAA, GLBA, FCRA, SOPIPA, FERPA | No | See §3.8 and §4 |

**The one-sentence version: no comprehensive privacy statute binds this company today, but the FTC Act and CalOPPA do, and both are satisfied primarily by writing an accurate privacy policy and then actually behaving the way it says — which currently requires building the deletion path in §2.5 that does not exist.**

---

## 4. FERPA — does it apply?

**No. FERPA does not apply to this product as designed, and it is not a close question.** I am stating this without hedging because the analysis is genuinely determinate, and because hedging here has a real cost: FERPA anxiety is one of the most common reasons edtech founders buy compliance products they do not need, or sign school contracts whose data terms quietly destroy the thing that made the business valuable.

### 4.1 What FERPA actually regulates

FERPA (20 U.S.C. § 1232g, [statute](https://www.law.cornell.edu/uscode/text/20/1232g); implementing regulations at [34 C.F.R. Part 99](https://www.ecfr.gov/current/title-34/subtitle-A/part-99)) is a **funding condition imposed on schools**, not a general data protection statute and not a statute that regulates companies.

Three structural features determine the outcome here:

1. **It binds only "educational agencies or institutions."** 34 C.F.R. § 99.1 provides that Part 99 applies to an educational agency or institution "to which funds have been made available under any program administered by the Secretary" of Education ([§ 99.1](https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-A/section-99.1)). A private company that has never received Department of Education funds is not an educational agency or institution and has no direct FERPA obligations of any kind. This company is not one, will not become one, and could not become one without applying for Title IV eligibility.

2. **It protects only "education records," which are defined by who maintains them.** 34 C.F.R. § 99.3 defines an education record as a record that is "(1) Directly related to a student; and (2) Maintained by an educational agency or institution or by a party acting for the agency or institution" ([§ 99.3](https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-A/section-99.3)). Both prongs are required. Data you collect from a person directly, under your own terms of service, with no school in the picture, is not maintained by or for an educational agency. It is therefore not an education record, no matter how educational it is. A student's practice-test history is not an education record for the same reason their Duolingo streak is not.

3. **The only route by which a vendor picks up FERPA-derived obligations is the "school official" exception**, 34 C.F.R. § 99.31(a)(1)(i)(B). That exception is what lets a school hand PII from education records to a contractor without parental/student consent, provided the contractor performs an institutional function, is under the school's direct control as to use and maintenance of the records, and does not re-disclose or repurpose the data. The Department's own vendor guidance sets out these conditions ([SPPO, *Responsibilities of Third-Party Service Providers under FERPA*](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf)). **The exception is triggered by a disclosure from a school. No disclosure from a school, no exception, and nothing for the exception to attach to.**

The Department has said this directly in the context of online services. Its February 2014 guidance, *Protecting Student Privacy While Using Online Educational Services*, frames the entire question as whether "PII from students' education records" is disclosed to the provider, and gives as its counter-example services where no student PII from records is disclosed at all ([ED/PTAC, Feb. 2014](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Student%20Privacy%20and%20Online%20Educational%20Services%20(February%202014)_0.pdf)). Where a student signs up on their own initiative, outside any school contract, there is no such disclosure and FERPA is not implicated.

### 4.2 Applying it to this product

| FERPA element | This product |
|---|---|
| Is the company an educational agency or institution receiving ED funds? | No. |
| Is the company "a party acting for" such an institution? | No. There is no school contract, no institutional customer, no roster import. Users authenticate with a personal Google account (`backend/app/routes.py`, `/auth/google`) and create their own account under your ToS. |
| Is any data received *from* a school? | No. Every field in `models.py` is either self-supplied, Google-supplied, or generated by the user's own activity in the app. |
| Is the LSAT itself an education record? | No. The LSAT is administered by LSAC, a non-profit membership organisation, not by a school receiving ED funds. LSAC is not subject to FERPA in its own right. |

Every prong fails. FERPA does not apply.

A useful sanity check on the stakes: FERPA has **no private right of action**. In *Gonzaga University v. Doe*, 536 U.S. 273 (2002), the Supreme Court held that FERPA's nondisclosure provisions create no personal rights enforceable under § 1983 ([opinion](https://supreme.justia.com/cases/federal/us/536/273/)). The sole statutory remedy is administrative, running against the *institution*, up to withdrawal of federal funding — a remedy that has never once been imposed in the statute's fifty-year history. So even in the world where FERPA somehow reached you, the direct regulatory exposure would be approximately zero; the real exposure would be contractual, to the school.

### 4.3 The three futures in which this answer changes

FERPA is not a risk today. It is a **strategic constraint on one specific growth path**, and that is the reason to have read this section.

**(a) Selling to universities, pre-law advising offices, or law schools.** The moment an institution licenses the product for its students and gives you a roster — names, student IDs, emails from the SIS, GPAs, LSAT scores from CAS — those are education records disclosed under the school official exception, and the exception's terms attach. Its most important term for you is the fourth one: the vendor "uses education records only for authorized purposes and may not re-disclose PII from education records to other parties" (SPPO vendor FAQ, above).

Read that against `research/02`'s core thesis. **The school official exception is fundamentally incompatible with using institutional student data to build a proprietary longitudinal score-prediction model**, because the model is your purpose, not the school's authorised purpose. Institutional data would have to be firewalled from the research corpus unless each school's contract expressly authorises secondary research use — and most institutional data-protection addenda specifically forbid it. That is a business-model decision disguised as a compliance question, and it should be made deliberately rather than discovered during a procurement review. If you pursue the campus channel, budget for a genuinely separate data plane, not a `tenant_id` column.

**(b) A data partnership with LSAC.** If LSAC ever supplied score data in bulk, FERPA would still not attach (LSAC is not an educational agency), but LSAC's own contractual and privacy terms would, and they are the operative constraint. See §11 — this path is not the one to plan around.

**(c) K–12 or under-18 school programmes.** Not a plausible direction for an LSAT product, but if the company ever pivoted to SAT/ACT prep sold through high schools, FERPA plus SOPIPA (Cal. Bus. & Prof. Code § 22584) plus roughly forty state student-privacy statutes all engage at once, and the compliance cost goes up by an order of magnitude. Note that when the FTC amended the COPPA Rule in 2025 it *declined* to adopt edtech-specific amendments precisely because of the pending interaction with FERPA ([Davis Wright Tremaine analysis](https://www.dwt.com/blogs/privacy--security-law-blog/2025/05/coppa-rule-ftc-amended-childrens-privacy)), so this area is in motion and any K–12 pivot needs fresh advice at the time.

### 4.4 What to do with this

- **Do not** buy a FERPA compliance product, a FERPA audit, or a student-data-privacy certification. Do not join the Student Privacy Pledge. None of it is required and none of it reduces any risk you actually have.
- **Do not** claim "FERPA compliant" in marketing. It is meaningless for a company that FERPA does not reach, and a claim of compliance with a statute you are not subject to is exactly the kind of statement the FTC treats as deceptive. This mistake is endemic in edtech marketing copy; do not copy it.
- **Do** record the conclusion, with the reasoning above, in whatever passes for your compliance file. You will be asked this by every enterprise prospect, every investor's diligence checklist, and possibly by a partner's security questionnaire. Having the answer written down once, with citations, saves the same argument being re-litigated from scratch each time.
- **Do** re-open the question the day you sign your first institutional customer, and treat §4.3(a) as the decision memo.

---

## 5. Minors — COPPA and the age-appropriate design rules

### 5.1 Who your users actually are

LSAC's own Candidate Agreement sets a **Minimum Age Requirement of 18 on the date of registration** for the LSAT, with a discretionary exception process for candidates who can show they will either be 18 on test day or apply to law school within two years ([LSAC Candidate Agreement 2026–2027](https://www.lsac.org/about/lsac-policies/lsac-candidate-agreement/2026-2027)). That is a genuinely useful anchor: the test itself is an adults' test, and the population of people who would plausibly pay for LSAT preparation software skews to 21–28.

But "usually adults" is not "always adults," and the exceptions are foreseeable rather than exotic: a 17-year-old college junior on an accelerated track, a dual-enrolment student, a precocious high-schooler exploring a 3+3 programme, or a curious sixteen-year-old who has heard that logic games are fun. **The under-13 population is realistically zero.** The 16–17 population is small but non-zero.

That distinction maps almost exactly onto the two bodies of law: COPPA cares only about under-13, and the state design codes care about under-18.

### 5.2 COPPA

COPPA (15 U.S.C. §§ 6501–6506) and the COPPA Rule ([16 C.F.R. Part 312](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312)) apply to an operator of a website or online service that is either **(a) directed to children under 13**, or **(b) a general-audience service with actual knowledge that it is collecting personal information from a child under 13**.

**Neither limb is met.**

On (a), whether a service is "directed to children" is a multi-factor test under § 312.2 — subject matter, visual and audio content, use of animated characters or child-oriented activities, music, age of models, presence of child celebrities, language, advertising directed to children, and competent, reliable empirical evidence about audience composition. A product whose entire subject matter is a graduate-school admissions test scores zero on every factor. This is about as clearly general-audience as a consumer service gets.

On (b), "actual knowledge" means what it says. The FTC considered and **declined** to adopt a constructive-knowledge standard in its 2025 rulemaking; the standard remains actual knowledge ([FTC, Final Rule Amendments, 90 Fed. Reg. 16918 (Apr. 22, 2025)](https://www.govinfo.gov/content/pkg/FR-2025-04-22/pdf/2025-05904.pdf)). Your current auth path gives you no age signal at all: `_verified_google_claims` in `backend/app/routes.py` reads `sub`, `email`, `name`, and `picture` from the Google ID token, and Google does not put a birthdate in an OIDC ID token. You collect no date of birth anywhere in `models.py`. **You therefore have no mechanism by which actual knowledge could arise today**, other than a user volunteering their age in a support email or a free-text field.

Two current-rule details worth knowing even though they do not bind you:

- The amended Rule's **compliance date was April 22, 2026** and the FTC is now enforcing it ([Davis Polk](https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect); [Taft](https://www.privacyanddatasecurityinsight.com/2026/04/enforcement-begins-soon-for-significant-coppa-rule-amendments/)). Among the new obligations is a **written, published data retention policy** for children's data under § 312.10 and enhanced security-programme requirements. If you ever acquire COPPA obligations, they are meaningfully heavier than the pre-2026 version.
- The "**mixed audience**" category, now a standalone defined term, covers services that do not target children as their *primary* audience but that choose to age-screen. Crucially, a mixed-audience operator "may not collect personal information from any visitor until it collects age information ... or uses another means reasonably calculated ... to determine whether the visitor is under 13," and any age screen must be **neutral** — no default age, no nudging users to falsify (90 Fed. Reg. 16918). This matters for the recommendation below: **a badly built age gate can move you from "general audience with no obligations" into "mixed audience with obligations."** An age gate is not a free action.

### 5.3 The state age-appropriate design codes — under-18, and genuinely in flux

These are the live area, and I am going to describe the state of play rather than pretend it is stable, because it is not.

| Law | Status as of August 2026 | Definition of child |
|---|---|---|
| **California AADCA** (Cal. Civ. Code § 1798.99.28 et seq.) | Partially enjoined. On March 12, 2026 the Ninth Circuit in *NetChoice v. Bonta* vacated the whole-statute injunction and vacated the injunction against the **age-estimation** provision, while affirming injunctions against the **DPIA requirement**, the **data-use restrictions**, and the **dark-patterns** prohibition on vagueness grounds. The mandate issued April 3, 2026, so the non-enjoined remainder is enforceable; the case is back before the district court on severability and age estimation. ([Cooley](https://www.cooley.com/news/insight/2026/2026-03-30-netchoice-v-bonta-ninth-circuit-narrows-injunction-against-californias-ageappropriate-design-code-act); [Wiley](https://www.wiley.law/alert-Injunction-on-California-AADC-Partially-Vacated-Key-Provisions-May-Take-Effect-on-April-2)) | Under 18 |
| **Maryland AADC** (SB 571) | Effective Oct. 1, 2024. Challenged by NetChoice; **no injunction entered.** | Under 18 |
| **Nebraska Age-Appropriate Online Design Code Act** (LB 504, amended by LB 838) | Effective Jan. 1, 2026; the amendment **removed** the prior "50% of revenue from data sales" applicability gate, materially expanding scope. Certain express-parental-consent and age-verification provisions preliminarily enjoined in June 2026. | Under 18 |
| **South Carolina** | In effect; challenged, no injunction. | Under 18 |
| **Vermont AADC** (S. 69) | Takes effect **Jan. 1, 2027**; applies to businesses reasonably likely to be accessed by minors, apparently on a ~2% audience threshold. | Under 18 |

(Status summary drawn from [Loeb & Loeb, *Children's Online Privacy in 2026*](https://www.loeb.com/en/insights/publications/2026/06/childrens-online-privacy-2026-state-app-store-design-code-and-social-media-laws), which is the most current consolidated practitioner tracking I could find; note that practitioner summaries of the CAADCA's post-mandate status genuinely conflict with one another, which is itself a signal about how settled this is.)

**The applicability trigger in all of them is some variant of "reasonably likely to be accessed by children/minors."** That phrase has no authoritative construction, and it is a low bar in the abstract — almost any general-purpose website is *accessible* to a seventeen-year-old. The honest position is: an adult-oriented admissions-test product has a strong argument that it is not "reasonably likely to be accessed" by minors in the sense these statutes mean, and no regulator has ever suggested otherwise for a product of this kind, but the argument has not been tested, and Vermont's apparent 2%-of-audience formulation would be uncomfortable if your analytics ever showed a real teen cohort. This is one of the places where I will not manufacture certainty.

### 5.4 App store accountability acts — the one that will actually reach your mobile app

`backend/app/__init__.py` reads `GOOGLE_MOBILE_CLIENT_IDS` and `routes.py` exposes `/auth/mobile/google`, so a native iOS/Android app is in the plan. That triggers a body of law that has nothing to do with COPPA and is already in force.

The **Texas App Store Accountability Act** (SB 2420, [enrolled text](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.HTM)) took effect January 1, 2026; the Fifth Circuit allowed it to operate pending appeal, and on July 6, 2026 the Supreme Court declined to block enforcement. It requires app stores to verify age category (**under 13, 13–15, 16–17, 18+**) and obtain parental consent for minors, and it imposes obligations **directly on developers**: assign and maintain accurate age ratings, consume the store-provided age-category and consent signals, notify the store on "significant changes" (which expressly includes material changes to data processing and monetisation) so consent can be refreshed, and limit retention of the age/consent data received ([Wiley, *Key Developments With State App Store Accountability Acts*](https://www.wiley.law/alert-Key-Developments-With-State-App-Store-Accountability-Acts-as-Texas-Act-Takes-Effect)). Utah's analogue has a May 6, 2027 operative date after amendment; Alabama's takes effect January 1, 2027; Louisiana has amended its own.

Apple has already shipped the plumbing: the **Declared Age Range API** returns the Texas-defined age category plus an age-assurance-method signal, and the **Significant Change API** under PermissionKit requests renewed parental consent ([Apple Developer, *Next steps for apps distributed in Texas*](https://developer.apple.com/news/?id=2ezb6jhj)). Google Play has equivalent signals.

This is good news, not bad. **The app stores are now doing age assurance for you, for free, to a standard you could never afford to build.** An 18+ policy on mobile becomes: request the declared age range, and if it is not `18+`, decline to create an account. That is a dozen lines of client code and it is materially stronger evidence of a good-faith age posture than any self-attestation checkbox.

### 5.5 Recommendation: the cheapest defensible posture

**Set the floor at 18, do not collect date of birth, and rely on attestation on the web plus store-provided age signals on mobile.**

Concretely:

1. **Terms of Service:** "The Service is offered only to individuals who are at least 18 years of age. By creating an account you represent that you are 18 or older." One sentence. This mirrors LSAC's own Minimum Age Requirement, so it is defensible on its face rather than looking like a legal dodge — you can say truthfully that the test you prepare people for is an adults' test.
2. **Signup:** a single unticked checkbox — "I am at least 18 years old and I agree to the Terms of Service and Privacy Policy." Do **not** add a date-of-birth field, and do **not** add a date-picker age gate. A DOB field converts you from a general-audience service with no COPPA obligations into an operator with actual knowledge of every user's age, imports the neutral-age-screen requirements of the mixed-audience rule, and creates a new sensitive-ish field to store, secure, and delete. It buys you nothing.
3. **Mobile:** consume `Declared Age Range` on iOS and the Play equivalent on Android; refuse account creation below 18. Set the store age rating to 17+/18+ and keep it accurate — an inaccurate age rating is itself a Texas ASAA violation.
4. **Actual-knowledge procedure:** write down, in one paragraph, what happens if you learn a user is under 18 — suspend the account, delete the data, refund any subscription, log the event. Put the email address for such reports in the privacy policy. Having a documented procedure that you actually follow is the entire defence; not having one is what turns a single teenage user into an enforcement narrative.
5. **Do not** build parental consent flows, do not buy age-estimation vendors, and do not pursue a COPPA safe-harbour certification. All three are large costs incurred to solve a problem you have designed away.

**Cost: effectively zero** — one ToS sentence, one checkbox, one short internal procedure, and a small amount of mobile client work you will have to do for the app stores anyway.

**The trade-off, stated honestly:** an 18+ floor turns away the small number of legitimate 16–17-year-old LSAT candidates that LSAC's own exception process contemplates. If the product later shows real demand from that cohort, the right move is not to quietly stop enforcing the ToS term — an unenforced age term you know is being violated is worse than no term, because it converts a compliance gap into a misrepresentation. The right move at that point is a deliberate build: lower the floor to 16, add verifiable parental consent for 16–17-year-olds, and accept the Maryland/Nebraska/Vermont design-code obligations that follow. Budget several weeks of engineering and a counsel review before doing that; do not do it at launch.

---

## 6. Are verified LSAT scores "sensitive" or "special category" data?

A parallel workstream wants to collect verified official scores and needs a yes-or-no answer, so here it is.

> **No. A verified LSAT score is not special category data under the GDPR, and it is not "sensitive data" or "sensitive personal information" under any US state privacy statute currently in force. Collect it. But do not collect accommodations status alongside it, and do get explicit, versioned, revocable consent anyway — for reasons that are commercial and FTC-related rather than sensitive-data-related.**

The rest of this section is the reasoning, plus the one genuinely dangerous adjacent field.

### 6.1 GDPR Article 9 — a closed list, and scores are not on it

Article 9(1) prohibits processing of personal data "revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, or trade union membership, and the processing of genetic data, biometric data for the purpose of uniquely identifying a natural person, data concerning health or data concerning a natural person's sex life or sexual orientation" ([Regulation (EU) 2016/679, Art. 9](https://eur-lex.europa.eu/eli/reg/2016/679/oj); [ICO summary](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/)).

**That list is exhaustive.** It is not illustrative, and there is no residual "anything else that feels private" category. Academic performance, examination results, and standardised test scores are not on it, and no regulator or court has ever suggested they are. This is worth stating flatly because "test scores must be special category data, they're about a person's abilities" is a common intuition among engineers and it is simply wrong.

**The one respectable counter-argument, and why it fails.** In *OT v Vyriausioji tarnybinės etikos komisija* (C-184/20), the CJEU held that Article 9 catches data from which special-category information can be inferred "by means of an intellectual operation involving comparison or deduction" — there, a spouse's name revealing sexual orientation ([judgment](https://curia.europa.eu/juris/liste.jsf?num=C-184/20)). Someone could argue that because LSAT score distributions differ across demographic groups in the aggregate, a score "reveals" racial or ethnic origin.

It does not, and the argument confuses population statistics with individual inference. *OT* concerned data from which a specific individual's special-category attribute could be **deduced** — the deduction was near-certain for that person. A score of 164 supports no deduction whatsoever about any individual's ethnicity; every group is represented across the entire scale. If this argument worked, income, postcode, and job title would all be Article 9 data, and they are not. Treat this one as closed.

Article 9 is also, in practice, moot for you: §3.3 concludes the GDPR most likely does not reach a non-EU-targeting product at all. It matters here only because "is it Article 9?" is the question people ask first, and a clean answer prevents an expensive detour.

### 6.2 US state law — enumerated lists, and scores are on none of them

Every US state comprehensive privacy law defines sensitive data by enumeration. The categories, pooled across all twenty statutes, are:

racial or ethnic origin · religious beliefs · mental or physical health condition, diagnosis, disability, or treatment · sex life, sexual orientation, or status as nonbinary or transgender · citizenship or immigration status · national origin · genetic or biometric data · precise geolocation · personal data of a known child · status as a victim of a crime · neural data · financial account credentials · government-issued identification numbers · consumer health data.

Representative citations: Cal. Civ. Code § 1798.140(ae) ([CPRA "sensitive personal information"](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140)); Tex. Bus. & Com. Code § 541.001(23) ([Texas AG summary](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act)); Conn. Gen. Stat. § 42-515 as amended by SB 1295 / P.A. 25-113 effective July 1, 2026 ([Foley & Lardner](https://www.foley.com/insights/publications/2026/07/connecticut-dramatically-expands-its-data-privacy-act-what-businesses-need-to-know-now/)).

**Educational records, academic performance, and test scores appear in none of them.** Connecticut's July 2026 amendment is the most expansive sensitive-data definition in the country — it reached out to add neural data, disability and treatment, transgender and nonbinary status, government identifiers, and financial account credentials — and it still does not touch academic data. When a legislature actively expands a list and declines to add your category, that is strong evidence the category is out.

Note also, from §3.5, that Texas's small-business carve-out has an exception only for *the sale of sensitive data* (§ 541.107). Since scores are not sensitive data, that exception does not reach them either. (You should not be selling them regardless — see §6.5.)

### 6.3 The field that *is* sensitive — and you are already collecting it

**Testing accommodations status is health and disability data, it is sensitive under both regimes, and it is the one genuinely sensitive structured field already in your schema.**

`backend/app/models.py:108` declares `StudySession.accommodation_multiplier`, a float defaulting to 1.0. `backend/app/services.py:519` constrains it to `{1.0, 1.5, 2.0}`, `backend/app/routes.py:500` lets the user set it when starting a diagnostic, and `services.py:287` returns it in the session payload. It arrived in migration `0016_learning_modes`.

Those three permitted values are not arbitrary — **1.5× and 2× are exactly LSAC's standard extended-time accommodation tiers** ([LSAC accommodations](https://www.lsac.org/lsat/register-lsat/accommodations)). A user who selects one is, in the overwhelming majority of cases, telling you they have a disability-based testing accommodation. That makes the field data from which disability is readily inferred.

Under the GDPR that is "data concerning health": Recital 35 defines it to include "any information on, for example, a disease, **disability**, disease risk, medical history, clinical treatment" ([Recital 35](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32016R0679)), and the ICO confirms disability information is in scope so far as it reveals health status ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/)). Under US state law, Connecticut's amended definition names "disability or treatment" outright, and every other state's "mental or physical health condition or diagnosis" formulation reaches it.

**The honest counter-argument, and why I would not rely on it.** This is a self-selected timing preference on a practice diagnostic, not a recorded diagnosis. Some users will pick 1.5× because they want a relaxed practice run. So the inference is probabilistic rather than certain, and a reasonable lawyer could argue the field is a product setting rather than health data. But the ICO's position is explicitly that *inferred* health status counts, the permitted values map one-to-one onto a clinical accommodation scheme, and the cost of treating it as sensitive is very low. Treat it as sensitive.

**What to do — none of it expensive:**

1. **Do not remove it.** It is a legitimate product feature and removing it would be worse for the users who need it.
2. **Do not propagate it.** It must not be copied onto `OfficialScore` (§11.2), must not be included in any research export or partner feed, and must not be sent to the LLM gateway. It currently is not sent — `_question_data` does not include it — and that should stay true deliberately rather than by accident.
3. **Disclose it** in the privacy policy as accommodation-related timing data, with an explicit statement that you do not use it to infer disability and do not share it.
4. **Confirm it deletes.** It lives on `StudySession`, so it should cascade with account deletion — verify that in the same test as R2.
5. **Do not add a second accommodations field to the score record.** A psychometrician will want it, because timed-section models behave differently for extended-time takers and omitting the variable is a genuine modelling compromise. Say no at launch anyway: the cost is sensitive-data opt-in obligations in every state that later applies, an Article 9 condition if the GDPR ever reaches you, and a DPIA trigger in several states — to improve a score model you have not yet validated.
6. **If it later becomes necessary**, build it deliberately: separately opted in, independently revocable, stored apart from the score record, used only for model calibration, never surfaced or exported. A project, not a column.

One thing that will be proposed and is not a fix: **renaming the field to "timing preference" does not change its classification.** Regulators look at what data reveals, not what a column is called. Renaming the *user-facing label* is still worth doing, because presenting the control as a practice setting rather than an accommodation declaration is better product and slightly weakens the inference — but do not mistake it for the mitigation. The mitigation is items 2 through 5.

### 6.4 Two related traps

**Free-text reasoning fields.** §2.2 already identifies these as the highest-sensitivity payload. The sensitive-data angle is that a student explaining why they got a question wrong will sometimes write "my ADHD meds wore off," "I was in a bad place mentally," or "I'm ESL." You did not ask, you have no lawful-basis analysis for it, and it is sitting in `Attempt.reasoning_text` and being posted to a third-party LLM gateway. See §3.6 for the microcopy mitigation and §7 for the egress problem; the point here is that the *only* sensitive data you are likely to hold is data you never intended to collect.

**Score cancellation and withdrawal.** A record showing that a candidate cancelled a score, or that they took the test five times, is reputationally loaded in a way a single score is not. It is still not "sensitive data" as a legal term of art, but it belongs in the same handling tier as the score itself.

### 6.5 What "not sensitive" does and does not buy you

**What it buys:** no opt-in consent requirement as a matter of statute, no data-protection impact assessment triggered by the category alone, no Article 9 condition to identify, and — usefully — **no breach-notification trigger**. State breach notification statutes key off defined data elements: name combined with SSN, driver's licence number, financial account plus access code, medical information, health insurance information, or account credentials ([NCSL summary](https://www.ncsl.org/technology-and-communication/security-breach-notification-laws)). An email address and a scaled score is not a notifiable combination in the overwhelming majority of states. Because you store only SHA-256 hashes of session tokens (`backend/app/auth.py`) and no passwords, a database compromise of score data alone would in most states not trigger statutory notice. That is a meaningful reduction in the tail cost of a breach and it is worth not squandering.

**What it does not buy:**

1. **Freedom from FTC Act § 5.** The FTC's unfairness authority does not depend on statutory categories; it depends on substantial injury not reasonably avoidable and not outweighed by benefits. Publishing, leaking, or selling identified LSAT scores would be a clean unfairness case regardless of what any state statute enumerates.
2. **Freedom from your own promises.** Whatever your privacy policy and consent screen say about score data becomes enforceable against you the moment you say it. This is where nearly all realistic legal risk on this data actually lives.
3. **Purpose limitation — the most likely real-world violation.** A score collected "to improve your score prediction" cannot be silently repurposed into a marketing testimonial, a public leaderboard, or an aggregate "our users average +12 points" claim. That last one is exactly what a founder will want to publish the week the data looks good, and it is a different purpose from the one the user consented to. It is also a substantiation problem in its own right: the FTC requires competent and reliable evidence for objective efficacy claims, and a self-selected sample of users who chose to report their scores is not that. Decide now that aggregate marketing claims require their own disclosure and their own methodology, and put the constraint in §11's consent text rather than discovering it later.
4. **User tolerance.** People are *intensely* private about test scores in a way that has nothing to do with statutory categories. A product that mishandles them dies of reputation long before it dies of enforcement.
4. **Permission to sell.** Selling identified or re-identifiable score data would trigger sale/share opt-out machinery in every state law the moment one applies, would blow up the CCPA "50% of revenue from sale" threshold analysis in §3.4, and would be commercially suicidal. Do not do it, and say in the privacy policy that you do not.

### 6.6 The decision for the score-collection workstream

**Green light, with four conditions.** Collect verified official scores. Do it as follows, and §11 gives the actual consent text and deletion path:

1. **Express, separate, opt-in consent** — not bundled into ToS acceptance, not pre-ticked, presented at the moment of score entry.
2. **Versioned consent**, which is exactly what `consent_version` in the `OfficialScore` spec is for. Record the version string of the consent language the user actually saw, not the current one.
3. **Honest verification tiers.** The spec's `verification` enum (`self_report` | `screenshot` | `verified`) must reflect reality. Recording a self-reported score as verified is a data-integrity problem first and a misrepresentation problem second.
4. **No accommodations field.** Per §6.3.

None of these four is legally compelled by the sensitive-data analysis. All four are cheap, and together they convert the highest-value dataset in the business from a liability that a future acquirer's diligence will discount into an asset with a provable, per-row lawful basis. That is the actual argument for doing it properly, and it is a commercial argument rather than a legal one.

---

## 7. The LLM provider — what the terms actually in force say

### 7.1 What the code does, precisely

`backend/app/coaching.py` builds an OpenAI-shaped chat-completions request and `POST`s it with `requests.post` to `TFY_URL` + `/chat/completions`, authenticated with a bearer `TFY_API_KEY` (`_chat`, lines 53–94). The model string is hard-coded in `backend/app/__init__.py:109` as `COACHING_MODEL="gpt-5.6-luna"`. In production the call is dispatched asynchronously through SQS and executed by a Lambda worker (`backend/app/jobs.py`), which changes the timing but not the destination.

The payload per call (`generate_attempt_coaching`, lines 189–249) contains:

- `question`: the passage canonical text, stimulus, stem, every answer choice, and the verified correct label — i.e. **your licensed item content**;
- `student_reasoning`: the student's free-text explanation for this attempt;
- `recent_reasoning_samples`: **a list of that student's previous free-text explanations**.

Two observations before the legal analysis. First, credit where due: the payload carries **no direct identifiers** — no email, no name, no user ID, no Google `sub`. That is a genuinely good design choice and it materially reduces the exposure. Second, it is nonetheless personal data. Several free-text writing samples from the same individual, correlated in one request, are readily linkable and would be treated as personal data by any regulator; the absence of a name does not make it anonymous.

### 7.2 The structural problem: you are two contracts away from the model

There are two distinct entities in this path and they have different terms:

```
  your app ──► TrueFoundry AI Gateway ──► the actual model provider
              (logs, retention, access)     (training, retention)
```

**Which model provider?** The repository cannot tell you. `gpt-5.6-luna` is a `gpt-`prefixed string, which suggests OpenAI, but a gateway maps arbitrary model aliases to arbitrary backends — that is the entire point of a gateway. A tenant administrator can point `gpt-5.6-luna` at OpenAI direct, at Azure OpenAI, at a reseller, or at something else entirely, and your application would not observe any difference. **You cannot currently answer, from your own systems, the question "which company receives my users' writing?"** That is not a hypothetical deficiency; it is the specific question a privacy policy is required to answer and that any enterprise customer's security questionnaire will ask.

### 7.3 Layer 1 — TrueFoundry, and the header you are not sending

TrueFoundry's AI Gateway logs request and response bodies, and the default posture logs them.

Per [TrueFoundry's request logging documentation](https://www.truefoundry.com/docs/ai-gateway/request-logging), logging can be controlled per request with an `X-TFY-LOGGING-CONFIG` header, or tenant-wide by a logging configuration. Under the `HEADER_CONTROLLED` mode, "if the header is absent or set to `true`, logging will occur." The `_chat` function sends exactly two headers — `Authorization` and `Content-Type`. **It does not send `X-TFY-LOGGING-CONFIG`.** So unless the tenant has a rule that turns logging off, every student explanation this app has ever generated is stored as a request body in the gateway's trace store, viewable in the gateway UI under `AI Gateway > Monitor > Requests`.

Three consequences follow, and they compound with the §1 finding that the tenant appears to belong to an unrelated corporate entity:

1. **The logs are in somebody else's console.** Trace storage destination, trace retention period, and the "data access rules" governing who may view traces are all tenant-level settings ([data routing docs](https://www.truefoundry.com/docs/ai-gateway/data-routing)). If you do not own the tenant, you do not control any of them, you cannot audit who has looked, and you cannot honour a user's deletion request against that copy — which makes any deletion promise in your privacy policy false as to this data.
2. **Metrics are kept forever.** TrueFoundry's documentation states plainly that metrics "are kept forever and always routed to the default destination. Retention cannot be configured for metrics." Metrics are not request bodies, so this is a lesser exposure, but "forever" is not a retention period you can recite in a privacy policy without qualification.
3. **Redaction exists but is not enabled.** The [logging configuration](https://www.truefoundry.com/docs/ai-gateway/logging-config) feature can redact patterns from the stored copy while leaving the live request untouched. Nobody has configured it here.

On contracts: TrueFoundry publishes a [privacy policy](https://www.truefoundry.com/privacy-policy) directing data-subject requests to `security@truefoundry.com`, and offers enterprise plans with customer-managed storage. But **a privacy policy is not a data processing agreement**, and a DPA signed by Trilogy would run to Trilogy, not to you. Whether TrueFoundry will sign a DPA with you directly is a commercial question I cannot resolve from here — it is a normal enterprise ask and enterprise AI gateways generally do offer one, but I am flagging it as unverified rather than asserting it.

### 7.4 Layer 2 — OpenAI's terms, assuming that is where the traffic lands

Taking the `gpt-` prefix at face value, these are the current terms:

**Training: no, not by default.** OpenAI states: "By default, we do not use data from ChatGPT Enterprise, ChatGPT Business, ChatGPT Edu, ChatGPT for Healthcare, ChatGPT for Teachers, or our API platform—including inputs or outputs—for training or improving our models," with training available only by explicit opt-in in the API dashboard ([OpenAI, *Business data privacy, security, and compliance*](https://openai.com/business-data/)). The per-endpoint table in the [data controls documentation](https://developers.openai.com/api/docs/guides/your-data) confirms "Data used for training: **No**" for `/v1/chat/completions`, which is the endpoint this app calls.

**Retention: 30 days for abuse monitoring.** "By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days, unless longer retention is required by law, or is reasonably necessary to protect our services or any third party from harm" (same source). For `/v1/chat/completions` specifically: abuse monitoring retention 30 days, application-state retention none (unless `store: true` is set — this app does not set it).

**Zero retention: available, but gated.** Zero Data Retention and Modified Abuse Monitoring are both listed as available for `/v1/chat/completions`, but are "subject to prior approval by OpenAI and acceptance of additional requirements." ZDR is not a self-serve toggle; it is requested through sales or the privacy portal.

**DPA: yes, published and incorporated by reference.** The [OpenAI Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) is incorporated into the [Services Agreement](https://openai.com/policies/services-agreement/) at § 5.3, and contains the provisions you would want: no sale or sharing of personal data under US privacy laws, no combining customer data with other parties' data, return or deletion on termination (§ 2.11), and deletion of customer content within thirty days of termination (§ 11.3).

**A retention promise is subject to legal process.** During the 2025 *New York Times v. OpenAI* discovery dispute, a court preservation order required OpenAI to retain API and ChatGPT output data that would otherwise have been deleted on the normal schedule ([OpenAI's statement](https://openai.com/index/response-to-nyt-data-demands/)). Nothing about that was a breach of the terms — the terms already say retention may be extended where "longer retention is required by law." The lesson is that "deleted after 30 days" is a commitment about the vendor's ordinary practice, not a guarantee against litigation holds, and your privacy policy should not promise more certainty than the underlying vendor terms provide. Phrase it as "up to 30 days, longer if legally required," which is both accurate and unremarkable.

**One caveat worth internalising.** Practitioner analysis notes that for API and Team tiers the no-training commitment is a *published policy* rather than a separately negotiated contractual obligation with bespoke remedies, whereas for Enterprise it is contractual in the MSA ([AI Policy Desk, 2026](https://www.aipolicydesk.com/blog/openai-enterprise-privacy-trust-portal-compliance-guide-2026)). Since the DPA is incorporated into the Services Agreement, the gap is narrower than that framing suggests, but if a future enterprise customer demands a contractual no-training warranty, that is an Enterprise-tier conversation.

### 7.5 So — does the provider train on your users' content?

**Under the terms actually in force: almost certainly not — but the protection does not run to you, and you cannot currently prove it does.**

The no-training commitment is a promise from OpenAI to *its account holder*. If the API key in `TFY_API_KEY` belongs to a TrueFoundry tenant owned by a third party, then the chain of promises is: OpenAI → tenant owner → (nothing) → you. There is no contract on the last hop. You are relying on the good behaviour of an intermediary you have no agreement with, whose acceptable-use terms you are probably outside of, and whose observability console holds a complete copy of your users' writing.

**The practical risk is not that a model gets trained on a student's essay about assumption questions. It is that you will write a privacy policy — and you must, per §3.2 — and every sentence in it about AI processing will be a statement you cannot substantiate.** That is the FTC exposure, and it is the reason this ranks first in §10.

### 7.6 What to do

**Option A — get your own OpenAI account. Recommended.** Replace the gateway credential with a direct OpenAI API key on an account owned by this company. Accept the Services Agreement, which incorporates the DPA. Request Zero Data Retention (or at minimum Modified Abuse Monitoring) through the privacy portal. Then every claim in your privacy policy is backed by a contract you hold and can produce.
*Cost:* the API spend you are already implicitly incurring, plus perhaps half a day of work — `_endpoint()` already normalises the URL and the payload is already OpenAI-shaped, so this is a configuration change, not a rewrite. *This is the single highest-leverage compliance action available to this company.*

**Option B — get your own TrueFoundry tenant.** Keep the gateway for routing and cost control, but on a tenant you own, with a DPA signed with TrueFoundry, a logging config that disables body logging or redacts free text, and a documented trace retention period. Sensible if the gateway's multi-provider routing has real value to you. Costs more, and adds a second processor to disclose and diligence.

**Option C — stop sending free text.** Send only derived features: question ID, chosen answer, timing, error taxonomy codes. Best privacy posture by a distance, and it destroys the coaching product, which is the feature students are paying for. Not recommended, but worth naming so that the decision to send free text is made consciously rather than by default.

**Do these regardless of which option you pick:**

1. **Send `X-TFY-LOGGING-CONFIG` with `enabled: false`** (or the equivalent on whatever gateway you end up on) so that body logging is off by default rather than on by default. One header, one line of code, immediate reduction in copies of user data.
2. **Trim the payload.** `recent_reasoning_samples` sends multiple prior writing samples from the same student on every single call. If three samples materially improve coaching quality, keep three; if the number was chosen arbitrarily, reduce it. Every sample is another copy leaving your infrastructure.
3. **Reconsider shipping full item content.** `_question_data` sends the entire passage, stimulus, stem, and all choices on every call. That is not a privacy issue — it is a licensing one, and it belongs to whatever `research/03-content-licensing.md` concludes about redistribution rights in your item bank. Flagging it here because the same egress path carries both problems and one fix addresses both.
4. **Add the reasoning-box microcopy** from §3.6 discouraging health and other sensitive disclosures. Cheapest risk reduction in this document.
5. **Name the subprocessor in the privacy policy**, with a subprocessor list you commit to updating. You cannot do this until you know who it is, which is the point.

---

## 8. Auth and security posture

Scoped to launch-readiness, not to a penetration test. The question here is "is there anything in the authentication and session layer that would make a breach notification, an FTC unfairness theory, or an enterprise security questionnaire go badly?" — not "is this codebase perfect?"

**Overall: this is better than most pre-seed code I have read.** The auth design shows evidence of deliberate thought rather than copy-paste. The findings below are refinements, with one genuine gap.

### 8.1 What is already correct — do not spend money re-examining these

Worth recording explicitly, because these are the things a security questionnaire asks about and you can answer them affirmatively today.

- **Session tokens are high-entropy and stored hashed.** `secrets.token_urlsafe(48)` yields ~288 bits, and only `sha256(token)` is persisted (`backend/app/auth.py`, `_hash` and `issue_auth_cookies`). A database compromise therefore yields no usable session tokens. Mobile bearer tokens use the identical hashed, revocable `AuthSession` table — the docstring on `issue_mobile_token` shows this was a conscious decision rather than an accident.
- **No passwords exist anywhere.** Google is the sole identity provider. This removes credential stuffing, password reuse, reset-token flows, and password-hash breach exposure in one stroke — the largest single category of authentication risk simply is not present. It also, per §6.5, keeps you outside the "username and password" trigger in most state breach notification statutes.
- **Cookie flags are right.** `HttpOnly` on the session cookie, `Secure` in production via `COOKIE_SECURE=is_production`, `SameSite=Lax`, explicit `path="/"`.
- **CSRF is implemented correctly, including the subtle parts.** Double-submit with a non-`HttpOnly` CSRF cookie compared against an `X-CSRF-Token` header using `secrets.compare_digest` (constant-time). It covers `POST`/`PUT`/`PATCH`/`DELETE`, exempts only the four pre-session login routes, and — the part people get wrong — **skips the check for bearer-authenticated requests**, which is correct, since browsers do not automatically attach `Authorization` headers and forcing a cookie-derived CSRF token into device storage would be worse than useless.
- **Google ID token verification is done properly.** `_verified_google_claims` verifies signature and issuer via `id_token.verify_oauth2_token`, then checks `aud` explicitly against an allowlist set rather than trusting the library's single-audience parameter — which is what lets the mobile endpoint accept configured iOS/Android client IDs without weakening the web endpoint. It also **checks `email_verified`** (`routes.py:117`), rejects overlong `sub`/`email` values, and raises `google_identity_conflict` when an existing email maps to a different Google `sub`. That last check closes an account-takeover-by-email-reuse path that a lot of production code leaves open.
- **Development auth cannot run in production.** `create_app` raises `RuntimeError` at startup if `DEV_AUTH_ENABLED` is requested while `FLASK_ENV=production`, and `DEV_AUTH_ENABLED` is additionally `and not is_production`. Belt and braces, correctly.
- **CORS is a single explicit origin with credentials**, not a wildcard, with a closed `allow_headers` list.
- **Error logging does not leak payloads.** `coaching.py` logs `type(exc).__name__` only. Given what is in those payloads (§7.1), this matters.

### 8.2 Findings, ordered by what I would fix first

**F1 — There is no rate limiting anywhere in the application. This is the one real gap.**
No `Flask-Limiter`, no throttling decorator, no per-user quota exists anywhere in `backend/`. The consequences are unequal:

- *The AI coaching endpoint costs you money per call.* An authenticated user — or one account shared among a study group, or a script — can enqueue coaching jobs in a loop. `jobs.py` dedupes on `coaching:{attempt.id}`, which prevents duplicate work for one attempt but does nothing to stop a user generating attempts. There is no spend ceiling between a user and your LLM bill.
- *The login endpoints call out to Google on every request* (`google_requests.Request()` fetches Google's certs per invocation, uncached), making `/v1/auth/google` an unauthenticated amplification point.
- *Enumeration and scraping.* Your item bank is the asset; an authenticated scraper with no rate limit can walk it.

This is not primarily a privacy finding, but it becomes one: "reasonable security measures appropriate to the nature of the data" is the operative standard in every state privacy statute and in the FTC's unfairness cases, and absent rate limiting is a standard finding. *Fix: `Flask-Limiter` with a storage backend, strict limits on the auth and coaching routes, looser global defaults. Half a day.*

**F2 — Use `__Host-` cookie prefixes.**
The double-submit CSRF pattern has one well-known weakness: an attacker who can set a cookie on a sibling subdomain of your domain can overwrite the CSRF cookie and defeat the comparison. The standard mitigation is the `__Host-` prefix, which instructs the browser to reject the cookie unless it is `Secure`, has `Path=/`, and has **no** `Domain` attribute — making it un-settable from a subdomain ([MDN, cookie prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes); [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)). Your production cookies already satisfy all three conditions, so this is a rename of the `AUTH_COOKIE` and `CSRF_COOKIE` config values plus the matching frontend read — with the caveat that the prefix cannot be used in local development over plain HTTP, so it needs to be conditional on `COOKIE_SECURE`. *Under an hour.*

**F3 — `SECRET_KEY` does not fail closed.**
`SECRET_KEY=os.getenv("SECRET_KEY", "local-only-change-me")`. Because sessions use the custom `AuthSession` table rather than Flask's signed session cookie, the blast radius today is small. But the default is a published constant in a public repository, and the pattern is exactly the one that becomes critical the moment somebody adds a `flash()` call or an `itsdangerous` token. `DEV_AUTH_ENABLED` already demonstrates the right pattern — raise at startup in production. *Ten minutes.*

**F4 — HSTS and CSP (extending §2.6).**
§2.6 established that responses carry `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Cache-Control: no-store`, but no HSTS and no CSP. The useful addition here is *where* each belongs and how much each costs:

- **HSTS belongs at the edge, not in Flask.** Setting `Strict-Transport-Security` from the application is the wrong layer, because a request that reached Flask over plain HTTP has already leaked. Set it via a CloudFront response headers policy ([AWS docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)) covering both the app and the API origin. Start with `max-age=300` for a day to confirm nothing breaks, then raise to a year. **Do not add `preload` until you are certain** — preload list removal takes months. *An hour of config.*
- **CSP is the expensive one, so do it in stages.** A meaningful CSP for a React SPA that loads Google Identity Services requires enumerating script origins (`accounts.google.com`), and is where most teams stall. Deploy `Content-Security-Policy-Report-Only` first, collect violations for a week, then enforce ([MDN CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)). A worthwhile intermediate step that costs nothing and is not report-only: add `frame-ancestors 'none'` — the modern, correctly-specified replacement for the `X-Frame-Options` header you already send. *One day for report-only, a second day to enforce.*

**F5 — Users cannot see or revoke their own sessions.**
`AuthSession` has `revoked_at` and the table is well designed for it, but nothing exposes it. With 14-day web sessions and **90-day** mobile tokens (`MOBILE_AUTH_DAYS`), a user who loses a phone has no self-service remedy. This is a small feature, and it is naturally the same piece of work as the account-deletion endpoint that §2.5 says does not exist — both are "operate on all rows for this user." Build them together. *Counted under §9's deletion work rather than here.*

### 8.3 Deliberately not recommended before launch

Stating these explicitly so nobody spends the money: no penetration test, no SOC 2, no bug bounty, no WAF tuning, no secrets-manager migration, no MFA (you have delegated authentication to Google, which already does MFA better than you would). SOC 2 in particular is a **$20,000–$50,000 first-year commitment** that buys nothing until an enterprise buyer demands it. If a prospect asks, the correct answer is "not yet, here is our security summary" — which is why §8.1 is written the way it is.

### 8.4 Cost

Everything in §8.2 except CSP enforcement is roughly **two engineer-days**. CSP enforcement adds two more. No external spend. The only item I would treat as genuinely blocking for a paid launch is **F1**, and that is as much about your AWS bill as about compliance.

---

## 9. The documents you need before launch

Sorted by whether the law actually compels them for a US-first, direct-to-consumer, subscription launch. Cost estimates are US market rates for a pre-seed company in 2026 and assume you do the drafting groundwork yourself, which you are unusually well placed to do because §2 of this document is already the data inventory that every one of these documents is built from.

### 9.1 Privacy policy — **legally required**

Not "advisable." Required, from your first California user, by CalOPPA (§3.2(b)), and independently by Delaware and Nevada. Required again, contractually, by the Google API Services User Data Policy, and again by both app stores as a condition of listing.

Minimum contents, drawn from the statutes and from what §2 shows you actually do:

- Categories of personal information collected, tied to real fields: Google account identifiers, email, display name, avatar URL; practice attempts, timings, and answers; free-text reasoning; derived mastery and error-pattern inferences; official scores if and when collected.
- Categories of third parties who receive it — **naming the LLM subprocessor** (§7), AWS as infrastructure, Google as identity provider, and your payment processor once one exists.
- How a user reviews, corrects, deletes, and exports their data, with a working contact address. Do not write this section until the endpoint exists (§2.5); writing it first is the deception risk in §3.2(a).
- Retention periods, honestly stated. "Until you delete your account, plus 30 days in backups" is a fine answer. "As long as necessary" alone is not.
- Your response to Do Not Track signals — an explicit CalOPPA requirement that boilerplate generators routinely omit.
- Effective date and how changes are notified.
- A statement that you do not sell or share personal information (assuming that remains true — see §6.5).

**Cost and route.** Skip the $99 generators: they produce policies describing analytics and advertising you do not run, and a policy that misdescribes you is worse than none. Draft it yourself from §2 in a day, then buy **2–4 hours of privacy counsel review at $400–$700/hour: $1,000–$2,500**. A full agency-drafted startup privacy package runs $5,000–$15,000 and is not warranted at this stage. *Time: one day of drafting, one to two weeks of counsel turnaround.*

### 9.2 Terms of Service — **not required by statute, required in practice**

No statute compels a ToS. Ship without one and you have no limitation of liability, no warranty disclaimer, no governing law or venue, no arbitration or class-action waiver, no licence terms for your item bank, and no basis for terminating an abusive account. Both app stores require an EULA or impose Apple's default.

The provisions that matter most for *this* product specifically:

- **A hard disclaimer on score outcomes.** You are building a score-prediction feature. Someone will pay you, score 152, and claim you promised 165. Disclaim predicted outcomes explicitly and prominently.
- **The 18+ term** from §5.5.
- **The US/Canada-only jurisdictional statement** from §3.3.
- **Your rights in user-generated content** — you need a licence to process free-text reasoning for coaching and, if you want it, for model improvement and research. Note that this is where §11's research consent interacts: a broad ToS licence is *not* a substitute for the specific opt-in consent that verified score collection needs.

**Cost:** counsel-drafted, **$1,500–$4,000**. Bundled with the privacy policy review, a competent startup lawyer will do both for **$2,500–$5,000** total. *Time: one to two weeks.*

### 9.3 Subscription and auto-renewal disclosures — **legally required, and the most actively enforced item in this section**

This is the one founders underestimate, so it gets its own heading rather than a bullet inside the ToS.

The FTC's "Click-to-Cancel" Negative Option Rule was **vacated in its entirety** by the Eighth Circuit on July 8, 2025 for procedural failure under § 22 of the FTC Act ([WilmerHale](https://www.wilmerhale.com/en/insights/client-alerts/20250801-eighth-circuit-vacates-the-ftcs-click-to-cancel-rule-but-federal-and-state-regulators-likely-to-remain-active); [Cooley](https://www.cooley.com/news/insight/2025/2025-07-11-click-to-cancel-just-got-cancelled-eighth-circuit-vacates-entirety-of-ftcs-negative-option-rule)). The FTC submitted a draft ANPRM to OIRA on January 30, 2026 to restart the rulemaking ([Gibson Dunn](https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/)).

**Do not read that as relief.** Two things survive it entirely:

- **ROSCA**, 15 U.S.C. § 8403, still applies to every online negative-option transaction: clear and conspicuous disclosure of all material terms *before* billing information is collected, express informed consent, and a simple cancellation mechanism. The FTC is actively enforcing it and can seek civil penalties of up to **$53,088 per violation** ([Wiley](https://www.wiley.law/alert-With-Click-to-Cancel-Rule-Now-Vacated-by-8th-Circuit-Whats-Next-for-FTC)).
- **State automatic renewal laws**, several of which are stricter than the vacated federal rule. California's amended ARL took effect July 1, 2025 and regulates even the "save" offers you show someone who clicks cancel; Massachusetts's regulation took effect September 2, 2025; Minnesota regulates retention discounts; several include a private right of action. Enforcement is real and multistate — a $7.5M California settlement with a meal-delivery service, a $4.8M settlement by 34 states with an online retailer ([Perkins Coie](https://perkinscoie.com/insights/update/eighth-circuit-vacates-ftc-negative-option-rule-whats-next); Gibson Dunn, above).

**Practical rule: build cancellation to be at least as easy as signup, in the same medium, with no dark patterns and no mandatory retention call.** Since signup is one Google button, cancellation must be one button in the account settings. Get the pre-checkout disclosure block and the post-purchase confirmation email right the first time; both are prescribed in detail by the state ARLs. **Cost: $0 in legal spend if the product is built correctly, one to two engineer-days.** Getting it wrong is the most likely route to a five-or-six-figure regulatory cost in this entire document, which is why it appears in §10.

### 9.4 Cookie consent banner — **not required. Do not buy one.**

`issue_auth_cookies` sets exactly two first-party cookies: a session cookie and a CSRF token. There are no analytics cookies, no advertising cookies, no third-party tags, no tag manager (§2.4).

- **In the US**, no state law requires a cookie banner at all. Consent obligations attach to *selling or sharing* personal information for cross-context behavioural advertising, which you do not do.
- **Under EU/UK law** — which §3.3 concludes probably does not reach you anyway — the ePrivacy Directive's consent requirement expressly exempts cookies "strictly necessary" for a service the user requested. Authentication and CSRF cookies are the textbook examples.

**Save the $500–$1,200/year that a consent management platform costs.** Disclose the two cookies in the privacy policy and move on. Revisit *only* if you add analytics or advertising — and note that adding a product analytics SDK costs you the cookie-banner exemption, the CCPA-threshold advantage in §3.4, and part of the clean story in §7, so price that decision accordingly.

### 9.5 Data processing agreements — **required to obtain, not required to offer**

You are a **controller** selling to consumers, not a processor. Nobody will ask you to sign a DPA until you sell B2B (§4.3). What you need is DPAs *from* your vendors:

| Vendor | Status |
|---|---|
| **LLM provider** | **The gap.** See §7. OpenAI publishes a [DPA](https://openai.com/policies/data-processing-addendum/) incorporated into its Services Agreement at § 5.3 — but only for its own account holders. Whether TrueFoundry will sign one with you directly is unverified. |
| **AWS** | Already covered. The AWS GDPR Data Processing Addendum is incorporated into the AWS Service Terms automatically ([AWS DPA](https://aws.amazon.com/compliance/gdpr-center/)) — no signature needed. |
| **Google** (identity) | Governed by the Google API Services User Data Policy and Google Terms; no separate DPA needed for OAuth-only use. |
| **Stripe or equivalent** | Incorporated in their standard terms when you sign up. |
| **Transactional email provider** | Whichever you pick; check at selection time, not after. |

**Cost: $0.** This is filing and reading, not drafting. Keep the executed or incorporated-by-reference terms in one folder. *Time: half a day, once the LLM decision in §7.6 is made.*

### 9.6 Records of processing (GDPR Article 30) — **not required for a US-first launch; do it anyway because it is free**

Article 30 records are a GDPR obligation. If §3.3's conclusion holds, you do not owe one. But note the small-organisation exemption in Art. 30(5) is narrower than it looks — it falls away where processing is not occasional, and yours is continuous.

The practical point: **§2 of this document already is a record of processing** in everything but name. Keep it current as the schema changes and you have satisfied the substance for free, plus you will have the artefact that every investor's diligence checklist, every enterprise security questionnaire, and any future GDPR obligation asks for. **Cost: $0, plus the discipline of updating it when you add a table.**

### 9.7 Two more that are cheap and routinely skipped

- **A public subprocessor list** — a page naming AWS, your LLM provider, Google, and your payment processor, with a commitment to update it. Advisable, not required. Half an hour. It is also the single most common question on enterprise security questionnaires.
- **A one-page incident response runbook** — who is called, who decides notification, what the state-by-state clock is, where the logs are. Not statutorily required at your scale, but "reasonable security" under every state statute and the FTC's unfairness standard is partly procedural, and the marginal cost of writing it now, calmly, versus at 2am during an incident, is enormous. **One hour.**

### 9.8 Summary and total

| Document | Required? | Route | Cost | Time |
|---|---|---|---|---|
| Privacy policy | **Yes** (CalOPPA, DE, NV, Google, app stores) | Self-draft from §2 + counsel review | $1,000–$2,500 | 1 day + 1–2 weeks |
| Terms of Service | Practically yes | Counsel-drafted | $1,500–$4,000 | 1–2 weeks |
| Auto-renewal / ROSCA compliance | **Yes**, if you charge | Product work + ToS clauses | $0 legal, 1–2 eng-days | 2 days |
| Cookie banner | **No** | Do not buy | $0 | — |
| DPAs from vendors | Yes, to obtain | Collect and file | $0 | Half a day |
| DPA to offer customers | Not until B2B | Defer | $0 | — |
| Records of processing | No (US-first) | Maintain §2 | $0 | Ongoing |
| Subprocessor list | Advisable | Self-written | $0 | 30 min |
| Incident response runbook | Advisable | Self-written | $0 | 1 hour |

**Realistic total legal spend to launch: $2,500–$5,000**, bundled with one startup-focused privacy attorney, plus roughly **three to four engineer-days** for the deletion/export endpoint (§2.5), the cancellation flow, and the §8 fixes. **Elapsed time: two to three weeks**, gated on counsel turnaround rather than on your own work.

That number is low because the product is genuinely simple and collects genuinely little. It rises sharply — call it $15,000–$25,000 and two months — the moment you add EU users, institutional customers, or an advertising stack.

---

## 10. Risk register

**How to read the numbers.** "Expected cost" is probability × magnitude over roughly the next 24 months, expressed as an order of magnitude. These are engineering-style estimates and reflect my judgement about a pre-revenue consumer product, not actuarial data. I have deliberately *not* used headline statutory maxima as magnitudes — GDPR's 4%-of-turnover ceiling applied to zero turnover is zero, and quoting it would inflate the register in exactly the way that makes founders ignore risk registers. What drives the numbers below is mostly remediation cost, lost engineering time, deal friction at fundraising, and the realistic settlement value of the enforcement that actually happens to small companies.

### 10.1 Must be resolved before the first paying customer

The threshold I am using: taking money converts you from a hobbyist to a commercial operator, triggers ROSCA and the state ARLs, makes FTC deception theories concrete because there is now a transaction, and makes "we're pre-launch" unavailable as a mitigation.

| # | Risk | Expected cost | Fix cost | Why it is in this tier |
|---|---|---|---|---|
| **R1** | **LLM egress with no contract you hold** (§7). User free-text goes to a gateway tenant that appears to belong to an unrelated company, is logged there by default, and routes to a model provider you cannot identify. | **$25k–$150k** | ~½ day + normal API spend | Every AI sentence in your privacy policy is currently unsubstantiable, which is the classic FTC deception setup; the credential can be revoked without notice, taking the flagship feature down; and it is a guaranteed finding in fundraising or acquisition diligence, where it is priced as a discount rather than a fine. Highest expected cost in the document and among the cheapest to fix. |
| **R2** | **No deletion or export path** (§2.5), while the privacy policy you are about to write must describe one. | **$20k–$80k** | 2–3 eng-days | Deletion is the most-enforced right in every state privacy statute, and promising it without building it is textbook deception. Independently, **Apple App Store Review Guideline 5.1.1(v) requires apps that support account creation to offer in-app account deletion** ([guidelines](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)) — so this is a hard gate on shipping the mobile app, not a policy nicety. The schema already cascades on delete; only the endpoint is missing. |
| **R3** | **Auto-renewal / ROSCA / state ARL non-compliance** (§9.3). | **$15k–$100k** | 1–2 eng-days | The most actively enforced consumer-protection regime touching a subscription business. Federal civil penalties up to $53,088 per violation, multistate AG settlements in the millions, private rights of action in several states. Probability of a *technical* violation is high if the cancellation flow is built without reading the state ARLs; probability of enforcement against a small company is low but non-trivial and rising. |
| **R4** | **No privacy policy exists** (§3.2). | **$5k–$40k** | $1k–$2.5k | Required unconditionally by CalOPPA and analogues, and a precondition for Google OAuth verification and both app store listings. Low direct enforcement probability, but it blocks distribution, which converts a compliance item into a launch dependency. |
| **R5** | **Unmanaged sensitive data: the free-text corpus, plus `accommodation_multiplier`** (§2.2, §3.6, §6.3, §7.3). | **$10k–$50k** | ~1 day | Students disclose health and personal circumstances in reasoning boxes without being asked, the corpus has no retention limit, and it is logged in a third party's console. Separately, `StudySession.accommodation_multiplier` already records disability-adjacent data whose permitted values map onto LSAC's accommodation tiers, and nothing currently marks it as sensitive. Combined with R1 this is your largest concentration of unmanaged sensitive data, and Washington's MHMDA is the only US privacy statute with a private right of action. Mitigations are microcopy, a logging-off header, a retention limit, and a handling rule for one existing column — all trivial. |
| **R6** | **No rate limiting on the paid LLM path** (§8.2 F1). | **$5k–$40k** | ½ day | Mostly a direct-cost risk: nothing sits between a user and your inference bill. Secondarily a "reasonable security measures" finding, which is boilerplate in every state statute and in FTC consent orders. |
| **R7** | **Verified score collection shipped without the consent flow** (§6, §11). | **$10k–$60k** | ~1 day if done at build time | Only materialises if the feature ships, but then it is severe and *retroactive*: remediating an improperly consented dataset means re-consenting every user or deleting the data, and the FTC's algorithmic-disgorgement remedy reaches models trained on it. This is the only risk here whose cost grows by an order of magnitude if deferred. Gate the feature on §11, not on the calendar. |
| **R8** | **Incident readiness: no IR plan, 1-day backup retention** (§2.6, §9.7). | **$5k–$30k** | 1 hour + AWS config | Low probability, but breach notification requires you to state *what* was exposed, and a 24-hour backup window limits your ability to reconstruct that. The runbook costs an hour; extending backup retention costs a few dollars a month. |
| **R9** | **Minors / age posture** (§5). | **$2k–$20k** | ~0 | Genuinely low probability given an adult test. In this tier purely because the fix — one ToS sentence, one checkbox, one written procedure — is free, and because leaving it out means answering "what is your age policy?" with silence. |
| **R10** | **Cookie prefixes and `SECRET_KEY` fail-closed** (§8.2 F2, F3). | **$1k–$10k** | ~1 hour | Small real risk, near-zero fix cost. Included so it does not get lost. |

**Tier total: roughly 6–8 engineer-days and $1,000–$2,500 of legal spend**, against something like $100k–$550k of expected cost. That ratio is unusual and is the main finding of this section: the required work is small, well-specified, and mostly already scaffolded by existing schema design.

### 10.2 Can follow the first paying customer

| # | Risk | Expected cost | Trigger to escalate |
|---|---|---|---|
| **R11** | **Missing CSP** (§8.2 F4). HSTS should be done in the first tier since it is an hour of CloudFront config; CSP is a multi-day project for an SPA with third-party identity. | $2k–$20k | Any user-generated content rendered to other users; any third-party script added |
| **R12** | **No user-visible session inventory / revocation** (§8.2 F5), with 90-day mobile tokens. | $1k–$10k | Ship alongside the R2 deletion work if convenient |
| **R13** | **Accessibility (ADA Title III / WCAG 2.1 AA).** Not a privacy matter, but the most common serial-plaintiff claim against consumer web products, and cheaper to design in than retrofit. Flagging because it is adjacent and routinely missed in compliance planning. | $5k–$30k | Any marketing push; any institutional customer (they will require a VPAT) |
| **R14** | **State comprehensive privacy law thresholds** (§3.5). | Low until scale | 35,000 residents of CT/DE/MD/NH/RI in a year; 100,000 of a large state; exceeding SBA small-business size standards; any corporate affiliation with a $26.625M entity |
| **R15** | **GDPR territorial scope** (§3.3). | Low if you do not target the EU | EU/UK marketing, EUR/GBP pricing, or a material EU user cohort in your own logs |
| **R16** | **FERPA and institutional data terms** (§4.3). | Zero today | Your first school, university, or pre-law-office contract — at which point re-read §4.3 before signing, because the data-use restrictions may be incompatible with the research corpus |
| **R17** | **SOC 2 / security questionnaires.** | Sales friction, not legal risk | First enterprise prospect. Until then, §8.1 is your answer. |
| **R18** | **Item-content egress and licensing** (§7.6). Full passages and stems leave on every coaching call. | Owned by `research/03-content-licensing.md` | Whatever that document concludes about redistribution rights |

### 10.3 The three highest-expected-cost risks, stated plainly

1. **R1 — the LLM egress path.** You cannot say who processes your users' writing, you have no agreement with whoever it is, and their default configuration logs it. Fix: move to a direct provider account you own, with a DPA, and request zero retention.
2. **R2 — the missing deletion path.** The right you are most likely to promise is the one you cannot honour, and Apple will block the mobile app over it regardless.
3. **R3 — subscription auto-renewal compliance.** The only item here with an active, well-funded, multistate enforcement apparatus pointed at companies of your size, and it is entirely a product-design problem.

All three are fixable in under a week of engineering plus one legal review.

---

## 11. Guidance for the measurement plan (`research/11`, §4.3)

`research/11-measurement-implementation-spec.md` §4.3 defines an `OfficialScore` table with `consent_at` and `consent_version` columns, says "do not ship this without the consent flow," and asks this document for the lawful collection path. This section supplies it: the schema deltas, the actual consent text, and the deletion path.

The spec's instinct was right and its two columns are the right two columns. What follows is what has to exist around them.

### 11.1 The legal position in one paragraph

Per §6, a verified LSAT score is not special category data under the GDPR and not sensitive data under any US state statute. **No statute currently compels opt-in consent for this collection.** The reason to build a real consent flow anyway is that (a) it is the only way to make secondary research use defensible, (b) versioned per-row consent is what turns the dataset from a diligence liability into a provable asset, and (c) under FTC Act § 5 you will be held to whatever you say, so it is worth saying something accurate and narrow rather than something broad and unenforceable. Consent here is a commercial instrument that happens to also be the compliance answer.

### 11.2 Schema deltas to §4.3

Keep the spec's table. Change five things.

1. **Archive the consent text, not just its version string.** `consent_version` is worthless unless you can produce, years later, the exact words a given user saw. Commit each version as an immutable file — `backend/app/consent/official_score/2026-08-01.md` — and never edit a published one; only add new ones. The column stores the filename stem. This is the single most important mechanic in this section and it costs nothing.
2. **Split product use from research use.** Add `consent_scope` (`'product'` | `'product_research'`), or two booleans. They have genuinely different withdrawal semantics: a user who wants their score out of your research corpus may still want it powering their own score estimate. Bundling them means every withdrawal is a deletion, which is worse for both of you.
3. **Add `consent_withdrawn_at` (nullable).** Needed to represent "stop using my score for research, keep showing me my estimate" without deleting the row. If it is set, the row is excluded from every research query.
4. **Do not add an accommodations column.** See §6.3 — that is the one field in this area that genuinely is sensitive data under both regimes.
5. **Use the codebase's `utcnow()`, not `datetime.utcnow`.** The spec's snippet has `default=datetime.utcnow`, which produces a naive datetime, while `backend/app/models.py` already exports a `utcnow()` helper used throughout. Consent timestamps are evidentiary; an ambiguous timezone in the one column whose whole purpose is to prove *when* someone agreed is a bad trade for a shorter import line.

On `verification`: the spec's three-tier enum is right, and its warning that self-reported scores "must not be silently modelled as verified" is the correct instinct. Be honest that **at launch you cannot achieve the `verified` tier at all** — you have no LSAC data feed, so nothing is verified in any meaningful sense. Ship with `self_report` only, leave the other two values defined but unused, and let the measurement models carry an explicit self-report error term. That is better psychometrics *and* better compliance than a tier label that overstates what you know.

### 11.3 One thing to rule out now

**Never ask a user for their LSAC account credentials, and never build a scraper or "connect your LSAC account" flow.** Someone will propose it as the obvious route to genuine verification. It would put users in breach of the LSAC Candidate Agreement ([2026–2027 terms](https://www.lsac.org/about/lsac-policies/lsac-candidate-agreement/2026-2027)), put you in the credential-harvesting business, and raise Computer Fraud and Abuse Act exposure for access exceeding authorisation. There is no version of this that is worth the data. A student voluntarily typing their own score into your app is entirely lawful; a student handing you the keys to LSAC's systems is not the same act.

### 11.4 The consent language

Ready to use. Plain English deliberately — consent that a reader cannot understand is not consent, and dense legalese here would also be worse product.

**Screen heading**

> **Add your official LSAT score**

**Body**

> Your official score is the most useful thing you can give us for making score estimates accurate — for you, and for everyone else using the app. Sharing it is completely optional, and it will never affect your access to any feature.

**Fields:** scaled score (120–180), test date, percentile (optional).

**Checkbox 1 — required to save, unticked by default**

> I'm adding my official LSAT score and test date. I agree that LSATspeedrun may store this in my account and use it to make my own score estimates more accurate.

**Checkbox 2 — genuinely optional, unticked by default, separately recorded**

> You may also use my score together with my practice history, in de-identified form, for research to improve score prediction for everyone.

**Standing text below the checkboxes**

> You can delete your score at any time in **Settings → Your data**. Deleting it removes it from your account and from all future research. We can't reverse statistics we've already published or model versions we've already trained — but nothing we build after you delete it will use your score.

**Expandable "What we do and don't do with this" — collapsed by default, but written to be read**

> **We collect:** your scaled score, your test date, and your percentile if you give it.
> **We do not collect:** your LSAC account number, your name as it appears on your score report, your address, or whether you tested with accommodations.
> **We will never:** sell your score, publish it, share it with law schools or admissions consultants, show it to other users, or use it to advertise to you.
> **We will never ask for your LSAC password.**
> Your score is stored with your account and deleted when you delete your account.

Three notes on why it is written this way. The **"we can't reverse what's already trained"** sentence is unusual and it is there on purpose: it is true of every ML product, almost no consent flow admits it, and admitting it is what makes the rest of the promise credible and enforceable-as-written rather than a promise you will quietly break. The **explicit non-collection list** does more work than the collection list, because it pre-commits you against the four expansions someone will propose later. And **checkbox 2 must be separately recorded**, not inferred — that is what `consent_scope` is for.

**Versioning in practice:** the first version is `2026-08-01`. Any change to the words above — including softening "never" — is a new version. Users on old versions keep their old consent and are not retroactively upgraded. If a new version expands what you do, re-prompt affected users; if it only narrows, no re-prompt is needed.

### 11.5 The deletion path

This is the part the spec's `ondelete="CASCADE"` only half-solves. Cascade handles the primary database. It does nothing about the four other places score data will end up.

**Layer 1 — the row.** `DELETE /v1/official-scores/<id>`, hard delete, not a soft-delete flag. A soft-deleted row is still stored personal data, still in scope for every deletion right, and still one careless `SELECT` away from being used. If you need "stop research use but keep my estimate," that is `consent_withdrawn_at`, which is a different operation with different semantics — do not conflate them.

**Layer 2 — the account.** Account deletion cascades to `OfficialScore` via the existing foreign key. This depends on the general account-deletion endpoint that §2.5 says does not exist and R2 says to build; the score work should not ship before it. Note the spec's own §7 flags a foreign-key hazard — verify the cascade actually fires end-to-end with a test, rather than trusting the DDL.

**Layer 3 — backups.** State a bounded window in the privacy policy: "removed from backups within N days." There is a small irony worth noticing: §2.6 found RDS backup retention set to **1 day**, which is poor for disaster recovery and unusually good for deletion promises. If you extend retention to a sane 7–35 days (you should), update N in the policy at the same time. These two numbers must match, and nobody ever remembers to change the second one.

**Layer 4 — derived copies. This is where deletion programmes actually fail.** The moment someone exports a CSV to fit a model in a notebook, cascade deletion stops being true. At your scale the defensible rule is the simple one: **never persist a derived copy of identified score data outside the primary database.** Recompute from the database for each analysis; treat notebooks and extracts as ephemeral. If that eventually becomes impractical, the alternative is a `deletion_log` table of `(user_id, deleted_at)` that every derived dataset must be re-filtered against before use — meaningfully more machinery, so postpone needing it for as long as you can.

**Layer 5 — trained models.** You cannot untrain a model. The consent text above says so. Do not write a policy sentence that implies otherwise; that sentence is the one an FTC investigator would quote back, and algorithmic disgorgement (§3.2(a)) is the remedy attached to getting it wrong.

**Proof.** Keep an append-only audit record of deletion events — `user_id`, `what`, `when`, `requested_via` — and deliberately **not** the deleted value. The audit log exists to prove you honoured the request; a log that preserves the score would resurrect the data you just deleted, which is a mistake I have seen shipped more than once.

**SLA.** Promise 30 days in the privacy policy; execute immediately. Under-promise here, because the promise is the enforceable part.

### 11.6 Screenshots — defer them, and if you don't, don't store them

The spec's `screenshot` verification tier is the highest-risk item in this table and I would not build it for v1.

A screenshot of an LSAC score report is not a score. It contains the candidate's full name, LSAC account number, test date, and often more. That single design choice would change your data classification, your breach-notification posture (per §6.5 you are currently *outside* most state notification triggers; a stored name-plus-account-number image plausibly puts you inside), and your storage security requirements — to verify a number the user already typed.

If you build it later, the rules are: never persist the image; process in memory or in a bucket with a hard ≤24-hour lifecycle rule; extract only score and test date; if a human reviews it, review a crop; tell the user in the UI to redact everything except the score and date before uploading; and never let the image reach the LLM gateway in §7.

### 11.7 Summary for the measurement workstream

- **Build it.** Verified official scores are lawful to collect and are the highest-value data in the product.
- **Ship `self_report` only at launch.** Model the error explicitly instead of pretending to verification you cannot perform.
- **Two checkboxes, unticked, separately recorded**, with the archived-text versioning in §11.2(1).
- **Hard delete, plus the account-deletion endpoint first.** The score feature should not ship before R2.
- **No accommodations column, no screenshots, no LSAC credentials.**
- **Total added cost: about one engineer-day**, most of it the settings UI, on top of the account-deletion work that is required anyway.

---

## 12. Pre-launch checklist

Ordered so that the blocking dependencies come first and the two-week counsel turnaround starts on day one rather than day ten. Everything in Phases 0–3 is required before you take money. Phase 4 is deliberately deferred.

### Phase 0 — Do these first; everything else waits on them (day 1)

- [ ] **Answer one question: whose LLM credential is in `TFY_API_KEY`?** Open a direct OpenAI account in the company's name, accept the Services Agreement (which incorporates the DPA at § 5.3), and request Zero Data Retention or Modified Abuse Monitoring through the privacy portal. Point `TFY_URL` at it. *(§7.6 Option A — half a day, unblocks the privacy policy and R1.)*
- [ ] **Email a startup-focused privacy attorney today** with this document attached and a two-line brief: US-first D2C subscription, need a privacy policy review and a ToS. Their turnaround is your critical path. *(§9.1, §9.2 — $2,500–$5,000.)*
- [ ] **Decide, and write down, the EU question.** Are you accepting EU/UK users? If no (recommended), the answer is a jurisdictional statement in the ToS, not a geo-block. *(§3.3.)*

### Phase 1 — Engineering, week 1 (about 6 days)

- [ ] **Account deletion endpoint** — hard delete, cascade verified by an end-to-end test, not by reading the DDL. *(R2. Blocks the mobile app under Apple guideline 5.1.1(v).)*
- [ ] **Data export endpoint** — JSON dump of everything tied to the user. Same query surface as deletion; build them together. *(§2.5.)*
- [ ] **Session list and revoke** while you are in there. *(§8.2 F5.)*
- [ ] **Rate limiting** — `Flask-Limiter`, strict on `/auth/*` and the coaching routes, looser globally. *(R6.)*
- [ ] **Send `X-TFY-LOGGING-CONFIG` with `enabled: false`**, or the equivalent on whatever provider you land on. *(§7.6.)*
- [ ] **Reasoning-box microcopy:** "Please don't include health, medical, or other sensitive personal details in your explanation." *(§3.6, R5.)*
- [ ] **Trim `recent_reasoning_samples`** to the smallest number that preserves coaching quality. *(§7.6.)*
- [ ] **`__Host-` cookie prefixes**, conditional on `COOKIE_SECURE`. *(§8.2 F2.)*
- [ ] **`SECRET_KEY` raises at startup in production**, mirroring the existing `DEV_AUTH_ENABLED` pattern. *(§8.2 F3.)*
- [ ] **HSTS via a CloudFront response headers policy.** `max-age=300` for one day, then a year. No `preload`. *(§8.2 F4.)*
- [ ] **Extend RDS backup retention** from 1 day to 7–35, and note the number you chose — the privacy policy has to match it. *(§2.6, §11.5.)*
- [ ] **Retention limit on free-text reasoning.** Pick a number, implement the job, write it in the policy. *(R5.)*
- [ ] **Mark `accommodation_multiplier` as sensitive.** Confirm it is never sent to the LLM gateway, never copied to `OfficialScore`, never included in any export, and does cascade on account deletion. Relabel the user-facing control as a timing preference. *(§6.3, R5.)*

### Phase 2 — Documents, week 1–2 (mostly waiting on counsel)

- [ ] **Draft the privacy policy yourself from §2** — you have the data inventory, which is the expensive part. Include: categories collected, named subprocessors, deletion/export instructions, real retention periods, DNT response, effective date, and an explicit "we do not sell or share personal information." *(§9.1.)*
- [ ] **Send it to counsel with the ToS brief.** ToS must include: the score-outcome disclaimer, the 18+ term, the US/Canada-only statement, the UGC licence, limitation of liability, and governing law. *(§9.2, §5.5, §3.3.)*
- [ ] **Publish a subprocessor list** — AWS, your LLM provider, Google, payment processor. Thirty minutes. *(§9.7.)*
- [ ] **Write the one-page incident response runbook.** One hour. *(§9.7, R8.)*
- [ ] **Collect vendor DPAs into one folder.** AWS is automatic; OpenAI is incorporated by reference; note the rest. *(§9.5.)*
- [ ] **Write down the FERPA conclusion** with the §4 citations, so you never re-litigate it in a diligence call. *(§4.4.)*

### Phase 3 — Before you charge the first customer

- [ ] **Age posture:** one ToS sentence, one unticked 18+ checkbox at signup, no date-of-birth field. *(§5.5, R9.)*
- [ ] **Written actual-knowledge procedure** for under-18 reports, with the contact address published in the policy. *(§5.5.)*
- [ ] **Cancellation must be as easy as signup, in the same medium.** Signup is one Google button, so cancellation is one button in settings. No mandatory call, no retention gauntlet. *(§9.3, R3.)*
- [ ] **Pre-checkout auto-renewal disclosure block** — price, renewal cadence, cancellation method — shown *before* billing details are collected, plus a post-purchase confirmation email restating them. *(ROSCA; state ARLs.)*
- [ ] **Reconcile the policy against reality.** Read the finished privacy policy line by line against `models.py` and §2. Every sentence must be something the code actually does today. This takes an hour and prevents the single most likely enforcement theory against you. *(§3.2(a).)*
- [ ] **Mobile only:** consume the store age signal and refuse under-18 accounts; set an accurate age rating; confirm in-app account deletion is present. *(§5.4, R2.)*

### Phase 4 — Gated on a feature, not on the calendar

- [ ] **Before the `OfficialScore` table ships:** the two-checkbox consent flow, the archived versioned consent text, `consent_scope` and `consent_withdrawn_at`, `self_report` tier only, no accommodations column, no screenshots, and score deletion in Settings. *(§11, R7.)*
- [ ] **Before any wellbeing, stress, or test-anxiety feature ships:** stop and get advice. Washington's MHMDA is the only US privacy statute with a private right of action and inferred mental-health data is its core subject. *(§3.6.)*
- [ ] **Before signing an institutional customer:** re-read §4.3 and decide deliberately whether institutional data can enter the research corpus. It probably cannot. *(§4.3, R16.)*
- [ ] **Before adding any analytics or advertising SDK:** you would forfeit the cookie-banner exemption, part of the CCPA threshold advantage, and part of the clean data story. Price it properly. *(§9.4, §3.4.)*

### Explicitly not now

SOC 2. Penetration test. Cookie consent platform. FERPA certification or the Student Privacy Pledge. GDPR Article 27 representative. Age-verification vendor. Parental consent flows. DPA template for customers. Each of these is a real cost solving a problem you do not currently have. *(§4.4, §5.5, §8.3, §9.4, §9.5.)*

---

## 13. What needs a lawyer, what does not, and what nobody can tell you

**Restating the obvious: I am not a lawyer, and none of this is legal advice.** Everything above is cited so it can be checked. The value of this section is that it tells you where *not* to spend money on legal fees, which for a pre-revenue company matters as much as knowing where to spend it.

### 13.1 Settled enough to act on today, without counsel

I would act on each of these unilaterally. Each is either a published primary source or a determinate application of one, and each is cited above.

| Conclusion | Where | Confidence |
|---|---|---|
| FERPA does not apply to a direct-to-consumer product with no school relationship | §4 | High |
| No US state comprehensive privacy statute binds this company today | §3.4, §3.5 | High |
| CalOPPA requires a posted privacy policy from your first California user, with no threshold | §3.2 | High |
| A verified LSAT score is not GDPR Article 9 data and not "sensitive data" under any state statute | §6 | High |
| Testing accommodations status *is* health/disability data under both regimes | §6.3 | High |
| COPPA does not apply; an 18+ attestation posture is sound and costs nothing | §5 | High |
| No cookie consent banner is required for two strictly-necessary first-party cookies | §9.4 | High |
| OpenAI does not train on API content by default; 30-day abuse-monitoring retention; DPA published and incorporated | §7.4 | High (published terms, verifiable today) |
| Deletion and export endpoints must exist before you promise them | §2.5, §3.2 | High |
| Every engineering item in §8.2 and §12 Phase 1 | §8, §12 | High — no legal judgement involved |

### 13.2 Genuinely needs a lawyer — and these are bounded, cheap questions

Ask for *review*, not research. You are handing counsel a finished draft and a specific question, which is a one-hour engagement rather than a five-hour one.

1. **The Terms of Service.** Do not self-draft. Limitation of liability, warranty disclaimer, arbitration and class-action waiver, and governing law are exactly the clauses that fail when written by non-lawyers, and they are the clauses that matter when something goes wrong. *$1,500–$4,000.*
2. **Privacy policy review** against the finished draft. *2–4 hours.*
3. **The auto-renewal flow, reviewed before you charge anyone**, against California's amended ARL, the Massachusetts regulation, and ROSCA. Show them screenshots of the actual checkout and cancellation flow, not a description. Highest-ROI single hour of legal time in this document. *1–2 hours.*
4. **A corporate-structure question, for corporate counsel, taking about fifteen minutes:** is this entity controlled by, or under common branding with, any entity that clears $26.625M in gross revenue or exceeds SBA size standards? A "yes" collapses the §3.4 and §3.5 exemptions that most of this document's cost estimates depend on.
5. **The LLM credential's history.** If `TFY_API_KEY` does belong to a third party's tenant, ask whether past processing of user data through it created any exposure that needs remediating, as distinct from just fixing it going forward. Bounded question, worth asking once.
6. **Every institutional or B2B contract, every time** — see §4.3, where the data-use terms may be incompatible with the research corpus.
7. **Before any of these three product decisions:** lowering the age floor below 18; shipping any wellbeing, stress, or test-anxiety inference; deliberately accepting EU or UK users.

### 13.3 Genuinely unsettled — where a lawyer will also say "it depends"

If counsel gives you a confident answer on any of these, be suspicious. Listed so you can recognise them when they come up rather than paying to rediscover them.

- **Whether GDPR Article 3(2)(b) "monitoring of behaviour" reaches a non-targeting US service that incidentally profiles a user who happens to be in the EU.** No CJEU ruling on the point; the EDPB has not disclaimed the broad reading. (§3.3)
- **What "reasonably likely to be accessed by minors" means** in the age-appropriate design codes — and, separately, whether those statutes survive First Amendment review at all. *NetChoice v. Bonta* is back before the district court on remand; Maryland and South Carolina are under challenge. The law here will look different in a year. (§5.3)
- **Whether the Washington MHMDA's "derived or extrapolated" language reaches behavioural inferences never intended as health inferences.** Untested, and because of the private right of action it will be tested by plaintiffs rather than by a regulator issuing guidance. (§3.6)
- **Whether the App Store Accountability Acts' developer obligations survive the pending First Amendment litigation.** They are enforceable now; that is the operative fact. (§5.4)
- **Where the FTC's restarted negative-option rulemaking lands** relative to ROSCA. (§9.3)
- **How aggressively algorithmic disgorgement will be applied to small companies.** The remedy exists and has been imposed; its boundaries have not been mapped. This is the tail risk that makes §11's consent discipline worth the one engineer-day. (§3.2)

### 13.4 How to brief counsel without spending $10,000

Send this document. Say: *"US-first, direct-to-consumer LSAT prep subscription, pre-revenue, no EU users, no institutional customers, no advertising. I've done the data inventory and drafted the privacy policy. I need (a) a ToS, (b) a review of the policy, (c) a review of my cancellation flow against ROSCA and the state ARLs. Fixed fee if possible."*

That brief is short because the expensive part — knowing what data the system actually holds, where it goes, and which regimes are in play — is already done. Lawyers charge for discovery as much as for judgement, and §2 through §7 of this document is the discovery.

---

*End of assessment. Sections 1–2.6 by a prior pass; 3–13 in this one. Every legal claim above links to a primary source or named practitioner commentary; if you are reading this more than six months after the effective date in the header, re-check §3.5, §5.3, and §9.3 in particular — those three areas moved during 2026 and will move again.*
