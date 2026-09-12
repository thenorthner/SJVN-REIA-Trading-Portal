import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The SLDC / RLDC standing clearances on record, and what each one allows.
//
// This screen ran on six invented NOC numbers, and its renewal alert counted
// days from a date written into the source ("today = 2026-08-01"), so it warned
// about an expiry that had nothing to do with the actual date. Both the list and
// the clauses come from the register the desk fills in on NOC Updation, and the
// client's own clearance terms come from the clearance the bid checks use.

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Days from today to a date on record — negative once it has passed. */
function daysUntil(date) {
  if (!date) return null;
  const then = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.round((startOfDay(then) - startOfDay(new Date())) / DAY);
}

function stateOf(noc) {
  if (noc.status === 'CANCELLED') return 'CANCELLED';
  const left = daysUntil(noc.noc_valid_to);
  if (left == null) return 'UNKNOWN';
  if (left < 0) return 'EXPIRED';
  if (left <= 30) return 'RENEWAL_DUE';
  return 'ACTIVE';
}

const TONE = { ACTIVE: 'success', RENEWAL_DUE: 'warning', EXPIRED: 'danger', CANCELLED: 'neutral', UNKNOWN: 'neutral' };
const LABEL = { ACTIVE: 'Active', RENEWAL_DUE: 'Renewal due', EXPIRED: 'Expired', CANCELLED: 'Cancelled', UNKNOWN: 'No validity on record' };

