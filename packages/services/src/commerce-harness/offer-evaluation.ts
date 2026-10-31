// ============================================================
// Commerce harness — W1 the offer-evaluation half of the L3 planner
// (split from planner.ts at the 2026-10-31 W-campaign — the same
// behavior-verified-split discipline the R4 renderer split used)
// ============================================================
//
// The pure constraint-evaluation + shortlist + predicted-totals +
// per-store-strip composition over the EXACT-query observations. Every
// law documented on these functions moved with them verbatim; the
// planner re-exports the public surface so callers (and the R5 suite)
// keep importing from planner.js — the split is a file-level fact, not
// an API change.
//
// LAWS (unchanged by the split):
//   - HARD CONSTRAINTS FIRST: an offer with any VIOLATED constraint is
//     excluded from the shortlist; UNKNOWN constraints keep the offer
//     IN, marked unknown (INV-10).
//   - W1-a: the money boundary is the ONE canonical projection
//     (finding-money.ts) — sub-cent precision refuses to project, it is
//     never rounded into money.
//   - W1-b: the budget constraint is satisfied ONLY on an observed
//     landed total (subtotal+shipping+tax+duties); subtotal-only fits
//     answer UNKNOWN.
//   - W1-c: variant-level evidence satisfies the size constraint;
//     matching normalizes case/punctuation and requires every
//     meaningful token.

import type { CapabilityObservation } from "./execution.js";
import type { CommerceIntentEnvelope, HarnessMoney } from "./intent.js";
import { formatHarnessMoney, parseMoneyToCents } from "./intent.js";
import {
  compareHarnessMoney,
  findingLandedBreakdown,
  findingSubtotal,
  findingSubtotalRefusalReason,
} from "./finding-money.js";
import type {
  ConstraintName,
  ConstraintSatisfactionEntry,
  PredictedTotals,
} from "./evaluation.js";
import type {
  LandedTotalBreakdown,
  PerStoreEntry,
  ShortlistOffer,
} from "./outcome.js";

// ——— constraint evaluation (HARD CONSTRAINTS FIRST; INV-10 everywhere) ———

// The ONE canonical connector→harness money projection lives in finding-money.ts
// (W1-a: the 2026-10-31 review's reproduced toFixed(2) laundering, closed —
// sub-cent precision now refuses to project instead of rounding into money).
// findingSubtotal is re-exported for the module's own consumers.

