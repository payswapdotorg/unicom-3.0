// ============================================================
// merchant_read — the R6 tool + connector conformance suite
// (HARNESS-CONTRACT.md §1 L3/L4 + §3, the R6 row, the tool face)
// ============================================================
//
// The merchant-side read plane's tool contract, as REAL tests in the
// package's own vitest lane (the find-best-offer suite's twin discipline):
// the labelled-fixture tier — a FAKE isolated ZCODE_DATA_BASE_DIR store
// record + a LABELLED fetch double over FE3-shaped Etsy payloads. No live
// network anywhere (the double is the only transport the connector can
// reach), no browsers, no stubs of shipped code.
//
// Contract under test (HARNESS-CONTRACT.md §1 L3/L4 + §3 R6 + §2):
//   1. The tool's JSON face: {ok, operation, store?, platform?,
//      shopSummary?, inventory?, orders?, truncated?, notice?, per_store?,
//      durationMs} — exact money (string decimals), buyer-less orders,
//      honest truncation, the multi-store shop_summary refusal.
//   2. The zod input contract (.strict(); the documented shape + the
//      forgiving limit clamp into 1..50).
//   3. The honest not_configured law: Etsy no/garbage credentials, Shopify
//      (Admin API token), WooCommerce (ck/cs) — each proven ZERO network
//      through a never-fetch double.
//   4. Planning honesty: web-tier never planned (delegated notice); unknown
//      platform filter is a helpful 400-style tool error; an
//      unknown-platform RECORD answers the honest per-store not_supported;
//      zero stores is ok:true with the connect-one notice pushed ALONGSIDE
//      the committed reader's {"stores": []} "unexpected shape" quirk (the
//      R5-recorded behavior, asserted both-strings, not hidden).
//   5. The fan-out discipline: a store's failure lands in per_store
//      honestly, never failing the call (the mixed fan-out).
//   6. The outcome taxonomy VERBATIM (the frozen eight-code list, through
//      the REAL classifier + the registry's own answers).
//   7. NO formatModelContent on the tool entry (the F4-P5-fix law) + the
//      parseable model face.
//   8. The authority law: the merchant transport issues GET-class requests
//      ONLY — asserted through the connector's own request table + the
//      fetch double's header log (x-api-key + Bearer on EVERY call).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The tool under test + its committed machinery.
import { merchantReadToolEntry } from "../src/tool/handlers/merchant-read.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { stringifyOutputForModel } from "../src/tool/executor/result-content-projection.js";
import {
  classifyFetchThrow,
  classifyPlatformFetch,
  notConfiguredError,
} from "../src/tool/handlers/store-search/errors.js";
import { readMerchantSnapshot } from "../src/tool/handlers/store-search/merchant/index.js";
import {
  readMerchantRequestTable,
  resetMerchantRequestTable,
} from "../src/tool/handlers/store-search/merchant/etsy-merchant.js";

// ——— the labelled fixtures (fixture tier: no live network anywhere) ———

/** The Etsy record with fixture credentials (Tier-2): the connector runs
 * against the labelled fetch double — the fixture-flavoured domain can
 * never be reached by accident, and the double is the only transport. */
const FIXTURE_ETSY_STORE = {
  id: "r6-fixture-etsy",
  platform: "etsy",
  domain: "fixture-etsy-shop",
  label: "R6 Fixture Etsy Shop",
  tier: "credential",
  connectedAt: "2026-10-29T00:00:00.000Z",
  status: "ok",
  credentials: { apiKeyString: "fixture-keystring", userToken: "fixture-user-token" },
} as const;

/** The second Etsy record (the multi-store shop_summary refusal fixture). */
const FIXTURE_ETSY_STORE_TWO = {
  ...FIXTURE_ETSY_STORE,
  id: "r6-fixture-etsy-two",
  domain: "fixture-etsy-shop-two",
  label: "R6 Fixture Etsy Shop Two",
} as const;

/** A Shopify record (Tier-1 public for buyer search; merchant reads need
 * the Admin API) — the honest not_configured, zero network. */
const FIXTURE_SHOPIFY_STORE = {
  id: "r6-fixture-shopify",
  platform: "shopify",
  domain: "fixture-shop.myshopify.com",
  label: "R6 Fixture Shopify Store",
  tier: "public",
  connectedAt: "2026-10-29T00:00:00.000Z",
  status: "ok",
} as const;

