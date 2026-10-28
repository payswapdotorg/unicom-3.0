// ============================================================
// find_best_offer — the R5 tool + twin conformance suite
// (HARNESS-CONTRACT.md §2, the cross-cutting contracts, the tool face)
// ============================================================
//
// The R4 vertical slice's tool-side contract, as REAL tests in the package's
// own vitest lane (the promotion of dispatch/harness-check-r4.mjs — the
// temporary live-proof script — into the repo's enforceable suite; the LIVE
// evidence class stays with the worker fixtures + the TL battery, this is the
// labelled-fixture tier: no live network, no browsers, no stubs of shipped
// code).
//
// Contract under test (HARNESS-CONTRACT.md §1 L3/L4 + §2):
//   1. The tool's JSON face: {ok, intent, plan, evaluation.feasibility,
//      results, opportunities (evidenceClass conditional|predicted, NEVER
//      observed — INV-30), per_store, notice?, durationMs} against a FAKE
//      isolated ZCODE_DATA_BASE_DIR store record (a platform with NO committed
//      connector answers honestly not_supported — zero network by construction).
//   2. The twin agreement: the core twin (handlers/find-best-offer/) and the
//      canonical services module (packages/services/src/commerce-harness/)
//      agree on the family set, per-family feasibility, evidence classes,
//      money parsing/formatting, the plan and the shortlist for the SAME
//      labelled fixture record + observations. The layering wall (the twin
//      disclosure in harness.ts's header) is crossed by THIS TEST, never by
//      shipped code.
//   3. The authority gate (INV-7/8; the v1 safety law): a plan step whose
//      authorityClass is not read-only is refused BEFORE any network call.
//   4. The outcome taxonomy VERBATIM: timeout | unreachable |
//      invalid_credentials | insufficient_scope | rate_limited |
//      platform_error | not_configured | not_supported — asserted against a
//      frozen string list through the REAL classifier + the per-store strip,
//      so a taxonomy drift fails this suite.
//   5. NO formatModelContent on the tool entry (the F4-P5-fix law): the JSON
//      fallback feeds both the model and the transcript — the renderer's data
//      face can never be starved by a text formatter again.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The tool under test + its committed machinery.
import { findBestOfferToolEntry } from "../src/tool/handlers/find-best-offer.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { stringifyOutputForModel } from "../src/tool/executor/result-content-projection.js";
import {
  classifyFetchThrow,
  classifyPlatformFetch,
  notConfiguredError,
} from "../src/tool/handlers/store-search/errors.js";
import { connectorFor } from "../src/tool/handlers/store-search/index.js";

// The core twin (the runtime implementation the agent actually calls).
import * as twinHarness from "../src/tool/handlers/find-best-offer/harness.js";
import * as twinFamilies from "../src/tool/handlers/find-best-offer/families.js";

// The canonical services-island module (the same contract's other face — the
// twin-agreement proof imports both, the way dispatch/harness-check-r4.mjs
// did; @zcode/core itself never imports across this wall).
import * as moduleIntent from "../../../../../packages/services/src/commerce-harness/intent.js";
import * as modulePlanner from "../../../../../packages/services/src/commerce-harness/planner.js";
import * as moduleFamilies from "../../../../../packages/services/src/commerce-harness/families.js";
import * as moduleExecution from "../../../../../packages/services/src/commerce-harness/execution.js";

// ——— the labelled fixtures (fixture tier: no live network anywhere) ———

/** A Tier-1 public record on a platform with NO committed connector: the
 * governed executor answers honestly `not_supported` without any fetch. The
 * .invalid TLD is reserved (RFC 2606) — unreachable even by accident. */
const FIXTURE_PUBLIC_STORE = {
  id: "r5-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "R5 Fixture Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
} as const;

/** A web-tier record (no public store API): delegated to WebSearch via the
 * notice, never planned — the honest web-tier law. */
const FIXTURE_WEB_STORE = {
  id: "r5-fixture-web",
  platform: "whatnot",
  domain: "whatnot.example",
  label: "R5 Fixture Web Store",
  tier: "web",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
} as const;

