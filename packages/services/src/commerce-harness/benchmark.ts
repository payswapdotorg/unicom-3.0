// ============================================================
// Commerce harness — L5 benchmark, lane R7 (HARNESS-CONTRACT.md §1 L5 + §3)
// ============================================================
//
// The fixed intent corpus × three comparators, scored on the L5 denominators
// (issue #23 acceptance evidence 6; the R7 lane — the claim's arbiter).
// The corpus itself (the 10 labelled fixture cases + the fixture plumbing)
// lives in ./benchmark-corpus.ts — this module owns the comparators, the
// measurement and the aggregation, and re-exports the corpus surface.
//
// THE COMPARATORS: exactly ONE is real code — `unicom-harness` runs the REAL
// runHarnessFlow over each case's fixture stores and fixture observations.
// The other two are labelled fixture-tier SIMULATIONS of incumbent behavior
// over the SAME fixture observations (meta.comparatorsSimulated: true):
//   - provider-native-incumbent: one provider's native app, one store, no
//     cross-store comparison, no counterfactual families.
//   - general-purpose-baseline: all stores, no hard-constraint envelope,
//     naive listed-price ranking, no counterfactuals.
// A live-tier comparative run is OWED (meta.liveTierOwed: true) before any
// comparative claim leaves the fixture tier. No multiplier language appears
// anywhere in this module — raw denominators only (the issue #23 E-law).
//
// LAWS (HARNESS-CONTRACT §1 L5 + §2):
//   - INV-10 UNKNOWN: a comparator that cannot judge task success records
//     null + cannotJudge — never a guessed verdict; a precision with zero
//     claims is null, never zero; a ground-truth saving that is unknowable in
//     principle stays null.
//   - INV-14 money: every monetary number in every result is an exact string
//     decimal + an explicit currency; comparisons are same-currency only;
//     cross-currency never enters a verdict. The simulated baseline's naive
//     cross-currency ranking is SCORED as violated — measured, never adopted.
//   - INV-30 evidence classes: a feasible family slot is a capability
//     verdict, never a savings claim; the harness's candidates stay
//     conditional/predicted (see the opportunity denominators below).
//   - INV-51: the fixture tier is a deployment constraint of THIS benchmark
//     (the campaign authorizes no live provider credentials) — never domain
//     semantics. Fixture/free-tier limits are reported, never baked in.
//   - GOVERNED_EXECUTION_BASELINE (execution.ts): unauthorizedActions,
//     privacyLeaks and humanInterventions are literal zeros on every result —
//     any non-zero is a defect, not a statistic.
//
// THE OPPORTUNITY DENOMINATORS (stated precisely, so the numbers stay honest):
//   - surfaced feasible families: families whose candidates the real harness
//     marked `feasible` (at fixture tier approved_substitutes and wait_or_buy
//     answer feasible by construction — re-searching and waiting are
//     exercisable through the connected read-only capability).
//   - savings claim: a feasible candidate asserting a currently-grounded
//     in-budget outcome — the shipped module's only such sentence is the
//     approved-substitutes "An in-budget purchase today" claim. wait_or_buy
//     claims no magnitude by its own text, so it never enters this set.
//   - trueSavings: the ground truth's realizableFamily is among the surfaced
//     feasible families (the harness surfaced the realizable lane).
//   - falseSavings: a savings claim exists while ground truth says NO family
//     is realizable — a claimed saving that does not exist.
//   - opportunityPrecision = ground-truth-matching savings claims / all
//     savings claims (null when the harness made none — INV-10).
//   - opportunityRecall = realizable cases surfaced feasible / all
//     ground-truth realizable cases (null when the corpus has none).
//
// CLOCK LAW: every timestamp reads the injected `now` — no Date.now() in any
// logic path. The shipped planner measures its own wall latency with
// Date.now() inside runHarnessFlow; that number is deliberately never
// serialized into a result — this benchmark's latencyMs is the modeled
// fixture step latency (FIXTURE_STEP_LATENCY_MS per tool call, labelled
// not-live in meta), so a fixed clock makes the whole run byte-deterministic.

