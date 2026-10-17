import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

// Energy banking under a PPA: energy the buyer could not take is credited to the
// seller and drawn back later within the cycle. Whatever is still unused when the
// cycle closes settles in cash at a discount to tariff, because banking is a
// carry-forward facility rather than a guaranteed sale.

const EMPTY_BANK = { cycle: '', period_month: '', banked_mwh: '', cycle_ends_on: '' };
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The financial-year cycle a month falls in, ending 31 March. */
function fyCycle(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return null;
  const start = m >= 4 ? y : y - 1;
  return { cycle: `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`, ends: `${start + 1}-03-31` };
}
const EMPTY_DRAW = { cycle: '', draw_mwh: '' };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const end = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(end)) return null;
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((end - today) / 86400000);
}

// A cycle is only interesting once it holds energy nobody has drawn: that is what
// expires. The closer the cycle end, the more it matters.
function CycleWindow({ endsOn, available }) {
  const left = daysUntil(endsOn);
  if (left === null) return <span>—</span>;
  const urgent = available > 0 && left >= 0 && left <= 30;
  const lapsed = left < 0;
  const tone = lapsed ? 'var(--text-light)' : urgent ? 'var(--amber, #b7791f)' : 'var(--text)';
  const note = lapsed ? 'closed' : left === 0 ? 'closes today' : `${left}d left`;
  return (
    <span style={{ color: tone, fontWeight: urgent ? 600 : 400 }}>
      {endsOn}
      <span style={{ fontSize: 13, marginLeft: 6, color: 'var(--text-light)' }}>{note}</span>
    </span>
  );
}