const FIXTURE_INTENT: twinHarness.CommerceIntentEnvelope = {
  query: "yeezy shoes",
  maxLandedTotalCost: { amount: "400", currency: "HKD" },
  size: "EU 44",
  consentBasis: "read-only-search",
  provenance: { surface: "r5 conformance fixture", expressedAt: "2026-10-28T00:00:00.000Z" },
  unknowns: ["brand", "condition", "geography", "deadline", "excludedStores"],
};

const FIXTURE_TARGET: twinHarness.ConnectedStoreTarget = {
  id: FIXTURE_PUBLIC_STORE.id,
  platform: FIXTURE_PUBLIC_STORE.platform,
  domain: FIXTURE_PUBLIC_STORE.domain,
  label: FIXTURE_PUBLIC_STORE.label,
  tier: "public",
};

/** The exact-query observation fixture: one in-budget offer (size satisfied by
 * title), one over-budget offer (violated — must be excluded from the
 * shortlist), one unpriced offer (budget UNKNOWN — must stay in). */
function fixtureExactObservation(): twinHarness.CapabilityObservation {
  return {
    stepId: "fixture-exact",
    target: FIXTURE_TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-28T00:00:00.000Z",
    findings: [
      {
        platform: "bigcommerce",
        store: "R5 Fixture Store",
        store_domain: "fixture.invalid",
        title: "Fixture Runner EU 44",
        price: 350,
        currency: "HKD",
        url: "https://fixture.invalid/runner",
        image_url: null,
        published_at: "2026-10-01T00:00:00.000Z",
      },
      {
        platform: "bigcommerce",
        store: "R5 Fixture Store",
        store_domain: "fixture.invalid",
        title: "Fixture Grand Vintage",
        price: 4000,
        currency: "HKD",
        url: "https://fixture.invalid/grand",
        image_url: null,
        published_at: "2026-10-02T00:00:00.000Z",
      },
      {
        platform: "bigcommerce",
        store: "R5 Fixture Store",
        store_domain: "fixture.invalid",
        title: "Fixture No-Price Sneaker",
        price: null,
        currency: null,
        url: "https://fixture.invalid/noprice",
        image_url: null,
        published_at: null,
      },
    ],
  };
}

/** The broadened substitutes observation fixture: one in-budget substitute. */
function fixtureSubstitutesObservation(): twinHarness.CapabilityObservation {
  return {
    stepId: "fixture-substitutes",
    target: FIXTURE_TARGET,
    operation: "store_search",
    outcome: "ok",
    observedAt: "2026-10-28T00:00:00.000Z",
    findings: [
      {
        platform: "bigcommerce",
        store: "R5 Fixture Store",
        store_domain: "fixture.invalid",
        title: "Fixture Substitute Trainer",
        price: 300,
        currency: "HKD",
        url: "https://fixture.invalid/substitute",
        image_url: null,
        published_at: "2026-10-03T00:00:00.000Z",
      },
    ],
  };
}

// ——— the isolated per-user state (ZCODE_DATA_BASE_DIR, bound per test) ———

const previousDataDir = process.env.ZCODE_DATA_BASE_DIR;
const tempRoots: string[] = [];

