import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency,
} from '../../components/ui.jsx';

// REIA's month-end handover to corporate Finance — the same three steps as the
// hydro one (gather and check, book against Finance's voucher, reverse when
// wrong), booked by what a document is to Finance: sales to buyers, developers'
// bills SJVN accepted, and credit notes.

const lastMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DEFAULT_CATEGORIES = [
  { value: 'SALE', label: 'Sale to buyers (receivable)' },
  { value: 'PURCHASE', label: 'Purchase from developers (payable)' },
  { value: 'CREDIT_NOTE', label: 'Credit notes issued' },
];

const amount = (v) => (
  <span style={{ color: v < 0 ? 'var(--red)' : undefined }}>{fmtCurrency(v)}</span>
);

// The parts a document splits into, shared by the waiting list and a posting's lines.
const partColumns = [
  { key: 'energy_amount', header: 'Energy', render: (r) => amount(r.energy_amount ?? r.energy) },
  { key: 'margin_amount', header: 'Margin', render: (r) => amount(r.margin_amount ?? r.margin) },
  { key: 'pass_through_amount', header: 'Pass-through', render: (r) => amount(r.pass_through_amount ?? r.pass_through) },
  { key: 'tax_amount', header: 'Tax', render: (r) => amount(r.tax_amount ?? r.tax) },
  { key: 'adjustment_amount', header: 'Adj.', render: (r) => amount(r.adjustment_amount ?? r.adjustment) },
  { key: 'total_amount', header: 'Total', render: (r) => <strong>{amount(r.total_amount ?? r.total)}</strong> },
];

const docColumns = [
  { key: 'doc_no', header: 'Document', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5 }}>{r.doc_no}</span> },
  { key: 'doc_kind', header: 'Kind', render: (r) => <Badge label={r.doc_kind} /> },
  { key: 'contract_no', header: 'Contract' },
  { key: 'counterparty', header: 'Counterparty' },
  ...partColumns,
];

