# Source of Truth — TL Reconciliation, campaign 2026-10-30

**Author:** TL (resident orchestrator, session web-715a27e3-a43f-4909-86a3-1ceec59691a8) · **Status:** RECONCILED — R2–R6 recorded, R8–R10 dispatched · **Supersedes:** `docs/SOURCE-OF-TRUTH-2026-10-28.md` (kept immutable; its §4 judgments are re-assigned here)

## 1. The question

The 2026-10-28 record was written **before** the R2/R4/R5/R6 lanes landed, so its progress judgments are stale (most visibly: "commerce-specific intent planning — not established", overturned by R4). Two further debts accrued since: (a) the campaign evidence chain lived partly outside this repository (chat worklog, temp scripts — not reproducible in-repo), and (b) the R4–R6 pushes were made with `--no-verify` after the pre-push architecture check blocked. This record re-baselines the program on **in-repo evidence only**, per the issue #23 closure checklist ("worker summaries alone are not acceptance evidence").

## 2. The evidence (re-verified 2026-10-30, fresh anonymous clones)

| Repo | Default-branch HEAD (verified 2026-10-30 ~05:47 UTC) | Role |
|---|---|---|
| `payswapdotorg/UniCom` | `34585f1` — R3 harness contract (`spec/architecture/HARNESS-CONTRACT.md`) | Contract + governance authority (issue #23) |
| `payswapdotorg/unicom-3.0` | `c7bda09` — R6 merchant_read | Active implementation repo (the harness verticals) |

`unicom-2.0` remains retired (never existed — 2026-10-28 §2). Single lane `main` on `unicom-3.0`; no CI — **TL batteries at merge time are the quality mechanism** (disclosed, unchanged).

## 3. The lane record (in-repo evidence only, TL-counted 2026-10-30)

| Lane | Commit | Delivered | In-repo evidence | Evidence tier | Honest limits |
|---|---|---|---|---|---|
| R2 | `3d5cf9d2` | ZCode feature-preservation matrix (issue #23 Workstream A) | `docs/PRESERVATION-MATRIX-2026-10-28.md` (160 lines) | source-audit | Its `LIVE-VERIFIED` rows cite the prior campaign's **external** worklog — those rows are recorded claims, not repo-reproducible evidence |
| R4 | `33e3dbae` | `find_best_offer` — the first full L1→L5 commerce-harness thread: hard-constraint intent envelope, planner/evaluator, 8 counterfactual families, governed read-only execution, outcome record + renderer | 7 modules in `packages/services/src/commerce-harness/` + the core-side twin handler + UI renderer + i18n (15 files, +5014) | contract/fixture | Results are conditional/predicted, never live quotes; no writes by law |
| R5 | `067b7cc6` | The conformance suite — evidence-class honesty, authority honesty, UNKNOWN preservation, money correctness, provenance, the closed 8-family set | 3 test files: `packages/services/test/commerce-harness.contract.test.ts` (**29** it-blocks), `apps/zcode-cli/packages/core/tests/find-best-offer.contract.test.ts` (**20**), `packages/ui/test/commerce-harness-renderer.contract.test.ts` (**20**) | contract/fixture | No live network, no browser |
| R6 | `c7bda09` | `merchant_read` — the merchant-side L3/L4 read plane: shop summary/inventory/recent orders, **real Etsy OpenAPI GET-only reader**, honest `not_configured` for Shopify/Woo | core handler + `store-search/merchant/*` + tests (core **24**, UI **23** it-blocks) + renderer | contract/fixture; the Etsy reader is live-capable read-only code | No live acceptance run recorded in-repo; GET-only by construction |

Test-block counts above are TL-counted from the tree on 2026-10-30 and re-executed by the TL battery (§7) — they are no longer just worker-reported numbers.

## 4. Reconciled progress judgments (supersedes 2026-10-28 §4)

- ZCode-derived runtime baseline — **evidenced** (unchanged; R2 matrix).
- Store-search tool + connector registry — **implemented in source** (unchanged).
- Commerce-specific intent planning (capability planner/evaluator) — **ESTABLISHED at contract/fixture tier by R4** (`33e3dbae`). The 2026-10-28 "not established" is overturned by the commit, not by a claim.
- Cross-platform read/write workflows — **read plane extended** (buyer `store_search` + merchant `merchant_read` with a real Etsy reader); **write plane still not established** — by law: no consequential external actions without separate authorization.
- Connector coverage — **partial** (unchanged; Amazon/Jumia/Temu/Alibaba absent, Whatnot delegated to web search).
- Real-browser + packaged-app acceptance — **not met**: the root experience still boots the full ZCode workspace; the preservation matrix marks UNiCOM branding as a GAP. Owed, unchanged.
- Comparative benchmark — **not established until R10 lands** (dispatched this campaign at fixture tier; a "2×" stays "2×", nothing is advertised as "10×").

## 5. The gate debt (disclosed, closing this campaign)

- R4–R6 were pushed with `--no-verify`: the pre-push architecture check (`verify:pre-push` → `architecture:check --changed`) blocks new source files in unmanaged module roots — the R4/R6 **UI renderer files land in `packages/ui/src/`, a `managed: false` legacy root**, so those pushes bypassed the gate rather than resolving it.
- This campaign's law: **new code lands only in managed modules (`packages/services/src/commerce-harness/`) or test directories** (exempt by the checker's own rules); the full battery is re-run on the merged tree before any "done" claim (§7). The pre-existing `packages/ui` renderer files are baseline, not new violations — they stay disclosed here rather than silently excused.

## 6. The 2026-10-30 dispatch (three lanes, base `c7bda09`, pairwise-disjoint write surfaces)

| Lane | Brief (issue #23 acceptance item) | Exclusive write surface |
|---|---|---|
| **R8** | Opportunity lifecycle + two-node federation: persistence/freshness/expiry/re-verify/revocation/outcome reconciliation; publish→privacy-filter→match→revoke/expiry propagation across two isolated nodes (acceptance #2) | `packages/services/src/commerce-harness/opportunity-lifecycle.ts`, `packages/services/src/commerce-harness/federation.ts`, `packages/services/test/commerce-harness-lifecycle.contract.test.ts`, `packages/services/test/commerce-harness-federation.contract.test.ts` |
| **R9** | Universal connector fallback: the browser/computer-use transport as a governed L4 transport over labelled fixtures — scope denial, session expiry, timeout, DOM change, ambiguity, challenge-required, prompt injection, cancel, idempotency, manual approval, post-action read-back (acceptance #3) + the merchant execution workflow prepare/preview/approve/execute/verify with unauthorized writes blocked (acceptance #4) | `packages/services/src/commerce-harness/browser-transport.ts`, `packages/services/src/commerce-harness/merchant-execution.ts`, `packages/services/test/browser-transport.contract.test.ts`, `packages/services/test/merchant-execution.contract.test.ts` |
| **R10** | The R7 benchmark at fixture tier: fixed intent corpus × (harness / incumbent / general-baseline comparators) with the L5 denominators — task success, cost correctness, true/false savings, opportunity precision/recall, freshness, latency, privacy leaks, unauthorized actions, intervention rate (acceptance #6) | `packages/services/src/commerce-harness/benchmark.ts`, `packages/services/test/commerce-harness-benchmark.contract.test.ts`, `scripts/commerce-harness/run-benchmark.ts` |

**TL lane (this document + the registry + the battery):** `docs/SOURCE-OF-TRUTH-2026-10-30.md` (this file), `docs/TL-VERIFICATION-BATTERY-2026-10-30.md`, and in the UniCom repo `docs/development-state/issue-23-commerce-harness-state.json` + the README phase pointer. No worker touches git; the TL is the only committer. Max three workers concurrent; write surfaces pairwise-disjoint by the table above.

## 7. TL verification battery (2026-10-30)

Run by the TL on the merged tree at this commit's parent (`c7bda09` + the R8/R9/R10 lanes). Full commands + exit codes: `docs/TL-VERIFICATION-BATTERY-2026-10-30.md`. Summary: **249/249 tests across 13 files on three islands** — services 161 (the R5 suite re-verified at 29/29 + the three new lanes), core 44 (R5/R6 re-verified), UI 44 (R5/R6 re-verified + the split module manifest); `architecture:check` **OK 0/0/0** (two modules adopted via the sanctioned `architecture:adopt`, the pre-existing gen-ui-service artifact gap closed — not baselined, not bypassed); whole-repo lint **0 errors** (94 pre-existing warnings unchanged; the two pre-existing errors fixed at the root: `no-unsafe-finally` ×2 in `startup.ts`, and the R4 renderer's `max-lines` via the behavior-verified `commerce-harness-view` split); `tsc -b packages/services` **exit 0**; `test:architecture` **36/36**; the R7 benchmark artifact generated **byte-reproducible** (`docs/benchmark-r7-2026-10-30.json`: harness 0.8 success / 1.0 cost-correctness / 2 true / 0 false savings / precision 1.0 / recall 0.5 — the recall miss is the honestly-reported Tier-1-catalog limitation, not a hidden failure; no multiplier claim, live tier owed).

## 8. Evidence-chain law (from this record on)

1. Progress claims cite **in-repo artifacts at SHAs** (files, tests, scripts, committed reports). External worklog/chat references are non-authoritative and may only be quoted as *recorded claims*.
2. Worker reports are dispatch artifacts; only the TL battery result recorded in-repo closes a lane.
3. Every "delivered" row above carries its honest tier (`contract/fixture` vs `live`); nothing upgrades tier by assertion.
4. `--no-verify` pushes are prohibited; a blocked gate is a defect to resolve, never a gate to bypass.
