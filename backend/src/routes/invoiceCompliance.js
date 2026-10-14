/**
 * What goes with a seller's invoice besides its figures.
 *
 *   e-invoice    the IRN, acknowledgement and signed QR the seller got from the
 *                GST invoice portal. They are recorded and cross-checked against
 *                the bill; the portal's signature on the QR is not verified here.
 *   signed copy  the invoice PDF as the seller signed it. The file is looked at
 *                for a digital signature and what it says of itself; whether the
 *                certificate is valid is not established here.
 *   TDS          an estimate of what SJVN will deduct at source, worked from
 *                parameters Finance holds, so the seller knows what to expect.
 *   hard copy    the courier and docket the signed paper went by, and when SJVN
 *                received it.
 *
 * A seller acts on its own invoices; the REIA desk reads all of them and
 * records receipt of the paper.
 */
import { Router } from 'express';
import fs from 'fs';
import QRCode from 'qrcode';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import { pushNotification } from '../util.js';
import { getParam, getParamNumber } from '../mastersService.js';
import { contractVisibleTo, invoicePresentedTo, authoredBy } from '../services/counterpartyScope.js';

const router = Router();
router.use(requireAuth);

const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const canManage = (user) => ROLE_GROUPS.REIA_WRITE.includes(user?.role);
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => Promise.resolve().then(fn).then((v) => res.json(v)).catch((err) => {
  if (!err.status) console.error('[INVOICE]', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
});
const audit = (req, action, id, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'REIA', entityType: 'invoice', entityId: id, ...extra }); } catch (err) { console.error('[INVOICE] audit failed', err.message); }
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

/** The invoice, its contract and its seller, if the caller may see the invoice. */
function invoiceFor(user, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const contract = inv && db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  const side = counterpartySide(user) || (INTERNAL_READ.includes(user?.role) || user?.role === 'FINANCE_USER' ? 'SJVN' : null);
  if (!contract || !side || !contractVisibleTo(user, contract)) throw fail(404, 'Invoice not found');
  if (!invoicePresentedTo(user, inv) && !authoredBy(user, inv)) throw fail(404, 'Invoice not found');
  const seller = contract.seller_id ? db.prepare('SELECT id, name, pan_no, gst_no FROM entities WHERE id = ?').get(contract.seller_id) : null;
  return { inv, contract, seller, side };
}

/** The seller's own invoice, while it can still be added to: before SJVN has approved it. */
function ownOpenInvoice(user, id) {
  const ctx = invoiceFor(user, id);
  // A bill SJVN raises on a buyer is SJVN's document: its desk puts the IRN and
  // the signed copy on it, and the buyer reads them.
  if (ctx.inv.direction === 'SJVN_TO_BUYER') {
    if (!canManage(user)) throw fail(403, 'Only the REIA desk adds this to a bill SJVN has raised');
    return ctx;
  }
  if (ctx.inv.direction !== 'SELLER_TO_SJVN') throw fail(400, 'This applies to a seller\'s invoice to SJVN');
  if (ctx.side !== 'SELLER' && !canManage(user)) throw fail(403, 'Only the seller can add this to its invoice');
  return ctx;
}
const EDITABLE = ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED'];
/** A seller's invoice is open until SJVN approves it; SJVN's own bill until it is withdrawn. */
const stillOpen = (inv) => (inv.direction === 'SJVN_TO_BUYER' ? inv.status !== 'CANCELLED' : EDITABLE.includes(inv.status));

// ── TDS ─────────────────────────────────────────────────────────────────────

/** The financial year a billing month falls in, as its first and last month. */
function financialYear(period) {
  const [y, m] = String(period).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { label: `FY ${start}-${String(start + 1).slice(2)}`, from: `${start}-04`, to: `${start + 1}-03` };
}

/**
 * What SJVN would deduct at source on a bill of this size, on the parameters
 * Finance holds. The deduction is on purchases from one seller beyond a
 * threshold in the financial year, so what the seller has already billed this
 * year decides how much of this bill it falls on.
 *
 * An estimate, not a determination: the actual deduction is Finance's.
 */
