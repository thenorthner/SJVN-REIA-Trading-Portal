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
        th{background:#5b9bd5;color:#fff;text-align:left;padding:6px}
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

  const thStyle = {
    background: '#5b9bd5',
    color: '#fff',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const exportBtnStyle = { background: '#3b82f6', color: '#fff', border: 'none' };
  const colCount = columns.length + (showSr ? 1 : 0);

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0 }}>{title}</div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" style={exportBtnStyle} onClick={exportCsv}>CSV</button>
            <button type="button" className="btn btn-sm" style={exportBtnStyle} onClick={exportExcel}>Excel</button>
            <button type="button" className="btn btn-sm" style={exportBtnStyle} onClick={exportPdf}>PDF</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Search:
            <input
              type="search"
              className="input"
              style={{ width: 260 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <div className="page-loading">Loading report…</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {showSr && <th style={{ ...thStyle, cursor: 'default' }}>Sr. No.</th>}
                    {columns.map((c) => (
                      <th key={c.key} style={thStyle} onClick={() => toggleSort(c.key)}>
                        {c.label}{' '}
                        <span style={{ opacity: sortKey === c.key ? 1 : 0.45 }}>
                          {sortKey === c.key && sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {totals && (
                    <tr style={{ background: '#e8f0fe', fontWeight: 600 }}>
                      {showSr && <td style={{ padding: '10px 12px' }}>Total</td>}
                      {columns.map((c) => (
                        <td key={c.key} style={{ padding: '10px 12px' }}>
                          {totalKeys.includes(c.key)
                            ? Number(totals[c.key]).toLocaleString('en-IN', { maximumFractionDigits: 2 })
                            : ''}
                        </td>
                      ))}
                    </tr>
                  )}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        {emptyText}
                      </td>
                    </tr>
                  ) : filtered.map((r, idx) => (
                    <tr key={r.id || idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 ? '#eef6ff' : '#fff' }}>
                      {showSr && <td style={{ padding: '10px 12px', textAlign: 'center' }}>{idx + 1}</td>}
                      {columns.map((c) => (
                        <td key={c.key} style={{ padding: '10px 12px', whiteSpace: c.nowrap ? 'nowrap' : undefined }}>
                          {cellValue(r, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              Showing {filtered.length ? 1 : 0} to {filtered.length} of {filtered.length} entries.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
