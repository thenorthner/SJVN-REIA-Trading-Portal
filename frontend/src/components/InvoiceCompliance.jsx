import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Field, fmtCurrency } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// What goes with a seller's invoice besides its figures: the TDS to expect,
// the e-invoice reference, the digitally signed copy, and the hard copy's
// journey. The seller fills these in; the REIA desk reads them and records
// receipt of the paper.

const errText = (e) => e.response?.data?.error || e.message;
const Tick = ({ ok, children }) => (
  <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3, color: ok === true ? '#15803d' : ok === false ? '#b91c1c' : 'var(--slate-500)' }}>
    {ok === true ? '✓' : ok === false ? '✗' : '·'} {children}
  </div>
);
const Row = ({ label, children }) => (
  <div className="detail-item"><span className="detail-label">{label}</span><span className="detail-value">{children}</span></div>
);

/** The TDS estimate, as a short statement of how it was arrived at. */
export function TdsEstimate({ tds, total }) {
  if (!tds) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-main, #f8fafc)' }}>
      <div className="detail-grid mb-0">
        <Row label={`Billed earlier in ${tds.financial_year}`}>{fmtCurrency(tds.billed_before)}</Row>
        <Row label="Of this bill, liable to TDS">{fmtCurrency(tds.liable_amount)}</Row>
        <Row label={`TDS u/s ${tds.section} @ ${tds.rate_pct}%`}><strong style={{ color: tds.tds_amount > 0 ? '#b45309' : 'inherit' }}>{fmtCurrency(tds.tds_amount)}</strong></Row>
        <Row label="Expected net payment"><strong style={{ color: '#15803d' }}>{fmtCurrency(tds.net_payable ?? (total - tds.tds_amount))}</strong></Row>
      </div>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--slate-500)', lineHeight: 1.5 }}>
        {tds.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}

