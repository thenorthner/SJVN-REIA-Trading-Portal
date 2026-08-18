import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

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

function fmtTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
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
    'Reference No': r.reference_no,
    'Contract': r.contract_id || '',
    Product: r.product_code,
    Quantity: r.quantity,
    Price: r.price,
    'Delivery From': fmtDate(r.delivery_date_from),
    'Delivery To': fmtDate(r.delivery_date_to),
    'From Time': fmtTime(r.from_time),
    'To Time': fmtTime(r.to_time),
    Status: r.status,
    'Created On': fmtCreated(r.created_at),
  }));
}

/**
 * ISET Pxil Order Details — searchable list with CSV / Excel / PDF and Place Bid.
 */
export default function PxilOrderSummary() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.pxilOrders.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const hay = [
          r.reference_no, r.product_code, r.quantity, r.price,
          r.contract_id, Array.isArray(r.bid_ids) ? r.bid_ids.join(' ') : '',
          r.delivery_date_from, r.delivery_date_to, r.from_time, r.to_time,
          r.status, r.side, fmtCreated(r.created_at),
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

  async function placeBid(id) {
    setError('');
    setMessage('');
    setBusyId(id);
    try {
      const updated = await api.pxilOrders.placeBid(id);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setMessage(`Bid placed for ${updated.reference_no}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to place bid.');
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    const data = rowsForExport(filtered);
    const header = Object.keys(data[0] || {
      'Reference No': '', Product: '', Quantity: '', Price: '',
      'Delivery From': '', 'Delivery To': '', 'From Time': '', 'To Time': '',
      Status: '', 'Created On': '',
    });
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`pxil-orders-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = rowsForExport(filtered);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ 'Reference No': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'PXIL Orders');
    XLSX.writeFile(wb, `pxil-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = rowsForExport(filtered);
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = data.map((r) => `
      <tr>
        <td>${r['Reference No']}</td>
        <td>${r.Product}</td>
        <td>${r.Quantity}</td>
        <td>${r.Price}</td>
        <td>${r['Delivery From']}</td>
        <td>${r['Delivery To']}</td>
        <td>${r['From Time']}</td>
        <td>${r['To Time']}</td>
        <td>${r.Status}</td>
        <td>${r['Created On']}</td>
      </tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Pxil Order Details</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        h1 { font-size: 18px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #5b9bd5; color: #fff; text-align: left; padding: 8px; }
        td { border-bottom: 1px solid #ddd; padding: 8px; }
      </style></head><body>
      <h1>Pxil Order Details</h1>
      <table><thead><tr>
        <th>Reference No</th><th>Product</th><th>Quantity</th><th>Price</th>
        <th>Delivery From</th><th>Delivery To</th><th>From Time</th><th>To Time</th>
        <th>Status</th><th>Created On</th>
      </tr></thead><tbody>${rowsHtml || '<tr><td colspan="10">No entries</td></tr>'}</tbody></table>
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

  const columns = [
    ['reference_no', 'Reference No'],
    ['contract_id', 'Contract'],
    ['product_code', 'Product'],
    ['quantity', 'Quantity'],
    ['price', 'Price'],
    ['delivery_date_from', 'Delivery From'],
    ['delivery_date_to', 'Delivery To'],
    ['from_time', 'From Time'],
    ['to_time', 'To Time'],
  ];

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Pxil Order Details</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/trading/pxil/create')}>
          + Create Order
        </button>
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
              placeholder="Reference, product…"
            />
          </label>
        </div>

        {error && <div role="alert" style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {message && <div role="status" style={{ color: '#15803d', fontSize: 13, marginBottom: 10 }}>{message}</div>}

        {loading ? (
          <div className="page-loading">Loading PXIL orders…</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {columns.map(([key, label]) => (
                      <th key={key} style={thStyle} onClick={() => toggleSort(key)}>
                        {label}{' '}
                        <span style={{ opacity: sortKey === key ? 1 : 0.45 }}>
                          {sortKey === key && sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </th>
                    ))}
                    <th style={{ ...thStyle, cursor: 'default' }}>Action</th>
                    <th style={thStyle} onClick={() => toggleSort('created_at')}>
                      Created On{' '}
                      <span style={{ opacity: sortKey === 'created_at' ? 1 : 0.45 }}>
                        {sortKey === 'created_at' && sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No PXIL orders yet.{' '}
                        <Link to="/trading/pxil/create">Create one</Link>
                      </td>
                    </tr>
                  ) : filtered.map((r, idx) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 ? '#f8fafc' : '#fff' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ color: '#1d4ed8', fontWeight: 500 }}>{r.reference_no}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{r.product_code}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12 }}>{r.contract_id || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{r.quantity}</td>
                      <td style={{ padding: '10px 12px' }}>{r.price}</td>
                      <td style={{ padding: '10px 12px' }}>{fmtDate(r.delivery_date_from)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmtDate(r.delivery_date_to)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmtTime(r.from_time)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmtTime(r.to_time)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {r.status === 'BID_PLACED' ? (
                          <div style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>
                            Bid Placed
                            {Array.isArray(r.bid_ids) && r.bid_ids.length > 0 && (
                              <div style={{ fontWeight: 400, color: '#475569' }}>{r.bid_ids.length} bid{r.bid_ids.length > 1 ? 's' : ''} linked</div>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busyId === r.id || r.status !== 'CREATED'}
                            onClick={() => placeBid(r.id)}
                          >
                            {busyId === r.id ? '…' : 'Place Bid'}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtCreated(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              Showing 1 to {filtered.length} of {filtered.length} entries.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
