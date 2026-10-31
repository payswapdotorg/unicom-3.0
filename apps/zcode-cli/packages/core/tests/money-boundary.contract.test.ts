// ============================================================
// money-boundary.contract.test.ts — the W1b ingestion boundary (core island)
// ============================================================
//
// The 2026-10-31 second operator review's confirmed finding, closed by the
// code under test: the CORE TWIN + the two Etsy connectors still converted
// prices through floats —
//   - find-best-offer/harness.ts and find-best-offer/families.ts projected
//     finding prices via `finding.price.toFixed(2)` (the SAME laundering class
//     the first review reproduced in the services module: 400.005 → "400.00",
//     valid money one step upstream of the strict parser);
//   - store-search/etsy.ts (buyer) rounded via Math.round((amount/divisor)*100)/100;
//   - store-search/merchant/etsy-merchant.ts rounded grandtotals via
//     Math.round(value*100).
//
// THE BOUNDARY LAW (the twin of finding-money.ts, INV-14): source decimal
// precision is preserved at INGESTION — a JS number projects via its SHORTEST
// ROUND-TRIP decimal text, accepted only at ≤ 2 fraction digits (padding to
// two is the same exact value); an Etsy Money {amount, divisor} is the exact
// rational, accepted only when BigInt(amount)*100 divides exactly. Sub-cent
// precision is UNKNOWN (null), NEVER rounded into valid money.
//
// Fixture tier throughout: the fetch doubles serve fixture payloads; no live
// network anywhere (issue #23 law).

import { afterEach, describe, expect, it, vi } from "vitest";
import * as twinHarness from "../src/tool/handlers/find-best-offer/harness.js";
import { etsyConnector } from "../src/tool/handlers/store-search/etsy.js";
import { etsyMerchantConnector } from "../src/tool/handlers/store-search/merchant/etsy-merchant.js";
import type { MerchantReadParams } from "../src/tool/handlers/store-search/merchant/types.js";
import type { StoreSearchParams } from "../src/tool/handlers/store-search/types.js";

// ——— the labelled fetch double (route match by longest path; calls recorded) ———

interface FetchCall {
  url: string;
}