/** A WooCommerce record — ck/cs not configured, zero network. */
const FIXTURE_WOO_STORE = {
  id: "r6-fixture-woo",
  platform: "woocommerce",
  domain: "fixture-woo.example",
  label: "R6 Fixture Woo Store",
  tier: "public",
  connectedAt: "2026-10-29T00:00:00.000Z",
  status: "ok",
} as const;

/** A web-tier record (no store API): never planned, delegated notice. */
const FIXTURE_WEB_STORE = {
  id: "r6-fixture-web",
  platform: "whatnot",
  domain: "whatnot.example",
  label: "R6 Fixture Web Store",
  tier: "web",
  connectedAt: "2026-10-29T00:00:00.000Z",
  status: "ok",
} as const;

// ——— the FE3-shaped Etsy payloads (the labelled fetch double's routes) ———

const ETSY_USER_ME = { user_id: 730_001 };
const ETSY_USER_SHOPS = { shop_id: 456_001 };
const ETSY_SHOP = {
  shop_id: 456_001,
  shop_name: "Fixture Handmade Studio",
  listing_active_count: 24,
  listing_draft_count: 3,
  listing_expired_count: 11,
  is_vacation: false,
  currency_code: "USD",
  create_date: 1_600_000_000, // epoch seconds
};

function etsyListing(
  listingId: number,
  title: string,
  amount: number,
  quantity: number,
  sku: string | null,
) {
  return {
    listing_id: listingId,
    title,
    state: "active",
    sku,
    quantity,
    price: { amount, divisor: 100, currency_code: "USD" },
    url: `https://fixture.invalid/listing/${listingId}`,
  };
}

const ETSY_LISTINGS = {
  count: 2,
  results: [
    etsyListing(9001, "Fixture Ceramic Mug", 4599, 12, "MUG-01"),
    etsyListing(9002, "Fixture Linen Apron", 1250, 4, null),
  ],
};

const ETSY_LISTINGS_TRUNCATED = {
  count: 250,
  results: Array.from({ length: 100 }, (_, i) =>
    etsyListing(10_000 + i, `Fixture Bulk Item ${i}`, 999, 5, null),
  ),
};

/** The receipts fixture — BUYER-LESS BY LAW: the payload deliberately carries
 * buyer-ish fields; only receipt_id / create_date / grandtotal / currency_code
 * may ever reach the tool face. */
const ETSY_RECEIPTS = {
  count: 3,
  results: [
    {
      receipt_id: 5001,
      create_date: 1_770_000_000,
      grandtotal: 45.99,
      currency_code: "USD",
      buyer_name: "NEVER READ",
      buyer_email: "never@read.invalid",
    },
    {
      receipt_id: 5002,
      create_date: 1_770_100_000,
      grandtotal: 12.5,
      currency_code: "USD",
      buyer_name: "NEVER READ",
    },
  ],
};

// ——— the labelled fetch double ———

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Install a fetch double serving the FE3-shaped routes by LONGEST path
 * match (the shop route must not shadow the listings/receipts routes).
 * Records every call (url + method + headers) for the authority assertions. */
function installEtsyFetchDouble(routes: Record<string, unknown>): FetchCall[] {
  const calls: FetchCall[] = [];
  const double = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof url === "string" ? url : url.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders !== undefined) {
      const iterable =
        typeof (rawHeaders as Iterable<[string, string]>)[Symbol.iterator] === "function"
          ? (rawHeaders as Iterable<[string, string]>)
          : Object.entries(rawHeaders as Record<string, string>);
      for (const [key, value] of iterable) {
        headers[key] = value;
      }
    }
    calls.push({ url: href, method: init?.method ?? "GET", headers });
    const path = new URL(href).pathname;
    let best: [string, unknown] | null = null;
    for (const entry of Object.entries(routes)) {
      if (path.includes(entry[0]) && (best === null || entry[0].length > best[0].length)) {
        best = entry;
      }
    }
    if (best !== null) {
      return new Response(JSON.stringify(best[1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: `no fixture route for ${path}` }), { status: 404 });
  };
  vi.stubGlobal("fetch", double);
  return calls;
}

/** The never-fetch double: ANY network call fails the test outright (the
 * zero-network proof for the not_configured / not_supported paths). */
