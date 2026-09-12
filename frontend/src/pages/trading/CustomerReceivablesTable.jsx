import React from 'react';
import ErpDocumentFormat from './ErpDocumentFormat.jsx';

// Customer Receivables Format (ERP) — the receivable side of the same SAP
// upload, keyed on the customer rather than the vendor.

export default function CustomerReceivablesTable() {
  return (
    <ErpDocumentFormat
      kind="erp-customer-receivable"
      title="Customer Receivables Format"
      subtitle="Receivable documents raised on customers, in SAP upload order."
      filename="customer-receivables-format"
      cardTitle="Receivable Documents"
      noun="receivable document"
    />
  );
}
