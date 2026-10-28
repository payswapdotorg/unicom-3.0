// ============================================================
// find_best_offer — the L1→L5 harness twin (core side)
// ============================================================
//
// The core-side twin of the canonical pure module
// packages/services/src/commerce-harness/ (HARNESS-CONTRACT.md — the R4
// slice's five layers: L1 Intent → L3 Planner/Evaluator → L4 Governed
// Execution → L5 Measured Outcome). The twin exists because of the layering
// wall documented in the P4 storesService header: @zcode/services cannot
// depend on the CLI core package, and @zcode/core declares no
// @zcode/services dependency (its tsc build is a plain rootDir-bounded
// program) — so the tool cannot import the module across the wall, and the
// module cannot import the committed connectors. This file is the faithful
// port of the module's pure logic (the same laws, the same record shapes,
// the same strings); dispatch/harness-check-r4.mjs proves the twin agreement
// against the module (family set + feasibility + evidence classes).
//
// LAWS (HARNESS-CONTRACT §1/§2, binding this file):
//   - Read-only authority ONLY (INV-7/8): v1 writes nothing, sends nothing,
//     takes no consequential action. assertReadOnlyAuthority throws BEFORE
//     any network call for any non-read-only step.
//   - Money (INV-14): string decimals + explicit currency; arithmetic on
//     BigInt cents only; an unknown landed-total component stays null and is
//     listed in unknowns — never zero, never estimated, never summed.
//   - UNKNOWN ≠ FAILED ≠ SUCCESS (INV-10) everywhere; absent intent
//     constraints are recorded in `unknowns`, never assumed.
//   - Evidence classes (INV-30): counterfactual candidates are `conditional`
//     or `predicted` — NEVER `observed`; a counterfactual price is never a
//     live quote (INV-16/17).
//   - The connected-store records arrive as data (the committed reader is
//     imported by the TOOL file, never re-implemented — this file never
//     reads, writes, or fetches anything).

// ——— exact money (INV-14) ———

export interface HarnessMoney {
  amount: string;
  currency: string;
}

