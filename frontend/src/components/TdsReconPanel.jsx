/**
 * L4: TDS withheld against Form 16A, per counterparty and quarter — for
 * Finance to reconcile, or to take up a mismatch.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Badge, Modal, Field, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate } from '../datetime.js';
import { actsAs } from '../lib/rolePages.js';

const STATE = { MATCHED: ['ACTIVE', 'Matches'], AWAITED: ['PENDING', '16A awaited'], OVERDUE: ['OVERDUE', '16A overdue'], SHORT: ['REJECTED', '16A short'], EXCESS: ['DISPUTED', '16A over'] };
const fyNow = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };

export default function TdsReconPanel() {
  const { user } = useAuth() || {};
  const canMark = actsAs(user, ['FINANCE_USER']);
  const [fy, setFy] = useState(fyNow());
  const [data, setData] = useState(null);
  const [mark, setMark] = useState(null);
  const [popup, setPopup] = useState(null);
  const load = useCallback(() => { api.tdsRecon.list(fy).then(setData).catch(() => setData(null)); }, [fy]);
  useEffect(() => { load(); }, [load]);
  const years = Array.from({ length: 4 }, (_, i) => { const y = Number(fyNow().slice(0, 4)) - i; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });
  return (
    <Card title="TDS vs Form 16A reconciliation">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">{years.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        {data && <span style={{ fontSize: 14.5 }}>Withheld {fmtCurrency(data.totals.deducted)} · certified {fmtCurrency(data.totals.certified)} · {data.totals.matched} matched, {data.totals.awaited + data.totals.overdue} awaited ({data.totals.overdue} overdue), {data.totals.short + data.totals.excess} mismatched</span>}
        <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
          try {
            const blob = await api.tdsRecon.exportXlsx(fy);
            const url = URL.createObjectURL(blob); const a = document.createElement('a');
            a.href = url; a.download = `tds-16a-reconciliation-${fy}.xlsx`; a.click(); URL.revokeObjectURL(url);
          } catch { setPopup({ tone: 'error', title: 'Export failed', message: 'Could not prepare the workbook.' }); }
        }}>Export (Excel)</button>
      </div>
      {!data ? <p>Loading…</p> : data.rows.length === 0 ? <p style={{ margin: 0 }}>No tax was withheld and no certificate filed in FY {fy}.</p> : (
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr><th>Counterparty</th><th>Quarter</th><th>194Q</th><th>194C</th><th>Withheld</th><th>Form 16A</th><th>Difference</th><th>State</th><th>Reconciliation</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.entity_id}-${r.party_side}-${r.quarter}`}>
                  <td>{r.entity_name}<div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{r.party_side === 'BUYER' ? 'Buyer withholds on SJVN' : 'SJVN withholds on developer'}</div></td>
                  <td>{r.quarter}<div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>16A due {fmtDate(r.certificate_due)}</div></td>
                  <td>{r.by_section['194Q'] ? fmtCurrency(r.by_section['194Q']) : '—'}</td>
                  <td>{r.by_section['194C'] ? fmtCurrency(r.by_section['194C']) : '—'}</td>
                  <td>{fmtCurrency(r.deducted)}</td>
                  <td>{r.certificate ? <>{fmtCurrency(r.certificate.amount)}<div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{r.certificate.certificate_no || ''}</div></> : '—'}</td>
                  <td>{r.difference == null ? '—' : fmtCurrency(r.difference)}</td>
                  <td><Badge status={STATE[r.state][0]} label={STATE[r.state][1]} /></td>
                  <td>
                    {r.recon_status ? <span title={r.recon_note || ''}><Badge status={r.recon_status === 'RECONCILED' ? 'ACTIVE' : 'DISPUTED'} label={r.recon_status === 'RECONCILED' ? 'Reconciled' : 'Mismatch raised'} /></span> : '—'}
                    {canMark && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMark({ row: r, status: r.state === 'MATCHED' ? 'RECONCILED' : 'MISMATCH', note: r.recon_note || '' })}>Mark</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!mark} onClose={() => setMark(null)} title={mark ? `${mark.row.entity_name} — ${mark.row.financial_year} ${mark.row.quarter}` : ''} width={480}>
        {mark && (
          <form noValidate onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.tdsRecon.mark({ entity_id: mark.row.entity_id, party_side: mark.row.party_side, financial_year: mark.row.financial_year, quarter: mark.row.quarter, status: mark.status, note: mark.note });
              setMark(null); load();
            } catch (err) { setPopup({ tone: 'error', title: 'Not saved', message: err?.response?.data?.error || 'Could not save.' }); }
          }}>
            <Field label="Reconciliation" required>
              <select value={mark.status} onChange={(e) => setMark({ ...mark, status: e.target.value })}>
                <option value="RECONCILED">Reconciled</option>
                <option value="MISMATCH">Mismatch — taken up with the party</option>
              </select>
            </Field>
            <Field label="Note"><textarea rows={3} value={mark.note} onChange={(e) => setMark({ ...mark, note: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setMark(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </Card>
  );
}
