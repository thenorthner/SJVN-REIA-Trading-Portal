/**
 * Point-in-time backups of the SQLite database.
 *
 * The whole platform — contracts, bills, settlements, the audit chain — is one
 * file. A bad migration, a full disk or a corrupted page loses all of it at
 * once, and nothing else in the deployment keeps a second copy. So the server
 * takes its own snapshot on boot and once a day.
 *
 * `Database#backup` is SQLite's online backup API: it copies the file page by
 * page while the server keeps reading and writing, and the copy is a consistent
 * snapshot rather than a `cp` of a file mid-transaction (which is how a backup
 * that looks fine restores as "database disk image is malformed").
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { db } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where snapshots go. Overridable so the tests do not write into the repo. */
export function backupDir() {
  return process.env.SJVN_BACKUP_DIR
    || path.resolve(__dirname, '../../backups');
}

/**
 * Whether snapshots land on the same disk as the live database.
 *
 * A copy on the same disk covers a bad migration or a corrupted page, which is
 * most of what goes wrong — but not the disk failing or the server being lost,
 * which take the copies with them. SJVN_BACKUP_DIR pointed at a second disk or
 * a mounted share covers those. Null when it cannot tell.
 */
export function backupSharesDiskWithDatabase(dir = backupDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.statSync(dir).dev === fs.statSync(db.name).dev;
  } catch {
    return null;
  }
}

/** How many snapshots to keep. Two weeks of dailies at ~7 MB each. */
const DEFAULT_KEEP = Number(process.env.SJVN_BACKUP_KEEP) || 14;

const NAME_RE = /^platform-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/;

let running = false;

/**
 * Drop the -wal/-shm files SQLite creates beside a database when it is opened.
 *
 * The snapshot itself is complete the moment `backup` returns; these appear
 * only because the integrity check opens the copy. Left behind they accumulate
 * one pair per snapshot for ever, and a restore that copies the directory picks
 * up a stale WAL alongside the database it does not belong to.
 */
function removeSidecars(file) {
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(file + suffix); } catch { /* absent, which is the normal case */ }
  }
}

function stamp(d = new Date()) {
  return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Delete all but the newest `keep` snapshots.
 *
 * Only files this module wrote are considered — anything else a person has put
 * in the directory is left alone, so an operator's own copy of a database is
 * never the thing that retention deletes.
 */
export function pruneBackups(dir = backupDir(), keep = DEFAULT_KEEP) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n));
  } catch {
    return { removed: 0, kept: 0 };
  }
  names.sort();                                  // the stamp sorts chronologically
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  let removed = 0;
  for (const name of doomed) {
    try { fs.unlinkSync(path.join(dir, name)); removed += 1; } catch { /* next run retries */ }
    removeSidecars(path.join(dir, name));
  }
  return { removed, kept: names.length - removed };
}

/**
 * Take one snapshot, verify it, and prune old ones.
 *
 * The verification matters as much as the copy: a backup nobody has opened is
 * a guess. Reading the snapshot back with `quick_check` is what makes the
 * difference between having backups and having restorable backups. A snapshot
 * that fails the check is deleted rather than left to be mistaken for a good one.
 */
export async function backupDatabase({ dir = backupDir(), keep = DEFAULT_KEEP } = {}) {
  if (running) return { skipped: 'a backup is already running' };
  running = true;
  const dest = path.join(dir, `platform-${stamp()}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    await db.backup(dest);

    let check;
    const copy = new Database(dest, { readonly: true });
    try {
      check = copy.pragma('quick_check', { simple: true });
    } finally {
      copy.close();
      removeSidecars(dest);
    }
    if (check !== 'ok') {
      fs.unlinkSync(dest);
      throw new Error(`the snapshot failed its integrity check (${check}) and was discarded`);
    }

    const { removed } = pruneBackups(dir, keep);
    return {
      file: dest, bytes: fs.statSync(dest).size, pruned: removed,
      same_disk: backupSharesDiskWithDatabase(dir),
    };
  } finally {
    running = false;
  }
}
