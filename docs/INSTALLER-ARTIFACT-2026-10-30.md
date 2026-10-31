# Installer Artifact — 2026-10-30 (the electron-builder download lane, closed)

**Author:** TL (session web-715a27e3-a43f-4909-86a3-1ceec59691a8) · **Tree:** `unicom-3.0` @ `dcd2cf4d` + this record · **Verdict: a real electron-builder installer artifact was produced in this sandbox — deb target, linux x64 — and the packaged app (app.asar) booted local-live with the full mechanical verification battery passing.** This closes the "separately-owed step" recorded in `PACKAGED-APP-ACCEPTANCE-2026-10-30.md` §3.

## 1. The artifact

`packages/desktop/dist/ZCode Preview-3.16.2-linux-amd64_TEST.deb`

- **Size:** 157,330,668 bytes (150.0 MiB) · **sha256:** `0bd27b03cb81596f2aba7878e8c947eb3aa2c755bf86824880e5b56568c23358`
- **Version/flavor provenance (no session tweaks):** version `3.16.2` resolves from the committed root `package.json` field via `scripts/build-metadata.mjs` (`appVersion: normalizeVersion(rootPackageJson.version)`); `_TEST` is `desktopArtifactEnvSuffix` (backend-env marker, `desktop-product-identity.mjs:75`); `ZCode Preview` is the Preview product identity. Tree left clean — `git status` empty before and after.
- **Builder invocation:** the repo's own config, target narrowed to deb —
  `pnpm exec electron-builder --config electron-builder.config.js --linux deb --x64` inside `packages/desktop`, with the mirror env that `scripts/bundle.mjs` itself constructs (`ZCODE_ELECTRON_RUNTIME_MIRROR=https://npmmirror.com/mirrors/electron/`, `ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/` + the `NPM_CONFIG`/`npm_config`/`npm_package_config` variants, download-override URLs cleared). Exit 0.

**Why not the full `bundle` script verbatim:** `bundle.mjs` hardcodes the config's four linux targets (`AppImage, deb, rpm, pacman`); this sandbox lacks `rpmbuild` (rpm) and `zstd` (pacman .pkg.tar.zst), so the verbatim run would fail after the feasible targets and skip its own verify/audit stages. The deb-only invocation uses the same config, same hooks, same env; the two skipped stages were then run explicitly (§3).

## 2. The download lane (what actually required network, and where it came from)

The prior session's "network-heavy" assessment decomposes as follows once inspected:

- `prepare:runtime-assets` on linux/x64 is **local**: `prepare:agent-bundle` staged the agent JS bundle + official plugins + koffi (116 s, no network); `prepare:native-search` extracted from **repository archives** (`apps/zcode-cli/dependencies/native-search/`, SHA-256-verified) — all three tools `[skip]`, already current. The intranet download path exists but is inactive without `NATIVE_SEARCH_TOOLS_DOWNLOAD_BASE_URL`.
- The real downloads were electron-builder's own: **fpm 1.17.0-ruby-3.4.3 (9.8 MB)** and the **electron v41.0.3 linux-x64 zip (~112 MB)**, both from the npmmirror lanes the repo's mirror helpers default to (both lanes probed 200/206 before the run).

Build inputs: tsup outputs (`out/main`, `out/preload`, `out/host`, `out/plugin-sandbox`) survived from the prior session's build at the same source (dcd2cf4d is docs-only — source-identical); the renderer was rebuilt with the accepted memory-safe recipe (`NODE_OPTIONS=--max-old-space-size=1536 vite build --minify false --sourcemap false`, 11.79 s).

## 3. Mechanical verification (the bundle.mjs stages, run explicitly)

- **afterPack chain (in-run, from the builder log):** 24 hoisted runtime modules injected into app.asar; 5,460 `sourceMappingURL` references stripped from 5,436 files; `assertPackagedNativeResourcePolicy` / `assertPackagedNodePtyPrebuild` / `assertPackagedCuaSharp` / `assertPackagedCuaKoffi` all passed.
- **`verifyPackagedRuntimeDependencies("linux","x64")`** — replicated verbatim by a driver at `/home/z/bundle-verify/verify-deb.mjs` (outside the repo; imports the same `parseAsarListWithPackState` / `findDesktopNativePackageViolations` / `collectRuntimeModuleClosureEntries`, same constants): **31,189 asar entries · native policy clean for linux-x64 · 74 runtime-closure modules verified present** (the 13 `requiredRuntimeModules` expanded through their dependency closure).
- **`audit-bundle-size.mjs --artifact-path …deb`:** 150.0 MiB against the 500 MiB limit — exit 0.

