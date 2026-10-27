// ============================================================
// Store search - the connector registry + platform discovery
// ============================================================

import type { StoreSearchError } from "./errors.js";
import { etsyConnector } from "./etsy.js";
import { normalizeStorefrontDomain, probeShopifyCatalog, shopifyConnector } from "./shopify.js";
import type { StoreConnector } from "./types.js";
import { normalizeWooOrigin, probeWooCatalog, wooConnector } from "./woocommerce.js";

export { etsyConnector, shopifyConnector, wooConnector };
export type {
  EtsyCredentials,
  StoreConnector,
  StoreCredentials,
  StoreFinding,
  StoreSearchParams,
  StoreSearchResult,
  StoreSearchSort,
  StoreSearchSuccess,
} from "./types.js";
export { isEtsyCredentials, isStoreSearchError } from "./types.js";
export { FETCH_TIMEOUT_MS, type StoreSearchError, type StoreSearchErrorCode } from "./errors.js";
export type { ConnectedStoresState, StoreRecord, StoreTier } from "./stores.js";
export { connectedStoresFilePaths, isSearchableStore, readConnectedStores } from "./stores.js";

/** The canonical platform ids this library knows connectors for. */
export type SupportedStorePlatform = "shopify" | "woocommerce" | "etsy";

/**
 * Normalize a platform name to its canonical connector id. Accepts the
 * registry's aliases ("woo" for woocommerce); case-insensitive. Unknown
 * platforms return null — the caller answers honestly (not_supported).
 */
export function normalizeStorePlatform(platform: string): SupportedStorePlatform | null {
  const p = platform.trim().toLowerCase();
  if (p === "shopify" || p === "shopify.com") return "shopify";
  if (p === "woocommerce" || p === "woo" || p === "woo.com" || p === "wc") return "woocommerce";
  if (p === "etsy" || p === "etsy.com") return "etsy";
  return null;
}

/**
 * The real-connector registry. Shopify, WooCommerce and Etsy search live
 * today; every other platform returns null and the tool answers with the
 * honest not_supported per-store status (never a fake search).
 */
export function connectorFor(platform: string): StoreConnector | null {
  switch (normalizeStorePlatform(platform)) {
    case "shopify":
      return shopifyConnector;
    case "woocommerce":
      return wooConnector;
    case "etsy":
      return etsyConnector;
    default:
      return null;
  }
}

// ——— platform discovery for user-provided URLs ———

export type PlatformDiscoveryResult =
  | { platform: "shopify" | "woocommerce"; domain: string }
  | { platform: null; error: StoreSearchError };

/**
 * urlToPlatform — the "connect by URL" sniffing helper for the future
 * StoresService connect flow: detect which public-catalog platform a
 * user-provided store URL serves (Shopify vs WooCommerce), with the same 10s
 * aborts + error taxonomy as the search connectors. Probes the cheapest
 * public endpoints live (a live probe beats string sniffing — custom domains
 * carry no platform hint):
 *   - Shopify: {host}/products.json?limit=1 (200 + products array)
 *   - Woo:     {origin}/wp-json/wc/v3/products?per_page=1 (200 + array)
 * A network-level failure (unreachable/timeout) fails fast; a locked or
 * missing catalog returns the more informative of the two classifications.
 */
export async function urlToPlatform(url: string): Promise<PlatformDiscoveryResult> {
  const host = normalizeStorefrontDomain(url);
  if (host.length === 0) {
    return { platform: null, error: { code: "platform_error", message: "The URL has no usable host." } };
  }
  const shopifyProbe = await probeShopifyCatalog(host);
  if (shopifyProbe === true) return { platform: "shopify", domain: host };
  if (shopifyProbe.code === "unreachable" || shopifyProbe.code === "timeout") {
    return { platform: null, error: shopifyProbe };
  }

  const origin = normalizeWooOrigin(url);
  const wooProbe = await probeWooCatalog(origin);
  if (wooProbe === true) return { platform: "woocommerce", domain: host };
  // Auth-style answers (401/403/429) mean "this IS the platform, but locked";
  // plain 404s mean "not this platform" — prefer the informative one.
  const authAnswered =
    wooProbe.code === "invalid_credentials" ||
    wooProbe.code === "insufficient_scope" ||
    wooProbe.code === "rate_limited";
  return { platform: null, error: authAnswered ? wooProbe : shopifyProbe };
}
