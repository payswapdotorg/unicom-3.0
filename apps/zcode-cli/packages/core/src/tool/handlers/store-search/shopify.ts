// ============================================================
// Store search - the Shopify PUBLIC CATALOG connector (Tier-1)
// ============================================================
//
// Grounded in the live-verified FE3 Shopify connector semantics, re-targeted
// to the storefront's public catalog (no credentials):
//   - ENDPOINT: https://{storefront-domain}/products.json?limit=250&page=N —
//     public on most storefronts (custom domains like kith.com included; some
//     *.myshopify.com hosts are password-protected and answer 401 honestly).
//   - PAGINATION: page walk, cap 3 pages (750 products) — `truncated` says so
//     honestly when the cap stopped a full walk.
//   - CURRENCY: the public catalog payload carries no currency; the storefront's
//     public /cart.js does (verified live: {"currency":"USD"}) — one best-effort
//     read per search, honest null on any failure.
//   - There is no server-side text filter on the public endpoint — filtering is
//     client-side over title/tags/product_type/vendor (all-token match preferred,
//     any-token match as the fallback so "yeezy shoes" finds Yeezys even when
//     the title alone says "YEEZY BOOST 350 V2").
// Every fetch carries a hard 10s abort. Failures are honest StoreSearchErrors.

import {
  classifyFetchThrow,
  classifyPlatformFetch,
  fetchWithTimeout,
  type StoreSearchError,
} from "./errors.js";
import type { StoreConnector, StoreFinding, StoreSearchParams, StoreSearchSort } from "./types.js";

const PLATFORM = "Shopify";
const PRODUCTS_PER_PAGE = 250;
/** Catalog scan cap: 3 pages x 250 products = 750 — honest `truncated` beyond. */
const PAGE_CAP = 3;

/**
 * Normalize a storefront input to the host the public catalog serves from.
 * Accepts "kith", "kith.myshopify.com", "https://kith.com/collections/all"
 * -> "kith.myshopify.com" / "kith.com" (custom domains keep their host — the
 * public catalog serves from them too, and some myshopify.com hosts are
 * password-protected while the custom domain is open).
 */
export function normalizeStorefrontDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, ""); // strip protocol
  s = s.replace(/\/+$/, ""); // strip trailing slashes
  const slash = s.indexOf("/");
  if (slash !== -1) s = s.slice(0, slash); // strip any path
  if (s.length === 0) return s;
  if (s.includes(".")) return s; // a real host (custom or myshopify.com)
  return `${s}.myshopify.com`; // a bare shop slug
}

// ——— transport ———

type ShopifyResponse =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; error: StoreSearchError };

async function shopifyFetch(url: string): Promise<ShopifyResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    return { ok: false, error: classifyFetchThrow(PLATFORM, e) };
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: classifyPlatformFetch(PLATFORM, res.status, res.headers, bodyText) };
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === "object" && parsed !== null) {
      return { ok: true, json: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through to the honest unexpected-payload error
  }
  return {
    ok: false,
    error: {
      code: "platform_error",
      message: `${PLATFORM} answered ${res.status} but the payload wasn't the expected JSON — the connector cannot read it honestly.`,
    },
  };
}

// ——— filtering ———

/** Tiny stopword set so natural queries ("find me the latest yeezy shoes")
 * still filter on their meaningful tokens. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "buy", "find", "for", "from", "get",
  "in", "is", "it", "latest", "me", "my", "new", "newest", "of", "on", "or",
  "please", "search", "show", "some", "the", "to", "want", "with",
]);

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

interface ScoredProduct {
  product: Record<string, unknown>;
  matchedTokens: number;
}

function searchableText(product: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof product.title === "string") parts.push(product.title);
  if (typeof product.product_type === "string") parts.push(product.product_type);
  if (typeof product.vendor === "string") parts.push(product.vendor);
  if (typeof product.tags === "string") parts.push(product.tags);
  if (Array.isArray(product.tags)) {
    parts.push(product.tags.filter((t) => typeof t === "string").join(" "));
  }
  return parts.join(" \n ").toLowerCase();
}

/** All-token match preferred (precise); any-token fallback (recall). */
function filterProducts(
  products: Record<string, unknown>[],
  tokens: string[],
): ScoredProduct[] {
  if (tokens.length === 0) {
    return products.map((product) => ({ product, matchedTokens: 0 }));
  }
  const any: ScoredProduct[] = [];
  const all: ScoredProduct[] = [];
  for (const product of products) {
    const text = searchableText(product);
    const matchedTokens = tokens.filter((token) => text.includes(token)).length;
    if (matchedTokens === 0) continue;
    const scored = { product, matchedTokens };
    any.push(scored);
    if (matchedTokens === tokens.length) all.push(scored);
  }
  return all.length > 0 ? all : any;
}

// ——— normalization ———

function parseFloatOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number.parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFinding(
  product: Record<string, unknown>,
  host: string,
  currency: string | null,
): StoreFinding | null {
  const title = typeof product.title === "string" ? product.title.trim() : "";
  const handle = typeof product.handle === "string" ? product.handle.trim() : "";
  if (title.length === 0 || handle.length === 0) return null;
  // Price: first variant's price, else a product-level price field.
  let price: number | null = null;
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const first = product.variants[0];
    if (typeof first === "object" && first !== null) {
      price = parseFloatOrNull((first as Record<string, unknown>).price);
    }
  }
  if (price === null) price = parseFloatOrNull(product.price);
  let image_url: string | null = null;
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0];
    if (typeof first === "object" && first !== null) {
      const src = (first as Record<string, unknown>).src;
      if (typeof src === "string" && src.length > 0) image_url = src;
    }
  }
  const published_at =
    typeof product.published_at === "string" && product.published_at.length > 0
      ? product.published_at
      : null;
  return {
    platform: "shopify",
    store: "",
    store_domain: host,
    title,
    price,
    currency,
    url: `https://${host}/products/${handle}`,
    image_url,
    published_at,
  };
}

function timestampOf(finding: StoreFinding): number {
  if (finding.published_at === null) return 0;
  const ms = Date.parse(finding.published_at);
  return Number.isFinite(ms) ? ms : 0;
}

function sortFindings(
  findings: StoreFinding[],
  scored: Map<StoreFinding, number>,
  sort: StoreSearchSort,
): void {
  if (sort === "price_asc" || sort === "price_desc") {
    const direction = sort === "price_asc" ? 1 : -1;
    findings.sort((a, b) => {
      const ap = a.price ?? Number.POSITIVE_INFINITY;
      const bp = b.price ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return (ap - bp) * direction;
      return timestampOf(b) - timestampOf(a);
    });
    return;
  }
  if (sort === "relevance") {
    findings.sort((a, b) => {
      const at = scored.get(a) ?? 0;
      const bt = scored.get(b) ?? 0;
      if (at !== bt) return bt - at;
      return timestampOf(b) - timestampOf(a);
    });
    return;
  }
  // newest (default): latest published_at first, undated last.
  findings.sort((a, b) => timestampOf(b) - timestampOf(a));
}

// ——— the connector ———

export const shopifyConnector: StoreConnector = {
  async search(params: StoreSearchParams) {
    const host = normalizeStorefrontDomain(params.domain);
    if (host.length === 0) {
      return {
        code: "platform_error",
        message: `${PLATFORM}: the store domain is empty — check the Connected Stores record.`,
      };
    }
    const tokens = queryTokens(params.query);
    // Currency read overlaps the page walk (best-effort; null on any failure).
    const currencyPromise = shopifyFetch(`https://${host}/cart.js`);
    const collected: Record<string, unknown>[] = [];
    let walkCapped = false;

    for (let page = 1; page <= PAGE_CAP; page += 1) {
      const res = await shopifyFetch(
        `https://${host}/products.json?limit=${PRODUCTS_PER_PAGE}&page=${page}`,
      );
      if (!res.ok) {
        // The currency probe is irrelevant when the catalog itself failed.
        return res.error;
      }
      const products = Array.isArray(res.json.products) ? res.json.products : [];
      const rows = products.filter(
        (p): p is Record<string, unknown> => typeof p === "object" && p !== null,
      );
      collected.push(...rows);
      if (rows.length < PRODUCTS_PER_PAGE) break; // catalog exhausted
      if (page === PAGE_CAP) walkCapped = true; // full page at the cap: more may exist
    }

    const currencyRes = await currencyPromise;
    const currency =
      currencyRes.ok && typeof currencyRes.json.currency === "string"
        ? currencyRes.json.currency
        : null;

    const scoredMap = new Map<StoreFinding, number>();
    const findings: StoreFinding[] = [];
    for (const { product, matchedTokens } of filterProducts(collected, tokens)) {
      const finding = toFinding(product, host, currency);
      if (finding === null) continue;
      finding.store = params.label;
      scoredMap.set(finding, matchedTokens);
      findings.push(finding);
    }
    sortFindings(findings, scoredMap, params.sort);
    const limited = findings.slice(0, params.maxPerStore);
    // Honest truncation note: the catalog scan stopped at the page cap.
    if (walkCapped) {
      for (const finding of limited) finding.truncated = true;
    }
    return { findings: limited, truncated: walkCapped };
  },
};

// ——— platform discovery (shared with the connector registry) ———

/**
 * Does this host serve a public Shopify catalog? (discoverPlatformForUrl's
 * Shopify probe — one cheapest-possible page read.)
 */
export async function probeShopifyCatalog(host: string): Promise<true | StoreSearchError> {
  const normalized = normalizeStorefrontDomain(host);
  if (normalized.length === 0) {
    return { code: "platform_error", message: "The URL has no usable host." };
  }
  const res = await shopifyFetch(`https://${normalized}/products.json?limit=1`);
  if (!res.ok) return res.error;
  if (!Array.isArray(res.json.products)) {
    return {
      code: "platform_error",
      message: `${PLATFORM} answered 200 but /products.json carried no products array — this may not be a Shopify storefront.`,
    };
  }
  return true;
}
