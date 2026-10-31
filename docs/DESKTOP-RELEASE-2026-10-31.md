# DESKTOP RELEASE LANE — 2026-10-31 (the operator addendum, part 1 delivered)

**Mandate:** the operator addendum to the issue #23 handoff ("Operator addendum —
always-available installable desktop releases", pushed to UniCom main at `a6b6db2`
+ the README gate pointer at `1db783b`, 2026-10-31). It is part of the definition
of done: continuous installable snapshots + versioned operator-approved releases
for Windows and Linux, UNiCOM product identity, checksums, release evidence, and
clean-machine install/launch acceptance.

**This commit delivers the release-channel infrastructure** (the parts that carry
no live-tier dependency and activate on the pending PAT push — the same pattern
as the CI-enforcement lane at `f6036f7d`):

| Delivered | What |
|---|---|
| `.github/workflows/desktop-snapshot.yml` | The snapshot channel: every push to main builds Windows x64 (NSIS) + Linux x64 (AppImage/deb/rpm) through the repo's own `pnpm --filter @zcode/desktop run bundle -- <os> <arch>` path, emits a verified `SHA256SUMS`, and uploads commit-pinned workflow artifacts (`UNiCOM-snapshot-<os>-<arch>-<sha>`), retention 30 days. Snapshots are labelled development builds — never releases. |
| `.github/workflows/desktop-release.yml` | The versioned channel: a SemVer tag FIRST re-runs the full TL battery (§1–§9 — an unverified commit can never publish), then builds both targets, assembles per-target `SHA256SUMS` + a release manifest (tag, source SHA, OS/arch, toolchain versions, every asset's SHA-256), and creates a **DRAFT** GitHub Release. Publishing is the operator's explicit action — the approval boundary is structural, not procedural. |
| `scripts/release/sha256sums.mjs` | The checksum law: hash every installer (sorted deterministic walk, `UNPACKED` staging skipped), write `SHA256SUMS`, then RE-VERIFY its own output (re-hash + compare; any mismatch exits 1). Self-tested locally 2026-10-31: 2 fixture installers → written, verified. |
| `scripts/release/release-manifest.mjs` | The manifest law: version/tag/source SHA/architecture/OS/toolchain versions + each asset's SHA-256 and byte size, with the honest notes (unsigned Windows label; ARM64 BLOCKED). Self-tested locally: manifest assembled for 2 fixture assets. |

## Reproducibility record (the clean-checkout law)

- Toolchain (pinned): Node 24 (repo `.nvmrc`), pnpm 10.33.2 (repo `packageManager`,
  activated via `corepack prepare pnpm@10.33.2 --activate`), the committed
  `.npmrc` (hoisted linker), `pnpm install --frozen-lockfile`.
- Clean-checkout build: `pnpm install --frozen-lockfile && pnpm --filter @zcode/desktop run bundle -- <win|linux> <x64>`
  (the repo's own `scripts/bundle.mjs` aggregation: packaging, retry policy,
  artifact verification — the same path this campaign's deb/AppImage/rpm/pacman
  artifacts were built with on 2026-10-30/31).
- The workflows encode exactly these commands; their first live runs ride the
  pending PAT push (snapshots) and the first SemVer tag (releases). The
  cold-runner bootstrap is standard GitHub Actions usage — recorded, not
  asserted in advance.

## The install matrix — status

| OS | Arch | Targets | Status |
|---|---|---|---|
| Windows | x64 | NSIS `.exe` | Workflow-committed; first build on the push. Clean-machine install/launch/upgrade/uninstall acceptance = the operator's test environment (open gate G3). |
| Windows | ARM64 | NSIS `.exe` | **BLOCKED** — no ARM64 Windows runner path or native-dependency proof (the addendum's law: never infer ARM64 from x64). Not advertised as downloadable anywhere. |
| Linux | x64 | `.AppImage` + `.deb` + `.rpm` | Workflow-committed (all three targets already PROVEN buildable + byte-auditable in this sandbox on 2026-10-30/31: deb 150.0 MiB, AppImage 203.3 MiB, rpm 131.4 MiB, pacman 181.3 MiB). Clean-machine install/remove acceptance = open gate G3. |
| Linux | ARM64 | `.AppImage` + `.deb` + `.rpm` | **BLOCKED** — same ARM64 law. |
| Arch | x64 | `.pkg.tar.zst` | Kept (byte-reproducible build proven 2026-10-31); carried by the repo's own packaging path, not yet in the workflow matrix (open gate G5). |

## Acceptance gates — the addendum's checklist, honestly dispositioned

- [ ] **G1 Clean checkout builds all declared targets with the pinned toolchain.**
  WORKFLOW-COMMITTED (activates on the push). The pinned-toolchain + commands
  are recorded above; the first live run is the proof.
- [ ] **G2 Default-branch builds publish commit-pinned downloadable snapshots.**
  WORKFLOW-COMMITTED (activates on the push).
- [ ] **G3 Clean-machine install/launch/upgrade/uninstall on Windows and Linux.**
  OPEN — requires the operator's clean test machines (this sandbox cannot
  prove a clean-root install; the 2026-10-30 packaged-app acceptance ran the
  app local-live under Xvfb, which is adjacent but not the same gate).
- [ ] **G4 Versioned tag → draft release with installers/checksums/manifest/notices/SBOM.**
  WORKFLOW-COMMITTED for installers/checksums/manifest/notices (electron-builder
  stages the third-party notices this repo already ships). **SBOM: OPEN** — a
  machine-readable SBOM generator is not yet wired (candidate:
  `cyclonedx-npm` over the packaged runtime closure; scoped as the lane's next
  commit).
- [ ] **G5 UNiCOM product identity end-to-end.** OPEN — the implementation map:
  `packages/desktop/scripts/desktop-product-identity.mjs` carries the identity
  table (appId/productName/executable/package names per flavor); add the
  `unicom` flavor (`dev.unicom.app` / "UNiCOM" / `unicom`), selected by a
  strict `UNICOM_IDENTITY=1` build switch (the `ZCODE_PREVIEW_IDENTITY` law),
  flowing automatically into `electron-builder.config.js` (appId, productName,
  linux executable/package names, the deb/rpm/pacman flavor isolation) and
  through `ZCODE_PRODUCT_FLAVOR` into the runtime. Distinct data namespace +
  migration-from-ZCode safety need their own design pass (the addendum's
  user-data laws). This is the lane's next commit — deliberately not rushed
  here: the identity is user-facing and must be verified in a real packaged
  boot, not asserted.
- [ ] **G6 No localhost update endpoint; updater validated or disabled.** The
  existing law already fail-closes: `initAutoUpdater({ enabled: ZCODE_PRODUCT_FLAVOR ===
  "production" && ... })` — any non-production flavor disables auto-update
  BEFORE any feed request (the fail-closed mechanism at autoUpdater.ts:1607+).
  Once the `unicom` flavor exists (G5), a packaged UNiCOM build is updater-DISABLED
  by construction — exactly the addendum's "explicitly disable packaged
  auto-update until that feed is ready". The `dev-app-update.yml` localhost
  placeholder remains DEV-ONLY (dev-app-update is a development-mode file;
  packaged builds read the publish config — which the release workflow never
  points at localhost).
- [ ] **G7 Checksums/SHA/source/build logs/inventory/install evidence attached.**
  WORKFLOW-COMMITTED for checksums/manifest/inventory (this commit); build logs
  are the workflow runs themselves; install evidence = G3.
- [ ] **G8 README/download docs point to the latest stable release.** OPEN —
  cannot exist before the first release (G4's first tag); the placeholder law:
  never advertise a download that has not passed the recorded acceptance.

**No tier is upgraded by this commit.** The workflows run on GitHub's runners
when the push lands; until then they are committed evidence of readiness, and
the open gates above are recorded, not excused.
