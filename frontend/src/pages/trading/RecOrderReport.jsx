import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, fmtNumber } from '../../components/ui.jsx';

function formatTradeDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

/**
 * ISET REC Order Report — date-range KPIs + trade-date list with expandable details.
 */
export default function RecOrderReport() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState({
    total_rec_sold: 0,
    min_discovered_price: null,
    max_discovered_price: null,
    total_sale_value: 0,
  });
  const [tradeDates, setTradeDates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function search(e) {
    e?.preventDefault?.();
    setBusy(true);
    setError('');
    try {
      const data = await api.recTrading.orderReport({
        from: from || undefined,
        to: to || undefined,
      });
      setSummary(data.summary || {});
      setTradeDates(data.trade_dates || []);
      setSelected(data.trade_dates?.[0]?.trade_date || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load REC order report.');
      setSummary({ total_rec_sold: 0, min_discovered_price: null, max_discovered_price: null, total_sale_value: 0 });
      setTradeDates([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { search(); }, []);

  const selectedBlock = tradeDates.find((t) => t.trade_date === selected);

  const cards = [
    { label: 'Total REC Sold', value: fmtNumber(summary.total_rec_sold || 0, 0), unit: 'Nos.' },
    { label: 'Minimum Discovered Price', value: summary.min_discovered_price == null ? '—' : fmtNumber(summary.min_discovered_price, 1), unit: 'Rupees' },
    { label: 'Maximum Discovered Price', value: summary.max_discovered_price == null ? '—' : fmtNumber(summary.max_discovered_price, 1), unit: 'Rupees' },
    { label: 'Total Sale Value', value: fmtNumber(summary.total_sale_value || 0, 0), unit: 'Rupees' },
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>REC Order Report</h1>
        <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
          <Link to="/trading/rec" style={{ color: '#1d4ed8' }}>← REC Order</Link>
          <Link to="/trading/rec/bid-entry" style={{ color: '#1d4ed8' }}>Bid Entry →</Link>
        </div>
      </div>

      <div style={{ background: '#5b9bd5', color: '#fff', textAlign: 'center', padding: '10px 12px', borderRadius: 4, fontWeight: 600, marginBottom: 16 }}>
        REC Order Report
      </div>

      <Card>
        <form onSubmit={search} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>From Date</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>To Date</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
      </Card>

      {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: '#d6eaf8', borderRadius: 6, padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#1e3a5f', fontWeight: 600, marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#0f172a' }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>{c.unit}</div>
          </div>
        ))}
      </div>

      <div className="form-section-header" style={{ marginTop: 20 }}>Trade Date</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tradeDates.length === 0 ? (
          <div style={{ padding: 16, color: '#64748b', textAlign: 'center', background: '#f8fafc', borderRadius: 6 }}>No trades in this range.</div>
        ) : tradeDates.map((t) => (
          <button
            key={t.trade_date}
            type="button"
            onClick={() => setSelected(t.trade_date)}
            style={{
              textAlign: 'left',
              border: 'none',
              borderRadius: 6,
              padding: '12px 16px',
              cursor: 'pointer',
              background: selected === t.trade_date ? '#5b9bd5' : '#d6eaf8',
              color: selected === t.trade_date ? '#fff' : '#0f172a',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {formatTradeDate(t.trade_date)}
            <span style={{ float: 'right', fontWeight: 500, opacity: 0.85, fontSize: 12 }}>
              {fmtNumber(t.total_recs_sold, 0)} RECs · ₹{fmtNumber(t.sale_value, 0)}
            </span>
          </button>
        ))}
      </div>

      {selectedBlock && (
        <Card style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 14 }}>Orders on {formatTradeDate(selected)}</strong>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  {['Order', 'Buyer', 'Invoice', 'RECs Sold', 'Discovered ₹', 'Obligation', 'Net Revenue', 'Total Amt'].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedBlock.orders.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{o.id}</td>
                    <td style={{ padding: '8px 10px' }}>{o.buyer_name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{o.invoice_no || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{fmtNumber(o.total_recs_sold, 0)}</td>
                    <td style={{ padding: '8px 10px' }}>{fmtNumber(o.discovered_rate, 1)}</td>
                    <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.trade_obligation, 2)}</td>
                    <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.net_revenue, 2)}</td>
                    <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.total_amount, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
