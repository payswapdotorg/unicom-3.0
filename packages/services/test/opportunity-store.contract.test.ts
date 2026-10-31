// ============================================================
// commerce-harness — the W2 persistent canonical opportunity
// store suite (the 2026-10-31 review's "persistent canonical
// opportunities")
// ============================================================
//
// Pins the store's own laws (opportunity-store.ts):
//   1. IDENTITY IS CONTENT: the same candidate registers once — the second
//      registration is an idempotent no-op returning the EXISTING record.
//   2. EVERY TRANSITION EMITS EXACTLY ONE AUDIT EVENT, versions increment,
//      and terminal records answer honest no-ops (never rewritten history).
//   3. PERSISTENCE IS A PORT: the snapshot round-trips through an
//      in-memory port; a store built over the loaded snapshot continues
//      the SAME canonical identities, versions, and event log.
//   4. RECONCILIATION feeds R7's denominators: true-savings /
//      false-savings / unknown, on exact same-currency cents only.
//
// Fixture tier: labelled fixture candidates + an injected clock.

import { describe, expect, it } from "vitest";
import {
  createInMemoryOpportunityPersistence,
  createOpportunityStore,
  type OpportunityStore,
} from "../src/commerce-harness/opportunity-store.js";
import type { HarnessOpportunityCandidate } from "../src/commerce-harness/families.js";

const NOW = new Date("2026-10-31T00:00:00.000Z");

function fixtureCandidate(title: string): HarnessOpportunityCandidate {
  return {
    family: "approved_substitutes",
    title,
    feasibility: "feasible",
    reason: "fixture: search-based substitutes family",
    evidenceClass: "conditional",
    observedFacts: "fixture observed facts",
    changedAssumptions: "fixture changed assumptions",
    predictedOutcome: "fixture predicted outcome",
    preconditions: ["fixture precondition"],
    evidence: {
      source: "fixture: the broadened store_search observation",
      observedAt: "2026-10-31T00:00:00.000Z",
      freshness: "live-observed",
      expiresAt: "2026-11-01T00:00:00.000Z",
    },
    consentRequired: "fixture consent",
    authorityRequired: "read-only",
  };
}

function fixtureStore(): OpportunityStore {
  return createOpportunityStore({
    now: () => NOW,
    persistence: createInMemoryOpportunityPersistence(),
  });
}

const CONSENT = { basis: "private" as const, grantedAt: "2026-10-31T00:00:00.000Z" };
const GENERALIZED = {
  currency: "HKD",
  priceBand: { min: { amount: "80.00", currency: "HKD" }, max: { amount: "120.00", currency: "HKD" } },
};

// ——— registration + identity ———

describe("W2-b registration and canonical identity", () => {
  it("registers once; the SAME candidate registers idempotently (identity is content)", () => {
    const store = fixtureStore();
    const first = store.register(fixtureCandidate("Substitutes A"), CONSENT, GENERALIZED);
    expect(first.existed).toBe(false);
    expect(first.record.status).toBe("active");
    expect(first.record.version).toBe(1);
    const second = store.register(fixtureCandidate("Substitutes A"), CONSENT, GENERALIZED);
    expect(second.existed).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(store.list()).toHaveLength(1);
  });

  it("different candidates derive different canonical ids", () => {
    const store = fixtureStore();
    store.register(fixtureCandidate("Substitutes A"), CONSENT);
    store.register(fixtureCandidate("Substitutes B"), CONSENT);
    expect(store.list()).toHaveLength(2);
  });

  it("get() answers null for a missing id — never a guess", () => {
    expect(fixtureStore().get("missing-id")).toBeNull();
  });
});

// ——— transitions + the audit log ———

