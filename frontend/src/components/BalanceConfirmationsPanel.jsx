/**
 * R5: year-end balance confirmations — issue the letter from SJVN's ledger,
 * record the counterparty's answer, and file the auditor's certificate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Badge, Modal, Field, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate } from '../datetime.js';

const lastClosedFy = () => { const d = new Date(); const y = (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };
const save = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };

export default function BalanceConfirmationsPanel({ canWrite }) {
  const [fy, setFy] = useState(lastClosedFy());
  const [data, setData] = useState(null);
  const [parties, setParties] = useState([]);
  const [issue, setIssue] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [popup, setPopup] = useState(null);
  const load = useCallback(() => { api.balanceConfirmations.list(fy).then(setData).catch(() => setData(null)); }, [fy]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([api.ledger.sellers().catch(() => []), api.ledger.buyers().catch(() => [])])
      .then(([s, b]) => setParties([...s.map((x) => ({ ...x, side: 'Seller' })), ...b.map((x) => ({ ...x, side: 'Buyer' }))]));
  }, []);
  const err = (title) => (e) => setPopup({ tone: 'error', title, message: e?.response?.data?.error || 'Something went wrong.' });
  const years = Array.from({ length: 4 }, (_, i) => { const y = Number(lastClosedFy().slice(0, 4)) - i; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });

  return (
    <Card title="Annual balance confirmation">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">{years.map((y) => <option key={y} value={y}>FY {y} (as on 31 Mar {Number(y.slice(0, 4)) + 1})</option>)}</select>
        {data && <span style={{ fontSize: 13 }}>{data.totals.issued} issued · {data.totals.confirmed} confirmed · {data.totals.disputed} disputed · {data.totals.awaiting} awaiting</span>}
        {canWrite && <button type="button" className="btn btn-primary btn-sm" onClick={() => setIssue({ entity_id: '' })}>Issue confirmation letter</button>}
      </div>
      {!data ? <p>Loading…</p> : data.rows.length === 0 ? <p style={{ margin: 0 }}>No balance confirmation issued for FY {fy} yet.</p> : (
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr><th>No.</th><th>Counterparty</th><th>Opening</th><th>Billed</th><th>Paid &amp; adjusted</th><th>Closing (SJVN books)</th><th>Their balance</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.confirmation_no}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>issued {fmtDate(b.issued_at)}</div></td>
                  <td>{b.entity_name}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{b.party_side === 'BUYER' ? 'Buyer' : 'Seller'}</div></td>
                  <td>{fmtCurrency(b.opening_balance)}</td>
                  <td>{fmtCurrency(b.billed)}</td>
                  <td>{fmtCurrency(b.settled)}</td>
                  <td><strong>{fmtCurrency(b.closing_balance)}</strong></td>
                  <td>{b.confirmed_balance == null ? '—' : <>{fmtCurrency(b.confirmed_balance)}{b.difference ? <div style={{ fontSize: 12, color: 'var(--red-strong, #b91c1c)' }}>diff {fmtCurrency(b.difference)}</div> : null}</>}</td>
                  <td><Badge status={b.status === 'CONFIRMED' ? 'ACTIVE' : b.status === 'DISPUTED' ? 'DISPUTED' : 'PENDING'} label={b.status === 'ISSUED' ? 'Awaiting reply' : b.status === 'CONFIRMED' ? 'Confirmed' : 'Disputed'} />
                    {b.remarks && <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{b.remarks}</div>}</td>
                  <td>
                    <div className="cell-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.balanceConfirmations.letterPdf(b.id).then((blob) => save(blob, `balance-confirmation-${b.confirmation_no.replaceAll('/', '-')}.pdf`)).catch(err('Letter not ready'))}>Letter PDF</button>
                      {b.has_certificate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.balanceConfirmations.certificate(b.id).then((blob) => save(blob, b.certificate_name || 'certificate')).catch(err('Certificate not found'))}>Certificate</button>}
                      {canWrite && b.status === 'ISSUED' && <button type="button" className="btn btn-outline btn-sm" onClick={() => setAnswer({ row: b, status: 'CONFIRMED', confirmed_balance: '', auditor_name: '', remarks: '', file: null })}>Record reply</button>}
                      {canWrite && b.status !== 'ISSUED' && !b.has_certificate && (
                        <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                          Attach auditor certificate
                          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" style={{ display: 'none' }} onChange={(e) => {
                            const f = e.target.files?.[0]; e.target.value = '';
                            if (f) api.balanceConfirmations.uploadCertificate(b.id, f).then(load).catch(err('Certificate not filed'));
                          }} />
                        </label>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!issue} onClose={() => setIssue(null)} title={`Issue balance confirmation — FY ${fy}`} width={480}>
        {issue && (
          <form noValidate onSubmit={(e) => {
            e.preventDefault();
            if (!issue.entity_id) { setPopup({ tone: 'error', title: 'Choose the counterparty' }); return; }
            api.balanceConfirmations.issue({ entity_id: issue.entity_id, financial_year: fy }).then(() => { setIssue(null); load(); }).catch(err('Letter not issued'));
          }}>
            <p style={{ fontSize: 13, marginTop: 0 }}>The figures are taken from the counterparty ledger as on 31 March and frozen in the letter. A letter still awaiting a reply can be issued again with fresh figures.</p>
            <Field label="Counterparty" required>
              <select value={issue.entity_id} onChange={(e) => setIssue({ entity_id: e.target.value })}>
                <option value="">Choose…</option>
                {parties.map((p) => <option key={`${p.side}-${p.id}`} value={p.id}>{p.name} ({p.side})</option>)}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setIssue(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Issue</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!answer} onClose={() => setAnswer(null)} title={answer ? `Reply to ${answer.row.confirmation_no}` : ''} width={500}>
        {answer && (
          <form noValidate onSubmit={(e) => {
            e.preventDefault();
            if (answer.status === 'DISPUTED' && (answer.confirmed_balance === '' || answer.remarks.trim().length < 10)) {
              setPopup({ tone: 'error', title: 'Reply is incomplete', items: ['Their balance', 'What the difference is made of (at least 10 characters)'] }); return;
            }
            api.balanceConfirmations.respond(answer.row.id, answer).then(() => { setAnswer(null); load(); }).catch(err('Reply not recorded'));
          }}>
            <Field label="The counterparty" required>
              <select value={answer.status} onChange={(e) => setAnswer({ ...answer, status: e.target.value })}>
                <option value="CONFIRMED">Confirmed our balance ({fmtCurrency(answer.row.closing_balance)})</option>
                <option value="DISPUTED">Gave a different balance</option>
              </select>
            </Field>
            {answer.status === 'DISPUTED' && <Field label="Their balance (₹)" required><input type="number" step="0.01" value={answer.confirmed_balance} onChange={(e) => setAnswer({ ...answer, confirmed_balance: e.target.value })} /></Field>}
            <Field label="Auditor (if certified)"><input value={answer.auditor_name} onChange={(e) => setAnswer({ ...answer, auditor_name: e.target.value })} /></Field>
            <Field label={answer.status === 'DISPUTED' ? 'What the difference is made of' : 'Remarks'}><textarea rows={2} value={answer.remarks} onChange={(e) => setAnswer({ ...answer, remarks: e.target.value })} /></Field>
            <Field label="Signed reply / auditor certificate"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(e) => setAnswer({ ...answer, file: e.target.files?.[0] || null })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setAnswer(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </Card>
  );
}
