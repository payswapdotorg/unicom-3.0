// ============================================================
// Commerce harness — W2/W3 opportunity federation, the Commerce Network
// node (HARNESS-CONTRACT.md §1 L4/L5 distribution; issue #23 W2)
// ============================================================
//
// The two-node federation lane (handoff 2026-10-28, acceptance evidence #2):
// consented, GENERALIZED opportunity projections travel between isolated
// UNiCOM nodes through a transport PORT — the caller binds the real wire;
// tests bind the in-memory network from ./federation-wire.ts. The wire
// contract itself (envelope types, serialization, the privacy gate,
// construction, structural validation) lives in ./federation-wire.ts and is
// re-exported below so consumers keep ONE import face. Nothing here
// performs I/O.
//
// LAWS (binding every consumer of this module):
//   - PRIVACY DEFAULT (the handoff W2 law): the privacy gate runs FIRST,
//     before any transport interaction — a private record never touches
//     the wire and leaves no wire trace whatsoever.
//   - UNTRUSTED DATA (INV-26 discipline, the handoff W2 law): remote
//     payload strings are DATA, never instructions. No field is evaluated
//     or interpreted as control — adversarial note text is stored verbatim
//     as inert data and changes nothing. A received projection is stored
//     with evidenceClass "conditional" and remote provenance; a remote
//     claim NEVER becomes "observed" (INV-30) — a claimed evidenceClass is
//     ignored and overridden, not honored.
//   - MATCH PURITY (the handoff W2 law): a match NEVER reserves, buys,
//     publishes, messages, or authorizes anything. matchLocalIntent only
//     reads state and returns data.
//   - FORWARDING-LOOP PREVENTION: nodes never re-broadcast received
//     records (publishSharedOpportunity refuses remote-origin record ids),
//     receive() NEVER publishes (ingest only), hopCount >
//     FEDERATION_MAX_HOPS is rejected as a forwarding loop, and a node
//     never re-ingests its own publications as remote records.
//   - INV-14: budget-band compatibility is compared in exact cents,
//     same-currency only; cross-currency never converts — the intent is
//     simply not a match.
//   - INV-15: dedupe by contentHash is idempotent — no double side
//     effects, ever.
//
// Pure module: no I/O, no network, no wall clock — the node takes an
// injected clock (`now: () => Date`).

import type { CommerceIntentEnvelope } from "./intent.js";
import { compareCents, parseMoneyToCents } from "./intent.js";
import { OPPORTUNITY_FAMILIES } from "./families.js";
import type { OpportunityFamilyId } from "./families.js";
import type { OpportunityLifecycleRecord } from "./opportunity-lifecycle.js";
import { OPPORTUNITY_CLOCK_SKEW_MS, expireStaleOpportunities } from "./opportunity-lifecycle.js";
import {
  FEDERATION_MAX_HOPS,
  FEDERATION_MAX_SERIALIZED_BYTES,
  FEDERATION_RATE_LIMIT_DEFAULT,
  buildFederationEnvelope,
  generalizeForSharing,
  serializeEnvelope,
  validateEnvelopeStructure,
} from "./federation-wire.js";
import type {
  CommerceNetworkTransport,
  FederationEnvelope,
  FederationPointer,
  GeneralizedDemandBand,
  GeneralizedOpportunityProjection,
  NotShareableReason,
} from "./federation-wire.js";

// ——— the wire surface, re-exported (ONE import face for consumers) ———

export {
  FEDERATION_MAX_HOPS,
  FEDERATION_MAX_SERIALIZED_BYTES,
  FEDERATION_RATE_LIMIT_DEFAULT,
  FEDERATION_SCHEMA_VERSION,
  buildFederationEnvelope,
  createInMemoryCommerceNetwork,
  deserializeEnvelope,
  generalizeForSharing,
  serializeEnvelope,
  validateEnvelopeStructure,
} from "./federation-wire.js";
export type {
  CommerceNetworkTransport,
  DeserializeEnvelopeResult,
  FederationEnvelope,
  FederationEnvelopeKind,
  FederationPointer,
  GeneralizedDemandBand,
  GeneralizedOpportunityProjection,
  GeneralizeForSharingResult,
  InMemoryCommerceNetwork,
  NotShareableReason,
} from "./federation-wire.js";

