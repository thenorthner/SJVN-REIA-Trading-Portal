import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

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

function cellValue(row, key) {
  const v = row?.[key];
  return v == null ? '' : v;
}

/**
 * Shared ISET-style report: section header, CSV/Excel/PDF, search, sortable table.
 */
export default function IsetReportTable({
  kind,
  title,
  columns,
  emptyText = 'No data available in table',
  showSr = true,
  totalKeys = null,
  fetcher = null,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(showSr ? null : columns[0]?.key);
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    setLoading(true);
    const load = fetcher
      ? fetcher()
      : api.isetReports.list(kind);
    load
      .then((data) => setRows(Array.isArray(data) ? data : data?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [kind, fetcher]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) =>
        columns.some((c) => String(cellValue(r, c.key)).toLowerCase().includes(q)),
      );
    }
    if (!sortKey) return list;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, search, sortKey, sortDir, columns]);

  const totals = useMemo(() => {
    if (!totalKeys?.length || !filtered.length) return null;
    const t = {};
    for (const k of totalKeys) {
      t[k] = filtered.reduce((sum, r) => sum + (Number(r[k]) || 0), 0);
    }
    return t;
  }, [filtered, totalKeys]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function exportRows() {
    return filtered.map((r, i) => {
      const out = {};
      if (showSr) out['Sr. No.'] = i + 1;
      for (const c of columns) out[c.label] = cellValue(r, c.key);
      return out;
    });
  }

  function exportCsv() {
    const data = exportRows();
    const header = Object.keys(data[0] || { ...(showSr ? { 'Sr. No.': '' } : {}), ...Object.fromEntries(columns.map((c) => [c.label, ''])) });
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`${kind}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = exportRows();
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{}]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Report');
    XLSX.writeFile(wb, `${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = exportRows();
    const w = window.open('', '_blank');
    if (!w) return;
    const headers = (showSr ? ['Sr. No.'] : []).concat(columns.map((c) => c.label));
    const rowsHtml = data.map((r) =>
      `<tr>${headers.map((h) => `<td>${r[h] ?? ''}</td>`).join('')}</tr>`,
    ).join('');
    w.document.write(`<!doctype html><html><head><title>${title}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px}
        h1{font-size:18px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th{background:#101a2e;color:#fff;text-align:left;padding:6px}
        td{border-bottom:1px solid #ddd;padding:6px}
      </style></head><body>
      <h1>${title}</h1>
      <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${headers.length}">${emptyText}</td></tr>`}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  // Header, zebra rows and export chrome all come from the shared .report-table
  // rules, so an ISET report and an ERP format report look like one grid.
  const colCount = columns.length + (showSr ? 1 : 0);

  return (
    <div className="report-shell">
      <div className="form-section-header" style={{ marginTop: 0 }}>{title}</div>
      <Card>
        <div className="report-toolbar">
          <div className="export-group">
            <button type="button" className="btn btn-sm btn-navy" onClick={exportCsv}>CSV</button>
            <button type="button" className="btn btn-sm btn-navy" onClick={exportExcel}>Excel</button>
            <button type="button" className="btn btn-sm btn-navy" onClick={exportPdf}>PDF</button>
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

        {loading ? (
          <div className="page-loading">Loading report…</div>
        ) : (
          <>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {showSr && <th scope="col" style={{ width: 64 }}>Sr. No.</th>}
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={`sortable${sortKey === c.key ? ' sorted' : ''}`}
                        onClick={() => toggleSort(c.key)}
                        aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {c.label}
                        <span className="sort-arrow">
                          {sortKey === c.key && sortDir === 'desc' ? '▼' : '▲'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {totals && (
                    <tr className="totals-row">
                      {showSr && <td>Total</td>}
                      {columns.map((c) => (
                        <td key={c.key} className={totalKeys.includes(c.key) ? 'num' : undefined}>
                          {totalKeys.includes(c.key)
                            ? Number(totals[c.key]).toLocaleString('en-IN', { maximumFractionDigits: 2 })
                            : ''}
                        </td>
                      ))}
                    </tr>
                  )}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={colCount}>{emptyText}</td>
                    </tr>
                  ) : filtered.map((r, idx) => (
                    <tr key={r.id || idx}>
                      {showSr && <td style={{ textAlign: 'center' }}>{idx + 1}</td>}
                      {columns.map((c) => (
                        <td key={c.key}>{cellValue(r, c.key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              Showing {filtered.length ? 1 : 0} to {filtered.length} of {filtered.length} entries.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
