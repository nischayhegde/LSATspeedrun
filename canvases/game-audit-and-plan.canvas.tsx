import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

/* ------------------------------------------------------------------ */
/* Findings — from the end-to-end playthrough audit (Aug 4 2026).       */
/* `status` and `now` are a re-verification against the working tree of */
/* feat/3d-overhaul-and-tycoon-mechanics on Aug 6 2026, read from the   */
/* code rather than from the audit's own plan.                          */
/* ------------------------------------------------------------------ */

type Status = "Closed" | "Partial" | "Open";

const statusTone: Record<Status, "success" | "warning" | "danger"> = {
  Closed: "success",
  Partial: "warning",
  Open: "danger",
};

const findings: Array<{
  id: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status: Status;
  now: string;
}> = [
  {
    id: "#1",
    title: "Mega-Litigation promotions are uncapped, free, and repeatable",
    severity: "Critical",
    status: "Closed",
    now:
      "game.py holds MEGA_LITIGATION_PROMOTION_COOLDOWN of 24h and a lifetime LIMIT of 3, counted on profiles.mega_litigation_promotions (migration 0024). mega_litigation_promotion_state reports cooldown vs lifetime_limit, and the grant is ledger-idempotent rather than session-idempotent.",
  },
  {
    id: "#2",
    title: "Firm-tier progression fully decoupled from story chapters",
    severity: "Critical",
    status: "Closed",
    now:
      "Two mechanisms. narrative.tsx raises a docked chapter prompt on tier-up (\u201cHEADQUARTERS n REACHED \u00b7 Take the meeting / Not now\u201d), and every non-shadow quest now carries requires_chapter, so an unplayed act hard-blocks the caseboard instead of merely not being shown.",
  },
  {
    id: "#3",
    title: "All quests unlock at once, final quest reachable first",
    severity: "Critical",
    status: "Closed",
    now:
      "19 quests (up from 15), each with a requires_chapter and a requires predecessor list. _quest_locks returns player-readable prerequisites; constellation_charter needs lunar_workers_appeal, orbital_signal and the name_in_the_sky chapter, so it can no longer be first.",
  },
  {
    id: "#4",
    title: "No ending: finale is a sidebar label change",
    severity: "Critical",
    status: "Closed",
    now:
      "story.py ships EPILOGUE_ENDINGS in three written variants keyed on the finale choice, plus EPILOGUE_PROMISE and EPILOGUE_ALIGNMENT. Served by GET/POST /game/story/epilogue, acknowledged once per account via player_story_states.epilogue_read_at (migration 0030).",
  },
  {
    id: "#5",
    title: "Correct answers can lose reputation and pay $0 on a 'generic' grade",
    severity: "High",
    status: "Closed",
    now:
      "The subjective \u201cgeneric\u201d rubric line is gone. Invalid is now an enumerated factual finding with an explicit tie-break to Weak, and game.py caps a correct answer's reputation loss at CORRECT_DROP_CAP = 1.5. THIN_WIN and UNGRADED multipliers cover the adjacent cases.",
  },
  {
    id: "#6",
    title: "DIAGNOSTIC_SIZE env var is read nowhere (name drift)",
    severity: "High",
    status: "Closed",
    now:
      "__init__.py reads DIAGNOSTIC_SESSION_SIZE or DIAGNOSTIC_SIZE, whichever is set, and logs a warning when the configured size diverges from the scoring reference form length.",
  },
  {
    id: "#7",
    title: "21-step tour is unskippable and keyed only to localStorage",
    severity: "High",
    status: "Closed",
    now:
      "Completion is server state on users.guided_tour_completed_at (migration 0025), written through api.updateMe. The tour carries a \u201cSkip the tour\u201d button, a close control, Escape, and header replay; its own copy now reads \u201cOptional orientation\u201d.",
  },
  {
    id: "#8",
    title: "Story cutscene and guided tour can both be active on /office",
    severity: "High",
    status: "Closed",
    now:
      "overlays.tsx is a single owner for \u201ca blocking full-screen layer is up\u201d. OVERLAY_PRIORITY ranks guided-tour 300, epilogue 250, story-cutscene 200, streak-welcome 150; exactly one renders, one Escape listener serves it, and the persistence rule per layer is written down.",
  },
  {
    id: "#9",
    title: "Coaching is a synchronous 20-30s blocking call per case",
    severity: "Medium",
    status: "Partial",
    now:
      "The async path is built end-to-end: AiJob rows, enqueue_coaching_job, HTTP 202 plus polling, and either an SQS worker or an in-process thread. But AI_JOBS_MODE defaults to \u201clocal\u201d in development and \u201csync\u201d in production, so the deployed default is still the blocking in-request call.",
  },
  {
    id: "#10",
    title: "Reputation swings \u00b14 on a single event from the 50.0 default",
    severity: "Medium",
    status: "Closed",
    now:
      "REPUTATION_WARMUP_CASES = 10 and REPUTATION_WARMUP_FLOOR = 0.55 scale the per-case drop ceiling in over the first ten cases, preserving every ordering the guards establish. Client and asset reputation_guard reduce the ceiling further; pro bono matters cap losses at 0.5.",
  },
  {
    id: "#11",
    title: "Endgame numbers reach $1.4T cash, header reads '640 Q'",
    severity: "Medium",
    status: "Partial",
    now:
      "The ladder was repriced: headquarters top out at $240M and all 15 combined cost $479M, and formatMoney now uses Intl compact notation, so no bespoke \u201cQ\u201d suffix can appear. But the catalog still reaches $140B for the final rival acquisition and about $715B to buy every asset and rival \u2014 legible, not human-scale.",
  },
  {
    id: "#12",
    title: "Spaced-repetition mastery gates nothing in progression",
    severity: "Medium",
    status: "Partial",
    now:
      "advance_firm still gates only on reputation, prerequisite assets and cash \u2014 no mastery gate was built. The premise changed instead: build_practice_session interleaves due FSRS-6 review cards through every run rather than parking them in an optional queue, so reviews are no longer skippable.",
  },
];

