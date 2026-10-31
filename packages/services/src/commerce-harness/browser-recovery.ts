// ============================================================
// Commerce harness — W3 the honest browser/computer-use recovery
// orchestrator (the 2026-10-31 review's "honest recovery when the
// UI changes, authentication expires, or a human challenge is
// required", closed at the fixture tier)
// ============================================================
//
// THE RECOVERY LAW (bounded, structural, honest):
//   - EXACTLY ONE bounded recovery strategy exists: SELECTOR DRIFT. When an
//     operation answers "element_not_found", the orchestrator performs ONE
//     structural re-location (the same role + label/text the original
//     element id carried) and — if the re-location is UNIQUE — retries the
//     original operation ONCE against the re-located element. The retry and
//     its relocation are recorded in the recovery record; the action trace
//     keeps the original refusal. Bounded: one relocation, one retry, never
//     more — never a loop, never a guess.
//   - EVERY OTHER OUTCOME IS AN HONEST STOP, NEVER A RETRY:
//     session_expired (re-authentication requires the principal — the
//     orchestrator never re-authenticates itself), challenge_required (a
//     human challenge is a human's to solve — never evaded), ambiguous_control
//     (ambiguity is resolved by the caller declaring a stricter structural
//     selector, not by picking), automation_denied (an authority refusal is
//     final), timeout (the page's latency budget is a policy, not a
//     suggestion), not_supported, unknown. Each stop names WHO must act
//     (the principal / the caller) — the honest answer instead of silent
//     retry.
//   - THE RECOVERY NEVER RELAXES AUTHORITY: the retried operation carries
//     the SAME approval + session gates performBrowserOperation enforces —
//     recovery is a transport-level concern, never an authority side door.
//   - THE RECORD IS COMPLETE: recovery.attempted, the strategy, the
//     re-location evidence (the original element id → the re-located
//     element id), the retried operation's outcome, and the final outcome
//     the caller consumes.

import {
  performBrowserOperation,
  type ApprovalRecord,
  type BrowserOperation,
  type BrowserOperationResult,
  type BrowserSessionScope,
  type FixtureBrowserPage,
} from "./browser-transport.js";

/** The honest recovery strategy set — exactly one recoverable cause, everything else an honest stop. */
export type BrowserRecoveryStrategy = "selector-drift-relocation" | "honest-stop";

/** Why the operation stopped honestly — names WHO must act (never a silent retry). */
export interface HonestStopRecord {
  strategy: "honest-stop";
  /** The outcome that caused the stop (verbatim taxonomy). */
  cause: BrowserOperationResult["outcome"];
  /** Who must act and what they must do — the honest answer. */
  actionRequired: string;
}

/** The selector-drift recovery record — bounded to ONE relocation + ONE retry. */
export interface SelectorDriftRecoveryRecord {
  strategy: "selector-drift-relocation";
  /** The original element id the operation targeted. */
  originalElementId: string;
  /** The unique structurally-matching element found by the relocation probe (or null — no recovery possible). */
  relocatedElementId: string | null;
  /** The re-location basis — structural fields only (role + label/text equality), never interpreted text. */
  relocationBasis: string;
  /** Whether the single retry was performed. */
  retryAttempted: boolean;
  /** The retried operation's outcome (verbatim), or null when no retry was possible. */
  retryOutcome: BrowserOperationResult["outcome"] | null;
}

/** The recovery result the caller consumes: the final outcome + the complete recovery record. */
export interface BrowserRecoveryResult {
  /** The final outcome the caller consumes — the retry's outcome when recovered, else the original. */
  result: BrowserOperationResult;
  recovery: SelectorDriftRecoveryRecord | HonestStopRecord;
}

/**
 * Why an act retry was not attempted (the re-approval law): the principal
 * approved the ORIGINAL operation id; the re-targeted element derives a
 * DIFFERENT operation id, and that difference is an authority fact, not a
 * transport detail. Recorded verbatim on the recovery record.
 */
export const ACT_RETRY_REAPPROVAL_OWED =
  "the re-targeted act derives a new operation id — the principal's approval of the ORIGINAL operation does not " +
  "cover it; present retryApproval bound to the re-targeted operation (the re-approval is owed, never assumed)";

/** Who must act, per honest-stop cause — the honest answer table (never a silent retry). */
function actionRequiredFor(cause: BrowserOperationResult["outcome"]): string {
  switch (cause) {
    case "session_expired":
      return "the PRINCIPAL must re-authenticate the browser session — the orchestrator never re-authenticates itself and never retries into an expired session";
    case "challenge_required":
      return "a HUMAN must complete the challenge — the harness never evades a challenge (the honest-stop law)";
    case "ambiguous_control":
      return "the CALLER must declare a stricter structural selector (an exact element id) — the orchestrator never picks among ambiguous controls";
    case "automation_denied":
      return "the AUTHORITY refusal is final — the caller must obtain the required approval/authority class; no transport-level retry exists";
    case "timeout":
      return "the page's latency exceeded the caller's timeout budget — the CALLER may raise the budget as policy; the orchestrator does not retry on its own";
    case "not_supported":
      return "the session or control state does not support this operation — the caller must open a new governed session through the sanctioned path";
    case "unknown":
      return "the outcome is UNKNOWN (INV-10) — the caller must re-observe before deciding; the orchestrator never guesses a retry";
    case "ok":
    case "element_not_found":
      return "not an honest-stop cause";
  }
}

/**
 * Perform one governed browser operation WITH bounded honest recovery.
 *
 * Selector drift (element_not_found) → ONE structural relocation probe →,
 * when unique, ONE retry against the re-located element. Every other
 * non-ok outcome → the honest stop record naming who must act. The
 * operation's authority gates apply to the retry exactly as to the
 * original — recovery never relaxes authority (W3 law).
 */
