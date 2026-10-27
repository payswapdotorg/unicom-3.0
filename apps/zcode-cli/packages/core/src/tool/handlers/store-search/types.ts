// ============================================================
// Store search - connector contract types
// ============================================================
//
// Ported from the live-verified FE3 connector law (error taxonomy, 10s aborts,
// pagination caps, honest failure) re-targeted from "shop metrics" to "product
// catalog search". A connector either returns real findings from the platform's
// own API or an honest StoreSearchError — never a fabricated search.

import type { StoreSearchError } from "./errors.js";

/** How the merged findings are ordered (REPORT.md section 4 tool contract). */
export type StoreSearchSort = "newest" | "relevance" | "price_asc" | "price_desc";

/** One search hit, in the exact result shape of REPORT.md section 4. */
export interface StoreFinding {
  platform: string;
  /** Display name of the connected store (the record's label). */
  store: string;
  store_domain: string;
  title: string;
  price: number | null;
  currency: string | null;
  /** The product page URL — opens in the integrated browser. */
  url: string;
  image_url: string | null;
  /** ISO-ish timestamp when the platform states one; null = unknown. */
  published_at: string | null;
  /** True when the store's scan hit a pagination cap (honest truncation note). */
  truncated?: boolean;
}

/**
 * Per-platform search parameters. `credentials` is only present for Tier-2
 * (credential-gated) connectors; a Tier-2 connector that receives none answers
 * the honest `not_configured` error instead of a fake search.
 */
export interface StoreSearchParams {
  /** The store's own host (Shopify storefront domain, Woo origin, Etsy shop id/name). */
  domain: string;
  /** Display name for the store (the connection record's label). */
  label: string;
  /** Free-text product query, latest-first when the platform allows. */
  query: string;
  /** Max findings per store (1..25, default 5 — enforced by the tool schema). */
  maxPerStore: number;
  sort: StoreSearchSort;
  credentials?: StoreCredentials;
}

/** A successful connector scan. `truncated` is the honest pagination-cap note. */
export interface StoreSearchSuccess {
  findings: StoreFinding[];
  truncated: boolean;
}

export type StoreSearchResult = StoreSearchSuccess | StoreSearchError;

/**
 * One real platform connector. `search` hits the LIVE platform API with a hard
 * 10s abort per request — it either returns real findings or an honest error.
 * It never throws: a transport/auth failure is returned as a StoreSearchError
 * so one store's failure can never fail the whole federated call.
 */
export interface StoreConnector {
  search(params: StoreSearchParams): Promise<StoreSearchResult>;
}

// ——— credentials (Tier-2) ———

/** Etsy OpenAPI v3 personal access pair (keystring + user token). */
export interface EtsyCredentials {
  apiKeyString: string;
  userToken: string;
}

export type StoreCredentials = EtsyCredentials;

/** Etsy credential shape guard (shared by the state reader and the connector). */
export function isEtsyCredentials(v: unknown): v is EtsyCredentials {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as EtsyCredentials).apiKeyString === "string" &&
    (v as EtsyCredentials).apiKeyString.trim().length > 0 &&
    typeof (v as EtsyCredentials).userToken === "string" &&
    (v as EtsyCredentials).userToken.trim().length > 0
  );
}

/** Guard for the connector result's failure arm. */
export function isStoreSearchError(v: unknown): v is StoreSearchError {
  return (
    typeof v === "object" &&
    v !== null &&
    "code" in v &&
    typeof (v as StoreSearchError).code === "string" &&
    "message" in v &&
    typeof (v as StoreSearchError).message === "string"
  );
}