import type { ObservedFinding } from "./execution.js";
import { findingSubtotal } from "./finding-money.js";
import { formatHarnessMoney } from "./intent.js";
import type { HarnessMoney } from "./intent.js";
import type { HarnessOpportunityCandidate, OpportunityFamilyId } from "./families.js";
import {
  buildShortlist,
  isSearchableHarnessStore,
  projectStoreTarget,
  runHarnessFlow,
} from "./planner.js";
import type { ConnectedStoreRecords } from "./planner.js";
import type { PerStoreEntry, ShortlistOffer } from "./outcome.js";
import {
  BENCHMARK_CORPUS,
  FIXTURE_STEP_LATENCY_MS,
  fixtureObservation,
  makeFixtureStepExecutor,
} from "./benchmark-corpus.js";
import type {
  BenchmarkFindingFixture,
  BenchmarkGroundTruth,
  BenchmarkIntentCase,
  BenchmarkStoreErrorFixture,
} from "./benchmark-corpus.js";

// ——— the corpus surface, re-exported (one import face for consumers) ———

export { BENCHMARK_CORPUS, FIXTURE_STEP_LATENCY_MS } from "./benchmark-corpus.js";
export type {
  BenchmarkFindingFixture,
  BenchmarkGroundTruth,
  BenchmarkIntentCase,
  BenchmarkStoreErrorFixture,
} from "./benchmark-corpus.js";

// ——— the result types (the L5 denominators, per case × comparator) ———

/** The three comparators. Exactly one is real code; two are labelled simulations. */
export type BenchmarkComparatorId =
  | "unicom-harness"
  | "provider-native-incumbent"
  | "general-purpose-baseline";

/** Cost correctness (INV-14): unknowns marked exactly, or a money law violated. */
export type BenchmarkCostCorrectness = "exact-unknowns-marked" | "violated";

/** Savings verdict: measured boolean for the harness; "not-applicable" for policies that never propose. */
export type BenchmarkSavingsVerdict = boolean | "not-applicable";

/** One comparator's measured outcome on one case (per case × comparator). */
export interface BenchmarkCaseResult {
  tier: "fixture";
  caseId: string;
  caseLabel: string;
  comparator: BenchmarkComparatorId;
  /** The honest policy statement (simulations say SIMULATED and why). */
  comparatorDescription: string;
  /** True for the two simulated policies; false only for the real harness. */
  simulated: boolean;
  /** Ground truth echoed for artifact self-containment (the corpus is the source). */
  groundTruth: BenchmarkGroundTruth;
  /** Null = cannot judge (INV-10) — counted as not-successful, flagged cannotJudge. */
  taskSuccess: boolean | null;
  cannotJudge: boolean;
  taskSuccessDetail: string;
  costCorrectness: BenchmarkCostCorrectness;
  costCorrectnessDetail: string;
  trueSavings: BenchmarkSavingsVerdict;
  falseSavings: BenchmarkSavingsVerdict;
  savingsDetail: string;
  /** Opportunities whose evidence expired before the run clock (harness must be 0). */
  freshnessViolations: number;
  /** Modeled fixture step latency (meta.latencyBasis) — never a wall-clock claim. */
  latencyMs: number;
  /** Tool calls the comparator's policy performed over the fixture map. */
  toolCalls: number;
  unauthorizedActions: 0;
  privacyLeaks: 0;
  humanInterventions: 0;
  searchedDomains: string[];
  findingsConsidered: number;
  bestOfferPrice: HarnessMoney | null;
  /** Harness-only surfaces (absent on the simulated policies). */
  shortlistSize?: number;
  feasibleFamilies?: OpportunityFamilyId[];
  savingsClaimFamilies?: OpportunityFamilyId[];
  perStore?: PerStoreEntry[];
}

