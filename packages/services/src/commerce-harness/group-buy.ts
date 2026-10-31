// ============================================================
// Commerce harness — W2 the group-buy threshold counterfactual
// calculation (the 2026-10-31 operator review's "central
// opportunity-engine gap", closed at the fixture tier)
// ============================================================
//
// THE REVIEW'S DEMANDED SHAPE, IMPLEMENTED EXACTLY:
//   - Current observed price: $100  → observedUnitPrice  (basis: observed)
//   - Counterfactual: combine compatible, consented demand
//   - Estimated merchant threshold: $80 → thresholdUnitPrice (basis: a
//     PUBLISHED merchant volume tier — an observed catalog fact — or a STATED
//     ASSUMPTION, never a silent invention)
//   - Required participants: 20 → derived from the tier's minQuantity
//   - Expected saving: $20 per participant → perParticipantSaving, computed
//     in exact BigInt cents
//   - Prerequisite: the merchant agrees to the price and quantity →
//     prerequisites[], verbatim law
//   - Result: a CONDITIONAL opportunity that becomes actionable only when
//     the conditions are satisfied → actionable: false, always, at
//     calculation time (INV-30: a counterfactual price is never a live quote)
//
// LAWS binding this module:
//   - EXACT MONEY ONLY (INV-14): every input is HarnessMoney (decimal string
//     + currency); every output is HarnessMoney; all arithmetic is BigInt
//     cents. A float never enters, an FX rate is never invented
//     (cross-currency inputs → the saving is UNKNOWN, null — never guessed).
//   - EVERY NUMBER CARRIES ITS BASIS (the W2 provenance law): observed /
//     published-volume-tier / stated-assumption. The computation's rendered
//     strings label each basis verbatim — no number appears unlabeled.
//   - THE TIER IS AN OFFER TO EVERYONE (the honesty law): a published volume
//     tier is a catalog fact, observable by anyone; the SAVING it implies is
//     still conditional on (a) the merchant honoring the tier at checkout,
//     (b) the group actually forming, and (c) a fresh re-observation before
//     any purchase (the issue #23 W2 freshness law). None of these is
//     assumed — they are prerequisites.
//   - MINIMUM GROUP SIZE: a group buy needs at least TWO participants; a
//     tier with minQuantity < 2 is not a group-buy surface (it is a
//     quantity discount one buyer could take alone) and is refused with the
//     exact reason.

import type { HarnessMoney } from "./intent.js";
import { formatHarnessMoney, parseMoneyToCents } from "./intent.js";
import { compareHarnessMoney } from "./finding-money.js";

/** The basis of the threshold price — every number carries its basis (the W2 provenance law). */
export type GroupBuyThresholdBasis = "published-volume-tier" | "stated-assumption";

/** One published merchant volume tier — an OBSERVED catalog fact (fixture tier: labelled fixture data). */
export interface MerchantVolumeTier {
  /** The store domain whose catalog publishes this tier (matches a finding's store_domain). */
  storeDomain: string;
  /** Minimum committed quantity that unlocks the tier price (integer ≥ 2 for a group-buy surface). */
  minQuantity: number;
  /** The tier unit price — exact money (INV-14). */
  unitPrice: HarnessMoney;
}

/** The calculation's input — every monetary input exact, every basis explicit. */
export interface GroupBuyComputationInput {
  /** The currently observed unit price (basis: observed). */
  observedUnitPrice: HarnessMoney;
  /** The threshold unit price the counterfactual assumes (basis: thresholdBasis). */
  thresholdUnitPrice: HarnessMoney;
  /** The threshold's basis — labelled on every rendered number (the W2 provenance law). */
  thresholdBasis: GroupBuyThresholdBasis;
  /** The minimum participants the threshold requires (from the tier, or stated). */
  requiredParticipants: number;
}

/** The exact computed result — null money fields mean UNKNOWN (INV-10/14), never a guess. */
export interface GroupBuyComputation {
  /** Exact: observedUnitPrice − thresholdUnitPrice, same-currency only; null = UNKNOWN. */
  perParticipantSaving: HarnessMoney | null;
  /** Exact: perParticipantSaving × requiredParticipants; null when the per-participant saving is unknown. */
  totalGroupSaving: HarnessMoney | null;
  /** The participants the threshold requires (integer ≥ 2 by construction). */
  requiredParticipants: number;
  /** Why the saving is unknown, when it is (cross-currency / unparseable) — verbatim law. */
  unknownReason: string | null;
  /** The prerequisite list — verbatim, each one required before the saving can realize. */
  prerequisites: string[];
  /** Always false at calculation time — a conditional opportunity, never actionable by arithmetic (INV-30). */
  actionable: false;
  /** The rendered saving sentence — every number carries its basis (the W2 provenance law). */
  renderedSaving: string;
  /** The rendered threshold basis sentence, verbatim. */
  renderedThresholdBasis: string;
  /** The rendered basis labels for every number in the computation (the W2 provenance law). */
  basisLabels: {
    observedUnitPrice: "observed";
    thresholdUnitPrice: GroupBuyThresholdBasis;
    requiredParticipants: "observed (the tier's minQuantity)" | "stated-assumption";
  };
}

