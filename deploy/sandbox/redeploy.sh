#!/bin/bash
# One-command recovery for the zcode sandbox deployment. Everything outside
# /home/z/my-project is EPHEMERAL (pod recycles wipe it); this script lives on
# the persistent volume and rebuilds the whole deployment idempotently:
#   clone (if missing) → install (if missing) → free :3000 → Xvfb + desktop + viewer
# Safe to re-run at any time; each step is guarded.
set -u
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
[ -f /home/z/my-project/download/credentials.env ] && source /home/z/my-project/download/credentials.env || true
ROOT="${ZCODE_ROOT:-/home/z/unicom-3.0}"
LOGS=/home/z/logs
mkdir -p "$LOGS"
cd /home/z 2>/dev/null || true

# 1. clone / update the repo --------------------------------------------------
if [ ! -d "$ROOT/.git" ]; then
  echo "[redeploy] cloning unicom-3.0 into $ROOT"
  git clone https://x-access-token:${GITHUB_TOKEN}@github.com/payswapdotorg/unicom-3.0.git "$ROOT" || { echo "[redeploy] clone FAILED"; exit 1; }
else
  echo "[redeploy] repo present — pulling"
  (cd "$ROOT" && git pull --ff-only origin main 2>/dev/null || echo "[redeploy] pull skipped (local commits or offline)")
fi

# 2. install dependencies ------------------------------------------------------
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[redeploy] pnpm install (this takes several minutes on first run)"
  (cd "$ROOT" && corepack pnpm install --frozen-lockfile) || { echo "[redeploy] frozen install failed — retrying without lockfile"; (cd "$ROOT" && corepack pnpm install); } || { echo "[redeploy] install FAILED"; exit 1; }
else
  echo "[redeploy] node_modules present"
fi

# 3. free :3000 (stop the Next.js console dev server — its work is committed) ---
if fuser 3000/tcp >/dev/null 2>&1; then
  echo "[redeploy] freeing :3000 (stopping next dev)"
  pkill -f "next dev -p 3000" 2>/dev/null
  for _ in $(seq 1 20); do fuser 3000/tcp >/dev/null 2>&1 || break; sleep 0.5; done
  fuser -k 3000/tcp >/dev/null 2>&1 || true
else
  echo "[redeploy] :3000 already free"
fi

# 4. boot the desktop + viewer --------------------------------------------------
bash "$DEPLOY/boot-desktop.sh"

if ! pgrep -f "zcode-deploy/viewer.mjs" >/dev/null 2>&1; then
  echo "[redeploy] starting viewer on :3000"
  nohup node "$DEPLOY/viewer.mjs" >"$LOGS/viewer.log" 2>&1 &
  echo "[redeploy] viewer pid $!"
else
  echo "[redeploy] viewer already running"
fi

sleep 2
echo "[redeploy] status:"
curl -s http://127.0.0.1:3000/state || echo "(viewer not answering yet)"
echo
echo "[redeploy] done — the operator's preview panel now shows the zcode desktop app."
