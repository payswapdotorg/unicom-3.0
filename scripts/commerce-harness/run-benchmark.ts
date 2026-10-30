#!/usr/bin/env -S pnpm exec tsx
// ============================================================
// commerce-harness — the R7 benchmark runner (FIXTURE TIER)
// ============================================================
//
// Runs the fixed 10-case corpus through runBenchmarkCorpus and prints the
// full BenchmarkRunResult as JSON on stdout. Only ONE of the three
// comparators is real code (the commerce-harness flow); the other two are
// labelled fixture-tier SIMULATIONS of incumbent behavior over the same
// fixture observations — NOT live provider measurements. A live-tier
// comparative run is owed before any comparative claim leaves this tier
// (meta.liveTierOwed: true; no multiplier language anywhere).
//
// Run:
//   pnpm exec tsx scripts/commerce-harness/run-benchmark.ts
//   pnpm exec tsx scripts/commerce-harness/run-benchmark.ts --out /tmp/benchmark-r7.json
//   pnpm exec tsx scripts/commerce-harness/run-benchmark.ts --at 2026-10-30T00:00:00.000Z --out docs/benchmark-r7-2026-10-30.json
//
// CLOCK LAW: `--at <ISO>` pins the run to a FIXED clock — the artifact is then
// byte-reproducible (the same input yields the same bytes; the contract tests
// prove it). Without --at the real clock is chosen HERE — the only sanctioned
// real-clock entry point (the module itself reads only the injected clock).
//
// INV-51: the fixture tier is a deployment constraint of this benchmark
// (the campaign authorizes no live provider credentials), never domain
// semantics. INV-14: every monetary number in the emitted JSON is an exact
// string decimal + an explicit currency.

import { writeFileSync } from "node:fs";
import { runBenchmarkCorpus } from "../../packages/services/src/commerce-harness/benchmark.js";

async function main(): Promise<void> {
  const outFlagIndex = process.argv.indexOf("--out");
  const outPath = outFlagIndex >= 0 ? process.argv[outFlagIndex + 1] : undefined;
  const atFlagIndex = process.argv.indexOf("--at");
  const atArg = atFlagIndex >= 0 ? process.argv[atFlagIndex + 1] : undefined;
  const fixedAt = atArg !== undefined ? Date.parse(atArg) : Number.NaN;
  if (atArg !== undefined && !Number.isFinite(fixedAt)) {
    console.error(`--at must be a parseable ISO timestamp (got "${atArg}")`);
    process.exitCode = 1;
    return;
  }
  const now =
    atArg !== undefined
      ? (): Date => new Date(fixedAt)
      : (): Date => new Date();
  const result = await runBenchmarkCorpus({ now });
  const json = JSON.stringify(result, null, 2);
  if (outPath !== undefined && outPath.trim().length > 0) {
    writeFileSync(outPath, `${json}\n`, "utf8");
  }
  console.log(json);
}

await main();
