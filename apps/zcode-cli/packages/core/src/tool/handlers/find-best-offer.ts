// ============================================================
// find_best_offer Tool — the commerce harness's L1→L5 thread
// (HARNESS-CONTRACT.md, the R4 vertical slice A)
// ============================================================
//
// The store-search.ts pattern, extended one layer: instead of just searching,
// the tool plans + evaluates + returns a MEASURED outcome. When the principal
// asks e.g. "find me yeezy shoes under $400 total in HKD, EU 44, by Friday",
// the agent calls this tool with the structured intent, and the tool threads
// the five contract layers:
//
//   L1 Intent            the hard-constraint envelope (absent = UNKNOWN, INV-10)
//   L2 Intelligence      the calling agent (this tool is the L3→L5 instrument)
//   L3 Planner/Evaluator the CapabilityPlan + PlanEvaluation + the eight
//                        counterfactual candidate families (the center)
//   L4 Governed Exec     read-only authority ONLY: assertReadOnlyAuthority
//                        throws BEFORE any network call for a non-read-only
//                        step; execution runs through the COMMITTED
//                        store-search connectors (imported, never re-implemented)
//   L5 Measured Outcome  the shortlist + the opportunity set + honest
//                        per-store statuses, as one JSON face
//
// The pure logic is the core-side twin in ./find-best-offer/ (harness.ts +
// families.ts — the twin of the canonical module
// packages/services/src/commerce-harness/; the layering wall is documented
// in both headers). Output = the contract JSON: {ok, intent, plan,
// evaluation:{feasibility,constraintSatisfaction,predictedTotals}, results,
// opportunities, per_store, notice?, durationMs} — NO formatModelContent
// (the F4-P5-fix law: the JSON fallback feeds both the model and the
// transcript, which is the renderer's data face).

import { z } from "zod";
import type { ToolEntry, ToolHandler, ToolHandlerFailure } from "../types.js";
import {
  connectorFor,
  isStoreSearchError,
  normalizeStorePlatform,
  readConnectedStores,
  type StoreRecord,
} from "./store-search/index.js";
import {
  assertReadOnlyAuthority,
  buildCapabilityPlan,
  buildPerStoreStrip,
  buildShortlist,
  evaluateIntentConstraints,
  evaluatePlanFeasibility,
  evaluatePredictedTotals,
  type CapabilityObservation,
  type CapabilityPlanStep,
  type CommerceIntentEnvelope,
  type IntentUnknownField,
  type StoreTierValue,
} from "./find-best-offer/harness.js";
import { evaluateCounterfactualFamilies } from "./find-best-offer/families.js";

const FIND_BEST_OFFER_TOOL_NAME = "find_best_offer";
const DEFAULT_MAX_PER_STORE = 5;
const HARD_MAX_PER_STORE = 25;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 20_000;

const FIND_BEST_OFFER_DESCRIPTION = [
  "Find the best offer for a shopping intent across the user's connected stores — the commerce harness: one tool that plans, evaluates, executes read-only searches, and returns a measured outcome (HARNESS-CONTRACT five layers).",
  "",
  "- Use it when the user asks to find products WITH constraints: a total budget (maxTotal {amount, currency}), size (e.g. \"EU 44\"), brand, condition, geography or a deadline — e.g. \"find me yeezy shoes under $400 total in HKD, EU 44\".",
  "- For an unconstrained catalog search, prefer store_search; this tool adds the plan/evaluation/opportunity layers on top of the same connected stores.",
  "- Read-only by construction: it searches the connected stores' public catalogs (and one broadened substitutes probe per store) and NOTHING else — no writes, no messages, no orders.",
  "- `results` is the shortlist (offers with NO violated hard constraint; unknown constraints keep the offer in, marked unknown — UNKNOWN is never guessed and never collapsed).",
  "- `opportunities` is the counterfactual set (the eight families: substitutes, wait-or-buy, coupon eligibility, group buy, counteroffer, consolidation, local pickup, fulfillment route) — each with evidenceClass `conditional` or `predicted`, NEVER a live quote; a not_supported family says so with the exact reason (e.g. coupon eligibility: the Tier-1 public catalog exposes no promotions API).",
  "- Landed totals are honest: the observed subtotal is exact (string decimal + currency, e.g. \"4000.00\" HKD); shipping/tax/duties are unobserved and marked unknown; the harness never invents an exchange rate.",
  "- Per-store failures never fail the call — check `per_store` for each store's honest status (invalid_credentials, rate_limited, unreachable, timeout, platform_error, not_configured, not_supported).",
  "- When no store is connected, the result says so — suggest Settings -> Connected Stores, or use WebSearch instead.",
].join("\n");

