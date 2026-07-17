import PDFDocument from 'pdfkit';

const MARGIN = 40;

function drawTableRow(doc, y, heights, values, colWidths, isBold = false) {
  if (isBold) doc.font('Helvetica-Bold');
  else doc.font('Helvetica');

  let x = MARGIN;
  values.forEach((val, i) => {
    doc.text(val, x + 5, y + 5, { width: colWidths[i] - 10, align: (i === 0 || i === 1) ? 'left' : 'right' });
    x += colWidths[i];
  });
  
  // Draw vertical lines
  x = MARGIN;
  doc.moveTo(x, y).lineTo(x, y + heights).stroke();
  colWidths.forEach((w) => {
    x += w;
    doc.moveTo(x, y).lineTo(x, y + heights).stroke();
  });
  
  // Draw bottom border
  doc.moveTo(MARGIN, y + heights).lineTo(MARGIN + colWidths.reduce((a,b)=>a+b, 0), y + heights).stroke();
}

export function generateInvoicePdf(invoice, contract, seller, buyer, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  doc.pipe(res);

  // --- HEADER ---
  const headerTopY = doc.y;
  
  if (seller?.logo_url) {
    try {
      // logo_url is likely something like /uploads/filename
      const logoPath = process.cwd() + seller.logo_url;
      doc.image(logoPath, MARGIN, headerTopY, { width: 80, fit: [80, 80] });
    } catch (e) {
      console.error('Failed to load logo:', e);
    }
  }

  doc.fontSize(12).font('Helvetica-Bold').text(seller?.name?.toUpperCase() || 'ENERGY GENERATOR', MARGIN + 100, headerTopY, { align: 'right' });
  doc.fontSize(9).font('Helvetica').text(`CIN: ${seller?.cin || '-'}`, { align: 'right' });
  doc.text(seller?.address || '-', { align: 'right' });
  doc.text(`Email: ${seller?.corporate_email || '-'}    Phone: ${seller?.corporate_phone || '-'}    Website: ${seller?.corporate_website || '-'}`, { align: 'right' });
  
  doc.moveDown(2);
  doc.moveDown(1);
  doc.fontSize(12).font('Helvetica-Bold').text('MONTHLY ENERGY BILL', { align: 'center', underline: true });
  doc.moveDown(1);

  // --- TOP GRID ---
  doc.fontSize(10).font('Helvetica');
  const topY = doc.y;
  doc.rect(MARGIN, topY, 250, 100).stroke(); // To Box
  doc.rect(MARGIN + 250, topY, 265, 100).stroke(); // Details Box

  // Left Box
  doc.font('Helvetica-Bold').text('To,', MARGIN + 10, topY + 10);
  doc.font('Helvetica').text(buyer?.name || '', MARGIN + 10, topY + 25);
  doc.text(buyer?.address || '-', MARGIN + 10, topY + 40, { width: 230 });

  // Right Box
  doc.font('Helvetica-Bold').text('Billing Month:', MARGIN + 260, topY + 10);
  doc.font('Helvetica').text(invoice.billing_period, MARGIN + 350, topY + 10);
  
  doc.font('Helvetica-Bold').text('Invoice No:', MARGIN + 260, topY + 25);
  doc.font('Helvetica').text(invoice.invoice_no, MARGIN + 350, topY + 25);
  
  doc.font('Helvetica-Bold').text('Date:', MARGIN + 260, topY + 40);
  doc.font('Helvetica').text(new Date(invoice.created_at).toLocaleDateString(), MARGIN + 350, topY + 40);
  
  doc.font('Helvetica-Bold').text('Due Date:', MARGIN + 260, topY + 55);
  doc.font('Helvetica').text(invoice.due_date || '-', MARGIN + 350, topY + 55);

  doc.y = topY + 110;

  // --- GST Details Grid ---
  const gstY = doc.y;
  doc.rect(MARGIN, gstY, 250, 60).stroke();
  doc.rect(MARGIN + 250, gstY, 265, 60).stroke();
  
  doc.font('Helvetica-Bold').text('Recipient Details:', MARGIN + 10, gstY + 5);
  doc.font('Helvetica').text(`GST No: ${buyer?.gst_no || '-'}`, MARGIN + 10, gstY + 20);
  doc.text(`PAN No: ${buyer?.pan_no || '-'}`, MARGIN + 10, gstY + 35);
  
  doc.font('Helvetica-Bold').text('Supplier Details:', MARGIN + 260, gstY + 5);
  doc.font('Helvetica').text(`GST No: ${seller?.gst_no || '-'}`, MARGIN + 260, gstY + 20);
  doc.text(`PAN No: ${seller?.pan_no || '-'}`, MARGIN + 260, gstY + 35);
  doc.text(`TAN No: ${seller?.tan_no || '-'}`, MARGIN + 260, gstY + 50);
  doc.text(`CIN No: ${seller?.cin || '-'}`, MARGIN + 260, gstY + 65);
  
  doc.y = gstY + 85;
  
  // Reference Line
  doc.font('Helvetica').text(`Ref: Power Purchase Agreement (PPA) dated ${new Date(contract.created_at).toLocaleDateString()} for ${contract.contracted_capacity_mw} MW ${contract.technology} power.`);
  doc.moveDown(1);
  
  doc.font('Helvetica-Bold').text('PART-A (UNITS GENERATED & BILLING)', { underline: true });
  doc.moveDown(0.5);

  // --- Table ---
  const colWidths = [40, 180, 80, 70, 70, 75]; // 515 total
  const headers = ['Sr No.', 'Description', 'Duration', 'Units (kWh)', 'Tariff (Rs)', 'Amount (Rs)'];
  
  let currentY = doc.y;
  // Top Border for headers
  doc.moveTo(MARGIN, currentY).lineTo(MARGIN + 515, currentY).stroke();
  drawTableRow(doc, currentY, 20, headers, colWidths, true);
  currentY += 20;
  
  let srNo = 1;
  const breakDown = invoice.invoice_breakdown_json ? JSON.parse(invoice.invoice_breakdown_json) : null;
  
  function drawRow(desc, units, tariff, amt) {
    drawTableRow(doc, currentY, 20, [
      String(srNo++),
      desc,
      invoice.billing_period,
      units === null ? '-' : String(units),
      tariff === null ? '-' : String(tariff),
      String(amt.toFixed(2))
    ], colWidths);
    currentY += 20;
  }
  
  if (breakDown && breakDown.lines) {
    breakDown.lines.forEach(l => {
      drawRow(
        l.code + ': ' + l.description, 
        l.value !== null && l.code.includes('E') && !l.code.includes('EE') ? (l.value * 1000).toFixed(0) : null, 
        l.code === 'EE1' ? invoice.tariff_per_unit.toFixed(2) : null,
        l.code === 'C1' ? invoice.capacity_charges : (l.code === 'EE1' ? invoice.energy_charges : (l.code === 'EE2' ? invoice.capacity_charges : 0))
      );
    });
  } else {
    drawRow('Scheduled Energy', (invoice.energy_mwh * 1000).toFixed(0), invoice.tariff_per_unit.toFixed(2), invoice.energy_charges);
  }
  
  // Totals
  drawTableRow(doc, currentY, 20, ['', 'Total Energy Charges', '', '', '', String(invoice.energy_charges.toFixed(2))], colWidths, true);
  currentY += 20;
  
  if (invoice.capacity_charges > 0) {
    drawTableRow(doc, currentY, 20, ['', 'Capacity Charges', '', '', '', String(invoice.capacity_charges.toFixed(2))], colWidths);
    currentY += 20;
  }
  
  if (invoice.trading_margin > 0) {
    drawTableRow(doc, currentY, 20, ['', 'Trading Margin', '', '', '', String(invoice.trading_margin.toFixed(2))], colWidths);
    currentY += 20;
  }
  if (invoice.transmission_charges > 0) {
    drawTableRow(doc, currentY, 20, ['', 'Transmission Charges', '', '', '', String(invoice.transmission_charges.toFixed(2))], colWidths);
    currentY += 20;
  }
  if (invoice.lps > 0) {
    drawTableRow(doc, currentY, 20, ['', 'Late Payment Surcharge', '', '', '', String(invoice.lps.toFixed(2))], colWidths);
    currentY += 20;
  }
  
  drawTableRow(doc, currentY, 25, ['', 'GRAND TOTAL', '', '', '', String(invoice.total_amount.toFixed(2))], colWidths, true);
  currentY += 35;
  
  // --- Bank Details ---
  doc.y = currentY;
  doc.font('Helvetica-Bold').text('Bank Details for Remittance:', { underline: true });
  doc.moveDown(0.5);
  doc.font('Helvetica').text(`Account Name : ${seller?.name || '-'}`);
  doc.text(`Bank Name    : ${seller?.bank_name || '-'}`);
  doc.text(`Account No.  : ${seller?.account_no || '-'}`);
  doc.text(`IFSC Code    : ${seller?.ifsc_code || '-'}`);
  doc.text(`Branch       : ${seller?.branch_address || '-'}`);
  
  doc.moveDown(2);
  
  // --- Notes ---
  doc.font('Helvetica-Bold').text('Notes:');
  doc.font('Helvetica').fontSize(9);
  doc.text('1. Rebate of 1.5% is allowed if payment is made within 5 days of invoice generation.');
  doc.text('2. Late Payment Surcharge (LPS) shall be applicable at base rate of LPS + 0.5% if payment is made beyond due date.');
  doc.text('3. Please share UTR No. and payment advice after remittance via email to finance@sjvn.co.in.');
  doc.text('4. This is a system generated invoice and does not require a physical signature.');
  
  doc.end();
}
