# TL Verification Battery — campaign 2026-10-30

**Author:** TL (session web-715a27e3-a43f-4909-86a3-1ceec59691a8) · **Tree:** `unicom-3.0` @ `c7bda09` + the R8/R9/R10 lanes (this commit) · **Environment:** fresh anonymous clone 2026-10-30 ~05:47 UTC; Node v24.22.1; pnpm 10.33.2 (corepack); install scope `pnpm install --filter . --filter @zcode/services... --filter @zcode/ui... --filter @zcode/core... --filter zcode... --filter @zcode/contracts` (with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; `@zcode/contracts` built once for the core tests).

A claim without a command + exit code below is not acceptance evidence (SOURCE-OF-TRUTH-2026-10-30 §8).

## 1. The battery (all re-run by the TL on the merged tree, 2026-10-30)

| # | Gate | Command (repo root) | Result |
|---|---|---|---|
| 1 | Services harness suites | `pnpm exec vitest run packages/services/test/{commerce-harness,commerce-harness-lifecycle,commerce-harness-federation,browser-transport,merchant-execution,commerce-harness-benchmark}.contract.test.ts packages/services/src/gen-ui/contract.test.ts packages/services/src/commerce-harness/contract.test.ts` | **8 files / 161 tests passed** (29 R5 re-verified + 29 lifecycle + 21 federation + 32 browser-transport + 24 merchant-execution + 23 benchmark + 2 gen-ui + 1 module manifest) |
| 2 | Core-island suites | `cd apps/zcode-cli/packages/core && pnpm exec vitest run tests/find-best-offer.contract.test.ts tests/merchant-read.contract.test.ts` | **2 files / 44 tests passed** (20 R5 + 24 R6 — re-verified, no longer recorded-claims-only) |
| 3 | UI-renderer suites | `pnpm exec vitest run packages/ui/test/commerce-harness-renderer.contract.test.ts packages/ui/test/merchant-read-renderer.contract.test.ts packages/ui/src/ToolCallBlocks/renderers/commerce-harness-view/contract.test.ts` | **3 files / 44 tests passed** (20 R5 + 23 R6 + 1 new module manifest — the renderer split is behavior-verified) |
| 4 | Architecture gate | `pnpm run architecture:check` | **OK — violations: 0, baseline: 0, new: 0.** Two modules adopted through the sanctioned `pnpm run architecture:adopt` (not bypass, not baseline): `commerce-harness` (services island — the R8/R9/R10 code home) and `commerce-harness-view` (ui island — the view-model split of the R4 card). The pre-existing `gen-ui-service` missing-`contract.test.ts` violation (present on main @ `c7bda09`, verified via `git stash`) closed by adding the honest manifest/descriptor contract test. |
| 5 | Lint (whole repo) | `pnpm run lint` | **94 warnings (pre-existing baseline, unchanged) + 0 errors.** Two pre-existing errors fixed at the root: (a) `no-unsafe-finally` ×2 in `packages/services/src/project-storage/startup.ts` — the throw is deferred past the `finally` (semantics preserved: close-failure surfaces only absent a first cause); (b) `max-lines` on the R4 renderer `commerce-harness.tsx` (1170 → 793 lines) via the `commerce-harness-view` view-model split, behavior-verified by battery #3. |
| 6 | Typecheck (package build) | `pnpm exec tsc -b packages/services` | **exit 0** (project build incl. `shared`/`rpc` references) |
| 7 | Architecture governance tests | `pnpm run test:architecture` | **36 pass / 0 fail** |
| 8 | Benchmark artifact | `pnpm exec tsx scripts/commerce-harness/run-benchmark.ts --at 2026-10-30T00:00:00.000Z --out docs/benchmark-r7-2026-10-30.json` | **exit 0; byte-reproducible** (second run `diff` identical). Aggregates below. |

**Battery total: 249/249 tests, 13 files, three islands (services/core/ui).**

