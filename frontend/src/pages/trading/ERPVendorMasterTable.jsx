import React, { useMemo, useState } from 'react';
import { PageHeader, Card, Field } from '../../components/ui.jsx';
import FormatReport from './FormatReport.jsx';
import useErpFormat from './useErpFormat.js';

// Vendor Format (ERP) — the FLVN00 FI-Vendor layout finance uploads into SAP.
// The column row carries both the SAP field name and its plain-English label,
// because the person running it reads the label and the person loading the file
// into SAP reads the field name.
//
// The criteria strip used to ask for a client-creation date range and then show
// the same rows whatever was entered. The register holds no creation date, so it
// now offers the one thing it can answer for: the vendor type.

export default function ERPVendorMasterTable() {
  const { columns, rows, loading, error } = useErpFormat('erp-vendor-master');
  const [type, setType] = useState('');

  const types = useMemo(
    () => [...new Set(rows.map((r) => r.type).filter(Boolean))].sort(),
    [rows],
  );
  const shown = useMemo(() => (type ? rows.filter((r) => r.type === type) : rows), [rows, type]);
  const bands = columns.length
    ? [[{ label: 'FLVN00 (FI Vendor)', span: columns.length }], [{ label: 'General', span: columns.length }]]
    : null;

  return (
    <div className="page">
      <PageHeader
        title="Vendor Format"
        subtitle="FLVN00 vendor master extract for the SAP FI upload."
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card title="Selection Criteria">
        <div className="report-criteria">
          <Field label="Vendor Type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="FLVN00 (FI Vendor) — General">
        {loading ? (
          <div className="audit-placeholder">Loading the vendor register…</div>
        ) : (
          <FormatReport
            filename="vendor-format"
            columns={columns}
            rows={shown}
            bands={bands}
            emptyText={type ? `No ${type} vendors on record` : 'No vendors on record'}
          />
        )}
      </Card>
    </div>
  );
}
