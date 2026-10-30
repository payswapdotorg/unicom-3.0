// ============================================================
// commerce-harness — the W2 opportunity lifecycle conformance suite
// (HARNESS-CONTRACT.md §2 cross-cutting contracts; issue #23 workstream 2)
// ============================================================
//
// The lifecycle law as real tests, in the R5 lane's style:
//
//   1. Deterministic identity (INV-15): the content-derived id is stable
//      for identical six-part candidates and distinct for any differing
//      part — no crypto, no randomness, replayable.
//   2. Registration defaults: version 1, active, expiry derived from the
//      candidate's evidence, the full issue-#23 provenance block (source,
//      observation time, freshness policy, recheck policy), pending
//      reconciliation, empty revocation history.
//   3. Copy-on-transition (INV-15): the wrapped candidate is NEVER mutated
//      by any transition — registration, expiry, revocation, reconciliation
//      and abandonment all leave the caller's object byte-identical.
//   4. Expiry: the staleness boundary sits EXACTLY at expiresAt; bulk
//      expiry emits one typed audit event per transition.
//   5. Revocation: the user opt-out path records reason + timestamp +
//      history and bumps the version; terminal records answer with an
//      honest no-op instead of rewriting history.
//   6. THE issue #23 W2 freshness gate: a conditional opportunity may be
//      represented as currently available ONLY behind a fresh independent
//      observation within OBSERVED_PRICE_FRESHNESS_MS — never for a
//      revoked/expired record, never without an observation, never for a
//      future-dated observation beyond clock skew, and NEVER as an
//      evidence-class upgrade (INV-30).
//   7. Reconciliation (the R7 denominators): same-currency exact BigInt
//      cents → true-savings/false-savings; cross-currency, missing or
//      unparseable totals → "unknown" (INV-10/INV-14 — no FX is invented).
//
// Fixture tier: everything arrives as labelled fixture data (the module is
// pure by design — no live network, no browsers, no wall clock; every
// function receives an injected Date).

import { describe, expect, it } from "vitest";
import type { HarnessOpportunityCandidate } from "../src/commerce-harness/families.js";
import { OBSERVED_PRICE_FRESHNESS_MS } from "../src/commerce-harness/families.js";
import {
  abandonOpportunity,
  deriveOpportunityIdentity,
  expireStaleOpportunities,
  isOpportunityStale,
  OPPORTUNITY_CLOCK_SKEW_MS,
  OPPORTUNITY_LIFECYCLE_STATUSES,
  reconcileOpportunityOutcome,
  registerOpportunityCandidate,
  revokeOpportunity,
  verifyFreshnessGate,
  type OpportunityLifecycleRecord,
  type ShareConsent,
} from "../src/commerce-harness/opportunity-lifecycle.js";
import type { HarnessMoney } from "../src/commerce-harness/intent.js";

// ——— the labelled fixtures ———

const FIXTURE_OBSERVED_AT = "2026-10-28T00:00:00.000Z";
/** observedAt + the 24h observed-price freshness window (families.ts law). */
const FIXTURE_EXPIRES_AT = "2026-10-29T00:00:00.000Z";
const FIXTURE_NOW = new Date("2026-10-28T00:00:00.000Z");
const FIXTURE_LATER = new Date("2026-10-28T06:00:00.000Z");

const FIXTURE_SHARED_CONSENT: ShareConsent = {
  basis: "shared-generalized",
  grantedAt: "2026-10-28T00:00:00.000Z",
};

const FIXTURE_PRIVATE_CONSENT: ShareConsent = {
  basis: "private",
  grantedAt: "2026-10-28T00:00:00.000Z",
};

/**
 * The six-part candidate fixture — the substitutes family, live-observed
 * evidence, a real expiry. The changedAssumptions text deliberately embeds
 * the raw query the way families.ts does, so the immutability/privacy
 * assertions below run against realistic free text.
 */
