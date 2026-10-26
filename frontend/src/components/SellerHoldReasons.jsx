import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { fmtCurrency } from './ui.jsx';

// Why SJVN is holding a developer's bill (16.5 follow-up): the checks SJVN
// works through before approving it, with SJVN's note on each that is not
// clear. A seller reads only its own bill's checklist (the API scopes it).
const HELD = ['SUBMITTED', 'UNDER_APPROVAL', 'REJECTED'];

export default function SellerHoldReasons({ invoice }) {
  const [v, setV] = useState(null);
  const own = invoice && !String(invoice.invoice_breakdown_json || '').trim() && HELD.includes(invoice.status);
  useEffect(() => {
    setV(null);
    if (own) api.invoices.getVerification(invoice.id).then(setV).catch(() => setV(null));
  }, [invoice?.id, invoice?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!own || !v) return null;
  const open = (v.technical || []).filter((t) => t.status !== 'VERIFIED' && t.status !== 'NOT_APPLICABLE');
  const gap = Number(v.commercial_gap) || 0;
  const done = v.verification_status === 'VERIFIED';
  return (
    <div style={{ marginTop: 16, border: `1px solid ${done ? 'var(--t-green-100)' : 'var(--t-amber-line)'}`, background: done ? 'var(--t-green-50)' : 'var(--t-amber-50)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {done ? 'SJVN has verified this bill — it is with the approvers.'
          : !v.started ? 'SJVN has not started verifying this bill yet.'
            : invoice.status === 'REJECTED' ? 'Why SJVN sent this bill back' : 'Why SJVN is holding this bill'}
      </div>
      {!done && v.started && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15 }}>
          {open.map((t) => (
            <li key={t.key}><strong>{t.label}</strong> — {t.status === 'FAILED' ? 'did not pass' : 'still to be checked'}{t.note ? `: ${t.note}` : ''}</li>
          ))}
          {Math.abs(gap) > 0.5 && <li><strong>Amount</strong> — the bill and SJVN&apos;s build-up differ by {fmtCurrency(Math.abs(gap))}</li>}
          {!open.length && Math.abs(gap) <= 0.5 && <li>All checks pass; the approval is with SJVN.</li>}
        </ul>
      )}
    </div>
  );
}
