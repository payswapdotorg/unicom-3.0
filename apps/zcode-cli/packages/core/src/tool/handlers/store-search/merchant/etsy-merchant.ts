// ============================================================
// Merchant reads - the Etsy OpenAPI v3 merchant connector (Tier-2)
// ============================================================
//
// The REAL merchant-side reader for the one platform with a committed
// credential path (the Etsy keystring + user token pair the Connected Stores
// tier already carries). Endpoint families follow the committed etsy.ts law
// (FE3-verified facts) and the Etsy OpenAPI 3.0.0 spec shape:
//
//   - AUTH (the committed law): every request carries BOTH
//     `x-api-key: {keyString}` AND `Authorization: Bearer {userToken}`.
//     No/garbage credentials -> the honest `not_configured` — never a
//     simulated catalog.
//   - SHOP RESOLUTION (the committed FE3 path): GET /application/users/me
//     -> user_id, then GET /application/users/{user_id}/shops -> shop_id.
//     A record whose domain is already the numeric shop_id skips the trip.
//   - SHOP SUMMARY (getShop family): GET /application/shops/{shop_id} —
//     shop_id / shop_name / listing_active_count / listing_draft_count /
//     listing_expired_count / is_vacation / currency_code / create_date,
//     each defensively read with null-unknown defaults.
//   - CATALOG/INVENTORY (the committed walk): GET
//     /application/shops/{shop_id}/listings/active — 3 pages x 100, honest
//     `truncated` beyond (the committed PAGE_CAP law).
//   - RECENT ORDERS (findAllShopReceipts family): GET
//     /application/shops/{shop_id}/receipts — receipts ARE the orders.
//     BUYER-LESS BY LAW: only receipt_id / create_date / grandtotal /
//     currency_code are read — never a buyer name, address, or any personal
//     field the merchant read plane does not need.
//   - MONEY (the exact-money law): Money = { amount, divisor,
//     currency_code } renders through the cents-based integer path as an
//     exact 2-dp decimal string; receipt grandtotals are decimal numbers
//     rendered through the same cents path — never float-shaped.
//   - TIMESTAMPS: create_date is epoch SECONDS (>= 1e12 taken as ms,
//     defensively — the committed epochSecondsToIso law).
//
// Every fetch carries the hard 10s abort (fetchWithTimeout, imported). All
// failures classify through the committed taxonomy (classifyFetchThrow /
// classifyPlatformFetch, imported). The connector NEVER throws.
//
// THE REQUEST TABLE (the L4 governed-execution trace + the authority
// proof): every transport request the module issues is recorded as
// { method: "GET", url } — the transport issues GET-class requests ONLY,
// structurally: the single fetch helper has no code path that can produce
// another method, and a non-GET entry in the table is a harness defect
// (the unauthorized-action rate must be ZERO, not small).

import {
  classifyFetchThrow,
  classifyPlatformFetch,
  fetchWithTimeout,
  notConfiguredError,
  type StoreSearchError,
} from "../errors.js";
import { isEtsyCredentials, type EtsyCredentials } from "../types.js";
import type {
  MerchantInventoryEntry,
  MerchantMoney,
  MerchantOrderEntry,
  MerchantReadParams,
  MerchantReadResult,
  MerchantRequestRecord,
  MerchantShopSummary,
} from "./types.js";

const PLATFORM = "Etsy";
const BASE = "https://openapi.etsy.com/v3";
const LISTINGS_PER_PAGE = 100;
/** Listing walk cap: 3 pages x 100 listings = 300 — honest `truncated` beyond. */
const PAGE_CAP = 3;
/** The receipts endpoint's own page size ceiling (spec: limit 1..100). */
const RECEIPTS_PAGE_MAX = 100;

// ——— the L4 request table (GET-class only, structurally) ———

const REQUEST_TABLE: MerchantRequestRecord[] = [];

/** The governed-execution trace: every transport request this module issued
 * since the last reset — method + full URL, in issue order. */
export function readMerchantRequestTable(): readonly MerchantRequestRecord[] {
  return REQUEST_TABLE;
}

/** Reset the trace (the test tier's isolation hook; production never calls). */
export function resetMerchantRequestTable(): void {
  REQUEST_TABLE.length = 0;
}

// ——— transport ———

type EtsyResponse =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; error: StoreSearchError };

/**
 * The single transport door: records the request into the L4 table (GET-class
 * only — there is no other method this helper can issue) and fetches with the
 * committed 10s abort + auth pair. Mirrors the committed etsyFetch, plus the
 * trace record.
 */
