// The manual's building blocks: a small vocabulary (chapter, step, figure, note,
// field table …) that the content files use, turned into Word paragraphs here so
// every chapter looks the same.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat,
  Packer, PageBreak, PageNumber, Paragraph, ShadingType, TabStopType, Table, TableCell,
  TableOfContents, TableRow, TextRun, VerticalAlign, WidthType, TableLayoutType,
} from 'docx';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(here, '../shots');
const LOGO = path.resolve(here, '../../../frontend/public/sjvn-logo.png');

// ── Look ────────────────────────────────────────────────────────────────────
const C = {
  navy: '0B2A5B', blue: '1D4ED8', ink: '1F2937', grey: '6B7280', line: 'D5DBE5', pale: 'F3F6FB',
  red: 'E11D2E', tipBg: 'ECFDF3', tipBar: '16A34A', noteBg: 'EFF6FF', noteBar: '2563EB',
  warnBg: 'FFF7ED', warnBar: 'EA580C', stopBg: 'FEF2F2', stopBar: 'DC2626', stepBg: '0B2A5B',
};
const FONT = 'Calibri';
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134; // A4, 2 cm
const BODY_W = PAGE_W - 2 * MARGIN; // 9638 dxa
const PX_PER_DXA = 96 / 1440;
const MAX_IMG_W = Math.floor(BODY_W * PX_PER_DXA) - 4; // ≈ 638 px
const MAX_IMG_H = 620;

const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: none, bottom: none, left: none, right: none };
const thin = (color = C.line) => ({ style: BorderStyle.SINGLE, size: 4, color });

/** Inline mark-up: **bold**, `button or field name`, _italic_. */
export function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0; let m;
  const push = (t, extra = {}) => { if (t) out.push(new TextRun({ text: t, font: FONT, ...base, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('`')) push(tok.slice(1, -1), { bold: true, color: C.blue });
    else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out;
}

const para = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 }, ...opts.p,
  children: runs(text, { size: 22, color: C.ink, ...opts.r }),
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}

// Pages ignores a cell's left/right margins when it lays a table out (text then
// wraps wider than the cell and the last line is cut off), so the padding is
// put on the paragraphs instead, which every word processor honours.
const PAD = 130;
const CP = (o) => new Paragraph({ ...o, indent: { left: PAD, right: PAD, ...(o.indent || {}) } });

function cell(children, { w, fill, borders, margins, vAlign, span } = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    borders, columnSpan: span,
    verticalAlign: vAlign || VerticalAlign.TOP,
    margins: { top: 80, bottom: 80, ...(margins || {}), left: 0, right: 0 },
    children: Array.isArray(children) ? children : [children],
  });
}

function table(widths, rows, extra = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths, layout: TableLayoutType.FIXED, ...extra, rows,
  });
}

const cellBullet = (text) => CP({
  indent: { left: PAD + 330, hanging: 210, right: PAD }, spacing: { after: 40, line: 280 },
  children: [new TextRun({ text: '\u2022  ', font: FONT, size: 21, color: C.navy }), ...runs(text, { size: 21, color: C.ink })],
});
const gap = (after = 120) => new Paragraph({ spacing: { after, line: 120 }, children: [] });

// ── Vocabulary used by the content files ────────────────────────────────────
let figNo = 0; let chapNo = 0;
const missing = [];

export const p = (text) => para(text);
export const lead = (text) => para(text, { r: { size: 24, color: C.grey }, p: { spacing: { after: 200, line: 320 } } });

export function chapter(title, kicker) {
  chapNo += 1; figNo = 0;
  const out = [new Paragraph({ children: [new PageBreak()] })];
  out.push(new Paragraph({
    spacing: { before: 0, after: 40 },
    children: [new TextRun({ text: `CHAPTER ${chapNo}`, font: FONT, size: 20, bold: true, color: C.blue, characterSpacing: 40 })],
  }));
  out.push(new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 0, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.navy, space: 6 } },
    children: [new TextRun({ text: `${chapNo}. ${title}`, font: FONT, size: 40, bold: true, color: C.navy })],
  }));
  if (kicker) out.push(lead(kicker));
  return out;
}

export function part(title, sub) {
  return [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ spacing: { before: 4200, after: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title.split('—')[0].trim().toUpperCase(), font: FONT, size: 26, bold: true, color: C.blue, characterSpacing: 60 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.navy, space: 10 } }, children: [new TextRun({ text: (title.split('—')[1] || title).trim(), font: FONT, size: 56, bold: true, color: C.navy })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: runs(sub || '', { size: 24, color: C.grey }) }),
  ];
}

let h2No = 0;
export const h2 = (title) => new Paragraph({
  heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 320, after: 120 },
  children: [new TextRun({ text: title, font: FONT, size: 30, bold: true, color: C.navy })],
});
export const h3 = (title) => new Paragraph({
  heading: HeadingLevel.HEADING_3, keepNext: true, spacing: { before: 240, after: 100 },
  children: [new TextRun({ text: title, font: FONT, size: 25, bold: true, color: C.blue })],
});

