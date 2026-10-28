# Sandbox deployment (zcode desktop, viewable live)

Streams the zcode desktop app (running under `Xvfb :100`) as an MJPEG view on `:3000`
— the sandbox gateway proxies the operator's preview panel to `:3000`, so the preview
shows the desktop live while it is being developed.

- `redeploy.sh` — one-command idempotent recovery: clone (if missing) → `pnpm install`
  (if missing) → free `:3000` → boot Xvfb + `pnpm dev:desktop` + the viewer.
- `boot-desktop.sh` — boots Xvfb `:100` (1280x800x24) and the desktop app under
  `dbus-run-session` (`ELECTRON_DISABLE_SANDBOX=1`, headless-safe).
- `viewer.mjs` — MJPEG viewer server on `:3000`: `/` (HTML shell), `/stream` (MJPEG of
  the display), `/shot.jpg` (single frame), `/state` (JSON), `/healthz`.

The persistent mirror of these scripts lives outside the repo on the sandbox volume
(`/home/z/my-project/download/zcode-deploy/`) because pod recycles wipe everything
except `/home/z/my-project`. Keep both copies in sync.

Renderer edits hot-reload through the vite dev server straight into the streamed view —
that is the "watch the changes land" loop for this deployment.

## 2026-10-28 update — the operator live view runs the WEB stack (boot-web.sh)

The Electron-under-Xvfb path (`boot-desktop.sh` + `viewer.mjs`) boots electron main
but **chromium's `ready` never fires in this sandbox**: main thread parked in
`epoll_pwait` with only stdio pipe handles (`process.getActiveResourcesInfo()`),
no `--type=renderer` process, the `app.commandLine` remote-debugging switch never
applied (no :9229), app log stops right after `[arms] electron initialized`, and
disabling hardware acceleration via `~/.zcode/v2/setting.json`
(`desktopChromiumHardwareAccelerationEnabled: false`) did not unblock it.
The blocker is upstream in chromium's C++ startup for this environment — open,
documented, and NOT a product bug.

**`boot-web.sh` is the operator's live view**: `@zcode/server` (tsup watch, :3030)
+ `@zcode/web` vite (`0.0.0.0:3000`). Same renderer, same `packages/ui` HMR —
every lane edit lands live in the preview panel, and the view is interactive.
The packaged-desktop acceptance item (operator review §7) remains open until the
chromium ready-hang is resolved (candidate next step: compare the older
electron that boots fine in the sibling UniCom repo).
