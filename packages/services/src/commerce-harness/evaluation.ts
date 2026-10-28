// ============================================================
// Commerce harness — L3 PlanEvaluation (HARNESS-CONTRACT.md §1, the evaluator half)
// ============================================================
//
// The typed evaluation the L3 evaluator emits: per-step feasibility
// (authority ✓, credential scope ✓, geography/currency ✓, freshness ✓ —
// FROZEN §D's executability law), constraint satisfaction (HARD CONSTRAINTS
// FIRST — INV-9/INV-10: a step the connected account cannot lawfully execute
// is infeasible, not merely expensive), and the predicted landed total with
// uncertainty (a counterfactual price is NEVER a live quote — INV-16/17/30).
//
// UNKNOWN law (INV-10): `unknown` is a first-class status everywhere below —
// a constraint the observations cannot confirm is recorded `unknown`, never
// guessed `satisfied`, never collapsed into `violated`.

import type { HarnessMoney } from "./intent.js";
import type { ConnectedStoreTarget } from "./plan.js";

/** The hard constraints the envelope can carry. */
export type ConstraintName = "budget" | "size" | "brand" | "condition" | "deadline";

/** Satisfied = observed-confirmed. Unknown = unobservable through the connected capability. Violated = observed-refuted. */
export type ConstraintStatus = "satisfied" | "unknown" | "violated";

/** Per-step feasibility (evaluated BEFORE execution, against the connected records). */
export interface StepFeasibility {
  stepId: string;
  target: ConnectedStoreTarget;
  /** False = the step is infeasible (INV-9: not merely expensive — refused). */
  feasible: boolean;
  /** Authority scope ✓ (v1: read-only catalog GETs under read-only-search consent). */
  authorityOk: boolean;
  /** Credential scope ✓ — true for Tier-1 public catalogs (no credentials needed). */
  credentialScopeOk: boolean;
  /**
   * Geography/currency ✓. `unknown` when the intent's currency/geography is
   * absent (INV-10) — never assumed compatible.
   */
  geographyCurrencyOk: boolean | "unknown";
  /**
   * Freshness ✓ — pre-execution there is no observation yet, so this is
   * honestly `unknown` until L4 produces the observation (read-back).
   */
  freshnessOk: "unknown";
  /** The honest reasons (each feasibility verdict says why). */
  reasons: string[];
}

/** One hard constraint's satisfaction status at the INTENT level. */
export interface ConstraintSatisfactionEntry {
  constraint: ConstraintName;
  status: ConstraintStatus;
  detail: string;
}

/**
 * The predicted landed total with uncertainty. `landedTotalKnown` is false in
 * v1 BY CONSTRUCTION: no connected Tier-1 public catalog states shipping, tax,
 * duties or a landed total, and the harness NEVER fabricates an exchange rate
 * or a shipping estimate (INV-14 unknowns-marked-unknown law).
 */
export interface PredictedTotals {
  /** The principal's stated budget (exact money), or null when absent (UNKNOWN). */
  budget: HarnessMoney | null;
  /** The cheapest same-currency observed subtotal, or null (none observed / currency mismatch). */
  bestObservedSubtotal: (HarnessMoney & { offerTitle: string }) | null;
  /**
   * False when the observed subtotals are denominated in a currency other
   * than the budget's — the harness never invents an FX rate. Null when
   * either side is absent (UNKNOWN).
   */
  currencyMatch: boolean | null;
  /** Always false in v1 — no connected capability observes landed totals. */
  landedTotalKnown: false;
  /** What is unknown about the landed total (shipping, tax, duties, FX, …). */
  unknowns: string[];
}

/** The L3 evaluation (per-step feasibility + constraint satisfaction + predicted totals). */
export interface PlanEvaluation {
  feasibility: StepFeasibility[];
  constraintSatisfaction: ConstraintSatisfactionEntry[];
  predictedTotals: PredictedTotals;
}
