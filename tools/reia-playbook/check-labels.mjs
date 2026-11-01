// Checks the playbook against the code it quotes. Every button the playbook
// tells someone to press, every refusal it quotes and every status it names was
// copied from the code; when a screen changes, the copy goes stale silently.
// This finds each one in frontend/src or backend/src and lists any it cannot.
//
//   node tools/reia-playbook/check-labels.mjs          list what is missing, exit 1 if any
//   node tools/reia-playbook/check-labels.mjs --all    also list what was found, and where
//                                                      (ok~ by its fixed parts, ok$ by a template)
//
// A message the code fills in at run time is found two ways: by its fixed parts
// around the playbook's "…" and examples, or by the code's own template, its
// ${…} parts read as "anything", matching the playbook's wording.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SOURCES = ['frontend/src', 'backend/src'];

// ── The playbook's data, run as it is in the page ──────────────────────────────

export function playbookData(src = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')) {
  const from = src.indexOf('/* ───────────────────────── data: roles');
  const to = src.indexOf('/* ───────────────────────── helpers');
  if (from === -1 || to === -1) throw new Error('index.html: the data section markers have moved');
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(from, to)}\nreturn { MISSIONS, QUESTS, MX, LIFE, CYCLE };`)();
}

// ── What the playbook quotes ───────────────────────────────────────────────────

const ticks = (s) => [...String(s ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const statuses = (s) => [...String(s ?? '').matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]);

export function quotes(data) {
  const out = [];
  const add = (kind, text, at) => { if (text && String(text).trim()) out.push({ kind, text: String(text).trim(), at }); };
  const prose = (s, at) => { ticks(s).forEach((t) => add('button', t, at)); statuses(s).forEach((t) => add('status', t, at)); };
  const books = [
    ...data.MISSIONS.map((m) => ({ m, tag: `Mission ${m.n}` })),
    ...data.QUESTS.map((m, i) => ({ m, tag: `Side quest ${i + 1}` })),
  ];
  for (const { m, tag } of books) {
    [m.goal, m.start, m.end, ...(m.also || [])].forEach((s) => prose(s, `${tag} (${m.short})`));
    m.steps.forEach((s, i) => {
      const at = `${tag}.${i + 1} ${s.t}`;
      (s.press || []).forEach((p) => add('button', p, at));
      (s.refuse || []).forEach((r) => add('refusal', r, at));
      if (s.res?.t) add('status', s.res.t, at);
      if (s.res?.f) add('status', s.res.f, at);
      [s.t, s.where, s.block, ...(s.fill || []), ...(s.rules || [])].forEach((x) => prose(x, at));
    });
  }
  (data.CYCLE || []).forEach((c, i) => {
    const at = `Full cycle ${i + 1} (${c.t})`;
    [c.t, c.ends, ...c.path.flatMap(([, t, how]) => [t, how])].forEach((s) => prose(s, at));
    c.edges.forEach((e) => { prose(e.if, `${at}: ${e.if}`); prose(e.then, `${at}: ${e.if}`); add('refusal', e.refuse, `${at}: ${e.if}`); });
  });
  data.MX.forEach((r) => { prose(r.a, `Powers: ${r.a}`); prose(r.note, `Powers: ${r.a}`); });
  data.LIFE.forEach((l) => l.tracks.forEach((t) => [...t.main, ...(t.side || [])].forEach((x) => {
    if (x.s) add('status', x.s, `Lifecycle: ${l.name}`);
    prose(x.act, `Lifecycle: ${l.name}`);
  })));
  return out;
}

// ── The code, flattened so a label split across JSX lines still matches ──────

const ENTITIES = { '&apos;': "'", '&#39;': "'", '&rsquo;': "'", '&lsquo;': "'", '&quot;': '"', '&ldquo;': '"', '&rdquo;': '"', '&amp;': '&', '&nbsp;': ' ', '&rarr;': '→', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–' };
const flat = (s) => String(s)
  .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
  .replace(/\\u2019|\\u2018/g, "'").replace(/\\u201c|\\u201d/g, '"').replace(/\\u2026/g, '…').replace(/\\u2014/g, '—')
  .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/\\(['"])/g, '$1')
  // A string the code splits over lines: 'so it cannot be ' + 'billed.'
  .replace(/(['"])\s*\+\s*\1/g, '')
  .replace(/\{\s*['"]\s['"]\s*\}/g, ' ')
  .replace(/\s+/g, ' ');
export const norm = (s) => flat(s).toLowerCase();

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    // A test can hold on to a label the screen has dropped, so tests do not count.
    else if (/\.(jsx?|mjs|cjs|json)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) yield p;
  }
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The code's template strings with real words in them, as patterns: each ${…} matches anything. */
function templates(text) {
  const out = [];
  for (const [, body] of text.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
    const fixed = body.split(/\$\{[^}]*\}/);
    if (fixed.join('').replace(/[^a-z]/g, '').length < 15) continue;
    out.push(new RegExp(fixed.map(escRe).join('.+?')));
  }
  return out;
}

export function corpus(root = ROOT) {
  const out = [];
  for (const dir of SOURCES) for (const f of files(path.join(root, dir))) {
    const raw = flat(fs.readFileSync(f, 'utf8'));
    const text = raw.toLowerCase();
    out.push({ file: path.relative(root, f), raw, text, templates: templates(text) });
  }
  return out;
}

/**
 * The fixed parts of a message the code fills in at run time. The playbook
 * writes the filled-in parts as "…", "(n)", or an example: a bill number, a
 * date, an amount, a percentage. Each of those is anything with a digit in it.
 */
export function fragments(text) {
  return norm(text)
    .split(/\S*(?:…|\.\.\.)\S*|\(n\)|\S*\d\S*/)
    .map((f) => f.trim().replace(/^[\s,.;:()'"-]+|[\s,.;:()'"-]+$/g, ''))
    .filter((f) => f.length >= 5);
}

/**
 * Where the code has this text: the files, and how it was found (whole, by
 * its fixed parts, or by a template of the code's). No files: nowhere.
 */
export function find(text, code, kind = 'button') {
  const n = norm(text);
  const files = (pick) => code.filter(pick).map((c) => c.file);
  // A status is a code word, in capitals and in quotes: SENT is not in "present".
  if (kind === 'status') {
    const re = new RegExp(`['"\`]${escRe(text)}['"\`]`);
    return { files: files((c) => re.test(c.raw)), how: 'whole' };
  }
  // A short label stands alone, as a string or an element's text: "Save" is not in
  // "Saved". It may carry an icon before it, or a count after: "Verify selected (3)".
  const whole = kind === 'button' && n.length < 25
    ? ((re) => (c) => re.test(c.text))(new RegExp(`(?:^|[>'"\`])\\s?(?:[^\\w\\s<>'"\`{}]{1,2}\\s)?${escRe(n)}\\s?(?:[<'"\`(]|$)`))
    : (c) => c.text.includes(n);
  let hit = files(whole);
  if (hit.length) return { files: hit, how: 'whole' };
  const parts = fragments(text);
  if (parts.length && parts.join(' ') !== n) {
    // Every fixed part, in one file and in the playbook's order.
    const inOrder = (t) => { let at = 0; for (const p of parts) { at = t.indexOf(p, at); if (at === -1) return false; at += p.length; } return true; };
    hit = files((c) => inOrder(c.text));
    if (hit.length) return { files: hit, how: 'parts' };
  }
  return { files: files((c) => c.templates.some((re) => re.test(n))), how: 'template' };
}

