// Builds the summary deck of the functional tree from the same data the PDF is
// printed from, so the two cannot drift apart.
//
//   node tools/functional-tree/build-deck.mjs

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pptxModule from 'pptxgenjs';

import { verticals, totals, statusOf, DOC_DATE } from './model.mjs';
import { systems } from './data/appendix.mjs';

const PptxGenJS = pptxModule.default ?? pptxModule;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'docs', 'SJVN_Platform_Functional_Tree_Summary_2026-10-01.pptx');
const PDF = path.join(ROOT, 'docs', 'SJVN_Platform_Functional_Tree_2026-10-01.pdf');

/* ---------------------------------------------------------------- style */

const INK = '17252A';
const MUTED = '5B6B6F';
const RULE = 'D5DDDB';
const MIST = 'F2F5F4';
const WHITE = 'FFFFFF';
const ACC = { reia: '1F6F5C', hydro: '1D4E89', trading: '8A4B14' };
const TINT = { reia: 'E6F1EE', hydro: 'E6EDF6', trading: 'F5ECE3' };
const STATUS = { live: '2C6E49', partial: 'B07D12', pending: '9B2C2C' };
const HEAD = 'Cambria';
const BODY = 'Calibri';
const W = 13.33;
const M = 0.6;

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'SJVN platform — functional tree (summary)';
pres.author = 'SJVN';

const text = (slide, value, o) => slide.addText(value, { isTextBox: true, margin: 0, fontFace: BODY, color: INK, valign: 'top', ...o });
const card = (slide, x, y, w, h, fill = MIST, line = RULE) =>
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.07, fill: { color: fill }, line: { color: line, width: 0.75 } });
const chip = (slide, label, x, y, w, color, size = 12) => {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.36, rectRadius: 0.08, fill: { color }, line: { color, width: 0.5 } });
  text(slide, label, { x, y, w, h: 0.36, align: 'center', valign: 'middle', bold: true, color: WHITE, fontSize: size });
};
const line = (slide, x, y, w, h, color = INK, width = 1.25) => slide.addShape(pres.shapes.LINE, { x, y, w, h, line: { color, width } });

function frame(kicker, title, notes) {
  const slide = pres.addSlide();
  slide.background = { color: WHITE };
  text(slide, kicker, { x: M, y: 0.42, w: 9, h: 0.26, fontSize: 11, bold: true, color: MUTED, charSpacing: 1.5 });
  text(slide, title, { x: M, y: 0.7, w: W - 2 * M, h: 0.72, fontFace: HEAD, fontSize: 30, valign: 'middle' });
  text(slide, 'SJVN platform — functional tree · summary', { x: M, y: 7.02, w: 6, h: 0.25, fontSize: 9, color: MUTED });
  slide.slideNumber = { x: W - M - 0.6, y: 7.0, w: 0.6, h: 0.28, fontFace: BODY, fontSize: 9, color: MUTED, align: 'right' };
  if (notes) slide.addNotes(notes);
  return slide;
}

const firstSentence = (s) => { const m = /^(.*?[.!?])(\s|$)/s.exec(s); return m ? m[1] : s; };
// U+2011 keeps "Form-IV" and "pre-trade" from breaking at the hyphen.
const shortName = (name) => (name.length > 44 ? name.replace(/\s*\([^)]*\)\s*$/, '') : name)
  .replace(' (two-part tariff, single beneficiary)', ' (two-part tariff)').replace(/(\w)-(\w)/g, '$1\u2011$2');
const byNo = Object.fromEntries(verticals.flatMap((v) => v.modules.map((m) => [m.no, m])));
const [reia, hydro, trading] = verticals;
const leafNo = (moduleNo, name) => {
  const fn = byNo[moduleNo].fns.find((x) => x.name === name);
  if (!fn) throw new Error(`No functionality "${name}" in module ${moduleNo}`);
  return fn.no;
};
const moduleNo = (v, startsWith) => {
  const m = v.modules.find((x) => x.name.startsWith(startsWith));
  if (!m) throw new Error(`No module "${startsWith}" in ${v.short}`);
  return m.no;
};

