import React from 'react';
import BuyerInvoices from './BuyerInvoices.jsx';

// A buyer's consolidated Billing & Payments hub — renders with the Payment Ledger & Receipts tab active.
export default function BuyerPayments() {
  return <BuyerInvoices initialTab="LEDGER" />;
}