const ZERO_STORES_NOTICE =
  "No stores are connected yet — open Settings → Connected Stores to add one, or ask me to search the web instead.";

// ——— input contract (the L1 intent envelope fields) ———

const MaxTotalSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,2})?$/u,
        'maxTotal.amount must be a plain decimal string like "400" or "400.00" (exact money — string decimals, never a float)',
      )
      .describe('Maximum landed total cost, as an exact decimal string, e.g. "400" or "400.00"'),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/u, "maxTotal.currency must be a 3-letter currency code, e.g. \"HKD\"")
      .describe('The budget currency code, e.g. "HKD"'),
  })
  .strict()
  .describe("The maximum landed total cost (exact money: decimal string + currency code)");

const FindBestOfferInputSchema = z
  .object({
    query: z.string().trim().min(1).describe('The product search query, e.g. "yeezy shoes"'),
    maxTotal: MaxTotalSchema.optional().describe("Maximum total cost the principal will pay (landed total: item + shipping + tax + duties)"),
    size: z.string().trim().min(1).max(64).optional().describe('Size/variant constraint, e.g. "EU 44"'),
    brand: z.string().trim().min(1).max(64).optional().describe("Brand constraint, e.g. \"adidas\""),
    condition: z.string().trim().min(1).max(64).optional().describe("Condition constraint, e.g. \"new\""),
    geography: z.string().trim().min(1).max(64).optional().describe("Ship-to geography, e.g. \"HK\""),
    deadline: z
      .string()
      .trim()
      .min(4)
      .max(40)
      .refine((value) => Number.isFinite(Date.parse(value)), {
        message: "deadline must be a parseable date (ISO 8601, e.g. \"2026-10-31\")",
      })
      .optional()
      .describe("When the purchase must happen, e.g. \"2026-10-31\""),
    excludedStores: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(50)
      .optional()
      .describe("Stores (label or domain) to exclude from the plan"),
    maxPerStore: z
      .number()
      .int()
      .optional()
      .describe(
        `Maximum findings per store per search (default ${DEFAULT_MAX_PER_STORE}, clamped into 1..${HARD_MAX_PER_STORE})`,
      ),
  })
  .strict();

type FindBestOfferInput = z.infer<typeof FindBestOfferInputSchema>;

// Provider-visible input schema, hand-written in the executor's supported JSON
// Schema subset (the store-search precedent: the zod schema above stays the
// single runtime authority; the provider schema is written directly).
const FindBestOfferInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description: 'The product search query, e.g. "yeezy shoes"',
    },
    maxTotal: {
      type: "object",
      additionalProperties: false,
      required: ["amount", "currency"],
      properties: {
        amount: {
          type: "string",
          description: 'Maximum landed total cost, as an exact decimal string, e.g. "400" or "400.00"',
        },
        currency: {
          type: "string",
          description: 'The budget currency code, e.g. "HKD"',
        },
      },
      description: "Maximum total cost the principal will pay (landed total: item + shipping + tax + duties)",
    },
    size: { type: "string", description: 'Size/variant constraint, e.g. "EU 44"' },
    brand: { type: "string", description: "Brand constraint, e.g. \"adidas\"" },
    condition: { type: "string", description: "Condition constraint, e.g. \"new\"" },
    geography: { type: "string", description: "Ship-to geography, e.g. \"HK\"" },
    deadline: { type: "string", description: "When the purchase must happen, e.g. \"2026-10-31\"" },
    excludedStores: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "Stores (label or domain) to exclude from the plan",
    },
    maxPerStore: {
      type: "integer",
      minimum: 1,
      maximum: HARD_MAX_PER_STORE,
      description: `Maximum findings per store per search (default ${DEFAULT_MAX_PER_STORE}, max ${HARD_MAX_PER_STORE})`,
    },
  },
} as const;

