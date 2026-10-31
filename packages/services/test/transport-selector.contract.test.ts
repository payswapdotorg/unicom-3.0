// ============================================================
// commerce-harness — the W3 operation-level transport selector
// suite (the 2026-10-31 review's "operation-level capability
// discovery / transport selection")
// ============================================================
//
// Pins the selector's laws (transport-selector.ts):
//   1. DISCOVERY decides — an undeclared/unavailable transport is refused
//      with its reason; nothing is assumed available.
//   2. PREFERENCE is deterministic: api > mcp > cli > browser — the
//      browser route is the universal FALLBACK, never the first resort.
//   3. POLICY can forbid transports; the refusal is the answer (never a
//      silent reroute).
//   4. AUTHORITY is carried, never relaxed — the selection record states
//      the authority class the selected transport still enforces.
//   5. The planner integration: a caller-bound discovery routes the plan's
//      steps (browser fallback included) while the default stays API-only
//      and byte-identical to pre-W3 plans.
//
// Fixture tier: labelled discovery data + the pure planner.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSPORT_POLICY,
  TRANSPORT_PREFERENCE_ORDER,
  selectTransportForOperation,
  type OperationCapabilityDiscovery,
} from "../src/commerce-harness/transport-selector.js";
import { buildCapabilityPlan } from "../src/commerce-harness/planner.js";
import type { CommerceIntentEnvelope } from "../src/commerce-harness/intent.js";
import type { StoreConnectionRecord } from "../src/stores/stores.js";

const INTENT: CommerceIntentEnvelope = {
  query: "selector fixture item",
  consentBasis: "read-only-search",
  provenance: { surface: "test", expressedAt: "2026-10-31T00:00:00.000Z" },
  unknowns: [],
};

const RECORD: StoreConnectionRecord = {
  id: "w3-fixture-public",
  platform: "bigcommerce",
  domain: "fixture.invalid",
  label: "W3 Fixture Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

// ——— discovery + preference ———

describe("W3-a the operation-level transport selection", () => {
  it("API available → selected; every other transport refused with its exact reason", () => {
    const discovery: OperationCapabilityDiscovery = {
      operation: "store_search",
      authorityClass: "read-only",
      routes: [{ transport: "api", available: true, reason: "the committed API connector" }],
    };
    const selection = selectTransportForOperation(discovery);
    expect(selection.selectedTransport).toBe("api");
    expect(selection.candidates.find((candidate) => candidate.transport === "mcp")?.reason).toBe(
      "not declared by the connected capability",
    );
    expect(selection.candidates.find((candidate) => candidate.transport === "browser")?.reason).toBe(
      "not declared by the connected capability",
    );
    expect(selection.refusalSummary).toBeNull();
  });

  it("API absent + browser declared → THE FALLBACK: browser is selected, and the record answers why", () => {
    const discovery: OperationCapabilityDiscovery = {
      operation: "update_price",
      authorityClass: "approval-required",
      routes: [
        { transport: "api", available: false, reason: "the provider exposes no pricing API for this scope" },
        { transport: "browser", available: true, reason: "the merchant's web UI exposes the pricing form (labelled fixture)" },
      ],
    };
    const selection = selectTransportForOperation(discovery);
    expect(selection.selectedTransport).toBe("browser");
    expect(selection.candidates.find((candidate) => candidate.transport === "api")?.reason).toBe(
      "declared unavailable",
    );
    // THE LAW: the browser transport carries the SAME authority class — never relaxed.
    expect(selection.authorityClass).toBe("approval-required");
  });

  it("the preference order is deterministic and recorded: api > mcp > cli > browser", () => {
    expect(TRANSPORT_PREFERENCE_ORDER).toEqual(["api", "mcp", "cli", "browser"]);
    const allAvailable: OperationCapabilityDiscovery = {
      operation: "store_search",
      authorityClass: "read-only",
      routes: TRANSPORT_PREFERENCE_ORDER.map((transport) => ({
        transport,
        available: true,
        reason: `fixture: ${transport} route available`,
      })),
    };
    const selection = selectTransportForOperation(allAvailable);
    expect(selection.selectedTransport).toBe("api");
    expect(selection.candidates.find((candidate) => candidate.transport === "mcp")?.reason).toBe(
      "preferred alternative selected",
    );
  });

  it("MCP beats CLI beats browser when API is unavailable", () => {
    const discovery: OperationCapabilityDiscovery = {
      operation: "merchant_read",
      authorityClass: "read-only",
      routes: [
        { transport: "api", available: false, reason: "no REST scope" },
        { transport: "mcp", available: true, reason: "an MCP server exposes the read" },
        { transport: "cli", available: true, reason: "a CLI exists" },
        { transport: "browser", available: true, reason: "the web UI renders it" },
      ],
    };
    expect(selectTransportForOperation(discovery).selectedTransport).toBe("mcp");
  });

  it("policy can forbid the browser route — the refusal is the answer, never a silent reroute", () => {
    const discovery: OperationCapabilityDiscovery = {
      operation: "update_price",
      authorityClass: "approval-required",
      routes: [
        { transport: "api", available: false, reason: "no API" },
        { transport: "browser", available: true, reason: "the web UI form" },
      ],
    };
    const selection = selectTransportForOperation(discovery, {
      allowedTransports: ["api", "mcp", "cli"],
    });
    expect(selection.selectedTransport).toBeNull();
    expect(selection.refusalSummary).toContain("no selectable transport");
    expect(selection.refusalSummary).toContain("stays UNEXECUTED");
    expect(selection.candidates.find((candidate) => candidate.transport === "browser")?.reason).toBe(
      "refused by policy",
    );
  });

  it("no route at all → the honest refusal record (never a silent default)", () => {
    const selection = selectTransportForOperation({
      operation: "place_order",
      authorityClass: "authorized-write",
      routes: [],
    });
    expect(selection.selectedTransport).toBeNull();
    expect(selection.refusalSummary).toContain("place_order");
  });

  it("the default policy permits every transport in the preference order", () => {
    expect(DEFAULT_TRANSPORT_POLICY.allowedTransports).toEqual([...TRANSPORT_PREFERENCE_ORDER]);
  });
});

// ——— the planner integration ———

describe("W3-a the planner integration (the discovery port)", () => {
  it("default: steps are API-only — byte-identical to pre-W3 plans (the selection record proves it)", () => {
    const build = buildCapabilityPlan(INTENT, [RECORD], new Date("2026-10-31T00:00:00.000Z"));
    expect(build.plan.steps.length).toBeGreaterThan(0);
    for (const step of build.plan.steps) {
      expect(step.transport).toBe("api");
    }
    expect(build.transportSelections).toHaveLength(1);
    expect(build.transportSelections[0]?.selectedTransport).toBe("api");
  });

  it("a caller-bound discovery routes the plan's steps over the browser fallback", () => {
    const build = buildCapabilityPlan(INTENT, [RECORD], new Date("2026-10-31T00:00:00.000Z"), {
      discoverTransport: () => ({
        operation: "store_search",
        authorityClass: "read-only",
        routes: [
          { transport: "api", available: false, reason: "fixture: the catalog exposes no API" },
          { transport: "browser", available: true, reason: "fixture: a labelled browser route reads the catalog" },
        ],
      }),
    });
    for (const step of build.plan.steps) {
      expect(step.transport).toBe("browser");
    }
    // The authority class is unchanged by the routing — a transport, never a side door.
    for (const step of build.plan.steps) {
      expect(step.authorityClass).toBe("read-only");
    }
    expect(build.transportSelections[0]?.candidates.find((c) => c.transport === "browser")?.selected).toBe(true);
  });
});
