// ============================================================
// Store search - connected-store state reader (defensive)
// ============================================================
//
// The store-connection records live in per-user JSON state under ~/.zcode —
// the same convention the CLI already uses (saved-workflows store reads
// ~/.zcode/workflows; the credential vault lives in ~/.zcode/v2). The
// StoresService (settings-side, P4) owns the WRITES; this reader only reads,
// defensively: a missing file is the normal zero-stores state (never an
// error), a corrupt or wrong-shaped file is reported honestly through
// `readError` instead of being silently turned into "no stores connected",
// and every record is shape-guarded before use.
//
// Both on-disk shapes are accepted so the reader cannot drift from the
// writer: a top-level array, or { "stores": [ ... ] }.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StoreCredentials } from "./types.js";

/** Connection tier: public catalog (no credentials), credential-gated, or
 * delegated web search (no API — e.g. Whatnot; surfaced in the notice). */
export type StoreTier = "public" | "credential" | "web";

/** One connected-store record (REPORT.md section 5). */
export interface StoreRecord {
  id: string;
  platform: string;
  domain: string;
  label: string;
  tier: StoreTier;
  connectedAt?: string;
  status?: string;
  /** Tier-2 credentials, when the state carries them; guarded per-platform. */
  credentials?: StoreCredentials;
}

export interface ConnectedStoresState {
  stores: StoreRecord[];
  /** Honest note when a state file exists but couldn't be read/parsed. */
  readError?: string;
}

/**
 * Candidate state files, in priority order.
 *
 * CANONICAL (the P4 StoresService writer contract): {base}/.zcode/stores.json
 * holding { "stores": StoreRecord[] } (a bare top-level array is also read
 * defensively). {base} is $ZCODE_DATA_BASE_DIR/.zcode when the desktop sets
 * it (README "configurable data directory"), else ~/.zcode.
 * The v2 sibling is a defensive fallback only (the credential vault lives
 * under .zcode/v2 — a writer landing there is still read, first-wins).
 */
export function connectedStoresFilePaths(homeDir?: string): string[] {
  const base = homeDir?.trim() || process.env.ZCODE_DATA_BASE_DIR?.trim() || homedir();
  return [
    join(base, ".zcode", "stores.json"),
    join(base, ".zcode", "v2", "stores.json"),
  ];
}

/** Raw record shape guard: a JSON object with non-empty platform + domain
 * strings (the same guard style as the FE3 credential guards; the rest of the
 * fields stay unknown and are each checked before use). */
interface RawStoreRecord {
  platform: string;
  domain: string;
}

function isRawRecord(v: unknown): v is RawStoreRecord & Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec.platform === "string" &&
    rec.platform.trim().length > 0 &&
    typeof rec.domain === "string" &&
    rec.domain.trim().length > 0
  );
}

function inferTier(platform: string, stated: unknown): StoreTier {
  if (stated === "public" || stated === "credential" || stated === "web") return stated;
  const p = platform.trim().toLowerCase();
  if (p === "etsy" || p === "ebay" || p === "amazon") return "credential";
  if (p === "whatnot") return "web";
  return "public";
}

function toStoreRecord(v: unknown, index: number): StoreRecord | null {
  if (!isRawRecord(v)) return null;
  const platform = v.platform.trim();
  const domain = v.domain.trim();
  const label =
    typeof v.label === "string" && v.label.trim().length > 0 ? v.label.trim() : domain;
  return {
    id: typeof v.id === "string" && v.id.length > 0 ? v.id : `store-${index}`,
    platform,
    domain,
    label,
    tier: inferTier(platform, v.tier),
    ...(typeof v.connectedAt === "string" ? { connectedAt: v.connectedAt } : {}),
    ...(typeof v.status === "string" && v.status.length > 0 ? { status: v.status } : {}),
    ...(v.credentials !== undefined ? { credentials: v.credentials as StoreCredentials } : {}),
  };
}

function extractRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const stores = (parsed as Record<string, unknown>).stores;
    if (Array.isArray(stores)) return stores;
  }
  return [];
}

/**
 * Read the connected-store records. Missing file(s) -> the normal empty state.
 * An existing-but-unreadable file -> empty list + an honest `readError` (the
 * tool surfaces it in its notice instead of pretending there are no stores).
 */
export async function readConnectedStores(homeDir?: string): Promise<ConnectedStoresState> {
  let readError: string | undefined;

  for (const path of connectedStoresFilePaths(homeDir)) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") continue; // normal absence
      readError = `Connected-stores state at ${path} could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`;
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      readError = `Connected-stores state at ${path} is not valid JSON (${
        error instanceof Error ? error.message : String(error)
      }) — fix or remove the file, then retry.`;
      break;
    }

    const records = extractRecords(parsed);
    if (records.length === 0 && !Array.isArray(parsed)) {
      readError = `Connected-stores state at ${path} has an unexpected shape (expected an array of store records or { "stores": [...] }).`;
      break;
    }
    const stores = records
      .map((record, index) => toStoreRecord(record, index))
      .filter((record): record is StoreRecord => record !== null);
    return { stores };
  }

  if (readError !== undefined) return { stores: [], readError };
  return { stores: [] };
}

/** Record statuses that mean "do not search this store". */
const DISCONNECTED_STATUSES = new Set(["disconnected", "revoked", "removed"]);

/** Is this record searchable right now? Unknown statuses default to searchable
 * (defensive: the service owns the status enum, a search attempt is honest). */
export function isSearchableStore(record: StoreRecord): boolean {
  return record.tier !== "web" && !DISCONNECTED_STATUSES.has(record.status ?? "");
}
