// ============================================================
// MerchantReadToolCallBlock — the R6 renderer + routing conformance suite
// (HARNESS-CONTRACT.md §1 L5 + §3, the renderer face)
// ============================================================
//
// The merchant read plane's renderer contract, as REAL tests in the ui
// package's own vitest lane (the commerce-harness-renderer suite's twin
// discipline): the SAME source modules resolve through the package's `@/`
// alias — no bundle, no stubs, the real dispatch path.
//
// Contract under test:
//   1. Routing: merchant_read + aliases (read_store / store_insights) +
//      the StoreSearch-style wire variants + raw tool_name/name + title all
//      resolve to MerchantReadToolCallBlock; near-misses fall back;
//      store_search / find_best_offer keep their OWN cards; WebSearch /
//      Read / ListModels are unaffected (zero regression on the routing
//      table).
//   2. Data-face honesty: the renderer's parse ACCEPTS the §-contract JSON
//      (a labelled fixture, incl. the JSON-string transcript face and the
//      legacy raw probes) and REJECTS a markdown-text face (the F4-P5-fix
//      starvation class can never silently return); money renders EXACT
//      (the payload's decimal strings verbatim — never float-shaped); the
//      orders face is BUYER-LESS; the shop-summary absent fields are never
//      fabricated; the four-state face holds (compact failure / running /
//      fallback / full card).
//   3. i18n key completeness: every key the renderer references exists in
//      BOTH en-US and zh-CN (the frozen 24-key set — the 13-vs-15 lesson,
//      now enforceable), and both locales carry the identical key set.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import type { TaskChatToolCallTreeNode } from "@/lib/toolCallTree.js";
import { ToolCallBlock } from "@/ToolCallBlocks.js";
import { resolveToolCallRenderer } from "@/ToolCallBlocks/resolveRenderer.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
import {
  MerchantReadToolCallBlock,
  readMerchantReadResult,
} from "@/ToolCallBlocks/renderers/merchant-read.js";
import { StoreSearchToolCallBlock } from "@/ToolCallBlocks/renderers/store-search.js";
import { CommerceHarnessToolCallBlock } from "@/ToolCallBlocks/renderers/commerce-harness.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ReadToolCallBlock } from "@/ToolCallBlocks/renderers/read.js";
import { SearchToolCallBlock } from "@/ToolCallBlocks/renderers/search.js";
import { ListModelsToolCallBlock } from "@/ToolCallBlocks/renderers/list-models.js";

type ToolCall = TaskChatToolCallTreeNode["toolCall"];

// ——— the §-contract JSON fixtures (labelled; the tool's output face) ———

const FIXTURE_INVENTORY_OUTPUT = {
  ok: true,
  operation: "catalog_inventory",
  store: "R6 Fixture Etsy Shop",
  platform: "etsy",
  inventory: [
    {
      store: "R6 Fixture Etsy Shop",
      listingId: 9001,
      title: "Fixture Ceramic Mug",
      state: "active",
      sku: "MUG-01",
      quantity: 12,
      price: { amount: "45.99", currency: "USD" },
      url: "https://fixture.invalid/mug",
    },
    {
      store: "R6 Fixture Etsy Shop",
      listingId: 9002,
      title: "Fixture Linen Apron",
      state: "active",
      sku: null,
      quantity: 4,
      price: { amount: "12.50", currency: "USD" },
      url: null,
    },
  ],
  per_store: [
    { platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 2 },
    {
      platform: "shopify",
      store: "R6 Fixture Shopify Store",
      status: "not_configured",
      error: "not_configured",
      message:
        "Shopify merchant reads need an Admin API access token — nothing was read.",
    },
  ],
  durationMs: 812,
};

