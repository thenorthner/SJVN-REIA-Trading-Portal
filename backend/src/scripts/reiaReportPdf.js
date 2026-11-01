/**
 * A REIA report (services/reiaReports.js runReport) as a PDF, in the platform's
 * report family (reportPdfKit.js). Portrait up to seven columns, landscape
 * beyond; group headings run across the page, subtotals and the total are
 * tinted bands.
 */
import { newDoc, header, kpiBand, notes, table, pageNumbers, contentW, ensureSpace, NAVY_SOFT } from './reportPdfKit.js';
import { NUMERIC, istStamp, printed } from '../services/reiaReportExport.js';

// The built-in fonts are WinAnsi (tests/reia/s26-pdf-glyphs). The report's own
// labels and the records carry a few characters outside it: the rupee sign,
// arrows, the minus sign. They are written in words; anything else outside
// the font becomes "?" rather than a silently wrong glyph.
const SWAPS = [[/\u20B9\s?/g, 'Rs '], [/\u2192/g, 'to'], [/\u2190/g, 'from'], [/\u2194/g, '<->'], [/\u2212/g, '-'], [/\u0394/g, 'delta']];
const WINANSI_EXTRA = new Set([...'\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178']);
export function pdfSafe(text) {
  let s = String(text ?? '');
  for (const [re, to] of SWAPS) s = s.replace(re, to);
  return [...s].map((ch) => (ch.codePointAt(0) < 0x100 || WINANSI_EXTRA.has(ch) ? ch : '?')).join('');
}

// Relative width a column wants on the page.
const WEIGHT = { text: 1.6, enum: 1.25, money: 1.15, mwh: 1, number: 0.9, int: 0.7, days: 0.7, percent: 0.75, rate: 0.85, mw: 0.85, date: 0.95, datetime: 1.2, month: 0.8 };

export function generateReiaReportPdf(report, res, filename) {
  const cols = report.columns;
  const landscape = cols.length > 7;
  const doc = newDoc(res, pdfSafe(report.title), filename, { layout: landscape ? 'landscape' : 'portrait' });
  // The criteria are listed in full under the band; the band names the dataset.
  const ctx = {
    vertical: 'REIA – Billing & Settlement',
    title: pdfSafe(report.title),
    subtitle: pdfSafe(report.title === report.dataset_title ? `${report.count} ${report.count === 1 ? 'record' : 'records'}` : report.dataset_title),
    generatedAt: `${istStamp(report.generated_at)} IST`,
  };
  header(doc, ctx);
  let y = 80;

  const sums = cols.filter((c) => c.agg === 'sum').slice(0, 3);
  y = kpiBand(doc, y, [
    { label: 'Rows', value: report.count.toLocaleString('en-IN') },
    ...sums.map((c) => ({ label: pdfSafe(`Total ${c.label}`), value: pdfSafe(printed(c, report.totals[c.key] ?? 0)) })),
  ]);
  const lines = [
    ...report.criteria.map((t) => `Criteria — ${t}`),
    ...(report.scope_note ? [report.scope_note] : []),
    ...(report.truncated ? [`The first ${report.rows?.length ?? ''} of ${report.count} rows are printed; narrow the filters for the rest.`] : []),
    ...cols.filter((c) => c.note).map((c) => `${c.label}: ${c.note}`),
    ...(report.generated_by ? [`Prepared by ${report.generated_by} from the REIA desk's records on the platform.`] : []),
  ];
  if (lines.length) y = notes(doc, y, lines.map(pdfSafe)) + 6;

  const width = contentW(doc);
  const weights = cols.map((c) => WEIGHT[c.type] || 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const pdfCols = cols.map((c, i) => ({
    label: pdfSafe(c.label),
    w: (weights[i] / sum) * width,
    align: NUMERIC.has(c.type) ? 'right' : 'left',
    // A heading or total line fills the cells it has nothing for with a space,
    // not the dash the table prints for a missing value.
    value: (r) => {
      if (r.__kind && i === 0) return pdfSafe(r.__label);
      if (r.__kind) return c.agg === 'sum' && r.__kind !== 'group' ? pdfSafe(printed(c, r[c.key])) : ' ';
      return pdfSafe(printed(c, r[c.key]));
    },
  }));
  const fontSize = cols.length > 12 ? 6 : 7;
  const style = (r) => (r.__kind === 'subtotal' ? { bold: true, fill: NAVY_SOFT } : r.__kind === 'total' ? { bold: true, fill: '#dde6f3' } : r.__kind === 'group' ? { bold: true, span: true } : null);
  const sumRow = (label, totals, count, kind) => ({
    __kind: kind,
    __label: `${label} (${count})`,
    ...Object.fromEntries(cols.filter((c) => c.agg === 'sum').map((c) => [c.key, totals[c.key] ?? 0])),
  });

  // A group printed as its values are ("Oct 2026", "30 Nov 2026").
  const groupName = (g) => (g.key === '' ? g.label : printed(report.group_column, g.key) || g.label);
  const rows = [];
  if (report.groups) {
    for (const g of report.groups) {
      if (!report.spec.summary) rows.push({ __kind: 'group', __label: `${report.group_column.label}: ${groupName(g)}` });
      rows.push(...g.rows);
      rows.push(sumRow(report.spec.summary ? groupName(g) : 'Subtotal', g.subtotals, g.count, 'subtotal'));
    }
  } else {
    rows.push(...report.rows);
  }
  rows.push(sumRow('Total', report.totals, report.count, 'total'));

  y = ensureSpace(doc, y, 60, ctx);
  table(doc, y, pdfCols, rows, ctx, { fontSize, rowStyle: style, emptyMessage: 'No records match these criteria.' });
  pageNumbers(doc);
  doc.end();
}
