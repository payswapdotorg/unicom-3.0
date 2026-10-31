# SOURCE OF TRUTH — 2026-10-31 (the W-campaign: the full roadmap, implemented)

**Program:** UNiCOM Commerce Harness — the 2026-10-31 operator review's W1/W2/W3 roadmap
**Authorization:** the operator's 2026-10-31 instruction — "do not return until the entire
roadmap has been implemented not just because one phase is done" — received after the
review response (f3e6cd77) proposed the lanes.
**Tier ceiling:** FIXTURE (issue #23 law — unchanged; no live network, no real browser,
no live provider execution anywhere in this campaign).
**Implementation repo:** payswapdotorg/unicom-3.0 · this commit.
**Governance repo:** payswapdotorg/UniCom · the registry closure commit.

---

## The lanes, delivered

### W1 — Commerce truth (the review's §3 correctness demands)

| Item | Delivered | Evidence |
|---|---|---|
| The money boundary defect (REPRODUCED in the review response) | **CLOSED** — the three `toFixed(2)` laundering sites (planner.ts:232 / families.ts:126 / benchmark.ts:241, as cited at HEAD before the fix) replaced by ONE canonical projection: `finding-money.ts` | `numberToExactMoneyText` refuses sub-cent precision (`400.005` → null, never `"400.00"`); `priceText` preserved verbatim when the connector carries it; the boundary test is `commerce-harness-money.contract.test.ts` case 1 ("THE review's test") |
| Byte-stability of the committed R10 artifact | **PRESERVED** — the exact projection pads whole/1-dp values ("390" → "390.00" — the same exact value, padding ≠ rounding), so `docs/benchmark-r7-2026-10-30.json` re-reproduces byte-identically after the fix | the battery's benchmark re-run diff |
| Landed-cost correctness | **DELIVERED** — findings may carry observed `landed` components (shipping/tax/duties, each through the SAME exact boundary); the landed total appears ONLY when every component is observed; the budget constraint is `satisfied` ONLY on an observed landed total (and `violated` on an observed landed over-budget), subtotal-only fits stay UNKNOWN | `findingLandedBreakdown` + the W1-b test block |
| Product/variant matching | **DELIVERED** — normalized token matching (case/punctuation) + variant-level size evidence (`finding.variant`) | the W1-c test block |

### W2 — Opportunity engine & federation (the review's "central opportunity-engine gap")

