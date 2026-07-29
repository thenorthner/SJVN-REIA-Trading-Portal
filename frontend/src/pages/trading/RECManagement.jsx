import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const STATUSES = ['APPLIED', 'ISSUED', 'LISTED', 'SOLD', 'REDEEMED', 'CANCELLED'];
const POSITIONS = ['HELD', 'PARTIALLY_SOLD', 'FULLY_DISPOSED', 'NOT_ISSUED'];
const TECHNOLOGIES = ['Solar', 'Wind', 'Hydro', 'Hybrid', 'MSW', 'Cogeneration', 'Biomass', 'Biofuel'];

const POSITION_TONE = { HELD: 'primary', PARTIALLY_SOLD: 'warning', FULLY_DISPOSED: 'success', NOT_ISSUED: 'neutral', CANCELLED: 'neutral' };
const POSITION_LABEL = { HELD: 'Held', PARTIALLY_SOLD: 'Part sold', FULLY_DISPOSED: 'Cleared', NOT_ISSUED: 'Awaiting issue', CANCELLED: 'Cancelled' };

const EMPTY_LOT = {
  source: '', technology: 'Hydro', vintage_month: '', energy_mwh: '', quantity: '',
  application_date: '', issue_cost_per_rec: '', contract_id: '', notes: '',
};
const EMPTY_TXN = {
  txn_type: 'SALE', quantity: '', rate_per_rec: '', trade_date: '',
  platform: 'IEX', buyer: '', obligated_entity: '', reference: '', notes: '',
};

const today = () => new Date().toISOString().split('T')[0];

