import React, { useState, useMemo } from 'react';
import { SampleDataNotice, PageHeader, Table, Badge, Modal, Field, Card } from '../../components/ui.jsx';

const MOCK_NOCS = [
  { id: '1', nocNo: 'NOC/HPSLDC/NR/2023/32622', validityFrom: '2023-11-26', validityTo: '2023-11-30', issueDate: '2023-11-25', sldc: 'Himachal Pradesh', status: 'Expired' },
  { id: '2', nocNo: 'NOC/HPSLDC/NR/2023/33718', validityFrom: '2023-12-01', validityTo: '2023-12-31', issueDate: '2023-11-29', sldc: 'Himachal Pradesh', status: 'Expired' },
  { id: '3', nocNo: 'NOC/HPSLDC/NR/2023/3413',  validityFrom: '2023-12-04', validityTo: '2023-12-31', issueDate: '2023-12-04', sldc: 'Himachal Pradesh', status: 'Expired' },
  { id: '4', nocNo: 'NOC/HPSLDC/NR/2024/39222', validityFrom: '2024-02-01', validityTo: '2024-02-29', issueDate: '2024-01-30', sldc: 'Himachal Pradesh', status: 'Expired' },
  { id: '5', nocNo: 'NOC/HPSLDC/NR/2026/91249', validityFrom: '2026-04-01', validityTo: '2026-06-30', issueDate: '2026-03-16', sldc: 'Himachal Pradesh', status: 'Expired' },
  { id: '6', nocNo: 'NOC/HPSLDC/NR/2026/99962', validityFrom: '2026-07-01', validityTo: '2026-09-30', issueDate: '2026-06-20', sldc: 'Himachal Pradesh', status: 'Active' },
];

