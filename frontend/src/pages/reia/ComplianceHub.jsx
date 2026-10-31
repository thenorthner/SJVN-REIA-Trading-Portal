import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ContractCompliance from './ContractCompliance.jsx';
import CercCompliance from './CercCompliance.jsx';
import { REIA_BETA } from '../../reiaBeta.js';

/**
 * Consolidated Compliance Hub
 * Brings Contract Compliance and CERC Regulatory Compliance into a single desk with sub-tabs.
 */
export default function ComplianceHub({ defaultTab = 'contract' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = (searchParams.get('tab') || defaultTab).toLowerCase();
  const activeTab = rawTab === 'cerc' ? 'cerc' : 'contract';

  const setTab = (key) => {
    setSearchParams(key === 'cerc' ? { tab: 'cerc' } : { tab: 'contract' }, { replace: true });
  };

  // The beta shows the contract checks alone: the CERC returns are filed under
  // SJVN's trading licence and name its other trades (see BETA_EXCLUDED).
  if (REIA_BETA) return <ContractCompliance />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button
          type="button"
          className={'btn btn-sm ' + (activeTab === 'contract' ? 'btn-primary' : 'btn-outline')}
          onClick={() => setTab('contract')}
        >
          Contract Compliance
        </button>
        <button
          type="button"
          className={'btn btn-sm ' + (activeTab === 'cerc' ? 'btn-primary' : 'btn-outline')}
          onClick={() => setTab('cerc')}
        >
          CERC Regulatory Compliance
        </button>
      </div>

      {activeTab === 'contract' ? (
        <ContractCompliance embedded={true} />
      ) : (
        <CercCompliance embedded={true} />
      )}
    </div>
  );
}
