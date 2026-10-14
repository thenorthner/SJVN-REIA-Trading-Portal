import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, fmtNumber } from '../../components/ui.jsx';

/**
 * Thermal Billing — its own section, apart from hydro.
 *
 * A thermal station is billed on a different tariff from a hydro one: fixed
 * (capacity) charges against availability, plus an energy charge that follows
 * the fuel — station heat rate, GCV and the landed cost of coal. None of the
 * hydro bill's arithmetic (design energy, free power to the home state) carries
 * over: the bill is computed on its own (thermalStationBill.js), and from
 * there it runs through the same approval, ledger and recovery screens as hydro,
 * on the thermal stations only.
 */

// What a thermal bill is computed from, and where each figure comes from.
const BILL_INPUTS = [
  ['Annual Fixed Charges (AFC)', 'CERC tariff order for the station'],
  ['Normative Plant Availability Factor (NAPAF)', 'CERC Tariff Regulations / tariff order'],
  ['Station Heat Rate, auxiliary consumption, specific oil consumption', 'CERC tariff order (norms of operation)'],
  ['GCV of coal as received, landed cost of coal and secondary oil', 'Station fuel statement (Form 15), every month'],
  ['Plant availability (PAFM) and scheduled energy, by beneficiary', 'ERPC Regional Energy Account'],
  ['Beneficiary allocation of the station’s capacity', 'MoP allocation order / ERPC'],
];

export default function ThermalDashboard() {
  const navigate = useNavigate();
  const [stations, setStations] = useState([]);
  const [stakeholders, setStakeholders] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.thermal.stations().catch(() => []),
      api.entities.list({ vertical: 'THERMAL' }).catch(() => []),
      api.hydroBilling.list({ vertical: 'THERMAL' }).catch(() => []),
    ]).then(([st, sk, bl]) => {
      setBills(Array.isArray(bl) ? bl : []);
      setStations(st);
      setStakeholders(Array.isArray(sk) ? sk : []);
    }).finally(() => setLoading(false));
  }, []);

  const approved = stakeholders.filter((s) => s.status === 'APPROVED').length;

  return (
    <div>
      <PageHeader
        title="Thermal Billing"
        subtitle="Thermal generating stations, their beneficiaries, and what each bill is computed from"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/thermal/stations')}>Stations &amp; Tariff</button>
            <button className="btn btn-primary" onClick={() => navigate('/thermal/billing')}>Monthly Bills</button>
          </div>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Thermal stations</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{loading ? '—' : stations.length}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {fmtNumber(stations.reduce((sum, s) => sum + (Number(s.capacity_mw) || 0), 0))} MW
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Stakeholders onboarded</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{loading ? '—' : stakeholders.length}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{approved} approved · {stakeholders.length - approved} pending</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Bills raised</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{loading ? '—' : bills.filter((b) => b.status !== 'CANCELLED').length}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {bills.filter((b) => b.status === 'DRAFT').length} draft · {bills.filter((b) => b.status === 'ISSUED').length} issued
          </div>
        </Card>
      </div>

      <Card title="Stations" style={{ marginBottom: 16 }}>
        <Table
          columns={[
            { key: 'station_name', header: 'Station' },
            { key: 'contract_no', header: 'PPA' },
            { key: 'capacity_mw', header: 'Capacity', render: (r) => `${fmtNumber(r.capacity_mw)} MW` },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            { key: 'ready', header: 'Ready to bill', render: (r) => (r.ready ? <Badge status="ACTIVE" label="Ready" /> : <span style={{ fontSize: 12, color: 'var(--amber-strong)' }}>Missing: {(r.missing || []).join(', ')}</span>) },
          ]}
          rows={stations}
          emptyMessage={loading ? 'Loading...' : 'No thermal station yet — set one up under Stations & Tariff.'}
        />
      </Card>

      <Card title="What a thermal bill is computed from">
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 0 }}>
          Capacity charge = AFC × days in month / days in year × PAFM / NAPAF. Energy charge = ECR × ex-bus scheduled energy,
          with ECR = [(GHR − SFC × CVSF) × LPPF / CVPF + SFC × LPSFi] × 100 / (100 − AUX). The year's figures go in under
          Stations &amp; Tariff; the month's availability, energy and fuel are entered with each bill.
        </p>
        <Table
          columns={[
            { key: 'input', header: 'Input' },
            { key: 'source', header: 'Source' },
          ]}
          rows={BILL_INPUTS.map(([input, source]) => ({ id: input, input, source }))}
        />
      </Card>
    </div>
  );
}
