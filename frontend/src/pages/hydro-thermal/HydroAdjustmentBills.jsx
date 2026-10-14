import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../lib/stationVertical.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Field, AlertPopup, Tabs, Tab, fmtCurrency } from '../../components/ui.jsx';

// Bills on months that are already billed.
//
//   Arrear        a revised tariff (a CERC order) applied back to months already
//                 billed. Each month is recomputed on the tariff now on record for
//                 its financial year, with the same energy, availability, β and
//                 beneficiary split, and the difference is billed on one bill.
//   Supplementary a one-off amount on top of a month — a change in law, a cess, an
//                 item the monthly bill missed — apportioned or on one beneficiary.
//
// Both are saved as drafts and processed exactly like a monthly bill: approval,
// issue (which posts them to the beneficiaries' accounts), release and send.

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function HydroAdjustmentBills({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [view, setView] = useState('arrear');
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [bills, setBills] = useState([]);
  const [popup, setPopup] = useState(null);
  const [busy, setBusy] = useState(false);

  const [arrear, setArrear] = useState({ from_month: '', to_month: thisMonth(), reason: '', order_reference: '' });
  const [preview, setPreview] = useState(null);

  const [reasons, setReasons] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [supp, setSupp] = useState({ billing_month: thisMonth(), amount: '', reason: 'CHANGE_IN_LAW', particulars: '', order_reference: '', beneficiary_name: '' });

  const [tariffs, setTariffs] = useState([]);
  const [tariffForm, setTariffForm] = useState({ financial_year: '', annual_afc: '', ecr_excess_rate: '', napaf_percent: '', annual_design_energy_mwh: '', normative_aux: '', order_ref: '' });

  const fail = (title, err) => setPopup({ tone: 'error', title, message: err?.response?.data?.error || err?.message || 'Something went wrong' });

  useEffect(() => {
    api.hydroBilling.stations({ vertical })
      .then((list) => { setStations(list || []); if (list?.length) setStationId((cur) => cur || list[0].id); })
      .catch((e) => fail('Stations could not be loaded', e));
    api.hydroBilling.supplementaryReasons().then(setReasons).catch(() => setReasons([]));
  }, []);

  const loadBills = useCallback(() => {
    if (!stationId) return;
    Promise.all([
      api.hydroBilling.list({ contract_id: stationId, bill_kind: 'ARREAR' }),
      api.hydroBilling.list({ contract_id: stationId, bill_kind: 'SUPPLEMENTARY' }),
    ]).then(([a, b]) => setBills([...(a || []), ...(b || [])].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))))
      .catch(() => setBills([]));
    api.hydroBilling.accounts({ contract_id: stationId }).then((a) => setBeneficiaries((a || []).map((x) => x.beneficiary_name))).catch(() => setBeneficiaries([]));
    api.hydroBilling.tariffs(stationId).then((t) => setTariffs(t || [])).catch(() => setTariffs([]));
  }, [stationId]);
  useEffect(loadBills, [loadBills]);
  useEffect(() => { setPreview(null); }, [stationId, arrear.from_month, arrear.to_month]);

  async function doPreview(e) {
    e.preventDefault();
    if (!arrear.from_month) { setPopup({ tone: 'error', title: 'Choose the months', message: 'Give the first month the revised tariff applies from.' }); return; }
    setBusy(true);
    try {
      setPreview(await api.hydroBilling.arrearPreview({ contract_id: stationId, ...arrear }));
    } catch (err) {
      fail('The arrear could not be worked out', err);
    } finally {
      setBusy(false);
    }
  }

  async function saveArrear() {
    if (arrear.reason.trim().length < 10) {
      setPopup({ tone: 'error', title: 'Say why the arrear arises', message: 'e.g. "CERC order dated 01.10.2026 in Petition 12/GT/2026 revising AFC for 2026-27" — it is printed on the bill.' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.hydroBilling.createArrear({ contract_id: stationId, ...arrear });
      setPreview(null);
      loadBills();
      setPopup({ tone: 'success', title: `${r.bill_no} saved as a draft`, message: `Arrear of ${fmtCurrency(r.total_differential)} over ${r.months.length} month(s). Send it for approval from Monthly Bills & Approval.` });
    } catch (err) {
      fail('The arrear bill was not saved', err);
    } finally {
      setBusy(false);
    }
  }

  async function saveSupplementary(e) {
    e.preventDefault();
    const problems = [];
    if (!(Number(supp.amount) > 0)) problems.push({ label: 'Amount', message: 'Enter an amount greater than zero. To give money back, raise a credit note.' });
    if (supp.particulars.trim().length < 10) problems.push({ label: 'Particulars', message: 'Say what the bill is for, in at least 10 characters — it is printed on the bill.' });
    if (problems.length) { setPopup({ tone: 'error', title: 'The supplementary bill cannot be saved yet', items: problems }); return; }
    setBusy(true);
    try {
      const r = await api.hydroBilling.createSupplementary({ contract_id: stationId, ...supp, amount: Number(supp.amount), beneficiary_name: supp.beneficiary_name || null });
      setSupp({ ...supp, amount: '', particulars: '' });
      loadBills();
      setPopup({ tone: 'success', title: `${r.bill_no} saved as a draft`, message: `${fmtCurrency(r.total_charges)} on ${r.beneficiaries} beneficiary(ies). Send it for approval from Monthly Bills & Approval.` });
    } catch (err) {
      fail('The supplementary bill was not saved', err);
    } finally {
      setBusy(false);
    }
  }

  async function saveTariff(e) {
    e.preventDefault();
    if (!/^\d{4}-\d{4}$/.test(tariffForm.financial_year)) {
      setPopup({ tone: 'error', title: 'Financial year', message: 'Write the financial year as 2026-2027.' });
      return;
    }
    setBusy(true);
    try {
      await api.hydroBilling.setTariff({ contract_id: stationId, ...tariffForm });
      loadBills();
      setPopup({ tone: 'success', title: `Tariff for ${tariffForm.financial_year} saved`, message: 'New bills for that year are computed on it, and an arrear on months already billed can now be worked out.' });
    } catch (err) {
      fail('The tariff was not saved', err);
    } finally {
      setBusy(false);
    }
  }

  const tariffChanged = preview?.months?.filter((m) => m.tariff.afc !== m.tariff.previous_afc || m.tariff.ecr !== m.tariff.previous_ecr) || [];

  return (
    <div>
      <PageHeader
        title="Arrear & Supplementary Bills"
        subtitle="Bills on months already billed — a revised tariff's arrear, or a one-off item — processed through the same approval, issue and ledger as a monthly bill"
      />

      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
      </div>

      <Tabs style={{ marginBottom: 16 }}>
        <Tab active={view === 'arrear'} onClick={() => setView('arrear')}>Arrear bill</Tab>
        <Tab active={view === 'supplementary'} onClick={() => setView('supplementary')}>Supplementary bill</Tab>
        {vertical !== 'THERMAL' && <Tab active={view === 'tariff'} onClick={() => setView('tariff')}>Tariff by financial year</Tab>}
      </Tabs>

      {view === 'arrear' && (
        <Card title="Arrear on a revised tariff">
          <ol style={{ margin: '0 0 14px', paddingLeft: 20, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {vertical === 'THERMAL'
              ? <li>Enter the revised AFC / norms for the financial year under <Link to="/thermal/stations">Station &amp; Tariff</Link> first. Each month is recomputed with the fuel it was billed on.</li>
              : <li>Enter the revised AFC (and any other revised figure) for the financial year in the <button type="button" className="btn-link" onClick={() => setView('tariff')}>Tariff by financial year</button> tab first.</li>}
            <li>Choose the months the revision applies to and preview: each issued month is recomputed on the revised tariff.</li>
            <li>Save it as a draft, then send it for approval and issue it from Monthly Bills & Approval. A negative arrear is credited to the beneficiary.</li>
          </ol>
          <form onSubmit={doPreview} noValidate>
            <div className="form-grid">
              <Field label="From month" required>
                <input type="month" value={arrear.from_month} onChange={(e) => setArrear({ ...arrear, from_month: e.target.value })} />
              </Field>
              <Field label="To month" required>
                <input type="month" value={arrear.to_month} onChange={(e) => setArrear({ ...arrear, to_month: e.target.value })} />
              </Field>
              <Field label="Why the arrear arises" required>
                <input value={arrear.reason} placeholder="CERC order dated … revising AFC for 2026-27" onChange={(e) => setArrear({ ...arrear, reason: e.target.value })} />
              </Field>
              <Field label="Order reference">
                <input value={arrear.order_reference} placeholder="e.g. Petition No. 12/GT/2026" onChange={(e) => setArrear({ ...arrear, order_reference: e.target.value })} />
              </Field>
            </div>
            <button type="submit" className="btn btn-secondary" disabled={busy || !stationId}>{busy ? 'Working…' : 'Preview arrear'}</button>
          </form>

          {preview && (
            <div style={{ marginTop: 18 }}>
              {preview.skipped.length > 0 && (
                <div className="ps-alert amber" style={{ marginBottom: 12 }}>
                  Not included: {preview.skipped.map((s) => `${s.month} (${s.reason})`).join('; ')}
                </div>
              )}
              {preview.months.length > 0 && tariffChanged.length === 0 && (
                <div className="ps-alert amber" style={{ marginBottom: 12 }}>
                  The tariff on record is the same one these months were billed at, so there is no arrear. Update the financial year's tariff first.
                </div>
              )}
              <h4 style={{ margin: '0 0 8px' }}>Month-wise</h4>
              <Table
                columns={[
                  { key: 'month', header: 'Month' },
                  { key: 'basis_bill_no', header: 'Billed on', render: (m) => `${m.basis_bill_no} (${m.basis_kind})` },
                  { key: 'afc', header: 'AFC billed → revised', render: (m) => `${fmtCurrency(m.tariff.previous_afc)} → ${fmtCurrency(m.tariff.afc)}` },
                  { key: 'previously_billed', header: 'Already billed', render: (m) => fmtCurrency(m.previously_billed) },
                  { key: 'revised_amount', header: 'On revised tariff', render: (m) => fmtCurrency(m.revised_amount) },
                  { key: 'differential', header: 'Arrear', render: (m) => <strong>{fmtCurrency(m.differential)}</strong> },
                ]}
                rows={preview.months.map((m) => ({ ...m, id: m.month }))}
                emptyMessage="No month in this range has an issued bill."
              />
              <h4 style={{ margin: '16px 0 8px' }}>Beneficiary-wise</h4>
              <Table
                columns={[
                  { key: 'beneficiary_name', header: 'Beneficiary' },
                  { key: 'capacity_differential', header: 'Capacity charge', render: (b) => fmtCurrency(b.capacity_differential) },
                  { key: 'energy_differential', header: 'Energy charge', render: (b) => fmtCurrency(b.energy_differential) },
                  { key: 'differential', header: 'Arrear', render: (b) => <strong style={{ color: b.differential < 0 ? '#15803d' : undefined }}>{fmtCurrency(b.differential)}{b.differential < 0 ? ' (credit)' : ''}</strong> },
                ]}
                rows={preview.beneficiaries.map((b) => ({ ...b, id: b.beneficiary_name }))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
                <strong>Total arrear: {fmtCurrency(preview.total_differential)}</strong>
                {canWrite && (
                  <button type="button" className="btn btn-primary" disabled={busy || !preview.months.length || tariffChanged.length === 0} onClick={saveArrear}>
                    Save arrear bill as draft
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {view === 'supplementary' && (
        <Card title="Supplementary bill">
          <form onSubmit={saveSupplementary} noValidate>
            <div className="form-grid">
              <Field label="Month it relates to" required>
                <input type="month" value={supp.billing_month} onChange={(e) => setSupp({ ...supp, billing_month: e.target.value })} />
              </Field>
              <Field label="Amount (₹)" required>
                <input type="number" min="0.01" step="0.01" value={supp.amount} onChange={(e) => setSupp({ ...supp, amount: e.target.value })} />
              </Field>
              <Field label="Reason" required>
                <select value={supp.reason} onChange={(e) => setSupp({ ...supp, reason: e.target.value })}>
                  {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Billed to">
                <select value={supp.beneficiary_name} onChange={(e) => setSupp({ ...supp, beneficiary_name: e.target.value })}>
                  <option value="">All beneficiaries — apportioned on the month's allocation</option>
                  {beneficiaries.map((b) => <option key={b} value={b}>{b} only</option>)}
                </select>
              </Field>
              <Field label="Order / notification reference">
                <input value={supp.order_reference} onChange={(e) => setSupp({ ...supp, order_reference: e.target.value })} />
              </Field>
            </div>
            <Field label="Particulars (printed on the bill)" required>
              <textarea rows={3} value={supp.particulars} onChange={(e) => setSupp({ ...supp, particulars: e.target.value })}
                placeholder="e.g. Water cess for September 2026 as per GoHP notification dated …" />
            </Field>
            {canWrite && (
              <button type="submit" className="btn btn-primary" disabled={busy || !stationId}>{busy ? 'Saving…' : 'Save supplementary bill as draft'}</button>
            )}
          </form>
        </Card>
      )}

      {view === 'tariff' && (
        <Card title="Tariff on record, by financial year">
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
            A year's figures here override the contract's for bills of that year. When CERC revises a year's tariff after bills are out,
            enter the revised figures here, then raise the arrear on the months already billed.
          </p>
          <Table
            columns={[
              { key: 'financial_year', header: 'Financial year' },
              { key: 'annual_afc', header: 'AFC (₹)', render: (t) => (t.annual_afc ? fmtCurrency(t.annual_afc) : '—') },
              { key: 'napaf_percent', header: 'NAPAF %', render: (t) => t.napaf_percent ?? '—' },
              { key: 'annual_design_energy_mwh', header: 'Design energy (MWh)', render: (t) => t.annual_design_energy_mwh ?? '—' },
              { key: 'normative_aux', header: 'Aux %', render: (t) => t.normative_aux ?? '—' },
              { key: 'ecr_excess_rate', header: 'Rate beyond DE', render: (t) => t.ecr_excess_rate ?? '—' },
              { key: 'order_ref', header: 'Order', render: (t) => t.order_ref || '—' },
            ]}
            rows={tariffs}
            emptyMessage="No year has its own figures — bills use the contract's."
          />
          {canWrite && (
            <form onSubmit={saveTariff} noValidate style={{ marginTop: 16 }}>
              <div className="form-grid">
                <Field label="Financial year" required><input placeholder="2026-2027" value={tariffForm.financial_year} onChange={(e) => setTariffForm({ ...tariffForm, financial_year: e.target.value })} /></Field>
                <Field label="Annual Fixed Charges (₹, not crore)"><input type="number" value={tariffForm.annual_afc} onChange={(e) => setTariffForm({ ...tariffForm, annual_afc: e.target.value })} /></Field>
                <Field label="NAPAF (%)"><input type="number" step="0.01" value={tariffForm.napaf_percent} onChange={(e) => setTariffForm({ ...tariffForm, napaf_percent: e.target.value })} /></Field>
                <Field label="Annual design energy (MWh)"><input type="number" value={tariffForm.annual_design_energy_mwh} onChange={(e) => setTariffForm({ ...tariffForm, annual_design_energy_mwh: e.target.value })} /></Field>
                <Field label="Normative aux consumption (%)"><input type="number" step="0.01" value={tariffForm.normative_aux} onChange={(e) => setTariffForm({ ...tariffForm, normative_aux: e.target.value })} /></Field>
                <Field label="Rate beyond design energy (₹/kWh)"><input type="number" step="0.0001" value={tariffForm.ecr_excess_rate} onChange={(e) => setTariffForm({ ...tariffForm, ecr_excess_rate: e.target.value })} /></Field>
                <Field label="CERC order reference"><input value={tariffForm.order_ref} onChange={(e) => setTariffForm({ ...tariffForm, order_ref: e.target.value })} /></Field>
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>Save year's tariff</button>
            </form>
          )}
        </Card>
      )}

      <Card title="Arrear and supplementary bills on this station" style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          Process these — send for approval, approve, issue, release, send — from <Link to={pathFor(vertical, 'billing')}>Monthly Bills &amp; Approval</Link>, where they are listed with every other bill of the station.
        </p>
        <Table
          columns={[
            { key: 'bill_no', header: 'Bill no.' },
            { key: 'bill_kind', header: 'Kind', render: (b) => <Badge label={b.bill_kind} /> },
            { key: 'period', header: 'Months', render: (b) => (b.bill_kind === 'ARREAR' ? `${b.arrear_from_month} to ${b.arrear_to_month}` : b.billing_month) },
            { key: 'total_charges', header: 'Amount', render: (b) => fmtCurrency(b.total_charges) },
            { key: 'status', header: 'Status', render: (b) => <Badge status={b.status} label={b.status} /> },
            { key: 'approval_status', header: 'Approval', render: (b) => (b.approval_status === 'IN_APPROVAL' ? `with ${b.pending_with || 'an approver'}` : b.approval_status.replaceAll('_', ' ').toLowerCase()) },
            { key: 'reason', header: 'Reason', render: (b) => <span style={{ fontSize: 12 }}>{b.revision_reason}</span> },
          ]}
          rows={bills}
          emptyMessage="No arrear or supplementary bill on this station yet."
        />
      </Card>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
