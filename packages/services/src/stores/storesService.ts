// ============================================================
// Connected Stores — the settings-side StoresService (P4 writer)
// ============================================================
//
// Owns the WRITES to {dataBaseDir}/.zcode/stores.json. The file is read by the
// COMMITTED store_search reader (apps/zcode-cli/packages/core/src/tool/
// handlers/store-search/stores.ts), so the on-disk shape is byte-compatible
// with it by law: { "stores": StoreRecord[] } holding
// {id, platform, domain, label, tier, connectedAt?, status?, credentials?}.
//
// HONEST TENSION (documented per the work order's stop clause): the committed
// READER expects Tier-2 Etsy credentials EMBEDDED in the record
// (record.credentials, guarded by isEtsyCredentials) — a vault-only record
// would make store_search answer not_configured for a store the settings UI
// just connected. The reader is the consumer and its contract wins, so
// connect() does a VAULT-FIRST DOUBLE WRITE: the credentialService vault
// entry (`store-connection:{id}`, AES-256-GCM encrypted, value =
// {"platform","credentials"}) is the authoritative store, and the record
// embeds the same credentials so the tool can search. remove() destroys BOTH
// honestly (FE3 law: credentialsDestroyed).
//
// Probe semantics follow the committed connector law (10s AbortController
// aborts, the FE3 error taxonomy, the platform's verbatim error message).
// They are re-implemented here because @zcode/services cannot depend on the
// CLI core package (layering: the app depends on services, never the
// reverse); the committed library stays the single source for the TOOL, this
// is its settings-side twin.
//
// Path binding law: paths.ts binds the data base dir at module load
// ($ZCODE_DATA_BASE_DIR > $HOME > homedir()); proof runs must set the env
// BEFORE importing this module.

import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getZCodeDataRootDir } from "../paths.js";
import type { LocalCredentialService } from "../credential/credentialService.js";
import type {
  ConnectStoreInput,
  ConnectStoreOutcome,
  StoreConnectionErrorCode,
  StoreConnectionRecord,
  StoreEtsyCredentials,
  StoreEvidenceClass,
  StoreListResult,
  StoreTier,
  TestConnectionOutcome,
} from "./stores.js";

const logger = createServiceLogger("storesService");

/** Same 10s hard abort law as the committed connectors. */
const FETCH_TIMEOUT_MS = 10_000;

/** Vault key prefix for store-connection credentials. */
const VAULT_KEY_PREFIX = "store-connection:";

const TIER_1_PLATFORMS = new Set(["shopify", "woocommerce"]);
const TIER_2_PLATFORMS = new Set(["etsy", "ebay", "amazon"]);
const WEB_PLATFORMS = new Set(["whatnot"]);

// ——— probe transport + taxonomy (ported from the committed connector law) ———

interface ProbeError {
  code: StoreConnectionErrorCode;
  message: string;
}

type ProbeResult = { ok: true } | { ok: false; error: ProbeError };

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Map the platform's own error body text (JSON errors field or raw text) to
 * a short honest snippet — ported from the committed errors.ts bodySnippet. */
function bodySnippet(bodyText: string, max = 140): string {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const rec = parsed as Record<string, unknown>;
      for (const key of ["errors", "error", "message", "code"]) {
        const v = rec[key];
        if (typeof v === "string" && v.trim().length > 0) {
          return v.trim().slice(0, max);
        }
      }
    }
  } catch {
    // not JSON — fall through to raw text
  }
  return trimmed.slice(0, max);
}

function classifyFetchThrow(platform: string, e: unknown): ProbeError {
  if (e instanceof Error && e.name === "AbortError") {
    return {
      code: "timeout",
      message: `${platform} didn't answer within 10 seconds — the connection was aborted. Nothing was searched; retry shortly.`,
    };
  }
  const reason = e instanceof Error ? e.message : String(e);
  return {
    code: "unreachable",
    message: `${platform} was unreachable (${reason.slice(0, 120)}) — check the store domain and the network.`,
  };
}