// ——— the node ———

/** Per-envelope receive verdicts — one reason per validation-chain stage. */
export type FederationReceiveVerdictKind =
  | "accepted"
  | "invalid-structure"
  | "bad-provenance"
  | "expired"
  | "duplicate"
  | "rate-limited"
  | "forwarding-loop"
  | "quarantined";

export interface FederationReceiveVerdict {
  envelopeId: string | null;
  verdict: FederationReceiveVerdictKind;
  reason: string;
}

/** A received projection stored locally — conditional by law, remote-provenanced. */
export interface FederatedOpportunityRecord {
  /** The origin's lifecycle record id (opaque pointer). */
  id: string;
  origin: { nodeId: string; publishedAt: string; contentHash: string; receivedAt: string };
  projection: GeneralizedOpportunityProjection;
  status: "active" | "expired" | "revoked";
  /** ALWAYS "conditional" — a remote claim never upgrades (INV-30). */
  evidenceClass: "conditional";
  /** The ignored remote evidenceClass claim, when one was made (audit of the override). */
  claimedEvidenceClassIgnored: string | null;
  revocation: { revokedAt: string; reason: string } | null;
}

export interface FederationLocalRecords {
  /** The node's own lifecycle records (registered by successful publication). */
  local: OpportunityLifecycleRecord[];
  /** Records received from the wire — remote provenance, conditional by law. */
  received: FederatedOpportunityRecord[];
}

/** A pure match report — a match never reserves, buys, publishes, messages or authorizes. */
export interface FederationIntentMatch {
  recordId: string;
  family: OpportunityFamilyId;
  originNodeId: string;
  currency: string;
  priceBand?: GeneralizedDemandBand;
  /** true | false when comparable (same currency + band); "unknown" otherwise (INV-10). */
  budgetCompatible: boolean | "unknown";
  matchBasis: string;
}

export type FederationPublishResult =
  | { published: true; envelope: FederationEnvelope }
  | { published: false; reason: NotShareableReason | "remote-record" | "empty-record-id" };

export interface FederationNodeOptions {
  nodeId: string;
  transport: CommerceNetworkTransport;
  /** Anti-abuse limits; defaults to FEDERATION_RATE_LIMIT_DEFAULT. */
  limits?: { maxEnvelopesPerOrigin: number; windowMs: number };
  /** The injected clock — no wall clock is ever read inside this module. */
  now: () => Date;
}

export interface FederationNode {
  readonly nodeId: string;
  /** Privacy gate FIRST: a private record NEVER touches the wire. */
  publishSharedOpportunity(record: OpportunityLifecycleRecord): FederationPublishResult;
  /** Publish a revocation pointer for one of this node's own records. */
  publishRevocation(recordId: string): FederationPublishResult;
  /** Publish an expiry pointer for one of this node's own records. */
  publishExpiry(recordId: string): FederationPublishResult;
  /**
   * Ingest every FOREIGN delivered envelope, in order, through the full
   * validation chain (structure → provenance → expiry → dedupe → rate →
   * hops → size), returning one verdict per envelope. Self-origin
   * publications are skipped — a node never re-ingests its own records as
   * remote data. receive() NEVER publishes and first advances the local
   * lifecycle (own + received records) through the expiry sweep.
   */
  receive(): FederationReceiveVerdict[];
  localRecords(): FederationLocalRecords;
  /** Pure read: match received generalized opportunities against a local intent. */
  matchLocalIntent(intent: CommerceIntentEnvelope): FederationIntentMatch[];
}

