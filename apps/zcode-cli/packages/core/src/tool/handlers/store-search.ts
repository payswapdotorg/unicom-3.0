// ============================================================
// StoreSearch Tool - federated product-catalog search across
// the user's connected stores (REPORT.md section 4 contract)
// ============================================================
//
// One tool, all stores: the fan-out queries every connected store in
// parallel; a per-store failure NEVER fails the whole call (it lands in
// per_store with its honest error code); zero connected stores is an ok:true
// result with a helpful notice, not an error. Store-connection records come
// from the per-user JSON state under ~/.zcode (read defensively — the
// StoresService owns the writes).

import { z } from "zod";
import type { ToolEntry, ToolHandler, ToolHandlerFailure } from "../types.js";
import {
  connectorFor,
  isSearchableStore,
  isStoreSearchError,
  normalizeStorePlatform,
  readConnectedStores,
  type StoreFinding,
  type StoreRecord,
  type StoreSearchError,
  type SupportedStorePlatform,
} from "./store-search/index.js";

const STORE_SEARCH_TOOL_NAME = "store_search";
const DEFAULT_MAX_PER_STORE = 5;
const HARD_MAX_PER_STORE = 25;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 20_000;

const STORE_SEARCH_DESCRIPTION = [
  "Search product catalogs across the user's connected stores (Shopify, WooCommerce, Etsy). Returns normalized findings with product page links that can be opened in the integrated browser. Supports newest-first and price sorting.",
  "",
  "- Use it whenever the user asks to find products/sneakers/merch in their connected stores; all connected stores are searched in parallel, newest first by default.",
  "- `platforms` limits the fan-out (e.g. [\"shopify\", \"woo\"]); default: all connected stores. Unknown platform names are rejected with the list of known platforms.",
  "- Per-store failures never fail the call — check `per_store` for each store's honest status (e.g. invalid_credentials, rate_limited, not_configured).",
  "- When no store is connected, the result says so — suggest Settings -> Connected Stores, or use WebSearch instead.",
  "- Platforms without a store API (e.g. Whatnot) are never faked: the notice says they are searched via the web instead — use WebSearch for those.",
].join("\n");

const ZERO_STORES_NOTICE =
  "No stores are connected yet — open Settings → Connected Stores to add one, or ask me to search the web instead.";

// ——— input contract ———

const StoreSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe('The product search query, e.g. "yeezy shoes"'),
    platforms: z
      .array(z.string().trim().min(1))
      .min(1)
      .optional()
      .describe(
        'Only search stores on these platforms (e.g. ["shopify", "woo"]); default: all connected stores',
      ),
    max_per_store: z
      .number()
      .default(DEFAULT_MAX_PER_STORE)
      .describe(
        `Maximum findings per store (default ${DEFAULT_MAX_PER_STORE}, clamped into 1..${HARD_MAX_PER_STORE})`,
      ),
    sort: z
      .enum(["newest", "relevance", "price_asc", "price_desc"])
      .default("newest")
      .describe("Findings order: newest (default), relevance, price_asc, or price_desc"),
  })
  .strict();

type StoreSearchInput = z.infer<typeof StoreSearchInputSchema>;

// Provider-visible input schema, hand-written in the executor's supported JSON
// Schema subset (the repo has two zod major versions — the zod v4 instance
// this file uses has no shared converter, so the provider schema is written
// directly; the zod schema above stays the single runtime authority).
const StoreSearchInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description: 'The product search query, e.g. "yeezy shoes"',
    },
    platforms: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description:
        'Only search stores on these platforms (e.g. ["shopify", "woo"]); default: all connected stores',
    },
    max_per_store: {
      type: "integer",
      minimum: 1,
      maximum: HARD_MAX_PER_STORE,
      description: `Maximum findings per store (default ${DEFAULT_MAX_PER_STORE}, max ${HARD_MAX_PER_STORE})`,
    },
    sort: {
      type: "string",
      enum: ["newest", "relevance", "price_asc", "price_desc"],
      description: "Findings order: newest (default), relevance, price_asc, or price_desc",
    },
  },
} as const;

// ——— output contract (REPORT.md section 4 result shape) ———

const StoreFindingSchema = z
  .object({
    platform: z.string(),
    store: z.string(),
    store_domain: z.string(),
    title: z.string(),
    price: z.number().nullable(),
    currency: z.string().nullable(),
    url: z.string(),
    image_url: z.string().nullable(),
    published_at: z.string().nullable(),
    truncated: z.boolean().optional(),
  })
  .strict();

const PerStoreOkSchema = z
  .object({
    platform: z.string(),
    store: z.string(),
    count: z.number().int().nonnegative(),
    status: z.literal("ok"),
    truncated: z.boolean().optional(),
  })
  .strict();

