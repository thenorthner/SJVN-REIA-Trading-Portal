import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'TRADING_USER'];
const CAN_RECORD_PAYMENT = ['SJVN_ADMIN', 'TRADING_USER', 'FINANCE_USER'];

const GEN_FORM = { client_id: '', invoice_kind: 'COMBINED', billing_period: '', quantum_mwh: '', rate_per_unit: '', margin_rate: '0.05', gst_applicable: true };
const PAY_FORM = { amount: '', payment_date: '', mode: 'NEFT', reference: '' };

export default function TradingInvoices() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ client_id: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState(GEN_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState(PAY_FORM);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.tradingInvoices.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.client_id, filters.status]);
  useEffect(() => { api.tradingClients.list().then(setClients).catch(() => {}); }, []);

  function openDetail(row) {
    api.tradingInvoices.get(row.id).then(setSelected);
    setPayForm(PAY_FORM);
  }

  async function refreshSelected(id) {
    setSelected(await api.tradingInvoices.get(id));
    load();
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.tradingInvoices.generate({
        ...genForm,
        quantum_mwh: Number(genForm.quantum_mwh),
        rate_per_unit: Number(genForm.rate_per_unit),
        margin_rate: Number(genForm.margin_rate),
      });
      setShowGenerate(false);
      setGenForm(GEN_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate invoice.');
    }
  }

  async function handleSend() {
    await api.tradingInvoices.send(selected.id);
    refreshSelected(selected.id);
  }

  async function handlePayment(e) {
    e.preventDefault();
    await api.tradingInvoices.recordPayment(selected.id, { ...payForm, amount: Number(payForm.amount) });
    setPayForm(PAY_FORM);
    refreshSelected(selected.id);
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'client_name', header: 'Client' },
    { key: 'invoice_kind', header: 'Kind' },
    { key: 'billing_period', header: 'Period' },
    { key: 'quantum_mwh', header: 'Quantum (MWh)', render: (r) => fmtNumber(r.quantum_mwh) },
    { key: 'trading_margin', header: 'Margin', render: (r) => fmtCurrency(r.trading_margin) },
    { key: 'total_amount', header: 'Total', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Trading Billing &amp; Settlement"
        subtitle="Generate trading margin / power supply invoices and track collections"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Invoice</button>}
      />

      <div className="filters-bar">
        <select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No trading invoices found.'} />
      </Card>

      <Modal open={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Trading Invoice" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleGenerate}>
          <div className="form-grid">
            <Field label="Client">
              <select required value={genForm.client_id} onChange={(e) => setGenForm({ ...genForm, client_id: e.target.value })}>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice Kind">
              <select value={genForm.invoice_kind} onChange={(e) => setGenForm({ ...genForm, invoice_kind: e.target.value })}>
                <option value="TRADING_MARGIN_ONLY">Trading Margin Only</option>
                <option value="POWER_SUPPLY_ONLY">Power Supply Only</option>
                <option value="COMBINED">Combined</option>
              </select>
            </Field>
            <Field label="Billing Period">
              <input required type="month" value={genForm.billing_period} onChange={(e) => setGenForm({ ...genForm, billing_period: e.target.value })} />
            </Field>
            <Field label="Quantum (MWh)">
              <input required type="number" step="0.01" value={genForm.quantum_mwh} onChange={(e) => setGenForm({ ...genForm, quantum_mwh: e.target.value })} />
            </Field>
            <Field label="Rate (₹/unit)">
              <input required type="number" step="0.01" value={genForm.rate_per_unit} onChange={(e) => setGenForm({ ...genForm, rate_per_unit: e.target.value })} />
            </Field>
            <Field label="Margin Rate (₹/unit)">
              <input type="number" step="0.01" value={genForm.margin_rate} onChange={(e) => setGenForm({ ...genForm, margin_rate: e.target.value })} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={genForm.gst_applicable} onChange={(e) => setGenForm({ ...genForm, gst_applicable: e.target.checked })} />
            Apply GST (18%)
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowGenerate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Generate</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={620}>
        {selected && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Client</span><span className="detail-value">{selected.client_name}</span></div>
              <div className="detail-item"><span className="detail-label">Kind</span><span className="detail-value">{selected.invoice_kind}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Quantum</span><span className="detail-value">{fmtNumber(selected.quantum_mwh)} MWh</span></div>
              <div className="detail-item"><span className="detail-label">Rate</span><span className="detail-value">₹{selected.rate_per_unit}/unit</span></div>
              <div className="detail-item"><span className="detail-label">Trading Margin</span><span className="detail-value">{fmtCurrency(selected.trading_margin)}</span></div>
              <div className="detail-item"><span className="detail-label">GST</span><span className="detail-value">{fmtCurrency(selected.gst_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Total Amount</span><span className="detail-value" style={{ fontSize: 16 }}>{fmtCurrency(selected.total_amount)}</span></div>
            </div>

            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Payment History</div>
                <div className="timeline">
                  {selected.payments.map((p) => (
                    <div className="timeline-item" key={p.id}>
                      {fmtCurrency(p.amount)} via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">Ref: {p.reference || '-'}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {CAN_WRITE.includes(user?.role) && selected.status === 'DRAFT' && (
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSend}>Send to Client</button>
              </div>
            )}

            {CAN_RECORD_PAYMENT.includes(user?.role) && !['PAID'].includes(selected.status) && selected.status !== 'DRAFT' && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Record Payment</div>
                <form onSubmit={handlePayment}>
                  <div className="form-grid">
                    <Field label="Amount (₹)">
                      <input required type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Mode">
                      <select value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                        {['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Reference">
                      <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                    </Field>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Record Payment</button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