const FIXTURE_SHOP_SUMMARY_OUTPUT = {
  ok: true,
  operation: "shop_summary",
  store: "R6 Fixture Etsy Shop",
  platform: "etsy",
  shopSummary: {
    shopId: 456_001,
    shopName: "Fixture Handmade Studio",
    listingActiveCount: 24,
    listingDraftCount: 3,
    listingExpiredCount: 11,
    isVacation: true,
    currencyCode: "USD",
    createdAt: "2020-09-13T12:26:40.000Z",
  },
  per_store: [{ platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 1 }],
  durationMs: 402,
};

/** The orders fixture — buyer-ish fields ride the payload deliberately: the
 * data face must never surface them (the buyer-less law). */
const FIXTURE_ORDERS_OUTPUT = {
  ok: true,
  operation: "recent_orders",
  store: "R6 Fixture Etsy Shop",
  platform: "etsy",
  orders: [
    {
      store: "R6 Fixture Etsy Shop",
      receiptId: 5002,
      createdAt: "2026-02-11T02:46:40.000Z",
      grandTotal: { amount: "12.50", currency: "USD" },
      buyer_name: "NEVER READ",
    },
    {
      store: "R6 Fixture Etsy Shop",
      receiptId: 5001,
      createdAt: "2026-01-31T18:26:40.000Z",
      grandTotal: { amount: "45.99", currency: "USD" },
      buyer_email: "never@read.invalid",
    },
  ],
  truncated: true,
  per_store: [
    { platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 2, truncated: true },
    {
      platform: "shopify",
      store: "R6 Fixture Shopify Store",
      status: "not_configured",
      error: "not_configured",
      message: "Shopify merchant reads need an Admin API access token — nothing was read.",
    },
  ],
  durationMs: 611,
};

// ——— the render helpers (the executeGroup card-test pattern) ———

/** The full render context the renderers read (the R5 sibling pattern:
 * render the RENDERER directly with forceOpen for body assertions). */
function renderContext(overrides: Partial<ToolCall>, forceOpen: boolean) {
  return {
    nestedToolRenderer: () => null,
    toolCallNode: {
      toolCall: {
        toolId: "r6-fixture-tool-call",
        toolName: "merchant_read",
        kind: "merchant_read",
        input: { operation: "catalog_inventory" },
        output: FIXTURE_INVENTORY_OUTPUT,
        raw: {},
        status: "completed",
        ...overrides,
      } as ToolCall,
      childToolCalls: [],
    },
    workspacePath: "/workspace",
    displayModel: {
      inlinePreview: { type: "none" },
      planResult: null,
      viewerSource: null,
      viewerLabelId: "codeViewer.viewCode",
      showSummaryFileLink: true,
      showInput: false,
      showOutput: true,
      showKind: false,
    },
    viewerSource: null,
    rawFileSummaries: [],
    isRunning: false,
    statusLabel: "Completed",
    childToolList: null,
    forceOpen,
    canToggle: true,
    showIcon: true,
    // The integrated-browser callback (the store-search precedent: linked
    // titles render as buttons that hand the URL to the host).
    onOpenBrowserUrl: (url: string) => url,
  } as unknown as ToolCallBlockRenderContext;
}

/** The renderer's expanded card (the content body — summary, inventory,
 * orders, strip, notices). */
function renderMerchantRead(
  overrides: Partial<ToolCall> = {},
  locale: "en-US" | "zh-CN" = "en-US",
  forceOpen = true,
): string {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(MerchantReadToolCallBlock, renderContext(overrides, forceOpen)),
    ),
  );
}

/** The collapsed chat-line card through the full ToolCallBlock wrapper (the
 * real dispatch + summary row). */
function renderToolCallBlockLine(
  overrides: Partial<ToolCall> = {},
  locale: "en-US" | "zh-CN" = "en-US",
): string {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(ToolCallBlock, {
        toolCallNode: {
          toolCall: {
            toolId: "r6-fixture-tool-call",
            toolName: "merchant_read",
            kind: "merchant_read",
            input: { operation: "catalog_inventory" },
            output: FIXTURE_INVENTORY_OUTPUT,
            raw: {},
            status: "completed",
            ...overrides,
          },
          childToolCalls: [],
        },
        workspacePath: "/workspace",
      }),
    ),
  );
}

