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
import type { CapabilityObservation, GovernedExecution, StepExecutor } from "./execution.js";
import { assertReadOnlyAuthority } from "./execution.js";
import type { CommerceIntentEnvelope, HarnessMoney } from "./intent.js";
import { formatHarnessMoney, parseMoneyToCents } from "./intent.js";
import type { CapabilityPlan, CapabilityPlanStep, ConnectedStoreTarget } from "./plan.js";
import type {
  ConstraintName,
  ConstraintSatisfactionEntry,
  PlanEvaluation,
  PredictedTotals,
  StepFeasibility,
} from "./evaluation.js";
import { evaluateCounterfactualFamilies, type HarnessOpportunityCandidate } from "./families.js";
import type {
  BenchmarkDenominators,
  LandedTotalBreakdown,
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
  searchableRecords: StoreConnectionRecord[];
  excludedRecords: StoreConnectionRecord[];
  webRecords: StoreConnectionRecord[];
}

/** Build the plan: one exact step + (when broadenable) one substitutes step per searchable store. */
export function buildCapabilityPlan(
  intent: CommerceIntentEnvelope,
  records: StoreConnectionRecord[],
  now: Date,
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

  const broadened = broadenQuery(intent.query);
  const steps: CapabilityPlanStep[] = [];
  let index = 0;
  for (const record of searchableRecords) {
    const target = projectStoreTarget(record);
    index += 1;
    steps.push({
      id: `step-${index}`,
      target,
      operation: "store_search",
      transport: "api",
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
        transport: "api",
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

// ——— constraint evaluation (HARD CONSTRAINTS FIRST; INV-10 everywhere) ———

/** Project a finding's numeric platform price to exact money (projection once; then BigInt cents only). */
function findingSubtotal(finding: {
  price: number | null;
  currency: string | null;
}): HarnessMoney | null {
  if (finding.price === null || finding.currency === null) return null;
  const amount = finding.price.toFixed(2);
  return parseMoneyToCents(amount) === null ? null : { amount, currency: finding.currency };
}

function titleCarries(title: string, value: string): boolean {
  const needle = value.trim().toLowerCase();
  return needle.length >= 2 && title.toLowerCase().includes(needle);
}

/** Per-offer constraint statuses for the EXPRESSED constraints only (absent = UNKNOWN, never evaluated as a guess). */
function offerConstraints(
  intent: CommerceIntentEnvelope,
  finding: { title: string; price: number | null; currency: string | null },
): { constraint: ConstraintName; status: "satisfied" | "unknown" | "violated"; detail: string }[] {
  const out: { constraint: ConstraintName; status: "satisfied" | "unknown" | "violated"; detail: string }[] = [];
  const budget = intent.maxLandedTotalCost;
  if (budget !== undefined) {
    const budgetCents = parseMoneyToCents(budget.amount);
    const subtotal = findingSubtotal(finding);
    if (subtotal === null || budgetCents === null) {
      out.push({
        constraint: "budget",
        status: "unknown",
        detail:
          "No observable price basis (the platform stated no price, or the budget amount is unparseable) — the budget fit is UNKNOWN, never guessed.",
      });
    } else if (subtotal.currency !== budget.currency) {
      out.push({
        constraint: "budget",
        status: "unknown",
        detail: `Currency mismatch — observed subtotal in ${subtotal.currency}, budget in ${budget.currency}. The harness invents no exchange rate; the fit is UNKNOWN.`,
      });
    } else {
      const subtotalCents = parseMoneyToCents(subtotal.amount);
      if (subtotalCents !== null && subtotalCents > budgetCents) {
        out.push({
          constraint: "budget",
          status: "violated",
          detail: `Observed subtotal ${formatHarnessMoney(subtotal)} exceeds the budget ${formatHarnessMoney(budget)} on the subtotal alone (shipping/tax/duties would only add).`,
        });
      } else {
        out.push({
          constraint: "budget",
          status: "unknown",
          detail: `Observed subtotal ${formatHarnessMoney(subtotal)} is within the budget ${formatHarnessMoney(budget)}, but shipping/tax/duties are unobserved — the landed total is UNKNOWN.`,
        });
      }
    }
  }
  if (intent.size !== undefined) {
    out.push(
      titleCarries(finding.title, intent.size)
        ? {
            constraint: "size",
            status: "satisfied",
            detail: `The finding's title carries "${intent.size}" (title-text evidence).`,
          }
        : {
            constraint: "size",
            status: "unknown",
            detail: `The public-catalog finding exposes no variant availability — "${intent.size}" is unconfirmed (not refuted); confirm on the product page.`,
          },
    );
  }
  if (intent.brand !== undefined) {
    out.push(
      titleCarries(finding.title, intent.brand)
        ? {
            constraint: "brand",
            status: "satisfied",
            detail: `The finding's title carries "${intent.brand}" (title-text evidence).`,
          }
        : {
            constraint: "brand",
            status: "unknown",
            detail: `The finding carries no brand field and the title doesn't mention "${intent.brand}" — the brand is unconfirmed, not refuted.`,
          },
    );
  }
  if (intent.condition !== undefined) {
    out.push({
      constraint: "condition",
      status: "unknown",
      detail: `The public catalog states no condition field — "${intent.condition}" is unconfirmed (retail listings are typically new, but the harness does not assume).`,
    });
  }
  if (intent.deadline !== undefined) {
    out.push({
      constraint: "deadline",
      status: "unknown",
      detail: `Delivery timing is unobserved (no shipping capability is connected) — arrival by ${intent.deadline} is UNKNOWN.`,
    });
  }
  return out;
}

function landedTotalFor(subtotal: HarnessMoney | null): LandedTotalBreakdown {
  return {
    subtotal,
    shipping: null,
    tax: null,
    duties: null,
    total: null,
    unknowns:
      subtotal === null
        ? ["subtotal", "shipping", "tax", "duties"]
        : ["shipping", "tax", "duties"],
  };
}

/**
 * Build the shortlist from the EXACT-query observations: HARD CONSTRAINTS
 * FIRST — an offer with any VIOLATED constraint is excluded (with the
 * violation recorded in the intent-level satisfaction); UNKNOWN constraints
 * keep the offer IN, marked unknown (INV-10). Rank: confirmed-first
 * (satisfied DESC, unknown ASC), then cheapest same-currency subtotal,
 * then observation order.
 */
export function buildShortlist(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
): ShortlistOffer[] {
  const offers: ShortlistOffer[] = [];
  for (const observation of exactObservations) {
    if (observation.outcome !== "ok") continue;
    for (const finding of observation.findings ?? []) {
      const constraints = offerConstraints(intent, finding);
      if (constraints.some((entry) => entry.status === "violated")) continue;
      const subtotal = findingSubtotal(finding);
      offers.push({
        rank: 0,
        platform: finding.platform,
        store: finding.store,
        store_domain: finding.store_domain,
        title: finding.title,
        price: finding.price,
        currency: finding.currency,
        url: finding.url,
        image_url: finding.image_url,
        published_at: finding.published_at,
        ...(finding.truncated === true ? { truncated: true } : {}),
        landedTotal: landedTotalFor(subtotal),
        constraints,
      });
    }
  }

  offers.sort((a, b) => {
    const aSatisfied = a.constraints.filter((entry) => entry.status === "satisfied").length;
    const bSatisfied = b.constraints.filter((entry) => entry.status === "satisfied").length;
    if (aSatisfied !== bSatisfied) return bSatisfied - aSatisfied;
    const aUnknown = a.constraints.filter((entry) => entry.status === "unknown").length;
    const bUnknown = b.constraints.filter((entry) => entry.status === "unknown").length;
    if (aUnknown !== bUnknown) return aUnknown - bUnknown;
    const budget = intent.maxLandedTotalCost;
    if (budget !== undefined) {
      const aCents =
        a.landedTotal.subtotal !== null && a.landedTotal.subtotal.currency === budget.currency
          ? parseMoneyToCents(a.landedTotal.subtotal.amount)
          : null;
      const bCents =
        b.landedTotal.subtotal !== null && b.landedTotal.subtotal.currency === budget.currency
          ? parseMoneyToCents(b.landedTotal.subtotal.amount)
          : null;
      if (aCents !== null && bCents !== null && aCents !== bCents) return aCents < bCents ? -1 : 1;
    }
    return 0;
  });
  offers.forEach((offer, index) => {
    offer.rank = index + 1;
  });
  return offers;
}

/** Intent-level constraint satisfaction — the FIRST violated constraint is the binding one (the renderer's empty state). */
export function evaluateIntentConstraints(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
  shortlist: ShortlistOffer[],
): ConstraintSatisfactionEntry[] {
  const entries: ConstraintSatisfactionEntry[] = [];
  const budget = intent.maxLandedTotalCost;
  if (budget !== undefined) {
    const budgetCents = parseMoneyToCents(budget.amount);
    let sameCurrency = 0;
    let overBudget = 0;
    let cheapest: HarnessMoney | null = null;
    let cheapestCents: bigint | null = null;
    let priced = 0;
    let mismatched = 0;
    for (const observation of exactObservations) {
      if (observation.outcome !== "ok") continue;
      for (const finding of observation.findings ?? []) {
        const subtotal = findingSubtotal(finding);
        if (subtotal === null) continue;
        priced += 1;
        if (subtotal.currency !== budget.currency) {
          mismatched += 1;
          continue;
        }
        sameCurrency += 1;
        const cents = parseMoneyToCents(subtotal.amount);
        if (cents === null || budgetCents === null) continue;
        if (cents > budgetCents) overBudget += 1;
        if (cheapestCents === null || cents < cheapestCents) {
          cheapestCents = cents;
          cheapest = subtotal;
        }
      }
    }
    if (priced === 0) {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail: "No priced offer was observed — the budget fit is UNKNOWN.",
      });
    } else if (sameCurrency === 0) {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail: `Every observed price is in a currency other than ${budget.currency} — the harness invents no exchange rate; the budget fit is UNKNOWN.`,
      });
    } else if (overBudget === sameCurrency) {
      entries.push({
        constraint: "budget",
        status: "violated",
        detail: `Every same-currency observed subtotal exceeds ${formatHarnessMoney(budget)} — cheapest observed: ${cheapest === null ? "unknown" : formatHarnessMoney(cheapest)}. The budget is the binding constraint.`,
      });
    } else {
      entries.push({
        constraint: "budget",
        status: "unknown",
        detail: `At least one observed subtotal is within ${formatHarnessMoney(budget)} on the subtotal, but shipping/tax/duties are unobserved on every offer — the landed-total fit is UNKNOWN.`,
      });
    }
  }
  const rollup = (name: ConstraintName, label: string): ConstraintSatisfactionEntry => {
    const shortlistEntry = shortlist.some((offer) =>
      offer.constraints.some((entry) => entry.constraint === name && entry.status === "satisfied"),
    );
    if (shortlistEntry) {
      return {
        constraint: name,
        status: "satisfied",
        detail: `At least one shortlisted offer's title carries the ${label} evidence — see the offer's constraint line.`,
      };
    }
    return {
      constraint: name,
      status: "unknown",
      detail: `The connected public-catalog capability cannot confirm the ${label} constraint on any offer — UNKNOWN, never guessed (see each offer's constraint line).`,
    };
  };
  if (intent.size !== undefined) entries.push(rollup("size", "size"));
  if (intent.brand !== undefined) entries.push(rollup("brand", "brand"));
  if (intent.condition !== undefined) entries.push(rollup("condition", "condition"));
  if (intent.deadline !== undefined) entries.push(rollup("deadline", "deadline"));
  return entries;
}

