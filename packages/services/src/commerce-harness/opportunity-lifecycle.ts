// ============================================================
// Commerce harness — W2 opportunity lifecycle (HARNESS-CONTRACT.md §1 L3/L5, §2)
// ============================================================
//
// The conditional-opportunity lifecycle law (issue #23 workstream 2): every
// HarnessOpportunityCandidate the L3 evaluator emits becomes an immutable,
// versioned lifecycle record that travels to the L5 measured outcome —
// registered, expired, revoked, realized or abandoned — carrying the full
// issue-#23 provenance: source, observation time, freshness policy, recheck
// policy and revocation history.
//
// LAWS (binding every consumer of this module):
//   - INV-15 (provenance/versioning): transitions COPY — the wrapped
//     candidate is never mutated, every transition bumps `version`, and the
//     deterministic content-derived identity (FNV-1a 32-bit over a canonical
//     JSON serialization defined below) is stable for identical content and
//     distinct for distinct content. No crypto dependency, no randomness.
//   - INV-30 (evidence classes): a lifecycle transition NEVER upgrades the
//     evidence class. verifyFreshnessGate — the issue #23 W2 law — licenses
//     REPRESENTING a conditional opportunity as currently available only
//     behind a fresh independent observation (within
//     OBSERVED_PRICE_FRESHNESS_MS from families.js); the record itself stays
//     conditional/predicted forever, and a revoked/expired record never
//     passes the gate at all.
//   - INV-10 (UNKNOWN preservation): an unparseable expiry, a missing
//     observation, an unparseable observation time, cross-currency totals —
//     all stay UNKNOWN/null. Never guessed, never collapsed into a verdict.
//   - INV-14 (exact money): reconciliation compares realized vs baseline
//     totals on BigInt cents, SAME currency only — anything else classifies
//     "unknown" (the harness never invents an FX rate).
//
// Pure module: no I/O, no network, no wall clock — every function takes an
// injected clock (`now: Date`), so the whole lifecycle is deterministic and
// replayable (R7's benchmark replays it against the fixture corpus).

import type { HarnessMoney } from "./intent.js";
import { compareCents, parseMoneyToCents } from "./intent.js";
import { OBSERVED_PRICE_FRESHNESS_MS } from "./families.js";
import type { HarnessOpportunityCandidate } from "./families.js";

// ——— the closed status set (none silently missing) ———

/** Every lifecycle status a registered opportunity can hold. */
export type OpportunityLifecycleStatus = "active" | "expired" | "revoked" | "realized" | "abandoned";

/** The closed status set — the lifecycle answers every slot. */
export const OPPORTUNITY_LIFECYCLE_STATUSES: readonly OpportunityLifecycleStatus[] = [
  "active",
  "expired",
  "revoked",
  "realized",
  "abandoned",
];

/** The share-consent basis (the issue #23 W2 privacy default: private unless opted in). */
export interface ShareConsent {
  /** "private" (the default — raw intent stays local) | "shared-generalized" (explicit opt-in). */
  basis: "private" | "shared-generalized";
  /** When the principal granted (or withheld) this basis (ISO timestamp). */
  grantedAt: string;
}

/**
 * The consented generalized commerce shape a shared projection may carry
 * (federation.ts projects it onto the wire). Exact money only (INV-14) —
 * and ONLY structured fields: no query text, no identity, ever.
 */
export interface GeneralizedDemandShape {
  /** The single stated currency of the generalized demand. */
  currency: string;
  /** An optional exact price band, same currency throughout. */
  priceBand?: { min: HarnessMoney; max: HarnessMoney };
}

/** One typed lifecycle audit event — every transition emits one. */
export interface OpportunityLifecycleEvent {
  /** ISO timestamp of the transition (the injected clock, never the wall clock). */
  at: string;
  from: OpportunityLifecycleStatus;
  to: OpportunityLifecycleStatus;
  recordId: string;
  reason: string;
}

