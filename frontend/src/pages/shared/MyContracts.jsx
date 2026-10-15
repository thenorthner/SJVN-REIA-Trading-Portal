import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, fmtNumber } from '../../components/ui.jsx';
import ContractWorkspace from '../../components/ContractWorkspace.jsx';
import { fmtDate } from '../../datetime.js';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What on a contract needs this company to act, as short flags for the list. */
function flagsOf(a) {
  if (!a) return [];
  return [
    a.milestones_delayed > 0 && { tone: 'red', text: `${plural(a.milestones_delayed, 'milestone')} delayed`, tab: 'MILESTONES' },
    a.pbg_state === 'EXPIRED' && { tone: 'red', text: 'PBG expired', tab: 'GUARANTEE' },
    a.notices_awaiting_me > 0 && { tone: 'red', text: `${plural(a.notices_awaiting_me, 'notice')} to acknowledge`, tab: 'NOTICES' },
    a.pbg_state === 'EXPIRING' && { tone: 'amber', text: `PBG expires in ${plural(a.pbg_days_to_expiry, 'day')}`, tab: 'GUARANTEE' },
    a.milestones_due_soon > 0 && { tone: 'amber', text: `${plural(a.milestones_due_soon, 'milestone')} due soon`, tab: 'MILESTONES' },
    a.requests_pending > 0 && { tone: 'amber', text: `${plural(a.requests_pending, 'request')} with SJVN`, tab: 'REQUESTS' },
  ].filter(Boolean);
}

/**
 * A counterparty's own contracts — PPAs for a seller, PSAs for a buyer — each
 * opening onto its working file: documents, milestones, guarantee, requests
 * and notices.
 */
export default function MyContracts({ contractType, title, subtitle, sourceLabel, capacityLabel }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', project_type: '' });
  const [selected, setSelected] = useState(null);
  const [startTab, setStartTab] = useState('OVERVIEW');

  const load = useCallback(() => {
    setLoading(true);
    const params = { contract_type: contractType };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params).then(setRows).finally(() => setLoading(false));
    api.contractWorkspace.summary()
      .then((list) => setSummary(Object.fromEntries(list.map((s) => [s.contract_id, s]))))
      .catch(() => setSummary({}));
  }, [contractType, filters]);

  useEffect(() => { load(); }, [load]);

  function open(row, tab = 'OVERVIEW') {
    setStartTab(tab);
    api.contracts.get(row.id).then(setSelected);
  }

  // Everything across the contracts that is waiting on this company, most pressing first.
  const attention = useMemo(() => rows
    .flatMap((r) => flagsOf(summary[r.id]).map((f) => ({ ...f, row: r })))
    .sort((a, b) => (a.tone === 'red' ? 0 : 1) - (b.tone === 'red' ? 0 : 1)), [rows, summary]);

  const columns = [
    { key: 'contract_no', header: 'Contract No.' },
    { key: 'project_type', header: sourceLabel },
    { key: 'capacity_mw', header: `${capacityLabel} (MW)`, render: (r) => fmtNumber(r.capacity_mw) },
    { key: 'tariff_per_unit', header: 'Tariff (₹/unit)', render: (r) => `₹${r.tariff_per_unit}` },
    { key: 'tenure', header: 'Tenure', render: (r) => `${r.tenure_start} → ${r.tenure_end}` },
    {
      key: 'next',
      header: 'Next milestone',
      render: (r) => {
        const n = summary[r.id]?.next_milestone;
        if (!n) return <span style={{ color: 'var(--slate-500)' }}>—</span>;
        return <span>{n.label.replace(/\s*\(.*\)$/, '')}{n.due_date ? <div style={{ fontSize: 13.5, color: n.status === 'DELAYED' ? '#b91c1c' : 'var(--slate-500)' }}>{fmtDate(n.due_date)}</div> : null}</span>;
      },
    },
    {
      key: 'attention',
      header: 'Needs attention',
      render: (r) => {
        const flags = flagsOf(summary[r.id]);
        return flags.length
          ? flags.map((f) => <span key={f.text} className={`cw-flag ${f.tone}`}>{f.text}</span>)
          : <span style={{ color: 'var(--slate-500)' }}>—</span>;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />

      {attention.length > 0 && (
        <Card title="Needs your attention" style={{ marginBottom: 16 }}>
          {attention.map((f) => (
            <div key={`${f.row.id}-${f.text}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13.5 }}>
                <span className={`cw-flag ${f.tone}`}>{f.text}</span>
                <strong>{f.row.contract_no}</strong>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => open(f.row, f.tab)}>Open</button>
            </div>
          ))}
        </Card>
      )}

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {['ACTIVE', 'EXPIRED', 'TERMINATED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.project_type} onChange={(e) => setFilters({ ...filters, project_type: e.target.value })} aria-label={sourceLabel}>
          <option value="">All {sourceLabel.toLowerCase()}s</option>
          {['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'PSP', 'Storage'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={(r) => open(r)} emptyMessage={loading ? 'Loading...' : 'No contracts found.'} />
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.contract_no} width={980}>
        {selected && <ContractWorkspace key={selected.id} contract={selected} startTab={startTab} onChanged={load} />}
      </Modal>
    </div>
  );
}
