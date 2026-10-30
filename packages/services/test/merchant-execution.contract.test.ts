// ============================================================
// merchant-execution — the R9 merchant-write workflow
// fixture-tier contract suite (HARNESS-CONTRACT.md §1 L4, §2;
// the 2026-10-28 TL handoff acceptance evidence #4 "Merchant
// flow")
// ============================================================
//
// The merchant-flow acceptance, asserted end-to-end over the
// labelled fixture write port:
//   - the full prepare → preview → approve → execute → verify
//     thread (all five statuses observed in order);
//   - draft-only authority for prepare/preview (no transport
//     anywhere), and the pre-transport authority gate for
//     execute (MerchantAuthorityError + port call count 0 —
//     unauthorized writes are blocked BEFORE any transport);
//   - exact money previews (formatHarnessMoney strings, UNKNOWN
//     for a null/cross-currency previous price — INV-10/14) and
//     integer-only inventory arithmetic;
//   - idempotent execution (one port effect per draft, verbatim
//     replay) and post-write read-back reconciliation (a mismatch
//     is "mismatch-unknown", never "failed");
//   - the audit trail (every transition timestamped with a
//     reason), draft immutability, and the verbatim status
//     taxonomy.
//
// Fixture tier: the write port is a test double WITH CALL
// COUNTERS — the module itself is pure (injected clock, no I/O).

import { describe, expect, it } from "vitest";
import {
  MERCHANT_CHANGE_STATUSES,
  MerchantAuthorityError,
  MerchantPayloadError,
  approveMerchantChange,
  executeMerchantChange,
  prepareMerchantChange,
  previewMerchantChange,
  verifyMerchantChange,
  type MerchantChangeDraft,
  type MerchantChangePayload,
  type MerchantWritePort,
} from "../src/commerce-harness/merchant-execution.js";
import type { ApprovalRecord } from "../src/commerce-harness/browser-transport.js";
import { formatHarnessMoney } from "../src/commerce-harness/intent.js";
import type { ConnectedStoreTarget } from "../src/commerce-harness/plan.js";

// ——— the labelled fixtures ———

const NOW = new Date("2026-10-28T00:00:00.000Z");
const T1 = new Date("2026-10-28T00:01:00.000Z");
const T2 = new Date("2026-10-28T00:02:00.000Z");
const T3 = new Date("2026-10-28T00:03:00.000Z");
const T4 = new Date("2026-10-28T00:04:00.000Z");
const T5 = new Date("2026-10-28T00:05:00.000Z");

const STORE: ConnectedStoreTarget = {
  id: "r9-fixture-merchant",
  platform: "shopify",
  domain: "merchant-fixture.invalid",
  label: "R9 Fixture Merchant Store",
  tier: "credential",
};

function pricePayload(
  newAmount = "40.00",
  previousAmount: string | null = "35.50",
  previousCurrency = "USD",
): MerchantChangePayload {
  return {
    priceUpdate: {
      productId: "SKU-1",
      newPrice: { amount: newAmount, currency: "USD" },
      previousPrice:
        previousAmount === null ? null : { amount: previousAmount, currency: previousCurrency },
    },
  };
}

function inventoryPayload(delta = 5, productId = "SKU-2"): MerchantChangePayload {
  return { inventoryAdjust: { productId, delta } };
}

function preparePriceChange(payload: MerchantChangePayload = pricePayload()): MerchantChangeDraft {
  return prepareMerchantChange({ store: STORE, kind: "price_update", payload, now: NOW });
}

function approvalForDraft(draft: MerchantChangeDraft, principal = "merchant-principal-1"): ApprovalRecord {
  return {
    principal,
    approvedAt: "2026-10-27T23:59:00.000Z",
    operationId: draft.id,
    scope: "single-operation",
  };
}