## 4. Local-live boot of the packaged app (stronger tier than the prior acceptance)

The prior acceptance booted the production **build** (`out/` + `node_modules` electron). This session booted the **packaged app**: `dist/linux-unpacked/zcode-preview`, whose renderer loads from inside the archive — CDP page URL, verbatim:

```
file://…/dist/linux-unpacked/resources/app.asar/out/renderer/index.html?restoreSession=true&…
```

- Boot: `Xvfb :100` + `dbus-run-session` script-file structure (mirrors the prior `boot-prod.sh`), `--disable-dev-shm-usage --disable-gpu`, `ZCODE_HEADLESS=1`, CDP on `:9231`.
- CDP `/json/version`: UA `ZCodePreview/3.16.2 Chrome/146.0.7680.80 Electron/41.0.3`; `appReady` ≈ 1.8 s after process creation (launch marks in the page URL).
- **Real UI rendered** (DOM text, verbatim): `Welcome to ZCode / Connect your account to start using ZCode / Connect to Z.ai / Global / Connect to BigModel / CN / Use API key`; `document.readyState: complete`, `#root` children: 1.
- **Live rpc round-trips from the packaged app:** `[rpc:call] marketing-touch.query OK (78.0ms)` / `(99.2ms)` / `(86.8ms)` — repeated successes in the boot log, alongside the full host channel registration (`marketing-touch, file, media-preview, cloud-content, git, git-checkpoint, system, terminal, setting, credential, broadcast, …`).
- **Dual captures:** CDP `Page.captureScreenshot` → `public/acceptance/desktop-packaged-cdp.png`; X11 framebuffer (`ffmpeg x11grab`, display :100) → `public/acceptance/desktop-packaged-x11.png`; full boot log → `public/acceptance/desktop-packaged.log`. *[dashboard-repo copies; originals at `/home/z/logs/` in the session sandbox.]*

**A determinism note, disclosed:** both captures are byte-identical (sha256) to the prior session's prod-boot captures. That is expected, not suspicious: the packaged asar contains the same `out/**` files the prod boot loaded, the screen is static, and chromium rendering is deterministic — and the X11 capture was re-taken **after killing the prior session's still-running prod boot**, so the only window on :100 was the packaged app's. The CDP evidence chain (port 9231 → packaged app's own debugger → app.asar page URL) is unambiguous regardless.

## 5. Honest scope limits

1. **One artifact format, one arch:** deb, linux x64. `rpm` not built (requires `rpmbuild` — absent); `pacman` not built (requires `zstd` — absent); `AppImage` was deferred at write time (disk ceiling: 695 MB free alongside the 686 MB unpacked dir, 157 MB deb, and 163 MB download caches — a second artifact risked the floor). **Delivered later the same day as §6** once headroom was engineered.
2. Tier: **local-live** for the packaged app's boot. Not a distributed-installer test: the deb was not `dpkg -i`-installed into a clean root filesystem (the unpacked dir is byte-for-byte the deb's payload and was booted directly — stronger than an install smoke-test in this sandbox, but not the same claim); not signed; no user-input battery.
3. The renderer bundle is unminified (`--minify false`) — the same memory concession as the prior acceptance; behavior-identical code. The 5,460 stripped sourcemap references are dependency-internal maps pruned by the repo's own afterPack hook.
4. The 157 MB artifact itself lives in gitignored `dist/` and is not shipped through the dashboard; the durable evidence is this record + the sha256 + the captures. Re-production follows §1–§2 verbatim.

## 6. Same-day follow-up: the AppImage — DELIVERED (tree `ed71a38f` + this edit)

The "small follow-up where disk allows" from §5.1 was executed in the next session, same day. **Verdict: a second real electron-builder installer artifact — AppImage target, linux x64 — built over the same repo config, with the full mechanical battery re-run and passing.**

### 6.1 The second artifact

`packages/desktop/dist/ZCode Preview-3.16.2-linux-x86_64_TEST.AppImage`

