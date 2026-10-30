// ============================================================
// Commerce harness — federation wire contract (the Commerce Network
// boundary's envelope layer; HARNESS-CONTRACT.md §1 L4/L5; issue #23 W2)
// ============================================================
//
// The federation lane's WIRE half: the envelope types, the canonical
// serialization, the privacy gate, envelope construction and the
// untrusted-input structural validation. The node that publishes/receives
// lives in ./federation.ts; this module is the contract the wire carries.
//
// LAWS (binding every consumer of this module):
//   - PRIVACY DEFAULT (the handoff W2 law): raw user intents stay local
//     unless the principal explicitly opted in (shareConsent basis
//     "shared-generalized"). The generalized projection carries NO query
//     text, NO user identity, NO address, NO private history, NO
//     credentials — only the generalized commerce shape: family, currency,
//     an optional exact price band, expiry, and a note synthesized from
//     those STRUCTURED fields alone (never from the candidate's free text,
//     which may embed the raw query).
//   - UNTRUSTED DATA (INV-26 discipline, the handoff W2 law): remote
//     payload strings are DATA, never instructions. Structural validation
//     inspects shapes only — string VALUES are never interpreted as
//     control, so adversarial note text can only ever be stored as inert
//     data. A remote evidenceClass claim is never honored (INV-30).
//   - INV-14: the projection's price band is exact money (string decimal +
//     explicit currency, BigInt-cents comparison), same currency
//     throughout; cross-currency comparison is never attempted, no FX is
//     ever invented.
//   - INV-15: envelopes are schema-versioned and content-addressed with
//     the lifecycle module's canonical-JSON FNV-1a hash (the shared
//     stableContentHash helper) — tampered or foreign-hashed content is
//     rejected structurally.
//
// Pure module: no I/O, no network, no wall clock — construction takes the
// caller's `now: Date`.

import type { HarnessMoney } from "./intent.js";
import { compareCents, formatHarnessMoney, parseMoneyToCents } from "./intent.js";
import { OPPORTUNITY_FAMILIES } from "./families.js";
import type { OpportunityFamilyId } from "./families.js";
import type { OpportunityLifecycleRecord } from "./opportunity-lifecycle.js";
import { canonicalJson, stableContentHash } from "./opportunity-lifecycle.js";

// ——— the wire contract ———

/** The federation envelope schema version (INV-15: versioned, migrated explicitly). */
export const FEDERATION_SCHEMA_VERSION = 1;

/** A received envelope that has already been forwarded more than this is a loop. */
export const FEDERATION_MAX_HOPS = 3;

/** Anti-abuse default: at most 10 accepted envelopes per origin per 60s window. */
export const FEDERATION_RATE_LIMIT_DEFAULT = {
  maxEnvelopesPerOrigin: 10,
  windowMs: 60_000,
} as const;

/** The quarantine cap: a serialized envelope larger than this never enters local state. */
export const FEDERATION_MAX_SERIALIZED_BYTES = 64 * 1024;

export type FederationEnvelopeKind = "opportunity-share" | "revocation" | "expiry";

/** An exact, same-currency price band (INV-14 — the only money the wire ever carries). */
export interface GeneralizedDemandBand {
  min: HarnessMoney;
  max: HarnessMoney;
}

/**
 * THE privacy-safe projection. Every field is generalized commerce shape:
 * an opaque record pointer, a contract family, a currency, an optional
 * exact price band, the locked evidence class, an expiry, and a short note
 * synthesized from these structured fields ALONE. There is deliberately NO
 * field in this type that COULD carry a query, an identity, an address, a
 * private history or a credential — the shape itself is the privacy law.
 */
export interface GeneralizedOpportunityProjection {
  /** The origin node's lifecycle record id — an opaque content hash, never user data. */
  recordId: string;
  family: OpportunityFamilyId;
  currency: string;
  priceBand?: GeneralizedDemandBand;
  /** LOCKED to "conditional" (INV-30): a shared opportunity is a conditional claim. */
  evidenceClass: "conditional";
  expiresAt: string | null;
  /** Short generalized note — inert DATA on the receiving side, never instructions. */
  note: string;
}