/** Normalize a matching surface: lowercase, collapse whitespace/punctuation runs to single spaces (W1-c). */
function normalizeMatchSurface(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

/** Genuine token matching (W1-c): every meaningful token of the needle must appear in the haystack surface. */
function surfaceCarries(surface: string, needle: string): boolean {
  const normalizedNeedle = normalizeMatchSurface(needle);
  if (normalizedNeedle.length < 2) return false;
  const normalizedSurface = normalizeMatchSurface(surface);
  const tokens = normalizedNeedle.split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((token) => normalizedSurface.includes(token));
}

function titleCarries(title: string, value: string): boolean {
  return surfaceCarries(title, value);
}

/** Per-offer constraint statuses for the EXPRESSED constraints only (absent = UNKNOWN, never evaluated as a guess). */
function offerConstraints(
  intent: CommerceIntentEnvelope,
  finding: {
    title: string;
    variant?: string | null;
    price: number | null;
    priceText?: string | null;
    currency: string | null;
    landed?: {
      shipping: number | null;
      tax: number | null;
      duties: number | null;
      shippingText?: string | null;
      taxText?: string | null;
      dutiesText?: string | null;
    } | null;
  },
): { constraint: ConstraintName; status: "satisfied" | "unknown" | "violated"; detail: string }[] {
  const out: { constraint: ConstraintName; status: "satisfied" | "unknown" | "violated"; detail: string }[] = [];
  const budget = intent.maxLandedTotalCost;
  if (budget !== undefined) {
    const budgetCents = parseMoneyToCents(budget.amount);
    const breakdown = findingLandedBreakdown(finding);
    const subtotal = breakdown.subtotal;
    if (subtotal === null || budgetCents === null) {
      out.push({
        constraint: "budget",
        status: "unknown",
        detail: `No observable price basis (${findingSubtotalRefusalReason(finding)}) — the budget fit is UNKNOWN, never guessed.`,
      });
    } else if (subtotal.currency !== budget.currency) {
      out.push({
        constraint: "budget",
        status: "unknown",
        detail: `Currency mismatch — observed subtotal in ${subtotal.currency}, budget in ${budget.currency}. The harness invents no exchange rate; the fit is UNKNOWN.`,
      });
    } else if (breakdown.total !== null) {
      // W1-b: EVERY landed component observed — the landed-total fit is then, and only then, decidable.
      const fit = compareHarnessMoney(breakdown.total, budget);
      if (fit !== null && fit > 0) {
        out.push({
          constraint: "budget",
          status: "violated",
          detail: `Observed LANDED total ${formatHarnessMoney(breakdown.total)} exceeds the budget ${formatHarnessMoney(budget)} — subtotal ${formatHarnessMoney(subtotal)} + shipping/tax/duties all observed.`,
        });
      } else if (fit !== null) {
        out.push({
          constraint: "budget",
          status: "satisfied",
          detail: `Observed LANDED total ${formatHarnessMoney(breakdown.total)} is within the budget ${formatHarnessMoney(budget)} — subtotal, shipping, tax and duties were all observed (exact BigInt-cents sum).`,
        });
      } else {
        out.push({
          constraint: "budget",
          status: "unknown",
          detail: `The landed total ${formatHarnessMoney(breakdown.total)} could not be compared exactly against ${formatHarnessMoney(budget)} — UNKNOWN, never guessed.`,
        });
      }
    } else {
      const subtotalCents = parseMoneyToCents(subtotal.amount);
      if (subtotalCents !== null && subtotalCents > budgetCents) {
        out.push({
          constraint: "budget",
          status: "violated",
          detail: `Observed subtotal ${formatHarnessMoney(subtotal)} exceeds the budget ${formatHarnessMoney(budget)} on the subtotal alone (shipping/tax/duties would only add).`,
        });
      } else {
        out.push({
          constraint: "budget",
          status: "unknown",
          detail: `Observed subtotal ${formatHarnessMoney(subtotal)} is within the budget ${formatHarnessMoney(budget)}, but the landed total is UNKNOWN (${breakdown.unknowns.join(", ")} unobserved) — the total-budget fit is UNKNOWN.`,
        });
      }
    }
  }
  if (intent.size !== undefined) {
    const variant = typeof finding.variant === "string" ? finding.variant : null;
    if (variant !== null && surfaceCarries(variant, intent.size)) {
      out.push({
        constraint: "size",
        status: "satisfied",
        detail: `The finding's observed variant descriptor carries "${intent.size}" (variant-level evidence — W1-c).`,
      });
    } else if (titleCarries(finding.title, intent.size)) {
      out.push({
        constraint: "size",
        status: "satisfied",
        detail: `The finding's title carries "${intent.size}" (title-text evidence).`,
      });
    } else {
      out.push({
        constraint: "size",
        status: "unknown",
        detail: `The finding exposes no variant availability${variant === null ? "" : " matching the ask"} — "${intent.size}" is unconfirmed (not refuted); confirm on the product page.`,
      });
    }
  }
  if (intent.brand !== undefined) {
    out.push(
      titleCarries(finding.title, intent.brand)
        ? {
            constraint: "brand",
            status: "satisfied",
            detail: `The finding's title carries "${intent.brand}" (title-text evidence).`,
          }
        : {
            constraint: "brand",
            status: "unknown",
            detail: `The finding carries no brand field and the title doesn't mention "${intent.brand}" — the brand is unconfirmed, not refuted.`,
          },
    );
  }
  if (intent.condition !== undefined) {
    out.push({
      constraint: "condition",
      status: "unknown",
      detail: `The public catalog states no condition field — "${intent.condition}" is unconfirmed (retail listings are typically new, but the harness does not assume).`,
    });
  }
  if (intent.deadline !== undefined) {
    out.push({
      constraint: "deadline",
      status: "unknown",
      detail: `Delivery timing is unobserved (no shipping capability is connected) — arrival by ${intent.deadline} is UNKNOWN.`,
    });
  }
  return out;
}

/** The landed breakdown from the finding's observed components (W1-b: total only when EVERY component is observed). */
function landedTotalFor(
  finding: Parameters<typeof findingLandedBreakdown>[0],
): LandedTotalBreakdown {
  const breakdown = findingLandedBreakdown(finding);
  return {
    subtotal: breakdown.subtotal,
    shipping: breakdown.shipping,
    tax: breakdown.tax,
    duties: breakdown.duties,
    total: breakdown.total,
    unknowns: breakdown.unknowns,
  };
}

/**
 * Build the shortlist from the EXACT-query observations: HARD CONSTRAINTS
 * FIRST — an offer with any VIOLATED constraint is excluded (with the
 * violation recorded in the intent-level satisfaction); UNKNOWN constraints
 * keep the offer IN, marked unknown (INV-10). Rank: confirmed-first
 * (satisfied DESC, unknown ASC), then cheapest same-currency subtotal,
 * then observation order.
 */
export function buildShortlist(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
): ShortlistOffer[] {
  const offers: ShortlistOffer[] = [];
  for (const observation of exactObservations) {
    if (observation.outcome !== "ok") continue;
    for (const finding of observation.findings ?? []) {
      const constraints = offerConstraints(intent, finding);
      if (constraints.some((entry) => entry.status === "violated")) continue;
      offers.push({
        rank: 0,
        platform: finding.platform,
        store: finding.store,
        store_domain: finding.store_domain,
        title: finding.title,
        price: finding.price,
        currency: finding.currency,
        url: finding.url,
        image_url: finding.image_url,
        published_at: finding.published_at,
        ...(finding.truncated === true ? { truncated: true } : {}),
        ...(typeof finding.priceText === "string" ? { priceText: finding.priceText } : {}),
        ...(typeof finding.variant === "string" ? { variant: finding.variant } : {}),
        landedTotal: landedTotalFor(finding),
        constraints,
      });
    }
  }

  offers.sort((a, b) => {
    const aSatisfied = a.constraints.filter((entry) => entry.status === "satisfied").length;
    const bSatisfied = b.constraints.filter((entry) => entry.status === "satisfied").length;
    if (aSatisfied !== bSatisfied) return bSatisfied - aSatisfied;
    const aUnknown = a.constraints.filter((entry) => entry.status === "unknown").length;
    const bUnknown = b.constraints.filter((entry) => entry.status === "unknown").length;
    if (aUnknown !== bUnknown) return aUnknown - bUnknown;
    const budget = intent.maxLandedTotalCost;
    if (budget !== undefined) {
      const aCents =
        a.landedTotal.subtotal !== null && a.landedTotal.subtotal.currency === budget.currency
          ? parseMoneyToCents(a.landedTotal.subtotal.amount)
          : null;
      const bCents =
        b.landedTotal.subtotal !== null && b.landedTotal.subtotal.currency === budget.currency
          ? parseMoneyToCents(b.landedTotal.subtotal.amount)
          : null;
      if (aCents !== null && bCents !== null && aCents !== bCents) return aCents < bCents ? -1 : 1;
    }
    return 0;
  });
  offers.forEach((offer, index) => {
    offer.rank = index + 1;
  });
  return offers;
}

/** Intent-level constraint satisfaction — the FIRST violated constraint is the binding one (the renderer's empty state). */
export function evaluateIntentConstraints(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
  shortlist: ShortlistOffer[],
): ConstraintSatisfactionEntry[] {
  const entries: ConstraintSatisfactionEntry[] = [];
  const budget = intent.maxLandedTotalCost;
  if (budget !== undefined) {
    const budgetCents = parseMoneyToCents(budget.amount);
    let sameCurrency = 0;
    let overBudget = 0;
    let landedKnownWithinBudget = false;
    let landedKnownCount = 0;
    let cheapest: HarnessMoney | null = null;
    let cheapestCents: bigint | null = null;
    let priced = 0;
    let mismatched = 0;
    for (const observation of exactObservations) {
      if (observation.outcome !== "ok") continue;
      for (const finding of observation.findings ?? []) {
        const breakdown = findingLandedBreakdown(finding);
        const subtotal = breakdown.subtotal;
        if (subtotal === null) continue;
        priced += 1;
        if (subtotal.currency !== budget.currency) {
          mismatched += 1;
          continue;
        }
        sameCurrency += 1;
        const cents = parseMoneyToCents(subtotal.amount);
        if (cents === null || budgetCents === null) continue;
        if (cents > budgetCents) overBudget += 1;
        if (cheapestCents === null || cents < cheapestCents) {
          cheapestCents = cents;
          cheapest = subtotal;
        }
        // W1-b: an observed landed total (every component present) decides the
        // total-budget fit exactly — the only path to a satisfied rollup, and a
        // landed-over-budget offer counts toward the violated rollup.
        if (breakdown.total !== null) {
          landedKnownCount += 1;
          const landedFit = compareHarnessMoney(breakdown.total, budget);
          if (landedFit !== null && landedFit <= 0) landedKnownWithinBudget = true;
          if (landedFit !== null && landedFit > 0) overBudget += 1;
        }
      }
    }
    if (priced === 0) {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail: "No priced offer was observed — the budget fit is UNKNOWN.",
      });
    } else if (sameCurrency === 0) {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail: `Every observed price is in a currency other than ${budget.currency} — the harness invents no exchange rate; the budget fit is UNKNOWN.`,
      });
    } else if (landedKnownWithinBudget) {
      entries.push({
        constraint: "budget",
        status: "satisfied",
        detail: `At least one observed LANDED total (subtotal+shipping+tax+duties all observed) is within ${formatHarnessMoney(budget)} — the total-budget fit is decidable on that offer (W1-b).`,
      });
    } else if (overBudget === sameCurrency) {
      entries.push({
        constraint: "budget",
        status: "violated",
        detail: `Every same-currency observed subtotal exceeds ${formatHarnessMoney(budget)} — cheapest observed: ${cheapest === null ? "unknown" : formatHarnessMoney(cheapest)}. The budget is the binding constraint.`,
      });
    } else {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail:
          landedKnownCount > 0
            ? `At least one landed total was fully observed but none is within ${formatHarnessMoney(budget)}, and at least one observed subtotal is within it on the subtotal alone — the total-budget fit is UNKNOWN on the subtotal-only offers (${landedKnownCount} landed-known offer(s) checked).`
            : `At least one observed subtotal is within ${formatHarnessMoney(budget)} on the subtotal, but shipping/tax/duties are unobserved on every offer — the landed-total fit is UNKNOWN.`,
      });
    }
  }
  const rollup = (name: ConstraintName, label: string): ConstraintSatisfactionEntry => {
    const shortlistEntry = shortlist.some((offer) =>
      offer.constraints.some((entry) => entry.constraint === name && entry.status === "satisfied"),
    );
    if (shortlistEntry) {
      return {
        constraint: name,
        status: "satisfied",
        detail: `At least one shortlisted offer's title carries the ${label} evidence — see the offer's constraint line.`,
      };
    }
    return {
      constraint: name,
      status: "unknown",
      detail: `The connected public-catalog capability cannot confirm the ${label} constraint on any offer — UNKNOWN, never guessed (see each offer's constraint line).`,
    };
  };
  if (intent.size !== undefined) entries.push(rollup("size", "size"));
  if (intent.brand !== undefined) entries.push(rollup("brand", "brand"));
  if (intent.condition !== undefined) entries.push(rollup("condition", "condition"));
  if (intent.deadline !== undefined) entries.push(rollup("deadline", "deadline"));
  return entries;
}

