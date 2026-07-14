import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, fmtNumber } from '../../components/ui.jsx';

export default function SellerEnergyData() {
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.energyData.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_id, filters.period_month, filters.status]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'cuf_percent', header: 'CUF %', render: (r) => r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-' },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Energy Data (Generation Records)"
        subtitle="View your metered energy supply data as recorded and validated by SJVN / SLDC"
      />

      <Card>
        <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 16, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
          ℹ️ Energy data is recorded by SJVN from SLDC/REA/JMR sources. Once status is <strong>LOCKED</strong>, it is used for invoice generation.
          If you disagree with any data, please raise a dispute through the <strong>Disputes</strong> module.
        </div>
      </Card>

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'VALIDATED', 'LOCKED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
      </Card>
    </div>
  );
}
