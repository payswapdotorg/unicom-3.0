// ============================================================
// Commerce harness — L3 CapabilityPlan (HARNESS-CONTRACT.md §1, the planner half)
// ============================================================
//
// The typed plan the L3 planner emits: an ordered set of candidate capability
// invocations, each resolved against a ConnectedCapabilityInstance (a
// connected store record — the proven store_search vertical's records).
//
// LAWS:
//   - Every step carries its authority class (issue #23 W1). v1 plans carry
//     ONLY `read-only` steps — the planner marks anything else infeasible and
//     L4 throws before any network call (see execution.ts).
//   - Catalogue presence never implies executable authority (INV-9): the plan
//     target is the connected record's projection, never a wish.
//   - The target NEVER carries credentials: plans/evaluations/outcomes are
//     rendered to the principal — secrets stay in the vault-side record.

import type { StoreTier } from "../stores/stores.js";
import type { CommerceConsentBasis, HarnessMoney } from "./intent.js";

/** Authority classes (issue #23 W1; the FE3 taxonomy shipped with the P4 tier). */
export type CapabilityAuthorityClass =
  | "read-only"
  | "draft-only"
  | "approval-required"
  | "authorized-write";

/** Transports (HARNESS-CONTRACT §1 L3): how a step reaches its capability. */
export type CapabilityTransport = "api" | "mcp" | "cli" | "browser";

/** The operations v1 knows (the proven store_search vertical). */
export type CapabilityOperation = "store_search";

/**
 * The connected-store projection a plan step targets — the
 * ConnectedCapabilityInstance shape (platform/domain/tier + identity).
 * Deliberately credential-free and status-free: a projection, not the record.
 */
export interface ConnectedStoreTarget {
  id: string;
  platform: string;
  domain: string;
  label: string;
  tier: StoreTier;
}

/** Why a step exists — the exact ask vs the substitutes counterfactual probe. */
export type CapabilityPlanStepPurpose = "exact" | "substitutes";

/** One ordered plan step. */
export interface CapabilityPlanStep {
  id: string;
  target: ConnectedStoreTarget;
  operation: CapabilityOperation;
  transport: CapabilityTransport;
  /** v1: `read-only` only — anything else is infeasible by construction. */
  authorityClass: CapabilityAuthorityClass;
  purpose: CapabilityPlanStepPurpose;
  /** The step's store_search query (the exact ask, or the broadened substitutes probe). */
  query: string;
  /** What the step expects to observe (the honest expectation, not a promise). */
  expectedObservation: string;
  /** Expected cost of the step itself — exact money (read-only public catalog GETs cost nothing). */
  expectedCost: HarnessMoney;
  /** Expected wall-clock latency, milliseconds (the connector law: hard 10s aborts per request). */
  expectedLatencyMs: number;
}

/** The L3 plan: ordered steps under one consent basis. */
export interface CapabilityPlan {
  createdAt: string;
  consentBasis: CommerceConsentBasis;
  steps: CapabilityPlanStep[];
}
