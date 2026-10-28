// ============================================================
// Commerce harness — L1 Intent (HARNESS-CONTRACT.md §1)
// ============================================================
//
// The buyer-intent hard-constraint envelope the whole harness threads:
// product/variant constraints (size, fit, brand, condition), geography,
// currency, maximum landed total cost, deadline, and the consent basis.
//
// LAWS (HARNESS-CONTRACT §1 + §2, binding every consumer of this type):
//   - An UNKNOWN constraint is an explicit field state, never an assumption
//     (INV-10): absent fields land in `unknowns`, they are never guessed.
//   - Money is exact (INV-14): a string decimal + an explicit currency code.
//     NEVER a float, never implicit currency. Arithmetic happens on BigInt
//     cents only (parseMoneyToCents) — no float math on money anywhere.
//   - Provenance (INV-15): who expressed the intent, when, through which
//     surface — carried on the immutable record.
//
// TWIN DISCLOSURE (the layering wall, the P4 storesService precedent): this
// module is the services-island canonical contract. The runtime implementation
// the agent actually calls is the core-side twin
// (apps/zcode-cli/packages/core/src/tool/handlers/find-best-offer.ts), which
// cannot import this package (@zcode/core declares no @zcode/services
// dependency and its tsc build is a plain rootDir-bounded program). The two
// are the two islands' faces of ONE contract — the same discipline as
// packages/services/src/stores/stores.ts ↔ the committed store-search reader.
// dispatch/harness-check-r4.mjs proves the twin agreement against this module.

/** Exact money (INV-14): a decimal string + an explicit currency code. */
export interface HarnessMoney {
  /** Decimal string, e.g. "400", "400.00". Never a number, never formatted. */
  amount: string;
  /** Explicit currency code, e.g. "HKD", "USD". Never implicit. */
  currency: string;
}

/**
 * What the principal authorized the harness to do on their behalf
 * (issue #23 W2 consent law). v1 knows exactly one basis: read-only search.
 */
export type CommerceConsentBasis = "read-only-search";

/** The intent-constraint fields that can be UNKNOWN (INV-10). */
export type CommerceIntentUnknownField =
  | "maxLandedTotalCost"
  | "size"
  | "brand"
  | "condition"
  | "geography"
  | "deadline"
  | "excludedStores";

/** Every field that can be UNKNOWN — the closed set, none silently missing. */
export const COMMERCE_INTENT_UNKNOWN_FIELDS: readonly CommerceIntentUnknownField[] = [
  "maxLandedTotalCost",
  "size",
  "brand",
  "condition",
  "geography",
  "deadline",
  "excludedStores",
];

/** The L1 intent envelope (a structured profile of CommerceIntent, not a second intent type). */
export interface CommerceIntentEnvelope {
  /** The product terms, e.g. "yeezy shoes". */
  query: string;
  /** Maximum landed total cost — exact money (INV-14). Absent = UNKNOWN. */
  maxLandedTotalCost?: HarnessMoney;
  /** Size/variant constraint, e.g. "EU 44". Absent = UNKNOWN. */
  size?: string;
  /** Brand constraint, e.g. "adidas". Absent = UNKNOWN. */
  brand?: string;
  /** Condition constraint, e.g. "new". Absent = UNKNOWN. */
  condition?: string;
  /** Geography (ship-to), e.g. "HK". Absent = UNKNOWN. */
  geography?: string;
  /** Deadline (ISO date). Absent = UNKNOWN. */
  deadline?: string;
  /** Stores (label or domain) to exclude from the plan. Absent = UNKNOWN (none excluded). */
  excludedStores?: string[];
  /** What the principal authorized. v1: read-only search, by construction. */
  consentBasis: CommerceConsentBasis;
  /** Provenance: who expressed it, when, through which surface (INV-15). */
  provenance: {
    surface: string;
    expressedAt: string;
  };
  /** The constraint fields that were absent — recorded UNKNOWN, never assumed (INV-10). */
  unknowns: CommerceIntentUnknownField[];
}

// ——— exact money helpers (INV-14: BigInt cents, never float arithmetic) ———

/**
 * Parse a decimal string ("400", "400.00", "4000.5") to BigInt cents.
 * Returns null for anything that is not a plain non-negative decimal with
 * at most two fraction digits — never parses silently, never rounds.
 */
export function parseMoneyToCents(amount: string): bigint | null {
  if (!/^\d+(\.\d{1,2})?$/u.test(amount)) {
    return null;
  }
  const [wholeMaybe, fraction = ""] = amount.split(".");
  const whole = wholeMaybe ?? "0";
  const padded = (fraction + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(padded);
}

/** Compare two cent amounts: negative | 0 | positive (BigInt compare — exact). */
export function compareCents(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Format exact money for display: "HKD 400.00" (currency code + 2-dp decimal, locale-neutral). */
export function formatHarnessMoney(money: HarnessMoney): string {
  const cents = parseMoneyToCents(money.amount);
  if (cents === null) {
    return `${money.currency} ${money.amount}`;
  }
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${money.currency} ${whole}.${fraction.toString().padStart(2, "0")}`;
}