export function estimateTds({ seller, billingPeriod, amount, taxes = 0, excludeInvoiceId = null }) {
  const section = String(getParam('seller_invoice_tds_section', '194Q'));
  const threshold = getParamNumber('seller_invoice_tds_threshold', 5000000);
  const hasPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(seller?.pan_no || '').toUpperCase().trim());
  const rate = hasPan ? getParamNumber('seller_invoice_tds_rate_pct', 0.1) : getParamNumber('seller_invoice_tds_no_pan_rate_pct', 5);
  const fy = financialYear(billingPeriod);
  const base = Math.max(0, Number(amount) - Number(taxes || 0));

  const before = seller ? db.prepare(`
    SELECT COALESCE(SUM(i.total_amount - COALESCE(i.taxes, 0)), 0) AS v
    FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE c.seller_id = ? AND i.direction = 'SELLER_TO_SJVN'
      AND i.billing_period BETWEEN ? AND ?
      AND i.status NOT IN ('DRAFT','PENDING_L2','REJECTED','CANCELLED')
      AND i.id <> ?
      -- "Billed earlier" is what was raised before this bill, not everything
      -- else in the year: a bill raised afterwards used to push this one's
      -- estimate over the threshold in hindsight.
      AND (? = '' OR i.rowid < COALESCE((SELECT rowid FROM invoices WHERE id = ?), i.rowid + 1))
  `).get(seller.id, fy.from, fy.to, excludeInvoiceId || '', excludeInvoiceId || '', excludeInvoiceId || '').v : 0;

  const over = (v) => Math.max(0, v - threshold);
  const liable = round2(over(before + base) - over(before));
  const tds = round2((liable * rate) / 100);
  return {
    section, rate_pct: rate, threshold, has_pan: hasPan, financial_year: fy.label,
    billed_before: round2(before), this_bill: round2(base), taxes_excluded: round2(Number(taxes || 0)),
    liable_amount: liable, tds_amount: tds, net_payable: round2(Number(amount) - tds),
    notes: [
      `Section ${section}: ${rate}% on purchases from one seller beyond ₹${threshold.toLocaleString('en-IN')} in a financial year.`,
      hasPan ? null : `No valid PAN is on your company record, so the higher rate of ${rate}% is used.`,
      Number(taxes) > 0 ? 'Worked on the bill value excluding the tax shown on it.' : null,
      'This is an estimate. The amount actually deducted is decided by SJVN Finance when the bill is paid.',
    ].filter(Boolean),
  };
}

// GET /tds-preview?contract_id=&billing_period=&amount=&taxes= — before the bill exists.
router.get('/tds-preview', (req, res) => send(res, () => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(String(req.query.contract_id || ''));
  if (!contract || !contractVisibleTo(req.user, contract)) throw fail(404, 'Contract not found');
  if (!/^\d{4}-\d{2}$/.test(req.query.billing_period || '')) throw fail(400, 'billing_period must be YYYY-MM');
  const amount = Number(req.query.amount);
  if (!(amount >= 0)) throw fail(400, 'amount must be a number');
  const seller = contract.seller_id ? db.prepare('SELECT id, name, pan_no, gst_no FROM entities WHERE id = ?').get(contract.seller_id) : null;
  return estimateTds({ seller, billingPeriod: req.query.billing_period, amount, taxes: Number(req.query.taxes) || 0 });
}));

// ── e-invoice ───────────────────────────────────────────────────────────────