/** Create a federation node bound to a transport port and an injected clock. */
export function createFederationNode(options: FederationNodeOptions): FederationNode {
  const nodeId = options.nodeId;
  const transport = options.transport;
  const limits = options.limits ?? FEDERATION_RATE_LIMIT_DEFAULT;
  const now = options.now;

  let ownRecords: OpportunityLifecycleRecord[] = [];
  const receivedRecords: FederatedOpportunityRecord[] = [];
  const seenContentHashes = new Set<string>();
  const remoteRecordOrigins = new Map<string, string>();
  const rateLog: { origin: string; at: number }[] = [];

  function envelopeIdOf(envelope: FederationEnvelope): string | null {
    return typeof envelope?.id === "string" ? envelope.id : null;
  }

  function envelopeOriginNodeId(envelope: FederationEnvelope): string | null {
    const origin = (envelope as { origin?: { nodeId?: unknown } })?.origin;
    return typeof origin?.nodeId === "string" ? origin.nodeId : null;
  }

  function publishSharedOpportunity(record: OpportunityLifecycleRecord): FederationPublishResult {
    // PRIVACY GATE FIRST — before ANY transport interaction, a private record
    // is refused outright and leaves no wire trace whatsoever.
    const generalized = generalizeForSharing(record);
    if (!generalized.shareable) {
      return { published: false, reason: generalized.reason };
    }
    // Forwarding-loop prevention at the source: this record id is known to
    // have arrived from a REMOTE origin — a node never re-broadcasts another
    // node's records, even if they are re-registered locally.
    if (remoteRecordOrigins.get(record.id) !== undefined) {
      return { published: false, reason: "remote-record" };
    }
    const envelope = buildFederationEnvelope(
      "opportunity-share",
      generalized.projection,
      nodeId,
      now(),
    );
    transport.publish(envelope);
    ownRecords = [...ownRecords, record];
    return { published: true, envelope };
  }

  function publishPointerEnvelope(
    kind: "revocation" | "expiry",
    recordId: string,
  ): FederationPublishResult {
    if (recordId.trim().length === 0) {
      return { published: false, reason: "empty-record-id" };
    }
    const envelope = buildFederationEnvelope(kind, { recordId }, nodeId, now());
    transport.publish(envelope);
    return { published: true, envelope };
  }

  function expireStaleReceivedRecords(nowMs: number): void {
    for (const record of receivedRecords) {
      if (record.status !== "active" || record.projection.expiresAt === null) continue;
      const expiresMs = Date.parse(record.projection.expiresAt);
      if (Number.isFinite(expiresMs) && nowMs >= expiresMs) {
        record.status = "expired";
      }
    }
  }

  function applyEnvelope(envelope: FederationEnvelope, nowDate: Date): void {
    if (envelope.kind === "opportunity-share") {
      const payload = envelope.payload as GeneralizedOpportunityProjection;
      // The remote evidenceClass claim is DATA: read it only to record that
      // it was ignored — the stored projection is "conditional" by law.
      const claimed = (envelope.payload as { evidenceClass?: unknown }).evidenceClass;
      const claimedIgnored =
        typeof claimed === "string" && claimed !== "conditional"
          ? `remote evidenceClass claim "${claimed}" ignored — received projections are conditional by law (INV-30)`
          : null;
      const storedProjection: GeneralizedOpportunityProjection = {
        recordId: payload.recordId,
        family: payload.family,
        currency: payload.currency,
        evidenceClass: "conditional",
        expiresAt: payload.expiresAt,
        note: payload.note, // inert DATA — stored verbatim, never interpreted
      };
      if (payload.priceBand !== undefined) {
        storedProjection.priceBand = payload.priceBand;
      }
      receivedRecords.push({
        id: payload.recordId,
        origin: {
          nodeId: envelope.origin.nodeId,
          publishedAt: envelope.origin.publishedAt,
          contentHash: envelope.contentHash,
          receivedAt: nowDate.toISOString(),
        },
        projection: storedProjection,
        status: "active",
        evidenceClass: "conditional",
        claimedEvidenceClassIgnored: claimedIgnored,
        revocation: null,
      });
      remoteRecordOrigins.set(payload.recordId, envelope.origin.nodeId);
      return;
    }
    // Revocation / expiry pointers: they flip only records that ORIGINATED
    // from the same node — a foreign revocation pointer can never revoke
    // another origin's records.
    const pointer = envelope.payload as FederationPointer;
    for (const record of receivedRecords) {
      if (record.id !== pointer.recordId || record.origin.nodeId !== envelope.origin.nodeId) {
        continue;
      }
      if (envelope.kind === "revocation") {
        record.status = "revoked";
        record.revocation = {
          revokedAt: nowDate.toISOString(),
          reason: `remote revocation published by ${envelope.origin.nodeId} at ${envelope.origin.publishedAt}`,
        };
      } else if (record.status === "active") {
        record.status = "expired";
      }
    }
  }

  function processEnvelope(envelope: FederationEnvelope, nowDate: Date): FederationReceiveVerdict {
    const nowMs = nowDate.getTime();

    // 1. structure / schema version / required fields / content integrity
    const structure = validateEnvelopeStructure(envelope);
    if (!structure.ok) {
      return { envelopeId: envelopeIdOf(envelope), verdict: "invalid-structure", reason: structure.reason };
    }

    // 2. provenance: non-empty origin, sane publishedAt, not from the future
    //    beyond the clock-skew tolerance.
    if (envelope.origin.nodeId.trim().length === 0) {
      return {
        envelopeId: envelope.id,
        verdict: "bad-provenance",
        reason: "envelope.origin.nodeId is empty",
      };
    }
    const publishedMs = Date.parse(envelope.origin.publishedAt);
    if (!Number.isFinite(publishedMs)) {
      return {
        envelopeId: envelope.id,
        verdict: "bad-provenance",
        reason: "envelope.origin.publishedAt is not a parseable timestamp",
      };
    }
    if (publishedMs - nowMs > OPPORTUNITY_CLOCK_SKEW_MS) {
      return {
        envelopeId: envelope.id,
        verdict: "bad-provenance",
        reason: `envelope.origin.publishedAt ${envelope.origin.publishedAt} is from the future beyond the ${OPPORTUNITY_CLOCK_SKEW_MS}ms clock-skew tolerance`,
      };
    }

    // 3. expiry: a share whose payload expiry already passed never surfaces.
    if (envelope.kind === "opportunity-share") {
      const payload = envelope.payload as GeneralizedOpportunityProjection;
      if (payload.expiresAt !== null) {
        const expiresMs = Date.parse(payload.expiresAt);
        if (Number.isFinite(expiresMs) && nowMs >= expiresMs) {
          return {
            envelopeId: envelope.id,
            verdict: "expired",
            reason: `the projected opportunity expired at ${payload.expiresAt} — expired content never surfaces`,
          };
        }
      }
    }

    // 4. dedupe by contentHash — idempotent, no double side effects. The
    //    hash is only marked seen once the envelope is fully accepted.
    if (seenContentHashes.has(envelope.contentHash)) {
      return {
        envelopeId: envelope.id,
        verdict: "duplicate",
        reason: `contentHash ${envelope.contentHash} was already processed — idempotent, no side effects`,
      };
    }

    // 5. rate limit: accepted envelopes per origin per trailing window.
    while (rateLog.length > 0 && nowMs - (rateLog[0]?.at ?? nowMs) > limits.windowMs) {
      rateLog.shift();
    }
    const originCount = rateLog.filter((entry) => entry.origin === envelope.origin.nodeId).length;
    if (originCount >= limits.maxEnvelopesPerOrigin) {
      return {
        envelopeId: envelope.id,
        verdict: "rate-limited",
        reason: `origin ${envelope.origin.nodeId} already delivered ${originCount} accepted envelopes within the ${limits.windowMs}ms window (limit ${limits.maxEnvelopesPerOrigin})`,
      };
    }

    // 6. hop count: a forwarded-past-the-max envelope is a loop.
    if (envelope.hopCount > FEDERATION_MAX_HOPS) {
      return {
        envelopeId: envelope.id,
        verdict: "forwarding-loop",
        reason: `hopCount ${envelope.hopCount} exceeds FEDERATION_MAX_HOPS ${FEDERATION_MAX_HOPS} — forwarding loop`,
      };
    }

    // 7. size: an oversized serialized envelope is quarantined, never stored.
    const serialized = serializeEnvelope(envelope);
    const serializedBytes = new TextEncoder().encode(serialized).length;
    if (serializedBytes > FEDERATION_MAX_SERIALIZED_BYTES) {
      return {
        envelopeId: envelope.id,
        verdict: "quarantined",
        reason: `serialized envelope is ${serializedBytes} bytes — over the ${FEDERATION_MAX_SERIALIZED_BYTES}-byte quarantine cap`,
      };
    }

    // Accepted: apply side effects, then mark seen + rate-logged.
    applyEnvelope(envelope, nowDate);
    seenContentHashes.add(envelope.contentHash);
    rateLog.push({ origin: envelope.origin.nodeId, at: nowMs });
    const acceptedReason =
      envelope.kind === "opportunity-share"
        ? `valid opportunity-share from ${envelope.origin.nodeId} stored as a CONDITIONAL remote projection (content ${envelope.contentHash})`
        : `${envelope.kind} pointer from ${envelope.origin.nodeId} applied to matching received records`;
    return { envelopeId: envelope.id, verdict: "accepted", reason: acceptedReason };
  }

  function receive(): FederationReceiveVerdict[] {
    const nowDate = now();
    const nowMs = nowDate.getTime();
    // The lifecycle law advances first: the node's OWN records expire via
    // expireStaleOpportunities (typed transitions, version bumps), and the
    // RECEIVED records expire against their projected expiry.
    ownRecords = expireStaleOpportunities(ownRecords, nowDate).records;
    expireStaleReceivedRecords(nowMs);
    const foreign = transport.delivered().filter(
      (envelope) => envelopeOriginNodeId(envelope) !== nodeId,
    );
    return foreign.map((envelope) => processEnvelope(envelope, nowDate));
  }

  function localRecords(): FederationLocalRecords {
    return {
      local: [...ownRecords],
      received: receivedRecords.map((record) => ({
        ...record,
        origin: { ...record.origin },
        projection: { ...record.projection },
      })),
    };
  }

  function matchLocalIntent(intent: CommerceIntentEnvelope): FederationIntentMatch[] {
    // PURE READ: no transport call, no state change, no publication — a
    // match never reserves, buys, publishes, messages, or authorizes.
    const budget = intent.maxLandedTotalCost;
    const matches: FederationIntentMatch[] = [];
    for (const record of receivedRecords) {
      if (record.status !== "active") continue;
      if (!OPPORTUNITY_FAMILIES.includes(record.projection.family)) continue;
      // Cross-currency never converts (INV-14): an intent with a stated
      // budget in a different currency is simply not a match.
      if (budget !== undefined && budget.currency !== record.projection.currency) continue;
      const band = record.projection.priceBand;
      let budgetCompatible: boolean | "unknown" = "unknown";
      if (budget !== undefined && band !== undefined) {
        const budgetCents = parseMoneyToCents(budget.amount);
        const maxCents = parseMoneyToCents(band.max.amount);
        if (budgetCents !== null && maxCents !== null) {
          budgetCompatible = compareCents(maxCents, budgetCents) <= 0;
        }
      }
      const budgetText =
        budgetCompatible === "unknown"
          ? "unknown (no comparable same-currency budget band)"
          : budgetCompatible
            ? "compatible (the projected band fits the stated budget)"
            : "incompatible (the projected band exceeds the stated budget)";
      const match: FederationIntentMatch = {
        recordId: record.id,
        family: record.projection.family,
        originNodeId: record.origin.nodeId,
        currency: record.projection.currency,
        budgetCompatible,
        matchBasis:
          `family ${record.projection.family} is one of the eight contract counterfactual families; the projection is ` +
          `active and same-currency (${record.projection.currency}); budget band: ${budgetText}. A match NEVER ` +
          "reserves, buys, publishes, messages, or authorizes anything (issue #23 W2 law).",
      };
      if (band !== undefined) {
        match.priceBand = band;
      }
      matches.push(match);
    }
    return matches;
  }

  return {
    nodeId,
    publishSharedOpportunity,
    publishRevocation: (recordId: string) => publishPointerEnvelope("revocation", recordId),
    publishExpiry: (recordId: string) => publishPointerEnvelope("expiry", recordId),
    receive,
    localRecords,
    matchLocalIntent,
  };
}