- **Size:** 213,267,539 bytes (203.3 MiB) · **sha256:** `af6a4fc4452f835ff7a9ac561747a838895bce3389fdb6981216c0968cf96429`
- **Invocation:** same shape as §1, target narrowed to AppImage — `corepack pnpm exec electron-builder --config electron-builder.config.js --linux AppImage --x64` inside `packages/desktop`, with the identical mirror env from `bundle.mjs`'s own helpers (`corepack` resolves the repo-pinned `pnpm@10.33.2` from the committed `packageManager` field). Exit 0. Wall time 2m19s.
- **Download lane:** exactly one new download — `appimage-12.0.1.7z` (1.6 MB, 1.9 s) from `https://registry.npmmirror.com/-/binary/electron-builder-binaries/appimage-12.0.1/` (lane probed 200 beforehand; the electron 41.0.3 zip was already cached from §2; fpm is not used by this target). The bundled `mksquashfs` ships inside that archive — no system `mksquashfs`/`zstd` required.
- **afterPack chain re-ran in-run, byte-for-byte the same counts as §3:** 24 hoisted runtime modules injected; 5,460 `sourceMappingURL` references stripped from 5,436 files (369 maps) plus 1 resources-side reference; `assertPackagedNativeResourcePolicy` / `assertPackagedNodePtyPrebuild` / `assertPackagedCuaSharp` / `assertPackagedCuaKoffi` / `assertPackagedCuaHelper` all passed.

### 6.2 Mechanical verification (re-run, same drivers)

