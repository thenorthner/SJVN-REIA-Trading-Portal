import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

function fmtCreated(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mm}`;
}

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

function rowsForExport(rows) {
  return rows.map((r) => ({
    'Contract No': r.loa_no || r.loi_contract_ref || r.id,
    'Registration Type': r.contract_type || 'Bilateral',
    'PPA No/MOU No': r.ppa_no || '',
    'Created On': fmtCreated(r.created_at),
  }));
}

/**
 * ISET Bilateral Contracts Summary — searchable list with CSV / Excel / PDF export.
 */
export default function BilateralContractsSummary() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    api.bilateral.list()
      .then((data) => setRows((data || []).filter((r) => r.loa_no || r.ppa_no)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const hay = [
          r.loa_no, r.ppa_no, r.loi_contract_ref, r.contract_type,
          r.counterparty, r.id, fmtCreated(r.created_at),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function exportCsv() {
    const data = rowsForExport(filtered);
    const header = Object.keys(data[0] || { 'Contract No': '', 'Registration Type': '', 'PPA No/MOU No': '', 'Created On': '' });
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`bilateral-contracts-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = rowsForExport(filtered);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ 'Contract No': '', 'Registration Type': '', 'PPA No/MOU No': '', 'Created On': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Bilateral Contracts');
    XLSX.writeFile(wb, `bilateral-contracts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = rowsForExport(filtered);
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = data.map((r) => `
      <tr>
        <td>${r['Contract No']}</td>
        <td>${r['Registration Type']}</td>
        <td>${r['PPA No/MOU No']}</td>
        <td>${r['Created On']}</td>
      </tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Bilateral Contracts</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        h1 { font-size: 18px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #5b9bd5; color: #fff; text-align: left; padding: 8px; }
        td { border-bottom: 1px solid #ddd; padding: 8px; }
      </style></head><body>
      <h1>Bilateral Contracts Summary</h1>
      <table><thead><tr>
        <th>Contract No</th><th>Registration Type</th><th>PPA No/MOU No</th><th>Created On</th>
      </tr></thead><tbody>${rowsHtml || '<tr><td colspan="4">No entries</td></tr>'}</tbody></table>
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
    fontSize: 13,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const exportBtnStyle = {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Bilateral Contracts</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-outline" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }} onClick={() => navigate('/trading/bilateral/desk')}>
            Operations desk
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/trading/bilateral/desk?action=create')}>
            + Create Contract
          </button>
        </div>
      </div>

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
              placeholder="Contract no, PPA…"
            />
          </label>
        </div>

        {loading ? (
          <div className="page-loading">Loading contracts…</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      ['loa_no', 'Contract No'],
                      ['contract_type', 'Registration Type'],
                      ['ppa_no', 'PPA No/MOU No'],
                      ['created_at', 'Created On'],
                    ].map(([key, label]) => (
                      <th key={key} style={thStyle} onClick={() => toggleSort(key)}>
                        {label}{' '}
                        <span style={{ opacity: sortKey === key ? 1 : 0.45 }}>
                          {sortKey === key && sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No bilateral contracts yet.{' '}
                        <Link to="/trading/bilateral/desk?action=create">Create one</Link>
                      </td>
                    </tr>
                  ) : filtered.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <Link to={`/trading/bilateral/desk?tx=${encodeURIComponent(r.id)}`} style={{ color: '#1d4ed8', fontWeight: 500 }}>
                          {r.loa_no || r.loi_contract_ref || r.id}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{r.contract_type || 'Bilateral'}</td>
                      <td style={{ padding: '10px 12px' }}>{r.ppa_no || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{fmtCreated(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              Showing {filtered.length === 0 ? 0 : 1} to {filtered.length} of {filtered.length} entries
              {search.trim() && rows.length !== filtered.length ? ` (filtered from ${rows.length})` : ''}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
