import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';
import { useStation, errOf } from './useStation.js';

// The letters of credit and guarantees each beneficiary keeps as payment
// security: what it should hold (a % of its average monthly billing), what is
// live, what expires soon, and invocation against overdue bills — which goes
// straight onto the beneficiary's account as money received.

const COVER_TONE = { COVERED: 'ACTIVE', SHORT: 'PENDING', NONE: 'REJECTED', NOT_DUE: 'DRAFT' };

export default function HydroSecurity({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [action, setAction] = useState(null); // { kind: 'invoke'|'amend'|'release', instrument, ... }
  const [popup, setPopup] = useState(null);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.security({ contract_id: stationId }).then(setData).catch((e) => setPopup({ tone: 'error', title: 'Could not load', message: errOf(e) }));
  }, [stationId]);
  useEffect(load, [load]);

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

  return (
    <div>
      <PageHeader
        title="Payment Security (LC / BG)"
        subtitle={`Each beneficiary's letter of credit or guarantee against ${data?.cover_pct ?? 105}% of its average monthly billing — cover, expiry, invocation and release`}
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary_name: beneficiaries[0] || '', instrument_type: 'LC', instrument_no: '', issuing_bank: '', amount: '', valid_from: '', valid_to: '', remarks: '' })}>+ Record LC / BG</button>}
      />
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Cover required" value={fmtCurrency(rows.reduce((a, r) => a + r.required, 0))} />
        <StatCard label="Live cover" value={fmtCurrency(rows.reduce((a, r) => a + r.live_cover, 0))} />
        <StatCard label="Shortfall" value={fmtCurrency(rows.reduce((a, r) => a + r.shortfall, 0))} tone={rows.some((r) => r.shortfall > 0) ? 'danger' : 'default'} />
        <StatCard label="Expiring within 30 days" value={instruments.filter((i) => i.expiring_soon).length} tone={instruments.some((i) => i.expiring_soon) ? 'danger' : 'default'} />
      </div>
      <Card title="Cover by beneficiary" style={{ marginBottom: 16 }}>
        <Table
          columns={[
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'average_monthly_billing', header: 'Avg monthly billing', render: (r) => fmtCurrency(r.average_monthly_billing) },
            { key: 'required', header: 'Required', render: (r) => fmtCurrency(r.required) },
            { key: 'live_cover', header: 'Live cover', render: (r) => fmtCurrency(r.live_cover) },
            { key: 'shortfall', header: 'Shortfall', render: (r) => (r.shortfall > 0 ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{fmtCurrency(r.shortfall)}</span> : '—') },
            { key: 'outstanding', header: 'Outstanding now', render: (r) => fmtCurrency(r.outstanding) },
            { key: 'status', header: 'Status', render: (r) => <Badge status={COVER_TONE[r.status]} label={r.status.replace('_', ' ')} /> },
          ]}
          rows={rows.map((r) => ({ ...r, id: r.beneficiary_name }))}
          emptyMessage="No beneficiary account on this station yet."
        />
      </Card>
      <Card title="Instruments">
        <Table
          columns={[
            { key: 'instrument_no', header: 'Instrument', render: (i) => <><strong>{i.instrument_type}</strong> {i.instrument_no}<div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.issuing_bank}</div></> },
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'amount', header: 'Amount', render: (i) => fmtCurrency(i.amount) },
            { key: 'available', header: 'Available', render: (i) => fmtCurrency(i.available) },
            { key: 'valid', header: 'Valid', render: (i) => <span style={{ color: i.expiring_soon ? '#b91c1c' : undefined }}>{fmtDate(i.valid_from)} – {fmtDate(i.valid_to)}{i.expiring_soon ? ` (${i.days_to_expiry} days left)` : ''}</span> },
            { key: 'status', header: 'Status', render: (i) => <Badge status={i.effective_status === 'ACTIVE' ? 'ACTIVE' : i.effective_status === 'EXPIRED' ? 'REJECTED' : 'DRAFT'} label={i.effective_status} /> },
            { key: 'actions', header: '', render: (i) => (canWrite && i.status === 'ACTIVE' ? (
              <span style={{ display: 'flex', gap: 6 }}>
                {i.effective_status === 'ACTIVE' && <button type="button" className="btn btn-xs btn-danger" onClick={() => setAction({ kind: 'invoke', instrument: i, amount: '', remarks: '', invoked_on: new Date().toISOString().slice(0, 10) })}>Invoke</button>}
                <button type="button" className="btn btn-xs btn-outline" onClick={() => setAction({ kind: 'amend', instrument: i, amount: i.amount, valid_to: i.valid_to, remarks: '' })}>Renew / amend</button>
                <button type="button" className="btn btn-xs btn-outline" onClick={() => setAction({ kind: 'release', instrument: i, remarks: '' })}>Release</button>
              </span>
            ) : null) },
          ]}
          rows={instruments}
          emptyMessage="No LC or BG recorded on this station."
        />
      </Card>

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

      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `${action.kind === 'invoke' ? 'Invoke' : action.kind === 'amend' ? 'Renew / amend' : 'Release'} ${action.instrument.instrument_no}` : ''} width={540}>
        {action && (
          <form onSubmit={act}>
            {action.kind === 'invoke' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
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
