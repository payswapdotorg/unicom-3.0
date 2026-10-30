// ============================================================
// Commerce harness — L4 Governed Execution: the merchant write
// workflow (HARNESS-CONTRACT.md §1 L4, §2; the 2026-10-28 TL
// handoff "Workstream 1 merchant journey", acceptance evidence
// #4 "Merchant flow")
// ============================================================
//
// The merchant-flow acceptance law: "read genuine connected
// catalog/inventory/order observations; prepare a draft/preview;
// block unauthorized writes; reconcile after any future
// explicitly authorized write." This module owns the CHANGE
// side — the read plane exists since R6. The workflow is
// prepare → preview → approve → execute → verify, and every
// transition is governed:
//
// LAWS binding this module:
//   - AUTHORITY (INV-7/8, the execution.ts assertReadOnlyAuthority
//     discipline): prepare/preview are draft-only (no transport
//     anywhere); execute refuses with a typed MerchantAuthorityError
//     — "refused BEFORE any transport call. Nothing was
//     attempted." — unless the authority class is
//     "authorized-write", the draft status is "approved", and a
//     single-operation ApprovalRecord is bound to the draft id.
//     THE PORT IS NEVER INVOKED in those refusal cases.
//   - MONEY (INV-14): exact string decimals + explicit currency,
//     BigInt cents arithmetic only, same-currency comparisons
//     only — a cross-currency previous price renders UNKNOWN,
//     never a converted figure (no FX rate exists here to invent).
//     Unparseable amounts and non-integer inventory deltas are
//     refused at draft time (MerchantPayloadError) — never
//     rounded, never silently accepted.
//   - UNKNOWN PRESERVED (INV-10): a null previousPrice renders
//     "UNKNOWN"; a read-back mismatch verifies as
//     "mismatch-unknown" — never "failed"; current stock is a
//     READ, so an inventory preview never fabricates before/after
//     stock — both stay UNKNOWN until the post-write read-back.
//   - A CLICK IS NOT PROOF (W3 law): the write port's success is
//     only claimed after the post-action read-back reconciliation
//     (reconcileReadBack — the same law browser-transport.ts
//     enforces); only a "verified" reconciliation promotes the
//     draft to "verified".
//   - IDEMPOTENCY (W3 law): execute applies ONE port effect per
//     draft — a repeated execute returns the recorded execution
//     verbatim (object-identity keyed, so no cross-test bleed).
//   - PROVENANCE (INV-15): every transition appends a timestamped
//     audit entry; drafts are copy-on-write and frozen —
//     preparedAt and the payload stay reference-identical across
//     every transition.
//
// Pure module: the clock is injected, the write port is a
// fixture-bound port the CALLER binds (the way execution.ts's
// StepExecutor port works) — this module performs no I/O itself.

import { reconcileReadBack } from "./browser-transport.js";
import type { ApprovalRecord } from "./browser-transport.js";
import { formatHarnessMoney, parseMoneyToCents } from "./intent.js";
import type { HarnessMoney } from "./intent.js";
import type { CapabilityAuthorityClass, ConnectedStoreTarget } from "./plan.js";

// ——— the change vocabulary (closed; INV-34: no duplicate vocabulary) ———

/** The merchant change kinds v1 knows. */
export type MerchantChangeKind = "price_update" | "inventory_adjust";

/** One merchant change payload — exactly ONE branch set, validated at draft time. */
export interface MerchantChangePayload {
  /** Present iff kind === "price_update". Exact money only (INV-14). */
  priceUpdate?: {
    productId: string;
    newPrice: HarnessMoney;
    /** Null = previous price UNKNOWN (INV-10) — rendered "UNKNOWN", never fabricated. */
    previousPrice: HarnessMoney | null;
  };
  /** Present iff kind === "inventory_adjust". Integer delta only. */
  inventoryAdjust?: {
    productId: string;
    delta: number;
  };
}

/** The draft status closed set — the prepare→preview→approve→execute→verify lifecycle. */
export type MerchantChangeStatus =
  | "prepared"
  | "previewed"
  | "approved"
  | "executing"
  | "verified"
  | "blocked";

/** The closed status set, none silently missing (the R5 closed-set discipline). */
export const MERCHANT_CHANGE_STATUSES: readonly MerchantChangeStatus[] = [
  "prepared",
  "previewed",
  "approved",
  "executing",
  "verified",
  "blocked",
];

