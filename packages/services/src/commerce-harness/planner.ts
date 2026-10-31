// ============================================================
// Commerce harness — L3 composition (the planner/evaluator orchestrator)
// ============================================================
//
// The pure L3→L5 composition: reads nothing, writes nothing, fetches nothing.
// Everything arrives as input — the connected-store records (via the
// reader port, whose signature is the COMMITTED reader's), the injected
// step executor (the caller binds it to the committed store_search
// connectors the way handlers/store-search.ts does), and a clock.
//
// READER LAW (the work order): the planner reads the connected stores via
// the COMMITTED reader — never a re-implementation. This module cannot
// import it across the layering wall (@zcode/services cannot depend on the
// CLI core package — the documented P4 law, storesService.ts header), so
// the reader is a PORT here: `ReadConnectedStoreRecords`, whose signature
// is the committed reader's (readConnectedStores). The tool-side twin
// binds the real committed reader; services-side lanes bind theirs. ZERO
// reading logic lives in this module — the wall is honored, not worked
// around.
//
// FLOW (HARNESS-CONTRACT §1): L3 buildCapabilityPlan → L4 governed
// execution (assertReadOnlyAuthority BEFORE each executeStep — a
// non-read-only step never reaches the network) → L3 evaluatePlanFeasibility
// (pre-execution) + constraint satisfaction + predicted totals over the
// observations → L5 buildOutcomeRecord (+ the counterfactual families from
// families.ts).

import type { StoreConnectionRecord } from "../stores/stores.js";
import type { GovernedExecution, StepExecutor } from "./execution.js";
import { assertReadOnlyAuthority } from "./execution.js";
import type { CommerceIntentEnvelope } from "./intent.js";
import type { CapabilityPlan, CapabilityPlanStep, ConnectedStoreTarget } from "./plan.js";
import type { PlanEvaluation, StepFeasibility } from "./evaluation.js";
import { evaluateCounterfactualFamilies, type HarnessOpportunityCandidate } from "./families.js";
import {
  selectTransportForOperation,
  storeSearchApiOnlyDiscovery,
  type TransportSelection,
} from "./transport-selector.js";
import type {
  BenchmarkDenominators,
  OutcomeRecord,
  PerStoreEntry,
  ShortlistOffer,
} from "./outcome.js";

// ——— the reader port (the COMMITTED reader's signature — never re-implemented) ———

/** The connected-stores read result — byte-compatible with the committed reader's ConnectedStoresState. */
export interface ConnectedStoreRecords {
  stores: StoreConnectionRecord[];
  readError?: string;
}

/**
 * The committed reader, as a port: readConnectedStores()'s exact signature.
 * The caller binds the REAL reader (the tool binds
 * handlers/store-search/stores.ts's readConnectedStores); this module never
 * implements reading.
 */
export type ReadConnectedStoreRecords = () => Promise<ConnectedStoreRecords>;

/** The searchable-store law, mirrored from the committed reader (stores.ts's
 * isSearchableStore): web-tier records are never searched; disconnected
 * statuses are never searched; unknown statuses stay searchable (defensive —
 * a search attempt is honest). */
const DISCONNECTED_STATUSES = new Set(["disconnected", "revoked", "removed"]);

export function isSearchableHarnessStore(record: StoreConnectionRecord): boolean {
  return record.tier !== "web" && !DISCONNECTED_STATUSES.has(record.status ?? "");
}

/** Project a record to the credential-free plan target (never a leak surface). */
export function projectStoreTarget(record: StoreConnectionRecord): ConnectedStoreTarget {
  return {
    id: record.id,
    platform: record.platform,
    domain: record.domain,
    label: record.label,
    tier: record.tier,
  };
}

/** Does this record match an excludedStores entry (label or domain, case-insensitive)? */
function isExcludedStore(record: StoreConnectionRecord, excluded: string[] | undefined): boolean {
  if (excluded === undefined || excluded.length === 0) return false;
  const label = record.label.trim().toLowerCase();
  const domain = record.domain.trim().toLowerCase();
  return excluded.some(
    (entry) =>
      entry.trim().length > 0 &&
      (entry.trim().toLowerCase() === label || entry.trim().toLowerCase() === domain),
  );
}