describe("W2-b lifecycle transitions through the store", () => {
  it("revoke transitions active → revoked with exactly ONE event and a version bump", () => {
    const store = fixtureStore();
    const { record } = store.register(fixtureCandidate("Substitutes A"), CONSENT);
    const { record: revoked, event } = store.revoke(record.id, "user-opt-out");
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.version).toBe(2);
    expect(event?.from).toBe("active");
    expect(event?.to).toBe("revoked");
    expect(event?.reason).toBe("user-opt-out");
    expect(store.events()).toHaveLength(1);
  });

  it("revoking a terminal record is an honest no-op (history never rewritten)", () => {
    const store = fixtureStore();
    const { record } = store.register(fixtureCandidate("Substitutes A"), CONSENT);
    store.revoke(record.id, "user-opt-out");
    const second = store.revoke(record.id, "user-opt-out-again");
    expect(second.event).toBeNull();
    expect(second.record?.status).toBe("revoked");
    expect(second.record?.version).toBe(2); // unchanged
    expect(store.events()).toHaveLength(1);
  });

  it("applyExpiry transitions stale ACTIVE records (the expiry sweep law)", () => {
    const store = fixtureStore();
    store.register(fixtureCandidate("Substitutes A"), CONSENT); // expires 2026-11-01
    const laterStore = createOpportunityStore({
      now: () => new Date("2026-11-02T00:00:00.000Z"),
    });
    // Re-register under the later clock to make it stale against that clock
    const { record } = laterStore.register(
      { ...fixtureCandidate("Substitutes A"), evidence: { ...fixtureCandidate("Substitutes A").evidence, observedAt: "2026-10-30T00:00:00.000Z" } },
      CONSENT,
    );
    const sweep = laterStore.applyExpiry();
    expect(sweep.transitioned).toHaveLength(1);
    expect(laterStore.list({ status: "expired" })).toHaveLength(1);
    expect(laterStore.get(record.id)?.status).toBe("expired");
  });

  it("reconcile realizes an ACTIVE record and classifies the savings (R7 denominators)", () => {
    const store = fixtureStore();
    const { record } = store.register(fixtureCandidate("Substitutes A"), CONSENT);
    const { record: reconciled, event } = store.reconcile(record.id, {
      observedAt: "2026-10-31T12:00:00.000Z",
      realizedTotal: { amount: "85.00", currency: "HKD" },
      baselineTotal: { amount: "100.00", currency: "HKD" },
    });
    expect(reconciled?.status).toBe("realized");
    expect(reconciled?.reconciliation.classification).toBe("true-savings");
    expect(reconciled?.reconciliation.realizedTotal).toEqual({ amount: "85.00", currency: "HKD" });
    expect(event?.reason).toBe("outcome-reconciled");
  });

  it("cross-currency reconciliation classifies UNKNOWN — no FX is ever invented", () => {
    const store = fixtureStore();
    const { record } = store.register(fixtureCandidate("Substitutes A"), CONSENT);
    const { record: reconciled } = store.reconcile(record.id, {
      observedAt: "2026-10-31T12:00:00.000Z",
      realizedTotal: { amount: "85.00", currency: "USD" },
      baselineTotal: { amount: "100.00", currency: "HKD" },
    });
    expect(reconciled?.reconciliation.classification).toBe("unknown");
  });
});

// ——— persistence round-trip ———

describe("W2-b persistence (the port law)", () => {
  it("a snapshot round-trips: a NEW store over the loaded port continues the same identities, versions, and log", () => {
    const persistence = createInMemoryOpportunityPersistence();
    const first = createOpportunityStore({ now: () => NOW, persistence });
    const registered = first.register(fixtureCandidate("Substitutes A"), CONSENT, GENERALIZED);
    first.revoke(registered.record.id, "user-opt-out");
    expect(first.events()).toHaveLength(1);

    const second = createOpportunityStore({ now: () => NOW, persistence });
    expect(second.list()).toHaveLength(1);
    const restored = second.get(registered.record.id);
    expect(restored?.id).toBe(registered.record.id);
    expect(restored?.status).toBe("revoked");
    expect(restored?.version).toBe(2);
    expect(second.events()).toHaveLength(1); // the log survived too
    // And the restored store keeps working: idempotent re-registration
    const again = second.register(fixtureCandidate("Substitutes A"), CONSENT, GENERALIZED);
    expect(again.existed).toBe(true);
  });

  it("the snapshot carries ONLY store data — no credentials, no private-intent fields", () => {
    const persistence = createInMemoryOpportunityPersistence();
    const store = createOpportunityStore({ now: () => NOW, persistence });
    store.register(fixtureCandidate("Substitutes A"), CONSENT, GENERALIZED);
    const snapshot = persistence.snapshot();
    expect(snapshot).not.toBeNull();
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["password", "cookie", "token", "mfa", "secret", "credential"]) {
      expect(serialized.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
    expect(snapshot?.schemaVersion).toBe(1);
  });
});
