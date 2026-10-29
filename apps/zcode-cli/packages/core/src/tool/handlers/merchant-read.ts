// ============================================================
// merchant_read Tool — the merchant-side L3/L4 read plane
// (HARNESS-CONTRACT.md §3, the R6 lane)
// ============================================================
//
// The store-search.ts fan-out discipline, applied to the merchant (store
// owner) question "how is my store doing": shop summary, catalog/inventory
// levels, recent orders — read through the SAME connected-stores tier, the
// SAME error taxonomy, the SAME authority discipline. One tool, all
// merchant-readable stores: the fan-out reads every matching connected
// store in parallel; a store's failure NEVER fails the whole call (it
// lands in per_store with its honest error code).
//
// The L3/L4 thread (the contract row: "L3/L4 with merchant authority
// scopes"):
//   L3 plan        the operation (one of the three) resolved against the
//                  connected merchant-readable stores — the platform/store
//                  filters + the store narrowing.
//   L4 governed    readMerchantSnapshot — the single entry that routes to
//                  the REAL Etsy reader or the honest not_configured /
//                  not_supported answers; read-only GET-class requests
//                  only (the request-table law), credentials from the
//                  committed state reader, NEVER simulated.
//
// Honesty laws carried over verbatim: zero connected stores is an ok:true
// result with a connect-one notice (not an error); web-tier records are
// never planned (delegated notice); unknown platforms in the filter are a
// helpful 400-style tool error; multi-store shop_summary REFUSES to merge
// shop identities into one summary (the notice names the `store`
// narrowing — never a silently-dropped summary); money is exact decimal
// strings; the orders face is BUYER-LESS.
//
// NO formatModelContent (the F4-P5-fix law): the JSON face feeds both the
// model and the transcript — the renderer's data face.

import { z } from "zod";
import type { ToolEntry, ToolHandler, ToolHandlerFailure } from "../types.js";
import {
  isSearchableStore,
  normalizeStorePlatform,
  readConnectedStores,
  type StoreRecord,
  type SupportedStorePlatform,
} from "./store-search/index.js";
import {
  isMerchantReadError,
  readMerchantSnapshot,
  type MerchantReadSuccess,
} from "./store-search/merchant/index.js";

const MERCHANT_READ_TOOL_NAME = "merchant_read";
const DEFAULT_LIMIT = 10;
const HARD_MAX_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 20_000;

const MERCHANT_READ_DESCRIPTION = [
  "Read the merchant-side state of the user's connected stores — shop summary, catalog/inventory levels, or recent orders (the merchant read plane: read-only, through the connected store's own credentials).",
  "",
  "- Use it when the store owner asks how their store is doing: \"how is my shop?\", \"what's my inventory?\", \"recent orders?\" — operation is one of shop_summary, catalog_inventory, recent_orders.",
  "- Reads are REAL: Etsy reads through its OpenAPI with the connected keystring + user token. Shopify and WooCommerce merchant reads need credentials that are not wired yet — they answer honestly not_configured, NEVER a simulated catalog or order list.",
  "- Orders are buyer-less by law: only date, receipt id and grand total are read — never buyer names or addresses.",
  "- `platform` limits the fan-out (e.g. \"etsy\"); `store` narrows to one connected store (label or domain) — required for shop_summary when multiple merchant stores are connected (summaries are never merged).",
  "- Per-store failures never fail the call — check `per_store` for each store's honest status (invalid_credentials, rate_limited, not_configured, not_supported).",
  "- When no store is connected, the result says so — suggest Settings -> Connected Stores.",
].join("\n");

const ZERO_STORES_NOTICE =
  "No stores are connected yet — open Settings → Connected Stores to add one (Etsy merchant reads work today with the store's keystring + user token).";

// ——— input contract ———

const MerchantReadInputSchema = z
  .object({
    operation: z
      .enum(["shop_summary", "catalog_inventory", "recent_orders"])
      .describe(
        "The merchant read operation: shop_summary (the shop's own facts), catalog_inventory (active listings + quantities + prices), or recent_orders (buyer-less receipts)",
      ),
    platform: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Only read stores on this platform (e.g. "etsy"); default: all connected stores',
      ),
    store: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Narrow to one connected store (its label or domain) — shop summaries are per-store and are never merged",
      ),
    limit: z
      .number()
      .optional()
      .describe(
        `Maximum entries for list operations (default ${DEFAULT_LIMIT}, clamped into 1..${HARD_MAX_LIMIT})`,
      ),
  })
  .strict();

type MerchantReadInput = z.infer<typeof MerchantReadInputSchema>;

