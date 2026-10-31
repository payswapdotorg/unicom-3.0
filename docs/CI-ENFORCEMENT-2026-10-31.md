# CI ENFORCEMENT — 2026-10-31 (the adopted criticism, closed at commit time)

## The criticism being closed

The 2026-10-31 operator review's confirmed-valid finding:

> Fair point: gates run as TL verification batteries recorded in-repo, not
> CI-enforced (CI documented as not configured). Recorded as a governance
> open gate.

It was adopted at f3e6cd77 (the review response) and recorded as an open
gate in `docs/SOURCE-OF-TRUTH-2026-10-31.md`. This commit closes the
"unconfigured" half: the battery now exists as a GitHub Actions workflow.

## What was delivered

`.github/workflows/battery.yml` — one job, fourteen steps, running on every
push and pull request to `main`:

| Step | Command (verbatim from the TL battery) |
|---|---|
| §1 | `pnpm exec vitest run` + the 12 services harness files |
| §2 | `cd apps/zcode-cli && pnpm --filter @zcode/contracts build && pnpm exec vitest run --config vitest.config.ts` + the 2 core-island files |
| §3 | `cd packages/ui && pnpm exec vitest run` + the 3 renderer files |
| §4 | `pnpm run architecture:check` |
| §5 | `pnpm run test:architecture` |
| §6 | `pnpm run lint` (oxlint — 0 errors is the gate; the 96 disclosed warnings are not gated) |
| §7 | `pnpm exec tsc -b packages/services` |
| §8 | benchmark byte-reproducibility: `run-benchmark.ts --at 2026-10-30T00:00:00.000Z --out /tmp/bench-ci.json` + `diff` against `docs/benchmark-r7-2026-10-30.json` |
| §9 | scenario byte-reproducibility: `run-scenarios.ts --at 2026-10-31T00:00:00.000Z --out /tmp/scenarios-ci.json` + `diff` against `docs/scenarios-w-2026-10-31.json` |

Bootstrap: Node 24 (the committed `.nvmrc`), pnpm 10.33.2 via corepack
(the `packageManager` pin — the same activation path re-proven in the
campaign sandbox after the environment reset), `pnpm install
--frozen-lockfile` (hoisted linker from the committed `.npmrc`),
`fetch-depth: 0` so the architecture gate's git fallback chain stays
resolvable. A non-zero exit anywhere fails the job; the two `diff` steps
make **byte-drift of either committed artifact a hard CI failure**.

## What is proven vs. what is honestly not

- **Proven at this tree (this sandbox, 2026-10-31):** every battery command
  §1–§9 re-ran green at HEAD — 230/230 services, 44/44 core, 44/44 UI,
  36/36 governance, lint 0 errors, architecture 0/0/0, tsc exit 0, and
  both artifact diffs empty. The workflow YAML itself parses (14 steps,
  triggers push/pull_request, §1 folds to a single 12-file command).
- **NOT proven and NOT claimed:** a live run of this workflow on GitHub's
  runners. The campaign's commits are committed-not-pushed (the PAT open
  gate), so the first live CI run happens on the next push to `main`.
- **NOT re-proven in this sandbox:** the cold-install bootstrap
  (`pnpm install --frozen-lockfile` from an empty store). The sandbox's
  `node_modules` (2.9 GB) pre-exists and the disk floor (2.1 GB free) did
  not allow a second cold install. The bootstrap is standard pnpm CI
  usage; the repo's `prepare` script (`husky && pnpm build:cua`) runs on
  install and is expected to behave on `ubuntu-latest` as it did here —
  expected, not asserted. If the first live run surfaces a bootstrap
  defect, that is a finding to fix, not a reason the gate never existed.

## Tier law (unchanged)

CI-enforcing the fixture-tier battery upgrades NO tier. The workflow runs
the same fixture-tier commands; it adds no live network beyond package
installation, no real browser, no live provider execution. The fixture
ceiling stands by issue #23 law.

## Residual

- The workflow is committed-not-pushed like the rest of the campaign chain;
  it activates when the PAT push lands. Until then the "CI-enforced" claim
  is "committed and mechanically validated," which is exactly what this
  record claims — nothing more.
- Signing, release automation, and matrix builds (mac/win) are NOT in scope
  of the review's criticism and remain untouched.