/** The fixture write port — a double WITH CALL COUNTERS (the touched-vs-untouched proof). */
function fixtureWritePort(
  observedValue = "USD 40.00",
): MerchantWritePort & {
  executeCallCount: () => number;
  readBackCallCount: () => number;
  appliedEffects: () => string[];
  setObservedValue: (value: string) => void;
} {
  let executeCalls = 0;
  let readBackCalls = 0;
  let observed = observedValue;
  const effects: string[] = [];
  const port: MerchantWritePort = {
    execute: (change: MerchantChangeDraft) => {
      executeCalls += 1;
      const productId =
        change.payload.priceUpdate?.productId ?? change.payload.inventoryAdjust?.productId ?? "unknown-product";
      const effect = `${change.kind} applied to ${productId}`;
      effects.push(effect);
      return { appliedAt: "2026-10-28T00:10:00.000Z", effect };
    },
    readBack: () => {
      readBackCalls += 1;
      return { observedValue: observed, observedAt: "2026-10-28T00:11:00.000Z" };
    },
  };
  return Object.assign(port, {
    executeCallCount: () => executeCalls,
    readBackCallCount: () => readBackCalls,
    appliedEffects: () => [...effects],
    setObservedValue: (value: string) => {
      observed = value;
    },
  });
}

/** prepare → preview → approve: the pre-execution thread, ready for execute. */
function approvedPriceChange(payload: MerchantChangePayload = pricePayload()): {
  draft: MerchantChangeDraft;
  approval: ApprovalRecord;
} {
  const prepared = prepareMerchantChange({ store: STORE, kind: "price_update", payload, now: NOW });
  const preview = previewMerchantChange(prepared, T1);
  const approval = approvalForDraft(prepared);
  const approved = approveMerchantChange(preview.draft, approval, T2);
  expect(approved.blocked).toBe(false);
  return { draft: approved.draft, approval };
}

// ============================================================
// 1. The draft lifecycle (draft-only authority for prepare/preview)
// ============================================================

