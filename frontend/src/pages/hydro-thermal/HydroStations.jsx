import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Field, AlertPopup, StatCard, fmtCurrency } from '../../components/ui.jsx';

// A hydro station and the tariff each financial year is billed on: the
// contract's constants, the CERC figures recorded for each year over them, and
// what the next bill will actually use.

const crore = (v) => (v == null ? '—' : `₹${(Number(v) / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 4 })} Cr`);
const num = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));
const emptyTariff = (fy) => ({ financial_year: fy, annual_afc: '', napaf_percent: '', annual_design_energy_mwh: '', normative_aux: '', ecr_excess_rate: '', order_ref: '' });

function currentFy() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}-${y + 1}`;
}

export default function HydroStations() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.HYDRO_THERMAL_WRITE.includes(user?.role);
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [tariffs, setTariffs] = useState([]);
  const [lastBill, setLastBill] = useState(null);
  const [alloc, setAlloc] = useState(null);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(emptyTariff(currentFy()));
  const [popup, setPopup] = useState(null);

  const loadStations = useCallback(() => {
    api.hydroBilling.stations({ vertical: 'HYDRO' }).then((list) => {
      setStations(list || []);
      if (list?.length) setStationId((cur) => cur || list[0].id);
    }).catch((e) => setPopup({ title: 'Stations could not be loaded', message: e.response?.data?.error || e.message }));
  }, []);
  useEffect(loadStations, [loadStations]);

  const loadStation = useCallback((id) => {
    if (!id) return;
    api.hydroBilling.tariffs(id).then((t) => setTariffs(t || [])).catch(() => setTariffs([]));
    api.hydroBilling.list({ contract_id: id }).then((bills) => {
      const live = (bills || []).filter((b) => b.status !== 'CANCELLED' && ['PROVISIONAL', 'FINAL'].includes(b.bill_kind))
        .sort((a, b) => (a.billing_month < b.billing_month ? 1 : -1));
      setLastBill(live[0] || null);
    }).catch(() => setLastBill(null));
    api.hydroBilling.allocations({ contract_id: id }).then(setAlloc).catch(() => setAlloc(null));
    api.hydroDesk.regulatory({ vertical: 'HYDRO' })
      .then((r) => setOrders((r.items || []).filter((i) => i.contract_id === id && i.tariff_impact)))
      .catch(() => setOrders([]));
  }, []);
  useEffect(() => { loadStation(stationId); }, [stationId, loadStation]);

  const station = stations.find((s) => s.id === stationId);
  const fy = currentFy();
  const yearRow = tariffs.find((t) => t.financial_year === fy);
  // What the next bill of the current year is computed on: the year's CERC
  // figure where one is recorded, the contract's otherwise.
  const effective = useMemo(() => {
    if (!station) return [];
    const pick = (k, ck = k) => (yearRow?.[k] != null ? { v: yearRow[k], from: `FY ${fy} tariff` } : { v: station[ck], from: 'contract' });
    return [
      { label: 'Annual Fixed Charges', ...pick('annual_afc'), fmt: crore },
      { label: 'NAPAF', ...pick('napaf_percent'), fmt: (v) => (v == null ? '—' : `${num(v)}%`) },
      { label: 'Annual design energy', ...pick('annual_design_energy_mwh'), fmt: (v) => (v == null ? '—' : `${num(v / 1000)} MU`) },
      { label: 'Normative auxiliary consumption', ...pick('normative_aux'), fmt: (v) => (v == null ? '—' : `${num(v)}%`) },
      { label: 'Rate beyond design energy', ...pick('ecr_excess_rate'), fmt: (v) => (v == null ? 'per CERC formula' : `₹${num(v, 4)}/kWh`) },
      { label: 'Free energy to home state', v: station.free_energy_home_state, from: 'contract', fmt: (v) => (v == null ? '—' : `${num(v)}%`) },
    ];
  }, [station, yearRow, fy]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const p = [];
    if (!/^\d{4}-\d{4}$/.test(form.financial_year)) p.push('Financial year like 2026-2027');
    else if (Number(form.financial_year.slice(5)) !== Number(form.financial_year.slice(0, 4)) + 1) p.push('Financial year must be consecutive years');
    const given = ['annual_afc', 'napaf_percent', 'annual_design_energy_mwh', 'normative_aux', 'ecr_excess_rate'].filter((k) => form[k] !== '');
    if (!given.length) p.push('At least one figure');
    if (form.annual_afc !== '' && Number(form.annual_afc) < 1e7) p.push('AFC is in rupees, not crore (1700.8363 crore is 17008363000)');
    if (form.napaf_percent !== '' && !(Number(form.napaf_percent) > 0 && Number(form.napaf_percent) <= 100)) p.push('NAPAF between 0 and 100%');
    if (form.normative_aux !== '' && !(Number(form.normative_aux) > 0 && Number(form.normative_aux) <= 100)) p.push('Auxiliary consumption between 0 and 100%');
    if (!form.order_ref.trim()) p.push('CERC order reference — the figures need their source');
    return p;
  }

  async function save(e) {
    e.preventDefault();
    const problems = validate();
    if (problems.length) { setPopup({ title: 'Check the tariff', items: problems }); return; }
    try {
      const r = await api.hydroBilling.setTariff({ contract_id: stationId, ...form });
      loadStation(stationId);
      const stale = r.bills_on_other_figures || [];
      setPopup({
        tone: stale.length ? 'warning' : 'success',
        title: `Tariff for ${form.financial_year} saved`,
        message: stale.length
          ? `${stale.length} bill(s) of that year were raised on a different AFC. Raise an arrear bill for them under Arrear & Supplementary Bills.`
          : 'Bills of that year are computed on it from now on.',
        items: stale.map((b) => `${b.bill_no} (${b.billing_month}, ${b.status.toLowerCase()}) — AFC ${crore(b.a1_afc)}`),
      });
      setForm(emptyTariff(form.financial_year));
    } catch (err) {
      setPopup({ title: 'The tariff was not saved', message: err.response?.data?.error || err.message });
    }
  }

  const pending = orders.filter((o) => o.to_implement);

  return (
    <div>
      <PageHeader
        title="Hydro Stations & Tariff"
        subtitle="Each hydro station's PPA constants, the CERC tariff recorded for every financial year, and what the next bill will be computed on"
      />
      <Card title="Stations" style={{ marginBottom: 16 }}>
        <Table
          onRowClick={(s) => setStationId(s.id)}
          columns={[
            { key: 'station_name', header: 'Station', render: (s) => <strong style={{ color: s.id === stationId ? 'var(--primary)' : undefined }}>{s.station_name}</strong> },
            { key: 'contract_no', header: 'PPA' },
            { key: 'capacity_mw', header: 'Capacity', render: (s) => (s.capacity_mw ? `${num(s.capacity_mw, 0)} MW` : '—') },
            { key: 'project_type', header: 'Type', render: (s) => (s.project_type === 'PSP' ? 'Pumped storage' : 'Hydro') },
            { key: 'tenure', header: 'Tenure', render: (s) => `${s.tenure_start || '—'} → ${s.tenure_end || '—'}` },
            { key: 'ready', header: 'Ready to bill', render: (s) => (s.ready ? <Badge type="success">Ready</Badge> : <span style={{ fontSize: 13.5, color: 'var(--amber-strong)' }}>Missing: {s.missing.join(', ')}</span>) },
          ]}
          rows={stations}
          emptyMessage="No hydro station is on the platform."
        />
      </Card>

      {station && (
        <>
          {pending.length > 0 && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {pending.length} CERC order(s) on this station change the tariff and are not yet in the bills: {pending.map((o) => `${o.title} (${o.order_ref})`).join('; ')}. Record the year's figures below, then mark the order implemented on the <Link to="/hydro-thermal/regulatory">Regulatory Desk</Link>.
            </div>
          )}
          <div className="kpi-grid">
            <StatCard label="Beneficiaries on allocation" value={alloc?.rows?.length ?? '—'} hint={alloc?.month ? `as of ${alloc.month}` : undefined} />
            <StatCard label="Last month billed" value={lastBill ? lastBill.billing_month : '—'} hint={lastBill ? `${lastBill.bill_no} · ${lastBill.bill_kind.toLowerCase()}` : undefined} />
            <StatCard label="ECR on last bill" value={lastBill ? `₹${num(lastBill.a12_ecr, 4)}/kWh` : '—'} hint={lastBill ? `beyond design ₹${num(lastBill.a13_ecr_excess, 4)}` : undefined} />
            <StatCard label="AFC on last bill" value={lastBill ? crore(lastBill.a1_afc) : '—'} tone={lastBill && effective[0] && Math.abs(Number(lastBill.a1_afc) - Number(effective[0].v)) > 0.5 && lastBill.financial_year === fy ? 'amber' : 'default'} />
          </div>

          <Card title={`What the next ${fy} bill is computed on — ${station.station_name}`} style={{ marginBottom: 16 }}>
            <Table
              columns={[
                { key: 'label', header: 'Constant' },
                { key: 'v', header: 'Value', render: (r) => <strong>{r.fmt(r.v)}</strong> },
                { key: 'from', header: 'Taken from', render: (r) => <Badge type={r.from === 'contract' ? 'neutral' : 'primary'}>{r.from}</Badge> },
              ]}
              rows={effective.map((r) => ({ ...r, id: r.label }))}
            />
            <p className="inline-note">
              Payment due {station.payment_terms_days ? `${station.payment_terms_days} days from the bill` : 'per the CERC regulations'}; rebate {station.rebate_pct ? `${station.rebate_pct}%` : 'per the CERC tiers'}; LPS {station.lps_annual_pct ? `${station.lps_annual_pct}% p.a.` : 'per the LPS Rules'}. A figure recorded for a year below overrides the contract for that year's bills only.
            </p>
          </Card>

          <Card title="Tariff by financial year" style={{ marginBottom: 16 }}>
            <Table
              columns={[
                { key: 'financial_year', header: 'FY' },
                { key: 'annual_afc', header: 'AFC', render: (t) => crore(t.annual_afc) },
                { key: 'napaf_percent', header: 'NAPAF %', render: (t) => num(t.napaf_percent) },
                { key: 'annual_design_energy_mwh', header: 'Design energy (MU)', render: (t) => (t.annual_design_energy_mwh ? num(t.annual_design_energy_mwh / 1000) : '—') },
                { key: 'normative_aux', header: 'Aux %', render: (t) => num(t.normative_aux) },
                { key: 'ecr_excess_rate', header: 'Beyond design ₹/kWh', render: (t) => num(t.ecr_excess_rate, 4) },
                { key: 'order_ref', header: 'Order', render: (t) => t.order_ref || '—' },
                { key: 'updated', header: 'Set by', render: (t) => <span style={{ fontSize: 12.5 }}>{t.updated_by || '—'}<div style={{ color: 'var(--text-light)' }}>{String(t.updated_at || '').slice(0, 10)}</div></span> },
                { key: 'edit', header: '', render: (t) => (canWrite ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ financial_year: t.financial_year, annual_afc: t.annual_afc ?? '', napaf_percent: t.napaf_percent ?? '', annual_design_energy_mwh: t.annual_design_energy_mwh ?? '', normative_aux: t.normative_aux ?? '', ecr_excess_rate: t.ecr_excess_rate ?? '', order_ref: t.order_ref || '' })}>Revise</button> : null) },
              ]}
              rows={tariffs}
              emptyMessage="No year recorded — every bill uses the contract's figures."
            />
            {canWrite && (
              <form onSubmit={save} style={{ marginTop: 14 }}>
                <div className="form-grid">
                  <Field label="Financial year" required><input placeholder="2026-2027" value={form.financial_year} onChange={set('financial_year')} /></Field>
                  <Field label="Annual Fixed Charges (₹, not crore)"><input type="number" value={form.annual_afc} onChange={set('annual_afc')} /></Field>
                  <Field label="NAPAF (%)"><input type="number" step="0.01" value={form.napaf_percent} onChange={set('napaf_percent')} /></Field>
                  <Field label="Annual design energy (MWh)"><input type="number" value={form.annual_design_energy_mwh} onChange={set('annual_design_energy_mwh')} /></Field>
                  <Field label="Normative aux consumption (%)"><input type="number" step="0.01" value={form.normative_aux} onChange={set('normative_aux')} /></Field>
                  <Field label="Rate beyond design energy (₹/kWh)"><input type="number" step="0.0001" value={form.ecr_excess_rate} onChange={set('ecr_excess_rate')} placeholder="blank = CERC formula" /></Field>
                  <Field label="CERC order reference" required><input value={form.order_ref} onChange={set('order_ref')} /></Field>
                </div>
                <button type="submit" className="btn btn-primary">Save year's tariff</button>
                <span className="inline-note" style={{ marginLeft: 10 }}>Bills already raised keep their figures; the desk is told which ones an AFC change leaves stale, for an <Link to="/hydro-thermal/arrear-supplementary">arrear bill</Link>.</span>
              </form>
            )}
          </Card>
        </>
      )}
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
