import React from 'react';
import ViewBillInvoiceLedger from './ViewBillInvoiceLedger.jsx';

export default function BilateralOpenAccessInvoice() {
  return (
    <ViewBillInvoiceLedger
      billType="BILATERAL_OA"
      title="Bilateral Open Access Invoice"
      showPaymentColumns
    />
  );
}
