import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card } from '../../components/ui.jsx';

// The six bill ledgers, as one list. Every row already went somewhere real; the
// markup was written for a CSS framework this app does not ship, so the page
// rendered unstyled, and its search box filtered nothing.

const BILL_TYPES = [
  { name: 'Exchange Trading Margin Invoice', path: '/invoices/trading-margin' },
  { name: 'Exchange Open Access Invoice', path: '/invoices/open-access' },
  { name: 'Exchange Energy Settlement Invoice', path: '/invoices/exchange-energy-settlement' },
  { name: 'Bilateral Energy Settlement Invoice', path: '/invoices/bilateral-energy-settlement' },
  { name: 'Bilateral SLDC Consent Fee Invoice', path: '/invoices/bilateral-sldc-consent' },
  { name: 'Bilateral Open Access Invoice', path: '/invoices/bilateral-open-access' },
];

export default function ViewBills() {
  return (
    <div className="page">
      <PageHeader title="View Bills (Invoice)" subtitle="Every invoice ledger the trading desk raises" />

      <Card>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 72 }}>Sr. No.</th>
                <th scope="col">Bill (Invoice) Name</th>
                <th scope="col" style={{ width: 120 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {BILL_TYPES.map((bill, i) => (
                <tr key={bill.path}>
                  <td>{i + 1}</td>
                  <td>{bill.name}</td>
                  <td><Link className="btn-link" to={bill.path}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