/** The reconciliation block — feeds R7's true/false-savings denominators. */
export interface OpportunityReconciliation {
  status: "pending" | "reconciled" | "abandoned";
  /** The exact realized total, null = unknown/unobserved. */
  realizedTotal: HarnessMoney | null;
  /** true-savings | false-savings | unknown | null (null = not yet reconciled). */
  classification: "true-savings" | "false-savings" | "unknown" | null;
  reconciledAt: string | null;
}

/** The lifecycle record: an immutable wrapper around the six-part candidate. */
export interface OpportunityLifecycleRecord {
  /** Deterministic content-derived identity (deriveOpportunityIdentity). */
  readonly id: string;
  /** Bumped on every transition (INV-15). Registration is version 1. */
  readonly version: number;
  readonly status: OpportunityLifecycleStatus;
  readonly createdAt: string;
  /** From candidate.evidence.expiresAt — null = no persistence claimed (predictions/refusals). */
  readonly expiresAt: string | null;
  readonly shareConsent: ShareConsent;
  /** The wrapped six-part candidate — COPIED at registration, never mutated afterwards. */
  readonly candidate: HarnessOpportunityCandidate;
  readonly revocation: { revokedAt: string; reason: string } | null;
  /** Every revocation ever applied to this record (the issue #23 history demand). */
  readonly revocationHistory: readonly { revokedAt: string; reason: string }[];
  readonly reconciliation: OpportunityReconciliation;
  /** The issue #23 W2 provenance block: source, observation time, policies. */
  readonly provenance: {
    source: string;
    observedAt: string;
    freshnessPolicy: string;
    recheckPolicy: string;
  };
  /** The consented generalized demand shape (null = none registered — nothing shareable). */
  readonly generalized: GeneralizedDemandShape | null;
}

// ——— the deterministic content hash (FNV-1a 32-bit over canonical JSON) ———

/** FNV-1a offset basis and prime (32-bit) — pure integer math, no crypto. */
const FNV1A_OFFSET_32 = 0x811c9dc5;
const FNV1A_PRIME_32 = 0x01000193;

/**
 * Canonical JSON: objects with RECURSIVELY SORTED keys, arrays in order,
 * `undefined`-valued keys omitted, JSON string escaping. Deterministic for
 * any JSON-able value regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return "null"; // undefined / functions / symbols never hash
}

/** FNV-1a 32-bit, hex, zero-padded to 8 characters. */
function fnv1a32Hex(text: string): string {
  let hash = FNV1A_OFFSET_32;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME_32) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The shared content-hash helper (federation.ts reuses it for envelope
 * contentHash fields): FNV-1a 32-bit over the canonical JSON of the value.
 * Pure, deterministic, collision-tolerant for fixture-scale content.
 */
export function stableContentHash(value: unknown): string {
  return fnv1a32Hex(canonicalJson(value));
}

/** The candidate's canonical projection — the identity covers ALL six parts. */
function canonicalCandidate(candidate: HarnessOpportunityCandidate): Record<string, unknown> {
  return {
    family: candidate.family,
    title: candidate.title,
    feasibility: candidate.feasibility,
    reason: candidate.reason,
    evidenceClass: candidate.evidenceClass,
    observedFacts: candidate.observedFacts,
    changedAssumptions: candidate.changedAssumptions,
    predictedOutcome: candidate.predictedOutcome,
    preconditions: [...candidate.preconditions],
    evidence: {
      source: candidate.evidence.source,
      observedAt: candidate.evidence.observedAt,
      freshness: candidate.evidence.freshness,
      expiresAt: candidate.evidence.expiresAt,
    },
    consentRequired: candidate.consentRequired,
    authorityRequired: candidate.authorityRequired,
  };
}

/**
 * The deterministic content-derived identity: `opp_` + FNV-1a over the
 * canonical JSON of the six-part candidate. Identical content → identical
 * id; any differing part → (for fixture-scale content) a different id.
 */
export function deriveOpportunityIdentity(candidate: HarnessOpportunityCandidate): string {
  return `opp_${stableContentHash(canonicalCandidate(candidate))}`;
}

