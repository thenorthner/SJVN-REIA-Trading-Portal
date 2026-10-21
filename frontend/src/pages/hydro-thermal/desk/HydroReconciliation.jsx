import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';
import ModuleGuide from '../../../components/ModuleGuide.jsx';
import { useStation, errOf } from './useStation.js';

const TONE = { DRAFT: 'DRAFT', SENT: 'PENDING', CONFIRMED: 'ACTIVE', DISPUTED: 'REJECTED', SIGNED_OFF: 'ACTIVE' };
const STEP = { SENT: 'Mark as sent', CONFIRMED: 'Beneficiary confirmed', DISPUTED: 'Beneficiary disputes balance', SIGNED_OFF: 'Sign off' };

const TABS = [
  { key: 'LIST', label: 'Statements' },
  { key: 'FYI', label: 'FYI — Reference Guide' },
];

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
  const [tab, setTab] = useState('LIST');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.reconciliations({ contract_id: stationId }).then(setRows).catch((e) => setPopup({ tone: 'error', title: 'Could not load', message: errOf(e) }));
  }, [stationId]);
  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED' || r.status === 'SIGNED_OFF').length;
    const disputed = rows.filter((r) => r.status === 'DISPUTED').length;
    const pending = rows.filter((r) => r.status === 'DRAFT' || r.status === 'SENT').length;
    const totalDiff = rows.reduce((s, r) => s + Math.abs(r.difference || 0), 0);
    return { total, confirmed, disputed, pending, totalDiff };
  }, [rows]);

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

      <div className="nb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'Balance confirmation process', body: 'A statement of account is drawn from the beneficiary ledger for a period. It lists every bill, payment, note, TDS and surcharge in the period with opening and closing balances. The statement is sent to the beneficiary, who either confirms the balance or disputes it with their own closing figure.' },
          { title: 'Status lifecycle', body: 'DRAFT → SENT → CONFIRMED (if balance matches) or DISPUTED (if not) → SIGNED OFF. A disputed statement records the beneficiary\'s closing balance and their explanation of the difference. Once resolved, it is signed off.' },
          { title: 'PDF statement', body: 'Each statement can be downloaded as a PDF for sharing with the beneficiary. The PDF shows the opening balance, all movements (debits and credits), and the closing balance.' },
          { title: 'Reconciliation tips', body: 'Common causes of difference: timing (a payment in transit), TDS not yet acknowledged, surcharge not recognized, or a disputed bill. The reconciliation tracks the difference amount and the beneficiary\'s explanation to help resolve it.' },
        ]} />
      )}

      {tab === 'LIST' && (
        <>
          <div className="filters-bar">
            <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="DISPUTED">Disputed</option>
              <option value="SIGNED_OFF">Signed off</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 16 }}>
            <StatCard label="Total statements" value={stats.total} />
            <StatCard label="Confirmed / Signed off" value={stats.confirmed} tone={stats.confirmed ? 'default' : 'amber'} />
            <StatCard label="Disputed" value={stats.disputed} tone={stats.disputed ? 'danger' : 'default'} />
            <StatCard label="Pending (Draft / Sent)" value={stats.pending} tone={stats.pending ? 'amber' : 'default'} />
            {stats.totalDiff > 0 && <StatCard label="Total variance" value={fmtCurrency(stats.totalDiff)} tone="danger" />}
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
                { key: 'difference', header: 'Difference', render: (r) => (r.difference ? <span style={{ color: 'var(--red-deep)' }}>{fmtCurrency(r.difference)}</span> : '—') },
                { key: 'status', header: 'Status', render: (r) => <Badge status={TONE[r.status]} label={r.status.replace('_', ' ')} /> },
                { key: 'sent_on', header: 'Sent', render: (r) => r.sent_on ? fmtDate(r.sent_on) : '—' },
              ]}
              rows={filtered}
              emptyMessage="No statement drawn up for this station yet."
            />
          </Card>
        </>
      )}

      {/* ── Create statement ── */}
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

      {/* ── Statement detail ── */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.statement_no} — ${selected.beneficiary_name}` : ''} width={900}>
        {selected && (
          <div>
            <table className="detail-table"><tbody>
              <tr><td>Opening balance ({fmtDate(selected.period_from)})</td><td>{fmtCurrency(selected.opening_balance)}</td></tr>
              <tr><td>Add: bills · debit notes · surcharge</td><td>{fmtCurrency(m.billed)} · {fmtCurrency(m.debit_notes)} · {fmtCurrency(m.surcharge)}</td></tr>
              <tr><td>Less: received · rebate · credit notes · TDS</td><td>{fmtCurrency(m.received)} · {fmtCurrency(m.rebate)} · {fmtCurrency(m.credit_notes)} · {fmtCurrency(m.tds)}</td></tr>
              <tr><td><strong>Closing balance ({fmtDate(selected.period_to)})</strong></td><td><strong>{fmtCurrency(selected.closing_balance)}</strong></td></tr>
              {selected.beneficiary_balance != null && <tr><td>Beneficiary's closing balance</td><td>{fmtCurrency(selected.beneficiary_balance)}</td></tr>}
              {selected.difference != null && selected.difference !== 0 && <tr><td style={{ color: 'var(--red-deep)' }}>Difference</td><td style={{ color: 'var(--red-deep)', fontWeight: 700 }}>{fmtCurrency(selected.difference)}</td></tr>}
              <tr><td>Status</td><td><Badge status={TONE[selected.status]} label={selected.status.replace('_', ' ')} />{selected.sent_on ? ` · sent ${fmtDate(selected.sent_on)}` : ''}{selected.confirmed_on ? ` · confirmed ${fmtDate(selected.confirmed_on)}` : ''}</td></tr>
              {selected.beneficiary_remarks && <tr><td>Beneficiary says</td><td>{selected.beneficiary_remarks}</td></tr>}
            </tbody></table>

            <h4 style={{ margin: '16px 0 8px' }}>Movements</h4>
            <Table
              columns={[
                { key: 'doc_date', header: 'Date', render: (l) => fmtDate(l.doc_date) },
                { key: 'doc_no', header: 'Document' },
                { key: 'info', header: 'Particulars', render: (l) => <span style={{ fontSize: 13.5 }}>{l.info || l.kind}</span> },
                { key: 'debit', header: 'Debit', render: (l) => (l.debit ? fmtCurrency(l.debit) : '') },
                { key: 'credit', header: 'Credit', render: (l) => (l.credit ? fmtCurrency(l.credit) : '') },
                { key: 'balance', header: 'Balance', render: (l) => fmtCurrency(l.balance) },
              ]}
              rows={(selected.summary?.lines || []).map((l) => ({ ...l, id: l.doc_no }))}
              emptyMessage="No movement in the period."
            />

            {selected.events?.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 8px' }}>Audit trail</h4>
                <Table
                  columns={[
                    { key: 'created_at', header: 'When', render: (e) => fmtDate(e.created_at) },
                    { key: 'action', header: 'Action', render: (e) => e.action || e.to_status?.replace('_', ' ') || '—' },
                    { key: 'actor', header: 'By', render: (e) => e.actor_name || e.actor || '—' },
                    { key: 'remarks', header: 'Remarks' },
                  ]}
                  rows={selected.events}
                />
              </>
            )}

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

      {/* ── Move reconciliation ── */}
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