export default function EnergyBanking() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bankForm, setBankForm] = useState(null);
  const [drawForm, setDrawForm] = useState(null);
  const [error, setError] = useState('');
  const [sweep, setSweep] = useState(null);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  useEffect(() => {
    api.contracts.list()
      .then((list) => {
        const ppas = (list || []).filter((c) => c.contract_type === 'PPA');
        setContracts(ppas);
        if (ppas.length && !contractId) setContractId(ppas[0].id);
      })
      .catch(() => {});
    // Only on mount: re-running would fight the user's own selection.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!contractId) { setRows([]); return; }
    setLoading(true);
    api.energyBanking.position(contractId)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => { setRows([]); setPopup({ title: 'Could not load the banked position', message: err.response?.data?.error || 'It did not load.' }); })
      .finally(() => setLoading(false));
  }, [contractId]);
  useEffect(load, [load]);

  const contract = contracts.find((c) => c.id === contractId);
  const totals = rows.reduce((a, r) => ({
    banked: a.banked + (Number(r.banked_mwh) || 0),
    drawn: a.drawn + (Number(r.drawn_mwh) || 0),
    available: a.available + (Number(r.available_mwh) || 0),
    settled: a.settled + (Number(r.settled_amount) || 0),
  }), { banked: 0, drawn: 0, available: 0, settled: 0 });

  // What the seller would be paid if this energy were never drawn. Shown before
  // banking so the discount is visible at the moment the decision is made.
  // Valued at the contract's tariff, which the server applies for the month; it is not typed.
  const bankRate = Number(contract?.tariff_per_unit) || 0;
  const bankMwh = Number(bankForm?.banked_mwh) || 0;
  const fullValue = Math.round(bankMwh * 1000 * bankRate);
  const lapseValue = Math.round(fullValue * 0.75);

  async function doBank(e) {
    e.preventDefault();
    if (busy.current) return;
    if (bankForm.cycle_ends_on && bankForm.cycle_ends_on < todayIso()) { setError(`The cycle ended on ${bankForm.cycle_ends_on}; energy cannot be banked into a closed cycle.`); return; }
    setError('');
    busy.current = true;
    try {
      await api.energyBanking.bank({ ...bankForm, contract_id: contractId, banked_mwh: Number(bankForm.banked_mwh) });
      setBankForm(null); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to bank energy.');
    } finally {
      busy.current = false;
    }
  }

  function setPeriod(period) {
    const fy = fyCycle(period);
    setBankForm((f) => ({ ...f, period_month: period, cycle: f.cycle || fy?.cycle || '', cycle_ends_on: f.cycle_ends_on || fy?.ends || '' }));
  }

  async function doDraw(e) {
    e.preventDefault();
    if (busy.current) return;
    setError('');
    busy.current = true;
    try {
      const res = await api.energyBanking.draw({ ...drawForm, contract_id: contractId, draw_mwh: Number(drawForm.draw_mwh) });
      setDrawForm(null); load();
      if (res?.remaining_unfilled > 0) setPopup({ tone: 'warning', title: 'Part drawn', message: `${fmtNumber(res.remaining_unfilled, 3)} MWh could not be drawn — the cycle did not hold enough.` });
      else if (res?.invoice) {
        const buyers = (res.buyer_invoices || []).map((b) => `${b.invoice_no} to ${b.contract_no} (${fmtCurrency(b.total_amount)})`);
        setPopup({
          tone: 'success',
          title: 'Drawn',
          message: `The generator's bill for the energy drawn is ${res.invoice.invoice_no} (${fmtCurrency(res.invoice.total_amount)}, full banked tariff).`
            + (buyers.length ? ` The buyers are billed their shares: ${buyers.join('; ')}.` : ' No PSA held a share of this energy, so no buyer is billed.')
            + ' All are drafts for approval under Billing & Invoicing.',
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to draw banked energy.');
    } finally {
      busy.current = false;
    }
  }

  function runSweep() {
    setPopup({
      tone: 'warning',
      title: 'Settle closed cycles',
      message: 'Settle every cycle that closed before today with energy unused? Settlement is at a discount to tariff and cannot be undone. (It also runs every night.)',
      confirm: async () => {
        const res = await api.energyBanking.settle({});
        setSweep(res); load(); setPopup(null);
      },
    });
  }

  async function confirmPopup() {
    if (busy.current || !popup?.confirm) return;
    busy.current = true;
    try {
      await popup.confirm();
    } catch (err) {
      setPopup({ title: 'Not done', message: err.response?.data?.error || err.message });
    } finally {
      busy.current = false;
    }
  }

  const columns = [
    { key: 'cycle', header: 'Cycle' },
    { key: 'cycle_ends_on', header: 'Cycle Ends', render: (r) => <CycleWindow endsOn={r.cycle_ends_on} available={Number(r.available_mwh) || 0} /> },
    { key: 'banked_mwh', header: 'Banked', render: (r) => `${fmtNumber(r.banked_mwh, 3)} MWh` },
    { key: 'drawn_mwh', header: 'Drawn', render: (r) => `${fmtNumber(r.drawn_mwh, 3)} MWh` },
    {
      key: 'available_mwh',
      header: 'Available',
      render: (r) => {
        const v = Number(r.available_mwh) || 0;
        return <strong style={{ color: v > 0 ? 'var(--green)' : 'var(--text-light)' }}>{fmtNumber(v, 3)} MWh</strong>;
      },
    },
    {
      key: 'settled_amount',
      header: 'Settled',
      render: (r) => {
        if (!Number(r.settled_amount)) return '—';
        return (
          <span>
            {fmtCurrency(r.settled_amount)}
            <span style={{ fontSize: 13, color: 'var(--text-light)', marginLeft: 6 }}>{fmtNumber(r.settled_mwh, 3)} MWh lapsed</span>
            {r.settlement_invoice_no && <div className="audit-muted">Billed on {r.settlement_invoice_no}</div>}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      // A closed cycle settles in cash; it is not drawn from.
      render: (r) => canWrite && Number(r.available_mwh) > 0 && r.cycle_ends_on >= todayIso() && (
        <div onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-xs btn-primary" onClick={() => { setError(''); setDrawForm({ ...EMPTY_DRAW, cycle: r.cycle }); }}>Draw</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Energy Banking"
        subtitle="Energy the buyer could not take, credited to the seller and drawn back within the cycle. Unused energy settles in cash at a discount to tariff."
        actions={canWrite && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={runSweep}>Settle Closed Cycles</button>
            <button className="btn btn-primary" disabled={!contractId} onClick={() => { setError(''); setBankForm({ ...EMPTY_BANK }); }}>+ Bank Energy</button>
          </div>
        )}
      />

      <Card>
        <Field label="PPA Contract">
          <select value={contractId} onChange={(e) => setContractId(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="">Select PPA...</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}{c.seller_name ? ` — ${c.seller_name}` : ''}</option>)}
          </select>
        </Field>
      </Card>

      <div className="kpi-grid">
        <StatCard label="Banked" value={`${fmtNumber(totals.banked, 3)} MWh`} />
        <StatCard label="Drawn Back" value={`${fmtNumber(totals.drawn, 3)} MWh`} />
        <StatCard label="Still Available" value={`${fmtNumber(totals.available, 3)} MWh`} tone={totals.available > 0 ? 'green' : 'default'} hint="drawable until the cycle closes" />
        <StatCard label="Cash Settled" value={fmtCurrency(totals.settled)} tone="amber" hint="lapsed, paid at a discount" />
      </div>

      {sweep && (
        <Card>
          <div style={{ fontSize: 13 }}>
            Checked <strong>{sweep.checked}</strong> closed {sweep.checked === 1 ? 'cycle' : 'cycles'} as of {sweep.as_of};
            {' '}<strong>{sweep.settled}</strong> settled in cash.
            {sweep.items?.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-light)' }}>
                {sweep.items.map((it) => (
                  <li key={it.id}>
                    {it.cycle}: {fmtNumber(it.unused_mwh, 3)} MWh unused @ ₹{it.settled_rate}/unit ({it.settlement_pct}% of tariff) = <strong>{fmtCurrency(it.settlement_amount)}</strong>
                    {it.invoice_no && <> · billed on {it.invoice_no}</>}
                  </li>
                ))}
              </ul>
            )}
            {sweep.buyer_invoices?.length > 0 && (
              <div style={{ marginTop: 8, color: 'var(--text-light)' }}>
                Passed on to the buyers for their share: {sweep.buyer_invoices.map((b) => `${b.invoice_no} to ${b.contract_no} (${fmtCurrency(b.total_amount)})`).join('; ')}.
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          emptyMessage={loading ? 'Loading...' : contractId ? 'Nothing banked against this contract.' : 'Select a PPA to see its banked position.'}
        />
      </Card>

      <AlertPopup
        open={!!popup}
        tone={popup?.tone || 'error'}
        title={popup?.title}
        message={popup?.message}
        okLabel={popup?.confirm ? 'Back' : undefined}
        actions={popup?.confirm ? <button type="button" className="btn btn-danger" onClick={confirmPopup}>Settle</button> : undefined}
        onClose={() => setPopup(null)}
      />
      <Modal open={!!bankForm} onClose={() => setBankForm(null)} title="Bank Energy" width={560}>
        <AlertPopup open={!!error && !!bankForm} title="Not banked" message={error} onClose={() => setError('')} />
        {bankForm && (
          <form onSubmit={doBank}>
            <div className="form-grid">
              <Field label="Banking Cycle"><input required value={bankForm.cycle} placeholder="e.g. FY2026-27" onChange={(e) => setBankForm({ ...bankForm, cycle: e.target.value })} /></Field>
              <Field label="Cycle Ends On"><input required type="date" min={todayIso()} value={bankForm.cycle_ends_on} onChange={(e) => setBankForm({ ...bankForm, cycle_ends_on: e.target.value })} /></Field>
            </div>
            <div className="form-grid">
              <Field label="Month generated (locked)"><input required type="month" max={todayIso().slice(0, 7)} value={bankForm.period_month} onChange={(e) => setPeriod(e.target.value)} /></Field>
              <Field label="Energy Banked (MWh)"><input required type="number" step="0.001" min="0.001" value={bankForm.banked_mwh} onChange={(e) => setBankForm({ ...bankForm, banked_mwh: e.target.value })} /></Field>
            </div>
            <p className="inline-note" style={{ margin: '4px 0' }}>
              Valued at the contract&apos;s tariff for the month ({contract?.tariff_per_unit != null ? `₹${contract.tariff_per_unit}/unit` : 'from the contract'}).
              Up to the month&apos;s locked generation can be banked, into a cycle that is still open, and only before the month is billed:
              the month&apos;s bills (the generator&apos;s and the buyers&apos;) leave banked energy out; a draw is billed by the generator at the full tariff
              and to each buyer for its share; what lapses is billed by the generator at the settlement rate and passed on to each buyer for its share at the same rate of its tariff.
            </p>
            <div style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13 }}>
              Drawn back within the cycle: <strong>{fmtCurrency(fullValue)}</strong> of energy.
              {'  ·  '}Left to lapse: <strong style={{ color: 'var(--amber, #b7791f)' }}>{fmtCurrency(lapseValue)}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 2 }}>
                Unused energy settles at 75% of tariff by default, so drawing it back is worth {fmtCurrency(fullValue - lapseValue)} more than letting the cycle close on it.
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setBankForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Bank Energy</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!drawForm} onClose={() => setDrawForm(null)} title="Draw Banked Energy" width={480}>
        <AlertPopup open={!!error && !!drawForm} title="Not drawn" message={error} onClose={() => setError('')} />
        {drawForm && (
          <form onSubmit={doDraw}>
            <Field label="Cycle"><input value={drawForm.cycle} readOnly /></Field>
            <Field label="Draw (MWh)">
              <input required type="number" step="0.001" min="0.001" value={drawForm.draw_mwh} onChange={(e) => setDrawForm({ ...drawForm, draw_mwh: e.target.value })} />
            </Field>
            <div style={{ fontSize: 13.5, color: 'var(--text-light)', margin: '4px 0 8px' }}>
              Available in this cycle: <strong>{fmtNumber(rows.find((r) => r.cycle === drawForm.cycle)?.available_mwh || 0, 3)} MWh</strong>. Oldest energy is drawn first, so what expires soonest is used up first.
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDrawForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Draw</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
