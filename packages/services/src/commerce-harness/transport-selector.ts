// ============================================================
// Commerce harness — W3 the operation-level universal transport
// selector (the 2026-10-31 review's "operation-level capability
// discovery / transport selection", closed at the fixture tier)
// ============================================================
//
// THE LAW (the review's demand, verbatim): "Browser/computer use must be
// a first-class connector transport, not a separate agent with broader
// permissions." Selection happens PER OPERATION, by capability
// discovery over the operation's declared transports, under the SAME
// authority law that gates every other transport:
//
//   1. DISCOVERY: each operation declares which transports its connected
//      capability actually exposes (api | mcp | cli | browser), each with
//      its availability + an honest reason when unavailable. NOTHING is
//      assumed available — an undeclared transport is "not declared by
//      the connected capability".
//   2. PREFERENCE: deterministic order api > mcp > cli > browser (the
//      cheapest governed surface first; the browser route is the
//      universal FALLBACK, never the first resort). The order is a
//      recorded policy, not a hidden default.
//   3. AUTHORITY: the transport NEVER relaxes the operation's authority
//      class. A consequential operation (approval-required /
//      authorized-write) routed over the browser still needs the approval
//      gates browser-transport.ts enforces (session authorityClass +
//      single-operation ApprovalRecord). The selector REFUSES to select
//      any transport whose policy gates the operation out — the refusal
//      is the answer, recorded with its reason.
//   4. THE ANSWER IS A RECORD: every candidate transport is listed with
//      chosen/refused + the exact reason — "why did this step run over
//      the browser" is always answerable from the selection record.
//
// Pure module: no I/O, no clock — the caller binds discovery data.

import type { CapabilityAuthorityClass, CapabilityTransport } from "./plan.js";

/** The deterministic preference order (recorded policy, not a hidden default). */
export const TRANSPORT_PREFERENCE_ORDER: readonly CapabilityTransport[] = ["api", "mcp", "cli", "browser"];

/** One discovered transport route for an operation. */
export interface DiscoveredTransportRoute {
  transport: CapabilityTransport;
  /** Whether the connected capability actually exposes this transport for the operation. */
  available: boolean;
  /** The honest reason — mandatory when unavailable, informative when available. */
  reason: string;
}

/** The operation's discovery surface — what the connected capability declares, nothing assumed. */
export interface OperationCapabilityDiscovery {
  /** The operation being selected for (e.g. "store_search", "merchant_read", "update_price"). */
  operation: string;
  /** The authority class realizing this operation requires. */
  authorityClass: CapabilityAuthorityClass;
  /** The discovered routes — at least one entry per transport the capability declares. */
  routes: DiscoveredTransportRoute[];
}

/** The selection policy the caller binds (defaults preserve the v1 law). */
export interface TransportSelectionPolicy {
  /** Which transports the policy permits at all (e.g. no "browser" in a browserless deployment). */
  allowedTransports: readonly CapabilityTransport[];
}

/** The default policy: every transport permitted, the preference order decides. */
export const DEFAULT_TRANSPORT_POLICY: TransportSelectionPolicy = {
  allowedTransports: [...TRANSPORT_PREFERENCE_ORDER],
};

/** Why one candidate transport was not chosen — the closed refusal reason set. */
export type TransportRefusalReason =
  | "not declared by the connected capability"
  | "declared unavailable"
  | "refused by policy"
  | "preferred alternative selected";

/** One candidate's adjudication in the selection record. */
export interface TransportCandidateAdjudication {
  transport: CapabilityTransport;
  selected: boolean;
  reason: TransportRefusalReason | null;
  /** The discovery reason, carried verbatim (evidence lineage). */
  discoveryReason: string;
}

/** The selection record — the complete, answerable "why this transport". */
export interface TransportSelection {
  operation: string;
  selectedTransport: CapabilityTransport | null;
  /** Every candidate transport's adjudication — none silently missing. */
  candidates: TransportCandidateAdjudication[];
  /** The authority class the selected transport still enforces (never relaxed). */
  authorityClass: CapabilityAuthorityClass;
  /** Why there is no selection (when selectedTransport is null). */
  refusalSummary: string | null;
}

/**
 * Select the transport for ONE operation: the first AVAILABLE + POLICY-PERMITTED
 * transport in the deterministic preference order; the browser route is the
 * universal fallback, never the first resort. The selection NEVER relaxes the
 * operation's authority class — that law is carried on the record verbatim.
 *
 * When no transport is selectable, the answer is an honest refusal record
 * (selectedTransport: null + refusalSummary) — never a silent default.
 */
export function selectTransportForOperation(
  discovery: OperationCapabilityDiscovery,
  policy: TransportSelectionPolicy = DEFAULT_TRANSPORT_POLICY,
): TransportSelection {
  const declared = new Map(discovery.routes.map((route) => [route.transport, route]));
  const candidates: TransportCandidateAdjudication[] = [];
  let selected: CapabilityTransport | null = null;

  for (const transport of TRANSPORT_PREFERENCE_ORDER) {
    const route = declared.get(transport);
    if (route === undefined) {
      candidates.push({
        transport,
        selected: false,
        reason: "not declared by the connected capability",
        discoveryReason: "the connected capability declares no such transport for this operation",
      });
      continue;
    }
    if (!route.available) {
      candidates.push({
        transport,
        selected: false,
        reason: "declared unavailable",
        discoveryReason: route.reason,
      });
      continue;
    }
    if (!policy.allowedTransports.includes(transport)) {
      candidates.push({
        transport,
        selected: false,
        reason: "refused by policy",
        discoveryReason: route.reason,
      });
      continue;
    }
    if (selected === null) {
      selected = transport;
      candidates.push({
        transport,
        selected: true,
        reason: null,
        discoveryReason: route.reason,
      });
    } else {
      candidates.push({
        transport,
        selected: false,
        reason: "preferred alternative selected",
        discoveryReason: route.reason,
      });
    }
  }

  const refusalSummary =
    selected === null
      ? `no selectable transport for operation "${discovery.operation}": ` +
        candidates
          .map((candidate) => `${candidate.transport} (${candidate.reason ?? "selected"})`)
          .join(", ") +
        ` — the operation stays UNEXECUTED rather than silently rerouted (authority class "${discovery.authorityClass}" unchanged)`
      : null;

  return {
    operation: discovery.operation,
    selectedTransport: selected,
    candidates,
    authorityClass: discovery.authorityClass,
    refusalSummary,
  };
}

/**
 * The default buyer-flow discovery for a searchable store target: the
 * committed store_search connectors are API-only in v1 (the browser route is
 * NOT declared for catalog search — web-tier stores are delegated to the
 * WebSearch tool instead, a separate capability outside this selector).
 */
export function storeSearchApiOnlyDiscovery(operation = "store_search"): OperationCapabilityDiscovery {
  return {
    operation,
    authorityClass: "read-only",
    routes: [
      {
        transport: "api",
        available: true,
        reason: "the committed store_search connector set is API-based (public catalog GETs)",
      },
    ],
  };
}