function classifyPlatformFetch(
  platform: string,
  status: number,
  headers: Headers,
  bodyText: string,
): ProbeError {
  const snippet = bodySnippet(bodyText);
  const suffix = snippet.length > 0 ? ` (platform said: "${snippet}")` : "";
  if (status === 401) {
    return {
      code: "invalid_credentials",
      message: `${platform} rejected the request (401)${suffix}. For a public catalog connector this usually means the store does not expose its product API publicly — credentials or a different store are needed.`,
    };
  }
  if (status === 403) {
    const scopeLanguage = /scope|permission|not authorized/i.test(bodyText);
    if (scopeLanguage) {
      return {
        code: "insufficient_scope",
        message: `${platform} denied the call (403) — the credentials' access scopes don't cover it${suffix}.`,
      };
    }
    return { code: "invalid_credentials", message: `${platform} denied access (403)${suffix}.` };
  }
  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    const seconds =
      retryAfter !== null && retryAfter.trim().length > 0 && Number.isFinite(Number(retryAfter))
        ? Number(retryAfter)
        : undefined;
    return {
      code: "rate_limited",
      message:
        seconds !== undefined
          ? `${platform} is rate-limiting this connection (429) — Retry-After says ${seconds}s. Retry in ${seconds} seconds.`
          : `${platform} is rate-limiting this connection (429) — wait a moment and try again.`,
    };
  }
  return { code: "platform_error", message: `${platform} answered ${status}${suffix}.` };
}

// ——— domain normalization (ported from the committed connector law) ———

/** Shopify storefront input -> the host the public catalog serves from. */
function normalizeStorefrontDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, ""); // strip protocol
  s = s.replace(/\/+$/, ""); // strip trailing slashes
  const slash = s.indexOf("/");
  if (slash !== -1) s = s.slice(0, slash); // strip any path
  if (s.length === 0) return s;
  if (s.includes(".")) return s;
  return `${s}.myshopify.com`; // a bare shop slug
}

/** WooCommerce site input -> the API origin (scheme + host, paths stripped). */
function normalizeWooOrigin(input: string): string {
  let s = input.trim();
  if (s.length === 0) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/**
 * Etsy shop input -> the shop id/name the connector resolves. Accepts a
 * numeric shop_id, an etsy.com/shop/{name} URL, or a bare shop name.
 */
function normalizeEtsyShopRef(input: string): string {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return s;
  const match = /etsy\.com\/shop\/([^/?#]+)/i.exec(s);
  if (match) return match[1]!;
  const bare = s.replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");
  const slash = bare.indexOf("/");
  if (slash !== -1) return bare.slice(slash + 1) || bare;
  return bare;
}

/** Hostname of a generic URL (eBay/Amazon storefront or seller page). */
function hostOf(input: string): string {
  const s = input.trim();
  if (s.length === 0) return s;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? s;
  }
}

// ——— live probes (the health-check semantics) ———

const SHOPIFY_PLATFORM = "Shopify";
const WOO_PLATFORM = "WooCommerce";
const ETSY_PLATFORM = "Etsy";

/** Shopify public catalog probe: {host}/products.json?limit=1 (200 + array). */
async function probeShopifyCatalog(host: string): Promise<ProbeResult> {
  const normalized = normalizeStorefrontDomain(host);
  if (normalized.length === 0) {
    return { ok: false, error: { code: "platform_error", message: "The URL has no usable host." } };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`https://${normalized}/products.json?limit=1`);
  } catch (e) {
    return { ok: false, error: classifyFetchThrow(SHOPIFY_PLATFORM, e) };
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: classifyPlatformFetch(SHOPIFY_PLATFORM, res.status, res.headers, bodyText) };
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { products?: unknown }).products)) {
      return { ok: true };
    }
  } catch {
    // fall through to the honest unexpected-payload error
  }
  return {
    ok: false,
    error: {
      code: "platform_error",
      message: `${SHOPIFY_PLATFORM} answered 200 but /products.json carried no products array — this may not be a Shopify storefront.`,
    },
  };
}

/** WooCommerce public REST probe: {origin}/wp-json/wc/v3/products?per_page=1. */
async function probeWooCatalog(origin: string): Promise<ProbeResult> {
  const normalized = normalizeWooOrigin(origin);
  if (normalized.length === 0) {
    return { ok: false, error: { code: "platform_error", message: "The URL has no usable host." } };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`${normalized}/wp-json/wc/v3/products?per_page=1`);
  } catch (e) {
    return { ok: false, error: classifyFetchThrow(WOO_PLATFORM, e) };
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: classifyPlatformFetch(WOO_PLATFORM, res.status, res.headers, bodyText) };
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (Array.isArray(parsed)) return { ok: true };
  } catch {
    // fall through
  }
  return {
    ok: false,
    error: {
      code: "platform_error",
      message: `${WOO_PLATFORM} answered ${res.status} but the payload wasn't the expected product array — this may not be a WooCommerce store.`,
    },
  };
}