function installNeverFetchDouble(): void {
  vi.stubGlobal("fetch", async (url: unknown): Promise<Response> => {
    throw new Error(
      `UNEXPECTED NETWORK CALL: ${String(url)} — this path must answer with ZERO fetches`,
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetMerchantRequestTable();
});

// ——— the isolated per-user state (ZCODE_DATA_BASE_DIR, bound per test) ———

const previousDataDir = process.env.ZCODE_DATA_BASE_DIR;
const tempRoots: string[] = [];

/** An isolated ZCODE_DATA_BASE_DIR carrying the labelled fixture records. */
function fixtureDataDir(stores: readonly unknown[]): string {
  const base = mkdtempSync(join(tmpdir(), "r6-merchant-read-"));
  tempRoots.push(base);
  mkdirSync(join(base, ".zcode"), { recursive: true });
  writeFileSync(
    join(base, ".zcode", "stores.json"),
    JSON.stringify({ stores }, null, 2),
    "utf8",
  );
  process.env.ZCODE_DATA_BASE_DIR = base;
  return base;
}

afterAll(() => {
  if (previousDataDir === undefined) {
    delete process.env.ZCODE_DATA_BASE_DIR;
  } else {
    process.env.ZCODE_DATA_BASE_DIR = previousDataDir;
  }
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The handler context fixture (the R5 precedent: the handler reads
 * abortSignal only; the rest are trace identities). */
function handlerContext(): ToolExecutionContext {
  return {
    toolCallId: "r6-merchant-read",
    traceId: "r6-trace",
    spanId: "r6-span",
    abortSignal: new AbortController().signal,
  } as unknown as ToolExecutionContext;
}

/** The §-contract JSON face (the runtime output contract's own shape). */
type MerchantReadToolOutput = {
  ok: true;
  operation: "shop_summary" | "catalog_inventory" | "recent_orders";
  store?: string;
  platform?: string;
  shopSummary?: Record<string, unknown>;
  inventory?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  truncated?: boolean;
  notice?: string;
  per_store?: Array<Record<string, unknown>>;
  durationMs: number;
};

async function invokeTool(input: Record<string, unknown>): Promise<MerchantReadToolOutput> {
  const output = await merchantReadToolEntry.handler(input, handlerContext());
  return output as MerchantReadToolOutput;
}

/** The full FE3 route set (shop resolution + the three operations). */
function fullEtsyRoutes(): Record<string, unknown> {
  return {
    "/application/users/me": ETSY_USER_ME,
    "/application/users/730001/shops": ETSY_USER_SHOPS,
    "/application/shops/456001": ETSY_SHOP,
    "/application/shops/456001/listings/active": ETSY_LISTINGS,
    "/application/shops/456001/receipts": ETSY_RECEIPTS,
  };
}

// ============================================================
// 1. The §-contract JSON face (the Etsy fixture-credential path)
// ============================================================

describe("merchant_read — the §-contract JSON face (Etsy fixture path, labelled double, no live network)", () => {
  it("shop_summary returns the full face {ok, operation, store, platform, shopSummary, per_store, durationMs}", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.ok).toBe(true);
    expect(output.operation).toBe("shop_summary");
    expect(output.store).toBe("R6 Fixture Etsy Shop");
    expect(output.platform).toBe("etsy");
    expect(output.shopSummary).toEqual({
      shopId: 456_001,
      shopName: "Fixture Handmade Studio",
      listingActiveCount: 24,
      listingDraftCount: 3,
      listingExpiredCount: 11,
      isVacation: false,
      currencyCode: "USD",
      createdAt: new Date(1_600_000_000 * 1000).toISOString(),
    });
    expect(output.per_store).toEqual([
      { platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 1 },
    ]);
    expect(typeof output.durationMs).toBe("number");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    // The FE3 shop-resolution path ran: users/me -> shops -> shop.
    expect(calls.some((call) => call.url.includes("/application/users/me"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/application/users/730001/shops"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/application/shops/456001"))).toBe(true);
  });

  it("a numeric record domain IS the shop_id — the resolution round trip is skipped", async () => {
    fixtureDataDir([{ ...FIXTURE_ETSY_STORE, domain: "456001" }]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.shopSummary?.shopName).toBe("Fixture Handmade Studio");
    expect(calls.some((call) => call.url.includes("/application/users/me"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/application/shops/456001"))).toBe(true);
  });

  it("shop_summary absent platform fields are honest nulls — never fabricated", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble({
      ...fullEtsyRoutes(),
      "/application/shops/456001": { shop_id: 456_001 }, // the platform stated nothing else
    });
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.shopSummary).toEqual({
      shopId: 456_001,
      shopName: null,
      listingActiveCount: null,
      listingDraftCount: null,
      listingExpiredCount: null,
      isVacation: null,
      currencyCode: null,
      createdAt: null,
    });
  });

  it("catalog_inventory returns entries with EXACT money strings (USD 45.99 / USD 12.50 — never float-shaped)", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "catalog_inventory" });

    expect(output.operation).toBe("catalog_inventory");
    expect(output.inventory).toHaveLength(2);
    const mug = output.inventory?.[0];
    expect(mug?.title).toBe("Fixture Ceramic Mug");
    expect(mug?.price).toEqual({ amount: "45.99", currency: "USD" });
    expect(mug?.quantity).toBe(12);
    expect(mug?.sku).toBe("MUG-01");
    expect(mug?.listingId).toBe(9001);
    expect(mug?.state).toBe("active");
    const apron = output.inventory?.[1];
    expect(apron?.price).toEqual({ amount: "12.50", currency: "USD" });
    expect(apron?.sku).toBeNull();
    expect(output.truncated).toBeUndefined(); // count(2) == shown(2) — no cap hit
    expect(output.per_store).toEqual([
      { platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 2 },
    ]);
  });

  it("catalog_inventory reports the honest `truncated` when the shop exceeds the walk/limit caps", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble({
      ...fullEtsyRoutes(),
      "/application/shops/456001/listings/active": ETSY_LISTINGS_TRUNCATED,
    });
    const output = await invokeTool({ operation: "catalog_inventory", limit: 5 });

    expect(output.inventory).toHaveLength(5);
    expect(output.truncated).toBe(true);
    expect(output.per_store?.[0]).toEqual({
      platform: "etsy",
      store: "R6 Fixture Etsy Shop",
      status: "ok",
      count: 5,
      truncated: true,
    });
  });

  it("recent_orders is BUYER-LESS (only date/receipt id/grand total ride the face) and newest-first", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "recent_orders" });

    expect(output.operation).toBe("recent_orders");
    expect(output.orders).toHaveLength(2);
    // Newest first: 5002 (1770100000) before 5001 (1770000000).
    expect(output.orders?.[0]?.receiptId).toBe(5002);
    expect(output.orders?.[1]?.receiptId).toBe(5001);
    // Exact grandtotals: 12.5 -> "12.50"; 45.99 -> "45.99" (the cents path).
    expect(output.orders?.[0]?.grandTotal).toEqual({ amount: "12.50", currency: "USD" });
    expect(output.orders?.[1]?.grandTotal).toEqual({ amount: "45.99", currency: "USD" });
    expect(output.orders?.[0]?.createdAt).toBe(new Date(1_770_100_000 * 1000).toISOString());
    // The buyer-less law, structurally: NO buyer field anywhere in the face.
    const faceText = JSON.stringify(output);
    expect(faceText).not.toContain("buyer");
    expect(faceText).not.toContain("NEVER READ");
    expect(faceText).not.toContain("never@read.invalid");
    // count(3) > shown(2) — the honest truncation note.
    expect(output.truncated).toBe(true);
  });

  it("every transport request carries BOTH x-api-key and Bearer (the committed Etsy auth law)", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    await invokeTool({ operation: "catalog_inventory" });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["x-api-key"], call.url).toBe("fixture-keystring");
      expect(call.headers["Authorization"], call.url).toBe("Bearer fixture-user-token");
    }
  });
});

