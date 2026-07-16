import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import { config } from './config.js';
import { fetchJson } from './sources/http.js';
import {
  activeItems,
  listSources,
  getSource,
  createSource,
  updateSource,
  deleteSource,
  getPullLog,
} from './db.js';
import { pluginCatalog, getPlugin } from './sources/index.js';
import { pollAll, pollSource, getStatus } from './poller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');

const app = express();
app.use(express.json());

// ---- admin gate -------------------------------------------------------------
// Gate admin routes. If neither ADMIN_PASSWORD nor ADMIN_TOKEN is set, we assume
// the admin path is protected upstream (e.g. Cloudflare Access) and allow through.
// Otherwise accept either HTTP Basic auth (browser password prompt) or a token
// header/query (CLI/scripts).
function requireAdmin(req, res, next) {
  const { adminToken, adminPassword } = config;
  if (!adminToken && !adminPassword) return next();

  const token =
    req.get('X-Admin-Token') || req.query.token || (req.body && req.body.token);
  if (adminToken && token === adminToken) return next();

  if (adminPassword) {
    const hdr = req.get('Authorization') || '';
    if (hdr.startsWith('Basic ')) {
      const decoded = Buffer.from(hdr.slice(6), 'base64').toString();
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (pass === adminPassword) return next();
    }
    // Prompt the browser for credentials.
    res.set('WWW-Authenticate', 'Basic realm="NewsHorde admin"');
  }
  return res.status(401).json({ error: 'admin auth required' });
}

// ---- public feed API --------------------------------------------------------
// Full live list of active alerts. Read/unread is a per-browser concern handled
// client-side (localStorage), so the server always returns everything active.
app.get('/api/items', (req, res) => {
  res.json({ items: activeItems(), status: getStatus() });
});

app.get('/api/status', (req, res) => {
  const items = activeItems();
  res.json({
    status: getStatus(),
    counts: {
      total: items.length,
      flee: items.filter((i) => i.category === 'flee').length,
      recall: items.filter((i) => i.category === 'recall').length,
      quake: items.filter((i) => i.category === 'quake').length,
      personal: items.filter((i) => i.category === 'personal').length,
    },
  });
});

// ---- weather (per-visitor location) ----------------------------------------
// NWS forecast + alerts for a point. Cached briefly to stay gentle on api.weather.gov.
const forecastCache = new Map();
const FORECAST_TTL = 10 * 60 * 1000;

const nwsHeaders = { 'User-Agent': config.nwsContact, Accept: 'application/geo+json' };

function mapHour(p) {
  return {
    time: p.startTime,
    temp: p.temperature,
    tempUnit: p.temperatureUnit,
    precip: p.probabilityOfPrecipitation?.value ?? null,
    wind: p.windSpeed,
    windDir: p.windDirection,
    short: p.shortForecast,
    icon: p.icon,
  };
}
function mapDay(p) {
  return {
    name: p.name,
    isDaytime: p.isDaytime,
    temp: p.temperature,
    tempUnit: p.temperatureUnit,
    precip: p.probabilityOfPrecipitation?.value ?? null,
    wind: p.windSpeed,
    short: p.shortForecast,
    icon: p.icon,
  };
}
function mapAlert(f) {
  const p = f.properties || {};
  return {
    event: p.event,
    severity: p.severity,
    headline: p.headline,
    area: p.areaDesc,
    expires: p.ends || p.expires,
    link: p['@id'] || null,
  };
}

async function getForecast(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = forecastCache.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL) return hit.data;

  const points = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: nwsHeaders,
  });
  const pp = points.properties || {};
  const loc = pp.relativeLocation?.properties;
  const label = loc ? `${loc.city}, ${loc.state}` : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

  const [daily, hourly, alertsRaw] = await Promise.all([
    fetchJson(pp.forecast, { headers: nwsHeaders }).catch(() => null),
    fetchJson(pp.forecastHourly, { headers: nwsHeaders }).catch(() => null),
    fetchJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
      headers: nwsHeaders,
    }).catch(() => null),
  ]);

  const hp = hourly?.properties?.periods || [];
  const dp = daily?.properties?.periods || [];
  const data = {
    location: label,
    updatedAt: new Date().toISOString(),
    current: hp[0] ? mapHour(hp[0]) : null,
    hourly: hp.slice(0, 12).map(mapHour),
    daily: dp.slice(0, 6).map(mapDay),
    alerts: (alertsRaw?.features || []).map(mapAlert),
  };
  forecastCache.set(key, { at: Date.now(), data });
  return data;
}