function installFetchDouble(routes: Record<string, unknown>): FetchCall[] {
  const calls: FetchCall[] = [];
  const double = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push({ url: href });
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

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// 1. The exact number→money projection (the twin of finding-money.ts)
// ============================================================

describe("money-boundary — numberToExactMoneyText (the W1b projection law)", () => {
  it("projects exact 2-dp values verbatim; whole and 1-dp values PAD (the same exact value, never rounding)", () => {
    expect(twinHarness.numberToExactMoneyText(45.99)).toBe("45.99");
    expect(twinHarness.numberToExactMoneyText(390)).toBe("390.00");
    expect(twinHarness.numberToExactMoneyText(0.1)).toBe("0.10");
    expect(twinHarness.numberToExactMoneyText(12.5)).toBe("12.50");
    expect(twinHarness.numberToExactMoneyText(0)).toBe("0.00");
  });

  it("REFUSES sub-cent precision — the review's laundering table, now UNKNOWN (INV-14: never rounded)", () => {
    expect(twinHarness.numberToExactMoneyText(400.005)).toBeNull(); // was "400.00" via toFixed(2)
    expect(twinHarness.numberToExactMoneyText(400.045)).toBeNull(); // was "400.05"/"400.04" via rounding
    expect(twinHarness.numberToExactMoneyText(0.1 + 0.2)).toBeNull(); // 0.30000000000000004 — float noise is not money
    expect(twinHarness.numberToExactMoneyText(1e-7)).toBeNull(); // exponent form
    expect(twinHarness.numberToExactMoneyText(-5)).toBeNull(); // negative
    expect(twinHarness.numberToExactMoneyText(Number.NaN)).toBeNull();
    expect(twinHarness.numberToExactMoneyText(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("the refusal reason names the sub-cent law honestly (INV-10, embedded in the callers' details)", () => {
    expect(
      twinHarness.findingSubtotalRefusalReason({ price: 400.005, currency: "HKD" }),
    ).toContain("sub-cent precision");
    expect(
      twinHarness.findingSubtotalRefusalReason({ price: 400.005, currency: "HKD" }),
    ).toContain("NOT rounded into money");
    expect(twinHarness.findingSubtotalRefusalReason({ price: null, currency: null })).toBe(
      "the platform stated no price and no currency",
    );
    expect(twinHarness.findingSubtotalRefusalReason({ price: 45.99, currency: null })).toBe(
      "the platform stated a price but no currency",
    );
  });
});

// ============================================================
// 2. The twin shortlist boundary (find-best-offer harness.ts + families.ts)
// ============================================================

const BOUNDARY_INTENT: twinHarness.CommerceIntentEnvelope = {
  query: "boundary fixture",
  maxLandedTotalCost: { amount: "400", currency: "HKD" },
  size: "EU 44",
  consentBasis: "read-only-search",
  provenance: { surface: "w1b boundary fixture", expressedAt: "2026-10-31T00:00:00.000Z" },
  unknowns: ["brand", "condition", "geography", "deadline", "excludedStores"],
};

function boundaryObservation(): twinHarness.CapabilityObservation {
  return {
    stepId: "boundary-exact",
    target: {
      id: "fixture-target",
      platform: "bigcommerce",
      domain: "fixture.invalid",
      label: "Boundary Fixture Store",
      tier: "public",
    },
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-31T00:00:00.000Z",
    findings: [
      {
        platform: "bigcommerce",
        store: "Boundary Fixture Store",
        store_domain: "fixture.invalid",
        title: "Sub-Cent Fixture EU 44",
        price: 400.005,
        currency: "HKD",
        url: "https://fixture.invalid/subcent",
        image_url: null,
        published_at: "2026-10-01T00:00:00.000Z",
      },
      {
        platform: "bigcommerce",
        store: "Boundary Fixture Store",
        store_domain: "fixture.invalid",
        title: "Clean Fixture EU 44",
        price: 45.99,
        currency: "HKD",
        url: "https://fixture.invalid/clean",
        image_url: null,
        published_at: "2026-10-01T00:00:00.000Z",
      },
      {
        platform: "bigcommerce",
        store: "Boundary Fixture Store",
        store_domain: "fixture.invalid",
        title: "Integer Fixture EU 44",
        price: 390,
        currency: "HKD",
        url: "https://fixture.invalid/integer",
        image_url: null,
        published_at: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
}

describe("money-boundary — the twin shortlist (find-best-offer harness.ts)", () => {
  it("a sub-cent price projects to subtotal UNKNOWN — never \"400.00\"/\"400.01\" (the W1b law)", () => {
    const shortlist = twinHarness.buildShortlist(BOUNDARY_INTENT, [boundaryObservation()]);
    const subCent = shortlist.find((offer) => offer.title === "Sub-Cent Fixture EU 44");
    expect(subCent).toBeDefined();
    expect(subCent?.landedTotal.subtotal ?? null).toBeNull();
    expect(subCent?.landedTotal.unknowns).toContain("subtotal"); // the honest INV-10 ledger
    const budget = subCent?.constraints.find((entry) => entry.constraint === "budget");
    expect(budget?.status).toBe("unknown");
    expect(budget?.detail).toContain("sub-cent precision");
    expect(budget?.detail).toContain("NOT rounded into money");
  });

  it("clean values stay byte-identical to the pre-W1b behavior (45.99 → \"45.99\"; 390 → \"390.00\" padding)", () => {
    const shortlist = twinHarness.buildShortlist(BOUNDARY_INTENT, [boundaryObservation()]);
    const clean = shortlist.find((offer) => offer.title === "Clean Fixture EU 44");
    const integer = shortlist.find((offer) => offer.title === "Integer Fixture EU 44");
    expect(clean?.landedTotal.subtotal?.amount).toBe("45.99");
    expect(integer?.landedTotal.subtotal?.amount).toBe("390.00");
    expect(clean?.landedTotal.subtotal?.currency).toBe("HKD");
    expect(integer?.landedTotal.subtotal?.currency).toBe("HKD");
  });
});

// ============================================================
// 3. The buyer connector boundary (store-search/etsy.ts — Etsy Money)
// ============================================================

describe("money-boundary — the Etsy buyer connector (moneyMajorUnits, exact rational)", () => {
  it("a sub-cent Etsy Money (amount=400005, divisor=1000) projects price UNKNOWN — never Math.round-ed", async () => {
    installFetchDouble({
      "/application/shops/12345/listings/active": {
        count: 1,
        results: [
          {
            listing_id: 1,
            title: "Sub-Cent Fixture Widget",
            url: "https://fixture.invalid/subcent",
            price: { amount: 400005, divisor: 1000, currency_code: "USD" },
          },
        ],
      },
    });
    const params: StoreSearchParams = {
      domain: "12345",
      label: "Boundary Fixture Shop",
      query: "widget",
      maxPerStore: 5,
      sort: "relevance",
      credentials: { apiKeyString: "fixture-keystring", userToken: "fixture-user-token" },
    };
    const result = await etsyConnector.search(params);
    expect("findings" in result).toBe(true);
    if ("findings" in result) {
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.title).toBe("Sub-Cent Fixture Widget");
      expect(finding.price).toBeNull(); // 400.005 — UNKNOWN, never "400.01"
      expect(finding.currency).toBeNull();
    }
  });

  it("exact Etsy Money stays exact: 4599/100 → 45.99; 400005/100 → 400.05 (2-dp-exact, 3 significant digits)", async () => {
    installFetchDouble({
      "/application/shops/12345/listings/active": {
        count: 2,
        results: [
          {
            listing_id: 1,
            title: "Clean Fixture Mug",
            url: "https://fixture.invalid/clean",
            price: { amount: 4599, divisor: 100, currency_code: "USD" },
          },
          {
            listing_id: 2,
            title: "Three-Digit Fixture Apron",
            url: "https://fixture.invalid/threedigit",
            price: { amount: 40005, divisor: 100, currency_code: "USD" },
          },
        ],
      },
    });
    const params: StoreSearchParams = {
      domain: "12345",
      label: "Boundary Fixture Shop",
      query: "fixture",
      maxPerStore: 5,
      sort: "relevance",
      credentials: { apiKeyString: "fixture-keystring", userToken: "fixture-user-token" },
    };
    const result = await etsyConnector.search(params);
    expect("findings" in result).toBe(true);
    if ("findings" in result) {
      const mug = result.findings.find((f) => f.title === "Clean Fixture Mug");
      const apron = result.findings.find((f) => f.title === "Three-Digit Fixture Apron");
      expect(mug?.price).toBe(45.99);
      expect(mug?.currency).toBe("USD");
      expect(apron?.price).toBe(400.05); // exact rational — NOT rounded, NOT refused
      expect(apron?.currency).toBe("USD");
    }
  });
});

// ============================================================
// 4. The merchant reader boundary (etsy-merchant.ts — receipt grandtotal)
// ============================================================

describe("money-boundary — the Etsy merchant reader (moneyFromDecimalGrandtotal)", () => {
  it("a sub-cent receipt grandtotal (400.005) is grandTotal UNKNOWN — never Math.round-ed to \"400.01\"", async () => {
    installFetchDouble({
      "/application/shops/12345/receipts": {
        count: 2,
        results: [
          {
            receipt_id: 6001,
            create_date: 1_770_000_000,
            grandtotal: 400.005,
            currency_code: "USD",
          },
          {
            receipt_id: 6002,
            create_date: 1_770_100_000,
            grandtotal: 45.99,
            currency_code: "USD",
          },
        ],
      },
    });
    const params: MerchantReadParams = {
      platform: "etsy",
      domain: "12345",
      label: "Boundary Fixture Shop",
      operation: "recent_orders",
      credentials: { apiKeyString: "fixture-keystring", userToken: "fixture-user-token" },
    };
    const result = await etsyMerchantConnector.read(params);
    expect("orders" in result).toBe(true);
    if ("orders" in result) {
      const subCent = result.orders.find((order) => order.receiptId === 6001);
      const clean = result.orders.find((order) => order.receiptId === 6002);
      expect(subCent?.grandTotal).toBeNull(); // 400.005 — UNKNOWN, never "400.01"
      expect(clean?.grandTotal).toEqual({ amount: "45.99", currency: "USD" });
    }
  });

  it("clean grandtotals stay byte-identical (12.5 → \"12.50\" padding; 45.99 → \"45.99\")", async () => {
    installFetchDouble({
      "/application/shops/12345/receipts": {
        count: 2,
        results: [
          {
            receipt_id: 6001,
            create_date: 1_770_000_000,
            grandtotal: 12.5,
            currency_code: "USD",
          },
          {
            receipt_id: 6002,
            create_date: 1_770_100_000,
            grandtotal: 45.99,
            currency_code: "USD",
          },
        ],
      },
    });
    const params: MerchantReadParams = {
      platform: "etsy",
      domain: "12345",
      label: "Boundary Fixture Shop",
      operation: "recent_orders",
      credentials: { apiKeyString: "fixture-keystring", userToken: "fixture-user-token" },
    };
    const result = await etsyMerchantConnector.read(params);
    expect("orders" in result).toBe(true);
    if ("orders" in result) {
      expect(result.orders[0]?.grandTotal).toEqual({ amount: "12.50", currency: "USD" });
      expect(result.orders[1]?.grandTotal).toEqual({ amount: "45.99", currency: "USD" });
    }
  });
});
