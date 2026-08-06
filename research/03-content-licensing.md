# Content Rights & Licensing for LSAT Speedrun

**Compiled:** Sunday, August 2, 2026
**Author:** Research agent (not an attorney)
**Question:** Can LSAT Speedrun launch commercially with its current question bank, and if not, what are the realistic paths forward?

> ## ⚠️ THIS IS NOT LEGAL ADVICE
>
> I am not a lawyer and this document is not legal advice. It is a research memo assembled from
> public sources to help you understand the shape of the problem and ask an attorney the right
> questions. Copyright, fair use, and contract questions are fact-specific and jurisdiction-specific.
> **Before any commercial launch, have a qualified IP attorney review the actual question bank and
> the actual product.** Several conclusions below are my inference from analogous cases, not
> statements of settled law, and I have labeled them as such throughout.

---

> # 🚨 URGENT — READ THIS FIRST, BEFORE THE REST OF THE DOCUMENT
>
> **The GitHub repository `github.com/nischayhegde/LSATspeedrun` is PUBLIC, and it contains the
> complete LSAT question bank in plaintext.**
>
> I verified this directly:
> - GitHub API reports `"private": false`, `"visibility": "public"`.
> - `https://raw.githubusercontent.com/nischayhegde/LSATspeedrun/main/backend/data/question_bank/lsat-lr/train.jsonl`
>   returns **HTTP 200 and 4.18 MB** of LSAT Logical Reasoning items to any anonymous request.
> - The commit that added it is titled **"Archive complete LSAT question bank"** (`1576bb3`,
>   2026-07-22). The repo has been public since 2026-07-17.
>
> **Why this is more serious than the app itself.** Serving items to logged-in users is one thing.
> Publishing ~85 complete LSAT PrepTests as bulk downloadable text files, worldwide, for free, is
> unauthorized **distribution** of LSAC's entire disclosed corpus in its most reusable form. It
> harms exactly the market LSAC sells into ($124/yr LawHub Advantage), it is trivially discoverable
> by anyone searching GitHub for "LSAT," and the commit message reads in a courtroom as a
> description of the act.
>
> **Do this today, before anything else:**
> 1. Make the repository **private** (Settings → General → Danger Zone → Change visibility).
> 2. Then purge the files from git history (`git filter-repo` or BFG) and force-push. Making it
>    private is the tourniquet; history purging is the actual fix, because the repo may be made
>    public again later or shared with investors and contractors.
> 3. Check for forks (currently 0 per the API — good) and for any mirror, archive, or cached copy.
> 4. Note the timestamps of what you did.
>
> This costs one minute and materially reduces exposure. Nothing else in this document is more
> time-sensitive. Details in §8.5.

---

**Method note:** Every source consulted is logged, including dead ends and sources that turned out
to be useless. Each source is tagged with a reliability level. I distinguish sharply between
**verified fact** (I read the primary document and it says this), **strong inference** (multiple
converging sources plus reasoning, but no single document says it), and **unverified claim**
(someone asserts it; I could not confirm).

**Reading key:**
- 🔴 = finding that materially increases legal risk
- 🟢 = finding that materially decreases legal risk or opens a path forward
- ⚪ = neutral / contextual

## The four things to know if you read nothing else

1. 🚨 **The GitHub repo is public and the whole question bank is downloadable by anyone right now.**
   Make it private today (see the urgent box above, and §8.5).
2. 🔴 **The question bank is 6,886 verbatim real LSAT items from ~85 real administrations,
   1991–2016.** No license exists anywhere in the chain. Nothing is public domain until ~2086.
3. 🔴 **LSAC sued a solo developer running an AI LSAT tutor in Dec 2024 and won judgment in May
   2025** — including claims against him personally. He had asked LSAC for a license first, and
   LSAC used that email as evidence of willfulness.
4. 🟢 **LSAC sells the license you need for $38 per student, publicly, with a rate card and an email
   address** — and onboarded a company with essentially your product description as a licensee this
   year. Getting a license is far more achievable than the founder assumes. It just won't happen in
   1.5 weeks.

## Contents

