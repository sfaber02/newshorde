# Deploying NewsHorde → newshorde.xyz

Runs in a Proxmox LXC under systemd, exposed by a **dashboard-managed Cloudflare
Tunnel**. The public feed is open; `/admin` is gated by Cloudflare Access.

`deploy/cloudflared-token` holds the tunnel connector token (gitignored — do not
commit). It's the token from `cloudflared service install <token>`.

## 1. Create the LXC (on the Proxmox host)

A small Debian 12 container is plenty:

```bash
# adjust storage/bridge to match your node; this mirrors your existing setup
pct create 118 local:vztmpl/debian-12-standard_*.tar.zst \
  --hostname newshorde --cores 1 --memory 768 --swap 256 \
  --rootfs local-lvm:4 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 --unprivileged 1 --onboot 1
pct start 118
pct enter 118
```

## 2. Copy the app + provision

From your Mac:

```bash
rsync -av --exclude node_modules --exclude data \
  ~/dev/newshorde/ root@<lxc-ip>:/opt/newshorde/
```

Then inside the container:

```bash
bash /opt/newshorde/deploy/setup-lxc.sh
```

That script installs Node 20, builds deps, writes `/opt/newshorde/.env`, installs and
starts the `newshorde` systemd service, installs `cloudflared`, and runs
`cloudflared service install <token>` using `deploy/cloudflared-token`.

Check it: `systemctl status newshorde` and `curl -s localhost:8787/api/status`.

## 3. Cloudflare dashboard (Zero Trust)

**Public hostname** — Networks → Tunnels → *(this tunnel)* → Public Hostname → Add:

| Field | Value |
|-------|-------|
| Subdomain | *(blank)* |
| Domain | newshorde.xyz |
| Service | HTTP → `localhost:8787` |

**Protect admin** — Access → Applications → Add a self-hosted app:

- Application domain: `newshorde.xyz`, path `admin` (add separate app or include
  paths for the admin APIs too: `api/sources`, `api/poll`, `api/catalog`).
- Policy: **Allow**, selector *Emails* → `sfaber02@gmail.com`.
- Leave `newshorde.xyz/` (the feed) with no Access app → stays public.

With Access in front of `/admin`, keep `ADMIN_TOKEN` blank in `.env` (Cloudflare does
the auth). For LAN-only access without the tunnel, set `ADMIN_TOKEN` instead.

## 4. Use it

- Feed: <https://newshorde.xyz>
- Admin: <https://newshorde.xyz/admin> → add your home lat/lon (NWS + air quality),
  turn on FDA Class I recalls, add band/RSS feeds with keywords.

## Updating later

```bash
rsync -av --exclude node_modules --exclude data ~/dev/newshorde/ root@<lxc-ip>:/opt/newshorde/
pct enter 118   # or ssh
cd /opt/newshorde && npm ci --omit=dev && systemctl restart newshorde
```

## Rotating the tunnel token

If the token leaks, delete/recreate the tunnel in the Cloudflare dashboard, drop the
new token into `deploy/cloudflared-token`, and re-run `cloudflared service install`.
