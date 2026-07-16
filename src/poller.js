// Polls every enabled source through its plugin, filters, and persists survivors.
import { getPlugin } from './sources/index.js';
import {
  listSources,
  upsertItems,
  recordPull,
  pruneItems,
} from './db.js';

let running = false;
let lastRun = null;

export function getStatus() {
  return { running, lastRun };
}

// Poll a single source (by row). Returns a summary for logging/debug.
export async function pollSource(source) {
  const plugin = getPlugin(source.type);
  if (!plugin) {
    recordPull(source.id, { rawCount: 0, keptCount: 0, error: `unknown type ${source.type}` });
    return { id: source.id, error: `unknown type ${source.type}` };
  }
  try {
    const { rawCount, items, sample } = await plugin.poll(source.config);
    const added = upsertItems(source.id, items);
    recordPull(source.id, {
      rawCount,
      keptCount: items.length,
      error: null,
      sample,
    });
    return { id: source.id, label: source.label, rawCount, kept: items.length, added };
  } catch (err) {
    recordPull(source.id, { rawCount: 0, keptCount: 0, error: String(err.message) });
    return { id: source.id, label: source.label, error: String(err.message) };
  }
}

// Poll all enabled sources. Serialized to stay gentle on rate-limited APIs.
export async function pollAll() {
  if (running) return { skipped: true };
  running = true;
  const results = [];
  try {
    for (const source of listSources()) {
      if (!source.enabled) continue;
      results.push(await pollSource(source));
    }
    pruneItems(30);
    lastRun = new Date().toISOString();
  } finally {
    running = false;
  }
  return { at: lastRun, results };
}
