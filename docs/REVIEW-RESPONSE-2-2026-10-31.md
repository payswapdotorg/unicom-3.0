# REVIEW RESPONSE 2 — 2026-10-31 (the second operator-side progress review)

**Responding to:** the operator's second in-depth review (received 2026-10-31, after the
W-campaign). **Method:** every finding was re-verified against this repository's HEAD
*before* answering — the same protocol as the first response (`docs/REVIEW-RESPONSE-2026-10-31.md`,
f3e6cd77). **Baseline note:** the review was compiled against the GitHub-visible remote
(`c7bda09` / `34585f1`, "no pushed implementation commits after 29 October") — exactly
origin/main. Eight (unicom-3.0) and seven (UniCom) commits exist committed-not-pushed,
gated on the PAT; the review itself anticipated this ("doesn't establish whether work is
happening in local or external agent sessions"). This response accounts for that gap
explicitly, per the review's request.

---

## 1. The counterfactual families table — CONFIRMED, with one row upgraded since the review's snapshot

The review's distinction is real and adopted: **eight candidate categories ≠ eight working
opportunity mechanisms.** The engine identifies possible improvements and honestly explains
why most cannot yet be executed; it has not demonstrated that it can *create* a lower-priced
negotiated offer, organize a viable group purchase, secure a discount, or discover a cheaper
fulfillment route. That remains true at HEAD — creating/realizing requires connected
capabilities that only the live lane (separate authorization, the standing open gate) can
exercise.

What changed at HEAD since the review's snapshot (4558d222, invisible to the remote-blind
review): the **group-buy row** upgraded from "refuses to predict" to **CALCULATED
counterfactual** — `group-buy.ts`: exact BigInt cents, every number labelled with its basis,
computed against the CHEAPEST observed offer, prerequisites verbatim, `actionable: false`
forever (INV-30). That is precisely the calculation the review's own §5 assigned to Worker 2
as "group-buy feasibility" — delivered at the fixture tier. The strongest implemented
mechanism remains broadened substitute searching — agreed, and the landed-total limitation
the review names is closed by law, not by capability: W1-b's `landedTotal` carries the
UNKNOWN ledger (`unknowns: ["shipping","tax","duties"]`) and the budget constraint is
`satisfied` ONLY on a fully observed landed total — the review's acceptance arm
("explicitly report that the total is unknown") is the implemented behavior.

## 2. The workstream table — row-by-row disposition

| Row | Review (remote-visible) | At HEAD (this chain) |
|---|---|---|
| A. ZCode preservation | Partial; packaged-app outstanding | Partial — agreed; but packaged-app acceptance CLOSED at `dcd2cf4d` (production build + file:// load + real UI under Xvfb), installers deb/AppImage/rpm/pacman delivered (`ed71a38f`/`d3a71259`/`6c68921c`). Branding remains the operator-level gap (preservation-matrix). |
| B. Counterfactual engine | Partial; most mechanisms unexercisable | Partial — agreed by design (fixture law). Money boundary + landed-cost law + variant matching (W1) and the group-buy calculation + persistent canonical store (W2) delivered at `4558d222`. |
| C. Opportunity federation | Not demonstrated | **Stale-baseline:** DEMONSTRATED at fixture tier — Scenario 2 (`docs/scenarios-w-2026-10-31.json`): node A publishes the consented generalized projection, node B receives/validates/matches it to its own user; the private record never touches the wire. Expiry/revocation: the R8 lifecycle suite (typed audit events, bulk expiry at the exact boundary, revocation semantics). |
| D. Universal connectors | Partial; browser fallback not demonstrated | **Stale-baseline:** transport selection + governed browser execution + honest recovery delivered (`transport-selector.ts`, `browser-recovery.ts`) — Scenario 3 (browser-only operation; read-back is the only success basis; ONE bounded recovery) + Scenario 4 (four distinct workflow states proven by port call counts). Computer-use remains out of scope, recorded. |
| E. Commerce workflows | Partial; merchant/seller workflows outstanding | Buyer + merchant-read foundations + the governed four-state merchant execution plane; the full store-operating write workflow is live-tier scope (the open gate). |
| R5 conformance | Delivered | Agreed. |
| R7 benchmark | Not demonstrated; no comparative result found | **Stale-baseline:** `docs/benchmark-r7-2026-10-30.json` exists and is byte-reproducible — three comparators (unicom-harness REAL / provider-native-incumbent / general-purpose-baseline, the latter two honestly labeled `simulated: true`), 10 cases × 3, aggregate dimension columns, `liveTierOwed: true`. See §6. |

## 3. Repository governance — one confirmed residue closed by the companion UniCom commit

- **README #22 → #23:** closed at the registry commit (`4b7150a` in the pre-reconciliation
  chain; `4731571` in the chain-of-record after the same-day reconciliation onto the
  operator's moved main — SHA map + the committer-date law recorded in the UniCom
  registry) — stale-baseline.
