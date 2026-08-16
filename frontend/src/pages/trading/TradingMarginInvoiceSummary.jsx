import React from 'react';
import ViewBillInvoiceLedger from './ViewBillInvoiceLedger.jsx';

export default function TradingMarginInvoiceSummary() {
  return (
    <ViewBillInvoiceLedger
      billType="TRADING_MARGIN"
      title="Trading Margin Invoice Summary"
    />
  );
}