// ============================================================
// 2. The zod input contract (.strict(); the documented shape + the clamp)
// ============================================================

describe("merchant_read — the input contract (zod .strict() + the forgiving limit clamp)", () => {
  it("accepts the documented shape; the limit clamps into 1..50 (the store-search clamp law)", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "shop_summary" });
    expect(output.ok).toBe(true);

    // The runtime authority (the entry's runtimeInputSchema) — acceptance.
    const runtime = merchantReadToolEntry.runtimeInputSchema;
    expect(runtime.safeParse({ operation: "recent_orders" }).success).toBe(true);
    expect(
      runtime
        .safeParse({ operation: "catalog_inventory", platform: "etsy", store: "x", limit: 25 })
        .success,
    ).toBe(true);
    expect(runtime.safeParse({ operation: "shop_summary", limit: 50 }).success).toBe(true);

    // The clamp: 51 -> 50 rides the receipts request URL (limit=50).
    await invokeTool({ operation: "recent_orders", limit: 51 });
    expect(calls.some((call) => call.url.includes("limit=50"))).toBe(true);
    expect(calls.some((call) => call.url.includes("limit=51"))).toBe(false);
  });

  it("rejects unknown keys and invalid operations (.strict() — never a silent pass)", () => {
    const runtime = merchantReadToolEntry.runtimeInputSchema;
    expect(runtime.safeParse({ operation: "shop_summary", surprise: true }).success).toBe(false);
    expect(runtime.safeParse({ operation: "delete_everything" }).success).toBe(false);
    expect(runtime.safeParse({}).success).toBe(false);
    expect(runtime.safeParse({ operation: 42 }).success).toBe(false);
  });
});

