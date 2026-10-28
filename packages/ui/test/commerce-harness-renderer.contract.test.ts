// ============================================================
// CommerceHarnessToolCallBlock — the R5 renderer + routing conformance suite
// (HARNESS-CONTRACT.md §1 L5 + §2, the renderer face)
// ============================================================
//
// The R4 vertical slice's renderer contract, as REAL tests in the ui
// package's own vitest lane — the promotion of dispatch/fixture-check-r4.mjs
// (the temporary esbuild-bundled resolver proof) into the repo's enforceable
// suite: in this lane the SAME source modules resolve through the package's
// `@/` alias — no bundle, no stubs, the real dispatch path.
//
// Contract under test:
//   1. Routing: find_best_offer + aliases (find_best_deal / shop_intent) +
//      the StoreSearch-style wire variants + raw tool_name/name + title all
//      resolve to CommerceHarnessToolCallBlock; near-misses fall back;
//      store_search (+ aliases) keeps its OWN card; WebSearch / Read /
//      ListModels are unaffected (zero regression).
//   2. Data-face honesty: the renderer's parse ACCEPTS the §-contract JSON
//      (a labelled fixture, incl. the JSON-string transcript face and the
//      legacy raw probes) and REJECTS a markdown-text face (the F4-P5-fix
//      starvation class can never silently return); the rendered structure
//      separates offers from opportunities — the "not a live offer"
//      discipline is STRUCTURAL (own section, dashed borders), not cosmetic.
//   3. i18n key completeness: every key the renderer references exists in
//      BOTH en-US and zh-CN (the enumerated 38-key set — the 13-vs-15
//      lesson, now enforceable).

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
  CommerceHarnessToolCallBlock,
  readCommerceHarnessResult,
} from "@/ToolCallBlocks/renderers/commerce-harness.js";
import { StoreSearchToolCallBlock } from "@/ToolCallBlocks/renderers/store-search.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ReadToolCallBlock } from "@/ToolCallBlocks/renderers/read.js";
import { SearchToolCallBlock } from "@/ToolCallBlocks/renderers/search.js";
import { ListModelsToolCallBlock } from "@/ToolCallBlocks/renderers/list-models.js";

type ToolCall = TaskChatToolCallTreeNode["toolCall"];

// ——— the §-contract JSON fixture (labelled; the tool's output face) ———

const FIXTURE_OFFER = {
  rank: 1,
  platform: "bigcommerce",
  store: "R5 Fixture Store",
  store_domain: "fixture.invalid",
  title: "Fixture Runner EU 44",
  price: 350,
  currency: "HKD",
  url: "https://fixture.invalid/runner",
  image_url: null,
  published_at: "2026-10-01T00:00:00.000Z",
  landedTotal: {
    subtotal: { amount: "350.00", currency: "HKD" },
    shipping: null,
    tax: null,
    duties: null,
    total: null,
    unknowns: ["shipping", "tax", "duties"],
  },
  constraints: [
    {
      constraint: "budget",
      status: "unknown",
      detail:
        "Observed subtotal HKD 350.00 is within the budget HKD 400.00, but shipping/tax/duties are unobserved — the landed total is UNKNOWN.",
    },
    { constraint: "size", status: "satisfied", detail: 'The finding\'s title carries "EU 44" (title-text evidence).' },
  ],
};

function fixtureOpportunity(family: string, overrides: Record<string, unknown> = {}) {
  return {
    family,
    title: `Fixture ${family}`,
    feasibility: "feasible",
    reason: "fixture reason — search-based, read-only",
    evidenceClass: "conditional",
    observedFacts: "fixture observed facts",
    changedAssumptions: "fixture changed assumption",
    predictedOutcome: "fixture predicted outcome",
    preconditions: ["fixture precondition one", "fixture precondition two"],
    evidence: {
      source: "the broadened store_search observation over the connected public catalog(s)",
      observedAt: "2026-10-28T00:00:00.000Z",
      freshness: "live-observed",
      expiresAt: "2026-10-29T00:00:00.000Z",
    },
    consentRequired: "the principal approves the substitute",
    authorityRequired: "read-only (the search)",
    ...overrides,
  };
}

