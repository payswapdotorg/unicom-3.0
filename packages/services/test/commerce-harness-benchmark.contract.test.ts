// ============================================================
// commerce-harness — the R7 benchmark conformance suite
// (HARNESS-CONTRACT.md §1 L5 + §3 lane R7 — the L5 denominators)
// ============================================================
//
// The benchmark module (src/commerce-harness/benchmark.ts) asserted against
// the L5 laws it is the arbiter of:
//
//   1. Determinism: a fixed clock makes the whole corpus run byte-identical
//      (JSON.stringify equality — no real-clock value leaks into a result).
//   2. The corpus closed set: EXACTLY 10 labelled cases, unique ids, every
//      ground truth well-formed (INV-10: no true saving without a realizable
//      family).
//   3. The harness comparator (the ONLY real code path): task success matches
//      ground truth everywhere; cost correctness is "exact-unknowns-marked"
//      on EVERY case (INV-14 — never a summed unknown, never an invented FX);
//      false savings are zero; precision/recall equal the hand-computed
//      expectation stated below; freshness violations are zero; the
//      governed-execution zeros hold everywhere (a non-zero is a defect).
//   4. The hard fixture cases: currency mismatch keeps totals UNKNOWN; a
//      rate_limited store lands in per-store honesty while other stores still
//      shortlist; zero findings is an honest empty; the incumbent loses the
//      cross-store case with its simulated limitation stated in its detail.
//   5. The simulated comparators are honestly labelled (simulated: true,
//      SIMULATED in the description, tier "fixture" on every result object)
//      and scored per their own policy (the baseline's naive cross-currency
//      ranking is scored violated — measured, never adopted).
//   6. Money exactness (INV-14, structural): every monetary position in the
//      serialized run is an exact string decimal + an explicit currency —
//      never a bare JS number.
//
// Fixture tier: the corpus itself is the labelled fixture data (fixture
// *.invalid domains, no credentials, no live provider). The LIVE evidence
// tier stays owed (meta.liveTierOwed) and outside this suite.

import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CORPUS,
  FIXTURE_STEP_LATENCY_MS,
  runBenchmarkCorpus,
  type BenchmarkCaseResult,
  type BenchmarkIntentCase,
  type BenchmarkRunResult,
} from "../src/commerce-harness/benchmark.js";
import { broadenQuery, runHarnessFlow } from "../src/commerce-harness/planner.js";
import { COMMERCE_INTENT_UNKNOWN_FIELDS, parseMoneyToCents } from "../src/commerce-harness/intent.js";
import type { HarnessFlowResult } from "../src/commerce-harness/planner.js";

// ——— the fixed clock (determinism: no Date.now reaches any result) ———

const FIXED_CLOCK = () => new Date("2026-11-04T12:00:00.000Z");

async function runCorpus(): Promise<BenchmarkRunResult> {
  return runBenchmarkCorpus({ now: FIXED_CLOCK });
}

function entriesFor(run: BenchmarkRunResult, comparator: string): BenchmarkCaseResult[] {
  return run.perCase.filter((entry) => entry.comparator === comparator);
}

function caseById(corpus: readonly BenchmarkIntentCase[], id: string): BenchmarkIntentCase {
  const found = corpus.find((caseData) => caseData.id === id);
  if (found === undefined) {
    throw new Error(`corpus case ${id} not found`);
  }
  return found;
}

/** Re-bind the case's fixture map to the REAL flow (the R5 double-binding pattern). */
async function runCaseFlow(caseData: BenchmarkIntentCase): Promise<HarnessFlowResult> {
  return runHarnessFlow({
    intent: caseData.intent,
    readStores: async () => ({ stores: caseData.stores }),
    executeStep: async (step) => {
      const error = caseData.storeErrors?.find((entry) => entry.storeDomain === step.target.domain);
      if (error !== undefined) {
        return {
          stepId: step.id,
          target: step.target,
          operation: "store_search",
          outcome: error.code,
          observedAt: FIXED_CLOCK().toISOString(),
          error: { code: error.code, message: error.message },
        };
      }
      const entry = caseData.findings.find(
        (candidate) => candidate.storeDomain === step.target.domain && candidate.query === step.query,
      );
      return {
        stepId: step.id,
        target: step.target,
        operation: "store_search",
        outcome: "ok",
        observedAt: FIXED_CLOCK().toISOString(),
        findings: entry === undefined ? [] : [...entry.findings],
      };
    },
    now: FIXED_CLOCK,
  });
}