// ============================================================
// 3. The honest not_configured law (zero network, proven)
// ============================================================

describe("merchant_read — the honest not_configured law (never a simulated read)", () => {
  it("Etsy record WITHOUT credentials -> not_configured, ZERO fetches", async () => {
    fixtureDataDir([
      {
        id: "r6-fixture-etsy-nocred",
        platform: "etsy",
        domain: "fixture-etsy-shop",
        label: "R6 Fixture Etsy Shop",
        tier: "credential",
        connectedAt: "2026-10-29T00:00:00.000Z",
        status: "ok",
      },
    ]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.ok).toBe(true);
    expect(output.shopSummary).toBeUndefined();
    expect(output.per_store).toEqual([
      {
        platform: "etsy",
        store: "R6 Fixture Etsy Shop",
        status: "not_configured",
        error: "not_configured",
        message: expect.stringContaining("Etsy credentials are not configured"),
      },
    ]);
  });

  it("Etsy record with GARBAGE credentials -> not_configured, ZERO fetches", async () => {
    fixtureDataDir([
      { ...FIXTURE_ETSY_STORE, credentials: { apiKeyString: "  ", userToken: "" } },
    ]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "recent_orders" });

    expect(output.per_store?.[0]).toMatchObject({
      status: "not_configured",
      error: "not_configured",
    });
    expect(output.orders).toBeUndefined();
  });

  it("Shopify record -> not_configured citing the Admin API access token, ZERO fetches", async () => {
    fixtureDataDir([FIXTURE_SHOPIFY_STORE]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "catalog_inventory" });

    expect(output.inventory).toBeUndefined();
    expect(output.per_store).toEqual([
      {
        platform: "shopify",
        store: "R6 Fixture Shopify Store",
        status: "not_configured",
        error: "not_configured",
        message: expect.stringContaining("Admin API access token"),
      },
    ]);
  });

  it("WooCommerce record -> not_configured citing ck/cs consumer keys, ZERO fetches", async () => {
    fixtureDataDir([FIXTURE_WOO_STORE]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "recent_orders" });

    expect(output.orders).toBeUndefined();
    expect(output.per_store?.[0]).toMatchObject({
      status: "not_configured",
      error: "not_configured",
    });
    const failure = output.per_store?.[0];
    expect(
      typeof failure?.message === "string" && failure.message.includes("consumer key/secret"),
    ).toBe(true);
  });
});

// ============================================================
// 4. Planning honesty (web-tier / unknown platform / zero stores)
// ============================================================

