import React from 'react';
import { Table, fmtNumber } from './ui.jsx';

export default function TaxInvoiceLedgerTable({ records, marketSegment }) {
  const isCert = ['REC', 'ESCERT'].includes(marketSegment);
  
  const columns = [
    { key: 'deliveryDate', label: 'Delivery Date' },
    { key: 'energyType', label: 'Energy Type', render: r => <span style={{ fontWeight: 'bold', color: marketSegment === 'GTAM' || marketSegment === 'REC' ? '#27ae60' : '#333' }}>{r.energyType || marketSegment}</span> },
    { key: 'totalObligation', label: isCert ? 'Cert Qty' : 'Volume (MWh)', render: r => <strong>{fmtNumber(r.totalObligation || r.energyMUs)}</strong> },
    { key: 'totalAmount', label: 'Gross Revenue (₹)', render: r => <span>{fmtNumber(r.totalAmount || r.grossValue)}</span> },
    { key: 'margin', label: 'Trading Margin', render: r => <span>{fmtNumber(r.margin)}</span> },
    { key: 'igst', label: 'IGST', render: r => <span>{fmtNumber(r.igst)}</span> },
    { key: 'cgst', label: 'CGST', render: r => <span>{fmtNumber(r.cgst)}</span> },
    { key: 'sgst', label: 'SGST', render: r => <span>{fmtNumber(r.sgst)}</span> },
    { key: 'grandTotal', label: 'Grand Total (₹)', render: r => (
      <div title={`Gross Value: ₹ ${fmtNumber(r.totalAmount || r.grossValue)}\nTrading Margin: ₹ ${fmtNumber(r.margin)}\nGST (18%): ₹ ${fmtNumber((r.igst || 0) + (r.cgst || 0) + (r.sgst || 0))}\n-------------------\nTotal Invoice: ₹ ${fmtNumber(r.grandTotal)}`} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help', fontWeight: 'bold' }}>
        {fmtNumber(r.grandTotal)}
      </div>
    )},
    { key: 'deduction', label: 'Deductions', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.deduction)}</span> },
    { key: 'netTotal', label: 'Net Payout (₹)', render: r => <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: 15 }}>{fmtNumber(r.netTotal || r.netAmount)}</span> },
    { key: 'sapStatus', label: 'SAP FI Status', render: r => (
      <span style={{ fontSize: 11, background: r.sapStatus === 'POSTED' ? '#e8f5e9' : '#fff3e0', color: r.sapStatus === 'POSTED' ? '#2e7d32' : '#f57c00', border: `1px solid ${r.sapStatus === 'POSTED' ? '#c8e6c9' : '#ffe0b2'}`, padding: '2px 6px', borderRadius: 12 }}>
        {r.sapStatus === 'POSTED' ? 'Posted' : 'Pending'}
      </span>
    )},
    { key: 'cert', label: 'Voucher', render: () => (
      <div style={{ display: 'flex', gap: 5 }}>
        <button className="btn btn-sm btn-outline" title="View Tax Invoice PDF" aria-label="View Tax Invoice PDF"></button>
        {isCert && <button className="btn btn-sm btn-outline" title="View Registry Slip" aria-label="View Registry Slip"></button>}
      </div>
    )}
  ];

  const handleSapPost = () => {
    // Nothing posts to SAP: there is no FI integration. Saying a batch was
    // initiated would leave finance believing entries are on their way.
    alert(
      'Not posted.\n\n'
      + 'SAP FI posting is not integrated yet, so no journal entry was created for '
      + `the ${records.filter(r => r.sapStatus !== 'POSTED').length} pending ${marketSegment} invoice(s).`
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, padding: '10px 15px', background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Commercial Tax Ledger</strong>
          <div style={{ fontSize: 12, color: '#6c757d' }}>{marketSegment} Segment • Standardized Formula: (Gross + Margin + GST) - Deductions - TDS</div>
        </div>
        <button onClick={handleSapPost} className="btn btn-primary" style={{ background: '#f39c12', borderColor: '#e67e22', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'bold' }}>
          <span></span> Generate SAP Journal Entry
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Table columns={columns} data={records} />
      </div>
    </div>
  );
}
