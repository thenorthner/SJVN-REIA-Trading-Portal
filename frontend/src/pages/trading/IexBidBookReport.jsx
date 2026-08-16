import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';
import { BID_BOOK_REPORTS } from './iexBidBookColumns.js';

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

/**
 * Shared ISET-style Bid Book Request Report (CSV / Excel / PDF + search).
 * `kind` is one of: dam-single | dam-block | rtm-single | rtm-block
 */
export default function IexBidBookReport({ kind }) {
  const config = BID_BOOK_REPORTS[kind];
  const columns = config.columns;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.iexBidBook.list({ report_type: config.reportType })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [config.reportType]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
    }
    return list.map((r, i) => ({ ...r, sl_no: i + 1 }));
  }, [rows, search]);

  function exportRows(list) {
    return list.map((r) => {
      const out = {};
      for (const col of columns) out[col.label] = r[col.key] ?? '';
      return out;
    });
  }

  function exportCsv() {
    const data = exportRows(filtered);
    const header = columns.map((c) => c.label);
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`${kind}-bid-book-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = exportRows(filtered);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : Object.fromEntries(columns.map((c) => [c.label, ''])));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Bid Book');
    XLSX.writeFile(wb, `${kind}-bid-book-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = exportRows(filtered);
    const w = window.open('', '_blank');
    if (!w) return;
    const head = columns.map((c) => `<th>${c.label}</th>`).join('');
    const body = data.map((r) => `<tr>${columns.map((c) => `<td>${r[c.label] ?? ''}</td>`).join('')}</tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>${config.title}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:16px;font-size:9px}
        h1{font-size:15px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ccc;padding:3px;white-space:nowrap}
        th{background:#5b9bd5;color:#fff}
      </style></head><body>
      <h1>${config.title}</h1>
      <table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">No data available in table</td></tr>`}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const thStyle = {
    background: '#5b9bd5',
    color: '#fff',
    padding: '8px 10px',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0 }}>{config.title}</div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportCsv}>CSV</button>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportExcel}>Excel</button>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportPdf}>PDF</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Search:
            <input className="input" style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>

        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : (
          <>
            <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {columns.map((c) => <th key={c.key} style={thStyle}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No data available in table
                      </td>
                    </tr>
                  ) : filtered.map((r) => (
                    <tr key={`${r.order_id || r.id}-${r.sl_no}-${r.from_period_id || ''}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {columns.map((c) => (
                        <td key={c.key} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r[c.key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
              {filtered.length === 0
                ? 'No data available in table'
                : `Showing 1 to ${filtered.length} of ${filtered.length} entries`}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

const exportBtn = {
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  padding: '6px 14px',
  fontWeight: 600,
};
