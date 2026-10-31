// ============================================================
// commerce-harness — the W1 money-boundary conformance suite
// (the 2026-10-31 operator review's reproduced defect, closed)
// ============================================================
//
// THE REVIEW'S DEMAND, TESTED VERBATIM: "a value such as 400.005 must not
// be silently rounded into a valid price." The former `toFixed(2)`
// projections laundered exactly that; the canonical boundary
// (finding-money.ts) now refuses sub-cent precision. This suite pins:
//
//   1. The exact number projection (W1-a): 400.005 → null (UNKNOWN,
//      never "400.00"); 400.045 → null; float artifacts → null; 2-dp
//      values project exactly, padded, byte-stably.
//   2. The priceText preservation path (W1-a): a connector-preserved
//      decimal string is honored verbatim; an unparseable one is refused,
//      never repaired from the number.
//   3. The connector-to-outcome path (the review's whole-pipeline test):
//      a finding priced 400.005 produces an UNKNOWN budget fit with the
//      refusal reason — never a silently rounded satisfied/violated one.
//   4. The landed-cost law (W1-b): landed totals only when EVERY component
//      is observed; the budget constraint is satisfied ONLY on an observed
//      landed total; subtotal-only stays UNKNOWN.
//   5. The variant-matching law (W1-c): variant-level evidence satisfies
//      size; normalized token matching across punctuation/case.
//
// Fixture tier: labelled fixture data only (the module is pure).

import { describe, expect, it } from "vitest";
import {
  numberToExactMoneyText,
  findingSubtotal,
  findingSubtotalRefusalReason,
  findingLandedBreakdown,
} from "../src/commerce-harness/finding-money.js";
import type { CommerceIntentEnvelope } from "../src/commerce-harness/intent.js";
import {
  buildShortlist,
  evaluateIntentConstraints,
  evaluatePredictedTotals,
} from "../src/commerce-harness/planner.js";
import type { CapabilityObservation } from "../src/commerce-harness/execution.js";
import type { ConnectedStoreTarget } from "../src/commerce-harness/plan.js";

// ——— the labelled fixtures ———

const TARGET: ConnectedStoreTarget = {
  id: "w1-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "W1 Fixture Store",
  tier: "public",
};

function observationWith(findings: Partial<CapabilityObservation["findings"]>[number][]): CapabilityObservation {
  return {
    stepId: "step-1",
    target: TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-31T00:00:00.000Z",
    findings: findings.map((finding) => ({
      platform: "bigcommerce",
      store: "W1 Fixture Store",
      store_domain: "fixture.invalid",
      title: "W1 Fixture Item",
      price: null,
      currency: null,
      url: "https://fixture.invalid/item",
      image_url: null,
      published_at: null,
      ...finding,
    })),
  };
}

const INTENT_BASE: CommerceIntentEnvelope = {
  query: "w1 fixture item",
  consentBasis: "read-only-search",
  provenance: { surface: "test", expressedAt: "2026-10-31T00:00:00.000Z" },
  unknowns: [],
};

// ——— 1. the exact number projection (the reproduced defect, closed) ———