/** A revocation/expiry pointer — references an origin's record by opaque id only. */
export interface FederationPointer {
  recordId: string;
}

/** The federation envelope (content-addressed, schema-versioned, hop-counted). */
export interface FederationEnvelope {
  id: string;
  schemaVersion: number;
  kind: FederationEnvelopeKind;
  origin: { nodeId: string; publishedAt: string };
  payload: GeneralizedOpportunityProjection | FederationPointer;
  hopCount: number;
  /** stableContentHash over { schemaVersion, kind, payload } — the canonical content. */
  contentHash: string;
}

/**
 * The Commerce Network transport PORT. The caller binds the real wire; the
 * tests bind createInMemoryCommerceNetwork() below (the wire they inspect).
 */
export interface CommerceNetworkTransport {
  publish(envelope: FederationEnvelope): void;
  delivered(): FederationEnvelope[];
}

/** The in-memory test wire (labelled fixture tier — never production transport). */
export interface InMemoryCommerceNetwork extends CommerceNetworkTransport {
  /** Everything ever published on this wire, in order (the privacy-scan surface). */
  published(): FederationEnvelope[];
}

/** The in-memory Commerce Network the two-node tests bind. */
export function createInMemoryCommerceNetwork(): InMemoryCommerceNetwork {
  const envelopes: FederationEnvelope[] = [];
  return {
    publish(envelope: FederationEnvelope): void {
      envelopes.push(envelope);
    },
    delivered(): FederationEnvelope[] {
      return [...envelopes];
    },
    published(): FederationEnvelope[] {
      return [...envelopes];
    },
  };
}

// ——— canonical serialization (the wire format tests scan and tamper with) ———

/** Serialize an envelope to canonical JSON (sorted keys — deterministic bytes). */
export function serializeEnvelope(envelope: FederationEnvelope): string {
  return canonicalJson(envelope);
}

/** The structural parse result. The parser is NEVER trusted — receive() re-validates. */
export type DeserializeEnvelopeResult =
  | { ok: true; envelope: FederationEnvelope }
  | { ok: false; reason: string };

/** Parse canonical JSON back into an envelope, validating structure only. */
export function deserializeEnvelope(text: string): DeserializeEnvelopeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const structure = validateEnvelopeStructure(parsed);
  if (!structure.ok) {
    return { ok: false, reason: structure.reason };
  }
  return { ok: true, envelope: parsed as FederationEnvelope };
}

// ——— the privacy gate ———

/** Why a record may not be shared. The privacy default is "private-intent". */
export type NotShareableReason = "private-intent" | "not-active" | "no-generalized-shape";

export type GeneralizeForSharingResult =
  | { shareable: true; projection: GeneralizedOpportunityProjection }
  | { shareable: false; reason: NotShareableReason };

/**
 * Is the band exact, same-currency, and ordered? Outbound leniency: an
 * invalid band is DROPPED (never repaired, never invented); inbound
 * untrusted bands are rejected outright by the structure validator.
 */
function validBand(
  band: GeneralizedDemandBand | undefined,
  currency: string,
): band is GeneralizedDemandBand {
  if (band === undefined) return false;
  if (band.min.currency !== currency || band.max.currency !== currency) return false;
  const minCents = parseMoneyToCents(band.min.amount);
  const maxCents = parseMoneyToCents(band.max.amount);
  if (minCents === null || maxCents === null) return false;
  return compareCents(minCents, maxCents) <= 0;
}

/** Synthesize the projection note from STRUCTURED fields only — never candidate free text. */
function buildNote(
  family: OpportunityFamilyId,
  currency: string,
  band: GeneralizedDemandBand | undefined,
  expiresAt: string | null,
): string {
  const bandText =
    band === undefined
      ? "no price band stated"
      : `band ${formatHarnessMoney(band.min)} to ${formatHarnessMoney(band.max)}`;
  const expiryText =
    expiresAt === null ? "no expiry (prediction-grade)" : `expires ${expiresAt}`;
  return (
    `Generalized ${family} demand signal, currency ${currency}, ${bandText}, conditional, ${expiryText}. ` +
    "No user-identifying content is carried."
  );
}