## 2. The R7 benchmark aggregates (fixture tier — `docs/benchmark-r7-2026-10-30.json`)

| Comparator | taskSuccessRate | costCorrectness | true/false savings | precision / recall | freshness | unauth / leaks / interventions |
|---|---|---|---|---|---|---|
| `unicom-harness` (REAL code) | 0.8 | 1.0 | 2 / 0 | 1.0 / 0.5 | 0 | 0 / 0 / 0 |
| `provider-native-incumbent` (SIMULATED) | 0.7 | 1.0 | n/a | n/a | 0 | 0 / 0 / 0 |
| `general-purpose-baseline` (SIMULATED) | 0.0 (cannot-judge ×10) | 0.9 | n/a | n/a | 0 | 0 / 0 / 0 |

Honest reading: the harness's 0.5 recall is the **reported, not hidden** fixture-tier miss — the group-buy and coupon lanes are realizable in ground truth but the Tier-1 public catalogs cannot observe them (cases r7-01/r7-04 say exactly this in their notes). Zero false savings, zero money-law violations, zero unauthorized actions/leaks — by construction, asserted by tests. **No multiplier claim is made at any tier; a live-tier comparative run is owed** (`meta.liveTierOwed: true`).

## 3. Lane acceptance (against the handoff's acceptance evidence)

- **#2 Two-node federation — DELIVERED (fixture/contract tier):** private intent → empty wire + wire privacy scan; shared generalized projection → privacy-field scan; receiving node stores conditional-only remote records; revocation + expiry propagation; malformed/injected/duplicate/rate-limited/loop/oversized envelopes each rejected with a distinct verdict; remote claims never upgrade evidence class (21 federation tests + 29 lifecycle tests).
- **#3 Browser-only operation — DELIVERED (fixture/contract tier):** labelled fixture pages only (`BROWSER_FIXTURE_LABEL`); pre-transport authority gate (ledger-untouched assertions); session expiry, timeout, changed DOM, ambiguous controls, challenge-required (honest stop), prompt-injection immunity (`INJECTION_PROBE_STRINGS`), cancel, idempotency, read-back verification incl. `mismatch-unknown`; no credential/cookie/MFA fields anywhere (`FORBIDDEN_FIELD_NAMES` structural scan) (32 tests).
- **#4 Merchant flow — DELIVERED (fixture/contract tier):** prepare→preview→approve→execute→verify; unauthorized writes refused BEFORE any port call (call-counter assertions); exact-money previews; idempotent execute (one port effect); read-back reconciliation `verified | mismatch-unknown | partial` (24 tests).
- **#6 Comparative benchmark — DELIVERED (fixture tier):** fixed 10-case corpus, three comparators (one real, two labelled simulations), L5 denominators, byte-reproducible artifact (23 tests + the runner).

## 4. Honest scope limits (disclosed, not excused)

1. **No live network, browser, or provider execution anywhere in this campaign** — by law (issue #23: fixtures + read-only first). The live tier remains owed for federation, connector fallback, and benchmark alike.
2. The full-workspace unit battery (`pnpm test:unit`, ~900 files incl. desktop/electron suites) was NOT run — the install scope covers the services/core/ui islands this campaign touches. The suites re-run here are exactly the campaign-relevant ones plus the R4–R6 suites in the touched areas.
3. R10's worker session hit an infrastructure timeout after delivering `benchmark.ts` + tests + runner; the TL completed the lane: split the corpus into `benchmark-corpus.ts` (the 800-line law), added the `--at` byte-reproducibility flag, generated and verified the committed artifact.
4. The R4/R6 renderer files under `packages/ui/src/ToolCallBlocks/renderers/` (legacy unmanaged root) remain pre-existing baseline for the unmanaged-new-file rule; this campaign's new UI code lives in the adopted `commerce-harness-view` module. Whole-repo lint now exits 0.
