import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import { parseAllocationPaste, parseEnergyPaste } from './allocationPaste.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, Tabs, Tab,
  fmtCurrency, fmtNumber,
} from '../../components/ui.jsx';

// The monthly bill for a hydro station, in the shape SJVN's Commercial & System
// Operation Department issues it: the station's own charges (the A, C, E and EE
// blocks of the printed bill) computed once, then split across the beneficiaries
// of the station in the proportions the Regional Energy Account fixes.
//
// The desk works month by month, so the page is built around one month at a
// time: pick the station and month, see what the bill comes to and who carries
// what, then save it. Nothing is written until Save, and the preview is the same
// computation the save uses — so what is on screen is what gets billed.

const KINDS = [
  { value: 'PROVISIONAL', label: 'Provisional — billed on the provisional REA' },
  { value: 'FINAL', label: 'Final — closing the month against the final REA' },
  { value: 'REVISION', label: 'Revision — restating a month that is already billed' },
];

const EMPTY = {
  billing_month: '',
  bill_kind: 'PROVISIONAL',
  ex_bus_scheduled_kwh: '',
  free_power_kwh: '',
  pafm_percent: '',
  beta_value: '',
  nrldc_total_fee: '',
  urs_nr_kwh: '',
  ecr_excess: '',
  rea_reference: '',
  revision_reason: '',
  revises_bill_id: '',
};

const kwh = (v) => `${fmtNumber(v, 1)} kWh`;
const mwh = (v) => `${fmtNumber(v, 3)} MWh`;
const pctText = (v) => (v == null ? '—' : `${Number(v).toFixed(6)}%`);

/** The current month, less one — the month a desk is usually billing. */
function defaultMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** One row of the printed bill: its code, what it means, and its value. */
function BillRow({ code, label, value, strong }) {
  return (
    <tr style={strong ? { fontWeight: 600 } : undefined}>
      <td style={{ width: 48, color: 'var(--text-light)', fontVariantNumeric: 'tabular-nums' }}>{code}</td>
      <td>{label}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
    </tr>
  );
}

