// NWS / NOAA active weather alerts.
// Keeps genuinely act-now alerts (Severe/Extreme severity AND Immediate/Expected
// urgency) — the "FLEE FOR YOUR LIFE" surface — PLUS an allow-list of event types
// that matter regardless of severity (e.g. Air Quality Alerts, which NWS tags with
// Unknown severity but are still health-relevant).
import { fetchJson, truncate } from './http.js';
import { config as appConfig } from '../config.js';

export const meta = {
  type: 'nws',
  label: 'Weather / emergency alerts (NWS)',
  description:
    'Severe & Extreme alerts near a point (tornado, flash flood, fire, evacuation) plus any always-keep events like Air Quality.',
  fields: [
    { key: 'lat', label: 'Latitude', type: 'number', required: true },
    { key: 'lon', label: 'Longitude', type: 'number', required: true },
    {
      key: 'keepEvents',
      label: 'Always keep these events (comma sep, any severity)',
      type: 'text',
      default: 'Air Quality Alert',
    },
  ],
};

const KEEP_SEVERITY = new Set(['Severe', 'Extreme']);
const KEEP_URGENCY = new Set(['Immediate', 'Expected']);
const DEFAULT_KEEP_EVENTS = ['Air Quality Alert'];

function parseKeepEvents(cfg) {
  if (Array.isArray(cfg.keepEvents)) return cfg.keepEvents.map((s) => s.toLowerCase());
  if (typeof cfg.keepEvents === 'string' && cfg.keepEvents.trim()) {
    return cfg.keepEvents.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_KEEP_EVENTS.map((s) => s.toLowerCase());
}

export async function poll(cfg) {
  const { lat, lon } = cfg;
  if (lat == null || lon == null) throw new Error('nws source needs lat/lon');
  const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
  const data = await fetchJson(url, {
    headers: {
      'User-Agent': appConfig.nwsContact,
      Accept: 'application/geo+json',
    },
  });

  const keepEvents = parseKeepEvents(cfg);
  const features = Array.isArray(data.features) ? data.features : [];
  const dropped = [];
  const items = [];

  for (const f of features) {
    const p = f.properties || {};
    const isActNow = KEEP_SEVERITY.has(p.severity) && KEEP_URGENCY.has(p.urgency);
    const isAllowed = keepEvents.includes((p.event || '').toLowerCase());
    if (!isActNow && !isAllowed) {
      dropped.push(`${p.event} (${p.severity}/${p.urgency})`);
      continue;
    }
    // Life-threatening alerts get critical/warning; allow-listed non-severe
    // events (air quality, etc.) surface as info so they inform without alarming.
    let severity = 'info';
    if (p.severity === 'Extreme') severity = 'critical';
    else if (p.severity === 'Severe') severity = 'warning';
    else if (isActNow) severity = 'warning';
    items.push({
      dedupe_key: p.id || f.id,
      severity,
      category: 'flee',
      title: p.event || 'Weather alert',
      body: truncate(p.headline || p.description, 500),
      link: p['@id'] || `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
      starts_at: p.onset || p.effective || null,
      expires_at: p.ends || p.expires || null,
    });
  }

  return { rawCount: features.length, items, sample: dropped.slice(0, 8) };
}
