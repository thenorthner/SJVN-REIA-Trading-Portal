import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, DemandLetterViewer } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER'];
const EMPTY_FORM = {
  contract_id: '', mechanism_type: 'LC', bg_subtype: '', limit_amount: '', issuing_bank: '',
  beneficiary: 'SJVN Limited', validity_start: '', validity_end: '', is_revolving: true, remarks: '',
};

function StatPill({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-2, #f6f7f9)', borderRadius: 8, minWidth: 110 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, opacity: 0.65 }}>{sub}</div>}
    </div>
  );
}

export default function PaymentSecurity() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [releases, setReleases] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [invocations, setInvocations] = useState([]);
  const [filters, setFilters] = useState({ status: '', mechanism_type: '', bg_subtype: '', expiring_days: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState(null);
  const [actionValue, setActionValue] = useState('');
  const [invokeForm, setInvokeForm] = useState({ contract_id: '', amount: '' });

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    Promise.all([
      api.paymentSecurity.list(params),
      api.paymentSecurity.stats().catch(() => null),
      api.paymentSecurity.releases().catch(() => []),
      api.paymentSecurity.overrides().catch(() => []),
      api.paymentSecurity.invocations().catch(() => []),
    ]).then(([list, s, rel, ov, inv]) => {
      setRows(list);
      setStats(s);
      setReleases(rel || []);
      setOverrides(ov || []);
      setInvocations(inv || []);
    }).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.mechanism_type, filters.bg_subtype, filters.expiring_days]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  async function openDetail(row) {
    setDetail(await api.paymentSecurity.get(row.id));
    setAction(null);
    setActionValue('');
  }

  async function refreshDetail() {
    if (!detail) return;
    setDetail(await api.paymentSecurity.get(detail.id));
    load();
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.paymentSecurity.create({
        ...form,
        limit_amount: Number(form.limit_amount),
        bg_subtype: form.mechanism_type === 'BANK_GUARANTEE' ? form.bg_subtype || 'OTHER_BG' : null,
        is_revolving: form.mechanism_type === 'LC' ? !!form.is_revolving : false,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create instrument.');
    }
  }

  async function submitAction(e) {
    e.preventDefault();
    if (!detail || !action) return;
    if (action === 'renew') await api.paymentSecurity.renew(detail.id, { validity_end: actionValue });
    else if (action === 'utilize') await api.paymentSecurity.utilize(detail.id, Number(actionValue));
    else if (action === 'replenish') await api.paymentSecurity.replenish(detail.id, Number(actionValue));
    else if (action === 'verify') await api.paymentSecurity.verify(detail.id, actionValue);
    else if (action === 'release') await api.paymentSecurity.releaseRequest(detail.id, actionValue || 'Release requested');
    setAction(null);
    await refreshDetail();
  }

  async function handleInvokeWaterfall(e) {
    e.preventDefault();
    setError('');
    try {
      await api.paymentSecurity.startInvocation({
        contract_id: invokeForm.contract_id,
        amount: invokeForm.amount ? Number(invokeForm.amount) : undefined,
      });
      setInvokeForm({ contract_id: '', amount: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Invocation failed');
    }
  }

  async function transitionInv(id, status) {
    await api.paymentSecurity.transitionInvocation(id, status);
    load();
    if (detail) await refreshDetail();
  }

  async function actRelease(id, decision) {
    await api.paymentSecurity.actRelease(id, decision);
    load();
  }

  const columns = [
    { key: 'instrument_no', header: 'Instrument' },
    { key: 'contract_no', header: 'Contract' },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <span>{r.mechanism_type}{r.bg_subtype ? `/${r.bg_subtype}` : ''}{r.is_revolving ? ' · Rev' : ''}</span>
      ),
    },
    { key: 'limit_amount', header: 'Limit', render: (r) => fmtCurrency(r.limit_amount ?? r.amount) },
    { key: 'available_amount', header: 'Available', render: (r) => fmtCurrency(r.available_amount) },
    {
      key: 'coverage',
      header: 'Coverage',
      render: (r) => (
        <span style={{ color: (r.coverage_ratio || 0) < 1 ? 'var(--danger, #b91c1c)' : undefined }}>
          {r.coverage_ratio != null ? r.coverage_ratio.toFixed(2) : '—'}
        </span>
      ),
    },
    {
      key: 'validity_end',
      header: 'Expiry',
      render: (r) => (
        <span>
          {r.validity_end || '—'}
          {r.days_to_expiry != null && r.days_to_expiry <= 30 && (
            <span style={{ marginLeft: 6, fontSize: 11, color: '#b45309' }}>{r.days_to_expiry}d</span>
          )}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Payment Security"
        subtitle="Revolving LC, bank guarantees, corpus waterfall, coverage & invocation control"
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            {CAN_WRITE.includes(user?.role) && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => api.paymentSecurity.runAlerts().then(load)}>Run Alerts</button>
                <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Instrument</button>
              </>
            )}
          </div>
        )}
      />

      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <StatPill label="Total security" value={fmtCurrency(stats.total_security_value)} sub={`${stats.instrument_count} active`} />
          <StatPill label="Avg coverage" value={stats.avg_coverage_ratio?.toFixed(2) ?? '—'} />
          <StatPill label="Shortfalls" value={stats.shortfall_count} sub="coverage < 1" />
          <StatPill label="Expiring 30/60/90" value={`${stats.expiring?.[30] ?? 0} / ${stats.expiring?.[60] ?? 0} / ${stats.expiring?.[90] ?? 0}`} />
          <StatPill label="Invocations" value={stats.invocation_ytd_count} sub={fmtCurrency(stats.invocation_ytd_amount)} />
        </div>
      )}

      {stats?.weak_entities?.length > 0 && (
        <Card title="Coverage shortfall" className="mb-3">
          <Table
            columns={[
              { key: 'contract_no', header: 'Contract' },
              { key: 'entity_name', header: 'Buyer' },
              { key: 'coverage_ratio', header: 'Ratio', render: (r) => r.coverage_ratio?.toFixed(3) },
              { key: 'shortfall', header: 'Shortfall', render: (r) => fmtCurrency(r.shortfall) },
              { key: 'available_security', header: 'Available', render: (r) => fmtCurrency(r.available_security) },
            ]}
            rows={stats.weak_entities}
          />
        </Card>
      )}

      <div className="filters-bar">
        <select value={filters.mechanism_type} onChange={(e) => setFilters({ ...filters, mechanism_type: e.target.value, bg_subtype: '' })}>
          <option value="">All types</option>
          <option value="LC">LC</option>
          <option value="BANK_GUARANTEE">Bank Guarantee</option>
          <option value="CORPUS_FUND">Corpus</option>
          <option value="PAYMENT_SECURITY_FUND">PSF</option>
        </select>
        {filters.mechanism_type === 'BANK_GUARANTEE' && (
          <select value={filters.bg_subtype} onChange={(e) => setFilters({ ...filters, bg_subtype: e.target.value })}>
            <option value="">All BG subtypes</option>
            <option value="EMD">EMD</option>
            <option value="PBG">PBG</option>
            <option value="OTHER_BG">Other</option>
          </select>
        )}
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['ACTIVE', 'PARTIALLY_UTILIZED', 'INVOKED', 'EXPIRED', 'RENEWED', 'RELEASE_PENDING', 'RELEASED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filters.expiring_days} onChange={(e) => setFilters({ ...filters, expiring_days: e.target.value })}>
          <option value="">Any expiry</option>
          <option value="15">≤ 15 days</option>
          <option value="30">≤ 30 days</option>
          <option value="60">≤ 60 days</option>
        </select>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No instruments found.'}
        />
      </Card>

      {CAN_WRITE.includes(user?.role) && (
        <Card title="Start waterfall invocation" className="mt-3">
          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleInvokeWaterfall} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label="Contract">
              <select required value={invokeForm.contract_id} onChange={(e) => setInvokeForm({ ...invokeForm, contract_id: e.target.value })}>
                <option value="">Select PSA/PPA...</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
              </select>
            </Field>
            <Field label="Amount (optional)">
              <input type="number" value={invokeForm.amount} onChange={(e) => setInvokeForm({ ...invokeForm, amount: e.target.value })} />
            </Field>
            <button type="submit" className="btn btn-danger">Invoke waterfall</button>
          </form>
        </Card>
      )}

      {invocations.length > 0 && (
        <Card title="Invocation tracker" className="mt-3">
          <Table
            columns={[
              { key: 'invocation_no', header: 'No.' },
              { key: 'contract_no', header: 'Contract' },
              { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
              {
                key: 'actions',
                header: 'Advance',
                render: (r) => CAN_WRITE.includes(user?.role) && r.status !== 'FUNDS_RECEIVED' && r.status !== 'REJECTED' && (
                  <div className="cell-actions">
                    {r.status === 'ELIGIBLE' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => transitionInv(r.id, 'NOTICE_ISSUED')}>Notice</button>}
                    {r.status === 'NOTICE_ISSUED' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => transitionInv(r.id, 'CLAIMED')}>Claimed</button>}
                    {r.status === 'CLAIMED' && <button type="button" className="btn btn-primary btn-sm" onClick={() => transitionInv(r.id, 'FUNDS_RECEIVED')}>Funds in</button>}
                  </div>
                ),
              },
            ]}
            rows={invocations.slice(0, 12)}
          />
        </Card>
      )}

      {(releases.some((r) => r.status === 'PENDING') || overrides.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Card title="Release queue">
            <Table
              columns={[
                { key: 'instrument_no', header: 'Instrument' },
                { key: 'contract_no', header: 'Contract' },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
                {
                  key: 'act',
                  header: '',
                  render: (r) => r.status === 'PENDING' && CAN_WRITE.includes(user?.role) && (
                    <div className="cell-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => actRelease(r.id, 'APPROVED')}>Release</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => actRelease(r.id, 'REJECTED')}>Reject</button>
                    </div>
                  ),
                },
              ]}
              rows={releases.filter((r) => r.status === 'PENDING')}
              emptyMessage="No pending releases."
            />
          </Card>
          <Card title="Adequacy overrides">
            <Table
              columns={[
                { key: 'contract_no', header: 'Contract' },
                { key: 'reason', header: 'Reason' },
                { key: 'approved_by', header: 'By' },
                { key: 'valid_until', header: 'Until' },
              ]}
              rows={overrides.slice(0, 8)}
              emptyMessage="No overrides."
            />
          </Card>
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add payment security" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Mechanism">
              <select value={form.mechanism_type} onChange={(e) => setForm({ ...form, mechanism_type: e.target.value })}>
                {['LC', 'BANK_GUARANTEE', 'CORPUS_FUND', 'PAYMENT_SECURITY_FUND', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            {form.mechanism_type === 'BANK_GUARANTEE' && (
              <Field label="BG subtype">
                <select value={form.bg_subtype} onChange={(e) => setForm({ ...form, bg_subtype: e.target.value })}>
                  {['EMD', 'PBG', 'OTHER_BG'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )}
            <Field label="Limit (₹)">
              <input required type="number" value={form.limit_amount} onChange={(e) => setForm({ ...form, limit_amount: e.target.value })} />
            </Field>
            <Field label="Issuing bank">
              <input value={form.issuing_bank} onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })} />
            </Field>
            <Field label="Validity start">
              <input required type="date" value={form.validity_start} onChange={(e) => setForm({ ...form, validity_start: e.target.value })} />
            </Field>
            <Field label="Validity end">
              <input required type="date" value={form.validity_end} onChange={(e) => setForm({ ...form, validity_end: e.target.value })} />
            </Field>
          </div>
          {form.mechanism_type === 'LC' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
              <input type="checkbox" checked={form.is_revolving} onChange={(e) => setForm({ ...form, is_revolving: e.target.checked })} />
              Revolving LC
            </label>
          )}
          <Field label="Remarks">
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.instrument_no || 'Instrument'} width={720}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{detail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{detail.mechanism_type}{detail.bg_subtype ? ` / ${detail.bg_subtype}` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Limit</span><span className="detail-value">{fmtCurrency(detail.limit_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Utilized</span><span className="detail-value">{fmtCurrency(detail.utilized_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Available</span><span className="detail-value">{fmtCurrency(detail.available_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Required</span><span className="detail-value">{fmtCurrency(detail.required_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Waterfall #</span><span className="detail-value">{detail.waterfall_priority}</span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Coverage</span><span className="detail-value">{detail.coverage?.coverage_ratio?.toFixed(3)} (shortfall {fmtCurrency(detail.coverage?.shortfall)})</span></div>
              <div className="detail-item"><span className="detail-label">Bank confirm</span><span className="detail-value">{detail.bank_confirmation_ref || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Validity</span><span className="detail-value">{detail.validity_start} → {detail.validity_end}</span></div>
              <div className="detail-item"><span className="detail-label">Revolving</span><span className="detail-value">{detail.is_revolving ? 'Yes' : 'No'}</span></div>
            </div>

            {CAN_WRITE.includes(user?.role) && (
              <div className="cell-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAction('utilize'); setActionValue(''); }}>Utilize</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAction('replenish'); setActionValue(''); }}>Replenish</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAction('renew'); setActionValue(detail.validity_end || ''); }}>Renew</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAction('verify'); setActionValue(''); }}>Verify</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAction('release'); setActionValue('Contract completion release'); }}>Request release</button>
              </div>
            )}

            {action && (
              <form onSubmit={submitAction} style={{ marginTop: 12 }}>
                <Field label={action === 'renew' ? 'New validity end' : action === 'verify' ? 'Bank confirmation ref' : action === 'release' ? 'Reason' : 'Amount (₹)'}>
                  {action === 'renew' ? (
                    <input required type="date" value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
                  ) : (
                    <input required value={actionValue} onChange={(e) => setActionValue(e.target.value)} type={['utilize', 'replenish'].includes(action) ? 'number' : 'text'} />
                  )}
                </Field>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setAction(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Confirm</button>
                </div>
              </form>
            )}

            {detail.requirements?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>Contract requirements</div>
                <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                  {detail.requirements.map((r) => (
                    <li key={r.id}>{r.mechanism_type}{r.bg_subtype ? `/${r.bg_subtype}` : ''} — min {fmtCurrency(r.min_amount)}, priority {r.waterfall_priority}</li>
                  ))}
                </ul>
              </>
            )}

            {detail.invocations?.[0]?.demand_letter_json && (
              <DemandLetterViewer letterStr={detail.invocations[0].demand_letter_json} />
            )}

            <DocumentManager 
              moduleName="PAYMENT_SECURITY"
              entityId={detail.entity_id} 
              contractId={detail.contract_id} 
              title="Payment Security Documents" 
            />

            {detail.events?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>Lifecycle events</div>
                <div className="timeline">
                  {detail.events.slice().reverse().slice(0, 12).map((ev) => (
                    <div className="timeline-item" key={ev.id}>
                      <strong>{ev.event_type}</strong> — {ev.actor_name}
                      <div className="t-meta">{ev.created_at}</div>
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
