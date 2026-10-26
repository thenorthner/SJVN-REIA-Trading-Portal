import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../../datetime.js';
import ModuleGuide from '../../../components/ModuleGuide.jsx';
import { useStation, errOf } from './useStation.js';
import HydroSecurityCoverageVault3D from '../../../components/HydroSecurityCoverageVault3D.jsx';

const COVER_TONE = { COVERED: 'ACTIVE', SHORT: 'PENDING', NONE: 'REJECTED', NOT_DUE: 'DRAFT' };

const TABS = [
  { key: 'MAIN', label: 'Security Register' },
  { key: 'FYI', label: 'FYI — Reference Guide' },
];

function exportSecurityRegister(instruments, stationName) {
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Instrument Type', 'Number', 'Beneficiary', 'Issuing Bank', 'Amount', 'Available', 'Valid From', 'Valid To', 'Days Left', 'Status', 'Invoked Amount', 'Remarks'];
  const lines = instruments.map((i) => [
    i.instrument_type, i.instrument_no, i.beneficiary_name, i.issuing_bank, i.amount, i.available,
    i.valid_from, i.valid_to, i.days_to_expiry ?? '', i.effective_status, i.invoked_amount || 0, i.remarks || '',
  ].map(csvCell).join(','));
  const blob = new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `security-register-${(stationName || 'station').replace(/[^\w]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HydroSecurity({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [action, setAction] = useState(null);
  const [popup, setPopup] = useState(null);
  const [tab, setTab] = useState('MAIN');
  const [selectedInstrument, setSelectedInstrument] = useState(null);
  const [events, setEvents] = useState([]);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.security({ contract_id: stationId }).then(setData).catch((e) => setPopup({ tone: 'error', title: 'Could not load', message: errOf(e) }));
  }, [stationId]);
  useEffect(load, [load]);

  async function openInstrumentDetail(i) {
    setSelectedInstrument(i);
    api.hydroDesk.securityEvents(i.id).then(setEvents).catch(() => setEvents([]));
  }

  const expiryStats = useMemo(() => {
    const instruments = data?.instruments || [];
    const active = instruments.filter((i) => i.effective_status === 'ACTIVE');
    return {
      within15: active.filter((i) => i.days_to_expiry != null && i.days_to_expiry <= 15).length,
      within30: active.filter((i) => i.days_to_expiry != null && i.days_to_expiry > 15 && i.days_to_expiry <= 30).length,
      within60: active.filter((i) => i.days_to_expiry != null && i.days_to_expiry > 30 && i.days_to_expiry <= 60).length,
      expired: instruments.filter((i) => i.effective_status === 'EXPIRED').length,
      invokedYtd: instruments.reduce((s, i) => s + (i.invoked_amount || 0), 0),
    };
  }, [data]);

  async function add(e) {
    e.preventDefault();
    try {
      await api.hydroDesk.addSecurity({ ...form, contract_id: stationId, amount: Number(form.amount) });
      setForm(null);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'The instrument was not recorded', message: errOf(err) });
    }
  }

  async function act(e) {
    e.preventDefault();
    const { kind, instrument } = action;
    try {
      if (kind === 'invoke') {
        const r = await api.hydroDesk.invokeSecurity(instrument.id, { amount: Number(action.amount), remarks: action.remarks, invoked_on: action.invoked_on });
        setPopup({ tone: 'success', title: `${instrument.instrument_no} invoked`, message: `${fmtCurrency(action.amount)} posted to ${instrument.beneficiary_name}'s account as ${r.ledger_doc.doc_no} and set against its overdue bills.` });
      } else if (kind === 'amend') {
        await api.hydroDesk.amendSecurity(instrument.id, { amount: action.amount, valid_to: action.valid_to, remarks: action.remarks });
      } else {
        await api.hydroDesk.releaseSecurity(instrument.id, { remarks: action.remarks });
      }
      setAction(null);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Not done', message: errOf(err) });
    }
  }

  const rows = data?.rows || [];
  const instruments = data?.instruments || [];
  const stationName = stations.find((s) => s.id === stationId)?.station_name || '';

  return (
    <div>
      <PageHeader
        title="Payment Security (LC / BG)"
        subtitle={`Each beneficiary's letter of credit or guarantee against ${data?.cover_pct ?? 105}% of its average monthly billing — cover, expiry, invocation and release`}
        actions={
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {instruments.length > 0 && <button type="button" className="btn btn-outline" onClick={() => exportSecurityRegister(instruments, stationName)}>Export register (CSV)</button>}
            {canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary_name: beneficiaries[0] || '', instrument_type: 'LC', instrument_no: '', issuing_bank: '', amount: '', valid_from: '', valid_to: '', remarks: '' })}>+ Record LC / BG</button>}
          </span>
        }
      />

      <div className="nb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'Cover requirement', body: `Each beneficiary must maintain payment security worth ${data?.cover_pct ?? 105}% of its average monthly billing. The cover can be furnished as a Letter of Credit (LC), Bank Guarantee (BG), Escrow deposit, or another approved instrument.` },
          { title: 'Shortfall detection', body: 'The system automatically calculates each beneficiary\'s required cover from their average monthly billing. If live cover falls below the requirement, the beneficiary is flagged as SHORT. A reminder should be sent requesting the shortfall to be made good.' },
          { title: 'Expiry management', body: 'Instruments expiring within 15, 30, and 60 days are tracked and flagged. Contact the beneficiary well before expiry to arrange renewal or replacement. Expired instruments stop counting toward live cover.' },
          { title: 'Invocation', body: 'When a beneficiary has overdue bills, the station may invoke an active LC or BG. The invoked amount is posted to the beneficiary\'s account and clears overdue bills oldest first. The instrument\'s available amount reduces accordingly.' },
          { title: 'Release', body: 'An instrument may be released when the beneficiary\'s obligation is met, it is replaced by a new instrument, or the beneficiary has no outstanding dues. Always check outstanding dues and open disputes before releasing.' },
          { title: 'Event trail', body: 'Every action on an instrument — recording, amendment, invocation, release — is logged with timestamp, actor, and remarks. Click on an instrument row to see its full lifecycle history.' },
        ]} />
      )}

      {tab === 'MAIN' && (
        <>
          <div className="filters-bar">
            <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
            </select>
          </div>

          <HydroSecurityCoverageVault3D vertical={vertical} rows={rows} instruments={instruments} coverPct={data?.cover_pct ?? 105} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 16 }}>
            <StatCard label="Cover required" value={fmtCurrency(rows.reduce((a, r) => a + r.required, 0))} />
            <StatCard label="Live cover" value={fmtCurrency(rows.reduce((a, r) => a + r.live_cover, 0))} />
            <StatCard label="Shortfall" value={fmtCurrency(rows.reduce((a, r) => a + r.shortfall, 0))} tone={rows.some((r) => r.shortfall > 0) ? 'danger' : 'default'} />
            <StatCard label="Invoked YTD" value={fmtCurrency(expiryStats.invokedYtd)} />
          </div>

          {(expiryStats.within15 > 0 || expiryStats.within30 > 0 || expiryStats.within60 > 0 || expiryStats.expired > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              {expiryStats.within15 > 0 && <StatCard label="Expiring in 15 days" value={expiryStats.within15} tone="danger" />}
              {expiryStats.within30 > 0 && <StatCard label="Expiring in 30 days" value={expiryStats.within30} tone="amber" />}
              {expiryStats.within60 > 0 && <StatCard label="Expiring in 60 days" value={expiryStats.within60} tone="amber" />}
              {expiryStats.expired > 0 && <StatCard label="Expired" value={expiryStats.expired} tone="danger" />}
            </div>
          )}

          <Card title="Cover by beneficiary" style={{ marginBottom: 16 }}>
            <Table
              columns={[
                { key: 'beneficiary_name', header: 'Beneficiary' },
                { key: 'average_monthly_billing', header: 'Avg monthly billing', render: (r) => fmtCurrency(r.average_monthly_billing) },
                { key: 'required', header: 'Required', render: (r) => fmtCurrency(r.required) },
                { key: 'live_cover', header: 'Live cover', render: (r) => fmtCurrency(r.live_cover) },
                { key: 'shortfall', header: 'Shortfall', render: (r) => (r.shortfall > 0 ? <span style={{ color: 'var(--red-deep)', fontWeight: 600 }}>{fmtCurrency(r.shortfall)}</span> : '—') },
                { key: 'outstanding', header: 'Outstanding now', render: (r) => fmtCurrency(r.outstanding) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={COVER_TONE[r.status]} label={r.status.replace('_', ' ')} /> },
              ]}
              rows={rows.map((r) => ({ ...r, id: r.beneficiary_name }))}
              emptyMessage="No beneficiary account on this station yet."
            />
          </Card>
          <Card title="Instruments">
            <Table
              onRowClick={openInstrumentDetail}
              columns={[
                { key: 'instrument_no', header: 'Instrument', render: (i) => <><strong>{i.instrument_type}</strong> {i.instrument_no}<div style={{ fontSize: 15, color: 'var(--text-muted)' }}>{i.issuing_bank}</div></> },
                { key: 'beneficiary_name', header: 'Beneficiary' },
                { key: 'amount', header: 'Amount', render: (i) => fmtCurrency(i.amount) },
                { key: 'available', header: 'Available', render: (i) => fmtCurrency(i.available) },
                { key: 'valid', header: 'Valid', render: (i) => <span style={{ color: i.expiring_soon ? 'var(--red-deep)' : undefined }}>{fmtDate(i.valid_from)} – {fmtDate(i.valid_to)}{i.expiring_soon ? ` (${i.days_to_expiry} days left)` : ''}</span> },
                { key: 'status', header: 'Status', render: (i) => <Badge status={i.effective_status === 'ACTIVE' ? 'ACTIVE' : i.effective_status === 'EXPIRED' ? 'REJECTED' : 'DRAFT'} label={i.effective_status} /> },
                { key: 'actions', header: '', render: (i) => (canWrite && i.status === 'ACTIVE' ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    {i.effective_status === 'ACTIVE' && <button type="button" className="btn btn-xs btn-danger" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'invoke', instrument: i, amount: '', remarks: '', invoked_on: new Date().toISOString().slice(0, 10) }); }}>Invoke</button>}
                    <button type="button" className="btn btn-xs btn-outline" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'amend', instrument: i, amount: i.amount, valid_to: i.valid_to, remarks: '' }); }}>Renew / amend</button>
                    <button type="button" className="btn btn-xs btn-outline" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'release', instrument: i, remarks: '' }); }}>Release</button>
                  </span>
                ) : null) },
              ]}
              rows={instruments}
              emptyMessage="No LC or BG recorded on this station."
            />
          </Card>
        </>
      )}

      {/* ── Instrument detail & event trail ── */}
      <Modal open={!!selectedInstrument} onClose={() => setSelectedInstrument(null)} title={selectedInstrument ? `${selectedInstrument.instrument_type} ${selectedInstrument.instrument_no}` : ''} width={720}>
        {selectedInstrument && (
          <div>
            <table className="detail-table"><tbody>
              <tr><td>Beneficiary</td><td>{selectedInstrument.beneficiary_name}</td></tr>
              <tr><td>Issuing bank</td><td>{selectedInstrument.issuing_bank}</td></tr>
              <tr><td>Amount</td><td>{fmtCurrency(selectedInstrument.amount)}</td></tr>
              <tr><td>Available</td><td>{fmtCurrency(selectedInstrument.available)}</td></tr>
              <tr><td>Invoked</td><td>{fmtCurrency(selectedInstrument.invoked_amount || 0)}</td></tr>
              <tr><td>Valid</td><td>{fmtDate(selectedInstrument.valid_from)} – {fmtDate(selectedInstrument.valid_to)}{selectedInstrument.days_to_expiry != null ? ` (${selectedInstrument.days_to_expiry} days left)` : ''}</td></tr>
              <tr><td>Status</td><td><Badge status={selectedInstrument.effective_status === 'ACTIVE' ? 'ACTIVE' : selectedInstrument.effective_status === 'EXPIRED' ? 'REJECTED' : 'DRAFT'} label={selectedInstrument.effective_status} /></td></tr>
              {selectedInstrument.remarks && <tr><td>Remarks</td><td>{selectedInstrument.remarks}</td></tr>}
            </tbody></table>

            <h4 style={{ margin: '18px 0 8px' }}>Event trail</h4>
            {events.length === 0 && <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>No events recorded.</p>}
            <Table
              columns={[
                { key: 'created_at', header: 'When', render: (e) => fmtDateTime(e.created_at) },
                { key: 'action', header: 'Action', render: (e) => e.action?.replace(/_/g, ' ') || '—' },
                { key: 'amount', header: 'Amount', render: (e) => e.amount ? fmtCurrency(e.amount) : '' },
                { key: 'actor', header: 'By', render: (e) => e.actor_name || e.actor || '—' },
                { key: 'remarks', header: 'Remarks' },
              ]}
              rows={events}
            />
          </div>
        )}
      </Modal>

      {/* ── Record new instrument ── */}
      <Modal open={!!form} onClose={() => setForm(null)} title="Record a letter of credit / guarantee" width={720}>
        {form && (
          <form onSubmit={add}>
            <div className="form-grid">
              <Field label="Beneficiary" required>
                <select value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })}>
                  {beneficiaries.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Instrument" required>
                <select value={form.instrument_type} onChange={(e) => setForm({ ...form, instrument_type: e.target.value })}>
                  <option value="LC">Letter of Credit</option>
                  <option value="BG">Bank Guarantee</option>
                  <option value="ESCROW">Escrow</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Instrument number" required><input required value={form.instrument_no} onChange={(e) => setForm({ ...form, instrument_no: e.target.value })} /></Field>
              <Field label="Issuing bank" required><input required value={form.issuing_bank} onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })} /></Field>
              <Field label="Amount (₹)" required><input required type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Valid from" required><input required type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
              <Field label="Valid to" required><input required type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></Field>
            </div>
            <Field label="Remarks"><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Record</button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Invoke / amend / release ── */}
      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `${action.kind === 'invoke' ? 'Invoke' : action.kind === 'amend' ? 'Renew / amend' : 'Release'} ${action.instrument.instrument_no}` : ''} width={540}>
        {action && (
          <form onSubmit={act}>
            {action.kind === 'invoke' && (
              <>
                <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 0 }}>
                  Up to {fmtCurrency(action.instrument.available)} can be invoked, against {action.instrument.beneficiary_name}'s overdue bills only. The amount is posted to its account and clears them oldest first.
                </p>
                <Field label="Amount to invoke (₹)" required><input required type="number" min="1" value={action.amount} onChange={(e) => setAction({ ...action, amount: e.target.value })} /></Field>
                <Field label="Date the bank honoured it" required><input required type="date" value={action.invoked_on} onChange={(e) => setAction({ ...action, invoked_on: e.target.value })} /></Field>
              </>
            )}
            {action.kind === 'amend' && (
              <div className="form-grid">
                <Field label="Amount (₹)"><input type="number" value={action.amount} onChange={(e) => setAction({ ...action, amount: e.target.value })} /></Field>
                <Field label="Valid to"><input type="date" value={action.valid_to} onChange={(e) => setAction({ ...action, valid_to: e.target.value })} /></Field>
              </div>
            )}
            {action.kind === 'release' && (
              <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 0 }}>
                Releasing this instrument removes it from {action.instrument.beneficiary_name}'s live cover. Ensure there are no outstanding dues or open disputes before releasing.
              </p>
            )}
            <Field label="Remarks" required={action.kind !== 'amend'}><textarea rows={2} value={action.remarks} onChange={(e) => setAction({ ...action, remarks: e.target.value })} /></Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAction(null)}>Cancel</button>
              <button type="submit" className={action.kind === 'invoke' ? 'btn btn-danger' : 'btn btn-primary'}>Confirm</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
