# TL VERIFICATION BATTERY — 2026-10-31 (the W-campaign)

Run by the TL on the merged tree (unicom-3.0, this commit's parent tree) after the
W1/W2/W3 integration. Every command, every exit code, every count — verbatim.

## 1. Services harness suites (vitest, 12 files — 6 pre-existing + 6 new)

```
pnpm exec vitest run \
  packages/services/test/commerce-harness.contract.test.ts \
  packages/services/test/commerce-harness-money.contract.test.ts \
  packages/services/test/commerce-harness-federation.contract.test.ts \
  packages/services/test/commerce-harness-lifecycle.contract.test.ts \
  packages/services/test/commerce-harness-benchmark.contract.test.ts \
  packages/services/test/commerce-harness-scenarios.contract.test.ts \
  packages/services/test/group-buy.contract.test.ts \
  packages/services/test/opportunity-store.contract.test.ts \
  packages/services/test/transport-selector.contract.test.ts \
  packages/services/test/browser-transport.contract.test.ts \
  packages/services/test/browser-recovery.contract.test.ts \
  packages/services/test/merchant-execution.contract.test.ts
```

**Result: 230/230 tests · 12 files · exit 0** (was 161/8 at R10; +69 tests, +6 files).
Breakdown of the new: money 22 · group-buy 13 · opportunity-store 10 ·
transport-selector 11 · browser-recovery 7 · scenarios 9 (= 72 new assertions minus
counted re-runs of pre-existing files: the six pre-existing files contribute 158, the
six new files contribute 72 → 230).

## 2. Core-island suites (R5/R6 — re-verified; W1b added the money-boundary suite)

```
cd apps/zcode-cli && pnpm --filter @zcode/contracts build
  && pnpm exec vitest run --config vitest.config.ts \
       packages/core/tests/find-best-offer.contract.test.ts \
       packages/core/tests/merchant-read.contract.test.ts \
       packages/core/tests/money-boundary.contract.test.ts
```

**Result: 53/53 · 3 files · exit 0** (44 at the W-campaign run + 9 from the W1b
follow-up's `money-boundary.contract.test.ts` — the ingestion-boundary suite that
closed the second operator review's confirmed finding; the @zcode/contracts build
is a prerequisite of the core test entry resolution — same as the R10 battery).

## 3. UI-renderer suites (R5/R6 + the split module — re-verified)

```
cd packages/ui && pnpm exec vitest run \
  test/commerce-harness-renderer.contract.test.ts \
  test/merchant-read-renderer.contract.test.ts \
  src/ToolCallBlocks/renderers/commerce-harness-view/contract.test.ts
```

**Result: 44/44 · 3 files · exit 0.**

## 4. Architecture gate

```
pnpm run architecture:check
```

**Result: violations 0 · baseline 0 · new 0 · exit 0.** (Interim event, recorded: during
W1 the planner hit the 800-line ceiling — new: 1, exit 1 — and was closed by the
behavior-verified split into offer-evaluation.ts; the artifacts re-proved
byte-identity after the split.)

## 5. Architecture governance tests

```
pnpm run test:architecture
```

**Result: 36 pass / 0 fail · exit 0.**

## 6. Whole-repo lint

```
pnpm run lint
```

**Result: 0 errors · 96 warnings · exit 0** (94 pre-existing at R10 + 2 net-new from the
W-campaign code — disclosed, none in the harness modules' new logic beyond import-order
no-ops already minimized from 116 → 96 by trimming).

## 7. Typecheck (package build)

```
pnpm exec tsc -b packages/services
```

**Result: exit 0.**

## 8. Benchmark artifact (byte-reproducibility, W1-preserved)

```
pnpm exec tsx scripts/commerce-harness/run-benchmark.ts \
  --at 2026-10-30T00:00:00.000Z --out /tmp/bench-recheck.json
diff /tmp/bench-recheck.json docs/benchmark-r7-2026-10-30.json
```

**Result: byte-identical (diff empty) — verified THREE times: after the W1 boundary
swap, after the planner split, and after the final lint cleanup. exit 0.**

## 9. Scenario artifact (NEW — byte-reproducibility)

```
pnpm exec tsx scripts/commerce-harness/run-scenarios.ts \
  --at 2026-10-31T00:00:00.000Z --out docs/scenarios-w-2026-10-31.json
# second run to /tmp, then diff
```

**Result: byte-identical (diff empty) — verified twice (post-write and post-split). exit 0.**

---

**TOTALS: 363 tests green this battery** (230 services harness + 53 core + 44 UI + 36
governance — the W1b follow-up re-run at its commit; the W-campaign run itself was 354)
· 0 lint errors · architecture 0/0/0 · tsc exit 0 · both artifacts
byte-reproducible. Nothing upgrades tier: the fixture ceiling stands by issue #23 law.
