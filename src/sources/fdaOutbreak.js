// FDA/CDC foodborne illness OUTBREAK investigations.
// Distinct from recalls: this catches active investigations even when NO recall
// has been issued (e.g. the 2026 Taco Bell Cyclospora case the recall feed misses).
// Source: FDA CORE "Investigations of Foodborne Illness Outbreaks" HTML table.
import { fetchText, truncate } from './http.js';

export const meta = {
  type: 'fda_outbreak',
  label: 'Foodborne outbreak investigations (FDA/CDC)',
  description:
    'Active FDA/CDC foodborne-illness outbreak investigations — including outbreaks with no formal recall.',
  fields: [
    {
      key: 'includeRecalled',
      label: 'Include outbreaks that already have a recall',
      type: 'boolean',
      default: true,
    },
  ],
};

const PAGE =
  'https://www.fda.gov/food/outbreaks-foodborne-illness/investigations-foodborne-illness-outbreaks';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 newshorde';

const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const unescapeHtml = (s) =>
  s
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, ' ');
const cellText = (c) => unescapeHtml(stripTags(c)).replace(/\s+/g, ' ').trim();
// The table smushes words together ("SalmonellaTyphimurium"); re-space them.
const despace = (s) => s.replace(/([a-z.])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();

const PLACEHOLDER = /^(not (yet )?identified|see advisory|see cdc|unknown|)$/i;

function absolutize(href) {
  if (!href) return PAGE;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `https://www.fda.gov${href}`;
  return PAGE;
}

function parseDate(mdy) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(mdy || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])).toISOString();
}

export async function poll(cfg = {}) {
  const includeRecalled = cfg.includeRecalled !== false;
  const html = await fetchText(PAGE, { headers: { 'User-Agent': UA } });

  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  let rawCount = 0;
  const dropped = [];
  const items = [];
  const seen = new Set();

  for (const table of tables) {
    // Only the outbreak-investigation tables have an "InvestigationStatus" header.
    if (!/Investigation\s*Status/i.test(stripTags(table))) continue;
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map((c) => c);
      if (cells.length < 8) continue; // header/spacer rows
      rawCount += 1;

      const date = cellText(cells[0]);
      const ref = cellText(cells[1]);
      const pathogen = despace(cellText(cells[2]));
      const product = despace(cellText(cells[3]));
      const cases = despace(cellText(cells[4]));
      const invStatus = cellText(cells[5]);
      const recall = cellText(cells[7]);

      if (!/^active$/i.test(invStatus)) {
        dropped.push(`${pathogen} (${invStatus})`);
        continue;
      }
      const hasRecall = recall && !/^(no|none|)$/i.test(recall);
      if (hasRecall && !includeRecalled) {
        dropped.push(`${pathogen} (already recalled)`);
        continue;
      }
      if (seen.has(ref)) continue;
      seen.add(ref);

      const hrefs = [...row.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
      const link = absolutize(
        hrefs.find((h) => /outbreak-investigation|cdc\.gov|investigation-notice|advisory/i.test(h)) ||
          hrefs[0]
      );

      const hasProduct = product && !PLACEHOLDER.test(product);
      const recallNote = hasRecall ? `recall issued` : `no recall yet`;
      items.push({
        dedupe_key: `fda_outbreak:${ref}`,
        severity: 'warning',
        category: 'outbreak',
        title: `Outbreak: ${pathogen}${hasProduct ? ' — ' + product : ''}`,
        body: truncate(
          `Active FDA/CDC investigation · cases: ${cases || 'see notice'} · ${recallNote}.`,
          400
        ),
        link,
        starts_at: parseDate(date),
        // Refresh a short expiry each poll; once the investigation closes it stops
        // being emitted and ages out within a few days.
        expires_at: new Date(Date.now() + 4 * 86400000).toISOString(),
      });
    }
  }

  return { rawCount, items, sample: dropped.slice(0, 8) };
}
