import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// Who owes what, how late it is, and what the lateness has earned.
//
// The scope asks for payment monitoring with delay days, developer payments, and
// an outstanding ageing view. They are one question asked three ways, so this is
// one screen with the two sides on a switch: money owed to SJVN by buyers, and
// money SJVN owes its generators. Every figure is the one the dashboard and the
// bill itself use — the outstanding is what is left after rebate, surcharge,
// disputes and payments, and the surcharge is what the invoice screen shows.

const SIDES = [
  { key: 'RECEIVABLE', label: 'Owed to SJVN (buyers)', noun: 'buyer' },
  { key: 'PAYABLE', label: 'Owed by SJVN (developers)', noun: 'developer' },
];

function ageTone(bucket) {
  if (bucket === 'NOT_DUE') return 'default';
  if (bucket === 'DAYS_0_30') return 'blue';
  if (bucket === 'DAYS_31_60') return 'amber';
  return 'red';
}

function delayBadge(days) {
  if (days == null) return <span className="audit-muted">no due date</span>;
  if (days <= 0) return <Badge type="neutral">{Math.abs(days)}d to go</Badge>;
  const tone = days > 90 ? 'danger' : days > 30 ? 'warning' : 'primary';
  return <Badge type={tone}>{days}d late</Badge>;
}

export default function PaymentMonitoring() {
  const [side, setSide] = useState('RECEIVABLE');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [counterparty, setCounterparty] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.reports.paymentMonitoring(side)
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load payment monitoring.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [side]);

  const bills = useMemo(() => {
    const list = data?.bills || [];
    return list.filter((b) => {
      if (onlyOverdue && !(b.days_past_due > 0)) return false;
      if (counterparty && b.counterparty_id !== counterparty) return false;
      return true;
    });
  }, [data, onlyOverdue, counterparty]);

  const noun = SIDES.find((s) => s.key === side).noun;
  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="Payment Monitoring"
        subtitle="Outstanding, how long it has been outstanding, and the surcharge it has earned"
        actions={<Link className="btn btn-outline" to="/reia/invoices">Open invoices</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="report-toolbar">
        <div className="export-group">
          {SIDES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`btn btn-sm ${side === s.key ? 'btn-navy' : 'btn-outline'}`}
              onClick={() => { setSide(s.key); setCounterparty(''); }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="report-search">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          Overdue only
        </label>
      </div>

      {loading ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Outstanding"
              value={fmtCurrency(totals.outstanding)}
              hint={`${fmtNumber(totals.invoices, 0)} open ${totals.invoices === 1 ? 'bill' : 'bills'}`}
              tone="blue"
            />
            <StatCard
              label="Past due"
              value={fmtCurrency(totals.overdue_amount)}
              hint={`${fmtNumber(totals.overdue_invoices, 0)} ${totals.overdue_invoices === 1 ? 'bill' : 'bills'}`}
              tone={totals.overdue_amount ? 'red' : 'default'}
            />
            <StatCard
              label="Surcharge billed"
              value={fmtCurrency(totals.lps_charged)}
              hint="Already raised on a bill"
            />
            <StatCard
              label="Surcharge earned, not billed"
              value={fmtCurrency(totals.lps_accrued_unbilled)}
              hint={`At ${data.annual_pct}% a year, or the contract's own rate`}
              tone={totals.lps_accrued_unbilled ? 'amber' : 'default'}
            />
          </div>

          <div className="grid-2">
            <Card title="How old the outstanding is">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Age</th>
                      <th scope="col" className="num">Bills</th>
                      <th scope="col" className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ageing.map((bucket) => (
                      <tr key={bucket.bucket}>
                        <td><Badge type={ageTone(bucket.bucket) === 'red' ? 'danger' : ageTone(bucket.bucket) === 'amber' ? 'warning' : 'neutral'}>{bucket.label}</Badge></td>
                        <td className="num">{fmtNumber(bucket.invoices, 0)}</td>
                        <td className="num">{fmtCurrency(bucket.amount)}</td>
                      </tr>
                    ))}
                    <tr className="totals-row">
                      <td>Total</td>
                      <td className="num">{fmtNumber(totals.invoices, 0)}</td>
                      <td className="num">{fmtCurrency(totals.outstanding)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={`By ${noun}`}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{noun === 'buyer' ? 'Buyer' : 'Developer'}</th>
                      <th scope="col" className="num">Outstanding</th>
                      <th scope="col" className="num">Past due</th>
                      <th scope="col" className="num">Oldest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.counterparties.length === 0 ? (
                      <tr><td className="empty-cell" colSpan={4}>Nothing outstanding on this side.</td></tr>
                    ) : data.counterparties.map((c) => (
                      <tr
                        key={c.counterparty_id || c.counterparty_name}
                        className={counterparty === c.counterparty_id ? 'clickable selected' : 'clickable'}
                        onClick={() => setCounterparty(counterparty === c.counterparty_id ? '' : c.counterparty_id)}
                      >
                        <td>{c.counterparty_name}</td>
                        <td className="num">{fmtCurrency(c.outstanding)}</td>
                        <td className="num">{c.overdue_amount ? fmtCurrency(c.overdue_amount) : '—'}</td>
                        <td className="num">{c.oldest_days_past_due ? `${c.oldest_days_past_due}d` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {counterparty && (
                <p className="report-count">
                  Showing one {noun}&apos;s bills below.{' '}
                  <button type="button" className="btn-link" onClick={() => setCounterparty('')}>Show all</button>
                </p>
              )}
            </Card>
          </div>

          <Card title="Every open bill">
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">{noun === 'buyer' ? 'Buyer' : 'Developer'}</th>
                    <th scope="col">Contract</th>
                    <th scope="col">Period</th>
                    <th scope="col">Due</th>
                    <th scope="col">Delay</th>
                    <th scope="col" className="num">Outstanding</th>
                    <th scope="col" className="num">Surcharge billed</th>
                    <th scope="col" className="num">Surcharge earned</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={10}>
                        {data.bills.length ? 'No bill matches this selection.' : 'Nothing outstanding on this side.'}
                      </td>
                    </tr>
                  ) : bills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.invoice_no}</td>
                      <td>{b.counterparty_name || '—'}</td>
                      <td>{b.contract_no || '—'}</td>
                      <td>{b.billing_period}</td>
                      <td>{b.due_date ? fmtDate(b.due_date) : '—'}</td>
                      <td>{delayBadge(b.days_past_due)}</td>
                      <td className="num">{fmtCurrency(b.outstanding)}</td>
                      <td className="num">{b.lps_charged ? fmtCurrency(b.lps_charged) : '—'}</td>
                      <td className="num">
                        {b.lps_accrued_unbilled ? fmtCurrency(b.lps_accrued_unbilled) : '—'}
                        {b.surcharge_days > 0 && <div className="audit-muted">{b.surcharge_days} chargeable days</div>}
                      </td>
                      <td><Badge status={b.status}>{b.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-count">
              Showing {bills.length} of {data.bills.length} open {data.bills.length === 1 ? 'bill' : 'bills'} as at {fmtDate(data.as_of)}.
              {' '}Surcharge is counted in chargeable days, which skip the payer&apos;s non-working days.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
