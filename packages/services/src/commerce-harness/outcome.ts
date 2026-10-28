// ============================================================
// Commerce harness — L5 Measured Outcome (HARNESS-CONTRACT.md §1)
// ============================================================
//
// The typed OutcomeRecord the L5 layer emits: did the intent succeed (hard
// constraints all met?); the sourced shortlist with per-offer landed-total
// breakdown (exact money — INV-14, single stated currency, unknowns marked
// unknown); the opportunity set with evidence classes; and the benchmark
// denominators (R7's benchmark is the claim's arbiter).
//
// LAWS:
//   - A simulated lower price is a CONDITIONAL opportunity, never a live
//     quote (INV-16/17/30) — the shortlist (observed offers) and the
//     opportunity set (counterfactuals) never mix.
//   - UNKNOWN ≠ FAILED ≠ SUCCESS (INV-10): a null subtotal is an unknown
//     price; an unknown landed-total component stays null + listed in
//     `unknowns` — never zero, never estimated.
//   - Hard constraints FIRST: the shortlist excludes only VIOLATED
//     constraints; UNKNOWN constraints keep the offer IN, marked unknown.

import type { HarnessOpportunityCandidate } from "./families.js";
import type { CapabilityObservation } from "./execution.js";
import type { HarnessMoney } from "./intent.js";
import type { CapabilityPlan, CapabilityPlanStep } from "./plan.js";
import type { PlanEvaluation } from "./evaluation.js";
import type { ConstraintName, ConstraintStatus } from "./evaluation.js";

/**
 * The landed-total breakdown — exact money, unknowns marked. `total` is null
 * whenever any component is unobserved: the harness never sums an observed
 * subtotal with an unknown shipping cost into a fake "total".
 */
export interface LandedTotalBreakdown {
  /** The observed listed price, projected once to exact money. Null = unknown. */
  subtotal: HarnessMoney | null;
  /** Unobserved in v1 (no shipping capability connected). Null = unknown. */
  shipping: HarnessMoney | null;
  /** Unobserved in v1. Null = unknown. */
  tax: HarnessMoney | null;
  /** Unobserved in v1. Null = unknown. */
  duties: HarnessMoney | null;
  /** Null = unknown (never a fabricated sum of unknowns). */
  total: HarnessMoney | null;
  /** What is unknown about this offer's landed total. */
  unknowns: string[];
}

/** One shortlisted offer: the store_search finding fields + the harness layers. */
export interface ShortlistOffer {
  /** Hard-constraint-first rank (1 = first). Violated offers are excluded, never ranked. */
  rank: number;
  // — the store_search finding fields, verbatim (REPORT.md §4) —
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
  // — the harness layers —
  landedTotal: LandedTotalBreakdown;
  /** Per expressed hard constraint: satisfied | unknown | violated (only expressed constraints appear). */
  constraints: { constraint: ConstraintName; status: ConstraintStatus; detail: string }[];
}

/** The R7 benchmark denominators (issue #23; the L5 law). */
export interface BenchmarkDenominators {
  latencyMs: number;
  /** The governed plan steps executed. */
  toolCalls: number;
  /** v1: zero by construction (the harness asks nothing mid-flow). */
  humanInterventions: 0;
  /** v1: zero by construction (the read-only authority gate throws first — a defect, not a statistic). */
  unauthorizedActions: 0;
  /** v1: zero by construction (only the connected store domains are contacted; nothing else is touched). */
  privacyLeaks: 0;
  /** The money basis every total in this record follows. */
  costCorrectnessBasis: "exact-string-decimals-unknowns-marked";
}

/** The L5 outcome record (extends Experiment/Decision semantics — never a new outcome type). */
export interface OutcomeRecord {
  /**
   * True = a non-empty shortlist with ZERO violated hard constraints
   * (unknowns marked, never counted as met). A false is honest, not a
   * failure: unknowns stay unknown.
   */
  success: boolean;
  plan: CapabilityPlan;
  execution: {
    startedAt: string;
    finishedAt: string;
    observations: CapabilityObservation[];
    unauthorizedActions: 0;
    humanInterventions: 0;
    privacyLeaks: 0;
  };
  evaluation: PlanEvaluation;
  shortlist: ShortlistOffer[];
  opportunities: HarnessOpportunityCandidate[];
  /** The steps the plan carried (the benchmark's toolCalls input). */
  plannedStepCount: number;
  benchmarks: BenchmarkDenominators;
}

/** The honest per-store strip entry (the store_search per_store contract, verbatim). */
export type PerStoreEntry =
  | { platform: string; store: string; count: number; status: "ok"; truncated?: boolean }
  | {
      platform: string;
      store: string;
      status: "error" | "not_configured";
      error: string;
      message: string;
    };

/** Convenience re-export for consumers composing the record from the layers. */
export type { CapabilityPlanStep };