async function etsyMerchantFetch(
  path: string,
  credentials: EtsyCredentials,
): Promise<EtsyResponse> {
  // The authority proof rides here: the literal "GET" is the only method the
  // merchant transport can ever issue (no body, no mutation verbs).
  REQUEST_TABLE.push({ method: "GET", url: `${BASE}${path}` });
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

// ——— field helpers (the committed FE3-verified semantics) ———

/** Etsy list endpoints wrap results as { count, results }. */
function listPayload(json: Record<string, unknown>): { count: number | null; results: unknown[] } {
  const count = typeof json.count === "number" && Number.isFinite(json.count) ? json.count : null;
  const results = Array.isArray(json.results) ? json.results : [];
  return { count, results };
}

/** Format integer cents as an exact 2-dp decimal string ("4599" -> "45.99"). */
function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = abs / 100n;
  const remainder = abs % 100n;
  return `${negative ? "-" : ""}${units}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * Etsy Money = { amount, divisor, currency_code } -> exact money. The
 * cents-based integer path: (amount * 100) / divisor must be integral for a
 * 2-dp exact rendering; anything else is an honest null-unknown — never a
 * rounded float.
 */
function moneyFromEtsyMoney(v: unknown): MerchantMoney | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  const currency =
    typeof m.currency_code === "string" && m.currency_code.trim().length > 0
      ? m.currency_code.trim()
      : null;
  if (currency === null) return null;
  const amount = m.amount;
  const divisor = m.divisor;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    typeof divisor !== "number" ||
    !Number.isFinite(divisor) ||
    !Number.isInteger(divisor) ||
    divisor <= 0
  ) {
    return null;
  }
  const scaled = BigInt(amount) * 100n;
  const d = BigInt(divisor);
  if (scaled % d !== 0n) return null; // not exactly representable at 2dp — null-unknown
  return { amount: centsToDecimalString(scaled / d), currency };
}

/**
 * Receipt grandtotal (a decimal number in the receipt's currency) -> exact
 * money through the same cents path: Math.round(value * 100) is an integer
 * number, and BigInt() of an integer is exact — the float only ever appears
 * in the intermediate, never in the rendered string.
 */
function moneyFromDecimalGrandtotal(value: unknown, currencyCode: unknown): MerchantMoney | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const currency =
    typeof currencyCode === "string" && currencyCode.trim().length > 0
      ? currencyCode.trim()
      : null;
  if (currency === null) return null;
  const cents = Math.round(value * 100);
  return { amount: centsToDecimalString(BigInt(cents)), currency };
}

/** Epoch seconds -> ISO string; ms-looking values (>= 1e12) taken as-is
 * (the committed defensive law). */
function epochSecondsToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const ms = v >= 1e12 ? v : v * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Defensive number read: finite numbers pass, everything else is null. */
function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Defensive string read: trimmed non-empty strings pass, else null. */
function readString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ——— shop resolution (the committed FE3 path, mirrored) ———

/**
 * Resolve the numeric Etsy shop_id from the record's domain: a numeric
 * domain IS the shop_id (shortcut); otherwise users/me -> user_id ->
 * users/{user_id}/shops -> shop_id. Mirrors the committed etsy.ts
 * resolveShopId (module-private there, so the merchant twin carries its own
 * copy — same path, same law, disclosed here).
 */
async function resolveShopId(
  domain: string,
  credentials: EtsyCredentials,
): Promise<number | StoreSearchError> {
  const numeric = /^\d+$/u.test(domain.trim()) ? Number.parseInt(domain.trim(), 10) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const me = await etsyMerchantFetch("/application/users/me", credentials);
  if (!me.ok) return me.error;
  const userId = me.json.user_id;
  if (typeof userId !== "number" || !Number.isFinite(userId)) {
    return {
      code: "platform_error",
      message: `${PLATFORM}'s users/me answered 200 without a user_id — the connector cannot resolve the shop honestly.`,
    };
  }
  const shops = await etsyMerchantFetch(`/application/users/${userId}/shops`, credentials);
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

// ——— the operation readers ———

