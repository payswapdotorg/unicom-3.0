// ============================================================
// find_best_offer — the counterfactual families twin (core side)
// ============================================================
//
// The faithful core-side port of the canonical module
// packages/services/src/commerce-harness/families.ts (the eight contract
// families, each with the six-part record — the twin disclosure is in
// harness.ts's header; the layering wall is why this port exists).
// dispatch/harness-check-r4.mjs asserts the twin agreement: the same family
// set, the same feasibility verdicts, the same evidence classes.
//
// LAWS: evidence classes are `conditional`/`predicted`, NEVER `observed`
// (INV-30); every family slot answers, none silently missing; the
// coupon/promotion family is THE honesty proof — honestly not_supported on a
// Tier-1 public catalog (no promotions API), never a simulated coupon.

import type {
  CapabilityObservation,
  CommerceIntentEnvelope,
  ConnectedStoreTarget,
  HarnessMoney,
} from "./harness.js";
import { formatHarnessMoney, parseMoneyToCents } from "./harness.js";

export type OpportunityFamilyId =
  | "group_buy_threshold"
  | "merchant_counteroffer"
  | "coupon_promotion_eligibility"
  | "order_shipping_consolidation"
  | "local_pickup"
  | "different_fulfillment_route"
  | "wait_or_buy"
  | "approved_substitutes";

export interface HarnessOpportunityCandidate {
  family: OpportunityFamilyId;
  title: string;
  feasibility: "feasible" | "not_supported" | "approval_required";
  reason: string;
  evidenceClass: "conditional" | "predicted";
  observedFacts: string;
  changedAssumptions: string;
  predictedOutcome: string;
  preconditions: string[];
  evidence: {
    source: string;
    observedAt: string;
    freshness: "live-observed" | "capability-inspection" | "prediction";
    expiresAt: string | null;
  };
  consentRequired: string;
  authorityRequired: string;
}

export interface FamiliesEvaluationInput {
  intent: CommerceIntentEnvelope;
  targets: ConnectedStoreTarget[];
  exactObservations: CapabilityObservation[];
  substitutesObservations: CapabilityObservation[];
  observedAt: string;
}

/** A live-observed price's freshness policy: re-observe before relying after this window. */
export const OBSERVED_PRICE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

function countFindings(observations: CapabilityObservation[]): number {
  let total = 0;
  for (const observation of observations) {
    if (observation.outcome === "ok") total += observation.findings?.length ?? 0;
  }
  return total;
}

function findingSubtotal(finding: { price: number | null; currency: string | null }): HarnessMoney | null {
  if (finding.price === null || finding.currency === null) return null;
  const amount = finding.price.toFixed(2);
  return parseMoneyToCents(amount) === null ? null : { amount, currency: finding.currency };
}

function withinBudget(subtotal: HarnessMoney, budget: HarnessMoney | undefined): boolean | "unknown" {
  if (budget === undefined) return "unknown";
  if (subtotal.currency !== budget.currency) return "unknown";
  const subtotalCents = parseMoneyToCents(subtotal.amount);
  const budgetCents = parseMoneyToCents(budget.amount);
  if (subtotalCents === null || budgetCents === null) return "unknown";
  return subtotalCents <= budgetCents;
}

function priceRange(
  observations: CapabilityObservation[],
): { min: HarnessMoney; max: HarnessMoney; count: number } | null {
  let min: HarnessMoney | null = null;
  let max: HarnessMoney | null = null;
  let count = 0;
  for (const observation of observations) {
    if (observation.outcome !== "ok") continue;
    for (const finding of observation.findings ?? []) {
      const subtotal = findingSubtotal(finding);
      if (subtotal === null) continue;
      const subtotalCents = parseMoneyToCents(subtotal.amount);
      if (subtotalCents === null) continue;
      count += 1;
      const minCents = min === null ? null : parseMoneyToCents(min.amount);
      const maxCents = max === null ? null : parseMoneyToCents(max.amount);
      if (minCents === null || subtotalCents < minCents) min = subtotal;
      if (maxCents === null || subtotalCents > maxCents) max = subtotal;
    }
  }
  if (min === null || max === null || count === 0) return null;
  return { min, max, count };
}

function observedAtPlusFreshness(observedAt: string): string | null {
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + OBSERVED_PRICE_FRESHNESS_MS).toISOString();
}

