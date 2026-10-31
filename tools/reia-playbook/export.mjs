// Writes the two copies of the playbook from index.html (the Artifact source):
//   REIA-Playbook-offline.html            one file to open from disk or send on
//   frontend/public/reia-playbook/        the copy the portal serves at /reia-playbook/
// The portal's Content-Security-Policy runs script from this origin only, so
// the portal copy carries its script as playbook.js rather than inline.
// Run after every edit to index.html:  node tools/reia-playbook/export.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, '../../frontend/public/reia-playbook');

const HEAD = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
const TAIL = '\n</html>\n';

const src = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
fs.writeFileSync(path.join(HERE, 'REIA-Playbook-offline.html'), HEAD + src + TAIL);

const scripts = [...src.matchAll(/<script>\n?([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error(`expected one inline script in index.html, found ${scripts.length}`);
const [block, code] = scripts[0];
const page = src
  .replace(block, '<script src="/reia-playbook/playbook.js"></script>')
  .replace('<title>', '<link rel="icon" href="/icons/favicon-32.png">\n<title>');

fs.mkdirSync(PORTAL, { recursive: true });
fs.writeFileSync(path.join(PORTAL, 'index.html'), HEAD + page + TAIL);
fs.writeFileSync(path.join(PORTAL, 'playbook.js'), code);
console.log(`Wrote REIA-Playbook-offline.html and ${path.relative(process.cwd(), PORTAL)}/{index.html,playbook.js}`);
