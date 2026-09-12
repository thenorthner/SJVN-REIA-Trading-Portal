import React, { useMemo, useState } from 'react';
import { PageHeader, Card, Field } from '../../components/ui.jsx';
import FormatReport from './FormatReport.jsx';
import useErpFormat from './useErpFormat.js';

// The two document-level SAP upload layouts — Vendor Payable and Customer
// Receivable — are the same screen keyed on the other party: a document-date
// criterion, then the grid in upload order. Both used to carry their rows inline
// and take a date that changed nothing.

/** '2023-08-16' -> '16.08.2023', the form the register stores. */
export function toSapDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * @param {object} props
 * @param {string} props.kind      report kind in the ISET catalog
 * @param {string} props.title     page title
 * @param {string} props.subtitle  page subtitle
 * @param {string} props.filename  base name for the CSV / XLSX download
 * @param {string} props.cardTitle heading over the grid
 * @param {string} props.noun      what one row is, for the empty message
 */
export default function ErpDocumentFormat({ kind, title, subtitle, filename, cardTitle, noun }) {
  const { columns, rows, loading, error } = useErpFormat(kind);
  const [date, setDate] = useState('');

  const shown = useMemo(() => {
    const sap = toSapDate(date);
    return sap ? rows.filter((r) => String(r.docDate || '').trim() === sap) : rows;
  }, [rows, date]);

  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card title="Selection Criteria">
        <div className="report-criteria">
          <Field label="Document Date">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {date && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDate('')}>Clear</button>
          )}
        </div>
        <p className="report-count">
          {date ? `Showing documents dated ${toSapDate(date)}.` : `Showing every ${noun} on record.`}
        </p>
      </Card>

      <Card title={cardTitle}>
        {loading ? (
          <div className="audit-placeholder">Loading the register…</div>
        ) : (
          <FormatReport
            filename={filename}
            columns={columns}
            rows={shown}
            emptyText={date ? `No ${noun} dated ${toSapDate(date)}` : `No ${noun}s on record`}
          />
        )}
      </Card>
    </div>
  );
}
