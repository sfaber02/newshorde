// Bandsintown artist tour dates via the official REST API.
// Requires an app_id (Bandsintown now denies anonymous access). Surfaces a
// "For you" card only when a tracked artist has an upcoming show near you.
//
// API: https://rest.bandsintown.com/artists/{artist}/events?app_id=...&date=upcoming
//   {artist} may be a name, `id_<numericId>`, or `fbid_<facebookId>`.
import { fetchJson, truncate } from './http.js';

export const meta = {
  type: 'bandsintown',
  label: 'Band coming to town (Bandsintown)',
  description:
    'Upcoming shows for artists you follow, filtered to your area. Needs a Bandsintown API app_id.',
  fields: [
    { key: 'appId', label: 'Bandsintown app_id', type: 'text', required: true },
    {
      key: 'artists',
      label: 'Artists (comma sep — paste the bandsintown URL, an id, or a name)',
      type: 'text',
      required: true,
    },
    {
      key: 'cities',
      label: 'Only near these cities/regions (comma sep). Blank = anywhere.',
      type: 'text',
      required: false,
    },
    { key: 'lat', label: 'Or filter by latitude', type: 'number', required: false },
    { key: 'lon', label: 'Longitude', type: 'number', required: false },
    { key: 'radiusKm', label: 'Radius (km)', type: 'number', default: 150 },
  ],
};

// Turn whatever the user pasted into an API artist selector + a friendly name.
function normalizeArtist(input) {
  const raw = String(input).trim();
  // Bandsintown URL, e.g. https://www.bandsintown.com/a/15537640-angine-de-poitrine
  const urlMatch = raw.match(/bandsintown\.com\/a\/(\d+)(?:-([^?/#]+))?/i);
  if (urlMatch) {
    const name = urlMatch[2] ? decodeURIComponent(urlMatch[2]).replace(/-/g, ' ') : `id ${urlMatch[1]}`;
    return { selector: `id_${urlMatch[1]}`, name };
  }
  if (/^\d+$/.test(raw)) return { selector: `id_${raw}`, name: `id ${raw}` };
  return { selector: encodeURIComponent(raw), name: raw };
}

function haversineKm(a, b, c, d) {
  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function titleCase(s) {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export async function poll(cfg) {
  if (!cfg.appId) throw new Error('bandsintown source needs an app_id');
  if (!cfg.artists) throw new Error('bandsintown source needs at least one artist');

  const cities = (cfg.cities || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const hasGeo = cfg.lat != null && cfg.lon != null && cfg.lat !== '' && cfg.lon !== '';
  const radiusKm = Number(cfg.radiusKm || 150);

  const artists = String(cfg.artists)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeArtist);

  let rawCount = 0;
  const dropped = [];
  const items = [];

  for (const artist of artists) {
    const url = `https://rest.bandsintown.com/artists/${artist.selector}/events?app_id=${encodeURIComponent(
      cfg.appId
    )}&date=upcoming`;

    let data;
    try {
      data = await fetchJson(url, { headers: { 'User-Agent': 'newshorde' } });
    } catch (err) {
      if (String(err.message).includes('HTTP 403')) {
        throw new Error(
          'Bandsintown denied the request — check your app_id (anonymous access is blocked).'
        );
      }
      throw err;
    }

    // Non-array response = error object or "artist not found".
    if (!Array.isArray(data)) {
      if (data && (data.errorMessage || data.Message)) {
        dropped.push(`${artist.name}: ${data.errorMessage || data.Message}`);
      }
      continue;
    }

    for (const ev of data) {
      rawCount += 1;
      const v = ev.venue || {};
      const where = `${v.city || ''} ${v.region || ''} ${v.country || ''}`.toLowerCase();

      let near = true;
      if (cities.length) near = cities.some((c) => where.includes(c));
      if (near && hasGeo && v.latitude && v.longitude) {
        const dist = haversineKm(
          Number(cfg.lat),
          Number(cfg.lon),
          Number(v.latitude),
          Number(v.longitude)
        );
        near = dist <= radiusKm;
      }
      if (!near) {
        dropped.push(`${artist.name} @ ${v.city || 'unknown'}`);
        continue;
      }

      const when = ev.datetime ? new Date(ev.datetime) : null;
      const city = [v.city, v.region].filter(Boolean).join(', ');
      items.push({
        dedupe_key: `bandsintown:${ev.id}`,
        severity: 'info',
        category: 'personal',
        title: `${titleCase(artist.name)} — ${city || v.name || 'a show near you'}`,
        body: truncate(
          `${v.name ? v.name + ' · ' : ''}${when ? when.toLocaleString() : ''}`,
          300
        ),
        link: ev.url || null,
        starts_at: ev.datetime || null,
        // Age the card out shortly after the show happens.
        expires_at: when ? new Date(when.getTime() + 12 * 3600 * 1000).toISOString() : null,
      });
    }
  }

  return { rawCount, items, sample: dropped.slice(0, 8) };
}
