/**
 * Forum tracker (D5): disputes taken before CERC/SERC/APTEL or an arbitrator —
 * case number, hearings, what is still at stake and what was awarded.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Badge, Modal, Field, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate } from '../datetime.js';

export default function ForumTrackerPanel({ canWrite }) {
  const [data, setData] = useState(null);
  const [caseForm, setCaseForm] = useState(null);
  const [hearing, setHearing] = useState(null);
  const [popup, setPopup] = useState(null);
  const load = useCallback(() => { api.disputeExtras.forumTracker().then(setData).catch(() => setData(null)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data || !data.rows.length) return null;

  const save = async (fn, close, title) => {
    try { await fn(); close(null); load(); } catch (err) {
      setPopup({ tone: 'error', title, message: err?.response?.data?.error || 'Could not save.' });
    }
  };

  return (
    <Card title={`Before a forum — ${data.totals.pending} pending · exposure ${fmtCurrency(data.totals.exposure)}${data.totals.hearings_in_7_days ? ` · ${data.totals.hearings_in_7_days} hearing(s) within 7 days` : ''}`}>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr><th>Dispute</th><th>Forum / case</th><th>Contested</th><th>Exposure</th><th>Next hearing</th><th>Status</th>{canWrite && <th />}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.dispute_no}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.invoice_no} · {r.contract_no}</div></td>
                <td>{r.forum_label || '—'}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.case_no ? `${r.case_no}${r.filed_on ? ` · filed ${fmtDate(r.filed_on)}` : ''}` : 'Case no. not recorded'}</div></td>
                <td>{fmtCurrency(r.contested_amount)}</td>
                <td>{r.status === 'DECIDED' ? (r.awarded_amount != null ? `Awarded ${fmtCurrency(r.awarded_amount)}` : '—') : fmtCurrency(r.expected_exposure)}</td>
                <td>
                  {r.next_hearing ? <>{fmtDate(r.next_hearing)}{r.days_to_hearing != null && r.days_to_hearing >= 0 && <div style={{ fontSize: 12, color: r.days_to_hearing <= 7 ? 'var(--amber-strong)' : 'var(--slate-500)' }}>in {r.days_to_hearing} day(s)</div>}</> : '—'}
                  {r.hearings.length > 0 && <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.hearings.length} hearing(s) held</div>}
                </td>
                <td><Badge status={r.status === 'DECIDED' ? 'ACTIVE' : 'PENDING'} label={r.status === 'DECIDED' ? (r.outcome || 'Decided') : 'Pending'} /></td>
                {canWrite && (
                  <td>
                    {r.status === 'PENDING' && (
                      <div className="cell-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setCaseForm({ id: r.id, case_no: r.case_no || '', filed_on: r.filed_on || '', expected_exposure: r.expected_exposure ?? '' })}>Case</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setHearing({ id: r.id, hearing_date: '', purpose: '', notes: '', next_date: '' })}>Hearing</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!caseForm} onClose={() => setCaseForm(null)} title="Forum case" width={480}>
        {caseForm && (
          <form noValidate onSubmit={(e) => { e.preventDefault(); save(() => api.disputeExtras.setForum(caseForm.id, caseForm), setCaseForm, 'Case not saved'); }}>
            <Field label="Case / petition number" required><input value={caseForm.case_no} onChange={(e) => setCaseForm({ ...caseForm, case_no: e.target.value })} /></Field>
            <Field label="Filed on"><input type="date" value={caseForm.filed_on} onChange={(e) => setCaseForm({ ...caseForm, filed_on: e.target.value })} /></Field>
            <Field label="Expected exposure (₹)"><input type="number" min="0" value={caseForm.expected_exposure} onChange={(e) => setCaseForm({ ...caseForm, expected_exposure: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCaseForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!hearing} onClose={() => setHearing(null)} title="Record a hearing" width={480}>
        {hearing && (
          <form noValidate onSubmit={(e) => { e.preventDefault(); save(() => api.disputeExtras.addHearing(hearing.id, hearing), setHearing, 'Hearing not saved'); }}>
            <Field label="Hearing date" required><input type="date" value={hearing.hearing_date} onChange={(e) => setHearing({ ...hearing, hearing_date: e.target.value })} /></Field>
            <Field label="Purpose"><input value={hearing.purpose} onChange={(e) => setHearing({ ...hearing, purpose: e.target.value })} /></Field>
            <Field label="What happened"><textarea rows={2} value={hearing.notes} onChange={(e) => setHearing({ ...hearing, notes: e.target.value })} /></Field>
            <Field label="Next date"><input type="date" value={hearing.next_date} onChange={(e) => setHearing({ ...hearing, next_date: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setHearing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </Card>
  );
}