/** Module numbers gathered into the groups a slide can hold. */
const GROUPS = {
  reia: [
    ['Parties and contracts', ['1.1', '1.2', '1.3', '1.4']],
    ['Energy and billing', ['1.5', '1.6', '1.7', '1.8', '1.9', '1.16']],
    ['Money and settlement', ['1.10', '1.11', '1.12', '1.13', '1.14', '1.15']],
    ['Compliance and common', ['1.17', '1.18', '1.19', '1.20', '1.21', '1.22']],
  ],
  hydro: [
    ['Masters and input', ['2.1', '2.2', '2.3']],
    ['The bill', ['2.4', '2.5', '2.6', '2.9', '2.10']],
    ['Account and money', ['2.7', '2.8', '2.11', '2.12']],
    ['Reporting and common', ['2.13', '2.14', '2.15', '2.16']],
  ],
  trading: [
    ['Clients and exchange trading', ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6']],
    ['Bilateral, open access, schedule', ['3.7', '3.8', '3.9', '3.10', '3.11']],
    ['Billing and settlement', ['3.12', '3.13', '3.14', '3.15', '3.18']],
    ['Analytics, compliance, common', ['3.16', '3.17', '3.19', '3.20', '3.21', '3.22', '3.23', '3.24']],
  ],
};
for (const v of verticals) {
  const grouped = GROUPS[v.id].flatMap(([, nos]) => nos).sort();
  const actual = v.modules.map((m) => m.no).sort();
  if (JSON.stringify(grouped) !== JSON.stringify(actual)) throw new Error(`Deck groups for ${v.id} do not match its modules`);
}

const moduleRuns = (nos, color, size = 11) => nos.flatMap((no, i) => {
  const m = byNo[no];
  return [
    { text: `${no}  `, options: { bold: true, color, fontSize: size } },
    { text: shortName(m.name), options: { color: INK, fontSize: size } },
    { text: '\u00A0\u00A0●', options: { color: STATUS[m.status], fontFace: 'Arial', fontSize: size - 3.5, breakLine: i < nos.length - 1 } },
  ];
});

const legend = (slide, y) => {
  text(slide, [
    { text: '● ', options: { color: STATUS.live, fontFace: 'Arial', fontSize: 8 } }, { text: 'in the platform     ', options: {} },
    { text: '● ', options: { color: STATUS.partial, fontFace: 'Arial', fontSize: 8 } }, { text: 'has an open item     ', options: {} },
    { text: '● ', options: { color: STATUS.pending, fontFace: 'Arial', fontSize: 8 } }, { text: 'not yet live', options: {} },
  ], { x: M, y, w: 8, h: 0.25, fontSize: 10, color: MUTED });
};

/* ------------------------------------------------------------- 1. title */
{
  const s = pres.addSlide();
  s.background = { color: INK };
  text(s, 'SJVN LIMITED', { x: M, y: 1.0, w: 6, h: 0.3, fontSize: 12, bold: true, color: 'A9BDB8', charSpacing: 2 });
  text(s, 'Functional tree', { x: M, y: 1.5, w: 7, h: 1.2, fontFace: HEAD, fontSize: 56, color: WHITE, valign: 'middle' });
  text(s, 'Integrated RE commercial, billing, settlement and power trading platform', { x: M, y: 2.85, w: 6.2, h: 0.9, fontSize: 19, color: 'DCE6E3' });
  text(s, `Summary of the full document · position as on ${DOC_DATE} · draft for review`, { x: M, y: 6.3, w: 7, h: 0.3, fontSize: 12, color: 'A9BDB8' });

  // the tree itself, as the picture
  const rx = 8.05; const cw = 1.5; const gap = 0.2;
  const root = { x: rx + (3 * cw + 2 * gap) / 2 - 1.25, y: 1.55, w: 2.5, h: 0.6 };
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...root, rectRadius: 0.08, fill: { color: WHITE }, line: { color: WHITE, width: 0.5 } });
  text(s, 'Platform', { ...root, align: 'center', valign: 'middle', fontFace: HEAD, fontSize: 16, bold: true });
  line(s, root.x + root.w / 2, root.y + root.h, 0, 0.45, 'A9BDB8');
  line(s, rx + cw / 2, 2.6, 2 * (cw + gap), 0, 'A9BDB8');
  verticals.forEach((v, i) => {
    const x = rx + i * (cw + gap);
    line(s, x + cw / 2, 2.6, 0, 0.4, 'A9BDB8');
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 3.0, w: cw, h: 0.95, rectRadius: 0.08, fill: { color: ACC[v.id] }, line: { color: ACC[v.id], width: 0.5 } });
    text(s, [{ text: v.no, options: { fontSize: 11, color: 'DCE6E3', breakLine: true } }, { text: v.short, options: { fontSize: 14, bold: true, color: WHITE } }],
      { x, y: 3.0, w: cw, h: 0.95, align: 'center', valign: 'middle' });
    line(s, x + cw / 2, 3.95, 0, 0.35, 'A9BDB8');
    const st = statusOf(v);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.3, w: cw, h: 0.95, rectRadius: 0.08, fill: { color: '22363C' }, line: { color: '3A5158', width: 0.75 } });
    text(s, [{ text: `${v.modules.length} modules`, options: { fontSize: 13, bold: true, color: WHITE, breakLine: true } }, { text: `${st.fns} functionalities`, options: { fontSize: 11, color: 'DCE6E3' } }],
      { x, y: 4.3, w: cw, h: 0.95, align: 'center', valign: 'middle' });
  });
  s.addNotes('Summary deck of the functional tree. The full document sets out every functionality with its input, who does it, its output and its rules.');
}