/** The predicted landed total with uncertainty (never a live quote — INV-16/17/30). */
export function evaluatePredictedTotals(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
): PredictedTotals {
  const budget = intent.maxLandedTotalCost ?? null;
  let best: (HarnessMoney & { offerTitle: string }) | null = null;
  let bestCents: bigint | null = null;
  let anyObserved = false;
  let anySameCurrency = false;
  let bestLandedKnown = false;
  if (budget !== null) {
    for (const observation of exactObservations) {
      if (observation.outcome !== "ok") continue;
      for (const finding of observation.findings ?? []) {
        const breakdown = findingLandedBreakdown(finding);
        const subtotal = breakdown.subtotal;
        if (subtotal === null) continue;
        anyObserved = true;
        if (subtotal.currency !== budget.currency) continue;
        anySameCurrency = true;
        const cents = parseMoneyToCents(subtotal.amount);
        if (cents !== null && (bestCents === null || cents < bestCents)) {
          bestCents = cents;
          best = { ...subtotal, offerTitle: finding.title };
          bestLandedKnown = breakdown.total !== null;
        }
      }
    }
  }
  const unknowns = ["shipping", "tax", "duties"];
  if (bestLandedKnown) unknowns.length = 0;
  if (budget !== null && anyObserved && !anySameCurrency) {
    unknowns.push("exchange rate (no FX source is connected — none is invented)");
  }
  return {
    budget,
    bestObservedSubtotal: best,
    currencyMatch: budget === null || !anyObserved ? null : anySameCurrency,
    landedTotalKnown: budget === null ? null : bestLandedKnown,
    unknowns,
  };
}

/** The honest per-store strip from the EXACT observations (the store_search per_store contract, verbatim). */
export function buildPerStoreStrip(
  exactObservations: CapabilityObservation[],
  displayPlatform: (platform: string) => string,
): PerStoreEntry[] {
  return exactObservations.map((observation) => {
    const platform = displayPlatform(observation.target.platform);
    if (observation.outcome === "ok") {
      return {
        platform,
        store: observation.target.label,
        count: observation.findings?.length ?? 0,
        status: "ok" as const,
        ...(observation.truncated === true ? { truncated: true } : {}),
      };
    }
    if (observation.error === undefined) {
      return {
        platform,
        store: observation.target.label,
        status: "error" as const,
        error: "unknown",
        message: "The observation carried no error payload — the outcome is preserved as unknown.",
      };
    }
    return {
      platform,
      store: observation.target.label,
      status: observation.error.code === "not_configured" ? ("not_configured" as const) : ("error" as const),
      error: observation.error.code,
      message: observation.error.message,
    };
  });
}
