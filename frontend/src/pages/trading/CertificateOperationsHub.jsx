import React, { useState, useMemo, useEffect } from 'react';
import { api } from '../../api/client.js';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
import { SampleDataNotice, PageHeader, Card, Table, fmtNumber, Badge, Modal, Field } from '../../components/ui.jsx';
import TaxInvoiceLedgerTable from '../../components/TaxInvoiceLedgerTable.jsx';

function generateMockCertData(certType, subView) {
  const records = [];
  const exchanges = ['IEX', 'PXIL'];
  
  if (subView === 'BIDDING') {
    for (let i = 0; i < 5; i++) {
      const qty = Math.floor(Math.random() * 100) + 50;
      const price = certType === 'ESCERT' ? (1200 + Math.random() * 200) : (1000 + Math.random() * 100);
      records.push({
        id: `BID-${certType}-${i}`,
        portfolioId: 'N1HP0PTC0850',
        portfolioName: 'SJVN Limited-Naitwar Mori HPS',
        tradeDate: `1${i}-Oct-2025`,
        type: Math.random() > 0.5 ? 'Buy' : 'Sell',
        energyType: certType === 'ESCERT' ? 'PAT Cycle 2' : 'Non-Solar',
        exchange: exchanges[i % 2],
        qty,
        price,
        status: i === 0 ? 'New' : i === 1 ? 'Approved' : 'Executed',
        creationDate: `1${i}-Oct-2025 10:00:00`,
        updationDate: `1${i}-Oct-2025 10:15:00`
      });
    }
    return records;
  }
  
  for (let i = 0; i < 8; i++) {
    const qty = Math.floor(Math.random() * 50) + 10;
    const price = certType === 'ESCERT' ? (1200 + Math.random() * 500) : (1000 + Math.random() * 200);
    const totalIEX = qty * price;
    
    // Default zero state
    let margin = 0;
    let igst = 0;
    let cgst = 0;
    let sgst = 0;
    let grandTotal = totalIEX;
    let deduction = 0;
    let netTotal = totalIEX;
    
    if (subView === 'OBLIGATION' || subView === 'INVOICE') {
      margin = qty * 15; // ₹15 margin per cert
      const isInterState = Math.random() > 0.5;
      
      if (isInterState) {
        igst = margin * 0.18;
      } else {
        cgst = margin * 0.09;
        sgst = margin * 0.09;
      }
      
      grandTotal = totalIEX + margin + igst + cgst + sgst;
      deduction = subView === 'INVOICE' ? (qty * 5) : 0; // Registry fee deduction in invoice
      netTotal = grandTotal - deduction;
    }
    
    records.push({
      id: `${certType.toLowerCase()}-${i}`,
      portfolioId: 'N1HP0PTC0850',
      portfolioName: 'SJVN Limited-Naitwar Mori HPS',
      tradeDate: `1${i}-Oct-2025`,
      deliveryDate: `1${i}-Oct-2025`,
      energyType: certType === 'ESCERT' ? 'PAT Cycle 2' : 'Non-Solar',
      registrationNo: certType === 'ESCERT' ? `BEE/PAT/${10000 + i * 42}` : `REC/REG/${20000 + i * 15}`,
      state: 'Himachal Pradesh',
      exchange: exchanges[i % 2],
      totalObligation: qty,
      totalAmount: totalIEX, // renamed totalIEX visually later
      margin, igst, cgst, sgst, grandTotal, deduction, netTotal,
      sapStatus: Math.random() > 0.3 ? 'POSTED' : 'PENDING',
      fileName: `IEX_${certType}_${i}.pdf`
    });
  }
  
  return records;
}

