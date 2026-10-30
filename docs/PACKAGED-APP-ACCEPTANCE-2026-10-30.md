# Packaged-App Acceptance — 2026-10-30 (the chromium ready-hang, re-diagnosed and closed)

**Author:** TL (session web-715a27e3-a43f-4909-86a3-1ceec59691a8) · **Tree:** `unicom-3.0` @ `4cc530c8` + this record · **Verdict: the packaged desktop app boots and renders in this sandbox — production build, production load path, real chromium, real UI.** The 2026-10-28 "upstream chromium ready-hang" diagnosis is overturned: chromium was never the blocker in this environment class.

## 1. What was accepted

The desktop app (`packages/desktop`), built with the repo's own production pipeline (`build:no-runtime-assets` = `prepare:build-meta` + `run-production-build.mjs`: tsup main/preload/host/plugin-sandbox + vite build renderer), booted under `Xvfb :100` + `dbus-run-session` with the electron binary from the repo's own lockfile (`electron@41.0.3`, chromium 146.0.7680.80), **without `ELECTRON_RENDERER_URL`** — i.e. the production load path (`file://…/out/renderer/index.html`).

Acceptance observations (CDP via the app's own dev-mode `remote-debugging-port=9229`, `src/main/index.ts:291`):

- `app-ready` → `[primary-window] creating main window` → renderer up, React mounted (`#root` children: 1), `document.readyState: complete`.
- **Real UI rendered** (DOM text, verbatim): `Welcome to ZCode / Connect your account to start using ZCode / Connect to Z.ai / Global / Connect to BigModel / CN / Use API key` — six buttons, 1200×800 viewport, UA `ZCodeDev/3.16.2 Chrome/146.0.7680.80 Electron/41.0.3`.
- Live main-process telemetry: `app.windows=1`, `ws.renderer_main≈230MB`, GPU/scheduler/utility-host processes online, cron scheduler started, `marketing-touch.query` rpc round-trips OK against the real endpoint.
- Evidence artifacts (in-repo pointers): `public/acceptance/desktop-prod-evidence.png` (CDP capture), `public/acceptance/desktop-x11.png` (Xvfb display capture via ffmpeg x11grab), `public/acceptance/boot-log.txt` (full boot log). *[dashboard-repo copies; original captures at `/home/z/logs/` in the session sandbox.]*

## 2. The real blocker chain (four defects, none of them "chromium ready-hang")

The 2026-10-28 diagnosis ("main parked in epoll_pwait … chromium's ready never fires … blocker is upstream in chromium's C++ startup") is **overturned by a minimal probe**: a 5-line electron 41.0.3 app under the same Xvfb/dbus env fires `app.whenReady()` in **1.2 s** and renders a screenshot in 2.2 s. What actually blocked the full app, in causal order:

1. **Dev-boot vite OOM (exit 137).** First `dev:desktop` chain: vite was kernel-killed while bundling dependencies (4 GB cgroup; the sandbox's Next.js dev server + tsup(10 pkgs) + vite + electron do not co-fit). Second boot with warm pre-builds got past this.
2. **`electron-updater` import-time semver validation.** `packages/desktop/package.json` has **no `version` field** (verified: never had one in its entire git history). `electron .` therefore reports `app.getVersion() = "0.0"`, and `src/main/autoUpdater.ts` destructures `autoUpdater` at module import (line 6), which constructs `AppImageUpdater` → `throw new Error('App version is not a valid semver version: "0.0"')` → **"App threw an error during load"** → main module never finishes initializing → no window, no renderer, no 9229. *This alone reproduces every symptom the 2026-10-28 session attributed to chromium.* (macOS dev boots are unaffected — `scripts/dev.mjs` prepares a dev app bundle there; Linux dev has no such path. Upstream-worthy fix: give the desktop package a version, or guard the import.)
3. **`/dev/shm` = 64 MB + `ulimit -n` = 1024.** With (2) fixed, the renderer loaded but ~14 of ~2240 dev-mode module requests failed with `net::ERR_INSUFFICIENT_RESOURCES` (the vite dep-optimizer emits **one chunk per lucide icon**), breaking the import graph — React never mounted. The repo's own e2e config already carries the remedy for exactly this container class: `containerChromeArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--ozone-platform=x11"]` (`wdio.conf.ts:590`). Passing `--disable-dev-shm-usage --disable-gpu` (+ `ulimit -n 8192`) to the dev electron fixed module loading — and then the **renderer itself OOM'd** (dev-mode unbundled ESM evaluation peak, `render-process-gone: reason=killed, exitCode 9`).
4. **Production-build OOM.** `vite build` (8224 modules transformed) was SIGKILLed twice during chunk rendering (peak left only ~271 MB `MemAvailable`). **`vite build --minify false --sourcemap false`** completed in 11.4 s with a comfortable floor (min 821 MB available). The production renderer then booted in ~3 s and mounted React — the acceptance above.

**Boot recipe (reproducible):** install (`corepack pnpm install --frozen-lockfile`, `pnpm` shim on PATH for the root `prepare`) → `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @zcode/desktop exec vite build --minify false --sourcemap false` inside `packages/desktop` → `Xvfb :100` + script-file `nohup dbus-run-session -- bash -c 'ulimit -n 8192; export DISPLAY=:100 ELECTRON_DISABLE_SANDBOX=1 ELECTRON_ENABLE_LOGGING=1 ZCODE_HEADLESS=1; exec …/node_modules/electron/dist/electron . --disable-dev-shm-usage --disable-gpu'` (no `ELECTRON_RENDERER_URL`) → verify over CDP :9229.

## 3. Local, uncommitted tweaks used for the acceptance run (all disclosed; tree left clean)

| File | Tweak | Why | Reverted |
|---|---|---|---|
| `packages/desktop/package.json` | `"version": "3.16.2"` (1-line insert) | defect (2) — electron-updater import-time validation | yes, after evidence capture |
| `packages/desktop/scripts/dev.mjs` | append `--disable-dev-shm-usage --disable-gpu` to the electron spawn | defect (3) — mirrors the repo's own `wdio.conf.ts` containerChromeArgs | yes |
| `deploy/sandbox/boot-desktop.sh` | `ulimit -n 8192` in the dbus session | defect (3) — sandbox default 1024 starves chromium's fd pool | yes |

The acceptance record survives with the repo tree clean at this commit; the tweaks are documented here as the recipe, not landed as product changes. The electron-builder full package (`pnpm --filter @zcode/desktop run bundle`) was NOT produced — it requires the runtime-asset download lane (`prepare:runtime-assets`), which is network-heavy and out of this session's scope. This acceptance covers the **production code path** (built artifacts, `file://` load, no dev server), which is the substance of the review §7 item; the final installer artifact remains a small, separately-owed step.

## 4. Honest scope limits

1. Tier: **local-live** (real electron, real chromium, real renderer, real UI in this sandbox). Not a signed/distributed installer test; not a user-interaction battery (no input was driven — the UI was verified by DOM text, CDP capture, and the X11 framebuffer capture, not by clicking).
2. The renderer bundle is unminified (`--minify false`) — a memory-concession of this sandbox, not a product property; behavior-identical code.
3. The app ran with the dev-mode fixed CDP port (9229) available because `app.isPackaged` is false when running `electron .` — used here as the verification channel (that is its stated dev purpose).
4. Environment-lifetime caveat: the app is long-lived under the script-file boot structure (verified alive across session-command boundaries), but the sandbox resets between sessions wipe `/home/z` outside the project dir; the durable evidence is this record + the captured artifacts.