// Provider-visible input schema, hand-written in the executor's supported
// JSON Schema subset (the store-search precedent: the zod schema above stays
// the single runtime authority).
const MerchantReadInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation"],
  properties: {
    operation: {
      type: "string",
      enum: ["shop_summary", "catalog_inventory", "recent_orders"],
      description:
        "The merchant read operation: shop_summary (the shop's own facts), catalog_inventory (active listings + quantities + prices), or recent_orders (buyer-less receipts)",
    },
    platform: {
      type: "string",
      minLength: 1,
      description: 'Only read stores on this platform (e.g. "etsy"); default: all connected stores',
    },
    store: {
      type: "string",
      minLength: 1,
      description:
        "Narrow to one connected store (its label or domain) — shop summaries are per-store and are never merged",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: HARD_MAX_LIMIT,
      description: `Maximum entries for list operations (default ${DEFAULT_LIMIT}, max ${HARD_MAX_LIMIT})`,
    },
  },
} as const;

// ——— output contract (the merchant read JSON face) ———

const MoneySchema = z.object({ amount: z.string(), currency: z.string() }).strict();

const ShopSummarySchema = z
  .object({
    shopId: z.number().nullable(),
    shopName: z.string().nullable(),
    listingActiveCount: z.number().nullable(),
    listingDraftCount: z.number().nullable(),
    listingExpiredCount: z.number().nullable(),
    isVacation: z.boolean().nullable(),
    currencyCode: z.string().nullable(),
    createdAt: z.string().nullable(),
  })
  .strict();

const InventoryEntrySchema = z
  .object({
    store: z.string(),
    listingId: z.number().nullable(),
    title: z.string(),
    state: z.string().nullable(),
    sku: z.string().nullable(),
    quantity: z.number().nullable(),
    price: MoneySchema.nullable(),
    url: z.string().nullable(),
  })
  .strict();

const OrderEntrySchema = z
  .object({
    store: z.string(),
    receiptId: z.number().nullable(),
    createdAt: z.string().nullable(),
    grandTotal: MoneySchema.nullable(),
  })
  .strict();

