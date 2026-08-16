import React from 'react';
import CsvUploaderForm from './CsvUploaderForm.jsx';

export default function RefundReportUploader() {
  return (
    <CsvUploaderForm
      kind="REFUND"
      title="Refund File Upload"
      fields={['dates', 'rldc']}
    />
  );
}
