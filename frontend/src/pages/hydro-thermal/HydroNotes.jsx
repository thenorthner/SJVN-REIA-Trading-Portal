import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../lib/stationVertical.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';
import ModuleGuide from '../../components/ModuleGuide.jsx';

// Debit and credit notes on a hydro beneficiary's account. A note is raised as a
// draft and moves nothing until a different officer approves it; then a debit
// note lands on the account as its own bill (DN, with its own due date and
// surcharge) and a credit note is set against what the beneficiary owes (CN) —
// never counted as money received. An approved note is corrected by raising the
// opposite one, so the account keeps both.

const STATUS_TONE = { DRAFT: 'PENDING', APPROVED: 'ACTIVE', REJECTED: 'REJECTED', CANCELLED: 'DRAFT' };

const emptyForm = (beneficiary = '') => ({
  note_type: 'DEBIT', beneficiary_name: beneficiary, against_doc_id: '', amount: '', reason: 'REVISED_REA', remarks: '',
});

export default function HydroNotes({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState(null);
  const [openBills, setOpenBills] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [popup, setPopup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('LIST');

  const fail = (title, err) => setPopup({ tone: 'error', title, message: err?.response?.data?.error || err?.message || 'Something went wrong' });

  useEffect(() => {
    api.hydroBilling.stations({ vertical })
      .then((list) => { setStations(list || []); if (list?.length) setStationId((cur) => cur || list[0].id); })
      .catch((e) => fail('Stations could not be loaded', e));
  }, []);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroBilling.notes({ contract_id: stationId, status: statusFilter || undefined })
      .then((r) => { setNotes(r.notes || []); setReasons(r.reasons || []); })
      .catch((e) => fail('Notes could not be loaded', e));
    api.hydroBilling.accounts({ contract_id: stationId }).then((a) => setAccounts(a || [])).catch(() => setAccounts([]));
  }, [stationId, statusFilter]);
  useEffect(load, [load]);

  // The bills a note can refer to: what is still open on the chosen account.
  useEffect(() => {
    if (!form?.beneficiary_name || !stationId) { setOpenBills([]); return; }
    api.hydroBilling.ledger({ contract_id: stationId, beneficiary: form.beneficiary_name })
      .then((acct) => setOpenBills((acct.rows || []).filter((r) => r.side === 'DEBIT' && r.status === 'OPEN' && r.outstanding > 0)))
      .catch(() => setOpenBills([]));
  }, [form?.beneficiary_name, stationId]);

  async function submit(e) {
    e.preventDefault();
    const problems = [];
    if (!form.beneficiary_name) problems.push({ label: 'Beneficiary', message: 'Choose the beneficiary the note is raised on.' });
    if (!(Number(form.amount) > 0)) problems.push({ label: 'Amount', message: 'Enter an amount greater than zero.' });
    if (form.remarks.trim().length < 10) problems.push({ label: 'Particulars', message: 'Say what the note is for, in at least 10 characters — it is printed on the note.' });
    const bill = openBills.find((b) => b.id === form.against_doc_id);
    if (form.note_type === 'CREDIT' && bill && Number(form.amount) > bill.outstanding) {
      problems.push({ label: 'Amount', message: `${bill.doc_no} has only ${fmtCurrency(bill.outstanding)} outstanding; a credit note against it cannot be for more.` });
    }
    if (problems.length) { setPopup({ tone: 'error', title: 'The note cannot be raised yet', items: problems }); return; }
    setBusy(true);
    try {
      const note = await api.hydroBilling.raiseNote({ ...form, contract_id: stationId, amount: Number(form.amount), against_doc_id: form.against_doc_id || null });
      setForm(null);
      load();
      setPopup({ tone: 'success', title: `${note.note_no} raised`, message: 'It is a draft until a different officer approves it. Nothing on the account changes until then.' });
    } catch (err) {
      fail('The note was not raised', err);
    } finally {
      setBusy(false);
    }
  }

  function approve(note) {
    setPopup({
      tone: 'info',
      title: `Approve ${note.note_no}?`,
      message: `${note.note_type === 'DEBIT' ? 'Debit' : 'Credit'} note for ${fmtCurrency(note.amount)}. It will be posted to ${note.beneficiary_name}'s account.`,
      actions: <button type="button" className="btn btn-primary" onClick={() => { setPopup(null); doApprove(note); }}>Approve</button>,
    });
  }

  async function doApprove(note) {
    try {
      const out = await api.hydroBilling.approveNote(note.id);
      load();
      setPopup({
        tone: 'success', title: `${note.note_no} approved`,
        message: note.note_type === 'DEBIT'
          ? `Posted as ${out.ledger_doc.doc_no}, due ${fmtDate(out.ledger_doc.due_date)}.`
          : `Posted as ${out.ledger_doc.doc_no}; ${fmtCurrency(out.applied?.applied || 0)} set against open bills${out.applied?.unapplied > 0 ? `, ${fmtCurrency(out.applied.unapplied)} left on the account as credit` : ''}.`,
      });
    } catch (err) {
      fail('The note was not approved', err);
    }
  }

  async function reject(e) {
    e.preventDefault();
    try {
      await api.hydroBilling.rejectNote(rejecting.id, rejectReason);
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (err) {
      fail('The note was not rejected', err);
    }
  }

  const columns = [
    { key: 'note_no', header: 'Note no.', render: (n) => <strong>{n.note_no}</strong> },
    { key: 'note_type', header: 'Type', render: (n) => <Badge status={n.note_type === 'DEBIT' ? 'PENDING' : 'ACTIVE'} label={n.note_type === 'DEBIT' ? 'Debit note' : 'Credit note'} /> },
    { key: 'beneficiary_name', header: 'Beneficiary' },
    { key: 'against', header: 'Against', render: (n) => n.against_doc_no || 'Oldest open bills' },
    { key: 'amount', header: 'Amount', render: (n) => fmtCurrency(n.amount) },
    { key: 'reason', header: 'Reason', render: (n) => <div><div>{n.reason_label}</div><div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{n.remarks}</div></div> },
    { key: 'status', header: 'Status', render: (n) => (
      <div>
        <Badge status={STATUS_TONE[n.status]} label={n.status} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Raised by {n.created_by_name || '—'} on {fmtDate(n.note_date)}
          {n.approved_by_name && n.status !== 'DRAFT' ? ` · ${n.status.toLowerCase()} by ${n.approved_by_name}` : ''}
          {n.ledger_doc_no ? ` · ledger ${n.ledger_doc_no}` : ''}
          {n.rejection_reason ? ` · ${n.rejection_reason}` : ''}
        </div>
      </div>
    )},
    { key: 'actions', header: '', render: (n) => (canWrite && n.status === 'DRAFT' ? (
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(n)}>Approve</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setRejecting(n); setRejectReason(''); }}>
          {n.created_by === user?.id ? 'Withdraw' : 'Reject'}
        </button>
      </div>
    ) : null) },
  ];

  const pending = notes.filter((n) => n.status === 'DRAFT').length;

  return (
    <div>
      <PageHeader
        title="Debit / Credit Notes"
        subtitle="Adjustments to a beneficiary's account after a bill is issued — raised, approved by a second officer, then posted to the ledger"
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm(emptyForm(accounts[0]?.beneficiary_name || ''))}>+ Raise Note</button>}
      />

      <div className="nb-tabs" role="tablist">
        {[{ key: 'LIST', label: 'Notes' }, { key: 'FYI', label: 'FYI — Reference Guide' }].map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'Debit note', body: 'A debit note increases what the beneficiary owes. Once approved, it lands on the account as its own bill with its own due date and carries late payment surcharge if paid late. Typical uses: revised REA difference, auxiliary consumption beyond normative, exchange rate variation claim.' },
          { title: 'Credit note', body: 'A credit note reduces what the beneficiary owes. It is set against the chosen bill (or the oldest open ones if none is chosen). It is not money received and earns no rebate. Anything it cannot clear stays on the account as credit. Typical uses: overbilling correction, write-off of a disputed amount.' },
          { title: 'Approval workflow', body: 'A note is raised as a DRAFT by one officer and must be approved by a different officer before it takes effect. The same officer who raised it cannot approve it. If rejected, the note is cancelled and nothing changes on the account. An approved note is corrected by raising the opposite type (debit note to reverse a credit, and vice versa).' },
          { title: 'Linking to a bill', body: 'A note can optionally be linked to a specific open bill. For credit notes, this is important — the credit is applied directly against that bill. For debit notes, the link is informational only (the note creates its own bill). If no bill is chosen, credit notes clear the oldest open bills first.' },
        ]} />
      )}

      {tab === 'LIST' && (<>
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="DRAFT">Awaiting approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Withdrawn</option>
        </select>
        {pending > 0 && <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--amber-strong)' }}>{pending} awaiting approval</span>}
      </div>

      <Card>
        <Table columns={columns} rows={notes} emptyMessage="No debit or credit notes on this station yet." />
      </Card>
      </>)}

      <Modal open={!!form} onClose={() => setForm(null)} title="Raise a Debit / Credit Note" width={720}>
        {form && (
          <form onSubmit={submit} noValidate>
            <div className="form-grid">
              <Field label="Note type" required>
                <select value={form.note_type} onChange={(e) => setForm({ ...form, note_type: e.target.value })}>
                  <option value="DEBIT">Debit note — beneficiary owes more</option>
                  <option value="CREDIT">Credit note — beneficiary owes less</option>
                </select>
              </Field>
              <Field label="Beneficiary" required>
                <select value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value, against_doc_id: '' })}>
                  <option value="">Select beneficiary…</option>
                  {accounts.map((a) => <option key={a.beneficiary_name} value={a.beneficiary_name}>{a.beneficiary_name} — {fmtCurrency(a.outstanding)} outstanding</option>)}
                </select>
              </Field>
              <Field label="Against bill">
                <select value={form.against_doc_id} onChange={(e) => setForm({ ...form, against_doc_id: e.target.value })}>
                  <option value="">{form.note_type === 'CREDIT' ? 'Oldest open bills first' : 'Not tied to one bill'}</option>
                  {openBills.map((b) => <option key={b.id} value={b.id}>{b.doc_no} — {fmtCurrency(b.outstanding)} open</option>)}
                </select>
              </Field>
              <Field label="Amount (₹)" required>
                <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Reason" required>
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                  {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Particulars (printed on the note)" required>
              <textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="e.g. Difference on revised REA for June 2026 issued by NRPC on 12.09.2026" />
            </Field>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {form.note_type === 'DEBIT'
                ? 'On approval this becomes its own bill on the account, due as per the PPA payment terms, and carries late payment surcharge if paid late.'
                : 'On approval this is set against the chosen bill (or the oldest open ones). It is not money received and earns no rebate; anything it cannot clear stays on the account as credit.'}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Raising…' : 'Raise as draft'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? `${rejecting.created_by === user?.id ? 'Withdraw' : 'Reject'} ${rejecting.note_no}` : ''} width={520}>
        {rejecting && (
          <form onSubmit={reject}>
            <Field label="Reason" required>
              <textarea rows={3} required minLength={5} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
              <button type="submit" className="btn btn-danger">{rejecting.created_by === user?.id ? 'Withdraw' : 'Reject'}</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} items={popup?.items} actions={popup?.actions} onClose={() => setPopup(null)} />
    </div>
  );
}
