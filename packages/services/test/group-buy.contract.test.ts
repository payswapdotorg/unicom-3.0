// ============================================================
// commerce-harness — the W2 group-buy counterfactual calculation
// suite (the 2026-10-31 review's "central opportunity-engine gap")
// ============================================================
//
// THE REVIEW'S DEMANDED SCENARIO, COMPUTED EXACTLY:
//   observed $100 · threshold $80 · 20 participants → $20/participant,
// in exact BigInt cents with every basis labelled. Plus the honest laws:
// cross-currency → UNKNOWN, at-or-below-threshold → honest no-saving,
// tier selection (cheapest applicable, minQuantity ≥ 2), and the family
// integration (computed candidate CARRIES the numbers; refusal stands
// verbatim without tiers).
//
// Fixture tier: labelled fixture tier tables only.

import { describe, expect, it } from "vitest";
import {
  computeGroupBuyThresholdSavings,
  selectApplicableVolumeTier,
  type MerchantVolumeTier,
} from "../src/commerce-harness/group-buy.js";
import {
  evaluateCounterfactualFamilies,
  type FamiliesEvaluationInput,
} from "../src/commerce-harness/families.js";
import type { CapabilityObservation } from "../src/commerce-harness/execution.js";
import type { CommerceIntentEnvelope } from "../src/commerce-harness/intent.js";
import type { ConnectedStoreTarget } from "../src/commerce-harness/plan.js";

const TARGET: ConnectedStoreTarget = {
  id: "w2-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "W2 Fixture Store",
  tier: "public",
};

const INTENT: CommerceIntentEnvelope = {
  query: "group fixture item",
  consentBasis: "read-only-search",
  provenance: { surface: "test", expressedAt: "2026-10-31T00:00:00.000Z" },
  unknowns: [],
};

function exactObservation(price: number, currency: string): CapabilityObservation {
  return {
    stepId: "step-1",
    target: TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-31T00:00:00.000Z",
    findings: [
      {
        platform: "bigcommerce",
        store: "W2 Fixture Store",
        store_domain: "fixture.invalid",
        title: "Group Fixture Item",
        price,
        currency,
        url: "https://fixture.invalid/item",
        image_url: null,
        published_at: null,
      },
    ],
  };
}

const TIERS: MerchantVolumeTier[] = [
  { storeDomain: "fixture.invalid", minQuantity: 5, unitPrice: { amount: "95.00", currency: "HKD" } },
  { storeDomain: "fixture.invalid", minQuantity: 20, unitPrice: { amount: "80.00", currency: "HKD" } },
];

// ——— the computation itself ———

describe("W2-a the group-buy threshold computation (the review's demanded calculation)", () => {
  it("THE review's numbers: observed 100, threshold 80, 20 participants → 20.00 per participant, 400.00 total", () => {
    const computation = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "80.00", currency: "HKD" },
      thresholdBasis: "published-volume-tier",
      requiredParticipants: 20,
    });
    expect(computation.perParticipantSaving).toEqual({ amount: "20.00", currency: "HKD" });
    expect(computation.totalGroupSaving).toEqual({ amount: "400.00", currency: "HKD" });
    expect(computation.requiredParticipants).toBe(20);
    expect(computation.actionable).toBe(false);
    expect(computation.renderedSaving).toContain("HKD 20.00 per participant");
  });

  it("every number carries its basis (the W2 provenance law)", () => {
    const computation = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "80.00", currency: "HKD" },
      thresholdBasis: "published-volume-tier",
      requiredParticipants: 20,
    });
    expect(computation.basisLabels.observedUnitPrice).toBe("observed");
    expect(computation.basisLabels.thresholdUnitPrice).toBe("published-volume-tier");
    expect(computation.basisLabels.requiredParticipants).toBe("observed (the tier's minQuantity)");
    expect(computation.renderedThresholdBasis).toContain("PUBLISHED volume tier");
    const stated = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "80.00", currency: "HKD" },
      thresholdBasis: "stated-assumption",
      requiredParticipants: 10,
    });
    expect(stated.basisLabels.thresholdUnitPrice).toBe("stated-assumption");
    expect(stated.renderedThresholdBasis).toContain("STATED ASSUMPTION");
  });

  it("cross-currency → UNKNOWN, never an invented FX rate (INV-14)", () => {
    const computation = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "80.00", currency: "USD" },
      thresholdBasis: "published-volume-tier",
      requiredParticipants: 20,
    });
    expect(computation.perParticipantSaving).toBeNull();
    expect(computation.totalGroupSaving).toBeNull();
    expect(computation.unknownReason).toContain("invents no exchange rate");
  });

  it("a threshold at-or-above the observed price is an honest NO saving, never dressed as one", () => {
    const computation = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdBasis: "published-volume-tier",
      requiredParticipants: 20,
    });
    expect(computation.perParticipantSaving).toEqual({ amount: "0.00", currency: "HKD" });
    expect(computation.renderedSaving).toContain("honest NO saving");
  });

  it("the prerequisites are the review's verbatim demands: merchant honors, group commits, fresh re-observation", () => {
    const computation = computeGroupBuyThresholdSavings({
      observedUnitPrice: { amount: "100.00", currency: "HKD" },
      thresholdUnitPrice: { amount: "80.00", currency: "HKD" },
      thresholdBasis: "published-volume-tier",
      requiredParticipants: 20,
    });
    expect(computation.prerequisites.some((entry) => entry.includes("merchant honors"))).toBe(true);
    expect(computation.prerequisites.some((entry) => entry.includes("consented buyers"))).toBe(true);
    expect(computation.prerequisites.some((entry) => entry.includes("fresh independent re-observation"))).toBe(true);
  });
});