/** An isolated ZCODE_DATA_BASE_DIR carrying the labelled fixture records. */
function fixtureDataDir(
  stores: readonly unknown[] = [FIXTURE_PUBLIC_STORE, FIXTURE_WEB_STORE],
): string {
  const base = mkdtempSync(join(tmpdir(), "r5-find-best-offer-"));
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

/** The handler context fixture (the harness-check precedent: the handler
 * reads abortSignal only; the rest are trace identities). */
function handlerContext(): ToolExecutionContext {
  return {
    toolCallId: "r5-find-best-offer",
    traceId: "r5-trace",
    spanId: "r5-span",
    abortSignal: new AbortController().signal,
  } as unknown as ToolExecutionContext;
}

/** The §-contract JSON face, typed through the twin's exported contract types. */
type FindBestOfferToolOutput = {
  ok: true;
  intent: twinHarness.CommerceIntentEnvelope;
  plan: twinHarness.CapabilityPlan;
  evaluation: twinHarness.PlanEvaluation;
  results: twinHarness.ShortlistOffer[];
  opportunities: twinFamilies.HarnessOpportunityCandidate[];
  per_store: twinHarness.PerStoreEntry[];
  notice?: string;
  durationMs: number;
};

async function invokeTool(input: Record<string, unknown>): Promise<FindBestOfferToolOutput> {
  const output = await findBestOfferToolEntry.handler(input, handlerContext());
  return output as FindBestOfferToolOutput;
}

// ============================================================
// 1. The tool's JSON face (the §-contract output shape, fixture tier)
// ============================================================

describe("find_best_offer — the §-contract JSON face (isolated fixture state, no live network)", () => {
  it("returns the full face {ok, intent, plan, evaluation, results, opportunities, per_store, durationMs} for the fixture records", async () => {
    fixtureDataDir();
    const output = await invokeTool({
      query: "yeezy shoes",
      maxTotal: { amount: "400", currency: "HKD" },
      size: "EU 44",
      maxPerStore: 2,
    });

    expect(output.ok).toBe(true);

    // L1: the intent envelope — the structured ask + INV-10 unknowns.
    expect(output.intent.query).toBe("yeezy shoes");
    expect(output.intent.maxLandedTotalCost).toEqual({ amount: "400", currency: "HKD" });
    expect(output.intent.size).toBe("EU 44");
    expect(output.intent.consentBasis).toBe("read-only-search");
    expect(typeof output.intent.provenance.surface).toBe("string");
    expect(output.intent.unknowns).toEqual([
      "brand",
      "condition",
      "geography",
      "deadline",
      "excludedStores",
    ]);

    // L3: the plan — the searchable public record carries the exact + the
    // broadened substitutes step; the web-tier record is NEVER planned.
    const steps = output.plan.steps;
    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.operation === "store_search" && step.transport === "api" && step.authorityClass === "read-only")).toBe(true);
    expect(steps.some((step) => step.purpose === "exact" && step.query === "yeezy shoes")).toBe(true);
    expect(steps.some((step) => step.purpose === "substitutes" && step.query === "shoes")).toBe(true);
    expect(steps.every((step) => step.target.domain === FIXTURE_PUBLIC_STORE.domain)).toBe(true);
    expect(steps.some((step) => step.target.domain === FIXTURE_WEB_STORE.domain)).toBe(false);

    // L3: per-step feasibility — Tier-1 public, UNKNOWN preserved (INV-10).
    expect(output.evaluation.feasibility).toHaveLength(2);
    for (const item of output.evaluation.feasibility) {
      expect(item.feasible).toBe(true);
      expect(item.authorityOk).toBe(true);
      expect(item.credentialScopeOk).toBe(true);
      expect(item.geographyCurrencyOk).toBe("unknown");
      expect(item.freshnessOk).toBe("unknown");
    }

    // L5: results — the honest empty path (the no-connector platform observed
    // nothing ok, so no offer is claimed), with the budget honestly UNKNOWN
    // (never guessed violated or satisfied without a priced observation).
    expect(output.results).toEqual([]);
    const budgetEntry = output.evaluation.constraintSatisfaction.find(
      (entry) => entry.constraint === "budget",
    );
    expect(budgetEntry?.status).toBe("unknown");
    expect(budgetEntry?.detail).toContain("No priced offer was observed");

    // The eight counterfactual families answer with honest evidence classes.
    expect(output.opportunities).toHaveLength(8);
    for (const candidate of output.opportunities) {
      expect(["conditional", "predicted"]).toContain(candidate.evidenceClass);
    }

    // The per-store strip: the honest taxonomy face for the no-connector
    // platform (verbatim code, never a fake search).
    expect(output.per_store).toHaveLength(1);
    expect(output.per_store[0]?.store).toBe("R5 Fixture Store");
    if (output.per_store[0]?.status !== "ok") {
      expect(output.per_store[0]?.error).toBe("not_supported");
      expect(output.per_store[0]?.message).toContain("No store_search connector");
    }

    // The web-tier record answers through the notice, never through a step.
    expect(output.notice).toContain("R5 Fixture Web Store");
    expect(output.notice).toContain("searched via the web instead");

    expect(typeof output.durationMs).toBe("number");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("the tool's own declared runtime output schema accepts the fixture face (the entry's zod contract)", async () => {
    fixtureDataDir();
    const output = await invokeTool({
      query: "yeezy shoes",
      maxTotal: { amount: "400", currency: "HKD" },
      size: "EU 44",
    });
    const runtimeOutputSchema = findBestOfferToolEntry.runtimeOutputSchema as {
      parse: (value: unknown) => unknown;
    };
    expect(() => runtimeOutputSchema.parse(output)).not.toThrow();
  });

  it("the zero-stores path stays honest: empty results/per_store, the connect-one notice, all 8 family slots still answering", async () => {
    fixtureDataDir([]);
    const output = await invokeTool({ query: "anything" });

    expect(output.ok).toBe(true);
    expect(output.results).toEqual([]);
    expect(output.per_store).toEqual([]);
    expect(output.plan.steps).toEqual([]);
    expect(output.evaluation.feasibility).toEqual([]);
    expect(output.opportunities).toHaveLength(8);
    expect(output.notice).toContain("No stores are connected yet");
    expect(output.notice).toContain("Connected Stores");
  });
});

// ============================================================
// 2. The twin agreement (module ↔ core twin, the same fixtures both sides)
// ============================================================

describe("find_best_offer — the twin agreement (packages/services module ↔ core twin)", () => {
  it("parseMoneyToCents agrees on the 9-case exact-money table (INV-14: BigInt cents, deterministic rejects)", () => {
    const cases: ReadonlyArray<[string, bigint | null]> = [
      ["400", 40000n],
      ["400.00", 40000n],
      ["0.01", 1n],
      ["4000.5", 400050n],
      ["0", 0n],
      ["abc", null],
      ["-1", null],
      ["1.234", null],
      ["4000.50", 400050n],
    ];
    for (const [amount, expected] of cases) {
      expect(moduleIntent.parseMoneyToCents(amount)).toBe(expected);
      expect(twinHarness.parseMoneyToCents(amount)).toBe(expected);
      expect(moduleIntent.parseMoneyToCents(amount)).toBe(twinHarness.parseMoneyToCents(amount));
    }
    // The documented rule for >2 fraction digits: REJECT, never round.
    expect(moduleIntent.parseMoneyToCents("400.005")).toBeNull();
    expect(twinHarness.parseMoneyToCents("400.005")).toBeNull();
  });

  it("formatHarnessMoney agrees module ↔ twin on the display table (exact 2-dp, deterministic passthrough)", () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ["400", "HKD", "HKD 400.00"],
      ["400.00", "HKD", "HKD 400.00"],
      ["0.01", "USD", "USD 0.01"],
      ["4000.5", "HKD", "HKD 4000.50"],
      // Unparseable amounts pass through verbatim — never a rounded lie.
      ["400.005", "HKD", "HKD 400.005"],
    ];
    for (const [amount, currency, expected] of cases) {
      const moduleText = moduleIntent.formatHarnessMoney({ amount, currency });
      const twinText = twinHarness.formatHarnessMoney({ amount, currency });
      expect(moduleText).toBe(expected);
      expect(twinText).toBe(expected);
    }
  });

  it("buildCapabilityPlan agrees: same steps, purposes, queries, authority classes and targets for the same fixture record", () => {
    const now = new Date("2026-10-28T00:00:00.000Z");
    const moduleBuild = modulePlanner.buildCapabilityPlan(
      FIXTURE_INTENT,
      [{ ...FIXTURE_PUBLIC_STORE }],
      now,
    );
    const twinBuild = twinHarness.buildCapabilityPlan(
      FIXTURE_INTENT,
      [{ ...FIXTURE_PUBLIC_STORE }],
      now,
    );

    const shape = (build: { plan: { steps: twinHarness.CapabilityPlanStep[] } }) =>
      build.plan.steps.map(
        (step) =>
          `${step.id}:${step.purpose}:${step.query}:${step.authorityClass}:${step.target.domain}`,
      );
    expect(shape(moduleBuild)).toEqual(shape(twinBuild));
    expect(moduleBuild.plan.steps).toHaveLength(2);
    expect(moduleBuild.searchableRecords).toHaveLength(1);
    expect(twinBuild.searchableRecords).toHaveLength(1);
  });

  it("buildShortlist agrees on the fixture exact observation (rank/title/price/subtotal; violated excluded, unknowns kept in)", () => {
    const exactObservation = fixtureExactObservation();
    const moduleShortlist = modulePlanner.buildShortlist(FIXTURE_INTENT, [exactObservation]);
    const twinShortlist = twinHarness.buildShortlist(FIXTURE_INTENT, [exactObservation]);

    const shape = (list: { rank: number; title: string; price: number | null; currency: string | null; subtotal: { amount: string } | null }[]) =>
      list.map(
        (offer) =>
          `${offer.rank}|${offer.title}|${String(offer.price)}|${String(offer.currency)}|${offer.subtotal?.amount ?? "null"}`,
      );
    expect(shape(moduleShortlist)).toEqual(shape(twinShortlist));

    // The hard-constraint-first law, on the twin's answer (the module's is
    // proven in the services-lane suite):
    expect(twinShortlist.map((offer) => offer.title)).toEqual([
      "Fixture Runner EU 44",
      "Fixture No-Price Sneaker",
    ]);
    expect(twinShortlist.every((offer) => offer.rank > 0)).toBe(true);
    expect(
      twinShortlist.every((offer) => !offer.constraints.some((entry) => entry.status === "violated")),
    ).toBe(true);
  });

  it("evaluateCounterfactualFamilies agrees: the 8 families' feasibility + evidence classes + titles are identical on both sides (and NEVER observed — INV-30)", () => {
    const input = {
      intent: FIXTURE_INTENT,
      targets: [FIXTURE_TARGET],
      exactObservations: [fixtureExactObservation()],
      substitutesObservations: [fixtureSubstitutesObservation()],
      observedAt: "2026-10-28T00:00:00.000Z",
    };
    const moduleCandidates = moduleFamilies.evaluateCounterfactualFamilies(input);
    const twinCandidates = twinFamilies.evaluateCounterfactualFamilies(input);

    expect(moduleCandidates).toHaveLength(8);
    expect(twinCandidates).toHaveLength(8);
    expect(moduleCandidates.map((candidate) => candidate.family)).toEqual(
      twinCandidates.map((candidate) => candidate.family),
    );
    for (let index = 0; index < moduleCandidates.length; index += 1) {
      const moduleCandidate = moduleCandidates[index]!;
      const twinCandidate = twinCandidates[index]!;
      expect(twinCandidate.family).toBe(moduleCandidate.family);
      expect(twinCandidate.feasibility).toBe(moduleCandidate.feasibility);
      expect(twinCandidate.evidenceClass).toBe(moduleCandidate.evidenceClass);
      expect(twinCandidate.title).toBe(moduleCandidate.title);
      // INV-30 on BOTH faces of the contract, fixture data included:
      expect(["conditional", "predicted"]).toContain(moduleCandidate.evidenceClass);
      expect(["conditional", "predicted"]).toContain(twinCandidate.evidenceClass);
    }

    // The live-verified verdicts hold on the fixture tier too (both sides).
    const verdictOf = (candidates: { family: string; feasibility: string; evidenceClass: string }[]) =>
      Object.fromEntries(candidates.map((candidate) => [candidate.family, `${candidate.feasibility}/${candidate.evidenceClass}`]));
    const expectedVerdicts = {
      group_buy_threshold: "approval_required/conditional",
      merchant_counteroffer: "approval_required/conditional",
      coupon_promotion_eligibility: "not_supported/conditional",
      order_shipping_consolidation: "not_supported/conditional",
      local_pickup: "not_supported/conditional",
      different_fulfillment_route: "not_supported/conditional",
      wait_or_buy: "feasible/predicted",
      approved_substitutes: "feasible/conditional",
    } as const;
    expect(verdictOf(moduleCandidates)).toEqual(expectedVerdicts);
    expect(verdictOf(twinCandidates)).toEqual(expectedVerdicts);
  });
});