/**
 * Derive the broadened substitutes query: drop the leading (usually the most
 * specific — the brand/model) token. "yeezy shoes" → "shoes". Null when the
 * query is a single meaningful token — nothing to broaden, honestly.
 */
export function broadenQuery(query: string): string | null {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return null;
  return tokens.slice(1).join(" ");
}

// ——— L3: the plan ———

export interface PlanBuildResult {
  plan: CapabilityPlan;
  /** W3: the operation-level transport selection record per target — the answerable "why this transport". */
  transportSelections: TransportSelection[];
  searchableRecords: StoreConnectionRecord[];
  excludedRecords: StoreConnectionRecord[];
  webRecords: StoreConnectionRecord[];
}

/**
 * The per-target transport discovery port (W3): the caller binds capability
 * discovery per (operation, target). Default: the committed store_search
 * connector set is API-only (storeSearchApiOnlyDiscovery) — plans built
 * without a port are byte-identical to pre-W3 plans.
 */
export type TransportDiscoveryPort = (
  operation: "store_search",
  target: ConnectedStoreTarget,
) => Parameters<typeof selectTransportForOperation>[0];

/** Build the plan: one exact step + (when broadenable) one substitutes step per searchable store. */
export function buildCapabilityPlan(
  intent: CommerceIntentEnvelope,
  records: StoreConnectionRecord[],
  now: Date,
  options?: { discoverTransport?: TransportDiscoveryPort },
): PlanBuildResult {
  const searchableRecords: StoreConnectionRecord[] = [];
  const excludedRecords: StoreConnectionRecord[] = [];
  const webRecords: StoreConnectionRecord[] = [];
  for (const record of records) {
    if (record.tier === "web") {
      webRecords.push(record);
      continue;
    }
    if (!isSearchableHarnessStore(record)) continue;
    if (isExcludedStore(record, intent.excludedStores)) {
      excludedRecords.push(record);
      continue;
    }
    searchableRecords.push(record);
  }

  const discoverTransport = options?.discoverTransport;
  const broadened = broadenQuery(intent.query);
  const steps: CapabilityPlanStep[] = [];
  const transportSelections: TransportSelection[] = [];
  let index = 0;
  for (const record of searchableRecords) {
    const target = projectStoreTarget(record);
    // W3: operation-level transport selection per (operation, target). Default
    // discovery is API-only — byte-identical to pre-W3 plans. A caller-bound
    // discovery may answer the browser fallback; the selection record is kept
    // on the plan (the answerable "why this transport").
    const selection =
      discoverTransport === undefined
        ? selectTransportForOperation(storeSearchApiOnlyDiscovery())
        : selectTransportForOperation(discoverTransport("store_search", target));
    transportSelections.push(selection);
    const transport: CapabilityPlanStep["transport"] =
      selection.selectedTransport ?? "api";
    index += 1;
    steps.push({
      id: `step-${index}`,
      target,
      operation: "store_search",
      transport,
      authorityClass: "read-only",
      purpose: "exact",
      query: intent.query,
      expectedObservation:
        `The ${record.platform} public catalog at ${record.domain} searched for "${intent.query}" ` +
        "(newest first, per-store cap applied) — findings with observed prices, or an honest taxonomy error.",
      expectedCost: { amount: "0.00", currency: "XXX" },
      expectedLatencyMs: 10_000,
    });
    if (broadened !== null) {
      index += 1;
      steps.push({
        id: `step-${index}`,
        target,
        operation: "store_search",
        transport,
        authorityClass: "read-only",
        purpose: "substitutes",
        query: broadened,
        expectedObservation:
          `The ${record.platform} public catalog at ${record.domain} searched for the broadened substitutes ` +
          `query "${broadened}" (from "${intent.query}") — observed substitute prices for the counterfactual ` +
          "approved-substitutes family, or an honest taxonomy error.",
        expectedCost: { amount: "0.00", currency: "XXX" },
        expectedLatencyMs: 10_000,
      });
    }
  }

  return {
    plan: { createdAt: now.toISOString(), consentBasis: intent.consentBasis, steps },
    transportSelections,
    searchableRecords,
    excludedRecords,
    webRecords,
  };
}