/** The per-comparator corpus aggregate (raw rates — never multiplier language). */
export interface BenchmarkAggregate {
  tier: "fixture";
  comparator: BenchmarkComparatorId;
  simulated: boolean;
  cases: number;
  /** Successes / cases (cannot-judge counts as not-successful). */
  taskSuccessRate: number;
  costCorrectnessRate: number;
  cannotJudgeCount: number;
  trueSavingsCount: number;
  falseSavingsCount: number;
  /** False for the simulated policies: their savings counts are structurally not-applicable. */
  savingsApplicable: boolean;
  /** Null when no claims were made (harness) or the comparator never proposes (INV-10). */
  opportunityPrecision: number | null;
  opportunityRecall: number | null;
  freshnessViolations: number;
  unauthorizedActions: 0;
  privacyLeaks: 0;
  humanInterventions: 0;
  medianLatencyMs: number;
  totalToolCalls: number;
}

/** The run's meta — the fixture-tier honesty labels (tier, simulation, owed live tier). */
export interface BenchmarkRunMeta {
  tier: "fixture";
  generatedAt: string;
  corpusSize: number;
  comparatorsSimulated: true;
  liveTierOwed: true;
  latencyBasis: "modeled-fixture-step-latency-not-live";
}

/** The whole run: meta + per case × comparator + per-comparator aggregates. */
export interface BenchmarkRunResult {
  meta: BenchmarkRunMeta;
  perCase: BenchmarkCaseResult[];
  aggregate: Record<BenchmarkComparatorId, BenchmarkAggregate>;
}

// ——— the comparator descriptions (honest policy statements) ———

const HARNESS_COMPARATOR_DESCRIPTION =
  "The REAL commerce-harness flow (runHarnessFlow) over this case's fixture stores and fixture " +
  "observations — the only real code path in this benchmark (read-only authority, fixture tier; " +
  "no live provider is contacted).";

const INCUMBENT_COMPARATOR_DESCRIPTION =
  "SIMULATED policy (fixture-tier simulation of incumbent behavior — NOT a live provider " +
  "measurement): a principal on one provider's native app searches only that provider's store " +
  "(the case's first store). It cannot compare cross-store, cannot evaluate counterfactual " +
  "families, and cannot verify constraints beyond what that single store's findings state; its " +
  "task success requires that single store's findings to satisfy the intent's hard constraints " +
  "(the same L5 law, single-store view).";

const BASELINE_COMPARATOR_DESCRIPTION =
  "SIMULATED policy (fixture-tier simulation — NOT a live assistant measurement): a generic " +
  "assistant searches every searchable store but carries no hard-constraint envelope (no " +
  "budget or size filtering), ranks naively by listed price (bare numbers — cross-currency " +
  "comparisons included), marks landed totals unknown, and never proposes counterfactuals. It " +
  "cannot judge constraint satisfaction (cannot-judge).";

// ——— shared measurement helpers ———

/**
 * The shipped module's ONLY currently-grounded savings claim: the
 * approved-substitutes family asserting an in-budget purchase from observed
 * prices ("An in-budget purchase today…"). Every other feasible family
 * (wait_or_buy) explicitly claims no magnitude. Structural check over the
 * shipped sentence — the contract test cross-checks it against the
 * fixture-derived in-budget computation, so upstream rewording fails loudly.
 */
function isSavingsBearingClaim(candidate: HarnessOpportunityCandidate): boolean {
  return (
    candidate.family === "approved_substitutes" &&
    candidate.feasibility === "feasible" &&
    candidate.predictedOutcome.startsWith("An in-budget purchase today")
  );
}

/** Project a platform listed price through the canonical exact boundary (W1-a — never rounds; sub-cent precision refuses to project). */
function projectListedPrice(finding: ObservedFinding): HarnessMoney | null {
  return findingSubtotal(finding);
}

