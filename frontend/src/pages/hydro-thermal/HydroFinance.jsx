import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency,
} from '../../components/ui.jsx';

// The month-end handover from Commercial to corporate Finance.
//
// Three steps, deliberately separate: gather the month's issued bills and check
// the totals, book them against the voucher Finance returns, and — when a
// booking is wrong — reverse it and start again. A posted entry is Finance's
// record rather than ours, so it is never edited in place.

const thisMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function HydroFinance() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [category, setCategory] = useState('HYDRO');
  const [categories, setCategories] = useState([]);
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

  const station = useMemo(() => stations.find((s) => s.id === stationId), [stations, stationId]);

  useEffect(() => {
    api.hydroBilling.stations()
      .then((list) => {
        setStations(list || []);
        if (list?.length) setStationId((cur) => cur || list[0].id);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const load = useCallback(() => {
    if (!stationId) { setPostings([]); setBookable(null); return; }
    api.hydroBilling.fiPostings({ contract_id: stationId })
      .then((r) => { setPostings(r?.postings || []); setCategories(r?.categories || []); })
      .catch(() => setPostings([]));
    api.hydroBilling.fiBookable({ contract_id: stationId, period_month: month, bill_category: category })
      .then(setBookable)
      .catch(() => setBookable(null));
  }, [stationId, month, category]);
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
      () => api.hydroBilling.fiPrepare({
        contract_id: stationId, period_month: month, bill_category: category,
      }),
      (r) => `${r.posting_no} prepared — ${r.bills_count} bill(s), ${fmtCurrency(r.total_amount)}. Check it, then post it to Finance.`,
    );
  }

  async function doPost(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.fiPost(posting.id, { fi_document_no: voucher || null }),
      (res) => `${res.posting_no} posted${res.fi_document_no ? ` under ${res.fi_document_no}` : ''}.`,
    );
    if (r) { setPosting(null); setVoucher(''); }
  }

  async function doReverse(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.fiReverse(reversing.id, reason),
      (res) => `${res.reversed} reversed by ${res.reversal_posting_no}. ${res.note}`,
    );
    if (r) { setReversing(null); setReason(''); }
  }

  const columns = [
    { key: 'posting_no', header: 'Posting', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.posting_no}</span> },
    { key: 'period_month', header: 'Month' },
    { key: 'bill_category', header: 'Category', render: (r) => <Badge label={r.bill_category} /> },
    { key: 'bills_count', header: 'Bills' },
    { key: 'sale_amount', header: 'Sale', render: (r) => fmtCurrency(r.sale_amount) },
    { key: 'nrldc_amount', header: 'NRLDC', render: (r) => fmtCurrency(r.nrldc_amount) },
    { key: 'tcs_amount', header: 'TCS', render: (r) => fmtCurrency(r.tcs_amount) },
    {
      key: 'total_amount',
      header: 'Total',
      render: (r) => (
        <strong style={{ color: r.total_amount < 0 ? 'var(--red)' : 'var(--text)' }}>
          {fmtCurrency(r.total_amount)}
        </strong>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span>
          <Badge status={r.status} label={r.status} />
          {r.fi_document_no && (
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-light)' }}>{r.fi_document_no}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" className="btn-link"
            onClick={() => api.hydroBilling.fiPosting(r.id).then(setOpen)}
          >
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
        title="Finance Posting (FI)"
        subtitle="The month-end handover of hydro billing to corporate Finance"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card title="Prepare a month">
        <div className="form-grid">
          <Field label="Station" htmlFor="hf-station">
            <select id="hf-station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.station_name} — {s.contract_no}</option>
              ))}
            </select>
          </Field>
          <Field label="Month" htmlFor="hf-month">
            <input id="hf-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Field label="What Finance is booking" htmlFor="hf-cat">
            <select id="hf-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>

        {bookable && (
          <>
            <div className="stat-grid">
              <StatCard label="Bills waiting" value={totals.bills_count} hint="issued, not yet booked" />
              <StatCard label="Sale" value={fmtCurrency(totals.sale_amount)} hint="capacity + energy billed" />
              <StatCard
                label="NRLDC"
                value={fmtCurrency(totals.nrldc_amount)}
                hint="passed through, booked apart from the sale"
              />
              <StatCard label="To book" value={fmtCurrency(totals.total_amount)} tone="primary" />
            </div>

            <Table
              columns={[
                { key: 'bill_no', header: 'Bill no.' },
                { key: 'bill_kind', header: 'Kind', render: (r) => <Badge label={r.bill_kind} /> },
                { key: 'sale_amount', header: 'Sale', render: (r) => fmtCurrency(r.sale_amount) },
                { key: 'nrldc_amount', header: 'NRLDC', render: (r) => fmtCurrency(r.nrldc_amount) },
                { key: 'tcs_amount', header: 'TCS', render: (r) => fmtCurrency(r.tcs_amount) },
                { key: 'total_amount', header: 'Total', render: (r) => fmtCurrency(r.total_amount) },
              ]}
              rows={bookable.bills}
              emptyMessage="Nothing waiting — either the month has no issued bills of this kind, or they are already booked."
            />

            {canWrite && bookable.bills.length > 0 && (
              <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={doPrepare}>
                Prepare the posting
              </button>
            )}
          </>
        )}
      </Card>

      <Card title={`Postings for ${station?.station_name || 'this station'}`}>
        <Table columns={columns} rows={postings} emptyMessage="Nothing has been handed to Finance for this station yet." />
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.posting_no : ''} width={820}>
        {open && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 13 }}>
              <Badge status={open.status} label={open.status} /> · {open.category_label} · {open.period_month}
              {open.plant_code && <> · plant {open.plant_code}</>}
              {open.fi_document_no && <> · Finance voucher {open.fi_document_no}</>}
              {open.reverses_posting_no && <> · reverses {open.reverses_posting_no}</>}
              {open.reversal_reason && <div style={{ marginTop: 4 }}>{open.reversal_reason}</div>}
            </div>
            <Table
              columns={[
                { key: 'bill_no', header: 'Bill no.' },
                { key: 'bill_kind', header: 'Kind', render: (r) => <Badge label={r.bill_kind} /> },
                { key: 'sale_amount', header: 'Sale', render: (r) => fmtCurrency(r.sale_amount) },
                { key: 'nrldc_amount', header: 'NRLDC', render: (r) => fmtCurrency(r.nrldc_amount) },
                { key: 'tcs_amount', header: 'TCS', render: (r) => fmtCurrency(r.tcs_amount) },
                { key: 'total_amount', header: 'Total', render: (r) => <strong>{fmtCurrency(r.total_amount)}</strong> },
              ]}
              rows={open.lines || []}
            />
            <p style={{ color: 'var(--text-light)', fontSize: 12, marginTop: 10 }}>
              These are the amounts as they were booked. A later revision to any of these bills does
              not change them, because what Finance holds is not ours to restate.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!posting} onClose={() => setPosting(null)} title={`Post ${posting?.posting_no || ''} to Finance`}>
        <form onSubmit={doPost}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            Booking {fmtCurrency(posting?.total_amount)} across {posting?.bills_count} bill(s). Record
            the voucher number Finance returns, so the entry can be found from either side.
          </p>
          <Field label="Finance document number" htmlFor="hf-vch">
            <input
              id="hf-vch" value={voucher} onChange={(e) => setVoucher(e.target.value)}
              placeholder="e.g. VCH-2026-90412"
            />
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
          <Field label="Reason" required htmlFor="hf-rev">
            <input id="hf-rev" required value={reason} onChange={(e) => setReason(e.target.value)} />
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
