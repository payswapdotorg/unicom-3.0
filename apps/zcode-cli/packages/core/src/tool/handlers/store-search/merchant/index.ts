// ============================================================
// Merchant reads - the connector registry + the single entry (R6)
// ============================================================
//
// The merchant twin of store-search/index.ts: one registry function
// (merchantConnectorFor — real connectors only, null otherwise) and ONE
// entry the tool calls (readMerchantSnapshot). Credential reality drives
// the honest scope, per the R6 contract row ("unsupported operations
// called out, never simulated"):
//
//   - Etsy          -> the REAL merchant reader (keystring + user token,
//                      the one platform with a committed credential path).
//   - Shopify       -> the honest not_configured citing the Admin API
//                      access token merchant reads require (the storefront
//                      product API is buyer-side; inventory and orders live
//                      behind the Admin API).
//   - WooCommerce   -> the honest not_configured citing the consumer
//                      key/secret (ck_/cs_) REST credentials merchant reads
//                      require.
//   - anything else -> the honest not_supported.
//
// A simulated catalog or order list is NEVER returned (INV-16's discipline
// applied to the merchant plane: unsupported means unsupported).

import { normalizeStorePlatform } from "../index.js";
import type { StoreSearchError } from "../errors.js";
import { etsyMerchantConnector, type MerchantConnector } from "./etsy-merchant.js";
import type { MerchantReadParams, MerchantReadResult } from "./types.js";

export {
  etsyMerchantConnector,
  readMerchantRequestTable,
  resetMerchantRequestTable,
  type MerchantConnector,
} from "./etsy-merchant.js";
export type { MerchantRequestRecord } from "./types.js";
export {
  isMerchantReadError,
  type MerchantInventoryEntry,
  type MerchantMoney,
  type MerchantOrderEntry,
  type MerchantReadOperation,
  type MerchantReadParams,
  type MerchantReadResult,
  type MerchantReadSuccess,
  type MerchantShopSummary,
} from "./types.js";

// ——— the honest platform answers (credential-reality-driven) ———

/** Shopify merchant reads need the Admin API — never simulated. */
const SHOPIFY_MERCHANT_NOT_CONFIGURED: StoreSearchError = {
  code: "not_configured",
  message:
    "Shopify merchant reads need an Admin API access token — the public storefront product API is buyer-side; catalog, inventory and orders live behind the Admin API. Open Settings -> Connected Stores to add merchant credentials. Nothing was read.",
};

/** WooCommerce merchant reads need ck/cs REST credentials — never simulated. */
const WOO_MERCHANT_NOT_CONFIGURED: StoreSearchError = {
  code: "not_configured",
  message:
    "WooCommerce merchant reads need consumer key/secret (ck_/cs_) REST API credentials with read scope — the public catalog endpoint carries no inventory or order data. Open Settings -> Connected Stores to add them. Nothing was read.",
};

/** Unknown platform — the honest not_supported, never a fake read. */
function notSupportedError(platform: string): StoreSearchError {
  return {
    code: "not_supported",
    message: `No merchant_read connector for platform "${platform}" — merchant reads are delivered for Etsy (Shopify and WooCommerce merchant credentials are not yet wired). Connect an Etsy store with its keystring + user token, or ask for the buyer-side store_search instead.`,
  };
}

// ——— the registry ———

/**
 * The REAL-merchant-connector registry: Etsy today; every other platform
 * returns null and readMerchantSnapshot answers honestly (the
 * connectorFor discipline — null is a fact, not a failure).
 */
export function merchantConnectorFor(platform: string): MerchantConnector | null {
  return normalizeStorePlatform(platform) === "etsy" ? etsyMerchantConnector : null;
}

// ——— the single entry ———

/**
 * readMerchantSnapshot — the one door the merchant_read tool calls. Etsy
 * goes to the real reader; Shopify/WooCommerce answer the honest
 * not_configured citing exactly what credential is missing; anything else
 * answers not_supported. A simulated snapshot is NEVER returned.
 */
export async function readMerchantSnapshot(
  params: MerchantReadParams,
): Promise<MerchantReadResult> {
  const normalized = normalizeStorePlatform(params.platform);
  if (normalized === "etsy") {
    return etsyMerchantConnector.read(params);
  }
  if (normalized === "shopify") {
    return SHOPIFY_MERCHANT_NOT_CONFIGURED;
  }
  if (normalized === "woocommerce") {
    return WOO_MERCHANT_NOT_CONFIGURED;
  }
  return notSupportedError(params.platform);
}