/** MEASURE the money laws over a shortlist (never assert them): unknowns stay unknown, no FX enters a verdict. */
function shortlistCostViolations(
  shortlist: ShortlistOffer[],
  budget: HarnessMoney | undefined,
): string[] {
  const violations: string[] = [];
  for (const offer of shortlist) {
    if (
      offer.landedTotal.total !== null &&
      (offer.landedTotal.shipping === null || offer.landedTotal.tax === null || offer.landedTotal.duties === null)
    ) {
      violations.push(`a landed total was summed over unobserved components (${offer.title})`);
    }
    if (
      budget !== undefined &&
      offer.landedTotal.subtotal !== null &&
      offer.landedTotal.subtotal.currency !== budget.currency &&
      offer.constraints.some((entry) => entry.constraint === "budget" && entry.status !== "unknown")
    ) {
      violations.push(`a cross-currency budget verdict was issued (${offer.title}) — an invented exchange rate`);
    }
  }
  return violations;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1] ?? 0;
  const right = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? right : (left + right) / 2;
}

// ——— comparator 1: the REAL harness (the only real code path) ———

async function runHarnessComparatorCase(
  caseData: BenchmarkIntentCase,
  now: () => Date,
): Promise<BenchmarkCaseResult> {
  const flow = await runHarnessFlow({
    intent: caseData.intent,
    readStores: async (): Promise<ConnectedStoreRecords> => ({ stores: [...caseData.stores] }),
    executeStep: makeFixtureStepExecutor(caseData, now),
    now,
  });
  const gt = caseData.groundTruth;
  const budget = caseData.intent.maxLandedTotalCost;

  const feasibleFamilies = flow.opportunities
    .filter((candidate) => candidate.feasibility === "feasible")
    .map((candidate) => candidate.family);
  const savingsClaimFamilies = flow.opportunities
    .filter((candidate) => isSavingsBearingClaim(candidate))
    .map((candidate) => candidate.family);
  const trueSavings: boolean =
    gt.realizableFamily !== null && feasibleFamilies.includes(gt.realizableFamily);
  const falseSavings: boolean = savingsClaimFamilies.length > 0 && gt.realizableFamily === null;

  const runClockMs = now().getTime();
  const freshnessViolations = flow.opportunities.filter(
    (candidate) =>
      candidate.evidence.expiresAt !== null && Date.parse(candidate.evidence.expiresAt) < runClockMs,
  ).length;

  // MEASURED cost correctness (never asserted): the money laws over the real
  // shortlist + the predicted-totals FX law (a "best" despite zero currency
  // match would be an invented exchange rate — the harness never does).
  const costViolations = shortlistCostViolations(flow.shortlist, budget);
  if (flow.evaluation.predictedTotals.currencyMatch === false && flow.evaluation.predictedTotals.bestObservedSubtotal !== null) {
    costViolations.push("a best observed subtotal was claimed despite no same-currency match");
  }
  const costCorrectness: BenchmarkCostCorrectness =
    costViolations.length === 0 ? "exact-unknowns-marked" : "violated";

  const gtCandidate =
    gt.realizableFamily === null
      ? undefined
      : flow.opportunities.find((candidate) => candidate.family === gt.realizableFamily);
  const savingsDetail =
    `ground truth certifies ${gt.realizableFamily ?? "no realizable family"}` +
    ` (true savings ${gt.trueSavings === null ? "unknown" : formatHarnessMoney(gt.trueSavings)}); ` +
    `surfaced feasible: [${feasibleFamilies.join(", ") || "none"}]; savings claims: [${savingsClaimFamilies.join(", ") || "none"}]` +
    (gtCandidate === undefined
      ? ""
      : `; the ground-truth family answered ${gtCandidate.feasibility}`) +
    (trueSavings
      ? " — the realizable lane was surfaced feasible"
      : gt.realizableFamily !== null
        ? " — an honest fixture-tier miss, reported not hidden"
        : "");

  const toolCalls = flow.plan.steps.length;
  const searchedDomains = [...new Set(flow.plan.steps.map((step) => step.target.domain))];
  const findingsConsidered = flow.perStore.reduce(
    (total, entry) => total + (entry.status === "ok" ? entry.count : 0),
    0,
  );

  return {
    tier: "fixture",
    caseId: caseData.id,
    caseLabel: caseData.label,
    comparator: "unicom-harness",
    comparatorDescription: HARNESS_COMPARATOR_DESCRIPTION,
    simulated: false,
    groundTruth: gt,
    taskSuccess: flow.outcome.success,
    cannotJudge: false,
    taskSuccessDetail:
      flow.outcome.success === true
        ? `the real flow shortlisted ${flow.shortlist.length} offer(s) across ${searchedDomains.join(", ") || "no store"} — success per the L5 law (non-empty shortlist, zero violated hard constraints, unknowns marked)`
        : "the real flow shortlisted zero offers — an honest empty (the binding constraint is recorded in the intent-level satisfaction), never a fabricated offer",
    costCorrectness,
    costCorrectnessDetail:
      costCorrectness === "exact-unknowns-marked"
        ? "every landed total stays null where a component is unobserved; no cross-currency comparison entered a budget verdict; the best observed subtotal is same-currency only"
        : `money-law violation(s) measured on the real flow: ${costViolations.join("; ")}`,
    trueSavings,
    falseSavings,
    savingsDetail,
    freshnessViolations,
    latencyMs: toolCalls * FIXTURE_STEP_LATENCY_MS,
    toolCalls,
    unauthorizedActions: flow.execution.unauthorizedActions,
    privacyLeaks: flow.execution.privacyLeaks,
    humanInterventions: flow.execution.humanInterventions,
    searchedDomains,
    findingsConsidered,
    bestOfferPrice: flow.shortlist[0]?.landedTotal.subtotal ?? null,
    shortlistSize: flow.shortlist.length,
    feasibleFamilies,
    savingsClaimFamilies,
    perStore: flow.perStore,
  };
}