// ——— L3: per-step feasibility (pre-execution, INV-9: infeasible ≠ expensive) ———

export function evaluatePlanFeasibility(plan: CapabilityPlan): StepFeasibility[] {
  return plan.steps.map((step) => {
    const reasons: string[] = [];
    const authorityOk = step.authorityClass === "read-only";
    if (!authorityOk) {
      reasons.push(
        `authority class "${step.authorityClass}" exceeds the v1 read-only consent basis — the step is infeasible, not merely expensive (INV-9)`,
      );
    } else {
      reasons.push("read-only catalog GETs under the read-only-search consent basis");
    }
    const credentialScopeOk = step.target.tier !== "credential";
    if (!credentialScopeOk) {
      reasons.push("credential-tier store without credentials on the record — execution would answer not_configured");
    } else if (step.target.tier === "public") {
      reasons.push("Tier-1 public catalog — no credentials needed");
    }
    return {
      stepId: step.id,
      target: step.target,
      feasible: authorityOk && credentialScopeOk,
      authorityOk,
      credentialScopeOk,
      geographyCurrencyOk: "unknown",
      freshnessOk: "unknown",
      reasons,
    };
  });
}

// ——— the offer-evaluation half (split into offer-evaluation.ts; re-exported) ———

// The constraint-evaluation / shortlist / predicted-totals / per-store-strip
// composition moved to offer-evaluation.ts at the 2026-10-31 W-campaign
// (planner.ts exceeded the 800-line architecture ceiling). The public surface
// is re-exported verbatim — the split is a file-level fact, not an API change.
export {
  buildShortlist,
  evaluateIntentConstraints,
  evaluatePredictedTotals,
  buildPerStoreStrip,
} from "./offer-evaluation.js";
import {
  buildShortlist,
  evaluateIntentConstraints,
  evaluatePredictedTotals,
  buildPerStoreStrip,
} from "./offer-evaluation.js";
// ——— L5: the outcome record ———

export function buildOutcomeRecord(input: {
  plan: CapabilityPlan;
  execution: GovernedExecution;
  evaluation: PlanEvaluation;
  shortlist: ShortlistOffer[];
  opportunities: HarnessOpportunityCandidate[];
  latencyMs: number;
}): OutcomeRecord {
  const { plan, execution, evaluation, shortlist, opportunities, latencyMs } = input;
  const benchmarks: BenchmarkDenominators = {
    latencyMs,
    toolCalls: plan.steps.length,
    humanInterventions: 0,
    unauthorizedActions: 0,
    privacyLeaks: 0,
    costCorrectnessBasis: "exact-string-decimals-unknowns-marked",
  };
  return {
    success: shortlist.length > 0,
    plan,
    execution,
    evaluation,
    shortlist,
    opportunities,
    plannedStepCount: plan.steps.length,
    benchmarks,
  };
}

// ——— the full L1→L5 flow (pure composition over the injected ports) ———

export interface HarnessFlowInput {
  intent: CommerceIntentEnvelope;
  /** The committed reader, bound by the caller (never re-implemented here). */
  readStores: ReadConnectedStoreRecords;
  /** The step executor, bound by the caller (the committed store_search connectors). */
  executeStep: StepExecutor;
  /** Platform display normalization (the caller binds the committed normalizeStorePlatform; default: passthrough). */
  displayPlatform?: (platform: string) => string;
  /** Clock injection (defaults to the real clock). */
  now?: () => Date;
  /**
   * W3: the per-target transport discovery port. Default: API-only discovery
   * (byte-identical to pre-W3 plans). Bind this to route an operation over the
   * browser/computer-use fallback when its API/MCP routes are absent — the
   * authority law is unchanged either way.
   */
  discoverTransport?: TransportDiscoveryPort;
}