describe("merchant-execution — the draft lifecycle (prepare → preview → approve → execute → verify)", () => {
  it("prepare produces a frozen prepared draft under draft-only authority — no transport anywhere", () => {
    const prepared = preparePriceChange();
    expect(prepared.status).toBe("prepared");
    expect(prepared.kind).toBe("price_update");
    expect(prepared.store).toBe(STORE);
    expect(prepared.preparedAt).toBe("2026-10-28T00:00:00.000Z"); // the injected clock, verbatim
    expect(prepared.id).toBe("merchant-change|price_update|SKU-1|2026-10-28T00:00:00.000Z"); // deterministic
    expect(prepared.execution).toBeUndefined(); // nothing executed — no transport was consulted
    expect(prepared.verification).toBeUndefined();
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.payload)).toBe(true); // the payload is frozen too (INV-15)
    // Draft-only authority is recorded honestly in the audit trail.
    expect(prepared.auditTrail).toHaveLength(1);
    expect(prepared.auditTrail[0]?.event).toBe("prepared");
    expect(prepared.auditTrail[0]?.at).toBe(prepared.preparedAt);
    expect(prepared.auditTrail[0]?.reason).toContain("draft-only authority");
    expect(prepared.auditTrail[0]?.reason).toContain("without consulting any transport");
  });

  it("the full thread observes ALL FIVE statuses in order, executes exactly once, and verifies by read-back", () => {
    const port = fixtureWritePort("USD 40.00");
    const prepared = preparePriceChange(); // → prepared
    expect(prepared.status).toBe("prepared");
    const preview = previewMerchantChange(prepared, T1); // → previewed
    expect(preview.draft.status).toBe("previewed");
    const approval = approvalForDraft(prepared);
    const approved = approveMerchantChange(preview.draft, approval, T2); // → approved
    expect(approved.blocked).toBe(false);
    expect(approved.draft.status).toBe("approved");
    const executed = executeMerchantChange({
      draft: approved.draft,
      approval,
      authorityClass: "authorized-write",
      port,
      now: T3,
    }); // → executing
    expect(executed.draft.status).toBe("executing");
    expect(port.executeCallCount()).toBe(1); // ONE port effect
    // The verification reads back THROUGH THE PORT (the fresh observation source).
    const read = port.readBack(approved.draft);
    expect(port.readBackCallCount()).toBe(1);
    const verified = verifyMerchantChange(
      executed.draft,
      {
        observedValue: read.observedValue,
        observedAt: read.observedAt,
        expected: formatHarnessMoney({ amount: "40.00", currency: "USD" }),
      },
      T4,
    ); // → verified
    expect(verified.status).toBe("verified");
    expect(verified.draft.status).toBe("verified");
    // The five statuses, observed in order:
    expect([
      prepared.status,
      preview.draft.status,
      approved.draft.status,
      executed.draft.status,
      verified.draft.status,
    ]).toEqual(["prepared", "previewed", "approved", "executing", "verified"]);
    expect(port.executeCallCount()).toBe(1); // still exactly one write effect
  });

  it("preview renders exact money strings via formatHarnessMoney and the exact BigInt-cents diff", () => {
    const preview = previewMerchantChange(preparePriceChange(pricePayload("40.00", "35.50")), T1);
    expect(preview.moneyExact).toBe(true);
    expect(preview.before).toBe("USD 35.50");
    expect(preview.after).toBe("USD 40.00");
    expect(preview.lines).toContain("before: USD 35.50");
    expect(preview.lines).toContain("after: USD 40.00");
    expect(preview.lines.some((line) => line.startsWith("change: +USD 4.50"))).toBe(true); // exact BigInt diff
    expect(preview.lines.some((line) => line.includes("INV-14"))).toBe(true);
    // A price DECREASE renders the exact negative diff too.
    const decrease = previewMerchantChange(preparePriceChange(pricePayload("30.25", "35.50")), T1);
    expect(decrease.lines.some((line) => line.startsWith("change: -USD 5.25"))).toBe(true);
  });

  it("preview renders UNKNOWN for a null previousPrice — never a fabricated baseline (INV-10)", () => {
    const preview = previewMerchantChange(preparePriceChange(pricePayload("40.00", null)), T1);
    expect(preview.before).toBe("UNKNOWN");
    expect(preview.after).toBe("USD 40.00");
    expect(preview.lines.some((line) => line.includes("UNKNOWN") && line.includes("INV-10"))).toBe(true);
    expect(preview.lines.some((line) => line.startsWith("change: UNKNOWN"))).toBe(true);
    expect(preview.moneyExact).toBe(true);
  });

  it("preview renders a cross-currency previous price as UNKNOWN — no exchange rate is ever invented (INV-14)", () => {
    const preview = previewMerchantChange(preparePriceChange(pricePayload("40.00", "30.00", "EUR")), T1);
    expect(preview.before).toBe("UNKNOWN");
    expect(preview.after).toBe("USD 40.00");
    expect(preview.lines.some((line) => line.includes("cross-currency"))).toBe(true);
    expect(preview.lines.some((line) => line.includes("no exchange rate is invented"))).toBe(true);
  });

  it("inventory preview: integer delta rendered, before/after stock stay UNKNOWN (stock is a READ)", () => {
    const draft = prepareMerchantChange({
      store: STORE,
      kind: "inventory_adjust",
      payload: inventoryPayload(5),
      now: NOW,
    });
    const preview = previewMerchantChange(draft, T1);
    expect(preview.moneyExact).toBe(true); // no money involved — vacuously exact, still stated
    expect(preview.before).toBe("UNKNOWN");
    expect(preview.after).toBe("UNKNOWN");
    expect(preview.lines.some((line) => line === "delta: +5 units (integer arithmetic only)")).toBe(true);
    expect(preview.lines.some((line) => line.includes("current stock is a READ"))).toBe(true);
    expect(preview.lines.some((line) => line.includes("post-write read-back"))).toBe(true);
    // A negative delta renders the minus sign honestly.
    const decrease = previewMerchantChange(
      prepareMerchantChange({ store: STORE, kind: "inventory_adjust", payload: inventoryPayload(-3), now: NOW }),
      T1,
    );
    expect(decrease.lines.some((line) => line === "delta: -3 units (integer arithmetic only)")).toBe(true);
  });
});

// ============================================================
// 2. The payload gates (INV-14 exact money, integer inventory)
// ============================================================