/**
 * THE privacy gate: a record is shareable ONLY when the principal opted in
 * (basis "shared-generalized") AND the record is still active AND a
 * generalized shape was registered. Everything else stays local — the
 * projection is built from the record's structured fields alone, so no
 * query text, identity, address, private history or credential can leak
 * even by accident: those strings simply have no path into this function.
 */
export function generalizeForSharing(record: OpportunityLifecycleRecord): GeneralizeForSharingResult {
  if (record.shareConsent.basis !== "shared-generalized") {
    return { shareable: false, reason: "private-intent" };
  }
  if (record.status !== "active") {
    return { shareable: false, reason: "not-active" };
  }
  if (record.generalized === null) {
    return { shareable: false, reason: "no-generalized-shape" };
  }
  const { currency } = record.generalized;
  const band = validBand(record.generalized.priceBand, currency)
    ? record.generalized.priceBand
    : undefined;
  const projection: GeneralizedOpportunityProjection = {
    recordId: record.id,
    family: record.candidate.family,
    currency,
    evidenceClass: "conditional",
    expiresAt: record.expiresAt,
    note: buildNote(record.candidate.family, currency, band, record.expiresAt),
  };
  if (band !== undefined) {
    projection.priceBand = band;
  }
  return { shareable: true, projection };
}

// ——— envelope construction ———

/**
 * Build a well-formed, content-addressed envelope (hopCount 0 — this module
 * never forwards; the exported builder lets tests craft VALID envelopes,
 * including adversarial ones, without hand-hashing).
 */
export function buildFederationEnvelope(
  kind: FederationEnvelopeKind,
  payload: GeneralizedOpportunityProjection | FederationPointer,
  originNodeId: string,
  now: Date,
): FederationEnvelope {
  const publishedAt = now.toISOString();
  const contentHash = stableContentHash({
    schemaVersion: FEDERATION_SCHEMA_VERSION,
    kind,
    payload,
  });
  return {
    id: `env_${stableContentHash({ contentHash, originNodeId, publishedAt })}`,
    schemaVersion: FEDERATION_SCHEMA_VERSION,
    kind,
    origin: { nodeId: originNodeId, publishedAt },
    payload,
    hopCount: 0,
    contentHash,
  };
}

// ——— untrusted-input structural validation ———

type StructureCheck = { ok: true } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHarnessMoneyShape(value: unknown): value is HarnessMoney {
  return isRecord(value) && typeof value.amount === "string" && typeof value.currency === "string";
}

