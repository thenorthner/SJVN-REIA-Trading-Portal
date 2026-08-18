import PDFDocument from 'pdfkit';

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateText(v) {
  if (!v) return '—';
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB');
}

export function generateTradingViewBillPdf(invoice, notes, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${String(invoice.invoice_no || invoice.id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
  doc.pipe(res);

  const breakup = (() => {
    try { return JSON.parse(invoice.breakup_json || '{}'); } catch { return {}; }
  })();
  const lineItems = Array.isArray(breakup.line_items) ? breakup.line_items : [];

  doc.fontSize(18).text('SJVN Trading Invoice', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Invoice No: ${invoice.invoice_no || invoice.id}`);
  doc.text(`Client: ${invoice.client_name || '—'}`);
  doc.text(`Bill Type: ${invoice.bill_type}`);
  doc.text(`Settlement Basis: ${invoice.settlement_basis || '—'}`);
  doc.text(`Status: ${invoice.status}`);
  doc.moveDown(0.5);

  doc.text(`Invoice Date: ${dateText(invoice.invoice_date)}`);
  doc.text(`Due Date: ${dateText(invoice.invoice_due_date)}`);
  doc.text(`Supply Period: ${dateText(invoice.supply_from_date)} to ${dateText(invoice.supply_to_date)}`);
  doc.text(`Generated On: ${invoice.invoice_generated_on || '—'}`);
  doc.moveDown();

  doc.fontSize(12).text('Commercial Summary');
  doc.fontSize(10);
  doc.text(`Quantum: ${invoice.quantum_mwh != null ? Number(invoice.quantum_mwh).toFixed(3) : '—'} MWh`);
  doc.text(`Rate: ${invoice.rate_per_unit != null ? `Rs. ${Number(invoice.rate_per_unit).toFixed(4)}/kWh` : '—'}`);
  doc.text(`GST: Rs. ${money(invoice.gst_amount)}`);
  doc.text(`Invoice Amount: Rs. ${money(invoice.invoice_amount)}`);
  if (invoice.received_amount != null) {
    doc.text(`Received Amount: Rs. ${money(invoice.received_amount)}`);
    doc.text(`Payment Date: ${dateText(invoice.payment_date)}`);
  }
  doc.moveDown();

  doc.fontSize(12).text('Line Items');
  doc.fontSize(10);
  if (!lineItems.length) {
    doc.text('No itemized breakup stored.');
  } else {
    for (const item of lineItems) {
      doc.text(`${item.description || 'Charge'}: Rs. ${money(item.amount)}`);
    }
  }

  if (notes.length) {
    doc.moveDown();
    doc.fontSize(12).text('Debit / Credit Notes');
    doc.fontSize(10);
    for (const note of notes) {
      const dir = note.note_type === 'DEBIT' ? '+' : '-';
      doc.text(`${note.note_no}  ${note.note_type}  ${note.reason_code}  ${dir}Rs. ${money(note.amount)}  (${note.status})`);
    }
  }

  if (invoice.remarks) {
    doc.moveDown();
    doc.fontSize(12).text('Remarks');
    doc.fontSize(10).text(invoice.remarks);
  }

  doc.end();
}