// ============================================================
// 1. Routing (through the real resolveRenderer modules)
// ============================================================

describe("MerchantReadToolCallBlock routing (resolveRenderer by-name registration)", () => {
  const base = (overrides: Partial<ToolCall>): ToolCall =>
    ({
      toolId: "r6-routing",
      kind: "",
      input: {},
      status: "completed",
      raw: {},
      ...overrides,
    }) as ToolCall;

  /** The resolver reads only toolCallNode.toolCall (the R5 precedent) — the
   * minimal context is the documented contract surface. */
  function resolveFor(toolCall: ToolCall) {
    const context = {
      toolCallNode: { toolCall, childToolCalls: [] },
    } as unknown as ToolCallBlockRenderContext;
    return resolveToolCallRenderer(context);
  }

  it("routes merchant_read by toolName, kind and title to the merchant-read card", () => {
    expect(resolveFor(base({ toolName: "merchant_read" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ kind: "merchant_read" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ title: "merchant_read" }))).toBe(MerchantReadToolCallBlock);
  });

  it("routes the aliases read_store / store_insights and the wire variants (MerchantRead / ReadStore / StoreInsights)", () => {
    expect(resolveFor(base({ toolName: "read_store" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ toolName: "store_insights" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ toolName: "MerchantRead" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ toolName: "ReadStore" }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ toolName: "StoreInsights" }))).toBe(MerchantReadToolCallBlock);
  });

  it("routes raw tool_name / name wire fields to the merchant-read card", () => {
    expect(resolveFor(base({ raw: { tool_name: "merchant_read" } }))).toBe(MerchantReadToolCallBlock);
    expect(resolveFor(base({ raw: { name: "store_insights" } }))).toBe(MerchantReadToolCallBlock);
  });

  it("does NOT swallow near-misses (merchant_reads / read_stores / store_insight / merchant -> fallback, never the merchant card)", () => {
    for (const toolName of ["merchant_reads", "read_stores", "store_insight", "merchant"]) {
      const resolved = resolveFor(base({ toolName }));
      expect(resolved, toolName).not.toBe(MerchantReadToolCallBlock);
    }
  });

  it("store_search and find_best_offer (with aliases) keep their OWN cards (zero regression)", () => {
    expect(resolveFor(base({ toolName: "store_search" }))).toBe(StoreSearchToolCallBlock);
    expect(resolveFor(base({ toolName: "search_stores" }))).toBe(StoreSearchToolCallBlock);
    expect(resolveFor(base({ toolName: "find_best_offer" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ toolName: "find_best_deal" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ toolName: "shop_intent" }))).toBe(CommerceHarnessToolCallBlock);
  });

  it("unrelated tools keep their own cards (WebSearch / Read / ListModels — zero regression)", () => {
    expect(resolveFor(base({ toolName: "WebSearch" }))).toBe(SearchToolCallBlock);
    expect(resolveFor(base({ toolName: "Read" }))).toBe(ReadToolCallBlock);
    expect(resolveFor(base({ toolName: "ListModels" }))).toBe(ListModelsToolCallBlock);
    expect(resolveFor(base({ toolName: "SomethingUnknown" }))).toBe(FallbackToolCallBlock);
  });
});

// ============================================================
// 2. Data-face honesty (parse + exact money + buyer-less + the four faces)
// ============================================================

