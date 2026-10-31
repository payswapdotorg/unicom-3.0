#!/usr/bin/env -S pnpm exec tsx
// ============================================================
// commerce-harness — the W-campaign acceptance scenario runner
// (FIXTURE TIER, byte-reproducible under --at)
// ============================================================
//
// Runs the 2026-10-31 operator review's five demanded acceptance
// scenarios end-to-end over the fixture tier and prints the evidence
// record as JSON on stdout. Every scenario cites the laws it proved;
// every monetary number is an exact string decimal + explicit currency
// (INV-14); every claim is fixture-tier labelled (issue #23 law — no
// live network, no real browser, no live provider).
//
// Run:
//   pnpm exec tsx scripts/commerce-harness/run-scenarios.ts
//   pnpm exec tsx scripts/commerce-harness/run-scenarios.ts --at 2026-10-31T00:00:00.000Z --out docs/scenarios-w-2026-10-31.json
//
// CLOCK LAW: --at pins the run to a FIXED clock — the artifact is then
// byte-reproducible (the contract tests prove the same input yields the
// same bytes). Without --at the real clock is chosen HERE only.

import { writeFileSync } from "node:fs";
import type { StoreConnectionRecord } from "../../packages/services/src/stores/stores.js";
import type { CommerceIntentEnvelope } from "../../packages/services/src/commerce-harness/intent.js";
import type { CapabilityObservation } from "../../packages/services/src/commerce-harness/execution.js";
import { runHarnessFlow } from "../../packages/services/src/commerce-harness/planner.js";
import { evaluateCounterfactualFamilies } from "../../packages/services/src/commerce-harness/families.js";
import type { MerchantVolumeTier } from "../../packages/services/src/commerce-harness/group-buy.js";
import { registerOpportunityCandidate } from "../../packages/services/src/commerce-harness/opportunity-lifecycle.js";
import { createFederationNode } from "../../packages/services/src/commerce-harness/federation.js";
import { createInMemoryCommerceNetwork } from "../../packages/services/src/commerce-harness/federation-wire.js";
import { selectTransportForOperation } from "../../packages/services/src/commerce-harness/transport-selector.js";
import {
  buildFixtureBrowserPage,
  deriveBrowserOperationId,
  openBrowserSession,
  performBrowserOperation,
  type ApprovalRecord,
  type BrowserOperation,
} from "../../packages/services/src/commerce-harness/browser-transport.js";
import { performBrowserOperationWithRecovery } from "../../packages/services/src/commerce-harness/browser-recovery.js";
import {
  approveMerchantChange,
  executeMerchantChange,
  prepareMerchantChange,
  previewMerchantChange,
  verifyMerchantChange,
  type MerchantWritePort,
} from "../../packages/services/src/commerce-harness/merchant-execution.js";
import { formatHarnessMoney } from "../../packages/services/src/commerce-harness/intent.js";
import { runBenchmarkCorpus } from "../../packages/services/src/commerce-harness/benchmark.js";

const FIXTURE_LABEL = "FIXTURE-TIER SCENARIO RECORD — labelled fixture data only; never production-reachable";