/** shop_summary: the getShop-family read, every field defensively read. */
async function readShopSummary(
  shopId: number,
  credentials: EtsyCredentials,
): Promise<MerchantReadResult> {
  const shop = await etsyMerchantFetch(`/application/shops/${shopId}`, credentials);
  if (!shop.ok) return shop.error;
  const json = shop.json;
  const summary: MerchantShopSummary = {
    shopId: readNumber(json.shop_id),
    shopName: readString(json.shop_name),
    listingActiveCount: readNumber(json.listing_active_count),
    listingDraftCount: readNumber(json.listing_draft_count),
    listingExpiredCount: readNumber(json.listing_expired_count),
    isVacation: typeof json.is_vacation === "boolean" ? json.is_vacation : null,
    currencyCode: readString(json.currency_code),
    createdAt: epochSecondsToIso(json.create_date),
  };
  return { shopSummary: summary, inventory: [], orders: [], truncated: false };
}

/** catalog_inventory: the committed active-listings walk (3 pages x 100),
 * sliced to the requested limit with the honest `truncated` note. */
async function readCatalogInventory(
  shopId: number,
  params: MerchantReadParams,
  credentials: EtsyCredentials,
): Promise<MerchantReadResult> {
  const limit = clampLimit(params.limit);
  const collected: Record<string, unknown>[] = [];
  let total: number | null = null;
  let walkCapped = false;

  for (
    let offset = 0;
    offset < PAGE_CAP * LISTINGS_PER_PAGE;
    offset += LISTINGS_PER_PAGE
  ) {
    const search = new URLSearchParams({
      limit: String(LISTINGS_PER_PAGE),
      offset: String(offset),
    });
    const page = await etsyMerchantFetch(
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

  const inventory: MerchantInventoryEntry[] = [];
  for (const row of collected.slice(0, limit)) {
    const title = readString(row.title);
    if (title === null) continue; // a listing without a title cannot be pointed at
    inventory.push({
      store: params.label,
      listingId: readNumber(row.listing_id),
      title,
      state: readString(row.state),
      sku: readString(row.sku),
      quantity: readNumber(row.quantity),
      price: moneyFromEtsyMoney(row.price),
      url: readString(row.url),
    });
  }
  const shown = inventory.length;
  const truncated =
    walkCapped || (total !== null && total > shown) || collected.length > shown;
  return { inventory, orders: [], truncated };
}

/** recent_orders: the findAllShopReceipts-family read. BUYER-LESS BY LAW —
 * receipt_id / create_date / grandtotal / currency_code are the ONLY fields
 * read, never a buyer name or address. */
async function readRecentOrders(
  shopId: number,
  params: MerchantReadParams,
  credentials: EtsyCredentials,
): Promise<MerchantReadResult> {
  const limit = clampLimit(params.limit);
  const requestLimit = Math.min(Math.max(limit, 1), RECEIPTS_PAGE_MAX);
  const search = new URLSearchParams({ limit: String(requestLimit) });
  const receipts = await etsyMerchantFetch(
    `/application/shops/${shopId}/receipts?${search.toString()}`,
    credentials,
  );
  if (!receipts.ok) return receipts.error;

  const { count, results } = listPayload(receipts.json);
  const orders: MerchantOrderEntry[] = [];
  for (const row of results) {
    if (typeof row !== "object" || row === null) continue;
    const receipt = row as Record<string, unknown>;
    orders.push({
      store: params.label,
      receiptId: readNumber(receipt.receipt_id),
      createdAt: epochSecondsToIso(receipt.create_date),
      grandTotal: moneyFromDecimalGrandtotal(receipt.grandtotal, receipt.currency_code),
    });
  }
  const shown = orders.slice(0, limit);
  const truncated = (count !== null && count > shown.length) || orders.length > shown.length;
  return { inventory: [], orders: shown, truncated };
}

/** Clamp the entry limit into 1..50 (the tool's hard cap; defensive here). */
function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.round(value)));
}

// ——— the connector ———

/** The merchant-side connector contract (the StoreConnector twin). */
export interface MerchantConnector {
  read(params: MerchantReadParams): Promise<MerchantReadResult>;
}

export const etsyMerchantConnector: MerchantConnector = {
  async read(params: MerchantReadParams): Promise<MerchantReadResult> {
    const credentials = params.credentials;
    if (!isEtsyCredentials(credentials)) {
      // Tier-2 without credentials: honest, never a simulated catalog.
      return notConfiguredError(PLATFORM);
    }
    const shopId = await resolveShopId(params.domain, credentials);
    if (typeof shopId !== "number") return shopId;

    switch (params.operation) {
      case "shop_summary":
        return readShopSummary(shopId, credentials);
      case "catalog_inventory":
        return readCatalogInventory(shopId, params, credentials);
      case "recent_orders":
        return readRecentOrders(shopId, params, credentials);
    }
  },
};