/** One audit-trail entry — timestamped (injected clock) with a reason, on every transition. */
export interface MerchantAuditEntry {
  at: string;
  event: string;
  reason: string;
}

/** The write execution record — ONE port effect by construction. */
export interface MerchantExecutionRecord {
  idempotencyKey: string;
  appliedAt: string;
  effect: string;
  /** Literal 1: exactly one port effect per draft, by construction (a defect if ever 2). */
  portEffects: 1;
}

/** The verification record the draft carries after verifyMerchantChange — honest in every verdict. */
export interface MerchantVerificationRecord {
  status: "verified" | "mismatch-unknown" | "partial";
  expected: string;
  observedValue: string;
  observedAt: string;
  recordedAt: string;
  reason: string;
}

/** The merchant change draft — copy-on-write, frozen at every transition. */
export interface MerchantChangeDraft {
  /** Deterministic: merchant-change|{kind}|{productId}|{preparedAt}. */
  id: string;
  store: ConnectedStoreTarget;
  kind: MerchantChangeKind;
  payload: MerchantChangePayload;
  preparedAt: string;
  status: MerchantChangeStatus;
  auditTrail: MerchantAuditEntry[];
  /** Present once executed. */
  execution?: MerchantExecutionRecord;
  /** Present once verified. */
  verification?: MerchantVerificationRecord;
}

// ——— the typed refusal gates ———

/** Thrown by the merchant authority gate BEFORE any transport call. A harness defect, not a statistic. */
export class MerchantAuthorityError extends Error {
  readonly draftId: string;
  readonly authorityClass: CapabilityAuthorityClass;
  readonly reason: MerchantAuthorityRefusalReason;
  constructor(
    draft: MerchantChangeDraft,
    authorityClass: CapabilityAuthorityClass,
    reason: MerchantAuthorityRefusalReason,
    detail: string,
  ) {
    super(
      `Merchant authority gate: draft ${draft.id} (${draft.kind} on ${draft.store.domain}, status ` +
        `"${draft.status}") was refused BEFORE any transport call. Nothing was attempted. ` +
        `Reason: ${reason} — ${detail}`,
    );
    this.name = "MerchantAuthorityError";
    this.draftId = draft.id;
    this.authorityClass = authorityClass;
    this.reason = reason;
  }
}

/** Why the merchant authority gate refused (closed set). */
export type MerchantAuthorityRefusalReason =
  | "authority-class"
  | "draft-status"
  | "missing-approval"
  | "operation-mismatch";

/** Thrown by the payload gate at draft time — INV-14/INV-10 discipline, never a silent fix-up. */
export class MerchantPayloadError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(
      `Merchant payload gate: ${detail} — refused BEFORE any draft was prepared. Nothing was attempted.`,
    );
    this.name = "MerchantPayloadError";
    this.field = field;
  }
}

// ——— the write port (fixture-bound; the CALLER binds the real transport) ———

/** The merchant write port — the governed transport this module never invokes ungated. */
export interface MerchantWritePort {
  /** Apply the change. The gate has already verified authority/approval/status when this runs. */
  execute(change: MerchantChangeDraft): { appliedAt: string; effect: string };
  /** The fresh read-back observation source the CALLER uses to build verifyMerchantChange's input. */
  readBack(change: MerchantChangeDraft): { observedValue: string; observedAt: string };
}

// ——— prepare (draft-only authority: no transport anywhere) ———

function freezePayload(payload: MerchantChangePayload): MerchantChangePayload {
  if (payload.priceUpdate !== undefined) {
    Object.freeze(payload.priceUpdate);
    Object.freeze(payload.priceUpdate.newPrice);
    if (payload.priceUpdate.previousPrice !== null) {
      Object.freeze(payload.priceUpdate.previousPrice);
    }
  }
  if (payload.inventoryAdjust !== undefined) {
    Object.freeze(payload.inventoryAdjust);
  }
  return Object.freeze(payload);
}

