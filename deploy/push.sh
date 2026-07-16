#!/usr/bin/env bash
# One-command deploy: sync local code to the live container and restart.
# Usage:  ./deploy/push.sh          (code only)
#         ./deploy/push.sh --deps   (also reinstall deps for package.json changes)
set -euo pipefail

HOST=root@192.168.50.118
APP=/opt/newshorde
SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing $SRC -> $HOST:$APP"
# Stream everything except local-only dirs; include deploy/cloudflared-token (present
# on disk, gitignored). --delete keeps the container in sync with local.
tar czf - -C "$SRC" \
  --exclude node_modules --exclude data --exclude .git \
  --exclude .playwright-mcp --exclude .DS_Store --exclude .env . \
| ssh -o BatchMode=yes "$HOST" "tar xzf - -C $APP"

if [ "${1:-}" = "--deps" ]; then
  echo "==> Reinstalling production deps"
  ssh -o BatchMode=yes "$HOST" "cd $APP && npm ci --omit=dev"
fi

echo "==> Restarting service"
ssh -o BatchMode=yes "$HOST" "chown -R newshorde:newshorde $APP && systemctl restart newshorde && sleep 1 && systemctl is-active newshorde && curl -s localhost:8787/api/status"
echo
echo "==> Live at https://newshorde.xyz"