export default function RECManagement() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [reference, setReference] = useState({ multipliers: {}, next_sessions: [] });
  const [issuable, setIssuable] = useState([]);
  const [filters, setFilters] = useState({ status: '', vintage_month: '', technology: '', position: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showLot, setShowLot] = useState(false);
  const [lotForm, setLotForm] = useState(EMPTY_LOT);
  const [lotError, setLotError] = useState('');

  const [showTxn, setShowTxn] = useState(false);
  const [txnForm, setTxnForm] = useState(EMPTY_TXN);
  const [txnError, setTxnError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });

    Promise.allSettled([
      api.rec.list(params), api.rec.summary(), api.rec.reference(), api.rec.issuable(),
    ]).then(([l, s, r, i]) => {
      if (l.status === 'fulfilled') setRows(l.value || []);
      if (s.status === 'fulfilled') setSummary(s.value || {});
      if (r.status === 'fulfilled') setReference(r.value || { multipliers: {}, next_sessions: [] });
      if (i.status === 'fulfilled') setIssuable(i.value || []);
      const first = [l, s, r, i].find((x) => x.status === 'rejected');
      if (first) setError(first.reason?.response?.data?.error || 'Could not load the REC ledger.');
    }).finally(() => setLoading(false));
  }, [filters]);

  useEffect(load, [load]);

  function applyResult(updated) {
    setDetail(updated);
    setDetailError('');
    load();
  }

  async function runOnDetail(fn, fallback) {
    setBusy(true);
    setDetailError('');
    try {
      applyResult(await fn());
    } catch (err) {
      setDetailError(err.response?.data?.error || fallback);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(row) {
    try {
      setDetail(await api.rec.get(row.id));
      setDetailError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open this lot.');
    }
  }

  function openLotFrom(energyRow) {
    setLotError('');
    setLotForm(energyRow ? {
      ...EMPTY_LOT,
      source: energyRow.contract_no,
      technology: energyRow.technology,
      vintage_month: energyRow.period_month,
      energy_mwh: energyRow.energy_mwh,
      contract_id: energyRow.contract_id,
      application_date: today(),
      issue_cost_per_rec: reference.issuance_fee_per_rec ?? '',
    } : { ...EMPTY_LOT, application_date: today(), issue_cost_per_rec: reference.issuance_fee_per_rec ?? '' });
    setShowLot(true);
  }

  async function saveLot(e) {
    e.preventDefault();
    setLotError('');
    try {
      const created = await api.rec.create({
        ...lotForm,
        energy_mwh: lotForm.energy_mwh === '' ? null : Number(lotForm.energy_mwh),
        quantity: lotForm.quantity === '' ? null : Number(lotForm.quantity),
        issue_cost_per_rec: lotForm.issue_cost_per_rec === '' ? null : Number(lotForm.issue_cost_per_rec),
      });
      setShowLot(false);
      load();
      setDetail(created);
    } catch (err) {
      setLotError(err.response?.data?.error || 'Failed to create the REC lot.');
    }
  }

  function openTxn(txn_type) {
    setTxnError('');
    setTxnForm({
      ...EMPTY_TXN,
      txn_type,
      trade_date: reference.next_sessions?.[0] || today(),
      quantity: detail?.held_qty || '',
    });
    setShowTxn(true);
  }

  async function saveTxn(e) {
    e.preventDefault();
    setTxnError('');
    try {
      const updated = await api.rec.addTxn(detail.id, {
        ...txnForm,
        quantity: Number(txnForm.quantity),
        rate_per_rec: Number(txnForm.rate_per_rec) || 0,
      });
      setShowTxn(false);
      applyResult(updated);
    } catch (err) {
      setTxnError(err.response?.data?.error || 'Failed to record the transaction.');
    }
  }

  // Offsetting entry rather than erasure — the certificates that moved stay
  // on record for registry reconciliation.
  async function reverseTxn(txn) {
    const reason = window.prompt(`Reverse ${txn.txn_no} (${fmtNumber(txn.quantity, 0)} RECs)? An offsetting entry will be posted.\n\nReason:`);
    if (reason === null) return;
    runOnDetail(() => api.rec.reverseTxn(txn.id, reason), 'Failed to reverse the transaction.');
  }

  const multiplierPreview = reference.multipliers?.[lotForm.technology] ?? 1;
  const lotQtyPreview = lotForm.energy_mwh
    ? Math.floor(Number(lotForm.energy_mwh) * multiplierPreview)
    : Number(lotForm.quantity) || 0;

  const columns = [
    { key: 'rec_no', header: 'REC No.' },
    { key: 'source', header: 'Station', render: (r) => r.source || '—' },
    {
      key: 'technology',
      header: 'Tech',
      render: (r) => (r.technology
        ? <span title={`Certificate multiplier ${r.certificate_multiplier}×`}>{r.technology} <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{r.certificate_multiplier}×</span></span>
        : '—'),
    },
    { key: 'vintage_month', header: 'Vintage' },
    {
      key: 'issued_qty',
      header: 'Issued',
      render: (r) => (r.position === 'NOT_ISSUED'
        ? <span style={{ color: 'var(--text-light)' }}>{fmtNumber(r.applied_qty, 0)} applied</span>
        : fmtNumber(r.issued_qty, 0)),
    },
    { key: 'sold_qty', header: 'Sold', render: (r) => fmtNumber(r.sold_qty, 0) },
    { key: 'redeemed_qty', header: 'Redeemed', render: (r) => (r.redeemed_qty ? fmtNumber(r.redeemed_qty, 0) : '—') },
    { key: 'held_qty', header: 'Held', render: (r) => <strong>{fmtNumber(r.held_qty, 0)}</strong> },
    { key: 'avg_realisation', header: 'Avg ₹/REC', render: (r) => (r.avg_realisation ? fmtCurrency(r.avg_realisation) : '—') },
    { key: 'realised_revenue', header: 'Revenue', render: (r) => (r.realised_revenue ? fmtCurrency(r.realised_revenue) : '—') },
    {
      key: 'profit',
      header: 'Profit',
      render: (r) => (
        <span style={{ color: r.profit > 0 ? 'var(--green)' : r.profit < 0 ? 'var(--red)' : 'var(--text-light)', fontWeight: 600 }}>
          {r.profit ? fmtCurrency(r.profit) : '—'}
        </span>
      ),
    },
    {
      key: 'holding_age_days',
      header: 'Age',
      render: (r) => (r.holding_age_days == null
        ? '—'
        : <span style={{ color: r.holding_age_days > 180 ? 'var(--amber)' : 'inherit' }}>{r.holding_age_days}d</span>),
    },
    { key: 'position', header: 'Position', render: (r) => <Badge type={POSITION_TONE[r.position]}>{POSITION_LABEL[r.position] || r.position}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  const txnColumns = [
    { key: 'txn_no', header: 'Txn No.' },
    { key: 'trade_date', header: 'Date' },
    { key: 'txn_type', header: 'Type', render: (t) => <Badge type={t.txn_type === 'SALE' ? 'success' : 'primary'}>{t.txn_type}</Badge> },
    { key: 'quantity', header: 'RECs', render: (t) => fmtNumber(t.quantity, 0) },
    { key: 'rate_per_rec', header: '₹/REC', render: (t) => (t.rate_per_rec ? fmtCurrency(t.rate_per_rec) : '—') },
    { key: 'amount', header: 'Amount', render: (t) => (t.amount ? fmtCurrency(t.amount) : '—') },
    { key: 'platform', header: 'Platform', render: (t) => t.platform || '—' },
    { key: 'counterparty', header: 'Counterparty', render: (t) => t.buyer || t.obligated_entity || '—' },
    { key: 'reference', header: 'Reference', render: (t) => <span style={{ fontSize: 11.5 }}>{t.reference || '—'}</span> },
    ...(canWrite ? [{
      key: 'actions',
      header: '',
      render: (t) => <button className="btn btn-xs btn-ghost" disabled={!!t.reverses_txn_id} title={t.reverses_txn_id ? 'This is itself a reversal' : 'Post an offsetting entry'} onClick={() => reverseTxn(t)}>Reverse</button>,
    }] : []),
  ];

  const agingData = Object.entries(summary.aging || {}).map(([bucket, recs]) => ({ bucket: `${bucket} days`, recs }));
  const techData = (summary.by_technology || []).map((t) => ({ technology: t.technology, held: t.held, sold: t.sold }));

  return (
    <div>
      <PageHeader
        title="REC Management"
        subtitle="Renewable Energy Certificates — issuance against injected energy, exchange trading and RPO redemption"
        actions={canWrite && <button className="btn btn-primary" onClick={() => openLotFrom(null)}>+ New REC Lot</button>}
      />

      {error && <div className="form-error">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Certificates Issued" value={fmtNumber(summary.issued_recs || 0, 0)} hint={`${summary.total_lots || 0} lots`} />
        <StatCard
          label="Held (Unsold)"
          value={fmtNumber(summary.held_recs || 0, 0)}
          tone="blue"
          hint={summary.last_traded_rate ? `≈ ${fmtCurrency(summary.held_value_at_last_price)} at last cleared ${fmtCurrency(summary.last_traded_rate)}` : 'No trade price yet'}
        />
        <StatCard label="Sold" value={fmtNumber(summary.sold_recs || 0, 0)} tone="green" hint={`Redeemed ${fmtNumber(summary.redeemed_recs || 0, 0)} against RPO`} />
        <StatCard label="REC Revenue" value={fmtCurrency(summary.rec_revenue || 0)} hint={`Avg realisation ${fmtCurrency(summary.avg_realisation || 0)}/REC`} />
        <StatCard
          label="Realised Profit"
          value={fmtCurrency(summary.profit_from_rec || 0)}
          tone={(summary.profit_from_rec || 0) >= 0 ? 'green' : 'red'}
          hint={`Issuance cost in held stock ${fmtCurrency(summary.held_cost || 0)}`}
        />
        <StatCard
          label="Next Trading Session"
          value={summary.next_sessions?.[0] || '—'}
          hint={summary.next_sessions?.length > 1 ? `Then ${summary.next_sessions[1]}` : '2nd & last Wednesday'}
        />
      </div>

      {issuable.length > 0 && (
        <Card
          title="Ready for Issuance"
          actions={<span className="inline-note" style={{ marginTop: 0 }}>{issuable.length} vintage month(s) with unclaimed certificates</span>}
        >
          <Table
            columns={[
              { key: 'contract_no', header: 'Contract' },
              { key: 'period_month', header: 'Vintage' },
              { key: 'technology', header: 'Technology' },
              { key: 'energy_mwh', header: 'Injected (MWh)', render: (r) => fmtNumber(r.energy_mwh, 0) },
              { key: 'certificate_multiplier', header: 'Multiplier', render: (r) => `${r.certificate_multiplier}×` },
              { key: 'eligible_recs', header: 'Eligible RECs', render: (r) => fmtNumber(r.eligible_recs, 0) },
              { key: 'already_claimed', header: 'Claimed', render: (r) => fmtNumber(r.already_claimed, 0) },
              { key: 'issuable_recs', header: 'Issuable', render: (r) => <strong>{fmtNumber(r.issuable_recs, 0)}</strong> },
              ...(canWrite ? [{
                key: 'actions',
                header: '',
                render: (r) => <button className="btn btn-xs btn-primary" onClick={() => openLotFrom(r)}>Apply</button>,
              }] : []),
            ]}
            rows={issuable}
          />
          <p className="inline-note">
            One certificate per MWh injected, multiplied by the CERC certificate multiplier for the technology
            (hydro 1.5×, wind and solar 1×). Fractions carry forward to the next application.
          </p>
        </Card>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Card title="Unsold Position by Age">
          {agingData.some((d) => d.recs > 0) ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${fmtNumber(v, 0)} RECs`, 'Held']} />
                  <Bar dataKey="recs" name="Held RECs" fill="#0b5fff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No unsold certificates.</div>}
          <p className="inline-note">
            Certificates are valid until redeemed, so ageing stock carries price risk rather than an expiry date.
          </p>
        </Card>

        <Card title="Position by Technology">
          {techData.length ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={techData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                  <XAxis dataKey="technology" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [`${fmtNumber(v, 0)} RECs`, name]} />
                  <Legend />
                  <Bar dataKey="sold" name="Sold" fill="#12875a" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="held" name="Held" fill="#0b5fff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No certificates yet.</div>}
        </Card>
      </div>

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.position} onChange={(e) => setFilters({ ...filters, position: e.target.value })}>
          <option value="">All positions</option>
          {POSITIONS.map((s) => <option key={s} value={s}>{POSITION_LABEL[s]}</option>)}
        </select>
        <select value={filters.technology} onChange={(e) => setFilters({ ...filters, technology: e.target.value })}>
          <option value="">All technologies</option>
          {TECHNOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="month" value={filters.vintage_month} onChange={(e) => setFilters({ ...filters, vintage_month: e.target.value })} />
        {Object.values(filters).some(Boolean) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ status: '', vintage_month: '', technology: '', position: '' })}>Clear</button>
        )}
      </div>

      <Card title="REC Lots">
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No REC lots yet.'}
        />
      </Card>

      <Modal open={showLot} onClose={() => setShowLot(false)} title="New REC Lot" width={560}>
        {lotError && <div className="form-error">{lotError}</div>}
        <form onSubmit={saveLot}>
          <div className="form-grid">
            <Field label="Station / Source">
              <input required value={lotForm.source} placeholder="e.g. NJHPS (Nathpa Jhakri)" onChange={(e) => setLotForm({ ...lotForm, source: e.target.value })} />
            </Field>
            <Field label="Technology">
              <select value={lotForm.technology} onChange={(e) => setLotForm({ ...lotForm, technology: e.target.value })}>
                {TECHNOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Vintage Month">
              <input required type="month" value={lotForm.vintage_month} onChange={(e) => setLotForm({ ...lotForm, vintage_month: e.target.value })} />
            </Field>
            <Field label="Injected Energy (MWh)">
              <input type="number" step="0.01" min="0" value={lotForm.energy_mwh} onChange={(e) => setLotForm({ ...lotForm, energy_mwh: e.target.value })} />
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Application Date">
              <input type="date" value={lotForm.application_date} onChange={(e) => setLotForm({ ...lotForm, application_date: e.target.value })} />
            </Field>
            <Field label="Issuance Cost / REC (₹)">
              <input type="number" step="0.01" min="0" value={lotForm.issue_cost_per_rec} onChange={(e) => setLotForm({ ...lotForm, issue_cost_per_rec: e.target.value })} />
            </Field>
          </div>

          {!lotForm.energy_mwh && (
            <Field label="Quantity (RECs) — only if injected energy is unknown">
              <input type="number" min="1" value={lotForm.quantity} onChange={(e) => setLotForm({ ...lotForm, quantity: e.target.value })} />
            </Field>
          )}

          <div className="audit-alert" style={{ margin: '8px 0' }}>
            Certificates applied for: <strong>{fmtNumber(lotQtyPreview, 0)}</strong>
            {lotForm.energy_mwh ? ` = ${fmtNumber(lotForm.energy_mwh, 0)} MWh × ${multiplierPreview}× multiplier (${lotForm.technology})` : ''}
          </div>

          <Field label="Notes"><input value={lotForm.notes} onChange={(e) => setLotForm({ ...lotForm, notes: e.target.value })} /></Field>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowLot(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Lot</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.rec_no} · ${detail.source || ''}` : ''} width={1020}>
        {detail && (
          <>
            {detailError && <div className="form-error">{detailError}</div>}

            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <StatCard
                label={detail.position === 'NOT_ISSUED' ? 'Applied For' : 'Issued'}
                value={fmtNumber(detail.position === 'NOT_ISSUED' ? detail.applied_qty : detail.issued_qty, 0)}
                hint={detail.energy_mwh ? `${fmtNumber(detail.energy_mwh, 0)} MWh × ${detail.certificate_multiplier}×` : detail.status}
              />
              <StatCard label="Held" value={fmtNumber(detail.held_qty, 0)} tone="blue" hint={detail.holding_age_days != null ? `${detail.holding_age_days} days since issuance` : 'Not issued yet'} />
              <StatCard label="Realised Revenue" value={fmtCurrency(detail.realised_revenue)} hint={detail.avg_realisation ? `Avg ${fmtCurrency(detail.avg_realisation)}/REC` : 'No sales yet'} />
              <StatCard
                label="Realised Profit"
                value={fmtCurrency(detail.profit)}
                tone={detail.profit >= 0 ? 'green' : 'red'}
                hint={`Issuance cost ${fmtCurrency(detail.issue_cost_per_rec)}/REC · held ${fmtCurrency(detail.held_cost)}`}
              />
            </div>

            {detail.registry_ref && (
              <div className="audit-alert" style={{ marginBottom: 12 }}>
                Issued by the Central Agency on {detail.issuance_date} under registry reference <strong>{detail.registry_ref}</strong>.
              </div>
            )}

            {canWrite && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {!detail.issuance_date && detail.status !== 'CANCELLED' && (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => runOnDetail(() => api.rec.issue(detail.id, { issuance_date: today() }), 'Failed to record issuance.')}
                  >
                    Record Issuance
                  </button>
                )}
                {detail.held_qty > 0 && (
                  <>
                    <button className="btn btn-primary" onClick={() => openTxn('SALE')}>Sell on Exchange</button>
                    <button className="btn btn-outline" onClick={() => openTxn('REDEMPTION')}>Redeem against RPO</button>
                  </>
                )}
              </div>
            )}

            <Card title="Disposals">
              <Table columns={txnColumns} rows={detail.transactions || []} emptyMessage="Nothing sold or redeemed from this lot yet." />
              <p className="inline-note">
                Trading sessions run on the 2nd and last Wednesday of each month.
                {reference.next_sessions?.length ? ` Next: ${reference.next_sessions.slice(0, 2).join(', ')}.` : ''}
              </p>
            </Card>
          </>
        )}
      </Modal>

      <Modal
        open={showTxn}
        onClose={() => setShowTxn(false)}
        title={txnForm.txn_type === 'SALE' ? 'Sell RECs on Exchange' : 'Redeem RECs against RPO'}
        width={520}
      >
        {txnError && <div className="form-error">{txnError}</div>}
        <form onSubmit={saveTxn}>
          <div className="form-grid">
            <Field label={`Quantity (max ${fmtNumber(detail?.held_qty || 0, 0)})`}>
              <input required type="number" min="1" max={detail?.held_qty || undefined} value={txnForm.quantity} onChange={(e) => setTxnForm({ ...txnForm, quantity: e.target.value })} />
            </Field>
            <Field label="Trade Date">
              <input required type="date" value={txnForm.trade_date} onChange={(e) => setTxnForm({ ...txnForm, trade_date: e.target.value })} />
            </Field>
          </div>

          {txnForm.txn_type === 'SALE' ? (
            <>
              <div className="form-grid">
                <Field label="Cleared Price (₹/REC)">
                  <input required type="number" step="0.01" min="0.01" value={txnForm.rate_per_rec} onChange={(e) => setTxnForm({ ...txnForm, rate_per_rec: e.target.value })} />
                </Field>
                <Field label="Exchange">
                  <select value={txnForm.platform} onChange={(e) => setTxnForm({ ...txnForm, platform: e.target.value })}>
                    <option value="IEX">IEX</option>
                    <option value="PXIL">PXIL</option>
                  </select>
                </Field>
              </div>
              <Field label="Buyer"><input value={txnForm.buyer} onChange={(e) => setTxnForm({ ...txnForm, buyer: e.target.value })} /></Field>
              <p className="inline-note">
                Floor and forbearance prices were withdrawn in December 2022 — record the price the session
                actually discovered.
              </p>
            </>
          ) : (
            <Field label="Obligated Entity (whose RPO this settles)">
              <input required value={txnForm.obligated_entity} placeholder="e.g. SJVN Ltd — captive RPO FY 2026-27" onChange={(e) => setTxnForm({ ...txnForm, obligated_entity: e.target.value })} />
            </Field>
          )}

          <Field label="Reference"><input value={txnForm.reference} placeholder="Exchange trade / registry reference" onChange={(e) => setTxnForm({ ...txnForm, reference: e.target.value })} /></Field>

          {txnForm.txn_type === 'SALE' && Number(txnForm.quantity) > 0 && Number(txnForm.rate_per_rec) > 0 && (
            <div className="audit-alert" style={{ margin: '8px 0' }}>
              Consideration <strong>{fmtCurrency(Number(txnForm.quantity) * Number(txnForm.rate_per_rec))}</strong>
              {' · '}position after this trade <strong>{fmtNumber((detail?.held_qty || 0) - Number(txnForm.quantity), 0)}</strong> RECs
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowTxn(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Record {txnForm.txn_type === 'SALE' ? 'Sale' : 'Redemption'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