describe("MerchantReadToolCallBlock data face (the §-contract JSON, labelled fixture)", () => {
  function toolCallWith(output: unknown, raw: unknown = {}): Parameters<typeof readMerchantReadResult>[0] {
    return {
      toolId: "r6-data-face",
      kind: "merchant_read",
      input: {},
      output,
      raw,
      status: "completed",
    } as Parameters<typeof readMerchantReadResult>[0];
  }

  it("ACCEPTS the §-contract JSON object (a valid `operation` is the acceptance spine)", () => {
    const result = readMerchantReadResult(toolCallWith(FIXTURE_INVENTORY_OUTPUT));
    expect(result).not.toBeNull();
    expect(result?.operation).toBe("catalog_inventory");
    expect(result?.store).toBe("R6 Fixture Etsy Shop");
    expect(result?.inventory).toHaveLength(2);
    expect(result?.inventory?.[0]?.price).toEqual({ amount: "45.99", currency: "USD" });
    expect(result?.perStore).toHaveLength(2);

    const summary = readMerchantReadResult(toolCallWith(FIXTURE_SHOP_SUMMARY_OUTPUT));
    expect(summary?.operation).toBe("shop_summary");
    expect(summary?.shopSummary?.shopName).toBe("Fixture Handmade Studio");
    expect(summary?.inventory).toBeUndefined(); // the channel is absent, not empty

    const orders = readMerchantReadResult(toolCallWith(FIXTURE_ORDERS_OUTPUT));
    expect(orders?.orders).toHaveLength(2);
    expect(orders?.orders?.[0]?.grandTotal).toEqual({ amount: "12.50", currency: "USD" });
  });

  it("ACCEPTS the JSON-string face (the persisted transcript path) and the legacy raw probes", () => {
    expect(readMerchantReadResult(toolCallWith(JSON.stringify(FIXTURE_INVENTORY_OUTPUT)))).not.toBeNull();
    expect(
      readMerchantReadResult(toolCallWith(undefined, { rawOutput: FIXTURE_INVENTORY_OUTPUT })),
    ).not.toBeNull();
    expect(
      readMerchantReadResult(toolCallWith(undefined, { output: JSON.stringify(FIXTURE_SHOP_SUMMARY_OUTPUT) })),
    ).not.toBeNull();
    expect(
      readMerchantReadResult(toolCallWith(undefined, { result: FIXTURE_ORDERS_OUTPUT })),
    ).not.toBeNull();
  });

  it("REJECTS a markdown-text face (the F4-P5-fix starvation class can never silently return)", () => {
    const markdown = [
      "# Store read for R6 Fixture Etsy Shop",
      "",
      "- Fixture Ceramic Mug — USD 45.99",
      "- 2 listings, 2 orders.",
    ].join("\n");
    expect(readMerchantReadResult(toolCallWith(markdown))).toBeNull();
    // A JSON object without a valid `operation` is equally unreadable —
    // "unreadable" must never impersonate "nothing read".
    expect(readMerchantReadResult(toolCallWith({ ok: true, note: "no operation" }))).toBeNull();
    expect(readMerchantReadResult(toolCallWith({ operation: "delete_everything" }))).toBeNull();
    expect(readMerchantReadResult(toolCallWith(undefined))).toBeNull();
  });

  it("money renders EXACT — the payload's decimal strings verbatim (USD 45.99 / USD 12.50), never float-shaped", () => {
    const html = renderMerchantRead();
    expect(html).toContain("USD 45.99");
    expect(html).toContain("USD 12.50");
    // The float shape would render "12.5" (or 12.5-formatted) — forbidden.
    expect(html).not.toContain("USD 12.5<");
    expect(html).not.toContain("USD 45.9<");
    expect(html).not.toContain("45.990");
  });

  it("the orders face is BUYER-LESS (payload buyer fields never reach the card)", () => {
    const html = renderMerchantRead({ output: FIXTURE_ORDERS_OUTPUT });
    expect(html).toContain('data-merchant-read-orders="true"');
    expect(html).toContain("#5002");
    expect(html).toContain("#5001");
    expect(html).toContain("2026-02-11");
    expect(html).toContain("USD 12.50");
    expect(html).toContain("USD 45.99");
    expect(html).not.toContain("NEVER READ");
    expect(html).not.toContain("buyer");
    expect(html).not.toContain("never@read.invalid");
  });

  it("the shop-summary section renders the platform's own fields; ABSENT fields are never fabricated", () => {
    const html = renderMerchantRead({ output: FIXTURE_SHOP_SUMMARY_OUTPUT });
    expect(html).toContain('data-merchant-read-summary="true"');
    expect(html).toContain("Fixture Handmade Studio");
    expect(html).toContain(`24 ${enUS["chat.toolCall.merchantRead.listingActiveCount"]}`);
    expect(html).toContain(`3 ${enUS["chat.toolCall.merchantRead.listingDraftCount"]}`);
    expect(html).toContain(`11 ${enUS["chat.toolCall.merchantRead.listingExpiredCount"]}`);
    expect(html).toContain(enUS["chat.toolCall.merchantRead.vacation"]);
    expect(html).toContain(
      `${enUS["chat.toolCall.merchantRead.shopCurrency"]} USD`,
    );
    expect(html).toContain(
      enUS["chat.toolCall.merchantRead.since"].replace("{date}", "2020-09-13"),
    );

    // Absent fields: a summary that stated nothing renders no fabricated rows.
    const sparse = renderMerchantRead({
      output: {
        ...FIXTURE_SHOP_SUMMARY_OUTPUT,
        shopSummary: { shopId: 456_001, shopName: null, listingActiveCount: null, listingDraftCount: null, listingExpiredCount: null, isVacation: null, currencyCode: null, createdAt: null },
      },
    });
    expect(sparse).toContain('data-merchant-read-summary="true"');
    expect(sparse).not.toContain(
      enUS["chat.toolCall.merchantRead.listingActiveCount"],
    );
    expect(sparse).not.toContain(enUS["chat.toolCall.merchantRead.vacation"]);
    expect(sparse).not.toContain("null");
  });

  it("the collapsed chat-line card carries the kind label, the operation headline, the store and the honest count", () => {
    const html = renderToolCallBlockLine();
    expect(html).toContain(enUS["chat.toolCall.merchantRead.kind"]);
    // Static markup escapes the ampersand: "Catalog & inventory" -> "Catalog &amp; inventory".
    expect(html).toContain("Catalog &amp; inventory");
    expect(html).toContain("R6 Fixture Etsy Shop");
    expect(html).toContain(
      enUS["chat.toolCall.merchantRead.entryCount.other"].replace("{count}", "2"),
    );
    // The summary line does NOT dump the whole JSON payload.
    expect(html).not.toContain('"operation"');
  });

  it("the inventory section renders title/SKU/quantity/state/price; the link rides the browser callback, and degrades to plain text without it", () => {
    const html = renderMerchantRead();
    expect(html).toContain('data-merchant-read-inventory="true"');
    expect(html).toContain('data-merchant-read-entry="true"');
    expect(html).toContain("Fixture Ceramic Mug");
    expect(html).toContain(`MUG-01`);
    expect(html).toContain(
      `${enUS["chat.toolCall.merchantRead.quantity"]} 12`,
    );
    expect(html).toContain("active");
    expect(html).toContain('data-merchant-read="true"');
    // The linked title renders as a <button> (the store-search precedent:
    // the renderer never opens external links itself).
    expect(html).toContain("<button");
    // The URL-less entry renders plain text, never a dead link.
    expect(html).toContain("Fixture Linen Apron");
  });

  it("the per-store strip preserves taxonomy codes verbatim + the not_configured label + the truncated note", () => {
    const html = renderMerchantRead({
      output: {
        ...FIXTURE_ORDERS_OUTPUT,
        per_store: [
          { platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 2, truncated: true },
          {
            platform: "shopify",
            store: "R6 Fixture Shopify Store",
            status: "not_configured",
            error: "not_configured",
            message: "Shopify merchant reads need an Admin API access token — nothing was read.",
          },
          {
            platform: "etsy",
            store: "R6 Fixture Etsy Shop Two",
            status: "error",
            error: "rate_limited",
            message: "Etsy is rate-limiting this connection (429) — Retry-After says 7s.",
          },
        ],
      },
    });
    expect(html).toContain('data-merchant-read-strip="true"');
    // The ERROR-status entry carries its taxonomy code VERBATIM on the chip
    // (never translated, never swallowed).
    expect(html).toContain("rate_limited");
    expect(html).toContain("Retry-After says 7s");
    // The not_configured entry renders its own honest label (the store-search
    // canon: the dedicated face, not the raw chip).
    expect(html).toContain(enUS["chat.toolCall.merchantRead.notConfigured"]);
    expect(html).toContain(
      enUS["chat.toolCall.merchantRead.truncated"].replace("{count}", "2"),
    );
  });

  it("the empty state renders the honest nothing-read message (inventory present but empty)", () => {
    const html = renderMerchantRead({
      output: {
        ok: true,
        operation: "catalog_inventory",
        store: "R6 Fixture Etsy Shop",
        platform: "etsy",
        inventory: [],
        per_store: [{ platform: "etsy", store: "R6 Fixture Etsy Shop", status: "ok", count: 0 }],
        durationMs: 90,
      },
    });
    expect(html).toContain(
      enUS["chat.toolCall.merchantRead.empty.one"].replace("{count}", "1"),
    );
    expect(html).not.toContain('data-merchant-read-entry="true"');
  });

  it("the running face: the reading label + the operation headline, no content body", () => {
    const runningHtml = renderToStaticMarkup(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "en-US" },
        createElement(MerchantReadToolCallBlock, {
          ...renderContext({ output: undefined, input: { operation: "shop_summary" } }, true),
          isRunning: true,
        } as unknown as ToolCallBlockRenderContext),
      ),
    );
    expect(runningHtml).toContain(enUS["chat.toolCall.merchantRead.reading"]);
    expect(runningHtml).toContain(enUS["chat.toolCall.merchantRead.operation.shopSummary"]);
    expect(runningHtml).not.toContain('data-merchant-read="true"');
  });

  it("a failed + unreadable call renders the COMPACT failure face — never the raw error JSON dump", () => {
    const html = renderMerchantRead({ output: "# raw failure dump", status: "failed" });
    expect(html).not.toContain("# raw failure dump");
    expect(html).not.toContain('data-merchant-read="true"');
    expect(html).toContain(enUS["chat.toolCall.merchantRead.kind"]);
  });

  it("a markdown output renders the FALLBACK card (raw payload visible) — never a fake empty merchant card", () => {
    const markdown = "# Store read for R6 Fixture Etsy Shop\n\n- Fixture Ceramic Mug — USD 45.99";
    const html = renderMerchantRead({ output: markdown });
    expect(html).not.toContain('data-merchant-read="true"');
    expect(html).not.toContain('data-merchant-read-inventory="true"');
    // The fallback card shows the raw payload — "unreadable" ≠ "nothing read".
    expect(html).toContain("# Store read for R6 Fixture Etsy Shop");
  });

  it("zh-CN renders the same structural card (both locales carry the discipline)", () => {
    const html = renderMerchantRead({ output: FIXTURE_SHOP_SUMMARY_OUTPUT }, "zh-CN");
    expect(html).toContain('data-merchant-read="true"');
    expect(html).toContain('data-merchant-read-summary="true"');
    expect(html).toContain(zhCN["chat.toolCall.merchantRead.kind"]);
    expect(html).toContain(zhCN["chat.toolCall.merchantRead.operation.shopSummary"]);
    expect(html).toContain(`24 ${zhCN["chat.toolCall.merchantRead.listingActiveCount"]}`);
    expect(html).toContain(zhCN["chat.toolCall.merchantRead.vacation"]);
    // The exact-money path is locale-neutral: the payload string rides verbatim.
    const ordersHtml = renderMerchantRead({ output: FIXTURE_ORDERS_OUTPUT }, "zh-CN");
    expect(ordersHtml).toContain("USD 12.50");
    expect(ordersHtml).toContain("USD 45.99");
  });
});