const PerStoreFailureSchema = z
  .object({
    platform: z.string(),
    store: z.string(),
    status: z.enum(["error", "not_configured"]),
    error: z.string(),
    message: z.string(),
  })
  .strict();

const StoreSearchOutputSchema = z
  .object({
    ok: z.literal(true),
    query: z.string(),
    results: z.array(StoreFindingSchema),
    per_store: z.array(z.union([PerStoreOkSchema, PerStoreFailureSchema])),
    notice: z.string().optional(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

type StoreSearchOutput = z.infer<typeof StoreSearchOutputSchema>;

// Provider-visible output schema via zod v4's native converter (the runtime
// schema above stays the validation authority for executor output checks).
const StoreSearchOutputJsonSchema = z.toJSONSchema(StoreSearchOutputSchema);

// ——— per-store fan-out ———

/** What one store's connector run needs (the clamped, validated input). */
interface FanOutParams {
  query: string;
  max_per_store: number;
  sort: StoreSearchInput["sort"];
}

/** Clamp the model-provided per-store cap into 1..25 — a forgiving clamp, not
 * a hard rejection (an out-of-range value still yields a sane, honest search). */
function clampMaxPerStore(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_PER_STORE;
  return Math.min(HARD_MAX_PER_STORE, Math.max(1, Math.round(value)));
}

type PerStoreOutcome =
  | { kind: "ok"; record: StoreRecord; findings: StoreFinding[]; truncated: boolean }
  | { kind: "error"; record: StoreRecord; error: StoreSearchError };

async function searchStore(record: StoreRecord, params: FanOutParams): Promise<PerStoreOutcome> {
  const connector = connectorFor(record.platform);
  if (connector === null) {
    return {
      kind: "error",
      record,
      error: {
        code: "not_supported",
        message: `No store_search connector for platform "${record.platform}" — connect a Shopify, WooCommerce or Etsy store instead.`,
      },
    };
  }
  try {
    const result = await connector.search({
      query: params.query,
      maxPerStore: params.max_per_store,
      sort: params.sort,
      domain: record.domain,
      label: record.label,
      ...(record.credentials !== undefined ? { credentials: record.credentials } : {}),
    });
    if (isStoreSearchError(result)) {
      return { kind: "error", record, error: result };
    }
    return { kind: "ok", record, findings: result.findings, truncated: result.truncated };
  } catch (error) {
    // Connectors never throw by contract — this is the defensive honest floor.
    return {
      kind: "error",
      record,
      error: {
        code: "platform_error",
        message: `${record.platform} connector failed unexpectedly (${
          error instanceof Error ? error.message : String(error)
        }).`,
      },
    };
  }
}

function displayPlatform(record: StoreRecord): string {
  return normalizeStorePlatform(record.platform) ?? record.platform;
}

/** Does this record match the (already canonicalized, pre-validated) filter?
 * Records on unknown platforms never match a filter — the filter only holds
 * known connector platforms. */
function matchesPlatformFilter(
  record: StoreRecord,
  filter: ReadonlySet<SupportedStorePlatform> | null,
): boolean {
  if (filter === null) return true;
  const canonical = normalizeStorePlatform(record.platform);
  return canonical !== null && filter.has(canonical);
}

function timestampOf(finding: StoreFinding): number {
  if (finding.published_at === null) return 0;
  const ms = Date.parse(finding.published_at);
  return Number.isFinite(ms) ? ms : 0;
}

function priceOf(finding: StoreFinding): number {
  return finding.price ?? Number.POSITIVE_INFINITY;
}

function sortMergedFindings(findings: StoreFinding[], sort: StoreSearchInput["sort"]): void {
  if (sort === "newest") {
    findings.sort((a, b) => timestampOf(b) - timestampOf(a));
  } else if (sort === "price_asc") {
    findings.sort((a, b) => priceOf(a) - priceOf(b));
  } else if (sort === "price_desc") {
    findings.sort((a, b) => priceOf(b) - priceOf(a));
  }
  // relevance: per-store order is preserved (stores in record order,
  // findings in each connector's own relevance order).
}

// ——— the handler ———

const storeSearchHandler: ToolHandler<
  StoreSearchInput,
  StoreSearchOutput | ToolHandlerFailure
> = async (input, context) => {
  context.abortSignal.throwIfAborted();
  const startedAt = Date.now();
  const parsed = StoreSearchInputSchema.parse(input);

  // Platform filter — validated against the KNOWN connector platforms first:
  // an unknown platform is a helpful 400-style tool error (the model learns
  // the valid names), never a silently-empty "search".
  let platformFilter: Set<SupportedStorePlatform> | null = null;
  if (parsed.platforms !== undefined) {
    const unknown: string[] = [];
    platformFilter = new Set<SupportedStorePlatform>();
    for (const entry of parsed.platforms) {
      const canonical = normalizeStorePlatform(entry);
      if (canonical === null) {
        unknown.push(entry);
      } else {
        platformFilter.add(canonical);
      }
    }
    if (unknown.length > 0) {
      return {
        result: false,
        errorCode: 400,
        message: `store_search: unknown platform(s) ${unknown
          .map((platform) => `"${platform}"`)
          .join(", ")} — the known platforms are shopify, woocommerce (alias "woo") and etsy. Platforms without a store API (e.g. whatnot) are never faked: search the web for those with WebSearch instead.`,
      };
    }
  }

  const fanOut: FanOutParams = {
    query: parsed.query,
    max_per_store: clampMaxPerStore(parsed.max_per_store),
    sort: parsed.sort,
  };

  const state = await readConnectedStores();
  const notices: string[] = [];
  if (state.readError !== undefined) notices.push(state.readError);

  const allStores = state.stores;
  // Delegated-web stores (tier "web", e.g. Whatnot) are never fetched — they
  // surface honestly in the notice as "searched via web" guidance.
  const webStores = allStores.filter(
    (record) => record.tier === "web" && matchesPlatformFilter(record, platformFilter),
  );
  const searchable = allStores.filter(
    (record) => isSearchableStore(record) && matchesPlatformFilter(record, platformFilter),
  );

  if (allStores.length === 0) {
    return {
      ok: true,
      query: parsed.query,
      results: [],
      per_store: [],
      ...(notices.length > 0 ? { notice: notices.join(" ") } : { notice: ZERO_STORES_NOTICE }),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  for (const record of webStores) {
    notices.push(
      `${record.label} (${record.platform}) has no public store API — it is searched via the web instead: use the WebSearch tool for ${record.label} findings.`,
    );
  }

  if (searchable.length === 0) {
    const connected = allStores.map((record) => displayPlatform(record));
    notices.push(
      `No connected store was searched for platform(s) ${
        parsed.platforms !== undefined ? parsed.platforms.join(", ") : "(all)"
      } — connected platforms: ${[...new Set(connected)].join(", ")}.`,
    );
    return {
      ok: true,
      query: parsed.query,
      results: [],
      per_store: [],
      notice: notices.join(" "),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  // Fan out to ALL connected (searchable) stores in parallel; a store's
  // failure never fails the call — it lands in per_store honestly.
  const outcomes = await Promise.all(searchable.map((record) => searchStore(record, fanOut)));

  const results: StoreFinding[] = [];
  const perStore: StoreSearchOutput["per_store"] = [];
  for (const outcome of outcomes) {
    const platform = displayPlatform(outcome.record);
    if (outcome.kind === "ok") {
      perStore.push({
        platform,
        store: outcome.record.label,
        count: outcome.findings.length,
        status: "ok",
        ...(outcome.truncated ? { truncated: true } : {}),
      });
      results.push(...outcome.findings);
    } else {
      perStore.push({
        platform,
        store: outcome.record.label,
        status: outcome.error.code === "not_configured" ? "not_configured" : "error",
        error: outcome.error.code,
        message: outcome.error.message,
      });
    }
  }

  sortMergedFindings(results, parsed.sort);

  return {
    ok: true,
    query: parsed.query,
    results,
    per_store: perStore,
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
};

// ——— the tool entry (wired in handlers/index.ts) ———

export const storeSearchToolEntry: ToolEntry = {
  capability:
    "Search product catalogs across the user's connected stores (Shopify, WooCommerce, Etsy)",
  metadata: {
    shouldDefer: true,
    name: STORE_SEARCH_TOOL_NAME,
    searchHint: "search the user's connected store product catalogs",
    description: STORE_SEARCH_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    sideEffectScope: "network",
    riskLevel: "low",
    needsApproval: false,
  },
  aliases: ["search_stores", "store_find"],
  handler: storeSearchHandler as ToolHandler,
  inputSchema: StoreSearchInputJsonSchema,
  outputSchema: StoreSearchOutputJsonSchema,
  runtimeInputSchema: StoreSearchInputSchema,
  runtimeOutputSchema: StoreSearchOutputSchema,
  permission: {
    permission: "store_search",
    reason:
      "store_search performs read-only catalog GET requests to the store domains the user connected",
    riskLevel: "low",
    sideEffectScope: "network",
    needsApproval: false,
    patternSources: ["toolName", "input", "network"],
    alwaysAllowPatternSources: ["network"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: 10_000,
    maxModelBytes: MAX_OUTPUT_BYTES,
    strategy: "truncate",
    preview: {
      maxLines: 30,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: DEFAULT_TIMEOUT_MS,
    maxMs: 120_000,
    allowCallOverride: true,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "store_search was cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
