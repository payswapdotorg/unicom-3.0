// ============================================================
// commerce-harness — the W3 honest browser recovery suite
// (the 2026-10-31 review's "honest recovery when the UI changes,
// authentication expires, or a human challenge is required")
// ============================================================
//
// Pins the recovery laws (browser-recovery.ts):
//   1. SELECTOR DRIFT: element_not_found → ONE structural relocation →
//      ONE retry against the re-located element — bounded, recorded.
//   2. THE RE-APPROVAL LAW: an act retry derives a NEW operation id —
//      without an explicit retryApproval the recovery records the owed
//      re-approval and KEEPS the honest refusal (never an authority
//      side door).
//   3. EVERY OTHER CAUSE IS AN HONEST STOP naming WHO must act:
//      session_expired → the principal; challenge_required → a human;
//      ambiguous relocation → the caller declares a stricter selector.
//   4. A read-back retry recovers cleanly when the relocation is unique.
//
// Fixture tier: labelled fixture pages only (never production-reachable).

import { describe, expect, it } from "vitest";
import {
  buildFixtureBrowserPage,
  deriveBrowserOperationId,
  openBrowserSession,
  type ApprovalRecord,
  type BrowserOperation,
  type FixtureBrowserPage,
} from "../src/commerce-harness/browser-transport.js";
import {
  ACT_RETRY_REAPPROVAL_OWED,
  performBrowserOperationWithRecovery,
} from "../src/commerce-harness/browser-recovery.js";

const NOW = new Date("2026-10-31T00:00:00.000Z");
const PAGE_ORIGIN = "https://fixture.invalid";

function fixturePage(elements: Parameters<typeof buildFixtureBrowserPage>[0]["elements"]): FixtureBrowserPage {
  return buildFixtureBrowserPage({
    origin: PAGE_ORIGIN,
    sessionValid: true,
    latencyMs: 100,
    elements,
  });
}

function writeSession() {
  return openBrowserSession(
    {
      origin: PAGE_ORIGIN,
      authorityClass: "authorized-write",
      sessionId: "fixture-session-1",
      ttlMs: 60 * 60 * 1000,
    },
    NOW,
  );
}

const APPROVAL: ApprovalRecord = {
  principal: "fixture-principal",
  approvedAt: "2026-10-31T00:00:00.000Z",
  operationId: "fixture-original-operation",
  scope: "single-operation",
};

function actOperation(elementId: string): BrowserOperation {
  return {
    kind: "act",
    elementId,
    action: "click",
    idempotencyKey: "fixture-key-1",
    effectDescription: "fixture: click the checkout button",
    requiresWriteAuthority: true,
  };
}

// ——— selector drift: the ONE bounded recovery ———

describe("W3-b selector drift (element_not_found → one relocation → one retry)", () => {
  it("a drifted element recovers: unique structural match → ONE retry → ok, all recorded", () => {
    // The page carries the SAME structural element under a NEW id (the DOM drifted).
    const page = fixturePage([
      { id: "checkout-new", role: "button", label: "Checkout", text: "Checkout", visible: true },
    ]);
    const session = writeSession();
    const operation = actOperation("checkout-old");
    // The original act must pass the authority gates on its own id first —
    // it answers element_not_found only AFTER the gates (which it passes via
    // the approval bound to ITS operation id).
    const originalApproval: ApprovalRecord = {
      ...APPROVAL,
      operationId: deriveIdFor(operation),
    };
    const retryOperation = actOperation("checkout-new");
    retryOperation.idempotencyKey = "fixture-key-1#recovery-1";
    const retryApproval: ApprovalRecord = {
      ...APPROVAL,
      operationId: deriveIdFor(retryOperation),
    };
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: originalApproval,
      retryApproval,
      relocationTarget: { by: "label", value: "Checkout" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("ok");
    expect(recovery.recovery.strategy).toBe("selector-drift-relocation");
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.originalElementId).toBe("checkout-old");
      expect(recovery.recovery.relocatedElementId).toBe("checkout-new");
      expect(recovery.recovery.retryAttempted).toBe(true);
      expect(recovery.recovery.retryOutcome).toBe("ok");
      expect(recovery.recovery.relocationBasis).toContain('probe (label "Checkout")');
    }
  });

  it("WITHOUT a declared probe there is no honest relocation basis — the stop stands", () => {
    const page = fixturePage([{ id: "checkout-new", role: "button", label: "Checkout", text: "Checkout", visible: true }]);
    const session = writeSession();
    const operation = actOperation("checkout-old");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      retryApproval: { ...APPROVAL, operationId: "unused" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("element_not_found");
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.relocationBasis).toContain("no relocation probe was declared");
      expect(recovery.recovery.retryAttempted).toBe(false);
    }
  });

  it("NO structural survivor → no recovery is honest (the element is gone, not drifted)", () => {
    const page = fixturePage([{ id: "different", role: "button", label: "Other", text: "Other", visible: true }]);
    const session = writeSession();
    const operation = actOperation("checkout-old");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      retryApproval: { ...APPROVAL, operationId: "unused" },
      relocationTarget: { by: "label", value: "Checkout" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("element_not_found");
    expect(recovery.recovery.strategy).toBe("selector-drift-relocation");
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.retryAttempted).toBe(false);
      expect(recovery.recovery.relocatedElementId).toBeNull();
      expect(recovery.recovery.relocationBasis).toContain("found NO element");
    }
  });

  it("AMBIGUOUS relocation (two identical structural elements) → honest stop, never a pick", () => {
    const page = fixturePage([
      { id: "a", role: "button", label: "Checkout", text: "Checkout", visible: true },
      { id: "b", role: "button", label: "Checkout", text: "Checkout", visible: true },
    ]);
    const session = writeSession();
    const operation = actOperation("checkout-old");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      relocationTarget: { by: "label", value: "Checkout" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("element_not_found");
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.relocationBasis).toContain("AMBIGUOUS");
      expect(recovery.recovery.retryAttempted).toBe(false);
    }
  });
});

