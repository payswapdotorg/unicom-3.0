// ============================================================
// Commerce harness — W2 the persistent canonical opportunity
// store (the 2026-10-31 review's "persistent canonical
// opportunities", closed at the fixture tier)
// ============================================================
//
// A store over the opportunity lifecycle (opportunity-lifecycle.ts):
// registration derives the canonical content-hash identity; every
// lifecycle transition (expire/revoke/abandon/reconcile) flows through
// the pure lifecycle functions and is appended to an audit event log;
// the caller binds a persistence port (in-memory for tests and
// fixtures, a JSON file for durable fixture-tier persistence).
//
// LAWS binding this module:
//   - IDENTITY IS CONTENT (INV-lifecycle): the same candidate ALWAYS maps
//     to the same canonical id (deriveOpportunityIdentity over the frozen
//     six-part record) — registering an identical candidate twice is an
//     honest no-op that returns the EXISTING record (idempotent), never a
//     second record.
//   - THE RECORD IS IMMUTABLE-SURFACED: callers receive frozen objects;
//     every mutation is a version+1 transition through the pure lifecycle
//     functions, each emitting exactly one typed audit event.
//   - PERSISTENCE IS A PORT: the store itself performs NO synchronous I/O
//     beyond the port's serialize call (the caller binds in-memory or
//     file-backed); the serialized snapshot contains ONLY store data —
//     never credentials, never private intents (the generalized shape is
//     the only money/demand the record carries, INV-14/27).
//   - UNKNOWN IS PRESERVED (INV-10): reconciliation inputs may carry null
//     totals — they classify "unknown", never a guessed verdict.
//   - EVERY ANSWER IS TOTAL: list() filters honestly; get() on a missing id
//     returns null; the event log is append-only and complete.

import {
  abandonOpportunity,
  deriveOpportunityIdentity,
  expireStaleOpportunities,
  registerOpportunityCandidate,
  reconcileOpportunityOutcome,
  revokeOpportunity,
  type GeneralizedDemandShape,
  type OpportunityLifecycleEvent,
  type OpportunityLifecycleRecord,
  type OpportunityLifecycleStatus,
  type ShareConsent,
} from "./opportunity-lifecycle.js";
import type { HarnessOpportunityCandidate } from "./families.js";
import type { HarnessMoney } from "./intent.js";

/** The persistence port — the caller binds in-memory or file-backed storage. */
export interface OpportunityPersistencePort {
  /** Persist the current snapshot (records + events). Called after every mutation. */
  save(snapshot: OpportunityStoreSnapshot): void;
  /** Load the snapshot at store creation. Null = empty store. */
  load(): OpportunityStoreSnapshot | null;
}

/** The serialized snapshot — records, events, and nothing else. */
export interface OpportunityStoreSnapshot {
  schemaVersion: 1;
  records: OpportunityLifecycleRecord[];
  events: OpportunityLifecycleEvent[];
}

/** The in-memory persistence port (tests + fixture wiring). */
export function createInMemoryOpportunityPersistence(): OpportunityPersistencePort & {
  snapshot(): OpportunityStoreSnapshot | null;
} {
  let current: OpportunityStoreSnapshot | null = null;
  return {
    save(snapshot: OpportunityStoreSnapshot): void {
      current = snapshot;
    },
    load(): OpportunityStoreSnapshot | null {
      return current;
    },
    snapshot(): OpportunityStoreSnapshot | null {
      return current;
    },
  };
}

/** A reconciliation outcome for the store's reconcile() entry point. */
export interface StoreReconciledOutcome {
  observedAt: string;
  realizedTotal: HarnessMoney | null;
  baselineTotal: HarnessMoney | null;
}

/** The persistent canonical opportunity store. */
export interface OpportunityStore {
  /**
   * Register a candidate. Idempotent on the canonical identity: an already
   * registered (identical) candidate returns the EXISTING record with
   * existed: true — never a duplicate, never a version bump.
   */
  register(
    candidate: HarnessOpportunityCandidate,
    consent: ShareConsent,
    generalized?: GeneralizedDemandShape,
  ): { record: OpportunityLifecycleRecord; existed: boolean };
  /** One record by canonical id, or null (never a guess). */
  get(id: string): OpportunityLifecycleRecord | null;
  /** All records, optionally filtered by status. */
  list(filter?: { status?: OpportunityLifecycleStatus }): OpportunityLifecycleRecord[];
  /** Bulk-expire stale ACTIVE records through the pure lifecycle law. */
  applyExpiry(): { transitioned: OpportunityLifecycleRecord[]; events: OpportunityLifecycleEvent[] };
  /** Revoke one ACTIVE record (honest no-op on terminal records). */
  revoke(id: string, reason: string): { record: OpportunityLifecycleRecord | null; event: OpportunityLifecycleEvent | null };
  /** Abandon one ACTIVE record (honest no-op on terminal records). */
  abandon(id: string, reason: string): { record: OpportunityLifecycleRecord | null; event: OpportunityLifecycleEvent | null };
  /** Reconcile one record's outcome (records the accounting; realizes ACTIVE records). */
  reconcile(
    id: string,
    outcome: StoreReconciledOutcome,
  ): { record: OpportunityLifecycleRecord | null; event: OpportunityLifecycleEvent | null };
  /** The append-only audit event log (every transition, in order). */
  events(): OpportunityLifecycleEvent[];
  /** The current snapshot (for persistence + tests). */
  snapshot(): OpportunityStoreSnapshot;
}