/**
 * Etsy OpenAPI v3 probe (the FE3-verified shop-resolution round trip):
 * GET /application/users/me -> user_id, GET /application/users/{id}/shops.
 * A numeric shop id probes the listings endpoint directly.
 */
async function etsyFetch(path: string, credentials: StoreEtsyCredentials): Promise<{ ok: true; status: number; bodyText: string; headers: Headers } | { ok: false; error: ProbeError }> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(`https://openapi.etsy.com/v3${path}`, {
        headers: {
          Accept: "application/json",
          "x-api-key": credentials.apiKeyString,
          Authorization: `Bearer ${credentials.userToken}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: classifyFetchThrow(ETSY_PLATFORM, e) };
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: classifyPlatformFetch(ETSY_PLATFORM, res.status, res.headers, bodyText) };
  }
  return { ok: true, status: res.status, bodyText, headers: res.headers };
}

async function etsyProbe(shopRef: string, credentials: StoreEtsyCredentials): Promise<ProbeResult> {
  const numeric = /^\d+$/u.test(shopRef.trim()) ? Number.parseInt(shopRef.trim(), 10) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    const listings = await etsyFetch(
      `/application/shops/${numeric}/listings/active?limit=1`,
      credentials,
    );
    return listings.ok ? { ok: true } : { ok: false, error: listings.error };
  }
  const me = await etsyFetch("/application/users/me", credentials);
  if (!me.ok) return { ok: false, error: me.error };
  let userId: unknown;
  try {
    userId = (JSON.parse(me.bodyText) as { user_id?: unknown }).user_id;
  } catch {
    userId = undefined;
  }
  if (typeof userId !== "number" || !Number.isFinite(userId)) {
    return {
      ok: false,
      error: {
        code: "platform_error",
        message: `${ETSY_PLATFORM}'s users/me answered 200 without a user_id — the probe cannot resolve the shop honestly.`,
      },
    };
  }
  const shops = await etsyFetch(`/application/users/${userId}/shops`, credentials);
  if (!shops.ok) return { ok: false, error: shops.error };
  return { ok: true };
}

// ——— tier resolution (mirrors the reader's inferTier law) ———

function tierOfPlatform(platform: string): StoreTier | null {
  const p = platform.trim().toLowerCase();
  if (TIER_1_PLATFORMS.has(p)) return "public";
  if (TIER_2_PLATFORMS.has(p)) return "credential";
  if (WEB_PLATFORMS.has(p)) return "web";
  return null;
}

function isEtsyCredentials(v: unknown): v is StoreEtsyCredentials {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as StoreEtsyCredentials).apiKeyString === "string" &&
    (v as StoreEtsyCredentials).apiKeyString.trim().length > 0 &&
    typeof (v as StoreEtsyCredentials).userToken === "string" &&
    (v as StoreEtsyCredentials).userToken.trim().length > 0
  );
}

// ——— persistence ———

interface StoresServiceDependencies {
  credentialService: LocalCredentialService;
}

