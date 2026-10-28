// ============================================================
// commerce-harness — the R5 module conformance suite
// (HARNESS-CONTRACT.md §2, the cross-cutting contracts, the module face)
// ============================================================
//
// The R4 vertical slice's services-island module
// (src/commerce-harness/ — the canonical pure L1→L5 contract), asserted
// against the six cross-cutting contract families (HARNESS-CONTRACT.md §2):
//
//   1. Evidence-class honesty (INV-30): every counterfactual candidate is
//      `conditional` or `predicted` — NEVER `observed`; a counterfactual
//      price/total is never marked observed anywhere in the outcome record.
//   2. Authority honesty (INV-7/8/9): a plan step whose authorityClass is not
//      read-only is refused BEFORE any network call (the module is pure — the
//      gate throws before the executor port is even consulted).
//   3. UNKNOWN preservation (INV-10): an intent without size/deadline never
//      assumes them; an offer without shipping/tax keeps landedTotal
//      components null (never 0, never estimated) and the total UNKNOWN, not
//      summed.
//   4. Money correctness (INV-14): string decimals + explicit currency,
//      BigInt-cents arithmetic only, deterministic reject on >2 fraction
//      digits (never rounds), zero float drift.
//   5. Provenance: every candidate carries the six-part issue-#23 record —
//      the coupon family's honest not_supported record included.
//   6. The eight-family closed set (INV-34 discipline): exactly the eight
//      contract families, none missing, none extra.
//
// Fixture tier: everything arrives as labelled fixture data (the module is
// pure by design — no live network, no browsers, no stubs of shipped code).
// The LIVE evidence class stays with the R4 worker fixtures + the TL battery.

import { describe, expect, it } from "vitest";
import {
  COMMERCE_INTENT_UNKNOWN_FIELDS,
  compareCents,
  formatHarnessMoney,
  parseMoneyToCents,
  type CommerceIntentEnvelope,
} from "../src/commerce-harness/intent.js";
import type { CapabilityPlan, CapabilityPlanStep, ConnectedStoreTarget } from "../src/commerce-harness/plan.js";
import {
  GOVERNED_EXECUTION_BASELINE,
  HarnessAuthorityError,
  assertReadOnlyAuthority,
  type CapabilityObservation,
} from "../src/commerce-harness/execution.js";
import {
  OBSERVED_PRICE_FRESHNESS_MS,
  OPPORTUNITY_FAMILIES,
  evaluateCounterfactualFamilies,
  type FamiliesEvaluationInput,
} from "../src/commerce-harness/families.js";
import {
  buildCapabilityPlan,
  buildShortlist,
  evaluateIntentConstraints,
  evaluatePlanFeasibility,
  evaluatePredictedTotals,
  runHarnessFlow,
  type ConnectedStoreRecords,
  type ReadConnectedStoreRecords,
  type StepExecutor,
} from "../src/commerce-harness/planner.js";
import type { StoreConnectionRecord } from "../src/stores/stores.js";

// ——— the labelled fixtures ———

const FIXTURE_TARGET: ConnectedStoreTarget = {
  id: "r5-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "R5 Fixture Store",
  tier: "public",
};

