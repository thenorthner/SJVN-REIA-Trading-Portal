import React from 'react';
import CsvUploaderForm from './CsvUploaderForm.jsx';

export default function ChargesUploader() {
  return (
    <CsvUploaderForm
      kind="CHARGES"
      title="Charges File Upload"
      fields={['dates', 'charges_type']}
    />
  );
}