// ── Run ────────────────────────────────────────────────────────────────────────

/**
 * Checks the playbook (index.html, or the source given) and prints what it
 * found. Returns how many labels the code no longer has.
 */
export function check({ all = false, src, log = console.log } = {}) {
  const code = corpus();
  const seen = new Map();
  for (const q of quotes(playbookData(src))) {
    const k = `${q.kind}\u0000${q.text}`;
    if (!seen.has(k)) seen.set(k, { ...q, at: [q.at] });
    else seen.get(k).at.push(q.at);
  }
  const missing = [];
  for (const q of seen.values()) {
    const { files: where, how } = find(q.text, code, q.kind);
    if (!where.length) missing.push(q);
    else if (all) log(`ok${{ whole: ' ', parts: '~', template: '$' }[how]} ${q.kind.padEnd(7)} ${q.text}  →  ${where.slice(0, 2).join(', ')}${where.length > 2 ? ` +${where.length - 2}` : ''}`);
  }
  const kinds = ['button', 'refusal', 'status'];
  log(`Checked ${seen.size} quoted labels (${kinds.map((k) => `${[...seen.values()].filter((q) => q.kind === k).length} ${k === 'status' ? 'statuses' : `${k}s`}`).join(', ')}) against ${SOURCES.join(' and ')}.`);
  if (!missing.length) { log('All found.'); return 0; }
  log(`\n${missing.length} not found in the code:\n`);
  for (const q of missing) log(`  ${q.kind.padEnd(7)} “${q.text}”\n          ${q.at.slice(0, 3).join('\n          ')}${q.at.length > 3 ? `\n          and ${q.at.length - 3} more` : ''}`);
  return missing.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(check({ all: process.argv.includes('--all') }) ? 1 : 0);
}
