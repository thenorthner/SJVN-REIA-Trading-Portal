import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';

// A thermal station and the tariff each financial year of it is billed on.
// The station is a PPA with a generating company onboarded under Thermal
// stakeholders; the tariff is the CERC order's AFC and operating norms.

const emptyTariff = () => ({
  financial_year: '', annual_afc: '', napaf_percent: '85', gross_heat_rate: '', aux_pct: '',
  sfc_ml_per_kwh: '0.5', cv_secondary_kcal_per_ml: '10', order_ref: '',
});

export default function ThermalStations() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.THERMAL_WRITE.includes(user?.role);
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [tariffs, setTariffs] = useState([]);
  const [gencos, setGencos] = useState([]);
  const [setup, setSetup] = useState(null);
  const [tariff, setTariff] = useState(emptyTariff());
  const [fuel, setFuel] = useState({ gcv_kcal_per_kg: '', coal_rs_per_tonne: '', oil_rs_per_kl: '' });
  const [ecr, setEcr] = useState(null);
  const [popup, setPopup] = useState(null);
  const fail = (title, err) => setPopup({ tone: 'error', title, message: err?.response?.data?.error || err?.message });

  const loadStations = useCallback(() => {
    api.thermal.stations().then((list) => {
      setStations(list || []);
      if (list?.length) setStationId((cur) => cur || list[0].id);
    }).catch((e) => fail('Stations could not be loaded', e));
  }, []);
  useEffect(loadStations, [loadStations]);
  useEffect(() => {
    api.entities.list({ vertical: 'THERMAL', entity_type: 'SELLER', status: 'APPROVED' }).then(setGencos).catch(() => setGencos([]));
  }, []);
  useEffect(() => {
    if (!stationId) { setTariffs([]); return; }
    api.thermal.tariffs(stationId).then(setTariffs).catch(() => setTariffs([]));
  }, [stationId]);

  const station = stations.find((s) => s.id === stationId);

  async function createStation(e) {
    e.preventDefault();
    try {
      const c = await api.thermal.createStation(setup);
      setSetup(null);
      setStationId(c.id);
      loadStations();
      setPopup({ tone: 'success', title: `${c.contract_no} set up`, message: 'Now enter the tariff for the financial year, and the beneficiary allocation under Monthly Bills & Approval.' });
    } catch (err) { fail('The station was not set up', err); }
  }

  async function saveTariff(e) {
    e.preventDefault();
    try {
      await api.thermal.setTariff({ ...tariff, contract_id: stationId });
      api.thermal.tariffs(stationId).then(setTariffs);
      loadStations();
      setPopup({ tone: 'success', title: `Tariff for ${tariff.financial_year} saved`, message: 'Bills of that year are computed on it. If bills are already out, raise the arrear from Arrear & Supplementary Bills.' });
    } catch (err) { fail('The tariff was not saved', err); }
  }

  async function previewEcr() {
    const t = tariffs[0] || tariff;
    try {
      setEcr(await api.thermal.ecrPreview({ ...t, ...fuel }));
    } catch (err) { fail('ECR could not be worked out', err); }
  }

  return (
    <div>
      <PageHeader
        title="Thermal Stations & Tariff"
        subtitle="Each thermal station's PPA and the CERC tariff every financial year is billed on"
        actions={canWrite && <button className="btn btn-primary" onClick={() => setSetup({ seller_id: gencos[0]?.id || '', contract_no: '', capacity_mw: '', tenure_start: '', tenure_end: '', payment_terms_days: '45', rebate_pct: '', rebate_days: '', lps_annual_pct: '' })}>+ Set up station</button>}
      />
      <Card title="Stations" style={{ marginBottom: 16 }}>
        <Table
          onRowClick={(s) => setStationId(s.id)}
          columns={[
            { key: 'station_name', header: 'Station', render: (s) => <strong style={{ color: s.id === stationId ? 'var(--primary)' : undefined }}>{s.station_name}</strong> },
            { key: 'contract_no', header: 'PPA' },
            { key: 'capacity_mw', header: 'Capacity', render: (s) => `${s.capacity_mw} MW` },
            { key: 'tenure', header: 'Tenure', render: (s) => `${s.tenure_start} → ${s.tenure_end}` },
            { key: 'ready', header: 'Ready to bill', render: (s) => (s.ready ? <Badge status="ACTIVE" label="Ready" /> : <span style={{ fontSize: 12, color: 'var(--amber-strong)' }}>Missing: {s.missing.join(', ')}</span>) },
          ]}
          rows={stations}
          emptyMessage="No thermal station set up yet. Onboard the generating company under Thermal → Stakeholders, approve it, then set up the station here."
        />
      </Card>

      {station && (
        <Card title={`Tariff by financial year — ${station.station_name}`} style={{ marginBottom: 16 }}>
          <Table
            columns={[
              { key: 'financial_year', header: 'FY' },
              { key: 'annual_afc', header: 'AFC', render: (t) => fmtCurrency(t.annual_afc) },
              { key: 'napaf_percent', header: 'NAPAF %' },
              { key: 'gross_heat_rate', header: 'GHR kCal/kWh' },
              { key: 'aux_pct', header: 'Aux %' },
              { key: 'sfc_ml_per_kwh', header: 'SFC ml/kWh' },
              { key: 'order_ref', header: 'Order', render: (t) => t.order_ref || '—' },
            ]}
            rows={tariffs}
            emptyMessage="No tariff yet — a bill cannot be raised until the year's tariff is set."
          />
          {canWrite && (
            <form onSubmit={saveTariff} style={{ marginTop: 14 }}>
              <div className="form-grid">
                <Field label="Financial year" required><input required placeholder="2026-2027" value={tariff.financial_year} onChange={(e) => setTariff({ ...tariff, financial_year: e.target.value })} /></Field>
                <Field label="Annual Fixed Charges (₹, not crore)" required><input required type="number" value={tariff.annual_afc} onChange={(e) => setTariff({ ...tariff, annual_afc: e.target.value })} /></Field>
                <Field label="NAPAF (%)" required><input required type="number" step="0.01" value={tariff.napaf_percent} onChange={(e) => setTariff({ ...tariff, napaf_percent: e.target.value })} /></Field>
                <Field label="Gross station heat rate (kCal/kWh)" required><input required type="number" value={tariff.gross_heat_rate} onChange={(e) => setTariff({ ...tariff, gross_heat_rate: e.target.value })} /></Field>
                <Field label="Normative aux consumption (%)" required><input required type="number" step="0.01" value={tariff.aux_pct} onChange={(e) => setTariff({ ...tariff, aux_pct: e.target.value })} /></Field>
                <Field label="Secondary fuel oil (ml/kWh)"><input type="number" step="0.01" value={tariff.sfc_ml_per_kwh} onChange={(e) => setTariff({ ...tariff, sfc_ml_per_kwh: e.target.value })} /></Field>
                <Field label="CV of secondary fuel (kCal/ml)"><input type="number" step="0.1" value={tariff.cv_secondary_kcal_per_ml} onChange={(e) => setTariff({ ...tariff, cv_secondary_kcal_per_ml: e.target.value })} /></Field>
                <Field label="CERC order reference"><input value={tariff.order_ref} onChange={(e) => setTariff({ ...tariff, order_ref: e.target.value })} /></Field>
              </div>
              <button type="submit" className="btn btn-primary">Save year's tariff</button>
            </form>
          )}
        </Card>
      )}

      {station && tariffs.length > 0 && (
        <Card title="What a month's fuel makes the energy charge rate">
          <div className="form-grid">
            <Field label="GCV of coal (kCal/kg)"><input type="number" value={fuel.gcv_kcal_per_kg} onChange={(e) => setFuel({ ...fuel, gcv_kcal_per_kg: e.target.value })} /></Field>
            <Field label="Landed price of coal (₹/tonne)"><input type="number" value={fuel.coal_rs_per_tonne} onChange={(e) => setFuel({ ...fuel, coal_rs_per_tonne: e.target.value })} /></Field>
            <Field label="Landed price of secondary oil (₹/kL)"><input type="number" value={fuel.oil_rs_per_kl} onChange={(e) => setFuel({ ...fuel, oil_rs_per_kl: e.target.value })} /></Field>
          </div>
          <button type="button" className="btn btn-secondary" onClick={previewEcr}>Work out ECR ({tariffs[0].financial_year} norms)</button>
          {ecr && <p style={{ marginTop: 10 }}>ECR = <strong>₹{ecr.ecr}/kWh</strong> — [(GHR − SFC × CVSF) × LPPF / CVPF + SFC × LPSFi] × 100 / (100 − AUX)</p>}
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Then raise the month's bill under <Link to="/thermal/billing">Monthly Bills &amp; Approval</Link>.
          </p>
        </Card>
      )}

      <Modal open={!!setup} onClose={() => setSetup(null)} title="Set up a thermal station" width={720}>
        {setup && (
          <form onSubmit={createStation}>
            <div className="form-grid">
              <Field label="Generating company" required>
                <select required value={setup.seller_id} onChange={(e) => setSetup({ ...setup, seller_id: e.target.value })}>
                  <option value="">Select…</option>
                  {gencos.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
              <Field label="PPA number" required><input required value={setup.contract_no} onChange={(e) => setSetup({ ...setup, contract_no: e.target.value })} placeholder="PPA/SJVN/BUXAR/001" /></Field>
              <Field label="Installed capacity (MW)" required><input required type="number" value={setup.capacity_mw} onChange={(e) => setSetup({ ...setup, capacity_mw: e.target.value })} /></Field>
              <Field label="Tenure from" required><input required type="date" value={setup.tenure_start} onChange={(e) => setSetup({ ...setup, tenure_start: e.target.value })} /></Field>
              <Field label="Tenure to" required><input required type="date" value={setup.tenure_end} onChange={(e) => setSetup({ ...setup, tenure_end: e.target.value })} /></Field>
              <Field label="Payment due (days from bill)"><input type="number" value={setup.payment_terms_days} onChange={(e) => setSetup({ ...setup, payment_terms_days: e.target.value })} /></Field>
              <Field label="Early-payment rebate (%)"><input type="number" step="0.01" value={setup.rebate_pct} onChange={(e) => setSetup({ ...setup, rebate_pct: e.target.value })} placeholder="blank = CERC tiers" /></Field>
              <Field label="Rebate window (days)"><input type="number" value={setup.rebate_days} onChange={(e) => setSetup({ ...setup, rebate_days: e.target.value })} /></Field>
              <Field label="LPS (% per annum)"><input type="number" step="0.01" value={setup.lps_annual_pct} onChange={(e) => setSetup({ ...setup, lps_annual_pct: e.target.value })} placeholder="blank = LPS Rules" /></Field>
            </div>
            {gencos.length === 0 && <p style={{ color: 'var(--amber-strong)', fontSize: 13 }}>No approved generating company under Thermal yet — onboard one in <Link to="/thermal/stakeholders">Stakeholders</Link>.</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Set up</button>
            </div>
          </form>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
