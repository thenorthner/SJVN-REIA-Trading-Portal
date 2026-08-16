import React from 'react';
import ViewBillInvoiceLedger from './ViewBillInvoiceLedger.jsx';

export default function BilateralSldcConsentInvoice() {
  return (
    <ViewBillInvoiceLedger
      billType="BILATERAL_SLDC"
      title="Bilateral SLDC Consent Fee Invoice"
      showPaymentColumns
    />
  );
}
