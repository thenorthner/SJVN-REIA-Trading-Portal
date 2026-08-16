import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card, Modal, Field } from '../../components/ui.jsx';

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()} ${hh}:${mm}`;
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
    Date: fmtDate(r.application_date),
    'Application Id': r.application_id,
    Applicant: r.applicant,
    'Seller Name': r.seller_name,
    'Buyer Name': r.buyer_name,
    Status: r.status,
  }));
}

async function downloadApiFile(fn, fallbackName) {
  const blob = await fn();
  downloadBlob(fallbackName, blob);
}

/**
 * ISET Bilateral Applications — searchable list with Format-I / Format-II downloads.
 */
export default function BilateralApplications() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('application_date');
  const [sortDir, setSortDir] = useState('desc');
  const [message, setMessage] = useState('');
  // Converting an application into a contract: the ISET format-generation form
  // carries no rate, so the desk supplies the commercial terms here.
  const [convertRow, setConvertRow] = useState(null);
  const [convertForm, setConvertForm] = useState({ sale_rate_per_unit: '', trading_margin_per_unit: '0.03', oa_type: 'STOA' });
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState('');

  function load() {
    setLoading(true);
    api.bilateralApplications.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => [
        r.application_id, r.applicant, r.seller_name, r.buyer_name,
        fmtDate(r.application_date), r.status,
      ].join(' ').toLowerCase().includes(q));
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
    const header = Object.keys(data[0] || { Date: '', 'Application Id': '', Applicant: '', 'Seller Name': '', 'Buyer Name': '' });
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`bilateral-applications-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = rowsForExport(filtered);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ Date: '', 'Application Id': '', Applicant: '', 'Seller Name': '', 'Buyer Name': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Bilateral Applications');
    XLSX.writeFile(wb, `bilateral-applications-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = rowsForExport(filtered);
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = data.map((r) => `
      <tr>
        <td>${r.Date}</td>
        <td>${r['Application Id']}</td>
        <td>${r.Applicant}</td>
        <td>${r['Seller Name']}</td>
        <td>${r['Buyer Name']}</td>
      </tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Bilateral Applications</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        h1 { font-size: 18px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #5b9bd5; color: #fff; text-align: left; padding: 8px; }
        td { border-bottom: 1px solid #ddd; padding: 8px; }
      </style></head><body>
      <h1>Bilateral Applications</h1>
      <table><thead><tr>
        <th>Date</th><th>Application Id</th><th>Applicant</th><th>Seller Name</th><th>Buyer Name</th>
      </tr></thead><tbody>${rowsHtml || '<tr><td colspan="5">No entries</td></tr>'}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  async function onDownload(row, kind) {
    setMessage('');
    try {
      if (kind === 'csv') {
        await downloadApiFile(() => api.bilateralApplications.downloadCsv(row.id), `${row.application_id}.csv`);
      } else if (kind === 'format-i') {
        await downloadApiFile(() => api.bilateralApplications.downloadFormatI(row.id), `${row.application_id}-Format-I.txt`);
      } else if (kind === 'format-ii-buyer') {
        await downloadApiFile(() => api.bilateralApplications.downloadFormatII(row.id, 'Buyer'), `${row.application_id}-Format-II-Buyer.txt`);
      } else if (kind === 'format-ii-seller') {
        await downloadApiFile(() => api.bilateralApplications.downloadFormatII(row.id, 'Seller'), `${row.application_id}-Format-II-Seller.txt`);
      }
    } catch (err) {
      setMessage(err.response?.data?.error || 'Download failed.');
    }
  }

  function openConvert(row) {
    setConvertRow(row);
    setConvertForm({ sale_rate_per_unit: '', trading_margin_per_unit: '0.03', oa_type: 'STOA' });
    setConvertError('');
  }

  async function submitConvert(e) {
    e.preventDefault();
    if (!convertRow?.bidding_id) return;
    setConvertBusy(true);
    setConvertError('');
    try {
      const tx = await api.bilateralBidding.createContract(convertRow.bidding_id, {
        sale_rate_per_unit: Number(convertForm.sale_rate_per_unit),
        trading_margin_per_unit: Number(convertForm.trading_margin_per_unit),
        oa_type: convertForm.oa_type,
      });
      setConvertRow(null);
      setMessage(`Contract ${tx.loa_no || tx.id} created from ${convertRow.application_id}.`);
      load();
    } catch (err) {
      setConvertError(err.response?.data?.error || 'Failed to create the contract.');
    } finally {
      setConvertBusy(false);
    }
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

  const exportBtn = { background: '#3b82f6', color: '#fff', border: 'none' };
  const linkBtn = { color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, fontWeight: 500 };

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Bilateral Applications</span>
        <Link to="/trading/bilateral/bidding" className="btn btn-sm btn-primary">+ Format Generation</Link>
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportCsv}>CSV</button>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportExcel}>Excel</button>
            <button type="button" className="btn btn-sm" style={exportBtn} onClick={exportPdf}>PDF</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Search:
            <input
              type="search"
              className="input"
              style={{ width: 240 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Application id, seller, buyer…"
            />
          </label>
        </div>

        {message && (
          <div style={{ marginBottom: 10, fontSize: 13, color: message.includes('fail') ? '#991b1b' : '#166534' }}>{message}</div>
        )}

        {loading ? (
          <div className="page-loading">Loading applications…</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      ['application_date', 'Date'],
                      ['application_id', 'Application Id'],
                      ['applicant', 'Applicant'],
                      ['seller_name', 'Seller Name'],
                      ['buyer_name', 'Buyer Name'],
                    ].map(([key, label]) => (
                      <th key={key} style={thStyle} onClick={() => toggleSort(key)}>
                        {label}{' '}
                        <span style={{ opacity: sortKey === key ? 1 : 0.45 }}>
                          {sortKey === key && sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </th>
                    ))}
                    <th style={{ ...thStyle, cursor: 'default' }}>action</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Contract</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Download CSV</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Format-II (Buyer)</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Format-II (Seller)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No bilateral applications yet.{' '}
                        <Link to="/trading/bilateral/bidding">Submit Format Generation</Link>
                      </td>
                    </tr>
                  ) : filtered.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtDate(r.application_date)}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{r.application_id}</td>
                      <td style={{ padding: '10px 12px' }}>{r.applicant}</td>
                      <td style={{ padding: '10px 12px', maxWidth: 280 }}>{r.seller_name}</td>
                      <td style={{ padding: '10px 12px' }}>{r.buyer_name}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <button type="button" style={linkBtn} onClick={() => onDownload(r, 'format-i')}>Format-I</button>
                        {' · '}
                        <button type="button" style={linkBtn} onClick={() => onDownload(r, 'format-ii-buyer')}>Format-II</button>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {r.transaction_id ? (
                          <Link to={`/trading/bilateral/desk?tx=${encodeURIComponent(r.transaction_id)}`} style={{ color: '#1d4ed8', fontWeight: 500 }}>
                            Open contract
                          </Link>
                        ) : r.bidding_id ? (
                          <button type="button" style={linkBtn} onClick={() => openConvert(r)}>+ Create contract</button>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button type="button" style={linkBtn} onClick={() => onDownload(r, 'csv')} title="Download CSV">⬇</button>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button type="button" style={linkBtn} onClick={() => onDownload(r, 'format-ii-buyer')} title="Format-II Buyer">⬇</button>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button type="button" style={linkBtn} onClick={() => onDownload(r, 'format-ii-seller')} title="Format-II Seller">⬇</button>
                      </td>
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

      {convertRow && (
        <Modal open={true} onClose={() => setConvertRow(null)} title={`Create contract from ${convertRow.application_id}`}>
          <form onSubmit={submitConvert}>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 14 }}>
              The parties, corridor and schedule come across from the application.
              The format-generation form carries no rate, so the commercial terms are set here.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Sale rate (Rs./kWh)" required>
                <input type="number" step="0.0001" min="0.0001" className="input" required
                  value={convertForm.sale_rate_per_unit}
                  onChange={(e) => setConvertForm({ ...convertForm, sale_rate_per_unit: e.target.value })} />
              </Field>
              <Field label="Trading margin (Rs./kWh)">
                <input type="number" step="0.0001" min="0" className="input"
                  value={convertForm.trading_margin_per_unit}
                  onChange={(e) => setConvertForm({ ...convertForm, trading_margin_per_unit: e.target.value })} />
              </Field>
              <Field label="Open access type">
                <select className="input" value={convertForm.oa_type}
                  onChange={(e) => setConvertForm({ ...convertForm, oa_type: e.target.value })}>
                  <option value="STOA">STOA</option>
                  <option value="MTOA">MTOA</option>
                  <option value="LTOA">LTOA</option>
                </select>
              </Field>
            </div>
            {convertForm.sale_rate_per_unit && (
              <p style={{ fontSize: 12, color: '#475569', marginTop: 10 }}>
                Purchase rate works out to{' '}
                <strong>
                  ₹{(Number(convertForm.sale_rate_per_unit) - Number(convertForm.trading_margin_per_unit || 0)).toFixed(4)}
                </strong>
                /kWh paid to {convertRow.seller_name}.
              </p>
            )}
            {convertError && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
                {convertError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-outline" onClick={() => setConvertRow(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={convertBusy}>
                {convertBusy ? 'Creating…' : 'Create Contract'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
