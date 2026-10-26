import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client.js';
import { deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, StatCard, Badge, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';

const mu = (kwh) => (kwh == null ? '—' : (Number(kwh) / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`);
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function fyOptions() {
  const now = new Date();
  const start = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return [0, 1, 2, 3].map((i) => `${start - i}-${start - i + 1}`);
}

// Each station's year against its tariff norms: availability against NAPAF,
// which sets how much capacity charge is recovered, and saleable energy against
// the design energy the energy charge rate was fixed on.
export default function StationPerformance({ vertical = 'HYDRO' }) {
  const [fy, setFy] = useState('');
  const [data, setData] = useState(null);
  const [popup, setPopup] = useState(null);

  const load = useCallback((year) => {
    api.hydroDesk.generationPerformance({ vertical, fy: year || undefined })
      .then((d) => { setData(d); if (!year) setFy(d.fy); })
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(() => { load(); }, [load]);

  const all = data?.stations || [];
  const isThermal = vertical === 'THERMAL';
  const sum = (k) => all.reduce((x, s) => x + (s.summary[k] || 0), 0);
  const below = all.reduce((x, s) => x + s.summary.months_below_napaf, 0);
  const shortfall = sum('capacity_shortfall');

  return (
    <div>
      <PageHeader
        title="Generation Performance"
        subtitle={isThermal
          ? 'Thermal stations against their tariff norms — availability (PAFM) against NAPAF, plant load factor against the incentive threshold, and the heat-rate, auxiliary and fuel figures each month\'s energy charge rate was worked on'
          : `${deskLabel(vertical)} stations against their tariff norms — plant availability (PAFM) against NAPAF, which decides the capacity charge recovered, and saleable energy against design energy`}
        actions={(
          <select value={fy} onChange={(e) => { setFy(e.target.value); load(e.target.value); }} aria-label="Financial year">
            {[...new Set([fy, ...fyOptions()].filter(Boolean))].map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
        )}
      />
      <div className="kpi-grid">
        <StatCard label={isThermal ? 'Energy scheduled YTD' : 'Saleable energy YTD'} value={`${mu(sum('saleable_ytd_kwh'))} MU`} />
        {isThermal
          ? <StatCard label={`Months above ${data?.plf_norm_pct ?? 85}% PLF (incentive)`} value={all.reduce((x, s) => x + (s.thermal?.months_above_plf_norm || 0), 0)} tone="green" />
          : <StatCard label="Design energy YTD (pro-rata)" value={`${mu(sum('design_ytd_kwh'))} MU`} />}
        <StatCard label="Months below NAPAF" value={below} tone={below ? 'red' : 'green'} />
        <StatCard label="Capacity charge lost to availability" value={fmtCurrency(shortfall)} tone={shortfall ? 'red' : 'default'} />
      </div>

      {all.map((s) => (
        <Card key={s.contract_id} title={`${s.station_name}${s.capacity_mw ? ` · ${s.capacity_mw} MW` : ''} · NAPAF ${pct(s.napaf_pct)}`}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 15, marginBottom: 10 }}>
            <span>PAF YTD <strong>{pct(s.summary.paf_ytd_pct)}</strong></span>
            {s.thermal ? (
              <>
                <span>PLF YTD <strong>{pct(s.thermal.plf_ytd_pct)}</strong> (incentive above {pct(s.thermal.plf_norm_pct)})</span>
                <span>Average ECR <strong>{s.thermal.avg_ecr != null ? `₹${s.thermal.avg_ecr}/kWh` : '—'}</strong></span>
                <span>GCV as received (weighted) <strong>{s.thermal.avg_gcv_received ?? '—'} kCal/kg</strong></span>
                <span>Landed coal (weighted) <strong>{s.thermal.avg_coal_rs_per_tonne != null ? fmtCurrency(s.thermal.avg_coal_rs_per_tonne) : '—'}/t</strong></span>
                <span>Coal on norms YTD <strong>{s.thermal.coal_tonnes_ytd.toLocaleString('en-IN')} t</strong></span>
              </>
            ) : (
              <>
                <span>Energy vs design YTD <strong>{pct(s.summary.energy_vs_design_ytd_pct)}</strong></span>
                <span>Annual saleable design energy used <strong>{pct(s.summary.annual_design_used_pct)}</strong></span>
              </>
            )}
            <span>Capacity charge recovered <strong>{fmtCurrency(s.summary.capacity_recovered)}</strong></span>
          </div>
          <Table
            columns={isThermal ? [
              { key: 'month', header: 'Month', render: (r) => monthName(r.month) },
              { key: 'pafm', header: 'PAFM', render: (r) => (r.billed ? <span style={{ color: r.below_napaf ? 'var(--red-deep)' : undefined, fontWeight: r.below_napaf ? 700 : 400 }}>{pct(r.pafm_pct)}</span> : '—') },
              { key: 'plf', header: 'PLF', render: (r) => (r.billed ? <span>{pct(r.plf_pct)}{r.plf_pct > s.thermal.plf_norm_pct && <div><Badge type="success">Incentive band</Badge></div>}</span> : '—') },
              { key: 'sched', header: 'Scheduled (MU)', render: (r) => (r.billed ? mu(r.ex_bus_kwh) : '—') },
              { key: 'norms', header: 'Norms (GHR · aux · SFC)', render: (r) => (r.billed ? <span style={{ fontSize: 14.5 }}>{r.norm_ghr ?? '—'} kCal/kWh · {pct(r.norm_aux_pct)} · {r.norm_sfc_ml_per_kwh ?? '—'} ml/kWh</span> : '—') },
              { key: 'fuel', header: 'Coal GCV / CVPF', render: (r) => (r.billed && r.gcv_received ? `${r.gcv_received} / ${r.cvpf} kCal/kg` : '—') },
              { key: 'price', header: 'Landed coal · oil', render: (r) => (r.billed && r.coal_rs_per_tonne ? <span style={{ fontSize: 14.5 }}>{fmtCurrency(r.coal_rs_per_tonne)}/t · {fmtCurrency(r.oil_rs_per_kl || 0)}/kL</span> : '—') },
              { key: 'coal', header: 'Coal on norms', render: (r) => (r.billed && r.coal_kg_per_kwh ? <span style={{ fontSize: 14.5 }}>{r.coal_kg_per_kwh} kg/kWh<div style={{ color: 'var(--text-light)' }}>{r.coal_tonnes.toLocaleString('en-IN')} t</div></span> : '—') },
              { key: 'ecr', header: 'ECR', render: (r) => (r.billed ? `₹${r.ecr}/kWh` : '—') },
              { key: 'short', header: 'Lost to availability', render: (r) => (r.billed && r.capacity_shortfall ? <span style={{ color: 'var(--red-deep)' }}>{fmtCurrency(r.capacity_shortfall)}</span> : '—') },
            ] : [
              { key: 'month', header: 'Month', render: (r) => monthName(r.month) },
              { key: 'pafm', header: 'PAFM', render: (r) => (r.billed ? <span style={{ color: r.below_napaf ? 'var(--red-deep)' : undefined, fontWeight: r.below_napaf ? 700 : 400 }}>{pct(r.pafm_pct)}</span> : '—') },
              { key: 'ok', header: 'vs NAPAF', render: (r) => (r.billed ? (r.below_napaf ? <Badge type="danger">Below</Badge> : <Badge type="success">Met</Badge>) : <span style={{ color: 'var(--text-light)' }}>not billed</span>) },
              { key: 'saleable', header: 'Saleable (MU)', render: (r) => (r.billed ? mu(r.saleable_kwh) : '—') },
              { key: 'design', header: 'Design (MU)', render: (r) => (r.billed ? mu(r.design_kwh) : '—') },
              { key: 'evd', header: 'Energy vs design', render: (r) => (r.billed ? pct(r.energy_vs_design_pct) : '—') },
              { key: 'excess', header: 'Beyond design (MU)', render: (r) => (r.billed ? mu(r.excess_kwh) : '—') },
              { key: 'cc', header: 'Capacity charge', render: (r) => (r.billed ? fmtCurrency(r.capacity_charge) : '—') },
              { key: 'short', header: 'Lost to availability', render: (r) => (r.billed && r.capacity_shortfall ? <span style={{ color: 'var(--red-deep)' }}>{fmtCurrency(r.capacity_shortfall)}</span> : '—') },
              { key: 'ec', header: 'Energy charge', render: (r) => (r.billed ? fmtCurrency(r.energy_charge) : '—') },
            ]}
            rows={s.months.map((r) => ({ ...r, id: r.month }))}
          />
        </Card>
      ))}
      {data && !all.length && <Card><p className="inline-note">No {deskLabel(vertical).toLowerCase()} station is on the platform.</p></Card>}
      {isThermal
        ? <p className="inline-note">Read off each month's bill. PLF is gross generation over capacity × hours, with gross generation taken as the scheduled ex-bus energy grossed up by the normative auxiliary consumption — the plant's actual heat rate and auxiliary consumption are not reported to the platform, so the norms shown are what each bill's energy charge rate was computed on. Coal on norms is (GHR − SFC × CVSF) / CVPF, grossed up for aux. The PLF incentive threshold is the thermal_plf_incentive_norm_pct master.</p>
        : <p className="inline-note">Read off each month's final bill, or its provisional bill until the final is out. Design energy is spread over the year by days; capacity charge is recovered in proportion to PAFM / NAPAF, so a month below the norm shows what it cost.</p>}
      <AlertPopup open={!!popup} tone="error" title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