export default function ReiaFinance() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [month, setMonth] = useState(lastMonth());
  const [category, setCategory] = useState('SALE');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [postings, setPostings] = useState([]);
  const [bookable, setBookable] = useState(null);
  const [open, setOpen] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [posting, setPosting] = useState(null);
  const [voucher, setVoucher] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.reiaFi.postings()
      .then((r) => {
        setPostings(r?.postings || []);
        if (r?.categories?.length) setCategories(r.categories);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
    if (!month) { setBookable(null); return; }
    api.reiaFi.bookable({ period_month: month, category })
      .then(setBookable)
      .catch(() => setBookable(null));
  }, [month, category]);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await fn();
      setNotice(typeof msg === 'function' ? msg(r) : msg);
      load();
      return r;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const totals = bookable?.totals;

  async function doPrepare() {
    await run(
      () => api.reiaFi.prepare({ period_month: month, category }),
      (r) => `${r.posting_no} prepared — ${r.docs_count} document(s), ${fmtCurrency(r.total_amount)}. Check it, then post it to Finance.`,
    );
  }

  async function doPost(e) {
    e.preventDefault();
    const r = await run(
      () => api.reiaFi.post(posting.id, { fi_document_no: voucher || null }),
      (res) => `${res.posting_no} posted${res.fi_document_no ? ` under ${res.fi_document_no}` : ''}.`,
    );
    if (r) { setPosting(null); setVoucher(''); }
  }

  async function doReverse(e) {
    e.preventDefault();
    const r = await run(
      () => api.reiaFi.reverse(reversing.id, reason),
      (res) => `${res.reversed} reversed by ${res.reversal_posting_no}. ${res.note}`,
    );
    if (r) { setReversing(null); setReason(''); }
  }

  const columns = [
    { key: 'posting_no', header: 'Posting', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5 }}>{r.posting_no}</span> },
    { key: 'period_month', header: 'Month' },
    { key: 'category', header: 'Category', render: (r) => <Badge label={r.category} /> },
    { key: 'docs_count', header: 'Docs' },
    ...partColumns,
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span>
          <Badge status={r.status} label={r.status} />
          {r.fi_document_no && (
            <span style={{ display: 'block', fontSize: 13, color: 'var(--text-light)' }}>{r.fi_document_no}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn-link" onClick={() => api.reiaFi.posting(r.id).then(setOpen)}>
            View
          </button>
          {canWrite && r.status === 'PREPARED' && (
            <button type="button" className="btn-link" onClick={() => { setPosting(r); setVoucher(''); }}>
              Post
            </button>
          )}
          {canWrite && r.status !== 'REVERSED' && (
            <button type="button" className="btn-link" onClick={() => { setReversing(r); setReason(''); }}>
              Reverse
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Finance Posting (FI) — REIA"
        subtitle="The month-end handover of REIA billing to corporate Finance: sales, purchases and credit notes"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card title="Prepare a month">
        <div className="form-grid">
          <Field label="Month" htmlFor="rf-month">
            <input id="rf-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Field label="What Finance is booking" htmlFor="rf-cat">
            <select id="rf-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>

        {bookable && (
          <>
            <div className="stat-grid">
              <StatCard label="Documents waiting" value={totals.docs_count} hint="issued or accepted, not yet booked" />
              <StatCard label="Energy" value={fmtCurrency(totals.energy_amount)} hint="energy, capacity and the like" />
              <StatCard label="Trading margin" value={fmtCurrency(totals.margin_amount)} hint="SJVN's own income" />
              <StatCard label="Pass-through" value={fmtCurrency(totals.pass_through_amount)} hint="NRLDC + transmission" />
              <StatCard label="To book" value={fmtCurrency(totals.total_amount)} tone="primary" />
            </div>

            <Table
              columns={docColumns}
              rows={bookable.documents}
              emptyMessage="Nothing waiting — either the month has nothing of this kind, or it is already booked."
            />

            {canWrite && bookable.documents.length > 0 && (
              <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={doPrepare}>
                Prepare the posting
              </button>
            )}
          </>
        )}
      </Card>

      <Card title="Postings">
        <Table columns={columns} rows={postings} emptyMessage="Nothing from REIA has been handed to Finance yet." />
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.posting_no : ''} width={980}>
        {open && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 13 }}>
              <Badge status={open.status} label={open.status} /> · {open.category_label} · {open.period_month}
              {open.fi_document_no && <> · Finance voucher {open.fi_document_no}</>}
              {open.reverses_posting_no && <> · reverses {open.reverses_posting_no}</>}
              {open.reversal_reason && <div style={{ marginTop: 4 }}>{open.reversal_reason}</div>}
            </div>
            <Table columns={docColumns} rows={open.lines || []} />
            <p style={{ color: 'var(--text-light)', fontSize: 13.5, marginTop: 10 }}>
              These are the amounts as they were booked. A later change to any of these documents
              does not change them, because what Finance holds is not ours to restate.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!posting} onClose={() => setPosting(null)} title={`Post ${posting?.posting_no || ''} to Finance`}>
        <form onSubmit={doPost}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            Booking {fmtCurrency(posting?.total_amount)} across {posting?.docs_count} document(s). Record
            the voucher number Finance returns, so the entry can be found from either side.
          </p>
          <Field label="Finance document number" htmlFor="rf-vch">
            <input id="rf-vch" value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="e.g. VCH-2026-90412" />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>Post it</button>
            <button type="button" className="btn" onClick={() => setPosting(null)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!reversing} onClose={() => setReversing(null)} title={`Reverse ${reversing?.posting_no || ''}`}>
        <form onSubmit={doReverse}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            The posting is not deleted: a counter-entry is written beside it and both stay visible.
            The month is then free to be prepared and posted again.
          </p>
          <Field label="Reason" required htmlFor="rf-rev">
            <input id="rf-rev" required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>Reverse it</button>
            <button type="button" className="btn" onClick={() => setReversing(null)}>Keep it</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