export default function CertificateOperationsHub({ defaultTab = 'ESCERT' }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [activeSubView, setActiveSubView] = useState('BIDDING'); // BIDDING | REGISTRY | OBLIGATION | INVOICE
  const [exchange, setExchange] = useState('ALL');
  
  // Create Bid Form State
  const [showCreate, setShowCreate] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [createForm, setCreateForm] = useState({
    exchange: 'IEX',
    date: '',
    portfolioId: 'N1HP0PTC0850',
    type: 'Buy',
    certType: 'Non-Solar REC',
    qty: '',
    price: ''
  });
  const [formError, setFormError] = useState('');
  const [priceError, setPriceError] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [priceBands, setPriceBands] = useState(null);

  // Floor and forbearance prices are set by CERC (RECs) and BEE (ESCerts) and
  // are revised by order, so they come from master data rather than a literal.
  // The screen previously tested one hard-coded 0-2,500 band for RECs and
  // applied nothing at all to ESCerts, whose bands are set separately.
  useEffect(() => {
    api.rec.reference()
      .then((r) => setPriceBands(r.price_bands || null))
      .catch(() => setPriceBands(null));
  }, []);

  useEffect(() => {
    setPriceError('');
    setPriceNote('');
    if (!createForm.price) return;

    const price = Number(createForm.price);
    if (!Number.isFinite(price)) return;

    const band = priceBands?.[activeTab];
    if (!band) {
      setPriceNote(`No ${activeTab} price band is configured, so the bid is not being checked against a regulatory floor or ceiling.`);
      return;
    }

    const floor = Number(band.floor);
    const ceiling = band.forbearance == null ? null : Number(band.forbearance);

    if (Number.isFinite(floor) && price < floor) {
      setPriceError(`₹${price} is below the ${activeTab} floor price of ₹${floor} per certificate.`);
      return;
    }
    if (ceiling != null && price > ceiling) {
      setPriceError(`₹${price} exceeds the ${activeTab} forbearance (ceiling) price of ₹${ceiling} per certificate.`);
      return;
    }
    if (ceiling == null) {
      setPriceNote(`No forbearance (ceiling) price is recorded for ${activeTab}, so only the floor of ₹${Number.isFinite(floor) ? floor : 0} was checked.`);
    }
  }, [createForm.price, activeTab, priceBands]);

  // A price outside the band blocks the bid. It used to be worded as a
  // "Warning" while also disabling submit, which told the trader the opposite
  // of what the control did.
  const isFormValid = Boolean(createForm.exchange && createForm.portfolioId && createForm.type && createForm.qty && createForm.price && !priceError);

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    setFormError('');
    
    // Registry Balance Validation
    const totalAvailable = activeTab === 'REC' ? (currentSummary.solarAvailable + currentSummary.nonSolarAvailable) : currentSummary.available;
    if (createForm.type === 'Sell' && Number(createForm.qty) > totalAvailable) {
      setFormError(`Insufficient Balance: You are trying to sell ${createForm.qty} units, but only ${totalAvailable} units are available in your registry holding.`);
      return;
    }
    
    setShowConfirm(true);
  };
  
  const confirmAndSaveBid = () => {
    // Nothing is persisted here yet: there is no certificate-bid endpoint. This
    // used to report the bid as saved and queued for the exchange, which would
    // leave a trader believing a REC/ESCert position had been taken.
    setShowConfirm(false);
    setShowCreate(false);
    alert(
      'Not submitted.\n\n'
      + 'Certificate bidding is still a prototype screen — this platform has no '
      + 'REC/ESCert bid endpoint yet, so nothing was saved or sent to the exchange.'
    );
  };

  const mockData = useMemo(() => generateMockCertData(activeTab, activeSubView), [activeTab, activeSubView]);
  const filteredRecords = mockData.filter(r => exchange === 'ALL' || r.exchange === exchange);

  const inventorySummary = {
    REC: { solarAvailable: 800, nonSolarAvailable: 400, price: '₹ 1,000.00', nextClosure: '10 Days : 5 Hrs' },
    ESCERT: { available: 4250, price: '₹ 1,524.00', nextClosure: '4 Days : 12 Hrs' }
  };
  
  const currentSummary = inventorySummary[activeTab];

  const getColumns = () => {
    let cols = [];
    
    if (activeSubView === 'BIDDING') {
      cols = [
        { key: 'portfolioId', label: 'Portfolio Id' },
        { key: 'tradeDate', label: 'Trading Date' },
        { key: 'type', label: 'Type', render: r => <Badge type={r.type === 'Buy' ? 'primary' : 'success'}>{r.type}</Badge> },
        { key: 'energyType', label: 'Certificate Type' },
        { key: 'qty', label: 'Certificate Quantity', render: r => <strong>{fmtNumber(r.qty)}</strong> },
        { key: 'price', label: 'Per Certificate Price(Rs.)', render: r => <span>{fmtNumber(r.price)}</span> },
        { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'New' ? 'primary' : r.status === 'Executed' ? 'success' : 'neutral'}>{r.status}</Badge> },
        { key: 'creationDate', label: 'Creation Date' },
        { key: 'updationDate', label: 'Updation Date' },
        { key: 'modify', label: 'Modify', render: () => (
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn btn-sm btn-outline" title="Edit" aria-label="Edit">✏️</button>
            <button className="btn btn-sm btn-outline" title="Delete" aria-label="Delete">🗑️</button>
          </div>
        )}
      ];
    }
    else if (activeSubView === 'REGISTRY') {
      cols = [
        { key: 'portfolioId', label: 'Portfolio Id' },
        { key: 'portfolioName', label: 'Portfolio Name' },
        { key: 'tradeDate', label: 'Trading Date' },
        { key: 'deliveryDate', label: 'Delivery Date' },
        { key: 'registrationNo', label: 'Registration No', render: r => <span style={{ fontFamily: 'monospace' }}>{r.registrationNo}</span> },
        { key: 'state', label: 'State' },
        { key: 'totalObligation', label: 'Total Obligation (Units)', render: r => <strong>{r.totalObligation}</strong> },
        { key: 'totalAmount', label: 'Total (₹)', render: r => <span style={{ color: '#27ae60', fontWeight: 'bold' }}>{fmtNumber(r.totalAmount)}</span> },
        { key: 'fileName', label: 'File Name', render: r => <span style={{ color: '#2980b9', textDecoration: 'underline', cursor: 'pointer' }}>{r.fileName}</span> },
        ...(activeTab === 'REC' ? [
          { key: 'solar', label: 'Solar Certificate', render: () => <button className="btn btn-sm btn-outline" title="View Solar Details" aria-label="View Solar Details">☀️</button> },
          { key: 'nonsolar', label: 'Non-Solar Certificate', render: () => <button className="btn btn-sm btn-outline" title="View Non-Solar Details" aria-label="View Non-Solar Details">💨</button> }
        ] : []),
        { key: 'cert', label: `${activeTab} Certificate`, render: () => <button className="btn btn-sm btn-outline" title="View POSOCO/BEE Transfer Slip" aria-label="View POSOCO/BEE Transfer Slip">📜</button> }
      ];
    } 
    else if (activeSubView === 'OBLIGATION') {
      cols = [
        { key: 'portfolioId', label: 'Portfolio Id' },
        { key: 'portfolioName', label: 'Portfolio Name' },
        { key: 'tradeDate', label: 'Trading Date' },
        { key: 'deliveryDate', label: 'Delivery Date' },
        { key: 'registrationNo', label: 'Registration No', render: r => <span style={{ fontFamily: 'monospace' }}>{r.registrationNo}</span> },
        { key: 'state', label: 'State' },
        { key: 'totalObligation', label: 'Total Obligation (Units)', render: r => (
          <strong title={`RPO Allocation:\n- Client A: ${Math.floor(r.totalObligation * 0.6)} Units\n- Internal Target: ${Math.ceil(r.totalObligation * 0.4)} Units`} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'help' }}>
            {r.totalObligation}
          </strong>
        )},
        { key: 'totalAmount', label: 'Total (₹)', render: r => <span style={{ color: '#333', fontWeight: 'bold' }}>{fmtNumber(r.totalAmount)}</span> },
        { key: 'fileName', label: 'File Name', render: r => <span style={{ color: '#2980b9', textDecoration: 'underline', cursor: 'pointer' }}>{r.fileName}</span> },
        ...(activeTab === 'REC' ? [
          { key: 'solar', label: 'Solar Certificate', render: () => <button className="btn btn-sm btn-outline" title="View Solar Details" aria-label="View Solar Details">☀️</button> },
          { key: 'nonsolar', label: 'Non-Solar Certificate', render: () => <button className="btn btn-sm btn-outline" title="View Non-Solar Details" aria-label="View Non-Solar Details">💨</button> }
        ] : []),
        { key: 'actions', label: 'Actions', render: () => (
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn btn-sm btn-outline" title="Exchange PDF" aria-label="Exchange PDF">📄</button>
            <button className="btn btn-sm btn-outline" title="NLDC Transfer Slip" aria-label="NLDC Transfer Slip">📜</button>
            <button className="btn btn-sm btn-outline" title="Breakup Details" aria-label="Breakup Details">🔍</button>
          </div>
        )}
      ];
    }
    else if (activeSubView === 'INVOICE') {
      return []; // Handled by TaxInvoiceLedgerTable now
    }
    
    return cols;
  };

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      
      {/* Top Module Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '2px solid #ddd' }}>
        <button 
          onClick={() => { setActiveTab('REC'); setCreateForm(f => ({...f, certType: 'Non-Solar REC'})); }}
          style={{ padding: '12px 24px', background: 'transparent', border: 'none', borderBottom: activeTab === 'REC' ? '3px solid #2980b9' : '3px solid transparent', color: activeTab === 'REC' ? '#2980b9' : '#666', fontWeight: 'bold', cursor: 'pointer', fontSize: 16 }}>
          📜 Renewable Energy Certificates (RECs)
        </button>
        <button 
          onClick={() => { setActiveTab('ESCERT'); setCreateForm(f => ({...f, certType: 'ESCERT'})); }}
          style={{ padding: '12px 24px', background: 'transparent', border: 'none', borderBottom: activeTab === 'ESCERT' ? '3px solid #2980b9' : '3px solid transparent', color: activeTab === 'ESCERT' ? '#2980b9' : '#666', fontWeight: 'bold', cursor: 'pointer', fontSize: 16 }}>
          ⚡ Energy Saving Certificates (ESCerts)
        </button>
      </div>

      {activeSubView === 'BIDDING' && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffe69c', padding: '10px 15px', borderRadius: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#664d03', fontWeight: 600 }}>
            <span style={{ marginRight: 8 }}>⏳</span>
            Closing in {currentSummary.nextClosure} for {activeTab} auction (Gate Closure: 15:00 PM)
          </div>
          <div>
            <button className="btn btn-primary btn-sm" style={{ background: '#664d03', borderColor: '#664d03' }} onClick={() => setShowCreate(true)}>Create New Bid</button>
          </div>
        </div>
      )}

      {/* Sub-View Toggle (Pill Navigation) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button 
          onClick={() => setActiveSubView('BIDDING')}
          style={{ padding: '8px 16px', background: activeSubView === 'BIDDING' ? '#2c3e50' : '#ecf0f1', color: activeSubView === 'BIDDING' ? '#fff' : '#333', border: 'none', borderRadius: 20, cursor: 'pointer', fontWeight: 'bold' }}>
          📝 Bid Management
        </button>
        <button 
          onClick={() => setActiveSubView('REGISTRY')}
          style={{ padding: '8px 16px', background: activeSubView === 'REGISTRY' ? '#2c3e50' : '#ecf0f1', color: activeSubView === 'REGISTRY' ? '#fff' : '#333', border: 'none', borderRadius: 20, cursor: 'pointer', fontWeight: 'bold' }}>
          📂 Registry Holdings
        </button>
        <button 
          onClick={() => setActiveSubView('OBLIGATION')}
          style={{ padding: '8px 16px', background: activeSubView === 'OBLIGATION' ? '#2c3e50' : '#ecf0f1', color: activeSubView === 'OBLIGATION' ? '#fff' : '#333', border: 'none', borderRadius: 20, cursor: 'pointer', fontWeight: 'bold' }}>
          💰 Clearing Obligations
        </button>
        <button 
          onClick={() => setActiveSubView('INVOICE')}
          style={{ padding: '8px 16px', background: activeSubView === 'INVOICE' ? '#2c3e50' : '#ecf0f1', color: activeSubView === 'INVOICE' ? '#fff' : '#333', border: 'none', borderRadius: 20, cursor: 'pointer', fontWeight: 'bold' }}>
          🧾 Commercial Tax Ledger & Invoices
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        {activeTab === 'REC' ? (
          <>
            <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', padding: 20, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: 32 }}>☀️</div>
              <div>
                <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Solar RECs Held</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2c3e50' }}>{fmtNumber(currentSummary.solarAvailable)} Units</div>
              </div>
            </div>
            <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', padding: 20, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: 32 }}>💨</div>
              <div>
                <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Non-Solar / Hydro RECs Held</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2c3e50' }}>{fmtNumber(currentSummary.nonSolarAvailable)} Units</div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', padding: 20, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 32 }}>📜</div>
            <div>
              <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Available {activeTab}s in Registry</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2c3e50' }}>{fmtNumber(currentSummary.available)} Units</div>
            </div>
          </div>
        )}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', padding: 20, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 32 }}>💰</div>
          <div>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Last Traded MCP</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#27ae60' }}>{currentSummary.price}</div>
            <div style={{ fontSize: 11, color: '#999' }}>Per {activeTab}</div>
          </div>
        </div>
        <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', padding: 20, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 32 }}>⏳</div>
          <div>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Next Auction Gate Closure</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#e74c3c' }}>{currentSummary.nextClosure}</div>
          </div>
        </div>
      </div>

      <SampleDataNotice detail="Certificate holdings, bids, obligations and tax invoices on this screen are generated figures. REC/ESCert data is not yet read from the platform or the national registry, and bids placed here are not sent anywhere." />

      <PageHeader 
        title={`${activeTab} ${activeSubView === 'BIDDING' ? 'Bid List' : activeSubView === 'REGISTRY' ? 'Registry Holdings' : activeSubView === 'OBLIGATION' ? 'Clearing Obligations' : 'Tax Invoices'}`} 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            {activeTab === 'REC' && activeSubView === 'REGISTRY' && (
              <button
                className="btn btn-secondary"
                disabled
                title="The recindia.in registry integration is not built yet"
                onClick={() => {
                  // Previously reported a successful sync, a balance figure and
                  // an audit log entry, none of which happened. A registry sync
                  // decides how many certificates SJVN believes it holds, so a
                  // fabricated confirmation is worse than no button at all.
                }}
              >
                🔄 Sync with REC Registry (not connected)
              </button>
            )}
            <button className="btn btn-primary" style={{ background: '#28a745' }}>[ EXCEL v ] Export</button>
          </div>
        }
      />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="certificateoperationshub-exchange">Exchange:</label>
            <select id="certificateoperationshub-exchange" className="input" value={exchange} onChange={e => setExchange(e.target.value)}>
              <option value="ALL">---Select---</option>
              <option value="IEX">IEX</option>
              <option value="PXIL">PXIL</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="certificateoperationshub-portfolio">Portfolio:</label>
            <PortfolioSelect id="certificateoperationshub-portfolio" includeAll />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="certificateoperationshub-from-date">From Date:</label>
            <input id="certificateoperationshub-from-date" type="date" className="input" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="certificateoperationshub-to-date">To Date:</label>
            <input id="certificateoperationshub-to-date" type="date" className="input" />
          </div>
          {activeSubView === 'BIDDING' && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="certificateoperationshub-status">Status:</label>
              <select id="certificateoperationshub-status" className="input">
                <option value="ALL">New</option>
                <option value="APPROVED">Approved</option>
              </select>
            </div>
          )}
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary">Search</button>
          </div>
        </div>
      </Card>

      <Card>
        {activeSubView === 'INVOICE' ? (
          <TaxInvoiceLedgerTable records={filteredRecords} marketSegment={activeTab} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table columns={getColumns()} data={filteredRecords} />
          </div>
        )}
      </Card>
      
      {/* Create Bid Form Modal */}
      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title={`Create ${activeTab} Bid`} width={600}>
          <form onSubmit={handleCreateSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Target Execution Strategy">
                <select className="input" value={createForm.exchange} onChange={e => setCreateForm({...createForm, exchange: e.target.value})}>
                  <option value="IEX">IEX (Primary Liquidity)</option>
                  <option value="PXIL">PXIL (Alternative Venue)</option>
                  <option value="SMART_SPLIT">Smart Split (60% IEX / 40% PXIL)</option>
                  <option value="AUTO_ROUTE">Auto-Route (Best Depth)</option>
                </select>
                {createForm.exchange === 'IEX' && (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#666' }}>📊 30-Day Liquidity: ~85,000 RECs cleared</div>
                )}
                {createForm.exchange === 'PXIL' && (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#666' }}>📊 30-Day Liquidity: ~12,000 RECs cleared</div>
                )}
                {(createForm.exchange === 'SMART_SPLIT' || createForm.exchange === 'AUTO_ROUTE') && (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#2980b9', fontWeight: 'bold' }}>
                    {createForm.exchange === 'SMART_SPLIT' ? '🧠 Splitting order to hedge execution risk.' : '⚡ Routing to exchange with highest order-book depth.'}
                  </div>
                )}
              </Field>
              <Field label="Date">
                <input type="date" className="input" value={createForm.date} onChange={e => setCreateForm({...createForm, date: e.target.value})} />
              </Field>
              <Field label="Portfolio Id">
                <PortfolioSelect
                  value={createForm.portfolioId}
                  onChange={(v) => setCreateForm({ ...createForm, portfolioId: v })}
                  allLabel="-- Select portfolio --"
                />
              </Field>
              <Field label="Type">
                <select className="input" value={createForm.type} onChange={e => setCreateForm({...createForm, type: e.target.value})}>
                  <option value="Buy">Buy</option>
                  <option value="Sell">Sell</option>
                </select>
              </Field>
              {activeTab === 'REC' && (
                <Field label="Certificate Type">
                  <select className="input" value={createForm.certType} onChange={e => setCreateForm({...createForm, certType: e.target.value})}>
                    <option value="Solar REC">Solar REC</option>
                    <option value="Non-Solar REC">Non-Solar REC</option>
                    <option value="Hydro REC">Hydro REC</option>
                  </select>
                </Field>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <Field label="Qty" required style={{ flex: 1 }}>
                  <input type="number" min="1" step="1" className="input" value={createForm.qty} onChange={e => setCreateForm({...createForm, qty: e.target.value})} required />
                </Field>
                <Field label={`Per Certificate Price (₹)`} style={{ flex: 1 }}>
                  <input type="number" className="input" value={createForm.price} onChange={e => setCreateForm({...createForm, price: e.target.value})} placeholder="e.g. 1500" />
                  {priceError && (
                    <div style={{ marginTop: 5, fontSize: 11, color: 'var(--red)', fontWeight: 'bold' }}>⚠️ {priceError}</div>
                  )}
                  {!priceError && priceNote && (
                    <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>{priceNote}</div>
                  )}
                </Field>
              </div>
            </div>
            
            {/* Auto-calculating Estimator */}
            {createForm.qty && createForm.price && (
              <div style={{ background: '#f8f9fa', border: '1px dashed #adb5bd', padding: 15, borderRadius: 8, marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: '#6c757d', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 5 }}>Order Value Estimator</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{fmtNumber(createForm.qty)} Units × ₹{fmtNumber(createForm.price)}</span>
                  <span style={{ fontSize: 20, fontWeight: 'bold', color: '#2c3e50' }}>₹{fmtNumber(createForm.qty * createForm.price)}</span>
                </div>
              </div>
            )}
            
            {formError && (
              <div style={{ background: '#f8d7da', color: '#842029', border: '1px solid #f5c2c7', padding: '10px 15px', borderRadius: 4, marginBottom: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
                ⚠️ {formError}
              </div>
            )}
            
            <div style={{ marginTop: 25, textAlign: 'right' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)} style={{ marginRight: 10 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!isFormValid} style={{ opacity: isFormValid ? 1 : 0.6, cursor: isFormValid ? 'pointer' : 'not-allowed', background: '#2c3e50', borderColor: '#2c3e50' }}>
                {isFormValid ? 'Save' : 'Complete Required Fields'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Pre-Submission Modal Summary */}
      {showConfirm && (
        <Modal open={true} onClose={() => setShowConfirm(false)} title="Confirm Order Submission" width={500}>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>{createForm.type === 'Buy' ? '📥' : '📤'}</div>
            <h3 style={{ margin: '0 0 10px 0' }}>Confirm {createForm.type} Order</h3>
            <p style={{ color: '#666', marginBottom: 20 }}>Please review your order details before submitting to the exchange.</p>
            
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', marginBottom: 20 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', color: '#666' }}>Exchange</td>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontWeight: 'bold', textAlign: 'right' }}>{createForm.exchange}</td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', color: '#666' }}>Order Type</td>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontWeight: 'bold', textAlign: 'right' }}>
                    <Badge type={createForm.type === 'Buy' ? 'primary' : 'success'}>{createForm.type}</Badge>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', color: '#666' }}>Quantity</td>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontWeight: 'bold', textAlign: 'right' }}>{fmtNumber(createForm.qty)} {createForm.certType}s</td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', color: '#666' }}>Limit Price</td>
                  <td style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontWeight: 'bold', textAlign: 'right' }}>₹{fmtNumber(createForm.price)}</td>
                </tr>
                <tr style={{ background: '#f5f7f9' }}>
                  <td style={{ padding: '12px 10px', color: '#333', fontWeight: 'bold' }}>Total Capital Obligation</td>
                  <td style={{ padding: '12px 10px', fontWeight: 'bold', textAlign: 'right', fontSize: 18, color: '#2c3e50' }}>
                    ₹{fmtNumber(createForm.qty * createForm.price)}
                  </td>
                </tr>
              </tbody>
            </table>
            
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowConfirm(false)}>Back to Edit</button>
              <button className="btn btn-primary" style={{ flex: 1, background: '#27ae60', borderColor: '#27ae60' }} onClick={confirmAndSaveBid}>Submit Bid</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