const FIXTURE_TOOL_OUTPUT = {
  ok: true,
  intent: {
    query: "yeezy shoes",
    maxLandedTotalCost: { amount: "400", currency: "HKD" },
    size: "EU 44",
    consentBasis: "read-only-search",
    provenance: { surface: "find_best_offer tool call", expressedAt: "2026-10-28T00:00:00.000Z" },
    unknowns: ["brand", "condition", "geography", "deadline", "excludedStores"],
  },
  plan: {
    createdAt: "2026-10-28T00:00:00.000Z",
    consentBasis: "read-only-search",
    steps: [
      {
        id: "step-1",
        target: { id: "r5-fixture-public", platform: "bigcommerce", domain: "fixture.invalid", label: "R5 Fixture Store", tier: "public" },
        operation: "store_search",
        transport: "api",
        authorityClass: "read-only",
        purpose: "exact",
        query: "yeezy shoes",
        expectedObservation: "fixture expectation",
        expectedCost: { amount: "0.00", currency: "XXX" },
        expectedLatencyMs: 10_000,
      },
    ],
  },
  evaluation: {
    feasibility: [
      {
        stepId: "step-1",
        target: { id: "r5-fixture-public", platform: "bigcommerce", domain: "fixture.invalid", label: "R5 Fixture Store", tier: "public" },
        feasible: true,
        authorityOk: true,
        credentialScopeOk: true,
        geographyCurrencyOk: "unknown",
        freshnessOk: "unknown",
        reasons: ["read-only catalog GETs under the read-only-search consent basis"],
      },
    ],
    constraintSatisfaction: [
      {
        constraint: "budget",
        status: "unknown",
        detail:
          "At least one observed subtotal is within HKD 400.00 on the subtotal, but shipping/tax/duties are unobserved on every offer — the landed-total fit is UNKNOWN.",
      },
      {
        constraint: "size",
        status: "satisfied",
        detail: "At least one shortlisted offer's title carries the size evidence — see the offer's constraint line.",
      },
    ],
    predictedTotals: {
      budget: { amount: "400", currency: "HKD" },
      bestObservedSubtotal: { amount: "350.00", currency: "HKD", offerTitle: "Fixture Runner EU 44" },
      currencyMatch: true,
      landedTotalKnown: false,
      unknowns: ["shipping", "tax", "duties"],
    },
  },
  results: [FIXTURE_OFFER],
  opportunities: [
    fixtureOpportunity("approved_substitutes"),
    fixtureOpportunity("wait_or_buy", {
      feasibility: "feasible",
      evidenceClass: "predicted",
      evidence: {
        source: "prediction over the observed catalog prices (no price-history capability is connected)",
        observedAt: "2026-10-28T00:00:00.000Z",
        freshness: "prediction",
        expiresAt: null,
      },
    }),
    fixtureOpportunity("coupon_promotion_eligibility", {
      feasibility: "not_supported",
      reason:
        "The Tier-1 public catalog capability exposes NO promotions or discount API — the harness refuses to predict, claim, or simulate a coupon.",
      predictedOutcome:
        "None claimed — not supported on the connected capability. A credential-gated promotions/price-rules capability would be required.",
      evidence: {
        source: "capability inspection: the connected Tier-1 public-catalog store records",
        observedAt: "2026-10-28T00:00:00.000Z",
        freshness: "capability-inspection",
        expiresAt: null,
      },
    }),
  ],
  per_store: [
    { platform: "bigcommerce", store: "R5 Fixture Store", count: 3, status: "ok", truncated: true },
    {
      platform: "bigcommerce",
      store: "R5 Fixture Legacy Store",
      status: "error",
      error: "not_supported",
      message: "No store_search connector for platform \"bigcommerce\" — connect a Shopify, WooCommerce or Etsy store instead.",
    },
  ],
  durationMs: 1631,
};

