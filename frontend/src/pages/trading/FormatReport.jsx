import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

// The shared body of an ERP "format" report — the SAP upload layouts the
// finance team pulls out of this system (Vendor, Vendor Payable, Customer
// Receivable). All three are the same thing: a criteria strip, then a grid you
// search, sort and export. They were three copies of hand-rolled markup that
// depended on a CSS framework this app does not ship, which is why they came
// out unstyled; this is the one implementation they now share.

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const cell = (row, key) => (row?.[key] == null ? '' : row[key]);

/**
 * @param {object} props
 * @param {string} props.filename        base name for the CSV / XLSX download
 * @param {Array<{key,label,code?,num?}>} props.columns  `code` is the SAP field name shown above the label
 * @param {Array<object>} props.rows
 * @param {Array<{label,span}>} [props.bands]  grouping bands drawn above the column row
 */
export default function FormatReport({ filename, columns, rows, bands, emptyText = 'No data available in table' }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter((r) => columns.some((c) => String(cell(r, c.key)).toLowerCase().includes(q)))
      : rows;
    if (!sortKey) return list;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = cell(a, sortKey);
      const bv = cell(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'en') * dir;
    });
  }, [rows, columns, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const exportRows = () => filtered.map((r) => Object.fromEntries(columns.map((c) => [c.label, cell(r, c.key)])));

  function exportCsv() {
    const header = columns.map((c) => c.label);
    const lines = [
      header.join(','),
      ...exportRows().map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`${filename}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = exportRows();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{}]), 'Report');
    XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <div className="report-toolbar">
        <div className="export-group">
          <button type="button" className="btn btn-sm btn-navy" onClick={exportCsv}>CSV</button>
          <button type="button" className="btn btn-sm btn-navy" onClick={exportExcel}>Excel</button>
        </div>
        <label className="report-search">
          Search:
          <input
            type="search"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter these rows"
          />
        </label>
      </div>

      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            {bands?.map((band, i) => (
              <tr key={i}>
                {band.map((b, j) => <th key={j} className="group-band" colSpan={b.span}>{b.label}</th>)}
              </tr>
            ))}
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`sortable${sortKey === c.key ? ' sorted' : ''}`}
                  onClick={() => toggleSort(c.key)}
                  aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  scope="col"
                >
                  {c.code && <span className="col-code">{c.code}</span>}
                  {c.label}
                  <span className="sort-arrow">{sortKey === c.key && sortDir === 'desc' ? '▼' : '▲'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td className="empty-cell" colSpan={columns.length}>{emptyText}</td></tr>
            ) : filtered.map((r, idx) => (
              <tr key={r.id || idx}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : undefined}>{cell(r, c.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        Showing {filtered.length} of {rows.length} {rows.length === 1 ? 'row' : 'rows'}.
      </p>
    </>
  );
}
