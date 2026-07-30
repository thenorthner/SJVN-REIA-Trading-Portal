import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import {
  resolvePeriod, dueDateFor, deriveLines, evaluateLine, normalizeLine, getLines, refreshTotals,
  insertLine, submissionBlockers, toCsv,
} from '../services/cercFormIv.js';
import { generateFormIvPdf } from '../scripts/governanceReportsPdf.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;

const today = () => new Date().toISOString().slice(0, 10);

/** A submitted return is the filed record — it must not drift afterwards. */
function assertEditable(form, res) {
  if (form.status === 'SUBMITTED') {
    res.status(409).json({ error: 'This Form-IV is already submitted to CERC and can no longer be edited.' });
    return false;
  }
  return true;
}

function withDerived(form) {
  if (!form) return form;
  const overdue = form.status !== 'SUBMITTED' && !!form.due_date && form.due_date < today();
  let window = {};
  try {
    const w = resolvePeriod(form.period_type, form.period);
    window = { period_from: w.from, period_to: w.to };
  } catch {
    // Legacy rows may hold a free-text period; the window is only a UI hint.
  }
  return { ...form, ...window, is_overdue: overdue };
}

router.get('/', requireRole(...READ), (req, res) => {
  const { status, period_type } = req.query;
  let sql = 'SELECT * FROM cerc_form_iv WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (period_type) { sql += ' AND period_type = ?'; params.push(period_type); }
  sql += ' ORDER BY period DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withDerived));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END),0) submitted,
    COALESCE(SUM(CASE WHEN status!='SUBMITTED' THEN 1 ELSE 0 END),0) pending,
    COALESCE(SUM(breach_count),0) open_breaches,
    COALESCE(SUM(total_volume_mu),0) total_volume_mu,
    COALESCE(SUM(trading_margin),0) total_margin
    FROM cerc_form_iv`).get();

  const overdue = db.prepare(`
    SELECT COUNT(*) c FROM cerc_form_iv
    WHERE status != 'SUBMITTED' AND due_date IS NOT NULL AND due_date < ?
  `).get(today()).c;

  const latest = db.prepare("SELECT period, status, due_date FROM cerc_form_iv WHERE period_type='MONTHLY' ORDER BY period DESC LIMIT 1").get();

  res.json({
    ...row,
    overdue,
    latest_period: latest?.period || null,
    latest_status: latest?.status || 'Pending',
    latest_due_date: latest?.due_date || null,
  });
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  const lines = getLines(form.id);
  res.json({ ...withDerived(form), lines, blockers: submissionBlockers(form, lines) });
});

router.get('/:id/export', requireRole(...READ), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  const csv = toCsv(form, getLines(form.id));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${form.form_no.replaceAll('/', '-')}.csv"`);
  res.send(csv);
});

