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
