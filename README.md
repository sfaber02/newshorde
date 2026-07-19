# NewsHorde

> "I don't wanna know unless it's gonna kill me."
> _(also: "That which does not kill me, is fucking irrelevant to me.")_

A ruthlessly curated **anti-news** feed. Silent 99% of the time. Instead of the
day-to-day horseshit, you get exactly two things: a dumb daily **headline** of
vital signs, and a **feed** that only ever surfaces stuff that can actually hurt
you. Live at **[newshorde.xyz](https://newshorde.xyz)**.

## The headline

The top of the page is three-ish big, colorful, run-together sentences — all
backed by **real data**, no made-up numbers:

- **Is Iggy Pop alive?** — checked against Wikidata (entity `Q184572`; if a
  "date of death" ever shows up, the sentence flips to an RIP).
- **The weather vibe** for your location — derived from the NWS forecast and
  phrased like a friend, not a meteorologist: _"it's gonna be nice out in
  New York"_, _"hot as shit"_, _"cold as balls"_, _"it's gonna piss rain"_.
- **Did any nukes go off?** — _"no nukes went off today ☮️"_, from the USGS
  seismic catalog (`eventtype=nuclear explosion`, which is how nuclear tests
  register). If one ever pops, it says so, in red.
- **The price of ketchup** — the real U.S. **BLS Producer Price Index** for
  canned catsup (FRED series `WPU02440127`), month-over-month change to an absurd
  4 decimal places, with a sparkline whose shaded area is filled with tomatoes.

## The feed

Only life-safety signal makes it in; everything else is dropped. Categories:

- **Flee** — NWS/NOAA severe & extreme, act-now alerts (tornado, flash flood,
  fire, evacuation), plus your location's active weather alerts and **unhealthy
  air** (live US AQI from Open-Meteo, since NWS misses a lot of bad-air days).
- **Recall** — openFDA **Class I** recalls only (the "serious injury or death" tier).
- **Outbreak** — active FDA CORE outbreak investigations, including ones with **no
  mandated recall** (e.g. the Taco Bell Cyclospora case).
- **Quake** — USGS earthquakes above a magnitude near you (off by default).
- **For you** — any RSS/Atom feed filtered to a keyword allow-list (e.g. a band's
  Bandsintown feed → only when they're playing near you).

When nothing qualifies, the feed just says **ALL CLEAR — go back to your life.**
Read/unread is tracked **per browser** (localStorage), so clearing the feed on
your phone doesn't clear it for anyone else.

## How it works

One Node process: an Express app serves the feed + admin UI and runs a polling
loop (`node-cron`) that pulls each source through a plugin, applies a ruthless
filter, and stores only survivors in SQLite. Sources are managed from `/admin`.

```
src/
  server.js       Express routes + cron scheduler
  poller.js       polls enabled sources, filters, persists
  db.js           SQLite schema + queries
  config.js       env loading
  extras.js       headline data: Iggy (Wikidata), ketchup (BLS/FRED), nukes (USGS)
  sources/        one file per source type (plugin)
    nws.js  fdaRecall.js  fdaOutbreak.js  usgsQuake.js  rss.js  bandsintown.js
    index.js (registry)  http.js (fetch helpers)
public/           feed (index) + admin UI, vanilla JS, tomato asset
scripts/          test-source.js, poll-once.js
deploy/           push.sh + systemd unit + LXC provisioning + Cloudflare notes
```

**Add a new source type** = drop a file in `src/sources/` exporting `meta` and
`async poll(config)` that returns `{ rawCount, items, sample }`, then register it
in `src/sources/index.js`. The admin UI builds its form from `meta.fields`
automatically.

### API

Public: `GET /api/items`, `GET /api/status`, `GET /api/headlines?lat&lon`,
`GET /api/forecast?lat&lon` (NWS points/hourly/daily/alerts + AQI),
`GET /api/geocode?q=` (Nominatim, US-only).
Admin (gated): `GET /api/catalog`, `GET/POST /api/sources`,
`PATCH/DELETE /api/sources/:id`, `POST /api/poll`.

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
npm run test-source -- fda_outbreak
npm run test-source -- rss feedUrl=https://example.com/feed keywords=radiohead
```

Run one poll of all configured sources and exit: `npm run poll`.

## Filtering philosophy

Allow-list, not block-list. Government feeds are gated on severity/class
thresholds; RSS is gated on explicit keywords (no keywords match = nothing shows).
Every source has an enable/disable switch, and the admin "kept/raw" counts +
dropped-sample let you tune filters. An empty feed is the expected, healthy state.

## Admin

`/admin` and the admin APIs are gated by **HTTP Basic auth** — set
`ADMIN_PASSWORD` in `.env` (username is ignored, password only). Leave it blank to
leave admin open (e.g. when gating upstream instead). Scripts/CLI can pass the same
value via `?token=` or the `X-Admin-Token` header.

## Deploy

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md). Runs in a Proxmox LXC under systemd,
exposed via a Cloudflare Tunnel on **newshorde.xyz**. `deploy/push.sh` syncs the
working tree to the container and restarts the service. Assets are cache-busted per
process boot so deploys go live in browsers without a hard refresh.
