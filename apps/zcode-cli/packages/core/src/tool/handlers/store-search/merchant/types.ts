// ============================================================
// Merchant reads - the connector contract types (the R6 lane)
// ============================================================
//
// HARNESS-CONTRACT.md §3, the R6 row, verbatim: "the merchant-side L3/L4
// read plane: catalog/inventory/orders read through connected, authorized
// sources; unsupported operations called out, never simulated."
//
// The merchant (store owner) twin of the buyer-side store-search contract:
// the SAME connected-stores tier (stores.ts records, credentials included),
// the SAME error taxonomy — imported VERBATIM from ../errors.js, never
// re-declared (a taxonomy drift is a contract break, not a refactor) — and
// the SAME money law: every money field is exact money (a plain decimal
// string + currency code) or honest null-unknown, never a float.
//
// The layering wall (documented in find-best-offer/harness.ts and the
// services commerce-harness headers) applies here too: this module lives
// core-side beside the store-search connectors and imports them through
// relative paths only — @zcode/services is never imported from here.

import type { StoreSearchError } from "../errors.js";
import type { StoreCredentials } from "../types.js";

// ——— operations ———

/** The three merchant read operations (the R6 contract row's own list). */
export type MerchantReadOperation = "shop_summary" | "catalog_inventory" | "recent_orders";

// ——— exact money (INV-14: string decimals, never floats) ———

/**
 * Exact money: a plain decimal string ("45.99") + currency code. The string
 * is the payload's own decimal rendering, formatted through the cents-based
 * integer path — it is never the product of float arithmetic, and it is
 * rendered verbatim downstream.
 */
export interface MerchantMoney {
  amount: string;
  currency: string;
}

// ——— the operation payloads ———

/**
 * The shop summary — the platform's own fields, defensively read. Absent
 * fields are honest nulls (INV-10: UNKNOWN is preserved, never fabricated);
 * counts are numbers; dates are ISO strings or null.
 */
export interface MerchantShopSummary {
  shopId: number | null;
  shopName: string | null;
  listingActiveCount: number | null;
  listingDraftCount: number | null;
  listingExpiredCount: number | null;
  isVacation: boolean | null;
  currencyCode: string | null;
  /** ISO timestamp of the shop's create_date; null = the platform stated none. */
  createdAt: string | null;
}

/**
 * One catalog/inventory entry. `store` carries the connection record's label
 * (the StoreFinding.store precedent — merged multi-store lists stay
 * attributable); every money field is exact money or null-unknown.
 */
export interface MerchantInventoryEntry {
  store: string;
  listingId: number | null;
  title: string;
  /** The listing's own state string ("active" for the active-listings walk). */
  state: string | null;
  sku: string | null;
  quantity: number | null;
  price: MerchantMoney | null;
  url: string | null;
}

/**
 * One recent order (an Etsy receipt read through the buyer-less law: ONLY
 * receipt_id / create_date / grandtotal / currency_code are read — never a
 * buyer name, address, or any other personal field the merchant plane does
 * not need).
 */
export interface MerchantOrderEntry {
  store: string;
  receiptId: number | null;
  /** ISO timestamp (create_date epoch seconds -> ISO); null = unstated. */
  createdAt: string | null;
  grandTotal: MerchantMoney | null;
}

// ——— the connector contract ———

/** What one merchant read needs (validated + clamped by the tool). */
export interface MerchantReadParams {
  /** The record's platform name (normalized by the caller or the registry). */
  platform: string;
  /** The store's own host / shop id (the connection record's domain). */
  domain: string;
  /** Display name for the store (the connection record's label). */
  label: string;
  operation: MerchantReadOperation;
  /** Max entries for list-shaped operations (1..50, clamped by the tool). */
  limit?: number;
  /** Tier-2 merchant credentials, when the record carries them. */
  credentials?: StoreCredentials;
}

/** A successful merchant read. List fields are empty for the operations that
 * were not requested; `truncated` is the honest pagination-cap note. */
export interface MerchantReadSuccess {
  shopSummary?: MerchantShopSummary;
  inventory: MerchantInventoryEntry[];
  orders: MerchantOrderEntry[];
  truncated: boolean;
}

/**
 * One merchant read's result: success or an honest StoreSearchError — the
 * committed taxonomy, imported verbatim. A merchant connector never throws:
 * a failure is returned so one store's failure never fails the fan-out.
 */
export type MerchantReadResult = MerchantReadSuccess | StoreSearchError;

/** Guard for the failure arm (the isStoreSearchError precedent). */
export function isMerchantReadError(v: unknown): v is StoreSearchError {
  return (
    typeof v === "object" &&
    v !== null &&
    "code" in v &&
    typeof (v as StoreSearchError).code === "string" &&
    "message" in v &&
    typeof (v as StoreSearchError).message === "string"
  );
}

// Re-export the taxonomy types so merchant-side consumers import them from
// one place WITHOUT re-declaring them (the single-source law).
export type { StoreSearchError } from "../errors.js";

// ——— the L4 governed-execution trace (the authority proof) ———

/**
 * One recorded transport request. The merchant transport issues GET-class
 * requests ONLY — the table is the structural proof: a POST/PUT/PATCH/DELETE
 * in this table is a harness defect (unauthorized-action rate must be zero).
 */
export interface MerchantRequestRecord {
  method: "GET";
  url: string;
}
