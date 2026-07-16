// openFDA enforcement (recall) reports. Keeps Class I only — the tier defined as
// "reasonable probability of serious adverse health consequences or death".
// This is the "rocks in the potato chips" surface.
import { fetchJson, truncate } from './http.js';

export const meta = {
  type: 'fda_recall',
  label: 'Dangerous recalls (FDA Class I)',
  description:
    'Food and/or drug recalls at the Class I (serious injury/death) tier from openFDA.',
  fields: [
    {
      key: 'kinds',
      label: 'Which recalls (comma sep: food, drug)',
      type: 'text',
      default: 'food,drug',
    },
    {
      key: 'state',
      label: 'Limit to state (2-letter, optional)',
      type: 'text',
      required: false,
    },
    { key: 'sinceDays', label: 'Look back (days)', type: 'number', default: 30 },
  ],
};

function endpointFor(kind) {
  if (kind === 'food') return 'https://api.fda.gov/food/enforcement.json';
  if (kind === 'drug') return 'https://api.fda.gov/drug/enforcement.json';
  return null;
}

function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export async function poll(cfg) {
  const kinds = (cfg.kinds || 'food,drug')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const sinceDays = Number(cfg.sinceDays || 30);
  const since = new Date(Date.now() - sinceDays * 86400000);

  let rawCount = 0;
  const dropped = [];
  const items = [];

  for (const kind of kinds) {
    const endpoint = endpointFor(kind);
    if (!endpoint) continue;

    // openFDA lucene-ish query: recent reports, any classification (we filter below
    // so we can log what got dropped). report_date is YYYYMMDD.
    const search = `report_date:[${yyyymmdd(since)}+TO+${yyyymmdd(new Date())}]`;
    const url = `${endpoint}?search=${search}&limit=100&sort=report_date:desc`;

    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      // openFDA returns 404 when a query matches zero rows — treat as empty.
      if (String(err.message).includes('HTTP 404')) continue;
      throw err;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    rawCount += results.length;

    for (const r of results) {
      if (r.classification !== 'Class I') {
        dropped.push(`${truncate(r.product_description, 60)} (${r.classification})`);
        continue;
      }
      if (cfg.state) {
        const st = String(cfg.state).toUpperCase();
        const dist = (r.distribution_pattern || '').toUpperCase();
        const firmState = (r.state || '').toUpperCase();
        const nationwide = /NATIONWIDE|ALL 50|NATION WIDE/.test(dist);
        if (!nationwide && firmState !== st && !dist.includes(st)) {
          dropped.push(`${truncate(r.product_description, 40)} (not ${st})`);
          continue;
        }
      }
      items.push({
        dedupe_key: `${kind}:${r.recall_number || r.event_id}`,
        severity: 'warning',
        category: 'recall',
        title: `Recall: ${truncate(r.product_description, 90)}`,
        body: truncate(
          `${r.reason_for_recall || ''} — ${r.recalling_firm || ''}`,
          500
        ),
        link: 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
        starts_at: null,
        expires_at: null,
      });
    }
  }

  return { rawCount, items, sample: dropped.slice(0, 8) };
}
