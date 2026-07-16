// Generic RSS/Atom source with a keyword ALLOW-LIST. Nothing matches → nothing
// shows. This is the opt-in personal-signal path (e.g. a Bandsintown artist feed
// filtered to your city, a specific band name, etc.).
import Parser from 'rss-parser';
import { truncate } from './http.js';
import { config as appConfig } from '../config.js';

const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': appConfig.nwsContact },
});

export const meta = {
  type: 'rss',
  label: 'RSS / Atom feed (keyword allow-list)',
  description:
    'Subscribe to a feed but only surface entries matching your keywords (e.g. band names, a city).',
  fields: [
    { key: 'feedUrl', label: 'Feed URL', type: 'text', required: true },
    {
      key: 'keywords',
      label: 'Keywords (comma sep, ANY match). Blank = allow all.',
      type: 'text',
      required: false,
    },
    {
      key: 'matchAll',
      label: 'Require ALL keywords instead of any',
      type: 'boolean',
      default: false,
    },
  ],
};

function parseKeywords(kw) {
  if (Array.isArray(kw)) return kw.map((s) => s.toLowerCase());
  if (!kw) return [];
  return String(kw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function poll(cfg) {
  if (!cfg.feedUrl) throw new Error('rss source needs feedUrl');
  const keywords = parseKeywords(cfg.keywords);
  const matchAll = !!cfg.matchAll;

  const feed = await parser.parseURL(cfg.feedUrl);
  const entries = feed.items || [];
  const dropped = [];
  const items = [];

  for (const e of entries) {
    const hay = `${e.title || ''} ${e.contentSnippet || e.content || ''}`.toLowerCase();
    let keep = true;
    if (keywords.length) {
      keep = matchAll
        ? keywords.every((k) => hay.includes(k))
        : keywords.some((k) => hay.includes(k));
    }
    if (!keep) {
      dropped.push(truncate(e.title, 60));
      continue;
    }
    items.push({
      dedupe_key: e.guid || e.link || e.title,
      severity: 'info',
      category: 'personal',
      title: truncate(e.title || feed.title || 'Update', 120),
      body: truncate(e.contentSnippet || e.content, 400),
      link: e.link || cfg.feedUrl,
      starts_at: e.isoDate || null,
      expires_at: null,
    });
  }

  return { rawCount: entries.length, items, sample: dropped.slice(0, 8) };
}