/** The fixture map's own in-budget substitute count (the cross-check for the harness's savings claims). */
function fixtureDerivedInBudgetSubstitutes(caseData: BenchmarkIntentCase): number {
  const broadened = broadenQuery(caseData.intent.query);
  const budget = caseData.intent.maxLandedTotalCost;
  if (broadened === null || budget === undefined) return 0;
  let count = 0;
  for (const entry of caseData.findings) {
    if (entry.query !== broadened) continue;
    for (const finding of entry.findings) {
      if (finding.price === null || finding.currency === null) continue;
      if (finding.currency !== budget.currency) continue;
      const subtotalCents = parseMoneyToCents(finding.price.toFixed(2));
      const budgetCents = parseMoneyToCents(budget.amount);
      if (subtotalCents !== null && budgetCents !== null && subtotalCents <= budgetCents) count += 1;
    }
  }
  return count;
}

/** Structural money scan (INV-14): every amount-keyed position is an exact decimal string + explicit currency. */
function scanMoneyPositions(node: unknown, path: string, violations: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanMoneyPositions(item, `${path}[${index}]`, violations));
    return;
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (Object.hasOwn(record, "amount")) {
      const amount = record.amount;
      if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/u.test(amount)) {
        violations.push(`${path}.amount is not an exact decimal string: ${String(amount)}`);
      }
      const currency = record.currency;
      if (typeof currency !== "string" || currency.length === 0) {
        violations.push(`${path}.currency is not an explicit currency code`);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      scanMoneyPositions(value, `${path}.${key}`, violations);
    }
  }
}

// ============================================================
// 1. Determinism + the run meta (the fixture-tier honesty labels)
// ============================================================

describe("R7 benchmark — determinism and meta", () => {
  it("two runs with the SAME fixed clock deep-equal (JSON.stringify equality — no real-clock leak)", async () => {
    const first = await runCorpus();
    const second = await runCorpus();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.perCase).toHaveLength(30); // 10 cases × 3 comparators, fixed order
  });

  it("meta carries the fixture-tier labels: tier fixture, comparatorsSimulated, liveTierOwed, corpusSize 10, not-live latency basis, fixed-clock generatedAt", async () => {
    const run = await runCorpus();
    expect(run.meta.tier).toBe("fixture");
    expect(run.meta.comparatorsSimulated).toBe(true);
    expect(run.meta.liveTierOwed).toBe(true);
    expect(run.meta.corpusSize).toBe(10);
    expect(run.meta.corpusSize).toBe(BENCHMARK_CORPUS.length);
    expect(run.meta.latencyBasis).toContain("not-live");
    expect(run.meta.generatedAt).toBe("2026-11-04T12:00:00.000Z");
    expect(Object.keys(run.aggregate).sort()).toEqual([
      "general-purpose-baseline",
      "provider-native-incumbent",
      "unicom-harness",
    ]);
  });
});

// ============================================================
// 2. The corpus closed set (EXACTLY 10 labelled cases)
// ============================================================

