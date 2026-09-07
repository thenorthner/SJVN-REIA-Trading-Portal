import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency,
} from '../../components/ui.jsx';

// One beneficiary's running account against a hydro station — the screen SJVN's
// desk knows as Account Display.
//
// Every movement is a numbered document: PB is the beneficiary's share of a
// station bill, LPS a surcharge on it, PMT money received. A payment with
// nothing applied to it shows as ADV, an advance sitting on the account, which
// is why releasing a payment from a bill appears to turn it into one.

const DOC_TONE = {
  PB: { label: 'Bill', color: 'var(--text)' },
  LPS: { label: 'Surcharge', color: 'var(--amber, #b7791f)' },
  PMT: { label: 'Payment', color: 'var(--green, #276749)' },
  ADV: { label: 'Advance', color: 'var(--blue, #2b6cb0)' },
};

const today = () => new Date().toISOString().slice(0, 10);

function DocType({ row }) {
  const tone = DOC_TONE[row.display_type] || DOC_TONE[row.doc_type] || {};
  return (
    <span style={{ color: tone.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {row.display_type}
      <span style={{ fontWeight: 400, color: 'var(--text-light)', fontSize: 11, marginLeft: 6 }}>
        {tone.label}
      </span>
    </span>
  );
}

export default function HydroLedger() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [beneficiary, setBeneficiary] = useState('');
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [payForm, setPayForm] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.hydroBilling.stations()
      .then((list) => {
        setStations(list || []);
        if (list?.length) setStationId((cur) => cur || list[0].id);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const loadAccounts = useCallback(() => {
    if (!stationId) { setAccounts([]); setBeneficiary(''); return; }
    api.hydroBilling.accounts({ contract_id: stationId })
      .then((list) => {
        setAccounts(list || []);
        setBeneficiary((cur) => (list?.some((a) => a.beneficiary_name === cur) ? cur : (list?.[0]?.beneficiary_name || '')));
      })
      .catch(() => setAccounts([]));
  }, [stationId]);
  useEffect(loadAccounts, [loadAccounts]);

  const loadAccount = useCallback(() => {
    if (!stationId || !beneficiary) { setAccount(null); return; }
    setLoading(true);
    api.hydroBilling.ledger({ contract_id: stationId, beneficiary })
      .then(setAccount)
      .catch((e) => { setAccount(null); setError(e.response?.data?.error || e.message); })
      .finally(() => setLoading(false));
  }, [stationId, beneficiary]);
  useEffect(loadAccount, [loadAccount]);

  function refresh() { loadAccount(); loadAccounts(); }

  async function run(fn, successMsg) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await fn();
      setNotice(typeof successMsg === 'function' ? successMsg(r) : successMsg);
      refresh();
      return r;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function doPay(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.pay({
        contract_id: stationId,
        beneficiary,
        amount: Number(payForm.amount),
        payment_date: payForm.payment_date,
        mode: payForm.mode || null,
        reference: payForm.reference || null,
        info: payForm.info || null,
      }),
      (res) => `Payment ${res.doc.doc_no} recorded${res.note ? ` — ${res.note}` : `, clearing ${res.clearings.length} bill(s)`}.`,
    );
    if (r) setPayForm(null);
  }

  async function doReverse(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.reversePayment(reversing.id, reverseReason),
      (res) => `${res.reversed} reversed by ${res.reversal_doc_no}.`,
    );
    if (r) { setReversing(null); setReverseReason(''); }
  }

  const totals = account?.totals || {};
  const lps = account?.lps;

  const columns = [
    { key: 'doc_no', header: 'Doc', render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.doc_no}</span> },
    { key: 'display_type', header: 'Type', render: (r) => <DocType row={r} /> },
    { key: 'doc_date', header: 'Date' },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => (
        <span style={{ color: r.side === 'CREDIT' ? 'var(--green, #276749)' : 'var(--text)' }}>
          {r.side === 'CREDIT' ? '−' : ''}{fmtCurrency(r.amount)}
        </span>
      ),
    },
    { key: 'due_date', header: 'Due date', render: (r) => r.due_date || '—' },
    {
      key: 'outstanding',
      header: 'Outstanding',
      render: (r) => (r.side === 'DEBIT'
        ? <span style={{ fontWeight: r.outstanding > 0 ? 600 : 400 }}>{fmtCurrency(r.outstanding)}</span>
        : (r.unapplied > 0 ? <span style={{ color: 'var(--blue, #2b6cb0)' }}>{fmtCurrency(r.unapplied)} unapplied</span> : '—')),
    },
    { key: 'clr_doc', header: 'CLR doc', render: (r) => (r.clr_doc ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.clr_doc}</span> : '—') },
    { key: 'clr_date', header: 'CLR date', render: (r) => r.clr_date || '—' },
    {
      key: 'status',
      header: '',
      render: (r) => {
        if (r.status === 'REVERSED') return <Badge label="REVERSED" />;
        if (!canWrite || r.doc_type !== 'PMT') return null;
        return (
          <span style={{ display: 'flex', gap: 6 }}>
            {r.unapplied > 0 && (
              <button type="button" className="btn-link" disabled={busy}
                onClick={() => run(() => api.hydroBilling.accountMaintenance(r.id), 'Advance applied to the open bills.')}>
                Apply
              </button>
            )}
            {r.applied > 0 && (
              <button type="button" className="btn-link" disabled={busy}
                onClick={() => run(() => api.hydroBilling.resetClearing(r.id), 'Clearing reset — the payment now sits as an advance.')}>
                Reset
              </button>
            )}
            <button type="button" className="btn-link" disabled={busy} onClick={() => { setReversing(r); setReverseReason(''); }}>
              Reverse
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Hydro Account Display"
        subtitle="What each beneficiary of a hydro station owes, what it has paid, and what is overdue"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card title="Account">
        <div className="form-grid">
          <Field label="Station" htmlFor="hl-station">
            <select id="hl-station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name} — {s.contract_no}</option>)}
            </select>
          </Field>
          <Field label="Beneficiary" htmlFor="hl-beneficiary">
            <select id="hl-beneficiary" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
              {accounts.length === 0 && <option value="">No account yet — issue a bill first</option>}
              {accounts.map((a) => (
                <option key={a.beneficiary_name} value={a.beneficiary_name}>
                  {a.beneficiary_name}{a.outstanding > 0 ? ` — ${fmtCurrency(a.outstanding)} outstanding` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {accounts.length === 0 && (
          <p style={{ color: 'var(--text-light)', fontSize: 13 }}>
            An account opens for each beneficiary when a bill is issued. Nothing has been issued for
            this station yet.
          </p>
        )}
      </Card>

      {account && (
        <>
          <div className="stat-grid">
            <StatCard label="Billed" value={fmtCurrency(totals.billed)} hint="periodic bills raised" />
            <StatCard label="Received" value={fmtCurrency(totals.received)} hint="payments on the account" />
            <StatCard
              label="Outstanding"
              value={fmtCurrency(totals.outstanding)}
              tone={totals.outstanding > 0 ? 'warning' : 'default'}
              hint={totals.surcharge > 0 ? `includes ${fmtCurrency(totals.surcharge)} surcharge` : 'nothing overdue billed'}
            />
            <StatCard
              label="Advance"
              value={fmtCurrency(totals.advance)}
              hint={totals.advance > 0 ? 'unapplied — can be set against a bill' : 'none held'}
            />
          </div>

          {lps?.total_chargeable > 0 && (
            <div className="alert alert-warning" role="alert">
              <strong>{fmtCurrency(lps.total_chargeable)}</strong> of late payment surcharge has accrued
              and not been charged ({lps.lines.filter((l) => l.chargeable > 0).map((l) => `${l.doc_no}: ${l.days_overdue} days at ${Number(l.effective_pct).toFixed(2)}% p.a.`).join('; ')}).
              {canWrite && (
                <button
                  type="button" className="btn" style={{ marginLeft: 12 }} disabled={busy}
                  onClick={() => run(
                    () => api.hydroBilling.postLps({ contract_id: stationId, beneficiary }),
                    (r) => `Surcharge raised on ${r.posted} bill(s).`,
                  )}
                >
                  Raise the surcharge
                </button>
              )}
            </div>
          )}

          <Card
            title={`${beneficiary} — ${account.rows.length} document${account.rows.length === 1 ? '' : 's'}`}
            actions={canWrite && (
              <button
                type="button" className="btn btn-primary"
                onClick={() => setPayForm({ amount: totals.outstanding || '', payment_date: today(), mode: '', reference: '', info: '' })}
              >
                Record a payment
              </button>
            )}
          >
            <Table
              columns={columns}
              rows={account.rows}
              loading={loading}
              emptyMessage="No documents on this account yet."
              caption="Account display: bills, surcharges and payments"
            />
            <div style={{
              padding: '10px 12px', borderTop: '1px solid var(--border)',
              fontVariantNumeric: 'tabular-nums', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
            }}>
              <span style={{ color: 'var(--text-light)' }}>
                PB bill · LPS surcharge · PMT payment · ADV advance not yet applied
              </span>
              <span>
                Balance <strong>{fmtCurrency(totals.balance)}</strong>
                {totals.balance < 0 && <span style={{ color: 'var(--green, #276749)' }}> in the beneficiary&apos;s favour</span>}
              </span>
            </div>
          </Card>
        </>
      )}

      <Modal open={!!payForm} onClose={() => setPayForm(null)} title={`Record a payment from ${beneficiary}`}>
        {payForm && (
          <form onSubmit={doPay}>
            <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
              The payment is set against the oldest outstanding bill first. Anything beyond what is
              owed stays on the account as an advance rather than being treated as settled.
            </p>
            <div className="form-grid">
              <Field label="Amount (₹)" required htmlFor="hl-amt">
                <input id="hl-amt" type="number" step="0.01" min="0.01" required
                  value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </Field>
              <Field label="Payment date" required htmlFor="hl-date">
                <input id="hl-date" type="date" required
                  value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </Field>
              <Field label="Mode" htmlFor="hl-mode">
                <input id="hl-mode" placeholder="RTGS / NEFT / cheque"
                  value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })} />
              </Field>
              <Field label="Reference" htmlFor="hl-ref">
                <input id="hl-ref" placeholder="UTR or instrument number"
                  value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
              </Field>
            </div>
            {Number(payForm.amount) > (totals.outstanding || 0) && (
              <div className="alert alert-warning" role="status">
                This is {fmtCurrency(Number(payForm.amount) - (totals.outstanding || 0))} more than
                is outstanding — the excess will sit as an advance.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Recording…' : 'Record the payment'}
              </button>
              <button type="button" className="btn" onClick={() => setPayForm(null)}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!reversing} onClose={() => setReversing(null)} title={`Reverse ${reversing?.doc_no || ''}`}>
        <form onSubmit={doReverse}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            The payment is not deleted: it stays on the account with a counter-entry beside it, and
            any bill it had cleared reopens.
          </p>
          <Field label="Reason" required htmlFor="hl-rev">
            <input id="hl-rev" required value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>Reverse the payment</button>
            <button type="button" className="btn" onClick={() => setReversing(null)}>Keep it</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