// ============================================================
// 3. i18n key completeness (the frozen 24-key set, BOTH locales)
// ============================================================

describe("MerchantReadToolCallBlock i18n key completeness (en-US + zh-CN)", () => {
  /** The enumerated key set the renderer references — the contract (24 keys,
   * the R6 delivery's verified count). A key added to the renderer without
   * updating this list (and both locales) fails here — the 13-vs-15 lesson. */
  const FROZEN_MERCHANT_READ_KEYS = [
    "chat.toolCall.merchantRead.kind",
    "chat.toolCall.merchantRead.reading",
    "chat.toolCall.merchantRead.operation.shopSummary",
    "chat.toolCall.merchantRead.operation.catalogInventory",
    "chat.toolCall.merchantRead.operation.recentOrders",
    "chat.toolCall.merchantRead.entryCount.one",
    "chat.toolCall.merchantRead.entryCount.other",
    "chat.toolCall.merchantRead.orderCount.one",
    "chat.toolCall.merchantRead.orderCount.other",
    "chat.toolCall.merchantRead.summaryCount.one",
    "chat.toolCall.merchantRead.summaryCount.other",
    "chat.toolCall.merchantRead.noMatches",
    "chat.toolCall.merchantRead.notConfigured",
    "chat.toolCall.merchantRead.truncated",
    "chat.toolCall.merchantRead.empty.one",
    "chat.toolCall.merchantRead.empty.other",
    "chat.toolCall.merchantRead.listingActiveCount",
    "chat.toolCall.merchantRead.listingDraftCount",
    "chat.toolCall.merchantRead.listingExpiredCount",
    "chat.toolCall.merchantRead.vacation",
    "chat.toolCall.merchantRead.shopCurrency",
    "chat.toolCall.merchantRead.since",
    "chat.toolCall.merchantRead.quantity",
    "chat.toolCall.merchantRead.sku",
  ] as const;

  it("every frozen key exists in BOTH en-US and zh-CN with a non-empty message", () => {
    expect(FROZEN_MERCHANT_READ_KEYS).toHaveLength(24);
    for (const key of FROZEN_MERCHANT_READ_KEYS) {
      expect(
        typeof enUS[key] === "string" && enUS[key]!.length > 0,
        `en-US missing: ${key}`,
      ).toBe(true);
      expect(
        typeof zhCN[key] === "string" && zhCN[key]!.length > 0,
        `zh-CN missing: ${key}`,
      ).toBe(true);
    }
  });

  it("the renderer source references EXACTLY the frozen key set (a referenced-but-unlisted key fails)", () => {
    // The i18n keys are referenced from merchant-read.tsx (the card file —
    // the merchant-read-face.ts split is pure data, no intl surface).
    const source = readFileSync(
      new URL("../src/ToolCallBlocks/renderers/merchant-read.tsx", import.meta.url),
      "utf8",
    );
    const referenced = [
      ...new Set(source.match(/chat\.toolCall\.merchantRead\.[A-Za-z0-9_.]+/gu) ?? []),
    ].sort();
    expect(referenced).toEqual([...FROZEN_MERCHANT_READ_KEYS].sort());
  });

  it("both locales carry the IDENTICAL merchantRead key set (no extra keys on either side)", () => {
    const enKeys = Object.keys(enUS)
      .filter((key) => key.startsWith("chat.toolCall.merchantRead."))
      .sort();
    const zhKeys = Object.keys(zhCN)
      .filter((key) => key.startsWith("chat.toolCall.merchantRead."))
      .sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toEqual([...FROZEN_MERCHANT_READ_KEYS].sort());
  });
});