/** What a signed QR says, without checking who signed it. */
function readSignedQr(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const data = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data || payload;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function einvoiceChecks({ inv, seller, irn, qr, sjvnBill = false }) {
  const checks = [];
  if (!qr) {
    checks.push({ ok: null, text: 'No signed QR was given, so the IRN could not be compared with the bill.' });
    return checks;
  }
  const same = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
  checks.push(same(qr.Irn, irn)
    ? { ok: true, text: 'The QR carries the same IRN.' }
    : { ok: false, text: 'The IRN inside the QR is not the IRN entered.' });
  if (qr.SellerGstin && seller?.gst_no) {
    checks.push(same(qr.SellerGstin, seller.gst_no)
      ? { ok: true, text: `Seller GSTIN in the QR (${qr.SellerGstin}) is your company's.` }
      : { ok: false, text: `Seller GSTIN in the QR (${qr.SellerGstin}) is not the one on your company record (${seller.gst_no}).` });
  }
  if (qr.DocNo) {
    checks.push(same(qr.DocNo, inv.invoice_no)
      ? { ok: true, text: `Document number in the QR matches this invoice (${inv.invoice_no}).` }
      : { ok: false, text: `Document number in the QR (${qr.DocNo}) is not this invoice's number (${inv.invoice_no}).` });
  }
  if (qr.TotInvVal != null) {
    checks.push(Math.abs(Number(qr.TotInvVal) - Number(inv.total_amount)) <= 1
      ? { ok: true, text: `Invoice value in the QR matches (₹${Number(qr.TotInvVal).toLocaleString('en-IN')}).` }
      : { ok: false, text: `Invoice value in the QR (₹${Number(qr.TotInvVal).toLocaleString('en-IN')}) is not this bill's total (₹${Number(inv.total_amount).toLocaleString('en-IN')}).` });
  }
  const sjvnGstin = String(getParam('sjvn_gstin', '') || '').trim();
  if (!sjvnBill && qr.BuyerGstin && sjvnGstin) {
    checks.push(same(qr.BuyerGstin, sjvnGstin)
      ? { ok: true, text: 'Buyer GSTIN in the QR is SJVN\'s.' }
      : { ok: false, text: `Buyer GSTIN in the QR (${qr.BuyerGstin}) is not SJVN's (${sjvnGstin}).` });
  }
  return checks;
}

// ── Signed copy ─────────────────────────────────────────────────────────────

/**
 * Whether a PDF carries a digital signature, and what the signature says of
 * itself. This reads the file; it does not validate the certificate or check
 * that the document is unchanged since signing.
 */
export function inspectSignature(filePath) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return { is_pdf: false, signed: false }; }
  if (buf.slice(0, 4).toString('latin1') !== '%PDF') return { is_pdf: false, signed: false };
  const text = buf.toString('latin1');
  const signed = /\/ByteRange\s*\[/.test(text) && /\/(Type\s*\/Sig|SubFilter\s*\/(adbe\.pkcs7|ETSI\.CAdES|adbe\.x509))/.test(text);
  if (!signed) return { is_pdf: true, signed: false };
  const field = (name) => {
    const m = new RegExp(`/${name}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(text);
    return m ? m[1].replace(/\\([()\\])/g, '$1').slice(0, 200) : null;
  };
  const when = /\/M\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(text);
  return {
    is_pdf: true, signed: true,
    signer: field('Name'), reason: field('Reason'), location: field('Location'),
    signed_on: when ? `${when[1]}-${when[2]}-${when[3]}${when[4] ? ` ${when[4]}:${when[5] || '00'}` : ''}` : null,
    signatures: (text.match(/\/ByteRange\s*\[/g) || []).length,
  };
}

// ── The panel ───────────────────────────────────────────────────────────────

const flag = (key) => String(getParam(key, '0')) === '1';

function panel(ctx) {
  const { inv, seller, side } = ctx;
  const version = inv.signed_version_id ? db.prepare(`
    SELECT v.id AS version_id, v.file_name, v.created_at FROM document_versions v WHERE v.id = ?
  `).get(inv.signed_version_id) : null;
  const sellerInvoice = inv.direction === 'SELLER_TO_SJVN';
  return {
    invoice_id: inv.id,
    invoice_no: inv.invoice_no,
    status: inv.status,
    side,
    can_edit: sellerInvoice ? (side === 'SELLER' || side === 'SJVN') && EDITABLE.includes(inv.status) : side === 'SJVN' && inv.status !== 'CANCELLED',
    sjvn_bill: !sellerInvoice,
    can_manage: side === 'SJVN',
    requirements: { irn: flag('seller_invoice_requires_irn'), signed_copy: flag('seller_invoice_requires_signed_copy') },
    tds: sellerInvoice ? estimateTds({ seller, billingPeriod: inv.billing_period, amount: inv.total_amount, taxes: inv.taxes, excludeInvoiceId: inv.id }) : null,
    einvoice: inv.irn ? {
      irn: inv.irn, ack_no: inv.irn_ack_no, ack_date: inv.irn_ack_date, has_qr: !!inv.irn_signed_qr,
      checks: parse(inv.irn_checks_json) || [], recorded_at: inv.irn_recorded_at,
    } : null,
    signed_copy: version ? { ...version, ...(parse(inv.signed_info_json) || {}) } : null,
    hardcopy: inv.hardcopy_docket_no ? {
      courier: inv.hardcopy_courier, docket_no: inv.hardcopy_docket_no, dispatched_on: inv.hardcopy_dispatched_on,
      received_on: inv.hardcopy_received_on, received_by: inv.hardcopy_received_by, note: inv.hardcopy_note,
    } : null,
  };
}
const fresh = (user, id) => panel(invoiceFor(user, id));

/** What an approval would be refused for, where SJVN has made these mandatory. Used by the approval route. */
export function complianceBlock(inv) {
  if (inv.direction !== 'SELLER_TO_SJVN') return null;
  if (flag('seller_invoice_requires_signed_copy') && !inv.signed_version_id) return 'The seller has not attached the digitally signed copy of this invoice.';
  if (flag('seller_invoice_requires_irn') && !inv.irn) return 'The seller has not recorded the e-invoice IRN for this invoice.';
  return null;
}

// GET /:id — everything this module holds on one invoice.
router.get('/:id', (req, res) => send(res, () => fresh(req.user, req.params.id)));

// POST /:id/einvoice { irn, ack_no, ack_date, signed_qr }
router.post('/:id/einvoice', (req, res) => send(res, () => {
  const ctx = ownOpenInvoice(req.user, req.params.id);
  if (!stillOpen(ctx.inv)) throw fail(400, 'The e-invoice details can no longer be changed on this invoice');
  const irn = String(req.body.irn || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(irn)) throw fail(400, 'An IRN is 64 characters of 0–9 and a–f');
  const ackNo = String(req.body.ack_no || '').trim();
  if (ackNo && !/^\d{1,30}$/.test(ackNo)) throw fail(400, 'The acknowledgement number must contain digits only');
  const ackDate = String(req.body.ack_date || '').trim().slice(0, 10);
  if (ackDate && !DAY.test(ackDate)) throw fail(400, 'The acknowledgement date must be YYYY-MM-DD');
  const signedQr = String(req.body.signed_qr || '').trim();
  if (signedQr.length > 6000) throw fail(400, 'The signed QR text is too long');
  const qr = signedQr ? readSignedQr(signedQr) : null;
  if (signedQr && !qr) throw fail(400, 'The signed QR could not be read. Paste the SignedQRCode value exactly as the portal returned it.');
  const dup = db.prepare('SELECT invoice_no FROM invoices WHERE irn = ? AND id <> ?').get(irn, ctx.inv.id);
  if (dup) throw fail(400, `This IRN is already recorded on invoice ${dup.invoice_no}`);

  const sjvnBill = ctx.inv.direction === 'SJVN_TO_BUYER';
  // On SJVN's own bill the supplier is SJVN, so the seller-company comparisons do not apply.
  const checks = einvoiceChecks({ inv: ctx.inv, seller: sjvnBill ? null : ctx.seller, irn, qr, sjvnBill });
  db.prepare(`
    UPDATE invoices SET irn = ?, irn_ack_no = ?, irn_ack_date = ?, irn_signed_qr = ?, irn_checks_json = ?,
      irn_recorded_by = ?, irn_recorded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(irn, ackNo || null, ackDate || null, signedQr || null, JSON.stringify(checks), req.user.id, ctx.inv.id);
  audit(req, 'INVOICE_IRN_RECORDED', ctx.inv.id, { afterValue: { irn, ack_no: ackNo || null, mismatches: checks.filter((c) => c.ok === false).length } });
  return fresh(req.user, ctx.inv.id);
}));