function targetDomainList(targets: ConnectedStoreTarget[]): string {
  return targets.map((target) => target.domain).join(", ");
}

function failedOutcomes(observations: CapabilityObservation[]): string {
  return [...new Set(observations.map((observation) => observation.outcome))].join(", ");
}

// ——— the three concrete v1 families ———

function evaluateSubstitutes(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { intent, substitutesObservations, observedAt } = input;
  const budget = intent.maxLandedTotalCost;

  const inBudget: { title: string; subtotal: HarnessMoney; store: string }[] = [];
  let observedCount = 0;
  let cheapestOverall: { title: string; subtotal: HarnessMoney; store: string } | null = null;
  for (const observation of substitutesObservations) {
    if (observation.outcome !== "ok") continue;
    for (const finding of observation.findings ?? []) {
      observedCount += 1;
      const subtotal = findingSubtotal(finding);
      if (subtotal === null) continue;
      const cheapestCents =
        cheapestOverall === null ? null : parseMoneyToCents(cheapestOverall.subtotal.amount);
      const subtotalCents = parseMoneyToCents(subtotal.amount);
      if (subtotalCents !== null && (cheapestCents === null || subtotalCents < cheapestCents)) {
        cheapestOverall = { title: finding.title, subtotal, store: finding.store };
      }
      if (withinBudget(subtotal, budget) === true) {
        inBudget.push({ title: finding.title, subtotal, store: finding.store });
      }
    }
  }

  const ranProbe = substitutesObservations.length > 0;
  const failedProbe = ranProbe && substitutesObservations.every((observation) => observation.outcome !== "ok");
  let observedFacts: string;
  if (!ranProbe) {
    observedFacts =
      "No broadened substitutes search ran — the exact query is a single token with nothing to broaden. " +
      "No substitute prices were observed.";
  } else if (failedProbe) {
    observedFacts =
      `The broadened substitutes search FAILED on every connected store (outcome ${failedOutcomes(substitutesObservations)}) — ` +
      "no substitute price was observed (the failure is honest, not an empty result).";
  } else if (inBudget.length > 0) {
    const cheapest = inBudget.reduce((best, item) => {
      const bestCents = parseMoneyToCents(best.subtotal.amount) ?? 0n;
      const itemCents = parseMoneyToCents(item.subtotal.amount) ?? 0n;
      return itemCents < bestCents ? item : best;
    });
    observedFacts =
      `The broadened substitutes search observed ${observedCount} item(s) in the connected catalog(s), ` +
      `${inBudget.length} within the stated budget${budget === undefined ? "" : ` (${formatHarnessMoney(budget)})`} ` +
      `on the observed subtotal — cheapest: "${cheapest.title}" at ${formatHarnessMoney(cheapest.subtotal)} (${cheapest.store}). ` +
      "These are live catalog price observations, not held quotes.";
  } else if (cheapestOverall !== null) {
    observedFacts =
      `The broadened substitutes search observed ${observedCount} item(s), NONE within the stated budget ` +
      `on the observed subtotal — cheapest observed: "${cheapestOverall.title}" at ` +
      `${formatHarnessMoney(cheapestOverall.subtotal)} (${cheapestOverall.store}). ` +
      "Shipping, tax and duties are unobserved, so landed totals are unknown.";
  } else {
    observedFacts =
      `The broadened substitutes search observed ${observedCount} item(s); none carried both a price and a currency, ` +
      "so no substitute price comparison was possible (UNKNOWN — never guessed).";
  }

  const deadlineNote =
    intent.deadline === undefined
      ? "no deadline was stated, so the wait window is unknown"
      : `the deadline is ${intent.deadline}`;

  return {
    family: "approved_substitutes",
    title: "Approved substitutes",
    feasibility: "feasible",
    reason:
      "Search-based: the same connected catalog, re-searched with broadened terms under the same read-only authority — " +
      "no new capability, no new authority, no consequential action.",
    evidenceClass: "conditional",
    observedFacts,
    changedAssumptions:
      `The principal accepts a substitute for the exact "${intent.query}" ask ` +
      "(a different model, colorway or condition than literally requested).",
    predictedOutcome:
      inBudget.length > 0
        ? "An in-budget purchase today from the observed substitutes — conditional on the principal approving one. " +
          "The observed prices are live catalog observations; before purchase the chosen item needs a fresh check " +
          "(stock and price)."
        : "No in-budget substitute was observed in this catalog scan. A further-broadened search or another connected " +
          "store may return one — predicted, not observed; no substitute offer is claimed.",
    preconditions: [
      "the principal approves a substitute for the exact ask",
      "the chosen substitute is still in stock and at the observed price at purchase time (a fresh observation)",
      deadlineNote,
    ],
    evidence: {
      source: ranProbe
        ? "the broadened store_search observation over the connected public catalog(s)"
        : "capability inspection: the committed store_search connector set",
      observedAt,
      freshness: ranProbe ? "live-observed" : "capability-inspection",
      expiresAt: ranProbe ? observedAtPlusFreshness(observedAt) : null,
    },
    consentRequired:
      "the principal approves one of the observed substitutes (the harness itself stays read-only — it buys nothing)",
    authorityRequired: "read-only (the search); the purchase itself is outside the harness's granted authority",
  };
}

