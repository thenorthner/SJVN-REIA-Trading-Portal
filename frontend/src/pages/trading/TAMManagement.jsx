import React, { useState, useMemo } from 'react';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
import { SampleDataNotice, PageHeader, Card, Badge, fmtNumber } from '../../components/ui.jsx';
import TAMObligationDetailsModal from './TAMObligationDetailsModal.jsx';

// Mock Data Generator for TAM with Hierarchical (Weekly) support
function generateMockTamData() {
  const records = [];
  const exchanges = ['IEX', 'PXIL', 'HPX'];
  let totalTds = 0;

  for (let i = 0; i < 5; i++) {
    const isWeekly = i % 2 !== 0; 
    const exchange = exchanges[i % exchanges.length];
    const acceptanceNo = isWeekly ? `GNA250927-${i}` : `SR/2025/20064/C/R/${i}`;
    const contractType = isWeekly ? 'Weekly' : 'Day Ahead';

    if (isWeekly) {
      // Weekly Contract (Multiple Days)
      const numDays = 16;
      const dailyMUs = 0.140; // 140 MWh
      const ratePerKwh = 5.0; // ₹5.0 per kWh
      
      const children = [];
      let weeklyGross = 0;
      let weeklyMargin = 0;
      let weeklyIgst = 0;
      let weeklyGrand = 0;
      let weeklyTds = 0;
      let weeklyDed = 0;
      let weeklyNet = 0;
      
      for (let d = 3; d <= 18; d++) {
        const dateStr = `${String(d).padStart(2, '0')}-Oct-2025`;
        
        const grossValue = (dailyMUs * 1000000) * ratePerKwh; 
        const margin = (dailyMUs * 1000000) * 0.02;
        const igst = margin * 0.18;
        const grandTotal = grossValue + margin + igst;
        const tds = grandTotal * 0.001;
        totalTds += tds;
        const deduction = 0;
        const netAmount = grandTotal - tds - deduction;

        weeklyGross += grossValue;
        weeklyMargin += margin;
        weeklyIgst += igst;
        weeklyGrand += grandTotal;
        weeklyTds += tds;
        weeklyDed += deduction;
        weeklyNet += netAmount;

        children.push({
          id: `child-${i}-${d}`,
          exchange,
          acceptanceNo,
          contractType,
          deliveryDate: dateStr,
          tradeDate: '27-Sep-2025',
          energyMUs: dailyMUs,
          grossValue, margin, igst, grandTotal, tds, deduction, netAmount
        });
      }

      records.push({
        id: `parent-${i}`,
        isParent: true,
        isWeekly: true,
        exchange,
        acceptanceNo,
        contractType,
        deliveryDate: '03-Oct to 18-Oct',
        tradeDate: '27-Sep-2025',
        energyMUs: dailyMUs * numDays,
        grossValue: weeklyGross,
        margin: weeklyMargin,
        igst: weeklyIgst,
        grandTotal: weeklyGrand,
        tds: weeklyTds,
        deduction: weeklyDed,
        netAmount: weeklyNet,
        children
      });

    } else {
      // Day Ahead Contract (Single Day)
      const energyMUs = 0.819; // 819 MWh
      const ratePerKwh = 4.8;
      
      const grossValue = (energyMUs * 1000000) * ratePerKwh; 
      const margin = (energyMUs * 1000000) * 0.02;
      const igst = margin * 0.18;
      const grandTotal = grossValue + margin + igst;
      const tds = grandTotal * 0.001;
      totalTds += tds;
      const deduction = Math.random() * 5000;
      const netAmount = grandTotal - tds - deduction;

      records.push({
        id: `parent-${i}`,
        isParent: false,
        isWeekly: false,
        exchange,
        acceptanceNo,
        contractType,
        deliveryDate: '23-Aug-2025',
        tradeDate: '22-Aug-2025',
        energyMUs,
        grossValue, margin, igst, grandTotal, tds, deduction, netAmount,
        children: []
      });
    }
  }
  return { records, totalTds };
}