// ——— comparator 2: the provider-native incumbent (SIMULATED, single store) ———

function runIncumbentComparatorCase(
  caseData: BenchmarkIntentCase,
  now: () => Date,
): BenchmarkCaseResult {
  const gt = caseData.groundTruth;
  const firstStore = caseData.stores[0];
  const target = firstStore === undefined ? undefined : projectStoreTarget(firstStore);
  const observation =
    target === undefined
      ? undefined
      : fixtureObservation({
          stepId: "incumbent-single-store-search",
          target,
          query: caseData.intent.query,
          caseData,
          now,
        });
  const shortlist = observation === undefined ? [] : buildShortlist(caseData.intent, [observation]);
  const taskSuccess = shortlist.length > 0;

  // The benchmark's honest annotation (grounded in the same shipped arbiter
  // over EVERY store's exact findings): when the single store fails but a
  // satisfying offer exists elsewhere, the detail says why — the comparator's
  // own simulated limitation, never a rigged failure.
  let crossStoreNote = "";
  if (!taskSuccess && firstStore !== undefined) {
    const allObservations = caseData.stores
      .filter(isSearchableHarnessStore)
      .map((store) =>
        fixtureObservation({
          stepId: "incumbent-annotation-search",
          target: projectStoreTarget(store),
          query: caseData.intent.query,
          caseData,
          now,
        }),
      );
    const elsewhere = buildShortlist(caseData.intent, allObservations);
    const otherDomains = [...new Set(elsewhere.map((offer) => offer.store_domain))];
    if (elsewhere.length > 0) {
      crossStoreNote = ` — an offer satisfying the same constraints existed on ${otherDomains.join(", ")}: cross-store comparison is outside this simulated single-store policy's reach`;
    } else if (observation !== undefined && observation.outcome !== "ok") {
      crossStoreNote = ` — its only store answered ${observation.outcome}`;
    }
  }

  const costViolations = shortlistCostViolations(shortlist, caseData.intent.maxLandedTotalCost);
  const costCorrectness: BenchmarkCostCorrectness =
    costViolations.length === 0 ? "exact-unknowns-marked" : "violated";
  const findingsConsidered =
    observation !== undefined && observation.outcome === "ok" ? observation.findings?.length ?? 0 : 0;

  return {
    tier: "fixture",
    caseId: caseData.id,
    caseLabel: caseData.label,
    comparator: "provider-native-incumbent",
    comparatorDescription: INCUMBENT_COMPARATOR_DESCRIPTION,
    simulated: true,
    groundTruth: gt,
    taskSuccess,
    cannotJudge: false,
    taskSuccessDetail:
      firstStore === undefined
        ? "the case carries no store — the simulated incumbent had nothing to search"
        : taskSuccess
          ? `its single store (${firstStore.label}, ${firstStore.domain}) carried ${shortlist.length} offer(s) with zero violated hard constraints — success under the same L5 law, single-store view`
          : `its single store (${firstStore.label}, ${firstStore.domain}) satisfied no hard constraint${crossStoreNote}`,
    costCorrectness,
    costCorrectnessDetail:
      costCorrectness === "exact-unknowns-marked"
        ? "single-store listed prices passed through verbatim; no totals summed; no FX applied — an unverifiable budget fit stays unverified"
        : `money-law violation(s) measured on the simulated policy: ${costViolations.join("; ")}`,
    trueSavings: "not-applicable",
    falseSavings: "not-applicable",
    savingsDetail:
      "not-applicable — the incumbent never proposes counterfactual families, so there is no savings surface to score (recorded not-applicable, not false)",
    freshnessViolations: 0,
    latencyMs: FIXTURE_STEP_LATENCY_MS,
    toolCalls: 1,
    unauthorizedActions: 0,
    privacyLeaks: 0,
    humanInterventions: 0,
    searchedDomains: firstStore === undefined ? [] : [firstStore.domain],
    findingsConsidered,
    bestOfferPrice: shortlist[0]?.landedTotal.subtotal ?? null,
  };
}