export function performBrowserOperationWithRecovery(input: {
  session: BrowserSessionScope;
  operation: BrowserOperation;
  approval?: ApprovalRecord;
  /** The principal's approval for the RETRIED (re-targeted) act — required before any act retry (the re-approval law). */
  retryApproval?: ApprovalRecord;
  /**
   * The caller's DECLARED structural expectation of the operation's target
   * element (the same by/value vocabulary the locate operation uses). The
   * relocation probe re-locates by these STRUCTURAL fields only — never by
   * interpreting page text. Without a declared expectation there is no honest
   * relocation basis and the stop stands.
   */
  relocationTarget?: { by: "role" | "label" | "text"; value: string };
  page: FixtureBrowserPage;
  now: Date;
  timeoutBudgetMs: number;
}): BrowserRecoveryResult {
  const original = performBrowserOperation(input);

  if (original.outcome === "ok") {
    return {
      result: original,
      recovery: {
        strategy: "honest-stop",
        cause: "ok",
        actionRequired: "not an honest-stop cause",
      },
    };
  }

  if (original.outcome !== "element_not_found") {
    return {
      result: original,
      recovery: {
        strategy: "honest-stop",
        cause: original.outcome,
        actionRequired: actionRequiredFor(original.outcome),
      },
    };
  }

  // ——— the ONE bounded recovery: selector drift ———
  const recoveryBase: SelectorDriftRecoveryRecord = {
    strategy: "selector-drift-relocation",
    originalElementId: input.operation.kind === "act" || input.operation.kind === "read-back"
      ? input.operation.elementId
      : "(not an element operation)",
    relocatedElementId: null,
    relocationBasis: "",
    retryAttempted: false,
    retryOutcome: null,
  };

  // The relocation probe: the caller's DECLARED structural expectation, matched
  // by exact equality on the structural fields (the locate operation's own
  // by/value vocabulary — never interpreted text, INV-26).
  if (input.relocationTarget === undefined) {
    return {
      result: original,
      recovery: {
        ...recoveryBase,
        relocationBasis:
          "no relocation probe was declared — without a structural expectation there is no honest relocation basis; " +
          "the caller must declare relocationTarget (by/value) or an exact element id",
      },
    };
  }

  const matchesBy = (candidate: { role: string; label: string; text?: string }): boolean => {
    switch (input.relocationTarget?.by) {
      case "role":
        return candidate.role === input.relocationTarget.value;
      case "label":
        return candidate.label === input.relocationTarget.value;
      case "text":
        return (candidate.text ?? "") === input.relocationTarget.value;
      default:
        return false;
    }
  };
  const structuralMatches = input.page.elements.filter(matchesBy);
  if (structuralMatches.length === 0) {
    return {
      result: original,
      recovery: {
        ...recoveryBase,
        relocationBasis:
          `the relocation probe (${input.relocationTarget.by} "${input.relocationTarget.value}") found NO element — ` +
          "the target is gone, not drifted; no recovery is honest here",
      },
    };
  }
  if (structuralMatches.length > 1) {
    return {
      result: original,
      recovery: {
        ...recoveryBase,
        relocationBasis:
          `the relocation probe (${input.relocationTarget.by} "${input.relocationTarget.value}") matched ${structuralMatches.length} elements — ` +
          "relocation would be AMBIGUOUS; the honest answer stays element_not_found (the caller must declare an exact element id)",
      },
    };
  }

  const relocated = structuralMatches[0];
  if (relocated === undefined) {
    return {
      result: original,
      recovery: { ...recoveryBase, relocationBasis: "internal: relocation match vanished" },
    };
  }

  // The ONE retry — same authority gates (approval + session), same operation
  // shape, only the element id re-targeted. Never a second attempt.
  const retryOperation: BrowserOperation =
    input.operation.kind === "act"
      ? {
          ...input.operation,
          elementId: relocated.id,
          idempotencyKey: `${input.operation.idempotencyKey}#recovery-1`,
        }
      : input.operation.kind === "read-back"
        ? { ...input.operation, elementId: relocated.id }
        : input.operation; // locate/navigate carry no element to re-target

  // THE RE-APPROVAL LAW: an act retry derives a new operation id — the
  // original approval never covers it. Without an explicit retryApproval,
  // the recovery records the owed re-approval and keeps the honest refusal.
  if (input.operation.kind === "act" && input.retryApproval === undefined) {
    return {
      result: original,
      recovery: {
        ...recoveryBase,
        relocatedElementId: relocated.id,
        relocationBasis:
          `unique structural match on the declared probe (${input.relocationTarget?.by} "${input.relocationTarget?.value}") — ` +
          `relocated to element id ${relocated.id} (role "${relocated.role}", label "${relocated.label}"; INV-26: structural fields only, text is data). ` +
          ACT_RETRY_REAPPROVAL_OWED,
      },
    };
  }

  const retry = performBrowserOperation({
    session: input.session,
    operation: retryOperation,
    approval: input.operation.kind === "act" ? input.retryApproval : input.approval,
    page: input.page,
    now: input.now,
    timeoutBudgetMs: input.timeoutBudgetMs,
  });

  return {
    result: retry,
    recovery: {
      ...recoveryBase,
      relocatedElementId: relocated.id,
      relocationBasis:
        `unique structural match on the declared probe (${input.relocationTarget?.by} "${input.relocationTarget?.value}") — ` +
        `relocated to element id ${relocated.id} (role "${relocated.role}", label "${relocated.label}"; INV-26: structural fields only, text is data)`,
      retryAttempted: true,
      retryOutcome: retry.outcome,
    },
  };
}
