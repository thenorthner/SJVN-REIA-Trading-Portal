import React from 'react';
import CsvUploaderForm from './CsvUploaderForm.jsx';

export default function LatestRefundUploader() {
  return (
    <CsvUploaderForm
      kind="REFUND_LATEST"
      title="Latest Refund File Upload"
      fields={['dates', 'rldc']}
    />
  );
}