const PerStoreOkSchema = z
  .object({
    platform: z.string(),
    store: z.string(),
    status: z.literal("ok"),
    count: z.number().int().nonnegative(),
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

const MerchantReadOutputSchema = z
  .object({
    ok: z.literal(true),
    operation: z.enum(["shop_summary", "catalog_inventory", "recent_orders"]),
    store: z.string().optional(),
    platform: z.string().optional(),
    shopSummary: ShopSummarySchema.optional(),
    inventory: z.array(InventoryEntrySchema).optional(),
    orders: z.array(OrderEntrySchema).optional(),
    truncated: z.boolean().optional(),
    notice: z.string().optional(),
    per_store: z.array(z.union([PerStoreOkSchema, PerStoreFailureSchema])).optional(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

type MerchantReadOutput = z.infer<typeof MerchantReadOutputSchema>;

// Provider-visible output schema via zod v4's native converter (the runtime
// schema above stays the validation authority for executor output checks).
const MerchantReadOutputJsonSchema = z.toJSONSchema(MerchantReadOutputSchema);

// ——— the fan-out ———

/** Clamp the model-provided entry cap into 1..50 — a forgiving clamp, not a
 * hard rejection (the store-search clampMaxPerStore law). */
function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(HARD_MAX_LIMIT, Math.max(1, Math.round(value)));
}

function displayPlatform(record: StoreRecord): string {
  return normalizeStorePlatform(record.platform) ?? record.platform;
}

/** Does this record match the (already canonicalized) platform filter? */
function matchesPlatformFilter(
  record: StoreRecord,
  filter: ReadonlySet<SupportedStorePlatform> | null,
): boolean {
  if (filter === null) return true;
  const canonical = normalizeStorePlatform(record.platform);
  return canonical !== null && filter.has(canonical);
}

/** Does this record match the `store` narrowing (label or domain)? */
function matchesStoreNarrowing(record: StoreRecord, store: string | undefined): boolean {
  if (store === undefined) return true;
  const needle = store.trim().toLowerCase();
  return (
    record.label.trim().toLowerCase() === needle ||
    record.domain.trim().toLowerCase() === needle
  );
}

type PerStoreOutcome =
  | { kind: "ok"; record: StoreRecord; snapshot: MerchantReadSuccess }
  | { kind: "error"; record: StoreRecord; error: { code: string; message: string } };

async function readStore(
  record: StoreRecord,
  operation: MerchantReadInput["operation"],
  limit: number,
): Promise<PerStoreOutcome> {
  try {
    const result = await readMerchantSnapshot({
      platform: record.platform,
      domain: record.domain,
      label: record.label,
      operation,
      limit,
      ...(record.credentials !== undefined ? { credentials: record.credentials } : {}),
    });
    if (isMerchantReadError(result)) {
      return { kind: "error", record, error: { code: result.code, message: result.message } };
    }
    return { kind: "ok", record, snapshot: result };
  } catch (error) {
    // The merchant entry never throws by contract — the defensive honest floor.
    return {
      kind: "error",
      record,
      error: {
        code: "platform_error",
        message: `${record.platform} merchant read failed unexpectedly (${
          error instanceof Error ? error.message : String(error)
        }).`,
      },
    };
  }
}

/** The entry count a per-store ok carries for the operation (the honest
 * count of what was actually read). */
function snapshotCount(
  snapshot: MerchantReadSuccess,
  operation: MerchantReadInput["operation"],
): number {
  if (operation === "shop_summary") {
    return snapshot.shopSummary !== undefined ? 1 : 0;
  }
  if (operation === "recent_orders") {
    return snapshot.orders.length;
  }
  return snapshot.inventory.length;
}

// ——— the handler ———

const merchantReadHandler: ToolHandler<
  MerchantReadInput,
  MerchantReadOutput | ToolHandlerFailure
> = async (input, context) => {
  context.abortSignal.throwIfAborted();
  const startedAt = Date.now();
  const parsed = MerchantReadInputSchema.parse(input);
  const limit = clampLimit(parsed.limit);

  // Platform filter — validated against the KNOWN platforms first: an
  // unknown platform is a helpful 400-style tool error (the model learns the
  // valid names), never a silently-empty "read" (the store-search law).
  let platformFilter: Set<SupportedStorePlatform> | null = null;
  if (parsed.platform !== undefined) {
    const canonical = normalizeStorePlatform(parsed.platform);
    if (canonical === null) {
      return {
        result: false,
        errorCode: 400,
        message: `merchant_read: unknown platform "${parsed.platform}" — the known platforms are shopify, woocommerce (alias "woo") and etsy; merchant reads are delivered for Etsy today (Shopify needs an Admin API token, WooCommerce needs ck/cs keys — both answer honestly not_configured until then).`,
      };
    }
    platformFilter = new Set<SupportedStorePlatform>([canonical]);
  }

  const state = await readConnectedStores();
  const notices: string[] = [];
  if (state.readError !== undefined) notices.push(state.readError);

  const allStores = state.stores;
  // Web-tier stores (no store API, e.g. Whatnot) are never planned — they
  // surface honestly in the notice as delegated-web guidance.
  const webStores = allStores.filter(
    (record) =>
      record.tier === "web" &&
      matchesPlatformFilter(record, platformFilter) &&
      matchesStoreNarrowing(record, parsed.store),
  );
  const readable = allStores.filter(
    (record) =>
      isSearchableStore(record) &&
      matchesPlatformFilter(record, platformFilter) &&
      matchesStoreNarrowing(record, parsed.store),
  );

  if (allStores.length === 0) {
    // The committed reader flags the canonical {"stores": []} shape as an
    // "unexpected shape" readError (the R5-recorded quirk); the connect-one
    // notice is pushed ALONGSIDE it (the find-best-offer precedent) — both
    // strings ride the notice, the quirk is surfaced, never hidden.
    notices.push(ZERO_STORES_NOTICE);
    return {
      ok: true,
      operation: parsed.operation,
      notice: notices.join(" "),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  for (const record of webStores) {
    notices.push(
      `${record.label} (${record.platform}) has no store API — merchant reads are not available for it; use the WebSearch tool for ${record.label} instead.`,
    );
  }

  if (parsed.store !== undefined && readable.length === 0) {
    const connected = allStores.map((record) => `${record.label} (${displayPlatform(record)})`);
    notices.push(
      `No connected store matches "${parsed.store}" — connected stores: ${connected.join(", ")}.`,
    );
    return {
      ok: true,
      operation: parsed.operation,
      ...(parsed.platform !== undefined ? { platform: parsed.platform } : {}),
      notice: notices.join(" "),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  if (readable.length === 0) {
    const connected = allStores.map((record) => displayPlatform(record));
    notices.push(
      `No connected merchant store was read for platform(s) ${
        parsed.platform !== undefined ? parsed.platform : "(all)"
      } — connected platforms: ${[...new Set(connected)].join(", ")}.`,
    );
    return {
      ok: true,
      operation: parsed.operation,
      ...(parsed.platform !== undefined ? { platform: parsed.platform } : {}),
      notice: notices.join(" "),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  // Fan out to every readable store in parallel; a store's failure never
  // fails the call — it lands in per_store honestly.
  const outcomes = await Promise.all(
    readable.map((record) => readStore(record, parsed.operation, limit)),
  );

  const perStore: NonNullable<MerchantReadOutput["per_store"]> = [];
  const okSnapshots: { record: StoreRecord; snapshot: MerchantReadSuccess }[] = [];
  for (const outcome of outcomes) {
    const platform = displayPlatform(outcome.record);
    if (outcome.kind === "ok") {
      perStore.push({
        platform,
        store: outcome.record.label,
        status: "ok",
        count: snapshotCount(outcome.snapshot, parsed.operation),
        ...(outcome.snapshot.truncated ? { truncated: true } : {}),
      });
      okSnapshots.push({ record: outcome.record, snapshot: outcome.snapshot });
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

  const face: MerchantReadOutput = {
    ok: true,
    operation: parsed.operation,
    // Single-store read (the overwhelmingly common merchant case): the face
    // carries the record's canonical label + platform. Multi-store reads
    // stay unattributed at the top level — the per_store strip attributes.
    ...(readable.length === 1
      ? { store: readable[0]?.label, platform: displayPlatform(readable[0]) }
      : {}),
    ...(parsed.platform !== undefined && readable.length > 1
      ? { platform: parsed.platform }
      : {}),
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
    per_store: perStore,
    durationMs: Math.max(0, Date.now() - startedAt),
  };

  if (parsed.operation === "shop_summary") {
    if (okSnapshots.length === 1) {
      face.shopSummary = okSnapshots[0]?.snapshot.shopSummary;
    } else if (okSnapshots.length > 1) {
      // Shop identities are NEVER merged into one summary: the notice names
      // the `store` narrowing (never a silently-dropped summary).
      notices.push(
        `Shop summaries were read for ${okSnapshots.length} connected stores — a shop summary is per-store and is never merged; pass store (label or domain) to narrow to one: ${okSnapshots
          .map((entry) => entry.record.label)
          .join(", ")}.`,
      );
      face.notice = notices.join(" ");
    }
  } else if (parsed.operation === "catalog_inventory") {
    // The channel rides the face ONLY when at least one store read ok —
    // absent ≠ empty ("no store was read" must never impersonate "the
    // catalog is empty").
    if (okSnapshots.length > 0) {
      face.inventory = okSnapshots.flatMap((entry) => entry.snapshot.inventory);
      if (okSnapshots.some((entry) => entry.snapshot.truncated)) {
        face.truncated = true;
      }
    }
  } else {
    if (okSnapshots.length > 0) {
      const orders = okSnapshots.flatMap((entry) => entry.snapshot.orders);
      // Recent first: newest createdAt at the head, unknown dates last (stable).
      orders.sort((a, b) => {
        if (a.createdAt === null && b.createdAt === null) return 0;
        if (a.createdAt === null) return 1;
        if (b.createdAt === null) return -1;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
      face.orders = orders;
      if (okSnapshots.some((entry) => entry.snapshot.truncated)) {
        face.truncated = true;
      }
    }
  }

  return face;
};

// ——— the tool entry (wired in handlers/index.ts) ———

export const merchantReadToolEntry: ToolEntry = {
  capability:
    "Read the merchant-side state of the user's connected stores (shop summary, catalog/inventory, recent orders) — read-only, through the connected stores' own credentials",
  metadata: {
    shouldDefer: true,
    name: MERCHANT_READ_TOOL_NAME,
    searchHint: "read the merchant-side shop state: summary, inventory, or recent orders",
    description: MERCHANT_READ_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    sideEffectScope: "network",
    riskLevel: "low",
    needsApproval: false,
  },
  aliases: ["read_store", "store_insights"],
  handler: merchantReadHandler as ToolHandler,
  inputSchema: MerchantReadInputJsonSchema,
  outputSchema: MerchantReadOutputJsonSchema,
  runtimeInputSchema: MerchantReadInputSchema,
  runtimeOutputSchema: MerchantReadOutputSchema,
  permission: {
    permission: "merchant_read",
    reason:
      "merchant_read performs read-only merchant GET requests (shop record, active listings, receipts) through the credentials of the store domains the user connected — the merchant read plane, read-only authority only; orders are read buyer-less",
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
    userVisibleMessage: "merchant_read was cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