/** Parse a decimal string to BigInt cents — null for anything else (never silent, never rounded). */
export function parseMoneyToCents(amount: string): bigint | null {
  if (!/^\d+(\.\d{1,2})?$/u.test(amount)) return null;
  const [wholeMaybe, fraction = ""] = amount.split(".");
  const whole = wholeMaybe ?? "0";
  const padded = (fraction + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(padded);
}

/** Format exact money for display: "HKD 400.00" (locale-neutral). */
export function formatHarnessMoney(money: HarnessMoney): string {
  const cents = parseMoneyToCents(money.amount);
  if (cents === null) return `${money.currency} ${money.amount}`;
  const absolute = cents < 0n ? -cents : cents;
  return `${money.currency} ${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

// ——— L1: the intent envelope ———

export type IntentUnknownField =
  | "maxLandedTotalCost"
  | "size"
  | "brand"
  | "condition"
  | "geography"
  | "deadline"
  | "excludedStores";

export interface CommerceIntentEnvelope {
  query: string;
  maxLandedTotalCost?: HarnessMoney;
  size?: string;
  brand?: string;
  condition?: string;
  geography?: string;
  deadline?: string;
  excludedStores?: string[];
  consentBasis: "read-only-search";
  provenance: { surface: string; expressedAt: string };
  unknowns: IntentUnknownField[];
}

// ——— L3: the plan ———

export type StoreTierValue = "public" | "credential" | "web";

export interface ConnectedStoreTarget {
  id: string;
  platform: string;
  domain: string;
  label: string;
  tier: StoreTierValue;
}

export interface CapabilityPlanStep {
  id: string;
  target: ConnectedStoreTarget;
  operation: "store_search";
  transport: "api";
  authorityClass: "read-only" | "draft-only" | "approval-required" | "authorized-write";
  purpose: "exact" | "substitutes";
  query: string;
  expectedObservation: string;
  expectedCost: HarnessMoney;
  expectedLatencyMs: number;
}

export interface CapabilityPlan {
  createdAt: string;
  consentBasis: "read-only-search";
  steps: CapabilityPlanStep[];
}

// ——— L4: observations + the authority gate ———

export type CapabilityOutcomeCode =
  | "ok"
  | "timeout"
  | "unreachable"
  | "invalid_credentials"
  | "insufficient_scope"
  | "rate_limited"
  | "platform_error"
  | "not_configured"
  | "not_supported"
  | "unknown";

export interface ObservedFinding {
  platform: string;
  store: string;
  store_domain: string;
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  truncated?: boolean;
}

export interface CapabilityObservation {
  stepId: string;
  target: ConnectedStoreTarget;
  operation: "store_search";
  outcome: CapabilityOutcomeCode;
  observedAt: string;
  findings?: ObservedFinding[];
  truncated?: boolean;
  error?: { code: Exclude<CapabilityOutcomeCode, "ok" | "unknown">; message: string };
}

/** Thrown BEFORE any network call — a harness defect, not a statistic. */
export class HarnessAuthorityError extends Error {
  constructor(step: CapabilityPlanStep) {
    super(
      `Harness authority gate: step ${step.id} (${step.operation} on ${step.target.domain}) ` +
        `declares authorityClass "${step.authorityClass}" — v1 permits read-only steps only, ` +
        `so the step was refused BEFORE any network call. Nothing was attempted.`,
    );
    this.name = "HarnessAuthorityError";
  }
}

export function assertReadOnlyAuthority(step: CapabilityPlanStep): void {
  if (step.authorityClass !== "read-only") throw new HarnessAuthorityError(step);
}

// ——— L3: evaluation ———

export type ConstraintName = "budget" | "size" | "brand" | "condition" | "deadline";
export type ConstraintStatus = "satisfied" | "unknown" | "violated";

export interface StepFeasibility {
  stepId: string;
  target: ConnectedStoreTarget;
  feasible: boolean;
  authorityOk: boolean;
  credentialScopeOk: boolean;
  geographyCurrencyOk: boolean | "unknown";
  freshnessOk: "unknown";
  reasons: string[];
}

export interface ConstraintSatisfactionEntry {
  constraint: ConstraintName;
  status: ConstraintStatus;
  detail: string;
}

export interface PredictedTotals {
  budget: HarnessMoney | null;
  bestObservedSubtotal: (HarnessMoney & { offerTitle: string }) | null;
  currencyMatch: boolean | null;
  landedTotalKnown: false;
  unknowns: string[];
}

export interface PlanEvaluation {
  feasibility: StepFeasibility[];
  constraintSatisfaction: ConstraintSatisfactionEntry[];
  predictedTotals: PredictedTotals;
}

// ——— L5: the shortlist + the per-store strip ———

export interface LandedTotalBreakdown {
  subtotal: HarnessMoney | null;
  shipping: HarnessMoney | null;
  tax: HarnessMoney | null;
  duties: HarnessMoney | null;
  total: HarnessMoney | null;
  unknowns: string[];
}

export interface OfferConstraintEntry {
  constraint: ConstraintName;
  status: ConstraintStatus;
  detail: string;
}

export interface ShortlistOffer {
  rank: number;
  platform: string;
  store: string;
  store_domain: string;
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  truncated?: boolean;
  landedTotal: LandedTotalBreakdown;
  constraints: OfferConstraintEntry[];
}

export type PerStoreEntry =
  | { platform: string; store: string; count: number; status: "ok"; truncated?: boolean }
  | { platform: string; store: string; status: "error" | "not_configured"; error: string; message: string };

// ——— L3: plan building (the committed reader's records arrive as data) ———

/** The committed reader's record shape, as the twin sees it (never the credentials — they stay in the executor's closure). */
export interface HarnessStoreRecord {
  id: string;
  platform: string;
  domain: string;
  label: string;
  tier: StoreTierValue;
  status?: string;
}

const DISCONNECTED_STATUSES = new Set(["disconnected", "revoked", "removed"]);

/** The committed reader's isSearchableStore law (mirrored — see the module header for the wall). */
export function isSearchableHarnessStore(record: HarnessStoreRecord): boolean {
  return record.tier !== "web" && !DISCONNECTED_STATUSES.has(record.status ?? "");
}

export function projectStoreTarget(record: HarnessStoreRecord): ConnectedStoreTarget {
  return { id: record.id, platform: record.platform, domain: record.domain, label: record.label, tier: record.tier };
}

function isExcludedStore(record: HarnessStoreRecord, excluded: string[] | undefined): boolean {
  if (excluded === undefined || excluded.length === 0) return false;
  const label = record.label.trim().toLowerCase();
  const domain = record.domain.trim().toLowerCase();
  return excluded.some((entry) => {
    const needle = entry.trim().toLowerCase();
    return needle.length > 0 && (needle === label || needle === domain);
  });
}

/** Drop the leading (usually most specific) token: "yeezy shoes" → "shoes". Null when single-token. */
export function broadenQuery(query: string): string | null {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return null;
  return tokens.slice(1).join(" ");
}

export interface PlanBuildResult {
  plan: CapabilityPlan;
  searchableRecords: HarnessStoreRecord[];
  excludedRecords: HarnessStoreRecord[];
  webRecords: HarnessStoreRecord[];
}

export function buildCapabilityPlan(
  intent: CommerceIntentEnvelope,
  records: HarnessStoreRecord[],
  now: Date,
): PlanBuildResult {
  const searchableRecords: HarnessStoreRecord[] = [];
  const excludedRecords: HarnessStoreRecord[] = [];
  const webRecords: HarnessStoreRecord[] = [];
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

function findingSubtotal(finding: { price: number | null; currency: string | null }): HarnessMoney | null {
  if (finding.price === null || finding.currency === null) return null;
  const amount = finding.price.toFixed(2);
  return parseMoneyToCents(amount) === null ? null : { amount, currency: finding.currency };
}

function titleCarries(title: string, value: string): boolean {
  const needle = value.trim().toLowerCase();
  return needle.length >= 2 && title.toLowerCase().includes(needle);
}

function offerConstraints(
  intent: CommerceIntentEnvelope,
  finding: { title: string; price: number | null; currency: string | null },
): OfferConstraintEntry[] {
  const out: OfferConstraintEntry[] = [];
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
        ? { constraint: "size", status: "satisfied", detail: `The finding's title carries "${intent.size}" (title-text evidence).` }
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
        ? { constraint: "brand", status: "satisfied", detail: `The finding's title carries "${intent.brand}" (title-text evidence).` }
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

/**
 * The shortlist from the EXACT observations: an offer with any VIOLATED
 * constraint is excluded; UNKNOWN constraints keep the offer IN, marked
 * unknown (INV-10). Rank: confirmed-first (satisfied DESC, unknown ASC),
 * then cheapest same-currency subtotal, then observation order.
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
        landedTotal: {
          subtotal,
          shipping: null,
          tax: null,
          duties: null,
          total: null,
          unknowns: subtotal === null ? ["subtotal", "shipping", "tax", "duties"] : ["shipping", "tax", "duties"],
        },
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
      const centsOf = (offer: ShortlistOffer): bigint | null =>
        offer.landedTotal.subtotal !== null && offer.landedTotal.subtotal.currency === budget.currency
          ? parseMoneyToCents(offer.landedTotal.subtotal.amount)
          : null;
      const aCents = centsOf(a);
      const bCents = centsOf(b);
      if (aCents !== null && bCents !== null && aCents !== bCents) return aCents < bCents ? -1 : 1;
    }
    return 0;
  });
  offers.forEach((offer, index) => {
    offer.rank = index + 1;
  });
  return offers;
}

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
    for (const observation of exactObservations) {
      if (observation.outcome !== "ok") continue;
      for (const finding of observation.findings ?? []) {
        const subtotal = findingSubtotal(finding);
        if (subtotal === null) continue;
        priced += 1;
        if (subtotal.currency !== budget.currency) continue;
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
      entries.push({ constraint: "budget", status: "unknown", detail: "No priced offer was observed — the budget fit is UNKNOWN." });
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
  const rollup = (name: ConstraintName, label: string): ConstraintSatisfactionEntry =>
    shortlist.some((offer) => offer.constraints.some((entry) => entry.constraint === name && entry.status === "satisfied"))
      ? {
          constraint: name,
          status: "satisfied",
          detail: `At least one shortlisted offer's title carries the ${label} evidence — see the offer's constraint line.`,
        }
      : {
          constraint: name,
          status: "unknown",
          detail: `The connected public-catalog capability cannot confirm the ${label} constraint on any offer — UNKNOWN, never guessed (see each offer's constraint line).`,
        };
  if (intent.size !== undefined) entries.push(rollup("size", "size"));
  if (intent.brand !== undefined) entries.push(rollup("brand", "brand"));
  if (intent.condition !== undefined) entries.push(rollup("condition", "condition"));
  if (intent.deadline !== undefined) entries.push(rollup("deadline", "deadline"));
  return entries;
}

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
