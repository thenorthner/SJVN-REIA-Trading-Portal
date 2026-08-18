import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

const COLUMNS = [
  { key: 'sl_no', label: 'Sl No.' },
  { key: 'transaction_id', label: 'Transaction ID' },
  { key: 'product_type', label: 'Product Type' },
  { key: 'bid_type', label: 'Bid Type' },
  { key: 'delivery_date', label: 'Delivery Date' },
  { key: 'asset_id', label: 'Asset ID' },
  { key: 'bid_area_id', label: 'Bid Area ID' },
  { key: 'user_id', label: 'User ID' },
  { key: 'participant_id', label: 'Participant ID' },
  { key: 'portfolio_id', label: 'Portfolio ID' },
  { key: 'initiated_by', label: 'Initiated By' },
  { key: 'session', label: 'Session' },
  { key: 'from_period_id', label: 'From Period ID' },
  { key: 'to_period_id', label: 'To Period ID' },
  { key: 'buy_sell', label: 'Buy/Sell (B/S)' },
  { key: 'ocf_opted', label: 'OCF Opted' },
  { key: 'premium_discount_price', label: 'Premium/Discount Price' },
  { key: 'max_ocf_quantity', label: 'Max OCF Quantity' },
  { key: 'rate_price', label: 'Rate / Price' },
  { key: 'quantity_mwh', label: 'Quantity (MWh)' },
  { key: 'bid_reference', label: 'Bid Reference' },
  { key: 'block_id', label: 'Block Id (For Block Bid)' },
  { key: 'dam_bid_id', label: 'DAM Bid' },
  { key: 'status', label: 'Status' },
  { key: 'status_message', label: 'Status Message' },
  { key: 'created_at', label: 'Created At' },
];

function fmtDelivery(s) {
  if (!s) return '—';
  // Keep ISO dates readable; sample uses 12-Aug-2026
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
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

function exportRows(rows) {
  return rows.map((r) => {
    const out = {};
    for (const col of COLUMNS) {
      let v = r[col.key];
      if (col.key === 'delivery_date') v = fmtDelivery(v);
      out[col.label] = v ?? '';
    }
    return out;
  });
}

export default function ExchangeBiddingDetailReport() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('q') || searchParams.get('portfolio') || '');

  useEffect(() => {
    setLoading(true);
    api.exchangeBiddingLatest.report()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)))
      .map((r, i) => ({ ...r, sl_no: i + 1 }));
  }, [rows, search]);

  function exportCsv() {
    const data = exportRows(filtered);
    const header = COLUMNS.map((c) => c.label);
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`bid-details-report-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = exportRows(filtered);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : Object.fromEntries(COLUMNS.map((c) => [c.label, ''])));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Bid Details');
    XLSX.writeFile(wb, `bid-details-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = exportRows(filtered);
    const w = window.open('', '_blank');
    if (!w) return;
    const head = COLUMNS.map((c) => `<th>${c.label}</th>`).join('');
    const body = data.map((r) => `<tr>${COLUMNS.map((c) => `<td>${r[c.label] ?? ''}</td>`).join('')}</tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Bid Details Report</title>
      <style>
        body{font-family:Arial,sans-serif;padding:16px;font-size:10px}
        h1{font-size:16px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ccc;padding:4px;white-space:nowrap}
        th{background:#5b9bd5;color:#fff}
      </style></head><body>
      <h1>Bid Details Report</h1>
      <table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="25">No entries</td></tr>'}</tbody></table>
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
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Bid Details Report</span>
        <Link to="/trading/exchange/bidding-latest" className="btn btn-sm btn-primary" style={{ textDecoration: 'none' }}>
          + New Bid (Latest)
        </Link>
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
            <input className="input" style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Transaction ID, portfolio…" />
          </label>
        </div>

        {loading ? (
          <div className="page-loading">Loading report…</div>
        ) : (
          <>
            <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => <th key={c.key} style={thStyle}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No bid details yet. Submit from{' '}
                        <Link to="/trading/exchange/bidding-latest">Exchange Bidding (Latest)</Link>.
                      </td>
                    </tr>
                  ) : filtered.map((r) => (
                    <tr key={`${r.transaction_id}-${r.sl_no}-${r.from_period_id}-${r.bid_reference}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {COLUMNS.map((c) => {
                        let v = r[c.key];
                        if (c.key === 'delivery_date') v = fmtDelivery(v);
                        if (c.key === 'buy_sell') v = v === 'Buy' ? 'Buy' : v === 'Sell' ? 'Sell' : (v || '');
                        if (c.key === 'dam_bid_id' && v) {
                          return (
                            <td key={c.key} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              <Link to="/trading/dam">{v}</Link>
                            </td>
                          );
                        }
                        return <td key={c.key} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{v ?? ''}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
              Showing {filtered.length === 0 ? 0 : 1} to {filtered.length} of {filtered.length} entries
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
