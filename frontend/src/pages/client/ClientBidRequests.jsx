import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// What the client asks the desk to do, and who in the client's office agreed.
//
// The portal could only read, so a client that wanted power bought asked by phone
// and nothing on either side recorded the asking. A request is raised here by the
// client's maker and cleared by its checker — never the same person — and only
// then is it the desk's to act on. The desk links the bid it placed, so the
// client can see what was done about it.

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const PRODUCTS = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM'];
const STATUS_TONE = {
  PENDING_CHECK: 'warning', APPROVED: 'primary', REJECTED: 'danger',
  WITHDRAWN: 'neutral', PLACED: 'success',
};
const STATUS_LABEL = {
  PENDING_CHECK: 'Awaiting our checker', APPROVED: 'With the desk',
  REJECTED: 'Sent back', WITHDRAWN: 'Withdrawn', PLACED: 'Bid placed',
};

const EMPTY = { side: 'BUY', exchange: 'IEX', product: 'DAM', delivery_date: '', quantum_mw: '', price_limit_per_unit: '', notes: '' };

export default function ClientBidRequests() {
  const { user } = useAuth();
  const isMaker = user?.role === 'TRADING_CLIENT_MAKER';
  const isChecker = user?.role === 'TRADING_CLIENT_CHECKER';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showRaise, setShowRaise] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(null); // the request being cleared
  const [remarks, setRemarks] = useState('');

  function load() {
    setLoading(true);
    api.clientBidRequests.list()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load your requests.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const counts = useMemo(() => rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    if (r.status === 'PENDING_CHECK' || r.status === 'APPROVED') acc.open_mw += r.quantum_mw || 0;
    return acc;
  }, { open_mw: 0 }), [rows]);

  async function raise(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.clientBidRequests.raise({
        ...form,
        quantum_mw: Number(form.quantum_mw),
        price_limit_per_unit: form.price_limit_per_unit === '' ? null : Number(form.price_limit_per_unit),
      });
      setShowRaise(false);
      setForm(EMPTY);
      setMessage(`Request raised for ${fmtDate(created.delivery_date)} — it now needs your checker.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The request could not be raised.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      await api.clientBidRequests.check(checking.id, { decision, remarks: remarks.trim() || undefined });
      setMessage(decision === 'APPROVE'
        ? 'Approved — the desk can act on it now.'
        : 'Sent back to whoever raised it.');
      setChecking(null);
      setRemarks('');
      load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(row) {
    if (!window.confirm(`Withdraw the request for ${fmtNumber(row.quantum_mw)} MW on ${fmtDate(row.delivery_date)}?`)) return;
    setError('');
    try {
      await api.clientBidRequests.withdraw(row.id, {});
      setMessage('Request withdrawn.');
      load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The request could not be withdrawn.');
    }
  }

  const columns = [
    { key: 'delivery_date', header: 'Delivery', render: (r) => fmtDate(r.delivery_date) },
    { key: 'side', header: 'Side', render: (r) => <Badge type={r.side === 'BUY' ? 'primary' : 'neutral'}>{r.side}</Badge> },
    { key: 'exchange', header: 'Exchange / Product', render: (r) => `${r.exchange} · ${r.product}` },
    { key: 'quantum_mw', header: 'Quantum (MW)', render: (r) => fmtNumber(r.quantum_mw) },
    {
      key: 'price_limit_per_unit',
      header: 'Price limit (Rs/kWh)',
      render: (r) => (r.price_limit_per_unit == null
        ? '—'
        : `${r.side === 'BUY' ? 'up to ' : 'at least '}${fmtNumber(r.price_limit_per_unit, 2)}`),
    },
    { key: 'raised_by_name', header: 'Raised by', render: (r) => (
      <>
        {r.raised_by_name || '—'}
        <div className="audit-muted">{fmtDateTime(r.raised_at)}</div>
      </>
    ) },
    { key: 'status', header: 'Status', render: (r) => (
      <>
        <Badge type={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] || r.status}</Badge>
        {r.checked_by_name && <div className="audit-muted">{r.status === 'REJECTED' ? 'Sent back' : 'Cleared'} by {r.checked_by_name}</div>}
        {r.check_remarks && <div className="audit-muted">{r.check_remarks}</div>}
        {r.bid_id && <div className="audit-muted">Bid {r.bid_id}{r.bid_status ? ` · ${r.bid_status}` : ''}</div>}
      </>
    ) },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {isChecker && r.status === 'PENDING_CHECK' && (
            <button type="button" className="btn btn-xs btn-primary" onClick={() => { setChecking(r); setRemarks(''); }}>
              Review
            </button>
          )}
          {(isMaker || isChecker) && ['PENDING_CHECK', 'APPROVED', 'REJECTED'].includes(r.status) && (
            <button type="button" className="btn btn-xs btn-outline" onClick={() => withdraw(r)}>Withdraw</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Bid Requests"
        subtitle="What we have asked the SJVN desk to bid for us"
        actions={isMaker && (
          <button type="button" className="btn btn-primary" onClick={() => { setForm(EMPTY); setShowRaise(true); }}>
            Raise a request
          </button>
        )}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      {!isMaker && !isChecker && (
        <div className="alert alert-info" role="status">
          This login reads the account. Raising a request is the maker&apos;s to do and clearing it the checker&apos;s.
        </div>
      )}

      <div className="kpi-grid">
        <StatCard label="Awaiting our checker" value={fmtNumber(counts.PENDING_CHECK || 0, 0)} tone={counts.PENDING_CHECK ? 'amber' : 'default'} />
        <StatCard label="With the desk" value={fmtNumber(counts.APPROVED || 0, 0)} tone="blue" />
        <StatCard label="Bids placed" value={fmtNumber(counts.PLACED || 0, 0)} tone="green" />
        <StatCard label="Open quantum" value={`${fmtNumber(counts.open_mw)} MW`} hint="Raised or approved, not yet placed" />
      </div>

      <Card style={{ padding: 0 }}>
        <Table
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={isMaker ? 'No requests yet. Raise one when you want power bought or sold.' : 'No requests yet.'}
        />
      </Card>

      <Modal open={showRaise} onClose={() => setShowRaise(false)} title="Raise a bid request" width={620}>
        <form onSubmit={raise}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Side" required>
              <select className="input" required value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
                <option value="BUY">BUY — we want power</option>
                <option value="SELL">SELL — we have power to sell</option>
              </select>
            </Field>
            <Field label="Delivery date" required>
              <input type="date" className="input" required value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </Field>
            <Field label="Exchange" required>
              <select className="input" required value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })}>
                {EXCHANGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Product" required>
              <select className="input" required value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
                {PRODUCTS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Quantum (MW)" required>
              <input type="number" step="any" min="0" className="input" required value={form.quantum_mw} onChange={(e) => setForm({ ...form, quantum_mw: e.target.value })} />
            </Field>
            <Field label={form.side === 'BUY' ? 'Most we will pay (Rs/kWh)' : 'Least we will take (Rs/kWh)'}>
              <input type="number" step="any" min="0" className="input" value={form.price_limit_per_unit} onChange={(e) => setForm({ ...form, price_limit_per_unit: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes for the desk">
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the desk should know" />
          </Field>
          <p className="report-count">
            The request goes to your own checker first. The desk sees it only once the checker has cleared it.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-outline" onClick={() => setShowRaise(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Raising…' : 'Raise the request'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!checking} onClose={() => setChecking(null)} title="Review the request" width={560}>
        {checking && (
          <>
            <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: 12 }}>
              <div><strong>{checking.side}</strong> {fmtNumber(checking.quantum_mw)} MW on {checking.exchange} · {checking.product}</div>
              <div>Delivery {fmtDate(checking.delivery_date)}</div>
              <div>
                {checking.price_limit_per_unit == null
                  ? 'No price limit given'
                  : `${checking.side === 'BUY' ? 'Up to' : 'At least'} Rs ${fmtNumber(checking.price_limit_per_unit, 2)}/kWh`}
              </div>
              <div>Raised by {checking.raised_by_name} on {fmtDateTime(checking.raised_at)}</div>
              {checking.notes && <div>Note: {checking.notes}</div>}
            </div>
            <Field label="Remarks (required to send it back)">
              <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setChecking(null)}>Close</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide('REJECT')}>Send back</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('APPROVE')}>Approve</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