export function createStoresService(dependencies: StoresServiceDependencies) {
  const credentialService = dependencies.credentialService;

  function storesFilePath(): string {
    return join(getZCodeDataRootDir(), "stores.json");
  }

  /**
   * Read the state file. Missing file -> the normal empty state (never an
   * error); an existing-but-unreadable file -> empty list + an honest
   * readError (same law as the committed reader — the service refuses to
   * silently overwrite a corrupt store).
   */
  async function readStateFile(): Promise<StoreListResult> {
    const path = storesFilePath();
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return { stores: [] };
      return {
        stores: [],
        readError: `Connected-stores state at ${path} could not be read (${
          error instanceof Error ? error.message : String(error)
        }).`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        stores: [],
        readError: `Connected-stores state at ${path} is not valid JSON (${
          error instanceof Error ? error.message : String(error)
        }) — fix or remove the file, then retry.`,
      };
    }
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { stores?: unknown }).stores)
        ? (parsed as { stores: unknown[] }).stores
        : null;
    if (records === null) {
      return {
        stores: [],
        readError: `Connected-stores state at ${path} has an unexpected shape (expected an array of store records or { "stores": [...] }).`,
      };
    }
    const stores = records.filter(
      (record): record is StoreConnectionRecord =>
        typeof record === "object" &&
        record !== null &&
        typeof (record as StoreConnectionRecord).platform === "string" &&
        typeof (record as StoreConnectionRecord).domain === "string",
    );
    return { stores };
  }

  /** Read-modify-write under the same cross-process file lock law as the
   * credential vault. Writing zero stores REMOVES the file instead of
  persisting `{"stores": []}` — an empty object state is a readError in the
  committed reader's law, so absence is the only reader-legal empty shape. */
  async function mutateState(
    mutate: (stores: StoreConnectionRecord[]) => Promise<StoreConnectionRecord[]>,
  ): Promise<StoreListResult> {
    const path = storesFilePath();
    return withFileLock(path, async () => {
      const state = await readStateFile();
      if (state.readError !== undefined) return state;
      const next = await mutate(state.stores);
      if (next.length === 0) {
        try {
          await rm(path, { force: true });
        } catch {
          logger.warn(undefined, "failed to remove empty stores state file", { path });
        }
        return { stores: [] };
      }
      await atomicWritePrivateTextFile(path, `${JSON.stringify({ stores: next }, null, 2)}\n`);
      return { stores: next };
    });
  }

  function vaultKeyOf(id: string): string {
    return `${VAULT_KEY_PREFIX}${id}`;
  }

  // ——— probe dispatch ———

  async function probeRecord(record: StoreConnectionRecord): Promise<ProbeResult> {
    const platform = record.platform.trim().toLowerCase();
    if (platform === "shopify") return probeShopifyCatalog(record.domain);
    if (platform === "woocommerce") return probeWooCatalog(record.domain);
    if (platform === "etsy") {
      if (!isEtsyCredentials(record.credentials)) {
        return {
          ok: false,
          error: {
            code: "not_configured",
            message: `${ETSY_PLATFORM} credentials are not configured for this store — open Settings -> Connected Stores to add them. Nothing was searched.`,
          },
        };
      }
      return etsyProbe(record.domain, record.credentials);
    }
    if (platform === "whatnot") {
      return {
        ok: false,
        error: {
          code: "not_supported",
          message: "Whatnot has no public API — the agent will search the web instead; there is no connection to test.",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "not_supported",
        message: `${record.platform} has no v1 connector yet — the store stays listed, but store_search answers not_supported for it honestly.`,
      },
    };
  }

  function evidenceClassOfProbe(result: ProbeResult): StoreEvidenceClass {
    if (result.ok) return "live API result";
    if (result.error.code === "unreachable" || result.error.code === "timeout") return "unavailable";
    return "live API result";
  }

  // ——— the service ———

  return {
    async list(): Promise<StoreListResult> {
      return readStateFile();
    },

    async connect(input: ConnectStoreInput): Promise<ConnectStoreOutcome> {
      const platform = input.platform.trim().toLowerCase();
      const tier = tierOfPlatform(platform);
      if (tier === null) {
        return {
          ok: false,
          code: "not_supported",
          message: `Unknown platform "${input.platform}" — the supported platforms are Shopify, WooCommerce, Etsy, eBay, Amazon and Whatnot.`,
          evidenceClass: "unavailable",
        };
      }
      const url = input.url.trim();
      if (url.length === 0) {
        return {
          ok: false,
          code: "platform_error",
          message: "The store URL is empty — paste the storefront URL and try again.",
          evidenceClass: "unavailable",
        };
      }

      const label = input.label?.trim() || url;

      if (tier === "web") {
        // Whatnot: honest web-tier record — tracked for the notice, never a
        // fake connection; the reader marks it NOT searchable.
        const domain = hostOf(url) || url;
        const record: StoreConnectionRecord = {
          id: randomUUID(),
          platform,
          domain,
          label,
          tier,
          connectedAt: new Date().toISOString(),
          status: "web-searched",
        };
        const state = await mutateState((stores) => Promise.resolve([...stores, record]));
        if (state.readError !== undefined) {
          return {
            ok: false,
            code: "platform_error",
            message: state.readError,
            evidenceClass: "unavailable",
          };
        }
        return {
          ok: true,
          store: record,
          message: "Whatnot has no public API — the agent will search the web for this store instead.",
          evidenceClass: "public-page observation",
        };
      }

      if (tier === "credential") {
        if (!isEtsyCredentials(input.credentials)) {
          return {
            ok: false,
            code: "not_configured",
            message: `${input.platform} needs credentials to connect — fill in the credential fields and try again.`,
            evidenceClass: "unavailable",
          };
        }
        if (platform !== "etsy") {
          // eBay/Amazon: Tier-2 records are accepted (the UI form is honest
          // about the future connector), but v1 has no connector — the
          // credentials go to the VAULT only (no record embedding: nothing
          // reads them yet), and store_search answers not_supported
          // per-store honestly.
          const record: StoreConnectionRecord = {
            id: randomUUID(),
            platform,
            domain: hostOf(url) || url,
            label,
            tier,
            connectedAt: new Date().toISOString(),
            status: "configured",
            authority: "read-only",
          };
          try {
            await credentialService.save(
              vaultKeyOf(record.id),
              JSON.stringify({ platform, credentials: input.credentials }),
            );
          } catch (error) {
            logger.warn(undefined, "failed to persist store credentials to vault", { platform });
            return {
              ok: false,
              code: "platform_error",
              message: `The ${platform} connection could not be saved to the credential vault (${
                error instanceof Error ? error.message : String(error)
              }) — nothing was connected.`,
              evidenceClass: "unavailable",
            };
          }
          const state = await mutateState((stores) => Promise.resolve([...stores, record]));
          if (state.readError !== undefined) {
            return {
              ok: false,
              code: "platform_error",
              message: state.readError,
              evidenceClass: "unavailable",
            };
          }
          return {
            ok: true,
            store: record,
            message: `${input.platform} connected — v1 has no ${input.platform} connector yet, so store_search will answer not_supported for this store until one ships.`,
            evidenceClass: "inferred",
          };
        }
        // Etsy: VAULT-FIRST double write (see file header for the tension).
        // Connect stores the credentials WITHOUT a live probe — the probe
        // runs on "Test connection" (a user must be able to save credentials
        // while offline; the status chip honestly says "configured", not
        // "connected", until a probe says otherwise).
        const shopRef = normalizeEtsyShopRef(url);
        if (shopRef.length === 0) {
          return {
            ok: false,
            code: "platform_error",
            message: "The Etsy URL has no shop — paste https://www.etsy.com/shop/{your-shop} and try again.",
            evidenceClass: "unavailable",
          };
        }
        const record: StoreConnectionRecord = {
          id: randomUUID(),
          platform,
          domain: shopRef,
          label,
          tier,
          connectedAt: new Date().toISOString(),
          status: "configured",
          credentials: { ...input.credentials },
          authority: "read-only",
        };
        try {
          await credentialService.save(
            vaultKeyOf(record.id),
            JSON.stringify({ platform, credentials: input.credentials }),
          );
        } catch (error) {
          logger.warn(undefined, "failed to persist store credentials to vault", { platform });
          return {
            ok: false,
            code: "platform_error",
            message: `The ${platform} connection could not be saved to the credential vault (${
              error instanceof Error ? error.message : String(error)
            }) — nothing was connected.`,
            evidenceClass: "unavailable",
          };
        }
        const state = await mutateState((stores) => Promise.resolve([...stores, record]));
        if (state.readError !== undefined) {
          // Roll the vault entry back — the record never landed.
          await credentialService.delete(vaultKeyOf(record.id)).catch(() => undefined);
          return {
            ok: false,
            code: "platform_error",
            message: state.readError,
            evidenceClass: "unavailable",
          };
        }
        return {
          ok: true,
          store: record,
          message: `${label} connected — credentials saved to the vault; run Test connection for the live Etsy OpenAPI probe.`,
          evidenceClass: "inferred",
        };
      }

      // Tier-1 (public catalog): classify the URL live first — the probe
      // must say this IS the claimed platform, or the connect is refused
      // honestly and no record is written.
      if (platform === "shopify") {
        const host = normalizeStorefrontDomain(url);
        const probe = await probeShopifyCatalog(host);
        if (!probe.ok) {
          return {
            ok: false,
            code: probe.error.code,
            message: probe.error.message,
            evidenceClass: evidenceClassOfProbe(probe),
          };
        }
        const record: StoreConnectionRecord = {
          id: randomUUID(),
          platform,
          domain: host,
          label: input.label?.trim() || host,
          tier,
          connectedAt: new Date().toISOString(),
          status: "connected",
          lastCheckedAt: new Date().toISOString(),
          authority: "read-only",
        };
        const state = await mutateState((stores) => Promise.resolve([...stores, record]));
        if (state.readError !== undefined) {
          return {
            ok: false,
            code: "platform_error",
            message: state.readError,
            evidenceClass: "unavailable",
          };
        }
        return {
          ok: true,
          store: record,
          message: `${record.label} connected — the live Shopify catalog probe answered ok.`,
          evidenceClass: "live API result",
        };
      }

      // woocommerce
      const origin = normalizeWooOrigin(url);
      const probe = await probeWooCatalog(origin);
      if (!probe.ok) {
        return {
          ok: false,
          code: probe.error.code,
          message: probe.error.message,
          evidenceClass: evidenceClassOfProbe(probe),
        };
      }
      const record: StoreConnectionRecord = {
        id: randomUUID(),
        platform,
        domain: origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""),
        label: input.label?.trim() || origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""),
        tier,
        connectedAt: new Date().toISOString(),
        status: "connected",
        lastCheckedAt: new Date().toISOString(),
        authority: "read-only",
      };
      const state = await mutateState((stores) => Promise.resolve([...stores, record]));
      if (state.readError !== undefined) {
        return {
          ok: false,
          code: "platform_error",
          message: state.readError,
          evidenceClass: "unavailable",
        };
      }
      return {
        ok: true,
        store: record,
        message: `${record.label} connected — the live WooCommerce catalog probe answered ok.`,
        evidenceClass: "live API result",
      };
    },

    async test(params: { id: string }): Promise<TestConnectionOutcome> {
      const state = await readStateFile();
      if (state.readError !== undefined) {
        return { ok: false, message: state.readError, evidenceClass: "unavailable" };
      }
      const record = state.stores.find((store) => store.id === params.id);
      if (record === undefined) {
        return {
          ok: false,
          code: "not_configured",
          message: "That store is no longer connected — refresh the list and try again.",
          evidenceClass: "unavailable",
        };
      }
      const probe = await probeRecord(record);
      const evidenceClass = evidenceClassOfProbe(probe);
      const now = new Date().toISOString();
      const code = probe.ok ? undefined : probe.error.code;
      const nextRecord: StoreConnectionRecord = {
        ...record,
        status: probe.ok ? "connected" : "error",
        lastCheckedAt: now,
        ...(code !== undefined ? { lastCheckCode: code } : { lastCheckCode: undefined }),
      };
      const written = await mutateState((stores) =>
        Promise.resolve(stores.map((store) => (store.id === record.id ? nextRecord : store))),
      );
      if (written.readError !== undefined) {
        logger.warn(undefined, "failed to persist probe result", { platform: record.platform });
      }
      return probe.ok
        ? {
            ok: true,
            message: `${record.label} answered the live probe — the connection works.`,
            evidenceClass,
          }
        : { ok: false, code, message: probe.error.message, evidenceClass };
    },

    async remove(params: { id: string }): Promise<{ ok: boolean; message: string; credentialsDestroyed: boolean }> {
      const state = await readStateFile();
      if (state.readError !== undefined) {
        return { ok: false, message: state.readError, credentialsDestroyed: false };
      }
      const record = state.stores.find((store) => store.id === params.id);
      if (record === undefined) {
        return {
          ok: false,
          message: "That store is no longer connected — refresh the list and try again.",
          credentialsDestroyed: false,
        };
      }
      // Destroy the vault entry FIRST (FE3 law: honest credentialsDestroyed).
      let credentialsDestroyed = false;
      if (record.tier === "credential") {
        try {
          const vaultValue = await credentialService.load(vaultKeyOf(record.id));
          if (vaultValue !== null) {
            await credentialService.delete(vaultKeyOf(record.id));
            credentialsDestroyed = true;
          }
        } catch (error) {
          logger.warn(undefined, "failed to destroy vault entry on revoke", { platform: record.platform });
          return {
            ok: false,
            message: `The credential vault entry could not be destroyed (${
              error instanceof Error ? error.message : String(error)
            }) — the store was NOT revoked; retry.`,
            credentialsDestroyed: false,
          };
        }
      }
      const written = await mutateState((stores) =>
        Promise.resolve(stores.filter((store) => store.id !== record.id)),
      );
      if (written.readError !== undefined) {
        return {
          ok: false,
          message: written.readError,
          // The vault entry is already gone — report that honestly.
          credentialsDestroyed,
        };
      }
      return {
        ok: true,
        message:
          record.tier === "credential"
            ? credentialsDestroyed
              ? `${record.label} revoked — the stored credentials were destroyed.`
              : `${record.label} revoked — no vault entry was found (already destroyed).`
            : `${record.label} revoked.`,
        credentialsDestroyed,
      };
    },
  };
}

export type StoresService = ReturnType<typeof createStoresService>;