/** The predicted landed total with uncertainty (never a live quote — INV-16/17/30). */
export function evaluatePredictedTotals(
  intent: CommerceIntentEnvelope,
  exactObservations: CapabilityObservation[],
): PredictedTotals {
  const budget = intent.maxLandedTotalCost ?? null;
  let best: (HarnessMoney & { offerTitle: string }) | null = null;
  let bestCents: bigint | null = null;
  let anyObserved = false;
  let anySameCurrency = false;
  if (budget !== null) {
    for (const observation of exactObservations) {
      if (observation.outcome !== "ok") continue;
      for (const finding of observation.findings ?? []) {
        const subtotal = findingSubtotal(finding);
        if (subtotal === null) continue;
        anyObserved = true;
        if (subtotal.currency !== budget.currency) continue;
        anySameCurrency = true;
        const cents = parseMoneyToCents(subtotal.amount);
        if (cents !== null && (bestCents === null || cents < bestCents)) {
          bestCents = cents;
          best = { ...subtotal, offerTitle: finding.title };
        }
      }
    }
  }
  const unknowns = ["shipping", "tax", "duties"];
  if (budget !== null && anyObserved && !anySameCurrency) {
    unknowns.push("exchange rate (no FX source is connected — none is invented)");
  }
  return {
    budget,
    bestObservedSubtotal: best,
    currencyMatch: budget === null || !anyObserved ? null : anySameCurrency,
    landedTotalKnown: false,
    unknowns,
  };
}

/** The honest per-store strip from the EXACT observations (the store_search per_store contract, verbatim). */
export function buildPerStoreStrip(
  exactObservations: CapabilityObservation[],
  displayPlatform: (platform: string) => string,
): PerStoreEntry[] {
  return exactObservations.map((observation) => {
    const platform = displayPlatform(observation.target.platform);
    if (observation.outcome === "ok") {
      return {
        platform,
        store: observation.target.label,
        count: observation.findings?.length ?? 0,
        status: "ok" as const,
        ...(observation.truncated === true ? { truncated: true } : {}),
      };
    }
    if (observation.error === undefined) {
      return {
        platform,
        store: observation.target.label,
        status: "error" as const,
        error: "unknown",
        message: "The observation carried no error payload — the outcome is preserved as unknown.",
      };
    }
    return {
      platform,
      store: observation.target.label,
      status: observation.error.code === "not_configured" ? ("not_configured" as const) : ("error" as const),
      error: observation.error.code,
      message: observation.error.message,
    };
  });
}

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

  const build = buildCapabilityPlan(input.intent, state.stores, now());
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