// ============================================================
// 3. The authority gate (INV-7/8 — a non-read-only step never reaches the network)
// ============================================================

describe("find_best_offer — the read-only authority gate", () => {
  const gateFixtureStep = (authorityClass: twinHarness.CapabilityPlanStep["authorityClass"]): twinHarness.CapabilityPlanStep => ({
    id: "r5-gate-step",
    target: FIXTURE_TARGET,
    operation: "store_search",
    transport: "api",
    authorityClass,
    purpose: "exact",
    query: "yeezy shoes",
    expectedObservation: "must never run",
    expectedCost: { amount: "0.00", currency: "XXX" },
    expectedLatencyMs: 10_000,
  });

  it("throws HarnessAuthorityError for a draft-only step (before any network call)", () => {
    expect(() => twinHarness.assertReadOnlyAuthority(gateFixtureStep("draft-only"))).toThrowError(
      twinHarness.HarnessAuthorityError,
    );
    try {
      twinHarness.assertReadOnlyAuthority(gateFixtureStep("draft-only"));
    } catch (error) {
      const gateError = error as twinHarness.HarnessAuthorityError;
      expect(gateError.name).toBe("HarnessAuthorityError");
      expect(gateError.message).toContain("BEFORE any network call");
    }
  });

  it("throws HarnessAuthorityError for an authorized-write step", () => {
    expect(() =>
      twinHarness.assertReadOnlyAuthority(gateFixtureStep("authorized-write")),
    ).toThrowError(twinHarness.HarnessAuthorityError);
  });

  it("throws HarnessAuthorityError for an approval-required step", () => {
    expect(() =>
      twinHarness.assertReadOnlyAuthority(gateFixtureStep("approval-required")),
    ).toThrowError(twinHarness.HarnessAuthorityError);
  });

  it("passes a read-only step and the module's gate agrees on the same refusal (twin agreement on the gate)", () => {
    expect(() => twinHarness.assertReadOnlyAuthority(gateFixtureStep("read-only"))).not.toThrow();
    expect(() => moduleExecution.assertReadOnlyAuthority(gateFixtureStep("authorized-write"))).toThrowError(
      moduleExecution.HarnessAuthorityError,
    );
  });

  it("the flow only ever produces read-only steps — every step the executor can see declares read-only authority", async () => {
    fixtureDataDir();
    const output = await invokeTool({ query: "yeezy shoes" });
    expect(output.plan.steps.length).toBeGreaterThan(0);
    expect(output.plan.steps.every((step) => step.authorityClass === "read-only")).toBe(true);
  });
});

