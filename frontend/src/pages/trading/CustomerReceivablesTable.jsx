import React, { useState } from 'react';
import { PageHeader, Card, Field } from '../../components/ui.jsx';
import FormatReport from './FormatReport.jsx';

// Customer Receivables Format (ERP) — the receivable side of the same SAP
// upload, keyed on the customer rather than the vendor.

const RECEIVABLE_ROWS = [
  { desc: 'SJVN/OA/APPPC/202308/083', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-APPPC', headerText: 'SJVN/OA/APPPC/202308/083', postingKey: '01', customerNo: '1011956' },
  { desc: 'SJVN/OA/KREATE/202312/020', docDate: '25.12.2023', docType: 'DW', companyCode: '1000', postingDate: '25.12.2023', currency: 'INR', reference: 'BLTR_OA-KREATE', headerText: 'SJVN/OA/KREATE/202312/020', postingKey: '01', customerNo: '1010562' },
  { desc: 'SJVN/OA/NDMC/202308/065', docDate: '05.08.2023', docType: 'DW', companyCode: '1000', postingDate: '05.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/065', postingKey: '01', customerNo: '1010' },
  { desc: 'SJVN/OA/NDMC/202308/079', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/079', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202308/082', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/082', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202308/133-0', docDate: '14.08.2023', docType: 'DW', companyCode: '1000', postingDate: '14.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/133-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202310/010-0', docDate: '09.10.2023', docType: 'DW', companyCode: '1000', postingDate: '09.10.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202310/010-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/021-0', docDate: '20.03.2024', docType: 'DW', companyCode: '1000', postingDate: '20.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/021-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/030-0', docDate: '21.03.2024', docType: 'DW', companyCode: '1000', postingDate: '21.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/030-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/068-0', docDate: '21.03.2024', docType: 'DW', companyCode: '1000', postingDate: '21.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/068-0', postingKey: '01', customerNo: '1004872' },
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
  { key: 'customerNo', label: 'SAP Customer No.' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'refGL', label: 'Reference GL' },
  { key: 'pan', label: 'PAN' },
];

export default function CustomerReceivablesTable() {
  const [date, setDate] = useState('');
  const [ranAt, setRanAt] = useState(null);

  return (
    <div className="page">
      <PageHeader
        title="Customer Receivables Format"
        subtitle="Receivable documents raised on customers, in SAP upload order."
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

      <Card title="Receivable Documents">
        <FormatReport filename="customer-receivables-format" columns={COLUMNS} rows={RECEIVABLE_ROWS} />
      </Card>
    </div>
  );
}
