import React, { useState } from 'react';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
import { SampleDataNotice, Card, Table, Badge } from '../../components/ui.jsx';

export default function GDAMObligationConsole({ product = 'GDAM' }) {
  const [selectedRows, setSelectedRows] = useState([]);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [activePdf, setActivePdf] = useState(null);

  // Mock Data for Obligation List
  const mockData = [
    {
      id: 1,
      portfolioId: 'N1HP0PTC0850',
      deliveryDate: '10-07-2026',
      updatedOn: '09-07-2026 14:05:00',
      sentMail: true,
      fileStatus: 'GENERATED',
      pdfUrl: 'mock_obligation_1.pdf',
      xlsUrl: 'mock_obligation_1.xls'
    },
    {
      id: 2,
      portfolioId: 'N1HP0PTC0850',
      deliveryDate: '11-07-2026',
      updatedOn: '10-07-2026 14:10:00',
      sentMail: false,
      fileStatus: 'APPROVED',
      pdfUrl: 'mock_obligation_2.pdf',
      xlsUrl: 'mock_obligation_2.xls'
    },
    {
      id: 3,
      portfolioId: 'SJVN_SOLAR_001',
      deliveryDate: '11-07-2026',
      updatedOn: '10-07-2026 14:12:00',
      sentMail: true,
      fileStatus: 'REJECTED',
      pdfUrl: 'mock_obligation_3.pdf',
      xlsUrl: 'mock_obligation_3.xls'
    }
  ];

  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedRows(mockData.map(r => r.id));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const handleViewPdf = (record) => {
    setActivePdf(record);
    setPdfModalOpen(true);
  };

  const renderStatus = (status) => {
    switch(status) {
      case 'GENERATED': return <Badge type="neutral">📄 Generated</Badge>;
      case 'APPROVED': return <Badge type="success">🟢 Approved</Badge>;
      case 'REJECTED': return <Badge type="danger">🔴 Rejected</Badge>;
      case 'DISPUTED': return <Badge type="danger">🟠 Disputed</Badge>;
      default: return <Badge type="neutral">{status}</Badge>;
    }
  };

  const columns = [
    { 
      key: 'select', 
      label: <input type="checkbox" aria-label="Select all obligations" checked={selectedRows.length === mockData.length} onChange={handleSelectAll} />,
      render: r => <input type="checkbox" aria-label={`Select obligation ${r.id}`} checked={selectedRows.includes(r.id)} onChange={() => handleSelectRow(r.id)} />
    },
    { key: 'portfolioId', label: 'Portfolio Id' },
    { key: 'deliveryDate', label: 'Delivery Date' },
    { key: 'updatedOn', label: 'Updated On' },
    { key: 'sentMail', label: 'Sent Mail', render: r => r.sentMail ? '✅ Yes' : '❌ No' },
    { key: 'fileStatus', label: 'File Status', render: r => renderStatus(r.fileStatus) },
    { 
      key: 'view', 
      label: 'View', 
      render: r => (
        <button 
          className="icon-btn" 
          onClick={() => handleViewPdf(r)}
          style={{ color: '#0284c7', background: 'none', border: 'none', cursor: 'pointer' }}
          title="View Clearing Statement PDF"
        >
          📄 View
        </button>
      )
    }
  ];

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      
      {/* Filter Control Toolbar */}
      <SampleDataNotice detail="Obligation and settlement figures on this screen are generated, not computed from cleared bids." />

      <Card style={{ marginBottom: 20, background: '#f8fafc' }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdamobligationconsole-exchange">Exchange</label>
            <select id="gdamobligationconsole-exchange" className="input"><option>IEX</option><option>PXIL</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdamobligationconsole-port-id">Port Id</label>
            <PortfolioSelect id="gdamobligationconsole-port-id" includeAll allLabel="---Select---" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdamobligationconsole-port-name">Port Name</label>
            <select id="gdamobligationconsole-port-name" className="input"><option>---Select---</option><option>Naitwar_Mori_HPS</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdamobligationconsole-from-delivery-date">From Delivery Date</label>
            <input id="gdamobligationconsole-from-delivery-date" type="date" className="input" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdamobligationconsole-to-delivery-date">To Delivery Date</label>
            <input id="gdamobligationconsole-to-delivery-date" type="date" className="input" />
          </div>
          <button className="btn btn-outline">Search</button>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" style={{ background: '#10b981' }} disabled={selectedRows.length === 0}>
              🟢 Approve & Send to Invoicing
            </button>
            <button className="btn btn-primary" style={{ background: '#ef4444' }} disabled={selectedRows.length === 0}>
              🔴 Reject & Raise Dispute
            </button>
          </div>
        </div>
      </Card>

      {/* Main Table */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{product} Obligation List</h3>
        </div>
        <Table columns={columns} data={mockData} />
        
        {/* Bulk Export Actions */}
        <div style={{ marginTop: 15, display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ color: '#d35400', borderColor: '#d35400' }}>[ Download PDF Files ]</button>
          <button className="btn btn-outline" style={{ color: '#27ae60', borderColor: '#27ae60' }}>[ Download XLS Files ]</button>
        </div>
      </Card>

      {/* Inline PDF Preview Drawer / Modal */}
      {pdfModalOpen && activePdf && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '600px', background: '#fff', zIndex: 9999, boxShadow: '-5px 0 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: 20, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            <div>
              <h3 style={{ margin: 0 }}>Document Viewer - {activePdf.pdfUrl}</h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 5 }}>Portfolio: {activePdf.portfolioId} | Delivery: {activePdf.deliveryDate}</div>
            </div>
            <button onClick={() => setPdfModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: 'auto', background: '#525659', display: 'flex', justifyContent: 'center' }}>
            <div style={{ background: '#fff', width: '100%', maxWidth: 800, minHeight: 800, padding: 30, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}>
               <h2 style={{ textAlign: 'center', textDecoration: 'underline' }}>DAILY OBLIGATION SUMMARY REPORT</h2>
               <table style={{ width: '100%', marginTop: 30, borderCollapse: 'collapse', fontSize: 14 }}>
                  <tbody>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>Trading Date</td><td style={{ padding: 8, border: '1px solid #000' }}>{activePdf.deliveryDate}</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>Entity Name</td><td style={{ padding: 8, border: '1px solid #000' }}>PTC India Ltd.</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>Portfolio Name</td><td style={{ padding: 8, border: '1px solid #000' }}>{activePdf.portfolioId}</td></tr>
                  </tbody>
               </table>
               <table style={{ width: '100%', marginTop: 30, borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                     <tr>
                        <th scope="col" style={{ padding: 8, border: '1px solid #000', textAlign: 'left' }}>LINE ITEM DESCRIPTION</th>
                        <th scope="col" style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>AMOUNT IN ₹</th>
                     </tr>
                  </thead>
                  <tbody>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>Funds Payin(-) / Payout(+)</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>13,21,932.90</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000', paddingLeft: 20 }}>- NLDC Application Fees</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>-7.56</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000', paddingLeft: 20 }}>- STU Transmission Charges</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>-24,289.07</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000', paddingLeft: 20 }}>- SLDC Scheduling and Operating Charges</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>-2,000.00</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>Fees</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>-7,175.50</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000' }}>GST Breakup (IGST)</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right' }}>-1,291.59</td></tr>
                     <tr><td style={{ padding: 8, border: '1px solid #000', fontWeight: 'bold' }}>TOTAL NET PAYOUT</td><td style={{ padding: 8, border: '1px solid #000', textAlign: 'right', fontWeight: 'bold' }}>12,87,169.18</td></tr>
                  </tbody>
               </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
