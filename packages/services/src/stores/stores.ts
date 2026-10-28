import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * Connected-store connection tier — mirrors the COMMITTED reader's tier
 * vocabulary (apps/zcode-cli/.../store-search/stores.ts), the single law for
 * both sides of the ~/.zcode/stores.json contract.
 */
export type StoreTier = "public" | "credential" | "web";

/**
 * Operator-review §5 connector authority vocabulary (additive record
 * metadata; v1 store_search connectors are read-only catalog readers).
 */
export type StoreAuthority = "read-only";

/**
 * Operator-review §5 evidence-class vocabulary, carried on probe results so
 * the UI can label every status honestly.
 */
export type StoreEvidenceClass =
  | "live API result"
  | "cached"
  | "public-page observation"
  | "inferred"
  | "unavailable";

/** The connector error taxonomy — identical codes to the committed tool. */
export type StoreConnectionErrorCode =
  | "invalid_credentials"
  | "insufficient_scope"
  | "rate_limited"
  | "platform_error"
  | "unreachable"
  | "timeout"
  | "not_configured"
  | "not_supported";

/** Etsy OpenAPI v3 personal access pair (keystring + user token). */
export interface StoreEtsyCredentials {
  apiKeyString: string;
  userToken: string;
}

/**
 * One connected-store record. The persisted shape is byte-compatible with the
 * COMMITTED reader's StoreRecord: {id, platform, domain, label, tier,
 * connectedAt?, status?, credentials?}. `lastCheckedAt` / `lastCheckCode` /
 * `authority` are ADDITIVE metadata the reader ignores defensively.
 */
export interface StoreConnectionRecord {
  id: string;
  platform: string;
  domain: string;
  label: string;
  tier: StoreTier;
  connectedAt?: string;
  status?: string;
  /** Tier-2 credentials, embedded per the reader contract (see storesService
   * header for the vault-first double-write tension). */
  credentials?: StoreEtsyCredentials;
  /** When the last health-check probe ran (ISO timestamp). */
  lastCheckedAt?: string;
  /** Taxonomy code of the last probe's honest answer. */
  lastCheckCode?: StoreConnectionErrorCode;
  /** Connector authority label (v1 connectors are read-only). */
  authority?: StoreAuthority;
}

/** list() view — the records plus an honest readError if the state file
 * exists but couldn't be read/parsed (same law as the reader). */
export interface StoreListResult {
  stores: StoreConnectionRecord[];
  readError?: string;
}

/** Etsy credentials, when the connect form carries them. */
export interface ConnectStoreInput {
  platform: string;
  url: string;
  label?: string;
  credentials?: StoreEtsyCredentials;
}

export type ConnectStoreOutcome =
  | {
      ok: true;
      store: StoreConnectionRecord;
      message: string;
      evidenceClass: StoreEvidenceClass;
    }
  | {
      ok: false;
      code: StoreConnectionErrorCode;
      message: string;
      evidenceClass?: StoreEvidenceClass;
    };

export interface TestConnectionOutcome {
  ok: boolean;
  /** Taxonomy code of the honest answer (invalid_credentials, not_supported, …). */
  code?: StoreConnectionErrorCode;
  /** The platform's verbatim message (never a paraphrase). */
  message: string;
  evidenceClass: StoreEvidenceClass;
}

export interface RemoveStoreOutcome {
  ok: boolean;
  message: string;
  /** FE3 law: honest report that the vault entry was destroyed (true for
   * Tier-2 records whose vault entry existed; false when there was nothing
   * to destroy). */
  credentialsDestroyed: boolean;
}

/**
 * Connected-store management service (settings-side, P4).
 *
 * Owns the WRITES to ~/.zcode/stores.json — the file the committed
 * store_search reader reads. The consumer (renderer) only talks to this
 * interface over RPC; credentials never enter renderer memory beyond the
 * form that submits them.
 */
export interface IStoresService {
  /** List the connected stores (plus an honest readError, never a silent empty). */
  list(): Promise<StoreListResult>;
  /** Connect a store (Tier-1 live-probes the public catalog first — a closed
   * or misclassified storefront is refused honestly, no record written). */
  connect(input: ConnectStoreInput): Promise<ConnectStoreOutcome>;
  /** Run the live health-check probe and persist the honest result. */
  test(params: { id: string }): Promise<TestConnectionOutcome>;
  /** Revoke a store: destroys the vault entry (if any) and the record. */
  remove(params: { id: string }): Promise<RemoveStoreOutcome>;
}

export const IStoresService = createServiceDescriptor<IStoresService>(
  ServiceChannels.Stores,
);