/* ------------------------------------------------- 2. three levels */
{
  const s = frame('HOW IT IS ORGANISED', 'One tree, three levels',
    'A vertical is a line of business, a module is a branch of it, a functionality is a leaf. Screens and layouts are left out on purpose because they will change.');
  const stats = [[String(verticals.length), 'verticals', 'A line of SJVN\'s business'], [String(totals.modules), 'modules', 'A branch — one area of work'], [String(totals.fns), 'functionalities', 'A leaf — one thing the module does']];
  const sw = 3.85; const sg = 0.29;
  stats.forEach(([n, label, sub], i) => {
    const x = M + i * (sw + sg);
    card(s, x, 1.7, sw, 1.75);
    text(s, n, { x: x + 0.3, y: 1.82, w: 1.75, h: 1.5, fontFace: HEAD, fontSize: 60, valign: 'middle', color: INK });
    text(s, [{ text: label, options: { fontSize: 18, bold: true, breakLine: true } }, { text: sub, options: { fontSize: 12, color: MUTED } }],
      { x: x + 2.05, y: 1.82, w: sw - 2.2, h: 1.5, valign: 'middle' });
  });

  text(s, 'How a line is numbered', { x: M, y: 3.85, w: 6, h: 0.35, fontFace: HEAD, fontSize: 18, bold: true });
  const path3 = [['1', 'REIA', 0.6], ['1.12', 'Deviation settlement', 0.9], ['1.12.4', 'Manual estimate', 1.1]];
  path3.forEach(([no, name, cwid], i) => {
    const y = 4.4 + i * 0.62;
    const x = M + i * 0.45;
    chip(s, no, x, y, cwid, ACC.reia);
    text(s, name, { x: x + cwid + 0.18, y, w: 4, h: 0.36, fontSize: 15, valign: 'middle' });
  });
  text(s, 'A number such as 1.12.4 can be quoted in a note or a meeting and found again in the full document.',
    { x: M, y: 6.3, w: 5.9, h: 0.55, fontSize: 12, color: MUTED });

  const rx = 7.1;
  text(s, 'What every functionality records', { x: rx, y: 3.85, w: 5.6, h: 0.35, fontFace: HEAD, fontSize: 18, bold: true });
  const fields = [['What it does', 'the purpose of the leaf, in a sentence'], ['Input', 'what goes in'], ['Done by', 'the role responsible, or the system'], ['Output', 'what comes out'], ['Rules and controls', 'the rule or check that governs it']];
  fields.forEach(([k, d], i) => {
    const y = 4.4 + i * 0.47;
    card(s, rx, y, 5.63, 0.4, i % 2 ? WHITE : MIST);
    text(s, k, { x: rx + 0.18, y, w: 1.9, h: 0.4, fontSize: 13, bold: true, valign: 'middle' });
    text(s, d, { x: rx + 2.1, y, w: 3.4, h: 0.4, fontSize: 12.5, color: MUTED, valign: 'middle' });
  });
}

/* ------------------------------------------------------ 3. the tree */
{
  const s = frame('THE TREE', 'Three verticals and their branches',
    'Each vertical with its modules gathered into four groups. The module-by-module lists follow on the vertical slides.');
  const rootW = 4.2; const rootX = (W - rootW) / 2;
  card(s, rootX, 1.6, rootW, 0.5, INK, INK);
  text(s, 'SJVN commercial and trading platform', { x: rootX, y: 1.6, w: rootW, h: 0.5, align: 'center', valign: 'middle', color: WHITE, bold: true, fontSize: 13.5 });
  const cw = 3.85; const cg = 0.29;
  line(s, W / 2, 2.1, 0, 0.2);
  line(s, M + cw / 2, 2.3, 2 * (cw + cg), 0);
  verticals.forEach((v, i) => {
    const x = M + i * (cw + cg);
    line(s, x + cw / 2, 2.3, 0, 0.2);
    card(s, x, 2.5, cw, 0.62, ACC[v.id], ACC[v.id]);
    text(s, [{ text: `${v.no}  ${v.short}`, options: { bold: true, fontSize: 16, color: WHITE } }, { text: `     ${v.modules.length} modules`, options: { fontSize: 11.5, color: WHITE } }],
      { x: x + 0.2, y: 2.5, w: cw - 0.4, h: 0.62, valign: 'middle', fontFace: HEAD });
    GROUPS[v.id].forEach(([name, nos], gi) => {
      const y = 3.27 + gi * 0.9;
      card(s, x, y, cw, 0.8, TINT[v.id], TINT[v.id]);
      text(s, name, { x: x + 0.2, y: y + 0.09, w: cw - 1.3, h: 0.3, fontSize: 13.5, bold: true });
      text(s, `${nos.length} modules`, { x: x + cw - 1.2, y: y + 0.09, w: 1.0, h: 0.3, fontSize: 11, color: ACC[v.id], bold: true, align: 'right' });
      text(s, nos.join(' · '), { x: x + 0.2, y: y + 0.42, w: cw - 0.4, h: 0.28, fontSize: 11, color: MUTED });
    });
  });
}

