import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';
import { useStation, errOf } from './useStation.js';

// A beneficiary disputing its share of an issued hydro bill. Acknowledge within
// 2 days and resolve within 15 of receipt. Accepting it raises a draft credit
// note for the amount accepted, which a second officer approves before the
// account changes; rejecting it records why.

const STATUS_TONE = {
  RAISED: 'PENDING', ACKNOWLEDGED: 'PENDING', UNDER_REVIEW: 'PENDING', INFO_REQUESTED: 'PENDING', ESCALATED: 'REJECTED',
  RESOLVED_ACCEPTED: 'ACTIVE', RESOLVED_REJECTED: 'DRAFT', CLOSED: 'DRAFT',
};
const STEP_LABEL = {
  ACKNOWLEDGED: 'Acknowledge', UNDER_REVIEW: 'Take up for review', INFO_REQUESTED: 'Ask for information',
  ESCALATED: 'Escalate', RESOLVED_ACCEPTED: 'Accept', RESOLVED_REJECTED: 'Reject', CLOSED: 'Close',
};

export default function HydroDisputes({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('OPEN');
  const [reasons, setReasons] = useState([]);
  const [form, setForm] = useState(null);
  const [shares, setShares] = useState([]);
  const [selected, setSelected] = useState(null);
  const [move, setMove] = useState(null);
  const [popup, setPopup] = useState(null);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.disputes({ contract_id: stationId, status: filter || undefined }).then(setRows).catch((e) => setPopup({ tone: 'error', title: 'Disputes could not be loaded', message: errOf(e) }));
  }, [stationId, filter]);
  useEffect(load, [load]);
  useEffect(() => { api.hydroDesk.disputeReasons().then(setReasons).catch(() => setReasons([])); }, []);
  useEffect(() => {
    if (!form?.beneficiary || !stationId) { setShares([]); return; }
    api.hydroDesk.disputeShares({ contract_id: stationId, beneficiary: form.beneficiary }).then(setShares).catch(() => setShares([]));
  }, [form?.beneficiary, stationId]);

  async function raise(e) {
    e.preventDefault();
    const problems = [];
    if (!form.ledger_doc_id) problems.push({ label: 'Bill', message: 'Choose the bill share being disputed.' });
    if (!(Number(form.disputed_amount) > 0)) problems.push({ label: 'Disputed amount', message: 'Enter the amount the beneficiary disputes.' });
    if (form.description.trim().length < 10) problems.push({ label: 'What is disputed', message: 'Describe the dispute in at least 10 characters.' });
    if (problems.length) { setPopup({ tone: 'error', title: 'The dispute cannot be recorded yet', items: problems }); return; }
    try {
      const d = await api.hydroDesk.raiseDispute({ ...form, disputed_amount: Number(form.disputed_amount) });
      setForm(null);
      load();
      setPopup({ tone: 'success', title: `${d.dispute_no} recorded`, message: `Acknowledge by ${fmtDate(d.ack_due)}; resolve by ${fmtDate(d.resolve_due)}.` });
    } catch (err) {
      setPopup({ tone: 'error', title: 'The dispute was not recorded', message: errOf(err) });
    }
  }

  async function doMove(e) {
    e.preventDefault();
    try {
      const d = await api.hydroDesk.moveDispute(move.dispute.id, { to: move.to, remarks: move.remarks, accepted_amount: move.accepted_amount });
      setMove(null);
      setSelected(d);
      load();
      if (d.status === 'RESOLVED_ACCEPTED') {
        setPopup({ tone: 'success', title: `${d.dispute_no} accepted`, message: `Credit note ${d.credit_note_no} for ${fmtCurrency(d.accepted_amount)} has been raised as a draft. It reaches the beneficiary's account once a second officer approves it in Debit / Credit Notes.` });
      }
    } catch (err) {
      setPopup({ tone: 'error', title: 'The dispute was not moved on', message: errOf(err) });
    }
  }

  const open = rows.filter((r) => r.is_open);
  const overdue = rows.filter((r) => r.resolve_overdue || r.ack_overdue);

  return (
    <div>
      <PageHeader
        title="Dispute Management"
        subtitle="Beneficiaries' disputes on issued station bills — acknowledged within 2 days, resolved within 15, and settled by credit note when accepted"
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary: beneficiaries[0] || '', ledger_doc_id: '', reason_code: 'REA_ENERGY_MISMATCH', disputed_amount: '', description: '', letter_ref: '', received_on: new Date().toISOString().slice(0, 10) })}>+ Record Dispute</button>}
      />
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="OPEN">Open</option>
          <option value="">All</option>
          <option value="RESOLVED_ACCEPTED">Accepted</option>
          <option value="RESOLVED_REJECTED">Rejected</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Open disputes" value={open.length} />
        <StatCard label="Amount under dispute" value={fmtCurrency(open.reduce((a, r) => a + r.disputed_amount, 0))} />
        <StatCard label="Past SLA" value={overdue.length} tone={overdue.length ? 'danger' : 'default'} />
      </div>
      <Card>
        <Table
          onRowClick={(r) => api.hydroDesk.dispute(r.id).then(setSelected)}
          columns={[
            { key: 'dispute_no', header: 'Dispute no.', render: (r) => <strong>{r.dispute_no}</strong> },
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'bill_no', header: 'Bill', render: (r) => `${r.bill_no} · ${r.billing_month}` },
            { key: 'reason', header: 'Reason', render: (r) => r.reason_label },
            { key: 'disputed_amount', header: 'Disputed', render: (r) => fmtCurrency(r.disputed_amount) },
            { key: 'status', header: 'Status', render: (r) => <Badge status={STATUS_TONE[r.status]} label={r.status.replaceAll('_', ' ')} /> },
            { key: 'sla', header: 'SLA', render: (r) => (r.ack_overdue ? <span style={{ color: '#b91c1c' }}>Acknowledge was due {fmtDate(r.ack_due)}</span>
              : r.resolve_overdue ? <span style={{ color: '#b91c1c' }}>Resolution was due {fmtDate(r.resolve_due)}</span>
                : r.is_open ? `Resolve by ${fmtDate(r.resolve_due)}` : '—') },
          ]}
          rows={rows}
          emptyMessage="No dispute on this station."
        />
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title="Record a dispute" width={720}>
        {form && (
          <form onSubmit={raise} noValidate>
            <div className="form-grid">
              <Field label="Beneficiary" required>
                <select value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value, ledger_doc_id: '' })}>
                  {beneficiaries.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Bill share disputed" required>
                <select value={form.ledger_doc_id} onChange={(e) => setForm({ ...form, ledger_doc_id: e.target.value })}>
                  <option value="">Select…</option>
                  {shares.map((s) => <option key={s.ledger_doc_id} value={s.ledger_doc_id}>{s.bill_no} · {s.billing_month} · {s.bill_kind} — {fmtCurrency(s.amount)}</option>)}
                </select>
              </Field>
              <Field label="Reason" required>
                <select value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
                  {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Disputed amount (₹)" required>
                <input type="number" min="0.01" step="0.01" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
              </Field>
              <Field label="Received on" required>
                <input type="date" value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
              </Field>
              <Field label="Beneficiary's letter reference">
                <input value={form.letter_ref} onChange={(e) => setForm({ ...form, letter_ref: e.target.value })} />
              </Field>
            </div>
            <Field label="What is disputed" required>
              <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. PAFM taken as 95.0% but the final REA certifies 92.4% for May 2026" />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Record dispute</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.dispute_no} — ${selected.beneficiary_name}` : ''} width={760}>
        {selected && (
          <div>
            <table className="detail-table"><tbody>
              <tr><td>Bill</td><td>{selected.bill_no} · {selected.billing_month} · billed {fmtCurrency(selected.billed_amount)}</td></tr>
              <tr><td>Reason</td><td>{selected.reason_label}</td></tr>
              <tr><td>What is disputed</td><td>{selected.description}</td></tr>
              <tr><td>Disputed</td><td>{fmtCurrency(selected.disputed_amount)}{selected.accepted_amount != null ? ` · accepted ${fmtCurrency(selected.accepted_amount)}` : ''}</td></tr>
              <tr><td>Received</td><td>{fmtDate(selected.received_on)}{selected.letter_ref ? ` · ${selected.letter_ref}` : ''}</td></tr>
              <tr><td>Status</td><td><Badge status={STATUS_TONE[selected.status]} label={selected.status.replaceAll('_', ' ')} /></td></tr>
              {selected.resolution && <tr><td>Resolution</td><td>{selected.resolution}</td></tr>}
              {selected.credit_note_no && <tr><td>Credit note</td><td><Link to={pathFor(vertical, 'notes')}>{selected.credit_note_no}</Link> ({selected.credit_note_status})</td></tr>}
            </tbody></table>
            <h4 style={{ margin: '16px 0 8px' }}>History</h4>
            <Table
              columns={[
                { key: 'created_at', header: 'When', render: (e) => fmtDate(e.created_at) },
                { key: 'to_status', header: 'Step', render: (e) => e.to_status.replaceAll('_', ' ') },
                { key: 'actor', header: 'By' },
                { key: 'remarks', header: 'Remarks' },
              ]}
              rows={selected.events || []}
            />
            {canWrite && selected.allowed_next.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {selected.allowed_next.map((to) => (
                  <button key={to} type="button" className={to === 'RESOLVED_REJECTED' ? 'btn btn-danger' : to === 'RESOLVED_ACCEPTED' ? 'btn btn-primary' : 'btn btn-outline'}
                    onClick={() => setMove({ dispute: selected, to, remarks: '', accepted_amount: selected.disputed_amount })}>
                    {STEP_LABEL[to] || to}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!move} onClose={() => setMove(null)} title={move ? `${STEP_LABEL[move.to]} — ${move.dispute.dispute_no}` : ''} width={540}>
        {move && (
          <form onSubmit={doMove}>
            {move.to === 'RESOLVED_ACCEPTED' && (
              <Field label="Amount accepted (₹)" required>
                <input type="number" min="0.01" step="0.01" max={move.dispute.disputed_amount} value={move.accepted_amount} onChange={(e) => setMove({ ...move, accepted_amount: e.target.value })} />
              </Field>
            )}
            <Field label="Remarks (sent to the beneficiary)">
              <textarea rows={3} value={move.remarks} onChange={(e) => setMove({ ...move, remarks: e.target.value })} />
            </Field>
            {move.to === 'RESOLVED_ACCEPTED' && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>A draft credit note for the accepted amount is raised against the bill.</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMove(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{STEP_LABEL[move.to]}</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
