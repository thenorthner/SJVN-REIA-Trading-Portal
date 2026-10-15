import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { Card, Field, Table, StatCard, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ThermalCoalToBusbarECR3D from '../../components/ThermalCoalToBusbarECR3D.jsx';
import ThermalCapacityRecoveryGate3D from '../../components/ThermalCapacityRecoveryGate3D.jsx';

// Raising a thermal station's monthly bill. The tariff (AFC, NAPAF and the
// norms) is the financial year's, set under Station & Tariff; what the desk
// enters here is the month: availability, scheduled energy and the fuel.

const thisMonth = () => new Date().toISOString().slice(0, 7);
const EMPTY = {
  billing_month: thisMonth(), bill_kind: 'PROVISIONAL', revision_reason: '',
  ex_bus_scheduled_kwh: '', pafm_percent: '', gcv_kcal_per_kg: '', coal_rs_per_tonne: '', oil_rs_per_kl: '',
  nrldc_total_fee: '', rea_reference: '',
};

export function ThermalBillSummary({ bill, lines }) {
  const t = typeof bill.thermal_inputs_json === 'string' ? JSON.parse(bill.thermal_inputs_json || '{}') : (bill.thermal_inputs || {});
  return (
    <div>
      <ThermalCapacityRecoveryGate3D bill={bill} />
      <div className="stat-grid">
        <StatCard label="Capacity charge" value={fmtCurrency(bill.c5_total_capacity_charge)} hint={`PAFM ${bill.c1_pafm_pct}% / NAPAF ${bill.a11_napaf_pct}%`} />
        <StatCard label="Energy charge" value={fmtCurrency(bill.ee1_energy_charge)} hint={`${fmtNumber(bill.e1_ex_bus_scheduled_kwh / 1e6, 3)} MU × ₹${bill.a12_ecr}/kWh`} />
        <StatCard label="Total" value={fmtCurrency(bill.total_charges)} tone="primary" />
      </div>
      <table className="detail-table" style={{ marginBottom: 12 }}><tbody>
        <tr><td>Tariff ({t.tariff?.financial_year})</td><td>AFC {fmtCurrency(t.tariff?.annual_afc)} · NAPAF {t.tariff?.napaf_percent}% · GHR {t.tariff?.gross_heat_rate} kCal/kWh · AUX {t.tariff?.aux_pct}% · SFC {t.tariff?.sfc_ml_per_kwh} ml/kWh</td></tr>
        <tr><td>Fuel for the month</td><td>GCV {t.fuel?.gcv_kcal_per_kg} kCal/kg · coal {fmtCurrency(t.fuel?.coal_rs_per_tonne)}/t · oil {fmtCurrency(t.fuel?.oil_rs_per_kl)}/kL</td></tr>
        <tr><td>Energy charge rate</td><td><strong>₹{bill.a12_ecr}/kWh</strong></td></tr>
        <tr><td>Capacity charge</td><td>{t.capacity_formula}</td></tr>
        {t.not_modelled && <tr><td>Note</td><td style={{ fontSize: 13.5 }}>{t.not_modelled}</td></tr>}
      </tbody></table>
      <Table
        columns={[
          { key: 'beneficiary_name', header: 'Beneficiary' },
          { key: 'pct_proportionate', header: 'Share %', render: (l) => Number(l.pct_proportionate).toFixed(4) },
          { key: 'capacity_charge', header: 'Capacity charge', render: (l) => fmtCurrency(l.capacity_charge) },
          { key: 'saleable_energy_kwh', header: 'Energy (kWh)', render: (l) => fmtNumber(l.saleable_energy_kwh) },
          { key: 'energy_charge_total', header: 'Energy charge', render: (l) => fmtCurrency(l.energy_charge_total) },
          { key: 'total_charges', header: 'Total', render: (l) => <strong>{fmtCurrency(l.total_charges)}</strong> },
        ]}
        rows={(lines || []).map((l, i) => ({ ...l, id: l.id || `${l.beneficiary_name}-${i}` }))}
      />
    </div>
  );
}

export function ThermalBillForm({ station, stationId, canWrite, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(null);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setPreview(null); };

  function problems() {
    const p = [];
    if (!(Number(form.ex_bus_scheduled_kwh) >= 0) || form.ex_bus_scheduled_kwh === '') p.push({ label: 'Scheduled energy', message: 'Enter the ex-bus scheduled energy for the month in kWh (from the REA).' });
    if (form.pafm_percent === '' || !(Number(form.pafm_percent) >= 0 && Number(form.pafm_percent) <= 110)) p.push({ label: 'PAFM', message: 'Enter the plant availability achieved in the month, 0 to 110%.' });
    if (!(Number(form.gcv_kcal_per_kg) > 0)) p.push({ label: 'GCV of coal', message: 'Enter the GCV of coal for the month in kCal/kg.' });
    if (!(Number(form.coal_rs_per_tonne) > 0)) p.push({ label: 'Landed price of coal', message: 'Enter the landed price of coal in ₹/tonne.' });
    if (form.bill_kind === 'REVISION' && form.revision_reason.trim().length < 5) p.push({ label: 'Revision', message: 'Say what changed.' });
    return p;
  }

  async function doPreview(e) {
    e.preventDefault();
    const p = problems();
    if (p.length) { setPopup({ tone: 'error', title: 'The bill cannot be computed yet', items: p }); return; }
    setBusy(true);
    try {
      setPreview(await api.hydroBilling.preview({ contract_id: stationId, ...form }));
    } catch (err) {
      setPopup({ tone: 'error', title: 'The bill could not be computed', message: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api.hydroBilling.create({ contract_id: stationId, ...form });
      setPreview(null);
      setForm({ ...EMPTY, billing_month: form.billing_month });
      onSaved?.();
      setPopup({ tone: 'success', title: `${r.bill_no} saved as a draft`, message: `${fmtCurrency(r.total_charges)} across ${r.lines.length} beneficiaries. Send it for approval from the list above.` });
    } catch (err) {
      setPopup({ tone: 'error', title: 'The bill was not saved', message: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Raise the monthly bill">
      {station && !station.ready && (
        <div className="ps-alert amber" style={{ marginBottom: 12 }}>
          Not ready to bill: {station.missing?.join(', ')}. Set it up under <Link to="/thermal/stations">Station &amp; Tariff</Link>; the beneficiary allocation is entered below.
        </div>
      )}

      <ThermalCoalToBusbarECR3D station={station} fuel={form} tariff={station} bill={preview?.bill} />

      <form onSubmit={doPreview} noValidate>
        <div className="form-grid">
          <Field label="Billing month" required><input type="month" value={form.billing_month} onChange={set('billing_month')} /></Field>
          <Field label="Bill kind">
            <select value={form.bill_kind} onChange={set('bill_kind')}>
              <option value="PROVISIONAL">Provisional — on the provisional REA</option>
              <option value="FINAL">Final — on the final REA</option>
              <option value="REVISION">Revision — restating a billed month</option>
            </select>
          </Field>
          <Field label="Ex-bus scheduled energy (kWh)" required><input type="number" min="0" value={form.ex_bus_scheduled_kwh} onChange={set('ex_bus_scheduled_kwh')} /></Field>
          <Field label="PAFM achieved (%)" required><input type="number" step="0.01" min="0" max="110" value={form.pafm_percent} onChange={set('pafm_percent')} /></Field>
          <Field label="GCV of coal (kCal/kg)" required><input type="number" min="0" value={form.gcv_kcal_per_kg} onChange={set('gcv_kcal_per_kg')} /></Field>
          <Field label="Landed price of coal (₹/tonne)" required><input type="number" min="0" value={form.coal_rs_per_tonne} onChange={set('coal_rs_per_tonne')} /></Field>
          <Field label="Landed price of secondary oil (₹/kL)"><input type="number" min="0" value={form.oil_rs_per_kl} onChange={set('oil_rs_per_kl')} /></Field>
          <Field label="RLDC fees for the month (₹)"><input type="number" min="0" value={form.nrldc_total_fee} onChange={set('nrldc_total_fee')} /></Field>
          <Field label="REA reference"><input value={form.rea_reference} onChange={set('rea_reference')} placeholder="e.g. ERPC Provisional REA 09/2026" /></Field>
          {form.bill_kind === 'REVISION' && <Field label="What changed" required><input value={form.revision_reason} onChange={set('revision_reason')} /></Field>}
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy || !stationId}>{busy ? 'Computing…' : 'Compute bill'}</button>
      </form>
      {preview && (
        <div style={{ marginTop: 16 }}>
          {preview.existing?.length > 0 && (
            <div className="alert alert-warning">This month already has: {preview.existing.map((b) => `${b.bill_no} (${b.bill_kind}, ${b.status})`).join('; ')}.</div>
          )}
          <ThermalBillSummary bill={preview.bill} lines={preview.lines} />
          {canWrite && <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>Save as draft</button>}
        </div>
      )}
      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </Card>
  );
}
