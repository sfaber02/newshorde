import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import { config } from './config.js';
import {
  activeItems,
  readItems,
  dismissItem,
  dismissAllActive,
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
// If ADMIN_TOKEN is set, admin APIs require it (header or ?token=). If unset, we
// assume the admin path is protected upstream (Cloudflare Access) and allow.
function requireAdmin(req, res, next) {
  if (!config.adminToken) return next();
  const provided =
    req.get('X-Admin-Token') || req.query.token || (req.body && req.body.token);
  if (provided === config.adminToken) return next();
  return res.status(401).json({ error: 'admin token required' });
}

// ---- public feed API --------------------------------------------------------
app.get('/api/items', (req, res) => {
  const filter = req.query.filter === 'read' ? 'read' : 'unread';
  const items = filter === 'read' ? readItems() : activeItems();
  res.json({ items, filter, status: getStatus() });
});

app.post('/api/items/:id/dismiss', requireAdmin, (req, res) => {
  const ok = dismissItem(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

// Mark all as read. Personal single-user action, so not admin-gated — works from
// the public feed page.
app.post('/api/items/dismiss-all', (req, res) => {
  res.json({ dismissed: dismissAllActive() });
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
app.use(express.static(publicDir));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

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