// ——— the render helpers (the executeGroup card-test pattern) ———

/** The full render context the renderers read (the executeGroup sibling
 * pattern: render the RENDERER directly with forceOpen for body assertions). */
function renderContext(overrides: Partial<ToolCall>, forceOpen: boolean) {
  return {
    nestedToolRenderer: () => null,
    toolCallNode: {
      toolCall: {
        toolId: "r5-fixture-tool-call",
        toolName: "find_best_offer",
        kind: "find_best_offer",
        input: { query: "yeezy shoes" },
        output: FIXTURE_TOOL_OUTPUT,
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
  } as unknown as ToolCallBlockRenderContext;
}

/** The renderer's expanded card (the content body — offers, strip, opportunities). */
function renderCommerceHarness(
  overrides: Partial<ToolCall> = {},
  locale: "en-US" | "zh-CN" = "en-US",
  forceOpen = true,
): string {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(CommerceHarnessToolCallBlock, renderContext(overrides, forceOpen)),
    ),
  );
}

/** The collapsed chat-line card through the full ToolCallBlock wrapper (the
 * toolSearch sibling pattern — the real dispatch + summary row). */
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
            toolId: "r5-fixture-tool-call",
            toolName: "find_best_offer",
            kind: "find_best_offer",
            input: { query: "yeezy shoes" },
            output: FIXTURE_TOOL_OUTPUT,
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
// 1. Routing (the fixture-check-r4.mjs promotion, through the real modules)
// ============================================================

describe("CommerceHarnessToolCallBlock routing (resolveRenderer by-name registration)", () => {
  const base = (overrides: Partial<ToolCall>): ToolCall =>
    ({
      toolId: "r5-routing",
      kind: "",
      input: {},
      status: "completed",
      raw: {},
      ...overrides,
    }) as ToolCall;

  /** The resolver reads only toolCallNode.toolCall (the fixture-check
   * precedent) — the minimal context is the documented contract surface. */
  function resolveFor(toolCall: ToolCall) {
    const context = {
      toolCallNode: { toolCall, childToolCalls: [] },
    } as unknown as ToolCallBlockRenderContext;
    return resolveToolCallRenderer(context);
  }

  it("routes find_best_offer by toolName, kind and title to the commerce-harness card", () => {
    expect(resolveFor(base({ toolName: "find_best_offer" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ kind: "find_best_offer" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ title: "find_best_offer" }))).toBe(CommerceHarnessToolCallBlock);
  });

  it("routes the aliases find_best_deal / shop_intent to the commerce-harness card", () => {
    expect(resolveFor(base({ toolName: "find_best_deal" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ toolName: "shop_intent" }))).toBe(CommerceHarnessToolCallBlock);
  });

  it("routes the StoreSearch-style wire variants (FindBestOffer / FindBestDeal / ShopIntent)", () => {
    expect(resolveFor(base({ toolName: "FindBestOffer" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ toolName: "FindBestDeal" }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ toolName: "ShopIntent" }))).toBe(CommerceHarnessToolCallBlock);
  });

  it("routes raw tool_name / name wire fields to the commerce-harness card", () => {
    expect(resolveFor(base({ raw: { tool_name: "find_best_offer" } }))).toBe(CommerceHarnessToolCallBlock);
    expect(resolveFor(base({ raw: { name: "shop_intent" } }))).toBe(CommerceHarnessToolCallBlock);
  });

  it("does NOT swallow near-misses (find_best_offers / best_offer / shop_intents / find_best → fallback, never the commerce card)", () => {
    for (const toolName of ["find_best_offers", "best_offer", "shop_intents", "find_best"]) {
      const resolved = resolveFor(base({ toolName }));
      expect(resolved, toolName).not.toBe(CommerceHarnessToolCallBlock);
    }
  });

  it("store_search and its aliases still resolve to their OWN card (zero regression)", () => {
    expect(resolveFor(base({ toolName: "store_search" }))).toBe(StoreSearchToolCallBlock);
    expect(resolveFor(base({ toolName: "search_stores" }))).toBe(StoreSearchToolCallBlock);
    expect(resolveFor(base({ toolName: "store_find" }))).toBe(StoreSearchToolCallBlock);
  });

  it("unrelated tools keep their own cards (WebSearch / Read / ListModels — zero regression)", () => {
    expect(resolveFor(base({ toolName: "WebSearch" }))).toBe(SearchToolCallBlock);
    expect(resolveFor(base({ toolName: "Read" }))).toBe(ReadToolCallBlock);
    expect(resolveFor(base({ toolName: "ListModels" }))).toBe(ListModelsToolCallBlock);
    expect(resolveFor(base({ toolName: "SomethingUnknown" }))).toBe(FallbackToolCallBlock);
  });
});