describe("R7 benchmark — the corpus closed set", () => {
  it("exactly 10 cases with unique ids, labelled, each with at least one fixture store (fixture .invalid domains, no credentials)", () => {
    expect(BENCHMARK_CORPUS).toHaveLength(10);
    expect(new Set(BENCHMARK_CORPUS.map((caseData) => caseData.id)).size).toBe(10);
    for (const caseData of BENCHMARK_CORPUS) {
      expect(caseData.label.length).toBeGreaterThan(0);
      expect(caseData.stores.length).toBeGreaterThan(0);
      expect(caseData.intent.consentBasis).toBe("read-only-search");
      for (const store of caseData.stores) {
        expect(store.domain.endsWith(".fixture.invalid")).toBe(true);
        expect(store.credentials).toBeUndefined();
      }
    }
  });

  it("every ground truth is well-formed: trueSavings null unless realizableFamily non-null; a stated saving is exact money in the case's baseline currency", () => {
    for (const caseData of BENCHMARK_CORPUS) {
      const gt = caseData.groundTruth;
      expect(gt.note.length).toBeGreaterThan(0);
      if (gt.realizableFamily === null) {
        expect(gt.trueSavings).toBeNull();
      }
      if (gt.trueSavings !== null) {
        expect(parseMoneyToCents(gt.trueSavings.amount)).not.toBeNull();
        expect(gt.trueSavings.currency.length).toBeGreaterThan(0);
        // The saving is denominated against the case's baseline: the exact-query
        // findings carry a priced offer in that same currency.
        expect(
          caseData.findings.some(
            (entry) =>
              entry.query === caseData.intent.query &&
              entry.findings.some((finding) => finding.currency === gt.trueSavings?.currency),
          ),
        ).toBe(true);
      }
    }
  });

  it("every intent records exactly its absent constraint fields as unknown (the closed seven-field set, INV-10)", () => {
    for (const caseData of BENCHMARK_CORPUS) {
      const intent = caseData.intent;
      const expressed = new Set<string>();
      if (intent.maxLandedTotalCost !== undefined) expressed.add("maxLandedTotalCost");
      if (intent.size !== undefined) expressed.add("size");
      if (intent.brand !== undefined) expressed.add("brand");
      if (intent.condition !== undefined) expressed.add("condition");
      if (intent.geography !== undefined) expressed.add("geography");
      if (intent.deadline !== undefined) expressed.add("deadline");
      if (intent.excludedStores !== undefined) expressed.add("excludedStores");
      const expected = COMMERCE_INTENT_UNKNOWN_FIELDS.filter((field) => !expressed.has(field));
      expect([...intent.unknowns].sort(), caseData.id).toEqual([...expected].sort());
    }
  });

  it("fixture-map honesty: a store carrying a taxonomy error carries NO findings entries (its listings are unobservable that run)", () => {
    for (const caseData of BENCHMARK_CORPUS) {
      for (const error of caseData.storeErrors ?? []) {
        expect(
          caseData.findings.some((entry) => entry.storeDomain === error.storeDomain),
          caseData.id,
        ).toBe(false);
      }
    }
  });
});

// ============================================================
// 3. The harness comparator — the L5 denominators (the real code path)
// ============================================================