// ——— the re-approval law (recovery never relaxes authority) ———

describe("W3-b the re-approval law (an act retry is a NEW operation id)", () => {
  it("without retryApproval the recovery records the owed re-approval and keeps the refusal", () => {
    const page = fixturePage([{ id: "checkout-new", role: "button", label: "Checkout", text: "Checkout", visible: true }]);
    const session = writeSession();
    const operation = actOperation("checkout-old");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      relocationTarget: { by: "label", value: "Checkout" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("element_not_found"); // the honest refusal stands
    if (recovery.recovery.strategy === "selector-drift-relocation") {
      expect(recovery.recovery.retryAttempted).toBe(false);
      expect(recovery.recovery.relocatedElementId).toBe("checkout-new"); // the relocation WAS found
      expect(recovery.recovery.relocationBasis).toContain("re-approval is owed");
    }
    expect(ACT_RETRY_REAPPROVAL_OWED).toContain("never assumed");
  });
});

// ——— every other cause is an honest stop naming who must act ———

describe("W3-b honest stops (never a silent retry)", () => {
  it("session_expired → the PRINCIPAL must re-authenticate — no self-reauthentication", () => {
    const page = fixturePage([{ id: "checkout", role: "button", label: "Checkout", text: "Checkout", visible: true }]);
    const expiredSession = { ...writeSession(), expiresAt: "2026-10-30T00:00:00.000Z" };
    const recovery = performBrowserOperationWithRecovery({
      session: expiredSession,
      operation: actOperation("checkout"),
      approval: { ...APPROVAL, operationId: "any" },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("session_expired");
    expect(recovery.recovery.strategy).toBe("honest-stop");
    if (recovery.recovery.strategy === "honest-stop") {
      expect(recovery.recovery.actionRequired).toContain("PRINCIPAL must re-authenticate");
    }
  });

  it("challenge_required → a HUMAN must complete the challenge — never evaded", () => {
    const page = fixturePage([
      { id: "checkout", role: "button", label: "Checkout", text: "Checkout", visible: true, challenge: true },
    ]);
    const session = writeSession();
    const operation = actOperation("checkout");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("challenge_required");
    if (recovery.recovery.strategy === "honest-stop") {
      expect(recovery.recovery.actionRequired).toContain("HUMAN must complete the challenge");
    }
  });

  it("automation_denied (missing approval) → the authority refusal is final", () => {
    const page = fixturePage([{ id: "checkout", role: "button", label: "Checkout", text: "Checkout", visible: true }]);
    const session = writeSession();
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation: actOperation("checkout"),
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("automation_denied");
    if (recovery.recovery.strategy === "honest-stop") {
      expect(recovery.recovery.actionRequired).toContain("AUTHORITY refusal is final");
    }
  });

  it("an ok operation carries no recovery (strategy honest-stop, cause ok)", () => {
    const page = fixturePage([{ id: "checkout", role: "button", label: "Checkout", text: "Checkout", visible: true }]);
    const session = writeSession();
    const operation = actOperation("checkout");
    const recovery = performBrowserOperationWithRecovery({
      session,
      operation,
      approval: { ...APPROVAL, operationId: deriveIdFor(operation) },
      page,
      now: NOW,
      timeoutBudgetMs: 10_000,
    });
    expect(recovery.result.outcome).toBe("ok");
    expect(recovery.recovery.strategy).toBe("honest-stop");
  });
});

// ——— helper: derive the operation id exactly as browser-transport does ———

function deriveIdFor(operation: BrowserOperation): string {
  return deriveBrowserOperationId(operation);
}
