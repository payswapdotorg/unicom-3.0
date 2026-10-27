// ============================================================
// Store search - the WooCommerce PUBLIC CATALOG connector (Tier-1)
// ============================================================
//
// Grounded in the live-verified FE3 WooCommerce connector semantics
// (woocommerce.github.io/woocommerce-rest-api-docs), re-targeted to the
// public product catalog (no consumer key/secret):
//   - ENDPOINT: {origin}/wp-json/wc/v3/products?per_page=100&page=N&search=…
//     — public on many stores; many others disable public REST and answer
//     401 "Sorry, you cannot list resources." (verified live) — classified
//     honestly per the taxonomy, never faked.
//   - COUNTS/TRUNCATION: list endpoints answer X-WP-Total (the matched
//     total) and X-WP-TotalPages — the honest `truncated` note comes from
//     the platform's own totals (cap: 3 pages x 100 products).
//   - SEARCH: Woo's own server-side `search` param does the matching;
//     orderby/order map the requested sort onto the platform's own sorting
//     (date / price).
// Every fetch carries a hard 10s abort. Failures are honest StoreSearchErrors.

import {
  classifyFetchThrow,
  classifyPlatformFetch,
  fetchWithTimeout,
  type StoreSearchError,
} from "./errors.js";
import type { StoreConnector, StoreFinding, StoreSearchParams, StoreSearchSort } from "./types.js";

const PLATFORM = "WooCommerce";
const API_PATH = "/wp-json/wc/v3";
const PRODUCTS_PER_PAGE = 100;
/** Catalog scan cap: 3 pages x 100 products = 300 — honest `truncated` beyond. */
const PAGE_CAP = 3;

/**
 * Normalize a site input to the API origin (scheme + host + optional port;
 * paths stripped). Missing scheme defaults to https:// — same law as the FE3
 * connector. Ported verbatim.
 */
export function normalizeWooOrigin(input: string): string {
  let s = input.trim();
  if (s.length === 0) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/** The bare host (no scheme) — the canonical store_domain for findings. */
export function wooHostOf(input: string): string {
  return normalizeWooOrigin(input).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

// ——— transport ———

type WooResponse =
  | { ok: true; json: unknown; headers: Headers }
  | { ok: false; error: StoreSearchError };

async function wooFetch(url: string): Promise<WooResponse> {
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
    return { ok: true, json: JSON.parse(bodyText), headers: res.headers };
  } catch {
    return {
      ok: false,
      error: {
        code: "platform_error",
        message: `${PLATFORM} answered ${res.status} but the payload wasn't the expected JSON — the connector cannot read it honestly.`,
      },
    };
  }
}

/** X-WP-Total: the platform's own matched total. */
function wpTotalOf(headers: Headers): number | null {
  const raw = headers.get("x-wp-total");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The requested sort as Woo's own orderby/order params (relevance: none). */
function sortParams(sort: StoreSearchSort): { orderby?: string; order?: string } {
  switch (sort) {
    case "newest":
      return { orderby: "date", order: "desc" };
    case "price_asc":
      return { orderby: "price", order: "asc" };
    case "price_desc":
      return { orderby: "price", order: "desc" };
    default:
      return {};
  }
}

// ——— normalization ———

function toFinding(product: Record<string, unknown>, host: string): StoreFinding | null {
  const name = typeof product.name === "string" ? product.name.trim() : "";
  const permalink = typeof product.permalink === "string" ? product.permalink.trim() : "";
  if (name.length === 0 || permalink.length === 0) return null;
  let price: number | null = null;
  if (typeof product.price === "string" || typeof product.price === "number") {
    const parsed = Number.parseFloat(String(product.price));
    if (Number.isFinite(parsed)) price = parsed;
  }
  // Woo's product object doesn't state a currency; some setups add one —
  // surface it when present, else honest null.
  const currency =
    typeof product.currency === "string" && product.currency.length > 0 ? product.currency : null;
  let image_url: string | null = null;
  let imageDate: string | null = null;
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0];
    if (typeof first === "object" && first !== null) {
      const img = first as Record<string, unknown>;
      if (typeof img.src === "string" && img.src.length > 0) image_url = img.src;
      if (typeof img.date_created === "string" && img.date_created.length > 0) {
        imageDate = img.date_created;
      }
    }
  }
  const published_at =
    typeof product.date_created === "string" && product.date_created.length > 0
      ? product.date_created
      : imageDate;
  return {
    platform: "woocommerce",
    store: "",
    store_domain: host,
    title: name,
    price,
    currency,
    url: permalink,
    image_url,
    published_at,
  };
}

