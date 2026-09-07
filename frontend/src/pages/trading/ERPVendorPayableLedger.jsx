import React, { useState } from 'react';
import { PageHeader, Card, Field } from '../../components/ui.jsx';
import FormatReport from './FormatReport.jsx';

// Vendor Payable Format (ERP) — the accounts-payable document layout for SAP.

const PAYABLE_ROWS = [
  { desc: 'Energy Bill Invoice by Kreate 09-Aug-23 to 15-Aug-23', docDate: '16.08.2023', docType: 'PW', companyCode: '1000', postingDate: '22.08.2023', currency: 'INR', reference: 'KEIPL/SOP/340', headerText: 'KEIPL/SOP/340', postingKey: '31', vendorNo: '1010562', vendorName: '', refGL: '', pan: '' },
];

const COLUMNS = [
  { key: 'desc', label: 'Description' },
  { key: 'docDate', label: 'Document Date' },
  { key: 'docType', label: 'Document Type' },
  { key: 'companyCode', label: 'Company Code' },
  { key: 'postingDate', label: 'Posting Date' },
  { key: 'currency', label: 'Currency' },
  { key: 'reference', label: 'Reference' },
  { key: 'headerText', label: 'Document Header Text' },
  { key: 'postingKey', label: 'Posting Key' },
  { key: 'vendorNo', label: 'SAP Vendor No.' },
  { key: 'vendorName', label: 'Vendor Name' },
  { key: 'refGL', label: 'Reference GL' },
  { key: 'pan', label: 'PAN' },
];

export default function ERPVendorPayableLedger() {
  const [date, setDate] = useState('');
  const [ranAt, setRanAt] = useState(null);

  return (
    <div className="page">
      <PageHeader
        title="Vendor Payable Format"
        subtitle="Payable documents posted against vendors, in SAP upload order."
      />

      <Card title="Selection Criteria">
        <form className="report-criteria" onSubmit={(e) => { e.preventDefault(); setRanAt(date); }}>
          <Field label="Document Date" required>
            <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary">Show Report</button>
        </form>
        {ranAt && (
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Showing documents dated {ranAt}.
          </p>
        )}
      </Card>

      <Card title="Payable Documents">
        <FormatReport filename="vendor-payable-format" columns={COLUMNS} rows={PAYABLE_ROWS} />
      </Card>
    </div>
  );
}