// ——— comparator 3: the general-purpose baseline (SIMULATED, no envelope) ———

function runBaselineComparatorCase(
  caseData: BenchmarkIntentCase,
  now: () => Date,
): BenchmarkCaseResult {
  const gt = caseData.groundTruth;
  const searchableStores = caseData.stores.filter(isSearchableHarnessStore);
  const observations = searchableStores.map((store, index) =>
    fixtureObservation({
      stepId: `baseline-search-${index + 1}`,
      target: projectStoreTarget(store),
      query: caseData.intent.query,
      caseData,
      now,
    }),
  );
  const findings = observations.flatMap((observation) =>
    observation.outcome === "ok" ? observation.findings ?? [] : [],
  );
  const isPriced = (
    finding: ObservedFinding,
  ): finding is ObservedFinding & { price: number; currency: string } =>
    finding.price !== null && finding.currency !== null;
  const priced = findings.filter(isPriced);
  // The naive policy: rank by listed price as BARE numbers — cross-currency
  // comparisons included (the implicit one-to-one exchange assumption the
  // benchmark scores as a cost-correctness violation, never adopts).
  const ranked = [...priced].sort((a, b) => a.price - b.price);
  const best = ranked[0] ?? null;
  const currencies = [...new Set(priced.map((finding) => finding.currency))];
  const costCorrectness: BenchmarkCostCorrectness =
    currencies.length > 1 ? "violated" : "exact-unknowns-marked";

  return {
    tier: "fixture",
    caseId: caseData.id,
    caseLabel: caseData.label,
    comparator: "general-purpose-baseline",
    comparatorDescription: BASELINE_COMPARATOR_DESCRIPTION,
    simulated: true,
    groundTruth: gt,
    taskSuccess: null,
    cannotJudge: true,
    taskSuccessDetail:
      "the baseline carries no hard-constraint envelope — it cannot judge budget, size, condition or deadline satisfaction; recorded cannot-judge (null) and counted as not-successful in the aggregate",
    costCorrectness,
    costCorrectnessDetail:
      costCorrectness === "violated"
        ? `the naive policy ranked listed prices across different currencies (${currencies.join(", ")}) as bare numbers — an implicit one-to-one exchange assumption; FX invented by policy, scored as a violation`
        : "listed prices passed through verbatim; landed totals marked unknown; the naive rank compared same-currency listings only",
    trueSavings: "not-applicable",
    falseSavings: "not-applicable",
    savingsDetail:
      "not-applicable — the baseline never proposes counterfactual families, so there is no savings surface to score (recorded not-applicable, not false)",
    freshnessViolations: 0,
    latencyMs: searchableStores.length * FIXTURE_STEP_LATENCY_MS,
    toolCalls: searchableStores.length,
    unauthorizedActions: 0,
    privacyLeaks: 0,
    humanInterventions: 0,
    searchedDomains: searchableStores.map((store) => store.domain),
    findingsConsidered: findings.length,
    bestOfferPrice: best === null ? null : projectListedPrice(best),
  };
}