export default function NOARRegistry() {
  const [filters, setFilters] = useState({ nocNo: '', status: '', validityFrom: '', validityTo: '' });
  const [viewingNoc, setViewingNoc] = useState(null);

  const activeNoc = MOCK_NOCS.find(n => n.status === 'Active');
  
  // Calculate automated expiry alert
  const today = new Date('2026-08-01'); // Using system current date
  const expiryDate = activeNoc ? new Date(activeNoc.validityTo) : null;
  const daysToExpiry = expiryDate ? Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)) : 0;
  
  const showRenewalAlert = daysToExpiry <= 60; // Usually track ahead of time, showing if <= 60 days for demo

  const filteredData = useMemo(() => {
    return MOCK_NOCS.filter(r => {
      if (filters.nocNo && !r.nocNo.toLowerCase().includes(filters.nocNo.toLowerCase())) return false;
      if (filters.status && filters.status !== 'All') {
        if (filters.status === 'Active NOC' && r.status !== 'Active') return false;
        if (filters.status === 'Expired NOC' && r.status !== 'Expired') return false;
        if (filters.status === 'New NOC' && r.status !== 'New') return false;
      }
      if (filters.validityFrom && new Date(r.validityFrom) < new Date(filters.validityFrom)) return false;
      if (filters.validityTo && new Date(r.validityTo) > new Date(filters.validityTo)) return false;
      return true;
    });
  }, [filters]);

  const columns = [
    { key: 'nocNo', header: 'NOC No.', render: r => <span style={{ fontWeight: 600, color: '#0b4a8f' }}>{r.nocNo}</span> },
    { key: 'validityFrom', header: 'Validity From', render: r => new Date(r.validityFrom).toLocaleDateString('en-GB').replace(/\//g, '-') },
    { key: 'validityTo', header: 'Validity To', render: r => new Date(r.validityTo).toLocaleDateString('en-GB').replace(/\//g, '-') },
    { key: 'issueDate', header: 'Issue Date', render: r => new Date(r.issueDate).toLocaleDateString('en-GB').replace(/\//g, '-') },
    { key: 'sldc', header: 'SLDC' },
    { key: 'status', header: 'Status', render: r => <Badge type={r.status === 'Active' ? 'success' : 'default'}>{r.status}</Badge> },
    { 
      key: 'actions', 
      header: 'Actions', 
      render: r => (
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-xs btn-ghost" title="Download Attachment" onClick={() => setViewingNoc(r)}>💻 Attachment</button>
          <button className="btn btn-xs btn-outline" title="View Parsed Detail" onClick={() => setViewingNoc(r)}>💻 View</button>
        </div>
      ) 
    },
  ];

  return (
    <div>
      <SampleDataNotice detail="Registry entries shown here are placeholders; NOAR/SLDC records are not yet pulled into this screen." />

      <PageHeader
        title="NOAR / SLDC Standing Clearance Registry Console"
        subtitle="Historical log of No Objection Certificates (NOCs) for trading operations."
      />

      {/* ── Automated Expiry & Renewal Pipeline ── */}
      {showRenewalAlert && activeNoc && (
        <div style={{ background: daysToExpiry <= 7 ? '#fef2f2' : '#fffbeb', border: `1px solid ${daysToExpiry <= 7 ? '#f87171' : '#fcd34d'}`, padding: '16px 20px', borderRadius: 8, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{daysToExpiry <= 7 ? '🚨' : '⚠️'}</span>
            <div>
              <h4 style={{ margin: '0 0 4px 0', color: daysToExpiry <= 7 ? '#b91c1c' : '#b45309', fontSize: 15 }}>
                Action Required: SLDC Clearance Renewal
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                Active clearance <strong>{activeNoc.nocNo}</strong> expires in <strong>{daysToExpiry} days</strong> ({new Date(activeNoc.validityTo).toLocaleDateString('en-GB')}). 
                {daysToExpiry <= 7 && " Clause 26 mandates immediate renewal drafting to prevent trading suspension."}
              </p>
            </div>
          </div>
          <button className="btn btn-primary" style={{ background: daysToExpiry <= 7 ? '#dc2626' : '#d97706', borderColor: 'transparent' }}>
            Draft Renewal Application
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <Card title="Select NOC" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="NOC No:">
            <input type="text" className="input" placeholder="Search by NOC No..." value={filters.nocNo} onChange={e => setFilters({...filters, nocNo: e.target.value})} />
          </Field>
          <Field label="Status:">
            <select className="input" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
              <option value="All">All</option>
              <option value="Active NOC">Active NOC</option>
              <option value="Expired NOC">Expired NOC</option>
              <option value="New NOC">New NOC</option>
            </select>
          </Field>
          <Field label="Validity From:">
            <input type="date" className="input" value={filters.validityFrom} onChange={e => setFilters({...filters, validityFrom: e.target.value})} />
          </Field>
          <Field label="Validity To:">
            <input type="date" className="input" value={filters.validityTo} onChange={e => setFilters({...filters, validityTo: e.target.value})} />
          </Field>
          <button className="btn btn-primary" style={{ height: 38 }} onClick={() => {}}>Search</button>
        </div>
      </Card>

      {/* ── Data Grid ── */}
      <Card style={{ padding: 0 }}>
        <Table columns={columns} data={filteredData} emptyMessage="No clearances found." />
      </Card>

      {/* ── Inline Document Viewer Modal ── */}
      {viewingNoc && (
        <Modal open={true} onClose={() => setViewingNoc(null)} title={`Standing Clearance Document: ${viewingNoc.nocNo}`} width={900}>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
              <div style={{ flex: 1, background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#0b4a8f' }}>Entity Master Configuration</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><strong>SLDC:</strong> {viewingNoc.sldc}</div>
                  <div><strong>NOAR ID:</strong> NOSNA48142</div>
                  <div><strong>Entity Type:</strong> Central Generating Station</div>
                  <div><strong>Generator Type:</strong> Large Hydro</div>
                  <div><strong>Market:</strong> NR (Northern Region)</div>
                  <div><strong>Validity:</strong> {new Date(viewingNoc.validityFrom).toLocaleDateString('en-GB')} to {new Date(viewingNoc.validityTo).toLocaleDateString('en-GB')}</div>
                </div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', padding: 16, borderRadius: 8, border: '1px solid #fca5a5' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#dc2626' }}>Market Restrictions</h4>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#475569', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <li><strong>HP-DAM:</strong> Not Applicable (Blocked)</li>
                  <li><strong>TRAS:</strong> Not Applicable (Blocked)</li>
                  <li><strong>IEX / PXIL Collective:</strong> Active (29.29 MW Cap)</li>
                </ul>
              </div>
            </div>
            
            <h4 style={{ marginBottom: 12 }}>Extracted Document Clauses</h4>
            <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, maxHeight: 400, overflowY: 'auto', fontFamily: 'serif', fontSize: 14, lineHeight: 1.6, color: '#334155' }}>
              <p><strong>14. Maximum MW (at regional periphery) allowed for injection:</strong> 29.29 MW</p>
              <p><strong>15. Maximum MW (at regional periphery) allowed for drawal:</strong> 29.29 MW</p>
              <p><strong>16. Transmission Losses:</strong> State Transmission Losses: 0.75% | Any Other Losses: 0.33%</p>
              <p><strong>17. Applicable Charges:</strong> Regional Transmission Charges: ₹107.630 / MW / Block | State Transmission Charges: ₹67.7 / MWh | SLDC Operating Charges: ₹2000 / Day</p>
              <hr style={{ margin: '16px 0', borderColor: '#e2e8f0' }} />
              <p><strong>Declarations:</strong></p>
              <p>20. It is verified that availability of transmission capacity in the intrastate network for the sell and purchase of power, as applicable for M/s Naitwar Mori HPS is in place.</p>
              <p>23. It needs to be ensured that M/s Naitwar Mori HPS shall utilize this standing clearance for purchase of power only in case of forced outage.</p>
              <p>24. M/s Naitwar Mori HPS shall ensure that bidding in the short term market has done taking into ramping constraints in account.</p>
            </div>
            
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-outline" onClick={() => setViewingNoc(null)}>Close Viewer</button>
              <button className="btn btn-primary" onClick={() => window.alert('Not available yet — NOC documents are not stored against registry entries.')}>Download Original PDF</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