- **The #22 state file's "active" status:** the honest residue. The registry and README
  mark #22 superseded with `prior_phase_records_immutable: true`, but the state file itself
  still says `IN_PROGRESS` with the W3-024 dispatch recorded as the last activity. The
  companion UniCom commit appends a dated supersession block to that file — every historical
  byte preserved, the authority ambiguity closed (the review's "preserving historical phase
  evidence rather than overwriting it", verbatim).
- **The dispatch record (R4–R6 three workers):** CONFIRMED — and already disclosed in the
  registry's `known_findings`: "part of the R2-R6 campaign evidence chain (external worklog)
  lived outside the repos and is not repo-reproducible; it is recorded as claims only."
  Retro-fabricating dispatch assignments would be dishonest; it will not be done. The
  forward law stands (the registry's `dispatch_gate`: base SHA + pairwise-disjoint write
  surface recorded in-repo BEFORE any dispatch) and the next dispatch carries in-repo
  records from the first commit.
- **Source-of-truth staleness:** superseded by `SOURCE-OF-TRUTH-2026-10-30.md` and
  `SOURCE-OF-TRUTH-2026-10-31.md` (the W-campaign record) — stale-baseline. R7 is recorded
  DELIVERED in the registry lanes, not outstanding.
- **"GitHub shows no pushed commits after 29 October":** accounted for here — 8/7 commits
  ready, PAT-gated, exported as pinned patches with a cold-start-proven one-command
  recovery; the CI workflow's first live run rides the same push.

## 4. The money path — CONFIRMED, reproduced at HEAD, and worse than stated; closed in THIS commit (W1b)

The review's §4 named the Etsy merchant reader's `Math.round(value * 100)`. Reproduced —
and the hunt found **four** float-in-the-money-path sites, not one:

| Site | The laundering | Closed by |
|---|---|---|
| `store-search/merchant/etsy-merchant.ts` `moneyFromDecimalGrandtotal` | `Math.round(value*100)` — 400.005 → "400.01" | this commit (W1b boundary) |
| `store-search/etsy.ts` `moneyMajorUnits` (buyer) | `Math.round((amount/divisor)*100)/100` — 400005/1000 → "400.01"/"400.00" (float-representation-dependent) | this commit (exact rational) |
| `find-best-offer/harness.ts` `findingSubtotal` (the CORE TWIN — the deployed `find_best_offer` tool path) | `finding.price.toFixed(2)` — the SAME class the first review reproduced in the services module, fixed there at 4558d222, **but the twin was missed** | this commit |
| `find-best-offer/families.ts` `findingSubtotal` (twin) | same | this commit |

**The fix (the W1b law — the twin of `finding-money.ts`):** source decimal precision is
preserved at INGESTION. A JS number projects via its SHORTEST ROUND-TRIP decimal text
(`String(value)`), accepted only at ≤ 2 fraction digits (padding to two is the same exact
value); an Etsy Money `{amount, divisor}` is the exact rational — `BigInt(amount)*100`
must divide exactly. Anything else is **UNKNOWN (null), never rounded** (INV-14). The
merchant `moneyFromEtsyMoney` (amount/divisor) was already exact and stays.

**Tests (`apps/zcode-cli/packages/core/tests/money-boundary.contract.test.ts`, 9 new):**
the laundering table (400.005 → grandTotal/subtotal UNKNOWN with the sub-cent refusal
reason embedded in the budget detail); the exact cases (4599/100 → 45.99; 40005/100 →
400.05 — three significant digits, 2-dp-exact, neither rounded nor refused; 400005/1000 →
refused); byte-identical clean values (45.99 → "45.99"; 12.5 → "12.50"; 390 → "390.00").
The ingestion-to-output money path now demonstrates the strict exact-decimal guarantee at
every conversion site, core twin and connectors alike.

## 5. The three-worker structure — adopted; the lanes map to the review's prescription

W1/W2/W3 (delivered at `4558d222`) map to the review's Worker 1/2/3 almost verbatim:
Worker 1 = W1 (exact money, landed totals, comparability — the "cheapest comparable
landed-cost OR explicitly report unknown" acceptance is the `landedTotal.unknowns` law);
Worker 2 = W2 (opportunity lifecycle, group-buy feasibility, federation, privacy, expiry,
revocation — the two-node acceptance is Scenario 2 + the lifecycle suite); Worker 3 = W3
(operation-level routing, authority, post-action verification — the "API-unavailable
operation through an authorized UI route with state-change evidence" acceptance is
Scenario 3's read-back law + Scenario 4's port-call-count proof). What the review's full
acceptance still requires beyond this: the live lane (gated) and the benchmark's first
live-tier run. The TL separately owns integration + the R7 benchmark + final product
acceptance — the battery is that instrument.

## 6. The benchmark — the real deliverable already exists; the 10× stays a hypothesis

`docs/benchmark-r7-2026-10-30.json` (byte-reproducible, re-verified through the W1 fix and
the planner split): 10 intents × 3 comparators under equivalent fixture conditions — the
REAL harness flow (`simulated: false`) against provider-native-incumbent and
general-purpose-baseline (both honestly `simulated: true`, `liveTierOwed: true`,
`latencyBasis: "modeled-fixture-step-latency-not-live"`). The review's measurement table,
column by column: **task completion** (`taskSuccessRate` + per-case honest-miss details),
**landed-cost correctness** (`costCorrectnessRate` + `cannotJudgeCount`), **opportunity
precision** (`opportunityPrecision`/`opportunityRecall`), **verified savings**
(`trueSavingsCount` vs `falseSavingsCount` — "a prediction of $80 against $100 is not $20
of verified savings" is exactly this metric's law; ground truth per case), **recovery**
(honest-failure semantics in-case + the dedicated `browser-recovery.contract.test.ts`
suite), **latency and cost** (`medianLatencyMs`, `totalToolCalls`), **human interventions**
(`humanInterventions`), **privacy and authorization** (`privacyLeaks`,
`unauthorizedActions`). No 10× assertion anywhere — the ambition stays a hypothesis by law.

## Verdict

Agreed on the essentials: do not expand the roadmap; the W1/W2/W3 verticals are complete
(six new modules, 81 new tests across services+core, two byte-reproducible artifacts —
not another architecture proposal); the repository authorities synchronize on the PAT push;
every acceptance gate carries in-repo evidence at SHAs. The next checkpoint the review
demands — freshly reconciled repository state, auditable worker assignments, demonstrable
federation and browser execution — is exactly: the push (8+7 commits), this response, and
Scenarios 2/3/4. The residual after this commit is unchanged and operator-side: live-tier
authorization, the PAT push itself, installer signing, and branding.

**One factual correction offered in both directions:** the review's "no comparative
benchmark result found" was stale-baseline (the artifact has existed since 2026-10-30);
this response's own first draft would have claimed "all four money sites closed" without
the hunt finding the two twin sites — the review's method (inspect the implementation, not
the commit descriptions) found what the commit messages hid. Credit where due.