function validatePayload(kind: MerchantChangeKind, payload: MerchantChangePayload): void {
  const priceUpdate = payload.priceUpdate;
  const inventoryAdjust = payload.inventoryAdjust;
  if (priceUpdate !== undefined && inventoryAdjust !== undefined) {
    throw new MerchantPayloadError(
      "payload",
      "exactly one of priceUpdate/inventoryAdjust must be present — both were",
    );
  }
  if (priceUpdate === undefined && inventoryAdjust === undefined) {
    throw new MerchantPayloadError(
      "payload",
      "exactly one of priceUpdate/inventoryAdjust must be present — neither was",
    );
  }
  if (kind === "price_update") {
    if (priceUpdate === undefined) {
      throw new MerchantPayloadError("kind", 'kind "price_update" requires payload.priceUpdate');
    }
    if (priceUpdate.productId.length === 0) {
      throw new MerchantPayloadError("priceUpdate.productId", "productId must be a non-empty string");
    }
    if (parseMoneyToCents(priceUpdate.newPrice.amount) === null) {
      throw new MerchantPayloadError(
        "priceUpdate.newPrice.amount",
        `newPrice.amount "${priceUpdate.newPrice.amount}" is not an exact decimal (INV-14: at most two ` +
          `fraction digits, no rounding)`,
      );
    }
    if (priceUpdate.newPrice.currency.length === 0) {
      throw new MerchantPayloadError("priceUpdate.newPrice.currency", "newPrice.currency must be explicit (INV-14)");
    }
    if (priceUpdate.previousPrice !== null) {
      if (parseMoneyToCents(priceUpdate.previousPrice.amount) === null) {
        throw new MerchantPayloadError(
          "priceUpdate.previousPrice.amount",
          `previousPrice.amount "${priceUpdate.previousPrice.amount}" is not an exact decimal (INV-14)`,
        );
      }
      if (priceUpdate.previousPrice.currency.length === 0) {
        throw new MerchantPayloadError(
          "priceUpdate.previousPrice.currency",
          "previousPrice.currency must be explicit (INV-14)",
        );
      }
    }
  } else {
    if (inventoryAdjust === undefined) {
      throw new MerchantPayloadError("kind", 'kind "inventory_adjust" requires payload.inventoryAdjust');
    }
    if (inventoryAdjust.productId.length === 0) {
      throw new MerchantPayloadError("inventoryAdjust.productId", "productId must be a non-empty string");
    }
    if (!Number.isInteger(inventoryAdjust.delta)) {
      throw new MerchantPayloadError(
        "inventoryAdjust.delta",
        `inventory delta ${inventoryAdjust.delta} is not an integer — inventory arithmetic is integer only`,
      );
    }
  }
}

/** Prepare a draft at status "prepared" — draft-only authority: no transport anywhere. */
export function prepareMerchantChange(input: {
  store: ConnectedStoreTarget;
  kind: MerchantChangeKind;
  payload: MerchantChangePayload;
  now: Date;
}): MerchantChangeDraft {
  validatePayload(input.kind, input.payload);
  const preparedAt = input.now.toISOString();
  const priceProductId = input.payload.priceUpdate?.productId;
  const inventoryProductId = input.payload.inventoryAdjust?.productId;
  const productId = priceProductId ?? inventoryProductId ?? "unknown-product";
  const draft: MerchantChangeDraft = {
    id: `merchant-change|${input.kind}|${productId}|${preparedAt}`,
    store: input.store,
    kind: input.kind,
    payload: freezePayload(input.payload),
    preparedAt,
    status: "prepared",
    auditTrail: [
      {
        at: preparedAt,
        event: "prepared",
        reason: "draft-only authority — the draft was prepared without consulting any transport",
      },
    ],
  };
  return Object.freeze(draft);
}

// ——— preview (pure string rendering, no transport) ———

/** The rendered preview — the exact diff a human approves before any write. */
export interface MerchantChangePreview {
  lines: string[];
  moneyExact: true;
  before: string;
  after: string;
  /** The previewed draft (status "previewed" when the input was "prepared"). */
  draft: MerchantChangeDraft;
}

