import React from 'react';
import ViewBillInvoiceLedger from './ViewBillInvoiceLedger.jsx';

export default function BilateralEnergySettlementInvoice() {
  return (
    <ViewBillInvoiceLedger
      billType="BILATERAL_ENERGY"
      title="Energy Settlement Invoice Details"
      showPaymentColumns
    />
  );
}
