// Checks the side quests' data the way the page reads it. Run after every edit:
//   node tools/reia-playbook/test-quests.mjs        exit 1 on any failure
// What each check guards is in TEST-PLAN.md (Layer 1).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A quest's number is its progress key and its "Side quest N" name, so the
// order is pinned: add new quests at the end of QUESTS and here, never between.
export const PINNED = [
  'Late payment surcharge', 'Debit & credit notes', 'Arrear & supplementary', 'Advances', 'Release planner',
  'Ledgers & TDS', 'Month-Close Board', 'Invoice Verification', 'Finance posting (SAP)', 'Deviation (DSM)',
  'Contract changes', 'Compliance & holds', 'CUF true-up', 'Invoke security', 'Release security',
  'Power diversion', 'Energy banking', 'Additional charge', 'Break-glass', 'Project access',
  'Audit trail', 'CERC Form-IV', 'Reports', 'Role Powers', 'Holidays & due dates', 'Alerts & messages',
];

// Each "Side quest N" / "Mission N" the text cites, by the words around it, and
// the quest or mission it must name. A citation not listed here fails, so a new
// one is checked once by hand and added.
const CITES = [
  [/surcharge bills come from the Month-Close Board \(Side quest (\d+)\)/, 'q', 'Late payment surcharge'],
  [/deviation settlement is billed from its own screen \(Side quest (\d+)\)/, 'q', 'Deviation (DSM)'],
  [/as “Diversion surplus” \(Side quest (\d+)\)/, 'q', 'Power diversion'],
  [/The whole surcharge run is Side quest (\d+)/, 'q', 'Late payment surcharge'],
  [/Finance then books the month \(Side quest (\d+)\)/, 'q', 'Finance posting (SAP)'],
  [/Holds: Side quest (\d+)/, 'q', 'Compliance & holds'],
  [/held as the buyer’s advance \(Side quest (\d+)\)/, 'q', 'Advances'],
  [/use an additional charge instead \(Side quest (\d+)\)/, 'q', 'Additional charge'],
  [/can also be limited to some projects \(Side quest (\d+)\)/, 'q', 'Additional charge'],
  [/from Counterparty Ledgers & TDS \(Side quest (\d+)\)/, 'q', 'Ledgers & TDS'],
  [/Verification Checklist \(Mission (\d+)\)/, 'm', 'Bills & approval'],
  [/approval under Billing & Invoicing \(Mission (\d+)\)/, 'm', 'Bills & approval'],
  [/Credit notes from disputes come the same way \(Mission (\d+)\)/, 'm', 'Disputes'],
  [/The hourly job usually gets there first \(Mission (\d+)\)/, 'm', 'Reconciliation'],
  [/the early-payment rebate, is Mission (\d+)/, 'm', 'Pay the seller'],
  [/and the waterfall: Mission (\d+)/, 'm', 'Payment security'],
];

// Words the REIA beta must never show (other desks, markets, credentials).
const FORBIDDEN = /\btrad(e|es|ing|er)\b|hydro|thermal|exchange|\bIEX\b|PXIL|HPX|\bPT desk\b|Commercial (Dept|desk)|NJHPS|Nathpa|Rampur|@sjvn\.in|Pass@|\bdemo123\b/i;

// Role words in a step's rules that say someone else can do the step too.
const ROLE_WORDS = [
  [/\bFinance\b/, 'F'], [/\bManagement\b/, 'G'], [/\bHOD\b/, 'H'], [/\bchecker\b/i, 'C'], [/\bmaker\b/i, 'M'],
  [/\bbuyer\b/i, 'B'], [/\bseller\b/i, 'S'], [/\bSJVN Admin\b|\badministrator\b/, 'A'],
];

export function load(src = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')) {
  const cut = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`index.html: cannot find ${a}`); return src.slice(i, j); };
  const data = cut('/* ───────────────────────── data: roles', '/* ───────────────────────── helpers');
  const kind = cut('const KIND = {};', 'const st =');
  const qx = cut('const QX = ', 'const POOL');
  // eslint-disable-next-line no-new-func
  return new Function(`${data}\n${kind}\n${qx}\nreturn { R, ROLE_ORDER, MISSIONS, MX, LIFE, QZONES, QUESTS, KIND, QX };`)();
}