/** Format a BigInt cents delta as exact signed money, e.g. "+USD 4.50" / "-USD 1.25". */
function formatCentsDelta(cents: bigint, currency: string): string {
  const sign = cents < 0n ? "-" : "+";
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}${currency} ${whole}.${fraction}`;
}

/**
 * Render the exact preview. Pure string rendering — no transport, no clock-reading beyond the
 * injected one. `before` is "UNKNOWN" when previousPrice is null (INV-10) or cross-currency
 * (no FX rate is invented — INV-14's same-currency comparison law); inventory before/after
 * stay "UNKNOWN" because current stock is a READ this draft does not carry.
 */
export function previewMerchantChange(draft: MerchantChangeDraft, now: Date): MerchantChangePreview {
  const target = `${draft.store.label} (${draft.store.domain})`;
  let lines: string[];
  let before: string;
  let after: string;
  const priceUpdate = draft.payload.priceUpdate;
  const inventoryAdjust = draft.payload.inventoryAdjust;
  if (priceUpdate !== undefined) {
    after = formatHarnessMoney(priceUpdate.newPrice);
    const previousPrice = priceUpdate.previousPrice;
    if (previousPrice === null) {
      before = "UNKNOWN";
      lines = [
        `price_update — product ${priceUpdate.productId} on ${target}`,
        `before: UNKNOWN (no previous price was observed — INV-10, never fabricated)`,
        `after: ${after}`,
        `change: UNKNOWN (previous price unknown — INV-10, never a fabricated diff)`,
        `money: exact string decimals + explicit ${priceUpdate.newPrice.currency} (INV-14 — BigInt cents only)`,
      ];
    } else if (previousPrice.currency !== priceUpdate.newPrice.currency) {
      before = "UNKNOWN";
      lines = [
        `price_update — product ${priceUpdate.productId} on ${target}`,
        `before: UNKNOWN (previous price is ${previousPrice.currency}, new price is ` +
          `${priceUpdate.newPrice.currency} — cross-currency, no exchange rate is invented)`,
        `after: ${after}`,
        `change: UNKNOWN (cross-currency comparison — INV-14's same-currency law)`,
        `money: exact string decimals + explicit currencies (INV-14 — BigInt cents only)`,
      ];
    } else {
      before = formatHarnessMoney(previousPrice);
      const previousCents = parseMoneyToCents(previousPrice.amount);
      const newCents = parseMoneyToCents(priceUpdate.newPrice.amount);
      const change =
        previousCents !== null && newCents !== null
          ? formatCentsDelta(newCents - previousCents, priceUpdate.newPrice.currency)
          : "UNKNOWN";
      lines = [
        `price_update — product ${priceUpdate.productId} on ${target}`,
        `before: ${before}`,
        `after: ${after}`,
        `change: ${change} (exact BigInt-cents diff)`,
        `money: exact string decimals + explicit ${priceUpdate.newPrice.currency} (INV-14 — BigInt cents only)`,
      ];
    }
  } else if (inventoryAdjust !== undefined) {
    const sign = inventoryAdjust.delta >= 0 ? "+" : "";
    before = "UNKNOWN";
    after = "UNKNOWN";
    lines = [
      `inventory_adjust — product ${inventoryAdjust.productId} on ${target}`,
      `delta: ${sign}${inventoryAdjust.delta} units (integer arithmetic only)`,
      `before: UNKNOWN (current stock is a READ this draft does not carry — INV-10, never fabricated)`,
      `after: UNKNOWN (resulting stock is decided by the post-write read-back, never assumed)`,
      `money: none involved — moneyExact holds vacuously (INV-14 discipline kept)`,
    ];
  } else {
    // Unreachable post-validation; kept honest rather than crashing a renderer.
    throw new MerchantPayloadError("payload", "the draft carries no payload branch");
  }
  const previewedDraft: MerchantChangeDraft =
    draft.status === "prepared"
      ? Object.freeze({
          ...draft,
          status: "previewed",
          auditTrail: [
            ...draft.auditTrail,
            {
              at: now.toISOString(),
              event: "previewed",
              reason: "exact preview rendered — pure string rendering, no transport consulted",
            },
          ],
        })
      : draft;
  return { lines, moneyExact: true, before, after, draft: previewedDraft };
}

// ——— approve (the explicit human approval, bound to ONE operation id) ———

/** The approval result: the approved draft, or the honest block with its reason. */
export type MerchantApprovalResult =
  | { blocked: false; draft: MerchantChangeDraft }
  | { blocked: true; reason: "missing-approval" | "operation-mismatch"; draft: MerchantChangeDraft };