| § | Topic |
|---|---|
| [1](#1-provenance-what-is-actually-in-the-question-bank) | Provenance — what the question bank actually is |
| [2](#2-the-legal-reality-of-using-these-items-commercially) | Legal reality — case law, fair use, and the "but it's MIT licensed" question |
| [3](#3-copyright-duration-is-anything-in-the-public-domain) | Copyright duration |
| [4](#4-lsacs-licensing-program--this-is-the-most-important-section) | **LSAC's licensing program — pricing, licensees, terms, architecture** |
| [5](#5-what-lsac-gives-away-free-and-what-you-may-legitimately-build-on) | What's legitimately free, and LawHub's Terms of Use |
| [6](#6-the-alternative-original-or-ai-generated-items) | The original/AI-generated alternative and how the market sees it |
| [7](#7-building-the-licensing-pitch) | Building the licensing pitch |
| [8](#8-risk-assessment-for-launching-as-is) | Risk assessment for launching as-is |
| — | Source log (72 sources, including dead ends) |
| — | **The provenance verdict · Risk ladder · Could we get a license? · What I'd do with 1.5 weeks** |

---

# 1. Provenance: what is actually in the question bank?

## 1.1 The short version

The question bank is **verbatim real LSAT items from ~85 real LSAT administrations between June
1991 and December 2016, plus 5 LSAT—India administrations.** This is not a close call, not an
inference, and not a matter of interpretation. I traced the exact byte-level chain of custody and
verified it against the local snapshot in this repository.

## 1.2 The chain of custody, established

```
LSAC administers + publishes LSAT PrepTests (1991–2016)
   │  [copyrighted literary works, © Law School Admission Council]
   ▼
Zhong et al. / Wang et al. (Microsoft Research + Sun Yat-sen Univ. + Fudan Univ.)
scrape "nearly 90 LSAT exams from 1991 to 2016"
   │
   ▼
github.com/zhongwanjun/AR-LSAT  →  /complete_lsat_data/{train,val,test}_{ar,lr,rc}.json
   │  [repo carries a repo-level MIT LICENSE file]
   ▼
huggingface.co/datasets/tasksource/lsat-lr  and  tasksource/lsat-rc
   │  [NO license declared — dataset card is the auto-generated stub]
   ▼
LSAT Speedrun  backend/data/question_bank/{lsat-lr,lsat-rc}/*.jsonl
      6,886 items, unmodified upstream rows
```

## 1.3 How I verified each link

**Link 1 — The local snapshot is the HF dataset, unmodified.** `backend/data/question_bank/README.md`
states the snapshot "includes all train, validation, and test rows from `tasksource/lsat-lr` and
`tasksource/lsat-rc`" and that "Each JSONL line is one unchanged upstream row." Row counts match the
HF dataset metadata exactly:

| Dataset | train | validation | test | total |
|---|---|---|---|---|
| `tasksource/lsat-lr` | 3,504 | 506 | 510 | **4,520** |
| `tasksource/lsat-rc` | 1,827 | 270 | 269 | **2,366** |
| | | | | **6,886** |

**Link 2 — The `id_string` field decodes to real LSAT administration dates.** Every row carries an
`id_string` like `200010_1-LR1_1_1`. Parsing all 6,886 of them yields **90 distinct administration
codes**:

- **85 U.S. LSAT administrations** in `YYYYMM` form, from `199106` (June 1991) through `201612`
  (December 2016). Every code corresponds to a real LSAT test date. These map to roughly
  **PrepTest 1 through PrepTest 80**.
- **5 codes of the form `india1`–`india5`** — the LSAT—India exam, a separate LSAC product
  administered in India. 304 items.

Item counts per year are extremely regular (~230–310/year), consistent with systematic harvesting of
every published test rather than incidental collection. The `_1-LR1_`, `_2-RC_` segments decode to
section number and section type; the trailing digits are question position.

**Link 3 — The upstream file is byte-identical.** I downloaded
`complete_lsat_data/test_lr.json` from the AR-LSAT GitHub repo. It contains exactly **510** items —
matching the `tasksource/lsat-lr` test split — and item [0] is the identical "Editorial: The
structure of the present school calendar…" question with the identical five answer options. The nine
files in `complete_lsat_data/` (`{train,val,test}_{ar,lr,rc}.json`) map one-to-one onto the
tasksource splits. `tasksource/lsat-lr` and `tasksource/lsat-rc` are a straight parquet re-hosting of
the `_lr` and `_rc` files. (The `_ar` / Analytical Reasoning files were not ingested by this app.)

**Link 4 — The upstream paper states the source in plain English.** Zhong et al., *AR-LSAT:
Investigating Analytical Reasoning of Text*, §3.2: *"We collect data from nearly 90 LSAT exams from
1991 to 2016."* "Nearly 90" is exactly what I counted. The paper does not claim to have licensed
anything, does not mention LSAC permission, and does not discuss copyright at all.

## 1.4 🔴 The content is unmistakably real, not synthetic

Beyond the ID decoding, the content itself is self-authenticating as genuine LSAT material:

- Reading Comprehension questions contain **line references to the printed test** — e.g. *"the
  twofold obligation introduced in lines 20–23."* A synthetic generator has no reason to produce
  line numbers keyed to a physical page layout. These are transcriptions of printed booklets.
- The question stems are the exact canonical LSAC formulations: *"Which one of the following is an
  assumption on which the editorial's argument depends?"*, *"Which one of the following, if true,
  most helps to resolve the apparent discrepancy?"*, *"The conclusion follows logically if which one
  of the following is assumed?"* These are LSAC's house style verbatim, down to "Which one of the
  following" rather than "Which of the following."
- The RC passage in test item [0] of `lsat-rc` is a known LSAT passage about defense lawyers'
  obligations.

**There is no plausible reading under which this is anything other than LSAC's copyrighted test
content, reproduced verbatim.**

## 1.5 🔴 The license situation: nobody upstream had rights to grant

This is the crux the founder needs to understand, so I want to be precise about each layer.

**Layer A — `tasksource/lsat-lr` and `tasksource/lsat-rc` declare no license at all.**
I queried the Hugging Face API for both datasets. Neither has a `license:` tag. Neither repository
contains a `LICENSE` file — the full file tree for `lsat-lr` is exactly three entries:
`.gitattributes`, `README.md`, and the `data/` directory. The README is the unmodified
auto-generated stub: *"# Dataset Card for 'lsat-lr' — [More Information needed]"*. There is no
provenance statement, no citation to the upstream paper, no terms of use, no attribution to LSAC.

So the "the dataset says MIT" premise is **not even true at the layer this app pulled from**. The
app pulled from a dataset with *no* stated license. Under Hugging Face's own terms and under default
copyright law, "no license stated" means **no permission granted** — not "public domain."

**Layer B — the AR-LSAT GitHub repo carries a repo-level MIT license.** GitHub's API reports the
repo license as MIT. But note what that actually is: a `LICENSE` file at the root of a repo that
primarily contains *research code* (the "Analytical Reasoning Machine" pipeline, NER/parsing scripts,
model training code). The MIT text is boilerplate covering "the Software." Nothing in the repo says
"the LSAT items in `complete_lsat_data/` are MIT licensed" as a considered legal statement about the
test content.

**Layer C — and this is the decisive point — it would not matter if it did.**

> **You cannot license what you do not own.** *Nemo dat quod non habet.* An MIT license from Party B
> conveys only whatever rights Party B actually held. Microsoft Research interns scraping LSAT
> booklets acquired **zero** copyright in LSAC's items by scraping them. Placing an MIT LICENSE file
> in the repo transfers zero rights in LSAC's content downstream, because there were zero rights to
> transfer.

**Strong inference (near-certainty):** a permissive license tag on a scraped dataset provides **no
defense to a copyright claim by the original rightsholder.** It may be relevant to your *state of
mind* — see §4.3 on willfulness and statutory damages, where this actually matters a great deal —
but it is not a license, and it is not a defense to liability.

An analogy that may land better: if someone uploads a full copy of a Stephen King novel to GitHub
with an MIT LICENSE file, downstream users who sell copies are infringing King's copyright. The
LICENSE file does nothing except possibly make the downstream user's infringement non-willful. The
LSAT items are in exactly this posture, with the wrinkle that a research paper's academic
respectability makes the provenance *feel* cleaner than it is.

## 1.6 ⚪ Datasets I checked and ruled out as the source

- **ReClor** (Yu et al., ICLR 2020) — logical reasoning items drawn from LSAT *and* GMAT, 6,138
  items. **Not the source.** ReClor's own terms are notable and are discussed in §1.7 below.
- **AGIEval** (Zhong et al., Microsoft, 2023) — a benchmark suite whose `lsat-ar`, `lsat-lr`,
  `lsat-rc` tasks are *themselves derived from the AR-LSAT `complete_lsat_data` files*. AGIEval is
  a **sibling** of the tasksource datasets (same underlying files, same lead author Wanjun Zhong),
  not an ancestor. Its LSAT subsets are the same LSAC content.
- **LogiQA** — derived from Chinese Civil Service exams, not LSAT. Irrelevant.

## 1.7 ⚪ What the more careful upstream researchers did differently

Worth noting because it shows the field knows this is a problem: **ReClor**, which drew from the same
kind of source material, gates its dataset behind a registration wall and an explicit
**non-commercial, research-use-only** agreement, and instructs users not to redistribute. That is
what a research team looks like when it has thought about the rights question. AR-LSAT's
`complete_lsat_data` has no such gate — it is a plain public directory with an MIT file on the repo.

**The contrast is itself evidence:** the existence of a careful non-commercial-gated sibling dataset
undercuts any argument that the field treats LSAT items as freely usable.

---

## Sources — Section 1 (Provenance)

### tasksource/lsat-lr dataset metadata (Hugging Face API)
- **Source**: Hugging Face Hub API
- **Link**: https://huggingface.co/api/datasets/tasksource/lsat-lr
- **Date accessed**: 2026-08-02
- **Type**: primary (dataset metadata)
- **What it establishes**: No `license` tag present in `tags[]`. Splits: train 3,504 / validation 506 / test 510 = 4,520. Created 2024-03-25 by author `tasksource`. Features include `id_string`. File tree contains only `.gitattributes`, `README.md`, `data/` — **no LICENSE file**.
- **Reliability**: verified fact

### tasksource/lsat-rc dataset metadata (Hugging Face API)
- **Source**: Hugging Face Hub API
- **Link**: https://huggingface.co/api/datasets/tasksource/lsat-rc
- **Date accessed**: 2026-08-02
- **Type**: primary (dataset metadata)
- **What it establishes**: No license tag. Splits: train 1,827 / validation 270 / test 269 = 2,366. Same structure and same absence of LICENSE file.
- **Reliability**: verified fact

### tasksource/lsat-lr dataset card (raw README.md)
- **Source**: Hugging Face
- **Link**: https://huggingface.co/datasets/tasksource/lsat-lr/raw/main/README.md
- **Date accessed**: 2026-08-02
- **Type**: primary (official dataset documentation)
- **What it establishes**: The entire human-written body is `# Dataset Card for "lsat-lr"` followed by `[More Information needed]`. No provenance, no license, no attribution, no terms of use, no citation to the upstream paper.
- **Reliability**: verified fact

### Sample rows from tasksource/lsat-lr and lsat-rc (HF datasets-server)
- **Source**: Hugging Face datasets-server
- **Link**: https://datasets-server.huggingface.co/rows?dataset=tasksource%2Flsat-lr&config=default&split=test&offset=0&length=5
- **Date accessed**: 2026-08-02
- **Type**: primary (the data itself)
- **What it establishes**: `id_string` values decode to LSAT administration/section/question (e.g. `200010_1-LR1_1_1` = Oct 2000, section 1, LR1, Q1). RC items contain printed-page line references ("lines 20–23"). Question stems are LSAC's exact canonical phrasings. This is verbatim real LSAT content.
- **Reliability**: verified fact

### Local question bank id_string analysis
- **Source**: This repository, `backend/data/question_bank/**/*.jsonl` (6,886 rows parsed)
- **Link**: n/a (local)
- **Date accessed**: 2026-08-02
- **Type**: primary (the shipped artifact)
- **What it establishes**: 90 distinct administration codes: 85 U.S. dates spanning `199106`→`201612`, plus `india1`–`india5` (304 items, LSAT—India). Per-year counts 230–310, highly regular. The app ships essentially the entire published PrepTest corpus for LR and RC from 1991–2016.
- **Reliability**: verified fact

### 🚨 GitHub repository visibility check — github.com/nischayhegde/LSATspeedrun
- **Source**: GitHub REST API and raw.githubusercontent.com, direct requests
- **Link**: https://api.github.com/repos/nischayhegde/LSATspeedrun · https://raw.githubusercontent.com/nischayhegde/LSATspeedrun/main/backend/data/question_bank/lsat-lr/train.jsonl
- **Date accessed**: 2026-08-02
- **Type**: primary (live verification)
- **What it establishes**: The repository is **public** (`"private": false`, `"visibility": "public"`), created 2026-07-17, last pushed 2026-07-31, 0 forks, 0 stars. The raw question bank file returns **HTTP 200 with 4,178,746 bytes** to an unauthenticated request — i.e., the LSAT Logical Reasoning training split is anonymously downloadable by anyone on the internet right now. The commit that added the bank is `1576bb3`, dated 2026-07-22, titled **"Archive complete LSAT question bank."**
- **Reliability**: verified fact

### Local question bank README (existing internal disclosure)
- **Source**: This repository, `backend/data/question_bank/README.md`
- **Link**: n/a (local)
- **Date accessed**: 2026-08-02
- **Type**: primary (internal doc)
- **What it establishes**: Rows are "unchanged upstream row[s]"; the repo already acknowledges "The upstream dataset cards do not currently declare a license" and warns to confirm compliance "before distributing or commercializing this material." **Note for the record: this is a pre-existing written acknowledgment of the rights question, which is relevant to willfulness (§4.3).**
- **Reliability**: verified fact

### AR-LSAT GitHub repository
- **Source**: Wanjun Zhong et al. / GitHub
- **Link**: https://github.com/zhongwanjun/AR-LSAT
- **Date accessed**: 2026-08-02
- **Type**: primary (upstream source repo)
- **What it establishes**: Repo license reported by GitHub API as **MIT**. Directory `complete_lsat_data/` contains exactly `{train,val,test}_{ar,lr,rc}.json`. Repo description is "Experiment for lsat"; contents are predominantly research code. No statement anywhere claiming rights in the LSAT content, no LSAC permission mentioned.
- **Reliability**: verified fact

### AR-LSAT complete_lsat_data/test_lr.json (byte-level match)
- **Source**: GitHub raw
- **Link**: https://raw.githubusercontent.com/zhongwanjun/AR-LSAT/main/complete_lsat_data/test_lr.json
- **Date accessed**: 2026-08-02
- **Type**: primary (the data itself)
- **What it establishes**: Contains exactly 510 items, matching `tasksource/lsat-lr` test split count; item [0] is character-identical to the HF item [0]. **Confirms tasksource is a re-host of AR-LSAT's complete_lsat_data, not an independent collection.**
- **Reliability**: verified fact

### Zhong et al., "AR-LSAT: Investigating Analytical Reasoning of Text" (arXiv 2104.06598)
- **Source**: Microsoft Research / Sun Yat-sen University; arXiv
- **Link**: https://arxiv.org/pdf/2104.06598
- **Date accessed**: 2026-08-02
- **Type**: primary (academic paper)
- **What it establishes**: §3.2 Dataset Collection: *"We collect data from nearly 90 LSAT exams from 1991 to 2016."* Exactly matches the 90 administration codes found in the shipped data. The paper contains **no** discussion of copyright, licensing, or LSAC permission.
- **Reliability**: verified fact

### Wang et al., "From LSAT: The Progress and Challenges of Complex Reasoning" (IEEE/ACM TASLP 2022; arXiv 2108.00648)
- **Source**: Fudan University / Microsoft Research
- **Link**: https://arxiv.org/abs/2108.00648
- **Date accessed**: 2026-08-02
- **Type**: primary (academic paper)
- **What it establishes**: This is the paper the `complete_lsat_data/` directory (all three sections: AR, LR, RC) belongs to, per the AR-LSAT repo README. It is the direct upstream of the LR and RC files this app ships.
- **Reliability**: verified fact (attribution per repo README)

### Findings of NAACL 2022 version of AR-LSAT
- **Source**: ACL Anthology
- **Link**: https://aclanthology.org/2022.findings-naacl.177.pdf
- **Date accessed**: 2026-08-02
- **Type**: primary (peer-reviewed publication)
- **What it establishes**: Peer-reviewed confirmation of the same collection statement ("nearly 90 LSAT exams from 1991 to 2016"). The only citation given for "LSAT" is the **Wikipedia article** — i.e., no rights provenance was documented even at peer review.
- **Reliability**: verified fact

---

# 2. The legal reality of using these items commercially

## 2.1 🔴 Are individual test questions copyrightable? Yes, and this was litigated and lost.

The most natural defense — "a single multiple-choice question is too short/functional to be
copyrightable, and we're just teaching from them" — was raised by the Princeton Review in
*Educational Testing Service v. Katzman*, 793 F.2d 533 (3d Cir. 1986), and rejected.

Defendants there argued exactly what a startup would want to argue: (a) ETS's copyrights "do not
extend to individual questions"; (b) the questions "contain material in the public domain or …
reflect ideas and concepts not entitled to copyright protection"; (c) any similarity was
"de minimis or inevitable"; and (d) fair use. The Third Circuit affirmed a preliminary injunction
against Princeton Review on all fronts.

**On fair use specifically, the court's four-factor analysis maps almost point-for-point onto LSAT
Speedrun's situation:**

| § 107 factor | *Katzman* holding | Application here |
|---|---|---|
| 1. Purpose & character | Use was "highly commercial" → against fair use | LSAT Speedrun would be a commercial product. Same posture. Not transformative: serving LSAT questions as LSAT practice questions is the *identical* use LSAC makes of them. |
| 2. Nature of the work | "the unique nature of secure tests means that **any** use is destructive of ETS' rights" | Weighs against. Note the disclosed-test wrinkle in §2.2 below. |
| 3. Amount & substantiality | Copying "not insubstantial" even though not verbatim throughout | 🔴 Worse here: **6,886 items, 100% verbatim, ~85 complete administrations.** This is not "some questions," it is the corpus. |
| 4. Market effect | Copying "rendered the materials worthless to ETS" | 🔴 Worse here. LSAC has an **actual, priced, functioning license market** for exactly this use. Displacing a real licensing market is the strongest possible showing of factor-4 harm. |

The court also quoted *ETS v. Mikaelian*, 571 F. Supp. 148, 153 (E.D. Pa. 1983): *"The very purpose
of copyrighting the … questions is to prevent their use as teaching aids, since such use would
confer an unfair advantage to those taking a test preparation course."*

**Strong inference:** a fair use defense for serving these items as commercial LSAT practice is very
weak. Factor 4 alone is close to dispositive given that LSAC sells this exact license at a published
price (§4).

## 2.2 ⚪ One honest nuance: "secure tests" vs. "disclosed tests"

*Katzman* and *Mikaelian* both involved **secure** (unreleased) test forms — in *Katzman*, literally
stolen ones. The items in this question bank are from **disclosed** PrepTests, which LSAC
deliberately publishes and sells. So factor 2's "any use is destructive" reasoning does not transfer
cleanly: LSAC's whole business model for these items *is* to release and license them.

I want to be fair about this: **it is the one factor where LSAT Speedrun's facts are meaningfully
better than *Katzman*'s.**

But it helps far less than it sounds, for two reasons:
1. Factor 2 is historically the least important fair use factor.
2. The improvement on factor 2 makes **factor 4 worse**. The reason LSAC discloses these tests is to
   sell and license them. A competing free/cheap copy directly substitutes for LawHub Advantage
   ($124/yr) and undercuts the $38/student coaching license. LSAC pleaded exactly this in the Chatty
   Courses complaint: unauthorized use "erodes LSAC's ability to negotiate with other actual and
   potential licensees and preserve its licensing business model."

There is also a **compilation** layer: even if one argued about individual items, LSAC holds
copyright in each PrepTest as a compilation, and this bank reproduces ~85 of them essentially whole.

## 2.3 🔴 LSAC's actual enforcement record — and it is much more aggressive than expected

This was the most surprising and most important part of the research. **LSAC is actively litigious,
uses AmLaw-100 counsel, and has specifically sued a solo-developer AI LSAT app.**

### *LSAC v. Chatty Courses, Inc., Mun Dot So, Inc., and Ozgur Dogan Ugurlu* — the near-exact analogue

E.D. Pa. No. 2:24-cv-06905 (filed Dec. 31, 2024). **Read the full complaint.** The facts are
uncomfortably close to LSAT Speedrun's:

- Defendant was **one software engineer** operating "AI Tutor for LSAT" / "LSAT-GPT" / "AI Assistant
  for LSAT" via a website and a Chrome extension.
- **The app did not even host LSAT items itself.** It instructed users to *"[c]opy/paste an LSAT
  question with answer here"* or *"[u]pload an LSAT question screenshot,"* and relayed that content
  to OpenAI. LSAC sued for **direct** copyright infringement (display/reproduction/derivative works)
  *and* **contributory/vicarious** infringement for inducing users to copy.

  🔴 **LSAT Speedrun's exposure is strictly worse.** It ships 6,886 items in its own database and
  serves them directly. Every theory LSAC pleaded against Chatty Courses applies here with fewer
  intermediate steps.

- **Timeline — this is the number to internalize:**

  | Date | Event |
  |---|---|
  | ~Apr 23, 2024 | Chatty Courses begins operating |
  | Jun 27, 2024 | Ugurlu creates free LawHub account, accepts LawHub Terms |
  | Sep 11, 2024 | Buys LawHub Advantage, accepts Terms again |
  | Sep 19, 2024 | **Emails LSAC asking to buy a license** |
  | Oct 11, 2024 | LSAC counsel (Alston & Bird) sends cease-and-desist |
  | Oct 22 / Nov 13, 2024 | Two more C&D letters |
  | Dec 31, 2024 | Complaint filed — **~8 months after launch** |
  | Feb–May 2025 | Consent judgment process |
  | **May 7, 2025** | **Final judgment entered for LSAC** on breach of contract, federal copyright infringement, federal trademark infringement, PA common-law unfair competition, and federal unfair competition |

- 🔴 **LSAC sought and pursued personal liability against the individual founder**, pleading that he
  was "the moving, active, conscious force" behind the infringement, and pleading **alter ego /
  veil-piercing** in the alternative. Incorporating an LLC would not have protected him.

- 🔴 **The license inquiry became evidence against him.** LSAC's complaint quotes Ugurlu's own
  September 25, 2024 email — *"we … want to use LSAC's copyrighted LSAT questions to help students
  prepare for the exam"* — and uses the Sept. 19 and Sept. 25 contacts to establish that Defendants
  "were aware of LSAC's … Copyrighted Works," supporting the **willfulness** allegations. It also
  used his signing up for a LawHub account to create **contract** claims and a **Pennsylvania forum
  selection clause**, which is how a California defendant ended up litigating in E.D. Pa.

  **This is the single most actionable lesson in this entire memo.** See §7.4 — you must do
  remediation *before* you contact LSAC, not after.

- Relief sought included statutory damages "**up to $150,000 per work infringed**," treble damages,
  disgorgement of profits, attorneys' fees, and a permanent injunction plus a sworn compliance report.

### *LSAC v. TestMax, Inc.* — LSAC sues even its own licensees

E.D. Pa. No. 2:26-cv-00351 (filed Jan. 20, 2026), counsel Ballard Spahr + Alston & Bird. TestMax
operates **LSATMax**, an established prep company. LSAC alleges unpaid license fees across three
successive Content License Agreements ($40,319 + $95,758 + $34,080 = **$170,157**), termination of
the 2024 CLA after a 30-day cure period, and continued use of LSAC trademarks post-termination.
Reported by Law360 on July 7, 2026, so it is live as of this writing.

**Two things this tells us.** First, LSAC monitors, invoices, chases, terminates, and sues — the
licensing program is administered with real rigor. Second, the complaint is a goldmine: it **quotes
the actual License Agreement terms**, which no public LSAC page discloses. See §4.4.

## 2.4 🔴 Does "the dataset says MIT" help? No. Here is the clear answer you asked for.

Three separate reasons, in descending order of importance:

**(1) The premise is false at the layer you consumed.** `tasksource/lsat-lr` and `tasksource/lsat-rc`
declare **no license whatsoever** — no tag, no LICENSE file, no terms in the card. There is nothing
to rely on. "No license" is the default state of "all rights reserved," not a grant.

**(2) Even the MIT file upstream conveys nothing.** *Nemo dat quod non habet* — you cannot give what
you do not have. The AR-LSAT authors scraped LSAC's booklets; scraping creates no ownership. An MIT
LICENSE file operates only on rights the licensor actually holds. Since they held none in LSAC's
items, they transferred none. There is no "innocent downstream licensee" doctrine in U.S. copyright
that cures this. Copyright infringement is a **strict liability** tort: intent is not an element.

**(3) It is not even a good-faith-reliance story on these facts.** This repository's own
`backend/data/question_bank/README.md` already states that "The upstream dataset cards do not
currently declare a license" and warns to confirm rights "before distributing or commercializing
this material." That is a written internal acknowledgment that the rights question was open.

**Where the license tag *does* matter: willfulness.** This is genuinely important and worth
understanding precisely. Under 17 U.S.C. § 504(c):
- Ordinary statutory damages: **$750–$30,000 per work.**
- **Willful** infringement: up to **$150,000 per work.**
- **Innocent** infringement (infringer "was not aware and had no reason to believe" it was
  infringing): court *may* reduce to as low as **$200 per work.**

A plausible good-faith belief based on an upstream permissive license is the kind of thing that
argues against willfulness and toward the low end. But note how LSAC litigates: in *Chatty Courses*
it built a paragraph-by-paragraph record of when the defendant "was aware of LSAC's … Copyrighted
Works." **Every day you continue after reading this document is a day that argument gets weaker.**

**Also note the "research dataset provenance" defense specifically.** I found no case holding that
obtaining infringing content from an academic dataset immunizes commercial redistribution, and the
structure of copyright law suggests it would not. The § 107 preamble protects "scholarship, or
research" — the *researchers'* use, arguably. It does not launder the content for a downstream
commercial reseller, whose own purpose is squarely commercial. The AI-training fair use cases
(*Bartz v. Anthropic*, *Kadrey v. Meta*, both N.D. Cal. 2025) are also a poor fit: whatever those
say about *training*, this app does not train on the items — **it serves them to users as the
product**, which is verbatim public distribution, not an intermediate technical use. See §6.5.

## 2.5 🔴 Paraphrasing does not fix this

Rewriting the items to avoid verbatim copying is a natural instinct and it does not work:

- 17 U.S.C. § 106(2) reserves to the owner the right to prepare **derivative works** — a work "based
  upon" the original. A paraphrase of a copyrighted argument stimulus is a textbook derivative work.
- LSAC pleaded derivative-work infringement in *Chatty Courses*, and won.
- The relevant test is **substantial similarity of protected expression**, not literal identity.
  *Katzman* expressly rejected the argument that "not verbatim" means "not infringing."
- Practically: to keep an LSAT item pedagogically useful you must preserve the argument structure,
  the flaw, the answer choices' relationships, and the trap logic. That *is* the protected expression.
  The more useful your paraphrase, the more infringing it is.
- 🔴 An AI-paraphrasing pipeline is arguably **worse than doing nothing**, because it creates a
  documented process of copying-then-altering, which reads as consciousness of guilt.

The only genuinely safe version is **independent creation** — new items written (or generated) from
scratch, without the LSAC items present as source material. See §6.

---

# 3. Copyright duration: is anything in the public domain?

## 3.1 🔴 The definitive answer: No. Not one item in this question bank, and not one LSAT item ever written.

**For the actual corpus (1991–2016), this is not close.** LSAT items are works made for hire
authored by LSAC's staff item writers. Under **17 U.S.C. § 302(c)** (text verified at Cornell LII):

> "In the case of an anonymous work, a pseudonymous work, or a work made for hire, the copyright
> endures for a term of **95 years from the year of its first publication, or a term of 120 years
> from the year of its creation, whichever expires first.**"

| Item vintage in this bank | Earliest possible expiry (95 yrs from publication) |
|---|---|
| June 1991 (oldest, `199106`) | **2086** |
| December 2016 (newest, `201612`) | **2111** |

The oldest item in this app is protected for another **60 years**. There is no theory on which any
of it is public domain.

## 3.2 ⚪ And the very oldest LSAT items (1948 onward) are not public domain either

The general U.S. rule as of 2026: published works enter the public domain 95 years after
publication, so works published **1930 and earlier** are free. The LSAT was first administered in
**1948** — LSAC's own trademark filings assert continuous "LSAT" use in commerce since 1948 (pleaded
in both complaints). **1948 + 95 = 2044** is therefore the theoretical earliest date any LSAT
content could fall out of copyright, and only for the very first administration.

⚪ **A caveat I'll flag honestly rather than paper over.** Pre-1978 works had formalities (notice,
renewal) whose absence could forfeit copyright, so *in principle* some 1948–1963 LSAT material could
have lapsed. I did **not** verify LSAC's renewal filings for mid-century LSATs, and I'd treat any
such theory as unverified and commercially useless anyway:

1. Those items were almost certainly distributed as **secure test forms under restriction**, which
   likely makes them *unpublished* under the limited-publication doctrine — unpublished works escape
   the notice/renewal formalities entirely.
2. Even if a 1950s form were public domain, you would need a physical copy from a non-infringing
   source, and it would be pedagogically useless: the LSAT of that era bears little resemblance to
   the modern test, and the current test (post-August 2024) is two scored Logical Reasoning sections
   plus one Reading Comprehension section.
3. It does nothing about the 6,886 items you actually have.

**Bottom line: "wait for the copyright to expire" and "find public-domain LSAT items" are both
non-strategies.**

---

# 4. LSAC's licensing program — this is the most important section

## 4.1 🟢 The single best finding in this research: LSAC runs a public, published, self-serve-priced licensing program, and small startups get in.

The founder's framing assumed getting a license would require "a stronger pitch." **That assumption
appears to be wrong, and this reframes the whole decision.** LSAC is not a gatekeeper handing out
rare partnerships to companies that impress it. It runs what is effectively a **standard commercial
licensing program with a published rate card and an email address.**

From LSAC's own licensing page (verified against a May 2024 Wayback capture; the same figures appear
in current 2026 search-engine retrievals of the live page):

| License type | What you get | **Published fee** |
|---|---|---|
| **Coaching** | "Use official LSAT questions and disclosed tests in your prep offerings. Link to LawHub's authentic LSAT test interface." Works in conjunction with student LawHub participation. | **$38 per student** (nonprofits: **$19/student** if prep is free to the student) |
| **Public Marketing** | One full test (June 2007) + assorted PrepTest 65 questions, usable in public marketing/website | **$5,000 per year** |
| **Book Publishing** | Disclosed items or full PrepTests in commercially sold books | Fees based on item/test usage |

**Contact: `licensing@LSAC.org`** (for-profit) / `ambassadors@LSAC.org` (nonprofit).

Three observations that matter enormously:

1. **There is no minimum commitment published, and the unit is per-student.** A $38-per-student fee
   means a company with 10 students owes $380. This is not a six-figure enterprise deal — it is
   priced for small operators. I found no published minimum, floor, or volume commitment.
2. **The pricing has been stable for at least two years** (identical in the May 2024 archive and in
   2026 retrievals), which suggests a standardized program, not bespoke negotiation.
3. **The program is a volume business, not an exclusive club.** The LawHub Marketplace lists dozens
   of licensees; the alphabetical first page alone runs from 7Sage through Apollo Test Prep.

## 4.2 🟢 Who holds licenses — including companies that look exactly like LSAT Speedrun

The LawHub Marketplace page server-renders structured records for each licensee. Parsing them yields
fields LSAC does not display in the UI, including a `vendorId` whose suffix encodes the onboarding
year, and an `apiAccessEnabledFor` flag.

| Vendor | Vendor ID | Type | API access | Licensed products |
|---|---|---|---|---|
| 7Sage | `7SG2020` | For-Profit | Production + Integration | Free Sub, Premium Sub, 1yr Coaching License |
| Access Prep | `AXS2022` | For-Profit | — | Free, Premium, 1yr Coaching |
| **AdeptLR** | `ADT2020` | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |
| **Admit Law** | **`ADL2026`** | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |
| Admit Master | `AMT2021` | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |
| Advantage Testing | `AT2020` | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |
| AlphaScore | `ALP2021` | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |
| Apecs Tutoring | `APX2023` | For-Profit | — | Premium, 1yr Coaching |
| Apex Pre-Law Services | `APL2022` | For-Profit | — | Free, Premium, 1yr Coaching |
| Apollo Test Prep | `APO2022` | For-Profit | Production + Integration | Free, Premium, 1yr Coaching |

*(These are the ten alphabetically-first licensees, the only ones server-rendered; the full list is
loaded client-side and is longer. Onboarding years are my decoding of the vendorId suffix — strong
inference, not stated by LSAC.)*

🟢 **Two of these are the founder's answer:**

- **`ADL2026` — Admit Law was onboarded as a licensee in 2026, i.e., this year.** LSAC's own
  description of it: *"Admit Law helps LSAT students drill smarter with licensed practice, analytics,
  blind review, pacing tools, and personalized recommendations that identify why performance breaks
  down and route students to the practice they need most."* Read that again and compare it to LSAT
  Speedrun's pitch. **That is the same product, and it got a license this year.**
- **AdeptLR** — *"a platform for adaptive drilling. Using our proprietary algorithm, it delivers
  personalized drill sets that adjust to each user's performance."* Also the same product.

And **LSAT Demon** is the scale proof: per third-party reporting, roughly **2–10 employees and under
$5M revenue**, built entirely on licensed official items ("All 81 released exams," "no
Demon-written practice questions"), with founders who are open that they consider unofficial
questions actively harmful. A two-person company holds this license.

**The question "do we have a strong enough case to get a license?" is, on this evidence, the wrong
question.** The right questions are "can we comply with the license terms?" and "does the unit
economics work at $38/student plus a mandatory $124 student LawHub subscription?"

## 4.3 🟢 How the licensed model actually works architecturally

This is the part that determines whether LSAT Speedrun can adopt it. Since **August 4, 2020**, LSAC
has required a two-sided arrangement, confirmed independently by 7Sage, Blueprint, Kaplan, and LSAT
Demon:

```
   STUDENT                                    YOU (licensee)
      │                                            │
      ├── buys LawHub Advantage from LSAC ($124/yr)│
      │   (or bundles it through you at checkout)  │
      │                                            │
      └── links their LSAC account ────────────────┤
          to your platform as their "coach"        │
                                                   ├── pays LSAC $38/student/yr
                                                   │   Coaching License Fee
                                                   │
                                                   ├── serves official items
                                                   │   IN YOUR OWN UI
                                                   │   (gated on active link)
                                                   │
                                                   └── LawHub Provider Portal
                                                       + API integration for
                                                       student performance data
```

Verified specifics:
- **7Sage:** *"LSAC requires that every student who wants to use a prep course that uses real LSAT
  questions must have an active LSAC LawHub Advantage subscription. That includes us, 7Sage, and any
  other LSAT prep course that uses real LSAT questions."* Unlinked accounts see: *"Sorry, your
  account must be linked to an active LSAC LSAT LawHub Advantage account to access licensed
  materials."* 7Sage gives new students a 24-hour grace window while they sort out linking.
- **Blueprint:** *"Because we use official LSAT questions in our Blueprint course, all students must
  pay for the LSAT LawHub Advantage license."* Blueprint dates the requirement to **August 4, 2020**.
- **Kaplan:** "LSAT Link Integration with access to 59 official practice tests via LSAC's LawHub
  Advantage," "Nearly 6,000 official LSAT exam questions."
- **One subscription covers all providers** — students can link the same LawHub Advantage to multiple
  prep companies. So it is not a per-vendor tax on the student.

🟢 **Critically: licensees serve the items inside their own interface.** LSAT Demon's marketing
describes drilling official questions in its own UI with its own filters, tagging by PrepTest origin,
difficulty stars, and question subtype. 7Sage does the same. **This means LSAT Speedrun's core
product — a fast, gamified drilling loop over the official item bank — is fully compatible with the
license.** You are not forced to iframe LawHub or link out. You must gate on the student's linked
subscription.

**The technical path exists and is documented.** From LawHub's "Work With Us" page, licensees get:
- Use of officially licensed LSAT content including real questions
- Use of LSAC trademarks (including "LSAT") under the Content and Trademark Use Guidelines —
  ⚪ *note: without a license you cannot legitimately use "LSAT" in your product name or marketing;
  this is a separate Lanham Act exposure from the copyright issue, and it's the claim LSAC won on
  against both Chatty Courses and TestMax*
- A **listing on LawHub Marketplace** (i.e., LSAC-driven customer acquisition)
- **LawHub Provider Portal** with student performance reporting, plus **API integration** for data
  exchange. The marketplace records confirm two environments — `Integration` (sandbox) and
  `Production` — with per-vendor `clientId` / `integrationClientId` credentials.
- Participation in LSAC Law School Forums and the **virtual Test Prep Vendor Fair**

## 4.4 🔴 The license terms you would actually be signing — and where LSAT Speedrun currently conflicts

LSAC does not publish the Content License Agreement. But the *TestMax* complaint quotes and
characterizes it extensively, which is the best public window into the real terms:

| Term (from LSAC's pleading) | Implication for LSAT Speedrun |
|---|---|
| Fee components: **Coaching License Fee, Student Subscription Fee, Processing Fee, Marketing License Fee, Book Publication Fee** | The public "$38/student" is the Coaching fee. There are additional fee lines. Budget above the headline number. |
| "Licensees may use LSAC content **solely to prepare students for the LSAT, and only for students who have an active student subscription**" | Hard-gate every item behind a verified LawHub Advantage link. No public demo of real items. No free tier that serves official content. |
| "Licensees are **prohibited from creating derivative works, modifying, translating, and/or otherwise altering** LSAC content. All LSAT items used in courses **must be used verbatim in English, without modification or editing, except for symbolization**" | 🔴 **This constrains the AI features.** Rewriting stems, generating variants, auto-simplifying, or translating items would breach. Explanations *about* an item are fine; altering the item is not. Check any AI feature that rewrites question text. |
| "Licensees are **expressly prohibited from replicating or mimicking** [the Digital LSAT] interface" | 🔴 Do not clone LawHub's look. Your own distinct UI is required — which, fortunately, is what a gamified speedrun app wants anyway. |
| Security: "safeguarding content from unauthorized reproduction, distribution, or disclosure and **maintaining content in a secure, encrypted environment**" | 🔴 **Direct conflict today.** The items currently sit as plaintext JSONL in `backend/data/question_bank/` inside the source repository. Under a license this would be a material breach. Content must move to encrypted at-rest storage, out of the repo, ideally fetched at runtime. |
| Confidentiality of test content and LSAC business information | No public dumps, no committing items to a public repo, no shipping them in a client bundle. |
| **LSAC reserves the right to audit licensees for compliance** | Assume you will be inspected. |
| Termination: LSAC may terminate on notice for material breach; **30-day cure period**; on termination all rights and all trademark use cease immediately | Non-payment is an existential risk — see TestMax. |
| Governing law **Pennsylvania**; exclusive jurisdiction in PA state/federal courts; LSAC entitled to injunctive relief | You will litigate in Pennsylvania regardless of where you are. |
| Late fee **1.5%** plus collection costs and attorneys' fees | — |
| Grant is "non-exclusive, worldwide, and limited in scope" | — |

## 4.5 ⚪ What a license actually costs at scale — a real data point

The TestMax complaint gives the only concrete licensee-spend figures I could find anywhere:

| Agreement year | Amount TestMax owed LSAC |
|---|---|
| 2020 CLA (unpaid as of Jun 2023) | $40,319 |
| 2023 CLA (unpaid as of Jun 2024) | $95,758 |
| 2024 CLA (unpaid as of Dec 2025) | $34,080 |
| **Total pleaded** | **$170,157** |

⚪ **Careful reading:** these are *unpaid balances*, not total annual fees, so they are lower bounds
on TestMax's annual obligation. Still, $95,758 at $38/student implies on the order of **2,500
students/year** for an established national brand. Scaling down: a startup with 100 paying students
in year one owes LSAC roughly **$3,800**.

**Realistic cost/timeline for a small startup (my synthesis, labeled as inference):**
- **Fee:** ~$38/student/year, plus likely a processing fee and $5,000/yr *only if* you want to show
  real items in public marketing. A pre-revenue launch could plausibly start under $5,000 all-in.
- **Timeline:** unverified. No public source states how long onboarding takes. The existence of
  `ADL2026` proves the pipeline is currently open and producing new licensees in 2026. My estimate,
  based on the fact that this is a standard-form contract with published pricing rather than a
  bespoke partnership: **weeks to a few months**, dominated by contract review, security/compliance
  attestation, and API integration work. **It will not be done in 1.5 weeks.** Treat that as the
  binding constraint.
- **Qualification requirements:** not published. Inference from the licensee roster (which includes
  one-person tutoring shops alongside Kaplan) is that the bar is low — a real business entity,
  ability to pay, agreement to the security and use restrictions. I found **no** evidence of a
  minimum size, revenue, or curriculum-quality gate.

## 4.6 🟢 Lower-tier options for a small startup

Yes, several — this is better than expected:

1. **Coaching license at low volume.** The per-student structure *is* the low tier. There is no
   published minimum. This is the main answer.
2. **Nonprofit rate — $19/student**, if prep is provided at no cost to the student. If part of the
   product is a genuinely free access-focused offering under a nonprofit entity, this halves the
   rate and aligns with LSAC's mission (§7.1).
3. **LawHub Marketplace listing.** Per "Work With Us," you can *"Add your products and services to
   LawHub Marketplace"* — this is listed as a separate offering from content licensing. ⚪ Whether a
   non-licensee can list a non-content product here is **unverified**; the current Marketplace page
   is framed as "Official LSAT Content Licensees."
4. **Link-out / bring-your-own-LawHub model.** Build the coaching, analytics, spaced repetition,
   scheduling, and explanation layer, and have students take official material in LawHub, importing
   results. **7Sage already ships exactly this as "LawHub auto-import."** ⚪ Whether *importing
   results* without displaying item text requires a license is unverified and I'd ask counsel — 7Sage
   is a licensee, so their doing it proves nothing about non-licensees.
5. **Fee-waiver alignment.** LSAC fee-waiver recipients get LawHub Advantage free, and LSAC notes
   many licensees offer them free or discounted courses. Offering this is cheap goodwill.

⚪ **What I could not find, despite looking:** any published revenue-share arrangement, any affiliate
program paying commission on LawHub Advantage referrals, any free/evaluation tier of the content
license, or any startup-specific program. If these exist they are not public. Ask
`licensing@LSAC.org` directly.

---

# 5. What LSAC gives away free, and what you may legitimately build on

## 5.1 ⚪ The free tier is real but small, and it is not a content source

With a **free LawHub account** (no payment), a student gets:
- **Four full-length official PrepTests** — currently PrepTests **140, 141, 157, and 158**, all in the
  post-August-2024 four-section format
- Both self-paced (untimed) and simulated-exam (timed) modes in the authentic digital interface
- Instant scoring and answer review
- **Answer rationales** for the free PrepTests (added mid-2024)
- The migrated **Khan Academy** library: 100+ lessons and videos, ~100 explanatory articles, and
  practice drill sets
- An LSAT Argumentative Writing practice prompt

**LawHub Advantage ($124/yr; $115 at some price points; rising from $120 to $124 as of July 1, 2026)**
adds ~54 more full PrepTests, for roughly 58 total.

⚪ Note also: **LSAC fee-waiver recipients get LawHub Advantage free for a year.**

## 5.2 🔴 But "free to the student" is not "free for you to redistribute"

I read the **LawHub Terms and Conditions** in full. They are unambiguous, and they close the door on
every clever workaround:

> "the entire contents of the Official LSAT Prep and/or LawHub Advantage subscription, both the
> content that is visible to the User and the software supporting it, are copyrighted by LSAC.
> **Unauthorized reproduction or distribution of any contents … are strictly prohibited.** The
> subscription materials and contents **may be used only for purpose of preparing for the LSAT**."

> "The content shared on LawHub as part of the User's 'Official LSAT Prep' subscription **may only be
> used by the User** for the purpose of preparing for the LSAT."

> "**Users are prohibited from downloading copyrighted material** and are explicitly prohibited from
> modifying the Contents in any way… The User **may not copy, store (either in hard copy or in
> electronic format), transmit, transfer, perform, broadcast, publish, reproduce, create a derivative
> work from, display, distribute, sell, offer for sale, license, rent, lease, frame, deep link to, or
> otherwise use the Contents in any manner inconsistent with the rights of LSAC, including … any use
> of the Contents for any commercial purpose.**"

Practical consequences, several of which are counterintuitive:

- 🔴 **You personally cannot legally harvest the free PrepTests** to seed a product. That is exactly
  what Chatty Courses' founder did (free account June 27, 2024; LawHub Advantage September 11, 2024),
  and it converted a pure copyright case into a **breach of contract** case with a
  **Pennsylvania forum selection clause** — which is how a California defendant ended up in E.D. Pa.
- 🔴 **"Deep link to" is expressly prohibited.** So even the seemingly safe "link out to LawHub"
  strategy has limits: linking to LawHub's homepage or a generic prep page is fine (LSAC actively
  wants that), but constructing deep links into specific content is not.
- 🔴 **"Frame" is prohibited** — no iframing LawHub inside your app.
- ⚪ **The LSAC Terms & Conditions of Use are incorporated by reference** and limit site usage to
  "noncommercial use."
- ⚪ **Governing law and venue: Bucks County, Pennsylvania**, exclusive.
- ⚪ Users **indemnify LSAC** against third-party claims arising from their use.
- ⚪ LSAC "reserves the right to prosecute copyright infringements of any content found in or
  associated with LawHub."

**What you *can* legitimately build around the free tier:** everything that is not LSAC's content.
A study planner, a scheduling and spaced-repetition engine, score tracking where the *student*
enters their own results, motivational/gamification layers, your own written strategy content, and
links to LawHub's public pages. That is a real product — it is just not a question bank.

---

# 6. The alternative: original or AI-generated items

## 6.1 🔴 The uncomfortable market truth: almost nobody does this in LSAT prep, and that is not an accident

I went looking for successful LSAT companies built on original items. In the established market, they
essentially do not exist. **Every major LSAT prep company licenses official content:**

| Company | Content model | Verified |
|---|---|---|
| 7Sage | Official, licensed; requires student LawHub Advantage | Yes |
| Blueprint | Official, licensed; "all students must pay for the LSAT LawHub Advantage license" | Yes |
| Kaplan | Official, licensed; "Nearly 6,000 official LSAT exam questions," LSAT Link integration | Yes |
| Princeton Review | Official, licensed via LawHub | Strong inference (review sites) |
| Magoosh | Official, licensed — *"By permission of the Law School Admission Council (LSAC®), Magoosh is pleased to be one of the most recommended … providers to use official LSAC questions"* | Yes (own site) |
| LSAT Demon | Official, licensed; **"There are no 'Demon-written' practice questions,"** a deliberate stance | Yes |
| PowerScore | Official, licensed (books contain real items) | Strong inference |
| LSATMax / TestMax | Official — *was* licensed; license terminated Dec 12, 2025; now being sued | Yes |

One reviewer's summary captures it: *"Magoosh uses nothing but official, past LSAT exams … **this is
not novel in the LSAT test prep space today as almost every LSAT prep company uses real LSATs.**"*

## 6.2 🔴 Student sentiment is actively hostile to unofficial questions

This matters more for LSAT than for almost any other test, and it is a genuine commercial risk to
option (c). From the 7Sage community forums (real students, primary source):

> *"I'm not using any of these test prep books because of what I've read on law school forums about
> how they're not very helpful and not 'actual' LSAT questions."*

> *"there's simply no need to use made-up questions when you don't have to … why risk using a flawed
> question when you have over 7000 real questions right at your fingertips."*

> *"[unofficial] 'methods' … are sub-par on many occasions and will ingrain faulty technique in you.
> Not the best thing to have going into a test that will pretty much decide how the rest of your life
> will be in large part."*

LSAT Demon's founders — who have every commercial incentive to sell you their own content — market
the *opposite*, arguing that **"fake questions train fake habits."**

⚪ The structural reason: LSAC has released ~90 tests, so a diligent student can access **7,000+ real
items**. Contrast the medical or professional-certification markets, where official items are scarce
and original content is the norm. **In LSAT prep, official items are abundant, cheap ($124/yr for
~58 tests), and universally available. Original content isn't a differentiator — it's a handicap
you'd have to explain away on your pricing page.**

## 6.3 🟢 That said, a 2026 cohort of AI-first startups is testing exactly this thesis

There is a live, unproven, but real experiment happening right now:

- **Premier Exam Prep** — the closest comparable to option (c). Claims **2,400+ original items**
  (1,650 LR drills, 608 RC drills, 2 full tests), *"written in the style of the current LSAT and
  checked by an independent reviewer,"* explicitly **"Nothing is recycled from official tests."*
  Free during early access; AI tutor as a $29/mo add-on. They also built a replica of LSAC's
  **August 2026** platform UI — ⚪ note that mimicking the interface is precisely what LSAC's license
  forbids licensees from doing, so this is an interesting (and possibly risky) posture for a
  non-licensee.
- **PrepEngine Academy** — 400+ items, *"AI-generated, then reviewed and refined."* $25/mo.
- **AccelaStudy AI LSAT** — fully dynamic generation, *"never see the same test twice."* $129/mo.
- **PDFQuiz** — generates items from the user's own uploaded materials. Explicitly states it *"does
  not reproduce real LSAT questions"* and should be used *"alongside official LSAC PrepTests."*
- **LexPrep** — AI-first, but advertises *"official LSAT PrepTests 101–158."* ⚪ **Whether LexPrep
  holds a license is unverified** — I could not confirm it on the (partial) marketplace list I was
  able to extract. If it does not, it is in the same position as LSAT Speedrun.

🟢 **The genuinely useful marketing frame these companies have found:** original items are pitched
not as a substitute for official ones but as a *complement* — *"original drills mean your official
PrepTests stay fresh for full-length rehearsal."* That reframes the weakness (not official) into a
strength (doesn't burn your finite supply of real tests). **If you go the original-content route,
this is the positioning to adopt.** It is honest, it is defensible, and it sidesteps the "your
questions are fake" objection.

## 6.4 ⚪ Note the product-quality wrinkle in the current corpus

Separate from legality: the bank runs **1991–2016**. The LSAT changed materially in **August 2024** —
Analytical Reasoning (Logic Games) was removed, and the scored test is now **two Logical Reasoning
sections plus one Reading Comprehension section**. LSAC also renumbered PrepTests (the current free
ones are 140, 141, 157, 158).

- 🟢 Mildly favorable: the corpus is LR + RC only, which are exactly the two surviving section types,
  and LR is now *more* heavily weighted than before.
- 🔴 Unfavorable: LSAT communities generally consider modern tests (roughly PT 70+, i.e. 2013 onward)
  the most representative. Only about **four years** of this corpus falls in that band, and **none of
  it reflects the post-2024 test.** So even setting rights aside, ~80% of the bank is dated material
  that a knowledgeable student would rank below what LawHub Advantage sells for $124.

**This weakens the "but our content is uniquely valuable" argument in both directions** — it is not
worth the legal risk, and it is not a moat.

## 6.5 ⚪ On AI training specifically

A distinct question worth separating: could you *train or fine-tune* a generator on these items and
ship only the generator's outputs?

- ⚪ The 2025 AI fair-use decisions (*Bartz v. Anthropic*, *Kadrey v. Meta*, both N.D. Cal.) found
  some training uses transformative, **but both turned heavily on the lawfulness of acquiring the
  copies in the first place**, and neither blesses distributing outputs that are substantially
  similar to the training inputs.
- 🔴 If the generator emits items substantially similar to LSAC items, you are back to derivative-work
  infringement regardless of the pipeline.
- 🔴 Retaining the 6,886 items to train on is itself a reproduction. The "acquisition" prong is where
  these cases have gone badly for defendants.
- ⚪ **Unverified but worth flagging:** I did not find any case addressing AI training on
  standardized-test items specifically. Given LSAC's demonstrated willingness to sue an AI tutor
  within eight months of its launch, I would treat this as an area where LSAC would very likely
  litigate rather than acquiesce. Ask counsel before building it.

**The defensible version:** generate items using a model that has *never seen* your copy of the LSAT
corpus, prompted with publicly-describable *specifications* — question types, logical structures,
difficulty targets, LSAC's own published section descriptions — rather than with LSAC items as
examples. Document that pipeline carefully. Unprotectable ideas, methods, and formats are fair game;
LSAC's specific expression is not.

---

# 7. Building the licensing pitch

## 7.1 ⚪ What LSAC actually is, and what it says it cares about

**Verified from LSAC's own site:**
- LSAC is a **not-for-profit** whose mission is *"to advance law and justice by promoting access,
  equity, and fairness in law school admission, to broaden the pathway into legal education, and to
  support law schools, law students, and the legal education community."*
- **President and CEO: Sudha Setty**, effective **July 1, 2025**. Former dean of CUNY School of Law
  and Western New England University School of Law; first South Asian American woman to lead an
  ABA-accredited law school. Her stated focus is *"championing access, equity, and outcomes in legal
  education,"* social justice and public-interest lawyering, and pipeline/pathway programs. She
  succeeded Kellye Testy (who left for AALS); Susan Krinsky served as interim.
- ⚪ **Notably for you: Setty served on the New York State Bar Association Task Force on Artificial
  Intelligence.** She is not naive about AI, in either direction.
- Recent strategic moves (2024–2026): acquisition of **Law School Transparency** and the **Institute
  for the Future of the Law Practice**, both folded into LawHub; launch of the **Legal Education
  Program**, a holistic undergraduate pathway; **Plus, Guided Journey** access program; and the
  **Before the JD II** research study with AALS.

**The pattern across all of these is unmistakable: LSAC is consolidating the prelaw journey onto
LawHub, by acquisition where possible.** The Khan Academy wind-down (§7.2) is the same pattern.

## 7.2 🔴 The Khan Academy precedent cuts *against* a "free access partner" pitch

Because it is the most tempting pitch — "we'll be your free/low-cost access play" — it's important to
know it was tried at scale and ended.

- LSAC and Khan Academy partnered from **June 2018** to provide free Official LSAT Prep, reaching
  "hundreds of thousands of test takers."
- Announced Nov 1, 2023; wound down **June 30, 2024.** Khan Academy retained only videos and articles.
- LSAC's stated rationale: *"When LSAC initially collaborated with Khan Academy … there was no other
  destination available for students to access free LSAT prep."* Now there is — LawHub. LSAC's
  pre-law advising director put it plainly: *"When we partnered with Khan Academy, LawHub didn't
  exist."*
- All of Khan's jointly-developed tools, drills, and rationales moved **into** LawHub.

🔴 **Read that as LSAC's revealed preference: it does not want a third party to own the free-access
relationship with candidates. It wants that relationship itself.** A pitch built on "let us democratize
LSAT prep for you" is pitching something LSAC just spent two years insourcing.

## 7.3 🟢 The honest strategic assessment: you don't need a pitch, you need an application

This is the finding I'd most want the founder to sit with.

**The premise that a license requires a compelling strategic case appears to be false.** LSAC runs a
standardized, published-rate licensing program with an email address, an onboarding pipeline that
produced at least one new licensee in 2026, and a roster that includes one-person tutoring shops
alongside Kaplan. There is no evidence of a qualification bar beyond being a real business that can
pay and comply.

**What LSAC actually needs from you** (inferred from the license terms in §4.4 and the enforcement
record in §2.3):

| LSAC's concern | What you must show |
|---|---|
| Will you pay? | A real entity, a payment method, willingness to be invoiced. TestMax's fate shows non-payment is what gets you sued. |
| Will you leak the content? | Encrypted at-rest storage, access gated on verified LawHub Advantage linkage, no items in your repo or client bundle, audit-readiness |
| Will you alter the items? | Verbatim-only rendering; AI features that *explain* rather than *rewrite* |
| Will you clone their interface? | A visually distinct UI — a gamified speedrun app naturally satisfies this |
| Will you misuse the trademarks? | Compliance with the Content and Trademark Use Guidelines |
| Does this serve candidates? | Fee-waiver discounts; a real pedagogical thesis |

🟢 **And you do have genuine mission alignment worth stating** — briefly, without overclaiming:
- **Affordability.** If LSAT Speedrun is materially cheaper than the $169–$4,000+ incumbents, that is
  directly responsive to LSAC's access mission and to Setty's stated priorities.
- **Fee-waiver support.** LSAC highlights that many licensees offer free or discounted access to fee-
  waiver recipients. Committing to this on day one is cheap and precisely on-mission.
- **The nonprofit rate.** $19/student if prep is free to the student is LSAC telling you exactly what
  behavior it wants to subsidize.
- **A defensible learning-science thesis.** If the companion learning-science review supports the
  high-volume retrieval-practice loop, that is a substantive pedagogical claim, not marketing.

🔴 **What will not work:** equity offers (LSAC is a nonprofit with an established revenue line, not a
venture investor), "we'll grow your market" (LSAC already reaches every test-taker), exclusivity
(the license is expressly non-exclusive), and anything premised on being LSAC's free-prep arm (§7.2).

## 7.4 🔴 THE CRITICAL SEQUENCING WARNING

**Do not email `licensing@LSAC.org` while the infringing items are still deployed or still in the
repository.**

In *Chatty Courses*, LSAC's complaint devotes numbered paragraphs to the defendant's license inquiry
and uses it as proof of knowledge:

- ¶59: *"On September 19, 2024, Ugurlu submitted an email to LSAC indicating that he was interested
  in purchasing a license to LSAC's intellectual property."*
- ¶62: Ugurlu wrote that he *"want[ed] to use LSAC's copyrighted LSAT questions to help students
  prepare for the exam."*
- ¶¶60, 63: *"as of September 19/25, 2024, Defendants were aware of LSAC's … Copyrighted Works."*
- C&D letter followed **22 days** after the first license email.
- ¶99: *"Defendants' copyright infringement has been knowing, willful, and/or intentional."*

**He asked to buy a license and handed them the willfulness element.** The gap between $30,000 and
$150,000 per work in statutory damages is exactly the willfulness finding.

**Correct sequence:**
1. Take the infringing content down. Purge it from the running app, the database, and git history.
2. Document the removal with timestamps.
3. *Then* contact `licensing@LSAC.org` as a clean prospective licensee.
4. Have counsel decide whether and how to disclose the prior use. There are real arguments both ways
   — voluntary disclosure can build goodwill and start the statute of limitations clock, but it also
   creates an admission. **This is a decision for a lawyer, not for you and not for me.**

## 7.5 ⚪ Who to contact and what to send

**Primary:** `licensing@LSAC.org` — LSAC Licensing Team (for-profit entities). This is LSAC's own
published contact for content licensing.
**Secondary:** `ambassadors@LSAC.org` — for nonprofit-track inquiries at the $19/student rate.
**Also:** `LSACinfo@LSAC.org` for general LawHub questions; the LawHub "Work With Us" page has a
"Get Listed on Marketplace" path.
**Watch for:** the **virtual Test Prep Vendor Fair** and LSAC Law School Forums, listed as licensee
benefits — likely the lowest-friction way to meet the licensing team in person.

**Suggested first email — short, transactional, no pitch deck:**

> Subject: Official LSAT Content License inquiry — [Company], LSAT prep platform
>
> Hi — I'm [name], founder of [Company], a [one-line: adaptive LSAT drilling platform focused on
> high-volume retrieval practice for Logical Reasoning and Reading Comprehension].
>
> We'd like to become an Official LSAT content licensee under the Coaching package. Specifically:
> - We'd serve official items in our own interface, gated on each student's active LawHub Advantage
>   subscription, per the standard model.
> - We store content encrypted at rest and can walk through our security architecture.
> - We render items verbatim; our AI features generate explanations, never modified item text.
> - Our interface is visually distinct from the Digital LSAT interface.
> - We'll offer [free/discounted] access to LSAC fee-waiver recipients from launch.
>
> Could you send the current Content License Agreement and let me know the onboarding steps and
> timeline? Happy to get on a call.

Keep the mission language to one sentence. **You are buying a standard product, not pitching a
partnership.** Framing it as a partnership pitch invites scrutiny you don't need.

---

# 8. Risk assessment for launching as-is

## 8.1 🔴 The claims LSAC would bring

Based verbatim on what it pleaded against Chatty Courses and TestMax:

1. **Direct copyright infringement** (17 U.S.C. § 501) — reproduction, distribution, public display,
   and derivative works, for each of ~85 PrepTest compilations
2. **Contributory / vicarious infringement** — if users can copy items out
3. **Federal trademark infringement** (15 U.S.C. § 1114) — 🔴 **if the product name, domain, app store
   listing, marketing copy, or SEO uses "LSAT."** "LSAT Speedrun" contains a registered, incontestable
   mark. This is a *separate* claim that survives even if you removed every question.
4. **Unfair competition / false designation of origin** (15 U.S.C. § 1125(a))
5. **State-law trademark dilution and unfair trade practices** (PA)
6. **Breach of contract** — 🔴 **triggered the moment anyone at the company creates a LawHub account**
   and accepts the Terms. Also imports the **Bucks County, PA** forum selection clause.

## 8.2 🔴 Damages exposure

**Statutory damages, 17 U.S.C. § 504(c):**

| Scenario | Per work | ×85 PrepTests (illustrative) |
|---|---|---|
| Innocent infringement | as low as $200 | $17,000 |
| Ordinary | $750 – $30,000 | $63,750 – $2,550,000 |
| **Willful** | up to **$150,000** | up to **$12,750,000** |

⚪ **Important caveat on "per work,"** because the number changes by orders of magnitude: under
§ 504(c)(1) all parts of a compilation count as **one work**. LSAC would likely argue each registered
PrepTest is one work (~85 works), not each of 6,886 items. LSAC pleaded "up to $150,000 per work
infringed" without specifying. **Even the conservative reading is company-ending for a startup.**

Also available: actual damages plus infringer's profits (§ 504(b)); Lanham Act **treble damages** and
disgorgement (§ 1117); **attorneys' fees** under both statutes; permanent injunction; and a sworn
compliance report.

🔴 **Personal liability is not theoretical.** LSAC pleaded that the individual founder was "the
moving, active, conscious force" behind the infringement and pleaded **alter ego / veil-piercing** in
the alternative. An LLC is not a shield here.

## 8.3 🔴 Likelihood of enforcement: high, and this is where intuition fails

The instinct that "LSAC won't bother with a tiny startup" is **directly contradicted by the evidence.**

- Chatty Courses was **one engineer with a Chrome extension** who didn't even host the questions.
  LSAC sued him personally, in Pennsylvania, using **Alston & Bird**.
- Detection took roughly **six months** from launch to first C&D.
- LSAC's own pleading explains *why* it must enforce against small players: unauthorized use "erodes
  LSAC's ability to **negotiate with other actual and potential licensees and preserve its licensing
  business model**." 🔴 **A free/cheap unlicensed competitor is the single most damaging thing to a
  per-student licensing program.** Every licensee paying $38/student is a reason LSAC must sue you.
- LSAC even sues **its own licensees** over $170k (TestMax).
- Detection is easy: your marketing must say you have official LSAT questions, or nobody buys. Your
  own SEO is the discovery mechanism. Reddit's LSAT community would surface you within weeks.

**My assessment: if LSAT Speedrun launches publicly with these items and gets any traction at all,
a cease-and-desist is likely within roughly 3–9 months.** Traction is the trigger. That is a
strong inference from a one-case pattern plus LSAC's stated posture — not a certainty — but the
direction is not in doubt.

## 8.4 ⚪ What mitigations actually work

| Mitigation | Does it work? |
|---|---|
| Launch free / non-commercial | 🟡 **Partially.** Removes the "highly commercial" fair-use factor-1 problem and reduces damages. But *free* is arguably **worse** on factor 4 — a free substitute for a $124 product is maximum market harm. And it does not make the use non-infringing. Reduces exposure; does not eliminate it. |
| Paraphrase / AI-rewrite the items | 🔴 **No.** Derivative works. Likely *increases* willfulness evidence. See §2.5. |
| Attribute LSAC / add a disclaimer | 🔴 **No.** Attribution is not a defense to copyright. A disclaimer may slightly help the trademark claim; it does nothing for copyright. |
| Rename to remove "LSAT" | 🟢 **Yes, for the trademark claims specifically** — and it's cheap. Does nothing for copyright. Note nominative fair use permits truthful references ("prep for the LSAT"), but not use as your brand. |
| Rely on the MIT license upstream | 🔴 **No.** See §2.4. May help on willfulness only. |
| Geo-block outside the US | 🔴 **No.** LSAC is a U.S. entity, your users are U.S. |
| Use only a small subset of items | 🟡 Marginally. Reduces the "amount and substantiality" factor and the per-work damages multiplier. Still infringement. |
| Take it down and switch to original items | 🟢 **Yes — this is the real mitigation.** |
| Get a license | 🟢 **Yes — this is the actual solution.** |

⚪ **On DMCA takedown:** a § 512(c) takedown to your host is the *cheapest* thing LSAC can do and
would likely come first or alongside a C&D. Note that DMCA safe harbor **does not apply to you** —
§ 512(c) protects platforms hosting *user-uploaded* content. You uploaded these yourself. You are the
direct infringer, not a service provider.

⚪ **On statute of limitations:** civil copyright claims run three years from accrual
(17 U.S.C. § 507(b)), but each new act of distribution can restart the clock. Continuing to serve the
items keeps the exposure fresh indefinitely.

## 8.5 🔴 Immediate hygiene issues in the current repository

Independent of the launch decision, four things are true right now:

1. 🔴 **The repository is PUBLIC and the entire question bank is anonymously downloadable.** Verified:
   the GitHub API reports `"private": false, "visibility": "public"` for
   `github.com/nischayhegde/LSATspeedrun`, and
   `raw.githubusercontent.com/.../backend/data/question_bank/lsat-lr/train.jsonl` returns **HTTP 200,
   4,178,746 bytes** to an unauthenticated request. The repo has been public since **2026-07-17**;
   the bank was committed **2026-07-22**.

   This is **worse than the app**. It is bulk, worldwide, free redistribution of ~85 complete
   PrepTests in the most reusable possible form — plain text, machine-readable, with answer keys.
   It is the clearest possible case of market substitution for LawHub Advantage, and it is
   discoverable by anyone who searches GitHub for "LSAT." **Make the repo private today.**

2. 🔴 **The commit message is `"Archive complete LSAT question bank"`** (`1576bb3`). Commit messages
   are discoverable and are read aloud in depositions. This one accurately describes the act.

3. **They are in git history.** Making the repo private is the tourniquet, not the cure. Deleting the
   files does not remove them from history. Purging requires history rewriting (`git filter-repo` or
   BFG) plus a force-push, plus deleting forks (currently 0, per the API — verify again after any
   delay). Also consider whether the repo has been cloned by anyone, or archived by any third-party
   GitHub mirror or code-search index.

4. **The `README.md` in that directory already documents awareness of the rights problem.** In
   discovery, that is Exhibit A on knowledge. It was the right thing to write — but it means the
   "we had no idea" posture is unavailable, and it raises the cost of every additional day the
   content stays up.

---

# Sources — Sections 2 through 8

*Section 1 sources are logged at the end of §1. Sources below are grouped by the section where they
were most useful; some informed multiple sections and are cross-referenced rather than duplicated.
Dead ends and low-value results are logged too.*

## Case law and statutes

### Educational Testing Service v. Katzman, 793 F.2d 533 (3d Cir. 1986) — full opinion
- **Source**: U.S. Court of Appeals for the Third Circuit, via Justia and Google Scholar
- **Link**: https://law.justia.com/cases/federal/appellate-courts/F2/793/533/119118/ · https://scholar.google.com/scholar_case?case=11664753017076917598
- **Date accessed**: 2026-08-02
- **Type**: primary legal
- **What it establishes**: Individual standardized test questions ARE copyrightable; test-prep teaching use is NOT fair use. Rejects "copyrights do not extend to individual questions," "de minimis or inevitable," and public-domain-material arguments. Fair use analysis: use "highly commercial"; secure tests mean "any use is destructive"; copying "not insubstantial" even where not verbatim; copying "rendered the materials worthless to ETS."
- **Reliability**: verified fact

### U.S. Copyright Office fair use summary of ETS v. Katzman
- **Source**: U.S. Copyright Office Fair Use Index
- **Link**: https://www.copyright.gov/fair-use/summaries/eductesting-katzman-3dcir1986.pdf
- **Date accessed**: 2026-08-02
- **Type**: primary legal (government summary)
- **What it establishes**: Government's own four-factor summary of the holding. Also notes the case was "abrogated on other grounds by eBay v. MercExchange (2006)" — i.e., the injunction-presumption analysis, not the copyright holdings, was superseded. **Important nuance: irreparable harm is no longer presumed, so an injunction is slightly harder to get today than in 1986.**
- **Reliability**: verified fact

### Educational Testing Service v. Mikaelian, 571 F. Supp. 148 (E.D. Pa. 1983)
- **Source**: quoted in *Katzman*
- **Link**: https://scholar.google.com/scholar_case?case=16656648286944577299
- **Date accessed**: 2026-08-02
- **Type**: primary legal
- **What it establishes**: *"The very purpose of copyrighting the … questions is to prevent their use as teaching aids, since such use would confer an unfair advantage to those taking a test preparation course."* Note: E.D. Pa. — the same district where LSAC files.
- **Reliability**: verified fact (as quoted in the Third Circuit opinion; I did not read the full district opinion)

### LSAC v. Chatty Courses, Inc., Mun Dot So, Inc., and Ozgur Dogan Ugurlu — COMPLAINT
- **Source**: U.S. District Court, E.D. Pa., No. 2:24-cv-06905-JFM, Dkt. 1, filed 12/31/2024; retrieved via CourtListener RECAP
- **Link**: https://storage.courtlistener.com/recap/gov.uscourts.paed.631672/gov.uscourts.paed.631672.1.0.pdf
- **Date accessed**: 2026-08-02
- **Type**: primary legal
- **What it establishes**: **The single most on-point source in this memo.** LSAC sued a solo software engineer running "AI Tutor for LSAT"/"LSAT-GPT." Eight counts. Establishes: LSAC pleads direct + contributory/vicarious copyright infringement even where the app only relayed user-pasted content to OpenAI; LSAC pursues individual/personal liability and pleads alter-ego veil-piercing; LSAC used the defendant's own license-inquiry emails (Sept 19 & 25, 2024) as evidence of knowledge and willfulness; LawHub account signup created contract claims and a PA forum selection clause; statutory damages sought "up to $150,000 per work infringed"; LSAC's registered copyrights include TX0006862472, TXU002320834, TXU002320865; counsel was Alston & Bird.
- **Reliability**: verified fact (that these are LSAC's *allegations*; the judgment below establishes they were reduced to judgment)

### LSAC v. Chatty Courses — docket and FINAL JUDGMENT
- **Source**: PacerMonitor docket summary, E.D. Pa. 2:24-cv-06905
- **Link**: https://www.pacermonitor.com/public/case/56355403/LAW_SCHOOL_ADMISSION_COUNCIL,_INC_v_CHATTY_COURSES,_INC_et_al
- **Date accessed**: 2026-08-02
- **Type**: primary legal (docket)
- **What it establishes**: Dkt. 14, 5/7/2025: "FINAL JUDGMENT … IN FAVOR OF THE PLAINTIFF AND AGAINST DEFENDANTS CHATTY COURSES AND MUN DOT SO ON … COUNT I (PENNSYLVANIA BREACH OF CONTRACT); COUNT II (FEDERAL COPYRIGHT INFRINGEMENT); COUNT IV (FEDERAL TRADEMARK INFRINGEMENT); COUNT V (PENNSYLVANIA COMMON LAW UNFAIR COMPETITION); AND COUNT VII (FEDERAL UNFAIR COMPETITION)." Also shows a consent-judgment process requiring corporate representation (Dkt. 5, 2/12/25). Judge John F. Murphy.
- **Reliability**: verified fact
- ⚪ **Dead end noted**: the judgment PDF itself (Dkt. 9–14) is not in CourtListener's free RECAP archive; I attempted all and got 404s. **The dollar amount of the judgment is therefore unverified.** Obtaining it would require PACER.

### LSAC v. TestMax, Inc. — COMPLAINT
- **Source**: U.S. District Court, E.D. Pa., No. 2:26-cv-00351, Dkt. 1, filed 1/20/2026; via CourtListener RECAP
- **Link**: https://storage.courtlistener.com/recap/gov.uscourts.paed.648688/gov.uscourts.paed.648688.1.0.pdf
- **Date accessed**: 2026-08-02
- **Type**: primary legal
- **What it establishes**: **The only public window into the actual LSAT Content License Agreement terms.** Quotes/characterizes: fee components (Coaching License Fee, Student Subscription Fee, Processing Fee, Marketing License Fee, Book Publication Fee); prohibition on derivative works and on modifying items ("must be used verbatim in English … except for symbolization"); prohibition on "replicating or mimicking" the Digital LSAT interface; requirement that content be used only for students with an active subscription; security/encryption requirement; LSAC's audit right; 30-day cure period; PA governing law and exclusive PA venue; 1.5% late fee. Also gives real licensee-spend figures: $40,319 + $95,758 + $34,080 = $170,157 in unpaid fees across three CLAs. Counsel: Ballard Spahr + Alston & Bird.
- **Reliability**: verified fact (as to what the document says; the underlying CLA terms are LSAC's characterization of its own contract, which is reliable but one-sided)

### Law360 — "LSAC Says Test Prep Co. Flouted Fees, Infringed TMs"
- **Source**: Law360, July 7, 2026
- **Link**: https://www.law360.com/articles/2497915/lsac-says-test-prep-co-flouted-fees-infringed-tms
- **Date accessed**: 2026-08-02
- **Type**: news (paywalled — headline/lede only)
- **What it establishes**: The TestMax action is live and being covered by trade press as of July 2026.
- **Reliability**: verified fact (headline/lede); full article not accessible

### Bloomberg Law — "LSAT Prep Site Infringes Copyrights and Trademarks, Suit Says"
- **Source**: Bloomberg Law
- **Link**: https://news.bloomberglaw.com/ip-law/lsat-prep-site-infringes-copyrights-and-trademarks-suit-says
- **Date accessed**: 2026-08-02
- **Type**: news (paywalled)
- **What it establishes**: Independent confirmation of the Chatty Courses filing. Partially paywalled.
- **Reliability**: verified fact (visible portion)

### Law.com — "LSAT Administrator Sues to Block AI Tutor From Using 'Famous, Distinctive' Test Prep Materials"
- **Source**: Law.com, Dec. 31, 2024
- **Link**: https://www.law.com/2024/12/31/lsat-administrator-sues-to-block-ai-tutor-from-using-famous-distinctive-test-prep-materials/
- **Date accessed**: 2026-08-02
- **Type**: news
- **What it establishes**: Independent reporting on the Chatty Courses suit; quotes the complaint: *"LSAC owns unexpired copyrights covering materials it has created, including copyrights covering the thousands of LSAT questions it has created. The copyrighted works cover not only the exam questions, but also the instructions, answers, answer keys, and other related materials."*
- **Reliability**: verified fact

### 17 U.S.C. § 302 — Duration of copyright
- **Source**: Cornell Legal Information Institute
- **Link**: https://www.law.cornell.edu/uscode/text/17/302
- **Date accessed**: 2026-08-02
- **Type**: primary legal (statute)
- **What it establishes**: § 302(c) verbatim — works made for hire endure "95 years from the year of its first publication, or … 120 years from the year of its creation, whichever expires first."
- **Reliability**: verified fact

### 17 U.S.C. § 504(c) — Statutory damages
- **Source**: statutory framework (well-established; figures cross-checked against the relief LSAC seeks)
- **Link**: https://www.law.cornell.edu/uscode/text/17/504
- **Date accessed**: 2026-08-02
- **Type**: primary legal (statute)
- **What it establishes**: $750–$30,000 per work ordinary; up to $150,000 willful; as low as $200 for innocent infringement; all parts of a compilation count as one work.
- **Reliability**: verified fact (statute) / ⚪ the application of "per work" to PrepTest compilations vs. individual items is **my inference**, and courts vary

### CourtListener search — all LSAC federal litigation
- **Source**: CourtListener API, RECAP search
- **Link**: https://www.courtlistener.com/api/rest/v4/search/?q=%22Law+School+Admission+Council%22&type=r
- **Date accessed**: 2026-08-02
- **Type**: primary legal (docket search)
- **What it establishes**: 456 matching RECAP documents. Most LSAC litigation is *defensive* (ADA/accommodations suits, e.g. *Semkin*, *Jackson*, *Risner*, *Taylor*, *McHenry*), not IP enforcement. The two IP enforcement actions I found are Chatty Courses and TestMax. ⚪ **Honest caveat: I did not find a long history of LSAC copyright suits.** The enforcement pattern appears to be recent (2024–2026) and coincides with the rise of AI prep tools. That is a meaningful nuance — but it points the wrong way for LSAT Speedrun, since the recent cases are precisely the AI-prep fact pattern.
- **Reliability**: verified fact

### Public Domain Day 2026
- **Source**: Center for the Study of the Public Domain, Duke Law School (Jennifer Jenkins & James Boyle)
- **Link**: https://web.law.duke.edu/cspd/publicdomainday/2026/
- **Date accessed**: 2026-08-02
- **Type**: primary (authoritative academic center)
- **What it establishes**: As of January 1, 2026, works published in the U.S. in **1930 and earlier** are in the public domain (95-year term under the 1998 CTEA). Confirms the LSAT (first administered 1948) cannot have any public-domain content until ~2044 at the very earliest.
- **Reliability**: verified fact

### Bartz v. Anthropic PBC, 787 F. Supp. 3d 1007 (N.D. Cal. 2025) — Copyright Office summary
- **Source**: U.S. Copyright Office Fair Use Index
- **Link**: https://www.copyright.gov/fair-use/summaries/Bartz-v-Anthropic-PBC-787-F-Supp-3d-1007-ND-Cal-2025.pdf
- **Date accessed**: 2026-08-02
- **Type**: primary legal (government summary)
- **What it establishes**: Training LLMs on books was fair use; but building a permanent library from **pirated** copies was NOT fair use on all four factors — "steal[ing] a work you could otherwise buy" would "destroy" the market. Directly relevant: the *acquisition* prong is where AI defendants lose.
- **Reliability**: verified fact

### Kadrey v. Meta Platforms + Bartz — law firm analyses
- **Source**: Debevoise & Plimpton; Skadden; Fenwick; Thompson Coburn
- **Link**: https://www.debevoise.com/insights/publications/2025/06/anthropic-and-meta-decisions-on-fair-use · https://www.skadden.com/insights/publications/2025/07/fair-use-and-ai-training · https://www.fenwick.com/insights/publications/two-federal-courts-rule-that-reproduction-of-books-to-train-llms-is-fair-use-but-with-caveats-and-strikingly-different-views · https://www.thompsoncoburn.com/insights/intermediate-copying-and-fair-use-two-approaches-from-the-same-bench/
- **Date accessed**: 2026-08-02
- **Type**: secondary legal analysis (sophisticated)
- **What it establishes**: Both rulings are "narrow and fact-specific," not sweeping endorsements. The two judges **split** on whether pirated acquisition independently creates liability. Neither case blesses distributing outputs substantially similar to inputs. Confirms these cases do not help a product that *serves* the copyrighted items directly.
- **Reliability**: strong inference (law-firm client alerts are reliable but not primary)

## LSAC licensing program — primary sources

### LSAC — "License Official LSAT Questions and PrepTests" (rate card)
- **Source**: Law School Admission Council, official site
- **Link**: https://www.lsac.org/contact/official-lsat-content-licensing (live page 403s to direct fetch); archived: https://web.archive.org/web/20240520051533/https://www.lsac.org/contact/official-lsat-content-licensing
- **Date accessed**: 2026-08-02
- **Type**: official terms / primary
- **What it establishes**: **The core commercial finding.** Coaching license **$38/student** (nonprofit **$19/student** if free to student), "works in conjunction with student participation in LawHub." Public Marketing **$5,000/year** (one full test — June 2007 — plus PrepTest 65 questions). Book Publishing: fees based on item/test usage. Contacts: `licensing@LSAC.org` (for-profit), `ambassadors@LSAC.org` (nonprofit). Student options: free LawHub account with free PrepTests; LawHub Advantage $115–124/yr.
- **Reliability**: verified fact
- ⚪ **Method note:** the live page returns HTTP 403 to direct fetch and to the Wayback crawler (a 2026-05-27 capture is a 403). I verified the figures two ways: the May 20, 2024 Wayback capture (full text, quoted above) and current 2026 search-engine retrievals of the live page, which return identical figures. **Prices appear unchanged since at least May 2024.**

### LawHub — "Work With Us" (partner program)
- **Source**: LawHub / LSAC
- **Link**: https://lawhub.org/work-with-us
- **Date accessed**: 2026-08-02
- **Type**: official terms / primary
- **What it establishes**: What an Official LSAT content licensee gets: licensed content use; LSAC trademark use under the Content and Trademark Use Guidelines; a LawHub Marketplace listing; **LawHub Provider Portal with student performance reporting and API integration**; LSAC Law School Forums and the **virtual Test Prep Vendor Fair**; podcast sponsorship. States flatly: *"no person or entity may use LSAT content without obtaining a license to do so as an 'Official LSAT licensee'."* Also notes 100,000+ LSAT takers/year.
- **Reliability**: verified fact

### LawHub Marketplace — Official LSAT Content Licensees (structured vendor records)
- **Source**: LSAC / LawHub, server-rendered page payload
- **Link**: https://app.lawhub.org/marketplace/providers
- **Date accessed**: 2026-08-02
- **Type**: official / primary (extracted from the page's own SSR data)
- **What it establishes**: Per-licensee records with `vendorName`, `vendorId`, `vendorType`, `negotiatedCoachingRate`, `apiAccessEnabledFor` (`Production` / `Integration`), and product SKUs (`LSAC-Free Subscription`, `LSAC-Premium Subscription`, `LSAC-1yr Coaching License`). Ten alphabetically-first licensees captured: 7Sage (`7SG2020`), Access Prep (`AXS2022`), AdeptLR (`ADT2020`), **Admit Law (`ADL2026`)**, Admit Master (`AMT2021`), Advantage Testing (`AT2020`), AlphaScore (`ALP2021`), Apecs Tutoring (`APX2023`), Apex Pre-Law Services (`APL2022`), Apollo Test Prep (`APO2022`). Confirms a real OAuth-style API with sandbox and production environments.
- **Reliability**: verified fact for the field values. ⚪ **The decoding of the vendorId suffix as an onboarding year is my inference** — well-supported by the consistent 2020–2026 pattern, but LSAC does not state it.
- ⚪ **Dead end:** the full licensee list loads client-side. I probed `api.lawhub.org` (`/marketplace/providers`, `/vendors`, `/marketplace`, `/v1/marketplace/providers`, etc.) — all return `{"statusCode":404}` — and tried `?page=2` on the app route, which returns the same first ten. **The complete roster is unverified; it is longer than ten.**

### LawHub Terms and Conditions (full text)
- **Source**: LSAC / LawHub
- **Link**: https://www.lawhub.org/terms-and-conditions
- **Date accessed**: 2026-08-02
- **Type**: official terms / primary
- **What it establishes**: Read in full. Content is copyrighted by LSAC; "may be used only for purpose of preparing for the LSAT"; users "prohibited from downloading copyrighted material"; may not "copy, store … reproduce, create a derivative work from, display, distribute, sell … **frame, deep link to**, or otherwise use the Contents … including … any use of the Contents for any commercial purpose." Incorporates the LSAC Terms & Conditions of Use (limiting usage to "noncommercial use"). Governing law Pennsylvania; **exclusive venue Bucks County, PA**. Users indemnify LSAC. LSAC "reserves the right to prosecute copyright infringements."
- **Reliability**: verified fact

### LSAC — Guidelines for Informational Use of LSAC Trademarks by Third Parties
- **Source**: LSAC
- **Link**: https://www.lsac.org/about/lsac-policies/guidelines-informational-use-law-school-admission-council-inc-lsac-trademarks-third
- **Date accessed**: 2026-08-02
- **Type**: official terms / primary
- **What it establishes**: *"LSAC's copyrighted material cannot be used without LSAC's permission."* Nominative "fair use" of the marks is permitted for truthful reference to LSAC products, but must not disparage or imply endorsement. Logos strictly prohibited absent written license.
- **Reliability**: verified fact

### LSAC — Prepare for the LSAT / Prep Options
- **Source**: LSAC
- **Link**: https://www.lsac.org/lsat/prepare · https://www.lsac.org/lsat/prep
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: LSAC directs students: *"If you're thinking about studying with a test prep company, make sure to choose a provider that licenses official LSAT content."* Maintains the public licensee list. Notes many licensees offer free/discounted courses to fee-waiver recipients, and that LSAC "does not review or audit the performance of individual test prep companies."
- **Reliability**: verified fact

### LSAC — Official LSAT Practice Tests (free tier)
- **Source**: LSAC
- **Link**: https://www.lsac.org/lsat/prepare/official-lsat-practice-tests
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: "Four full four-section LSAT PrepTests are available for free through LawHub." LawHub Advantage $124/yr for "an extensive library." Official LSAT TriplePrep series reflects the post-August-2024 design.
- **Reliability**: verified fact

### LawHub — "Redesigned Official LSAT PrepTests Available Now"
- **Source**: LSAC / LawHub
- **Link**: https://app.lawhub.org/article/redesigned-official-lsat-preptests-available-now
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: 4 free full-length tests + 54 more via LawHub Advantage (≈58 total); every PrepTest in the library now follows the post-August-2024 format; LawHub is "the exclusive home of prep tools that previously were available as free LSAT prep resources offered by Khan Academy."
- **Reliability**: verified fact

### LSAC — LawHub product page
- **Source**: LSAC
- **Link**: https://www.lsac.org/lawhub
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: LawHub Advantage $124/year. Free LawHub account available to all.
- **Reliability**: verified fact

### LawHub — Prepare with LawHub
- **Source**: LSAC / LawHub
- **Link**: https://www.lawhub.org/prepare-for-the-lsat/prepare-with-lawhub
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: LawHub Advantage $124; "Content you can use with any of LSAC's Official LSAT Content Licensees" — confirms the license is portable across providers from the student's side.
- **Reliability**: verified fact

## How licensees actually operate

### 7Sage — "LawHub Advantage Activation and Linking"
- **Source**: 7Sage (licensee `7SG2020`)
- **Link**: https://7sage.com/blog/lawhub-advantage-activation-and-linking
- **Date accessed**: 2026-08-02
- **Type**: official terms (third-party licensee) / primary
- **What it establishes**: *"LSAC requires that every student who wants to use a prep course that uses real LSAT questions must have an active LSAC LawHub Advantage subscription. That includes us, 7Sage, and any other LSAT prep course that uses real LSAT questions."* One subscription works across multiple providers. Students must link accounts. Even owning hard-copy PrepTests doesn't exempt you — LSAC requires the subscription to view content online.
- **Reliability**: verified fact

### 7Sage community — LawHub gating error message
- **Source**: 7Sage forums
- **Link**: https://7sage.com/discussion/45859/lsac-subscription · https://7sage.com/discussion/55800/7sage-lawhub-advantage
- **Date accessed**: 2026-08-02
- **Type**: forum / primary (product behavior)
- **What it establishes**: Verbatim gating message: *"Sorry, your account must be linked to an active LSAC LSAT LawHub Advantage account to access licensed materials."* 7Sage staff: *"you're paying LSAC for copies of past LSATs, and you're paying us for the educational materials."* 24-hour complimentary grace window on signup. **This is the entitlement architecture LSAT Speedrun would need to build.**
- **Reliability**: verified fact

### 7Sage — LawHub auto-import feature
- **Source**: 7Sage
- **Link**: https://7sage.com/discussion/7126/new-feature-auto-import-from-lawhub · https://7sage.com/blog/new-features-roundup
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: 7Sage automatically imports PrepTests taken in LawHub into its own analytics. Proves the "companion layer" architecture is real and shipped. ⚪ 7Sage is a licensee, so this does not establish that a non-licensee may do the same.
- **Reliability**: verified fact

### Blueprint LSAT — "LSAC LawHub Advantage 101" and "What is LawHub Advantage?"
- **Source**: Blueprint Prep help center and blog (post updated March 20, 2026)
- **Link**: https://help.blueprintprep.com/en/articles/6431996-lsac-lawhub-advantage-101 · https://blog.blueprintprep.com/lsat/what-is-lsat-prep-plus/
- **Date accessed**: 2026-08-02
- **Type**: official (third-party licensee) / primary
- **What it establishes**: **Dates the industry-wide requirement to August 4, 2020** — "all LSAT students need an active LawHub Advantage … subscription to access any licensed LSAT content." *"Because we use official LSAT questions in our Blueprint course, all students must pay for the LSAT LawHub Advantage license."* Students must designate their prep company as their "coach." Blueprint's bank: "7000+ real LSAT questions."
- **Reliability**: verified fact

### Kaplan — LSAT Prep On Demand course page
- **Source**: Kaplan Test Prep
- **Link**: https://www.kaptest.com/lsat/courses/lsat-prep-diy-online
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: "LSAT Link Integration with access to 59 official practice tests via LSAC's LawHub Advantage ($120 subscription required)"; "Nearly 6,000 official LSAT exam questions." **Notes LawHub Advantage increases from $120 to $124 effective July 1, 2026.**
- **Reliability**: verified fact

### LSAT Demon — LawHub Advantage FAQ, Plans, and plan explanations
- **Source**: LSAT Demon
- **Link**: https://lsatdemon.com/resources/frequently-asked-questions/lawhub-advantage-faq · https://lsatdemon.com/plans · https://lsatdemon.com/resources/frequently-asked-questions/lsat-demon-plans-explained
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: LawHub Advantage $124/yr, required by LSAC "to access official LSAT questions online," portable across providers. "All 81 released exams." Fee-waiver students get 50% off Essential / 20% off Live or Pro for three years. Confirms licensees serve official items in their own UI with their own drilling engine ("Smart Drilling," "Ugly Mode").
- **Reliability**: verified fact

### Magoosh — free LSAT practice test page (licensing statement)
- **Source**: Magoosh
- **Link**: https://magoosh.com/lsat/free-lsat-practice-test-explanations/
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: *"By permission of the Law School Admission Council (LSAC®), Magoosh is pleased to be one of the most recommended and most affordable test prep providers to use official LSAC questions in our LSAT Prep product."* "6,000+ official practice problems."
- **Reliability**: verified fact

### Magoosh — "How to Use LawHub and LawHub Advantage"
- **Source**: Magoosh LSAT blog
- **Link**: https://magoosh.com/lsat/how-to-use-lsac-official-lsat-prep-lawhub/
- **Date accessed**: 2026-08-02
- **Type**: news/company blog
- **What it establishes**: Names the four free PrepTests as **140, 141, 157, 158**; LawHub Advantage "over 58 official tests"; fee-waiver holders get Advantage free.
- **Reliability**: verified fact

### Test Prep Insight — Magoosh review and Magoosh vs. Princeton Review
- **Source**: Test Prep Insight (review site)
- **Link**: https://testprepinsight.com/reviews/magoosh-lsat-review/ · https://testprepinsight.com/comparisons/magoosh-vs-princeton-review-lsat/
- **Date accessed**: 2026-08-02
- **Type**: news / review site
- **What it establishes**: *"almost every LSAT prep company uses real LSATs"*; both Magoosh and Princeton Review "leverage official LSAT problems through LSAC" and require an LSAC license purchase.
- **Reliability**: strong inference (independent review site, consistent with primary sources; Princeton Review's licensee status is **not** independently verified by me)

### TestPrepPal — LawHub Advantage and LSAC free PrepTests pages
- **Source**: TestPrepPal (review site)
- **Link**: https://testpreppal.com/lsat/prep-course/lsac · https://testpreppal.com/lsat/practice-tests/lsac
- **Date accessed**: 2026-08-02
- **Type**: news / review site
- **What it establishes**: Corroborates the four free PrepTests (140, 141, 157, 158), LawHub Advantage pricing, and the cross-provider requirement.
- **Reliability**: unverified claim / weak — SEO review site; used only as corroboration of facts established primarily elsewhere

### PracticeTestGeeks — LSAT Demon review; LSAT practice tests
- **Source**: practicetestgeeks.com
- **Link**: https://practicetestgeeks.com/lsat/lsat-demon · https://practicetestgeeks.com/lsat/practice-tests
- **Date accessed**: 2026-08-02
- **Type**: news / review site
- **What it establishes**: LSAT Demon's bank described as ~90 released PrepTests, 6,000+ LR questions, 300+ RC passages, "no Demon-written practice questions … The founders argue that fake questions train fake habits."
- **Reliability**: unverified claim — SEO review site. Corroborated on the "no original questions" point by LSAT Demon's own site.

### Accio company profile — LSAT Demon
- **Source**: accio.com (aggregating Tracxn / LinkedIn / ZoomInfo)
- **Link**: https://www.accio.com/business/lsat-demon
- **Date accessed**: 2026-08-02
- **Type**: news / data aggregator
- **What it establishes**: LSAT Demon founded 2018 by Nathan Fox and Ben Olson; **2–10 employees; under $5M annual revenue**; uses exclusively official licensed LSAC questions.
- **Reliability**: unverified claim — aggregator data. Used for the *scale* point ("a very small company holds this license"), which is directionally reliable but not precisely verified.

### Pass4Sure — Best LSAT Prep Courses 2025
- **Source**: pass4-sure.us
- **Link**: https://pass4-sure.us/standardized-tests/online-prep-courses/best-lsat-prep-courses-2025
- **Date accessed**: 2026-08-02
- **Type**: news / SEO review site
- **What it establishes**: "The LSAC licenses authentic LSAT questions to prep companies"; PowerScore books contain real licensed items; LawHub is "effectively essential."
- **Reliability**: unverified claim — low-quality SEO content, and it contains a suspicious "quote" attributed to LSAC that I could not locate on any LSAC page. **PowerScore's licensee status should be treated as strong inference, not verified.**

## Khan Academy partnership

### Khan Academy — "LSAT Prep Moving from Khan Academy to LSAC's LawHub After June 30, 2024"
- **Source**: Khan Academy support center
- **Link**: https://support.khanacademy.org/hc/en-us/articles/23864027890829-LSAT-Prep-Moving-from-Khan-Academy-to-LSAC-s-LawHub-After-June-30-2024
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: Partnership ran from **2018 to June 30, 2024**. Rationale: *"With the continued growth and development of LSAC's LawHub, we believe students will be best served by having one centralized place."* Also tied to the LSAT format change effective August 2024. Khan retains only videos and articles.
- **Reliability**: verified fact

### LSAC — "Khan Academy LSAT Test Prep Resources Coming to LSAC's LawHub by June 2024"
- **Source**: LSAC blog
- **Link**: https://www.lsac.org/blog/khan-academy-lsat-test-prep-resources-coming-lsacs-lawhub-june-2024
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: LSAC's own framing: *"When LSAC initially collaborated with Khan Academy … there was no other destination available for students to access free LSAT prep."* Announced Nov 1, 2023. All jointly-developed tools moved into LawHub. **Strong evidence that LSAC now wants to own the free-prep relationship directly.**
- **Reliability**: verified fact

### LSAC — "LSAT Update – July 3, 2024"
- **Source**: LSAC blog
- **Link**: https://www.lsac.org/blog/lsat-update-july-3-2024
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: Transition detail — drill sets, videos, articles moved to LawHub's free library March 2024; answer rationales for the four free PrepTests added mid-2024.
- **Reliability**: verified fact

### Daily Trojan — "Students discuss end of Khan Academy LSAT prep"
- **Source**: Daily Trojan (USC student newspaper)
- **Link**: https://dailytrojan.com/?p=209273
- **Date accessed**: 2026-08-02
- **Type**: news
- **What it establishes**: Independent reporting; quotes Katya Valasek, LSAC director of pre-law advising: *"When we partnered with Khan Academy, LawHub didn't exist. The test was still a paper and pencil test. Khan Academy was a way to get test prep to a wider range of people."* Also links the wind-down to the removal of Logic Games.
- **Reliability**: verified fact

### Yale OCS — "Khan Academy LSAT Resources Moving to LawHub"
- **Source**: Yale Office of Career Strategy
- **Link**: https://ocs.yale.edu/blog/2024/01/08/khan-academy-lsat-resources-moving-to-lawhub/
- **Date accessed**: 2026-08-02
- **Type**: news (university advising office)
- **What it establishes**: Corroborates transition details and timeline; notes 100+ lessons/videos and ~100 articles migrated starting February 2024.
- **Reliability**: verified fact

## LSAC mission, leadership, and strategy

### LSAC — About / Mission & History
- **Source**: LSAC
- **Link**: https://www.lsac.org/about · https://www.lsac.org/about/mission-history
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: Mission verbatim: *"to advance law and justice by promoting access, equity, and fairness in law school admission, to broaden the pathway into legal education, and to support law schools, law students, and the legal education community."* Confirms nonprofit status and access/equity emphasis.
- **Reliability**: verified fact

### LSAC — Sudha Setty leadership bio
- **Source**: LSAC
- **Link**: https://www.lsac.org/about/lsac-leadership/sudha-setty
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: Setty is LSAC president and CEO. Former dean of CUNY Law and Western New England Law. Expanded CUNY's Pipeline to Justice access program. **Served on the New York State Bar Association Task Force on Artificial Intelligence.** Stanford BA, Columbia JD, began at Davis Polk, elected member of the American Law Institute.
- **Reliability**: verified fact

### LSAC / PR Newswire / ABA Journal — Setty appointment
- **Source**: LSAC press release, PR Newswire (Jan. 6, 2025), ABA Journal
- **Link**: https://www.lsac.org/about/news/lsac-names-cuny-law-dean-sudha-setty-its-new-president-and-ceo · https://www.prnewswire.com/news-releases/lsac-names-cuny-law-dean-sudha-setty-as-its-new-president-and-ceo-302342270.html · https://www.abajournal.com/web/article/setty-to-lead-the-law-school-admissions-council
- **Date accessed**: 2026-08-02
- **Type**: official press release / news
- **What it establishes**: Effective **July 1, 2025**. Succeeded Kellye Testy (departed for AALS July 2024); Susan Krinsky served as interim. Setty's stated priorities: *"championing access, equity, and outcomes in legal education,"* preserving the rule of law, and supporting "those who have been historically excluded from leadership roles."
- **Reliability**: verified fact

### LSAC — Legal Education Program launch
- **Source**: LSAC news
- **Link**: https://www.lsac.org/about/news/lsac-launches-program-offer-new-holistic-pathway-law-school
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: New holistic undergraduate pathway program. Notes LSAC's **acquisitions of the Institute for the Future of the Law Practice (IFLP) and Law School Transparency (LST)**, both folded into LawHub. Confirms the consolidation strategy: "LawHub is quickly evolving as a legal education destination."
- **Reliability**: verified fact

### LSAC — Press releases index; Before the JD II study
- **Source**: LSAC
- **Link**: https://www.lsac.org/about/news/press-releases · https://www.lsac.org/about/news/lsac-aals-launch-jd-ii-study
- **Date accessed**: 2026-08-02
- **Type**: official / primary
- **What it establishes**: Recent initiative set: Before the JD II (with AALS, AccessLex, NCBE, NALP), Law School Transparency acquisition, LawHub expansion, chief diversity officer appointment, Plus Guided Journey.
- **Reliability**: verified fact

### ProPublica Nonprofit Explorer — LSAC financials
- **Source**: ProPublica Nonprofit Explorer API
- **Link**: https://projects.propublica.org/nonprofits/api/v2/search.json?q=%22Law+School+Admission+Council%22
- **Date accessed**: 2026-08-02
- **Type**: primary (IRS Form 990 aggregator)
- **What it establishes**: ⚪ **Dead end.** Returned zero results for both the quoted and unquoted org name, and a guessed EIN returned no organization record. **LSAC's revenue scale and licensing-revenue line are therefore unverified.** Would be worth checking directly on the IRS Tax Exempt Organization Search before a negotiation, to size how much the licensing program matters to them.
- **Reliability**: n/a (failed lookup)

## Original / AI-generated item alternatives

### 7Sage forum — "Test Prep Books (Barrons, Princeton Review, Kaplan, etc)"
- **Source**: 7Sage community forum (actual LSAT students)
- **Link**: https://7sage.com/discussion/8664/test-prep-books-barrons-princeton-review-kaplan-etc
- **Date accessed**: 2026-08-02
- **Type**: forum / primary (student sentiment)
- **What it establishes**: **The best primary evidence of student hostility to unofficial questions.** *"there's simply no need to use made-up questions when you don't have to … why risk using a flawed question when you have over 7000 real questions right at your fingertips."* And: unofficial "methods … will ingrain faulty technique in you." Also articulates the structural reason: unlike other tests, LSAC has released enough real material that scarcity isn't a problem.
- **Reliability**: verified fact (that this sentiment exists and is prevalent); ⚪ a handful of forum posts is not a survey — treat as indicative, not quantified

### Premier Exam Prep — LSAT practice (original items)
- **Source**: premierexamprep.com
- **Link**: https://premierexamprep.com/lsat/practice
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: The closest existing model for the "original items" path. Claims 2,400+ original items (1,650 LR, 608 RC, 2 full tests), *"written in the style of the current LSAT, and checked by an independent reviewer,"* *"Nothing is recycled from official tests."* Free during early access; AI tutor "Lex" at $29/mo. Built a replica of LSAC's August 2026 platform UI. **Key marketing frame: "original drills mean your official PrepTests stay fresh for full-length rehearsal."**
- **Reliability**: verified fact (that they make these claims); ⚪ item quality and commercial traction unverified

### PrepEngine Academy
- **Source**: prepengineacademy.com
- **Link**: https://prepengineacademy.com/
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: 400+ items, *"AI-generated, then reviewed and refined."* $25/month after a 3-day trial. A live example of the AI-generated-plus-human-review pipeline at small scale.
- **Reliability**: verified fact (as to claims)

### AccelaStudy AI LSAT
- **Source**: lsat.accelastudy.ai
- **Link**: https://lsat.accelastudy.ai/
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: Fully dynamic generation — "Practice tests are dynamically composed from over a million questions. You never see the same test twice." $129/mo. ⚪ Note it advertises Logic Games practice, which was removed from the LSAT in August 2024 — a quality signal worth noting.
- **Reliability**: unverified claim (the "over a million questions" figure is marketing)

### PDFQuiz — LSAT practice question generator
- **Source**: pdfquiz.com
- **Link**: https://pdfquiz.com/lsat-practice-test
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: Generates items from the user's own uploaded material. Notably **explicit about rights posture**: *"it does not reproduce real LSAT questions. Use it alongside official LSAC PrepTests and your prep course."* Also confirms current format: two LR sections + one RC, 75–80 scored questions, Logic Games retired August 2024.
- **Reliability**: verified fact (as to claims)

### LexPrep
- **Source**: lexprep.ai
- **Link**: https://www.lexprep.ai/
- **Date accessed**: 2026-08-02
- **Type**: official (company) / primary
- **What it establishes**: AI-first LSAT platform advertising "official LSAT PrepTests 101–158." ⚪ **Its licensee status is unverified** — it did not appear in the partial marketplace roster I could extract (which only covered vendors alphabetically through "Apollo," so absence proves nothing).
- **Reliability**: unverified claim

### Test Prep Street; Exam-Labs; RevisionTown; hub.bocatc.org
- **Source**: various SEO/review sites
- **Link**: https://testprepstreet.com/lsat-practice-test-where-to-find-free-and-reliable-full-length-exams/ · https://www.exam-labs.com/blog/free-lsat-practice-test-with-official-questions-explanations · https://revisiontown.com/lsat-match-flaws/ · https://hub.bocatc.org/lsat-practice-tests-reddit/
- **Date accessed**: 2026-08-02
- **Type**: news / SEO content
- **What it establishes**: Consistent market narrative that official items have "perfect difficulty calibration" from real administration data, and that unofficial items risk "developing bad habits." Useful only as evidence of the *prevailing narrative*.
- **Reliability**: unverified claim — these are low-quality SEO pages, several likely AI-generated. **I am relying on them only for the fact that this sentiment is the market consensus, which is independently corroborated by the 7Sage forum and by LSAT Demon's own marketing.**

### Reddit — attempted sentiment search
- **Source**: reddit.com JSON search API
- **Link**: https://www.reddit.com/search.json?q=LSAT+unofficial+questions
- **Date accessed**: 2026-08-02
- **Type**: forum
- **What it establishes**: ⚪ **Dead end.** Reddit's JSON endpoints returned non-JSON (blocked) for this client. **I was unable to sample r/LSAT sentiment directly**, which is a real gap — r/LSAT is the largest LSAT community and would be the best source on official-vs-unofficial sentiment. I substituted the 7Sage forums, which are a genuine student community but smaller and affiliated with a licensee (a possible bias toward official content).
- **Reliability**: n/a (failed)

## Dataset provenance — additional

### ReClor dataset terms of use
- **Source**: Weihao Yu et al., National University of Singapore (ICLR 2020)
- **Link**: https://whyu.me/reclor/
- **Date accessed**: 2026-08-02
- **Type**: official terms / primary
- **What it establishes**: **The instructive contrast with AR-LSAT.** ReClor gates its download behind an agreement with the literal password `for_non-commercial_research_purpose_only`, and states: *"ReClor dataset is available for non-commercial research purpose use only"*; *"All passages are obtained from websites/books which are not the property of National University of Singapore"*; *"You agree not to reproduce, duplicate, copy, sell, trade, resell or exploit for any commercial purpose, any portion of the contexts and any portion of derived data."* Notably: *"**We shuffle the order of answer options and randomly delete one of the wrong options for each dataset point to comply with fair use of law.**"* AR-LSAT (the actual upstream here) did none of this — it retained all five options verbatim.
- **Reliability**: verified fact

### AGIEval benchmark
- **Source**: Microsoft Research (Zhong et al., 2023)
- **Link**: https://github.com/ruixiangcui/AGIEval
- **Date accessed**: 2026-08-02
- **Type**: primary (research repo)
- **What it establishes**: AGIEval's `lsat-ar` / `lsat-lr` / `lsat-rc` tasks derive from the same AR-LSAT `complete_lsat_data` files (shared lead author, Wanjun Zhong). It is a **sibling** of the tasksource datasets, not an ancestor — ruled out as the provenance path but confirms the same LSAC content propagated into a widely-used LLM benchmark.
- **Reliability**: strong inference

### Wang et al., "From LSAT: The Progress and Challenges of Complex Reasoning" (arXiv 2108.00648)
- **Source**: Fudan University / Microsoft Research; IEEE/ACM TASLP 2022
- **Link**: https://arxiv.org/abs/2108.00648
- **Date accessed**: 2026-08-02
- **Type**: primary (academic paper)
- **What it establishes**: The paper to which `complete_lsat_data/` (all three sections) belongs, per the AR-LSAT repo README — i.e., the direct upstream of the LR and RC files this app ships. Cross-referenced in §1.
- **Reliability**: verified fact (attribution per repo README)

---

# The provenance verdict

**What the current question bank actually is:**

> **6,886 verbatim, unmodified, real LSAT questions — 4,520 Logical Reasoning and 2,366 Reading
> Comprehension — taken from approximately 85 real U.S. LSAT administrations between June 1991 and
> December 2016, plus 5 LSAT—India administrations. Every one of them is an original literary work
> owned by LSAC. Not one is in the public domain, and the earliest will not enter the public domain
> until roughly 2086.**

**Its rights status: no rights whatsoever.** The chain of custody is:

`LSAC (© owner) → scraped by academic researchers with no permission → GitHub repo with a boilerplate
MIT LICENSE file covering research code → re-hosted on Hugging Face with no license at all → this app`

**Nobody in that chain ever held a right to grant.** The MIT file upstream conveys nothing, because
the researchers acquired nothing by scraping. And the dataset this app actually consumed declares no
license at all — the card is an empty auto-generated stub reading "More Information needed."

**Confidence: very high.** This is not inference. I decoded all 6,886 `id_string` values to real LSAT
administration dates, confirmed the item text is byte-identical to the upstream AR-LSAT files,
confirmed the upstream paper states "we collect data from nearly 90 LSAT exams from 1991 to 2016,"
and confirmed via the Hugging Face API that neither dataset carries a license tag or LICENSE file.

**There is no version of this where the current question bank is safe to ship commercially.**

🚨 **And a distribution problem exists independently of shipping:** the entire bank is, as of today,
publicly downloadable from the project's public GitHub repository. That is live, ongoing,
unauthorized distribution of ~85 complete PrepTests — happening right now, whether or not the app
ever launches. Fixing that is a one-minute action and should precede everything else.

---

# Risk ladder

Ordered most to least risky.

### (a) Launch as-is, commercially — 🔴 DO NOT DO THIS
- **Legal exposure:** Extreme. Direct + contributory copyright infringement across ~85 registered
  works; trademark infringement if "LSAT" is in the name; breach of contract if anyone at the company
  ever made a LawHub account. Personal liability for the founder is squarely on the table.
- 🚨 **And note this option is currently *already partly in effect*** — the public GitHub repo is
  distributing the full bank today. Launching would compound an exposure that has already started.
- **Realistic damages:** $63k–$2.5M ordinary; up to ~$12.75M if willful; plus fees, disgorgement,
  injunction.
- **Likelihood of enforcement:** High. LSAC sued a solo-developer AI LSAT tool within ~8 months of
  launch and won judgment in ~13 months, using AmLaw-100 counsel.
- **Cost:** $0 upfront; potentially catastrophic later. Defense costs alone would exceed six figures.
- **Timeline:** Ships now. C&D likely in ~3–9 months if you get traction.
- **Verdict:** The upside is a few months of runway; the downside is personal bankruptcy and an
  injunction that ends the company. There is a legitimate version of this business available for
  $38/student. Taking this risk is not rational.

### (b) Launch free / non-commercial with the same items — 🔴 Still bad
- **Legal exposure:** High. Improves fair-use factor 1 and reduces damages, but a free substitute for
  a $124 paid product is *maximum* factor-4 market harm — the argument partly cancels itself.
- **Realistic damages:** Lower (no profits to disgorge; better willfulness posture) but statutory
  damages and injunction remain fully available.
- **Cost:** $0. **Timeline:** now.
- **Verdict:** Only defensible as a *very* short bridge while you execute (c) or (d), and even then
  I would not recommend it. It also poisons a later license application (§7.4). If you need something
  live this week, ship a version with **no LSAT items at all** — the learning loop, the UI, the
  planner, the analytics — and let users bring their own questions.

### (c) Switch to original / AI-generated items — 🟢 Legally sound, commercially hard
- **Legal exposure:** Low **if** genuinely independently created. Must be generated from
  *specifications*, not from the LSAC items. Paraphrasing the existing bank does **not** qualify and
  keeps you fully exposed (§2.5).
- **Cost:** Generation is cheap; **quality control is not**. Premier Exam Prep uses independent human
  reviewers on every item. Realistic: **$15k–$60k+** for a few thousand reviewed items, or several
  months of founder time. Building 2,400 credible items is a real project.
- **Timeline:** 1–3 months for a defensible v1 bank; ongoing.
- **Market risk:** 🔴 This is the real cost. LSAT students are unusually hostile to unofficial
  questions, and every serious competitor uses official content. You would be the only major player
  without it. **Mitigation:** adopt the complement framing — *"original drills so your official
  PrepTests stay fresh"* — rather than positioning as a substitute.
- **Verdict:** A legitimate path, and the fastest one to a *lawful* product. Weakest on credibility.

### (d) Pursue an LSAC Official LSAT Content License — 🟢 The right destination
- **Legal exposure:** None, once signed and complied with.
- **Cost:** **$38/student/year** (Coaching), or $19 nonprofit if free to students; plus a Processing
  Fee and other line items; plus $5,000/yr only if you want real items in public marketing. **At 100
  students, roughly $3,800/yr.** Plus counsel to review the CLA — budget $2k–$10k.
- **Student cost:** each student must hold LawHub Advantage at **$124/yr** (one subscription works
  across all providers, and fee-waiver recipients get it free). This must be in your pricing model
  from day one.
- **Timeline:** ⚪ Unverified, but **certainly longer than 1.5 weeks.** My estimate is weeks to a few
  months: contract review, security attestation, LawHub linkage + Provider Portal/API integration.
- **Engineering work required:** encrypted content storage; per-student entitlement gating on LawHub
  linkage; verbatim-only rendering; a UI visually distinct from the Digital LSAT; removal of items
  from the repo and git history; audit-readiness.
- **Feasibility:** 🟢 **High.** Published rate card, public email address, no published minimum, and
  a licensee roster that includes two-person shops and a company (`ADL2026`) onboarded this year with
  essentially your product description.
- **Verdict:** This is what the business should be. The only question is bridging the gap.

### (e) Link out to LawHub / bring-your-own-official-content — 🟢 Lowest risk, real product
- **Legal exposure:** Low, **with two caveats**: LawHub Terms prohibit "frame" and "deep link to," so
  link to LawHub's public pages, not into content. And ⚪ whether *importing a student's own results*
  without a license is permitted is **unverified** — 7Sage does it, but 7Sage is a licensee.
- **Cost:** ~$0 in licensing.
- **Timeline:** Days to weeks. **This is the only option on this ladder that fits a 1.5-week runway.**
- **What the product becomes:** the coaching, analytics, spaced-repetition, gamification, scheduling,
  and explanation layer over content the student accesses in LawHub. Students self-report or import
  results.
- **Trade-off:** you lose the tight drill loop that is presumably the product's core. It is a real
  business (7Sage shipped "LawHub auto-import"), but it is a different one.
- **Verdict:** The safe harbor. Best used as the **launch vehicle while you pursue (d)**.

---

# The licensing pitch: could we actually get one?

**Short answer: yes, and more easily than the founder assumes — but the framing needs to change
completely.**

The founder's premise was *"we need a stronger pitch to assert that our application is worthy of
getting licensing, but I don't know if we have a strong case."* **That premise is wrong in a way
that is good news.** LSAC is not curating an exclusive partner program. It is selling a standard
license at **$38 per student**, publicly, with a rate card, an email address, and a licensee roster
that includes one-person tutoring shops. There is no evidence of a worthiness bar.

**The evidence that a company like yours can get one:**
- **`ADL2026`** — Admit Law onboarded as a licensee in **2026**, described by LSAC as helping students
  *"drill smarter with licensed practice, analytics, blind review, pacing tools, and personalized
  recommendations."* That is your product, licensed, this year.
- **AdeptLR** — *"adaptive drilling … proprietary algorithm … personalized drill sets."* Same.
- **LSAT Demon** — reportedly 2–10 employees, under $5M revenue, entirely licensed content.
- Pricing is per-student with no published minimum, which is structurally friendly to a startup.

**What you'd actually need to be true first — the real gating items:**
1. 🔴 **The infringing items must be gone** — from the app, the database, and git history — **before
   you make contact.** This is the highest-priority item in this entire memo. See §7.4.
2. **A real legal entity** that can sign a Pennsylvania-law contract and be invoiced.
3. **A security story:** encrypted at rest, entitlement-gated, not in the repo, audit-ready.
4. **Product changes:** verbatim-only item rendering; AI that explains rather than rewrites; a UI
   visually distinct from the Digital LSAT.
5. **Pricing that absorbs $38/student plus the student's $124 LawHub Advantage.**
6. **Counsel** to review the CLA and to advise on disclosing the prior use.

**The pitch itself should be one paragraph, not a deck.** You are buying a listed product. Lead with
compliance, not vision:

> *We're an adaptive LSAT drilling platform built around high-volume retrieval practice for LR and
> RC. We want the standard Coaching license: official items served in our own distinct interface,
> gated on each student's active LawHub Advantage link, stored encrypted, rendered verbatim, with AI
> generating explanations rather than modified items. We'll offer [free/discounted] access to LSAC
> fee-waiver recipients from launch.*

Add **one** sentence of mission alignment — affordability and fee-waiver access, which map directly
onto LSAC's stated mission and President Setty's priorities. Then stop.

**What to avoid:** equity (LSAC is a nonprofit), exclusivity (the license is expressly
non-exclusive), "we'll grow your market" (LSAC already reaches every candidate), and any pitch
premised on being LSAC's free-prep partner — LSAC spent 2023–2024 deliberately insourcing exactly
that from Khan Academy (§7.2).

**Contact:** `licensing@LSAC.org`. Nonprofit track: `ambassadors@LSAC.org`.

**Confidence:** 🟢 High that a license is *obtainable*. ⚪ Genuinely unknown on **timeline** — no
public source states it, and this is the main thing to find out in your first email.

---

# What I'd do with a 1.5-week runway

**The core conflict: the license is obtainable but almost certainly not in 1.5 weeks. So decouple
"launch" from "launch with official questions."**

### Hour 1 — 🚨 Make the GitHub repository private
`github.com/nischayhegde/LSATspeedrun` is **public right now**, and the full question bank is
anonymously downloadable (verified: HTTP 200, 4.18 MB). This is the highest-severity, lowest-effort
item on the entire list. Settings → General → Danger Zone → Change visibility. One minute.

### Days 1–2 — Stop the bleeding (do this regardless of everything else)
1. **Remove the 6,886 items from the deployed application.** Today.
2. **Purge the items from git history** (`git filter-repo` / BFG, force-push, delete forks). Private
   is the tourniquet; history purging is the fix — repos get made public again, and get shared with
   investors, contractors, and acquirers.
3. **Document the removal** with timestamps, in case you later need to show when you stopped.
4. **Email `licensing@LSAC.org`** — *after* steps 1–3 — asking for the CLA, onboarding steps, and
   **timeline**. This is a one-paragraph email and it starts the longest-lead-time clock. Do not
   describe your prior use without counsel.
5. **Book an IP attorney.** A 1–2 hour consult (~$500–$1,500) on: disclosure strategy, the CLA, and
   whether your product name creates Lanham Act exposure. **Do not skip this.**

### Days 3–5 — Decide what actually ships
Ship **the engine without LSAC's content.** Everything that makes LSAT Speedrun distinctive — the
speedrun loop, the timing, the streaks, the analytics, the spaced repetition, the explanations
layer — is yours and is unencumbered. What you cannot ship is the item bank.

Two viable fillings, and I would do both:

- **Bridge (immediate):** a **bring-your-own-content / LawHub companion** mode. Students practice
  official material in LawHub (free tier: 4 full PrepTests; Advantage: ~58) and your app is the
  coaching, tracking, and review layer. 7Sage validated this pattern with "LawHub auto-import."
  ⚪ Confirm with counsel that result-import without item text is acceptable for a non-licensee.
- **Seed bank (parallel):** a small set of **genuinely original items** — 200–400, not 2,400 — built
  from *specifications* (question types, logical structures, difficulty targets), never from the LSAC
  items, with a documented pipeline and human review. Enough to make the loop demonstrable. Market it
  honestly with the complement framing: *"original drills so your official PrepTests stay fresh."*

### Days 6–10 — Build for the license you're going to get
Do the engineering that the CLA will require anyway, so that signing is a switch-flip:
- Content storage encrypted at rest, outside the repo, fetched at runtime
- Per-student entitlement gating (scaffold the LawHub-link check now)
- A rendering path that treats item text as immutable and verbatim
- A UI deliberately unlike the Digital LSAT interface
- Any AI feature that rewrites item text → refactor to *explain* item text
- Pricing model that absorbs $38/student and assumes the student holds LawHub Advantage
- Rename if "LSAT" is used as a brand rather than a descriptor — get counsel's read

### The one-sentence recommendation

> **Pull the questions now, ship the engine without them in 1.5 weeks (LawHub companion mode plus a
> few hundred genuinely original items), and run the LSAC licensing conversation in parallel — because
> at $38 per student with a company like yours onboarded as a licensee this year, the license is very
> likely available, and it converts this from a company with an existential legal problem into an
> ordinary one with a cost of goods sold.**

**What you'd be giving up:** launching with 6,886 official questions in 1.5 weeks. **What you'd be
getting:** a business that can raise money, sign customers, survive diligence, and not end in a
Pennsylvania courtroom with the founder personally named — which is precisely what happened to the
last solo developer who built an AI LSAT tool on LSAC's questions.

---

# ⚠️ Disclaimer

**This document is research, not legal advice. I am not a lawyer.**

It was assembled from public sources — court filings, statutes, LSAC's own published terms and
pricing, dataset metadata, company documentation, and press coverage — to give you the most accurate
picture I could of a situation that has real legal consequences. I have tried hard to label what is
verified fact, what is my inference, and what I could not confirm. But labeling my own uncertainty is
not the same as being right.

Several of the most important conclusions here are **inferences from analogous cases and from one
closely-matching lawsuit**, not statements of settled law. Fair use is decided case by case on
specific facts. Damages depend on how a court counts "works." Contract terms I have described come
from LSAC's own characterization of its agreements in litigation, not from the agreement itself.
Timelines and qualification requirements for the licensing program are genuinely unknown.

**Before any commercial launch — and before contacting LSAC — have a qualified intellectual property
attorney review the actual question bank, the actual product, and the actual license agreement.**
The specific questions worth paying for are:

1. Disclosure strategy — whether, when, and how to tell LSAC about the prior use (§7.4)
2. Whether the product name creates independent Lanham Act exposure (§8.1)
3. Review of the Content License Agreement before signing (§4.4)
4. What a defensible original-item generation pipeline looks like, if you go that route (§6.5)
5. Whether importing a student's own LawHub results, without displaying item text, requires a
   license (§4.6, §5.2)

An hour or two of a real IP lawyer's time is the cheapest line item in this entire analysis, and it
is the one I would spend first.