describe("R7 benchmark — the harness comparator's L5 denominators", () => {
  it("taskSuccess matches groundTruth.expectedSuccess on every case (the L5 success law over the real flow)", async () => {
    const run = await runCorpus();
    for (const entry of entriesFor(run, "unicom-harness")) {
      expect({ caseId: entry.caseId, taskSuccess: entry.taskSuccess }).toEqual({
        caseId: entry.caseId,
        taskSuccess: entry.groundTruth.expectedSuccess,
      });
    }
  });

  it("costCorrectness is 'exact-unknowns-marked' on EVERY case — never 'violated' (measured, not asserted)", async () => {
    const run = await runCorpus();
    for (const entry of entriesFor(run, "unicom-harness")) {
      expect({ caseId: entry.caseId, costCorrectness: entry.costCorrectness }).toEqual({
        caseId: entry.caseId,
        costCorrectness: "exact-unknowns-marked",
      });
    }
  });

  it("falseSavingsCount is 0 — no case claims a saving ground truth says does not exist", async () => {
    const run = await runCorpus();
    expect(run.aggregate["unicom-harness"].falseSavingsCount).toBe(0);
    for (const entry of entriesFor(run, "unicom-harness")) {
      expect(entry.falseSavings).toBe(false);
    }
  });

  it("the harness's savings claims match the fixture-derived in-budget substitutes exactly (the prose marker cross-check)", async () => {
    const run = await runCorpus();
    for (const entry of entriesFor(run, "unicom-harness")) {
      const caseData = caseById(BENCHMARK_CORPUS, entry.caseId);
      const fixtureInBudget = fixtureDerivedInBudgetSubstitutes(caseData);
      const claims = entry.savingsClaimFamilies ?? [];
      if (fixtureInBudget > 0) {
        expect(claims, entry.caseId).toEqual(["approved_substitutes"]);
      } else {
        expect(claims, entry.caseId).toEqual([]);
      }
    }
    // Exactly one case in the corpus grounds a savings claim (r7-07's observed
    // HKD 350.00 substitute within the HKD 400.00 budget).
    expect(
      entriesFor(run, "unicom-harness").filter((entry) => (entry.savingsClaimFamilies ?? []).length > 0).map((entry) => entry.caseId),
    ).toEqual(["r7-07"]);
  });

  it("precision and recall equal the hand-computed expectation (stated BEFORE the assertion, from the corpus)", async () => {
    // Hand computation:
    //  - Ground-truth realizable cases: r7-01 group_buy_threshold,
    //    r7-04 coupon_promotion_eligibility, r7-05 wait_or_buy,
    //    r7-07 approved_substitutes — 4 cases.
    //  - The shipped families module surfaces approved_substitutes and
    //    wait_or_buy as feasible on every case (re-searching and waiting are
    //    exercisable read-only), so the realizable lane is surfaced on r7-05
    //    and r7-07 → recall = 2/4 = 0.5. r7-01 answers approval_required and
    //    r7-04 answers not_supported — honest fixture-tier misses the
    //    benchmark reports, never hides.
    //  - Savings claims: only r7-07's approved_substitutes (the single
    //    in-budget observed substitute) — 1 claim, 1 ground-truth match →
    //    precision = 1/1 = 1.
    //  - trueSavings is therefore true exactly on r7-05 and r7-07 (2 cases).
    const run = await runCorpus();
    const harnessAggregate = run.aggregate["unicom-harness"];
    expect(harnessAggregate.opportunityPrecision).toBe(1);
    expect(harnessAggregate.opportunityRecall).toBe(0.5);
    expect(harnessAggregate.trueSavingsCount).toBe(2);
    expect(
      entriesFor(run, "unicom-harness")
        .filter((entry) => entry.trueSavings === true)
        .map((entry) => entry.caseId),
    ).toEqual(["r7-05", "r7-07"]);
  });

  it("freshnessViolations are 0 everywhere (no opportunity's evidence expires before the run clock)", async () => {
    const run = await runCorpus();
    expect(run.aggregate["unicom-harness"].freshnessViolations).toBe(0);
    for (const entry of entriesFor(run, "unicom-harness")) {
      expect(entry.freshnessViolations).toBe(0);
    }
  });

  it("unauthorizedActions / privacyLeaks / humanInterventions are literal 0 on EVERY result of EVERY comparator and every aggregate (a non-zero is a defect)", async () => {
    const run = await runCorpus();
    for (const entry of run.perCase) {
      expect({ id: entry.caseId, comparator: entry.comparator }).toBeDefined();
      expect(entry.unauthorizedActions).toBe(0);
      expect(entry.privacyLeaks).toBe(0);
      expect(entry.humanInterventions).toBe(0);
    }
    for (const aggregate of Object.values(run.aggregate)) {
      expect(aggregate.unauthorizedActions).toBe(0);
      expect(aggregate.privacyLeaks).toBe(0);
      expect(aggregate.humanInterventions).toBe(0);
    }
  });

  it("the headline aggregate rates equal the hand-computed expectation (raw denominators only)", async () => {
    // Hand computation: the harness succeeds on 8 of 10 (honest empties on
    // r7-02 budget-violated-everywhere and r7-08 zero-findings) → 0.8; the
    // incumbent succeeds on 7 of 10 (loses r7-02, r7-08, r7-10 — its single
    // store satisfies no constraint there) → 0.7; the baseline cannot judge
    // any case (counts as not-successful) → 0. Cost correctness: harness
    // 10/10, incumbent 10/10 (its policy sums nothing and applies no FX),
    // baseline 9/10 (r7-03's naive cross-currency ranking is violated).
    const run = await runCorpus();
    expect(run.aggregate["unicom-harness"].taskSuccessRate).toBe(0.8);
    expect(run.aggregate["provider-native-incumbent"].taskSuccessRate).toBe(0.7);
    expect(run.aggregate["general-purpose-baseline"].taskSuccessRate).toBe(0);
    expect(run.aggregate["unicom-harness"].costCorrectnessRate).toBe(1);
    expect(run.aggregate["provider-native-incumbent"].costCorrectnessRate).toBe(1);
    expect(run.aggregate["general-purpose-baseline"].costCorrectnessRate).toBe(0.9);
    expect(
      entriesFor(run, "provider-native-incumbent")
        .filter((entry) => entry.taskSuccess === false)
        .map((entry) => entry.caseId),
    ).toEqual(["r7-02", "r7-08", "r7-10"]);
  });
});