export default function InvoiceCompliance({ invoice, onChanged }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const [irnForm, setIrnForm] = useState(null);
  const [qr, setQr] = useState(null);
  const [signedFile, setSignedFile] = useState(null);
  const [courier, setCourier] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.invoiceCompliance.get(invoice.id).then(setC).catch((e) => setError(errText(e))), [invoice.id]);
  useEffect(() => { setQr(null); load(); }, [load, invoice.status]);

  const run = async (fn, after) => {
    setBusy(true);
    try {
      setC(await fn());
      setError('');
      after?.();
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // The portal hands back a JSON file with the IRN, the acknowledgement and the signed QR in it.
  function readIrpFile(file) {
    if (!file) return;
    file.text().then((text) => {
      const j = JSON.parse(text);
      const d = Array.isArray(j) ? j[0] : j.Data || j.data || j;
      setIrnForm((f) => ({
        ...f,
        irn: d.Irn || d.irn || f.irn,
        ack_no: String(d.AckNo || d.ackNo || f.ack_no || ''),
        ack_date: String(d.AckDt || d.ackDt || f.ack_date || '').slice(0, 10),
        signed_qr: d.SignedQRCode || d.signedQRCode || f.signed_qr,
      }));
      setError('');
    }).catch(() => setError('That file could not be read as the portal\'s e-invoice JSON. Enter the details by hand instead.'));
  }

  async function attachSigned(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', signedFile);
      fd.append('contract_id', invoice.contract_id);
      fd.append('document_type', 'SELLER_INVOICE_SIGNED');
      fd.append('category', 'RECORD');
      fd.append('title', `Signed invoice ${invoice.invoice_no}`);
      const up = await api.documents.upload(fd);
      setC(await api.invoiceCompliance.attachSigned(invoice.id, up.version_id));
      setSignedFile(null);
      setError('');
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!c) return error ? <div className="alert alert-error">{error}</div> : null;
  // On a bill SJVN raised on a buyer only the e-invoice and the signed copy apply:
  // SJVN's desk records them and the buyer reads them.
  const sjvnBill = !!c.sjvn_bill;
  const e = c.einvoice;
  const s = c.signed_copy;
  const h = c.hardcopy;
  const seller = c.side === 'SELLER';
  const afterSubmit = !['DRAFT', 'PENDING_L2', 'CANCELLED'].includes(c.status);

  return (
    <div style={{ marginTop: 18 }}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {!sjvnBill && <div className="section-title">TDS — what to expect on payment</div>}
      {!sjvnBill && <TdsEstimate tds={c.tds} total={invoice.total_amount} />}

      <div className="section-title" style={{ marginTop: sjvnBill ? 0 : 18 }}>
        E-invoice (IRN &amp; QR){c.requirements.irn ? <span style={{ color: '#b91c1c', fontWeight: 600 }}> — required before SJVN approves</span> : ''}
      </div>
      {e ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12.5, wordBreak: 'break-all' }}><strong>IRN</strong> {e.irn}</div>
            <div style={{ fontSize: 12.5, color: 'var(--slate-600)', marginTop: 2 }}>
              {e.ack_no ? `Ack No. ${e.ack_no}` : 'No acknowledgement number'}{e.ack_date ? ` · ${fmtDate(e.ack_date)}` : ''}
            </div>
            {e.checks.map((k) => <Tick key={k.text} ok={k.ok}>{k.text}</Tick>)}
            <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 6 }}>
              Compared with this bill as given. The portal's signature on the QR is not verified here — scan the QR with the GST e-invoice verifier app for that.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {e.has_qr && !qr && <button type="button" className="btn btn-secondary btn-sm" onClick={() => api.invoiceCompliance.qr(invoice.id).then((r) => setQr(r.data_url)).catch((x) => setError(errText(x)))}>Show QR code</button>}
              {c.can_edit && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIrnForm({ irn: e.irn, ack_no: e.ack_no || '', ack_date: e.ack_date || '', signed_qr: '' })}>Change</button>}
              {c.can_edit && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => window.confirm('Remove the e-invoice details from this invoice?') && run(() => api.invoiceCompliance.removeEinvoice(invoice.id))}>Remove</button>}
            </div>
          </div>
          {qr && <img src={qr} alt="Signed e-invoice QR code" width={150} height={150} style={{ border: '1px solid var(--border)', borderRadius: 6 }} />}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>
          No e-invoice reference is recorded on this invoice.
          {seller && ' If you registered it on the GST invoice portal, add the IRN here. The sale of electricity is not itself a taxable supply, so many power invoices have none.'}
          {c.can_edit && !irnForm && <div style={{ marginTop: 8 }}><button type="button" className="btn btn-secondary btn-sm" onClick={() => setIrnForm({ irn: '', ack_no: '', ack_date: '', signed_qr: '' })}>Add IRN &amp; QR</button></div>}
        </div>
      )}
      {irnForm && (
        <form className="cw-form" onSubmit={(ev) => { ev.preventDefault(); run(() => api.invoiceCompliance.saveEinvoice(invoice.id, irnForm), () => { setIrnForm(null); setQr(null); }); }}>
          <Field label="The portal's e-invoice JSON (fills the fields below)">
            <input type="file" accept=".json,application/json" onChange={(ev) => readIrpFile(ev.target.files[0])} />
          </Field>
          <Field label="IRN (64 characters)" required>
            <input required value={irnForm.irn} onChange={(ev) => setIrnForm({ ...irnForm, irn: ev.target.value.trim() })} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Field>
          <div className="form-grid">
            <Field label="Acknowledgement No."><input value={irnForm.ack_no} onChange={(ev) => setIrnForm({ ...irnForm, ack_no: ev.target.value.trim() })} /></Field>
            <Field label="Acknowledgement date"><input type="date" value={irnForm.ack_date} onChange={(ev) => setIrnForm({ ...irnForm, ack_date: ev.target.value })} /></Field>
          </div>
          <Field label="Signed QR code text (SignedQRCode)">
            <textarea rows={3} value={irnForm.signed_qr} onChange={(ev) => setIrnForm({ ...irnForm, signed_qr: ev.target.value.trim() })} style={{ fontFamily: 'monospace', fontSize: 11 }} placeholder="eyJhbGciOi…" />
          </Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setIrnForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Save</button></div>
        </form>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>
        Digitally signed copy{c.requirements.signed_copy ? <span style={{ color: '#b91c1c', fontWeight: 600 }}> — required before SJVN approves</span> : ''}
      </div>
      {s ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <span><strong>{s.file_name}</strong> · attached {fmtDateTime(s.created_at)}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(s)}>View</button>
          </div>
          {s.signed
            ? <Tick ok>A digital signature is present{s.signer ? ` — signer: ${s.signer}` : ''}{s.signed_on ? `, signed ${s.signed_on}` : ''}{s.signatures > 1 ? ` (${s.signatures} signatures)` : ''}.</Tick>
            : <Tick ok={false}>No digital signature was found in this PDF. Sign it with your DSC or Aadhaar e-Sign and attach it again.</Tick>}
          <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4 }}>
            This reads the signature in the file. It does not validate the certificate — open the PDF in a reader that does for that.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>
          No signed copy is attached.{seller && ' Download the PDF bill above, sign it with your DSC token or Aadhaar e-Sign, and attach the signed file here.'}
        </div>
      )}
      {c.can_edit && (
        <form onSubmit={attachSigned} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <input key={s?.version_id || 'none'} type="file" accept=".pdf,application/pdf" onChange={(ev) => setSignedFile(ev.target.files[0])} aria-label="Signed invoice PDF" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!signedFile || busy}>{s ? 'Replace signed copy' : 'Attach signed copy'}</button>
        </form>
      )}

      {!sjvnBill && <div className="section-title" style={{ marginTop: 18 }}>Hard copy by courier</div>}
      {sjvnBill ? null : h ? (
        <div style={{ fontSize: 13 }}>
          Sent by <strong>{h.courier}</strong>, docket / AWB <strong>{h.docket_no}</strong>, on {fmtDate(h.dispatched_on)}.
          {h.received_on
            ? <Tick ok>Received by SJVN on {fmtDate(h.received_on)}{h.received_by ? ` — ${h.received_by}` : ''}{h.note ? ` (${h.note})` : ''}.</Tick>
            : <Tick ok={null}>Not yet recorded as received by SJVN.</Tick>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {seller && !h.received_on && !courier && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCourier({ courier: h.courier, docket_no: h.docket_no, dispatched_on: h.dispatched_on })}>Correct</button>}
            {c.can_manage && !h.received_on && !receipt && <button type="button" className="btn btn-primary btn-sm" onClick={() => setReceipt({ received_on: new Date().toISOString().slice(0, 10), note: '' })}>Mark received</button>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>
          No hard copy has been recorded as sent.
          {seller && afterSubmit && !courier && <div style={{ marginTop: 8 }}><button type="button" className="btn btn-secondary btn-sm" onClick={() => setCourier({ courier: '', docket_no: '', dispatched_on: new Date().toISOString().slice(0, 10) })}>Enter courier docket / AWB number</button></div>}
          {seller && !afterSubmit && ' You can enter the courier details once the invoice has been submitted to SJVN.'}
        </div>
      )}
      {courier && (
        <form className="cw-form" onSubmit={(ev) => { ev.preventDefault(); run(() => api.invoiceCompliance.dispatchHardcopy(invoice.id, courier), () => setCourier(null)); }}>
          <div className="form-grid">
            <Field label="Courier" required><input required value={courier.courier} onChange={(ev) => setCourier({ ...courier, courier: ev.target.value })} placeholder="e.g. Blue Dart, Speed Post" /></Field>
            <Field label="Docket / AWB number" required><input required value={courier.docket_no} onChange={(ev) => setCourier({ ...courier, docket_no: ev.target.value })} /></Field>
            <Field label="Dispatched on" required><input type="date" required value={courier.dispatched_on} onChange={(ev) => setCourier({ ...courier, dispatched_on: ev.target.value })} /></Field>
          </div>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setCourier(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Save</button></div>
        </form>
      )}
      {receipt && (
        <form className="cw-form" onSubmit={(ev) => { ev.preventDefault(); run(() => api.invoiceCompliance.receiveHardcopy(invoice.id, receipt), () => setReceipt(null)); }}>
          <div className="form-grid">
            <Field label="Received on" required><input type="date" required value={receipt.received_on} onChange={(ev) => setReceipt({ ...receipt, received_on: ev.target.value })} /></Field>
            <Field label="Inward no. / note"><input value={receipt.note} onChange={(ev) => setReceipt({ ...receipt, note: ev.target.value })} /></Field>
          </div>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setReceipt(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Record receipt</button></div>
        </form>
      )}

      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
