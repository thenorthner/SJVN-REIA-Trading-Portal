import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const RUN_FORM = { contract_id: '', period_type: 'MONTHLY', period: '' };

function MatchIcon({ ok }) {
  return <span style={{ color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>;
}

export default function Reconciliation() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', period_type: '' });
  const [loading, setLoading] = useState(true);
  const [showRun, setShowRun] = useState(false);
  const [runForm, setRunForm] = useState(RUN_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.reconciliation.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.period_type]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  async function handleRun(e) {
    e.preventDefault();
    setError('');
    try {
      await api.reconciliation.run(runForm);
      setShowRun(false);
      setRunForm(RUN_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run reconciliation.');
    }
  }

  async function handleResolve(e) {
    e.preventDefault();
    await api.reconciliation.resolve(selected.id, notes);
    setSelected(null);
    setNotes('');
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_type', header: 'Period Type' },
    { key: 'period', header: 'Period' },
    { key: 'energy_match', header: 'Energy', render: (r) => <MatchIcon ok={!!r.energy_match} /> },
    { key: 'payment_match', header: 'Payment', render: (r) => <MatchIcon ok={!!r.payment_match} /> },
    { key: 'performance_match', header: 'Performance', render: (r) => <MatchIcon ok={!!r.performance_match} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'discrepancy_notes', header: 'Notes', render: (r) => r.discrepancy_notes || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Match metered energy, billing and payment records across monthly/quarterly/annual periods"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowRun(true)}>+ Run Reconciliation</button>}
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['OPEN', 'ASSISTED_REVIEW', 'RESOLVED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.period_type} onChange={(e) => setFilters({ ...filters, period_type: e.target.value })}>
          <option value="">All period types</option>
          {['MONTHLY', 'QUARTERLY', 'ANNUAL'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={(r) => { if (CAN_WRITE.includes(user?.role) && r.status !== 'RESOLVED') { setSelected(r); setNotes(r.discrepancy_notes || ''); } }}
          emptyMessage={loading ? 'Loading...' : 'No reconciliation records found.'}
        />
      </Card>

      <Modal open={showRun} onClose={() => setShowRun(false)} title="Run Reconciliation" width={480}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleRun}>
          <Field label="Contract">
            <select required value={runForm.contract_id} onChange={(e) => setRunForm({ ...runForm, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period Type">
              <select value={runForm.period_type} onChange={(e) => setRunForm({ ...runForm, period_type: e.target.value })}>
                {['MONTHLY', 'QUARTERLY', 'ANNUAL'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Period (e.g. 2025-06)">
              <input required placeholder="YYYY-MM" value={runForm.period} onChange={(e) => setRunForm({ ...runForm, period: e.target.value })} />
            </Field>
          </div>
          <p className="inline-note">Checks energy quantum, payment status and availability against billing records for the selected period.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowRun(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Run Check</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Resolve — ${selected?.contract_no} (${selected?.period})`} width={480}>
        {selected && (
          <form onSubmit={handleResolve}>
            <div className="detail-grid mb-0" style={{ marginBottom: 14 }}>
              <div className="detail-item"><span className="detail-label">Energy Match</span><span className="detail-value"><MatchIcon ok={!!selected.energy_match} /></span></div>
              <div className="detail-item"><span className="detail-label">Payment Match</span><span className="detail-value"><MatchIcon ok={!!selected.payment_match} /></span></div>
              <div className="detail-item"><span className="detail-label">Performance Match</span><span className="detail-value"><MatchIcon ok={!!selected.performance_match} /></span></div>
            </div>
            <Field label="Resolution Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Mark Resolved</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