describe("merchant-execution — the payload gates (INV-14)", () => {
  it("prepare refuses malformed money amounts — never rounds, never accepts silently", () => {
    expect(() => preparePriceChange(pricePayload("40.005", "35.50"))).toThrowError(MerchantPayloadError);
    expect(() => preparePriceChange(pricePayload("40.005", "35.50"))).toThrowError(/not an exact decimal/);
    expect(() => preparePriceChange(pricePayload("abc", "35.50"))).toThrowError(MerchantPayloadError);
    expect(() => preparePriceChange(pricePayload("40.00", "35.555"))).toThrowError(MerchantPayloadError);
    expect(() => preparePriceChange(pricePayload("40.00", "-1"))).toThrowError(MerchantPayloadError);
    try {
      preparePriceChange(pricePayload("40.005", "35.50"));
      throw new Error("the payload gate must throw for a third fraction digit");
    } catch (error) {
      const gateError = error as MerchantPayloadError;
      expect(gateError.name).toBe("MerchantPayloadError");
      expect(gateError.field).toBe("priceUpdate.newPrice.amount");
      expect(gateError.message).toContain("refused BEFORE any draft was prepared");
      expect(gateError.message).toContain("Nothing was attempted");
    }
  });

  it("prepare refuses non-integer inventory deltas and kind/payload mismatches (the closed payload discipline)", () => {
    expect(() =>
      prepareMerchantChange({ store: STORE, kind: "inventory_adjust", payload: inventoryPayload(2.5), now: NOW }),
    ).toThrowError(MerchantPayloadError);
    expect(() =>
      prepareMerchantChange({ store: STORE, kind: "inventory_adjust", payload: inventoryPayload(2.5), now: NOW }),
    ).toThrowError(/is not an integer/);
    // kind/payload mismatches:
    expect(() =>
      prepareMerchantChange({ store: STORE, kind: "price_update", payload: inventoryPayload(5), now: NOW }),
    ).toThrowError(/requires payload.priceUpdate/);
    expect(() =>
      prepareMerchantChange({ store: STORE, kind: "inventory_adjust", payload: pricePayload(), now: NOW }),
    ).toThrowError(/requires payload.inventoryAdjust/);
    // both branches / neither branch:
    expect(() =>
      prepareMerchantChange({
        store: STORE,
        kind: "price_update",
        payload: { priceUpdate: pricePayload().priceUpdate, inventoryAdjust: inventoryPayload(1).inventoryAdjust },
        now: NOW,
      }),
    ).toThrowError(/exactly one of priceUpdate\/inventoryAdjust/);
    expect(() => prepareMerchantChange({ store: STORE, kind: "price_update", payload: {}, now: NOW })).toThrowError(
      /exactly one of priceUpdate\/inventoryAdjust/,
    );
  });
});

// ============================================================
// 3. The authority gate — unauthorized writes blocked BEFORE any
//    transport call (INV-7/8; the port is never invoked)
// ============================================================