// ——— registration ———

/** Copy the candidate (two levels) so the record is detached from the caller's object. */
function cloneCandidate(candidate: HarnessOpportunityCandidate): HarnessOpportunityCandidate {
  return {
    ...candidate,
    preconditions: [...candidate.preconditions],
    evidence: { ...candidate.evidence },
  };
}

/** Copy the generalized shape so later caller mutation never reaches the record. */
function cloneGeneralized(generalized: GeneralizedDemandShape): GeneralizedDemandShape {
  return {
    currency: generalized.currency,
    ...(generalized.priceBand === undefined
      ? {}
      : {
          priceBand: {
            min: { ...generalized.priceBand.min },
            max: { ...generalized.priceBand.max },
          },
        }),
  };
}

function freshnessPolicyFor(freshness: HarnessOpportunityCandidate["evidence"]["freshness"]): string {
  if (freshness === "live-observed") {
    return `live-observed prices must be re-observed within ${OBSERVED_PRICE_FRESHNESS_MS}ms (the observed-price freshness window) before representing as currently available`;
  }
  if (freshness === "capability-inspection") {
    return "capability-inspection evidence — never represented as currently available without a fresh independent observation";
  }
  return "prediction evidence — never represented as currently available; predictions do not expire, they are re-evaluated";
}

const RECHECK_POLICY_TEXT =
  `verifyFreshnessGate: a fresh independent observation (observedAt within ${OBSERVED_PRICE_FRESHNESS_MS}ms of now) ` +
  "is required before a conditional opportunity may be represented as currently available (issue #23 W2 law)";

/**
 * Register a candidate: status active, version 1, expiry derived from
 * candidate.evidence.expiresAt, reconciliation pending, provenance carried.
 * The optional generalized shape is the ONLY money the record ever carries —
 * money is never parsed out of the candidate's free text (INV-14).
 */
export function registerOpportunityCandidate(
  candidate: HarnessOpportunityCandidate,
  consent: ShareConsent,
  now: Date,
  generalized?: GeneralizedDemandShape,
): OpportunityLifecycleRecord {
  return {
    id: deriveOpportunityIdentity(candidate),
    version: 1,
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: candidate.evidence.expiresAt,
    shareConsent: { basis: consent.basis, grantedAt: consent.grantedAt },
    candidate: cloneCandidate(candidate),
    revocation: null,
    revocationHistory: [],
    reconciliation: { status: "pending", realizedTotal: null, classification: null, reconciledAt: null },
    provenance: {
      source: candidate.evidence.source,
      observedAt: candidate.evidence.observedAt,
      freshnessPolicy: freshnessPolicyFor(candidate.evidence.freshness),
      recheckPolicy: RECHECK_POLICY_TEXT,
    },
    generalized: generalized === undefined ? null : cloneGeneralized(generalized),
  };
}

// ——— expiry ———

/**
 * Is the record stale at `now`? True only while the record is ACTIVE and its
 * evidence expiry has passed (>= expiresAt — the boundary itself is stale).
 * An unparseable expiry is UNKNOWN, never guessed stale (INV-10); a
 * null expiry (prediction/refusal) never goes stale; terminal statuses are
 * no longer "stale" — they already answered.
 */
export function isOpportunityStale(record: OpportunityLifecycleRecord, now: Date): boolean {
  if (record.status !== "active") return false;
  if (record.expiresAt === null) return false;
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return now.getTime() >= expiresMs;
}

/** The bulk-expiry result: the transitioned records + the typed audit events. */
export interface LifecycleTransitionResult {
  records: OpportunityLifecycleRecord[];
  events: OpportunityLifecycleEvent[];
}

/**
 * Bulk transition: every ACTIVE record whose expiry has passed becomes
 * "expired" (version + 1) with one typed event per transition; every other
 * record passes through untouched (same reference, same version).
 */
