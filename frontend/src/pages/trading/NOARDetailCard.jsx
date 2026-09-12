import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// One NOAR application: what NRLDC approved, and what the open-access charges
// against it came to. This page used to carry one real application's numbers
// written into the source — applicant, seller, buyer, capacities, two charge
// lines — and showed them whatever application number was in the URL.

const money = (v) => (v == null ? '—' : `₹${fmtNumber(v, 2)}`);
const mwh = (v) => (v == null ? '—' : `${fmtNumber(v, 3)} MWh`);

function Facts({ rows }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" style={{ width: '34%', textAlign: 'left' }}>{label}</th>
              <td>{value == null || value === '' ? '—' : value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NOARDetailCard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.isetReports.noarApplication(id)
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load this application.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const approval = data?.approval;
  const charges = data?.charges || [];
  const payment = data?.payment;
  const totals = charges.reduce((t, c) => ({
    payable: t.payable + (c.payable || 0),
    tds: t.tds + (c.tds || 0),
    net: t.net + (c.net || 0),
  }), { payable: 0, tds: 0, net: 0 });

  return (
    <div className="page">
      <PageHeader
        title="NOAR Approval Details"
        subtitle={`Application ${id}`}
        actions={<Link className="btn btn-outline" to="/reports/noar-approvals">Back to NOAR Approvals</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading ? (
        <Card><div className="audit-placeholder">Loading the application…</div></Card>
      ) : !data ? null : (
        <>
          <Card title="Application">
            {approval ? (
              <Facts rows={[
                ['Application No.', approval.application_no],
                ['Applicant Name', approval.applicant_name],
                ['Seller Name', approval.seller_name],
                ['Buyer Name', approval.buyer_name],
                ['From Date', approval.from_date ? fmtDate(approval.from_date) : null],
                ['To Date', approval.to_date ? fmtDate(approval.to_date) : null],
                ['Applied Capacity', mwh(approval.applied_capacity_mwh)],
                ['Approved Capacity', mwh(approval.approved_capacity_mwh)],
                ['Approval No.', approval.approval_no],
                ['Approval Date', approval.approval_date ? fmtDate(approval.approval_date) : null],
              ]} />
            ) : (
              <div className="audit-placeholder">
                No approval is on record for this application — only the charges below.
              </div>
            )}
          </Card>

          <Card title="Open Access Charges">
            {charges.length === 0 ? (
              <div className="audit-placeholder">No charges are booked against this application.</div>
            ) : (
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Charge</th>
                      <th scope="col">Agency</th>
                      <th scope="col">PAN</th>
                      <th scope="col" className="num">Payable (Rs.)</th>
                      <th scope="col" className="num">TDS (Rs.)</th>
                      <th scope="col" className="num">Net (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.vendor || '—'}</td>
                        <td>{c.pan || '—'}</td>
                        <td className="num">{money(c.payable)}</td>
                        <td className="num">{c.tds ? money(c.tds) : '—'}</td>
                        <td className="num">{money(c.net)}</td>
                      </tr>
                    ))}
                    <tr className="totals-row">
                      <td colSpan={3}>Total</td>
                      <td className="num">{money(totals.payable)}</td>
                      <td className="num">{money(totals.tds)}</td>
                      <td className="num">{money(totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {payment && (
            <Card title="Payment">
              <Facts rows={[
                ['Nodal RLDC', payment.nodal_rldc],
                ['Date of Payment', payment.payment_date ? fmtDate(payment.payment_date) : null],
                ['Total STOA Charges', money(payment.total_stoa)],
                ['Total TDS Withheld', money(payment.total_tds)],
                ['Net Payable', money(payment.net_payment)],
                ['STOA Actually Paid', money(payment.actual_stoa_paid)],
                ['TDS Actually Paid', money(payment.actual_tds_paid)],
              ]} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