// DELETE /:id/einvoice — taken off again, while the invoice is still open.
router.delete('/:id/einvoice', (req, res) => send(res, () => {
  const ctx = ownOpenInvoice(req.user, req.params.id);
  if (!stillOpen(ctx.inv)) throw fail(400, 'The e-invoice details can no longer be changed on this invoice');
  db.prepare(`UPDATE invoices SET irn = NULL, irn_ack_no = NULL, irn_ack_date = NULL, irn_signed_qr = NULL, irn_checks_json = NULL, irn_recorded_by = NULL, irn_recorded_at = NULL WHERE id = ?`).run(ctx.inv.id);
  audit(req, 'INVOICE_IRN_REMOVED', ctx.inv.id, { beforeValue: { irn: ctx.inv.irn } });
  return fresh(req.user, ctx.inv.id);
}));

// GET /:id/einvoice/qr — the signed QR as a picture.
router.get('/:id/einvoice/qr', (req, res) => send(res, async () => {
  const { inv } = invoiceFor(req.user, req.params.id);
  if (!inv.irn_signed_qr) throw fail(404, 'No signed QR is recorded on this invoice');
  return { data_url: await QRCode.toDataURL(inv.irn_signed_qr, { errorCorrectionLevel: 'L', margin: 1, width: 260 }) };
}));

