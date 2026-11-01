import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency,
} from '../../components/ui.jsx';
import { reiaTerm } from '../../reiaBeta.js';
import { actsAs } from '../../lib/rolePages.js';

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
  { key: 'doc_no', header: 'Document', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{r.doc_no}</span> },
  { key: 'doc_kind', header: 'Kind', render: (r) => <Badge label={r.doc_kind} /> },
  { key: 'contract_no', header: 'Contract' },
  { key: 'counterparty', header: 'Counterparty' },
  ...partColumns,
];

export default function ReiaFinance() {
  const { user } = useAuth();
  // Phase B.2: the maker prepares a posting; the checker posts, withdraws or reverses it.
  const canWrite = actsAs(user, ROLE_GROUPS.REIA_MAKE);
  const canPost = actsAs(user, ROLE_GROUPS.REIA_CHECK);

  const [month, setMonth] = useState(lastMonth());
  const [category, setCategory] = useState('SALE');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [postings, setPostings] = useState([]);
  const [bookable, setBookable] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [open, setOpen] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [posting, setPosting] = useState(null);
  const [voucher, setVoucher] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // SAP: the posting whose pushes are open, and what was sent for it.
  const [sapFor, setSapFor] = useState(null);
  const [sapPushes, setSapPushes] = useState([]);

  const load = useCallback(() => {
    api.reiaFi.postings()
      .then((r) => {
        setPostings(r?.postings || []);
        if (r?.categories?.length) setCategories(r.categories);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
    if (!month) { setBookable(null); setChecklist(null); return; }
    // L2: the month's open items, seen before it is booked.
    Promise.resolve().then(() => api.reiaFi.checklist(month)).then(setChecklist).catch(() => setChecklist(null));
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
      () => api.reiaFi.post(posting.id, { fi_document_no: voucher.trim() }),
      (res) => `${res.posting_no} posted${res.fi_document_no ? ` under ${res.fi_document_no}` : ''}.`,
    );
    if (r) { setPosting(null); setVoucher(''); }
  }

  async function doReverse(e) {
    e.preventDefault();
    if (reason.trim().length < 10) { setError('Say why (at least 10 characters) — it is what Finance\'s record shows.'); return; }
    const r = await run(
      () => api.reiaFi.reverse(reversing.id, reason.trim()),
      (res) => (res.withdrawn ? `${res.reversed} withdrawn. ${res.note}` : `${res.reversed} reversed by ${res.reversal_posting_no}. ${res.note}`),
    );
    if (r) { setReversing(null); setReason(''); }
  }

  function openSap(r) {
    setSapFor(r);
    setSapPushes([]);
    api.reiaFi.sapPushes(r.id).then((x) => setSapPushes(x?.pushes || [])).catch(() => setSapPushes([]));
  }

  async function doSapHealth() {
    await run(
      () => api.reiaFi.sapHealth(),
      (r) => `SAP is reachable: ${r.host}${r.client ? `, client ${r.client}` : ''}, service answers (${(r.entity_sets || []).join(', ')}).`,
    );
  }

  async function doSapPush() {
    const r = await run(
      () => api.reiaFi.sapPush(sapFor.id),
      (res) => `${res.posting_no}: ${res.sent} invoice(s) sent to SAP.`,
    );
    // Anything not sent is a problem to look at, not a success.
    if (r && (r.failed || r.unknown)) {
      setNotice('');
      setError(`${r.posting_no}: ${r.sent} sent to SAP${r.failed ? `, ${r.failed} refused by SAP` : ''}${r.unknown ? `, ${r.unknown} got no answer from SAP — use "Read back from SAP" before pushing again` : ''}. The list shows why.`);
    }
    // Refresh even when refused: a refusal can follow a push that half went.
    api.reiaFi.sapPushes(sapFor.id).then((x) => setSapPushes(x?.pushes || [])).catch(() => {});
    api.reiaFi.posting(sapFor.id).then(setSapFor).catch(() => {});
  }

  async function doSapCheck() {
    const r = await run(() => api.reiaFi.sapCheck(sapFor.id), (res) => {
      const n = (s) => (res.pushes || []).filter((p) => p.status === s).length;
      return `Read back from SAP: ${n('BOOKED')} booked, ${n('SENT')} waiting for SAP's posting run${n('FAILED') ? `, ${n('FAILED')} not in SAP` : ''}.`;
    });
    if (r) {
      setSapPushes(r.pushes || []);
      // Once SAP has posted every invoice the posting itself is POSTED.
      api.reiaFi.posting(sapFor.id).then(setSapFor).catch(() => {});
    }
  }

  // Every invoice of the open posting already sent (or perhaps sent): nothing left to push.
  const allInSap = !!sapFor && new Set(sapPushes.filter((p) => p.status !== 'FAILED').map((p) => p.posting_line_id)).size >= sapFor.docs_count;

  const sapColumns = [
    { key: 'doc_no', header: 'Invoice', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5 }}>{r.doc_no}</span> },
    { key: 'belnr', header: 'SAP Belnr' },
    { key: 'sap_timestamp', header: 'Sent (SAP run id)' },
    { key: 'lines', header: 'Lines' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={{ FAILED: 'REJECTED', BOOKED: 'APPROVED', SENT: 'SENT', UNKNOWN: 'PENDING' }[r.status]} label={r.status === 'UNKNOWN' ? 'NO ANSWER' : r.status} /> },
    { key: 'sap_fi_doc', header: 'FI document', render: (r) => (r.sap_fi_doc ? `${r.sap_fi_doc} / ${r.sap_fi_year || ''}` : '—') },
    { key: 'message', header: 'SAP says', render: (r) => r.error || r.sap_message || '' },
  ];

  const columns = [
    { key: 'posting_no', header: 'Posting', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{r.posting_no}</span> },
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
            <span style={{ display: 'block', fontSize: 14.5, color: 'var(--text-light)' }}>{r.fi_document_no}</span>
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
          {r.category === 'SALE' && !r.reverses_posting_id && (
            <button type="button" className="btn-link" onClick={() => openSap(r)}>
              SAP
            </button>
          )}
          {/* Once in SAP, SAP books it: no typed voucher, and no reversal from here. */}
          {!!r.in_sap && r.status === 'PREPARED' && (
            <span className="audit-muted">in SAP — &ldquo;Read back&rdquo; brings the FI document</span>
          )}
          {/* Whoever prepared a batch does not also book it. */}
          {!r.in_sap && canPost && r.status === 'PREPARED' && r.created_by !== user?.id && (
            <button type="button" className="btn-link" onClick={() => { setPosting(r); setVoucher(''); }}>
              Post
            </button>
          )}
          {!r.in_sap && canWrite && r.status === 'PREPARED' && r.created_by === user?.id && (
            <span className="audit-muted">prepared by you — the checker posts it</span>
          )}
          {!r.in_sap && canPost && r.status !== 'REVERSED' && !r.reverses_posting_id && (
            <button type="button" className="btn-link" onClick={() => { setReversing(r); setReason(''); }}>
              {r.status === 'PREPARED' ? 'Withdraw' : 'Reverse'}
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

      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {checklist && !checklist.clear && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <strong>{checklist.open_items} open item{checklist.open_items === 1 ? '' : 's'} for {month} before it is booked:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {checklist.items.filter((i) => !i.clear).map((i) => <li key={i.key}>{i.label} — {i.count}{i.amount != null ? `, ₹${Math.abs(i.amount).toLocaleString('en-IN')}` : ''}</li>)}
          </ul>
          <div style={{ fontSize: 14.5, marginTop: 4 }}>Posting is not stopped; the Month-Close Board has the detail.</div>
        </div>
      )}
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
              <StatCard label={reiaTerm('Trading margin')} value={fmtCurrency(totals.margin_amount)} hint="SJVN's own income" />
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

      <Card
        title="Postings"
        actions={(
          <button type="button" className="btn" disabled={busy} onClick={doSapHealth}>
            Test SAP connection
          </button>
        )}
      >
        <Table columns={columns} rows={postings} emptyMessage="Nothing from REIA has been handed to Finance yet." />
      </Card>

      <Modal open={!!sapFor} onClose={() => setSapFor(null)} title={sapFor ? `${sapFor.posting_no} in SAP` : ''} width={1100}>
        {sapFor && (
          <div>
            <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13.5 }}>
              Each invoice goes to SAP as one document: the receivable on key 40 and its parts on
              key 50. SAP&apos;s posting run books it; &ldquo;Read back from SAP&rdquo; then shows the FI document.
              An invoice already in SAP is not sent again. Pushing books the posting, so it is the
              checker&apos;s step, as recording Finance&apos;s voucher is; once SAP has posted every invoice the
              posting shows as posted, under SAP&apos;s FI documents.
            </p>
            {notice && <div className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</div>}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {canPost && sapFor.status === 'PREPARED' && sapFor.created_by !== user?.id && !allInSap && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={doSapPush}>
                  Push to SAP
                </button>
              )}
              {(canWrite || canPost) && (
                <button type="button" className="btn" disabled={busy || !sapPushes.some((p) => p.status !== 'FAILED')} onClick={doSapCheck}>
                  Read back from SAP
                </button>
              )}
            </div>
            <Table columns={sapColumns} rows={sapPushes} emptyMessage="Nothing of this posting has been sent to SAP yet." />
          </div>
        )}
      </Modal>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.posting_no : ''} width={980}>
        {open && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 14.5 }}>
              <Badge status={open.status} label={open.status} /> · {open.category_label} · {open.period_month}
              {open.fi_document_no && <> · Finance voucher {open.fi_document_no}</>}
              {open.reverses_posting_no && <> · reverses {open.reverses_posting_no}</>}
              {open.reversal_reason && <div style={{ marginTop: 4 }}>{open.reversal_reason}</div>}
            </div>
            <Table columns={docColumns} rows={open.lines || []} />
            <p style={{ color: 'var(--text-light)', fontSize: 15, marginTop: 10 }}>
              These are the amounts as they were booked. A later change to any of these documents
              does not change them, because what Finance holds is not ours to restate.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!posting} onClose={() => setPosting(null)} title={`Post ${posting?.posting_no || ''} to Finance`}>
        <form onSubmit={doPost}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 14.5 }}>
            Booking {fmtCurrency(posting?.total_amount)} across {posting?.docs_count} document(s). Record
            the voucher number Finance returns, so the entry can be found from either side.
          </p>
          <Field label="Finance document number" htmlFor="rf-vch">
            <input id="rf-vch" required minLength={3} value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="e.g. SAP-JV-2026-08-9901" />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>Post it</button>
            <button type="button" className="btn" onClick={() => setPosting(null)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!reversing} onClose={() => setReversing(null)} title={`${reversing?.status === 'PREPARED' ? 'Withdraw' : 'Reverse'} ${reversing?.posting_no || ''}`}>
        <form onSubmit={doReverse}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 14.5 }}>
            {reversing?.status === 'PREPARED'
              ? 'This batch was never booked, so it is withdrawn without a counter-entry. Its documents are free to be prepared again.'
              : 'The posting is not deleted: a counter-entry is written beside it and both stay visible. Its documents are then free to be prepared and posted again.'}
          </p>
          <Field label="Reason" required htmlFor="rf-rev">
            <input id="rf-rev" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
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