function timestampOf(finding: StoreFinding): number {
  if (finding.published_at === null) return 0;
  const ms = Date.parse(finding.published_at);
  return Number.isFinite(ms) ? ms : 0;
}

function priceOf(finding: StoreFinding): number {
  return finding.price ?? Number.POSITIVE_INFINITY;
}

// ——— the connector ———

export const wooConnector: StoreConnector = {
  async search(params: StoreSearchParams) {
    const origin = normalizeWooOrigin(params.domain);
    if (origin.length === 0 || origin === "https://") {
      return {
        code: "platform_error",
        message: `${PLATFORM}: the store domain is empty — check the Connected Stores record.`,
      };
    }
    const host = wooHostOf(origin);
    const collected: Record<string, unknown>[] = [];
    let total: number | null = null;
    let walkCapped = false;

    const { orderby, order } = sortParams(params.sort);
    for (let page = 1; page <= PAGE_CAP; page += 1) {
      const search = new URLSearchParams({
        per_page: String(PRODUCTS_PER_PAGE),
        page: String(page),
        search: params.query,
      });
      if (orderby !== undefined) search.set("orderby", orderby);
      if (order !== undefined) search.set("order", order);
      const res = await wooFetch(`${origin}${API_PATH}/products?${search.toString()}`);
      if (!res.ok) return res.error;
      const pageTotal = wpTotalOf(res.headers);
      if (pageTotal !== null) total = pageTotal;
      const rows = Array.isArray(res.json)
        ? res.json.filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        : [];
      collected.push(...rows);
      if (rows.length < PRODUCTS_PER_PAGE) break; // matched set exhausted
      if (page === PAGE_CAP) walkCapped = true; // full page at the cap: more matched
    }

    // Honest truncation from the platform's own totals (X-WP-Total), else the
    // full-page-at-cap fact.
    const truncated = walkCapped || (total !== null && total > collected.length);

    const findings: StoreFinding[] = [];
    for (const row of collected) {
      const finding = toFinding(row, host);
      if (finding === null) continue;
      finding.store = params.label;
      findings.push(finding);
    }
    // The platform already sorted; only newest needs the local tie-breaker for
    // stores that ignore orderby (undated last, newest first).
    if (params.sort === "newest") {
      findings.sort((a, b) => timestampOf(b) - timestampOf(a));
    } else if (params.sort === "price_asc") {
      findings.sort((a, b) => priceOf(a) - priceOf(b));
    } else if (params.sort === "price_desc") {
      findings.sort((a, b) => priceOf(b) - priceOf(a));
    }
    const limited = findings.slice(0, params.maxPerStore);
    if (truncated) {
      for (const finding of limited) finding.truncated = true;
    }
    return { findings: limited, truncated };
  },
};

// ——— platform discovery (shared with the connector registry) ———

/**
 * Does this origin serve the public Woo REST catalog? (discoverPlatformForUrl's
 * Woo probe — one cheapest-possible page read; X-WP-Total proves the endpoint.)
 */
export async function probeWooCatalog(origin: string): Promise<true | StoreSearchError> {
  const normalized = normalizeWooOrigin(origin);
  if (normalized.length === 0 || normalized === "https://") {
    return { code: "platform_error", message: "The URL has no usable host." };
  }
  const res = await wooFetch(`${normalized}${API_PATH}/products?per_page=1`);
  if (!res.ok) return res.error;
  if (!Array.isArray(res.json)) {
    return {
      code: "platform_error",
      message: `${PLATFORM} answered 200 but /wp-json/wc/v3/products didn't return a product array — this may not be a WooCommerce store.`,
    };
  }
  return true;
}
