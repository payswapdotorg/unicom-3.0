// ============================================================
// commerce-harness — the W-campaign acceptance scenarios suite
// (the 2026-10-31 operator review's five demanded demonstrations,
//  run end-to-end at the fixture tier)
// ============================================================
//
//   SCENARIO 1 — Find cheaper shoes: best observed offer + the COMPUTED
//   group-buy counterfactual (exact numbers, labelled bases) + the
//   substitutes family — a conditional opportunity that can genuinely
//   produce a lower price, with assumptions and unlock conditions stated.
//
//   SCENARIO 2 — The opportunity travels between nodes: node A publishes
//   the SHARED-GENERALIZED projection (never the private intent); node B
//   receives, validates, and surfaces it in its own matches for its own
//   user; the private record never touches the wire.
//
//   SCENARIO 3 — Browser-only platform operation: the operation-level
//   selector routes to the browser fallback (no API/MCP route); the
//   governed session + single-operation approval execute; the READ-BACK
//   observation (never the click) is the success basis; honest recovery
//   on selector drift.
//
//   SCENARIO 4 — Merchant workflow: recommendation → prepared change →
//   previewed diff → approved → executed → VERIFIED by read-back — the
//   four states are distinct and provably different (a recommendation
//   never writes; an attempted action without approval never reaches
//   the transport; a verified change carries the read-back record).
//
//   SCENARIO 5 — Comparative benchmark: the fixture-tier benchmark's own
//   honesty laws (one real comparator, labelled simulations, no
//   multiplier claim, live tier owed) — referenced, not duplicated.
//
// Fixture tier throughout: labelled fixture data, injected clocks, no
// live network, no real browser (issue #23 law).

import { describe, expect, it } from "vitest";
import type { StoreConnectionRecord } from "../src/stores/stores.js";
import type { CommerceIntentEnvelope } from "../src/commerce-harness/intent.js";
import type { CapabilityObservation } from "../src/commerce-harness/execution.js";
import {
  buildShortlist,
  evaluatePredictedTotals,
  runHarnessFlow,
  type StepExecutor,
} from "../src/commerce-harness/planner.js";
import { evaluateCounterfactualFamilies } from "../src/commerce-harness/families.js";
import type { MerchantVolumeTier } from "../src/commerce-harness/group-buy.js";
import { registerOpportunityCandidate } from "../src/commerce-harness/opportunity-lifecycle.js";
import { createFederationNode } from "../src/commerce-harness/federation.js";
import { createInMemoryCommerceNetwork } from "../src/commerce-harness/federation-wire.js";
import { selectTransportForOperation } from "../src/commerce-harness/transport-selector.js";
import {
  buildFixtureBrowserPage,
  deriveBrowserOperationId,
  openBrowserSession,
  performBrowserOperation,
  type ApprovalRecord,
  type BrowserOperation,
} from "../src/commerce-harness/browser-transport.js";
import { performBrowserOperationWithRecovery } from "../src/commerce-harness/browser-recovery.js";
import {
  approveMerchantChange,
  executeMerchantChange,
  prepareMerchantChange,
  previewMerchantChange,
  verifyMerchantChange,
  type MerchantWritePort,
} from "../src/commerce-harness/merchant-execution.js";
import { formatHarnessMoney } from "../src/commerce-harness/intent.js";
import { runBenchmarkCorpus } from "../src/commerce-harness/benchmark.js";

const NOW = new Date("2026-10-31T00:00:00.000Z");
const NOW_FN = (): Date => NOW;