| Item | Delivered | Evidence |
|---|---|---|
| The group-buy counterfactual calculation (the review's demanded shape, verbatim) | **DELIVERED** — `group-buy.ts`: observed price − threshold, exact BigInt cents, every number labelled with its basis (observed / published-volume-tier / stated-assumption); prerequisites verbatim (merchant honors, group commits, fresh re-observation); `actionable: false` always (INV-30) | `group-buy.contract.test.ts` case 1: observed 100, threshold 80, 20 participants → HKD 20.00/participant, HKD 400.00 total |
| The baseline law | **DELIVERED** — the counterfactual is computed against the CHEAPEST observed offer (measuring against a worse listing would inflate savings — caught and fixed by the scenario test, recorded as the honest baseline law) | `families.ts` evaluateGroupBuy |
| Persistent canonical opportunities | **DELIVERED** — `opportunity-store.ts`: content-hash identity (idempotent registration), every transition through the pure lifecycle functions with exactly one audit event, a persistence port (in-memory fixture / JSON file), snapshot carries only store data | `opportunity-store.contract.test.ts` (10 tests) |
| Cross-node publication & matching (Scenario 2) | **DEMONSTRATED** — the computed group-buy travels: node A publishes the shared-generalized projection; node B receives, validates, surfaces it for its own user; the PRIVATE record never touches the wire | `commerce-harness-scenarios.contract.test.ts` Scenario 2 |

### W3 — Universal connectors (the review's "browser must be a first-class transport")

| Item | Delivered | Evidence |
|---|---|---|
| Operation-level transport selection | **DELIVERED** — `transport-selector.ts`: discovery decides (undeclared/unavailable refused with reasons), deterministic preference api > mcp > cli > browser, policy gates, authority carried never relaxed, refusal-is-the-answer; the planner takes a discovery port (default = API-only, byte-identical plans) | `transport-selector.contract.test.ts` (11 tests) |
| Governed browser execution (Scenario 3) | **DEMONSTRATED** — selector routes to the browser fallback; the authority gate refuses unapproved acts BEFORE any page interaction; the read-back observation is the only success basis | Scenario 3 |
| Honest recovery (the review's exact demand) | **DELIVERED** — `browser-recovery.ts`: ONE bounded strategy (selector drift → structural relocation → ONE retry); the re-approval law (an act retry derives a NEW operation id — the original approval never covers it); every other cause is an honest stop naming WHO must act | `browser-recovery.contract.test.ts` (7 tests) |
| The merchant workflow states (Scenario 4) | **DEMONSTRATED** — recommendation ≠ prepared ≠ attempted ≠ verified, with port call counts proving the distinctions (0 effects at recommend/prepare/preview; the unapproved attempt throws before the port; exactly ONE effect at execution; the read-back verification record) | Scenario 4 |

### The acceptance demonstrations (the review's five scenarios)

`scripts/commerce-harness/run-scenarios.ts` runs all five end-to-end at the fixture tier
and emits `docs/scenarios-w-2026-10-31.json` — **byte-reproducible under `--at`** (second
run diff identical; re-verified after the planner split). Scenario 5 references the R7
benchmark artifact (byte-identical post-W1, post-split).

---

## The architecture ceiling event (recorded honestly)

`planner.ts` grew to 855 lines during W1 and tripped the 800-line architecture ceiling
(`architecture:check` → new: 1). Closed the same way the R4 renderer split closed it:
a behavior-verified split — the constraint-evaluation/shortlist/predicted-totals/
per-store half moved to `offer-evaluation.ts` (478 lines; planner.ts now 445), the public
surface re-exported so no caller changed. Proof the split was behavior-preserving: the
benchmark AND scenario artifacts re-reproduce **byte-identically** after it, and the
full battery re-ran green.

## New modules (all inside the adopted commerce-harness module — no adoption needed)

- `finding-money.ts` — the ONE canonical connector→harness money boundary (W1-a/W1-b)
- `group-buy.ts` — the counterfactual calculation (W2-a)
- `opportunity-store.ts` — persistent canonical store (W2-b)
- `transport-selector.ts` — operation-level selection (W3-a)
- `browser-recovery.ts` — bounded honest recovery (W3-b)
- `offer-evaluation.ts` — the planner split (the architecture-ceiling closure)

## What this campaign did NOT do (recorded, not excused)

- **No live tier.** Everything above is fixture tier by issue #23 law. The live lane
  (real network, real browser, real providers) still requires separate operator
  authorization.
- **No new integrations.** The review's advice was taken: no marketplace broadening —
  the core ideas were completed instead.
- ~~**CI remains unconfigured.**~~ **CLOSED same day** (the follow-up commit):
  `.github/workflows/battery.yml` now enforces the full battery — §1–§9 verbatim,
  including HARD `diff` gates on both committed artifacts (byte-drift fails CI) —
  on every push/PR to main. Committed-not-pushed like the rest of the chain; the
  first live run happens on the PAT push. Record: `docs/CI-ENFORCEMENT-2026-10-31.md`.
- **The push remains gated on a PAT.** This commit travels in the exported patch set
  until one is provided.

## The evidence chain

- Tests: `packages/services/test/commerce-harness-money.contract.test.ts` (22),
  `group-buy.contract.test.ts` (13), `opportunity-store.contract.test.ts` (10),
  `transport-selector.contract.test.ts` (11), `browser-recovery.contract.test.ts` (7),
  `commerce-harness-scenarios.contract.test.ts` (9) — **all new**; the six pre-existing
  harness suites re-verified unchanged (158).
- Artifacts: `docs/scenarios-w-2026-10-31.json` (new, byte-reproducible);
  `docs/benchmark-r7-2026-10-30.json` (unchanged bytes, re-verified twice).
- The full battery: `docs/TL-VERIFICATION-BATTERY-2026-10-31.md`.
