// SQLite setup, schema, and query helpers.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,          -- nws | fda_recall | usgs_quake | rss
    label        TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    config       TEXT NOT NULL DEFAULT '{}',  -- JSON blob, plugin-specific
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    dedupe_key   TEXT NOT NULL,
    severity     TEXT NOT NULL,          -- critical | warning | info
    category     TEXT NOT NULL,          -- flee | recall | quake | personal
    title        TEXT NOT NULL,
    body         TEXT,
    link         TEXT,
    starts_at    TEXT,
    expires_at   TEXT,
    first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen    TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source_id, dedupe_key)
  );

  CREATE INDEX IF NOT EXISTS idx_items_active
    ON items (dismissed, severity, first_seen);

  -- Rolling record of the last raw pull per source, for the admin debug view.
  CREATE TABLE IF NOT EXISTS pull_log (
    source_id    INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    pulled_at    TEXT NOT NULL DEFAULT (datetime('now')),
    raw_count    INTEGER NOT NULL DEFAULT 0,
    kept_count   INTEGER NOT NULL DEFAULT 0,
    error        TEXT,
    sample       TEXT                    -- JSON: a few dropped titles, for tuning
  );
`);

// ---- source queries ---------------------------------------------------------

export function listSources() {
  return db
    .prepare('SELECT * FROM sources ORDER BY created_at')
    .all()
    .map((r) => ({ ...r, enabled: !!r.enabled, config: JSON.parse(r.config) }));
}

export function getSource(id) {
  const r = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, enabled: !!r.enabled, config: JSON.parse(r.config) };
}

export function createSource({ type, label, config: cfg = {}, enabled = true }) {
  const info = db
    .prepare(
      'INSERT INTO sources (type, label, enabled, config) VALUES (?, ?, ?, ?)'
    )
    .run(type, label, enabled ? 1 : 0, JSON.stringify(cfg));
  return getSource(info.lastInsertRowid);
}

export function updateSource(id, patch) {
  const cur = getSource(id);
  if (!cur) return null;
  const next = {
    label: patch.label ?? cur.label,
    enabled: patch.enabled ?? cur.enabled,
    config: patch.config ?? cur.config,
  };
  db.prepare(
    'UPDATE sources SET label = ?, enabled = ?, config = ? WHERE id = ?'
  ).run(next.label, next.enabled ? 1 : 0, JSON.stringify(next.config), id);
  return getSource(id);
}

export function deleteSource(id) {
  return db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
}

// ---- item queries -----------------------------------------------------------

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

// Upsert a batch of items for one source. Returns count of new (first-seen) rows.
export function upsertItems(sourceId, items) {
  const insert = db.prepare(`
    INSERT INTO items
      (source_id, dedupe_key, severity, category, title, body, link, starts_at, expires_at)
    VALUES
      (@source_id, @dedupe_key, @severity, @category, @title, @body, @link, @starts_at, @expires_at)
    ON CONFLICT(source_id, dedupe_key) DO UPDATE SET
      severity   = excluded.severity,
      title      = excluded.title,
      body       = excluded.body,
      link       = excluded.link,
      starts_at  = excluded.starts_at,
      expires_at = excluded.expires_at,
      last_seen  = datetime('now')
  `);
  const countExisting = db.prepare(
    'SELECT 1 FROM items WHERE source_id = ? AND dedupe_key = ?'
  );
  let added = 0;
  const tx = db.transaction((rows) => {
    for (const it of rows) {
      const existed = countExisting.get(sourceId, it.dedupe_key);
      if (!existed) added += 1;
      insert.run({
        source_id: sourceId,
        dedupe_key: it.dedupe_key,
        severity: it.severity,
        category: it.category,
        title: it.title,
        body: it.body ?? null,
        link: it.link ?? null,
        starts_at: it.starts_at ?? null,
        expires_at: it.expires_at ?? null,
      });
    }
  });
  tx(items);
  return added;
}

// Active items = not dismissed and (no expiry or not yet expired).
export function activeItems() {
  const rows = db
    .prepare(
      `SELECT items.*, sources.type AS source_type, sources.label AS source_label
       FROM items JOIN sources ON sources.id = items.source_id
       WHERE items.dismissed = 0
         AND sources.enabled = 1
         AND (items.expires_at IS NULL OR items.expires_at > datetime('now'))
       ORDER BY items.first_seen DESC`
    )
    .all();
  rows.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return b.first_seen.localeCompare(a.first_seen);
  });
  return rows;
}

export function dismissItem(id) {
  return db.prepare('UPDATE items SET dismissed = 1 WHERE id = ?').run(id)
    .changes > 0;
}

// Drop dismissed/expired rows older than a cutoff to keep the table small.
export function pruneItems(days = 30) {
  return db
    .prepare(
      `DELETE FROM items
       WHERE (expires_at IS NOT NULL AND expires_at < datetime('now', ?))
          OR (dismissed = 1 AND last_seen < datetime('now', ?))`
    )
    .run(`-${days} days`, `-${days} days`).changes;
}

// ---- pull log ---------------------------------------------------------------

export function recordPull(sourceId, { rawCount, keptCount, error, sample }) {
  db.prepare(
    `INSERT INTO pull_log (source_id, pulled_at, raw_count, kept_count, error, sample)
     VALUES (?, datetime('now'), ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       pulled_at = excluded.pulled_at,
       raw_count = excluded.raw_count,
       kept_count = excluded.kept_count,
       error = excluded.error,
       sample = excluded.sample`
  ).run(
    sourceId,
    rawCount ?? 0,
    keptCount ?? 0,
    error ?? null,
    sample ? JSON.stringify(sample) : null
  );
}

export function getPullLog() {
  return db
    .prepare('SELECT * FROM pull_log')
    .all()
    .map((r) => ({ ...r, sample: r.sample ? JSON.parse(r.sample) : null }));
}