export function expireStaleOpportunities(
  records: readonly OpportunityLifecycleRecord[],
  now: Date,
): LifecycleTransitionResult {
  const events: OpportunityLifecycleEvent[] = [];
  const transitioned = records.map((record) => {
    if (!isOpportunityStale(record, now)) return record;
    events.push({
      at: now.toISOString(),
      from: "active",
      to: "expired",
      recordId: record.id,
      reason: "evidence-expired",
    });
    return { ...record, status: "expired" as const, version: record.version + 1 };
  });
  return { records: transitioned, events };
}

// ——— revocation (the user opt-out / authority revocation path) ———

/** The revocation result: the new record + the emitted event (null on a no-op). */
export interface LifecycleTransition {
  record: OpportunityLifecycleRecord;
  event: OpportunityLifecycleEvent | null;
}

/**
 * Revoke: the user opt-out / authority-revocation path (reasons such as
 * "user-opt-out", "authority-revoked"). Only an ACTIVE record can revoke —
 * revoking a terminal record is an honest no-op (record unchanged, no event,
 * no version bump) rather than a silent rewrite of history.
 */
export function revokeOpportunity(
  record: OpportunityLifecycleRecord,
  reason: string,
  now: Date,
): LifecycleTransition {
  if (record.status !== "active") {
    return { record, event: null };
  }
  const revokedAt = now.toISOString();
  const revocation = { revokedAt, reason };
  return {
    record: {
      ...record,
      status: "revoked",
      version: record.version + 1,
      revocation,
      revocationHistory: [...record.revocationHistory, revocation],
    },
    event: { at: revokedAt, from: "active", to: "revoked", recordId: record.id, reason },
  };
}

// ——— abandonment ———

/**
 * Abandon: the principal walked away without an outcome. Only an ACTIVE
 * record can abandon — terminal records answer with an honest no-op.
 */
export function abandonOpportunity(
  record: OpportunityLifecycleRecord,
  reason: string,
  now: Date,
): LifecycleTransition {
  if (record.status !== "active") {
    return { record, event: null };
  }
  const abandonedAt = now.toISOString();
  return {
    record: {
      ...record,
      status: "abandoned",
      version: record.version + 1,
      reconciliation: { ...record.reconciliation, status: "abandoned" },
    },
    event: { at: abandonedAt, from: "active", to: "abandoned", recordId: record.id, reason },
  };
}

// ——— the issue #23 W2 freshness gate ———

/** How far an observation timestamp may sit in the future before it is rejected (clock skew). */
export const OPPORTUNITY_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The gate's answer. */
export interface FreshnessGateResult {
  mayRepresentAsCurrentlyAvailable: boolean;
  /** Why — cites the observation, the window, or the blocking record state. */
  basis: string;
}

/**
 * THE issue #23 W2 LAW: a conditional opportunity may be described as
 * "currently available" ONLY after a fresh independent observation whose
 * observedAt sits within OBSERVED_PRICE_FRESHNESS_MS of now (allowing the
 * clock-skew tolerance). Without it — stale observation, no observation, an
 * unparseable timestamp, or a revoked/expired/terminal record — the answer
 * is false and the opportunity stays conditional.
 *
 * The gate NEVER upgrades the evidence class (INV-30): a true verdict
 * licenses REPRESENTATION only; the record's candidate stays exactly as the
 * L3 evaluator classified it.
 */