/**
 * Bind the principal's explicit approval to the draft. An approval whose operationId does not
 * match the draft id blocks (the draft is marked "blocked" — execute refuses anything not
 * "approved"). The approval parameter is undefined-able so "missing-approval" is representable.
 */
export function approveMerchantChange(
  draft: MerchantChangeDraft,
  approval: ApprovalRecord | undefined,
  now: Date,
): MerchantApprovalResult {
  const at = now.toISOString();
  if (approval === undefined) {
    return {
      blocked: true,
      reason: "missing-approval",
      draft: Object.freeze({
        ...draft,
        status: "blocked",
        auditTrail: [
          ...draft.auditTrail,
          {
            at,
            event: "approval-blocked",
            reason: "missing-approval — no ApprovalRecord was presented",
          },
        ],
      }),
    };
  }
  if (approval.operationId !== draft.id || approval.scope !== "single-operation") {
    return {
      blocked: true,
      reason: "operation-mismatch",
      draft: Object.freeze({
        ...draft,
        status: "blocked",
        auditTrail: [
          ...draft.auditTrail,
          {
            at,
            event: "approval-blocked",
            reason: `operation-mismatch — the approval (principal "${approval.principal}") is bound to ` +
              `"${approval.operationId}", not to "${draft.id}"`,
          },
        ],
      }),
    };
  }
  return {
    blocked: false,
    draft: Object.freeze({
      ...draft,
      status: "approved",
      auditTrail: [
        ...draft.auditTrail,
        {
          at,
          event: "approved",
          reason: `single-operation approval by principal "${approval.principal}" bound to "${draft.id}"`,
        },
      ],
    }),
  };
}

// ——— execute (the authority-gated write; the port is NEVER invoked ungated) ———

/** The execute result — the executing draft plus its ONE-effect execution record. */
export interface MerchantExecutionResult {
  draft: MerchantChangeDraft;
  execution: MerchantExecutionRecord;
}

/** Prior executions keyed by draft object identity — verbatim replay, no cross-test bleed. */
const EXECUTED_CHANGES = new WeakMap<object, MerchantExecutionResult>();

/**
 * Execute an approved merchant change through the write port.
 *
 * Refusal order (all BEFORE any transport call — the port's call counter stays 0):
 *   1. authority-class: authorityClass must be "authorized-write".
 *   2. approval: a single-operation ApprovalRecord bound to the draft id must be presented.
 *   3. idempotent replay: an already-executed draft returns the recorded execution verbatim
 *      (the port is not touched again — one port effect per draft, by construction).
 *   4. draft-status: the draft must be at status "approved".
 */
export function executeMerchantChange(input: {
  draft: MerchantChangeDraft;
  approval?: ApprovalRecord;
  authorityClass: CapabilityAuthorityClass;
  port: MerchantWritePort;
  now: Date;
}): MerchantExecutionResult {
  const { draft, authorityClass, port, now } = input;
  const approval = input.approval;
  if (authorityClass !== "authorized-write") {
    throw new MerchantAuthorityError(
      draft,
      authorityClass,
      "authority-class",
      `authorityClass "${authorityClass}" does not permit merchant writes — only "authorized-write" does`,
    );
  }
  if (approval === undefined) {
    throw new MerchantAuthorityError(
      draft,
      authorityClass,
      "missing-approval",
      "no single-operation ApprovalRecord bound to the draft id was presented",
    );
  }
  if (approval.operationId !== draft.id || approval.scope !== "single-operation") {
    throw new MerchantAuthorityError(
      draft,
      authorityClass,
      "operation-mismatch",
      `the approval (principal "${approval.principal}") is bound to "${approval.operationId}", ` +
        `not to "${draft.id}"`,
    );
  }
  // Idempotent replay — the recorded result, verbatim (both the original approved object and
  // the returned executing draft are registered, so either replays).
  const replayedByObject = EXECUTED_CHANGES.get(draft);
  if (replayedByObject !== undefined) {
    return replayedByObject;
  }
  if (draft.status === "executing" && draft.execution !== undefined) {
    return { draft, execution: draft.execution };
  }
  if (draft.status !== "approved") {
    throw new MerchantAuthorityError(
      draft,
      authorityClass,
      "draft-status",
      `draft status is "${draft.status}", not "approved" — the preview→approve gate was not completed`,
    );
  }

  const at = now.toISOString();
  const idempotencyKey = `merchant-write|${draft.id}`;
  const startedDraft: MerchantChangeDraft = Object.freeze({
    ...draft,
    status: "executing",
    auditTrail: [
      ...draft.auditTrail,
      {
        at,
        event: "execute-started",
        reason: `authority gate passed ("authorized-write" + approval verified); executing via the merchant ` +
          `write port with idempotency key "${idempotencyKey}"`,
      },
    ],
  });
  // The ONLY port invocation — reached exclusively past every gate above.
  const applied = port.execute(startedDraft);
  const execution: MerchantExecutionRecord = {
    idempotencyKey,
    appliedAt: applied.appliedAt,
    effect: applied.effect,
    portEffects: 1,
  };
  const executingDraft: MerchantChangeDraft = Object.freeze({
    ...startedDraft,
    execution,
    auditTrail: [
      ...startedDraft.auditTrail,
      {
        at,
        event: "execute-applied",
        reason: `the port applied the effect at ${applied.appliedAt}: "${applied.effect}" — one port effect ` +
          `by construction; a click is not proof, the read-back verification decides`,
      },
    ],
  });
  const result: MerchantExecutionResult = { draft: executingDraft, execution };
  EXECUTED_CHANGES.set(draft, result);
  EXECUTED_CHANGES.set(executingDraft, result);
  return result;
}

