// ============================================================
// Store search - the Etsy OpenAPI v3 connector (Tier-2, credentials)
// ============================================================
//
// Endpoint + field facts re-verified against the LIVE official Etsy OpenAPI
// 3.0.0 spec (https://www.etsy.com/openapi/generated/oas/3.0.0.json) and the
// live-verified FE3 Etsy connector semantics:
//   - AUTH: `x-api-key: {keyString}` + `Authorization: Bearer {userToken}`
//     (personal access tokens come as a keystring/token pair). No credentials
//     -> the honest `not_configured` error — never a fake search.
//   - SHOP RESOLUTION (FE3-verified path): GET /application/users/me ->
//     user_id, then GET /application/users/{user_id}/shops -> shop_id. A store
//     record whose domain is already the numeric shop_id skips the round trip.
//   - SEARCH: GET /application/shops/{shop_id}/listings/active with
//     `keywords` (server-side match), `limit` (1-100) / `offset` walk (cap 3
//     pages), `sort_on` in {created, price, updated, score} + `sort_order`.
//   - MONEY: Money = { amount, divisor, currency_code } — the value is
//     amount / divisor (divisor is typically 100 -> cents).
//   - TIMESTAMPS: listing timestamps (original_creation_timestamp /
//     created_timestamp) are epoch SECONDS (spec: "in epoch seconds").
//   - IMAGES: ShopListing carries no images (a per-listing call) — findings
//     keep image_url null, honestly, rather than paying 1 call per listing.
// Every fetch carries a hard 10s abort. Failures are honest StoreSearchErrors.

import {
  classifyFetchThrow,
  classifyPlatformFetch,
  fetchWithTimeout,
  notConfiguredError,
  type StoreSearchError,
} from "./errors.js";
import {
  isEtsyCredentials,
  type EtsyCredentials,
  type StoreConnector,
  type StoreFinding,
  type StoreSearchParams,
  type StoreSearchSort,
  type StoreSearchSuccess,
} from "./types.js";

const PLATFORM = "Etsy";
const BASE = "https://openapi.etsy.com/v3";
const LISTINGS_PER_PAGE = 100;
/** Listing walk cap: 3 pages x 100 listings = 300 — honest `truncated` beyond. */
const PAGE_CAP = 3;

// ——— transport ———

type EtsyResponse =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; error: StoreSearchError };

async function etsyFetch(
  path: string,
  credentials: EtsyCredentials,
): Promise<EtsyResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}${path}`, {
      headers: {
        "x-api-key": credentials.apiKeyString,
        Authorization: `Bearer ${credentials.userToken}`,
      },
    });
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

// ——— field helpers (FE3-verified semantics) ———

/** Etsy list endpoints wrap results as { count, results } — count is the
 * API's own matched total. */
function listPayload(json: Record<string, unknown>): { count: number | null; results: unknown[] } {
  const count = typeof json.count === "number" && Number.isFinite(json.count) ? json.count : null;
  const results = Array.isArray(json.results) ? json.results : [];
  return { count, results };
}

/** Etsy Money = { amount, divisor, currency_code } -> major units. */
function moneyMajorUnits(
  v: unknown,
): { value: number; currency: string | null } | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  const amount = typeof m.amount === "number" ? m.amount : NaN;
  const divisor = typeof m.divisor === "number" && m.divisor > 0 ? m.divisor : NaN;
  if (!Number.isFinite(amount) || !Number.isFinite(divisor)) return null;
  return {
    value: Math.round((amount / divisor) * 100) / 100,
    currency:
      typeof m.currency_code === "string" && m.currency_code.length > 0
        ? m.currency_code
        : null,
  };
}

/** Epoch seconds (spec) -> ISO string; values that already look like
 * milliseconds (>= 1e12) are taken as-is, defensively. */
function epochSecondsToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const ms = v >= 1e12 ? v : v * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The requested sort as Etsy's own sort_on/sort_order (relevance: none —
 * the API's own score ordering). */
function sortParams(sort: StoreSearchSort): { sort_on?: string; sort_order?: string } {
  switch (sort) {
    case "newest":
      return { sort_on: "created", sort_order: "desc" };
    case "price_asc":
      return { sort_on: "price", sort_order: "asc" };
    case "price_desc":
      return { sort_on: "price", sort_order: "desc" };
    default:
      return {};
  }
}

// ——— shop resolution (FE3-verified path) ———

async function resolveShopId(
  domain: string,
  credentials: EtsyCredentials,
): Promise<number | StoreSearchError> {
  // A numeric record domain IS the shop_id — skip the round trip.
  const numeric = /^\d+$/u.test(domain.trim()) ? Number.parseInt(domain.trim(), 10) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const me = await etsyFetch("/application/users/me", credentials);
  if (!me.ok) return me.error;
  const userId = me.json.user_id;
  if (typeof userId !== "number" || !Number.isFinite(userId)) {
    return {
      code: "platform_error",
      message: `${PLATFORM}'s users/me answered 200 without a user_id — the connector cannot resolve the shop honestly.`,
    };
  }
  const shops = await etsyFetch(`/application/users/${userId}/shops`, credentials);
  if (!shops.ok) return shops.error;
  const shopId = shops.json.shop_id;
  if (typeof shopId !== "number" || !Number.isFinite(shopId)) {
    return {
      code: "platform_error",
      message: `${PLATFORM} answered 200 for the account's shops without a shop_id — this account may not own a shop.`,
    };
  }
  return shopId;
}