// Filing-format PDF — the return as it reads for review/submission, alongside
// the raw CSV export above.
router.get('/:id/pdf', requireRole(...READ), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  try {
    generateFormIvPdf(form, getLines(form.id), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Form-IV PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const period_type = b.period_type === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';

  let window;
  try {
    window = resolvePeriod(period_type, b.period);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const dup = db.prepare('SELECT id FROM cerc_form_iv WHERE period_type=? AND period=?').get(period_type, window.period);
  if (dup) return res.status(409).json({ error: `A ${period_type} Form-IV for ${window.period} already exists.` });

  const id = newId('FIV');
  const seq = (db.prepare('SELECT COUNT(*) c FROM cerc_form_iv').get().c || 0) + 1;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO cerc_form_iv (id, form_no, period_type, period, due_date, status, reference_no, notes, created_by)
      VALUES (@id, @form_no, @period_type, @period, @due_date, 'DRAFT', @reference_no, @notes, @created_by)
    `).run({
      id,
      form_no: `FORM-IV/${window.period}/${String(seq).padStart(3, '0')}`,
      period_type,
      period: window.period,
      due_date: dueDateFor(window.to),
      reference_no: b.reference_no || null,
      notes: b.notes || null,
      created_by: req.user.name,
    });

    // Pre-fill from trade data unless the preparer explicitly wants a blank form.
    if (b.auto_generate !== false) {
      deriveLines(window.from, window.to).forEach((l) => insertLine(id, l));
      db.prepare("UPDATE cerc_form_iv SET generated_at = datetime('now') WHERE id = ?").run(id);
      refreshTotals(id);
    }
  })();

  logAudit({ req, user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: id, details: b });
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(id);
  const lines = getLines(id);
  res.status(201).json({ ...withDerived(form), lines, blockers: submissionBlockers(form, lines) });
});

/**
 * Rebuild the lines from current trade data. Manually added lines and recorded
 * exemptions survive — only the auto-derived bilateral rows are replaced, so a
 * regenerate after a rate correction doesn't discard the preparer's work.
 */
router.post('/:id/generate', requireRole(...WRITE), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  if (!assertEditable(form, res)) return;

  let window;
  try {
    window = resolvePeriod(form.period_type, form.period);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const exemptions = new Map(
    getLines(form.id)
      .filter((l) => l.bilateral_id && l.exempt_reason)
      .map((l) => [l.bilateral_id, l.exempt_reason]),
  );
  const kept = getLines(form.id).filter((l) => l.source !== 'BILATERAL');

  db.transaction(() => {
    db.prepare("DELETE FROM cerc_form_iv_lines WHERE form_id = ? AND source = 'BILATERAL'").run(form.id);

    const derived = deriveLines(window.from, window.to).map((l) => {
      const reason = exemptions.get(l.bilateral_id);
      return reason ? { ...l, exempt_reason: reason, ...evaluateLine({ ...l, exempt_reason: reason }) } : l;
    });
    derived.forEach((l) => insertLine(form.id, l));

    // Manual lines keep their content but are renumbered after the derived block.
    kept.forEach((l, i) => {
      db.prepare('UPDATE cerc_form_iv_lines SET line_no = ? WHERE id = ?').run(derived.length + i + 1, l.id);
    });

    db.prepare("UPDATE cerc_form_iv SET generated_at = datetime('now') WHERE id = ?").run(form.id);
    refreshTotals(form.id);
  })();

  logAudit({ req, user: req.user, action: 'GENERATE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, details: window });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

router.put('/:id', requireRole(...WRITE), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  if (!assertEditable(form, res)) return;

  const b = req.body;
  // SUBMITTED is reached only through /submit, which runs the compliance gate.
  const status = b.status === 'PREPARED' || b.status === 'DRAFT' ? b.status : form.status;

  db.prepare(`
    UPDATE cerc_form_iv SET status=?, reference_no=?, notes=?, updated_at=datetime('now') WHERE id=?
  `).run(status, b.reference_no ?? form.reference_no, b.notes ?? form.notes, form.id);

  logAudit({ req, user: req.user, action: 'UPDATE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, details: b });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

router.post('/:id/submit', requireRole(...WRITE), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  if (form.status === 'SUBMITTED') return res.status(409).json({ error: 'This Form-IV is already submitted.' });

  const reference_no = req.body.reference_no || form.reference_no;
  const candidate = { ...form, reference_no };
  const blockers = submissionBlockers(candidate, getLines(form.id));
  if (blockers.length) return res.status(400).json({ error: blockers[0], blockers });

  db.prepare(`
    UPDATE cerc_form_iv SET status='SUBMITTED', submission_date=?, reference_no=?, submitted_by=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(req.body.submission_date || today(), reference_no, req.user.name, form.id);

  logAudit({ req, user: req.user, action: 'SUBMIT', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, details: { reference_no } });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

router.post('/:id/lines', requireRole(...WRITE), (req, res) => {
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form-IV record not found' });
  if (!assertEditable(form, res)) return;

  const b = req.body;
  if (!b.seller_name || !b.buyer_name) return res.status(400).json({ error: 'seller_name and buyer_name are required' });
  if (!b.period_from || !b.period_to) return res.status(400).json({ error: 'period_from and period_to are required' });

  const purchase_rate = Number(b.purchase_rate) || 0;
  const sale_rate = Number(b.sale_rate) || 0;
  const nextNo = (db.prepare('SELECT COALESCE(MAX(line_no),0) m FROM cerc_form_iv_lines WHERE form_id = ?').get(form.id).m) + 1;

  insertLine(form.id, {
    line_no: nextNo,
    source: b.source === 'EXCHANGE' ? 'EXCHANGE' : 'MANUAL',
    bilateral_id: null,
    seller_name: b.seller_name,
    buyer_name: b.buyer_name,
    contract_ref: b.contract_ref || null,
    period_from: b.period_from,
    period_to: b.period_to,
    quantum_mu: Number(b.quantum_mu) || 0,
    purchase_rate,
    sale_rate,
    trading_margin_per_unit: b.trading_margin_per_unit != null ? Number(b.trading_margin_per_unit) : null,
    exempt_reason: b.exempt_reason || null,
    remarks: b.remarks || null,
  });
  refreshTotals(form.id);

  logAudit({ req, user: req.user, action: 'ADD_LINE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, details: b });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.status(201).json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

router.put('/lines/:lineId', requireRole(...WRITE), (req, res) => {
  const line = db.prepare('SELECT * FROM cerc_form_iv_lines WHERE id = ?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Form-IV line not found' });
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(line.form_id);
  if (!assertEditable(form, res)) return;

  const b = req.body;
  const merged = normalizeLine({
    ...line,
    quantum_mu: b.quantum_mu != null ? Number(b.quantum_mu) : line.quantum_mu,
    purchase_rate: b.purchase_rate != null ? Number(b.purchase_rate) : line.purchase_rate,
    sale_rate: b.sale_rate != null ? Number(b.sale_rate) : line.sale_rate,
    // Null lets normalizeLine re-derive the margin from the two legs.
    trading_margin_per_unit: b.trading_margin_per_unit != null ? Number(b.trading_margin_per_unit) : null,
    // Empty string clears an exemption and puts the line back under the cap.
    exempt_reason: b.exempt_reason !== undefined ? (b.exempt_reason || null) : line.exempt_reason,
    remarks: b.remarks !== undefined ? (b.remarks || null) : line.remarks,
  });
  const evaluated = { ...merged, ...evaluateLine(merged) };

  db.prepare(`
    UPDATE cerc_form_iv_lines SET quantum_mu=?, purchase_rate=?, sale_rate=?, trading_margin_per_unit=?,
      margin_cap=?, compliance_status=?, exempt_reason=?, remarks=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    evaluated.quantum_mu, evaluated.purchase_rate, evaluated.sale_rate, evaluated.trading_margin_per_unit,
    evaluated.margin_cap, evaluated.compliance_status, evaluated.exempt_reason, evaluated.remarks,
    line.id,
  );
  refreshTotals(form.id);

  logAudit({ req, user: req.user, action: 'UPDATE_LINE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, beforeValue: line, afterValue: evaluated });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

router.delete('/lines/:lineId', requireRole(...WRITE), (req, res) => {
  const line = db.prepare('SELECT * FROM cerc_form_iv_lines WHERE id = ?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Form-IV line not found' });
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(line.form_id);
  if (!assertEditable(form, res)) return;

  db.transaction(() => {
    db.prepare('DELETE FROM cerc_form_iv_lines WHERE id = ?').run(line.id);
    getLines(form.id).forEach((l, i) => {
      db.prepare('UPDATE cerc_form_iv_lines SET line_no = ? WHERE id = ?').run(i + 1, l.id);
    });
    refreshTotals(form.id);
  })();

  logAudit({ req, user: req.user, action: 'DELETE_LINE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, beforeValue: line });
  const updated = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(form.id);
  const lines = getLines(form.id);
  res.json({ ...withDerived(updated), lines, blockers: submissionBlockers(updated, lines) });
});

export default router;
