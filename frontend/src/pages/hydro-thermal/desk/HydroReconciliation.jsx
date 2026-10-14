import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';
import { useStation, errOf } from './useStation.js';

// Balance confirmation with each beneficiary. The statement is drawn from the
// ledger for a period, sent, and marked confirmed only when the beneficiary's
// balance matches ours; otherwise the difference and its explanation are kept.

const TONE = { DRAFT: 'DRAFT', SENT: 'PENDING', CONFIRMED: 'ACTIVE', DISPUTED: 'REJECTED', SIGNED_OFF: 'ACTIVE' };
const STEP = { SENT: 'Mark as sent', CONFIRMED: 'Beneficiary confirmed', DISPUTED: 'Beneficiary disputes balance', SIGNED_OFF: 'Sign off' };

const quarterStart = () => {
  const d = new Date();
  const m = d.getMonth();
  const qm = m - (m % 3);
  return new Date(Date.UTC(d.getFullYear(), qm, 1)).toISOString().slice(0, 10);
};

export default function HydroReconciliation({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [move, setMove] = useState(null);
  const [popup, setPopup] = useState(null);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.reconciliations({ contract_id: stationId }).then(setRows).catch((e) => setPopup({ tone: 'error', title: 'Could not load', message: errOf(e) }));
  }, [stationId]);
  useEffect(load, [load]);

  async function create(e) {
    e.preventDefault();
    try {
      const r = await api.hydroDesk.createReconciliation({ ...form, contract_id: stationId });
      setForm(null);
      load();
      setSelected(r);
    } catch (err) {
      setPopup({ tone: 'error', title: 'The statement was not drawn up', message: errOf(err) });
    }
  }

  async function doMove(e) {
    e.preventDefault();
    try {
      const r = await api.hydroDesk.moveReconciliation(move.rec.id, { to: move.to, beneficiary_balance: move.beneficiary_balance, remarks: move.remarks });
      setMove(null);
      setSelected(r);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Not done', message: errOf(err) });
    }
  }

  const m = selected?.summary?.movements || {};

  return (
    <div>
      <PageHeader
        title="Reconciliation (Balance Confirmation)"
        subtitle="Statements of account drawn from the ledger, sent to each beneficiary, and confirmed or reconciled"
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary_name: beneficiaries[0] || '', period_from: quarterStart(), period_to: new Date().toISOString().slice(0, 10) })}>+ New Statement</button>}
      />
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
      </div>
      <Card>
        <Table
          onRowClick={setSelected}
          columns={[
            { key: 'statement_no', header: 'Statement', render: (r) => <strong>{r.statement_no}</strong> },
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` },
            { key: 'closing_balance', header: 'Our closing balance', render: (r) => fmtCurrency(r.closing_balance) },
            { key: 'beneficiary_balance', header: 'Their balance', render: (r) => (r.beneficiary_balance != null ? fmtCurrency(r.beneficiary_balance) : '—') },
            { key: 'difference', header: 'Difference', render: (r) => (r.difference ? <span style={{ color: '#b91c1c' }}>{fmtCurrency(r.difference)}</span> : '—') },
            { key: 'status', header: 'Status', render: (r) => <Badge status={TONE[r.status]} label={r.status.replace('_', ' ')} /> },
          ]}
          rows={rows}
          emptyMessage="No statement drawn up for this station yet."
        />
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title="Draw up a statement of account" width={600}>
        {form && (
          <form onSubmit={create}>
            <Field label="Beneficiary" required>
              <select value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })}>
                {beneficiaries.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="From" required><input type="date" required value={form.period_from} onChange={(e) => setForm({ ...form, period_from: e.target.value })} /></Field>
              <Field label="To" required><input type="date" required value={form.period_to} onChange={(e) => setForm({ ...form, period_to: e.target.value })} /></Field>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Draw up</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.statement_no} — ${selected.beneficiary_name}` : ''} width={900}>
        {selected && (
          <div>
            <table className="detail-table"><tbody>
              <tr><td>Opening balance ({fmtDate(selected.period_from)})</td><td>{fmtCurrency(selected.opening_balance)}</td></tr>
              <tr><td>Add: bills · debit notes · surcharge</td><td>{fmtCurrency(m.billed)} · {fmtCurrency(m.debit_notes)} · {fmtCurrency(m.surcharge)}</td></tr>
              <tr><td>Less: received · rebate · credit notes · TDS</td><td>{fmtCurrency(m.received)} · {fmtCurrency(m.rebate)} · {fmtCurrency(m.credit_notes)} · {fmtCurrency(m.tds)}</td></tr>
              <tr><td><strong>Closing balance ({fmtDate(selected.period_to)})</strong></td><td><strong>{fmtCurrency(selected.closing_balance)}</strong></td></tr>
              <tr><td>Status</td><td><Badge status={TONE[selected.status]} label={selected.status.replace('_', ' ')} />{selected.sent_on ? ` · sent ${fmtDate(selected.sent_on)}` : ''}</td></tr>
              {selected.beneficiary_remarks && <tr><td>Beneficiary says</td><td>{selected.beneficiary_remarks}</td></tr>}
            </tbody></table>
            <h4 style={{ margin: '16px 0 8px' }}>Movements</h4>
            <Table
              columns={[
                { key: 'doc_date', header: 'Date', render: (l) => fmtDate(l.doc_date) },
                { key: 'doc_no', header: 'Document' },
                { key: 'info', header: 'Particulars', render: (l) => <span style={{ fontSize: 12 }}>{l.info || l.kind}</span> },
                { key: 'debit', header: 'Debit', render: (l) => (l.debit ? fmtCurrency(l.debit) : '') },
                { key: 'credit', header: 'Credit', render: (l) => (l.credit ? fmtCurrency(l.credit) : '') },
                { key: 'balance', header: 'Balance', render: (l) => fmtCurrency(l.balance) },
              ]}
              rows={(selected.summary?.lines || []).map((l) => ({ ...l, id: l.doc_no }))}
              emptyMessage="No movement in the period."
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => api.hydroDesk.reconciliationPdf(selected.id, selected.statement_no).catch((e) => setPopup({ tone: 'error', title: 'PDF failed', message: errOf(e) }))}>Download statement (PDF)</button>
              {canWrite && selected.allowed_next.map((to) => (
                <button key={to} type="button" className={to === 'DISPUTED' ? 'btn btn-danger' : 'btn btn-primary'}
                  onClick={() => (to === 'SENT' || to === 'SIGNED_OFF'
                    ? api.hydroDesk.moveReconciliation(selected.id, { to }).then((r) => { setSelected(r); load(); }).catch((e) => setPopup({ tone: 'error', title: 'Not done', message: errOf(e) }))
                    : setMove({ rec: selected, to, beneficiary_balance: '', remarks: '' }))}>
                  {STEP[to]}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!move} onClose={() => setMove(null)} title={move ? STEP[move.to] : ''} width={520}>
        {move && (
          <form onSubmit={doMove}>
            <Field label="Closing balance per the beneficiary's books (₹)" required>
              <input type="number" step="0.01" required value={move.beneficiary_balance} onChange={(e) => setMove({ ...move, beneficiary_balance: e.target.value })} />
            </Field>
            <Field label={move.to === 'DISPUTED' ? 'What they say the difference is made of' : 'Remarks'} required={move.to === 'DISPUTED'}>
              <textarea rows={3} value={move.remarks} onChange={(e) => setMove({ ...move, remarks: e.target.value })} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMove(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
