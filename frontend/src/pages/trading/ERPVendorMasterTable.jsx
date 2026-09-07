import React, { useState } from 'react';
import { PageHeader, Card, Field } from '../../components/ui.jsx';
import FormatReport from './FormatReport.jsx';

// Vendor Format (ERP) — the FLVN00 FI-Vendor layout finance uploads into SAP.
// The column row carries both the SAP field name and its plain-English label,
// because the person running it reads the label and the person loading the file
// into SAP reads the field name.

const VENDOR_ROWS = [
  { type: 'Discom', firstName: 'DOP, Govt. of Arunachal Pradesh', lastName: '', lang: 'EN', searchTerm: 'DOP, Govt. of Arunachal Pradesh' },
  { type: 'Discom', firstName: 'Himachal Pradesh State Electricity Board Ltd.', lastName: '', lang: 'EN', searchTerm: 'Himachal Pradesh State Electricity Board Ltd.' },
  { type: 'Generator', firstName: 'BALRAMPUR CHINI MILLS LTD', lastName: '', lang: 'EN', searchTerm: 'BALRAMPUR CHINI MILLS LTD' },
  { type: 'Generator', firstName: 'Balrampur Chini Mills Ltd. Unit HCM', lastName: '', lang: 'EN', searchTerm: 'Balrampur Chini Mills Ltd. Unit HCM' },
  { type: 'Generator', firstName: 'Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)', lastName: '', lang: 'EN', searchTerm: 'Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)' },
  { type: 'Generator', firstName: 'India Power Corporation Limited', lastName: '', lang: 'EN', searchTerm: 'India Power Corporation Limited' },
  { type: 'Generator', firstName: 'Indian Oil Corporation Limited', lastName: '', lang: 'EN', searchTerm: 'Indian Oil Corporation Limited' },
  { type: 'Generator', firstName: 'NSL Krishnaveni sugars limited', lastName: '', lang: 'EN', searchTerm: 'NSL Krishnaveni sugars limited' },
  { type: 'Generator', firstName: 'NTPC Renewable Energy Limited_KPS3', lastName: '', lang: 'EN', searchTerm: 'NTPC Renewable Energy Limited_KPS3' },
  { type: 'Generator', firstName: 'Ostro Kannada Power Private Limited', lastName: '', lang: 'EN', searchTerm: 'Ostro Kannada Power Private Limited' },
  { type: 'Generator', firstName: 'ReNew Surya Ravi Private Limited', lastName: '', lang: 'EN', searchTerm: 'ReNew Surya Ravi Private Limited' },
  { type: 'Generator', firstName: 'Shivashakti Sugars Limited', lastName: '', lang: 'EN', searchTerm: 'Shivashakti Sugars Limited' },
  { type: 'Generator', firstName: 'Shree Renuka Sugars Limited Athani', lastName: '', lang: 'EN', searchTerm: 'Shree Renuka Sugars Limited Athani' },
  { type: 'Generator', firstName: 'SHREE RENUKA SUGARS LIMITED HAVALGA', lastName: '', lang: 'EN', searchTerm: 'SHREE RENUKA SUGARS LIMITED HAVALGA' },
];

const COLUMNS = [
  { key: 'type', label: 'Vendor Type' },
  { key: 'partnerRole', label: 'BP Role', code: 'PARTNER_ROLE' },
  { key: 'creationGroup', label: 'Grouping', code: 'CREATION_GROUP' },
  { key: 'firstName', label: 'First Name', code: 'NAME_FIRST' },
  { key: 'lastName', label: 'Last Name', code: 'NAME_LAST' },
  { key: 'lang', label: 'Correspondence Lang', code: 'LANGUOCORR' },
  { key: 'searchTerm', label: 'Search Term / Old Vendor No.', code: 'BU_SORT1_TXT' },
];

const BANDS = [
  [{ label: 'FLVN00 (FI Vendor)', span: COLUMNS.length }],
  [{ label: 'General', span: COLUMNS.length }],
];

export default function ERPVendorMasterTable() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [range, setRange] = useState(null);

  return (
    <div className="page">
      <PageHeader
        title="Vendor Format"
        subtitle="FLVN00 vendor master extract for the SAP FI upload."
      />

      <Card title="Selection Criteria">
        <form
          className="report-criteria"
          onSubmit={(e) => { e.preventDefault(); setRange({ fromDate, toDate }); }}
        >
          <Field label="Client Creation Date — From" required>
            <input type="date" className="input" required value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="Client Creation Date — To" required>
            <input type="date" className="input" required value={toDate} onChange={(e) => setToDate(e.target.value)} min={fromDate || undefined} />
          </Field>
          <button type="submit" className="btn btn-primary">Download</button>
        </form>
        {range && (
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Showing vendors created between {range.fromDate} and {range.toDate}.
          </p>
        )}
      </Card>

      <Card title="FLVN00 (FI Vendor) — General">
        <FormatReport filename="vendor-format" columns={COLUMNS} rows={VENDOR_ROWS} bands={BANDS} />
      </Card>
    </div>
  );
}