describe("merchant_read — planning honesty (the L3 resolution laws)", () => {
  it("web-tier records are never planned — the delegated notice names WebSearch", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE, FIXTURE_WEB_STORE]);
    installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.notice).toContain("R6 Fixture Web Store");
    expect(output.notice).toContain("WebSearch");
    // The web-tier store never reaches the per-store strip as a read.
    expect(output.per_store?.every((entry) => entry.store !== "R6 Fixture Web Store")).toBe(true);
  });

  it("unknown platform in the filter -> the helpful 400-style tool error naming the known platforms", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installNeverFetchDouble();
    const failure = (await merchantReadToolEntry.handler(
      { operation: "shop_summary", platform: "ebay" },
      handlerContext(),
    )) as { result: false; errorCode: number; message: string };

    expect(failure.result).toBe(false);
    expect(failure.errorCode).toBe(400);
    expect(failure.message).toContain('unknown platform "ebay"');
    expect(failure.message).toContain("shopify, woocommerce");
  });

  it("an unknown-platform RECORD answers the honest per-store not_supported (zero fetch)", async () => {
    fixtureDataDir([
      {
        id: "r6-fixture-unknown",
        platform: "bigcommerce",
        domain: "fixture.invalid",
        label: "R6 Fixture Unknown Platform Store",
        tier: "public",
        status: "ok",
      },
    ]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.shopSummary).toBeUndefined();
    expect(output.per_store).toEqual([
      {
        platform: "bigcommerce",
        store: "R6 Fixture Unknown Platform Store",
        status: "error",
        error: "not_supported",
        message: expect.stringContaining("No merchant_read connector"),
      },
    ]);
  });

  it("zero connected stores -> ok:true with the connect-one notice pushed ALONGSIDE the reader's {\"stores\": []} quirk (both strings)", async () => {
    fixtureDataDir([]);
    installNeverFetchDouble();
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.ok).toBe(true);
    // The committed reader flags the canonical empty shape as "unexpected
    // shape" (the R5-recorded quirk); the R6 handler pushes the connect-one
    // notice ALONGSIDE it (the find-best-offer precedent) — both strings.
    expect(output.notice).toContain("Settings → Connected Stores");
    expect(output.notice).toContain("unexpected shape");
    expect(output.per_store).toBeUndefined();
  });
});

// ============================================================
// 5. The fan-out discipline (a store's failure never fails the call)
// ============================================================

describe("merchant_read — the fan-out discipline (per-store honesty)", () => {
  it("mixed fan-out: the Etsy store reads ok while Shopify lands not_configured — the call stays ok", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE, FIXTURE_SHOPIFY_STORE]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "recent_orders" });

    expect(output.ok).toBe(true);
    expect(output.orders).toHaveLength(2);
    expect(output.per_store).toHaveLength(2);
    const etsy = output.per_store?.find((entry) => entry.platform === "etsy");
    const shopify = output.per_store?.find((entry) => entry.platform === "shopify");
    expect(etsy).toMatchObject({ status: "ok", count: 2 });
    expect(shopify).toMatchObject({ status: "not_configured", error: "not_configured" });
    // Only the Etsy store was fetched — Shopify never touched the transport.
    expect(calls.every((call) => call.url.includes("openapi.etsy.com"))).toBe(true);
  });

  it("multi-store shop_summary REFUSES to merge shop identities — the notice names the `store` narrowing", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE, FIXTURE_ETSY_STORE_TWO]);
    installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "shop_summary" });

    expect(output.ok).toBe(true);
    expect(output.shopSummary).toBeUndefined(); // never a merged/silent drop
    expect(output.per_store).toHaveLength(2);
    expect(output.per_store?.every((entry) => entry.status === "ok")).toBe(true);
    expect(output.notice).toContain("never merged");
    expect(output.notice).toContain("R6 Fixture Etsy Shop Two");
    expect(output.notice).toContain("store");
  });

  it("the `store` narrowing selects one store; a non-matching name answers the honest no-match notice", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    const calls = installEtsyFetchDouble(fullEtsyRoutes());
    const narrowed = await invokeTool({ operation: "shop_summary", store: "R6 Fixture Etsy Shop" });
    expect(narrowed.store).toBe("R6 Fixture Etsy Shop");
    expect(calls.length).toBeGreaterThan(0);

    const mismatch = await invokeTool({ operation: "shop_summary", store: "No Such Store" });
    expect(mismatch.ok).toBe(true);
    expect(mismatch.shopSummary).toBeUndefined();
    expect(mismatch.notice).toContain('No connected store matches "No Such Store"');
    expect(mismatch.notice).toContain("R6 Fixture Etsy Shop");
  });
});

// ============================================================
// 6. The outcome taxonomy VERBATIM (the frozen eight-code list)
// ============================================================