// POST /:id/signed-copy { version_id } — the invoice as the seller signed it, already uploaded to the contract.
router.post('/:id/signed-copy', (req, res) => send(res, () => {
  const ctx = ownOpenInvoice(req.user, req.params.id);
  if (!stillOpen(ctx.inv)) throw fail(400, 'The signed copy can no longer be changed on this invoice');
  const v = db.prepare(`
    SELECT v.id, v.file_path, v.file_name FROM document_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.id = ? AND d.contract_id = ?
  `).get(String(req.body.version_id || ''), ctx.contract.id);
  if (!v) throw fail(400, 'That file is not one of this contract\'s documents');
  const info = inspectSignature(v.file_path);
  if (!info.is_pdf) throw fail(400, 'The signed copy must be a PDF');
  db.prepare(`UPDATE invoices SET signed_version_id = ?, signed_info_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(v.id, JSON.stringify(info), ctx.inv.id);
  audit(req, 'INVOICE_SIGNED_COPY_ATTACHED', ctx.inv.id, { afterValue: { file_name: v.file_name, signature_found: info.signed, signer: info.signer || null } });
  return fresh(req.user, ctx.inv.id);
}));

// POST /:id/hardcopy { courier, docket_no, dispatched_on } — the seller saying the paper is on its way.
router.post('/:id/hardcopy', (req, res) => send(res, () => {
  const ctx = invoiceFor(req.user, req.params.id);
  if (ctx.inv.direction !== 'SELLER_TO_SJVN') throw fail(400, 'This applies to a seller\'s invoice to SJVN');
  if (ctx.side !== 'SELLER' && !canManage(req.user)) throw fail(403, 'Only the seller records the dispatch of its hard copy');
  if (['DRAFT', 'PENDING_L2', 'CANCELLED'].includes(ctx.inv.status)) throw fail(400, 'The hard copy goes out once the invoice has been submitted to SJVN');
  if (ctx.inv.hardcopy_received_on) throw fail(400, 'SJVN has already recorded receipt of the hard copy');
  const courier = String(req.body.courier || '').trim().slice(0, 80);
  const docket = String(req.body.docket_no || '').trim().slice(0, 60);
  const dispatched = String(req.body.dispatched_on || '').trim() || today();
  if (!courier || !docket) throw fail(400, 'Give the courier and the docket / AWB number');
  if (!/^[A-Za-z0-9\-/ ]{4,60}$/.test(docket)) throw fail(400, 'A docket number is letters, digits, hyphens and slashes');
  if (!DAY.test(dispatched) || dispatched > today()) throw fail(400, 'The dispatch date must be today or earlier, as YYYY-MM-DD');
  db.prepare(`UPDATE invoices SET hardcopy_courier = ?, hardcopy_docket_no = ?, hardcopy_dispatched_on = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(courier, docket, dispatched, ctx.inv.id);
  audit(req, 'INVOICE_HARDCOPY_DISPATCHED', ctx.inv.id, { afterValue: { courier, docket_no: docket, dispatched_on: dispatched } });
  for (const role of ROLE_GROUPS.REIA_WRITE) pushNotification({ role, type: 'INVOICE_HARDCOPY', message: `Hard copy of invoice ${ctx.inv.invoice_no} dispatched by ${courier}, docket ${docket}.` });
  return fresh(req.user, ctx.inv.id);
}));

// POST /:id/hardcopy/received { received_on, note } — SJVN saying it has arrived.
router.post('/:id/hardcopy/received', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk records receipt of a hard copy');
  const ctx = invoiceFor(req.user, req.params.id);
  if (!ctx.inv.hardcopy_docket_no) throw fail(400, 'The seller has not recorded a dispatch for this invoice');
  if (ctx.inv.hardcopy_received_on) throw fail(400, 'Receipt has already been recorded');
  const received = String(req.body.received_on || '').trim() || today();
  if (!DAY.test(received) || received > today()) throw fail(400, 'The receipt date must be today or earlier, as YYYY-MM-DD');
  if (ctx.inv.hardcopy_dispatched_on && received < ctx.inv.hardcopy_dispatched_on) throw fail(400, 'It cannot have been received before it was dispatched');
  db.prepare(`UPDATE invoices SET hardcopy_received_on = ?, hardcopy_received_by = ?, hardcopy_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(received, req.user.name, String(req.body.note || '').trim().slice(0, 500) || null, ctx.inv.id);
  audit(req, 'INVOICE_HARDCOPY_RECEIVED', ctx.inv.id, { afterValue: { received_on: received } });
  if (ctx.contract.seller_id) {
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(ctx.contract.seller_id)) {
      pushNotification({ userId: u.id, type: 'INVOICE_HARDCOPY', message: `SJVN received the hard copy of invoice ${ctx.inv.invoice_no} on ${received}.` });
    }
  }
  return fresh(req.user, ctx.inv.id);
}));

export default router;