// ——— the tier selection ———

describe("W2-a the applicable-tier selection", () => {
  it("selects the CHEAPEST strictly-below-observed tier with minQuantity >= 2", () => {
    const selected = selectApplicableVolumeTier({ amount: "100.00", currency: "HKD" }, TIERS);
    expect(selected?.tier.unitPrice).toEqual({ amount: "80.00", currency: "HKD" });
    expect(selected?.tier.minQuantity).toBe(20);
    expect(selected?.computation.perParticipantSaving).toEqual({ amount: "20.00", currency: "HKD" });
  });

  it("refuses tiers at-or-above the observed price (no group-buy surface)", () => {
    expect(selectApplicableVolumeTier({ amount: "80.00", currency: "HKD" }, TIERS)).toBeNull();
    expect(selectApplicableVolumeTier({ amount: "75.00", currency: "HKD" }, TIERS)).toBeNull();
  });

  it("refuses cross-currency tiers (no invented FX)", () => {
    const usdTiers: MerchantVolumeTier[] = [
      { storeDomain: "fixture.invalid", minQuantity: 10, unitPrice: { amount: "10.00", currency: "USD" } },
    ];
    expect(selectApplicableVolumeTier({ amount: "100.00", currency: "HKD" }, usdTiers)).toBeNull();
  });

  it("refuses single-buyer 'tiers' (minQuantity < 2 is a quantity discount, not a group-buy surface)", () => {
    const solo: MerchantVolumeTier[] = [
      { storeDomain: "fixture.invalid", minQuantity: 1, unitPrice: { amount: "50.00", currency: "HKD" } },
    ];
    expect(selectApplicableVolumeTier({ amount: "100.00", currency: "HKD" }, solo)).toBeNull();
  });
});

// ——— the family integration ———

describe("W2-a the group-buy family carries the computed counterfactual", () => {
  function familiesInput(tiers?: readonly MerchantVolumeTier[]): FamiliesEvaluationInput {
    return {
      intent: INTENT,
      targets: [TARGET],
      exactObservations: [exactObservation(100, "HKD")],
      substitutesObservations: [],
      ...(tiers === undefined ? {} : { merchantVolumeTiers: tiers }),
      observedAt: "2026-10-31T00:00:00.000Z",
    };
  }

  it("WITH tiers: the candidate carries the exact numbers, stays conditional + approval-required", () => {
    const candidates = evaluateCounterfactualFamilies(familiesInput(TIERS));
    const groupBuy = candidates.find((candidate) => candidate.family === "group_buy_threshold");
    expect(groupBuy).toBeDefined();
    expect(groupBuy?.feasibility).toBe("approval_required");
    expect(groupBuy?.evidenceClass).toBe("conditional"); // INV-30 — never observed
    expect(groupBuy?.reason).toContain("COMPUTED counterfactual");
    expect(groupBuy?.predictedOutcome).toContain("HKD 20.00 per participant");
    expect(groupBuy?.predictedOutcome).toContain("HKD 400.00");
    expect(groupBuy?.predictedOutcome).toContain("20 participants");
    expect(groupBuy?.observedFacts).toContain("minQuantity 20");
    expect(groupBuy?.observedFacts).toContain("[basis: published-volume-tier");
    expect(groupBuy?.evidence.freshness).toBe("live-observed");
    expect(groupBuy?.evidence.expiresAt).toBe("2026-11-01T00:00:00.000Z"); // the freshness window
  });

  it("WITHOUT tiers: the honest refusal stands verbatim — never predicted, never simulated", () => {
    const candidates = evaluateCounterfactualFamilies(familiesInput());
    const groupBuy = candidates.find((candidate) => candidate.family === "group_buy_threshold");
    expect(groupBuy?.predictedOutcome).toContain("None claimed");
    expect(groupBuy?.predictedOutcome).toContain("not predicted or simulated");
    expect(groupBuy?.evidence.freshness).toBe("capability-inspection");
  });

  it("with tiers that do not apply: the refusal names why (the honest tiers note)", () => {
    const irrelevant: MerchantVolumeTier[] = [
      { storeDomain: "other.invalid", minQuantity: 20, unitPrice: { amount: "80.00", currency: "HKD" } },
    ];
    const candidates = evaluateCounterfactualFamilies(familiesInput(irrelevant));
    const groupBuy = candidates.find((candidate) => candidate.family === "group_buy_threshold");
    expect(groupBuy?.predictedOutcome).toContain("None claimed");
    expect(groupBuy?.observedFacts).toContain("no tier that applies");
  });

  it("the eight-family closed set is unchanged (no family added or dropped)", () => {
    const candidates = evaluateCounterfactualFamilies(familiesInput(TIERS));
    expect(candidates.map((candidate) => candidate.family).sort()).toEqual(
      [
        "approved_substitutes",
        "coupon_promotion_eligibility",
        "different_fulfillment_route",
        "group_buy_threshold",
        "local_pickup",
        "merchant_counteroffer",
        "order_shipping_consolidation",
        "wait_or_buy",
      ].sort(),
    );
  });
});
