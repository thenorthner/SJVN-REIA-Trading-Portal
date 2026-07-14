import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

export default function SellerContracts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', project_type: '' });
  const [selected, setSelected] = useState(null);

  function load() {
    setLoading(true);
    const params = { contract_type: 'PPA' }; // Seller only sees PPAs
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.project_type]);

  function openDetail(row) {
    api.contracts.get(row.id).then(setSelected);
  }

  const columns = [
    { key: 'contract_no', header: 'Contract No.' },
    { key: 'project_type', header: 'Project Type' },
    { key: 'capacity_mw', header: 'Capacity (MW)', render: (r) => fmtNumber(r.capacity_mw) },
    { key: 'tariff_per_unit', header: 'Tariff (₹/unit)', render: (r) => `₹${r.tariff_per_unit}` },
    { key: 'tenure', header: 'Tenure', render: (r) => `${r.tenure_start} → ${r.tenure_end}` },
    { key: 'billing_cycle', header: 'Billing Cycle' },
    { key: 'payment_terms', header: 'Payment Terms', render: (r) => r.payment_terms || '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="My Contracts (PPAs)"
        subtitle="View your Power Purchase Agreements with SJVN"
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['ACTIVE', 'EXPIRED', 'TERMINATED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.project_type} onChange={(e) => setFilters({ ...filters, project_type: e.target.value })}>
          <option value="">All project types</option>
          {['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'PSP', 'Storage'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No contracts found.'} />
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.contract_no} width={680}>
        {selected && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Contract Type</span><span className="detail-value"><Badge status={selected.contract_type} /></span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Project Type</span><span className="detail-value">{selected.project_type}</span></div>
              <div className="detail-item"><span className="detail-label">Capacity</span><span className="detail-value">{fmtNumber(selected.capacity_mw)} MW</span></div>
              <div className="detail-item"><span className="detail-label">Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
              <div className="detail-item"><span className="detail-label">Tenure</span><span className="detail-value">{selected.tenure_start} → {selected.tenure_end}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Cycle</span><span className="detail-value">{selected.billing_cycle}</span></div>
              <div className="detail-item"><span className="detail-label">Payment Terms</span><span className="detail-value">{selected.payment_terms || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">EMD</span><span className="detail-value">{fmtCurrency(selected.emd_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">PBG</span><span className="detail-value">{fmtCurrency(selected.pbg_amount)} {selected.pbg_type ? `(${selected.pbg_type})` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">PBG Expiry</span><span className="detail-value">{selected.pbg_expiry || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Version</span><span className="detail-value">v{selected.version}</span></div>
            </div>

            {selected.versions?.length > 1 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Version History</div>
                <div className="timeline">
                  {selected.versions.map((v) => (
                    <div className="timeline-item" key={v.id}>
                      {v.contract_no} — v{v.version} <Badge status={v.status} />
                      <div className="t-meta">{v.created_at}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