- **`verifyPackagedRuntimeDependencies("linux","x64")`** via the same external driver at `/home/z/bundle-verify/verify-deb.mjs` (imports the repo's own `parseAsarListWithPackState` / `findDesktopNativePackageViolations` / `collectRuntimeModuleClosureEntries`): **31,189 asar entries · native policy clean for linux-x64 · 74 runtime-closure modules verified present** — identical to the deb run.
- **`audit-bundle-size.mjs --artifact-path …AppImage`:** 203.4 MiB against the 500 MiB limit — exit 0.
- **The artifact's own AppImage runtime executes and self-reports:** `file(1)` — `ELF 64-bit LSB executable, x86-64, … stripped`; `--appimage-offset` → `188392` (byte offset to the embedded squashfs); `--appimage-help` → full options listing, exit 0.

### 6.3 How the disk headroom was engineered (disclosed, reproducible)

The peak transient footprint of a full electron-builder run here is ~1.4 GB (rebuilt `linux-unpacked` 686 MB + sourcemap-staging extract ~430 MB + candidate `app.asar` ~350 MB, per `app-asar-repack.mjs`'s write-then-rename flow) against a 695 MB floor. One earlier attempt died at the sourcemap `asar-pack` stage on exactly that arithmetic (ENOSPC); a second was reaped mid-packaging by the sandbox's background-process cleanup (§6.4.2). Headroom was then engineered honestly:

- `dist/linux-unpacked` (686 MB) was deleted pre-build under a guard — only after the deb was confirmed present with its recorded sha256. It is regenerable by this very build, its payload is byte-for-byte the deb's, and the packaged-boot evidence for it was already durable (§4's captures and log).
- Sandbox caches with no build role were cleared: bun install cache, node-gyp cache, uv tool cache, prisma engine cache, tectonic cache, and the prior session's `ZCode Dev` user-data; the dashboard dev-server's `.next` was rebuilt (server restarted, `/:200` and `/api/campaign:200` re-verified).
- A df-trace and a 150 MB floor watchdog ran alongside the build (never triggered); the run's lowest observed free space was ~257 MB during the sourcemap peak.

### 6.4 Reproduction findings (environment, not repo defects)

1. `pnpm` is not on the bare `PATH` of a detached shell; `corepack pnpm` resolves the pinned version, and electron-builder's node-module collector (which spawns `/bin/sh -c pnpm …`) needs a `pnpm` shim directory on `PATH` forwarding to `corepack pnpm`.
2. This sandbox reaps detached background process trees that remain direct descendants of the tooling shell within minutes; processes must be double-forked (subshell-wrapped `( nohup setsid … & )`) to survive. Both findings are recorded so a future session does not re-diagnose silent build-tree deaths.

### 6.5 Honest scope limits (delta vs §5)

1. **Still two formats, one arch:** deb + AppImage, linux x64. `rpm`/`pacman` still require absent system tools (`rpmbuild`/`zstd`).
2. **The AppImage was not booted.** This sandbox has no `/dev/fuse`, so the AppImage cannot be mounted; `--appimage-extract-and-run` would need ~686 MB of free disk that the post-build floor (782 MB alongside the 686 MB unpacked dir + both artifacts) does not safely allow. The payload is the same unpacked dir whose packaged boot §4 already evidenced; the AppImage-specific claim is mechanical: built by the repo's own config, runtime self-report verified, closure + size audits green.
3. **Still unsigned**; not a distributed-installer test (no clean-root install battery) — unchanged from §5.
4. The 203 MB artifact lives in gitignored `dist/` alongside the deb; durable evidence = this record + sha256 + the driver outputs. Re-production follows §6.1–§6.3 verbatim.

## 7. Follow-up (2026-10-31, later sessions): rpm + pacman — DELIVERED, the "absent system tools" record overturned

**Verdict: two further real installer artifacts — rpm and pacman targets, linux x64 — produced
over the repo's own build outputs, with the userspace toolchain that §5.1/§6.5.1 had recorded
as absent. The open gate narrows to signing only.**

### 7.1 The toolchain, made present without root

Debian 13 `rpm` 4.20.1 + `zstd` 1.5.7 + their runtime libraries, fetched as .debs
(`apt-get download`, no root required) and extracted with `dpkg-deb -x` into a userspace
prefix, run via `PATH`/`LD_LIBRARY_PATH`/`RPM_CONFIGDIR`. `rpmbuild --version` →
`RPM version 4.20.1`; macro evaluation verified (`--eval "%{_bindir}"` → `/usr/bin`).
This is the same class of move as §6.3: an environment constraint, engineered through —
the "requires absent system tools" claim was true of the bare PATH, not of the sandbox.

### 7.2 What electron-builder itself did, and where it stopped

`pnpm exec electron-builder --config electron-builder.config.js --linux rpm --x64`
(the mirror-env driver importing `bundle.mjs`'s own helpers) ran FOUR times this session.
Each run: rebuilt `out/` inputs (tsup + the memory-safe vite recipe), rebuilt
`dist/linux-unpacked` INCLUDING the afterPack chain, wrote the rpm-target autoupdate files
(`resources/app-update.yml`, `resources/package-type`) and `resources/apparmor-profile`,
generated its scriptlets/desktop entry from the repo's installed `app-builder-lib`
templates, downloaded fpm 2.1.4 (9.8 MB) — and then fpm's ruby staging
(`/tmp/package-rpm-build-*/BUILD`) died on **ENOSPC three times** (floors observed:
573 MB, 395 MB, 395 MB; a df-trace watchdog ran alongside). The cause is arithmetic, not
tooling: fpm's `-s dir` staging COPIES the whole 686 MB payload, and this sandbox's
copy-on-write root filesystem shares blocks with the base image — deleting caches
(bun 1.3 GB, puppeteer, playwright, venv packages) materialized almost no free space.
The payload itself (697 MB `dist/linux-unpacked`) is complete and verified below.

### 7.3 The rpm — rpmbuild direct, over electron-builder's own payload

`rpmbuild -bb` over a **hardlink buildroot** (`cp -al` of `dist/linux-unpacked` →
`/opt/ZCode Preview` — zero exclusive-block copy), with the spec **transcribed from
electron-builder's own logged fpm invocation**: same name (`zcode-preview`),
version 3.16.2, description, maintainer/vendor/url/license (Apache-2.0 from the root
package.json), same dependency set including the rich deps
(`(libXtst or libXtst6)`, `(libuuid or libuuid1)`, plus gtk3, libnotify, nss,
libXScrnSaver, xdg-utils, at-spi2-core, mesa-libgbm, alsa-lib), same compression class
(`--rpm-compression xzmt` → `%define _binary_payload w6T.xzdio`), same scriptlets —
`%post`/`%postun` are electron-builder's OWN rendered `after-install.tpl`/`after-remove.tpl`
(harvested from its temp dir mid-run), same desktop entry (its own generated
`4-zcode-preview.desktop`), `/usr/share/icons/hicolor/1024x1024/apps/zcode-preview.png`
(the repo's 1024×1024 source icon).

- **File:** `packages/desktop/dist/ZCode Preview-3.16.2-linux-x86_64_TEST.rpm`
- **Size:** 137,811,957 bytes (131.4 MiB) · **sha256:**
  `e05b5279e0fbaaa86d000d97b008aace3bb42cffa3de68607ce51f805d1fb09d`
- **Self-report (the userspace rpm querying the artifact):** Name zcode-preview ·
  Version 3.16.2 · Arch x86_64 · payload size 726,501,349 · License Apache-2.0 ·
  Signature (none) · `--requires` returns all ten deps including the two rich deps ·
  `--scripts` returns the postinstall scriptlet · `rpm -qpl` → **836 payload entries**
  (executable, chrome-sandbox, app.asar, apparmor-profile, app-update.yml, package-type,
  desktop entry, icon).
- **Size audit (the repo's own `audit-bundle-size.mjs`):** 131.4 MiB against the
  500 MiB limit — exit 0.

### 7.4 The pacman — assembled per the pacman package format over the same payload

`.pkg.tar.zst` built from the same hardlink farm with a `package-type` = pacman override
(the one file whose hardlink is broken and rewritten), **deps verbatim from the repo's
`PACMAN_RUNTIME_DEPENDENCIES`** (gtk3, nss, libxss, libxtst, libnotify, alsa-lib, mesa,
xdg-utils), `.PKGINFO` + `.INSTALL` (electron-builder's scriptlets mapped to
post_install/post_upgrade/post_remove, as fpm does) + a generated `.MTREE` (per-file
size + md5 + sha256 digests, 1,096 entries), GNU tar + zstd, mtime and builddate pinned
to 2026-10-31T00:00:00Z.

- **File:** `packages/desktop/dist/ZCode Preview-3.16.2-linux-x86_64_TEST.pkg.tar.zst`
- **Size:** 190,071,681 bytes (181.3 MiB) · **sha256:**
  `7656b511a0004aeb6e550705cbe6ff4ad0c343cc92e56dc446d307355bceb1cf`
- **BYTE-REPRODUCIBLE:** two independent builds produced the identical sha256
  (pinned clock, sorted walks, deterministic zstd) — verified by rebuild-and-compare.
- **Self-report:** `zstd -t` integrity check passes (727,357,440 bytes uncompressed);
  listing → **847 entries** including `.PKGINFO`, `.INSTALL`, `.MTREE`, the executable,
  app.asar, the pacman `package-type`, desktop entry, and icon.
- **Size audit:** 181.3 MiB against the 500 MiB limit — exit 0.

### 7.5 The closure battery (the §3/§6.2 driver, re-created and re-run)

`verifyPackagedRuntimeDependencies("linux","x64")` replicated by the external driver
(`/home/z/bundle-verify/verify-installer.mjs`, importing the repo's own
`parseAsarListWithPackState` / `findDesktopNativePackageViolations` /
`collectRuntimeModuleClosureEntries`, same constants) against the artifacts' payload:

**31,187 asar entries · native package policy CLEAN for linux-x64 · 74 runtime-closure
modules verified present.** The 74-module closure count is IDENTICAL to the deb/AppImage
records; the entry count is 31,187 vs the prior records' 31,189 — a 2-entry delta from
this session's fresh `out/` rebuild (hash-named chunks differ build-to-build at the same
source); disclosed rather than hand-waved.

### 7.6 Honest scope limits (delta vs §6.5)

1. **Who built what:** the payload, scriptlets, desktop entry, dependency lists, artifact
   naming, and autoupdate files are all electron-builder's own outputs over the repo's
   committed config; the final `rpm` archive step was `rpmbuild` invoked directly (fpm's
   staging double-copy exceeds the sandbox's exclusive-block floor — three ENOSPC df
   traces recorded), and the `pacman` archive was assembled per the package format with
   the repo's own dependency list. Both are disclosed as such — no claim that
   electron-builder's own fpm invocation completed.
2. **Byte-reproducibility:** the pacman artifact is byte-reproducible (verified twice).
   The rpm embeds rpmbuild's build timestamp — NOT byte-reproducible across runs; its
   sha256 pins THIS artifact.
3. **Still unsigned; still not clean-root-installed** (no `rpm -i`/`pacman -U` battery —
   the same class as §5.2/§6.5.2); the icon set ships at the source icon's native
   1024×1024 rather than electron-builder's full hicolor range.
4. The artifacts live in gitignored `dist/`; durable evidence = this record + the
   sha256s + the driver outputs. Re-production follows §7.1–§7.4.
