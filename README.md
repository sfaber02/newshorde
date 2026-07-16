# NewsHorde

> "I don't wanna know unless it's gonna kill me."

A ruthlessly curated anti-news feed. Silent 99% of the time. Only surfaces things
that actually matter to you:

- **Flee** — NWS/NOAA severe & extreme, act-now alerts (tornado, flash flood, fire,
  evacuation) plus always-keep events like Air Quality.
- **Recall** — openFDA **Class I** recalls only (the "serious injury or death" tier).
- **Quake** — USGS earthquakes above a magnitude near you (off by default).
- **For you** — any RSS/Atom feed filtered to a keyword allow-list (e.g. a band's
  Bandsintown feed → only when they're near you).

When nothing qualifies, the feed just says **ALL CLEAR — go back to your life.**

## How it works

One Node process: an Express app serves the feed + admin UI and runs a polling loop
(`node-cron`) that pulls each source through a plugin, applies a ruthless filter, and
stores only survivors in SQLite. Sources are added/managed from `/admin`.

```
src/
  server.js       Express routes + cron scheduler
  poller.js       polls enabled sources, filters, persists
  db.js           SQLite schema + queries
  config.js       env loading
  sources/        one file per source type (plugin)
    nws.js  fdaRecall.js  usgsQuake.js  rss.js  index.js (registry)
public/           feed (index) + admin UI, vanilla JS
scripts/          test-source.js, poll-once.js
deploy/           systemd unit + LXC provisioning + Cloudflare notes
```

**Add a new source type** = drop a file in `src/sources/` exporting `meta` and
`async poll(config)` that returns `{ rawCount, items, sample }`, then register it in
`src/sources/index.js`. The admin UI builds its form from `meta.fields` automatically.

## Run locally

```bash
npm install
cp .env.example .env      # optional; defaults are fine
npm start                 # http://localhost:8787  (admin at /admin)
```

Test a single source against live data without the server:

```bash
npm run test-source -- nws lat=47.6 lon=-122.3
npm run test-source -- fda_recall kinds=food,drug sinceDays=30
npm run test-source -- rss feedUrl=https://example.com/feed keywords=radiohead
```

## Filtering philosophy

Allow-list, not block-list. Government feeds are gated on severity/class thresholds;
RSS is gated on explicit keywords (no keywords match = nothing shows). Every source
has an enable/disable switch, and the admin "kept/raw" counts + dropped-sample let you
tune filters. An empty feed is the expected, healthy state.

## Deploy

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — runs in a Proxmox LXC under systemd,
exposed via a Cloudflare Tunnel on **newshorde.xyz**, with `/admin` gated by
Cloudflare Access.
