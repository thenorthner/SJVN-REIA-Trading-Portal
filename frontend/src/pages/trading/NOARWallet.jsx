import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const CATEGORIES = ['ISTS', 'RLDC', 'APPLICATION', 'OTHER'];
const CATEGORY_LABEL = {
  ISTS: 'ISTS transmission charges',
  RLDC: 'RLDC / SLDC operating charges',
  APPLICATION: 'Open access application fee',
  OTHER: 'Other Grid India / NLDC charges',
};
const PAYEES = ['Grid India', 'CTUIL', 'NLDC', 'RLDC'];
const CATEGORY_COLOR = { ISTS: 'var(--primary)', RLDC: '#f59e0b', APPLICATION: '#10b981', OTHER: 'var(--slate-400)' };

const today = () => new Date().toISOString().split('T')[0];
const EMPTY = {
  txn_type: 'RECHARGE', amount: '', category: 'ISTS', payee: '', reference: '',
  txn_date: today(), notes: '', bilateral_id: '',
};

// ₹-signed amount: recharge credits the wallet, charge debits it.
function SignedAmount({ type, amount }) {
  const credit = type === 'RECHARGE';
  return (
    <span style={{ color: credit ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
      {credit ? '+' : '−'}{fmtCurrency(amount)}
    </span>
  );
}

export default function NOARWallet() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [bilaterals, setBilaterals] = useState([]);
  const [filters, setFilters] = useState({ txn_type: '', category: '', start_date: '', end_date: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.txn_type) params.txn_type = filters.txn_type;
    if (filters.category) params.category = filters.category;
    if (filters.start_date) params.start_date = filters.start_date;
    if (filters.end_date) params.end_date = filters.end_date;

    // allSettled: a failing chart must not blank the ledger.
    Promise.allSettled([
      api.noar.list(params),
      api.noar.summary(),
      api.noar.trend(),
    ]).then(([l, s, t]) => {
      const failed = [];
      if (l.status === 'fulfilled') setRows(l.value || []); else failed.push('transactions');
      if (s.status === 'fulfilled') setSummary(s.value); else failed.push('summary');
      if (t.status === 'fulfilled') setTrend(t.value || []); else failed.push('monthly trend');

      const first = [l, s, t].find((x) => x.status === 'rejected');
      if (failed.length) setError(first?.reason?.response?.data?.error || `Could not load ${failed.join(', ')}.`);
    }).finally(() => setLoading(false));
  }, [filters.txn_type, filters.category, filters.start_date, filters.end_date]);

  useEffect(load, [load]);

  useEffect(() => {
    api.bilateral.list().then((d) => setBilaterals(d || [])).catch(() => {});
  }, []);

  function open(txn_type) {
    setForm({ ...EMPTY, txn_type, txn_date: today(), payee: txn_type === 'CHARGE' ? 'CTUIL' : 'Grid India' });
    setFormError('');
    setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.noar.create({ ...form, amount: Number(form.amount), bilateral_id: form.bilateral_id || null });
      setShow(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save transaction.');
    } finally {
      setSaving(false);
    }
  }

  // The ledger is append-only: a wrong entry is cancelled by an opposing
  // entry, so the wallet still reconciles against the Grid India statement.
  async function reverse(row) {
    const reason = window.prompt(`Reverse ${row.txn_no}? An opposing entry will be posted.\n\nReason:`);
    if (reason === null) return;
    try {
      await api.noar.reverse(row.id, reason);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reverse transaction.');
    }
  }

  const cat = summary?.charges_by_category || {};
  const isLow = summary?.is_low_balance;

  const columns = [
    { key: 'txn_no', header: 'Txn No.' },
    { key: 'txn_date', header: 'Date' },
    {
      key: 'txn_type',
      header: 'Type',
      render: (r) => <Badge type={r.txn_type === 'RECHARGE' ? 'success' : 'warning'}>{r.txn_type}</Badge>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => (r.category
        ? <span title={CATEGORY_LABEL[r.category] || ''}>{r.category}</span>
        : <span style={{ color: 'var(--text-light)' }}>—</span>),
    },
    { key: 'payee', header: 'Payee', render: (r) => r.payee || '—' },
    {
      key: 'reference',
      header: 'Reference',
      render: (r) => <span style={{ fontSize: 11.5 }}>{r.reference || '—'}</span>,
    },
    { key: 'amount', header: 'Amount', render: (r) => <SignedAmount type={r.txn_type} amount={r.amount} /> },
    { key: 'balance_after', header: 'Balance', render: (r) => fmtCurrency(r.balance_after) },
    ...(canWrite ? [{
      key: 'actions',
      header: '',
      render: (r) => (
        <button className="btn btn-xs btn-ghost" disabled={!!r.reverses_txn_id} title={r.reverses_txn_id ? 'This is itself a reversal' : 'Post an opposing entry'} onClick={(e) => { e.stopPropagation(); reverse(r); }}>Reverse</button>
      ),
    }] : []),
  ];

  const categoryBars = CATEGORIES
    .map((c) => ({ category: c, amount: cat[c] || 0 }))
    .filter((r) => r.amount > 0);

  return (
    <div>
      <PageHeader
        title="NOAR Wallet & Open Access Charges"
        subtitle="Recharge the NOAR wallet and pay Open Access charges (ISTS / RLDC / application) to Grid India & CTUIL"
        actions={canWrite && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => open('CHARGE')}>+ Pay OA Charge</button>
            <button className="btn btn-primary" onClick={() => open('RECHARGE')}>+ Recharge Wallet</button>
          </div>
        )}
      />

      {error && <div className="form-error">{error}</div>}

      <div className="kpi-grid">
        <StatCard
          label="Wallet Balance"
          value={fmtCurrency(summary?.balance || 0)}
          tone={isLow ? 'amber' : 'green'}
          hint={summary?.months_of_cover != null
            ? `≈ ${summary.months_of_cover} months of cover at current burn`
            : 'No charges booked yet'}
        />
        <StatCard
          label="Total Recharged"
          value={fmtCurrency(summary?.total_recharged || 0)}
          hint={`${fmtNumber(summary?.recharge_count || 0, 0)} recharges`}
        />
        <StatCard
          label="Total Charges Paid"
          value={fmtCurrency(summary?.total_charges || 0)}
          tone="amber"
          hint={`${fmtNumber(summary?.charge_count || 0, 0)} open-access charges`}
        />
        <StatCard
          label="ISTS Charges"
          value={fmtCurrency(cat.ISTS || 0)}
          hint={`RLDC ${fmtCurrency(cat.RLDC || 0)} · App ${fmtCurrency(cat.APPLICATION || 0)}`}
        />
      </div>

      {isLow && (
        <div className="audit-alert audit-alert-warn" style={{ marginBottom: 16 }}>
          Wallet balance is below the {fmtCurrency(summary.low_balance_threshold)} working threshold.
          Recharge before the next scheduling window — Grid India rejects open-access requests against an overdrawn wallet.
        </div>
      )}

      <div className="filters-bar">
        <select value={filters.txn_type} onChange={(e) => setFilters({ ...filters, txn_type: e.target.value })}>
          <option value="">All transactions</option>
          <option value="RECHARGE">Recharges only</option>
          <option value="CHARGE">Charges only</option>
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={filters.start_date} onChange={(e) => setFilters({ ...filters, start_date: e.target.value })} />
        <input type="date" value={filters.end_date} onChange={(e) => setFilters({ ...filters, end_date: e.target.value })} />
        {(filters.txn_type || filters.category || filters.start_date || filters.end_date) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ txn_type: '', category: '', start_date: '', end_date: '' })}>Clear</button>
        )}
      </div>

      <div className="grid-2">
        <Card title="Monthly Recharge vs Open Access Charges">
          {trend.length ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(v, name) => [fmtCurrency(v), name]} />
                  <Legend />
                  <Bar dataKey="recharge" name="Recharged" fill="var(--green)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="charge" name="OA charges" fill="var(--red)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No wallet activity yet.</div>}
        </Card>

        <Card title="Closing Balance Trend">
          {trend.length ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(v) => [fmtCurrency(v), 'Closing balance']} />
                  <Line type="monotone" dataKey="closing_balance" name="Closing balance" stroke="var(--primary)" strokeWidth={2.4} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No wallet activity yet.</div>}
          <p className="inline-note">Month-end balance carried forward across the ledger.</p>
        </Card>
      </div>

      {categoryBars.length > 0 && (
        <Card title="Charges by Category" style={{ marginTop: 16 }}>
          <div className="chart-box" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryBars} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={100} />
                <Tooltip formatter={(v, _n, p) => [fmtCurrency(v), CATEGORY_LABEL[p?.payload?.category] || 'Charges']} />
                <Bar dataKey="amount" name="Paid" radius={[0, 6, 6, 0]} fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card
        title="Wallet Ledger"
        style={{ marginTop: 16 }}
        actions={<span className="inline-note" style={{ marginTop: 0 }}>{fmtNumber(rows.length, 0)} transactions</span>}
      >
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          emptyMessage={loading ? 'Loading...' : 'No wallet transactions for these filters.'}
        />
      </Card>

      <Modal
        open={show}
        onClose={() => setShow(false)}
        title={form.txn_type === 'RECHARGE' ? 'Recharge NOAR Wallet' : 'Pay Open Access Charge'}
        width={520}
      >
        {formError && <div className="form-error">{formError}</div>}
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Type">
              <select value={form.txn_type} onChange={(e) => setForm({ ...form, txn_type: e.target.value })}>
                <option value="RECHARGE">Recharge (credit)</option>
                <option value="CHARGE">Charge (debit)</option>
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input required type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
          </div>

          {form.txn_type === 'CHARGE' && (
            <>
              <div className="form-grid">
                <Field label="Charge Category">
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Payee">
                  <select value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })}>
                    <option value="">Select…</option>
                    {PAYEES.map((pp) => <option key={pp} value={pp}>{pp}</option>)}
                  </select>
                </Field>
              </div>
              <p className="inline-note">{CATEGORY_LABEL[form.category]}</p>
              {bilaterals.length > 0 && (
                <Field label="Link to Open Access deal (optional)">
                  <select value={form.bilateral_id} onChange={(e) => setForm({ ...form, bilateral_id: e.target.value })}>
                    <option value="">Not linked to a specific deal</option>
                    {bilaterals.map((bt) => (
                      <option key={bt.id} value={bt.id}>
                        {bt.loi_contract_ref || bt.counterparty} · {bt.quantum_mw} MW
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}

          {form.txn_type === 'RECHARGE' && (
            <Field label="Payee / Wallet">
              <select value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })}>
                <option value="">Select…</option>
                {PAYEES.map((pp) => <option key={pp} value={pp}>{pp}</option>)}
              </select>
            </Field>
          )}

          <div className="form-grid">
            <Field label="Date">
              <input required type="date" value={form.txn_date} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} />
            </Field>
            <Field label="Reference">
              <input value={form.reference} placeholder="UTR / bill no." onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
          </div>

          <Field label="Notes">
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          {form.txn_type === 'CHARGE' && summary && Number(form.amount) > 0 && (
            <p className="inline-note">
              Balance after this charge: <strong>{fmtCurrency((summary.balance || 0) - Number(form.amount))}</strong>
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