export const bullets = (items) => items.map((t) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 }, spacing: { after: 70, line: 290 },
  children: runs(t, { size: 22, color: C.ink }),
}));

/** "At a glance" box that opens every screen's section. */
export function glance({ what, who, where, when }) {
  const rows = [['What it is for', what], ['Who uses it', who], ['How to open it', where], ['When to use it', when]].filter((r) => r[1]);
  const W = [2100, BODY_W - 2100];
  return [table(W, rows.map(([k, v]) => new TableRow({
    children: [
      cell(CP({ children: [new TextRun({ text: k, font: FONT, size: 20, bold: true, color: C.navy })] }), { w: W[0], fill: 'E4EBF7', borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none } }),
      cell(CP({ spacing: { line: 280 }, children: runs(v, { size: 21, color: C.ink }) }), { w: W[1], fill: C.pale, borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none } }),
    ],
  }))), gap(160)];
}

/** One numbered step: a dark number tile on the left, the instruction on the right. */
let stepNo = 0;
export const resetSteps = () => { stepNo = 0; return []; };
export function step(text, more = []) {
  stepNo += 1;
  const W = [900, BODY_W - 900];
  const body = [CP({ spacing: { after: more.length ? 80 : 0, line: 290 }, children: runs(text, { size: 22, color: C.ink }) })];
  for (const m of more) body.push(cellBullet(m));
  return [table(W, [new TableRow({
    cantSplit: true,
    children: [
      cell(CP({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'STEP', font: FONT, size: 13, bold: true, color: 'BFD0EE' }), new TextRun({ text: String(stepNo), font: FONT, size: 34, bold: true, color: 'FFFFFF', break: 1 })] }), { w: W[0], fill: C.stepBg, borders: noBorders, vAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 60, right: 60 } }),
      cell(body, { w: W[1], fill: C.pale, borders: noBorders, vAlign: VerticalAlign.CENTER, margins: { top: 110, bottom: 110 } }),
    ],
  })]), gap(110)];
}
/** Start a new procedure: a heading and step numbering back at 1. */
export function procedure(title) { stepNo = 0; return [h3(title)]; }

/** A screenshot with its caption and (optionally) what each red number means. */
export function fig(name, caption, marks = [], { maxH = MAX_IMG_H, maxW = MAX_IMG_W } = {}) {
  // shots-opt/ holds smaller copies (see optimise.sh) that keep the Word file a sensible size.
  const small = path.join(SHOTS, '../shots-opt', `${name}.png`);
  const file = fs.existsSync(small) ? small : path.join(SHOTS, `${name}.png`);
  figNo += 1;
  const label = `Figure ${chapNo}.${figNo}`;
  const out = [];
  if (!fs.existsSync(file)) {
    missing.push(name);
    out.push(para(`[missing screenshot: ${name}]`, { r: { color: C.red, bold: true } }));
  } else {
    const { w, h, data } = pngSize(file);
    const k = Math.min(maxW / w, maxH / h, 1);
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 60, after: 60 },
      border: { top: thin('B8C2D3'), bottom: thin('B8C2D3'), left: thin('B8C2D3'), right: thin('B8C2D3') },
      children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(w * k), height: Math.round(h * k) } })],
    }));
  }
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: marks.length ? 80 : 200 }, keepNext: marks.length > 0,
    children: [new TextRun({ text: `${label}  `, font: FONT, size: 18, bold: true, color: C.navy }), ...runs(caption, { size: 18, color: C.grey, italics: true })],
  }));
  if (marks.length) {
    const W = [620, BODY_W - 620];
    out.push(table(W, marks.map(([n, text]) => new TableRow({
      cantSplit: true,
      children: [
        cell(CP({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(n), font: FONT, size: 20, bold: true, color: 'FFFFFF' })] }), { w: W[0], fill: C.red, borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none }, vAlign: VerticalAlign.CENTER, margins: { top: 50, bottom: 50, left: 40, right: 40 } }),
        cell(CP({ spacing: { line: 276 }, children: runs(text, { size: 21, color: C.ink }) }), { w: W[1], fill: 'FFF5F5', borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none }, vAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 160, right: 120 } }),
      ],
    }))));
    out.push(gap(200));
  }
  return out;
}

function box(title, text, bg, bar, more = []) {
  const kids = [CP({ spacing: { after: 40 }, children: [new TextRun({ text: title, font: FONT, size: 20, bold: true, color: bar })] })];
  for (const t of [].concat(text)) kids.push(CP({ spacing: { after: 40, line: 280 }, children: runs(t, { size: 21, color: C.ink }) }));
  for (const m of more) kids.push(cellBullet(m));
  return [table([BODY_W], [new TableRow({
    cantSplit: true,
    children: [cell(kids, { w: BODY_W, fill: bg, borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 36, color: bar } }, margins: { top: 110, bottom: 90, left: 220, right: 160 } })],
  })]), gap(160)];
}
export const tip = (t, more) => box('TIP', t, C.tipBg, C.tipBar, more);
export const note = (t, more) => box('GOOD TO KNOW', t, C.noteBg, C.noteBar, more);
export const important = (t, more) => box('IMPORTANT', t, C.warnBg, C.warnBar, more);
export const warning = (t, more) => box('BE CAREFUL', t, C.stopBg, C.stopBar, more);
export const result = (t, more) => box('WHAT YOU SHOULD SEE NOW', t, C.tipBg, C.tipBar, more);