const statusCount = (status: Status) =>
  findings.filter((f) => f.status === status).length;

/* ------------------------------------------------------------------ */

const phases: Array<{
  n: string;
  name: string;
  state: string;
  goal: string;
  items: Array<{ refs: string; what: string; status: Status; how: string }>;
}> = [
  {
    n: "01",
    name: "Stop the bleeding",
    state: "All three shipped",
    goal:
      "Close the exploit that invalidates the whole economy. Nothing else on this list mattered until progression could not be short-circuited.",
    items: [
      {
        refs: "#1",
        what: "Cap Mega-Litigation promotions",
        status: "Closed",
        how:
          "Shipped as a 24-hour cooldown plus a lifetime allowance of 3, which keeps the free route to roughly a fifth of the fifteen-tier ladder and puts three days between the first tier and the last free one.",
      },
      {
        refs: "#6",
        what: "Fix the env var name drift",
        status: "Closed",
        how:
          "Shipped, and slightly larger than the one-line rename planned: both names are accepted and the app warns when the configured diagnostic size disagrees with the scoring reference form.",
      },
      {
        refs: "#8",
        what: "Make tour and cutscene mutually exclusive",
        status: "Closed",
        how:
          "Shipped as the single-owner overlay registry the plan asked for, generalised to four layers with documented priorities, one Escape owner, and a written policy for where each dismissal is persisted.",
      },
    ],
  },
  {
    n: "02",
    name: "Restore the intended pace",
    state: "Rebalanced; mastery gate declined",
    goal:
      "Rebalance so reaching the end actually costs 30-180 hours. The question bank was never the constraint \u2014 the thresholds were.",
    items: [
      {
        refs: "#1 #11",
        what: "Rescale tier costs and reputation thresholds",
        status: "Closed",
        how:
          "Repaced three times since the audit and stamped as RULE_VERSION lsat-tycoon-v8. Client fees fell about 5.6x, the daily-goal reward was requoted in cases, and TIER_EFFORT_BASE was tuned to 5.33 so a purchase costs one to two hours for both a daily-claiming and a non-claiming player.",
      },
      {
        refs: "#12",
        what: "Decide whether review mastery gates progression",
        status: "Partial",
        how:
          "Decided the other way, and the decision looks right. No gate was added to advance_firm; instead FSRS-6 scheduling and genuine interleaving put due reviews inside ordinary practice runs, so time-on-task comes from reviews being unavoidable rather than from a threshold that can be failed.",
      },
    ],
  },
  {
    n: "03",
    name: "Make the story actually happen",
    state: "All three shipped",
    goal:
      "At audit time a player could hit max tier having seen none of the 8 chapters, then blitz all of them in under a minute.",
    items: [
      {
        refs: "#2",
        what: "Surface pending chapters as tiers advance",
        status: "Closed",
        how:
          "Shipped as a docked prompt on tier-up with a \u201cNot now\u201d deferral remembered per pending chapter, plus the stronger fix the plan did not ask for: quests will not open until the chapter has actually been played.",
      },
      {
        refs: "#3",
        what: "Sequence the quest chain",
        status: "Closed",
        how:
          "Shipped, and the chain is a two-track graph rather than a line: public-interest and investigation work are both required and both feed the finale, while shadow files stay an optional parallel track off the critical path.",
      },
      {
        refs: "#4",
        what: "Build a real ending",
        status: "Closed",
        how:
          "Shipped well past the \u201cepilogue moment\u201d in the plan: three written endings selected by the finale choice, a callback to the first chapter's promise, an alignment line, and a once-per-account acknowledgement.",
      },
    ],
  },
  {
    n: "04",
    name: "Fairness and friction",
    state: "Two shipped, one config-gated",
    goal:
      "Fix the parts that would read as arbitrary or punishing to a real student.",
    items: [
      {
        refs: "#5 #10",
        what: "Stop punishing correct answers",
        status: "Closed",
        how:
          "Shipped on both halves: the rubric no longer lets a subjective impression become a factual finding, and a correct answer's reputation loss is hard-capped. enforcement.py cites this episode as the reason no model opinion is ever allowed to block a submission.",
      },
      {
        refs: "#7",
        what: "Add a tour skip and server-side completion",
        status: "Closed",
        how:
          "Shipped exactly as planned \u2014 account-scoped completion, an explicit skip, Escape, and replay \u2014 and generalised into the overlay persistence policy that also covers the epilogue.",
      },
      {
        refs: "#9",
        what: "Move coaching off the critical path",
        status: "Partial",
        how:
          "The mechanism exists and works; the production default does not use it. Flipping AI_JOBS_MODE to local or sqs in production is the remaining step, and it is the single largest quality-of-life item left on this board.",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */

const shippedBeyondPlan: Array<[string, string, string]> = [
  [
    "FSRS-6 review scheduling",
    "Verbatim FSRS-6 parameters, retrievability ordering, and interleaving that distributes reviews through a run instead of stacking them first.",
    "scheduling.py",
  ],
  [
    "Strategy enforcement gates",
    "\u201cUse it\u201d arms a structural gate \u2014 choices withheld until a prediction is written, selection refused until eliminations are struck. Deterministic checks only.",
    "enforcement.py \u00b7 0028",
  ],
  [
    "LSAC-grounded score projection",
    "Raw-to-scaled conversion with an equating-error admission and a reported band rather than a point estimate.",
    "scoring.py \u00b7 0027",
  ],
  [
    "Answer history",
    "Paginated, eager-loaded read paths over every attempt ever submitted, so \u201cevery Assumption question I have missed\u201d is answerable.",
    "history.py",
  ],
  [
    "District retainers",
    "A 38-district board bought with casework, paying standing and rent relief, both apportioned by largest remainder.",
    "game.py \u00b7 0032",
  ],
  [
    "Trial calendar",
    "The learner's real LSAT date as a court date, with the remaining gap inverted out of the projection estimator rather than guessed.",
    "trial.py",
  ],
  [
    "Rent-relief apportionment fix",
    "Independent rounding summed to 9,998 of 10,000 bps, so holding every district left a 960/day lease at tier 14. Exact apportionment makes the headline promise true by construction.",
    "game.py \u00b7 _apportion_exactly",
  ],
];

/* ------------------------------------------------------------------ */

function Header() {
  const theme = useHostTheme();
  return (
    <Stack gap={8}>
      <Row gap={10} align="center" wrap>
        <H1 style={{ margin: 0 }}>Game audit and remediation plan</H1>
        <Pill size="sm">LSAT Tycoon</Pill>
        <Pill size="sm">Status re-verified</Pill>
      </Row>
      <Text tone="secondary">
        End-to-end playthrough to true max-tier end-state (tier 14, reputation
        100, all 8 chapters, final quest cleared) on two independent
        progression paths, via real UI and real API calls. Every finding below
        carries its original severity and a current status read from the code.
      </Text>
      <Text size="small" style={{ color: theme.text.tertiary }}>
        Sources: full-playthrough QA audit, Aug 4 2026 (12 findings) ·
        status re-verified against the working tree of
        feat/3d-overhaul-and-tycoon-mechanics, Aug 6 2026
      </Text>
    </Stack>
  );
}

function Verdict() {
  return (
    <Callout
      tone="success"
      title="The finding that defined the audit is closed, and the pace target is now met"
    >
      At audit time a fresh account reached tier 14 in fourteen consecutive
      diagnostics — zero cash spent, zero upgrades bought, zero reasoning
      written — and the whole game fell in 24-37 hours against a 30-180 hour
      target. The promotion now costs a 24-hour wait and runs out after three
      uses, and the economy has been repaced three times since. A full campaign
      is modelled at 120-133 hours of case time, inside the band. Three of the
      twelve findings remain partly open; none of them are the exploit.
    </Callout>
  );
}

function Numbers() {
  return (
    <Grid columns={4} gap={16}>
      <Stat value={`${statusCount("Closed")} / 12`} label="Findings closed" tone="success" />
      <Stat value={`${statusCount("Partial")} / 12`} label="Partly open" tone="warning" />
      <Stat value="120-133h" label="Modelled campaign, case time only" />
      <Stat value="~30%" label="Question bank a full campaign consumes" />
    </Grid>
  );
}

function PacingChart() {
  return (
    <Stack gap={6}>
      <H3 style={{ margin: 0 }}>
        Hours to reach the end-state: as audited vs. as currently modelled
      </H3>
      <BarChart
        categories={[
          "Audit \u00b7 Path B, diagnostic chaining",
          "Audit \u00b7 Path A, economy grind",
          "Current \u00b7 claims daily goals",
          "Current \u00b7 never claims",
        ]}
        series={[{ name: "Hours of engaged play to finish", data: [27, 37, 120, 133] }]}
        valueSuffix=" h"
        horizontal
        showValues
        referenceLines={[
          { value: 30, label: "Target floor", tone: "warning" },
          { value: 180, label: "Target ceiling", tone: "danger" },
        ]}
        height={230}
      />
      <Text size="small" tone="tertiary">
        Hours (engaged play). Audit bars are the Aug 4 measured pace; current
        bars are game.py's own model of buying the 93 mandatory purchases and
        count case time only, excluding coaching, story beats and the district
        map. Target band is 1-2 months at 1-3 h/day.
      </Text>
    </Stack>
  );
}

function BankChart() {
  return (
    <Stack gap={6}>
      <H3 style={{ margin: 0 }}>Questions a full campaign consumes vs. bank size</H3>
      <BarChart
        categories={[
          "Audit \u00b7 Path A",
          "Audit \u00b7 Path B",
          "Current campaign",
          "Full bank available",
        ]}
        series={[{ name: "Questions consumed", data: [640, 1090, 2061, 6886] }]}
        showValues
        height={230}
      />
      <Text size="small" tone="tertiary">
        Questions (count). Bank is 6,886 total (4,520 LR + 2,366 RC). A full
        campaign moved from 10-16% of the bank at audit time to about 30%, so
        the bank still holds roughly three campaigns of unseen material —
        content volume was never the bottleneck, and is not one now.
      </Text>
    </Stack>
  );
}

function FindingsTable() {
  return (
    <Stack gap={6}>
      <H2 style={{ margin: 0 }}>Findings and current status</H2>
      <Text tone="secondary">
        Severity is as originally assessed. Status is what the code does today.
      </Text>
      <Table
        headers={["", "Finding", "Severity", "Status", "Where it stands now"]}
        rows={findings.map((f) => [f.id, f.title, f.severity, f.status, f.now])}
        rowTone={findings.map((f) => statusTone[f.status])}
        striped
      />
    </Stack>
  );
}

function PhaseCard({ phase }: { phase: (typeof phases)[number] }) {
  const theme = useHostTheme();
  return (
    <Card>
      <CardHeader trailing={<Pill size="sm">{phase.state}</Pill>}>
        {`${phase.n} \u2014 ${phase.name}`}
      </CardHeader>
      <CardBody>
        <Stack gap={12}>
          <Text tone="secondary">{phase.goal}</Text>
          <Divider />
          {phase.items.map((item, i) => (
            <div key={item.what}>
              <Stack gap={4}>
                {i > 0 ? <Divider /> : null}
                <Row gap={8} align="center" wrap>
                  <Text weight="semibold">{item.what}</Text>
                  <Pill size="sm">
                    {item.status === "Closed" ? "Shipped" : item.status}
                  </Pill>
                  <Text size="small" style={{ color: theme.text.quaternary }}>
                    {item.refs}
                  </Text>
                </Row>
                <Text size="small" tone="secondary">
                  {item.how}
                </Text>
              </Stack>
            </div>
          ))}
        </Stack>
      </CardBody>
    </Card>
  );
}

function Plan() {
  return (
    <Stack gap={10}>
      <H2 style={{ margin: 0 }}>Remediation plan, and what became of it</H2>
      <Text tone="secondary">
        Ordered by dependency, as written. Ten of the eleven plan items shipped;
        one was deliberately answered a different way and one is built but
        switched off in production.
      </Text>
      <Grid columns={2} gap={16} align="start">
        {phases.map((p) => (
          <div key={p.n}>
            <PhaseCard phase={p} />
          </div>
        ))}
      </Grid>
    </Stack>
  );
}

function BeyondPlan() {
  return (
    <Stack gap={6}>
      <H2 style={{ margin: 0 }}>Built since the audit, outside the plan</H2>
      <Text tone="secondary">
        None of these were remediation items. They matter for reading the plan
        above, because two of them are why finding #12 was answered without a
        gate and why the pacing numbers moved.
      </Text>
      <Table
        headers={["System", "What it does", "Where"]}
        rows={shippedBeyondPlan.map((row) => [row[0], row[1], row[2]])}
        striped
      />
    </Stack>
  );
}

function ContentDepth() {
  return (
    <Card>
      <CardHeader trailing={<Pill size="sm">Re-assessed</Pill>}>
        Content depth against 1-2 months at 1-3 h/day
      </CardHeader>
      <CardBody>
        <Stack gap={14}>
          <Text>
            The audit's diagnosis holds and its numbers do not. It concluded
            that content volume was never the constraint and that the shortfall
            was gating and balance; that was correct, and the balance work
            landed. But it measured a game that could be finished in 24-37 hours
            against an economy that has since been retuned three times, so the
            24-37h figure and the 10-16% bank-usage figure should not be quoted
            as current.
          </Text>
          <Divider />
          <Grid columns={3} gap={16}>
            <Stat value="93" label="Mandatory purchases (79 assets + 14 HQ)" />
            <Stat value="2,061" label="Played cases to buy the catalog out" />
            <Stat value="~3.5 min" label="Modelled time per played case" />
          </Grid>
          <Text>
            game.py's own pacing model puts a full campaign at roughly 2,061
            played cases and 120 hours of case time for a player who claims
            daily goals, and 2,282 cases and 133 hours for one who never does.
            That is two months at two hours a day, or four months at one —
            inside the target band, in its upper half, and a floor rather than a
            ceiling, since it counts case time only and excludes coaching, story
            beats and the district map.
          </Text>
          <Text tone="secondary">
            Two honest caveats. First, the band is now tight: the model reports
            0.2% of clearance at the floor for a daily-claiming player and 4.8%
            at the ceiling for a non-claiming one, so the risk has moved from
            “not enough content” to “any new income source re-opens the pacing
            question and has to be measured before it ships”.
            Second, buying the catalog out is not the same as exhausting the
            app: at about 30% of the bank consumed, roughly 4,800 questions
            remain unseen after a full campaign, which is depth for continued
            practice but not additional authored content.
          </Text>
        </Stack>
      </CardBody>
    </Card>
  );
}

function Remaining() {
  return (
    <Callout tone="warning" title="What is actually left">
      Coaching still runs in-request in production (#9) — flipping
      AI_JOBS_MODE to local or sqs is the single largest remaining
      quality-of-life change, worth hours of dead spinner time over a 120-hour
      campaign. Late-game money is legible but still enormous (#11): buying
      every asset and rival runs about $715B, and the final rival acquisition
      alone costs $140B. And no explicit
      mastery gate exists on tier advance (#12), which is now a defensible
      product position rather than an oversight, since reviews are interleaved
      into ordinary practice and can no longer be avoided.
    </Callout>
  );
}

export default function GameAuditAndPlan() {
  return (
    <Stack gap={28} style={{ padding: 28, maxWidth: 1080 }}>
      <Header />
      <Verdict />
      <Numbers />
      <Grid columns={2} gap={24} align="start">
        <PacingChart />
        <BankChart />
      </Grid>
      <FindingsTable />
      <Plan />
      <ContentDepth />
      <BeyondPlan />
      <Remaining />
    </Stack>
  );
}
