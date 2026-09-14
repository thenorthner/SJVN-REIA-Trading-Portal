import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// What clients have asked the desk to bid for them.
//
// A client's maker raises a request and its own checker clears it; only then does
// it appear here as the desk's to act on. The desk places the bid in the bidding
// console as it always has, then names that bid against the request, so a bid can
// be read back to the request that asked for it and a client can see what was
// done. Requests still waiting on the client's own checker are listed but not
// actionable — they are not the desk's yet.

const STATUS_TONE = {
  PENDING_CHECK: 'neutral', APPROVED: 'warning', REJECTED: 'danger',
  WITHDRAWN: 'neutral', PLACED: 'success',
};
const STATUS_LABEL = {
  PENDING_CHECK: "With the client's checker", APPROVED: 'Ours to place',
  REJECTED: 'Sent back by the client', WITHDRAWN: 'Withdrawn', PLACED: 'Placed',
};

export default function ClientBidRequestQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('APPROVED');
  const [placing, setPlacing] = useState(null);
  const [bids, setBids] = useState([]);
  const [bidId, setBidId] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api.clientBidRequests.list(status ? { status } : undefined)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load the requests.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [status]);

  // The bids already on the book for that client and delivery date — what the
  // desk would be naming against the request.
  useEffect(() => {
    if (!placing) { setBids([]); setBidId(''); return; }
    api.bids.list({ client_id: placing.client_id })
      .then((r) => setBids((Array.isArray(r) ? r : []).filter((b) => b.delivery_date === placing.delivery_date)))
      .catch(() => setBids([]));
  }, [placing]);

  const waiting = useMemo(() => rows.filter((r) => r.status === 'APPROVED'), [rows]);
  const openMw = waiting.reduce((a, r) => a + (r.quantum_mw || 0), 0);

  async function place() {
    setBusy(true);
    setError('');
    try {
      await api.clientBidRequests.place(placing.id, { bid_id: bidId });
      setMessage(`Request from ${placing.client_name} answered with bid ${bidId}.`);
      setPlacing(null);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || 'That bid could not be recorded against the request.');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'client_name', header: 'Client' },
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
    {
      key: 'cleared_by',
      header: "Client's own approval",
      render: (r) => (r.checked_by_name
        ? <>{r.checked_by_name}<div className="audit-muted">{fmtDateTime(r.checked_at)}</div></>
        : <span className="audit-muted">not cleared yet</span>),
    },
    { key: 'status', header: 'Status', render: (r) => (
      <>
        <Badge type={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] || r.status}</Badge>
        {r.bid_id && <div className="audit-muted">Bid {r.bid_id}{r.bid_status ? ` · ${r.bid_status}` : ''}</div>}
      </>
    ) },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => (r.status === 'APPROVED'
        ? <button type="button" className="btn btn-xs btn-primary" onClick={() => setPlacing(r)}>Record the bid</button>
        : null),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Client Bid Requests"
        subtitle="What clients have asked the desk to bid for them, once their own checker has cleared it"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <div className="kpi-grid">
        <StatCard label="Ours to place" value={fmtNumber(waiting.length, 0)} tone={waiting.length ? 'amber' : 'default'} />
        <StatCard label="Quantum asked for" value={`${fmtNumber(openMw)} MW`} hint="Approved and not yet placed" />
      </div>

      <Card>
        <div className="report-toolbar">
          <label className="report-search">
            Showing:
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="APPROVED">Ours to place</option>
              <option value="PENDING_CHECK">With the client&apos;s checker</option>
              <option value="PLACED">Already placed</option>
              <option value="REJECTED">Sent back by the client</option>
              <option value="WITHDRAWN">Withdrawn</option>
              <option value="">Everything</option>
            </select>
          </label>
        </div>
        <Table
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={status === 'APPROVED' ? 'Nothing waiting on the desk.' : 'No requests in this state.'}
        />
      </Card>

      <Modal open={!!placing} onClose={() => setPlacing(null)} title="Record the bid placed" width={600}>
        {placing && (
          <>
            <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: 12 }}>
              <div><strong>{placing.client_name}</strong> asked to {placing.side === 'BUY' ? 'buy' : 'sell'} {fmtNumber(placing.quantum_mw)} MW</div>
              <div>{placing.exchange} · {placing.product}, delivery {fmtDate(placing.delivery_date)}</div>
              {placing.notes && <div>Note from the client: {placing.notes}</div>}
            </div>

            {bids.length === 0 ? (
              <div className="alert alert-warning" role="status">
                This client has no bid on record for {fmtDate(placing.delivery_date)} yet. Place it in the bidding
                console first, then come back and name it here.
              </div>
            ) : (
              <Field label="The bid that answers this request" required>
                <select className="input" value={bidId} onChange={(e) => setBidId(e.target.value)}>
                  <option value="">Choose a bid…</option>
                  {bids.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id} · {fmtNumber(b.quantum_mw)} MW @ {fmtNumber(b.price_per_unit, 2)} · {b.status}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setPlacing(null)}>Close</button>
              <button type="button" className="btn btn-primary" disabled={!bidId || busy} onClick={place}>
                {busy ? 'Recording…' : 'Record it'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
