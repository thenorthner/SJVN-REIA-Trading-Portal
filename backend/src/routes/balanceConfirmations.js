/**
 * R5: the year-end balance confirmation (Batch 5, 17-Oct-2026).
 *
 * For a counterparty and a closed financial year, SJVN's books give the
 * balance as on 31 March — opening, billed, paid and adjusted, closing — from
 * the same ledger as the statement of account. The letter asks the party to
 * confirm it or state its own figure; its answer, and the auditor's
 * certificate where one is given, are filed against the confirmation. The
 * figures are frozen when the letter is issued, so what was asked is what is
 * answered; a letter still unanswered can be re-issued with fresh figures.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { accountFor } from './sellerLedger.js';
import { deskUpload, letterProblem, deskFilePath, discardUpload } from '../services/deskFiles.js';
import { newDoc, header, kpiBand, sectionTitle, table, notes as footNotes, pageNumbers, M, CONTENT_W, INK, MUTED, nowLabel } from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);
const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER'])];
const upload = deskUpload('balance-certificates');
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn, code = 200) => {
  try { res.status(code).json(fn()); } catch (err) {
    if (!err.status) console.error('[BALANCE-CONFIRMATION]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};

function fyBounds(fy) {
  if (!/^\d{4}-\d{2}$/.test(String(fy || '')) || Number(fy.slice(5)) !== (Number(fy.slice(0, 4)) + 1) % 100) throw fail(400, 'financial_year must read like 2025-26');
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

const ROW = `SELECT b.*, e.name AS entity_name, e.pan_no, e.gst_no, e.address FROM balance_confirmations b JOIN entities e ON e.id = b.entity_id`;
const getRow = (id) => {
  const r = db.prepare(`${ROW} WHERE b.id = ?`).get(id);
  if (!r) throw fail(404, 'Balance confirmation not found');
  return r;
};

router.get('/', requireRole(...READ), (req, res) => send(res, () => {
  const fy = req.query.fy || null;
  const rows = db.prepare(`${ROW} ${fy ? 'WHERE b.financial_year = ?' : ''} ORDER BY b.financial_year DESC, e.name`).all(...(fy ? [fy] : []))
    .map((r) => ({ ...r, has_certificate: !!r.certificate_file, certificate_file: undefined }));
  return {
    rows,
    totals: { issued: rows.length, confirmed: rows.filter((r) => r.status === 'CONFIRMED').length, disputed: rows.filter((r) => r.status === 'DISPUTED').length, awaiting: rows.filter((r) => r.status === 'ISSUED').length },
  };
}));

// POST / { entity_id, financial_year } — freeze SJVN's figures and issue the letter.
router.post('/', requireRole(...WRITE), (req, res) => send(res, () => {
  const { entity_id: entityId, financial_year: fy } = req.body || {};
  const { from, to } = fyBounds(fy);
  if (to >= istToday()) throw fail(400, `FY ${fy} has not closed yet — the balance is confirmed as on 31 March, once the year is over.`);
  const entity = db.prepare('SELECT id, name, entity_type FROM entities WHERE id = ?').get(String(entityId || ''));
  if (!entity) throw fail(400, 'Choose the counterparty');
  const s = accountFor(entity.id, { from, to });
  const t = s.totals;
  const billed = money(t.billed + t.debit_notes + t.lps + t.refunds);
  const settled = money(t.received + t.tds + t.deductions + t.rebate + t.credit_notes + t.advances);
  const existing = db.prepare('SELECT * FROM balance_confirmations WHERE entity_id = ? AND party_side = ? AND financial_year = ?').get(entity.id, s.party_side, fy);
  if (existing && existing.status !== 'ISSUED') throw fail(409, `${entity.name} has already ${existing.status === 'CONFIRMED' ? 'confirmed' : 'disputed'} its FY ${fy} balance.`);
  if (existing) {
    db.prepare(`UPDATE balance_confirmations SET opening_balance = ?, billed = ?, settled = ?, closing_balance = ?, issued_by = ?, issued_at = datetime('now') WHERE id = ?`)
      .run(s.opening_balance, billed, settled, s.closing_balance, req.user.name, existing.id);
  } else {
    const seq = (db.prepare('SELECT COUNT(*) n FROM balance_confirmations WHERE financial_year = ?').get(fy).n || 0) + 1;
    db.prepare(`INSERT INTO balance_confirmations (id, confirmation_no, entity_id, party_side, financial_year, period_from, period_to, opening_balance, billed, settled, closing_balance, issued_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId('BCF'), `BC/${fy}/${String(seq).padStart(3, '0')}`, entity.id, s.party_side, fy, from, to, s.opening_balance, billed, settled, s.closing_balance, req.user.name);
  }
  const row = db.prepare('SELECT * FROM balance_confirmations WHERE entity_id = ? AND party_side = ? AND financial_year = ?').get(entity.id, s.party_side, fy);
  logAudit({ req, user: req.user, action: existing ? 'BALANCE_CONFIRMATION_REISSUED' : 'BALANCE_CONFIRMATION_ISSUED', module: 'REIA', entityType: 'entity', entityId: entity.id, details: { confirmation_no: row.confirmation_no, closing_balance: row.closing_balance } });
  return getRow(row.id);
}, 201));

// GET /:id/letter.pdf — the letter to the counterparty.
router.get('/:id/letter.pdf', requireRole(...READ), (req, res) => {
  let b;
  try { b = getRow(req.params.id); } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  const asOn = b.period_to;
  const buyer = b.party_side === 'BUYER';
  const owes = b.closing_balance >= 0
    ? (buyer ? `payable by ${b.entity_name} to SJVN Limited` : `payable by SJVN Limited to ${b.entity_name}`)
    : (buyer ? `payable by SJVN Limited to ${b.entity_name}` : `payable by ${b.entity_name} to SJVN Limited`);
  const title = 'Balance Confirmation';
  const ctx = { vertical: 'REIA', title, subtitle: `${b.confirmation_no}  ·  as on ${asOn}` };
  const doc = newDoc(res, `${title} — ${b.entity_name} — FY ${b.financial_year}`, `balance-confirmation-${b.confirmation_no.replaceAll('/', '-')}.pdf`);
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  doc.font('Helvetica').fontSize(9);
  for (const [k, v] of [['To', b.entity_name], ['Address', b.address || '—'], ['PAN / GSTIN', `${b.pan_no || '—'}  /  ${b.gst_no || '—'}`], ['Reference', `${b.confirmation_no} dated ${String(b.issued_at).slice(0, 10)}`]]) {
    doc.fillColor(MUTED).text(k, M, y, { width: 90 });
    doc.fillColor(INK).text(v, M + 95, y, { width: CONTENT_W - 95 });
    y = doc.y + 4;
  }
  y += 6;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Subject: Confirmation of balance as on ${asOn} (FY ${b.financial_year})`, M, y, { width: CONTENT_W });
  y = doc.y + 8;
  doc.font('Helvetica').fontSize(9).text(
    `As per the books of SJVN Limited, your account for the financial year ${b.financial_year} stands as summarised below, and the closing balance of Rs ${inr(Math.abs(b.closing_balance))} as on ${asOn} is ${owes}. `
    + 'Please confirm the balance by signing and returning a copy of this letter, or state the balance as per your books with a statement of the differences. '
    + 'The statutory auditors of SJVN Limited may rely on your reply; where your auditor certifies the balance, please attach the certificate.',
    M, y, { width: CONTENT_W, align: 'justify', lineGap: 2 },
  );
  y = doc.y + 10;
  y = kpiBand(doc, y, [
    { label: `Opening (${b.period_from})`, value: `Rs ${inr(b.opening_balance)}` },
    { label: 'Billed in the year', value: `Rs ${inr(b.billed)}` },
    { label: 'Paid & adjusted', value: `Rs ${inr(b.settled)}` },
    { label: `Closing (${asOn})`, value: `Rs ${inr(b.closing_balance)}` },
  ]);
  y = sectionTitle(doc, y, 'Summary as per SJVN books');
  y = table(doc, y, [
    { label: 'Particulars', w: CONTENT_W - 140, value: (r) => r.k },
    { label: 'Amount (Rs)', w: 140, align: 'right', value: (r) => r.v },
  ], [
    { k: `Balance brought forward as on ${b.period_from}`, v: inr(b.opening_balance) },
    { k: 'Add: bills, debit notes, surcharge and refunds in the year', v: inr(b.billed) },
    { k: 'Less: payments, TDS, deductions, rebate, credit notes and advances in the year', v: inr(b.settled) },
    { k: `Closing balance as on ${asOn} (${owes})`, v: inr(b.closing_balance) },
  ], ctx, { fontSize: 8.5, rowH: 18 });
  y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const half = (CONTENT_W - 20) / 2;
  doc.text('For SJVN Limited', M, y, { width: half });
  doc.text(`For ${b.entity_name}`, M + half + 20, y, { width: half });
  y += 44;
  doc.text('Authorised signatory', M, y, { width: half });
  doc.text('We confirm the balance above  /  Our balance is Rs ______________', M + half + 20, y, { width: half });
  y = doc.y + 30;
  doc.text('Authorised signatory, with seal', M + half + 20, y, { width: half });
  footNotes(doc, y + 30, [
    'A debit balance on a buyer\'s account is owed to SJVN; on a seller\'s account, owed by SJVN. A disputed bill counts in full until a credit note settles the dispute.',
    'Generated from the SJVN portal from the counterparty ledger as on the date of issue.',
  ]);
  pageNumbers(doc);
  doc.end();
  logAudit({ req, user: req.user, action: 'BALANCE_CONFIRMATION_LETTER', module: 'REIA', entityType: 'entity', entityId: b.entity_id, details: { confirmation_no: b.confirmation_no } });
});

// POST /:id/response (multipart: status, confirmed_balance, auditor_name, remarks, file?)
router.post('/:id/response', requireRole(...WRITE), upload.single('file'), (req, res) => {
  let b;
  try { b = getRow(req.params.id); } catch (err) { discardUpload(req.file); return res.status(err.status || 500).json({ error: err.message }); }
  const refuse = (msg, code = 400) => { discardUpload(req.file); return res.status(code).json({ error: msg }); };
  if (b.status !== 'ISSUED') return refuse(`${b.confirmation_no} is already ${b.status.toLowerCase()}.`, 409);
  const status = String(req.body?.status || '');
  if (!['CONFIRMED', 'DISPUTED'].includes(status)) return refuse('status must be CONFIRMED or DISPUTED');
  const theirs = req.body?.confirmed_balance === undefined || req.body.confirmed_balance === '' ? (status === 'CONFIRMED' ? b.closing_balance : null) : Number(req.body.confirmed_balance);
  if (theirs == null || !Number.isFinite(theirs)) return refuse('Give the balance as per the counterparty\'s books.');
  const diff = money(theirs - b.closing_balance);
  if (status === 'CONFIRMED' && Math.abs(diff) > 1) return refuse(`The party's balance differs from ours by Rs ${inr(diff)} — record it as disputed, with the reasons.`);
  const remarks = String(req.body?.remarks || '').trim();
  if (status === 'DISPUTED' && remarks.length < 10) return refuse('Say what the difference is made of — at least 10 characters.');
  if (req.file) {
    const problem = letterProblem(req.file);
    if (problem) return res.status(400).json({ error: problem });
  }
  db.prepare(`UPDATE balance_confirmations SET status = ?, confirmed_balance = ?, difference = ?, auditor_name = ?, remarks = ?,
      certificate_file = COALESCE(?, certificate_file), certificate_name = COALESCE(?, certificate_name), responded_by = ?, responded_at = datetime('now') WHERE id = ?`)
    .run(status, money(theirs), diff, String(req.body?.auditor_name || '').trim() || null, remarks || null, req.file?.filename || null, req.file?.originalname || null, req.user.name, b.id);
  logAudit({ req, user: req.user, action: `BALANCE_${status}`, module: 'REIA', entityType: 'entity', entityId: b.entity_id, details: { confirmation_no: b.confirmation_no, ours: b.closing_balance, theirs, difference: diff, certificate: req.file?.originalname || null } });
  res.json(getRow(b.id));
});

// POST /:id/certificate — the auditor's certificate, filed later.
router.post('/:id/certificate', requireRole(...WRITE), upload.single('file'), (req, res) => {
  let b;
  try { b = getRow(req.params.id); } catch (err) { discardUpload(req.file); return res.status(err.status || 500).json({ error: err.message }); }
  const problem = letterProblem(req.file);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE balance_confirmations SET certificate_file = ?, certificate_name = ?, auditor_name = COALESCE(?, auditor_name) WHERE id = ?')
    .run(req.file.filename, req.file.originalname, String(req.body?.auditor_name || '').trim() || null, b.id);
  logAudit({ req, user: req.user, action: 'BALANCE_CERTIFICATE_FILED', module: 'REIA', entityType: 'entity', entityId: b.entity_id, details: { confirmation_no: b.confirmation_no, file: req.file.originalname } });
  res.status(201).json(getRow(b.id));
});

router.get('/:id/certificate', requireRole(...READ), (req, res) => {
  let b;
  try { b = getRow(req.params.id); } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  const file = b.certificate_file && deskFilePath('balance-certificates', b.certificate_file);
  if (!file) return res.status(404).json({ error: 'No certificate is filed for this confirmation' });
  res.download(file, b.certificate_name || b.certificate_file);
});

export default router;