/** Copy a record two levels deep and freeze it — the immutable surface callers receive. */
function cloneRecord(record: OpportunityLifecycleRecord): OpportunityLifecycleRecord {
  return Object.freeze({
    ...record,
    candidate: { ...record.candidate, preconditions: [...record.candidate.preconditions], evidence: { ...record.candidate.evidence } },
    shareConsent: { ...record.shareConsent },
    revocation: record.revocation === null ? null : { ...record.revocation },
    revocationHistory: record.revocationHistory.map((entry) => ({ ...entry })),
    reconciliation: { ...record.reconciliation },
    provenance: { ...record.provenance },
    generalized:
      record.generalized === null
        ? null
        : {
            currency: record.generalized.currency,
            ...(record.generalized.priceBand === undefined
              ? {}
              : {
                  priceBand: {
                    min: { ...record.generalized.priceBand.min },
                    max: { ...record.generalized.priceBand.max },
                  },
                }),
          },
  });
}

/** Create a persistent canonical opportunity store over the injected clock + persistence port. */
export function createOpportunityStore(input: {
  now: () => Date;
  persistence?: OpportunityPersistencePort;
}): OpportunityStore {
  const now = input.now;
  const persistence = input.persistence;
  let records: OpportunityLifecycleRecord[] = [];
  let eventLog: OpportunityLifecycleEvent[] = [];

  const loaded = persistence?.load() ?? null;
  if (loaded !== null && Array.isArray(loaded.records) && Array.isArray(loaded.events)) {
    records = [...loaded.records];
    eventLog = [...loaded.events];
  }

  function persist(): void {
    persistence?.save({ schemaVersion: 1, records: [...records], events: [...eventLog] });
  }

  function findIndexById(id: string): number {
    return records.findIndex((record) => record.id === id);
  }

  function replaceRecord(record: OpportunityLifecycleRecord, event: OpportunityLifecycleEvent | null): void {
    const index = findIndexById(record.id);
    if (index >= 0) records[index] = record;
    if (event !== null) eventLog.push(event);
    persist();
  }

  const store: OpportunityStore = {
    register(candidate, consent, generalized) {
      const canonicalId = deriveOpportunityIdentity(candidate);
      const existingIndex = findIndexById(canonicalId);
      if (existingIndex >= 0) {
        return { record: cloneRecord(records[existingIndex] as OpportunityLifecycleRecord), existed: true };
      }
      const record = registerOpportunityCandidate(candidate, consent, now(), generalized);
      records.push(record);
      persist();
      return { record: cloneRecord(record), existed: false };
    },
    get(id) {
      const record = records.find((entry) => entry.id === id);
      return record === undefined ? null : cloneRecord(record);
    },
    list(filter) {
      const filtered =
        filter?.status === undefined ? records : records.filter((record) => record.status === filter.status);
      return filtered.map((record) => cloneRecord(record));
    },
    applyExpiry() {
      const result = expireStaleOpportunities(records, now());
      records = result.records;
      eventLog.push(...result.events);
      persist();
      const transitioned = result.events.map((event) => {
        const record = records.find((entry) => entry.id === event.recordId);
        return record as OpportunityLifecycleRecord;
      });
      return { transitioned, events: result.events };
    },
    revoke(id, reason) {
      const index = findIndexById(id);
      if (index < 0) return { record: null, event: null };
      const transition = revokeOpportunity(records[index] as OpportunityLifecycleRecord, reason, now());
      replaceRecord(transition.record, transition.event);
      return { record: cloneRecord(transition.record), event: transition.event };
    },
    abandon(id, reason) {
      const index = findIndexById(id);
      if (index < 0) return { record: null, event: null };
      const transition = abandonOpportunity(records[index] as OpportunityLifecycleRecord, reason, now());
      replaceRecord(transition.record, transition.event);
      return { record: cloneRecord(transition.record), event: transition.event };
    },
    reconcile(id, outcome) {
      const index = findIndexById(id);
      if (index < 0) return { record: null, event: null };
      const transition = reconcileOpportunityOutcome(
        records[index] as OpportunityLifecycleRecord,
        {
          observedAt: outcome.observedAt,
          realizedTotal: outcome.realizedTotal,
          baselineTotal: outcome.baselineTotal,
        },
        now(),
      );
      replaceRecord(transition.record, transition.event);
      return { record: cloneRecord(transition.record), event: transition.event };
    },
    events() {
      return [...eventLog];
    },
    snapshot() {
      return { schemaVersion: 1, records: [...records], events: [...eventLog] };
    },
  };
  return store;
}