describe("merchant-execution — the pre-transport authority gate", () => {
  it("a read-only authority execute is refused with MerchantAuthorityError — port.execute call count 0", () => {
    const port = fixtureWritePort();
    const { draft, approval } = approvedPriceChange();
    try {
      executeMerchantChange({ draft, approval, authorityClass: "read-only", port, now: T3 });
      throw new Error("the authority gate must throw for a read-only authority");
    } catch (error) {
      expect(error).toBeInstanceOf(MerchantAuthorityError);
      const gateError = error as MerchantAuthorityError;
      expect(gateError.name).toBe("MerchantAuthorityError");
      expect(gateError.draftId).toBe(draft.id);
      expect(gateError.authorityClass).toBe("read-only");
      expect(gateError.reason).toBe("authority-class");
      expect(gateError.message).toContain("refused BEFORE any transport call");
      expect(gateError.message).toContain("Nothing was attempted");
      expect(gateError.message).toContain('only "authorized-write" does');
    }
    expect(port.executeCallCount()).toBe(0); // THE PORT WAS NEVER INVOKED
    expect(port.appliedEffects()).toEqual([]);
  });

  it("draft-only and approval-required authorities are refused the same way — count 0", () => {
    for (const authorityClass of ["draft-only", "approval-required"] as const) {
      const port = fixtureWritePort();
      const { draft, approval } = approvedPriceChange();
      expect(() =>
        executeMerchantChange({ draft, approval, authorityClass, port, now: T3 }),
      ).toThrowError(MerchantAuthorityError);
      expect(port.executeCallCount()).toBe(0);
    }
  });

  it("a missing approval at execute is refused BEFORE any transport call — count 0", () => {
    const port = fixtureWritePort();
    const { draft } = approvedPriceChange();
    try {
      executeMerchantChange({ draft, approval: undefined, authorityClass: "authorized-write", port, now: T3 });
      throw new Error("the authority gate must throw for a missing approval");
    } catch (error) {
      const gateError = error as MerchantAuthorityError;
      expect(gateError.reason).toBe("missing-approval");
      expect(gateError.message).toContain("no single-operation ApprovalRecord");
    }
    expect(port.executeCallCount()).toBe(0);
  });

  it("an approval bound to another operation is refused BEFORE any transport call — count 0", () => {
    const port = fixtureWritePort();
    const { draft, approval } = approvedPriceChange();
    const wrongApproval: ApprovalRecord = { ...approval, operationId: "merchant-change|price_update|SKU-9|elsewhere" };
    try {
      executeMerchantChange({ draft, approval: wrongApproval, authorityClass: "authorized-write", port, now: T3 });
      throw new Error("the authority gate must throw for a mismatched approval");
    } catch (error) {
      const gateError = error as MerchantAuthorityError;
      expect(gateError.reason).toBe("operation-mismatch");
      expect(gateError.message).toContain(`not to "${draft.id}"`);
    }
    expect(port.executeCallCount()).toBe(0);
  });

  it("a draft whose status is not approved is refused BEFORE any transport call — count 0", () => {
    // prepared (preview never rendered):
    const port = fixtureWritePort();
    const prepared = preparePriceChange();
    expect(() =>
      executeMerchantChange({
        draft: prepared,
        approval: approvalForDraft(prepared),
        authorityClass: "authorized-write",
        port,
        now: T3,
      }),
    ).toThrowError(MerchantAuthorityError);
    // previewed (approval never granted):
    const previewed = previewMerchantChange(preparePriceChange(), T1).draft;
    expect(() =>
      executeMerchantChange({
        draft: previewed,
        approval: approvalForDraft(previewed),
        authorityClass: "authorized-write",
        port,
        now: T3,
      }),
    ).toThrowError(/draft status is "previewed"/);
    expect(port.executeCallCount()).toBe(0); // both refusals never touched the port
  });
});

// ============================================================
// 4. Approval (the explicit human approval, bound to ONE operation)
// ============================================================

describe("merchant-execution — approval", () => {
  it("approve without an approval record blocks with reason missing-approval (the draft is marked blocked)", () => {
    const prepared = preparePriceChange();
    const blocked = approveMerchantChange(prepared, undefined, T1);
    if (blocked.blocked !== true) {
      throw new Error("approve without an approval record must block");
    }
    expect(blocked.reason).toBe("missing-approval");
    expect(blocked.draft.status).toBe("blocked");
    expect(blocked.draft.auditTrail[blocked.draft.auditTrail.length - 1]?.event).toBe("approval-blocked");
    expect(blocked.draft.auditTrail[blocked.draft.auditTrail.length - 1]?.reason).toContain("missing-approval");
  });

  it("approve with an approval bound to another operationId blocks with reason operation-mismatch", () => {
    const prepared = preparePriceChange();
    const wrong: ApprovalRecord = {
      principal: "merchant-principal-1",
      approvedAt: "2026-10-27T23:59:00.000Z",
      operationId: "merchant-change|price_update|SKU-9|elsewhere",
      scope: "single-operation",
    };
    const blocked = approveMerchantChange(prepared, wrong, T1);
    if (blocked.blocked !== true) {
      throw new Error("approve with a foreign-bound approval must block");
    }
    expect(blocked.reason).toBe("operation-mismatch");
    expect(blocked.draft.status).toBe("blocked");
    expect(blocked.draft.auditTrail[blocked.draft.auditTrail.length - 1]?.reason).toContain("operation-mismatch");
  });

  it("a blocked draft is recovered by the correct approval — the audit trail records both honestly", () => {
    const prepared = preparePriceChange();
    const blocked = approveMerchantChange(prepared, undefined, T1);
    const recovered = approveMerchantChange(blocked.draft, approvalForDraft(prepared), T2);
    expect(recovered.blocked).toBe(false);
    expect(recovered.draft.status).toBe("approved");
    const events = recovered.draft.auditTrail.map((entry) => entry.event);
    expect(events).toContain("approval-blocked");
    expect(events[events.length - 1]).toBe("approved");
  });
});