function evaluateWaitOrBuy(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { intent, exactObservations, observedAt } = input;
  const range = priceRange(exactObservations);
  const exactFailed =
    exactObservations.length > 0 && exactObservations.every((observation) => observation.outcome !== "ok");
  let observedFacts: string;
  if (exactFailed) {
    observedFacts =
      `The exact search FAILED on every connected store (outcome ${failedOutcomes(exactObservations)}) — no price was observed ` +
      "(the failure is honest, not an empty result).";
  } else if (range === null) {
    observedFacts =
      countFindings(exactObservations) === 0
        ? "The exact search observed no matching items — there is no observed price to wait on."
        : "The exact search observed matching items, but none carried both a price and a currency (UNKNOWN — never guessed).";
  } else {
    observedFacts =
      `The exact search observed ${range.count} priced item(s) for "${intent.query}", observed subtotals from ` +
      `${formatHarnessMoney(range.min)} to ${formatHarnessMoney(range.max)}. The public catalog exposes NO price ` +
      "history — only the current price is observable.";
  }

  const budget = intent.maxLandedTotalCost;
  const overBudget =
    budget !== undefined &&
    range !== null &&
    range.min.currency === budget.currency &&
    (parseMoneyToCents(range.min.amount) ?? 0n) > (parseMoneyToCents(budget.amount) ?? 0n);

  return {
    family: "wait_or_buy",
    title: "Wait or buy",
    feasibility: "feasible",
    reason:
      "Prediction-based: waiting is free and read-only — but the connected public catalog exposes no price history, " +
      "so the harness can predict that prices MAY change, never by how much or when.",
    evidenceClass: "predicted",
    observedFacts,
    changedAssumptions: "The purchase timing changes: the principal waits instead of buying at the currently observed price.",
    predictedOutcome: overBudget
      ? "Every observed item is over the stated budget on the observed subtotal; only a price change (sale, restock, " +
        "delisting and relisting) could bring one within it. No drop, magnitude, or timing is predicted or claimed — " +
        "the catalog exposes no price history."
      : "Prices may change while waiting — down (sales, season changes) or up (sellouts, restocks). No drop, " +
        "magnitude, or timing is predicted or claimed — the catalog exposes no price history.",
    preconditions: [
      intent.deadline === undefined
        ? "the principal can wait (no deadline was stated — the wait window is unknown)"
        : `the principal can wait until ${intent.deadline}`,
      ...(budget !== undefined
        ? [`the eventually observed price lands within ${formatHarnessMoney(budget)} on the landed total`]
        : []),
    ],
    evidence: {
      source: "prediction over the observed catalog prices (no price-history capability is connected)",
      observedAt,
      freshness: "prediction",
      expiresAt: null,
    },
    consentRequired:
      "the principal chooses to wait (the harness stays read-only — it holds no cart and sets no alerts in v1)",
    authorityRequired: "read-only (a later re-observation)",
  };
}

