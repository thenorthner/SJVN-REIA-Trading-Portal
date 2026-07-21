import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

function inrCompact(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return fmtCurrency(n);
}

function StatCard({ label, value, sub, tone }) {
  const color = tone === 'good' ? '#047857' : tone === 'bad' ? '#b91c1c' : '#0f172a';
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Reports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  const loadScreen = useCallback(async (from = range.from, to = range.to) => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.reports.billingSummary(params);
      setData(res);
      if (res?.months?.length) {
        setSuccess(`Report ready: ${res.month_count} month(s) · Net profit ${inrCompact(res.totals?.net_profit)}`);
      } else {
        setSuccess('No invoices found for this period.');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { loadScreen(); }, []);

  async function downloadPdf() {
    setPdfLoading(true);
    setError('');
    setSuccess('');
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      // Refresh screen data first so preview matches the PDF
      await loadScreen(range.from, range.to);
      await api.reports.billingSummaryPdf(params);
      setSuccess('PDF downloaded — open the file for the formatted report.');
    } catch (e) {
      console.error('PDF download failed:', e);
      // blob error bodies often need parsing
      let msg = e.message || 'Failed to generate PDF';
      if (e.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const j = JSON.parse(text);
          if (j.error) msg = j.error;
        } catch { /* ignore */ }
      } else if (e.response?.data?.error) {
        msg = e.response.data.error;
      }
      setError(msg);
    } finally {
      setPdfLoading(false);
    }
  }

  const t = data?.totals || {};

  const columns = [
    { key: 'billing_period', header: 'Month', render: (r) => (
      r.__total ? <strong>TOTAL</strong> : r.billing_period
    )},
    { key: 'sales_billed', header: 'Sales Billed (S→B)', render: (r) => fmtCurrency(r.sales_billed) },
    { key: 'purchase_billed', header: 'Purchases (Dev→SJVN)', render: (r) => fmtCurrency(r.purchase_billed) },
    { key: 'gross_margin', header: 'Gross Margin', render: (r) => (
      <span style={{ color: r.gross_margin >= 0 ? '#047857' : '#b91c1c', fontWeight: 600 }}>{fmtCurrency(r.gross_margin)}</span>
    )},
    { key: 'trading_margin', header: 'Trading Margin', render: (r) => fmtCurrency(r.trading_margin) },
    { key: 'rebate_saved', header: 'Rebate Saved', render: (r) => fmtCurrency(r.rebate_saved) },
    { key: 'lps_receivable', header: 'LPS Recv.', render: (r) => fmtCurrency(r.lps_receivable) },
    { key: 'net_profit', header: 'Net Profit', render: (r) => (
      <span style={{ color: r.net_profit >= 0 ? '#047857' : '#b91c1c', fontWeight: 700 }}>{fmtCurrency(r.net_profit)}</span>
    )},
    { key: 'collected', header: 'Collected', render: (r) => fmtCurrency(r.collected) },
    { key: 'outstanding_receivable', header: 'Outstanding Recv.', render: (r) => (
      <span style={{ color: r.outstanding_receivable > 0 ? '#b45309' : '#64748b' }}>{fmtCurrency(r.outstanding_receivable)}</span>
    )},
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
  ];

  const rowsWithTotal = data?.months?.length
    ? [...data.months, {
        billing_period: 'TOTAL',
        sales_billed: t.sales_billed, purchase_billed: t.purchase_billed, gross_margin: t.gross_margin,
        trading_margin: t.trading_margin, rebate_saved: t.rebate_saved, lps_receivable: t.lps_receivable,
        net_profit: t.net_profit, collected: t.collected, outstanding_receivable: t.outstanding_receivable,
        energy_mwh: t.energy_mwh, __total: true,
      }]
    : [];

  return (
    <div>
      <PageHeader
        title="Billing & Invoicing Reports"
        subtitle="Month-wise summary — download a professional PDF (not a screenshot)"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={pdfLoading || loading}
            onClick={downloadPdf}
          >
            {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
          </button>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="From (month)">
            <input type="month" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To (month)">
            <input type="month" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => loadScreen()}
          >
            {loading ? 'Loading…' : 'Refresh Preview'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pdfLoading || loading}
            onClick={downloadPdf}
          >
            {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
          </button>
          {(range.from || range.to) && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => {
                setRange({ from: '', to: '' });
                loadScreen('', '');
              }}
            >
              Clear Filter
            </button>
          )}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#64748b' }}>
          Preview below matches the PDF. Click <strong>Download PDF Report</strong> for a landscape SJVN-branded document with executive summary, month table, and notes.
        </p>
      </Card>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {success && !error && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '10px 14px', borderRadius: 8, marginBottom: 12 }}>
          {success}
        </div>
      )}

      {loading && !data ? (
        <Card><div style={{ padding: 20, color: '#64748b' }}>Loading report…</div></Card>
      ) : !data?.months?.length ? (
        <Card>
          <div style={{ padding: 20, color: '#64748b' }}>
            No billing data for the selected period. Generate invoices under <strong>Billing &amp; Invoicing</strong> first.
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard label="Total Sales Billed" value={inrCompact(t.sales_billed)} sub={`${t.sales_count || 0} buyer invoices`} />
            <StatCard label="Total Purchases" value={inrCompact(t.purchase_billed)} sub={`${t.purchase_count || 0} developer invoices`} />
            <StatCard label="Gross Margin" value={inrCompact(t.gross_margin)} sub="Sales − Purchases" tone={t.gross_margin >= 0 ? 'good' : 'bad'} />
            <StatCard label="Trading Margin" value={inrCompact(t.trading_margin)} sub="SJVN margin on PSAs" tone="good" />
            <StatCard label="Rebate Saved" value={inrCompact(t.rebate_saved)} sub="Early-payment rebates" tone="good" />
            <StatCard label="Net Profit" value={inrCompact(t.net_profit)} sub="Gross + rebate + LPS recv − LPS paid" tone={t.net_profit >= 0 ? 'good' : 'bad'} />
            <StatCard label="Collected" value={inrCompact(t.collected)} sub="Received from buyers" />
            <StatCard label="Outstanding Receivable" value={inrCompact(t.outstanding_receivable)} sub="Yet to collect" tone={t.outstanding_receivable > 0 ? 'bad' : undefined} />
          </div>

          <Card title={`Month-wise Breakup (${data.from || '—'} → ${data.to || '—'})`}>
            <Table columns={columns} rows={rowsWithTotal} />
          </Card>
        </>
      )}
    </div>
  );
}