export function verifyFreshnessGate(
  record: OpportunityLifecycleRecord,
  freshIndependentObservation: { observedAt: string } | null,
  now: Date,
): FreshnessGateResult {
  if (record.status !== "active") {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis: `record status is "${record.status}" — only an active record can be represented as currently available`,
    };
  }
  if (isOpportunityStale(record, now)) {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis: `the record's own evidence expired at ${record.expiresAt} — expired content is never currently available`,
    };
  }
  if (freshIndependentObservation === null) {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis:
        "no fresh independent observation — the conditional opportunity stays conditional (never rendered as currently available)",
    };
  }
  const observedMs = Date.parse(freshIndependentObservation.observedAt);
  if (!Number.isFinite(observedMs)) {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis: `the independent observation's observedAt "${freshIndependentObservation.observedAt}" is unparseable — UNKNOWN, never guessed fresh (INV-10)`,
    };
  }
  const nowMs = now.getTime();
  if (observedMs - nowMs > OPPORTUNITY_CLOCK_SKEW_MS) {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis: `the independent observation is dated ${freshIndependentObservation.observedAt} — in the future beyond the ${OPPORTUNITY_CLOCK_SKEW_MS}ms clock-skew tolerance`,
    };
  }
  const ageMs = Math.max(0, nowMs - observedMs);
  if (ageMs > OBSERVED_PRICE_FRESHNESS_MS) {
    return {
      mayRepresentAsCurrentlyAvailable: false,
      basis: `the independent observation at ${freshIndependentObservation.observedAt} is ${ageMs}ms old — beyond the ${OBSERVED_PRICE_FRESHNESS_MS}ms freshness window`,
    };
  }
  return {
    mayRepresentAsCurrentlyAvailable: true,
    basis:
      `fresh independent observation at ${freshIndependentObservation.observedAt} (age ${ageMs}ms, within the ` +
      `${OBSERVED_PRICE_FRESHNESS_MS}ms window); the evidence class stays "${record.candidate.evidenceClass}" — ` +
      "this gate licenses representation as currently available, never an evidence upgrade (INV-30)",
  };
}

// ——— reconciliation (the R7 true/false-savings denominators) ———

/** The realized outcome the caller observed for the opportunity. */
export interface ReconciledOutcomeInput {
  observedAt: string;
  realizedTotal: HarnessMoney | null;
  baselineTotal: HarnessMoney | null;
}

/**
 * Classify the realized outcome: "true-savings" only when realizedTotal is
 * STRICTLY below baselineTotal on same-currency exact BigInt cents; equal or
 * worse on comparable money is "false-savings" (zero/negative realized
 * saving — the predicted saving did not materialize); cross-currency,
 * unparseable or missing totals classify "unknown" — the harness never
 * invents an FX rate and never guesses a comparison (INV-10/INV-14).
 */
function classifySavings(
  realizedTotal: HarnessMoney | null,
  baselineTotal: HarnessMoney | null,
): "true-savings" | "false-savings" | "unknown" {
  if (realizedTotal === null || baselineTotal === null) return "unknown";
  if (realizedTotal.currency !== baselineTotal.currency) return "unknown";
  const realizedCents = parseMoneyToCents(realizedTotal.amount);
  const baselineCents = parseMoneyToCents(baselineTotal.amount);
  if (realizedCents === null || baselineCents === null) return "unknown";
  return compareCents(realizedCents, baselineCents) < 0 ? "true-savings" : "false-savings";
}

/**
 * Reconcile the outcome: records the realized total, classifies the savings,
 * and — if the record was still active — realizes it (the lifecycle's
 * "realized" terminal state). Reconciling an already-terminal record still
 * records the accounting (R7 needs it for expired/revoked opportunities
 * too) but never rewrites the terminal status; the audit event's `to` then
 * equals its `from`. Version always increments (INV-15).
 */
export function reconcileOpportunityOutcome(
  record: OpportunityLifecycleRecord,
  realized: ReconciledOutcomeInput,
  now: Date,
): LifecycleTransition {
  const reconciledAt = now.toISOString();
  const classification = classifySavings(realized.realizedTotal, realized.baselineTotal);
  const statusAfter: OpportunityLifecycleStatus =
    record.status === "active" ? "realized" : record.status;
  return {
    record: {
      ...record,
      status: statusAfter,
      version: record.version + 1,
      reconciliation: {
        status: "reconciled",
        realizedTotal: realized.realizedTotal,
        classification,
        reconciledAt,
      },
    },
    event: {
      at: reconciledAt,
      from: record.status,
      to: statusAfter,
      recordId: record.id,
      reason:
        record.status === "active"
          ? "outcome-reconciled"
          : `outcome-reconciled (status stays "${record.status}" — terminal statuses are never rewritten)`,
    },
  };
}
