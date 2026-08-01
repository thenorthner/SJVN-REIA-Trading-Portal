import React, { useState } from 'react';
import { SampleDataNotice, Card, Table, Badge, fmtNumber } from '../../components/ui.jsx';

export default function DAMInvoiceLedger() {
  const [deductionsExpanded, setDeductionsExpanded] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);

  // Mock Data for the DAM Invoice Record List
  const mockData = [
    {
      id: 1,
      transType: 'Sell',
      deliveryDate: '10-07-2026',
      energyMus: 12.50,
      totalIex: 56250000,
      tradingMargin: 250000,
      grandTotal: 56545000, // Includes GST on margin (56250k + 250k + 45k)
      prevBalance: 0,
      currentDeposit: 100000,
      tds: 56250,
      deduction: 12000,
      // Cross-market deductions
      recDeduction: 45000,
      escertDeduction: 0,
      tamDeduction: 0,
      rtmDeduction: 12500,
      gtamDeduction: 0,
      gdamDeduction: 8000,
      pxilDeduction: 0,
      netAmount: 56421250
    },
    {
      id: 2,
      transType: 'Sell',
      deliveryDate: '11-07-2026',
      energyMus: 10.20,
      totalIex: 45900000,
      tradingMargin: 204000,
      grandTotal: 46140720,
      prevBalance: 56421250,
      currentDeposit: 0,
      tds: 45900,
      deduction: 10500,
      // Cross-market deductions
      recDeduction: 0,
      escertDeduction: 15000,
      tamDeduction: 20000,
      rtmDeduction: -5000, // Refund or positive adjustment
      gtamDeduction: 10000,
      gdamDeduction: 0,
      pxilDeduction: 0,
      netAmount: 102476570 // Includes carried over balance
    }
  ];

  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedRows(mockData.map(r => r.id));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const calculateTotalDeductions = (r) => {
    return r.recDeduction + r.escertDeduction + r.tamDeduction + r.rtmDeduction + r.gtamDeduction + r.gdamDeduction + r.pxilDeduction;
  };

  const columns = [
    { 
      key: 'select', 
      label: <input type="checkbox" checked={selectedRows.length === mockData.length} onChange={handleSelectAll} />,
      render: r => <input type="checkbox" checked={selectedRows.includes(r.id)} onChange={() => handleSelectRow(r.id)} />
    },
    { key: 'transType', label: 'Trans Type' },
    { key: 'deliveryDate', label: 'Delivery Date' },
    { key: 'energyMus', label: 'Energy (Mus)', render: r => <strong>{r.energyMus.toFixed(2)}</strong> },
    { key: 'totalIex', label: 'Total IEX/PXIL', render: r => fmtNumber(r.totalIex) },
    { key: 'tradingMargin', label: 'Trading Margin', render: r => fmtNumber(r.tradingMargin) },
    { key: 'grandTotal', label: 'Grand Total', render: r => <span style={{ fontWeight: 'bold' }}>{fmtNumber(r.grandTotal)}</span> },
    { key: 'prevBalance', label: 'Prev Balance', render: r => fmtNumber(r.prevBalance) },
    { key: 'currentDeposit', label: 'Current Deposit', render: r => fmtNumber(r.currentDeposit) },
    { key: 'tds', label: 'TDS', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.tds)}</span> },
    { key: 'deduction', label: 'Deduction', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.deduction)}</span> },
    // Expandable Deductions Segment
    ...(deductionsExpanded ? [
      { 
        key: 'recDeduction', 
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
             <button onClick={() => setDeductionsExpanded(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>➖</button>
             REC Ded.
          </div>
        ), 
        render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.recDeduction)}</span> 
      },
      { key: 'escertDeduction', label: 'ESCERT Ded.', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.escertDeduction)}</span> },
      { key: 'tamDeduction', label: 'TAM Ded.', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.tamDeduction)}</span> },
      { key: 'rtmDeduction', label: 'RTM Ded.', render: r => <span style={{ color: r.rtmDeduction < 0 ? '#27ae60' : '#e74c3c' }}>{fmtNumber(r.rtmDeduction)}</span> },
      { key: 'gtamDeduction', label: 'GTAM Ded.', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.gtamDeduction)}</span> },
      { key: 'gdamDeduction', label: 'GDAM Ded.', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.gdamDeduction)}</span> },
      { key: 'pxilDeduction', label: 'PXIL Ded.', render: r => <span style={{ color: '#e74c3c' }}>{fmtNumber(r.pxilDeduction)}</span> },
    ] : [
      { 
        key: 'totalSegmentDeductions', 
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#c0392b', cursor: 'pointer' }} onClick={() => setDeductionsExpanded(true)}>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>➕</button>
            Total Segment Deductions
          </div>
        ),
        render: r => {
          const total = calculateTotalDeductions(r);
          return <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>{fmtNumber(total)}</span>;
        }
      }
    ]),
    { key: 'netAmount', label: 'Net Amount', render: r => <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: 15 }}>₹ {fmtNumber(r.netAmount)}</span> },
    { 
      key: 'view', 
      label: 'View', 
      render: () => (
        <button className="icon-btn" style={{ color: '#0284c7', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }} title="View Details">📄</button>
      )
    }
  ];

  const handleExportSap = () => {
    alert(
      'Not exported.\n\n'
      + `SAP journal export is not built, so nothing was generated for the ${selectedRows.length} selected DAM entr(y/ies). `
      + 'Cross-market deduction mapping to SJVN cost centres is still a design note, not working code.'
    );
  };

  return (
    <div style={{ padding: '0 0px 20px', margin: '0 auto', width: '100%' }}>
      
      <SampleDataNotice detail="This ledger renders generated invoice rows. Amounts, taxes and SAP references are not SJVN records." />

      {/* Filter Control Toolbar */}
      <Card style={{ marginBottom: 20, background: '#f8fafc' }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Exchange</label>
            <select className="input"><option>IEX</option><option>PXIL</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>PortfolioId</label>
            <select className="input"><option>N1HP0PTC0850</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>PortfolioName</label>
            <select className="input"><option>SJVN Limited-Naitwar Mori HEP</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>From Date</label>
            <input type="date" className="input" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>To Date</label>
            <input type="date" className="input" />
          </div>
          <button className="btn btn-primary">Search</button>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" style={{ color: '#27ae60', borderColor: '#27ae60' }}>[ EXCEL v ] Export</button>
            <button className="btn btn-primary" style={{ background: '#f39c12', borderColor: '#e67e22', display: 'flex', alignItems: 'center', gap: 8 }} disabled={selectedRows.length === 0} onClick={handleExportSap}>
              <span>⚡</span> Export SAP Journal Entry
            </button>
          </div>
        </div>
      </Card>

      {/* Main Table */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>DAM Invoice Record List (Cross-Market Ledger)</h3>
            <p style={{ margin: '5px 0 0', fontSize: 12, color: '#64748b' }}>
              Central clearinghouse view. Deductions from other markets (RTM, REC, TAM, GDAM) are settled against DAM receivables here.
            </p>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
           <Table columns={columns} data={mockData} />
        </div>
      </Card>

    </div>
  );
}