/* ----------------------------------------------------- 4. where it stands */
{
  const s = frame('POSITION', 'Where the platform stands',
    'Status is taken from the September status notes and the software, on the test server. Nothing is in production use yet. A module shared by three verticals is counted three times.');
  const big = [[totals.live, 'in the platform', STATUS.live], [totals.partial, 'partly in place', STATUS.partial], [totals.pending, 'not yet live', STATUS.pending]];
  big.forEach(([n, label, color], i) => {
    const y = 1.75 + i * 1.55;
    card(s, M, y, 4.3, 1.35);
    text(s, String(n), { x: M + 0.3, y, w: 1.9, h: 1.35, fontFace: HEAD, fontSize: 54, color, valign: 'middle' });
    text(s, [{ text: label, options: { fontSize: 17, bold: true, breakLine: true } }, { text: `of ${totals.fns} functionalities`, options: { fontSize: 12, color: MUTED } }],
      { x: M + 2.2, y, w: 2.0, h: 1.35, valign: 'middle' });
  });
  // Drawn as shapes, not a native chart: Keynote drops this chart on import and
  // leaves the slide half empty, and with three bars nothing is lost.
  const st = verticals.map(statusOf);
  const bx = 5.3; const bw = W - M - bx;
  text(s, 'Open items by vertical', { x: bx, y: 1.75, w: bw, h: 0.36, fontFace: HEAD, fontSize: 18, bold: true });
  const trackX = bx + 2.35; const trackW = bw - 2.35 - 0.6;
  const scale = trackW / Math.max(...st.map((x) => x.partial + x.pending));
  verticals.forEach((v, i) => {
    const y = 2.4 + i * 1.02;
    text(s, [{ text: v.short, options: { bold: true, fontSize: 15, breakLine: true } }, { text: `${st[i].partial + st[i].pending} of ${st[i].fns} open`, options: { fontSize: 11.5, color: MUTED } }],
      { x: bx, y, w: 2.25, h: 0.8, valign: 'middle' });
    let x = trackX;
    [['partial', st[i].partial], ['pending', st[i].pending]].forEach(([kind, n]) => {
      if (!n) return;
      const w = n * scale;
      s.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.12, w, h: 0.56, fill: { color: STATUS[kind] }, line: { color: WHITE, width: 1 } });
      if (w >= 0.3) text(s, String(n), { x, y: y + 0.12, w, h: 0.56, align: 'center', valign: 'middle', color: WHITE, bold: true, fontSize: 14 });
      x += w;
    });
  });
  [['partial', 'Partly in place'], ['pending', 'Not yet live']].forEach(([kind, label], i) => {
    const x = trackX + i * 2.0;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 5.52, w: 0.2, h: 0.2, fill: { color: STATUS[kind] }, line: { color: STATUS[kind], width: 0.5 } });
    text(s, label, { x: x + 0.3, y: 5.47, w: 1.6, h: 0.3, fontSize: 12, valign: 'middle' });
  });
  text(s, 'Basis: status notes of 11–28 September 2026 and the software itself, on the test server. Each line was not re-tested for this paper. A module shared by several verticals is counted in each.',
    { x: 5.3, y: 6.0, w: 7.43, h: 0.75, fontSize: 11.5, color: MUTED });
}