export default function TAMManagement({ marketType = 'TAM' }) {
  const [exchange, setExchange] = useState('ALL');
  const [unitMode, setUnitMode] = useState('MU'); // 'MU' or 'MWH'
  const [selectedRows, setSelectedRows] = useState([]);
  const [expandedRows, setExpandedRows] = useState([]);
  const [selectedTamRecord, setSelectedTamRecord] = useState(null);

  const mockData = useMemo(() => generateMockTamData(), []);
  const filteredRecords = mockData.records.filter(r => exchange === 'ALL' || r.exchange === exchange);

  const handleSelectRow = (id, childrenIds = []) => {
    setSelectedRows(prev => {
      const isSelected = prev.includes(id);
      let newSelection = [...prev];
      if (isSelected) {
        newSelection = newSelection.filter(x => x !== id && !childrenIds.includes(x));
      } else {
        newSelection.push(id);
        childrenIds.forEach(cid => {
          if (!newSelection.includes(cid)) newSelection.push(cid);
        });
      }
      return newSelection;
    });
  };

  const toggleExpand = (id) => {
    setExpandedRows(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const renderVolume = (mus) => {
    if (unitMode === 'MWH') return `${fmtNumber(mus * 1000)} MWh`;
    return `${mus.toFixed(3)} MUs`;
  };

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Global Countdown Banners */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
         <div style={{ flex: 1, background: '#f39c12', color: '#fff', padding: '10px 20px', borderRadius: '0 0 8px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold' }}>Remaining 19 Days for REC bid</span>
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}>View Calendar</button>
         </div>
         <div style={{ flex: 1, background: '#e74c3c', color: '#fff', padding: '10px 20px', borderRadius: '0 0 8px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold' }}>Remaining 4 Days for ESCERT bid</span>
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}>Go to Market</button>
         </div>
      </div>

      <SampleDataNotice detail="Term-Ahead contracts, obligations and invoices shown here are generated figures — the TAM/GTAM screens are not yet reading from the platform." />


      <PageHeader 
        title={marketType === 'GTAM' ? "GTAM Invoice Record List" : "TAM Obligation List"} 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" style={{ background: '#28a745' }}>[ EXCEL v ] Export Raw Data</button>
          </div>
        }
      />

      {/* Filter Bar */}
      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Exchange:</label>
            <select className="input" value={exchange} onChange={e => setExchange(e.target.value)}>
              <option value="ALL">All Exchanges</option>
              <option value="IEX">IEX</option>
              <option value="PXIL">PXIL</option>
              <option value="HPX">HPX</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Port Id:</label>
            <PortfolioSelect includeAll />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Port Name:</label>
            <select className="input"><option>SJVN Limited-Naitwar Mori HPS</option></select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>From Trading Date:</label>
            <input type="date" className="input" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>To Trading Date:</label>
            <input type="date" className="input" />
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary">Search</button>
          </div>
        </div>
      </Card>

      {/* Tax Summary & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
         <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', padding: '10px 20px', borderRadius: 4, display: 'inline-block' }}>
            <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: 16 }}>
              Cumulative TDS Withheld: ₹ {fmtNumber(mockData.totalTds)}
            </span>
         </div>
         <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 'bold', color: '#555' }}>Volume Unit:</span>
            <div style={{ display: 'flex', background: '#eee', borderRadius: 20, overflow: 'hidden', padding: 2 }}>
               <button onClick={() => setUnitMode('MU')} style={{ background: unitMode === 'MU' ? '#fff' : 'transparent', border: 'none', padding: '5px 15px', borderRadius: 20, cursor: 'pointer', fontWeight: unitMode === 'MU' ? 'bold' : 'normal' }}>MUs</button>
               <button onClick={() => setUnitMode('MWH')} style={{ background: unitMode === 'MWH' ? '#fff' : 'transparent', border: 'none', padding: '5px 15px', borderRadius: 20, cursor: 'pointer', fontWeight: unitMode === 'MWH' ? 'bold' : 'normal' }}>MWh</button>
            </div>
         </div>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: 10, width: 40 }}></th>
                <th style={{ padding: 10 }}>Trading Date</th>
                <th style={{ padding: 10 }}>Delivery Date</th>
                <th style={{ padding: 10 }}>Acceptance No</th>
                <th style={{ padding: 10 }}>Contract</th>
                <th style={{ padding: 10 }}>Total Vol</th>
                <th style={{ padding: 10 }}>Net Amount (₹)</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map(record => {
                const isExpanded = expandedRows.includes(record.id);
                const childrenIds = record.children ? record.children.map(c => c.id) : [];
                return (
                  <React.Fragment key={record.id}>
                    {/* Parent Row */}
                    <tr style={{ borderBottom: '1px solid #eee', background: record.isWeekly ? '#fdfdfd' : '#fff' }}>
                      <td style={{ padding: 10, display: 'flex', gap: 10 }}>
                        {record.isWeekly ? (
                          <button onClick={() => toggleExpand(record.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        ) : <span style={{ width: 14 }}></span>}
                        <input type="checkbox" checked={selectedRows.includes(record.id)} onChange={() => handleSelectRow(record.id, childrenIds)} />
                      </td>
                      <td style={{ padding: 10 }}>{record.tradeDate}</td>
                      <td style={{ padding: 10 }}>
                        {record.deliveryDate}
                        {marketType === 'GTAM' && (
                          <Badge type="success" style={{ display: 'block', marginTop: 4, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', fontSize: 10 }}>
                            🌿 Green Power (GTAM)
                          </Badge>
                        )}
                      </td>
                      <td style={{ padding: 10, fontFamily: 'monospace' }}>{record.acceptanceNo}</td>
                      <td style={{ padding: 10 }}><Badge type={record.isWeekly ? "primary" : "neutral"}>{record.contractType}</Badge></td>
                      <td style={{ padding: 10, fontWeight: 'bold' }}>{renderVolume(record.energyMUs)}</td>
                      <td style={{ padding: 10, color: '#27ae60', fontWeight: 'bold' }}>{fmtNumber(record.netAmount)}</td>
                      <td style={{ padding: 10 }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button className="btn btn-sm btn-outline" title="View Details" onClick={() => setSelectedTamRecord(record)}>📄</button>
                          <button className="btn btn-sm btn-outline" title="View PDFs (IEX Voucher)">💻</button>
                          <button className="btn btn-sm btn-outline" title="View Certificate (Standing Clearance)">📜</button>
                          <button className="btn btn-sm btn-outline" style={{ color: '#e74c3c' }} title="Cancel/Archive">❌</button>
                        </div>
                      </td>
                    </tr>

                    {/* Child Rows (Accordion) */}
                    {isExpanded && record.children && record.children.map(child => (
                      <tr key={child.id} style={{ background: '#f8f9fc', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: 10, textAlign: 'right' }}>
                           <span style={{ color: '#aaa' }}>├─</span>
                           <input type="checkbox" checked={selectedRows.includes(child.id)} onChange={() => handleSelectRow(child.id)} style={{ marginLeft: 5 }} />
                        </td>
                        <td style={{ padding: 10, color: '#666' }}>{child.tradeDate}</td>
                        <td style={{ padding: 10, color: '#666' }}>{child.deliveryDate}</td>
                        <td style={{ padding: 10, color: '#666', fontFamily: 'monospace', fontSize: 12 }}>{child.acceptanceNo}</td>
                        <td style={{ padding: 10, color: '#666', fontSize: 12 }}>{child.contractType}</td>
                        <td style={{ padding: 10, color: '#444' }}>{renderVolume(child.energyMUs)}</td>
                        <td style={{ padding: 10, color: '#444' }}>{fmtNumber(child.netAmount)}</td>
                        <td style={{ padding: 10 }}>
                           <div style={{ display: 'flex', gap: 5 }}>
                             <button className="btn btn-sm btn-outline" title="View Details" onClick={() => setSelectedTamRecord(child)}>📄</button>
                             <button className="btn btn-sm btn-outline" title="View PDFs (IEX Voucher)">💻</button>
                           </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Floating Batch Action Toolbar */}
      {selectedRows.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          background: '#34495e', color: '#fff', padding: '15px 30px', borderRadius: 30,
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 20, zIndex: 900
        }}>
          <div style={{ fontWeight: 'bold' }}>{selectedRows.length} Records Selected</div>
          <button className="btn btn-sm" style={{ background: '#2980b9', color: '#fff', border: 'none' }}>⬇️ Download Checked PDFs (.zip)</button>
          <button className="btn btn-sm" style={{ background: '#27ae60', color: '#fff', border: 'none' }}>📤 Export SAP Settlement Data</button>
        </div>
      )}

      {selectedTamRecord && (
        <TAMObligationDetailsModal record={selectedTamRecord} onClose={() => setSelectedTamRecord(null)} />
      )}
    </div>
  );
}
