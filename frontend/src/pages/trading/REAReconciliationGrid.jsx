import React, { useMemo, useState } from 'react';
import { PageHeader, Card, Field, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';
import useErpFormat from './useErpFormat.js';

// REA/SEA Reconciliation — what the regional energy account says a buyer drew
// against what its open-access approval allowed, application by application.
//
// This screen was a mockup: its rows were transcribed from the live portal and
// sat in tracked source, its Month / Year / Entity boxes were readOnly, its
// column headers offered a sort that was not wired, and its markup was written
// for a CSS framework this app does not ship, so it rendered unstyled. The
// filters below select on the register; the gap column is what the screen is for.

const DONE = /^done$/i;

export default function REAReconciliationGrid() {
  const { rows, loading, error } = useErpFormat('rea-sea-reconciliation');
  const [month, setMonth] = useState('');
  const [entity, setEntity] = useState('');

  const months = useMemo(() => [...new Set(rows.map((r) => r.month).filter(Boolean))], [rows]);
  const entities = useMemo(() => [...new Set(rows.map((r) => r.entity).filter(Boolean))].sort(), [rows]);

  const shown = useMemo(() => rows.filter(
    (r) => (!month || r.month === month) && (!entity || r.entity === entity),
  ), [rows, month, entity]);

  const totals = useMemo(() => shown.reduce((t, r) => ({
    approved: t.approved + (Number(r.approved) || 0),
    rea: t.rea + (Number(r.rea) || 0),
    pending: t.pending + (DONE.test(r.status || '') ? 0 : 1),
  }), { approved: 0, rea: 0, pending: 0 }), [shown]);

  return (
    <div className="page">
      <PageHeader
        title="REA/SEA Reconciliation"
        subtitle="Approved open-access energy against what the regional energy account records"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card title="Selection Criteria">
        <div className="report-criteria">
          <Field label="Month">
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Entity Name">
            <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <div className="kpi-grid">
        <StatCard label="Approved energy" value={`${fmtNumber(totals.approved)} MWh`} />
        <StatCard label="As per REA" value={`${fmtNumber(totals.rea)} MWh`} />
        <StatCard
          label="Gap to reconcile"
          value={`${fmtNumber(totals.approved - totals.rea)} MWh`}
          tone={totals.approved - totals.rea ? 'amber' : 'green'}
        />
        <StatCard label="Applications pending" value={fmtNumber(totals.pending, 0)} tone={totals.pending ? 'amber' : 'green'} />
      </div>

      <Card title="Applications">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Contract No</th>
                <th scope="col">Name Of The Entity</th>
                <th scope="col">Application Number</th>
                <th scope="col">Approval Number</th>
                <th scope="col" className="num">Approved Energy (MWh)</th>
                <th scope="col" className="num">Energy As Per REA (MWh)</th>
                <th scope="col" className="num">As Per RLDC Schedule (MWh)</th>
                <th scope="col" className="num">Gap (MWh)</th>
                <th scope="col">Reconciliation Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="empty-cell">Loading the reconciliation…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={9} className="empty-cell">No applications on record for this selection</td></tr>
              ) : shown.map((r, i) => {
                const gap = (Number(r.approved) || 0) - (Number(r.rea) || 0);
                return (
                  <tr key={r.id || `${r.appNo}-${i}`}>
                    <td>{r.contract}</td>
                    <td>{r.entity}</td>
                    <td>{r.appNo}</td>
                    <td>{r.approvalNo}</td>
                    <td className="num">{fmtNumber(r.approved)}</td>
                    <td className="num">{fmtNumber(r.rea)}</td>
                    <td className="num">{fmtNumber(r.rldc)}</td>
                    <td className="num">{gap ? fmtNumber(gap) : '—'}</td>
                    <td><Badge type={DONE.test(r.status || '') ? 'success' : 'warning'}>{r.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