// ============================================================
// 5. Idempotent execution + post-write read-back verification
// ============================================================

describe("merchant-execution — idempotent execution + verification", () => {
  it("a repeated execute (via the returned executing draft) produces ONE port effect and the recorded result verbatim", () => {
    const port = fixtureWritePort();
    const { draft, approval } = approvedPriceChange();
    const first = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    expect(first.draft.status).toBe("executing");
    expect(first.execution.portEffects).toBe(1); // literal 1 by construction
    expect(first.execution.idempotencyKey).toBe(`merchant-write|${draft.id}`);
    const second = executeMerchantChange({
      draft: first.draft,
      approval,
      authorityClass: "authorized-write",
      port,
      now: T4,
    });
    expect(second).toBe(first); // the recorded execution, VERBATIM
    expect(port.executeCallCount()).toBe(1); // one port effect, not two
    expect(port.appliedEffects()).toEqual(["price_update applied to SKU-1"]);
  });

  it("a repeated execute with the ORIGINAL approved draft object also dedupes — one port effect", () => {
    const port = fixtureWritePort();
    const { draft, approval } = approvedPriceChange();
    const first = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    const second = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T4 });
    expect(second).toBe(first);
    expect(port.executeCallCount()).toBe(1);
    // And the executing draft's own record keeps the single effect:
    expect(first.draft.execution?.portEffects).toBe(1);
    expect(first.draft.execution?.appliedAt).toBe("2026-10-28T00:10:00.000Z"); // the port's honest time
  });

  it("a read-back mismatch verifies as mismatch-unknown — never failed (INV-10)", () => {
    const port = fixtureWritePort("USD 41.00"); // the store now shows 41.00, not 40.00
    const { draft, approval } = approvedPriceChange();
    const executed = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    const verified = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 41.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    expect(verified.status).toBe("mismatch-unknown");
    expect(verified.status).not.toBe("failed"); // UNKNOWN, never a failure verdict
    expect(verified.reason).toContain('never "failed"');
    // The draft records the verification honestly — it does NOT claim verified:
    expect(verified.draft.status).toBe("executing");
    expect(verified.draft.verification?.status).toBe("mismatch-unknown");
    expect(verified.draft.verification?.observedValue).toBe("USD 41.00");
    expect(verified.draft.verification?.expected).toBe("USD 40.00");
  });

  it("the verified path promotes the draft and records the full verification (observedAt included)", () => {
    const port = fixtureWritePort("USD 40.00");
    const { draft, approval } = approvedPriceChange();
    const executed = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    const verified = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T5,
    );
    expect(verified.status).toBe("verified");
    expect(verified.draft.status).toBe("verified");
    expect(verified.draft.verification?.status).toBe("verified");
    expect(verified.draft.verification?.observedAt).toBe("2026-10-28T00:11:00.000Z");
    expect(verified.draft.verification?.recordedAt).toBe("2026-10-28T00:05:00.000Z");
    expect(verified.reason).toContain("the only basis for claiming success");
  });

  it("the documented partial sub-cases: no expectation declared, and a draft that never executed", () => {
    const port = fixtureWritePort("USD 40.00");
    const { draft, approval } = approvedPriceChange();
    const executed = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    // (a) an empty expected value is the absence of an expectation — partial, not verified.
    const noExpectation = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "" },
      T4,
    );
    expect(noExpectation.status).toBe("partial");
    expect(noExpectation.draft.status).toBe("executing"); // partial never promotes the draft
    // (b) verifying a draft that never executed — nothing to verify, no fabricated verdict.
    const notExecuted = verifyMerchantChange(
      preparePriceChange(),
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    expect(notExecuted.status).toBe("partial");
    expect(notExecuted.reason).toContain("no executed write to verify");
  });
});