function fixtureCandidate(overrides: Partial<HarnessOpportunityCandidate> = {}): HarnessOpportunityCandidate {
  return {
    family: "approved_substitutes",
    title: "Approved substitutes",
    feasibility: "feasible",
    reason: "fixture: search-based counterfactual over the connected catalog",
    evidenceClass: "conditional",
    observedFacts: "fixture observed facts: three priced items were observed",
    changedAssumptions: 'the principal accepts a substitute for the exact "yeezy shoes" ask',
    predictedOutcome: "an in-budget substitute purchase today, conditional on the principal approving one",
    preconditions: ["the principal approves a substitute", "a fresh check before purchase"],
    evidence: {
      source: "the fixture broadened store_search observation",
      observedAt: FIXTURE_OBSERVED_AT,
      freshness: "live-observed",
      expiresAt: FIXTURE_EXPIRES_AT,
    },
    consentRequired: "the principal approves one of the observed substitutes",
    authorityRequired: "read-only",
    ...overrides,
  };
}

/** The prediction-grade candidate (wait_or_buy): null expiry, never stale. */
function fixturePredictionCandidate(): HarnessOpportunityCandidate {
  return fixtureCandidate({
    family: "wait_or_buy",
    title: "Wait or buy",
    evidenceClass: "predicted",
    reason: "fixture: prediction-based",
    evidence: {
      source: "prediction over the observed catalog prices",
      observedAt: FIXTURE_OBSERVED_AT,
      freshness: "prediction",
      expiresAt: null,
    },
  });
}

function fixtureSharedRecord(): OpportunityLifecycleRecord {
  return registerOpportunityCandidate(
    fixtureCandidate(),
    FIXTURE_SHARED_CONSENT,
    FIXTURE_NOW,
    { currency: "HKD", priceBand: { min: { amount: "300.00", currency: "HKD" }, max: { amount: "400.00", currency: "HKD" } } },
  );
}

function money(amount: string, currency: string): HarnessMoney {
  return { amount, currency };
}

// ============================================================
// 1. Deterministic identity (INV-15)
// ============================================================

describe("opportunity lifecycle — deterministic identity (INV-15)", () => {
  it("the same six-part candidate always derives the same identity, and two registrations agree", () => {
    const first = deriveOpportunityIdentity(fixtureCandidate());
    const second = deriveOpportunityIdentity(fixtureCandidate());
    expect(first).toBe(second);
    expect(first).toMatch(/^opp_[0-9a-f]{8}$/u);
    const recordOne = registerOpportunityCandidate(fixtureCandidate(), FIXTURE_SHARED_CONSENT, FIXTURE_NOW);
    const recordTwo = registerOpportunityCandidate(fixtureCandidate(), FIXTURE_PRIVATE_CONSENT, FIXTURE_LATER);
    // Identity is content-derived ONLY — consent and time never change it.
    expect(recordOne.id).toBe(first);
    expect(recordTwo.id).toBe(first);
  });

  it("a differing candidate derives a differing identity", () => {
    const base = deriveOpportunityIdentity(fixtureCandidate());
    const different = deriveOpportunityIdentity(
      fixtureCandidate({ changedAssumptions: "a different changed assumption" }),
    );
    expect(different).not.toBe(base);
  });

  it("the identity covers the whole six-part record — every part is load-bearing", () => {
    const base = deriveOpportunityIdentity(fixtureCandidate());
    const variants: HarnessOpportunityCandidate[] = [
      fixtureCandidate({ preconditions: [...fixtureCandidate().preconditions, "a third precondition"] }),
      fixtureCandidate({ authorityRequired: "approval-required" }),
      fixtureCandidate({ consentRequired: "a different consent" }),
      fixtureCandidate({
        evidence: { ...fixtureCandidate().evidence, source: "a different source" },
      }),
      fixtureCandidate({
        evidence: { ...fixtureCandidate().evidence, observedAt: "2026-10-27T00:00:00.000Z" },
      }),
      fixtureCandidate({
        evidence: { ...fixtureCandidate().evidence, expiresAt: null },
      }),
    ];
    for (const variant of variants) {
      expect(deriveOpportunityIdentity(variant)).not.toBe(base);
    }
  });
});

