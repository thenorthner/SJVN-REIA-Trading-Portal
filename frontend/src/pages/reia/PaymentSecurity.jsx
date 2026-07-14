import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = { contract_id: '', mechanism_type: 'LC', amount: '', issuing_bank: '', beneficiary: 'SJVN Limited', validity_start: '', validity_end: '', remarks: '' };

export default function PaymentSecurity() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [status, setStatus] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [actionRow, setActionRow] = useState(null);
  const [actionType, setActionType] = useState('');
  const [actionValue, setActionValue] = useState('');

  function load() {
    setLoading(true);
    const p = expiringOnly ? api.paymentSecurity.expiring(60) : api.paymentSecurity.list(status ? { status } : undefined);
    p.then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [status, expiringOnly]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.paymentSecurity.create({ ...form, amount: Number(form.amount) });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create payment security.');
    }
  }

  function openAction(row, type) {
    setActionRow(row);
    setActionType(type);
    setActionValue(type === 'renew' ? row.validity_end : '');
  }

  async function submitAction(e) {
    e.preventDefault();
    if (actionType === 'renew') {
      await api.paymentSecurity.renew(actionRow.id, { validity_end: actionValue });
    } else {
      await api.paymentSecurity.invoke(actionRow.id, Number(actionValue));
    }
    setActionRow(null);
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'mechanism_type', header: 'Mechanism' },
    { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
    { key: 'utilized_amount', header: 'Utilized', render: (r) => fmtCurrency(r.utilized_amount) },
    { key: 'issuing_bank', header: 'Issuing Bank' },
    { key: 'validity', header: 'Validity', render: (r) => `${r.validity_start} → ${r.validity_end}` },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {r.status !== 'CLOSED' && <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openAction(r, 'renew'); }}>Renew</button>}
          {r.status === 'ACTIVE' && <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); openAction(r, 'invoke'); }}>Invoke</button>}
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Payment Security Tracking"
        subtitle="Letters of Credit, Bank Guarantees and Corpus Fund instruments securing contract payments"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Payment Security</button>}
      />

      <div className="filters-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={expiringOnly}>
          <option value="">All statuses</option>
          {['ACTIVE', 'EXPIRED', 'INVOKED', 'RENEWED', 'CLOSED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
          Expiring within 60 days
        </label>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No payment security records found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Payment Security" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Mechanism Type">
              <select value={form.mechanism_type} onChange={(e) => setForm({ ...form, mechanism_type: e.target.value })}>
                {['LC', 'BANK_GUARANTEE', 'CORPUS_FUND', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Issuing Bank">
              <input value={form.issuing_bank} onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })} />
            </Field>
            <Field label="Beneficiary">
              <input value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value })} />
            </Field>
            <Field label="Validity Start">
              <input required type="date" value={form.validity_start} onChange={(e) => setForm({ ...form, validity_start: e.target.value })} />
            </Field>
            <Field label="Validity End">
              <input required type="date" value={form.validity_end} onChange={(e) => setForm({ ...form, validity_end: e.target.value })} />
            </Field>
          </div>
          <Field label="Remarks">
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!actionRow} onClose={() => setActionRow(null)} title={actionType === 'renew' ? 'Renew Instrument' : 'Invoke Instrument'} width={420}>
        {actionRow && (
          <form onSubmit={submitAction}>
            {actionType === 'renew' ? (
              <Field label="New Validity End Date">
                <input required type="date" value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
              </Field>
            ) : (
              <Field label="Amount to Invoke (₹)">
                <input required type="number" max={actionRow.amount - actionRow.utilized_amount} value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
              </Field>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setActionRow(null)}>Cancel</button>
              <button type="submit" className={actionType === 'renew' ? 'btn btn-primary' : 'btn btn-danger'}>{actionType === 'renew' ? 'Renew' : 'Invoke'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