export default function NOARRegistry() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', state: '', validFrom: '', validTo: '' });
  const [viewing, setViewing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [clearance, setClearance] = useState(null);

  useEffect(() => {
    api.nocUpdation.list()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load the clearance register.'))
      .finally(() => setLoading(false));
  }, []);

  // The clauses and the order lines of one clearance, plus the terms the bid
  // checks read for that client.
  useEffect(() => {
    if (!viewing) { setDetail(null); setClearance(null); return; }
    let live = true;
    api.nocUpdation.get(viewing.id).then((d) => { if (live) setDetail(d); }).catch(() => {});
    api.bids.standingClearance(viewing.client_id)
      .then((c) => { if (live) setClearance(c); })
      .catch(() => { if (live) setClearance(null); });
    return () => { live = false; };
  }, [viewing]);

  const decorated = useMemo(() => rows.map((r) => ({ ...r, state: stateOf(r), days_left: daysUntil(r.noc_valid_to) })), [rows]);

  const shown = useMemo(() => decorated.filter((r) => {
    const q = filters.q.trim().toLowerCase();
    if (q && ![r.noc_reference_no, r.client_name, r.issuing_authority, r.noar_id].join(' ').toLowerCase().includes(q)) return false;
    if (filters.state && r.state !== filters.state) return false;
    if (filters.validFrom && String(r.noc_valid_from) < filters.validFrom) return false;
    if (filters.validTo && String(r.noc_valid_to) > filters.validTo) return false;
    return true;
  }), [decorated, filters]);

  // What needs attention: expired clearances, then the ones closest to expiry.
  const attention = decorated
    .filter((r) => r.state === 'EXPIRED' || r.state === 'RENEWAL_DUE')
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
  const active = decorated.filter((r) => r.state === 'ACTIVE');

  const columns = [
    { key: 'noc_reference_no', header: 'NOC No.', render: (r) => <strong>{r.noc_reference_no}</strong> },
    { key: 'client_name', header: 'Client' },
    { key: 'issuing_authority', header: 'Issued By' },
    { key: 'noc_valid_from', header: 'Validity From', render: (r) => fmtDate(r.noc_valid_from) },
    { key: 'noc_valid_to', header: 'Validity To', render: (r) => fmtDate(r.noc_valid_to) },
    { key: 'total_quantum_mw', header: 'Quantum (MW)', render: (r) => fmtNumber(r.total_quantum_mw) },
    { key: 'order_count', header: 'Order Lines', render: (r) => fmtNumber(r.order_count, 0) },
    {
      key: 'state',
      header: 'Status',
      render: (r) => (
        <Badge type={TONE[r.state]}>
          {LABEL[r.state]}
          {r.state === 'RENEWAL_DUE' ? ` · ${r.days_left}d` : ''}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => <button type="button" className="btn btn-xs btn-outline" onClick={() => setViewing(r)}>View</button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Standing Clearance Registry"
        subtitle="The SLDC / RLDC no-objection certificates on record, and what each one allows"
        actions={<Link className="btn btn-primary" to="/erp/noc-updation">Record a clearance</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Clearances on record" value={fmtNumber(rows.length, 0)} tone="blue" />
        <StatCard label="Active today" value={fmtNumber(active.length, 0)} tone="green" />
        <StatCard
          label="Expired or due for renewal"
          value={fmtNumber(attention.length, 0)}
          tone={attention.length ? 'amber' : 'default'}
          hint={attention.length ? `Soonest: ${attention[0].noc_reference_no}` : 'Nothing within 30 days'}
        />
      </div>

      {attention.length > 0 && (
        <div className={`alert alert-${attention[0].state === 'EXPIRED' ? 'error' : 'warning'}`} role="alert">
          <strong>
            {attention[0].state === 'EXPIRED' ? 'Trading is exposed: ' : 'Renewal due: '}
          </strong>
          {attention[0].noc_reference_no} for {attention[0].client_name}
          {attention[0].state === 'EXPIRED'
            ? ` expired on ${fmtDate(attention[0].noc_valid_to)} (${Math.abs(attention[0].days_left)} days ago).`
            : ` expires on ${fmtDate(attention[0].noc_valid_to)}, in ${attention[0].days_left} days.`}
          {attention.length > 1 && ` ${attention.length - 1} more need attention.`}
        </div>
      )}

      <Card title="Select a clearance" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 16, alignItems: 'end' }}>
          <Field label="NOC No. / client / authority">
            <input type="search" className="input" placeholder="Search the register" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className="input" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="RENEWAL_DUE">Renewal due</option>
              <option value="EXPIRED">Expired</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </Field>
          <Field label="Valid from (on or after)">
            <input type="date" className="input" value={filters.validFrom} onChange={(e) => setFilters({ ...filters, validFrom: e.target.value })} />
          </Field>
          <Field label="Valid to (on or before)">
            <input type="date" className="input" value={filters.validTo} onChange={(e) => setFilters({ ...filters, validTo: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 0 }}>
        <Table
          columns={columns}
          data={shown}
          loading={loading}
          emptyMessage={rows.length ? 'No clearance matches this selection.' : 'No clearance has been recorded yet.'}
        />
      </Card>

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`Standing clearance ${viewing.noc_reference_no}`} width={900}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div>
              <h4 style={{ margin: '0 0 12px' }}>On record</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <div><strong>Client:</strong> {viewing.client_name}</div>
                <div><strong>NOAR ID:</strong> {viewing.noar_id || '—'}</div>
                <div><strong>Issued by:</strong> {viewing.issuing_authority}</div>
                <div><strong>Validity:</strong> {fmtDate(viewing.noc_valid_from)} to {fmtDate(viewing.noc_valid_to)}</div>
                <div><strong>Status:</strong> {LABEL[viewing.state]}</div>
                <div><strong>Recorded by:</strong> {viewing.created_by || '—'}</div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px' }}>What it allows</h4>
              {!detail ? (
                <div className="audit-placeholder">Loading the order lines…</div>
              ) : detail.orders?.length ? (
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Direction</th>
                        <th scope="col">Energy Source</th>
                        <th scope="col">Valid From</th>
                        <th scope="col">Valid To</th>
                        <th scope="col">Hours</th>
                        <th scope="col" className="num">Quantum (MW)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.orders.map((o) => (
                        <tr key={o.id}>
                          <td>{o.line_no}</td>
                          <td>{o.direction}</td>
                          <td>{o.energy_source}</td>
                          <td>{fmtDate(o.valid_from)}</td>
                          <td>{fmtDate(o.valid_to)}</td>
                          <td>{o.hour_from}–{o.hour_to}</td>
                          <td className="num">{fmtNumber(o.quantum_mw)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="audit-placeholder">No order lines were recorded against this clearance.</div>
              )}
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px' }}>Terms the bid checks read for this client</h4>
              {clearance ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><strong>SLDC:</strong> {clearance.sldc_name || '—'}</div>
                  <div><strong>Standing clearance no.:</strong> {clearance.standing_clearance_no || '—'}</div>
                  <div><strong>T-GNA approved:</strong> {clearance.tgna_approved_mw != null ? `${fmtNumber(clearance.tgna_approved_mw)} MW` : '—'}</div>
                  <div><strong>Max ramp rate:</strong> {clearance.max_ramp_rate_mw_per_min != null ? `${fmtNumber(clearance.max_ramp_rate_mw_per_min)} MW/min` : '—'}</div>
                  <div><strong>Periphery loss:</strong> {clearance.periphery_loss_percent != null ? `${fmtNumber(clearance.periphery_loss_percent, 2)}%` : '—'}</div>
                  <div><strong>SLDC operating charge:</strong> {clearance.operating_charge_per_day != null ? `₹${fmtNumber(clearance.operating_charge_per_day, 0)} / day` : '—'}</div>
                  <div><strong>Regional Tx charge:</strong> {clearance.regional_tx_charge_per_mw_block != null ? `₹${fmtNumber(clearance.regional_tx_charge_per_mw_block, 3)} / MW / block` : '—'}</div>
                  <div><strong>State Tx charge:</strong> {clearance.state_tx_charge_per_mwh != null ? `₹${fmtNumber(clearance.state_tx_charge_per_mwh, 2)} / MWh` : '—'}</div>
                  <div><strong>Approved by:</strong> {clearance.approver || '—'}{clearance.approver_designation ? `, ${clearance.approver_designation}` : ''}</div>
                  <div><strong>Valid till (client master):</strong> {clearance.valid_till ? fmtDate(clearance.valid_till) : '—'}</div>
                </div>
              ) : (
                <div className="audit-placeholder">
                  No clearance terms are on record for this client, so the bid checks have nothing to measure a bid against.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