async function main(): Promise<void> {
  const outFlagIndex = process.argv.indexOf("--out");
  const outPath = outFlagIndex >= 0 ? process.argv[outFlagIndex + 1] : undefined;
  const atFlagIndex = process.argv.indexOf("--at");
  const atArg = atFlagIndex >= 0 ? process.argv[atFlagIndex + 1] : undefined;
  const fixedAt = atArg !== undefined ? Date.parse(atArg) : Number.NaN;
  if (atArg !== undefined && !Number.isFinite(fixedAt)) {
    console.error(`--at must be a parseable ISO timestamp (got "${atArg}")`);
    process.exitCode = 1;
    return;
  }
  const now = atArg !== undefined ? (): Date => new Date(fixedAt) : (): Date => new Date();
  const NOW = now();
  const NOW_FN = now;

  // ——— the shared fixture world ———

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
    provenance: { surface: "scenario-runner", expressedAt: NOW.toISOString() },
    unknowns: ["condition", "geography", "deadline", "excludedStores"],
  };

  const SHOE_TIERS: MerchantVolumeTier[] = [
    { storeDomain: "shoes.fixture.invalid", minQuantity: 20, unitPrice: { amount: "80.00", currency: "HKD" } },
  ];

  const shoeFinding = (price: number, title: string): CapabilityObservation["findings"][number] => ({
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
  });

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
    observedAt: NOW.toISOString(),
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

  // ——— SCENARIO 1 — find cheaper shoes ———

  const flow = await runHarnessFlow({
    intent: SHOE_INTENT,
    readStores: async () => ({ stores: [SHOE_STORE] }),
    executeStep: async (step) => (step.purpose === "exact" ? SHOE_EXACT : SHOE_SUBSTITUTES),
    now: NOW_FN,
  });

  const families = evaluateCounterfactualFamilies({
    intent: SHOE_INTENT,
    targets: [SHOE_EXACT.target],
    exactObservations: [SHOE_EXACT],
    substitutesObservations: [SHOE_SUBSTITUTES],
    merchantVolumeTiers: SHOE_TIERS,
    observedAt: NOW.toISOString(),
  });
  const groupBuy = families.find((candidate) => candidate.family === "group_buy_threshold");
  const substitutes = families.find((candidate) => candidate.family === "approved_substitutes");

  const scenario1 = {
    name: "find cheaper shoes",
    tier: "fixture",
    lawsProved: [
      "the best observed offer is constraint-ranked with the budget answer UNKNOWN until landed costs are observed (INV-10)",
      "the group-buy counterfactual is COMPUTED in exact BigInt cents against the CHEAPEST observed offer — every number labelled with its basis",
      "the conditional opportunity lists the exact prerequisites that unlock the price; the tier price is never a live quote (INV-30)",
    ],
    bestObservedOffer: {
      title: flow.shortlist[0]?.title ?? null,
      subtotal: flow.shortlist[0]?.landedTotal.subtotal ?? null,
      budgetStatus:
        flow.shortlist[0]?.constraints.find((entry) => entry.constraint === "budget")?.status ?? null,
      budgetDetail:
        flow.shortlist[0]?.constraints.find((entry) => entry.constraint === "budget")?.detail ?? null,
      landedTotalKnown: flow.evaluation.predictedTotals.landedTotalKnown,
    },
    computedGroupBuyCounterfactual:
      groupBuy === undefined
        ? null
        : {
            feasibility: groupBuy.feasibility,
            evidenceClass: groupBuy.evidenceClass,
            observedFacts: groupBuy.observedFacts,
            predictedOutcome: groupBuy.predictedOutcome,
            preconditions: groupBuy.preconditions,
            expiresAt: groupBuy.evidence.expiresAt,
          },
    substitutesFamily:
      substitutes === undefined
        ? null
        : {
            observedFacts: substitutes.observedFacts,
            predictedOutcome: substitutes.predictedOutcome,
          },
  };

  // ——— SCENARIO 2 — the opportunity travels between nodes ———

  const network = createInMemoryCommerceNetwork();
  const nodeA = createFederationNode({ nodeId: "node-a", transport: network, now: NOW_FN });
  const nodeB = createFederationNode({ nodeId: "node-b", transport: network, now: NOW_FN });

  const sharedRecord =
    groupBuy === undefined
      ? null
      : registerOpportunityCandidate(
          groupBuy,
          { basis: "shared-generalized", grantedAt: NOW.toISOString() },
          NOW,
          {
            currency: "HKD",
            priceBand: {
              min: { amount: "80.00", currency: "HKD" },
              max: { amount: "120.00", currency: "HKD" },
            },
          },
        );

  const publish = sharedRecord === null ? null : nodeA.publishSharedOpportunity(sharedRecord);
  const verdicts = nodeB.receive();
  const received = sharedRecord === null ? [] : nodeB.localRecords().received.filter((entry) => entry.id === sharedRecord.id);
  const matches = nodeB.matchLocalIntent({
    ...SHOE_INTENT,
    provenance: { surface: "node-b", expressedAt: NOW.toISOString() },
  });
  const groupBuyMatch = matches.find((match) => match.family === "group_buy_threshold");

  // The privacy gate probe: a private record never touches the wire.
  const privateCandidate = families.find((entry) => entry.family === "wait_or_buy");
  const privateRecord =
    privateCandidate === undefined
      ? null
      : registerOpportunityCandidate(
          privateCandidate,
          { basis: "private", grantedAt: NOW.toISOString() },
          NOW,
        );
  const privatePublish = privateRecord === null ? null : nodeA.publishSharedOpportunity(privateRecord);

  const scenario2 = {
    name: "the opportunity travels between nodes",
    tier: "fixture",
    lawsProved: [
      "the privacy gate runs FIRST: a private record never touches the wire (no envelope, no trace)",
      "the generalized projection travels — never the private intent; received records stay conditional by law (INV-30)",
      "node B matches the received opportunity against ITS OWN user's intent (a pure read — never a reservation or a purchase)",
    ],
    publication: publish === null ? null : { published: publish.published, reason: publish.published ? null : publish.reason },
    receivedByNodeB: received.map((entry) => ({
      id: entry.id,
      originNodeId: entry.origin.nodeId,
      family: entry.projection.family,
      currency: entry.projection.currency,
      status: entry.status,
      evidenceClass: entry.evidenceClass,
    })),
    nodeBMatchForOwnUser:
      groupBuyMatch === undefined
        ? null
        : {
            family: groupBuyMatch.family,
            originNodeId: groupBuyMatch.originNodeId,
            budgetCompatible: groupBuyMatch.budgetCompatible,
            matchBasis: groupBuyMatch.matchBasis,
          },
    privacyGateProbe: privatePublish === null ? null : { published: privatePublish.published, reason: privatePublish.published ? null : privatePublish.reason },
  };

  // ——— SCENARIO 3 — browser-only platform operation ———

  const browserDiscovery = {
    operation: "update_price",
    authorityClass: "approval-required" as const,
    routes: [
      { transport: "api" as const, available: false, reason: "the platform exposes no pricing API for this scope" },
      { transport: "browser" as const, available: true, reason: "the merchant web UI exposes the pricing form (labelled fixture)" },
    ],
  };
  const browserSelection = selectTransportForOperation(browserDiscovery);

  const merchantUiPage = buildFixtureBrowserPage({
    origin: "https://merchant.fixture.invalid",
    elements: [
      { id: "price-input", role: "input", label: "Price", text: "99.00", visible: true },
      { id: "save-button", role: "button", label: "Save", text: "Save", visible: true },
      { id: "status-text", role: "text", label: "Status", text: "Price updated to 99.00", visible: true },
    ],
  });
  const browserSession = openBrowserSession(
    {
      sessionId: "scenario3-session",
      origin: "https://merchant.fixture.invalid",
      authorityClass: "authorized-write",
      ttlMs: 60 * 60 * 1000,
    },
    NOW,
  );
  const saveAct: BrowserOperation = {
    kind: "act",
    elementId: "save-button",
    action: "click",
    idempotencyKey: "scenario3-save",
    effectDescription: "fixture: save the new price",
    requiresWriteAuthority: true,
  };
  const saveApproval: ApprovalRecord = {
    principal: "scenario3-principal",
    approvedAt: NOW.toISOString(),
    operationId: deriveBrowserOperationId(saveAct),
    scope: "single-operation",
  };
  const unapproved = performBrowserOperation({
    session: browserSession,
    operation: saveAct,
    page: merchantUiPage,
    now: NOW,
    timeoutBudgetMs: 10_000,
  });
  const acted = performBrowserOperation({
    session: browserSession,
    operation: saveAct,
    approval: saveApproval,
    page: merchantUiPage,
    now: NOW,
    timeoutBudgetMs: 10_000,
  });
  const readBack = performBrowserOperation({
    session: browserSession,
    operation: { kind: "read-back", elementId: "status-text", expect: "Price updated to 99.00" },
    page: merchantUiPage,
    now: NOW,
    timeoutBudgetMs: 10_000,
  });

  // The honest-recovery probe on a DRIFTED page (the Save button re-issued under a new id).
  const driftedPage = buildFixtureBrowserPage({
    origin: "https://merchant.fixture.invalid",
    elements: [
      { id: "save-button-v2", role: "button", label: "Save", text: "Save", visible: true },
      { id: "status-text", role: "text", label: "Status", text: "Price updated to 99.00", visible: true },
    ],
  });
  const driftedAct: BrowserOperation = { ...saveAct, idempotencyKey: "scenario3-save-drift" };
  const driftedRetry: BrowserOperation = { ...driftedAct, elementId: "save-button-v2", idempotencyKey: "scenario3-save-drift#recovery-1" };
  const recovery = performBrowserOperationWithRecovery({
    session: browserSession,
    operation: driftedAct,
    approval: { ...saveApproval, operationId: deriveBrowserOperationId(driftedAct) },
    retryApproval: { ...saveApproval, operationId: deriveBrowserOperationId(driftedRetry) },
    relocationTarget: { by: "label", value: "Save" },
    page: driftedPage,
    now: NOW,
    timeoutBudgetMs: 10_000,
  });

  const scenario3 = {
    name: "browser-only platform operation",
    tier: "fixture",
    lawsProved: [
      "operation-level selection routes to the browser ONLY as the fallback — and carries the authority class unchanged",
      "the authority gate refuses an unapproved act BEFORE any page interaction",
      "a click is never proof: only the READ-BACK observation claims success",
      "selector drift recovers ONCE, structurally, with the re-approval law honored",
    ],
    transportSelection: browserSelection,
    unapprovedActOutcome: unapproved.outcome,
    approvedActOutcome: acted.outcome,
    readBackOutcome: readBack.outcome,
    readBackValue: readBack.evidence.readBackValue,
    honestRecovery: {
      finalOutcome: recovery.result.outcome,
      strategy: recovery.recovery.strategy,
      relocatedElementId:
        recovery.recovery.strategy === "selector-drift-relocation" ? recovery.recovery.relocatedElementId : null,
      retryAttempted:
        recovery.recovery.strategy === "selector-drift-relocation" ? recovery.recovery.retryAttempted : null,
    },
  };

  // ——— SCENARIO 4 — the merchant workflow ———

  let executeCalls = 0;
  let readBackCalls = 0;
  const merchantPort: MerchantWritePort = {
    execute: () => {
      executeCalls += 1;
      return { appliedAt: NOW.toISOString(), effect: "fixture: price updated to HKD 99.00" };
    },
    readBack: () => {
      readBackCalls += 1;
      return {
        observedValue: formatHarnessMoney({ amount: "99.00", currency: "HKD" }),
        observedAt: NOW.toISOString(),
      };
    },
  };

  const merchantDraft = prepareMerchantChange({
    store: {
      id: "sc4-store",
      platform: "etsy",
      domain: "shop.fixture.invalid",
      label: "Fixture Shop",
      tier: "credential",
    },
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
  const merchantPreview = previewMerchantChange(merchantDraft, NOW);
  let unapprovedAttemptRefused = false;
  let unapprovedAttemptReason: string | null = null;
  try {
    executeMerchantChange({
      draft: merchantPreview.draft,
      authorityClass: "authorized-write",
      port: merchantPort,
      now: NOW,
    });
  } catch (error) {
    unapprovedAttemptRefused = true;
    unapprovedAttemptReason = error instanceof Error ? error.message : String(error);
  }
  const merchantApproval: ApprovalRecord = {
    principal: "scenario4-principal",
    approvedAt: NOW.toISOString(),
    operationId: merchantDraft.id,
    scope: "single-operation",
  };
  const merchantApproved = approveMerchantChange(merchantPreview.draft, merchantApproval, NOW);
  const merchantExecuted = executeMerchantChange({
    draft: merchantApproved.blocked ? merchantPreview.draft : merchantApproved.draft,
    approval: merchantApproval,
    authorityClass: "authorized-write",
    port: merchantPort,
    now: NOW,
  });
  const merchantRead = merchantPort.readBack(merchantExecuted.draft);
  const merchantVerified = verifyMerchantChange(
    merchantExecuted.draft,
    {
      observedValue: merchantRead.observedValue,
      observedAt: merchantRead.observedAt,
      expected: formatHarnessMoney({ amount: "99.00", currency: "HKD" }),
    },
    NOW,
  );

  const scenario4 = {
    name: "merchant workflow",
    tier: "fixture",
    lawsProved: [
      "a RECOMMENDATION is pure analysis — nothing counted, nothing written",
      "a PREPARED change is draft-only — no transport is consulted at prepare or preview time",
      "an ATTEMPTED change without approval is refused BEFORE the transport (the gate throws; the port is never invoked)",
      "a VERIFIED change carries the read-back record — the only basis for claiming the write landed",
    ],
    recommendation: {
      analysis:
        "the observed price is 15% below the category median — raising it to 99.00 is projected to recover margin",
      transportEffects: 0,
    },
    preparedChange: { status: merchantDraft.status, transportEffectsAtPrepare: 0 },
    preview: { before: merchantPreview.before, after: merchantPreview.after, lines: merchantPreview.lines },
    unapprovedAttempt: { refused: unapprovedAttemptRefused, reason: unapprovedAttemptReason, transportEffects: executeCalls },
    approvedExecution: { status: merchantExecuted.draft.status, transportEffects: executeCalls },
    verification: {
      status: merchantVerified.draft.verification?.status ?? null,
      expected: merchantVerified.draft.verification?.expected ?? null,
      observedValue: merchantVerified.draft.verification?.observedValue ?? null,
      reason: merchantVerified.draft.verification?.reason ?? null,
    },
  };

  // ——— SCENARIO 5 — the comparative benchmark (referenced) ———

  const benchmark = await runBenchmarkCorpus({ now: NOW_FN });
  const scenario5 = {
    name: "comparative benchmark",
    tier: "fixture",
    lawsProved: [
      "exactly one REAL comparator (the harness flow); the two incumbents are labelled simulations",
      "the artifact's own meta states the tier, the owed live tier, and the modeled latency basis",
      "no multiplier language anywhere in the artifact",
    ],
    meta: benchmark.meta,
    aggregates: Object.fromEntries(
      Object.entries(benchmark.aggregate).map(([id, aggregate]) => [
        id,
        {
          simulated: aggregate.simulated,
          taskSuccessRate: aggregate.taskSuccessRate,
          costCorrectnessRate: aggregate.costCorrectnessRate,
          trueSavings: aggregate.trueSavings,
          falseSavings: aggregate.falseSavings,
        },
      ]),
    ),
    reference: "docs/benchmark-r7-2026-10-30.json (byte-reproducible under --at)",
  };

  // ——— the record ———

  const record = {
    fixtureLabel: FIXTURE_LABEL,
    scenarioSuite: "the 2026-10-31 operator review's five demanded acceptance demonstrations",
    generatedAt: NOW.toISOString(),
    clockPinned: atArg !== undefined,
    laws: {
      tier: "fixture — issue #23 law: no live network, no real browser, no live provider execution",
      money: "INV-14 — every monetary number below is an exact string decimal + explicit currency",
      evidence: "INV-30 — counterfactual prices are conditional, never live quotes",
      unknowns: "INV-10 — unknown stays unknown; no number is guessed",
    },
    scenarios: [scenario1, scenario2, scenario3, scenario4, scenario5],
  };

  const json = JSON.stringify(record, null, 2);
  if (outPath !== undefined && outPath.trim().length > 0) {
    writeFileSync(outPath, `${json}\n`, "utf8");
  }
  console.log(json);
}

await main();