function evaluateCouponEligibility(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { intent, targets, observedAt } = input;
  return {
    family: "coupon_promotion_eligibility",
    title: "Coupon / promotion eligibility",
    feasibility: "not_supported",
    reason:
      "The Tier-1 public catalog capability exposes NO promotions or discount API — the committed store_search " +
      "connector reads the public products.json catalog only. Coupon eligibility is unobservable through this " +
      "capability, so the harness refuses to predict, claim, or simulate a coupon.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection of the connected store record(s) (${targetDomainList(targets) || "none connected"}): ` +
      "Tier-1 public catalog (products.json) — no promotions endpoint, no discount codes, no price-rule surface. " +
      "A coupon may or may not exist on the merchant's site; the harness cannot observe it, and says so.",
    changedAssumptions:
      "None — no promotion mechanism is observable, so no assumption is changed. (A coupon's availability would be " +
      "the changed fact, and it is UNKNOWN.)",
    predictedOutcome:
      "None claimed — not supported on the connected capability. A credential-gated promotions/price-rules " +
      "capability would be required before any coupon outcome could be observed rather than guessed.",
    preconditions: [
      "a promotions/price-rules capability is connected (e.g. a credential-gated store API scope)",
      "the principal consents to that capability's authority class",
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired:
      "none exercised (refusal) — a future promotions capability would need the principal's explicit consent" +
      (intent.geography === undefined ? "" : ` (geography ${intent.geography} noted)`),
    authorityRequired: "read-only (the refusal itself); a future promotions capability would need its own scope",
  };
}

// ——— the five framework slots (each answers with its exact reason) ———

function evaluateGroupBuy(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { targets, observedAt } = input;
  return {
    family: "group_buy_threshold",
    title: "Group-buy threshold",
    feasibility: "approval_required",
    reason:
      "A group buy requires negotiating a threshold price with the merchant AND coordinating other buyers — both are " +
      "consequential actions under authority classes v1 does not hold (draft-only/approval-required), and no such " +
      "capability is connected.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection: the connected record(s) (${targetDomainList(targets) || "none connected"}) are Tier-1 ` +
      "public catalog reads. No merchant-communication capability, no group-buy surface, no buyer-coordination " +
      "capability is connected or observable.",
    changedAssumptions:
      "The unit price changes because N buyers commit together — a negotiated threshold the harness cannot observe " +
      "or draft in v1.",
    predictedOutcome:
      "None claimed — realizing this family requires merchant communication and buyer coordination, both beyond the " +
      "connected read-only capability. A group-buy price is not predicted or simulated.",
    preconditions: [
      "a merchant-communication capability is connected and authorized (approval-required)",
      "the principal approves the negotiated threshold and the buyer group",
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired: "the principal approves the group's commitment and the negotiated price",
    authorityRequired: "approval-required (merchant communication + a consequential group commitment)",
  };
}

function evaluateMerchantCounteroffer(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { targets, observedAt } = input;
  return {
    family: "merchant_counteroffer",
    title: "Merchant counteroffer",
    feasibility: "approval_required",
    reason:
      "A counteroffer requires messaging the merchant with a proposed price — a consequential communication under a " +
      "draft-only/approval-required authority class. No merchant-messaging capability is connected, and v1 sends no " +
      "messages by construction.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection: the connected record(s) (${targetDomainList(targets) || "none connected"}) expose ` +
      "read-only catalog reads only. No merchant-messaging channel, no offer/proposal surface, no negotiation " +
      "capability is connected.",
    changedAssumptions:
      "The merchant accepts a price below the listed one — a bilateral agreement the harness cannot draft, send, " +
      "or observe in v1.",
    predictedOutcome:
      "None claimed — not exercisable through the connected capability. No counteroffer price is predicted or " +
      "simulated (a simulated lower price is a conditional opportunity at best, and here even the conditional " +
      "channel does not exist).",
    preconditions: [
      "a merchant-messaging capability is connected and authorized",
      "the principal approves the counteroffer text and price before it is sent (draft-only, then approval)",
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired: "the principal approves the drafted counteroffer before any send",
    authorityRequired: "draft-only + approval-required (a consequential external message)",
  };
}

function evaluateConsolidation(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { targets, observedAt } = input;
  return {
    family: "order_shipping_consolidation",
    title: "Order / shipping consolidation",
    feasibility: "not_supported",
    reason:
      "Consolidation requires reading and restructuring the principal's ORDERS and shipments — an order capability " +
      "is not connected (v1 holds read-only CATALOG reads only), and the public catalog exposes no order surface.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection: the connected record(s) (${targetDomainList(targets) || "none connected"}) are ` +
      "catalog searches. No order-read, no shipment-read, no cart capability is connected — there are no observed " +
      "orders to consolidate.",
    changedAssumptions:
      "Split orders become one shipment — a restructuring of order state the harness cannot observe or hold in v1.",
    predictedOutcome:
      "None claimed — not supported on the connected capability. No shipping saving is predicted (it would depend " +
      "on unobserved orders and unobserved shipping rates).",
    preconditions: [
      "an order/shipment read capability is connected and authorized (R6's merchant-read plane)",
      "multiple open shipments actually exist (an observable fact, not an assumption)",
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired: "the principal consents to order-read and to the consolidation action",
    authorityRequired: "approval-required (reading orders) + authorized-write (restructuring them)",
  };
}

function evaluateLocalPickup(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { intent, targets, observedAt } = input;
  return {
    family: "local_pickup",
    title: "Local pickup",
    feasibility: "not_supported",
    reason:
      "The Tier-1 public catalog exposes no fulfillment-location or store-availability API — whether the merchant " +
      "offers local pickup is unobservable through the connected capability, and the harness refuses to assume it.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection: the connected record(s) (${targetDomainList(targets) || "none connected"}) expose the ` +
      "public products.json catalog only. No fulfillment-location endpoint, no in-store-availability surface" +
      (intent.geography === undefined
        ? " (no geography was stated in the intent — UNKNOWN)"
        : ` (geography ${intent.geography} was stated, but no pickup capability answers it)`) +
      ".",
    changedAssumptions:
      "The fulfillment route changes from shipping to pickup — a route the connected capability cannot observe, " +
      "price, or select.",
    predictedOutcome:
      "None claimed — not supported on the connected capability. No shipping saving from pickup is predicted " +
      "(both the pickup availability and the shipping cost are unobserved).",
    preconditions: [
      "a fulfillment-location / in-store-availability capability is connected",
      ...(intent.geography === undefined
        ? ["the principal states a geography (currently UNKNOWN)"]
        : [`a pickup location exists within ${intent.geography}`]),
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired: "the principal chooses pickup over shipping (a routing decision)",
    authorityRequired: "read-only (a future availability read) + the purchase's own authority",
  };
}

function evaluateFulfillmentRoute(input: FamiliesEvaluationInput): HarnessOpportunityCandidate {
  const { targets, observedAt } = input;
  return {
    family: "different_fulfillment_route",
    title: "Different fulfillment route",
    feasibility: "not_supported",
    reason:
      "Choosing a different fulfillment route (express vs standard, dropship vs warehouse, ship-to-store) requires a " +
      "shipping-rates/fulfillment-options capability — none is connected, and the public catalog exposes none.",
    evidenceClass: "conditional",
    observedFacts:
      `Capability inspection: the connected record(s) (${targetDomainList(targets) || "none connected"}) expose ` +
      "catalog reads only. No shipping-rates endpoint, no fulfillment-options surface, no delivery-schedule " +
      "capability is connected — shipping cost and speed are UNKNOWN on every observed offer.",
    changedAssumptions:
      "The fulfillment route (and with it the landed total and delivery date) changes to a cheaper or faster one — " +
      "an option set the connected capability cannot enumerate.",
    predictedOutcome:
      "None claimed — not supported on the connected capability. No route, saving, or speedup is predicted (the " +
      "options themselves are unobserved).",
    preconditions: [
      "a shipping-rates / fulfillment-options capability is connected and authorized",
      "the principal's geography is stated (the intent's geography may be UNKNOWN)",
    ],
    evidence: {
      source: "capability inspection: the connected Tier-1 public-catalog store records",
      observedAt,
      freshness: "capability-inspection",
      expiresAt: null,
    },
    consentRequired: "the principal chooses the route (a tradeoff between cost, speed and risk)",
    authorityRequired: "read-only (a future rates read) + the purchase's own authority",
  };
}

/** Evaluate all eight families — pure: every slot answers, none silently missing. */
export function evaluateCounterfactualFamilies(input: FamiliesEvaluationInput): HarnessOpportunityCandidate[] {
  return [
    evaluateGroupBuy(input),
    evaluateMerchantCounteroffer(input),
    evaluateCouponEligibility(input),
    evaluateConsolidation(input),
    evaluateLocalPickup(input),
    evaluateFulfillmentRoute(input),
    evaluateWaitOrBuy(input),
    evaluateSubstitutes(input),
  ];
}
