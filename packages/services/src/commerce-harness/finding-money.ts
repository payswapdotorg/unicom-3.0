// ============================================================
// Commerce harness — W1 the canonical connector→harness money boundary
// ============================================================
//
// THE 2026-10-31 OPERATOR REVIEW'S REPRODUCED DEFECT, CLOSED HERE:
// the three former `finding.price.toFixed(2)` projections (planner.ts,
// families.ts, benchmark.ts) LAUNDERED a JS number into the strict decimal
// parser's input — a source value such as 400.005 was silently rounded to
// "400.00" (valid money) one step UPSTREAM of parseMoneyToCents, which would
// have rejected it. That violated INV-14's own law ("never parses silently,
// never rounds") before the parser could act.
//
// THE BOUNDARY LAW (this module, the ONE sanctioned projection):
//   1. `priceText` (a decimal string carried by the finding, when the
//      connector preserved it) is honored FIRST — validated by
//      parseMoneyToCents, never re-formatted.
//   2. Otherwise the number is projected via its SHORTEST ROUND-TRIP decimal
//      text (`String(price)`): accepted only when that text is a plain
//      non-negative decimal with AT MOST two fraction digits — then padded
//      to exactly two ("390" → "390.00" — the SAME exact value, padding is
//      not rounding, so pre-W1 byte-reproducible artifacts stay stable).
//   3. Any value whose exact text carries sub-cent precision (400.005,
//      0.1+0.2 = 0.30000000000000004), an exponent form (1e-7), a negative,
//      a non-finite, or an unparseable priceText projects to NULL — the
//      subtotal is UNKNOWN (INV-10), with the refusal reason carried in the
//      detail strings of the callers. NEVER rounded, never silently fixed.
//
// LANDED-COST LAW (W1-b): shipping/tax/duties are observed components of the
// SAME currency as the finding's price (a finding prices one offer in one
// currency); each is projected through the SAME exact boundary. The landed
// total is computed ONLY when subtotal + shipping + tax + duties are ALL
// observed — one BigInt-cents sum, no float anywhere. Any absent component
// leaves the landed total UNKNOWN (INV-10) — "within the total budget" is
// then never claimed.

import type { HarnessMoney } from "./intent.js";
import { parseMoneyToCents } from "./intent.js";

/** A finding-shaped price source: the numeric platform price + the optional preserved decimal text. */
export interface FindingPriceSource {
  price: number | null;
  currency: string | null;
  /** Optional decimal string preserved by the connector (the W1 preservation path). Validated, never re-formatted. */
  priceText?: string | null;
}

/** The observed landed-cost components on a finding (each null = UNKNOWN, never zero-by-default). */
export interface ObservedLandedCosts {
  shipping: number | null;
  tax: number | null;
  duties: number | null;
  /** Optional preserved decimal strings for the components (same preservation law as priceText). */
  shippingText?: string | null;
  taxText?: string | null;
  dutiesText?: string | null;
}

/**
 * Project a JS number to its EXACT 2-dp decimal text, or null when the exact
 * value carries sub-cent precision / an exponent / is negative or non-finite.
 * Padding "390" → "390.00" is the same exact value (never rounding).
 */
export function numberToExactMoneyText(value: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (Object.is(value, -0)) return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}

/** Project one component through the boundary: priceText first (validated verbatim), else the exact number projection. */
function projectComponent(
  value: number | null,
  text: string | null | undefined,
): { amount: string; cents: bigint } | null {
  if (typeof text === "string") {
    const cents = parseMoneyToCents(text);
    if (cents !== null) return { amount: text, cents };
    // An UNPARSEABLE preserved text is a connector defect — refused, never
    // silently re-derived from the number (the boundary never repairs input).
    return null;
  }
  if (value === null) return null;
  const amount = numberToExactMoneyText(value);
  if (amount === null) return null;
  const cents = parseMoneyToCents(amount);
  return cents === null ? null : { amount, cents };
}

/**
 * The finding's observed subtotal — the ONE canonical projection (W1-a).
 * Null when the price or currency is absent, or the exact value carries
 * sub-cent precision the parser would have rejected pre-laundering.
 */
export function findingSubtotal(finding: FindingPriceSource): HarnessMoney | null {
  if (finding.price === null && typeof finding.priceText !== "string") return null;
  if (finding.currency === null) return null;
  const component = projectComponent(finding.price, finding.priceText);
  if (component === null) return null;
  return { amount: component.amount, currency: finding.currency };
}