describe("W1-a the exact number projection (toFixed laundering, closed)", () => {
  it("THE review's test: 400.005 does NOT become a valid price — it refuses to project", () => {
    expect(numberToExactMoneyText(400.005)).toBeNull();
    expect(findingSubtotal({ price: 400.005, currency: "HKD" })).toBeNull();
  });

  it("the round-up variant also refuses: 400.045 → null (never '400.05')", () => {
    expect(numberToExactMoneyText(400.045)).toBeNull();
    expect(findingSubtotal({ price: 400.045, currency: "HKD" })).toBeNull();
  });

  it("float artifacts refuse: 0.1 + 0.2 → null (the exact text carries 17 digits)", () => {
    expect(numberToExactMoneyText(0.1 + 0.2)).toBeNull();
  });

  it("exponent forms refuse: 1e-7 → null", () => {
    expect(numberToExactMoneyText(1e-7)).toBeNull();
  });

  it("negative and non-finite refuse", () => {
    expect(numberToExactMoneyText(-19.99)).toBeNull();
    expect(numberToExactMoneyText(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numberToExactMoneyText(Number.NaN)).toBeNull();
  });

  it("2-dp values project EXACTLY, padded byte-stably: 390 → '390.00', 99.5 → '99.50', 129.99 → '129.99'", () => {
    expect(numberToExactMoneyText(390)).toBe("390.00");
    expect(numberToExactMoneyText(99.5)).toBe("99.50");
    expect(numberToExactMoneyText(129.99)).toBe("129.99");
    expect(numberToExactMoneyText(0)).toBe("0.00");
  });

  it("the refusal reason names the sub-cent precision verbatim (INV-10 evidence)", () => {
    const reason = findingSubtotalRefusalReason({ price: 400.005, currency: "HKD" });
    expect(reason).toContain("400.005");
    expect(reason).toContain("sub-cent precision");
    expect(reason).toContain("NOT rounded into money");
  });
});

// ——— 2. the priceText preservation path ———

describe("W1-a the priceText preservation path", () => {
  it("a connector-preserved decimal string is honored VERBATIM (never re-formatted)", () => {
    expect(findingSubtotal({ price: 0, priceText: "400.5", currency: "HKD" })).toEqual({
      amount: "400.5",
      currency: "HKD",
    });
    expect(findingSubtotal({ price: 0, priceText: "400", currency: "HKD" })).toEqual({
      amount: "400",
      currency: "HKD",
    });
  });

  it("an unparseable preserved text is REFUSED — never repaired from the number", () => {
    expect(findingSubtotal({ price: 390, priceText: "400.005", currency: "HKD" })).toBeNull();
    expect(findingSubtotalRefusalReason({ price: 390, priceText: "400.005", currency: "HKD" })).toContain(
      'preserved price text "400.005"',
    );
  });

  it("preservation beats the number: 399.999 with priceText '399.99' projects exactly 399.99", () => {
    expect(findingSubtotal({ price: 399.999, priceText: "399.99", currency: "HKD" })).toEqual({
      amount: "399.99",
      currency: "HKD",
    });
  });
});

// ——— 3. the connector-to-outcome path (the review's whole-pipeline test) ———

describe("W1-a the connector-to-outcome path", () => {
  it("a finding priced 400.005 under a 500 budget answers UNKNOWN — never a rounded satisfied", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
    };
    const observation = observationWith([{ title: "Sub-cent Item", price: 400.005, currency: "HKD" }]);
    const shortlist = buildShortlist(intent, [observation]);
    expect(shortlist).toHaveLength(1);
    const budgetEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "budget");
    expect(budgetEntry?.status).toBe("unknown");
    expect(budgetEntry?.detail).toContain("sub-cent precision");
    expect(shortlist[0]?.landedTotal.subtotal).toBeNull();
    expect(shortlist[0]?.landedTotal.unknowns).toContain("subtotal");
  });

  it("a 2-dp finding still answers exactly as before (no behavior drift on clean input)", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
    };
    const observation = observationWith([{ title: "Clean Item", price: 390, currency: "HKD" }]);
    const shortlist = buildShortlist(intent, [observation]);
    expect(shortlist[0]?.landedTotal.subtotal).toEqual({ amount: "390.00", currency: "HKD" });
    const budgetEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "budget");
    expect(budgetEntry?.status).toBe("unknown"); // subtotal-only — landed still unknown
  });
});

// ——— 4. the landed-cost law (W1-b) ———

