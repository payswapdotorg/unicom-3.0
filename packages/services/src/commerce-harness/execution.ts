// ============================================================
// Commerce harness — L4 Governed Execution / Verification (HARNESS-CONTRACT.md §1)
// ============================================================
//
// The GovernedExecution envelope: each plan step executes under its declared
// authority class, and produces a fresh CapabilityObservation (the canonical
// observation chain — INV-8, INV-29) carrying the delivered store_search
// outcome taxonomy VERBATIM:
//
//   ok | timeout | unreachable | invalid_credentials | insufficient_scope |
//   rate_limited | platform_error | not_configured | not_supported
//
// …plus UNKNOWN preserved as its own outcome (INV-10) — UNKNOWN is distinct
// from FAILED and from SUCCESS everywhere in this module.
//
// THE v1 SAFETY LAW (issue #23; the work order's hard law): v1 writes nothing
// to any store, sends no messages, takes no consequential action. The
// read-only authority gate below throws BEFORE any network call for any step
// whose authorityClass is not `read-only` — the executor port is never even
// invoked for such a step.

import type { CapabilityOperation, CapabilityPlanStep, ConnectedStoreTarget } from "./plan.js";

/** The delivered store_search outcome taxonomy, VERBATIM, plus UNKNOWN (INV-10). */
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

/** The failure subset of the taxonomy (never `ok`, never `unknown`). */
export type CapabilityFailureCode = Exclude<CapabilityOutcomeCode, "ok" | "unknown">;

/**
 * One observed finding — the committed store_search finding fields, verbatim
 * (REPORT.md §4): price/currency null = UNKNOWN (the platform stated none),
 * never fabricated.
 */
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

/** A fresh observation produced by one governed plan step (INV-8, INV-29). */
export interface CapabilityObservation {
  stepId: string;
  target: ConnectedStoreTarget;
  operation: CapabilityOperation;
  /** The taxonomy verdict, verbatim. `unknown` is preserved (INV-10). */
  outcome: CapabilityOutcomeCode;
  observedAt: string;
  /** Present on ok: the observed findings. */
  findings?: ObservedFinding[];
  /** Present on ok: the honest pagination-cap note (the store cap applied). */
  truncated?: boolean;
  /** Present on failure: the honest error (taxonomy code verbatim + message). */
  error?: { code: CapabilityFailureCode; message: string };
}

/** Thrown by the authority gate BEFORE any network call. A harness defect, not a statistic. */
export class HarnessAuthorityError extends Error {
  readonly stepId: string;
  readonly authorityClass: string;
  constructor(step: CapabilityPlanStep) {
    super(
      `Harness authority gate: step ${step.id} (${step.operation} on ${step.target.domain}) ` +
        `declares authorityClass "${step.authorityClass}" — v1 permits read-only steps only, ` +
        `so the step was refused BEFORE any network call. Nothing was attempted.`,
    );
    this.name = "HarnessAuthorityError";
    this.stepId = step.id;
    this.authorityClass = step.authorityClass;
  }
}

/**
 * The read-only authority gate (INV-7/8; the v1 safety law). Runs BEFORE the
 * executor port is invoked — a non-read-only step never reaches the network.
 */
export function assertReadOnlyAuthority(step: CapabilityPlanStep): void {
  if (step.authorityClass !== "read-only") {
    throw new HarnessAuthorityError(step);
  }
}

/**
 * The step-executor port. The harness module stays pure: the CALLER binds
 * this to real transport (the committed store_search connectors, the way
 * handlers/store-search.ts does) — this module never performs I/O itself.
 */
export type StepExecutor = (step: CapabilityPlanStep) => Promise<CapabilityObservation>;

/**
 * The governed-execution envelope. The benchmark denominators are literal
 * zeros by construction in v1: any non-zero unauthorizedActions is a harness
 * DEFECT (the authority gate throws), never a statistic.
 */
export interface GovernedExecution {
  startedAt: string;
  finishedAt: string;
  observations: CapabilityObservation[];
  unauthorizedActions: 0;
  humanInterventions: 0;
  privacyLeaks: 0;
}

/** The v1 execution trace's honest fingerprint — all zeros, by construction. */
export const GOVERNED_EXECUTION_BASELINE = {
  unauthorizedActions: 0,
  humanInterventions: 0,
  privacyLeaks: 0,
} as const;