// ============================================================
// 2. Data-face honesty (parse + structural separation)
// ============================================================

describe("CommerceHarnessToolCallBlock data face (the §-contract JSON, labelled fixture)", () => {
  function toolCallWith(output: unknown, raw: unknown = {}): Parameters<typeof readCommerceHarnessResult>[0] {
    return {
      toolId: "r5-data-face",
      kind: "find_best_offer",
      input: {},
      output,
      raw,
      status: "completed",
    } as Parameters<typeof readCommerceHarnessResult>[0];
  }

  it("ACCEPTS the §-contract JSON object (results[] + opportunities[] are the acceptance skeleton)", () => {
    const result = readCommerceHarnessResult(toolCallWith(FIXTURE_TOOL_OUTPUT));
    expect(result).not.toBeNull();
    expect(result?.query).toBe("yeezy shoes");
    expect(result?.budget).toEqual({ amount: "400", currency: "HKD" });
    expect(result?.size).toBe("EU 44");
    expect(result?.offers).toHaveLength(1);
    expect(result?.offers[0]?.title).toBe("Fixture Runner EU 44");
    expect(result?.opportunities).toHaveLength(3);
    expect(result?.perStore).toHaveLength(2);
    expect(result?.constraintSatisfaction).toHaveLength(2);
  });

  it("ACCEPTS the JSON-string face (the persisted transcript path) and the legacy raw probes", () => {
    // The transcript face: the tool's serializeOutput content is a JSON string.
    expect(readCommerceHarnessResult(toolCallWith(JSON.stringify(FIXTURE_TOOL_OUTPUT)))).not.toBeNull();
    // Legacy/older hosts: the JSON rides on raw.rawOutput / raw.output / raw.result.
    expect(
      readCommerceHarnessResult(toolCallWith(undefined, { rawOutput: FIXTURE_TOOL_OUTPUT })),
    ).not.toBeNull();
    expect(
      readCommerceHarnessResult(toolCallWith(undefined, { output: JSON.stringify(FIXTURE_TOOL_OUTPUT) })),
    ).not.toBeNull();
    expect(
      readCommerceHarnessResult(toolCallWith(undefined, { result: FIXTURE_TOOL_OUTPUT })),
    ).not.toBeNull();
  });

  it("REJECTS a markdown-text face (the F4-P5-fix starvation class can never silently return)", () => {
    const markdown = [
      "# Best offers for yeezy shoes",
      "",
      "- Fixture Runner EU 44 — HKD 350.00 (under budget)",
      "- No feasible offer found.",
    ].join("\n");
    expect(readCommerceHarnessResult(toolCallWith(markdown))).toBeNull();
    // A JSON object without the results[]/opportunities[] skeleton is equally
    // unreadable — "unreadable" must never impersonate "no results".
    expect(readCommerceHarnessResult(toolCallWith({ ok: true, note: "no skeleton" }))).toBeNull();
    expect(readCommerceHarnessResult(toolCallWith(undefined))).toBeNull();
  });

  it("the rendered card SEPARATES offers from opportunities — the not-a-live-offer discipline is structural", () => {
    const html = renderCommerceHarness();

    // The full card rendered (not the fallback).
    expect(html).toContain('data-commerce-harness="true"');
    // The offers section carries the observed offer; the opportunities
    // section is a SEPARATE structure — never mixed into the offers list.
    expect(html).toContain('data-commerce-harness-offers="true"');
    expect(html).toContain('data-commerce-harness-opportunities="true"');
    const offersStart = html.indexOf('data-commerce-harness-offers="true"');
    const opportunitiesStart = html.indexOf('data-commerce-harness-opportunities="true"');
    expect(offersStart).toBeGreaterThan(-1);
    expect(opportunitiesStart).toBeGreaterThan(offersStart);

    // Every opportunity card: dashed border (the counterfactual shape) + the
    // "not a live offer" label + the evidence-class chip — the offer card
    // itself carries NEITHER the dashed border NOR the label.
    const opportunityCards = html.match(/data-commerce-harness-opportunity="true"/gu) ?? [];
    expect(opportunityCards).toHaveLength(3);
    expect(html).toContain("border-dashed");
    expect(html).toContain(enUS["chat.toolCall.commerceHarness.notLiveOffer"]);
    expect(html).toContain(enUS["chat.toolCall.commerceHarness.evidenceClass.conditional"]);
    expect(html).toContain(enUS["chat.toolCall.commerceHarness.evidenceClass.predicted"]);
    const offerCards = html.match(/data-commerce-harness-offer="true"/gu) ?? [];
    expect(offerCards).toHaveLength(1);
    // The OFFERS section (offers heading → opportunities section) carries
    // neither the dashed counterfactual border nor the not-a-live-offer label.
    const offersSectionStart = html.indexOf('data-commerce-harness-offers="true"');
    const opportunitiesSectionStart = html.indexOf('data-commerce-harness-opportunities="true"');
    const offersSectionHtml = html.slice(offersSectionStart, opportunitiesSectionStart);
    expect(offersSectionHtml).not.toContain("border-dashed");
    expect(offersSectionHtml).not.toContain(enUS["chat.toolCall.commerceHarness.notLiveOffer"]);
    expect(offersSectionHtml).toContain("Fixture Runner EU 44");
    // ... while the OPPORTUNITIES section carries them on every candidate
    // card (each card's own dashed border + the dashed evidence chip).
    const opportunitiesSectionHtml = html.slice(opportunitiesSectionStart);
    expect((opportunitiesSectionHtml.match(/border-dashed/gu) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(
      (opportunitiesSectionHtml.match(new RegExp(enUS["chat.toolCall.commerceHarness.notLiveOffer"], "gu")) ?? []).length,
    ).toBe(3); // the label rides on EVERY candidate card

    // The refused family's exact reason is rendered (the honesty proof).
    expect(html).toContain("NO promotions or discount API");
    expect(html).toContain("None claimed");
  });

  it("the summary row formats the budget through the exact-money path (HKD 400.00, never a float-shaped HKD 400)", () => {
    const html = renderToolCallBlockLine();
    expect(html).toContain(enUS["chat.toolCall.commerceHarness.kind"]);
    expect(html).toContain("yeezy shoes");
    expect(html).toContain(`under HKD 400.00`);
    expect(html).not.toContain("under HKD 400<");
    // The collapsed summary counts offers and opportunities separately.
    expect(html).toContain(
      enUS["chat.toolCall.commerceHarness.offerCount.one"].replace("{count}", "1"),
    );
    expect(html).toContain(
      enUS["chat.toolCall.commerceHarness.opportunityCount.other"].replace("{count}", "3"),
    );
  });

  it("the constraint chips render only the PRESENT intent constraints, values exact", () => {
    const html = renderCommerceHarness();
    expect(html).toContain('data-commerce-harness-constraints="true"');
    expect(html).toContain(`budget HKD 400.00`);
    expect(html).toContain("size EU 44");
    // The ABSENT constraints (brand/condition/deadline/geography) are never
    // fabricated as chips — INV-10 at the renderer face.
    expect(html).not.toContain(
      `${enUS["chat.toolCall.commerceHarness.constraint.brand"]} `,
    );
    expect(html).not.toContain(
      `${enUS["chat.toolCall.commerceHarness.condition"]} `,
    );
    expect(html).not.toContain(
      `${enUS["chat.toolCall.commerceHarness.constraint.deadline"]} `,
    );
  });

  it("the per-store strip preserves taxonomy codes and honest counts verbatim", () => {
    const html = renderCommerceHarness();
    expect(html).toContain('data-commerce-harness-strip="true"');
    expect(html).toContain("not_supported"); // verbatim taxonomy code, never translated
    expect(html).toContain("No store_search connector");
    expect(html).toContain(
      enUS["chat.toolCall.commerceHarness.truncated"].replace("{count}", "3"),
    );
  });

  it("the honest empty state names the binding constraint (violated first, detail verbatim)", () => {
    const html = renderCommerceHarness({
      output: {
        ...FIXTURE_TOOL_OUTPUT,
        results: [],
        evaluation: {
          ...FIXTURE_TOOL_OUTPUT.evaluation,
          constraintSatisfaction: [
            {
              constraint: "budget",
              status: "violated",
              detail:
                "Every same-currency observed subtotal exceeds HKD 400.00 — cheapest observed: HKD 4000.00. The budget is the binding constraint.",
            },
          ],
        },
      },
    });
    expect(html).toContain(
      enUS["chat.toolCall.commerceHarness.empty.violated"].replace(
        "{constraint}",
        enUS["chat.toolCall.commerceHarness.constraint.budget"],
      ),
    );
    expect(html).toContain("The budget is the binding constraint");
    expect(html).not.toContain('data-commerce-harness-offers="true"');
    // The opportunities still render — the counterfactual set is not hidden by
    // an empty shortlist.
    expect(html).toContain('data-commerce-harness-opportunities="true"');
  });

  it("a markdown output renders the FALLBACK card (raw payload visible) — never a fake empty commerce card", () => {
    const markdown = "# Best offers for yeezy shoes\n\n- Fixture Runner EU 44 — HKD 350.00";
    const html = renderCommerceHarness({ output: markdown });
    expect(html).not.toContain('data-commerce-harness="true"');
    expect(html).not.toContain('data-commerce-harness-offers="true"');
    expect(html).not.toContain('data-commerce-harness-opportunities="true"');
    // The fallback card shows the raw payload — "unreadable" ≠ "no results".
    expect(html).toContain("# Best offers for yeezy shoes");
  });

  it("zh-CN renders the same structural card (both locales carry the discipline)", () => {
    const html = renderCommerceHarness({}, "zh-CN");
    expect(html).toContain('data-commerce-harness="true"');
    expect(html).toContain('data-commerce-harness-opportunities="true"');
    expect(html).toContain(zhCN["chat.toolCall.commerceHarness.notLiveOffer"]);
    expect(html).toContain(zhCN["chat.toolCall.commerceHarness.evidenceClass.conditional"]);
    // The budget rides the same exact-money path in every locale: the zh-CN
    // underBudget message wraps the EXACT formatted "HKD 400.00".
    expect(html).toContain(
      zhCN["chat.toolCall.commerceHarness.underBudget"].replace("{budget}", "HKD 400.00"),
    );
  });
});

// ============================================================
// 3. i18n key completeness (the enumerated 38-key set, BOTH locales)
// ============================================================

describe("CommerceHarnessToolCallBlock i18n key completeness (en-US + zh-CN)", () => {
  /** The enumerated key set the renderer references — the contract (38 keys,
   * the R4 delivery's verified count). A key added to the renderer without
   * updating this list (and both locales) fails here — the 13-vs-15 lesson. */
  const FROZEN_COMMERCE_HARNESS_KEYS = [
    "chat.toolCall.commerceHarness.kind",
    "chat.toolCall.commerceHarness.planning",
    "chat.toolCall.commerceHarness.offerCount.one",
    "chat.toolCall.commerceHarness.offerCount.other",
    "chat.toolCall.commerceHarness.opportunityCount.one",
    "chat.toolCall.commerceHarness.opportunityCount.other",
    "chat.toolCall.commerceHarness.underBudget",
    "chat.toolCall.commerceHarness.found.one",
    "chat.toolCall.commerceHarness.found.other",
    "chat.toolCall.commerceHarness.noMatches",
    "chat.toolCall.commerceHarness.notConfigured",
    "chat.toolCall.commerceHarness.truncated",
    "chat.toolCall.commerceHarness.empty.violated",
    "chat.toolCall.commerceHarness.empty.noStores",
    "chat.toolCall.commerceHarness.empty.one",
    "chat.toolCall.commerceHarness.empty.other",
    "chat.toolCall.commerceHarness.constraint.budget",
    "chat.toolCall.commerceHarness.constraint.size",
    "chat.toolCall.commerceHarness.constraint.brand",
    "chat.toolCall.commerceHarness.constraint.condition",
    "chat.toolCall.commerceHarness.constraint.deadline",
    "chat.toolCall.commerceHarness.offersHeading",
    "chat.toolCall.commerceHarness.opportunitiesHeading",
    "chat.toolCall.commerceHarness.notLiveOffer",
    "chat.toolCall.commerceHarness.evidenceClass.conditional",
    "chat.toolCall.commerceHarness.evidenceClass.predicted",
    "chat.toolCall.commerceHarness.feasibility.feasible",
    "chat.toolCall.commerceHarness.feasibility.notSupported",
    "chat.toolCall.commerceHarness.feasibility.approvalRequired",
    "chat.toolCall.commerceHarness.opportunity.reason",
    "chat.toolCall.commerceHarness.opportunity.observedFacts",
    "chat.toolCall.commerceHarness.opportunity.changedAssumption",
    "chat.toolCall.commerceHarness.opportunity.predictedOutcome",
    "chat.toolCall.commerceHarness.opportunity.preconditions",
    "chat.toolCall.commerceHarness.opportunity.evidence",
    "chat.toolCall.commerceHarness.opportunity.expiry",
    "chat.toolCall.commerceHarness.opportunity.noExpiry",
    "chat.toolCall.commerceHarness.opportunity.consentAuthority",
  ] as const;

  it("every frozen key exists in BOTH en-US and zh-CN with a non-empty message", () => {
    expect(FROZEN_COMMERCE_HARNESS_KEYS).toHaveLength(38);
    for (const key of FROZEN_COMMERCE_HARNESS_KEYS) {
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
    const source = readFileSync(
      new URL("../src/ToolCallBlocks/renderers/commerce-harness.tsx", import.meta.url),
      "utf8",
    );
    const referenced = [
      ...new Set(source.match(/chat\.toolCall\.commerceHarness\.[A-Za-z0-9_.]+/gu) ?? []),
    ].sort();
    expect(referenced).toEqual([...FROZEN_COMMERCE_HARNESS_KEYS].sort());
  });

  it("both locales carry the IDENTICAL commerceHarness key set (no extra keys on either side)", () => {
    const enKeys = Object.keys(enUS)
      .filter((key) => key.startsWith("chat.toolCall.commerceHarness."))
      .sort();
    const zhKeys = Object.keys(zhCN)
      .filter((key) => key.startsWith("chat.toolCall.commerceHarness."))
      .sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toEqual([...FROZEN_COMMERCE_HARNESS_KEYS].sort());
  });
});