/* -------------------------------------------- vertical overview + modules */
function overview(v, actors, notes) {
  const s = frame(`VERTICAL ${v.no}`, v.name, notes);
  const st = statusOf(v);
  text(s, v.purpose.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.'), { x: M, y: 1.65, w: 6.0, h: 1.85, fontSize: 14.5, paraSpaceAfter: 6 });
  chip(s, `${v.modules.length} modules`, M, 3.65, 1.6, ACC[v.id]);
  chip(s, `${st.fns} functionalities`, M + 1.75, 3.65, 2.2, ACC[v.id]);

  text(s, 'Who is involved', { x: 7.0, y: 1.6, w: 5.7, h: 0.32, fontFace: HEAD, fontSize: 16, bold: true });
  actors.forEach(([who, what], i) => {
    const y = 2.02 + i * 0.5;
    line(s, 7.0, y - 0.05, 5.73, 0, RULE, 0.75);
    text(s, who, { x: 7.0, y, w: 2.1, h: 0.42, fontSize: 12.5, bold: true, valign: 'middle' });
    text(s, what, { x: 9.15, y, w: 3.58, h: 0.42, fontSize: 11, color: MUTED, valign: 'middle' });
  });

  text(s, 'The work from end to end', { x: M, y: 4.55, w: 6, h: 0.32, fontFace: HEAD, fontSize: 16, bold: true });
  const n = v.flow.length; const g = 0.1; const bw = (W - 2 * M - g * (n - 1)) / n;
  v.flow.forEach(([t, d], i) => {
    const x = M + i * (bw + g);
    card(s, x, 5.0, bw, 1.75, TINT[v.id], TINT[v.id]);
    text(s, String(i + 1), { x: x + 0.12, y: 5.08, w: 0.4, h: 0.26, color: ACC[v.id], bold: true, fontSize: 13, fontFace: HEAD, valign: 'middle' });
    text(s, t, { x: x + 0.12, y: 5.36, w: bw - 0.2, h: 0.4, fontSize: 11, bold: true });
    text(s, d.replace(/(\w)-(\w)/g, '$1\u2011$2'), { x: x + 0.12, y: 5.8, w: bw - 0.2, h: 0.9, fontSize: 10, color: '3D4B4F' });
  });
  return s;
}

function modulesFourUp(v, notes) {
  const s = frame(`VERTICAL ${v.no} · MODULES`, `${v.short} — the ${v.modules.length} modules`, notes);
  const cw = 2.88; const cg = 0.2;
  GROUPS[v.id].forEach(([name, nos], i) => {
    const x = M + i * (cw + cg);
    card(s, x, 1.65, cw, 4.85, TINT[v.id], TINT[v.id]);
    text(s, name, { x: x + 0.18, y: 1.78, w: cw - 0.36, h: 0.62, fontFace: HEAD, fontSize: 15, bold: true, color: ACC[v.id], valign: 'middle' });
    text(s, moduleRuns(nos, ACC[v.id], nos.length > 6 ? 12 : 13), { x: x + 0.18, y: 2.55, w: cw - 0.36, h: 3.85, paraSpaceAfter: nos.length > 6 ? 7 : 11 });
  });
  legend(s, 6.62);
  return s;
}

overview(reia, [
  ['REIA desk', 'Onboards parties, keeps contracts, validates energy, raises and verifies bills'],
  ['Approvers', 'Approve each invoice; never the person who raised it'],
  ['Finance', 'Books the month against the SAP voucher'],
  ['Seller (developer)', 'Own portal: raises its bills, follows payment and disputes'],
  ['Buyer (DISCOM / C&I)', 'Own portal: views bills, pays, disputes, signs off'],
], 'SJVN buys from developers under PPAs and sells to DISCOMs under PSAs, back to back. The nine steps are the monthly cycle from onboarding to Finance.');
modulesFourUp(reia, 'Twenty-two modules in four groups. The dot shows whether a module has anything still open; details are in the full document.');

/* ----------------------------------------------- 7. how a branch opens */
{
  const m = byNo['1.12'];
  const leaf = m.fns[3];
  const s = frame('HOW A BRANCH OPENS', 'Example: deviation settlement (module 1.12)',
    'This is how every module reads in the full document: the module, its leaves, and each leaf opened out. Deviation settlement is shown because it appears under both REIA and hydro billing.');
  chip(s, '1  REIA', M, 1.7, 1.2, ACC.reia);
  line(s, M + 0.6, 2.06, 0, 0.22, ACC.reia);
  chip(s, '1.12  Deviation settlement', M, 2.28, 3.1, ACC.reia);
  text(s, firstSentence(m.purpose), { x: M, y: 2.85, w: 3.3, h: 1.0, fontSize: 12, color: MUTED });
  text(s, [
    { text: 'Shared', options: { bold: true, breakLine: true } },
    { text: 'The same module is printed under hydro billing as 2.11.', options: { color: MUTED } },
  ], { x: M, y: 4.05, w: 3.3, h: 0.8, fontSize: 12 });
  text(s, [
    { text: 'Rule that governs it', options: { bold: true, breakLine: true } },
    { text: m.rules[0], options: { color: MUTED } },
  ], { x: M, y: 5.0, w: 3.3, h: 1.4, fontSize: 12 });

  card(s, 4.25, 1.65, 3.9, 4.95, TINT.reia, TINT.reia);
  text(s, `${m.fns.length} leaves`, { x: 4.45, y: 1.78, w: 3.5, h: 0.35, fontFace: HEAD, fontSize: 14.5, bold: true, color: ACC.reia });
  text(s, m.fns.flatMap((fn, i) => [
    { text: `${fn.no}  `, options: { bold: true, color: ACC.reia } },
    { text: fn.name, options: { bold: fn.no === leaf.no, breakLine: i < m.fns.length - 1 } },
  ]), { x: 4.45, y: 2.25, w: 3.55, h: 4.25, fontSize: 12.5, paraSpaceAfter: 9 });

  card(s, 8.4, 1.65, 4.33, 4.95, WHITE, ACC.reia);
  chip(s, leaf.no, 8.6, 1.83, 0.95, ACC.reia, 11.5);
  text(s, leaf.name, { x: 9.68, y: 1.83, w: 2.9, h: 0.36, fontFace: HEAD, fontSize: 15, bold: true, valign: 'middle' });
  const rows = [['What it does', leaf.what], ['Input', leaf.input], ['Done by', leaf.who], ['Output', leaf.output], ['Rules and controls', leaf.rules]];
  let y = 2.4;
  rows.forEach(([k, val]) => {
    const h = Math.ceil(val.length / 54) * 0.2;
    text(s, k.toUpperCase(), { x: 8.6, y, w: 3.95, h: 0.2, fontSize: 9, bold: true, color: ACC.reia, charSpacing: 1 });
    text(s, val, { x: 8.6, y: y + 0.22, w: 3.95, h, fontSize: 11.5 });
    y += h + 0.42;
  });
}

overview(hydro, [
  ['Commercial desk (C&SO)', 'Keeps the station master, computes and raises the bill, records payment'],
  ['Approvers', 'A next approver and a final approver, named on each bill'],
  ['Finance', 'Books the month\'s bills against the SAP voucher'],
  ['Beneficiaries', 'States and utilities; receive the printed bill, no login'],
  ['System', 'Reads the REA, computes the bill, accrues surcharge'],
], 'SJVN\'s own stations billed under the CERC two-part tariff. One bill for the station, split across beneficiaries in the proportions the Regional Energy Account fixes.');

/* ------------------------------------------------- 9. hydro modules */
{
  const v = hydro;
  const s = frame(`VERTICAL ${v.no} · MODULES`, `${v.short} — the ${v.modules.length} modules`,
    'Sixteen modules. The right-hand panel is the bill itself: four blocks, and the check against SJVN\'s own issued bill.');
  const cw = 3.62; const ch = 2.33; const cg = 0.2;
  GROUPS[v.id].forEach(([name, nos], i) => {
    const x = M + (i % 2) * (cw + cg); const y = 1.65 + Math.floor(i / 2) * (ch + cg);
    card(s, x, y, cw, ch, TINT[v.id], TINT[v.id]);
    text(s, name, { x: x + 0.18, y: y + 0.12, w: cw - 0.36, h: 0.32, fontFace: HEAD, fontSize: 14.5, bold: true, color: ACC[v.id] });
    text(s, moduleRuns(nos, ACC[v.id], 12.5), { x: x + 0.18, y: y + 0.56, w: cw - 0.36, h: ch - 0.64, paraSpaceAfter: 6 });
  });
  legend(s, 6.62);

  const rx = 8.24; const rw = W - M - rx;
  card(s, rx, 1.65, rw, 4.86, WHITE, ACC[v.id]);
  text(s, 'The station bill in four blocks', { x: rx + 0.22, y: 1.8, w: rw - 0.44, h: 0.35, fontFace: HEAD, fontSize: 15, bold: true });
  const blocks = [['A', 'Tariff constants and the rates derived from them'], ['C', 'Capacity charge on availability, and the incentive'], ['E', 'Energy: scheduled, free power, saleable, cumulative'], ['EE', 'Energy charges, with the excess rate past design energy']];
  blocks.forEach(([k, d], i) => {
    const y = 2.32 + i * 0.6;
    chip(s, k, rx + 0.22, y, 0.55, ACC[v.id]);
    text(s, d, { x: rx + 0.92, y: y - 0.04, w: rw - 1.14, h: 0.45, fontSize: 11.5, valign: 'middle' });
  });
  line(s, rx + 0.22, 4.78, rw - 0.44, 0, RULE, 0.75);
  text(s, 'Rs 157,49,26,027', { x: rx + 0.22, y: 4.9, w: rw - 0.44, h: 0.6, fontFace: HEAD, fontSize: 28, color: ACC[v.id], valign: 'middle' });
  text(s, 'NJHPS bill for June 2026 — the platform\'s figure matches SJVN\'s issued bill to the rupee. May 2026 matches too.',
    { x: rx + 0.22, y: 5.52, w: rw - 0.44, h: 0.85, fontSize: 11.5, color: MUTED });
}

overview(trading, [
  ['Trading desk', 'Keeps clients, enters bids and deals, tracks open access, raises bills'],
  ['Trading checker', 'Approves a bid; never its maker'],
  ['Finance', 'Uses the SAP formats, the TDS register and the ledgers'],
  ['Trading client', 'Own portal; its maker and checker clear a bid request'],
  ['Outside systems', 'IEX, PXIL, NOAR, WBES, NRPC, CERC, SAP'],
], 'The trading desk trades for SJVN and for clients, on the exchanges and through bilateral contracts under open access.');
modulesFourUp(trading, 'Twenty-four modules. The menu and the report layouts follow the existing ISET portal so they read the same way to its users.');

/* ---------------------------------------------- 12. shared modules */
{
  const s = frame('SHARED MODULES', 'Modules used by more than one vertical',
    'A shared module is printed in full under each vertical that uses it, worded for that vertical.');
  const keyOf = (name) => name.replace(/ — .*$/, '').replace(/\s*\(.*\)$/, '').replace(/^Dashboards.*$/, 'Dashboards, MIS and reports').replace(/^Finance.*$/, 'Finance posting and SAP').replace(/^Reconciliation.*$/, 'Reconciliation');
  const map = new Map();
  for (const v of verticals) for (const m of v.modules) {
    if (!m.sharedWith?.length) continue;
    const k = keyOf(m.name);
    if (!map.has(k)) map.set(k, {});
    map.get(k)[v.id] = m.no;
  }
  const head = (t, color) => ({ text: t, options: { bold: true, color: WHITE, fill: { color }, fontSize: 12.5, align: t === 'Module' ? 'left' : 'center', valign: 'middle' } });
  const rows = [[head('Module', INK), head('REIA', ACC.reia), head('Hydro billing', ACC.hydro), head('Power trading', ACC.trading)]];
  [...map.entries()].forEach(([name, o], i) => {
    const bg = i % 2 ? WHITE : MIST;
    const cell = (id) => ({ text: o[id] || '—', options: { align: 'center', valign: 'middle', bold: !!o[id], color: o[id] ? ACC[id] : 'A0ABAE', fill: { color: bg }, fontSize: 13 } });
    rows.push([{ text: name, options: { valign: 'middle', fill: { color: bg }, fontSize: 13 } }, cell('reia'), cell('hydro'), cell('trading')]);
  });
  s.addTable(rows, { x: M, y: 1.65, w: 8.0, colW: [3.8, 1.4, 1.4, 1.4], rowH: 0.43, fontFace: BODY, color: INK, border: { type: 'solid', color: RULE, pt: 0.75 }, margin: [0.04, 0.14, 0.04, 0.14] });

  const rx = 9.0; const rw = W - M - rx;
  card(s, rx, 1.65, rw, 4.73);
  text(s, String(map.size), { x: rx + 0.25, y: 1.8, w: rw - 0.5, h: 0.95, fontFace: HEAD, fontSize: 54, valign: 'middle' });
  text(s, 'modules are shared', { x: rx + 0.25, y: 2.78, w: rw - 0.5, h: 0.35, fontSize: 16, bold: true });
  text(s, [
    { text: 'Each is printed in full under every vertical that uses it, so a reader of one vertical never has to turn to another.', options: { breakLine: true } },
    { text: 'The numbers are the module numbers in each vertical.', options: { breakLine: true } },
    { text: 'Deviation settlement sits under both REIA and hydro billing: the stations are hydro, the bill it raises is a REIA supplementary bill.', options: {} },
  ], { x: rx + 0.25, y: 3.3, w: rw - 0.5, h: 2.95, fontSize: 12, color: MUTED, paraSpaceAfter: 8 });
}

/* ------------------------------------------- 13. outside systems */
{
  // One line per system, short enough for a slide. Keyed by the name in the
  // appendix so a system added there cannot be left off here.
  const NOTE = {
    'NRPC — Regional Energy Account': 'Monthly energy, availability and free power',
    'JMR / State Energy Account / RLDC statement': 'Table upload with the unit stated',
    'NOAR — trader API': 'Live: 422 applications read over four months',
    'CERC — monthly market reports': 'Sixteen months held and read',
    'NRPC — Deviation Settlement Account': 'Archive to January 2026 loaded; later weeks uploaded by hand',
    'IEX — front-office API': 'Live on IEX\'s test system; a market session is to be scheduled',
    'SAP (ERP)': 'Manual voucher handover; the interface awaits SJVN IT',
    'Email (SMTP)': 'Built; relay on the server to be confirmed',
    'IEX — REC and post-trade (C&S)': 'IEX to register the server and issue the token',
    'IEX / PXIL — bid submission': 'Switched off; rollout is a management decision',
    'PXIL — member API': 'PXIL to register the IP and issue a working token',
    'HPX': 'On hold',
    'WBES — Grid India': 'Grid India to register the server IP',
    'CEA': 'No feed or upload format yet',
    'Grid frequency feed': 'No live source; entered by hand',
    'GST e-invoice (IRP / GSP) and digital signature': 'DSC decision and GSP / IRP access',
    'SMS gateway and TRAI DLT': 'DLT registration of SJVN and its templates',
    'Bank / virtual accounts': 'No bank interface',
    'Active Directory (SSO)': 'With SJVN IT',
  };
  const missing = systems.filter((r) => !NOTE[r[0]]).map((r) => r[0]);
  if (missing.length) throw new Error(`No slide note for: ${missing.join(', ')}`);

  const s = frame('OUTSIDE SYSTEMS', 'Interfaces, and where each stands',
    'Working means in use on the test server. Partly means it works with a stated gap. Waiting means an outside party or a decision is needed first.');
  const cols = [['live', 'Working'], ['partial', 'Partly in place'], ['pending', 'Waiting']];
  const widths = [3.55, 3.9, 4.28]; const cg = 0.2;
  let x = M;
  cols.forEach(([kind, label], i) => {
    const items = systems.filter((r) => r[4] === kind);
    const w = widths[i];
    card(s, x, 1.65, w, 5.1);
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: 1.84, w: 0.2, h: 0.2, fill: { color: STATUS[kind] }, line: { color: STATUS[kind], width: 0.5 } });
    text(s, `${label} · ${items.length}`, { x: x + 0.5, y: 1.76, w: w - 0.7, h: 0.36, fontFace: HEAD, fontSize: 15, bold: true, valign: 'middle' });
    const dense = items.length > 7;
    text(s, items.flatMap((r, j) => [
      { text: r[0].replace(' — ', ': ').replace(' (IRP / GSP)', ''), options: { bold: true, fontSize: dense ? 11 : 12.5, breakLine: true, paraSpaceAfter: 0 } },
      { text: NOTE[r[0]], options: { color: MUTED, fontSize: dense ? 10 : 11.5, breakLine: j < items.length - 1, paraSpaceAfter: dense ? 2 : 12 } },
    ]), { x: x + 0.2, y: 2.3, w: w - 0.4, h: 4.35 });
    x += w + cg;
  });
}