// ============================================================
// 6. The audit trail, the taxonomy, and draft immutability
// ============================================================

describe("merchant-execution — audit trail, taxonomy, immutability", () => {
  it("every transition has an audit entry with a timestamp and a reason — the full event sequence", () => {
    const port = fixtureWritePort("USD 40.00");
    const { draft, approval } = approvedPriceChange();
    const executed = executeMerchantChange({ draft, approval, authorityClass: "authorized-write", port, now: T3 });
    const verified = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    expect(verified.draft.auditTrail.map((entry) => entry.event)).toEqual([
      "prepared",
      "previewed",
      "approved",
      "execute-started",
      "execute-applied",
      "verification-recorded",
    ]);
    for (const entry of verified.draft.auditTrail) {
      expect(Number.isNaN(Date.parse(entry.at))).toBe(false); // a real (injected-clock) timestamp
      expect(entry.event.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0); // a reason on EVERY entry
    }
    // The blocked transition is audited too.
    const blocked = approveMerchantChange(preparePriceChange(), undefined, T1);
    expect(blocked.draft.auditTrail.map((entry) => entry.event)).toEqual(["prepared", "approval-blocked"]);
  });

  it("the status taxonomy is verbatim — the closed six-status set, each literally produced", () => {
    expect(MERCHANT_CHANGE_STATUSES).toEqual([
      "prepared",
      "previewed",
      "approved",
      "executing",
      "verified",
      "blocked",
    ]);
    const port = fixtureWritePort("USD 40.00");
    const observed: string[] = [];
    const prepared = preparePriceChange();
    observed.push(prepared.status); // "prepared"
    const preview = previewMerchantChange(prepared, T1);
    observed.push(preview.draft.status); // "previewed"
    const approval = approvalForDraft(prepared);
    const approved = approveMerchantChange(preview.draft, approval, T2);
    observed.push(approved.draft.status); // "approved"
    const executed = executeMerchantChange({
      draft: approved.draft,
      approval,
      authorityClass: "authorized-write",
      port,
      now: T3,
    });
    observed.push(executed.draft.status); // "executing"
    const verified = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    observed.push(verified.draft.status); // "verified"
    const blocked = approveMerchantChange(preparePriceChange(), undefined, T1);
    observed.push(blocked.draft.status); // "blocked"
    expect(observed).toEqual([...MERCHANT_CHANGE_STATUSES]);
    // And the verification verdicts are verbatim literals:
    expect(verified.status).toBe("verified");
    const second = approvedPriceChange();
    const secondExecuted = executeMerchantChange({
      draft: second.draft,
      approval: second.approval,
      authorityClass: "authorized-write",
      port,
      now: T3,
    });
    const mismatched = verifyMerchantChange(
      secondExecuted.draft,
      { observedValue: "USD 99.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    expect(mismatched.status).toBe("mismatch-unknown");
    expect(mismatched.status).not.toBe("failed");
  });

  it("preparedAt and the payload are reference-identical across every transition (draft immutability)", () => {
    const port = fixtureWritePort("USD 40.00");
    const prepared = preparePriceChange();
    const preview = previewMerchantChange(prepared, T1);
    const approval = approvalForDraft(prepared);
    const approved = approveMerchantChange(preview.draft, approval, T2);
    const executed = executeMerchantChange({
      draft: approved.draft,
      approval,
      authorityClass: "authorized-write",
      port,
      now: T3,
    });
    const verified = verifyMerchantChange(
      executed.draft,
      { observedValue: "USD 40.00", observedAt: "2026-10-28T00:11:00.000Z", expected: "USD 40.00" },
      T4,
    );
    for (const draft of [preview.draft, approved.draft, executed.draft, verified.draft]) {
      expect(draft.payload).toBe(prepared.payload); // the SAME frozen object, never rebuilt
      expect(draft.preparedAt).toBe(prepared.preparedAt); // never rewritten
      expect(draft.id).toBe(prepared.id);
      expect(Object.isFrozen(draft)).toBe(true); // copy-on-write: every stage is frozen
    }
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.payload.priceUpdate?.newPrice)).toBe(true); // the money too
  });
});
