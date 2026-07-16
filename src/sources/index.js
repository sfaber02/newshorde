// Plugin registry. Adding a new source type = import it and add it here.
import * as nws from './nws.js';
import * as fdaRecall from './fdaRecall.js';
import * as usgsQuake from './usgsQuake.js';
import * as rss from './rss.js';
import * as bandsintown from './bandsintown.js';

export const plugins = {
  [nws.meta.type]: nws,
  [fdaRecall.meta.type]: fdaRecall,
  [usgsQuake.meta.type]: usgsQuake,
  [rss.meta.type]: rss,
  [bandsintown.meta.type]: bandsintown,
};

export function getPlugin(type) {
  return plugins[type] || null;
}

// Metadata for the admin UI (what source types exist + their config fields).
export function pluginCatalog() {
  return Object.values(plugins).map((p) => p.meta);
}