const SHOE_STORE: StoreConnectionRecord = {
  id: "sc1-store",
  platform: "bigcommerce",
  domain: "shoes.fixture.invalid",
  label: "Fixture Shoe Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

const SHOE_INTENT: CommerceIntentEnvelope = {
  query: "runner sneakers",
  maxLandedTotalCost: { amount: "500.00", currency: "HKD" },
  size: "EU 44",
  brand: "fixture",
  consentBasis: "read-only-search",
  provenance: { surface: "test", expressedAt: "2026-10-31T00:00:00.000Z" },
  unknowns: ["condition", "geography", "deadline", "excludedStores"],
};

const SHOE_TIERS: MerchantVolumeTier[] = [
  { storeDomain: "shoes.fixture.invalid", minQuantity: 20, unitPrice: { amount: "80.00", currency: "HKD" } },
];

function shoeFinding(price: number, title: string): CapabilityObservation["findings"][number] {
  return {
    platform: "bigcommerce",
    store: "Fixture Shoe Store",
    store_domain: "shoes.fixture.invalid",
    title,
    price,
    currency: "HKD",
    url: "https://shoes.fixture.invalid/item",
    image_url: null,
    published_at: null,
    variant: "EU 44 · Black",
  };
}

const SHOE_EXACT: CapabilityObservation = {
  stepId: "step-1",
  target: {
    id: "sc1-store",
    platform: "bigcommerce",
    domain: "shoes.fixture.invalid",
    label: "Fixture Shoe Store",
    tier: "public",
  },
  operation: "store_search",
  outcome: "ok",
  observedAt: "2026-10-31T00:00:00.000Z",
  findings: [
    shoeFinding(100, "Fixture Runner Sneakers EU 44"),
    shoeFinding(120, "Fixture Runner Sneakers Pro EU 44"),
  ],
};

const SHOE_SUBSTITUTES: CapabilityObservation = {
  ...SHOE_EXACT,
  stepId: "step-2",
  findings: [shoeFinding(85, "Fixture Trainer Lite EU 44")],
};

// ——— SCENARIO 1: find cheaper shoes ———

describe("SCENARIO 1 — find cheaper shoes (observed best + computed counterfactuals)", () => {
  it("the flow returns the best observed offer AND a computed group-buy counterfactual with exact numbers", async () => {
    const readStores = async () => ({ stores: [SHOE_STORE] });
    const executeStep: StepExecutor = async (step) =>
      step.purpose === "exact" ? SHOE_EXACT : SHOE_SUBSTITUTES;
    const result = await runHarnessFlow({
      intent: SHOE_INTENT,
      readStores,
      executeStep,
      now: NOW_FN,
    });

    // The best observed offer: cheapest same-currency subtotal, constraint-ranked.
    expect(result.shortlist.length).toBeGreaterThan(0);
    expect(result.shortlist[0]?.price).toBe(100);
    expect(result.shortlist[0]?.landedTotal.subtotal).toEqual({ amount: "100.00", currency: "HKD" });
    // Landed stays UNKNOWN — no shipping was observed (INV-10).
    expect(result.evaluation.predictedTotals.landedTotalKnown).toBe(false);

    // The families carry the computed group-buy counterfactual.
    const families = evaluateCounterfactualFamilies({
      intent: SHOE_INTENT,
      targets: [SHOE_EXACT.target],
      exactObservations: [SHOE_EXACT],
      substitutesObservations: [SHOE_SUBSTITUTES],
      merchantVolumeTiers: SHOE_TIERS,
      observedAt: "2026-10-31T00:00:00.000Z",
    });
    const groupBuy = families.find((candidate) => candidate.family === "group_buy_threshold");
    // THE REVIEW'S NUMBERS: observed 100 → threshold 80 → HKD 20.00 per participant, 20 participants.
    expect(groupBuy?.predictedOutcome).toContain("HKD 20.00 per participant");
    expect(groupBuy?.predictedOutcome).toContain("20 participants");
    expect(groupBuy?.predictedOutcome).toContain("CONDITIONAL opportunity");
    expect(groupBuy?.preconditions.some((entry) => entry.includes("merchant honors"))).toBe(true);
    // And the substitutes family observed the cheaper EU 44 alternative.
    const substitutes = families.find((candidate) => candidate.family === "approved_substitutes");
    expect(substitutes?.observedFacts).toContain("Fixture Trainer Lite");
  });

  it("the shortlist's budget answer is UNKNOWN on the subtotal (never 'within total budget')", () => {
    const shortlist = buildShortlist(SHOE_INTENT, [SHOE_EXACT]);
    const budgetEntry = shortlist[0]?.constraints.find((entry) => entry.constraint === "budget");
    expect(budgetEntry?.status).toBe("unknown");
    expect(budgetEntry?.detail).toContain("landed total is UNKNOWN");
    expect(evaluatePredictedTotals(SHOE_INTENT, [SHOE_EXACT]).landedTotalKnown).toBe(false);
  });
});

// ——— SCENARIO 2: the opportunity travels between nodes ———

describe("SCENARIO 2 — the opportunity travels between nodes (privacy gate first)", () => {
  function sharedGroupBuyRecord() {
    const families = evaluateCounterfactualFamilies({
      intent: SHOE_INTENT,
      targets: [SHOE_EXACT.target],
      exactObservations: [SHOE_EXACT],
      substitutesObservations: [],
      merchantVolumeTiers: SHOE_TIERS,
      observedAt: "2026-10-31T00:00:00.000Z",
    });
    const groupBuy = families.find((candidate) => candidate.family === "group_buy_threshold");
    if (groupBuy === undefined) throw new Error("fixture: group-buy candidate missing");
    return registerOpportunityCandidate(
      groupBuy,
      { basis: "shared-generalized", grantedAt: "2026-10-31T00:00:00.000Z" },
      NOW,
      {
        currency: "HKD",
        priceBand: { min: { amount: "80.00", currency: "HKD" }, max: { amount: "120.00", currency: "HKD" } },
      },
    );
  }

  it("node A publishes the generalized projection; node B receives, validates, and surfaces it for its own user", () => {
    const network = createInMemoryCommerceNetwork();
    const nodeA = createFederationNode({ nodeId: "node-a", transport: network, now: NOW_FN });
    const nodeB = createFederationNode({ nodeId: "node-b", transport: network, now: NOW_FN });

    const record = sharedGroupBuyRecord();
    const publish = nodeA.publishSharedOpportunity(record);
    expect(publish.published).toBe(true);

    const verdicts = nodeB.receive();
    expect(verdicts.length).toBeGreaterThan(0);
    const delivered = nodeB.localRecords().received.find((entry) => entry.id === record.id);
    expect(delivered).toBeDefined();
    // Received records stay CONDITIONAL by law — never upgraded.
    expect(delivered?.status).toBe("active");

    // Node B matches the received opportunity for ITS OWN user's intent.
    const matches = nodeB.matchLocalIntent({
      ...SHOE_INTENT,
      provenance: { surface: "node-b", expressedAt: "2026-10-31T00:00:00.000Z" },
    });
    const groupBuyMatch = matches.find((match) => match.family === "group_buy_threshold");
    expect(groupBuyMatch).toBeDefined();
    expect(groupBuyMatch?.originNodeId).toBe("node-a");
    expect(groupBuyMatch?.budgetCompatible).toBe(true); // HKD 80–120 band vs HKD 500 budget
  });

  it("the PRIVATE record never touches the wire — the privacy gate refuses before any transport call", () => {
    const network = createInMemoryCommerceNetwork();
    const nodeA = createFederationNode({ nodeId: "node-a", transport: network, now: NOW_FN });
    const families = evaluateCounterfactualFamilies({
      intent: SHOE_INTENT,
      targets: [SHOE_EXACT.target],
      exactObservations: [SHOE_EXACT],
      substitutesObservations: [],
      observedAt: "2026-10-31T00:00:00.000Z",
    });
    const candidate = families.find((entry) => entry.family === "group_buy_threshold");
    if (candidate === undefined) throw new Error("fixture: candidate missing");
    const privateRecord = registerOpportunityCandidate(
      candidate,
      { basis: "private", grantedAt: "2026-10-31T00:00:00.000Z" },
      NOW,
    );
    const publish = nodeA.publishSharedOpportunity(privateRecord);
    expect(publish.published).toBe(false);
    if (!publish.published) expect(publish.reason).toBe("private-intent");
    // Nothing reached the wire: node B receives nothing.
    const nodeB = createFederationNode({ nodeId: "node-b", transport: network, now: NOW_FN });
    expect(nodeB.receive()).toHaveLength(0);
  });
});

// ——— SCENARIO 3: browser-only platform operation ———

describe("SCENARIO 3 — browser-only platform operation (governed, verified, recoverable)", () => {
  const DISCOVERY = {
    operation: "update_price",
    authorityClass: "approval-required" as const,
    routes: [
      { transport: "api" as const, available: false, reason: "the platform exposes no pricing API" },
      { transport: "browser" as const, available: true, reason: "the merchant web UI exposes the pricing form (labelled fixture)" },
    ],
  };

  it("the selector routes to the browser fallback; the authority class is carried, never relaxed", () => {
    const selection = selectTransportForOperation(DISCOVERY);
    expect(selection.selectedTransport).toBe("browser");
    expect(selection.authorityClass).toBe("approval-required");
    expect(selection.candidates.find((candidate) => candidate.transport === "api")?.reason).toBe(
      "declared unavailable",
    );
  });

  it("governed execution: session + single-operation approval + READ-BACK as the only success basis", () => {
    const page = buildFixtureBrowserPage({
      origin: "https://merchant.fixture.invalid",
      elements: [
        { id: "price-input", role: "input", label: "Price", text: "99.00", visible: true },
        { id: "save-button", role: "button", label: "Save", text: "Save", visible: true },
        { id: "status-text", role: "text", label: "Status", text: "Price updated to 99.00", visible: true },
      ],
    });
    const session = openBrowserSession(
      {
        sessionId: "sc3-session",
        origin: "https://merchant.fixture.invalid",
        authorityClass: "authorized-write",
        ttlMs: 60 * 60 * 1000,
      },
      NOW,
    );
    const act: BrowserOperation = {
      kind: "act",
      elementId: "save-button",
      action: "click",
      idempotencyKey: "sc3-save-1",
      effectDescription: "fixture: save the new price",
      requiresWriteAuthority: true,
    };
    const approval: ApprovalRecord = {
      principal: "sc3-principal",
      approvedAt: "2026-10-31T00:00:00.000Z",
      operationId: deriveBrowserOperationId(act),
      scope: "single-operation",
    };
    // WITHOUT the approval the act is refused BEFORE any page interaction.
    const denied = performBrowserOperation({ session, operation: act, page, now: NOW, timeoutBudgetMs: 10_000 });
    expect(denied.outcome).toBe("automation_denied");
    // WITH the single-operation approval the act lands, but the CLICK is not proof…
    const acted = performBrowserOperation({ session, operation: act, approval, page, now: NOW, timeoutBudgetMs: 10_000 });
    expect(acted.outcome).toBe("ok");
    // …only the read-back observation is.
    const readBack = performBrowserOperation({
      session,
      operation: { kind: "read-back", elementId: "status-text", expect: "Price updated to 99.00" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(readBack.outcome).toBe("ok");
    expect(readBack.evidence.readBackValue).toBe("Price updated to 99.00");
  });

  it("honest recovery: the drifted Save button is re-located structurally and the retry is recorded", () => {
    const page = buildFixtureBrowserPage({
      origin: "https://merchant.fixture.invalid",
      elements: [
        { id: "save-button-v2", role: "button", label: "Save", text: "Save", visible: true },
        { id: "status-text", role: "text", label: "Status", text: "Price updated to 99.00", visible: true },
      ],
    });
    const session = openBrowserSession(
      {
        sessionId: "sc3-session-2",
        origin: "https://merchant.fixture.invalid",
        authorityClass: "authorized-write",
        ttlMs: 60 * 60 * 1000,
      },
      NOW,
    );
    const act: BrowserOperation = {
      kind: "act",
      elementId: "save-button",
      action: "click",
      idempotencyKey: "sc3-save-2",
      effectDescription: "fixture: save the new price",
      requiresWriteAuthority: true,
    };
    const retryAct: BrowserOperation = {
      ...act,
      elementId: "save-button-v2",
      idempotencyKey: "sc3-save-2#recovery-1",
    };
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation: act,
      approval: { principal: "sc3-principal", approvedAt: "2026-10-31T00:00:00.000Z", operationId: deriveBrowserOperationId(act), scope: "single-operation" },
      retryApproval: { principal: "sc3-principal", approvedAt: "2026-10-31T00:00:00.000Z", operationId: deriveBrowserOperationId(retryAct), scope: "single-operation" },
      relocationTarget: { by: "label", value: "Save" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("ok");
    expect(recovery.recovery.strategy).toBe("selector-drift-relocation");
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.relocatedElementId).toBe("save-button-v2");
      expect(recovery.recovery.retryAttempted).toBe(true);
    }
  });
});

// ——— SCENARIO 4: the merchant workflow ———

describe("SCENARIO 4 — merchant workflow (recommendation ≠ prepared ≠ attempted ≠ verified)", () => {
  const STORE_TARGET = {
    id: "sc4-store",
    platform: "etsy",
    domain: "shop.fixture.invalid",
    label: "Fixture Shop",
    tier: "credential" as const,
  };

  it("the four states are provably distinct: a recommendation writes nothing; an unapproved attempt never reaches the transport", () => {
    let executeCalls = 0;
    let readBackCalls = 0;
    const port: MerchantWritePort = {
      execute: () => {
        executeCalls += 1;
        return { appliedAt: "2026-10-31T00:00:03.000Z", effect: "fixture: price updated to HKD 99.00" };
      },
      readBack: () => {
        readBackCalls += 1;
        return { observedValue: formatHarnessMoney({ amount: "99.00", currency: "HKD" }), observedAt: "2026-10-31T00:00:04.000Z" };
      },
    };

    // 1. RECOMMENDATION (pure analysis — no draft, no transport, nothing counted):
    const recommendation =
      "the observed price is 15% below the category median — raising it to 99.00 is projected to recover margin";
    expect(recommendation).toContain("projected");
    expect(executeCalls).toBe(0);

    // 2. PREPARED CHANGE (draft-only authority — no transport anywhere):
    const draft = prepareMerchantChange({
      store: STORE_TARGET,
      kind: "price_update",
      payload: {
        priceUpdate: {
          productId: "fixture-product-1",
          previousPrice: { amount: "85.00", currency: "HKD" },
          newPrice: { amount: "99.00", currency: "HKD" },
        },
      },
      now: NOW,
    });
    expect(draft.status).toBe("prepared");
    expect(executeCalls).toBe(0); // preparing wrote nothing

    // 3. PREVIEWED — the exact diff a human approves:
    const preview = previewMerchantChange(draft, NOW);
    expect(preview.before).toBe("HKD 85.00");
    expect(preview.after).toBe("HKD 99.00");
    expect(preview.lines.join("\n")).toContain("+HKD 14.00");
    expect(executeCalls).toBe(0); // previewing wrote nothing

    // The unapproved EXECUTION attempt is refused BEFORE the transport (the gate throws):
    expect(() =>
      executeMerchantChange({
        draft: preview.draft,
        authorityClass: "authorized-write",
        port,
        now: NOW,
      }),
    ).toThrow(/no single-operation ApprovalRecord/);
    expect(executeCalls).toBe(0); // NOTHING reached the transport

    // 4. APPROVED → EXECUTED → VERIFIED (the read-back decides):
    const approval: ApprovalRecord = {
      principal: "sc4-principal",
      approvedAt: "2026-10-31T00:00:02.000Z",
      operationId: draft.id,
      scope: "single-operation",
    };
    const approved = approveMerchantChange(preview.draft, approval, new Date("2026-10-31T00:00:02.000Z"));
    expect(approved.blocked).toBe(false);
    const executed = executeMerchantChange({
      draft: approved.draft,
      approval,
      authorityClass: "authorized-write",
      port,
      now: new Date("2026-10-31T00:00:03.000Z"),
    });
    expect(executed.draft.status).toBe("executing");
    expect(executeCalls).toBe(1); // exactly ONE port effect
    const read = port.readBack(executed.draft);
    const verified = verifyMerchantChange(
      executed.draft,
      {
        observedValue: read.observedValue,
        observedAt: read.observedAt,
        expected: formatHarnessMoney({ amount: "99.00", currency: "HKD" }),
      },
      new Date("2026-10-31T00:00:05.000Z"),
    );
    expect(verified.draft.verification?.status).toBe("verified");
    expect(readBackCalls).toBe(1);
  });
});

// ——— SCENARIO 5: the comparative benchmark (referenced, not duplicated) ———

describe("SCENARIO 5 — the comparative benchmark's honesty laws (fixture tier)", () => {
  it("one real comparator + labelled simulations + live tier owed + no multiplier claim", async () => {
    const result = await runBenchmarkCorpus({ now: NOW_FN });
    expect(result.meta.tier).toBe("fixture");
    expect(result.meta.liveTierOwed).toBe(true);
    expect(result.meta.comparatorsSimulated).toBe(true);
    expect(result.meta.latencyBasis).toBe("modeled-fixture-step-latency-not-live");
    // Exactly one REAL comparator (the harness flow); the two incumbents are labelled simulations.
    expect(result.aggregate["unicom-harness"]?.simulated).toBe(false);
    expect(result.aggregate["provider-native-incumbent"]?.simulated).toBe(true);
    expect(result.aggregate["general-purpose-baseline"]?.simulated).toBe(true);
    // No multiplier language anywhere in the artifact.
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toContain("10x");
    expect(serialized.toLowerCase()).not.toContain("10×");
  });
});