// ——— the aggregates (raw rates computed from the measured per-case results) ———

function aggregateFor(
  comparator: BenchmarkComparatorId,
  results: BenchmarkCaseResult[],
): BenchmarkAggregate {
  const cases = results.length;
  const harnessOnly = comparator === "unicom-harness";
  let claims = 0;
  let claimMatches = 0;
  let realizableCases = 0;
  let surfaced = 0;
  for (const result of results) {
    for (const family of result.savingsClaimFamilies ?? []) {
      claims += 1;
      if (result.groundTruth.realizableFamily === family) claimMatches += 1;
    }
    const family = result.groundTruth.realizableFamily;
    if (family !== null) {
      realizableCases += 1;
      if ((result.feasibleFamilies ?? []).includes(family)) surfaced += 1;
    }
  }
  return {
    tier: "fixture",
    comparator,
    simulated: !harnessOnly,
    cases,
    taskSuccessRate: results.filter((result) => result.taskSuccess === true).length / cases,
    costCorrectnessRate:
      results.filter((result) => result.costCorrectness === "exact-unknowns-marked").length / cases,
    cannotJudgeCount: results.filter((result) => result.cannotJudge).length,
    trueSavingsCount: results.filter((result) => result.trueSavings === true).length,
    falseSavingsCount: results.filter((result) => result.falseSavings === true).length,
    savingsApplicable: harnessOnly,
    opportunityPrecision: harnessOnly && claims > 0 ? claimMatches / claims : null,
    opportunityRecall: harnessOnly && realizableCases > 0 ? surfaced / realizableCases : null,
    freshnessViolations: results.reduce((total, result) => total + result.freshnessViolations, 0),
    unauthorizedActions: 0,
    privacyLeaks: 0,
    humanInterventions: 0,
    medianLatencyMs: median(results.map((result) => result.latencyMs)),
    totalToolCalls: results.reduce((total, result) => total + result.toolCalls, 0),
  };
}

// ——— the run (async: the real runHarnessFlow is async — its executor port is a Promise) ———

/**
 * Run the fixed corpus through all three comparators and aggregate the L5
 * denominators. Deterministic under a fixed clock (byte-identical JSON). The
 * real clock is the CALLER's choice — the runner entry is the only sanctioned
 * real-clock call site; the tests inject a fixed clock.
 */
export async function runBenchmarkCorpus(input?: {
  now?: () => Date;
}): Promise<BenchmarkRunResult> {
  const now = input?.now ?? (() => new Date());
  const perCase: BenchmarkCaseResult[] = [];
  for (const caseData of BENCHMARK_CORPUS) {
    perCase.push(await runHarnessComparatorCase(caseData, now));
    perCase.push(runIncumbentComparatorCase(caseData, now));
    perCase.push(runBaselineComparatorCase(caseData, now));
  }
  return {
    meta: {
      tier: "fixture",
      generatedAt: now().toISOString(),
      corpusSize: BENCHMARK_CORPUS.length,
      comparatorsSimulated: true,
      liveTierOwed: true,
      latencyBasis: "modeled-fixture-step-latency-not-live",
    },
    perCase,
    aggregate: {
      "unicom-harness": aggregateFor(
        "unicom-harness",
        perCase.filter((result) => result.comparator === "unicom-harness"),
      ),
      "provider-native-incumbent": aggregateFor(
        "provider-native-incumbent",
        perCase.filter((result) => result.comparator === "provider-native-incumbent"),
      ),
      "general-purpose-baseline": aggregateFor(
        "general-purpose-baseline",
        perCase.filter((result) => result.comparator === "general-purpose-baseline"),
      ),
    },
  };
}