export function run({ src, log = console.log } = {}) {
  const D = load(src);
  const { R, MISSIONS, QZONES, QUESTS, KIND, QX } = D;
  const fails = [];
  const fail = (at, msg) => fails.push(`${at}: ${msg}`);
  const zones = new Set(QZONES.map(([z]) => z));
  // Shown plain on purpose: a version an amendment retired, a document KYC does not ask for.
  ['AMENDED', 'NOT_APPLICABLE'].forEach((x) => { KIND[x] = KIND[x] || 'plain'; });
  const roles = new Set(Object.keys(R));
  const str = (v) => typeof v === 'string' && v.trim().length > 0;

  // 1.1 order
  QUESTS.forEach((q, i) => { if (q.short !== PINNED[i]) fail(`q${i + 1}`, `is “${q.short}”, pinned as “${PINNED[i] ?? '(nothing)'}” — quests are added at the end only`); });
  if (QUESTS.length < PINNED.length) fail('QUESTS', `has ${QUESTS.length}, ${PINNED.length} pinned`);
  if (QUESTS.length > PINNED.length) fail('QUESTS', `has ${QUESTS.length}; pin the new quest at the end of PINNED`);

  const prose = [];
  QUESTS.forEach((q, qi) => {
    const at = `q${qi + 1} ${q.short}`;
    // 1.2 fields
    if (!zones.has(q.zone)) fail(at, `zone “${q.zone}” is not in QZONES`);
    ['short', 'name', 'screen', 'goal', 'start', 'end'].forEach((k) => { if (!str(q[k])) fail(at, `missing ${k}`); });
    if (!Array.isArray(q.steps) || q.steps.length < 2) fail(at, 'needs at least two steps');
    if (!Array.isArray(q.also) || !q.also.length) fail(at, 'missing also');
    prose.push(...[q.goal, q.start, q.end, ...(q.also || [])].map((t) => [at, t]));
    q.steps.forEach((s, i) => {
      const sa = `${at} · step ${i + 1} “${s.t}”`;
      // 1.3 roles
      if (!roles.has(s.who)) fail(sa, `who “${s.who}” is not a role`);
      if (s.alt) {
        if (!Array.isArray(s.alt) || !s.alt.length) fail(sa, 'alt must be a non-empty list');
        else {
          s.alt.forEach((k) => { if (!roles.has(k) || k === 'X') fail(sa, `alt “${k}” is not a human role`); });
          if (s.alt.includes(s.who)) fail(sa, 'alt repeats who');
          if (new Set(s.alt).size !== s.alt.length) fail(sa, 'alt has repeats');
        }
      }
      if (!str(s.t)) fail(sa, 'missing title');
      if (s.who !== 'X' && !str(s.where)) fail(sa, 'missing where');
      ['press', 'fill', 'rules', 'refuse'].forEach((k) => {
        if (s[k] !== undefined && (!Array.isArray(s[k]) || !s[k].length || !s[k].every(str))) fail(sa, `${k} must be a list of words`);
      });
      ['opt', 'noquiz'].forEach((k) => { if (s[k] !== undefined && s[k] !== true) fail(sa, `${k} must be true or absent`); });
      // 1.4 result
      if (s.res) {
        if (!str(s.res.o)) fail(sa, 'result has no object');
        if (!s.res.t === !s.res.text) fail(sa, 'result needs exactly one of t / text');
        if (s.res.f && !s.res.t) fail(sa, 'result has f without t');
        [s.res.f, s.res.t].filter(Boolean).forEach((x) => { if (!KIND[x]) fail(sa, `status ${x} has no colour in KIND`); });
      }
      // 1.6 block never blocks the actor
      if (s.block) {
        const head = s.block.split(':')[0];
        const blocked = ROLE_WORDS.filter(([re]) => re.test(head)).map(([, k]) => k);
        [s.who, ...(s.alt || [])].forEach((k) => { if (blocked.includes(k)) fail(sa, `blocks ${R[k].short}, who does this step`); });
      }
      prose.push(...[s.t, s.where, s.block, ...(s.fill || []), ...(s.rules || []), ...(s.refuse || [])].filter(Boolean).map((t) => [sa, t]));
      // 1.9 quiz fairness
      const qx = QX[`${q.id ?? 'q' + (qi + 1)}:${i}`];
      if (s.who !== 'X' && !s.noquiz && qx !== 'skip') {
        const not = new Set([s.who, ...(s.alt || []), ...(qx || []), ...(s.who === 'H' ? ['G'] : []), 'G']);
        // "Finance can …", "The maker or Finance can …", "The buyer asks the same way."
        (s.rules || []).forEach((r) => {
          ROLE_WORDS.forEach(([re, k]) => {
            const says = new RegExp(`${re.source}(?:\\s+(?:or|and)\\s+[A-Z]?\\w+)?\\s+(?:can\\b(?!not)|\\w+ the same way|\\w+ too\\b|\\w+ as well\\b)`, re.flags);
            if (says.test(r) && !not.has(k)) fail(sa, `quiz may offer ${R[k].short} as wrong, but the rule says “${r}”`);
          });
        });
      }
    });
  });

  // 1.9 one question, one answer: the quiz asks "Whose move" by a step's title,
  // so a title that two roles own, here or in a mission, cannot be answered.
  const owners = new Map();
  const ask = (s, key, where) => {
    if (s.who === 'X' || s.noquiz || QX[key] === 'skip') return;
    const o = owners.get(s.t) || new Map();
    o.set(s.who, [...(o.get(s.who) || []), where]); owners.set(s.t, o);
  };
  MISSIONS.forEach((m) => m.steps.forEach((s, i) => ask(s, `${m.n}:${i}`, `Mission ${m.n}.${i + 1}`)));
  QUESTS.forEach((q, qi) => q.steps.forEach((s, i) => ask(s, `q${qi + 1}:${i}`, `Q${qi + 1}.${i + 1}`)));
  owners.forEach((o, t) => { if (o.size > 1) fail('quiz', `“${t}” is asked with ${o.size} answers: ${[...o].map(([k, w]) => `${R[k].short} (${w.join(', ')})`).join('; ')}`); });

  // 1.5 every status the page colours, in missions and lifecycles too
  MISSIONS.forEach((m) => m.steps.forEach((s, i) => [s.res?.f, s.res?.t].filter(Boolean).forEach((x) => { if (!KIND[x]) fail(`Mission ${m.n}.${i + 1}`, `status ${x} has no colour in KIND`); })));
  D.LIFE.forEach((l) => l.tracks.forEach((tr) => [...tr.main.map((n) => n.s), ...(tr.br || []).flatMap((b) => [b.f, b.t])]
    .filter((x) => /^[A-Z_]+$/.test(x)).forEach((x) => { if (!KIND[x]) fail(`Lifecycle ${l.name}`, `status ${x} has no colour in KIND`); })));

  // 1.5 tokens, 1.7 citations, 1.8 wording
  const books = { q: QUESTS, m: MISSIONS };
  const allProse = [...prose, ...MISSIONS.flatMap((m) => [m.goal, ...(m.also || []), ...m.steps.flatMap((s) => [...(s.rules || []), ...(s.fill || [])])].filter(Boolean).map((t) => [`Mission ${m.n}`, t]))];
  allProse.forEach(([at, t]) => {
    if (((t.match(/`/g) || []).length) % 2) fail(at, `odd backtick in “${t}”`);
    [...t.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].forEach(([, x]) => { if (!KIND[x]) fail(at, `{${x}} has no colour in KIND`); });
    if (FORBIDDEN.test(t)) fail(at, `other-desk or credential word in “${t}”`);
    [...t.matchAll(/(Side quest|Mission) (\d+)/g)].forEach(([whole]) => {
      const rule = CITES.find(([re]) => re.test(t) && t.match(re)[1] && whole.endsWith(' ' + t.match(re)[1]));
      if (!rule) { fail(at, `“${whole}” is not in CITES: check it by hand and add it`); return; }
      const [re, k, want] = rule; const n = Number(t.match(re)[1]); const got = books[k][n - 1];
      if (!got || got.short !== want) fail(at, `“${whole}” names ${got ? `“${got.short}”` : 'nothing'}, the text means “${want}”`);
    });
  });
  QUESTS.forEach((q, qi) => [q.name, q.short, q.screen].forEach((t) => { if (FORBIDDEN.test(t)) fail(`q${qi + 1}`, `other-desk word in “${t}”`); }));

  const steps = QUESTS.reduce((a, q) => a + q.steps.length, 0);
  log(`Checked ${QUESTS.length} side quests, ${steps} steps.`);
  if (!fails.length) { log('All passed.'); return 0; }
  log(`\n${fails.length} failed:\n`);
  fails.forEach((f) => log('  ' + f));
  return fails.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run() ? 1 : 0);
}
