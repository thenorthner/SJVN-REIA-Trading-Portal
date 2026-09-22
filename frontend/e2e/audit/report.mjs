// Turns what the audit recorded (e2e/.data/audit/*.jsonl) into a readable
// report at e2e/.audit-report/REPORT.md, plus results.json for anything that
// wants the raw rows.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readRows } from './results.js';
import { WRITE_CALL } from './clicker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../.audit-report');
fs.mkdirSync(OUT, { recursive: true });

const inventory = readRows('inventory.jsonl');
const roles = readRows('roles.jsonl');
// A SILENT press that, once filled in, saved nothing was only idle (see
// clicker.js); rows written by an older clicker are read the same way.
const buttons = readRows('buttons.jsonl').map((b) => (b.outcome === 'SILENT' && !WRITE_CALL.test(b.detail)
  ? { ...b, outcome: 'OK', detail: b.detail.replace('does nothing while its fields are empty, and shows no message; filled in, it', 'idle with its fields empty; with them filled in, it') }
  : b));

const ORDER = ['BROKEN', 'REFUSED', 'PLACEHOLDER', 'DEAD', 'SILENT', 'SKIPPED', 'OK'];
const count = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const moduleOf = (route) => route.split('/').filter(Boolean)[0] || 'home';

const lines = [];
const out = (s = '') => lines.push(s);

out('# Frontend button audit: results');
out();
out(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. See AUDIT_PLAN.md for what each outcome means.`);
out();

if (inventory.length) {
  const items = inventory.reduce((n, s) => n + (s.items?.length || 0), 0);
  out('## Phase 1: inventory');
  out();
  out(`${inventory.length} screens and ${items} clickable things in their content areas. Items inside dialogs are counted in Phase 3.`);
  const bad = inventory.filter((s) => s.errorScreen || s.restricted || s.loadErrors?.length || s.loadServerErrors?.length);
  if (bad.length) {
    out();
    out('Screens with a problem on load:');
    out();
    out('| Screen | As | Problem |');
    out('|---|---|---|');
    for (const s of bad) {
      const why = [
        s.errorScreen && 'error screen',
        s.restricted && 'Access restricted',
        ...(s.loadErrors || []).map((e) => `uncaught: ${e}`),
        ...(s.loadServerErrors || []).map((c) => `${c.status} ${c.method} ${c.path}`),
      ].filter(Boolean).join('; ');
      out(`| \`${s.route}\` | ${s.role} | ${md(why)} |`);
    }
  }
  const empty = inventory.filter((s) => !s.skipped && !s.items?.length);
  if (empty.length) {
    out();
    out(`Screens with nothing to press (${empty.length}): ${empty.map((s) => `\`${s.route}\``).join(', ')}`);
  }
  out();
}

if (roles.length) {
  out('## Phase 2: every screen for every role');
  out();
  const byRole = {};
  for (const r of roles) (byRole[r.role] ||= []).push(r);
  out('| Role | Menu screens opened | Broken | Soon (not built) | Forbidden screen refused |');
  out('|---|---|---|---|---|');
  for (const [role, rows] of Object.entries(byRole)) {
    const menu = rows.filter((r) => !r.forbiddenCheck);
    const forb = rows.find((r) => r.forbiddenCheck);
    out(`| ${role} | ${menu.length} | ${menu.filter((r) => r.issues.length).length} | ${menu.filter((r) => r.soon).length} | ${forb ? (forb.issues.length ? `no: ${md(forb.issues.join('; '))}` : `yes (\`${forb.href}\`)`) : 'n/a'} |`);
  }
  const broken = roles.filter((r) => r.issues.length);
  if (broken.length) {
    out();
    out('| Role | Screen | Problem |');
    out('|---|---|---|');
    for (const r of broken) out(`| ${r.role} | \`${r.href}\` ${md(r.label)} | ${md(r.issues.join('; '))} |`);
  }
  const refused = roles.filter((r) => r.refused?.length && !r.issues.length);
  if (refused.length) {
    out();
    out('Screens a role opens where part of the page is refused by the API (403). The role sees the screen but some panels stay empty:');
    out();
    out('| Role | Screen | Refused |');
    out('|---|---|---|');
    for (const r of refused) out(`| ${r.role} | \`${r.href}\` | ${md([...new Set(r.refused)].join('; '))} |`);
  }
  out();
}

if (buttons.length) {
  const pressed = buttons.filter((b) => b.key !== '(screen load)');
  const totals = count(pressed, (b) => b.outcome);
  out('## Phase 3: every button');
  out();
  out(`${pressed.length} presses on ${new Set(buttons.map((b) => b.route)).size} screens (level 1: on the screen; level 2: inside what a press opened).`);
  out();
  out('| Outcome | Count |');
  out('|---|---|');
  for (const k of ORDER) if (totals[k]) out(`| ${k} | ${totals[k]} |`);
  out();

  out('### By module');
  out();
  out(`| Module | ${ORDER.join(' | ')} |`);
  out(`|---|${ORDER.map(() => '---').join('|')}|`);
  const byModule = {};
  for (const b of pressed) (byModule[moduleOf(b.route)] ||= []).push(b);
  for (const [mod, rows] of Object.entries(byModule).sort()) {
    const c = count(rows, (b) => b.outcome);
    out(`| ${mod} | ${ORDER.map((k) => c[k] || 0).join(' | ')} |`);
  }
  out();

  for (const k of ['BROKEN', 'REFUSED', 'PLACEHOLDER', 'DEAD', 'SILENT']) {
    const rows = buttons.filter((b) => b.outcome === k);
    if (!rows.length) continue;
    out(`### ${k} (${rows.length})`);
    out();
    out('| Screen | Button | What happened |');
    out('|---|---|---|');
    for (const b of rows) {
      const where = b.parent ? `${md(b.parent)} → ${md(b.key)}` : md(b.key);
      out(`| \`${b.route}\` | ${where} | ${md(b.detail)} |`);
    }
    out();
  }

  const skipped = buttons.filter((b) => b.outcome === 'SKIPPED');
  if (skipped.length) {
    out(`### SKIPPED (${skipped.length}) by reason`);
    out();
    const reasons = count(skipped, (b) => b.detail.replace(/: .*/, '').replace(/"[^"]*"/g, '"…"'));
    out('| Reason | Count |');
    out('|---|---|');
    for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) out(`| ${md(r)} | ${n} |`);
    out();
  }
}

fs.writeFileSync(path.join(OUT, 'REPORT.md'), `${lines.join('\n')}\n`);

// The same results as a filterable page, for going through screen by screen.
const slim = {
  generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  inventory: inventory.map(({ route, role, items, skipped }) => ({ route, role, items: items?.length || 0, skipped })),
  roles: roles.map(({ role, href, label, soon, issues, refused, forbiddenCheck }) => ({ role, href, label, soon, issues, refused, forbiddenCheck })),
  buttons: buttons.map(({ route, role, level, parent, key, kind, outcome, detail }) => ({ route, role, level, parent, key, kind, outcome, detail })),
};
const template = fs.readFileSync(path.join(here, 'report-template.html'), 'utf8');
fs.writeFileSync(
  path.join(OUT, 'button-audit.html'),
  // A function, so a "$&" in some button's label is not read as a pattern.
  template.replace('/*__DATA__*/null', () => JSON.stringify(slim).replace(/</g, '\\u003c')),
);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ inventory, roles, buttons }, null, 2));
console.log(`[audit] report written to ${path.join(OUT, 'REPORT.md')}`);
