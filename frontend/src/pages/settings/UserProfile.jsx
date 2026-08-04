import React from 'react';
import { usePortfolios } from '../../context/PortfolioContext.jsx';
import { PageHeader, Card, Badge, Field } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function UserProfile() {
  const { portfolios } = usePortfolios();
  const { user } = useAuth();
  
  // Hydrated defaults as requested (Auto-Populated Fallback State)
  const profile = {
    companyName: user?.company || 'NAITWAR MORI HEP / SJVN Limited',
    userId: user?.id || user?.name || 'naitwar850',
    joiningDate: user?.joiningDate || '28-09-2023',
    address: user?.address || 'SHAKTI SADAN, SHANAN, SHIMLA-171006',
    zipCode: user?.zipCode || '171006',
    phoneNo: user?.phoneNo || '0',
    mobileNo: user?.mobileNo || '8894300943',
    emailId: user?.email || 'naitwar850@sjvn.nic.in'
  };

  return (
    <div>
      <PageHeader 
        title="User Profile" 
        subtitle="Account-level master profile for identity, corporate affiliation, and communication credentials."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* ── Left Column: User Info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card title="User Info">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 40px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Company Name:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.companyName}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>User Id:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)', fontWeight: 600 }}>{profile.userId}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Joining Date:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.joiningDate}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Email Id:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.emailId}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Address:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.address}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Zip Code:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.zipCode}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Phone No:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.phoneNo}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 600 }}>Mobile No:</span>
                <span style={{ fontSize: 15, color: 'var(--slate-800)' }}>{profile.mobileNo}</span>
              </div>
            </div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline">Edit Details</button>
            </div>
          </Card>
        </div>

        {/* ── Right Column: Roles & Portfolios ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card title="Role & Rights" style={{ background: 'var(--slate-50)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: 'var(--slate-600)', fontWeight: 500 }}>System Role</span>
                <Badge type="success">Trader</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: 'var(--slate-600)', fontWeight: 500 }}>Approval Rights</span>
                <Badge type="default">Standard</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: 'var(--slate-600)', fontWeight: 500 }}>Audit Access</span>
                <Badge type="warning">Read-Only</Badge>
              </div>
            </div>
          </Card>

          <Card title="Portfolios on the desk">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Two fixed portfolio ids used to be printed here for every user.
                  There is no per-user portfolio assignment in the platform yet,
                  so this lists what the desk can reach rather than claiming an
                  assignment that was never made. */}
              {portfolios.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>No portfolios available.</div>
              )}
              {portfolios.map((pf) => (
                <div key={pf.id} style={{ padding: 12, border: '1px solid var(--slate-200)', borderRadius: 6, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span></span>
                    <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{pf.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginLeft: 26 }}>{pf.id} · {pf.client_type}</div>
                </div>
              ))}
              <button 
                className="btn btn-sm btn-ghost" 
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => window.location.href = '/master/portfolio-registry'}
              >
                View Full Registry →
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
