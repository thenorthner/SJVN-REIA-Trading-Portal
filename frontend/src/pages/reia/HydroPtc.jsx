import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import {
  PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber,
} from '../../components/ui.jsx';

// Power trading bills raised off a hydro station.
//
// A trade is not a tariff bill: no availability, no design energy, no
// beneficiary allocation. SJVN sells a quantum to one counterparty over a date
// range and is owed the gross sale less the trading expense. Once raised the
// bill behaves like any other — approval, release, despatch, the account,
// payments and reversals all come from the same machinery.

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const EMPTY = {
  billing_month: thisMonth(),
  exchange_beneficiary: '',
  from_date: '',
  to_date: '',
  due_date: '',
  energy_kwh: '',
  gross_sale: '',
  trading_expense: '',
  remarks: '',
};

export default function HydroPtc() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [bills, setBills] = useState([]);
  const [form, setForm] = useState(null);
  const [net, setNet] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
    if (!stationId) { setBills([]); return; }
    api.hydroBilling.ptcBills({ contract_id: stationId })
      .then((r) => setBills(r || []))
      .catch(() => setBills([]));
  }, [stationId]);
  useEffect(load, [load]);

  // The manual's "consolidate" step: show what the trade nets to before it is
  // committed to a bill.
  useEffect(() => {
    if (!form?.gross_sale) { setNet(null); return; }
    let live = true;
    api.hydroBilling.ptcConsolidate({
      gross_sale: Number(form.gross_sale),
      trading_expense: form.trading_expense === '' ? 0 : Number(form.trading_expense),
    })
      .then((r) => { if (live) setNet({ ok: true, ...r }); })
      .catch((e) => { if (live) setNet({ ok: false, error: e.response?.data?.error || e.message }); });
    return () => { live = false; };
  }, [form?.gross_sale, form?.trading_expense]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await api.hydroBilling.createPtc({ contract_id: stationId, ...form });
      setNotice(`${r.bill_no} raised — ${fmtCurrency(r.net_amount)} from ${r.exchange_beneficiary}. Send it for approval like any other bill.`);
      setForm(null); setNet(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  const outstanding = bills.filter((b) => b.status !== 'CANCELLED');
  const totalNet = outstanding.reduce((a, b) => a + Number(b.net_amount), 0);
  const totalEnergy = outstanding.reduce((a, b) => a + Number(b.energy_kwh), 0);

  return (
    <div>
      <PageHeader
        title="Power Trading (PTC)"
        subtitle="Trading bills raised off a hydro station, and what each trade netted"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card
        title="Station"
        actions={canWrite && (
          <button
            type="button" className="btn btn-primary"
            onClick={() => setForm({ ...EMPTY, from_date: '', to_date: '', due_date: '' })}
          >
            Raise a trading bill
          </button>
        )}
      >
        <Field label="Station" htmlFor="pt-station">
          <select id="pt-station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.station_name} — {s.contract_no}</option>
            ))}
          </select>
        </Field>
      </Card>

      {bills.length > 0 && (
        <div className="stat-grid">
          <StatCard label="Trades billed" value={outstanding.length} hint="on this station" />
          <StatCard label="Energy traded" value={`${fmtNumber(totalEnergy / 1e6, 2)} MU`} hint="across those trades" />
          <StatCard label="Net billed" value={fmtCurrency(totalNet)} tone="primary" hint="gross sale less trading expense" />
        </div>
      )}

      <Card title={`Trading bills for ${station?.station_name || 'this station'}`}>
        <Table
          columns={[
            { key: 'bill_no', header: 'Bill no.' },
            { key: 'exchange_beneficiary', header: 'Counterparty' },
            {
              key: 'from_date',
              header: 'Trade window',
              render: (r) => `${r.from_date} → ${r.to_date}`,
            },
            { key: 'energy_kwh', header: 'Energy', render: (r) => `${fmtNumber(r.energy_kwh / 1e6, 2)} MU` },
            { key: 'gross_sale', header: 'Gross sale', render: (r) => fmtCurrency(r.gross_sale) },
            {
              key: 'trading_expense',
              header: 'Trading expense',
              render: (r) => (Number(r.trading_expense) ? `− ${fmtCurrency(r.trading_expense)}` : '—'),
            },
            { key: 'net_amount', header: 'Net', render: (r) => <strong>{fmtCurrency(r.net_amount)}</strong> },
            { key: 'due_date', header: 'Due', render: (r) => r.due_date || '—' },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <span>
                  <Badge status={r.status} label={r.status} />
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-light)' }}>
                    {r.approval_status === 'APPROVED' ? 'approved' : r.approval_status?.toLowerCase().replace('_', ' ')}
                    {r.dispatched_at ? ' · despatched' : r.released_at ? ' · released' : ''}
                  </span>
                </span>
              ),
            },
          ]}
          rows={bills}
          emptyMessage="No trading bill has been raised on this station."
        />
        <p style={{ color: 'var(--text-light)', fontSize: 12, marginTop: 10 }}>
          A trading bill goes up the same approval chain as a tariff bill, and once issued it opens
          an account for the counterparty on the Hydro Account Display — where its payment, any
          reversal and its surcharge are handled exactly the same way.
        </p>
      </Card>

      <Modal open={!!form} onClose={() => { setForm(null); setNet(null); }} title="Raise a trading bill" width={660}>
        {form && (
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="Counterparty" required htmlFor="pt-ben">
                <input
                  id="pt-ben" required value={form.exchange_beneficiary}
                  onChange={(e) => setForm({ ...form, exchange_beneficiary: e.target.value })}
                  placeholder="e.g. PTC India Limited"
                />
              </Field>
              <Field label="Billing month" required htmlFor="pt-month">
                <input
                  id="pt-month" type="month" required value={form.billing_month}
                  onChange={(e) => setForm({ ...form, billing_month: e.target.value })}
                />
              </Field>
              <Field label="From date" required htmlFor="pt-from">
                <input
                  id="pt-from" type="date" required value={form.from_date}
                  onChange={(e) => setForm({ ...form, from_date: e.target.value })}
                />
              </Field>
              <Field label="To date" required htmlFor="pt-to">
                <input
                  id="pt-to" type="date" required value={form.to_date}
                  min={form.from_date || undefined}
                  onChange={(e) => setForm({ ...form, to_date: e.target.value })}
                />
              </Field>
              <Field label="Due date" htmlFor="pt-due">
                <input
                  id="pt-due" type="date" value={form.due_date}
                  min={form.to_date || undefined}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </Field>
              <Field label="Energy traded (kWh)" htmlFor="pt-energy">
                <input
                  id="pt-energy" type="number" step="0.1" min="0" value={form.energy_kwh}
                  onChange={(e) => setForm({ ...form, energy_kwh: e.target.value })}
                />
              </Field>
              <Field label="Gross sale (₹)" required htmlFor="pt-gross">
                <input
                  id="pt-gross" type="number" step="0.01" min="0.01" required value={form.gross_sale}
                  onChange={(e) => setForm({ ...form, gross_sale: e.target.value })}
                />
              </Field>
              <Field label="Trading expense (₹)" htmlFor="pt-exp">
                <input
                  id="pt-exp" type="number" step="0.01" min="0" value={form.trading_expense}
                  onChange={(e) => setForm({ ...form, trading_expense: e.target.value })}
                  placeholder="0"
                />
              </Field>
            </div>

            {net && (
              <div style={{
                padding: '10px 12px', marginBottom: 12, borderRadius: 4,
                background: 'var(--bg-subtle, #f7fafc)', fontVariantNumeric: 'tabular-nums',
              }}>
                {net.ok ? (
                  <>
                    {fmtCurrency(net.gross_sale)}
                    {net.trading_expense ? ` − ${fmtCurrency(net.trading_expense)}` : ''}
                    {' = '}<strong>{fmtCurrency(net.net_amount)}</strong>
                    <span style={{ color: 'var(--text-light)' }}> billed to the counterparty</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--red)' }}>{net.error}</span>
                )}
              </div>
            )}

            <Field label="Remarks" htmlFor="pt-rem">
              <input
                id="pt-rem" value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !net?.ok}>
                Raise the bill
              </button>
              <button type="button" className="btn" onClick={() => { setForm(null); setNet(null); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