// ============================================================
// 4. The outcome taxonomy VERBATIM (frozen list; drift fails the suite)
// ============================================================

/** HARNESS-CONTRACT §2 + the delivered store_search §-contract: the frozen
 * outcome taxonomy. If the shipped code drifts from this list, these tests
 * fail — a taxonomy string is a contract, not a detail. */
const FROZEN_OUTCOME_TAXONOMY = [
  "timeout",
  "unreachable",
  "invalid_credentials",
  "insufficient_scope",
  "rate_limited",
  "platform_error",
  "not_configured",
  "not_supported",
] as const;

describe("find_best_offer — the outcome taxonomy verbatim", () => {
  it("the real HTTP classifier answers ONLY frozen taxonomy codes (401/403/429/5xx)", () => {
    const headers = (retryAfter?: string) =>
      retryAfter === undefined ? new Headers() : new Headers({ "retry-after": retryAfter });

    const cases: ReadonlyArray<[number, Headers, string, string]> = [
      [401, headers(), "unauthorized", "invalid_credentials"],
      [403, headers(), "insufficient scope for products", "insufficient_scope"],
      [403, headers(), "access denied", "invalid_credentials"],
      [429, headers("7"), "slow down", "rate_limited"],
      [500, headers(), "internal error", "platform_error"],
    ];
    for (const [status, requestHeaders, body, expected] of cases) {
      const error = classifyPlatformFetch("fixture", status, requestHeaders, body);
      expect(FROZEN_OUTCOME_TAXONOMY).toContain(error.code);
      expect(error.code).toBe(expected);
      expect(error.message.length).toBeGreaterThan(0);
    }
    // 429 surfaces the platform's own Retry-After.
    expect(
      classifyPlatformFetch("fixture", 429, headers("7"), "slow down").retryAfterSeconds,
    ).toBe(7);
  });

  it("the real transport classifier answers ONLY frozen taxonomy codes (abort/DNS)", () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const timeout = classifyFetchThrow("fixture", abortError);
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(timeout.code);
    expect(timeout.code).toBe("timeout");

    const unreachable = classifyFetchThrow("fixture", new Error("getaddrinfo ENOTFOUND fixture.invalid"));
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(unreachable.code);
    expect(unreachable.code).toBe("unreachable");
  });

  it("the honest not_configured error is a frozen taxonomy code", () => {
    const notConfigured = notConfiguredError("fixture");
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(notConfigured.code);
    expect(notConfigured.code).toBe("not_configured");
  });

  it("the no-connector platform answers not_supported through the real tool face (frozen code, verbatim)", async () => {
    expect(connectorFor(FIXTURE_PUBLIC_STORE.platform)).toBeNull();
    fixtureDataDir([FIXTURE_PUBLIC_STORE]);
    const output = await invokeTool({ query: "yeezy shoes" });
    const entry = output.per_store[0];
    if (entry?.status === "ok") {
      throw new Error("the no-connector fixture platform must not answer ok");
    }
    expect(FROZEN_OUTCOME_TAXONOMY).toContain(entry?.error);
    expect(entry?.error).toBe("not_supported");
  });

  it("buildPerStoreStrip preserves every taxonomy code verbatim in the per_store error field (and UNKNOWN stays unknown)", () => {
    const observationFor = (
      code: (typeof FROZEN_OUTCOME_TAXONOMY)[number] | "unknown",
      withErrorPayload: boolean,
    ): twinHarness.CapabilityObservation => ({
      stepId: `r5-strip-${code}`,
      target: FIXTURE_TARGET,
      operation: "store_search",
      outcome: code,
      observedAt: "2026-10-28T00:00:00.000Z",
      ...(withErrorPayload
        ? { error: { code: code as Exclude<typeof code, "ok" | "unknown">, message: `fixture ${code}` } }
        : {}),
    });

    // Every frozen failure code round-trips verbatim through the strip.
    for (const code of FROZEN_OUTCOME_TAXONOMY) {
      const strip = twinHarness.buildPerStoreStrip(
        [observationFor(code, true)],
        (platform) => platform,
      );
      const entry = strip[0];
      if (entry?.status === "ok") {
        throw new Error(`taxonomy code ${code} must not render as an ok strip entry`);
      }
      expect(entry.error).toBe(code); // verbatim — never translated, never swallowed
      expect(entry.status).toBe(code === "not_configured" ? "not_configured" : "error");
      expect(entry.message).toBe(`fixture ${code}`);
    }

    // An ok observation carries the honest count.
    const okStrip = twinHarness.buildPerStoreStrip(
      [fixtureExactObservation()],
      (platform) => platform,
    );
    expect(okStrip[0]?.status).toBe("ok");
    if (okStrip[0]?.status === "ok") {
      expect(okStrip[0].count).toBe(3);
    }

    // An observation with NO error payload preserves UNKNOWN as unknown
    // (INV-10 — never collapsed into a fake error code).
    const unknownStrip = twinHarness.buildPerStoreStrip(
      [observationFor("unknown", false)],
      (platform) => platform,
    );
    const unknownEntry = unknownStrip[0];
    if (unknownEntry?.status === "ok") {
      throw new Error("an unknown-outcome observation must not render as ok");
    }
    expect(unknownEntry.error).toBe("unknown");
    expect(unknownEntry.message).toContain("preserved as unknown");
  });
});

// ============================================================
// 5. NO formatModelContent on the tool entry (the F4-P5-fix law)
// ============================================================

describe("find_best_offer — the F4-P5-fix law (the JSON face feeds model + transcript)", () => {
  it("the ToolEntry does NOT define formatModelContent (the starvation class is structurally impossible)", () => {
    expect(findBestOfferToolEntry.formatModelContent).toBeUndefined();
  });

  it("the model face is the PARSEABLE §-contract JSON (results + opportunities + per_store ride along)", async () => {
    fixtureDataDir();
    const output = await invokeTool({ query: "yeezy shoes" });
    const modelFace = stringifyOutputForModel(output, findBestOfferToolEntry);
    expect(typeof modelFace).toBe("string");
    const parsed = JSON.parse(modelFace) as FindBestOfferToolOutput;
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(Array.isArray(parsed.opportunities)).toBe(true);
    expect(Array.isArray(parsed.per_store)).toBe(true);
    expect(parsed.opportunities).toHaveLength(8);
  });
});