// ——— output contract (the harness JSON face) ———

const MoneySchema = z.object({ amount: z.string(), currency: z.string() }).strict();
const StoreTargetSchema = z
  .object({
    id: z.string(),
    platform: z.string(),
    domain: z.string(),
    label: z.string(),
    tier: z.enum(["public", "credential", "web"]),
  })
  .strict();
const PlanStepSchema = z
  .object({
    id: z.string(),
    target: StoreTargetSchema,
    operation: z.literal("store_search"),
    transport: z.literal("api"),
    authorityClass: z.enum(["read-only", "draft-only", "approval-required", "authorized-write"]),
    purpose: z.enum(["exact", "substitutes"]),
    query: z.string(),
    expectedObservation: z.string(),
    expectedCost: MoneySchema,
    expectedLatencyMs: z.number(),
  })
  .strict();
const IntentSchema = z
  .object({
    query: z.string(),
    maxLandedTotalCost: MoneySchema.optional(),
    size: z.string().optional(),
    brand: z.string().optional(),
    condition: z.string().optional(),
    geography: z.string().optional(),
    deadline: z.string().optional(),
    excludedStores: z.array(z.string()).optional(),
    consentBasis: z.literal("read-only-search"),
    provenance: z.object({ surface: z.string(), expressedAt: z.string() }).strict(),
    unknowns: z.array(
      z.enum([
        "maxLandedTotalCost",
        "size",
        "brand",
        "condition",
        "geography",
        "deadline",
        "excludedStores",
      ]),
    ),
  })
  .strict();
const StepFeasibilitySchema = z
  .object({
    stepId: z.string(),
    target: StoreTargetSchema,
    feasible: z.boolean(),
    authorityOk: z.boolean(),
    credentialScopeOk: z.boolean(),
    geographyCurrencyOk: z.union([z.boolean(), z.literal("unknown")]),
    freshnessOk: z.literal("unknown"),
    reasons: z.array(z.string()),
  })
  .strict();
const ConstraintSatisfactionSchema = z
  .object({
    constraint: z.enum(["budget", "size", "brand", "condition", "deadline"]),
    status: z.enum(["satisfied", "unknown", "violated"]),
    detail: z.string(),
  })
  .strict();
const PredictedTotalsSchema = z
  .object({
    budget: MoneySchema.nullable(),
    bestObservedSubtotal: z
      .object({ amount: z.string(), currency: z.string(), offerTitle: z.string() })
      .strict()
      .nullable(),
    currencyMatch: z.boolean().nullable(),
    landedTotalKnown: z.literal(false),
    unknowns: z.array(z.string()),
  })
  .strict();
const LandedTotalSchema = z
  .object({
    subtotal: MoneySchema.nullable(),
    shipping: MoneySchema.nullable(),
    tax: MoneySchema.nullable(),
    duties: MoneySchema.nullable(),
    total: MoneySchema.nullable(),
    unknowns: z.array(z.string()),
  })
  .strict();
const OfferConstraintSchema = z
  .object({
    constraint: z.enum(["budget", "size", "brand", "condition", "deadline"]),
    status: z.enum(["satisfied", "unknown", "violated"]),
    detail: z.string(),
  })
  .strict();
const ResultOfferSchema = z
  .object({
    rank: z.number().int().positive(),
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
    landedTotal: LandedTotalSchema,
    constraints: z.array(OfferConstraintSchema),
  })
  .strict();
