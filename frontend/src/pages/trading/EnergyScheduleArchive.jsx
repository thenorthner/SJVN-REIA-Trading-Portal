import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge } from '../../components/ui.jsx';

export default function EnergyScheduleArchive() {
  const [archives, setArchives] = useState([]);
  const [note, setNote] = useState('');
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
      let filtered = data.archives || [];
      if (dateFilter === 'LAST_7') {
        filtered = filtered.slice(0, 7);
      }
      setArchives(filtered);
      setNote(data.note || '');
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

  const columns = [
    { 
      key: 'checkbox', 
      label: <input type="checkbox" aria-label="Select all archives" onChange={handleSelectAll} checked={archives.length > 0 && selectedRows.length === archives.length} />, 
      render: r => <input type="checkbox" aria-label={`Select archive ${r.filename || r.id}`} checked={selectedRows.includes(r.id)} onChange={() => handleSelectRow(r.id)} /> 
    },
    { key: 'filename', label: 'FILE' },
    { key: 'rldc', label: 'RLDC', render: r => r.rldc || '—' },
    { key: 'delivery_date', label: 'DELIVERY DATE', render: r => r.delivery_date || '—' },
    { key: 'trade_date', label: 'UPLOADED' },
    { key: 'row_count', label: 'ROWS', render: r => r.row_count ?? '—' },
    { key: 'status', label: 'INGESTION', render: r => renderStatus(r.status) },
    { key: 'uploaded_by', label: 'BY', render: r => r.uploaded_by || '—' },
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
        {/* The archive is the upload register now, so an empty one means nothing
            has been uploaded — which is worth saying plainly. */}
        {note && <div className="alert alert-info" role="status">{note}</div>}

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
             <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div><strong>File:</strong> {selectedPreview.filename}</div>
                <div><strong>Kind:</strong> {selectedPreview.kind}</div>
                <div><strong>RLDC:</strong> {selectedPreview.rldc || '—'}</div>
                <div><strong>Delivery date:</strong> {selectedPreview.delivery_date || '—'}</div>
                {(selectedPreview.period_from || selectedPreview.period_to) && (
                  <div><strong>Period:</strong> {selectedPreview.period_from || '—'} → {selectedPreview.period_to || '—'}</div>
                )}
                <div><strong>Revision:</strong> {selectedPreview.revision_no || '—'}</div>
                <div><strong>Rows:</strong> {selectedPreview.row_count ?? '—'}</div>
                <div><strong>Uploaded:</strong> {selectedPreview.trade_date} by {selectedPreview.uploaded_by || '—'}</div>
                <div><strong>Ingestion:</strong> {renderStatus(selectedPreview.status)}</div>
                {selectedPreview.notes && <div><strong>Notes:</strong> {selectedPreview.notes}</div>}
             </div>

             {/* There was a 96-block bar chart here, drawn from a curve the API
                 made up. The register keeps the upload — file, period, revision,
                 row count — and not the parsed block values, so this says what it
                 has rather than drawing a day that was never read. */}
             <p style={{ fontSize: 12, color: '#555', marginTop: 20 }}>
                The platform records the file and its ingestion; the block-wise schedule inside it is not stored here.
             </p>
          </div>
        </div>
      )}
    </div>
  );
}