describe("merchant_read — the outcome taxonomy verbatim (the frozen list; drift fails the suite)", () => {
  const FROZEN_OUTCOME_TAXONOMY = [
    "timeout",
    "unreachable",
    "invalid_credentials",
    "insufficient_scope",
    "rate_limited",
    "platform_error",
    "not_configured",
    "not_supported",
  ];

  it("the real classifier + the registry's honest answers use ONLY frozen taxonomy codes", async () => {
    const headers = (retryAfter?: string) =>
      retryAfter === undefined ? new Headers() : new Headers({ "retry-after": retryAfter });

    const cases: ReadonlyArray<[number, Headers, string, string]> = [
      [401, headers(), "unauthorized", "invalid_credentials"],
      [403, headers(), "insufficient scope for shops", "insufficient_scope"],
      [403, headers(), "forbidden", "invalid_credentials"],
      [429, headers("7"), "slow down", "rate_limited"],
      [500, headers(), "boom", "platform_error"],
    ];
    for (const [status, hdrs, body, expected] of cases) {
      const error = classifyPlatformFetch("fixture", status, hdrs, body);
      expect(FROZEN_OUTCOME_TAXONOMY).toContain(error.code);
      expect(error.code).toBe(expected);
      expect(error.message.length).toBeGreaterThan(0);
    }
    // 429 surfaces the platform's own Retry-After.
    expect(classifyPlatformFetch("fixture", 429, headers("7"), "slow down").retryAfterSeconds).toBe(
      7,
    );

    // The throw classifiers: 10s abort -> timeout; anything else -> unreachable.
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(classifyFetchThrow("fixture", abortError).code);
    expect(classifyFetchThrow("fixture", abortError).code).toBe("timeout");
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(classifyFetchThrow("fixture", new Error("dns gone")).code);

    // The honest not_configured (the committed helper) is frozen.
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(notConfiguredError("fixture").code);

    // The registry's not_supported (unknown platform) is frozen too.
    const unsupported = await readMerchantSnapshot({
      platform: "fixture-unknown-platform",
      domain: "fixture.invalid",
      label: "Fixture Store",
      operation: "shop_summary",
    });
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(
      "code" in unsupported ? unsupported.code : "not_supported",
    );
  });
});

// ============================================================
// 7. The F4-P5-fix law (NO formatModelContent; the parseable model face)
// ============================================================

describe("merchant_read — the F4-P5-fix law (the JSON face feeds model + transcript)", () => {
  it("the ToolEntry does NOT define formatModelContent (the starvation class is structurally impossible)", () => {
    expect(merchantReadToolEntry.formatModelContent).toBeUndefined();
  });

  it("the model face is the PARSEABLE §-contract JSON (inventory + per_store ride along)", async () => {
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble(fullEtsyRoutes());
    const output = await invokeTool({ operation: "catalog_inventory" });
    const modelFace = stringifyOutputForModel(output, merchantReadToolEntry);
    expect(typeof modelFace).toBe("string");
    const parsed = JSON.parse(modelFace) as MerchantReadToolOutput;
    expect(parsed.operation).toBe("catalog_inventory");
    expect(Array.isArray(parsed.inventory)).toBe(true);
    expect(parsed.inventory?.[0]?.price).toEqual({ amount: "45.99", currency: "USD" });
    expect(Array.isArray(parsed.per_store)).toBe(true);
  });
});

// ============================================================
// 8. The authority law (GET-class only — the request table)
// ============================================================

describe("merchant_read — the authority law (the L4 governed-execution trace)", () => {
  it("the merchant request table carries GET-class requests ONLY (no POST/PUT/PATCH/DELETE is structurally possible)", async () => {
    resetMerchantRequestTable();
    fixtureDataDir([FIXTURE_ETSY_STORE]);
    installEtsyFetchDouble(fullEtsyRoutes());
    await invokeTool({ operation: "recent_orders" });

    const table = readMerchantRequestTable();
    expect(table.length).toBeGreaterThan(0);
    for (const record of table) {
      expect(record.method).toBe("GET");
      expect(record.url).toContain("openapi.etsy.com");
    }
    // The trace covers the full governed walk: resolution + the operation read.
    expect(table.some((record) => record.url.includes("/application/users/me"))).toBe(true);
    expect(table.some((record) => record.url.includes("/receipts"))).toBe(true);
  });
});
