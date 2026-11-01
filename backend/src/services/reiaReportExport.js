/**
 * A REIA report (services/reiaReports.js runReport) as a file: CSV or Excel
 * here, PDF in scripts/reiaReportPdf.js. All three carry the same rows, group subtotals and grand total as the
 * screen, and say at the top what the report was filtered on, so a sheet that
 * travels on its own still says what it is.
 */
import XLSX from 'xlsx';

export const NUMERIC = new Set(['money', 'mwh', 'number', 'int', 'percent', 'rate', 'mw', 'days']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored UTC timestamp as Indian time, "2026-10-29 09:55". */
export function istStamp(v) {
  const d = new Date(`${String(v).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'}`);
  if (Number.isNaN(d.getTime())) return String(v);
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16).replace('T', ' ');
}

/** A cell as a file shows it: labels for codes, numbers as numbers. */
function cellValue(c, v) {
  if (v === null || v === undefined || v === '') return '';
  if (c.labels && Object.prototype.hasOwnProperty.call(c.labels, v)) return c.labels[v];
  if (c.type === 'enum') return String(v).replace(/_/g, ' ');
  if (NUMERIC.has(c.type)) return Number(v);
  if (c.type === 'datetime') return istStamp(v);
  return String(v);
}

/** The same cell as printed on a page. */
export function printed(c, v) {
  if (v === null || v === undefined || v === '') return '';
  if (c.labels && Object.prototype.hasOwnProperty.call(c.labels, v)) return c.labels[v];
  if (c.type === 'enum') return String(v).replace(/_/g, ' ');
  const n = Number(v);
  switch (c.type) {
    case 'money': return `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    case 'mwh': case 'mw': case 'number': return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
    case 'rate': return n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
    case 'percent': return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
    case 'int': case 'days': return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(v);
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})/.exec(String(v));
      return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(v);
    }
    case 'datetime': return istStamp(v);
    default: return String(v);
  }
}

/**
 * The report as rows of cells, top to bottom: title, criteria, header, then
 * the data with a heading and a subtotal line per group, then the total.
 */
function layout(report, value) {
  const cols = report.columns;
  const lines = [];
  const kinds = [];
  const push = (cells, kind) => { lines.push(cells); kinds.push(kind); };
  const totalRow = (label, totals, count) => cols.map((c, i) => {
    if (i === 0) return `${label} (${count} ${count === 1 ? 'row' : 'rows'})`;
    return c.agg === 'sum' ? value(c, totals[c.key] ?? 0) : '';
  });

  push(cols.map((c) => c.label), 'head');
  if (report.groups) {
    for (const g of report.groups) {
      if (!report.spec.summary) push([`${report.group_column.label}: ${g.label}`, ...cols.slice(1).map(() => '')], 'group');
      for (const r of g.rows) push(cols.map((c) => value(c, r[c.key])), 'row');
      push(totalRow(report.spec.summary ? g.label : `Subtotal — ${g.label}`, g.subtotals, g.count), 'subtotal');
    }
  } else {
    for (const r of report.rows) push(cols.map((c) => value(c, r[c.key])), 'row');
  }
  push(totalRow('Total', report.totals, report.count), 'total');
  return { lines, kinds };
}

function preamble(report) {
  const out = [
    [`SJVN Limited — ${report.title}`],
    [`Generated ${istStamp(report.generated_at)} IST${report.generated_by ? ` by ${report.generated_by}` : ''}`],
  ];
  if (report.criteria.length) out.push([`Criteria: ${report.criteria.join('; ')}`]);
  if (report.scope_note) out.push([report.scope_note]);
  if (report.truncated) out.push([`Showing the first ${report.rows?.length ?? ''} of ${report.count} rows; narrow the filters for the rest.`]);
  out.push([]);
  return out;
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A leading = + - @ would be run as a formula by a spreadsheet opening the file.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportCsv(report) {
  const { lines } = layout(report, cellValue);
  const all = [...preamble(report), ...lines];
  // The byte-order mark makes Excel read the rupee sign and Hindi names as UTF-8.
  return `﻿${all.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function reportXlsx(report) {
  const { lines } = layout(report, cellValue);
  const top = preamble(report);
  const ws = XLSX.utils.aoa_to_sheet([...top, ...lines]);
  ws['!cols'] = report.columns.map((c) => ({ wch: Math.min(40, Math.max(10, c.label.length + 2, NUMERIC.has(c.type) ? 14 : 18)) }));
  // Money to two places with Indian grouping; the rest as they came.
  const first = top.length + 1;
  const range = XLSX.utils.decode_range(ws['!ref']);
  report.columns.forEach((c, ci) => {
    if (c.type !== 'money') return;
    for (let r = first; r <= range.e.r; r += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (cell && cell.t === 'n') cell.z = '#,##,##0.00';
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
