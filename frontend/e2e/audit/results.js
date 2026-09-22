// Where the audit writes what it saw. Lives under e2e/.data, which prepare.mjs
// clears at the start of every run, so a report never mixes two runs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AUDIT_DIR = path.join(here, '../.data/audit');

export function append(file, row) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.appendFileSync(path.join(AUDIT_DIR, file), `${JSON.stringify(row)}\n`);
}

export function readRows(file) {
  const p = path.join(AUDIT_DIR, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
