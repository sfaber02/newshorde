// USGS earthquakes near a point above a magnitude threshold.
import { fetchJson } from './http.js';

export const meta = {
  type: 'usgs_quake',
  label: 'Earthquakes (USGS)',
  description: 'Significant quakes within a radius of a point.',
  fields: [
    { key: 'lat', label: 'Latitude', type: 'number', required: true },
    { key: 'lon', label: 'Longitude', type: 'number', required: true },
    { key: 'radiusKm', label: 'Radius (km)', type: 'number', default: 300 },
    { key: 'minMag', label: 'Min magnitude', type: 'number', default: 4.5 },
    { key: 'sinceDays', label: 'Look back (days)', type: 'number', default: 3 },
  ],
};

export async function poll(cfg) {
  const { lat, lon } = cfg;
  if (lat == null || lon == null) throw new Error('usgs source needs lat/lon');
  const radiusKm = Number(cfg.radiusKm || 300);
  const minMag = Number(cfg.minMag || 4.5);
  const sinceDays = Number(cfg.sinceDays || 3);
  const start = new Date(Date.now() - sinceDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&starttime=${start}&latitude=${lat}&longitude=${lon}` +
    `&maxradiuskm=${radiusKm}&minmagnitude=${minMag}&orderby=time`;

  const data = await fetchJson(url);
  const features = Array.isArray(data.features) ? data.features : [];
  const items = features.map((f) => {
    const p = f.properties || {};
    return {
      dedupe_key: f.id,
      severity: p.mag >= 6 ? 'critical' : 'warning',
      category: 'quake',
      title: `M${p.mag} earthquake — ${p.place || 'unknown location'}`,
      body: p.alert ? `USGS alert level: ${p.alert}` : null,
      link: p.url || null,
      starts_at: p.time ? new Date(p.time).toISOString() : null,
      expires_at: null,
    };
  });

  return { rawCount: features.length, items, sample: [] };
}
