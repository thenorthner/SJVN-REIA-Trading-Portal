import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { SampleDataNotice, PageHeader, Card, Table, Badge } from '../../components/ui.jsx';

export default function EnergyScheduleArchive() {
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(false);
  const { activeId: portfolio } = usePortfolios();
  const [dateFilter, setDateFilter] = useState('LAST_30'); // 'LAST_7', 'LAST_30', 'CUSTOM'
  
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectedPreview, setSelectedPreview] = useState(null); // holds archive object
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchArchives = async () => {
    setLoading(true);
    try {
      const data = await api.tradingOps.archive({ portfolio });
      let filtered = data.archives;
      if (dateFilter === 'LAST_7') {
        filtered = filtered.slice(0, 7);
      }
      setArchives(filtered);
    } catch (err) {
      console.error('Failed to fetch archives', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchives();
  }, [portfolio, dateFilter]);

  const handlePreview = (arc) => {
    setSelectedPreview(arc);
    setDrawerOpen(true);
  };

  const handleSelectRow = (id) => {
    setSelectedRows(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(archives.map(a => a.id));
    } else {
      setSelectedRows([]);
    }
  };

  const renderStatus = (status) => {
    if (status === 'PARSED') return <Badge type="success">Parsed & Active</Badge>;
    if (status === 'PENDING') return <Badge type="warning" style={{ background: '#f39c12', color: '#fff' }}>Pending Ingestion</Badge>;
    if (status === 'SUPERSEDED') return <Badge type="danger">Revision Superseded</Badge>;
    return <Badge type="neutral">{status}</Badge>;
  };

  const renderSettlementStatus = (status) => {
    if (status === 'FULLY_RECONCILED') return <Badge type="success">Fully Reconciled</Badge>;
    if (status === 'PENDING_PAYOUT') return <Badge type="warning" style={{ background: '#f39c12', color: '#fff' }}>Pending Bank Payout</Badge>;
    if (status === 'DISCREPANCY') return <Badge type="danger">Discrepancy</Badge>;
    return null;
  };

  const columns = [
    { 
      key: 'checkbox', 
      label: <input type="checkbox" aria-label="Select all archives" onChange={handleSelectAll} checked={archives.length > 0 && selectedRows.length === archives.length} />, 
      render: r => <input type="checkbox" aria-label={`Select archive ${r.filename || r.id}`} checked={selectedRows.includes(r.id)} onChange={() => handleSelectRow(r.id)} /> 
    },
    { key: 'portfolio_id', label: 'PORTFOLIO ID' },
    { key: 'trade_date', label: 'TRADE DATE' },
    { key: 'delivery_date', label: 'DELIVERY DATE' },
    { key: 'status', label: 'INGESTION', render: r => renderStatus(r.status) },
    { key: 'settlement_status', label: 'SETTLEMENT', render: r => renderSettlementStatus(r.settlement_status) },
    { key: 'actions', label: 'ACTIONS', render: r => (
       <div style={{ display: 'flex', gap: 5 }}>
         <button className="btn btn-sm btn-outline" onClick={() => handlePreview(r)} title="View 96-Block Schedule"></button>
         <button className="btn btn-sm btn-outline" onClick={() => alert('Not available yet — exchange obligation PDFs are not stored by the platform.')} title="Download Official Obligation PDF"></button>
         <button className="btn btn-sm btn-outline" onClick={() => alert('Not available yet — there is no settlement export behind this screen.')} title="Export Raw Settlement Data"></button>
         <button className="btn btn-sm btn-outline" onClick={() => alert('Not available yet — SAP voucher sync is not built.')} title="Sync to SAP Voucher"></button>
       </div>
    ) }
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto', display: 'flex', position: 'relative' }}>
      <div style={{ flex: 1, marginRight: drawerOpen ? 300 : 0, transition: 'margin 0.3s' }}>
        <SampleDataNotice detail="The archive list is generated. No exchange schedule files have been ingested yet." />

        <PageHeader 
          title="DAILY TRADING DOSSIER (OBLIGATIONS & SCHEDULES)" 
          actions={
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ background: '#34495e' }} onClick={() => alert('Not available yet — bulk download is not built.')}>
                 Download Selected as Zip ({selectedRows.length})
              </button>
              <button className="btn btn-primary" style={{ background: '#28a745' }} onClick={() => alert('Not available yet — monthly summary export is not built.')}>
                 Export Consolidated Accounting Summary
              </button>
            </div>
          }
        />

        <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="energyschedulearchive-portfolio-id">Portfolio ID:</label>
              <PortfolioSelect id="energyschedulearchive-portfolio-id" scope="global" allLabel="-- Select portfolio --" />
            </div>
            
            <div style={{ marginLeft: 20, borderLeft: '1px solid #ccc', paddingLeft: 20 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Quick Dates:</span>
              <div role="group" aria-label="Quick Dates" style={{ display: 'flex', gap: 5 }}>
                <button 
                  className={`btn btn-sm ${dateFilter === 'LAST_7' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setDateFilter('LAST_7')}
                >
                  Last 7 Days
                </button>
                <button 
                  className={`btn btn-sm ${dateFilter === 'LAST_30' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setDateFilter('LAST_30')}
                >
                  Current Month
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading Archives...</div>
            ) : (
              <Table columns={columns} data={archives} />
            )}
          </div>
        </Card>
      </div>

      {/* Inline Preview Drawer */}
      {drawerOpen && selectedPreview && (
        <div style={{ 
          position: 'fixed', right: 0, top: 0, bottom: 0, width: 400, 
          background: '#fff', boxShadow: '-2px 0 10px rgba(0,0,0,0.1)', 
          zIndex: 1000, display: 'flex', flexDirection: 'column' 
        }}>
          <div style={{ padding: 20, background: '#f8f9fa', borderBottom: '1px solid #dee2e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <h3 style={{ margin: 0, fontSize: 16 }}>Schedule Preview</h3>
             <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>&times;</button>
          </div>
          <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
             <div style={{ marginBottom: 20, fontSize: 13 }}>
                <strong>Delivery Date:</strong> {selectedPreview.delivery_date}<br/>
                <strong>Filename:</strong> {selectedPreview.filename}
             </div>
             
             {/* 96-Block Mini Bar Chart (CSS-based) */}
             <div style={{ height: 300, borderLeft: '2px solid #ccc', borderBottom: '2px solid #ccc', position: 'relative', display: 'flex', alignItems: 'flex-end', paddingTop: 20 }}>
                {selectedPreview.blocks.map((mw, i) => {
                   // Calculate height % relative to max max(abs) e.g. 30MW
                   const h = (Math.abs(mw) / 30) * 100;
                   return (
                     <div key={i} style={{
                        flex: 1,
                        height: `${h}%`,
                        background: mw === 0 ? 'transparent' : '#2ecc71',
                        borderTop: mw === 0 ? 'none' : '1px solid #27ae60',
                        marginRight: 1
                     }} title={`Block ${i+1}: ${mw} MW`}></div>
                   )
                })}
             </div>
             <div style={{ textAlign: 'center', fontSize: 11, marginTop: 10, color: '#666' }}>96 Blocks (00:00 to 24:00)</div>
             
             <div style={{ marginTop: 20 }}>
                <p style={{ fontSize: 12, color: '#555' }}>Hover over the bars to see block-wise MW.</p>
                {renderStatus(selectedPreview.status)}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
