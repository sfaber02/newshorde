#!/usr/bin/env bash
# Provision NewsHorde on a fresh Debian 12 Proxmox LXC.
# Run as root inside the container. Idempotent-ish; safe to re-run.
set -euo pipefail

APP_DIR=/opt/newshorde
APP_USER=newshorde

echo "==> Installing Node 20 + build tools (for better-sqlite3) + cloudflared prereqs"
apt-get update
apt-get install -y curl ca-certificates gnupg build-essential python3
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating service user + app dir"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

echo "==> NOTE: copy the app into $APP_DIR before continuing (rsync from your Mac):"
echo "    rsync -av --exclude node_modules --exclude data ~/dev/newshorde/ root@<lxc-ip>:$APP_DIR/"
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "!! $APP_DIR/package.json not found — copy the app first, then re-run." >&2
  exit 1
fi

echo "==> Installing production dependencies"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Writing .env if missing"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<'ENV'
PORT=8787
DATA_DIR=/opt/newshorde/data
POLL_INTERVAL_MIN=10
NWS_CONTACT=newshorde (sfaber02@gmail.com)
# Leave ADMIN_TOKEN blank in production — /admin is gated by Cloudflare Access.
ADMIN_TOKEN=
ENV
fi

mkdir -p "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/newshorde.service" /etc/systemd/system/newshorde.service
systemctl daemon-reload
systemctl enable --now newshorde
sleep 2
systemctl --no-pager --lines=10 status newshorde || true

echo "==> Installing cloudflared (dashboard-managed tunnel)"
if ! command -v cloudflared >/dev/null; then
  mkdir -p /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update && apt-get install -y cloudflared
fi

if [ -f "$APP_DIR/deploy/cloudflared-token" ]; then
  TOKEN="$(tr -d '[:space:]' < "$APP_DIR/deploy/cloudflared-token")"
  cloudflared service install "$TOKEN"
  echo "==> cloudflared installed and running."
else
  echo "!! deploy/cloudflared-token not found. Run manually:" >&2
  echo "   cloudflared service install <TOKEN>" >&2
fi

cat <<'DONE'

==> Local install complete.

Finish in the Cloudflare dashboard (Zero Trust):
  1. Networks > Tunnels > (this tunnel) > Public Hostname:
       newshorde.xyz  ->  HTTP  ->  localhost:8787
  2. Access > Applications > Add:
       - Domain: newshorde.xyz  Path: /admin*   (also add /api/sources*, /api/poll*, /api/catalog*)
       - Policy: Allow, emails include sfaber02@gmail.com
     (Leave newshorde.xyz "/" public — that's the read-only feed.)

Then open https://newshorde.xyz and https://newshorde.xyz/admin to add your sources.
DONE