// ——— normalization ———

function toFinding(listing: Record<string, unknown>): StoreFinding | null {
  const title = typeof listing.title === "string" ? listing.title.trim() : "";
  const url = typeof listing.url === "string" ? listing.url.trim() : "";
  if (title.length === 0 || url.length === 0) return null;
  const price = moneyMajorUnits(listing.price);
  const published_at =
    epochSecondsToIso(listing.original_creation_timestamp) ??
    epochSecondsToIso(listing.created_timestamp);
  return {
    platform: "etsy",
    store: "",
    store_domain: "", // filled by the connector from the record's domain
    title,
    price: price?.value ?? null,
    currency: price?.currency ?? null,
    url,
    image_url: null, // ShopListing carries no images (per-listing call) — honest null.
    published_at,
  };
}

// ——— the connector ———

export const etsyConnector: StoreConnector = {
  async search(params: StoreSearchParams): Promise<StoreSearchSuccess | StoreSearchError> {
    const credentials = params.credentials;
    if (!isEtsyCredentials(credentials)) {
      // Tier-2 without credentials: honest, never a fake search.
      return notConfiguredError(PLATFORM);
    }
    const shopId = await resolveShopId(params.domain, credentials);
    if (typeof shopId !== "number") return shopId;

    const collected: Record<string, unknown>[] = [];
    let total: number | null = null;
    let walkCapped = false;
    const { sort_on, sort_order } = sortParams(params.sort);

    for (
      let offset = 0;
      offset < PAGE_CAP * LISTINGS_PER_PAGE;
      offset += LISTINGS_PER_PAGE
    ) {
      const search = new URLSearchParams({
        limit: String(LISTINGS_PER_PAGE),
        offset: String(offset),
      });
      if (params.query.trim().length > 0) search.set("keywords", params.query.trim());
      if (sort_on !== undefined) search.set("sort_on", sort_on);
      if (sort_order !== undefined) search.set("sort_order", sort_order);
      const page = await etsyFetch(
        `/application/shops/${shopId}/listings/active?${search.toString()}`,
        credentials,
      );
      if (!page.ok) return page.error;
      const { count, results } = listPayload(page.json);
      if (count !== null) total = count;
      const rows = results.filter(
        (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
      );
      collected.push(...rows);
      if (rows.length < LISTINGS_PER_PAGE) break; // matched set exhausted
      if (offset + LISTINGS_PER_PAGE >= PAGE_CAP * LISTINGS_PER_PAGE) walkCapped = true;
    }

    // Honest truncation from the API's own count, else the full-page-at-cap fact.
    const truncated = walkCapped || (total !== null && total > collected.length);

    const findings: StoreFinding[] = [];
    for (const row of collected) {
      const finding = toFinding(row);
      if (finding === null) continue;
      finding.store = params.label;
      const recordDomain = params.domain.trim();
      finding.store_domain = recordDomain.length > 0 ? recordDomain : String(shopId);
      findings.push(finding);
    }
    const limited = findings.slice(0, params.maxPerStore);
    if (truncated) {
      for (const finding of limited) finding.truncated = true;
    }
    return { findings: limited, truncated };
  },
};