// ——— verify (the post-action read-back reconciliation — INV-10) ———

/** The verification result: the verdict, the honestly-recorded draft, and the reason. */
export interface MerchantVerificationResult {
  status: "verified" | "mismatch-unknown" | "partial";
  draft: MerchantChangeDraft;
  reason: string;
}

/**
 * Verify an executed change against a FRESH read-back observation. A mismatch is
 * "mismatch-unknown" — UNKNOWN, never "failed" (INV-10); only a "verified" reconciliation
 * promotes the draft to status "verified". Documented sub-cases: an empty expected value is
 * the absence of an expectation (partial); an empty observed value against a declared
 * expectation is an unconfirmed expectation (mismatch-unknown); a draft that has not
 * executed has nothing to verify (partial — never a fabricated verdict).
 */
export function verifyMerchantChange(
  draft: MerchantChangeDraft,
  freshRead: { observedValue: string; observedAt: string; expected: string },
  now: Date,
): MerchantVerificationResult {
  const recordedAt = now.toISOString();
  const expected = freshRead.expected.length > 0 ? freshRead.expected : null;
  const observed = freshRead.observedValue.length > 0 ? freshRead.observedValue : null;
  let status: "verified" | "mismatch-unknown" | "partial";
  let reason: string;
  if (draft.status !== "executing" || draft.execution === undefined) {
    status = "partial";
    reason =
      `the draft is at status "${draft.status}" with no execution record — there is no executed write ` +
      `to verify, so no verdict is fabricated (partial)`;
  } else {
    status = reconcileReadBack(expected, observed);
    if (status === "verified") {
      reason = `read-back matched the expectation exactly ("${expected}") — the only basis for claiming success`;
    } else if (status === "mismatch-unknown") {
      reason =
        `read-back observed "${observed}" against expectation "${expected}" — mismatch is UNKNOWN ` +
        `(INV-10), never "failed"`;
    } else {
      reason =
        `the read-back was incomplete (expected ${expected === null ? "(none)" : `"${expected}"`}, ` +
        `observed ${observed === null ? "(none)" : `"${observed}"`}) — partial, never a fabricated verdict`;
    }
  }
  const verification: MerchantVerificationRecord = {
    status,
    expected: freshRead.expected,
    observedValue: freshRead.observedValue,
    observedAt: freshRead.observedAt,
    recordedAt,
    reason,
  };
  const verifiedDraft: MerchantChangeDraft = Object.freeze({
    ...draft,
    status: status === "verified" ? "verified" : draft.status,
    verification,
    auditTrail: [
      ...draft.auditTrail,
      {
        at: recordedAt,
        event: "verification-recorded",
        reason: `read-back verification "${status}" (observed at ${freshRead.observedAt}): ${reason}`,
      },
    ],
  });
  return { status, draft: verifiedDraft, reason };
}