app.get('/api/forecast', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon required' });
  }
  try {
    res.json(await getForecast(lat, lon));
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
});

// Geocode a city/ZIP to lat/lon for manual location entry (US only — NWS is US).
app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const data = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(
        q
      )}`,
      { headers: { 'User-Agent': config.nwsContact } }
    );
    if (!data.length) return res.status(404).json({ error: 'not found' });
    res.json({
      lat: Number(data[0].lat),
      lon: Number(data[0].lon),
      label: data[0].display_name.split(',').slice(0, 2).join(',').trim(),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
});

// ---- admin: source management ----------------------------------------------
app.get('/api/catalog', requireAdmin, (req, res) => {
  res.json({ catalog: pluginCatalog() });
});

app.get('/api/sources', requireAdmin, (req, res) => {
  res.json({ sources: listSources(), pullLog: getPullLog() });
});

const sourceSchema = z.object({
  type: z.string(),
  label: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.any()).optional(),
});

app.post('/api/sources', requireAdmin, (req, res) => {
  const parsed = sourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues });
  }
  if (!getPlugin(parsed.data.type)) {
    return res.status(400).json({ error: `unknown source type ${parsed.data.type}` });
  }
  const source = createSource(parsed.data);
  res.status(201).json({ source });
});

app.patch('/api/sources/:id', requireAdmin, (req, res) => {
  const source = updateSource(Number(req.params.id), req.body || {});
  res.status(source ? 200 : 404).json({ source });
});

app.delete('/api/sources/:id', requireAdmin, (req, res) => {
  const ok = deleteSource(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

// Trigger an immediate poll (all sources, or one via ?id=).
app.post('/api/poll', requireAdmin, async (req, res) => {
  const id = req.query.id ? Number(req.query.id) : null;
  if (id) {
    const source = getSource(id);
    if (!source) return res.status(404).json({ error: 'no such source' });
    return res.json({ result: await pollSource(source) });
  }
  res.json(await pollAll());
});

// ---- static pages -----------------------------------------------------------
// Cache-bust versioned assets: Cloudflare forces a long browser TTL on JS/CSS, so
// we serve HTML with no-store and stamp a per-boot version onto asset URLs. Each
// deploy restarts the process -> new version -> browsers fetch fresh JS/CSS.
const ASSET_VERSION = String(Date.now());
function sendHtml(res, file) {
  let html = fs.readFileSync(path.join(publicDir, file), 'utf8');
  html = html.replace(/(\/(?:app|admin)\.js|\/styles\.css)"/g, `$1?v=${ASSET_VERSION}"`);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
}

app.get(['/', '/index.html'], (req, res) => sendHtml(res, 'index.html'));
// Gate the admin page BEFORE static so admin.html can't be served unauthenticated.
app.get(['/admin', '/admin.html'], requireAdmin, (req, res) => sendHtml(res, 'admin.html'));
app.use(express.static(publicDir, { index: false }));

// ---- boot -------------------------------------------------------------------
app.listen(config.port, () => {
  console.log(`NewsHorde listening on http://localhost:${config.port}`);
  console.log(`Polling every ${config.pollIntervalMin} min. Kicking off first poll…`);
  pollAll().catch((e) => console.error('initial poll failed', e));
});

// Schedule recurring polls.
const spec = `*/${Math.max(1, config.pollIntervalMin)} * * * *`;
cron.schedule(spec, () => {
  pollAll().catch((e) => console.error('scheduled poll failed', e));
});
