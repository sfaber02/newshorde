// Minimal env loading: read a .env file if present (no external dependency),
// then expose typed config values with sensible defaults.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load .env into process.env without clobbering already-set vars.
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || './data');

export const config = {
  rootDir,
  dataDir,
  dbPath: path.join(dataDir, 'newshorde.db'),
  port: Number(process.env.PORT || 8787),
  pollIntervalMin: Number(process.env.POLL_INTERVAL_MIN || 10),
  nwsContact: process.env.NWS_CONTACT || 'newshorde (self-hosted)',
  // Admin auth. Set ADMIN_PASSWORD for a browser password prompt (HTTP Basic).
  // ADMIN_TOKEN is an equivalent value accepted via header/query for CLI/scripts;
  // it mirrors ADMIN_PASSWORD by default so one secret covers both.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminToken: process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD || '',
};
