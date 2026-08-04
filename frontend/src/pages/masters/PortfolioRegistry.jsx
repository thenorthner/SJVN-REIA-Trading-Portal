import React, { useState } from 'react';
import { SampleDataNotice, PageHeader, Card, Badge, Modal } from '../../components/ui.jsx';

const MOCK_ASSETS = [
  {
    company: 'NAITWAR MORI HEP',
    plantName: 'SJVN Limited-Naitwar Mori HPS',
    portfolios: [
      {
        id: 'N1HP0PTC0850',
        type: 'Regional',
        description: 'IEX / RTM / DAM',
        status: 'Active',
        profile: {
          state: 'Himachal Pradesh',
          regionCode: 'N1',
          joiningDate: '28-09-2023',
          tickValue: '1',
          bid: 'Single',
          bidOn: 'Regional Periphery',
          contactPerson: 'SJVN LTD',
          fullAddress: 'SJVN LTD, CORPORATE HEAD QUARTERS, SHAKTI SADAN, SHANAN, SHIMLA-171006',
          zipCode: '171006',
          mobile: '8894300943'
        }
      },
      {
        id: 'HPDC10110008',
        type: 'State',
        description: 'SLDC / Intra-State',
        status: 'Active',
        profile: {
          state: 'Himachal Pradesh',
          regionCode: 'HP',
          joiningDate: '15-10-2023',
          tickValue: '1',
          bid: 'Single',
          bidOn: 'State Periphery',
          contactPerson: 'SJVN LTD',
          fullAddress: 'SJVN LTD, CORPORATE HEAD QUARTERS, SHAKTI SADAN, SHANAN, SHIMLA-171006',
          zipCode: '171006',
          mobile: '8894300943'
        }
      }
    ]
  }
];

export default function PortfolioRegistry() {
  const [viewProfile, setViewProfile] = useState(null);
  
  return (
    <div>
      <SampleDataNotice detail="Portfolio rows are placeholders. Assets are not yet read from the trading-client master." />

      <PageHeader 
        title="PORTFOLIO LIST" 
        subtitle="Master asset directory listing all registered power trading portfolios."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {MOCK_ASSETS.map((asset, i) => (
          <Card key={i} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ background: 'var(--slate-50)', padding: '16px 24px', borderBottom: '1px solid var(--slate-200)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}></span>
              <div>
                <h3 style={{ margin: 0, color: 'var(--slate-900)', fontSize: 18 }}>{asset.company}</h3>
                <span style={{ color: 'var(--slate-500)', fontSize: 13 }}>{asset.plantName}</span>
              </div>
            </div>
            
            <div style={{ padding: '0' }}>
              {asset.portfolios.map((p, j) => (
                <div key={p.id} style={{ padding: '20px 24px', borderBottom: j < asset.portfolios.length - 1 ? '1px solid var(--slate-200)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--slate-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ fontSize: 24, marginTop: 2 }}>{p.type === 'Regional' ? '' : ''}</div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)' }}>{p.id}</span>
                        <Badge type={p.status === 'Active' ? 'success' : 'default'}>{p.status}</Badge>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--slate-600)', fontWeight: 500 }}>
                        {p.type} Portfolio <span style={{ opacity: 0.5 }}>•</span> {p.description}
                      </div>
                    </div>
                  </div>

                  {/* ── Direct Quick-Action Toolbar ── */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-outline" style={{ background: '#fff' }} onClick={() => setViewProfile({...p, company: asset.company, plantName: asset.plantName})} title="View Profile">Profile</button>
                    <button className="btn btn-sm btn-outline" style={{ background: '#fff' }} onClick={() => window.location.href = '/trading/noar-registry'} title="NOC Registry">NOC</button>
                    <button className="btn btn-sm btn-outline" style={{ background: '#fff' }} onClick={() => window.alert('Not available yet — trading agreements are not linked to this registry.')} title="Agreements">Agreements</button>
                    <button className="btn btn-sm btn-outline" style={{ background: '#fff' }} onClick={() => window.alert('Not available yet — configure losses under Master Data \u2192 Transmission Losses.')} title="Loss Factors">Losses</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* ── Portfolio Profile Drawer / Modal ── */}
      {viewProfile && (
        <Modal open={true} onClose={() => setViewProfile(null)} title="Portfolio Profile" width={640}>
          <div style={{ padding: '0 20px 20px 20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid var(--slate-200)' }}>
              <tbody>
                {[
                  { k: 'Portfolio State:', v: viewProfile.profile.state },
                  { k: 'Region Code:', v: viewProfile.profile.regionCode },
                  { k: 'Company:', v: viewProfile.company },
                  { k: 'Portfolio ID:', v: viewProfile.id },
                  { k: 'Portfolio Name:', v: viewProfile.plantName },
                  { k: 'Joining Date:', v: viewProfile.profile.joiningDate },
                  { k: 'Status:', v: <span style={{ color: 'var(--green-strong)', fontWeight: 600 }}>{viewProfile.status}</span> },
                  { k: 'Tick Value:', v: viewProfile.profile.tickValue },
                  { k: 'Bid:', v: viewProfile.profile.bid },
                  { k: 'Bid On:', v: viewProfile.profile.bidOn },
                  { k: 'Contact Person Name:', v: viewProfile.profile.contactPerson },
                  { k: 'Full Address:', v: viewProfile.profile.fullAddress },
                  { k: 'Zip Code:', v: viewProfile.profile.zipCode },
                  { k: 'Mobile No.1:', v: viewProfile.profile.mobile },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--slate-200)', background: i % 2 === 0 ? 'var(--slate-50)' : '#ffffff' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--slate-600)', width: '35%', borderRight: '1px solid var(--slate-200)' }}>{row.k}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--slate-800)' }}>{row.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setViewProfile(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