const FIXTURE_PUBLIC_RECORD: StoreConnectionRecord = {
  id: "r5-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "R5 Fixture Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

const FIXTURE_WEB_RECORD: StoreConnectionRecord = {
  id: "r5-fixture-web",
  platform: "whatnot",
  domain: "whatnot.example",
  label: "R5 Fixture Web Store",
  tier: "web",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

/** The full intent (budget + size expressed; the rest recorded unknown). */
const FIXTURE_INTENT: CommerceIntentEnvelope = {
  query: "yeezy shoes",
  maxLandedTotalCost: { amount: "400", currency: "HKD" },
  size: "EU 44",
  consentBasis: "read-only-search",
  provenance: { surface: "r5 conformance fixture", expressedAt: "2026-10-28T00:00:00.000Z" },
  unknowns: ["brand", "condition", "geography", "deadline", "excludedStores"],
};

/** The minimal intent: NOTHING but the query — every constraint is UNKNOWN. */
const MINIMAL_INTENT: CommerceIntentEnvelope = {
  query: "sneakers",
  consentBasis: "read-only-search",
  provenance: { surface: "r5 conformance fixture", expressedAt: "2026-10-28T00:00:00.000Z" },
  unknowns: [...COMMERCE_INTENT_UNKNOWN_FIELDS],
};

function fixtureFinding(
  title: string,
  price: number | null,
  currency: string | null,
): CapabilityObservation["findings"] {
  return [
    {
      platform: "bigcommerce",
      store: "R5 Fixture Store",
      store_domain: "fixture.invalid",
      title,
      price,
      currency,
      url: `https://fixture.invalid/${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
      image_url: null,
      published_at: "2026-10-01T00:00:00.000Z",
    },
  ];
}

/** The exact-query observation: in-budget (size in title), over-budget, unpriced. */
function fixtureExactObservation(stepId = "fixture-exact"): CapabilityObservation {
  return {
    stepId,
    target: FIXTURE_TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-28T00:00:00.000Z",
    findings: [
      ...fixtureFinding("Fixture Runner EU 44", 350, "HKD"),
      ...fixtureFinding("Fixture Grand Vintage", 4000, "HKD"),
      ...fixtureFinding("Fixture No-Price Sneaker", null, null),
    ],
  };
}

/** The broadened substitutes observation: one in-budget substitute (an
 * OBSERVED catalog price — the counterfactual must still be conditional). */
function fixtureSubstitutesObservation(stepId = "fixture-substitutes"): CapabilityObservation {
  return {
    stepId,
    target: FIXTURE_TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-28T00:00:00.000Z",
    findings: [...fixtureFinding("Fixture Substitute Trainer", 300, "HKD")],
  };
}

function fixtureFamiliesInput(): FamiliesEvaluationInput {
  return {
    intent: FIXTURE_INTENT,
    targets: [FIXTURE_TARGET],
    exactObservations: [fixtureExactObservation()],
    substitutesObservations: [fixtureSubstitutesObservation()],
    observedAt: "2026-10-28T00:00:00.000Z",
  };
}

function fixtureGateStep(
  authorityClass: CapabilityPlanStep["authorityClass"],
): CapabilityPlanStep {
  return {
    id: "r5-gate-step",
    target: FIXTURE_TARGET,
    operation: "store_search",
    transport: "api",
    authorityClass,
    purpose: "exact",
    query: "yeezy shoes",
    expectedObservation: "must never run",
    expectedCost: { amount: "0.00", currency: "XXX" },
    expectedLatencyMs: 10_000,
  };
}

// ============================================================
// 1. Evidence-class honesty (INV-30)
// ============================================================

describe("commerce-harness module — evidence-class honesty (INV-30)", () => {
  it("every family candidate carries evidenceClass ∈ {conditional, predicted} — NEVER observed", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    expect(candidates).toHaveLength(8);
    for (const candidate of candidates) {
      expect(candidate.evidenceClass === "conditional" || candidate.evidenceClass === "predicted").toBe(true);
      expect(candidate.evidenceClass).not.toBe("observed");
    }
    // wait_or_buy is the prediction-based family (the distinct class); the
    // other seven are conditional.
    const byFamily = new Map(candidates.map((candidate) => [candidate.family, candidate]));
    expect(byFamily.get("wait_or_buy")?.evidenceClass).toBe("predicted");
    for (const family of OPPORTUNITY_FAMILIES) {
      if (family !== "wait_or_buy") {
        expect(byFamily.get(family)?.evidenceClass).toBe("conditional");
      }
    }
  });

  it("a counterfactual price is never marked observed anywhere in the serialized outcome record", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    const serialized = JSON.stringify(candidates);
    expect(serialized).not.toContain('"evidenceClass":"observed"');
    // Even the observed-price substitutions family (a live-observed 300.00 HKD
    // catalog price) stays CONDITIONAL — an observed price never becomes an
    // observed opportunity.
    const substitutes = candidates.find((candidate) => candidate.family === "approved_substitutes");
    expect(substitutes?.evidenceClass).toBe("conditional");
    expect(substitutes?.observedFacts).toContain("not held quotes");
  });

  it("the outcome record carries the same honest evidence classes end-to-end (runHarnessFlow)", async () => {
    const result = await runFixtureFlow();
    for (const candidate of result.opportunities) {
      expect(candidate.evidenceClass === "conditional" || candidate.evidenceClass === "predicted").toBe(true);
    }
    expect(JSON.stringify(result.opportunities)).not.toContain('"evidenceClass":"observed"');
    // The shortlist (observed offers) and the opportunity set (counterfactuals)
    // never mix: the shortlist carries no evidenceClass at all — it is not a
    // counterfactual surface (L5 law).
    for (const offer of result.shortlist) {
      expect("evidenceClass" in offer).toBe(false);
    }
  });
});

// ============================================================
// 2. Authority honesty (INV-7/8/9 — the v1 read-only safety law)
// ============================================================

describe("commerce-harness module — authority honesty (the read-only gate)", () => {
  it("a draft-only plan step is refused BEFORE any network call (HarnessAuthorityError)", () => {
    const step = fixtureGateStep("draft-only");
    try {
      assertReadOnlyAuthority(step);
      throw new Error("the gate must throw for a draft-only step");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessAuthorityError);
      const gateError = error as HarnessAuthorityError;
      expect(gateError.name).toBe("HarnessAuthorityError");
      expect(gateError.stepId).toBe(step.id);
      expect(gateError.authorityClass).toBe("draft-only");
      expect(gateError.message).toContain("BEFORE any network call");
      expect(gateError.message).toContain("Nothing was attempted");
    }
  });

  it("an authorized-write plan step is refused the same way (before any network call)", () => {
    const step = fixtureGateStep("authorized-write");
    expect(() => assertReadOnlyAuthority(step)).toThrowError(HarnessAuthorityError);
    try {
      assertReadOnlyAuthority(step);
    } catch (error) {
      expect((error as HarnessAuthorityError).authorityClass).toBe("authorized-write");
    }
  });

  it("an approval-required step is refused too (the closed set of refusals), while a read-only step passes", () => {
    expect(() => assertReadOnlyAuthority(fixtureGateStep("approval-required"))).toThrowError(
      HarnessAuthorityError,
    );
    expect(() => assertReadOnlyAuthority(fixtureGateStep("read-only"))).not.toThrow();
  });

  it("pre-execution feasibility marks a non-read-only step INFEASIBLE, not merely expensive (INV-9)", () => {
    const plan: CapabilityPlan = {
      createdAt: "2026-10-28T00:00:00.000Z",
      consentBasis: "read-only-search",
      steps: [fixtureGateStep("draft-only"), fixtureGateStep("read-only")],
    };
    const feasibility = evaluatePlanFeasibility(plan);
    expect(feasibility).toHaveLength(2);
    expect(feasibility[0]?.feasible).toBe(false);
    expect(feasibility[0]?.authorityOk).toBe(false);
    expect(feasibility[0]?.reasons.join(" ")).toContain("infeasible, not merely expensive");
    expect(feasibility[1]?.feasible).toBe(true);
    expect(feasibility[1]?.authorityOk).toBe(true);
  });

  it("the flow only ever hands read-only steps to the executor port, and the execution trace is all zeros", async () => {
    const seenSteps: CapabilityPlanStep[] = [];
    const result = await runFixtureFlow({
      executeStep: async (step) => {
        seenSteps.push(step);
        return step.purpose === "exact"
          ? fixtureExactObservation(step.id)
          : fixtureSubstitutesObservation(step.id);
      },
    });
    expect(seenSteps.length).toBeGreaterThan(0);
    expect(seenSteps.every((step) => step.authorityClass === "read-only")).toBe(true);
    expect(result.execution.unauthorizedActions).toBe(0);
    expect(result.execution.humanInterventions).toBe(0);
    expect(result.execution.privacyLeaks).toBe(0);
    expect(GOVERNED_EXECUTION_BASELINE).toEqual({
      unauthorizedActions: 0,
      humanInterventions: 0,
      privacyLeaks: 0,
    });
  });
});

// ============================================================
// 3. UNKNOWN preservation (INV-10 — never assumed, never collapsed)
// ============================================================

describe("commerce-harness module — UNKNOWN preservation (INV-10)", () => {
  it("the intent's unknown-field set is the closed seven-field set (none silently missing)", () => {
    expect(COMMERCE_INTENT_UNKNOWN_FIELDS).toEqual([
      "maxLandedTotalCost",
      "size",
      "brand",
      "condition",
      "geography",
      "deadline",
      "excludedStores",
    ]);
  });

  it("an intent without size/deadline never evaluates them — no offer carries a fabricated constraint entry", () => {
    const shortlist = buildShortlist(MINIMAL_INTENT, [fixtureExactObservation()]);
    expect(shortlist).toHaveLength(3); // nothing violated, nothing assumed
    for (const offer of shortlist) {
      expect(offer.constraints.map((entry) => entry.constraint)).toEqual([]);
    }
    const satisfaction = evaluateIntentConstraints(MINIMAL_INTENT, [fixtureExactObservation()], shortlist);
    expect(satisfaction).toEqual([]); // absent constraints are never rolled up
  });

  it("an expressed-but-unobservable constraint stays unknown (never assumed satisfied, never refuted)", () => {
    const shortlist = buildShortlist(FIXTURE_INTENT, [fixtureExactObservation()]);
    const byTitle = new Map(shortlist.map((offer) => [offer.title, offer]));
    // "EU 44" is carried by this title (title-text evidence) → satisfied.
    expect(
      byTitle.get("Fixture Runner EU 44")?.constraints.find((entry) => entry.constraint === "size")
        ?.status,
    ).toBe("satisfied");
    // No variant availability on the kept-but-unpriced offer → UNKNOWN, never
    // guessed (the over-budget offer is excluded by the hard-constraint-first
    // law — it never reaches the shortlist at all).
    expect(
      byTitle
        .get("Fixture No-Price Sneaker")
        ?.constraints.find((entry) => entry.constraint === "size")?.status,
    ).toBe("unknown");
    expect(byTitle.has("Fixture Grand Vintage")).toBe(false); // violated → excluded
  });

  it("an offer without shipping/tax keeps landedTotal components null and the total UNKNOWN, not summed", () => {
    const shortlist = buildShortlist(FIXTURE_INTENT, [fixtureExactObservation()]);
    const priced = shortlist.find((offer) => offer.title === "Fixture Runner EU 44");
    // The priced offer: subtotal observed, everything else null — never 0,
    // never estimated, and total is NEVER the subtotal summed with unknowns.
    expect(priced?.landedTotal.subtotal).toEqual({ amount: "350.00", currency: "HKD" });
    expect(priced?.landedTotal.shipping).toBeNull();
    expect(priced?.landedTotal.tax).toBeNull();
    expect(priced?.landedTotal.duties).toBeNull();
    expect(priced?.landedTotal.total).toBeNull();
    expect(priced?.landedTotal.unknowns).toEqual(["shipping", "tax", "duties"]);

    // The unpriced offer: subtotal unknown too — still null, still listed.
    const unpriced = shortlist.find((offer) => offer.title === "Fixture No-Price Sneaker");
    expect(unpriced?.landedTotal.subtotal).toBeNull();
    expect(unpriced?.landedTotal.total).toBeNull();
    expect(unpriced?.landedTotal.unknowns).toEqual(["subtotal", "shipping", "tax", "duties"]);
    // The budget fit of an unpriced offer is UNKNOWN, never guessed.
    expect(
      unpriced?.constraints.find((entry) => entry.constraint === "budget")?.status,
    ).toBe("unknown");
  });

  it("an in-budget offer keeps the budget UNKNOWN (the landed total is unobservable); an over-budget one is honestly violated", () => {
    const shortlist = buildShortlist(FIXTURE_INTENT, [fixtureExactObservation()]);
    const inBudget = shortlist.find((offer) => offer.title === "Fixture Runner EU 44");
    const budgetEntry = inBudget?.constraints.find((entry) => entry.constraint === "budget");
    expect(budgetEntry?.status).toBe("unknown"); // within on the subtotal — landed UNKNOWN
    expect(budgetEntry?.detail).toContain("landed total is UNKNOWN");

    // The over-budget offer is excluded from the shortlist (hard constraints
    // first), and the intent-level satisfaction names the binding constraint.
    expect(shortlist.some((offer) => offer.title === "Fixture Grand Vintage")).toBe(false);
    const satisfaction = evaluateIntentConstraints(FIXTURE_INTENT, [fixtureExactObservation()], shortlist);
    const intentBudget = satisfaction.find((entry) => entry.constraint === "budget");
    expect(intentBudget?.status).toBe("unknown"); // at least one subtotal within → landed still unknown
    expect(intentBudget?.detail).toContain("shipping/tax/duties are unobserved");
  });

  it("predictedTotals stays honest: landedTotalKnown false, unknowns listed, no invented exchange rate", () => {
    const predicted = evaluatePredictedTotals(FIXTURE_INTENT, [fixtureExactObservation()]);
    expect(predicted.landedTotalKnown).toBe(false);
    expect(predicted.unknowns).toEqual(
      expect.arrayContaining(["shipping", "tax", "duties"]),
    );
    expect(predicted.budget).toEqual({ amount: "400", currency: "HKD" });
    expect(predicted.currencyMatch).toBe(true); // same-currency prices were observed
    expect(predicted.bestObservedSubtotal?.amount).toBe("350.00");

    // Zero priced observations: everything UNKNOWN (null — never 0, never false).
    const empty = evaluatePredictedTotals(FIXTURE_INTENT, [
      { ...fixtureExactObservation(), findings: [...fixtureFinding("Only Unpriced", null, null)] },
    ]);
    expect(empty.bestObservedSubtotal).toBeNull();
    expect(empty.currencyMatch).toBeNull();
    expect(empty.landedTotalKnown).toBe(false);

    // All prices in a foreign currency: no FX rate is invented, ever.
    const foreign = evaluatePredictedTotals(FIXTURE_INTENT, [
      { ...fixtureExactObservation(), findings: [...fixtureFinding("Foreign Priced", 30, "USD")] },
    ]);
    expect(foreign.currencyMatch).toBe(false);
    expect(foreign.bestObservedSubtotal).toBeNull();
    expect(foreign.unknowns).toEqual(
      expect.arrayContaining(["exchange rate (no FX source is connected — none is invented)"]),
    );
  });
});

// ============================================================
// 4. Money correctness (INV-14 — exact string decimals, BigInt cents only)
// ============================================================

describe("commerce-harness module — money correctness (INV-14)", () => {
  it("parseMoneyToCents: the exact table (BigInt cents) + the deterministic reject rule", () => {
    const cases: ReadonlyArray<[string, bigint | null]> = [
      ["400", 40000n],
      ["400.00", 40000n],
      ["0.01", 1n],
      ["4000.5", 400050n],
      ["0", 0n],
      ["4000.50", 400050n],
      ["abc", null],
      ["-1", null],
      ["1.234", null],
    ];
    for (const [amount, expected] of cases) {
      expect(parseMoneyToCents(amount)).toBe(expected);
    }
    // The documented rule for a third fraction digit: REJECT, never round —
    // "400.005" is unparseable money, deterministically.
    expect(parseMoneyToCents("400.005")).toBeNull();
    expect(parseMoneyToCents("400.0")).toBe(40000n);
    expect(parseMoneyToCents("400.1")).toBe(40010n);
  });

  it("zero float drift on the 0.1+0.2 class (BigInt cents, never Number arithmetic)", () => {
    const dimes = parseMoneyToCents("0.10");
    const nickels = parseMoneyToCents("0.20");
    const sum = dimes! + nickels!;
    expect(sum).toBe(30n); // NOT 0.30000000000000004 — exact by construction
    expect(String(sum)).toBe("30");
    expect(sum).toBe(parseMoneyToCents("0.30"));
    expect(compareCents(sum, parseMoneyToCents("0.30")!)).toBe(0);
    expect(compareCents(dimes!, nickels!)).toBe(-1);
  });

  it("exact beyond Number.MAX_SAFE_INTEGER (the float representation would already lie)", () => {
    // 9,007,199,254,740,993 is odd; the closest float is ...992 — only BigInt
    // cents keep it exact.
    expect(parseMoneyToCents("9007199254740993.00")).toBe(900719925474099300n);
    expect(String(parseMoneyToCents("9007199254740993.00"))).toBe("900719925474099300");
    expect(Number.isSafeInteger(Number("9007199254740993"))).toBe(false); // the float class is the lie
  });

  it("formatHarnessMoney: locale-neutral 2-dp output, deterministic passthrough on unparseable amounts", () => {
    expect(formatHarnessMoney({ amount: "400", currency: "HKD" })).toBe("HKD 400.00");
    expect(formatHarnessMoney({ amount: "0.01", currency: "USD" })).toBe("USD 0.01");
    expect(formatHarnessMoney({ amount: "4000.5", currency: "HKD" })).toBe("HKD 4000.50");
    // Unparseable: passthrough verbatim — never a silently rounded figure.
    expect(formatHarnessMoney({ amount: "400.005", currency: "HKD" })).toBe("HKD 400.005");
  });

  it("every money value the module produces is a string decimal + an explicit currency (never a JS number)", async () => {
    const result = await runFixtureFlow();
    for (const step of result.plan.steps) {
      expect(typeof step.expectedCost.amount).toBe("string");
      expect(typeof step.expectedCost.currency).toBe("string");
    }
    for (const offer of result.shortlist) {
      if (offer.landedTotal.subtotal !== null) {
        expect(typeof offer.landedTotal.subtotal.amount).toBe("string");
        expect(typeof offer.landedTotal.subtotal.currency).toBe("string");
      }
    }
  });

  it("unknown money never enters a sum (the total stays null, the best stays null)", () => {
    const shortlist = buildShortlist(FIXTURE_INTENT, [fixtureExactObservation()]);
    for (const offer of shortlist) {
      // subtotal present + shipping null → total MUST stay null (not subtotal+0).
      expect(offer.landedTotal.total).toBeNull();
    }
    const empty = evaluatePredictedTotals(FIXTURE_INTENT, []);
    expect(empty.bestObservedSubtotal).toBeNull(); // null — never 0n, never a made-up sum
    expect(empty.currencyMatch).toBeNull();
  });
});

// ============================================================
// 5. Provenance — the six-part record on EVERY candidate
// ============================================================

describe("commerce-harness module — provenance (the six-part issue-#23 record)", () => {
  it("every candidate carries all six parts (the coupon family's not_supported record included)", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    expect(candidates).toHaveLength(8);
    for (const candidate of candidates) {
      expect(candidate.observedFacts.length).toBeGreaterThan(0);
      expect(candidate.changedAssumptions.length).toBeGreaterThan(0);
      expect(candidate.predictedOutcome.length).toBeGreaterThan(0);
      expect(candidate.preconditions.length).toBeGreaterThan(0);
      expect(candidate.preconditions.every((precondition) => precondition.length > 0)).toBe(true);
      expect(candidate.evidence.source.length).toBeGreaterThan(0);
      expect(candidate.evidence.observedAt.length).toBeGreaterThan(0);
      expect(
        candidate.evidence.freshness === "live-observed" ||
          candidate.evidence.freshness === "capability-inspection" ||
          candidate.evidence.freshness === "prediction",
      ).toBe(true);
      expect(["string", "object"]).toContain(typeof candidate.evidence.expiresAt);
      expect(candidate.evidence.expiresAt === null || typeof candidate.evidence.expiresAt === "string").toBe(true);
      expect(candidate.consentRequired.length).toBeGreaterThan(0);
      expect(candidate.authorityRequired.length).toBeGreaterThan(0);
      expect(candidate.reason.length).toBeGreaterThan(0);
    }
  });

  it("the coupon family's honest refusal: not_supported with the exact reason and NO claimed outcome", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    const coupon = candidates.find(
      (candidate) => candidate.family === "coupon_promotion_eligibility",
    );
    expect(coupon).toBeDefined();
    expect(coupon?.feasibility).toBe("not_supported");
    expect(coupon?.reason).toContain("NO promotions or discount API");
    expect(coupon?.reason).toContain("refuses to predict, claim, or simulate a coupon");
    expect(coupon?.predictedOutcome.startsWith("None claimed")).toBe(true);
    expect(coupon?.evidence.freshness).toBe("capability-inspection");
    expect(coupon?.evidence.expiresAt).toBeNull(); // refusals never expire — they say so
  });

  it("live-observed evidence carries a freshness expiry; predictions and refusals claim none", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    const substitutes = candidates.find((candidate) => candidate.family === "approved_substitutes");
    expect(substitutes?.evidence.freshness).toBe("live-observed");
    const observedAtMs = Date.parse("2026-10-28T00:00:00.000Z");
    const expectedExpiry = new Date(observedAtMs + OBSERVED_PRICE_FRESHNESS_MS).toISOString();
    expect(substitutes?.evidence.expiresAt).toBe(expectedExpiry); // observedAt + the 24h re-observe window
    expect(OBSERVED_PRICE_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);

    const waitOrBuy = candidates.find((candidate) => candidate.family === "wait_or_buy");
    expect(waitOrBuy?.evidence.freshness).toBe("prediction");
    expect(waitOrBuy?.evidence.expiresAt).toBeNull();
  });
});

// ============================================================
// 6. The eight-family closed set (INV-34 discipline)
// ============================================================

describe("commerce-harness module — the eight-family closed set", () => {
  it("OPPORTUNITY_FAMILIES is exactly the eight contract families (frozen list, none missing, none extra)", () => {
    expect(OPPORTUNITY_FAMILIES).toEqual([
      "group_buy_threshold",
      "merchant_counteroffer",
      "coupon_promotion_eligibility",
      "order_shipping_consolidation",
      "local_pickup",
      "different_fulfillment_route",
      "wait_or_buy",
      "approved_substitutes",
    ]);
  });

  it("evaluateCounterfactualFamilies answers every slot — a set-equal match, no duplicates", () => {
    const candidates = evaluateCounterfactualFamilies(fixtureFamiliesInput());
    const families = candidates.map((candidate) => candidate.family);
    expect(families).toHaveLength(8);
    expect(new Set(families).size).toBe(8);
    expect([...families].sort()).toEqual([...OPPORTUNITY_FAMILIES].sort());
  });

  it("even the zero-targets input answers all eight slots (none silently missing)", () => {
    const candidates = evaluateCounterfactualFamilies({
      intent: MINIMAL_INTENT,
      targets: [],
      exactObservations: [],
      substitutesObservations: [],
      observedAt: "2026-10-28T00:00:00.000Z",
    });
    expect(candidates.map((candidate) => candidate.family).sort()).toEqual(
      [...OPPORTUNITY_FAMILIES].sort(),
    );
    for (const candidate of candidates) {
      expect(candidate.evidenceClass === "conditional" || candidate.evidenceClass === "predicted").toBe(true);
    }
  });
});

// ============================================================
// The flow-level conformance (the pure L3→L5 composition over fixture ports)
// ============================================================

describe("commerce-harness module — the L3→L5 flow over injected fixture ports", () => {
  it("threads one intent through plan → governed read-only execution → shortlist → families", async () => {
    const result = await runFixtureFlow();

    // L3: the plan covers the searchable public record only (exact + substitutes).
    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.consentBasis).toBe("read-only-search");
    // L4: both observations recorded, zeros by construction.
    expect(result.execution.observations).toHaveLength(2);
    expect(result.execution.unauthorizedActions).toBe(0);
    // L5: the shortlist is the hard-constraint-first set (over-budget excluded).
    expect(result.shortlist.map((offer) => offer.title)).toEqual([
      "Fixture Runner EU 44",
      "Fixture No-Price Sneaker",
    ]);
    expect(result.shortlist.every((offer, index) => offer.rank === index + 1)).toBe(true);
    // The eight families answer.
    expect(result.opportunities).toHaveLength(8);
    // The per-store strip is honest (ok + count).
    expect(result.perStore).toHaveLength(1);
    expect(result.perStore[0]?.status).toBe("ok");
    // The web-tier record answers through a notice, never a step.
    expect(result.notices.some((notice) => notice.includes("R5 Fixture Web Store"))).toBe(true);
    expect(result.notices.some((notice) => notice.includes("searched via the web instead"))).toBe(true);
    expect(result.zeroSearchableStores).toBe(false);
    // The outcome record mirrors the layers (L5).
    expect(result.outcome.success).toBe(true);
    expect(result.outcome.shortlist).toHaveLength(2);
    expect(result.outcome.plannedStepCount).toBe(2);
    expect(result.outcome.benchmarks.unauthorizedActions).toBe(0);
    expect(result.outcome.benchmarks.costCorrectnessBasis).toBe("exact-string-decimals-unknowns-marked");
  });

  it("the honest zero-searchable-stores path: no steps, the honest notice, the families still answer", async () => {
    const result = await runFixtureFlow({
      readStores: async () => ({ stores: [FIXTURE_WEB_RECORD] }),
    });
    expect(result.plan.steps).toHaveLength(0);
    expect(result.zeroSearchableStores).toBe(true);
    expect(result.shortlist).toEqual([]);
    expect(result.opportunities).toHaveLength(8);
    expect(result.perStore).toEqual([]);
    expect(result.outcome.success).toBe(false); // honest, not a failure: unknowns stay unknown
    expect(
      result.notices.some((notice) => notice.includes("No connected store was searchable")),
    ).toBe(true);
  });

  it("the planner disciplines the records: web-tier, disconnected and credential-tier handling", () => {
    const disconnected: StoreConnectionRecord = { ...FIXTURE_PUBLIC_RECORD, id: "r5-disconnected", status: "disconnected" };
    const build = buildCapabilityPlan(FIXTURE_INTENT, [
      FIXTURE_PUBLIC_RECORD,
      FIXTURE_WEB_RECORD,
      disconnected,
    ], new Date("2026-10-28T00:00:00.000Z"));
    // Only the searchable public record is planned (web + disconnected never).
    expect(build.searchableRecords.map((record) => record.id)).toEqual(["r5-fixture-public"]);
    expect(build.webRecords.map((record) => record.id)).toEqual(["r5-fixture-web"]);
    expect(build.excludedRecords).toEqual([]);
    expect(build.plan.steps).toHaveLength(2); // exact + broadened substitutes
    expect(build.plan.steps.every((step) => step.authorityClass === "read-only")).toBe(true);
    // The excluded-stores intent excludes by label or domain (case-insensitive), honestly.
    const excludedBuild = buildCapabilityPlan(
      { ...FIXTURE_INTENT, excludedStores: ["r5 fixture store"] },
      [FIXTURE_PUBLIC_RECORD],
      new Date("2026-10-28T00:00:00.000Z"),
    );
    expect(excludedBuild.searchableRecords).toEqual([]);
    expect(excludedBuild.excludedRecords.map((record) => record.id)).toEqual(["r5-fixture-public"]);
    // A single-token query has nothing to broaden — no substitutes step.
    const singleToken = buildCapabilityPlan(
      { ...MINIMAL_INTENT, query: "sneakers" },
      [FIXTURE_PUBLIC_RECORD],
      new Date("2026-10-28T00:00:00.000Z"),
    );
    expect(singleToken.plan.steps).toHaveLength(1);
    expect(singleToken.plan.steps[0]?.purpose).toBe("exact");
  });
});

// ——— the flow fixture helpers ———

function runFixtureFlow(overrides: {
  readStores?: ReadConnectedStoreRecords;
  executeStep?: StepExecutor;
} = {}) {
  const readStores: ReadConnectedStoreRecords =
    overrides.readStores ??
    (async (): Promise<ConnectedStoreRecords> => ({
      stores: [FIXTURE_PUBLIC_RECORD, FIXTURE_WEB_RECORD],
    }));
  const executeStep: StepExecutor =
    overrides.executeStep ??
    (async (step) =>
      step.purpose === "exact"
        ? fixtureExactObservation(step.id)
        : fixtureSubstitutesObservation(step.id));
  return runHarnessFlow({
    intent: FIXTURE_INTENT,
    readStores,
    executeStep,
    now: () => new Date("2026-10-28T00:00:00.000Z"),
  });
}
