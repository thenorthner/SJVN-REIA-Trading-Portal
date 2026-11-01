import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import { Tabs, Tab } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';
import { showAlert, askConfirm } from '../../lib/dialogs.js';
import './ReiaReportsTab.css';

/**
 * The REIA Dashboard's Reports tab: the predefined reports (one click each),
 * a builder for a report of one's own, and the layouts people saved.
 *
 * Everything a report can be built from comes from the API's catalogue
 * (/api/reports/reia/catalog), which is already cut to what the signed-in
 * reader may see. This screen only arranges the keys the catalogue lists; the
 * API checks every key again and runs the query itself.
 */

const NUMERIC = new Set(['money', 'mwh', 'number', 'int', 'percent', 'rate', 'mw', 'days']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Rows drawn at a time; the totals and the exports always cover every row.
const PAGE = 500;
// A spec travels in the address of a GET. Past this it risks the proxy's
// request-line limit, so it is refused here with a reason rather than there.
const MAX_SPEC_CHARS = 6000;

const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback;
const blank = (v) => v === null || v === undefined || v === '';

const num = (v, digits) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits });
const money = (v) => {
  const n = Number(v);
  const text = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 && Number(text.replace(/,/g, '')) !== 0 ? '-' : ''}₹${text}`;
};

/** A value as the screen shows it: labels for codes, Indian grouping, real dates. */
export function cellText(c, v) {
  if (blank(v)) return '—';
  if (c.labels && Object.prototype.hasOwnProperty.call(c.labels, v)) return c.labels[v];
  switch (c.type) {
    case 'enum': return String(v).replace(/_/g, ' ');
    case 'money': return money(v);
    case 'mwh': case 'mw': case 'number': return num(v, 3);
    case 'rate': return num(v, 4);
    case 'percent': return `${num(v, 2)}%`;
    case 'int': case 'days': return num(v, 0);
    case 'date': return fmtDate(v, String(v));
    case 'datetime': return fmtDateTime(v, String(v));
    case 'month': {
      const m = /^(\d{4})-(\d{2})/.exec(String(v));
      return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(v);
    }
    default: return String(v);
  }
}

// ── Date ranges ──────────────────────────────────────────────────────────────

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The usual periods, the financial year running April to March. */
export function quickPeriods(today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const fy = m >= 3 ? y : y - 1;
  const q = Math.floor(m / 3) * 3;
  const daysBack = (n) => iso(new Date(y, m, today.getDate() - n));
  const fyLabel = (start) => `FY ${start}-${String(start + 1).slice(2)}`;
  return [
    { id: 'this-month', label: 'This month', range: [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))] },
    { id: 'last-month', label: 'Last month', range: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))] },
    { id: 'this-quarter', label: 'This quarter', range: [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))] },
    { id: 'this-fy', label: `This financial year (${fyLabel(fy)})`, range: [`${fy}-04-01`, `${fy + 1}-03-31`] },
    { id: 'last-fy', label: `Last financial year (${fyLabel(fy - 1)})`, range: [`${fy - 1}-04-01`, `${fy}-03-31`] },
    { id: 'last-30', label: 'Last 30 days', range: [daysBack(30), iso(today)] },
    { id: 'last-90', label: 'Last 90 days', range: [daysBack(90), iso(today)] },
  ];
}

// ── The builder's state, and the spec it makes ───────────────────────────────

const isRangeDate = (c) => c.ops.includes('between') && (c.type === 'date' || c.type === 'datetime');
const defaultColumns = (ds) => ds.columns.filter((c) => c.default).map((c) => c.key);
const padSort = (sort) => {
  const s = (sort || []).slice(0, 2).map((x) => ({ key: x.key, dir: x.dir === 'desc' ? 'desc' : 'asc' }));
  while (s.length < 2) s.push({ key: '', dir: 'asc' });
  return s;
};

/** A spec (a preset's, a saved one's, or the last run's) as the builder's fields. */
export function builderFrom(spec, ds) {
  const cols = new Map(ds.columns.map((c) => [c.key, c]));
  let range = { key: ds.columns.find(isRangeDate)?.key || '', from: '', to: '' };
  let rangeTaken = false;
  const filters = [];
  for (const f of spec?.filters || []) {
    const c = cols.get(f.key);
    if (!c) continue;
    const [lo, hi] = Array.isArray(f.value) ? f.value : [];
    if (f.op === 'between' && isRangeDate(c) && !rangeTaken) {
      range = { key: c.key, from: lo ?? '', to: hi ?? '' };
      rangeTaken = true;
    } else if (f.op === 'in') {
      filters.push({ key: c.key, op: 'in', value: (Array.isArray(f.value) ? f.value : [f.value]).map(String) });
    } else if (f.op === 'between') {
      filters.push({ key: c.key, op: 'between', value: [lo ?? '', hi ?? ''] });
    } else {
      filters.push({ key: c.key, op: f.op, value: String(f.value ?? '') });
    }
  }
  return {
    dataset: ds.key,
    name: spec?.title || '',
    columns: (spec?.columns?.length ? spec.columns : defaultColumns(ds)).filter((k) => cols.has(k)),
    range,
    filters,
    groupBy: spec?.group_by && cols.get(spec.group_by)?.group ? spec.group_by : '',
    summary: !!spec?.summary && !!spec?.group_by,
    sort: padSort(spec?.sort?.length ? spec.sort : ds.default_sort),
  };
}

/** The builder's fields as the spec the API takes. */
export function specOf(b) {
  const filters = [];
  if (b.range.key && (b.range.from || b.range.to)) {
    filters.push({ key: b.range.key, op: 'between', value: [b.range.from || null, b.range.to || null] });
  }
  for (const f of b.filters) {
    if (f.op === 'in') { if (f.value.length) filters.push({ key: f.key, op: 'in', value: f.value }); }
    else if (f.op === 'between') {
      const [lo, hi] = f.value;
      if (!blank(lo) || !blank(hi)) filters.push({ key: f.key, op: 'between', value: [blank(lo) ? null : lo, blank(hi) ? null : hi] });
    } else if (String(f.value).trim()) filters.push({ key: f.key, op: f.op, value: String(f.value).trim() });
  }
  const spec = {
    dataset: b.dataset,
    columns: b.columns,
    filters,
    group_by: b.groupBy || null,
    sort: b.sort.filter((s) => s.key),
    summary: !!b.groupBy && b.summary,
  };
  if (b.name.trim()) spec.title = b.name.trim();
  return spec;
}

/** What is wrong with a pair of from/to values, in words; null when nothing is. */
export function pairProblem(c, lo, hi) {
  if (c.type === 'month') {
    const bad = [lo, hi].find((v) => !blank(v) && !/^\d{4}-\d{2}$/.test(v));
    if (bad) return `"${c.label}" takes a month as YYYY-MM (for example 2026-04).`;
  }
  if (blank(lo) || blank(hi)) return null;
  const after = NUMERIC.has(c.type) ? Number(lo) > Number(hi) : String(lo) > String(hi);
  if (!after) return null;
  if (NUMERIC.has(c.type)) return `"${c.label}": the minimum is more than the maximum.`;
  return `"${c.label}": the "from" ${c.type === 'month' ? 'month' : 'date'} is after the "to" ${c.type === 'month' ? 'month' : 'date'}.`;
}

/** Every reason the builder's report cannot be run, so all are shown at once. */
export function builderProblems(b, ds) {
  const out = [];
  if (!ds) return ['Choose what the report is about.'];
  const cols = new Map(ds.columns.map((c) => [c.key, c]));
  if (!b.columns.length) out.push('Pick at least one column to show.');
  if (b.columns.length > 40) out.push('A report can show at most 40 columns.');
  if (b.range.key) {
    const p = pairProblem(cols.get(b.range.key), b.range.from, b.range.to);
    if (p) out.push(p);
  }
  for (const f of b.filters) {
    const c = cols.get(f.key);
    if (!c) continue;
    if (f.op === 'between') {
      const p = pairProblem(c, f.value[0], f.value[1]);
      if (p) out.push(p);
    } else if (f.op === 'contains' && String(f.value).trim().length > 100) {
      out.push(`The search in "${c.label}" is longer than 100 characters.`);
    } else if (f.op === 'in' && f.value.length > 200) {
      out.push(`"${c.label}": pick at most 200 values.`);
    }
  }
  return out;
}

const tooLong = (spec) => encodeURIComponent(JSON.stringify(spec)).length > MAX_SPEC_CHARS;
const TOO_LONG = 'So many values are picked in the filters that the request is too long to send. Pick fewer values, or filter on something broader.';

// ── Pieces ───────────────────────────────────────────────────────────────────

/** A dropdown of checkboxes, for a filter on a fixed set of values. */
function MultiSelect({ id, label, labelledBy, options, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const chosen = new Set(value);
  // A value picked earlier (a preset's statuses) stays listed even when no row has it now.
  const all = [...(options || [])];
  for (const v of value) if (!all.some((o) => o.value === v)) all.push({ value: v, label: v.replace(/_/g, ' ') });
  const labelOf = (v) => all.find((o) => o.value === v)?.label ?? v;
  const shown = q ? all.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : all;
  const toggle = (v) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary = !value.length ? 'Any' : value.length === 1 ? labelOf(value[0]) : `${value.length} selected`;

  return (
    <div className="rr-multi" ref={box}>
      <button type="button" id={id} className="rr-multi-btn" aria-expanded={open} aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined} onClick={() => setOpen((o) => !o)}>
        <span>{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="rr-multi-pop" role="group" aria-label={label}>
          {all.length > 8 && (
            <input type="search" className="rr-input" placeholder="Search…" aria-label={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div className="rr-multi-list">
            {shown.map((o) => (
              <label key={o.value} className="rr-check">
                <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
            {!shown.length && <div className="rr-muted">{loading ? 'Loading values…' : 'No values to pick from.'}</div>}
          </div>
          <div className="rr-multi-foot">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => onChange([])} disabled={!value.length}>Clear</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** From and to boxes for a date, month or amount; a reversed pair is said on leaving the box. */
function RangeInput({ c, value, onChange, idBase }) {
  if (!c) return null;
  const [lo, hi] = value;
  const type = c.type === 'month' ? 'month' : c.type === 'date' || c.type === 'datetime' ? 'date' : 'number';
  const words = type === 'number' ? ['Minimum', 'Maximum'] : ['From', 'To'];
  const check = (nextLo, nextHi) => {
    const p = pairProblem(c, nextLo, nextHi);
    if (p) showAlert(p, { title: 'Please check this filter', tone: 'warning' });
  };
  return (
    <div className="rr-pair">
      {[0, 1].map((i) => (
        <label key={i} className="field rr-field-inline" htmlFor={`${idBase}-${i}`}>
          <span className="field-label">{words[i]}</span>
          <input
            id={`${idBase}-${i}`}
            type={type}
            step={type === 'number' ? 'any' : undefined}
            placeholder={type === 'month' ? 'YYYY-MM' : undefined}
            value={value[i] ?? ''}
            onChange={(e) => onChange(i === 0 ? [e.target.value, hi] : [lo, e.target.value])}
            onBlur={(e) => check(i === 0 ? e.target.value : lo, i === 1 ? e.target.value : hi)}
          />
        </label>
      ))}
    </div>
  );
}

const filterKind = (c) => {
  if (c.ops.includes('between')) return ['date', 'datetime', 'month'].includes(c.type) ? 'Dates and periods' : 'Amounts and figures';
  if (c.ops.includes('contains')) return 'Search text';
  return c.user ? 'People' : 'Parties, status and type';
};
const KIND_ORDER = ['Parties, status and type', 'People', 'Dates and periods', 'Amounts and figures', 'Search text'];

function ReportCard({ title, blurb, meta, children }) {
  return (
    <div className="rr-card">
      <h4>{title}</h4>
      {blurb && <p>{blurb}</p>}
      {meta && <div className="rr-card-meta">{meta}</div>}
      <div className="rr-card-actions">{children}</div>
    </div>
  );
}

/** The report on screen: group headings, subtotals and the grand total, as the files carry them. */
function ReportResult({ report, onExport, exporting, onCustomise }) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [report]);
  const cols = report.columns;
  const summary = !!report.spec.summary;
  const lines = useMemo(() => {
    const out = [];
    if (report.groups) {
      for (const g of report.groups) {
        if (!summary) out.push({ kind: 'group', g });
        for (const r of g.rows) out.push({ kind: 'row', r });
        out.push({ kind: 'subtotal', g });
      }
    } else for (const r of report.rows) out.push({ kind: 'row', r });
    return out;
  }, [report, summary]);
  // A total's label spans the columns before the first figure that adds up.
  const firstSum = cols.findIndex((c) => c.agg === 'sum');
  const lead = firstSum === -1 ? cols.length : Math.max(firstSum, 1);
  const rowsWord = (n) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'row' : 'rows'}`;
  const cls = (c) => (NUMERIC.has(c.type) ? 'num' : undefined);
  // Codes and numbers stay on one line; a long name or remark wraps in a readable measure.
  const cell = (c, v) => {
    const t = cellText(c, v);
    return c.type === 'text' && t.length > 28 ? <span className="rr-long">{t}</span> : t;
  };
  const groupName = (g) => (g.key === '' ? '(blank)' : cellText(report.group_column, g.key));
  const shownCount = report.rows ? report.rows.length : (report.groups || []).reduce((n, g) => n + g.count, 0);

  const totalCells = (label, totals, key) => {
    // When the first column itself adds up, its figure rides with the label.
    const text = firstSum === 0 ? `${label}: ${cellText(cols[0], totals[cols[0].key] ?? 0)}` : label;
    return (
      <>
        <td colSpan={lead}>{text}</td>
        {cols.slice(lead).map((c) => (
          <td key={`${key}-${c.key}`} className={cls(c)}>{c.agg === 'sum' ? cellText(c, totals[c.key] ?? 0) : ''}</td>
        ))}
      </>
    );
  };

  const empty = report.count === 0;
  return (
    <div className="rr-panel rr-result" aria-live="polite">
      <div className="rr-result-head">
        <div>
          <h3>{report.title}</h3>
          <div className="rr-meta">
            {report.title !== report.dataset_title && <>{report.dataset_title} · </>}
            {rowsWord(report.count)} · prepared {fmtDateTime(report.generated_at)}
          </div>
          {report.criteria.length > 0 && (
            <ul className="rr-criteria" aria-label="Filters applied">
              {report.criteria.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
        </div>
        <div className="rr-actions">
          {onCustomise && <button type="button" className="btn btn-outline" onClick={onCustomise}>Change this report</button>}
          {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([f, label]) => (
            <button key={f} type="button" className="btn btn-secondary" disabled={!!exporting} onClick={() => onExport(f)}>
              {exporting === f ? 'Preparing…' : `Download ${label}`}
            </button>
          ))}
        </div>
      </div>
      {report.scope_note && <div className="rr-scope">{report.scope_note}</div>}
      {report.truncated && (
        <div className="rr-note" role="status">
          Only the first {shownCount.toLocaleString('en-IN')} of {rowsWord(report.count)} are in this report and its totals. Narrow the filters to see the rest.
        </div>
      )}

      {empty ? (
        <div className="rr-empty">No records match this report. Try a wider date range or fewer filters.</div>
      ) : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={report.title}>
            <table className="data-table rr-table">
              <thead>
                <tr>{cols.map((c) => <th key={c.key} scope="col" className={NUMERIC.has(c.type) ? 'num' : undefined} title={c.note || undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {lines.slice(0, limit).map((l, i) => {
                  if (l.kind === 'group') {
                    return (
                      <tr key={`g-${l.g.key}-${i}`} className="rr-group-row">
                        <td colSpan={cols.length}>{report.group_column.label}: {groupName(l.g)}</td>
                      </tr>
                    );
                  }
                  if (l.kind === 'subtotal') {
                    const name = summary ? groupName(l.g) : `Subtotal — ${groupName(l.g)}`;
                    return (
                      <tr key={`s-${l.g.key}-${i}`} className={summary ? 'rr-summary-row' : 'rr-subtotal'}>
                        {summary
                          ? cols.map((c, ci) => (
                            <td key={c.key} className={cls(c)}>
                              {ci === 0 ? `${name} (${rowsWord(l.g.count)})` : c.agg === 'sum' ? cellText(c, l.g.subtotals[c.key] ?? 0) : ''}
                            </td>
                          ))
                          : totalCells(`${name} (${rowsWord(l.g.count)})`, l.g.subtotals, `s${i}`)}
                      </tr>
                    );
                  }
                  return (
                    <tr key={`r-${i}`}>
                      {cols.map((c) => <td key={c.key} className={cls(c)}>{cell(c, l.r[c.key])}</td>)}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="rr-total">{totalCells(`Total (${rowsWord(shownCount)})`, report.totals, 'total')}</tr>
              </tfoot>
            </table>
          </div>
          {lines.length > limit && (
            <div className="rr-more">
              <span>Showing {limit.toLocaleString('en-IN')} of {lines.length.toLocaleString('en-IN')} lines. The totals and the downloads cover them all.</span>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setLimit((n) => n + PAGE)}>Show {PAGE} more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function ReiaReportsTab() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [templates, setTemplates] = useState([]);
  const [view, setView] = useState('presets');
  const [builder, setBuilder] = useState(null);
  const [facets, setFacets] = useState({});
  const [result, setResult] = useState(null);
  const [resultFrom, setResultFrom] = useState(null);
  const [running, setRunning] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const resultRef = useRef(null);

  const loadTemplates = () => api.reports.reia.templates().then(setTemplates).catch(() => setTemplates([]));
  useEffect(() => {
    api.reports.reia.catalog()
      .then((cat) => {
        setCatalog(cat);
        if (cat.datasets[0]) setBuilder(builderFrom({}, cat.datasets[0]));
      })
      .catch((err) => setLoadError(errText(err, 'The reports could not be loaded.')));
    loadTemplates();
  }, []);

  const dsOf = (key) => catalog?.datasets.find((d) => d.key === key) || null;
  const ds = builder ? dsOf(builder.dataset) : null;

  // The values each filter can take, fetched once per dataset.
  const dsKey = builder?.dataset;
  const askedFacets = useRef(new Set());
  useEffect(() => {
    if (!dsKey || askedFacets.current.has(dsKey)) return;
    askedFacets.current.add(dsKey);
    setFacets((f) => ({ ...f, [dsKey]: { loading: true } }));
    api.reports.reia.facets(dsKey)
      .then((v) => setFacets((f) => ({ ...f, [dsKey]: { values: v } })))
      .catch(() => setFacets((f) => ({ ...f, [dsKey]: { values: {} } })));
  }, [dsKey]);

  const presetGroups = useMemo(() => {
    const out = [];
    for (const p of catalog?.presets || []) {
      let g = out.find((x) => x.name === p.group);
      if (!g) out.push((g = { name: p.group, presets: [] }));
      g.presets.push(p);
    }
    return out;
  }, [catalog]);

  if (loadError) return <div className="rr-panel rr-empty">{loadError}</div>;
  if (!catalog) return <div className="page-loading">Loading reports…</div>;
  if (!catalog.datasets.length) return <div className="rr-panel rr-empty">No reports are available to your role.</div>;

  async function run(spec, from) {
    if (tooLong(spec)) { showAlert(TOO_LONG, { title: 'Please narrow the filters', tone: 'warning' }); return; }
    setRunning(from?.id || 'builder');
    try {
      const r = await api.reports.reia.run(spec);
      setResult(r);
      setResultFrom(from || null);
      setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0);
    } catch (err) {
      showAlert(errText(err, 'The report could not be prepared.'));
    } finally {
      setRunning(null);
    }
  }

  async function exportAs(format) {
    setExporting(format);
    try {
      await api.reports.reia.download(result.spec, format);
    } catch (err) {
      showAlert(errText(err, 'The file could not be prepared.'));
    } finally {
      setExporting(null);
    }
  }

  /** Open a spec in the builder; a saved report of one's own keeps its sharing. */
  function customise(spec, template) {
    const d = dsOf(spec.dataset);
    if (!d) return;
    setBuilder(builderFrom(spec, d));
    setShare(!!template?.mine && !!template.shared);
    setView('custom');
  }

  const set = (patch) => setBuilder((b) => ({ ...b, ...patch }));

  function pickDataset(key) {
    const d = dsOf(key);
    if (d) setBuilder(builderFrom({}, d));
  }

  function checkAndRun() {
    const problems = builderProblems(builder, ds);
    if (problems.length) {
      showAlert(problems.join('\n'), { title: 'The report cannot be run yet', tone: 'warning' });
      return;
    }
    run(specOf(builder), null);
  }

  async function saveLayout() {
    const name = builder.name.trim();
    const problems = [...(name ? [] : ['Give the report a name to save it under.']), ...builderProblems(builder, ds)];
    if (problems.length) {
      showAlert(problems.join('\n'), { title: 'The report cannot be saved yet', tone: 'warning' });
      return;
    }
    const spec = specOf(builder);
    if (tooLong(spec)) { showAlert(TOO_LONG, { title: 'Please narrow the filters', tone: 'warning' }); return; }
    const same = templates.find((t) => t.mine && t.name.toLowerCase() === name.toLowerCase());
    if (same && !(await askConfirm(`You already have a saved report called "${same.name}". Replace it with this layout?`, { okLabel: 'Replace' }))) return;
    setSaving(true);
    try {
      await api.reports.reia.saveTemplate({ name, spec, shared: catalog.can_share && share });
      await loadTemplates();
      showAlert(`Saved as "${name}". It is under Saved reports.`, { title: 'Report saved', tone: 'success' });
    } catch (err) {
      showAlert(errText(err, 'The report could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(t) {
    if (!(await askConfirm(`Remove the saved report "${t.name}"? The data it reports on is not touched.`, { okLabel: 'Remove' }))) return;
    try {
      await api.reports.reia.deleteTemplate(t.id);
      await loadTemplates();
    } catch (err) {
      showAlert(errText(err, 'The saved report could not be removed.'));
    }
  }

  // ── The builder's sections ──
  const colMap = ds ? new Map(ds.columns.map((c) => [c.key, c])) : new Map();
  const facetOf = (key) => facets[ds?.key]?.values?.[key];
  const facetsLoading = !!facets[ds?.key]?.loading;
  const rangeCols = ds ? ds.columns.filter(isRangeDate) : [];
  const usedFilters = new Set([...(builder?.filters || []).map((f) => f.key), ...(builder?.range.key ? [builder.range.key] : [])]);
  const addable = ds ? ds.columns.filter((c) => c.ops.length && !usedFilters.has(c.key)) : [];

  function toggleColumn(key) {
    set({ columns: builder.columns.includes(key) ? builder.columns.filter((k) => k !== key) : [...builder.columns, key] });
  }
  function moveColumn(i, by) {
    const next = [...builder.columns];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set({ columns: next });
  }
  function addFilter(key) {
    const c = colMap.get(key);
    if (!c) return;
    const op = c.ops[0];
    set({ filters: [...builder.filters, { key, op, value: op === 'in' ? [] : op === 'between' ? ['', ''] : '' }] });
  }
  const updateFilter = (i, value) => set({ filters: builder.filters.map((f, j) => (j === i ? { ...f, value } : f)) });
  const removeFilter = (i) => set({ filters: builder.filters.filter((_, j) => j !== i) });
  const setSort = (i, patch) => set({ sort: builder.sort.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const groupable = ds ? ds.columns.filter((c) => c.group) : [];

  const builderView = builder && ds && (
    <div className="rr-panel">
      <div className="rr-row">
        <label className="field rr-grow" htmlFor="rr-dataset">
          <span className="field-label">Report on</span>
          <select id="rr-dataset" value={builder.dataset} onChange={(e) => pickDataset(e.target.value)}>
            {catalog.datasets.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
          </select>
        </label>
        <label className="field rr-grow" htmlFor="rr-name">
          <span className="field-label">Report name (optional; printed as the title)</span>
          <input id="rr-name" type="text" maxLength={80} value={builder.name} placeholder={ds.title} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      {ds.blurb && <p className="rr-muted rr-tight">{ds.blurb}</p>}

      <section className="rr-section" aria-labelledby="rr-h-columns">
        <div className="rr-section-head">
          <h4 id="rr-h-columns">Columns</h4>
          <div className="rr-actions">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => set({ columns: defaultColumns(ds) })}>Usual columns</button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => set({ columns: ds.columns.slice(0, 40).map((c) => c.key) })}>All</button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => set({ columns: [] })}>None</button>
          </div>
        </div>
        <div className="rr-columns">
          {ds.columns.map((c) => (
            <label key={c.key} className="rr-check" title={c.note || undefined}>
              <input type="checkbox" checked={builder.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        {builder.columns.length > 0 && (
          <>
            <div className="rr-sub">Order in the report</div>
            <ol className="rr-chips" aria-label="Column order">
              {builder.columns.map((k, i) => (
                <li key={k} className="rr-chip">
                  <button type="button" aria-label={`Move ${colMap.get(k)?.label} earlier`} disabled={i === 0} onClick={() => moveColumn(i, -1)}>‹</button>
                  <span>{colMap.get(k)?.label || k}</span>
                  <button type="button" aria-label={`Move ${colMap.get(k)?.label} later`} disabled={i === builder.columns.length - 1} onClick={() => moveColumn(i, 1)}>›</button>
                  <button type="button" aria-label={`Remove ${colMap.get(k)?.label}`} onClick={() => toggleColumn(k)}>×</button>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="rr-section" aria-labelledby="rr-h-filters">
        <h4 id="rr-h-filters">Filters</h4>
        {rangeCols.length > 0 && (
          <div className="rr-row">
            <label className="field" htmlFor="rr-range-key">
              <span className="field-label">Date range on</span>
              <select id="rr-range-key" value={builder.range.key} onChange={(e) => set({ range: { ...builder.range, key: e.target.value } })}>
                {rangeCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="field" htmlFor="rr-quick">
              <span className="field-label">Period</span>
              <select
                id="rr-quick"
                value=""
                onChange={(e) => {
                  const q = quickPeriods().find((x) => x.id === e.target.value);
                  if (q) set({ range: { ...builder.range, from: q.range[0], to: q.range[1] } });
                }}
              >
                <option value="">Pick a period…</option>
                {quickPeriods().map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
            </label>
            <RangeInput
              c={colMap.get(builder.range.key)}
              idBase="rr-range"
              value={[builder.range.from, builder.range.to]}
              onChange={([from, to]) => set({ range: { ...builder.range, from, to } })}
            />
            {(builder.range.from || builder.range.to) && (
              <button type="button" className="btn btn-sm btn-outline rr-align-end" onClick={() => set({ range: { ...builder.range, from: '', to: '' } })}>Any date</button>
            )}
          </div>
        )}

        {builder.filters.map((f, i) => {
          const c = colMap.get(f.key);
          if (!c) return null;
          const id = `rr-f-${f.key}`;
          return (
            <div key={f.key} className="rr-filter">
              <div className="rr-filter-label" id={`${id}-label`}>
                {c.label}
                <span className="rr-muted"> {f.op === 'in' ? 'is one of' : f.op === 'contains' ? 'contains' : 'between'}</span>
              </div>
              <div className="rr-filter-value">
                {f.op === 'in' && (
                  <MultiSelect id={id} label={c.label} labelledBy={`${id}-label`} options={facetOf(c.key)} loading={facetsLoading} value={f.value} onChange={(v) => updateFilter(i, v)} />
                )}
                {f.op === 'contains' && (
                  <input id={id} className="rr-input" type="text" maxLength={100} aria-labelledby={`${id}-label`} value={f.value} onChange={(e) => updateFilter(i, e.target.value)} />
                )}
                {f.op === 'between' && <RangeInput c={c} idBase={id} value={f.value} onChange={(v) => updateFilter(i, v)} />}
              </div>
              <button type="button" className="btn btn-sm btn-outline" aria-label={`Remove the ${c.label} filter`} onClick={() => removeFilter(i)}>Remove</button>
            </div>
          );
        })}

        {addable.length > 0 && (
          <label className="field rr-add" htmlFor="rr-add-filter">
            <span className="field-label">Add a filter</span>
            <select id="rr-add-filter" value="" onChange={(e) => addFilter(e.target.value)}>
              <option value="">Choose a field to filter on…</option>
              {KIND_ORDER.map((kind) => {
                const list = addable.filter((c) => filterKind(c) === kind);
                return list.length ? (
                  <optgroup key={kind} label={kind}>
                    {list.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
        )}
      </section>

      <section className="rr-section" aria-labelledby="rr-h-layout">
        <h4 id="rr-h-layout">Grouping and order</h4>
        <div className="rr-row">
          <label className="field" htmlFor="rr-group">
            <span className="field-label">Group by, with subtotals</span>
            <select id="rr-group" value={builder.groupBy} onChange={(e) => set({ groupBy: e.target.value, summary: e.target.value ? builder.summary : false })}>
              <option value="">No grouping</option>
              {groupable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="rr-check rr-align-end">
            <input type="checkbox" disabled={!builder.groupBy} checked={builder.summary} onChange={(e) => set({ summary: e.target.checked })} />
            <span>Subtotals only (one line per group)</span>
          </label>
        </div>
        <div className="rr-row">
          {builder.sort.map((s, i) => (
            <div key={i} className="rr-sortpair">
              <label className="field" htmlFor={`rr-sort-${i}`}>
                <span className="field-label">{i === 0 ? 'Sort by' : 'Then by'}</span>
                <select id={`rr-sort-${i}`} value={s.key} onChange={(e) => setSort(i, { key: e.target.value })}>
                  <option value="">{i === 0 ? 'The usual order' : 'Nothing else'}</option>
                  {ds.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="field" htmlFor={`rr-dir-${i}`}>
                <span className="field-label">Direction</span>
                <select id={`rr-dir-${i}`} value={s.dir} disabled={!s.key} onChange={(e) => setSort(i, { dir: e.target.value })}>
                  <option value="asc">Ascending (A–Z, oldest, smallest)</option>
                  <option value="desc">Descending (Z–A, newest, largest)</option>
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className="rr-section rr-row rr-footer">
        <button type="button" className="btn btn-primary" disabled={running === 'builder'} onClick={checkAndRun}>
          {running === 'builder' ? 'Running…' : 'Run report'}
        </button>
        <button type="button" className="btn btn-outline" disabled={saving} onClick={saveLayout}>
          {saving ? 'Saving…' : 'Save to my reports'}
        </button>
        {catalog.can_share && (
          <label className="rr-check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>Share with other SJVN officers</span>
          </label>
        )}
        <button type="button" className="btn btn-outline rr-push" onClick={() => pickDataset(builder.dataset)}>Start again</button>
      </div>
    </div>
  );

  const presetsView = (
    <div className="rr-groups">
      {presetGroups.map((g) => (
        <section key={g.name} aria-labelledby={`rr-g-${g.name}`}>
          <h3 className="rr-group-title" id={`rr-g-${g.name}`}>{g.name}</h3>
          <div className="rr-cards">
            {g.presets.map((p) => (
              <ReportCard key={p.id} title={p.title} blurb={p.blurb}>
                <button type="button" className="btn btn-sm btn-primary" disabled={running === p.id} onClick={() => run(p.spec, p)}>
                  {running === p.id ? 'Running…' : 'View report'}
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => customise(p.spec)}>Customise</button>
              </ReportCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const savedView = templates.length ? (
    <div className="rr-cards">
      {templates.map((t) => (
        <ReportCard
          key={t.id}
          title={t.name}
          blurb={dsOf(t.dataset)?.title}
          meta={t.mine ? `${t.shared ? 'Shared with the desk' : 'Only you'} · saved ${fmtDate(t.updated_at || t.created_at)}` : `Shared by ${t.owner_name || 'a colleague'}`}
        >
          <button type="button" className="btn btn-sm btn-primary" disabled={running === t.id} onClick={() => run(t.spec, t)}>
            {running === t.id ? 'Running…' : 'View report'}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => customise(t.spec, t)}>Customise</button>
          {t.mine && <button type="button" className="btn btn-sm btn-outline" onClick={() => removeTemplate(t)}>Remove</button>}
        </ReportCard>
      ))}
    </div>
  ) : (
    <div className="rr-panel rr-empty">
      Nothing saved yet. Build a report under Custom report and choose “Save to my reports” to keep its columns, filters and grouping.
    </div>
  );

  return (
    <div className="rr">
      <p className="rr-intro">
        {catalog.side
          ? 'Every report here reads your live records with SJVN. Open one on screen, then download it as CSV, Excel or PDF with the same rows and totals.'
          : 'Every report here reads the desk’s live records. Open one on screen, then download it as CSV, Excel or PDF with the same rows and totals.'}
        {catalog.scope_note && <> {catalog.scope_note}</>}
      </p>
      <Tabs>
        <Tab active={view === 'presets'} onClick={() => setView('presets')}>Predefined reports</Tab>
        <Tab active={view === 'custom'} onClick={() => setView('custom')}>Custom report</Tab>
        <Tab active={view === 'saved'} onClick={() => setView('saved')}>Saved reports ({templates.length})</Tab>
      </Tabs>
      {view === 'presets' && presetsView}
      {view === 'custom' && builderView}
      {view === 'saved' && savedView}

      <div ref={resultRef}>
        {result && (
          <ReportResult
            report={result}
            exporting={exporting}
            onExport={exportAs}
            onCustomise={() => customise(result.spec)}
          />
        )}
      </div>
    </div>
  );
}