/* -------------------------------------- 14. what waits on whom */
{
  const s = frame('OPEN ITEMS', 'What is not yet live, and who it waits on',
    'Appendix B of the full document lists every open item with its reference number.');
  const groups = [
    ['Exchanges and Grid India', [
      'IEX — a market-clearing test session; REC registration; the post-trade token',
      'PXIL — IP registration and a working token',
      'Grid India — register the server IP for WBES and confirm SJVN\'s utility code',
      'NOAR — written confirmation of what its interface returns',
    ]],
    ['SJVN IT', [
      'SAP — interface method, test system, company code, vendor and customer numbers, GL mapping',
      'SMTP relay on the server for invoice mail and the MIS pack',
      'Active Directory for single sign-on',
    ]],
    ['Registrations and notified rates', [
      'TRAI DLT — SJVN as principal entity, the header and 50 SMS templates; gateway vendor',
      'Digital signature and GSP / IRP access for GST e-invoice',
      'Notified DSM slab rates, to price deviation on trading schedules',
      'A bank interface for automatic collection',
    ]],
    ['To be built on our side', [
      'Edit and cancel of a saved bid before the exchange cut-off',
      'A dated master for transmission losses',
      'Billed, collected and overdue figures on the hydro dashboard',
      'CEA data — an upload format, if CEA\'s interface cannot be reached',
    ]],
  ];
  const cw = 5.97; const ch = 2.42; const cg = 0.19;
  groups.forEach(([name, items], i) => {
    const x = M + (i % 2) * (cw + cg); const y = 1.65 + Math.floor(i / 2) * (ch + cg);
    card(s, x, y, cw, ch);
    chip(s, String(items.length), x + 0.2, y + 0.17, 0.42, INK, 12);
    text(s, name, { x: x + 0.76, y: y + 0.17, w: cw - 1, h: 0.36, fontFace: HEAD, fontSize: 15, bold: true, valign: 'middle' });
    text(s, items.map((t, j) => ({ text: t, options: { bullet: { indent: 12 }, breakLine: j < items.length - 1 } })),
      { x: x + 0.2, y: y + 0.7, w: cw - 0.4, h: ch - 0.8, fontSize: 12, paraSpaceAfter: 4 });
  });
}