/** The per-participant saving as exact BigInt cents, or null (cross-currency / unparseable). */
function savingCents(
  observedUnitPrice: HarnessMoney,
  thresholdUnitPrice: HarnessMoney,
): bigint | null {
  if (observedUnitPrice.currency !== thresholdUnitPrice.currency) return null;
  const observedCents = parseMoneyToCents(observedUnitPrice.amount);
  const thresholdCents = parseMoneyToCents(thresholdUnitPrice.amount);
  if (observedCents === null || thresholdCents === null) return null;
  return observedCents - thresholdCents;
}

/** Format exact cents back to a money amount string ("80.00" style, 2-dp by construction). */
function centsToAmount(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Compute the group-buy threshold savings — the review's demanded calculation,
 * in exact BigInt cents with every basis labelled. Cross-currency or
 * unparseable inputs yield UNKNOWN money (null + unknownReason), never a
 * guess; a threshold at-or-above the observed price is an honest
 * no-saving (≤ 0 cents) recorded as such, never dressed as a saving.
 */
export function computeGroupBuyThresholdSavings(
  input: GroupBuyComputationInput,
): GroupBuyComputation {
  const { observedUnitPrice, thresholdUnitPrice, thresholdBasis, requiredParticipants } = input;
  const cents = savingCents(observedUnitPrice, thresholdUnitPrice);
  let perParticipantSaving: HarnessMoney | null = null;
  let totalGroupSaving: HarnessMoney | null = null;
  let unknownReason: string | null = null;
  if (cents === null) {
    unknownReason =
      observedUnitPrice.currency !== thresholdUnitPrice.currency
        ? `the observed unit price is in ${observedUnitPrice.currency} while the threshold is in ` +
          `${thresholdUnitPrice.currency} — the harness invents no exchange rate; the saving is UNKNOWN (INV-14)`
        : "an input amount is not a plain 2-dp decimal — the saving is UNKNOWN (INV-14), never guessed";
  } else if (cents > 0n) {
    perParticipantSaving = {
      amount: centsToAmount(cents),
      currency: observedUnitPrice.currency,
    };
    totalGroupSaving = {
      amount: centsToAmount(cents * BigInt(Math.max(2, requiredParticipants))),
      currency: observedUnitPrice.currency,
    };
  } else {
    // At-or-below the observed price: an honest NO saving — recorded as a zero
    // exact saving, never dressed as a positive one.
    perParticipantSaving = {
      amount: centsToAmount(cents),
      currency: observedUnitPrice.currency,
    };
    totalGroupSaving = {
      amount: centsToAmount(cents * BigInt(Math.max(2, requiredParticipants))),
      currency: observedUnitPrice.currency,
    };
  }

  const thresholdLabel =
    thresholdBasis === "published-volume-tier"
      ? "the merchant's PUBLISHED volume tier (an observed catalog fact)"
      : "a STATED ASSUMPTION (not observed — the threshold must be negotiated before any reliance)";
  const savingText =
    perParticipantSaving === null
      ? `UNKNOWN (${unknownReason})`
      : parseMoneyToCents(perParticipantSaving.amount) !== null && (parseMoneyToCents(perParticipantSaving.amount) as bigint) <= 0n
        ? `${formatHarnessMoney(perParticipantSaving)} (at-or-below the observed price — an honest NO saving, never dressed as one)`
        : `${formatHarnessMoney(perParticipantSaving)} per participant`;

  const prerequisites = [
    `the merchant honors the threshold price ${formatHarnessMoney(thresholdUnitPrice)} at checkout — the threshold is ${thresholdLabel}`,
    `a group of at least ${requiredParticipants} compatible, consented buyers actually commits (compatible demand, every participant consenting — never coerced or bundled)`,
    "a fresh independent re-observation of the price and the tier before any purchase (the issue #23 W2 freshness law — a conditional price is never a live quote)",
  ];

  return {
    perParticipantSaving,
    totalGroupSaving,
    requiredParticipants,
    unknownReason,
    prerequisites,
    actionable: false,
    renderedSaving: savingText,
    renderedThresholdBasis: thresholdLabel,
    basisLabels: {
      observedUnitPrice: "observed",
      thresholdUnitPrice: thresholdBasis,
      requiredParticipants:
        thresholdBasis === "published-volume-tier"
          ? "observed (the tier's minQuantity)"
          : "stated-assumption",
    },
  };
}

/**
 * Select the applicable tier for an observed price: the CHEAPEST published
 * tier whose unit price is strictly below the observed unit price (same
 * currency) and whose minQuantity ≥ 2. Returns null when no such tier exists
 * (the honest refusal — no group-buy surface is invented).
 */
export function selectApplicableVolumeTier(
  observedUnitPrice: HarnessMoney,
  tiers: readonly MerchantVolumeTier[],
): { tier: MerchantVolumeTier; computation: GroupBuyComputation } | null {
  let best: { tier: MerchantVolumeTier; computation: GroupBuyComputation } | null = null;
  let bestTierCents: bigint | null = null;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 2) continue;
    const fit = compareHarnessMoney(tier.unitPrice, observedUnitPrice);
    if (fit === null || fit >= 0) continue;
    const tierCents = parseMoneyToCents(tier.unitPrice.amount);
    if (tierCents === null) continue;
    if (bestTierCents === null || tierCents < bestTierCents) {
      bestTierCents = tierCents;
      best = {
        tier,
        computation: computeGroupBuyThresholdSavings({
          observedUnitPrice,
          thresholdUnitPrice: tier.unitPrice,
          thresholdBasis: "published-volume-tier",
          requiredParticipants: tier.minQuantity,
        }),
      };
    }
  }
  return best;
}