/**
 * Why a finding's subtotal refused to project — the honest refusal reason
 * (INV-10) the callers embed verbatim in their detail strings.
 */
export function findingSubtotalRefusalReason(finding: FindingPriceSource): string {
  if (finding.currency === null && finding.price === null && typeof finding.priceText !== "string") {
    return "the platform stated no price and no currency";
  }
  if (typeof finding.priceText === "string" && parseMoneyToCents(finding.priceText) === null) {
    return `the preserved price text "${finding.priceText}" is not a plain 2-dp decimal — refused, never repaired (INV-14)`;
  }
  if (finding.price !== null && numberToExactMoneyText(finding.price) === null) {
    return `the observed numeric price ${finding.price} carries sub-cent precision (${String(finding.price)}) — it is NOT rounded into money (INV-14); the subtotal is UNKNOWN`;
  }
  return "no observable price basis";
}

/** The observed landed-cost components, each through the SAME exact boundary (W1-b). */
export function findingLandedComponents(
  finding: FindingPriceSource & { landed?: ObservedLandedCosts | null },
): { shipping: HarnessMoney | null; tax: HarnessMoney | null; duties: HarnessMoney | null } {
  const landed = finding.landed ?? null;
  if (landed === null || finding.currency === null) {
    return { shipping: null, tax: null, duties: null };
  }
  const currency = finding.currency;
  const project = (
    value: number | null,
    text: string | null | undefined,
  ): HarnessMoney | null => {
    const component = projectComponent(value, text);
    return component === null ? null : { amount: component.amount, currency };
  };
  return {
    shipping: project(landed.shipping, landed.shippingText),
    tax: project(landed.tax, landed.taxText),
    duties: project(landed.duties, landed.dutiesText),
  };
}

/** The observed landed-total breakdown: total ONLY when every component is observed (W1-b). */
export interface FindingLandedBreakdown {
  subtotal: HarnessMoney | null;
  shipping: HarnessMoney | null;
  tax: HarnessMoney | null;
  duties: HarnessMoney | null;
  /** Present ONLY when subtotal+shipping+tax+duties are all observed — the exact BigInt-cents sum. */
  total: HarnessMoney | null;
  /** The components that remain UNKNOWN — never empty-when-total-present, by construction. */
  unknowns: string[];
}

/**
 * The finding's landed-total breakdown (W1-b). The total is computed only from
 * four observed same-currency components (the finding prices one offer in one
 * currency — the components inherit it); any absent component leaves the
 * total UNKNOWN with the component named in `unknowns` (INV-10).
 */
export function findingLandedBreakdown(
  finding: FindingPriceSource & { landed?: ObservedLandedCosts | null },
): FindingLandedBreakdown {
  const subtotal = findingSubtotal(finding);
  const components = findingLandedComponents(finding);
  const unknowns: string[] = [];
  if (subtotal === null) unknowns.push("subtotal");
  if (components.shipping === null) unknowns.push("shipping");
  if (components.tax === null) unknowns.push("tax");
  if (components.duties === null) unknowns.push("duties");
  let total: HarnessMoney | null = null;
  if (unknowns.length === 0 && subtotal !== null && components.shipping !== null && components.tax !== null && components.duties !== null) {
    const sum =
      (parseMoneyToCents(subtotal.amount) ?? 0n) +
      (parseMoneyToCents(components.shipping.amount) ?? 0n) +
      (parseMoneyToCents(components.tax.amount) ?? 0n) +
      (parseMoneyToCents(components.duties.amount) ?? 0n);
    const whole = sum / 100n;
    const fraction = (sum % 100n).toString().padStart(2, "0");
    total = { amount: `${whole}.${fraction}`, currency: subtotal.currency };
  }
  return {
    subtotal,
    shipping: components.shipping,
    tax: components.tax,
    duties: components.duties,
    total,
    unknowns,
  };
}

/** Compare two exact money values on BigInt cents: negative | 0 | positive | null (cross-currency/unparseable). */
export function compareHarnessMoney(
  a: HarnessMoney,
  b: HarnessMoney,
): number | null {
  if (a.currency !== b.currency) return null;
  const aCents = parseMoneyToCents(a.amount);
  const bCents = parseMoneyToCents(b.amount);
  if (aCents === null || bCents === null) return null;
  return aCents < bCents ? -1 : aCents > bCents ? 1 : 0;
}