export interface HarnessFlowResult {
  plan: CapabilityPlan;
  execution: GovernedExecution;
  evaluation: PlanEvaluation;
  shortlist: ShortlistOffer[];
  opportunities: HarnessOpportunityCandidate[];
  outcome: OutcomeRecord;
  perStore: PerStoreEntry[];
  /** Honest notices (read error, zero stores, web-tier delegation, exclusions) — the store_search notice law. */
  notices: string[];
  /** True when NO connected store was searchable for the plan (the honest empty state). */
  zeroSearchableStores: boolean;
  readError?: string;
}

export async function runHarnessFlow(input: HarnessFlowInput): Promise<HarnessFlowResult> {
  const now = input.now ?? (() => new Date());
  const startedMs = Date.now();

  const state = await input.readStores();
  const notices: string[] = [];
  if (state.readError !== undefined) notices.push(state.readError);

  const build = buildCapabilityPlan(input.intent, state.stores, now(), {
    discoverTransport: input.discoverTransport,
  });
  const feasibility = evaluatePlanFeasibility(build.plan);

  if (state.stores.length === 0) {
    notices.push(
      "No stores are connected yet — open Settings → Connected Stores to add one, or ask me to search the web instead.",
    );
  }
  for (const record of build.webRecords) {
    notices.push(
      `${record.label} (${record.platform}) has no public store API — it is searched via the web instead: use the WebSearch tool for ${record.label} findings.`,
    );
  }
  for (const record of build.excludedRecords) {
    notices.push(`${record.label} (${record.domain}) was excluded by the intent's excludedStores.`);
  }
  const zeroSearchableStores = build.searchableRecords.length === 0;
  if (state.stores.length > 0 && zeroSearchableStores && build.excludedRecords.length === 0) {
    notices.push(`No connected store was searchable for this plan — connected platforms: ${[...new Set(state.stores.map((record) => record.platform))].join(", ")}.`);
  }

  // L4: governed execution — the authority gate runs BEFORE the executor on
  // every step (a non-read-only step never reaches the network), then the
  // steps run in parallel (a store's failure never fails the flow — it lands
  // in its observation honestly).
  const startedAt = now().toISOString();
  const observations = await Promise.all(
    build.plan.steps.map(async (step) => {
      assertReadOnlyAuthority(step);
      return input.executeStep(step);
    }),
  );
  const finishedAt = now().toISOString();
  const execution: GovernedExecution = {
    startedAt,
    finishedAt,
    observations,
    unauthorizedActions: 0,
    humanInterventions: 0,
    privacyLeaks: 0,
  };

  const exactObservations = observations.filter(
    (observation) => build.plan.steps.find((step) => step.id === observation.stepId)?.purpose === "exact",
  );
  const substitutesObservations = observations.filter(
    (observation) => build.plan.steps.find((step) => step.id === observation.stepId)?.purpose === "substitutes",
  );

  const shortlist = buildShortlist(input.intent, exactObservations);
  const constraintSatisfaction = evaluateIntentConstraints(input.intent, exactObservations, shortlist);
  const predictedTotals = evaluatePredictedTotals(input.intent, exactObservations);
  const evaluation: PlanEvaluation = { feasibility, constraintSatisfaction, predictedTotals };

  const opportunities = evaluateCounterfactualFamilies({
    intent: input.intent,
    targets: build.searchableRecords.map(projectStoreTarget),
    exactObservations,
    substitutesObservations,
    observedAt: finishedAt,
  });

  const latencyMs = Math.max(0, Date.now() - startedMs);
  const outcome = buildOutcomeRecord({
    plan: build.plan,
    execution,
    evaluation,
    shortlist,
    opportunities,
    latencyMs,
  });

  const displayPlatform = input.displayPlatform ?? ((platform: string) => platform);
  const perStore = buildPerStoreStrip(exactObservations, displayPlatform);

  return {
    plan: build.plan,
    execution,
    evaluation,
    shortlist,
    opportunities,
    outcome,
    perStore,
    notices,
    zeroSearchableStores,
    ...(state.readError !== undefined ? { readError: state.readError } : {}),
  };
}
