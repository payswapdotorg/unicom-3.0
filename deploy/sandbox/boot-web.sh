#!/bin/bash
# Boots the zcode WEB stack (operator live view): @zcode/server on :3030 +
# @zcode/web vite on 0.0.0.0:3000 (the sandbox gateway proxies the operator's
# preview panel to :3000 — interactive, HMR-visible).
#
# WHY web, not the Electron desktop (2026-10-28): the desktop under Xvfb boots
# electron main but chromium's `ready` never fires in this sandbox (diagnosis:
# main thread idle in epoll_pwait with only stdio pipe handles; app.commandLine
# remote-debugging never applied; no renderer process; app.log stops after
# "[arms] electron initialized"; hardware-acceleration disabled via
# ~/.zcode/v2/setting.json did NOT unblock it). The renderer IS the same React
# app — packages/web serves it faithfully, so the operator sees every
# packages/ui / services change land live, and can interact through the
# gateway. The packaged-desktop acceptance (review §7 item) stays OPEN with the
# blocker documented; the MJPEG/Xvfb path returns to it later.
set -u
ROOT="${ZCODE_ROOT:-/home/z/unicom-3.0}"
LOGS=/home/z/logs
mkdir -p "$LOGS"
export PATH="/home/z/.local/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

[ -d "$ROOT/node_modules" ] || { echo "[boot-web] FATAL: $ROOT/node_modules missing — run install first"; exit 1; }

boot_server() {
  pgrep -f "server dev|@zcode/server" >/dev/null 2>&1 && { echo "[boot-web] server already running"; return 0; }
  echo "[boot-web] starting @zcode/server (tsup watch → :3030)"
  nohup bash -c "cd '$ROOT' && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --filter @zcode/server dev" >>"$LOGS/server.log" 2>&1 &
}

boot_web() {
  ss -ltn 2>/dev/null | grep -q ':3000 ' && { echo "[boot-web] :3000 already bound"; return 0; }
  echo "[boot-web] starting @zcode/web vite (0.0.0.0:3000)"
  nohup bash -c "cd '$ROOT' && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --filter @zcode/web exec vite dev --host 0.0.0.0 --port 3000 --strictPort" >>"$LOGS/web.log" 2>&1 &
}

boot_server
boot_web
for _ in $(seq 1 40); do ss -ltn 2>/dev/null | grep -q ':3000 ' && break; sleep 1; done
ss -ltn 2>/dev/null | grep -q ':3000 ' && echo "[boot-web] live view UP on :3000" || { echo "[boot-web] :3000 did not come up — see $LOGS/web.log"; exit 1; }
echo "[boot-web] done — the operator's preview panel shows the zcode web app now."