/* ----------------------------------------------- 15. decisions */
{
  const s = frame('FOR MANAGEMENT', 'Decisions needed',
    'Each of these is noted against its module in the full document.');
  const items = [
    ['Sending bids to the exchange', 'Bid submission is switched off on purpose. A controlled rollout has to be decided, and whether a test bid is placed in IEX\'s test session.', leafNo('3.3', 'Send to the exchange by API')],
    ['Who approves a debit or credit note', 'Today any second user from REIA or Finance may approve. Should it be Finance only?', `${moduleNo(reia, 'Debit and credit notes')} · ${moduleNo(trading, 'Debit and credit notes')}`],
    ['Pending and rejected open-access applications', 'NOAR returns approved applications only. Keep tracking the rest by hand, or drop it?', leafNo('3.8', 'Pending and rejected applications')],
    ['Hydro stations in scope', 'NJHPS and Rampur are set up. Which other stations are to be billed from the platform?', leafNo('2.1', 'Other stations')],
    ['Forecast method and accuracy', 'Price forecasting is built. The model and the accuracy expected of it await committee sign-off.', leafNo('3.16', 'Forecast method sign-off')],
    ['HPX', 'Integration with the third exchange is on hold. Confirm, or set a date.', leafNo('3.5', 'HPX')],
  ];
  const cw = 5.97; const ch = 1.55; const cg = 0.19;
  items.forEach(([t, d, ref], i) => {
    const x = M + (i % 2) * (cw + cg); const y = 1.65 + Math.floor(i / 2) * (ch + cg);
    card(s, x, y, cw, ch);
    s.addShape(pres.shapes.OVAL, { x: x + 0.22, y: y + 0.2, w: 0.5, h: 0.5, fill: { color: INK }, line: { color: INK, width: 0.5 } });
    text(s, String(i + 1), { x: x + 0.22, y: y + 0.2, w: 0.5, h: 0.5, align: 'center', valign: 'middle', color: WHITE, bold: true, fontSize: 16, fontFace: HEAD });
    text(s, t, { x: x + 0.92, y: y + 0.17, w: cw - 2.2, h: 0.36, fontSize: 14.5, bold: true, valign: 'middle' });
    text(s, ref, { x: x + cw - 1.3, y: y + 0.17, w: 1.1, h: 0.36, fontSize: 11, color: MUTED, align: 'right', valign: 'middle' });
    text(s, d, { x: x + 0.92, y: y + 0.62, w: cw - 1.15, h: ch - 0.72, fontSize: 13, color: '3D4B4F' });
  });
}