const OpportunitySchema = z
  .object({
    family: z.enum([
      "group_buy_threshold",
      "merchant_counteroffer",
      "coupon_promotion_eligibility",
      "order_shipping_consolidation",
      "local_pickup",
      "different_fulfillment_route",
      "wait_or_buy",
      "approved_substitutes",
    ]),
    title: z.string(),
    feasibility: z.enum(["feasible", "not_supported", "approval_required"]),
    reason: z.string(),
    evidenceClass: z.enum(["conditional", "predicted"]),
    observedFacts: z.string(),
    changedAssumptions: z.string(),
    predictedOutcome: z.string(),
    preconditions: z.array(z.string()),
    evidence: z
      .object({
        source: z.string(),
        observedAt: z.string(),
        freshness: z.enum(["live-observed", "capability-inspection", "prediction"]),
        expiresAt: z.string().nullable(),
      })
      .strict(),
    consentRequired: z.string(),
    authorityRequired: z.string(),
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

const FindBestOfferOutputSchema = z
  .object({
    ok: z.literal(true),
    intent: IntentSchema,
    plan: z
      .object({
        createdAt: z.string(),
        consentBasis: z.literal("read-only-search"),
        steps: z.array(PlanStepSchema),
      })
      .strict(),
    evaluation: z
      .object({
        feasibility: z.array(StepFeasibilitySchema),
        constraintSatisfaction: z.array(ConstraintSatisfactionSchema),
        predictedTotals: PredictedTotalsSchema,
      })
      .strict(),
    results: z.array(ResultOfferSchema),
    opportunities: z.array(OpportunitySchema),
    per_store: z.array(z.union([PerStoreOkSchema, PerStoreFailureSchema])),
    notice: z.string().optional(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

type FindBestOfferOutput = z.infer<typeof FindBestOfferOutputSchema>;

// Provider-visible output schema via zod v4's native converter (the runtime
// schema above stays the validation authority for executor output checks).
const FindBestOfferOutputJsonSchema = z.toJSONSchema(FindBestOfferOutputSchema);

// ——— the governed executor (L4: the COMMITTED connectors, read-only only) ———

/** Clamp the model-provided per-store cap into 1..25 (the store-search law). */
function clampMaxPerStore(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_PER_STORE;
  return Math.min(HARD_MAX_PER_STORE, Math.max(1, Math.round(value)));
}

function displayPlatform(record: StoreRecord): string {
  return normalizeStorePlatform(record.platform) ?? record.platform;
}

function toHarnessTier(tier: string): StoreTierValue {
  return tier === "public" || tier === "credential" || tier === "web" ? tier : "public";
}

/**
 * Execute one plan step through the COMMITTED store-search connector (the
 * searchStore pattern from handlers/store-search.ts — imported machinery,
 * never re-implemented). The authority gate ran BEFORE this function: a
 * non-read-only step never reaches here (it throws upstream of the network).
 */
async function executeStep(
  step: CapabilityPlanStep,
  record: StoreRecord | undefined,
  maxPerStore: number,
): Promise<CapabilityObservation> {
  const observedAt = new Date().toISOString();
  const base = { stepId: step.id, target: step.target, operation: "store_search" as const, observedAt };
  if (record === undefined) {
    return {
      ...base,
      outcome: "platform_error",
      error: {
        code: "platform_error",
        message:
          `The step's store record (${step.target.id}) was not found in the connected-stores state — ` +
          "the plan and the reader drifted (a harness defect; nothing was searched).",
      },
    };
  }
  const connector = connectorFor(record.platform);
  if (connector === null) {
    return {
      ...base,
      outcome: "not_supported",
      error: {
        code: "not_supported",
        message: `No store_search connector for platform "${record.platform}" — connect a Shopify, WooCommerce or Etsy store instead.`,
      },
    };
  }
  try {
    const result = await connector.search({
      query: step.query,
      maxPerStore,
      sort: "newest",
      domain: record.domain,
      label: record.label,
      ...(record.credentials !== undefined ? { credentials: record.credentials } : {}),
    });
    if (isStoreSearchError(result)) {
      return { ...base, outcome: result.code, error: { code: result.code, message: result.message } };
    }
    return {
      ...base,
      outcome: "ok",
      findings: result.findings,
      ...(result.truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    // Connectors never throw by contract — this is the defensive honest floor.
    return {
      ...base,
      outcome: "platform_error",
      error: {
        code: "platform_error",
        message: `${record.platform} connector failed unexpectedly (${
          error instanceof Error ? error.message : String(error)
        }).`,
      },
    };
  }
}

// ——— the handler ———

const findBestOfferHandler: ToolHandler<
  FindBestOfferInput,
  FindBestOfferOutput | ToolHandlerFailure
> = async (input, context) => {
  context.abortSignal.throwIfAborted();
  const startedAt = Date.now();
  const parsed = FindBestOfferInputSchema.parse(input);
  const maxPerStore = clampMaxPerStore(parsed.maxPerStore);

  // L1: the intent envelope (absent constraints are recorded UNKNOWN — INV-10).
  const unknowns: IntentUnknownField[] = [];
  if (parsed.maxTotal === undefined) unknowns.push("maxLandedTotalCost");
  if (parsed.size === undefined) unknowns.push("size");
  if (parsed.brand === undefined) unknowns.push("brand");
  if (parsed.condition === undefined) unknowns.push("condition");
  if (parsed.geography === undefined) unknowns.push("geography");
  if (parsed.deadline === undefined) unknowns.push("deadline");
  if (parsed.excludedStores === undefined) unknowns.push("excludedStores");
  const intent: CommerceIntentEnvelope = {
    query: parsed.query,
    ...(parsed.maxTotal !== undefined
      ? {
          maxLandedTotalCost: {
            amount: parsed.maxTotal.amount,
            currency: parsed.maxTotal.currency.toUpperCase(),
          },
        }
      : {}),
    ...(parsed.size !== undefined ? { size: parsed.size } : {}),
    ...(parsed.brand !== undefined ? { brand: parsed.brand } : {}),
    ...(parsed.condition !== undefined ? { condition: parsed.condition } : {}),
    ...(parsed.geography !== undefined ? { geography: parsed.geography } : {}),
    ...(parsed.deadline !== undefined ? { deadline: parsed.deadline } : {}),
    ...(parsed.excludedStores !== undefined ? { excludedStores: parsed.excludedStores } : {}),
    consentBasis: "read-only-search",
    provenance: { surface: "find_best_offer tool call", expressedAt: new Date().toISOString() },
    unknowns,
  };

  // The committed reader (imported — never re-implemented).
  const state = await readConnectedStores();
  const notices: string[] = [];
  if (state.readError !== undefined) notices.push(state.readError);
  const allStores = state.stores;

  // L3: the plan (one exact step + one broadened substitutes step per searchable store).
  const build = buildCapabilityPlan(
    intent,
    allStores.map((record) => ({
      id: record.id,
      platform: record.platform,
      domain: record.domain,
      label: record.label,
      tier: toHarnessTier(record.tier),
      ...(record.status !== undefined ? { status: record.status } : {}),
    })),
    new Date(),
  );
  const feasibility = evaluatePlanFeasibility(build.plan);

  if (allStores.length === 0) {
    notices.push(ZERO_STORES_NOTICE);
  }
  for (const record of build.webRecords) {
    notices.push(
      `${record.label} (${record.platform}) has no public store API — it is searched via the web instead: use the WebSearch tool for ${record.label} findings.`,
    );
  }
  for (const record of build.excludedRecords) {
    notices.push(`${record.label} (${record.domain}) was excluded by the intent's excludedStores.`);
  }
  if (allStores.length > 0 && build.searchableRecords.length === 0 && build.excludedRecords.length === 0) {
    notices.push(
      `No connected store was searchable for this plan — connected platforms: ${[
        ...new Set(allStores.map((record) => displayPlatform(record))),
      ].join(", ")}.`,
    );
  }

  // The full record by target id (credentials stay in this closure — never in the plan).
  const recordByTargetId = new Map<string, StoreRecord>();
  for (const record of allStores) {
    if (!recordByTargetId.has(record.id)) recordByTargetId.set(record.id, record);
  }

  // L4: governed execution — the authority gate runs BEFORE the connector on
  // every step; the steps run in parallel (a store's failure lands in its
  // observation honestly, never failing the whole call).
  const observations = await Promise.all(
    build.plan.steps.map(async (step) => {
      assertReadOnlyAuthority(step);
      return executeStep(step, recordByTargetId.get(step.target.id), maxPerStore);
    }),
  );

  const purposeByStepId = new Map(build.plan.steps.map((step) => [step.id, step.purpose] as const));
  const exactObservations = observations.filter(
    (observation) => purposeByStepId.get(observation.stepId) === "exact",
  );
  const substitutesObservations = observations.filter(
    (observation) => purposeByStepId.get(observation.stepId) === "substitutes",
  );

  // L3 evaluation + L5 shortlist over the fresh observations (read-back).
  const shortlist = buildShortlist(intent, exactObservations);
  const constraintSatisfaction = evaluateIntentConstraints(intent, exactObservations, shortlist);
  const predictedTotals = evaluatePredictedTotals(intent, exactObservations);

  // The counterfactual families (the six-part records; evidence classes conditional/predicted only).
  const observedAt = new Date().toISOString();
  const opportunities = evaluateCounterfactualFamilies({
    intent,
    targets: build.searchableRecords.map((record) => ({
      id: record.id,
      platform: record.platform,
      domain: record.domain,
      label: record.label,
      tier: record.tier,
    })),
    exactObservations,
    substitutesObservations,
    observedAt,
  });

  const perStore = buildPerStoreStrip(exactObservations, (platform) => {
    const normalized = normalizeStorePlatform(platform);
    return normalized ?? platform;
  });

  return {
    ok: true,
    intent,
    plan: build.plan,
    evaluation: { feasibility, constraintSatisfaction, predictedTotals },
    results: shortlist,
    opportunities,
    per_store: perStore,
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
};

// ——— the tool entry (wired in handlers/index.ts) ———

export const findBestOfferToolEntry: ToolEntry = {
  capability:
    "Find the best offer for a shopping intent across the user's connected stores (the commerce harness: plan → evaluate → governed read-only search → measured outcome)",
  metadata: {
    shouldDefer: true,
    name: FIND_BEST_OFFER_TOOL_NAME,
    searchHint: "find the best offer or deal for a shopping intent across the user's connected stores",
    description: FIND_BEST_OFFER_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    sideEffectScope: "network",
    riskLevel: "low",
    needsApproval: false,
  },
  aliases: ["find_best_deal", "shop_intent"],
  handler: findBestOfferHandler as ToolHandler,
  inputSchema: FindBestOfferInputJsonSchema,
  outputSchema: FindBestOfferOutputJsonSchema,
  runtimeInputSchema: FindBestOfferInputSchema,
  runtimeOutputSchema: FindBestOfferOutputSchema,
  permission: {
    permission: "find_best_offer",
    reason:
      "find_best_offer performs read-only catalog GET requests (the exact ask plus one broadened substitutes probe) to the store domains the user connected — the harness's governed execution layer, read-only authority only",
    riskLevel: "low",
    sideEffectScope: "network",
    needsApproval: false,
    patternSources: ["toolName", "input", "network"],
    alwaysAllowPatternSources: ["network"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    // The harness JSON face has a structural floor ABOVE store_search's 10_000: the
    // eight six-part opportunity records alone measure ~12KB live (R4 fixture:
    // 15,445 bytes for the yeezy/HKD-400/EU-44 run, results empty). The budget must
    // let the §-contract JSON survive serialization UNTRUNCATED — the transcript
    // output is the renderer's data face (the F4-P5-fix law), and a truncated head
    // would starve the CommerceHarnessToolCallBlock card on every call.
    maxInlineBytes: MAX_OUTPUT_BYTES,
    maxModelBytes: MAX_OUTPUT_BYTES,
    strategy: "truncate",
    preview: {
      maxLines: 30,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: DEFAULT_TIMEOUT_MS,
    maxMs: 180_000,
    allowCallOverride: true,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "find_best_offer was cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