// ============================================================
// 2. Registration defaults (the issue #23 provenance block)
// ============================================================

describe("opportunity lifecycle — registration defaults", () => {
  it("registers active at version 1 with the derived expiry and the full provenance block", () => {
    const record = fixtureSharedRecord();
    expect(record.status).toBe("active");
    expect(record.version).toBe(1);
    expect(record.createdAt).toBe(FIXTURE_NOW.toISOString());
    expect(record.expiresAt).toBe(FIXTURE_EXPIRES_AT); // derived from candidate.evidence.expiresAt
    expect(record.shareConsent).toEqual(FIXTURE_SHARED_CONSENT);
    expect(record.revocation).toBeNull();
    expect(record.revocationHistory).toEqual([]);
    expect(record.reconciliation).toEqual({
      status: "pending",
      realizedTotal: null,
      classification: null,
      reconciledAt: null,
    });
    // The issue #23 W2 provenance demands: source, observation time,
    // freshness policy, recheck policy.
    expect(record.provenance.source).toBe(fixtureCandidate().evidence.source);
    expect(record.provenance.observedAt).toBe(FIXTURE_OBSERVED_AT);
    expect(record.provenance.freshnessPolicy).toContain(String(OBSERVED_PRICE_FRESHNESS_MS));
    expect(record.provenance.freshnessPolicy).toContain("re-observed");
    expect(record.provenance.recheckPolicy).toContain("fresh independent observation");
    expect(record.provenance.recheckPolicy).toContain("issue #23 W2 law");
    expect(OPPORTUNITY_LIFECYCLE_STATUSES).toEqual(["active", "expired", "revoked", "realized", "abandoned"]);
  });

  it("the freshness policy is honest per evidence grade (prediction-grade records claim no window)", () => {
    const predicted = registerOpportunityCandidate(fixturePredictionCandidate(), FIXTURE_PRIVATE_CONSENT, FIXTURE_NOW);
    expect(predicted.expiresAt).toBeNull();
    expect(predicted.provenance.freshnessPolicy).toContain("never represented as currently available");
    expect(isOpportunityStale(predicted, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("registration copies the candidate — later mutation of the caller's object never reaches the record", () => {
    const candidate = fixtureCandidate();
    const record = registerOpportunityCandidate(candidate, FIXTURE_SHARED_CONSENT, FIXTURE_NOW);
    candidate.title = "MUTATED TITLE";
    candidate.evidence.expiresAt = null;
    candidate.preconditions.push("MUTATED PRECONDITION");
    expect(record.candidate.title).toBe("Approved substitutes");
    expect(record.candidate.evidence.expiresAt).toBe(FIXTURE_EXPIRES_AT);
    expect(record.candidate.preconditions).toHaveLength(2);
  });
});

// ============================================================
// 3. Expiry — the staleness boundary and the audit trail
// ============================================================

describe("opportunity lifecycle — expiry (the staleness boundary)", () => {
  it("exactly at expiresAt the record is stale; one millisecond before it is not", () => {
    const record = fixtureSharedRecord();
    const expiresAt = new Date(FIXTURE_EXPIRES_AT);
    expect(isOpportunityStale(record, expiresAt)).toBe(true); // the boundary itself
    expect(isOpportunityStale(record, new Date(expiresAt.getTime() - 1))).toBe(false);
  });

  it("expireStaleOpportunities transitions stale records, bumps versions and emits the typed audit event", () => {
    const stale = fixtureSharedRecord();
    const fresh = registerOpportunityCandidate(
      fixtureCandidate({
        evidence: { ...fixtureCandidate().evidence, expiresAt: "2026-11-28T00:00:00.000Z" },
      }),
      FIXTURE_SHARED_CONSENT,
      FIXTURE_NOW,
    );
    const at = new Date("2026-10-30T00:00:00.000Z");
    const result = expireStaleOpportunities([stale, fresh], at);
    const [transitioned, untouched] = result.records;
    expect(transitioned?.status).toBe("expired");
    expect(transitioned?.version).toBe(2);
    expect(transitioned?.id).toBe(stale.id);
    expect(untouched).toBe(fresh); // non-stale records pass through as the SAME reference
    expect(untouched?.version).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      at: at.toISOString(),
      from: "active",
      to: "expired",
      recordId: stale.id,
      reason: "evidence-expired",
    });
  });

  it("an unparseable expiry is UNKNOWN, never guessed stale (INV-10)", () => {
    const malformed = registerOpportunityCandidate(
      fixtureCandidate({
        evidence: { ...fixtureCandidate().evidence, expiresAt: "not-a-timestamp" },
      }),
      FIXTURE_SHARED_CONSENT,
      FIXTURE_NOW,
    );
    expect(isOpportunityStale(malformed, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(expireStaleOpportunities([malformed], new Date("2030-01-01T00:00:00.000Z")).events).toEqual([]);
  });
});

// ============================================================
// 4. Revocation — the user opt-out / authority revocation path
// ============================================================

describe("opportunity lifecycle — revocation (the opt-out path)", () => {
  it("revokeOpportunity records the reason, the timestamp, the history, and bumps the version", () => {
    const record = fixtureSharedRecord();
    const at = new Date("2026-10-28T09:30:00.000Z");
    const { record: revoked, event } = revokeOpportunity(record, "user-opt-out", at);
    expect(revoked.status).toBe("revoked");
    expect(revoked.version).toBe(2);
    expect(revoked.id).toBe(record.id);
    expect(revoked.revocation).toEqual({ revokedAt: at.toISOString(), reason: "user-opt-out" });
    expect(revoked.revocationHistory).toEqual([{ revokedAt: at.toISOString(), reason: "user-opt-out" }]);
    expect(event).toEqual({
      at: at.toISOString(),
      from: "active",
      to: "revoked",
      recordId: record.id,
      reason: "user-opt-out",
    });
  });

  it("revoking a non-active record is an honest no-op — history is never rewritten", () => {
    const record = fixtureSharedRecord();
    const expired = expireStaleOpportunities([record], new Date(FIXTURE_EXPIRES_AT)).records[0]!;
    expect(expired.status).toBe("expired");
    const { record: revoked, event } = revokeOpportunity(expired, "user-opt-out", FIXTURE_LATER);
    expect(revoked).toBe(expired); // same reference, same version, same status
    expect(revoked.version).toBe(2); // only the expiry bumped it
    expect(revoked.status).toBe("expired");
    expect(revoked.revocation).toBeNull();
    expect(event).toBeNull();
  });
});

// ============================================================
// 5. THE issue #23 W2 freshness gate
// ============================================================

describe("opportunity lifecycle — the issue #23 W2 freshness gate", () => {
  it("a fresh independent observation within the window licenses representing as currently available", () => {
    const record = fixtureSharedRecord();
    const observation = { observedAt: "2026-10-28T05:00:00.000Z" }; // 5h old, window is 24h
    const result = verifyFreshnessGate(record, observation, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(true);
    expect(result.basis).toContain(observation.observedAt);
    expect(result.basis).toContain(String(OBSERVED_PRICE_FRESHNESS_MS));
  });

  it("a stale independent observation (beyond the window) does not — the basis cites the window", () => {
    const record = fixtureSharedRecord();
    const observation = { observedAt: "2026-10-26T00:00:00.000Z" }; // 2.5 days old
    const result = verifyFreshnessGate(record, observation, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(result.basis).toContain("beyond the");
    expect(result.basis).toContain(`${OBSERVED_PRICE_FRESHNESS_MS}ms freshness window`);
  });

  it("no observation at all → false: the conditional opportunity stays conditional", () => {
    const result = verifyFreshnessGate(fixtureSharedRecord(), null, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(result.basis).toContain("no fresh independent observation");
    expect(result.basis).toContain("stays conditional");
  });

  it("a revoked record never passes the gate, even with a fresh observation", () => {
    const { record: revoked } = revokeOpportunity(fixtureSharedRecord(), "user-opt-out", FIXTURE_NOW);
    const fresh = { observedAt: FIXTURE_LATER.toISOString() };
    expect(verifyFreshnessGate(revoked, fresh, FIXTURE_LATER).mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(verifyFreshnessGate(revoked, fresh, FIXTURE_LATER).basis).toContain("revoked");
  });

  it("an expired record never passes the gate either", () => {
    const { records } = expireStaleOpportunities([fixtureSharedRecord()], new Date(FIXTURE_EXPIRES_AT));
    const expired = records[0]!;
    const fresh = { observedAt: new Date(FIXTURE_EXPIRES_AT).toISOString() };
    const result = verifyFreshnessGate(expired, fresh, new Date(FIXTURE_EXPIRES_AT));
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(result.basis).toContain("expired");
  });

  it("an observation dated in the future beyond clock skew is rejected — never guessed fresh", () => {
    const record = fixtureSharedRecord();
    const futureBeyondSkew = {
      observedAt: new Date(FIXTURE_LATER.getTime() + OPPORTUNITY_CLOCK_SKEW_MS + 1).toISOString(),
    };
    const result = verifyFreshnessGate(record, futureBeyondSkew, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(result.basis).toContain("clock-skew tolerance");
  });

  it("an unparseable observation timestamp is UNKNOWN — the gate refuses (INV-10)", () => {
    const result = verifyFreshnessGate(fixtureSharedRecord(), { observedAt: "not-a-timestamp" }, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(false);
    expect(result.basis).toContain("unparseable");
  });

  it("a TRUE gate never upgrades the evidence class — the record is untouched (INV-30)", () => {
    const record = fixtureSharedRecord();
    const before = JSON.stringify(record);
    const result = verifyFreshnessGate(record, { observedAt: FIXTURE_LATER.toISOString() }, FIXTURE_LATER);
    expect(result.mayRepresentAsCurrentlyAvailable).toBe(true);
    expect(JSON.stringify(record)).toBe(before); // the gate is a pure read
    expect(record.candidate.evidenceClass).toBe("conditional"); // representation ≠ reclassification
    expect(result.basis).toContain("never an evidence upgrade");
  });
});

// ============================================================
// 6. Reconciliation — the R7 true/false-savings denominators
// ============================================================

describe("opportunity lifecycle — reconciliation (the R7 denominators)", () => {
  it("same-currency realized strictly below baseline → true-savings, and the record realizes", () => {
    const record = fixtureSharedRecord();
    const at = new Date("2026-10-28T12:00:00.000Z");
    const { record: reconciled, event } = reconcileOpportunityOutcome(
      record,
      {
        observedAt: at.toISOString(),
        realizedTotal: money("320.00", "HKD"),
        baselineTotal: money("350.00", "HKD"),
      },
      at,
    );
    expect(reconciled.reconciliation.status).toBe("reconciled");
    expect(reconciled.reconciliation.classification).toBe("true-savings");
    expect(reconciled.reconciliation.realizedTotal).toEqual(money("320.00", "HKD"));
    expect(reconciled.reconciliation.reconciledAt).toBe(at.toISOString());
    expect(reconciled.status).toBe("realized");
    expect(reconciled.version).toBe(2);
    expect(event).toEqual({
      at: at.toISOString(),
      from: "active",
      to: "realized",
      recordId: record.id,
      reason: "outcome-reconciled",
    });
  });

  it("same-currency realized worse than baseline → false-savings", () => {
    const { record: reconciled } = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("380.00", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    expect(reconciled.reconciliation.classification).toBe("false-savings");
    expect(reconciled.status).toBe("realized");
  });

  it("same-currency equal totals → false-savings (zero realized saving — the predicted saving did not materialize)", () => {
    const { record: reconciled } = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("350.00", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    expect(reconciled.reconciliation.classification).toBe("false-savings");
  });

  it("cross-currency totals classify unknown — no FX rate is ever invented (INV-14)", () => {
    const { record: reconciled } = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("40.00", "USD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    expect(reconciled.reconciliation.classification).toBe("unknown");
    expect(reconciled.reconciliation.status).toBe("reconciled"); // reconciled — but honestly unclassifiable
  });

  it("null totals classify unknown (never zero, never a guess)", () => {
    const realizedNull = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: null, baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    const baselineNull = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("320.00", "HKD"), baselineTotal: null },
      FIXTURE_LATER,
    );
    expect(realizedNull.record.reconciliation.classification).toBe("unknown");
    expect(baselineNull.record.reconciliation.classification).toBe("unknown");
  });

  it("unparseable money classifies unknown (INV-10 — the reject rule applies to reconciliation too)", () => {
    const { record: reconciled } = reconcileOpportunityOutcome(
      fixtureSharedRecord(),
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("320.005", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    expect(reconciled.reconciliation.classification).toBe("unknown");
  });

  it("reconciling a terminal record records the accounting but never rewrites the terminal status", () => {
    const { record: revoked } = revokeOpportunity(fixtureSharedRecord(), "user-opt-out", FIXTURE_NOW);
    const { record: reconciled, event } = reconcileOpportunityOutcome(
      revoked,
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("320.00", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    expect(reconciled.status).toBe("revoked"); // terminal statuses are never rewritten
    expect(reconciled.version).toBe(3); // revoked (2) → reconciled (3)
    expect(reconciled.reconciliation.classification).toBe("true-savings");
    expect(event?.from).toBe("revoked");
    expect(event?.to).toBe("revoked");
    expect(event?.reason).toContain("never rewritten");
  });
});

// ============================================================
// 7. Abandonment + the immutability/versioning laws
// ============================================================

describe("opportunity lifecycle — abandonment, immutability, versioning", () => {
  it("abandonOpportunity: active → abandoned with the reconciliation abandoned and an audit event", () => {
    const record = fixtureSharedRecord();
    const at = new Date("2026-10-28T15:00:00.000Z");
    const { record: abandoned, event } = abandonOpportunity(record, "principal walked away", at);
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.reconciliation.status).toBe("abandoned");
    expect(abandoned.version).toBe(2);
    expect(event).toEqual({
      at: at.toISOString(),
      from: "active",
      to: "abandoned",
      recordId: record.id,
      reason: "principal walked away",
    });
  });

  it("no transition ever mutates the original candidate object (copy-on-transition, INV-15)", () => {
    const candidate = fixtureCandidate();
    const snapshot = JSON.stringify(candidate);
    const record = registerOpportunityCandidate(candidate, FIXTURE_SHARED_CONSENT, FIXTURE_NOW);
    expect(JSON.stringify(candidate)).toBe(snapshot); // registration copied, did not mutate
    expireStaleOpportunities([record], new Date(FIXTURE_EXPIRES_AT));
    revokeOpportunity(record, "user-opt-out", FIXTURE_LATER);
    reconcileOpportunityOutcome(
      record,
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("320.00", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    abandonOpportunity(record, "fixture", FIXTURE_LATER);
    expect(JSON.stringify(candidate)).toBe(snapshot); // still byte-identical
  });

  it("every transition bumps the version and the events never rewrite history", () => {
    let record = fixtureSharedRecord();
    expect(record.version).toBe(1);
    const revokeStep = revokeOpportunity(record, "user-opt-out", FIXTURE_LATER);
    record = revokeStep.record;
    expect(record.version).toBe(2);
    expect(revokeStep.event?.from).toBe("active");
    const reconcileStep = reconcileOpportunityOutcome(
      record,
      { observedAt: FIXTURE_LATER.toISOString(), realizedTotal: money("320.00", "HKD"), baselineTotal: money("350.00", "HKD") },
      FIXTURE_LATER,
    );
    record = reconcileStep.record;
    expect(record.version).toBe(3);
    expect(reconcileStep.event?.from).toBe("revoked"); // history is append-only, never rewritten
  });
});