/* --------------------------------------------------- 16. close */
{
  let pages = '';
  try { pages = existsSync(PDF) ? /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [PDF]).toString())?.[1] ?? '' : ''; } catch { pages = ''; }
  const s = pres.addSlide();
  s.background = { color: INK };
  text(s, 'THE FULL DOCUMENT', { x: M, y: 0.9, w: 6, h: 0.3, fontSize: 12, bold: true, color: 'A9BDB8', charSpacing: 2 });
  text(s, 'Every leaf, opened out', { x: M, y: 1.3, w: 9, h: 1.0, fontFace: HEAD, fontSize: 44, color: WHITE, valign: 'middle' });
  text(s, `${pages ? `${pages} pages. ` : ''}${totals.fns} functionalities, each with what it does, its input, who does it, its output and the rule that governs it.`,
    { x: M, y: 2.45, w: 8.5, h: 0.8, fontSize: 17, color: 'DCE6E3' });
  const steps = [['Page 3', 'The tree', 'Pick the vertical, then the module; its page number is beside it.'], ['Module page', 'Summary, then a table', 'Purpose, who, inputs, outputs, rules — then one row per functionality.'], ['Appendix B', 'Everything not yet live', 'Each open item with its reference and what it waits on.']];
  const cw = 3.85; const cg = 0.29;
  steps.forEach(([k, t, d], i) => {
    const x = M + i * (cw + cg);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 3.9, w: cw, h: 2.05, rectRadius: 0.07, fill: { color: '22363C' }, line: { color: '3A5158', width: 0.75 } });
    chip(s, k, x + 0.22, 4.1, 1.5, ACC[['reia', 'hydro', 'trading'][i]], 11.5);
    text(s, t, { x: x + 0.22, y: 4.62, w: cw - 0.44, h: 0.38, fontFace: HEAD, fontSize: 17, bold: true, color: WHITE });
    text(s, d, { x: x + 0.22, y: 5.05, w: cw - 0.44, h: 0.8, fontSize: 12, color: 'DCE6E3' });
  });
  text(s, 'docs/SJVN_Platform_Functional_Tree_2026-10-01.pdf', { x: M, y: 6.4, w: 9, h: 0.3, fontSize: 12, color: 'A9BDB8' });
  s.addNotes('The deck is the summary; the PDF is the reference.');
}

await pres.writeFile({ fileName: OUT });
console.log(`${path.relative(ROOT, OUT)} — ${pres.slides.length} slides`);
