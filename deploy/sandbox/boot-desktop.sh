#!/bin/bash
# Boots Xvfb :100 + the zcode desktop app (dev mode) under it. Idempotent.
# Logs: /home/z/logs/{xvfb,desktop}.log
set -u
ROOT="${ZCODE_ROOT:-/home/z/unicom-3.0}"
LOGS=/home/z/logs
mkdir -p "$LOGS"

# --- Xvfb on :100 -------------------------------------------------------------
XN=100
if [ -e "/tmp/.X11-unix/X$XN" ]; then
  echo "[boot] Xvfb :$XN already up"
else
  echo "[boot] starting Xvfb :$XN (1280x800x24)"
  nohup Xvfb :$XN -screen 0 1280x800x24 -nolisten tcp >"$LOGS/xvfb.log" 2>&1 &
  for _ in $(seq 1 40); do [ -e "/tmp/.X11-unix/X$XN" ] && break; sleep 0.25; done
fi
[ -e "/tmp/.X11-unix/X$XN" ] || { echo "[boot] FATAL: Xvfb failed — see $LOGS/xvfb.log"; exit 1; }

# --- desktop app --------------------------------------------------------------
PIDFILE=/tmp/zcode-desktop.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[boot] desktop already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

[ -d "$ROOT" ] || { echo "[boot] FATAL: $ROOT missing — run redeploy.sh first"; exit 1; }
[ -d "$ROOT/node_modules" ] || { echo "[boot] FATAL: node_modules missing — run redeploy.sh first"; exit 1; }

echo "[boot] starting zcode desktop (pnpm dev:desktop) under dbus + Xvfb :$XN"
cd "$ROOT"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
nohup dbus-run-session -- bash -c "
  cd '$ROOT'
  export DISPLAY=:$XN
  export ELECTRON_DISABLE_SANDBOX=1
  export ELECTRON_ENABLE_LOGGING=1
  export ZCODE_HEADLESS=1
  exec corepack pnpm dev:desktop
" >"$LOGS/desktop.log" 2>&1 &
echo $! > "$PIDFILE"
echo "[boot] desktop launcher pid $(cat "$PIDFILE") — log: $LOGS/desktop.log"
echo "[boot] renderer (vite) will come up on :5174; first boot compiles, give it a couple of minutes"
