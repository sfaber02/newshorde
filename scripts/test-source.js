// Run a single source plugin against live data and print raw vs. kept counts.
// Usage:
//   node scripts/test-source.js nws lat=47.6 lon=-122.3
//   node scripts/test-source.js fda_recall kinds=food sinceDays=45
//   node scripts/test-source.js rss feedUrl=https://example.com/feed keywords=radiohead
import { getPlugin, pluginCatalog } from '../src/sources/index.js';

const [type, ...rest] = process.argv.slice(2);
if (!type) {
  console.log('Available source types:');
  for (const m of pluginCatalog()) console.log(`  ${m.type} — ${m.description}`);
  process.exit(0);
}

const plugin = getPlugin(type);
if (!plugin) {
  console.error(`Unknown source type: ${type}`);
  process.exit(1);
}

const cfg = {};
for (const arg of rest) {
  const eq = arg.indexOf('=');
  if (eq === -1) continue;
  const key = arg.slice(0, eq);
  let val = arg.slice(eq + 1);
  if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
  else if (val === 'true') val = true;
  else if (val === 'false') val = false;
  cfg[key] = val;
}

console.log(`Polling ${type} with`, cfg, '\n');
try {
  const { rawCount, items, sample } = await plugin.poll(cfg);
  console.log(`raw entries:  ${rawCount}`);
  console.log(`kept (passed filter): ${items.length}\n`);
  for (const it of items) {
    console.log(`  [${it.severity}/${it.category}] ${it.title}`);
    if (it.body) console.log(`      ${it.body}`);
  }
  if (sample && sample.length) {
    console.log(`\n  dropped sample: ${sample.join(' | ')}`);
  }
} catch (err) {
  console.error('poll failed:', err.message);
  process.exit(1);
}
