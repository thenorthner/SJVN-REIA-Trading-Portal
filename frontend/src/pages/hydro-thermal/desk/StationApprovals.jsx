import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { pathFor, writeRolesFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, Modal, Field, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';

const monthName = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const age = (d) => (d == null ? '' : `${d} day${d === 1 ? '' : 's'}`);

// Everything on the desk waiting on a second person: bills in the approval
// chain, debit / credit notes for the checker, and FI postings to hand over.
export default function StationApprovals({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [data, setData] = useState(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [deciding, setDeciding] = useState(null); // { kind, row, action }
  const [comment, setComment] = useState('');
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    api.hydroDesk.approvals({ vertical })
      .then(setData)
      .catch((e) => setPopup({ title: 'Could not load the queue', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(load, [load]);

  async function decide() {
    if (busy.current || !deciding) return;
    const { kind, row, action } = deciding;
    if (!comment.trim() && (kind === 'bill' || kind === 'invoice' || action === 'REJECT')) {
      setPopup({ title: 'A reason is needed', message: kind === 'bill' ? 'Every approval decision carries a comment on the bill\'s trail.' : 'Say why the note is rejected; the maker sees it.' });
      return;
    }
    busy.current = true;
    try {
      if (kind === 'invoice') {
        await api.invoices.act(row.id, row.next_level, action === 'APPROVE' ? 'APPROVED' : 'REJECTED', comment.trim());
        setPopup({ tone: 'success', title: `${row.invoice_no} level ${row.next_level} ${action === 'APPROVE' ? 'approved' : 'rejected'}`, message: '' });
      } else if (kind === 'bill') {
        const r = await api.hydroBilling.act(row.id, { action, comments: comment.trim() });
        setPopup({ tone: 'success', title: `${row.bill_no} ${action === 'APPROVE' ? 'approved' : 'rejected'}`, message: r.approval_status === 'APPROVED' ? 'The bill can now be issued from Monthly Bills.' : '' });
      } else if (action === 'APPROVE') {
        await api.hydroBilling.approveNote(row.id);
        setPopup({ tone: 'success', title: `${row.note_no} approved`, message: 'Posted to the beneficiary\'s account.' });
      } else {
        await api.hydroBilling.rejectNote(row.id, comment.trim());
        setPopup({ tone: 'success', title: `${row.note_no} rejected`, message: '' });
      }
      setDeciding(null); setComment('');
      load();
    } catch (e) {
      setPopup({ title: 'Not done', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  const t = data?.totals || {};
  const bills = (data?.bills || []).filter((b) => !onlyMine || b.is_mine);

  return (
    <div>
      <PageHeader
        title="Approvals Inbox"
        subtitle={`What the ${deskLabel(vertical).toLowerCase()} desk is waiting on a second person for — bills in the approval chain, debit and credit notes for the checker, and Finance postings prepared but not handed over`}
      />
      <div className="kpi-grid">
        <StatCard label="Bills in approval" value={t.bills ?? 0} tone={t.bills ? 'amber' : 'default'} />
        <StatCard label="With me" value={t.mine ?? 0} tone={t.mine ? 'red' : 'default'} onClick={t.mine ? () => setOnlyMine(true) : undefined} />
        <StatCard label="Notes awaiting checker" value={t.notes ?? 0} tone={t.notes ? 'amber' : 'default'} />
        <StatCard label="FI postings to hand over" value={t.postings ?? 0} tone={t.postings ? 'amber' : 'default'} />
      </div>

      <Card
        title="Bills in the approval chain"
        actions={(
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5 }}>
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only with me
          </label>
        )}
      >
        <Table
          columns={[
            { key: 'bill_no', header: 'Bill', render: (r) => <span>{r.bill_no}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.station_name} · {monthName(r.billing_month)} · {r.bill_kind.toLowerCase()}</div></span> },
            { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.bill_kind === 'REVISION' ? r.differential_amount : r.total_charges) },
            { key: 'with', header: 'With', render: (r) => <span>{r.approver_name || '—'} {r.is_final ? <Badge type="primary">Final</Badge> : <span style={{ fontSize: 14, color: 'var(--text-light)' }}>level {r.level}</span>}</span> },
            { key: 'prepared_by', header: 'Prepared by', render: (r) => r.prepared_by || '—' },
            { key: 'age', header: 'Waiting', render: (r) => <span style={{ color: r.age_days > 3 ? 'var(--amber-strong)' : undefined }}>{age(r.age_days)}</span> },
            { key: 'act', header: '', render: (r) => (r.is_mine && r.is_final ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'bill', row: r, action: 'APPROVE' }); }}>Approve</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'bill', row: r, action: 'REJECT' }); }}>Reject</button>
              </span>
            ) : <Link className="btn btn-secondary btn-sm" to={pathFor(vertical, 'billing')}>Open</Link>) },
          ]}
          rows={bills}
          emptyMessage={data ? (onlyMine ? 'Nothing is waiting with you.' : 'No bill is in the approval chain.') : 'Loading…'}
        />
        <p className="inline-note">A final approver decides here; an intermediate step is forwarded from Monthly Bills, where the next approver is chosen.</p>
      </Card>

      {/* The station's own invoices on the approval chain, such as a DSM pool
          bill: they waited on the REIA desk unseen here (Thermal QA run 5). */}
      <Card title="Station invoices on the approval chain (DSM pool bills)">
        <Table
          columns={[
            { key: 'invoice_no', header: 'Invoice', render: (r) => <span>{r.invoice_no}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.billing_period} · {r.status.replace(/_/g, ' ').toLowerCase()}</div></span> },
            { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
            { key: 'level', header: 'Next', render: (r) => (r.to_submit ? 'Submit for approval' : `Level ${r.next_level}`) },
            { key: 'by', header: 'Raised by', render: (r) => <span>{r.created_by || '—'}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{age(r.age_days)} ago</div></span> },
            { key: 'act', header: '', render: (r) => (!canWrite ? null : r.to_submit
              ? <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await api.invoices.submitForApproval(r.id); load(); } catch (e) { setPopup({ title: 'Not submitted', message: e.response?.data?.error || e.message }); } }}>Submit</button>
              : (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'invoice', row: r, action: 'APPROVE' }); }}>Approve</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'invoice', row: r, action: 'REJECT' }); }}>Reject</button>
                </span>
              )) },
          ]}
          rows={data?.invoices || []}
          emptyMessage={data ? 'No station invoice is waiting.' : 'Loading…'}
        />
      </Card>

      <Card title="Debit / credit notes awaiting the checker">
        <Table
          columns={[
            { key: 'note_no', header: 'Note', render: (r) => <span>{r.note_no} <Badge type={r.note_type === 'CREDIT' ? 'success' : 'warning'}>{r.note_type === 'CREDIT' ? 'Credit' : 'Debit'}</Badge><div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.station_name} · {fmtDate(r.note_date)}</div></span> },
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
            { key: 'reason', header: 'Why', render: (r) => <span style={{ fontSize: 14.5 }}>{r.remarks}{r.against_doc_no ? <div style={{ color: 'var(--text-light)' }}>Against {r.against_doc_no}</div> : null}</span> },
            { key: 'by', header: 'Raised by', render: (r) => <span>{r.created_by_name || '—'}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{age(r.age_days)} ago</div></span> },
            { key: 'act', header: '', render: (r) => (!canWrite ? null : r.own
              ? <span style={{ fontSize: 14, color: 'var(--text-light)' }}>Your note — needs another checker</span>
              : (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'note', row: r, action: 'APPROVE' }); }}>Approve</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { setComment(''); setDeciding({ kind: 'note', row: r, action: 'REJECT' }); }}>Reject</button>
                </span>
              )) },
          ]}
          rows={data?.notes || []}
          emptyMessage={data ? 'No note is waiting for approval.' : 'Loading…'}
        />
      </Card>

      <Card title="Finance postings prepared, not handed over">
        <Table
          columns={[
            { key: 'posting_no', header: 'Posting' },
            { key: 'station_name', header: 'Station' },
            { key: 'period_month', header: 'Month', render: (r) => monthName(r.period_month) },
            { key: 'bill_category', header: 'Category', render: (r) => r.bill_category.toLowerCase() },
            { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
            { key: 'age', header: 'Prepared', render: (r) => `${age(r.age_days)} ago` },
            { key: 'go', header: '', render: () => <Link className="btn btn-secondary btn-sm" to={pathFor(vertical, 'finance')}>Open</Link> },
          ]}
          rows={data?.postings || []}
          emptyMessage={data ? 'No posting is waiting.' : 'Loading…'}
        />
      </Card>

      <Modal open={!!deciding} onClose={() => setDeciding(null)} title={deciding ? `${deciding.action === 'APPROVE' ? 'Approve' : 'Reject'} ${deciding.row.bill_no || deciding.row.note_no || deciding.row.invoice_no}` : ''}>
        {deciding && (
          <div>
            <p style={{ marginTop: 0 }}>
              {deciding.kind === 'bill'
                ? `${deciding.row.station_name}, ${monthName(deciding.row.billing_month)} — ${fmtCurrency(deciding.row.total_charges)}`
                : `${deciding.row.beneficiary_name} — ${fmtCurrency(deciding.row.amount)}`}
            </p>
            <Field label={deciding.kind === 'bill' ? 'Comment for the trail' : (deciding.action === 'REJECT' ? 'Reason' : 'Comment (optional)')} required={deciding.kind === 'bill' || deciding.action === 'REJECT'}>
              <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn-outline" onClick={() => setDeciding(null)}>Cancel</button>
              <button type="button" className={`btn ${deciding.action === 'APPROVE' ? 'btn-primary' : 'btn-danger'}`} onClick={decide}>{deciding.action === 'APPROVE' ? 'Approve' : 'Reject'}</button>
            </div>
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
