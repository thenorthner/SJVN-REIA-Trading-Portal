import React from 'react';
import ErpDocumentFormat from './ErpDocumentFormat.jsx';

// Vendor Payable Format (ERP) — the accounts-payable document layout for SAP.

export default function ERPVendorPayableLedger() {
  return (
    <ErpDocumentFormat
      kind="erp-vendor-payable"
      title="Vendor Payable Format"
      subtitle="Payable documents posted against vendors, in SAP upload order."
      filename="vendor-payable-format"
      cardTitle="Payable Documents"
      noun="payable document"
    />
  );
}
