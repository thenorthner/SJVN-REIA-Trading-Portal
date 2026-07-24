import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency } from '../../components/ui.jsx';

const EMPTY = { txn_type: 'RECHARGE', amount: '', category: 'ISTS', payee: '', reference: '', txn_date: new Date().toISOString().split('T')[0], notes: '' };
const CATEGORIES = ['ISTS', 'RLDC', 'APPLICATION', 'OTHER'];

export default function NOARWallet() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.noar.list(), api.noar.summary()])
      .then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api.noar.create({ ...form, amount: Number(form.amount) });
      setShow(false); setForm({ ...EMPTY, txn_date: new Date().toISOString().split('T')[0] }); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save transaction.');
    }
  }

  const columns = [
    { key: 'txn_no', header: 'Txn No.' },
    { key: 'txn_date', header: 'Date' },
    { key: 'txn_type', header: 'Type', render: (r) => <Badge status={r.txn_type === 'RECHARGE' ? 'ACTIVE' : 'PENDING'} label={r.txn_type} /> },
    { key: 'category', header: 'Category', render: (r) => r.category || '—' },
    { key: 'payee', header: 'Payee', render: (r) => r.payee || '—' },
    { key: 'amount', header: 'Amount', render: (r) => (
      <span style={{ color: r.txn_type === 'RECHARGE' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
        {r.txn_type === 'RECHARGE' ? '+' : '−'}{fmtCurrency(r.amount)}
      </span>
    ) },
    { key: 'balance_after', header: 'Balance', render: (r) => fmtCurrency(r.balance_after) },
  ];

  const cat = summary.charges_by_category || {};

  return (
    <div>
      <PageHeader
        title="NOAR Wallet & Open Access Charges"
        subtitle="Recharge the NOAR wallet & pay Open Access charges (ISTS / RLDC / application) to Grid India & CTUIL"
        actions={canWrite && <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY, txn_date: new Date().toISOString().split('T')[0] }); setError(''); setShow(true); }}>+ Add Transaction</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Wallet Balance" value={fmtCurrency(summary.balance || 0)} tone={(summary.balance || 0) > 0 ? 'green' : 'amber'} />
        <StatCard label="Total Recharged" value={fmtCurrency(summary.total_recharged || 0)} />
        <StatCard label="Total Charges Paid" value={fmtCurrency(summary.total_charges || 0)} tone="amber" />
        <StatCard label="ISTS Charges" value={fmtCurrency(cat.ISTS || 0)} hint={`RLDC ${fmtCurrency(cat.RLDC || 0)} · App ${fmtCurrency(cat.APPLICATION || 0)}`} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No wallet transactions yet.'} />
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title="NOAR Wallet Transaction" width={480}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Type">
              <select value={form.txn_type} onChange={(e) => setForm({ ...form, txn_type: e.target.value })}>
                <option value="RECHARGE">Recharge (credit)</option>
                <option value="CHARGE">Charge (debit)</option>
              </select>
            </Field>
            <Field label="Amount (₹)"><input required type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          </div>
          {form.txn_type === 'CHARGE' && (
            <div className="form-grid">
              <Field label="Charge Category">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Payee">
                <select value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="Grid India">Grid India</option>
                  <option value="CTUIL">CTUIL</option>
                  <option value="NLDC">NLDC</option>
                  <option value="RLDC">RLDC</option>
                </select>
              </Field>
            </div>
          )}
          <div className="form-grid">
            <Field label="Date"><input required type="date" value={form.txn_date} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} /></Field>
            <Field label="Reference"><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
