import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { Modal, fmtCurrency } from '../../components/ui.jsx';

const STATUS_TONE = { SENT: 'green', SIMULATED: 'amber', FAILED: 'red', NO_EMAIL: 'gray' };
const STATUS_LABEL = { SENT: 'Sent', SIMULATED: 'Saved to outbox', FAILED: 'Failed', NO_EMAIL: 'No address' };

const when = (iso) => (iso ? new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * Send a hydro station bill to its beneficiaries.
 *
 * A REIA invoice has one counterparty and a single Send button. A station bill
 * has one beneficiary per row, so this is that button once per row: who it goes
 * to, whether it has gone, and a tick to send. Each beneficiary is mailed its
 * own page with the station bill behind it.
 */
export default function HydroBillSend({ bill, canWrite, onClose }) {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});
  const [typed, setTyped] = useState({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);

  const load = useCallback(async () => {
    if (!bill) return;
    setError('');
    try {
      const r = await api.hydroBilling.recipients(bill.id);
      setData(r);
      setTyped(Object.fromEntries(r.lines.map((l) => [l.line_id, l.emails.join(', ')])));
      // Ticked by default: every beneficiary with an address that has not had this bill yet.
      setPicked(Object.fromEntries(r.lines.map((l) => [l.line_id,
        l.emails.length > 0 && !['SENT', 'SIMULATED'].includes(l.last_delivery?.status)])));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, [bill]);

  useEffect(() => { setData(null); setOutcome(null); load(); }, [load]);

  const chosen = (data?.lines || []).filter((l) => picked[l.line_id]);
  const missing = chosen.filter((l) => !(typed[l.line_id] || '').trim());

  async function send() {
    setError('');
    setOutcome(null);
    setSending(true);
    try {
      const r = await api.hydroBilling.send(bill.id, {
        lines: chosen.map((l) => ({ line_id: l.line_id, to: (typed[l.line_id] || '').trim() })),
      });
      setOutcome(r);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSending(false);
    }
  }

  const allTicked = data && data.lines.length > 0 && data.lines.every((l) => picked[l.line_id]);

  return (
    <Modal open={!!bill} onClose={onClose} title={`Send ${bill?.bill_no || ''} to beneficiaries`} width={860}>
      <p style={{ marginTop: 0, color: 'var(--text-light)', fontSize: 13 }}>
        Each beneficiary is emailed its own bill — its page first, then the station bill it is worked
        from. An address typed here is kept for that beneficiary&apos;s next bill.
      </p>

      {data && !data.can_send && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 10 }}>
          {data.bill_no} is {data.status}. A bill can be sent only once it has been approved and issued;
          until then it can be printed for checking.
        </div>
      )}
      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {outcome && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 10 }}>
          {outcome.sent > 0 && <span>{outcome.sent} sent. </span>}
          {outcome.simulated > 0 && (
            <span>{outcome.simulated} saved to the outbox — no mail server is configured, so nothing left the platform. </span>
          )}
          {outcome.failed > 0 && <span>{outcome.failed} failed. </span>}
          {outcome.no_email > 0 && <span>{outcome.no_email} skipped for want of an address.</span>}
        </div>
      )}

      {!data && !error && <p>Loading…</p>}
      {data && (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox" aria-label="Select all beneficiaries" checked={!!allTicked}
                    disabled={!canWrite || !data.can_send}
                    onChange={(e) => setPicked(Object.fromEntries(data.lines.map((l) => [l.line_id, e.target.checked])))}
                  />
                </th>
                <th>Beneficiary</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Email</th>
                <th>Last sent</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.line_id}>
                  <td>
                    <input
                      type="checkbox" aria-label={`Send to ${l.beneficiary_name}`}
                      checked={!!picked[l.line_id]} disabled={!canWrite || !data.can_send}
                      onChange={(e) => setPicked({ ...picked, [l.line_id]: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.beneficiary_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{l.bill_ref}</div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtCurrency(l.total_charges)}</td>
                  <td>
                    <input
                      type="text" className="form-control" style={{ minWidth: 220 }}
                      aria-label={`Email for ${l.beneficiary_name}`}
                      placeholder="name@discom.in, second@discom.in"
                      value={typed[l.line_id] || ''} disabled={!canWrite}
                      onChange={(e) => setTyped({ ...typed, [l.line_id]: e.target.value })}
                    />
                    {l.source === 'ENTITY' && (
                      <div style={{ fontSize: 11, color: 'var(--text-light)' }}>from the beneficiary&apos;s entity record</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {l.last_delivery ? (
                      <>
                        <span className={`badge badge-${STATUS_TONE[l.last_delivery.status] || 'gray'}`}>
                          {STATUS_LABEL[l.last_delivery.status] || l.last_delivery.status}
                        </span>
                        <div style={{ color: 'var(--text-light)', marginTop: 2 }}>
                          {when(l.last_delivery.created_at)}{l.last_delivery.sent_by ? ` · ${l.last_delivery.sent_by}` : ''}
                        </div>
                      </>
                    ) : <span style={{ color: 'var(--text-light)' }}>not sent</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        {canWrite && (
          <button
            type="button" className="btn btn-primary"
            disabled={sending || !data?.can_send || chosen.length === 0 || missing.length > 0}
            onClick={send}
          >
            {sending ? 'Sending…' : `Send to ${chosen.length} beneficiar${chosen.length === 1 ? 'y' : 'ies'}`}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>Close</button>
        {missing.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--danger, #b91c1c)' }}>
            No address for {missing.map((l) => l.beneficiary_name).join(', ')} — type one or untick.
          </span>
        )}
      </div>
    </Modal>
  );
}