// ============================================================
// 4. The hard fixture cases (currency mismatch, rate limit, empty, cross-store)
// ============================================================

describe("R7 benchmark — the hard fixture cases", () => {
  it("r7-03 (currency mismatch): landed totals stay UNKNOWN over the real flow — no FX is invented, ever", async () => {
    const caseData = caseById(BENCHMARK_CORPUS, "r7-03");
    const flow = await runCaseFlow(caseData);
    expect(flow.shortlist).toHaveLength(3); // all offers kept — the budget fit is UNKNOWN, not violated
    for (const offer of flow.shortlist) {
      expect(offer.landedTotal.total).toBeNull();
      expect(offer.landedTotal.shipping).toBeNull();
      expect(offer.landedTotal.tax).toBeNull();
      expect(offer.landedTotal.duties).toBeNull();
      const budgetEntry = offer.constraints.find((entry) => entry.constraint === "budget");
      expect(budgetEntry?.status).toBe("unknown");
      expect(budgetEntry?.detail).toContain("invents no exchange rate");
    }
    const predicted = flow.evaluation.predictedTotals;
    expect(predicted.currencyMatch).toBe(false);
    expect(predicted.bestObservedSubtotal).toBeNull();
    expect(predicted.landedTotalKnown).toBe(false);
    expect(predicted.unknowns).toContain("exchange rate (no FX source is connected — none is invented)");
    // …and the serialized benchmark result scores the harness exact-unknowns-marked.
    const run = await runCorpus();
    const entry = entriesFor(run, "unicom-harness").find((result) => result.caseId === "r7-03");
    expect(entry?.costCorrectness).toBe("exact-unknowns-marked");
    expect(entry?.trueSavings).toBe(false);
    expect(entry?.falseSavings).toBe(false);
  });

  it("r7-07 (rate_limited): the erroring store lands in per-store honesty, both its steps answer rate_limited, and the healthy store still shortlists", async () => {
    const caseData = caseById(BENCHMARK_CORPUS, "r7-07");
    const flow = await runCaseFlow(caseData);
    const betaObservations = flow.execution.observations.filter(
      (observation) => observation.target.domain === "beta.fixture.invalid",
    );
    expect(betaObservations).toHaveLength(2); // exact + substitutes steps both failed honestly
    expect(betaObservations.every((observation) => observation.outcome === "rate_limited")).toBe(true);
    const betaStrip = flow.perStore.find((entry) => entry.store === "Fixture Beta Store");
    expect(betaStrip?.status).toBe("error");
    expect(betaStrip?.error).toBe("rate_limited");
    const alphaStrip = flow.perStore.find((entry) => entry.store === "Fixture Alpha Store");
    expect(alphaStrip?.status).toBe("ok");
    expect(flow.shortlist).toHaveLength(1);
    expect(flow.outcome.success).toBe(true);
    // The serialized result carries the same honesty.
    const run = await runCorpus();
    const entry = entriesFor(run, "unicom-harness").find((result) => result.caseId === "r7-07");
    expect(entry?.taskSuccess).toBe(true);
    expect(entry?.shortlistSize).toBe(1);
    expect(entry?.savingsClaimFamilies).toEqual(["approved_substitutes"]);
    expect(entry?.perStore?.some((strip) => strip.status === "error" && strip.error === "rate_limited")).toBe(true);
  });

  it("r7-08 (zero findings): an honest empty — success false, empty shortlist, ok zero-count per-store strip, all eight family slots still answer", async () => {
    const caseData = caseById(BENCHMARK_CORPUS, "r7-08");
    const flow = await runCaseFlow(caseData);
    expect(flow.shortlist).toEqual([]);
    expect(flow.outcome.success).toBe(false);
    expect(flow.perStore).toHaveLength(2);
    expect(flow.perStore.every((entry) => entry.status === "ok")).toBe(true);
    expect(flow.opportunities).toHaveLength(8); // no family answer is silently missing
    const run = await runCorpus();
    const entry = entriesFor(run, "unicom-harness").find((result) => result.caseId === "r7-08");
    expect(entry?.taskSuccess).toBe(false);
    expect(entry?.shortlistSize).toBe(0);
    expect(entry?.findingsConsidered).toBe(0);
    expect(entry?.falseSavings).toBe(false); // an honest empty claims no saving
  });

  it("r7-10 (cross-store spread): the harness finds the second store's in-budget offer; the incumbent loses with its simulated limitation stated", async () => {
    const run = await runCorpus();
    const harnessEntry = entriesFor(run, "unicom-harness").find((result) => result.caseId === "r7-10");
    expect(harnessEntry?.taskSuccess).toBe(true);
    expect(harnessEntry?.bestOfferPrice).toEqual({ amount: "360.00", currency: "HKD" });
    expect(harnessEntry?.searchedDomains.sort()).toEqual(["alpha.fixture.invalid", "beta.fixture.invalid"]);
    const incumbentEntry = entriesFor(run, "provider-native-incumbent").find(
      (result) => result.caseId === "r7-10",
    );
    expect(incumbentEntry?.taskSuccess).toBe(false);
    expect(incumbentEntry?.bestOfferPrice).toBeNull(); // its single store satisfied no constraint
    expect(incumbentEntry?.taskSuccessDetail).toContain("cross-store");
    expect(incumbentEntry?.taskSuccessDetail).toContain("beta.fixture.invalid");
    // The comparator's own description states the limitation too — honestly labelled, not a rigged failure.
    expect(incumbentEntry?.comparatorDescription).toContain("cannot compare cross-store");
    expect(incumbentEntry?.simulated).toBe(true);
  });
});

