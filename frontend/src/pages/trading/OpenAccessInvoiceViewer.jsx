import React from 'react';
import ViewBillInvoiceLedger from './ViewBillInvoiceLedger.jsx';

export default function OpenAccessInvoiceViewer() {
  return (
    <ViewBillInvoiceLedger
      billType="EXCHANGE_OA"
      title="Buyer :: Invoice Details"
    />
  );
}
