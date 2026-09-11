/**
 * Small key/value store for the platform's notes to itself — which one-time
 * migrations have already run, and similar state.
 *
 * Deliberately separate from master_params: those are business settings people
 * edit from the Masters screens, and a migration flag sitting among them would
 * be both confusing and editable.
 */
import { db } from './index.js';

export function getMeta(key, fallback = null) {
  try {
    const row = db.prepare('SELECT value FROM platform_meta WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export function setMeta(key, value) {
  db.prepare(`
    INSERT INTO platform_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value == null ? null : String(value));
}
