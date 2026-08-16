import React from 'react';
import CsvUploaderForm from './CsvUploaderForm.jsx';

export default function RldcScheduleUploader() {
  return (
    <CsvUploaderForm
      kind="RLDC_SCHEDULE"
      title="RLDC/SLDC Schedule Upload"
      fields={['reading', 'upload_type']}
    />
  );
}