/** A plain table with a dark header row. widths are fractions of the page. */
export function grid(headers, rows, fractions) {
  const fr = fractions || headers.map(() => 1 / headers.length);
  const W = fr.map((f) => Math.round(BODY_W * f));
  W[W.length - 1] += BODY_W - W.reduce((a, b) => a + b, 0);
  const head = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => cell(CP({ children: [new TextRun({ text: h, font: FONT, size: 20, bold: true, color: 'FFFFFF' })] }), { w: W[i], fill: C.navy, borders: { top: thin(C.navy), bottom: thin(C.navy), left: thin(C.navy), right: thin(C.navy) } })),
  });
  const body = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((t, i) => cell(CP({ spacing: { line: 270 }, children: runs(String(t), { size: 20, color: C.ink, bold: i === 0 && r.length > 1 && fr[0] < 0.4 }) }), { w: W[i], fill: ri % 2 ? 'F8FAFD' : 'FFFFFF', borders: { top: thin(), bottom: thin(), left: thin(), right: thin() } })),
  }));
  return [table(W, [head, ...body]), gap(180)];
}
/** Field-by-field table for a form. */
export const fields = (rows) => grid(['Field', 'What to enter', 'Example'], rows, [0.24, 0.52, 0.24]);
/** "If this happens … do this" table. */
export const trouble = (rows) => grid(['If you see this', 'Why it happens', 'What to do'], rows, [0.3, 0.33, 0.37]);

// ── The document ────────────────────────────────────────────────────────────
function cover({ title, subtitle, version, date, audience }) {
  const logo = fs.readFileSync(LOGO);
  const meta = [['Document', title], ['Version', version], ['Date', date], ['For', audience], ['Prepared by', 'Commercial & IT team, SJVN Limited']];
  const W = [2400, 5200];
  return [
    new Paragraph({ spacing: { before: 900, after: 300 }, alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: logo, transformation: { width: 112, height: 170 } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'SJVN LIMITED', font: FONT, size: 30, bold: true, color: C.navy, characterSpacing: 80 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 }, children: [new TextRun({ text: 'A Navratna CPSE  |  Ministry of Power, Government of India', font: FONT, size: 20, color: C.grey })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'RE COMMERCIAL & TRADING PLATFORM', font: FONT, size: 24, bold: true, color: C.blue, characterSpacing: 60 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: C.navy, space: 14 } }, children: [new TextRun({ text: title, font: FONT, size: 68, bold: true, color: C.navy })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 1100 }, children: [new TextRun({ text: subtitle, font: FONT, size: 28, color: C.ink })] }),
    new Table({
      alignment: AlignmentType.CENTER, width: { size: W[0] + W[1], type: WidthType.DXA }, columnWidths: W,
      rows: meta.map(([k, v]) => new TableRow({ children: [
        cell(CP({ children: [new TextRun({ text: k, font: FONT, size: 20, bold: true, color: C.navy })] }), { w: W[0], fill: 'E4EBF7', borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none } }),
        cell(CP({ children: [new TextRun({ text: v, font: FONT, size: 20, color: C.ink })] }), { w: W[1], fill: C.pale, borders: { top: thin('FFFFFF'), bottom: thin('FFFFFF'), left: none, right: none } }),
      ] })),
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900 }, children: [new TextRun({ text: 'For internal use of SJVN and its registered sellers and buyers', font: FONT, size: 18, italics: true, color: C.grey })] }),
  ];
}

export async function build(outFile, meta, blocks) {
  const children = [
    ...cover(meta),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.navy, space: 6 } }, children: [new TextRun({ text: 'Contents', font: FONT, size: 40, bold: true, color: C.navy })] }),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
    ...blocks.flat(Infinity),
  ];
  const doc = new Document({
    creator: 'SJVN Limited', title: meta.title, description: meta.subtitle,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 40, bold: true, color: C.navy }, paragraph: { spacing: { before: 0, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 30, bold: true, color: C.navy }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 25, bold: true, color: C.blue }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1300, bottom: 1200, left: MARGIN, right: MARGIN } }, titlePage: true },
      headers: {
        default: new Header({ children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: BODY_W }], spacing: { after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line, space: 6 } },
          children: [new TextRun({ text: 'SJVN  |  RE Commercial & Trading Platform', font: FONT, size: 17, bold: true, color: C.navy }), new TextRun({ text: `\t${meta.title}`, font: FONT, size: 17, color: C.grey })],
        })] }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: BODY_W }],
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.line, space: 6 } },
          children: [new TextRun({ text: `${meta.version}  ·  ${meta.date}`, font: FONT, size: 17, color: C.grey }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT], font: FONT, size: 17, color: C.grey })],
        })] }),
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
      },
      children,
    }],
  });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  if (missing.length) console.warn(`Missing screenshots (${missing.length}): ${missing.join(', ')}`);
  console.log(`Wrote ${outFile}`);
}