describe("W1-b the landed-cost law", () => {
  it("the landed total appears ONLY when subtotal+shipping+tax+duties are ALL observed", () => {
    const fullyObserved = observationWith([
      {
        title: "Landed Complete",
        price: 390,
        currency: "HKD",
        landed: { shipping: 30, tax: 19.5, duties: 0 },
      },
    ]);
    const breakdown = findingLandedBreakdown(fullyObserved.findings?.[0] ?? {});
    expect(breakdown.total).toEqual({ amount: "439.50", currency: "HKD" });
    expect(breakdown.unknowns).toEqual([]);

    const missingTax = observationWith([
      { title: "Landed Missing Tax", price: 390, currency: "HKD", landed: { shipping: 30, tax: null, duties: 0 } },
    ]);
    const partial = findingLandedBreakdown(missingTax.findings?.[0] ?? {});
    expect(partial.total).toBeNull();
    expect(partial.unknowns).toEqual(["tax"]);
  });

  it("the budget constraint is SATISFIED only on an observed landed total within budget", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
    };
    const observation = observationWith([
      {
        title: "Landed Complete",
        price: 390,
        currency: "HKD",
        landed: { shipping: 30, tax: 19.5, duties: 0 },
      },
    ]);
    const shortlist = buildShortlist(intent, [observation]);
    const budgetEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "budget");
    expect(budgetEntry?.status).toBe("satisfied");
    expect(budgetEntry?.detail).toContain("LANDED total HKD 439.50");
  });

  it("an observed landed total OVER budget violates even when the subtotal fits — the offer is EXCLUDED", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "400.00", currency: "HKD" },
    };
    const observation = observationWith([
      { title: "Landed Over", price: 390, currency: "HKD", landed: { shipping: 30, tax: 19.5, duties: 0 } },
    ]);
    // Hard-constraint-first law: the violated offer never reaches the shortlist.
    const shortlist = buildShortlist(intent, [observation]);
    expect(shortlist).toHaveLength(0);
    // The intent-level rollup names the binding constraint with the landed total.
    const rollup = evaluateIntentConstraints(intent, [observation], shortlist);
    const budgetRollup = rollup.find((entry) => entry.constraint === "budget");
    expect(budgetRollup?.status).toBe("violated");
    expect(budgetRollup?.detail).toContain("HKD 400.00");
  });

  it("the intent-level rollup is satisfied only through a landed-known offer", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
    };
    const landedKnown = observationWith([
      { title: "Landed Complete", price: 390, currency: "HKD", landed: { shipping: 30, tax: 19.5, duties: 0 } },
    ]);
    const rollupKnown = evaluateIntentConstraints(intent, [landedKnown], buildShortlist(intent, [landedKnown]));
    expect(rollupKnown.find((entry) => entry.constraint === "budget")?.status).toBe("satisfied");

    const subtotalOnly = observationWith([{ title: "Subtotal Only", price: 390, currency: "HKD" }]);
    const rollupUnknown = evaluateIntentConstraints(intent, [subtotalOnly], buildShortlist(intent, [subtotalOnly]));
    expect(rollupUnknown.find((entry) => entry.constraint === "budget")?.status).toBe("unknown");
  });

  it("predictedTotals.landedTotalKnown turns true only for the landed-known best offer", () => {
    const intent: CommerceIntentEnvelope = {
      ...INTENT_BASE,
      maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
    };
    const landedKnown = observationWith([
      { title: "Landed Complete", price: 390, currency: "HKD", landed: { shipping: 30, tax: 19.5, duties: 0 } },
    ]);
    expect(evaluatePredictedTotals(intent, [landedKnown]).landedTotalKnown).toBe(true);
    expect(evaluatePredictedTotals(intent, [landedKnown]).unknowns).toEqual([]);

    const subtotalOnly = observationWith([{ title: "Subtotal Only", price: 390, currency: "HKD" }]);
    expect(evaluatePredictedTotals(intent, [subtotalOnly]).landedTotalKnown).toBe(false);
    expect(evaluatePredictedTotals(intent, [subtotalOnly]).unknowns).toEqual(["shipping", "tax", "duties"]);
  });

  it("landed components through the SAME exact boundary: sub-cent shipping refuses, never rounds", () => {
    const subCentShipping = observationWith([
      { title: "Sub-cent Shipping", price: 390, currency: "HKD", landed: { shipping: 30.005, tax: 19.5, duties: 0 } },
    ]);
    const breakdown = findingLandedBreakdown(subCentShipping.findings?.[0] ?? {});
    expect(breakdown.total).toBeNull();
    expect(breakdown.shipping).toBeNull();
    expect(breakdown.unknowns).toEqual(["shipping"]);
  });

  it("preserved component texts are honored verbatim (the same preservation law)", () => {
    const preserved = observationWith([
      {
        title: "Preserved Components",
        price: 390,
        currency: "HKD",
        landed: { shipping: 0, tax: 0, duties: 0, shippingText: "30", taxText: "19.5", dutiesText: "0" },
      },
    ]);
    const breakdown = findingLandedBreakdown(preserved.findings?.[0] ?? {});
    expect(breakdown.total).toEqual({ amount: "439.50", currency: "HKD" });
    expect(breakdown.shipping).toEqual({ amount: "30", currency: "HKD" });
  });
});

// ——— 5. the variant-matching law (W1-c) ———

describe("W1-c genuine product/variant matching", () => {
  it("variant-level evidence satisfies the size constraint (not just title-text)", () => {
    const intent: CommerceIntentEnvelope = { ...INTENT_BASE, size: "EU 44" };
    const observation = observationWith([
      { title: "Sneaker Model X", price: 390, currency: "HKD", variant: "EU 44 · Black" },
    ]);
    const shortlist = buildShortlist(intent, [observation]);
    const sizeEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "size");
    expect(sizeEntry?.status).toBe("satisfied");
    expect(sizeEntry?.detail).toContain("variant-level evidence");
  });

  it("normalized token matching: case and punctuation drift still carries the brand", () => {
    const intent: CommerceIntentEnvelope = { ...INTENT_BASE, brand: "adidas Originals" };
    const observation = observationWith([
      { title: "SNEAKER — adidas/originals line", price: 390, currency: "HKD" },
    ]);
    const shortlist = buildShortlist(intent, [observation]);
    const brandEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "brand");
    expect(brandEntry?.status).toBe("satisfied");
  });

  it("a non-matching variant does NOT satisfy (unknown, never guessed)", () => {
    const intent: CommerceIntentEnvelope = { ...INTENT_BASE, size: "EU 44" };
    const observation = observationWith([
      { title: "Sneaker Model X", price: 390, currency: "HKD", variant: "EU 42 · Black" },
    ]);
    const shortlist = buildShortlist(intent, [observation]);
    const sizeEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "size");
    expect(sizeEntry?.status).toBe("unknown");
  });
});