// ============================================================
// 5. The simulated comparators — honest labelling and per-policy scoring
// ============================================================

describe("R7 benchmark — the simulated comparators (labelled, scored per their own policy)", () => {
  it("every result object carries tier 'fixture'; the two policies carry simulated: true with SIMULATED descriptions; the harness is the real path", async () => {
    const run = await runCorpus();
    for (const entry of run.perCase) {
      expect(entry.tier).toBe("fixture");
      if (entry.comparator === "unicom-harness") {
        expect(entry.simulated).toBe(false);
        expect(entry.comparatorDescription).toContain("REAL");
      } else {
        expect(entry.simulated).toBe(true);
        expect(entry.comparatorDescription).toContain("SIMULATED");
        expect(entry.comparatorDescription).toContain("NOT a live");
      }
    }
    for (const aggregate of Object.values(run.aggregate)) {
      expect(aggregate.tier).toBe("fixture");
      expect(aggregate.simulated).toBe(aggregate.comparator !== "unicom-harness");
    }
  });

  it("the baseline cannot judge constraints on every case (null + cannot-judge, counted as not-successful) and proposes no counterfactuals (not-applicable, null precision/recall)", async () => {
    const run = await runCorpus();
    for (const entry of entriesFor(run, "general-purpose-baseline")) {
      expect(entry.taskSuccess).toBeNull();
      expect(entry.cannotJudge).toBe(true);
      expect(entry.taskSuccessDetail).toContain("cannot judge");
      expect(entry.trueSavings).toBe("not-applicable");
      expect(entry.falseSavings).toBe("not-applicable");
      expect(entry.savingsDetail).toContain("not-applicable");
    }
    const baselineAggregate = run.aggregate["general-purpose-baseline"];
    expect(baselineAggregate.cannotJudgeCount).toBe(10);
    expect(baselineAggregate.taskSuccessRate).toBe(0);
    expect(baselineAggregate.trueSavingsCount).toBe(0);
    expect(baselineAggregate.falseSavingsCount).toBe(0);
    expect(baselineAggregate.savingsApplicable).toBe(false);
    expect(baselineAggregate.opportunityPrecision).toBeNull();
    expect(baselineAggregate.opportunityRecall).toBeNull();
    // The incumbent's savings surface is not-applicable too — it never proposes.
    const incumbentAggregate = run.aggregate["provider-native-incumbent"];
    expect(incumbentAggregate.savingsApplicable).toBe(false);
    expect(incumbentAggregate.opportunityPrecision).toBeNull();
    expect(incumbentAggregate.opportunityRecall).toBeNull();
    for (const entry of entriesFor(run, "provider-native-incumbent")) {
      expect(entry.trueSavings).toBe("not-applicable");
      expect(entry.falseSavings).toBe("not-applicable");
    }
  });

  it("the baseline's naive cross-currency ranking is scored violated on r7-03 and exact-unknowns-marked elsewhere; the incumbent is exact everywhere (per-policy honesty)", async () => {
    const run = await runCorpus();
    const baselineViolated = entriesFor(run, "general-purpose-baseline").filter(
      (entry) => entry.costCorrectness === "violated",
    );
    expect(baselineViolated.map((entry) => entry.caseId)).toEqual(["r7-03"]);
    expect(baselineViolated[0]?.costCorrectnessDetail).toContain("currencies");
    for (const entry of entriesFor(run, "general-purpose-baseline")) {
      if (entry.caseId !== "r7-03") {
        expect(entry.costCorrectness).toBe("exact-unknowns-marked");
      }
    }
    for (const entry of entriesFor(run, "provider-native-incumbent")) {
      expect(entry.costCorrectness).toBe("exact-unknowns-marked");
    }
  });

  it("the harness's latency is the modeled fixture step latency over its plan steps — toolCalls match the hand-stated per-case step counts", async () => {
    // Hand-stated plan step counts (exact + broadened-substitutes per searchable
    // store; r7-09's single-token query has nothing to broaden):
    // r7-01: 2, r7-02: 4, r7-03: 4, r7-04: 2, r7-05: 2, r7-06: 2, r7-07: 4,
    // r7-08: 4, r7-09: 1, r7-10: 4.
    const expectedToolCalls: Record<string, number> = {
      "r7-01": 2,
      "r7-02": 4,
      "r7-03": 4,
      "r7-04": 2,
      "r7-05": 2,
      "r7-06": 2,
      "r7-07": 4,
      "r7-08": 4,
      "r7-09": 1,
      "r7-10": 4,
    };
    const run = await runCorpus();
    for (const entry of run.perCase) {
      expect(entry.latencyMs).toBe(entry.toolCalls * FIXTURE_STEP_LATENCY_MS);
    }
    for (const entry of entriesFor(run, "unicom-harness")) {
      expect(entry.toolCalls).toBe(expectedToolCalls[entry.caseId]);
    }
    expect(run.aggregate["unicom-harness"].totalToolCalls).toBe(29);
    expect(run.aggregate["unicom-harness"].medianLatencyMs).toBe(75);
    expect(run.aggregate["provider-native-incumbent"].medianLatencyMs).toBe(25);
    expect(run.aggregate["general-purpose-baseline"].medianLatencyMs).toBe(37.5);
  });
});

// ============================================================
// 6. Money exactness (INV-14 — structural scan of the serialized run)
// ============================================================

describe("R7 benchmark — money exactness (INV-14, structural)", () => {
  it("every monetary position in the serialized run is an exact string decimal with an explicit currency — no bare JS numbers in money positions", async () => {
    const run = await runCorpus();
    const serialized = JSON.parse(JSON.stringify(run)) as unknown;
    const violations: string[] = [];
    scanMoneyPositions(serialized, "$", violations);
    expect(violations).toEqual([]);
    // The money positions the run actually carries: ground-truth true savings
    // echoes and per-comparator best offer prices — all HarnessMoney-shaped.
    const harnessEntry = entriesFor(run, "unicom-harness").find((result) => result.caseId === "r7-01");
    expect(harnessEntry?.groundTruth.trueSavings).toEqual({ amount: "40.00", currency: "HKD" });
    expect(harnessEntry?.bestOfferPrice).toEqual({ amount: "380.00", currency: "HKD" });
    const baselineEntry = entriesFor(run, "general-purpose-baseline").find(
      (result) => result.caseId === "r7-10",
    );
    expect(baselineEntry?.bestOfferPrice).toEqual({ amount: "360.00", currency: "HKD" });
  });
});