function validateProjectionStructure(payload: Record<string, unknown>): StructureCheck {
  if (typeof payload.recordId !== "string" || payload.recordId.length === 0) {
    return { ok: false, reason: "projection.recordId must be a non-empty string" };
  }
  if (
    typeof payload.family !== "string" ||
    !OPPORTUNITY_FAMILIES.includes(payload.family as OpportunityFamilyId)
  ) {
    return { ok: false, reason: "projection.family must be one of the eight contract families" };
  }
  if (typeof payload.currency !== "string" || payload.currency.length === 0) {
    return { ok: false, reason: "projection.currency must be a non-empty currency code" };
  }
  if (payload.expiresAt !== null && typeof payload.expiresAt !== "string") {
    return { ok: false, reason: "projection.expiresAt must be an ISO timestamp string or null" };
  }
  if (typeof payload.expiresAt === "string" && !Number.isFinite(Date.parse(payload.expiresAt))) {
    return { ok: false, reason: "projection.expiresAt must be a parseable ISO timestamp" };
  }
  if (typeof payload.note !== "string") {
    return { ok: false, reason: "projection.note must be a string (untrusted DATA — never interpreted)" };
  }
  if (payload.evidenceClass !== undefined && typeof payload.evidenceClass !== "string") {
    return {
      ok: false,
      reason: "projection.evidenceClass, when present, must be a string (its VALUE is an untrusted claim — never honored)",
    };
  }
  if (payload.priceBand !== undefined) {
    if (!isRecord(payload.priceBand)) {
      return { ok: false, reason: "projection.priceBand must be { min, max } exact money" };
    }
    const min = payload.priceBand.min;
    const max = payload.priceBand.max;
    if (!isHarnessMoneyShape(min) || !isHarnessMoneyShape(max)) {
      return { ok: false, reason: "projection.priceBand min/max must be { amount, currency }" };
    }
    if (min.currency !== payload.currency || max.currency !== payload.currency) {
      return { ok: false, reason: "projection.priceBand currencies must match the projection currency (no FX is invented)" };
    }
    const minCents = parseMoneyToCents(min.amount);
    const maxCents = parseMoneyToCents(max.amount);
    if (minCents === null || maxCents === null) {
      return { ok: false, reason: "projection.priceBand amounts must be exact decimal strings (at most two fraction digits)" };
    }
    if (compareCents(minCents, maxCents) > 0) {
      return { ok: false, reason: "projection.priceBand min must not exceed max" };
    }
  }
  return { ok: true };
}

/**
 * Structural validation of an (untrusted) envelope: required fields, schema
 * version, closed kind set, payload shape, and — LAST within structure —
 * contentHash integrity against the recomputed canonical content. This
 * never inspects payload VALUES as semantics: strings are data.
 */
export function validateEnvelopeStructure(value: unknown): StructureCheck {
  if (!isRecord(value)) {
    return { ok: false, reason: "envelope is not a JSON object" };
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return { ok: false, reason: "envelope.id must be a non-empty string" };
  }
  if (value.schemaVersion !== FEDERATION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `envelope.schemaVersion must be ${FEDERATION_SCHEMA_VERSION} (got ${String(value.schemaVersion)})`,
    };
  }
  if (
    value.kind !== "opportunity-share" &&
    value.kind !== "revocation" &&
    value.kind !== "expiry"
  ) {
    return { ok: false, reason: "envelope.kind must be one of opportunity-share | revocation | expiry" };
  }
  if (!isRecord(value.origin)) {
    return { ok: false, reason: "envelope.origin must be an object { nodeId, publishedAt }" };
  }
  if (typeof value.origin.nodeId !== "string") {
    return { ok: false, reason: "envelope.origin.nodeId must be a string" };
  }
  if (typeof value.origin.publishedAt !== "string") {
    return { ok: false, reason: "envelope.origin.publishedAt must be an ISO timestamp string" };
  }
  if (
    typeof value.hopCount !== "number" ||
    !Number.isInteger(value.hopCount) ||
    value.hopCount < 0
  ) {
    return { ok: false, reason: "envelope.hopCount must be a non-negative integer" };
  }
  if (typeof value.contentHash !== "string" || value.contentHash.length === 0) {
    return { ok: false, reason: "envelope.contentHash must be a non-empty string" };
  }
  if (!isRecord(value.payload)) {
    return { ok: false, reason: "envelope.payload must be an object" };
  }
  if (value.kind === "opportunity-share") {
    const payloadCheck = validateProjectionStructure(value.payload);
    if (!payloadCheck.ok) {
      return payloadCheck;
    }
  } else if (typeof value.payload.recordId !== "string" || value.payload.recordId.length === 0) {
    return {
      ok: false,
      reason: `a ${String(value.kind)} payload must carry a non-empty recordId pointer`,
    };
  }
  const expectedHash = stableContentHash({
    schemaVersion: FEDERATION_SCHEMA_VERSION,
    kind: value.kind,
    payload: value.payload,
  });
  if (expectedHash !== value.contentHash) {
    return {
      ok: false,
      reason: "envelope.contentHash does not match the canonical envelope content — tampered or foreign-hashed",
    };
  }
  return { ok: true };
}