function BillBlock({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontWeight: 600, fontSize: 13, padding: '6px 0', marginBottom: 4,
        borderBottom: '1px solid var(--border)',
      }}>{title}</div>
      <table className="data-table" style={{ width: '100%' }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** The station bill itself — pages 1 of the printed bill. */
function StationBillSheet({ bill }) {
  if (!bill) return null;
  return (
    <div>
      <BillBlock title="Bill parameters">
        <BillRow code="A1" label='Annual Fixed Charges "AFC" as approved by CERC' value={fmtCurrency(bill.a1_afc)} />
        <BillRow code="A2" label="Annual Design Energy (DE)" value={mwh(bill.a2_design_energy_mwh)} />
        <BillRow code="A3" label="Normative Auxiliary Consumption (AUX)" value={`${bill.a3_aux_pct}%`} />
        <BillRow code="A4" label="Free Energy for Home State (FEHS)" value={`${bill.a4_fehs_pct}%`} />
        <BillRow code="A5" label="Annual Ex-bus Design Energy" value={mwh(bill.a5_ex_bus_design_energy_mwh)} />
        <BillRow code="A6" label="Annual Ex-bus Saleable Design Energy" value={mwh(bill.a6_ex_bus_saleable_design_energy_mwh)} />
        <BillRow code="A7" label="Installed Capacity (IC)" value={bill.a7_installed_capacity_mw ? `${fmtNumber(bill.a7_installed_capacity_mw, 0)} MW` : '—'} />
        <BillRow code="A8" label="Number of days in the month (NDM)" value={bill.a8_days_in_month} />
        <BillRow code="A9" label="Number of days in the year (NDY)" value={bill.a9_days_in_year} />
        <BillRow code="A11" label="Normative Annual Plant Availability Factor (NAPAF)" value={`${bill.a11_napaf_pct}%`} />
        <BillRow code="A12" label="Energy Charge Rate (ECR), up to annual saleable design energy" value={`₹${bill.a12_ecr}/kWh`} />
        <BillRow code="A13" label="Energy Charge Rate for energy in excess of it" value={`₹${bill.a13_ecr_excess}/kWh`} />
      </BillBlock>

      <BillBlock title="Capacity charges (inclusive of incentive)">
        <BillRow code="C1" label="Plant Availability Factor achieved during the month (PAFM)" value={`${bill.c1_pafm_pct}%`} />
        <BillRow code="C2" label="Capacity Charge for the month" value={fmtCurrency(bill.c2_capacity_charge)} />
        <BillRow code="C3" label="Beta Factor, as per REA" value={bill.c3_beta_factor == null ? 'not certified' : Number(bill.c3_beta_factor).toFixed(3)} />
        <BillRow code="C4" label={`Incentive on account of Beta Factor — ${bill.c4_beta_note || ''}`} value={fmtCurrency(bill.c4_beta_incentive)} />
        <BillRow code="C5" label="Total Capacity Charges including incentive" value={fmtCurrency(bill.c5_total_capacity_charge)} strong />
      </BillBlock>

      <BillBlock title="Energy details">
        <BillRow code="E1" label="Ex-bus Scheduled Energy for the month" value={kwh(bill.e1_ex_bus_scheduled_kwh)} />
        <BillRow code="E2" label="Free Power to the Home State as per REA" value={kwh(bill.e2_free_power_kwh)} />
        <BillRow code="E3" label="Ex-bus Saleable Scheduled Energy for the month" value={kwh(bill.e3_saleable_scheduled_kwh)} />
        <BillRow code="E4" label="Ex-bus Scheduled Energy, cumulative up to this month" value={kwh(bill.e4_cum_scheduled_kwh)} />
        <BillRow code="E5" label="Free Power to the Home State, cumulative" value={kwh(bill.e5_cum_free_power_kwh)} />
        <BillRow code="E6" label="Ex-bus Saleable Scheduled Energy, cumulative" value={kwh(bill.e6_cum_saleable_kwh)} />
        <BillRow code="E7" label="Energy in excess of Annual Ex-bus Saleable Design Energy" value={kwh(bill.e7_excess_kwh)} />
        <BillRow code="E8" label="Energy up to Annual Ex-bus Saleable Design Energy" value={kwh(bill.e8_upto_design_kwh)} />
        {Number(bill.urs_nr_kwh) > 0 && (
          <>
            <BillRow
              code="URS"
              label="Un-requisitioned surplus — regulated, billed to no beneficiary"
              value={kwh(bill.urs_nr_kwh)}
            />
            <BillRow
              code=""
              label="Saleable energy actually billed (E3 − URS)"
              value={kwh(bill.e3_billable_kwh)}
              strong
            />
          </>
        )}
      </BillBlock>

      <BillBlock title="Energy charges">
        <BillRow code="EE1" label="Energy Charges up to the Saleable Design Energy (E8 × A12)" value={fmtCurrency(bill.ee1_energy_charge)} />
        <BillRow code="EE2" label="Energy Charges for energy in excess of it (E7 × A13)" value={fmtCurrency(bill.ee2_excess_energy_charge)} />
        <BillRow code="" label="Total Charges (C5 + EE1 + EE2)" value={fmtCurrency(bill.total_charges)} strong />
      </BillBlock>

      {Number(bill.nrldc_total_fee) > 0 && (
        <BillBlock title="NRLDC fees and charges">
          <BillRow
            code=""
            label="Issued by POSOCO, billed through to beneficiaries — outside the total above"
            value={fmtCurrency(bill.nrldc_total_fee)}
          />
        </BillBlock>
      )}

      {bill.prev_total_charges != null && (
        <BillBlock title="Revision">
          <BillRow code="A" label="Already billed as per the earlier bill" value={fmtCurrency(bill.prev_total_charges)} />
          <BillRow code="B" label="Revised total for the month" value={fmtCurrency(bill.total_charges)} />
          <BillRow code="C" label="Differential amount to be billed (B − A)" value={fmtCurrency(bill.differential_amount)} strong />
        </BillBlock>
      )}
    </div>
  );
}

/** The beneficiary-wise breakup — pages 2 to 4 of the printed bill. */
function BeneficiarySheet({ lines, bill }) {
  const total = (k) => lines.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const hasNrldc = total('nrldc_fee') > 0;
  const hasExcess = total('energy_excess_kwh') > 0;
  const hasRegulation = total('deducted_scheduled_energy_kwh') > 0;

  const columns = [
    { key: 'sr_no', header: '#' },
    {
      key: 'beneficiary_name',
      header: 'Beneficiary',
      render: (r) => (
        <span>
          {r.beneficiary_name}
          {r.parent_state && (
            <span style={{ color: 'var(--text-light)', fontSize: 11, marginLeft: 6 }}>· {r.parent_state}</span>
          )}
        </span>
      ),
    },
    { key: 'pct_rea', header: 'REA %', render: (r) => pctText(r.pct_rea) },
    { key: 'pct_proportionate', header: 'Charging %', render: (r) => pctText(r.pct_proportionate) },
    { key: 'capacity_charge', header: 'Capacity charges', render: (r) => fmtCurrency(r.capacity_charge) },
    ...(hasRegulation ? [
      { key: 'actual_scheduled_energy_kwh', header: 'Actual scheduled', render: (r) => kwh(r.actual_scheduled_energy_kwh) },
      {
        key: 'deducted_scheduled_energy_kwh',
        header: 'Deducted',
        render: (r) => (r.deducted_scheduled_energy_kwh > 0
          ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{kwh(r.deducted_scheduled_energy_kwh)}</span>
          : '—'),
      },
    ] : []),
    {
      key: 'saleable_energy_kwh',
      header: hasRegulation ? 'Remaining (billed)' : 'Saleable energy',
      render: (r) => kwh(r.saleable_energy_kwh),
    },
    ...(hasExcess ? [{ key: 'energy_excess_kwh', header: 'of which in excess', render: (r) => kwh(r.energy_excess_kwh) }] : []),
    { key: 'energy_charge_total', header: 'Energy charges', render: (r) => fmtCurrency(r.energy_charge_total) },
    ...(hasNrldc ? [{ key: 'nrldc_fee', header: 'NRLDC fees', render: (r) => fmtCurrency(r.nrldc_fee) }] : []),
    { key: 'total_charges', header: 'Total for the month', render: (r) => <strong>{fmtCurrency(r.total_charges)}</strong> },
  ];

  // The first thing anyone checking this bill does is add the column up, so the
  // total is shown beside the station's own figure rather than left to be summed.
  const ties = bill && Math.abs(total('total_charges') - Number(bill.total_charges)) < 1;

  return (
    <div>
      <Table columns={columns} rows={lines} caption="Beneficiary-wise breakup of capacity and energy charges" />
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        padding: '10px 12px', marginTop: 8, borderTop: '1px solid var(--border)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ color: 'var(--text-light)' }}>
          {lines.length} beneficiaries · REA {total('pct_rea').toFixed(6)}% · charging {total('pct_proportionate').toFixed(6)}%
          {hasRegulation && (
            <span style={{ display: 'block' }}>
              {lines.filter((r) => r.is_regulated).length} regulated ·
              {' '}{fmtNumber(total('deducted_scheduled_energy_kwh'), 1)} kWh withheld
            </span>
          )}
        </span>
        <span>
          Capacity {fmtCurrency(total('capacity_charge'))} + Energy {fmtCurrency(total('energy_charge_total'))}
          {' = '}
          <strong>{fmtCurrency(total('total_charges'))}</strong>
          {bill && (
            <span style={{ marginLeft: 8, color: ties ? 'var(--green, #276749)' : 'var(--red)' }}>
              {ties ? 'ties to the station bill' : `does not tie — station bill is ${fmtCurrency(bill.total_charges)}`}
            </span>
          )}
          {/* NRLDC fees are billed through separately, so they are shown beside
              the total rather than added into it — the same way the printed bill
              carries them on their own sheet. */}
          {hasNrldc && (
            <span style={{ display: 'block', color: 'var(--text-light)' }}>
              plus NRLDC fees {fmtCurrency(total('nrldc_fee'))}, billed through separately
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The allocation master the bill is split on. */
/** The allocation master the bill is split on, and the editor for it. */
function AllocationSheet({ alloc, station, canWrite, onSaved }) {
  const [paste, setPaste] = useState('');
  const [editing, setEditing] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const parsed = useMemo(() => parseAllocationPaste(paste), [paste]);

  async function save(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const r = await api.hydroBilling.replaceAllocations({
        contract_id: station.id,
        effective_from: effectiveFrom,
        source_note: note || null,
        rows: parsed.rows,
      });
      setEditing(false); setPaste(''); setNote('');
      onSaved(r);
    } catch (e2) {
      setErr(e2.response?.data?.error || e2.message);
    } finally {
      setSaving(false);
    }
  }

  if (!alloc) return null;
  const columns = [
    { key: 'sr_no', header: '#' },
    { key: 'beneficiary_name', header: 'Beneficiary' },
    { key: 'parent_state', header: 'Rolls up to', render: (r) => r.parent_state || '—' },
    { key: 'pct_incl_free', header: 'Wtd. avg. % incl. free power', render: (r) => pctText(r.pct_incl_free) },
    { key: 'pct_rea', header: 'As per REA (after SoR to HPSEB)', render: (r) => pctText(r.pct_rea) },
    { key: 'pct_excl_free', header: `Excl. ${alloc.fehs_pct}% free power`, render: (r) => pctText(r.pct_excl_free) },
    { key: 'pct_proportionate', header: 'Proportionate (charging basis)', render: (r) => pctText(r.pct_proportionate) },
    {
      key: 'is_home_state',
      header: 'Home state',
      render: (r) => (r.is_home_state ? <Badge label="carries free power" /> : '—'),
    },
  ];
  const sum = (k) => alloc.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const reaTotal = sum('pct_rea');
  const closes = alloc.rows.length > 0 && Math.abs(reaTotal - 100) <= 0.01;

  return (
    <div>
      <p style={{ color: 'var(--text-light)', fontSize: 13, marginTop: 0 }}>
        Only the REA percentage is held as master data. The free energy to the home state is carved
        out of that state&apos;s own share, and the remainder is scaled back to 100% so it can carry
        the station&apos;s charges — which is why the two right-hand columns are derived here rather
        than keyed in.
      </p>

      {alloc.rows.length === 0 ? (
        <div className="alert alert-warning" role="alert">
          {station?.station_name || 'This station'} has no beneficiary allocation on file, so no bill
          can be raised for it. Paste its REA allocation sheet below.
        </div>
      ) : (
        <>
          <Table columns={columns} rows={alloc.rows} caption="Weighted average capacity allocation to beneficiaries" />
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }}>
            Totals — REA {reaTotal.toFixed(6)}% ·
            {' '}excl. free power {sum('pct_excl_free').toFixed(6)}% ·
            {' '}charging basis {sum('pct_proportionate').toFixed(6)}%
            {!closes && (
              <span style={{ color: 'var(--red)', marginLeft: 8 }}>
                — does not close on 100%, so no bill can be raised until it is corrected
              </span>
            )}
          </div>
        </>
      )}

      {canWrite && !editing && (
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>
          {alloc.rows.length ? 'Replace the allocation sheet' : 'Enter the allocation sheet'}
        </button>
      )}

      {canWrite && editing && (
        <form onSubmit={save} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
          <p style={{ color: 'var(--text-light)', fontSize: 13, marginTop: 0 }}>
            Paste the REA allocation sheet — one beneficiary per line, name and percentage separated
            by a tab (a copy straight out of Excel works). Use the percentage that includes equity
            and free power, after any Sale of Rights share has been reallocated. Add a third column
            for the state a discom rolls up to, and mark the home state that receives the free power
            with a <code>*</code> after its name. Saving replaces the whole sheet for this date;
            bills already raised keep the percentages they were computed on.
          </p>
          <div className="form-grid">
            <Field label="Effective from" required htmlFor="hb-eff">
              <input
                id="hb-eff" type="date" value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)} required
              />
            </Field>
            <Field label="Source" htmlFor="hb-note">
              <input
                id="hb-note" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Provisional REA, RHPS, FY 2026-2027"
              />
            </Field>
          </div>
          <Field label="Allocation sheet" required htmlFor="hb-paste">
            <textarea
              id="hb-paste" rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} required
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              placeholder={'CHANDIGARH\t1.714551\nTPDDL\t2.905400\tDELHI\nGoHP*\t34.000000'}
            />
          </Field>

          {paste.trim() && (
            <div style={{
              padding: '10px 12px', marginBottom: 12, borderRadius: 4,
              background: 'var(--bg-subtle, #f7fafc)', fontVariantNumeric: 'tabular-nums',
            }}>
              <div>
                Read {parsed.rows.length} beneficiaries, totalling{' '}
                <strong style={{ color: parsed.closesOn100 ? 'var(--green, #276749)' : 'var(--red)' }}>
                  {parsed.total.toFixed(6)}%
                </strong>
                {parsed.closesOn100 ? ' — closes on 100%' : ' — must close on 100% before a bill can be raised'}
              </div>
              {parsed.rows.some((r) => r.is_home_state) ? (
                <div style={{ color: 'var(--text-light)', fontSize: 12 }}>
                  Home state: {parsed.rows.filter((r) => r.is_home_state).map((r) => r.beneficiary_name).join(', ')}
                  {' '}— carries the {alloc.fehs_pct}% free power
                </div>
              ) : (
                <div style={{ color: 'var(--red)', fontSize: 12 }}>
                  No home state marked — add a <code>*</code> after the name of the state that
                  receives the {alloc.fehs_pct}% free power
                </div>
              )}
              {parsed.errors.map((e2) => (
                <div key={e2} style={{ color: 'var(--red)', fontSize: 12 }}>{e2}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving || !parsed.rows.length}>
              {saving ? 'Saving…' : `Save ${parsed.rows.length || ''} beneficiaries`}
            </button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setErr(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Regulation of power — the screen SJVN's desk knows as "exclude
 * beneficiaries/discoms from energy calculation".
 *
 * When SJVN regulates a beneficiary's supply, that beneficiary's scheduled
 * energy is withheld and shows on the REA as un-requisitioned surplus. The desk
 * ticks who was regulated and enters what was withheld, and the two figures have
 * to reconcile: the deductions must add up to the surplus, or the station would
 * be billing energy it allocated to nobody.
 */
function RegulationPanel({ ursNr, allocations, deductions, setDeductions, e3, previewLines }) {
  const rows = allocations?.rows || [];

  // Each beneficiary's entitlement on its own share — the ACTUAL SCHEDULED
  // ENERGY column, which is what a deduction is capped at.
  //
  // Once the bill has been computed these come from the server, which is the
  // only place they are exact: apportioning divides by the true sum of the
  // percentages and carries the rounding residue, so recomputing them here as
  // E3 x pct/100 lands a fraction of a kWh out. Before the first compute they
  // are shown as that estimate and marked approximate, and no deduction is
  // flagged as too large against a number we know is not exact.
  const exact = React.useMemo(() => {
    const m = {};
    for (const l of previewLines || []) m[l.beneficiary_name] = Number(l.actual_scheduled_energy_kwh) || 0;
    return Object.keys(m).length ? m : null;
  }, [previewLines]);

  const actualOf = (r) => (exact
    ? (exact[r.beneficiary_name] ?? 0)
    : (e3 * Number(r.pct_proportionate)) / 100);
  const total = Object.values(deductions).reduce((a, v) => a + (Number(v) || 0), 0);
  const diff = Math.round((total - ursNr) * 10) / 10;
  const ties = Math.abs(diff) <= 0.1;

  function setOne(name, value) {
    setDeductions((d) => {
      const next = { ...d };
      if (value === '' || Number(value) === 0) delete next[name];
      else next[name] = Number(value);
      return next;
    });
  }

  return (
    <Card title="Regulation of power — exclude beneficiaries from the energy calculation">
      <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
        {fmtNumber(ursNr, 1)} kWh is reported as un-requisitioned surplus for this month. Tick each
        beneficiary whose supply was regulated and enter what was withheld from it. The deductions
        must add up to the surplus before the bill can be raised. A regulated beneficiary still
        carries its capacity charge — only the energy is withheld.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Beneficiary</th>
              <th scope="col">Share</th>
              <th scope="col">
                Actual scheduled energy
                {!exact && (
                  <span style={{ fontWeight: 400, color: 'var(--text-light)', fontSize: 11, display: 'block' }}>
                    approximate until the bill is computed
                  </span>
                )}
              </th>
              <th scope="col">Deducted</th>
              <th scope="col">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const actual = actualOf(r);
              const ded = Number(deductions[r.beneficiary_name]) || 0;
              const over = exact && ded > actual + 0.1;
              return (
                <tr key={r.beneficiary_name}>
                  <td>
                    {r.beneficiary_name}
                    {r.parent_state && (
                      <span style={{ color: 'var(--text-light)', fontSize: 11, marginLeft: 6 }}>· {r.parent_state}</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(r.pct_proportionate).toFixed(6)}%</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNumber(actual, 1)}</td>
                  <td>
                    <input
                      type="number" step="0.1" min="0" max={actual}
                      aria-label={`Deducted scheduled energy for ${r.beneficiary_name}`}
                      value={deductions[r.beneficiary_name] ?? ''}
                      onChange={(e) => setOne(r.beneficiary_name, e.target.value)}
                      style={{ width: 160, borderColor: over ? 'var(--red)' : undefined }}
                      placeholder="0"
                    />
                    {over && (
                      <div style={{ color: 'var(--red)', fontSize: 11 }}>
                        more than it was scheduled
                      </div>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: ded > 0 ? 600 : 400 }}>
                    {fmtNumber(Math.max(0, actual - ded), 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border)',
        fontVariantNumeric: 'tabular-nums', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ color: 'var(--text-light)' }}>
          {Object.keys(deductions).length} beneficiary(ies) regulated
        </span>
        <span style={{ color: ties ? 'var(--green, #276749)' : 'var(--red)' }}>
          Deducted {fmtNumber(total, 1)} kWh against a surplus of {fmtNumber(ursNr, 1)} kWh
          {ties ? ' — they agree' : ` — ${diff > 0 ? 'over by' : 'short by'} ${fmtNumber(Math.abs(diff), 1)} kWh`}
        </span>
      </div>
    </Card>
  );
}

export default function HydroBilling() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [form, setForm] = useState({ ...EMPTY, billing_month: defaultMonth() });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('bill');
  const [alloc, setAlloc] = useState(null);
  const [bills, setBills] = useState([]);
  const [openBill, setOpenBill] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  // Regulation of power: which beneficiaries had supply withheld, keyed by name.
  const [deductions, setDeductions] = useState({});
  // The REA's own per-beneficiary energy (table D2), pasted by the desk.
  const [energyPaste, setEnergyPaste] = useState('');
  const [energyUnit, setEnergyUnit] = useState('LU');
  const [useReaEnergy, setUseReaEnergy] = useState(false);
  const [approvers, setApprovers] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [sending, setSending] = useState(null);
  const [sendForm, setSendForm] = useState({ next_approver_id: '', final_approver_id: '', comments: '' });
  const [acting, setActing] = useState(null);
  const [actForm, setActForm] = useState({ action: 'APPROVE', comments: '', next_approver_id: '', mark_final: true });

  const station = useMemo(() => stations.find((s) => s.id === stationId), [stations, stationId]);

  const parsedEnergy = useMemo(
    () => parseEnergyPaste(energyPaste, { unit: energyUnit }),
    [energyPaste, energyUnit],
  );
  // Only sent once the desk turns it on and the paste actually read; otherwise
  // the bill falls back to splitting E3 on the allocation percentages.
  const scheduledEnergy = useMemo(() => {
    if (!useReaEnergy || !parsedEnergy.rows.length) return null;
    return Object.fromEntries(parsedEnergy.rows.map((r) => [r.beneficiary_name, r.kwh]));
  }, [useReaEnergy, parsedEnergy]);

  const loadInbox = useCallback(() => {
    api.hydroBilling.inbox().then((r) => setInbox(r || [])).catch(() => setInbox([]));
  }, []);

  useEffect(() => {
    api.hydroBilling.approvers().then((r) => setApprovers(r || [])).catch(() => setApprovers([]));
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    api.hydroBilling.stations()
      .then((list) => {
        setStations(list || []);
        if (list?.length) setStationId((cur) => cur || list[0].id);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const loadBills = useCallback(() => {
    if (!stationId) { setBills([]); return; }
    api.hydroBilling.list({ contract_id: stationId })
      .then((r) => setBills(Array.isArray(r) ? r : []))
      .catch(() => setBills([]));
  }, [stationId]);
  useEffect(loadBills, [loadBills]);



  // Changing the station or the month invalidates whatever is on screen: a
  // preview left showing another month's numbers is worse than an empty panel.
  useEffect(() => {
    setPreview(null); setNotice(''); setDeductions({});
    setEnergyPaste(''); setUseReaEnergy(false);
  }, [stationId, form.billing_month, form.bill_kind]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const loadAllocations = useCallback(() => {
    if (!stationId) { setAlloc(null); return; }
    api.hydroBilling.allocations({ contract_id: stationId, month: form.billing_month })
      .then(setAlloc)
      .catch(() => setAlloc(null));
  }, [stationId, form.billing_month]);

  useEffect(loadAllocations, [loadAllocations]);

  // Saving a sheet can make a station billable, so the station list is reloaded
  // with it — otherwise it would keep reading "(not ready)".
  function onAllocationSaved(r) {
    setNotice(r.warning
      ? `Allocation sheet saved — ${r.rows.length} beneficiaries. ${r.warning}`
      : `Allocation sheet saved — ${r.rows.length} beneficiaries totalling 100%. ${station?.station_name || 'The station'} can now be billed.`);
    loadAllocations();
    api.hydroBilling.stations().then((list) => setStations(list || [])).catch(() => {});
  }

  async function doPreview(e) {
    e?.preventDefault();
    setError(''); setNotice(''); setPreviewing(true);
    try {
      const r = await api.hydroBilling.preview({
        contract_id: stationId, ...form, deductions, scheduled_energy: scheduledEnergy,
      });
      setPreview(r);
      setTab('bill');
    } catch (err) {
      setPreview(null);
      setError(err.response?.data?.error || err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function doSave() {
    setError(''); setSaving(true);
    try {
      const r = await api.hydroBilling.create({
        contract_id: stationId, ...form, deductions, scheduled_energy: scheduledEnergy,
      });
      setNotice(`Saved as ${r.bill_no} — ${fmtCurrency(r.total_charges)} across ${r.lines.length} beneficiaries. It is a draft until issued.`);
      setPreview(null);
      loadBills();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function doSend(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.hydroBilling.sendForApproval(sending.id, sendForm);
      setNotice(`${r.bill_no} sent to ${r.with}${r.is_final_step ? ' for final approval' : ''}.`);
      setSending(null);
      loadBills(); loadInbox();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function doAct(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.hydroBilling.act(acting.id, actForm);
      setNotice(
        r.outcome === 'APPROVED' ? `${r.bill_no} approved — it can now be issued.`
          : r.outcome === 'REJECTED' ? `${r.bill_no} rejected.`
            : `${r.bill_no} is now with ${r.now_with}.`,
      );
      setActing(null);
      loadBills(); loadInbox();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function doIssue(bill) {
    setError('');
    try {
      await api.hydroBilling.issue(bill.id, {});
      setNotice(`${bill.bill_no} issued.`);
      loadBills();
      if (openBill?.id === bill.id) setOpenBill(await api.hydroBilling.get(bill.id));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function doCancel(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.hydroBilling.cancel(cancelling.id, cancelReason);
      setNotice(r.warning ? `${cancelling.bill_no} cancelled. ${r.warning}` : `${cancelling.bill_no} cancelled.`);
      setCancelling(null); setCancelReason('');
      loadBills();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  const billColumns = [
    { key: 'bill_no', header: 'Bill no.' },
    { key: 'billing_month', header: 'Month' },
    { key: 'bill_kind', header: 'Kind', render: (r) => <Badge label={r.bill_kind} /> },
    {
      key: 'total_charges',
      header: 'Total charges',
      render: (r) => (
        <span>
          {fmtCurrency(r.total_charges)}
          {r.differential_amount != null && (
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-light)' }}>
              differential {fmtCurrency(r.differential_amount)}
            </span>
          )}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} label={r.status} /> },
    {
      key: 'approval_status',
      header: 'Approval',
      render: (r) => (r.approval_status === 'APPROVED'
        ? <Badge status="APPROVED" label="APPROVED" />
        : <span style={{ fontSize: 12, color: r.approval_status === 'REJECTED' ? 'var(--red)' : 'var(--text-light)' }}>
          {r.approval_status === 'IN_APPROVAL' ? 'with an approver' : r.approval_status === 'REJECTED' ? 'rejected' : 'not sent'}
        </span>),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-link" onClick={() => api.hydroBilling.get(r.id).then(setOpenBill)}>
            View
          </button>
          {canWrite && r.status === 'DRAFT' && r.approval_status === 'NOT_SENT' && (
            <button
              type="button" className="btn-link"
              onClick={() => { setSending(r); setSendForm({ next_approver_id: '', final_approver_id: '', comments: '' }); }}
            >
              Send for approval
            </button>
          )}
          {canWrite && r.status === 'DRAFT' && r.approval_status === 'APPROVED' && (
            <button type="button" className="btn-link" onClick={() => doIssue(r)}>Issue</button>
          )}
          {canWrite && r.status !== 'CANCELLED' && (
            <button type="button" className="btn-link" onClick={() => { setCancelling(r); setCancelReason(''); }}>
              Cancel
            </button>
          )}
        </span>
      ),
    },
  ];

  const bill = preview?.bill;

  return (
    <div>
      <PageHeader
        title="Hydro Billing"
        subtitle="Monthly CERC two-part bill for a hydro station, split across the beneficiaries of the Regional Energy Account"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {inbox.length > 0 && (
        <Card title={`Waiting for your approval (${inbox.length})`}>
          <Table
            columns={[
              { key: 'bill_no', header: 'Bill no.' },
              { key: 'station_name', header: 'Station' },
              { key: 'billing_month', header: 'Month' },
              { key: 'bill_kind', header: 'Kind', render: (r) => <Badge label={r.bill_kind} /> },
              { key: 'total_charges', header: 'Total', render: (r) => fmtCurrency(r.total_charges) },
              {
                key: 'is_final',
                header: '',
                render: (r) => (
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {r.is_final ? <Badge label="final approval" /> : null}
                    <button
                      type="button" className="btn-link"
                      onClick={() => {
                        setActing(r);
                        setActForm({ action: 'APPROVE', comments: '', next_approver_id: '', mark_final: !!r.is_final });
                      }}
                    >
                      Review
                    </button>
                  </span>
                ),
              },
            ]}
            rows={inbox}
          />
        </Card>
      )}

      <Card title="Bill a month">
        <form onSubmit={doPreview}>
          <div className="form-grid">
            <Field label="Station" required htmlFor="hb-station">
              <select id="hb-station" value={stationId} onChange={(e) => setStationId(e.target.value)} required>
                {stations.length === 0 && <option value="">No hydro station on file</option>}
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.station_name} — {s.contract_no}{s.ready ? '' : ' (not ready)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Billing month" required htmlFor="hb-month">
              <input id="hb-month" type="month" value={form.billing_month} onChange={set('billing_month')} required />
            </Field>
            <Field label="Bill kind" htmlFor="hb-kind">
              <select id="hb-kind" value={form.bill_kind} onChange={set('bill_kind')}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
          </div>

          {station && !station.ready && (
            <div className="alert alert-warning" role="alert">
              {station.station_name} cannot be billed yet — still missing: {station.missing.join(', ')}.
            </div>
          )}

          <div className="form-grid">
            <Field label="Ex-bus scheduled energy for the month (kWh)" htmlFor="hb-e1">
              <input
                id="hb-e1" type="number" step="0.1" value={form.ex_bus_scheduled_kwh}
                onChange={set('ex_bus_scheduled_kwh')} placeholder="from the month's energy data if left blank"
              />
            </Field>
            <Field label="Free power to the home state as per REA (kWh)" htmlFor="hb-e2">
              <input
                id="hb-e2" type="number" step="0.1" value={form.free_power_kwh}
                onChange={set('free_power_kwh')} placeholder={station ? `${station.free_energy_home_state}% of the above if left blank` : ''}
              />
            </Field>
            <Field label="Plant availability achieved, PAFM (%)" htmlFor="hb-pafm">
              <input
                id="hb-pafm" type="number" step="0.001" value={form.pafm_percent}
                onChange={set('pafm_percent')} placeholder={station ? `normative ${station.napaf_percent}% if left blank` : ''}
              />
            </Field>
            <Field label="Beta factor as certified by NRPC" htmlFor="hb-beta">
              <input
                id="hb-beta" type="number" step="0.001" min="0" max="1" value={form.beta_value}
                onChange={set('beta_value')} placeholder="from the station's β certificate if left blank"
              />
            </Field>
            <Field label="NRLDC fees issued by POSOCO (₹)" htmlFor="hb-nrldc">
              <input id="hb-nrldc" type="number" step="0.01" value={form.nrldc_total_fee} onChange={set('nrldc_total_fee')} placeholder="0" />
            </Field>
            <Field label="Un-requisitioned surplus, URS_NR (kWh)" htmlFor="hb-urs">
              <input
                id="hb-urs" type="number" step="0.1" min="0" value={form.urs_nr_kwh}
                onChange={set('urs_nr_kwh')} placeholder="0 — nothing regulated this month"
              />
            </Field>
            <Field label="REA reference" htmlFor="hb-rea">
              <input id="hb-rea" value={form.rea_reference} onChange={set('rea_reference')} placeholder="e.g. Provisional REA dated 01.07.2026" />
            </Field>
          </div>

          {form.bill_kind === 'REVISION' && (
            <Field label="What changed" required htmlFor="hb-reason">
              <input
                id="hb-reason" value={form.revision_reason} onChange={set('revision_reason')} required
                placeholder="e.g. β certified at 1.00 by NRPC on 19.06.2026"
              />
            </Field>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn" disabled={!stationId || previewing}>
              {previewing ? 'Computing…' : 'Compute the bill'}
            </button>
            {preview && canWrite && (
              <button type="button" className="btn btn-primary" onClick={doSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
            )}
          </div>
        </form>
      </Card>

      <Card title="Beneficiary energy from the REA (table D2)">
        <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
          The bill is billed on each beneficiary&apos;s own scheduled energy as the Regional Energy
          Account states it, not on a share of the station total — on NJHPS for June 2026 the two
          differ by a few thousand kWh per beneficiary. Paste the REA&apos;s table D2 column here to
          bill on it; leave this off and each share is derived from the allocation percentages
          instead.
        </p>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="checkbox" checked={useReaEnergy}
            onChange={(e) => setUseReaEnergy(e.target.checked)}
          />
          <span>Bill on the REA&apos;s figures</span>
        </label>

        {useReaEnergy && (
          <>
            <div className="form-grid">
              <Field label="The figures are in" htmlFor="hb-eunit">
                <select id="hb-eunit" value={energyUnit} onChange={(e) => setEnergyUnit(e.target.value)}>
                  <option value="LU">Lakh Units (as the REA prints them)</option>
                  <option value="kWh">kWh</option>
                </select>
              </Field>
            </div>
            <Field label="Table D2 — one beneficiary per line" required htmlFor="hb-epaste">
              <textarea
                id="hb-epaste" rows={8} value={energyPaste}
                onChange={(e) => setEnergyPaste(e.target.value)}
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                placeholder={'CHANDIGARH\t125.396150\nTPDDL\t212.428759\nGoHP\t1608.549250'}
              />
            </Field>

            {energyPaste.trim() && (
              <div style={{
                padding: '10px 12px', marginBottom: 12, borderRadius: 4,
                background: 'var(--bg-subtle, #f7fafc)', fontVariantNumeric: 'tabular-nums',
              }}>
                <div>
                  Read {parsedEnergy.rows.length} beneficiaries, totalling{' '}
                  <strong>{fmtNumber(parsedEnergy.total, 1)} kWh</strong>
                  {energyUnit === 'LU' && (
                    <span style={{ color: 'var(--text-light)' }}> (converted from Lakh Units)</span>
                  )}
                </div>
                {(() => {
                  // The one check that matters: the column has to add up to the
                  // month's saleable energy, or the station is billing energy it
                  // did not allocate.
                  const e3 = preview?.bill?.e3_saleable_scheduled_kwh;
                  if (e3 == null) {
                    return (
                      <div style={{ color: 'var(--text-light)', fontSize: 12 }}>
                        Compute the bill to check this against the month&apos;s saleable energy (E3).
                      </div>
                    );
                  }
                  const diff = Math.round((parsedEnergy.total - e3) * 10) / 10;
                  const ties = Math.abs(diff) <= 1;
                  return (
                    <div style={{ color: ties ? 'var(--green, #276749)' : 'var(--red)', fontSize: 12 }}>
                      Station saleable energy (E3) is {fmtNumber(e3, 1)} kWh —
                      {ties ? ' they agree' : ` ${diff > 0 ? 'over by' : 'short by'} ${fmtNumber(Math.abs(diff), 1)} kWh`}
                    </div>
                  );
                })()}
                {parsedEnergy.errors.map((e2) => (
                  <div key={e2} style={{ color: 'var(--red)', fontSize: 12 }}>{e2}</div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {Number(form.urs_nr_kwh) > 0 && alloc && (
        <RegulationPanel
          ursNr={Number(form.urs_nr_kwh)}
          allocations={alloc}
          deductions={deductions}
          setDeductions={setDeductions}
          previewLines={preview?.lines}
          e3={
            // The month's saleable energy: what the REA scheduled, less the free
            // power to the home state. Entitlements are shares of this.
            preview?.bill?.e3_saleable_scheduled_kwh
            ?? Math.max(0, Number(form.ex_bus_scheduled_kwh || 0) - (
              form.free_power_kwh !== '' ? Number(form.free_power_kwh)
                : Number(form.ex_bus_scheduled_kwh || 0) * (Number(station?.free_energy_home_state) || 0) / 100
            ))
          }
        />
      )}

      {preview && (
        <>
          <div className="stat-grid">
            <StatCard label="Capacity charges" value={fmtCurrency(bill.c5_total_capacity_charge)} hint={`PAFM ${bill.c1_pafm_pct}% against NAPAF ${bill.a11_napaf_pct}%`} />
            <StatCard label="Energy charges" value={fmtCurrency(bill.ee1_energy_charge + bill.ee2_excess_energy_charge)} hint={`${fmtNumber(bill.e3_saleable_scheduled_kwh / 1e6, 2)} MU at ₹${bill.a12_ecr}/kWh`} />
            <StatCard label="Total for the month" value={fmtCurrency(bill.total_charges)} tone="primary" hint={bill.financial_year} />
            <StatCard label="Beneficiaries" value={preview.lines.length} hint={`${bill.a4_fehs_pct}% free power to the home state`} />
          </div>

          {preview.existing?.length > 0 && (
            <div className="alert alert-warning" role="alert">
              {station?.station_name} already has {preview.existing.length} bill(s) for this month:{' '}
              {preview.existing.map((b) => `${b.bill_no} (${b.bill_kind}, ${b.status}, ${fmtCurrency(b.total_charges)})`).join('; ')}.
              {form.bill_kind !== 'REVISION' && ' Raise a revision if you mean to restate it.'}
            </div>
          )}

          <Card
            title={`${station?.station_name || 'Station'} — ${bill.billing_month} ${bill.bill_kind.toLowerCase()} bill`}
            actions={
              <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
                energy: {preview.sources.energy} · availability: {preview.sources.pafm} ·
                {' '}β: {preview.sources.beta} · cumulative: {preview.sources.cumulative}
                {preview.sources.beneficiary_energy && (
                  <span style={{ display: 'block' }}>
                    beneficiary energy: {preview.sources.beneficiary_energy}
                  </span>
                )}
              </span>
            }
          >
            <Tabs>
              <Tab active={tab === 'bill'} onClick={() => setTab('bill')}>Station bill</Tab>
              <Tab active={tab === 'beneficiaries'} onClick={() => setTab('beneficiaries')}>
                Beneficiary breakup ({preview.lines.length})
              </Tab>
              <Tab active={tab === 'allocation'} onClick={() => setTab('allocation')}>Allocation sheet</Tab>
            </Tabs>
            {tab === 'bill' && <StationBillSheet bill={bill} />}
            {tab === 'beneficiaries' && <BeneficiarySheet lines={preview.lines} bill={bill} />}
            {tab === 'allocation' && (
              <AllocationSheet alloc={alloc} station={station} canWrite={canWrite} onSaved={onAllocationSaved} />
            )}
          </Card>
        </>
      )}

      {!preview && (
        <Card title={`Allocation sheet — ${station?.station_name || 'station'}`}>
          <AllocationSheet alloc={alloc} station={station} canWrite={canWrite} onSaved={onAllocationSaved} />
        </Card>
      )}

      <Card title={`Bills raised for ${station?.station_name || 'this station'}`}>
        <Table
          columns={billColumns}
          rows={bills}
          emptyMessage="No bill has been raised for this station yet."
        />
      </Card>

      <Modal open={!!openBill} onClose={() => setOpenBill(null)} title={openBill ? `${openBill.bill_no} — ${openBill.station_name} ${openBill.billing_month}` : ''} width={980}>
        {openBill && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 13 }}>
              <Badge status={openBill.status} label={openBill.status} /> · {openBill.bill_kind} · FY {openBill.financial_year}
              {openBill.rea_reference && <> · {openBill.rea_reference}</>}
              {openBill.revises_bill_no && <> · revises {openBill.revises_bill_no}</>}
              {openBill.revision_reason && <div style={{ marginTop: 4 }}>{openBill.revision_reason}</div>}
            </div>
            <StationBillSheet bill={openBill} />
            <BeneficiarySheet lines={openBill.lines || []} bill={openBill} />
          </div>
        )}
      </Modal>

      <Modal open={!!sending} onClose={() => setSending(null)} title={`Send ${sending?.bill_no || ''} for approval`}>
        <form onSubmit={doSend}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            The final approver is the signature the beneficiaries&apos; bill goes out on and stays
            fixed once set. Whoever it goes to next may approve it, send it on, or reject it. The
            person who raised the bill cannot approve it.
          </p>
          <div className="form-grid">
            <Field label="Next approver" required htmlFor="hb-next">
              <select id="hb-next" required value={sendForm.next_approver_id}
                onChange={(e) => setSendForm({ ...sendForm, next_approver_id: e.target.value })}>
                <option value="">Select…</option>
                {approvers.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.is_self}>
                    {a.name} ({a.role}){a.is_self ? ' — you raised this bill' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Final approver" required htmlFor="hb-final">
              <select id="hb-final" required value={sendForm.final_approver_id}
                onChange={(e) => setSendForm({ ...sendForm, final_approver_id: e.target.value })}>
                <option value="">Select…</option>
                {approvers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </Field>
          </div>
          <Field label="Comments" htmlFor="hb-sc">
            <input id="hb-sc" value={sendForm.comments}
              onChange={(e) => setSendForm({ ...sendForm, comments: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary">Send</button>
            <button type="button" className="btn" onClick={() => setSending(null)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!acting} onClose={() => setActing(null)} title={`Review ${acting?.bill_no || ''}`}>
        {acting && (
          <form onSubmit={doAct}>
            <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
              {acting.station_name} · {acting.billing_month} · {fmtCurrency(acting.total_charges)}
              {acting.is_final && ' — this is the final approval, and approving here releases the bill for issue.'}
            </p>
            <Field label="Decision" htmlFor="hb-act">
              <select id="hb-act" value={actForm.action}
                onChange={(e) => setActForm({ ...actForm, action: e.target.value })}>
                <option value="APPROVE">Approve</option>
                <option value="FORWARD">Forward to someone else</option>
                <option value="REJECT">Reject</option>
              </select>
            </Field>

            {actForm.action !== 'REJECT' && !acting.is_final && (
              <>
                {actForm.action === 'APPROVE' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
                    <input type="checkbox" checked={actForm.mark_final}
                      onChange={(e) => setActForm({ ...actForm, mark_final: e.target.checked })} />
                    <span>This is the final approval — no further review needed</span>
                  </label>
                )}
                {(actForm.action === 'FORWARD' || !actForm.mark_final) && (
                  <Field label="Send it to" required htmlFor="hb-nextapp">
                    <select id="hb-nextapp" required value={actForm.next_approver_id}
                      onChange={(e) => setActForm({ ...actForm, next_approver_id: e.target.value })}>
                      <option value="">Select…</option>
                      {approvers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
                    </select>
                  </Field>
                )}
              </>
            )}

            <Field label="Comments" required htmlFor="hb-ac">
              <input id="hb-ac" required value={actForm.comments}
                onChange={(e) => setActForm({ ...actForm, comments: e.target.value })}
                placeholder="What you checked, or why you are rejecting it" />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary">Record the decision</button>
              <button type="button" className="btn" onClick={() => setActing(null)}>Close</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.bill_no || ''}`}>
        <form onSubmit={doCancel}>
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            A cancelled month drops out of the energy carried forward to later months in the same
            financial year, so any bill already raised after it will need re-checking.
          </p>
          <Field label="Reason" required htmlFor="hb-cancel">
            <input id="hb-cancel" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} required />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary">Cancel the bill</button>
            <button type="button" className="btn" onClick={() => setCancelling(null)}>Keep it</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
