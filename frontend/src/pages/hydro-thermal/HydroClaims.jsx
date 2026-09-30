import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, Tabs, Tab,
  fmtCurrency, fmtNumber,
} from '../../components/ui.jsx';

// What a hydro station bills besides its monthly energy bill.
//
// Additional charges — auxiliary consumption beyond the normative allowance,
// exchange rate variation on a foreign loan — accrue month by month and are
// then claimed together on one bill, split across the beneficiaries the way the
// capacity charge is. TCS is the other shape entirely: charged on money already
// received from one beneficiary, so it is never split.
//
// Both become ordinary bills once raised, and go up the same approval chain.

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const EMPTY_CHARGE = { charge_type: 'AUX_CONSUMPTION', period_month: thisMonth(), amount: '', remarks: '' };
const EMPTY_TCS = {
  beneficiary: '', billing_month: thisMonth(), payment_date: today(),
  amount_received: '', tcs_applicable_amount: '', tcs_rate_pct: '0.1', remarks: '',
};

export default function HydroClaims() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [tab, setTab] = useState('charges');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [charges, setCharges] = useState(null);
  const [selected, setSelected] = useState({});
  const [chargeForm, setChargeForm] = useState(null);
  const [claimForm, setClaimForm] = useState(null);

  const [tcs, setTcs] = useState([]);
  const [tcsForm, setTcsForm] = useState(null);
  const [tcsPreview, setTcsPreview] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState([]);

  const station = useMemo(() => stations.find((s) => s.id === stationId), [stations, stationId]);

  useEffect(() => {
    api.hydroBilling.stations()
      .then((list) => {
        setStations(list || []);
        if (list?.length) setStationId((cur) => cur || list[0].id);
      })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const load = useCallback(() => {
    if (!stationId) { setCharges(null); setTcs([]); setBeneficiaries([]); return; }
    setSelected({});
    api.hydroBilling.charges({ contract_id: stationId, include_claimed: 'true' })
      .then(setCharges).catch(() => setCharges(null));
    api.hydroBilling.tcsClaims({ contract_id: stationId })
      .then((r) => setTcs(r || [])).catch(() => setTcs([]));
    // The TCS picker only offers beneficiaries this station actually has.
    api.hydroBilling.allocations({ contract_id: stationId, month: thisMonth() })
      .then((r) => setBeneficiaries(r?.rows || []))
      .catch(() => setBeneficiaries([]));
  }, [stationId]);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await fn();
      setNotice(typeof msg === 'function' ? msg(r) : msg);
      load();
      return r;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const unclaimed = charges?.unclaimed || [];
  const chosen = unclaimed.filter((c) => selected[c.id]);
  // Nothing ticked means the claim sweeps everything outstanding, which is the
  // usual case and matches what the claim endpoint does with no ids.
  const claimRows = chosen.length ? chosen : unclaimed;
  const claimTotal = claimRows.reduce((a, c) => a + Number(c.amount), 0);

  async function doAddCharge(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.addCharge({ contract_id: stationId, ...chargeForm }),
      (res) => `Recorded ${fmtCurrency(res.amount)} for ${res.period_month}.`,
    );
    if (r) setChargeForm(null);
  }

  async function doClaim(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.claimCharges({
        contract_id: stationId,
        billing_month: claimForm.billing_month,
        bill_date: claimForm.bill_date || null,
        remarks: claimForm.remarks || null,
        charge_ids: chosen.length ? chosen.map((c) => c.id) : null,
      }),
      (res) => `${res.bill_no} raised for ${fmtCurrency(res.total_charges)} across ${res.lines} beneficiaries — send it for approval like any other bill.`,
    );
    if (r) setClaimForm(null);
  }

  async function doTcs(e) {
    e.preventDefault();
    const r = await run(
      () => api.hydroBilling.claimTcs({ contract_id: stationId, ...tcsForm }),
      (res) => `${res.bill_no} raised — ${fmtCurrency(res.tcs_amount)} TCS from ${res.beneficiary_name}.`,
    );
    if (r) { setTcsForm(null); setTcsPreview(null); }
  }

  // Show what the rate works out to before anything is raised.
  useEffect(() => {
    if (!tcsForm?.amount_received || !tcsForm?.tcs_rate_pct) { setTcsPreview(null); return; }
    let live = true;
    api.hydroBilling.previewTcs({
      amount_received: Number(tcsForm.amount_received),
      tcs_applicable_amount: tcsForm.tcs_applicable_amount === '' ? null : Number(tcsForm.tcs_applicable_amount),
      tcs_rate_pct: Number(tcsForm.tcs_rate_pct),
    })
      .then((r) => { if (live) setTcsPreview({ ok: true, ...r }); })
      .catch((e) => { if (live) setTcsPreview({ ok: false, error: e.response?.data?.error || e.message }); });
    return () => { live = false; };
  }, [tcsForm?.amount_received, tcsForm?.tcs_applicable_amount, tcsForm?.tcs_rate_pct]);

  return (
    <div>
      <PageHeader
        title="Additional Charges & TCS"
        subtitle="What a hydro station bills besides its monthly energy bill"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card title="Station">
        <Field label="Station" htmlFor="hc-station">
          <select id="hc-station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.station_name} — {s.contract_no}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Tabs>
        <Tab active={tab === 'charges'} onClick={() => setTab('charges')}>
          Additional charges{unclaimed.length ? ` (${unclaimed.length} unclaimed)` : ''}
        </Tab>
        <Tab active={tab === 'tcs'} onClick={() => setTab('tcs')}>
          TCS{tcs.length ? ` (${tcs.length})` : ''}
        </Tab>
      </Tabs>

      {tab === 'charges' && (
        <>
          <div className="stat-grid">
            <StatCard label="Unclaimed entries" value={unclaimed.length} hint="waiting to go on a claim bill" />
            <StatCard
              label="Unclaimed total"
              value={fmtCurrency(charges?.unclaimed_total || 0)}
              tone={(charges?.unclaimed_total || 0) !== 0 ? 'warning' : 'default'}
              hint="net of any credits"
            />
            <StatCard label="Already claimed" value={(charges?.claimed || []).length} hint="entries on raised bills" />
          </div>

          <Card
            title="Charges waiting to be claimed"
            actions={canWrite && (
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setChargeForm({ ...EMPTY_CHARGE })}>
                  Record a charge
                </button>
                <button
                  type="button" className="btn btn-primary" disabled={!unclaimed.length || busy}
                  onClick={() => setClaimForm({ billing_month: thisMonth(), bill_date: today(), remarks: '' })}
                >
                  Claim on a bill
                </button>
              </span>
            )}
          >
            <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
              Entries accrue against the month they arose in and are claimed together later. Tick
              specific entries to claim only those; with nothing ticked the claim takes everything
              outstanding up to the month you choose. A negative entry is a credit and nets off.
            </p>
            <Table
              columns={[
                ...(canWrite ? [{
                  key: 'pick',
                  header: '',
                  render: (r) => (
                    <input
                      type="checkbox"
                      aria-label={`Include ${r.charge_type_label} for ${r.period_month}`}
                      checked={!!selected[r.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))}
                    />
                  ),
                }] : []),
                { key: 'period_month', header: 'Month' },
                { key: 'charge_type_label', header: 'Charge' },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (r) => (
                    <span style={{ color: Number(r.amount) < 0 ? 'var(--green, #276749)' : 'var(--text)' }}>
                      {fmtCurrency(r.amount)}{Number(r.amount) < 0 ? ' credit' : ''}
                    </span>
                  ),
                },
                { key: 'remarks', header: 'Remarks', render: (r) => r.remarks || '—' },
              ]}
              rows={unclaimed}
              emptyMessage="Nothing outstanding — every entry has been claimed."
            />
          </Card>

          {(charges?.claimed || []).length > 0 && (
            <Card title="Already claimed">
              <Table
                columns={[
                  { key: 'period_month', header: 'Month' },
                  { key: 'charge_type', header: 'Charge', render: (r) => r.charge_type.replace(/_/g, ' ').toLowerCase() },
                  { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
                  { key: 'bill_no', header: 'Claimed on', render: (r) => r.bill_no || '—' },
                  { key: 'status', header: 'Bill status', render: (r) => (r.status ? <Badge status={r.status} label={r.status} /> : '—') },
                ]}
                rows={charges.claimed}
              />
            </Card>
          )}
        </>
      )}

      {tab === 'tcs' && (
        <Card
          title="TCS claimed from beneficiaries"
          actions={canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setTcsForm({ ...EMPTY_TCS })}>
              Claim TCS
            </button>
          )}
        >
          <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
            Tax collected at source is charged on money actually received, so a claim is against one
            beneficiary and carries the receipt it was computed on. It is never split across the
            station the way a capacity charge is.
          </p>
          <Table
            columns={[
              { key: 'bill_no', header: 'Bill no.', render: (r) => r.bill_no || '—' },
              { key: 'period_month', header: 'Month' },
              { key: 'beneficiary_name', header: 'Beneficiary' },
              { key: 'payment_date', header: 'Payment date', render: (r) => r.payment_date || '—' },
              { key: 'amount_received', header: 'Received', render: (r) => fmtCurrency(r.amount_received) },
              { key: 'tcs_applicable_amount', header: 'Applicable', render: (r) => fmtCurrency(r.tcs_applicable_amount) },
              { key: 'tcs_rate_pct', header: 'Rate', render: (r) => `${r.tcs_rate_pct}%` },
              { key: 'tcs_amount', header: 'TCS', render: (r) => <strong>{fmtCurrency(r.tcs_amount)}</strong> },
              { key: 'status', header: 'Bill', render: (r) => (r.status ? <Badge status={r.status} label={r.status} /> : '—') },
            ]}
            rows={tcs}
            emptyMessage="No TCS has been claimed on this station."
          />
        </Card>
      )}

      <Modal open={!!chargeForm} onClose={() => setChargeForm(null)} title="Record an additional charge">
        {chargeForm && (
          <form onSubmit={doAddCharge}>
            <div className="form-grid">
              <Field label="Charge" required htmlFor="hc-type">
                <select
                  id="hc-type" required value={chargeForm.charge_type}
                  onChange={(e) => setChargeForm({ ...chargeForm, charge_type: e.target.value })}
                >
                  {(charges?.charge_types || []).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Month it arose in" required htmlFor="hc-month">
                <input
                  id="hc-month" type="month" required value={chargeForm.period_month}
                  onChange={(e) => setChargeForm({ ...chargeForm, period_month: e.target.value })}
                />
              </Field>
              <Field label="Amount (₹)" required htmlFor="hc-amt">
                <input
                  id="hc-amt" type="number" step="0.01" required value={chargeForm.amount}
                  onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                  placeholder="negative for a credit"
                />
              </Field>
            </div>
            <Field label="Remarks" htmlFor="hc-rem">
              <input
                id="hc-rem" value={chargeForm.remarks}
                onChange={(e) => setChargeForm({ ...chargeForm, remarks: e.target.value })}
                placeholder="what this is for — it goes on the claim bill"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>Record it</button>
              <button type="button" className="btn" onClick={() => setChargeForm(null)}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!claimForm} onClose={() => setClaimForm(null)} title="Claim additional charges on a bill" width={620}>
        {claimForm && (
          <form onSubmit={doClaim}>
            <div style={{
              padding: '10px 12px', marginBottom: 12, borderRadius: 4,
              background: 'var(--bg-subtle, #f7fafc)', fontVariantNumeric: 'tabular-nums',
            }}>
              {chosen.length
                ? `${chosen.length} entry(ies) ticked`
                : `All ${unclaimed.length} outstanding entry(ies)`}
              {' — '}
              <strong>{fmtCurrency(claimTotal)}</strong>
              <div style={{ color: 'var(--text-light)', fontSize: 12 }}>
                Split across the beneficiaries on the same basis as the capacity charge, because
                these are costs of the station rather than of anyone&apos;s energy.
              </div>
            </div>
            <div className="form-grid">
              <Field label="Claim for the month" required htmlFor="hc-cmonth">
                <input
                  id="hc-cmonth" type="month" required value={claimForm.billing_month}
                  onChange={(e) => setClaimForm({ ...claimForm, billing_month: e.target.value })}
                />
              </Field>
              <Field label="Bill date" htmlFor="hc-cdate">
                <input
                  id="hc-cdate" type="date" value={claimForm.bill_date}
                  onChange={(e) => setClaimForm({ ...claimForm, bill_date: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Remarks" htmlFor="hc-crem">
              <input
                id="hc-crem" value={claimForm.remarks}
                onChange={(e) => setClaimForm({ ...claimForm, remarks: e.target.value })}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !claimRows.length}>
                Raise the claim bill
              </button>
              <button type="button" className="btn" onClick={() => setClaimForm(null)}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!tcsForm} onClose={() => { setTcsForm(null); setTcsPreview(null); }} title="Claim TCS" width={620}>
        {tcsForm && (
          <form onSubmit={doTcs}>
            <div className="form-grid">
              <Field label="Beneficiary" required htmlFor="hc-tben">
                <select
                  id="hc-tben" required value={tcsForm.beneficiary}
                  onChange={(e) => setTcsForm({ ...tcsForm, beneficiary: e.target.value })}
                >
                  <option value="">Select…</option>
                  {beneficiaries.map((b) => (
                    <option key={b.beneficiary_name} value={b.beneficiary_name}>{b.beneficiary_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Month" required htmlFor="hc-tmonth">
                <input
                  id="hc-tmonth" type="month" required value={tcsForm.billing_month}
                  onChange={(e) => setTcsForm({ ...tcsForm, billing_month: e.target.value })}
                />
              </Field>
              <Field label="Payment date" htmlFor="hc-tpd">
                <input
                  id="hc-tpd" type="date" value={tcsForm.payment_date}
                  onChange={(e) => setTcsForm({ ...tcsForm, payment_date: e.target.value })}
                />
              </Field>
              <Field label="Amount received (₹)" required htmlFor="hc-trec">
                <input
                  id="hc-trec" type="number" step="0.01" min="0.01" required value={tcsForm.amount_received}
                  onChange={(e) => setTcsForm({ ...tcsForm, amount_received: e.target.value })}
                />
              </Field>
              <Field label="TCS applicable amount (₹)" htmlFor="hc-tapp">
                <input
                  id="hc-tapp" type="number" step="0.01" min="0" value={tcsForm.tcs_applicable_amount}
                  onChange={(e) => setTcsForm({ ...tcsForm, tcs_applicable_amount: e.target.value })}
                  placeholder="the whole receipt if left blank"
                />
              </Field>
              <Field label="TCS rate (%)" required htmlFor="hc-trate">
                <input
                  id="hc-trate" type="number" step="0.001" min="0.001" max="100" required
                  value={tcsForm.tcs_rate_pct}
                  onChange={(e) => setTcsForm({ ...tcsForm, tcs_rate_pct: e.target.value })}
                />
              </Field>
            </div>

            {tcsPreview && (
              <div style={{
                padding: '10px 12px', marginBottom: 12, borderRadius: 4,
                background: 'var(--bg-subtle, #f7fafc)', fontVariantNumeric: 'tabular-nums',
              }}>
                {tcsPreview.ok ? (
                  <>
                    {tcsForm.tcs_rate_pct}% of {fmtCurrency(tcsPreview.tcs_applicable_amount)}
                    {' = '}<strong>{fmtCurrency(tcsPreview.tcs_amount)}</strong>
                  </>
                ) : (
                  <span style={{ color: 'var(--red)' }}>{tcsPreview.error}</span>
                )}
              </div>
            )}

            <Field label="Remarks" htmlFor="hc-trem">
              <input
                id="hc-trem" value={tcsForm.remarks}
                onChange={(e) => setTcsForm({ ...tcsForm, remarks: e.target.value })}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !tcsPreview?.ok}>
                Raise the TCS bill
              </button>
              <button type="button" className="btn" onClick={() => { setTcsForm(null); setTcsPreview(null); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
