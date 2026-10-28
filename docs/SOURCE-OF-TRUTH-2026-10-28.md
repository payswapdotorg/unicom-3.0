# Source of Truth — TL Reconciliation (2026-10-28)

**Author:** TL (resident orchestrator) · **Status:** RECONCILED · **Supersedes:** the open source-of-truth question in UniCom issue #23 and the operator review of 2026-10-28 §8-1.

## 1. The question

The operator review (2026-10-28) and UniCom issue #23 both flag: `payswapdotorg/unicom-2.0` was not retrievable, and progress percentages must be assigned against a verified source of truth, not a guessed repo.

## 2. The evidence (all re-verified live on 2026-10-28)

| Repo | Latest main commit (2026-10-28) | What it IS | Status in the program |
|---|---|---|---|
| `unicom-2.0` | **404 — never existed** (GitHub API, PAT-authenticated) | Nothing | Not the source of truth; nothing to supersede from it |
| `unicom-3.0` | `a4f5f7af` (store_search refinements) on top of `943094c5` → `3e1fff19` → `ed32f006` (zai-org/zcode 3.16.2 @ `3c5b227649371507ddc4eb46ac5133afe6db1cab`, Apache-2.0) | The ZCode-runtime harness lane: pristine zcode import + the `store_search` builtin tool + connector library (Shopify/Woo public catalogs, Etsy credential-gated, per-store honest error taxonomy) | **Active implementation repo for the harness verticals** (per the operator's 2026-10-24 restart directive that created it, and the operator review of 2026-10-28 which inspects it and orders the first vertical slice built on `store_search`) |
| `UniCom` | `bf4f245b` (TL handoff: counterfactual commerce opportunities + universal connectors) — after `dc6b141` (both-worlds W3-025 + W1-027 merged) | The UNiCOM product architecture repo: frozen architecture v1.1, work-order registry, the commerce-OS contracts (CommerceIntent, Opportunity, EconomicGoal, GroupBuy, WaitOrBuyPlan, Experiment, Decision, Commerce Twin, Lab, Commerce Network), the both-worlds web/desktop host | **Contract + governance authority** (per operator-approved issue #23, which names it "active candidate source of truth" for the Commerce-OS mission) |
| `unicom-live` | `860b6177` (FE2 console wave) | The deployed Next.js console lineage | Auxiliary, not the harness |
| `unicom-console` | `72eca33` | The archived console reference (the operator-approved 2026-10-23 port source) | Auxiliary, not the harness |

**Branches:** `unicom-3.0` has `main` only (single-lane by design). `UniCom` carries the historical work-order lanes (`work/w1-*`, `feat/ui-plugin`, `tl/program-audit`) per its own registry.

**CI:** No CI configured on any of these repos (no `.github` in `unicom-3.0`; `UniCom` governs via its own architecture checks + work-order battery). **Gates run as TL batteries at merge time** — that is the operative quality mechanism, disclosed honestly.

## 3. The reconciliation (one program, two lanes, ONE vocabulary)

1. **`unicom-2.0` is retired from the conversation** — it never existed. All progress claims must reference `unicom-3.0` (harness verticals) or `UniCom` (product contracts).
2. **`unicom-3.0` is the active implementation repo** for everything the 2026-10-28 review marks as the near-term proof: the ZCode feature-preservation matrix (item 2), the `store_search` vertical slice (item 4), the connector conformance suite (item 5), merchant read capabilities (item 6), and the benchmark harness (item 7).
3. **`UniCom` is the contract authority.** The commerce-harness contract (review item 3) extends UniCom's canonical chain `CapabilityDefinition → ProviderImplementation → ConnectedCapabilityInstance → CapabilityObservation` and its evidence classes (`observed | conditional | predicted | recommended`) and authority levels (`read-only | draft-only | approval-required | authorized-write`). **No second vocabulary is created anywhere** — `unicom-3.0` connectors align to these names additively (its per-store `status`/`error` taxonomy stays as the transport-level honesty layer; capability/authority/evidence metadata joins at the connector-contract level defined per issue #23).
4. Issue #23's W1/W2/W3 lane ownership areas map onto the review's instruction list (W1 ↔ items 2+4; W2 ↔ items 3+7 + the counterfactual/federation workstreams; W3 ↔ items 5+6 + the universal connector transport). The two operator directives are consistent; this document is the join point.
5. Until an ADR changes it, **no live provider credentials, purchases, marketplace publications, order/inventory mutations or other consequential external actions** are authorized in any lane (issue #23 law). Read-only catalog observations and clearly-labeled fixtures only.

## 4. Progress percentages (assigned only now, against this table)

Against the operator review's progress graph, the honest current state of the program:

- ZCode-derived runtime baseline — **evidenced** (`ed32f006` import, runtime boots live in the sandbox viewer; full preservation matrix still owed).
- Store-search tool + connector registry — **implemented in source** (`a4f5f7af`, Shopify/Woo/Etsy, honest per-store errors).
- Commerce-specific intent planning (the capability planner/evaluator) — **not established**.
- Cross-platform read/write workflows — **not established** (read-only catalog search only).
- Connector coverage — **partial** (Amazon/Jumia/Temu/Alibaba not implemented; Whatnot honestly delegated to web search).
- Real-browser + packaged-app acceptance — **in progress** (the sandbox live viewer streams the desktop at :3000; the packaged-app proof is owed).
- Comparative benchmark — **not established** (baseline + suite owed before ANY multiplier claim; a 2× success-rate ratio will be reported as 2×, never as 10×).
