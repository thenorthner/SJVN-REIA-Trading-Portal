import { Router } from 'express';
import db from '../db/index.js';
import { generateDemandLetterPdf } from '../scripts/demandLetterPdf.js';
import { requireAuth, requireRole, ROLE_GROUPS, BUYER_ROLES, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, invalidDecision } from '../util.js';
import {
  computeCoverage,
  checkAdequacy,
  checkPortfolioAdequacy,
  evaluateInvocationEligibility,
  invokeWaterfall,
  runAlertCascade,
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
  syncInstrumentAvailable,
  recordSecurityEvent,
  genInstrumentNo,
  refreshAvailable,
  releasePosition,
  releaseWhileLive,
  standingStatus,
  notifyCounterparty,
  notifyDesk,
  isLiveToday,
} from '../paymentSecurityEngine.js';
import { applyInvoicePayment } from './invoices.js';
import { securityBoard, requirementVsHeld, reinstatementTracker, releaseChecklist, alertLateReinstatements } from '../services/securityBoard.js';
import { ACTIVE_STATUSES, WATERFALL_DEFAULTS } from '../paymentSecurityConstants.js';
import { takeAmendmentOnRecord, remindExpiringSecurity } from './securityDesk.js';
import { claimFields, responseDate, claimTracker } from '../services/invocationClaims.js';
import { deskUpload, letterProblem, deskFilePath, discardUpload } from '../services/deskFiles.js';
import { hasGrant } from '../services/rolePowers.js';

const letterUpload = deskUpload('bank-letters');

export {
  computeCoverage,
  checkAdequacy,
  checkPortfolioAdequacy,
  evaluateInvocationEligibility,
  invokeWaterfall,
  runAlertCascade,
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
};

const router = Router();
router.use(requireAuth);

const REIA_WRITE = ROLE_GROUPS.REIA_WRITE;
// Phase B.2: the maker records instruments, asks and drafts; the checker verifies,
// draws, invokes and decides a release.
const REIA_MAKE = ROLE_GROUPS.REIA_MAKE;
const REIA_CHECK = ROLE_GROUPS.REIA_CHECK;
const REIA_ALL = ROLE_GROUPS.REIA_ALL;

function isReia(user) {
  return REIA_ALL.includes(user.role) || user.role === 'SJVN_ADMIN';
}

// Who may read the register across every contract: the REIA desk, Finance,
// Management and the auditor. A seller or a buyer reads its own contracts'.
// Anyone else — a trading client, say — used to fall through both checks and
// was handed every instrument on the platform.
const INTERNAL_READ = [...new Set([...REIA_ALL, 'COMPLIANCE_AUDITOR'])];
/** `null` when the caller may read nothing here; otherwise the SQL that narrows a contract alias to what it may. */
function readScope(user, alias = 'c') {
  if (INTERNAL_READ.includes(user?.role) || hasGrant(user?.role, 'reia.view')) return { where: '', params: [] };
  const side = counterpartySide(user);
  if (side === 'SELLER') return { where: ` AND ${alias}.seller_id = ?`, params: [user.linked_entity_id] };
  if (side === 'BUYER') return { where: ` AND ${alias}.buyer_id = ?`, params: [user.linked_entity_id] };
  return null;
}
function canReadContract(user, contract) {
  if (INTERNAL_READ.includes(user?.role) || hasGrant(user?.role, 'reia.view')) return true;
  const side = counterpartySide(user);
  if (side === 'SELLER') return !!contract.seller_id && contract.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return !!contract.buyer_id && contract.buyer_id === user.linked_entity_id;
  return false;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const words = (status) => String(status || '').toLowerCase().replace(/_/g, ' ');
const MECHANISMS = Object.keys(WATERFALL_DEFAULTS);
const BG_SUBTYPES = ['EMD', 'PBG', 'OTHER_BG'];
/** Whose default a contract's security answers for when nobody says: the buyer pays under a PSA, the seller performs under a PPA. */
const defaultSideOf = (contract) => (contract?.contract_type === 'PPA' ? 'SELLER' : 'BUYER');

function canAccessInstrument(user, ps) {
  if (isReia(user)) return true;
  const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(ps.contract_id);
  if (!c) return false;
  const side = counterpartySide(user);
  if (side === 'SELLER') return c.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return c.buyer_id === user.linked_entity_id;
  return false;
}

function enrich(ps) {
  if (!ps) return ps;
  const available = ['CLOSED', 'RELEASED'].includes(ps.status) ? 0 : refreshAvailable(ps);
  const coverage = computeCoverage(ps.contract_id);
  const daysToExpiry = ps.validity_end
    ? Math.ceil((new Date(ps.validity_end).getTime() - Date.now()) / 86400000)
    : null;
  return {
    ...ps,
    amount: ps.limit_amount,
    available_amount: available,
    coverage_ratio: coverage.coverage_ratio,
    shortfall: coverage.shortfall,
    days_to_expiry: daysToExpiry,
  };
}

router.get('/meta', (_req, res) => {
  res.json({
    active_statuses: ACTIVE_STATUSES,
    waterfall_defaults: WATERFALL_DEFAULTS,
    alert_cascade_days: [60, 30, 15, 7, 0],
  });
});

router.get('/stats', requireRole(...REIA_ALL), (_req, res) => {
  const instruments = db.prepare(`SELECT * FROM payment_security`).all();
  // In force today, not merely labelled so: a lapsed guarantee the nightly sweep
  // has not relabelled yet is not security.
  const active = instruments.filter((i) => isLiveToday(i));
  const totalSecurity = active.reduce((s, i) => s + refreshAvailable(i), 0);

  // Broken out by instrument. A single total said how much security existed and
  // nothing about what kind it was — and a letter of credit answering for a
  // buyer's payment and a guarantee answering for a seller's performance are not
  // interchangeable cover, so a portfolio view that adds them into one figure
  // cannot tell you whether either side is actually covered.
  const byType = {};
  for (const i of active) {
    const k = i.mechanism_type || 'OTHER';
    byType[k] = byType[k] || { mechanism_type: k, count: 0, limit: 0, utilized: 0, available: 0, verified: 0 };
    byType[k].count += 1;
    byType[k].limit += Number(i.limit_amount) || 0;
    byType[k].utilized += Number(i.utilized_amount) || 0;
    byType[k].available += refreshAvailable(i);
    if (i.verified_at) byType[k].verified += 1;
  }
  const security_by_type = Object.values(byType)
    .map((r) => ({ ...r, limit: Math.round(r.limit), utilized: Math.round(r.utilized), available: Math.round(r.available) }))
    .sort((a, b) => b.available - a.available);

  const psas = db.prepare(`SELECT id, contract_no, buyer_id FROM contracts WHERE contract_type = 'PSA' AND status = 'ACTIVE'`).all();
  const byEntity = [];
  let shortfallCount = 0;
  let ratioSum = 0;
  for (const c of psas) {
    const cov = computeCoverage(c.id);
    const buyer = db.prepare('SELECT name FROM entities WHERE id = ?').get(c.buyer_id);
    byEntity.push({
      contract_id: c.id,
      contract_no: c.contract_no,
      entity_name: buyer?.name || 'Unknown',
      ...cov,
    });
    if (!cov.adequate) shortfallCount += 1;
    ratioSum += cov.coverage_ratio;
  }

  const expiring = {};
  for (const d of [30, 60, 90]) {
    expiring[d] = db.prepare(`
      SELECT COUNT(*) c FROM payment_security
      WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
        AND validity_end IS NOT NULL
        AND julianday(validity_end) - julianday('now') BETWEEN 0 AND ?
    `).get(d).c;
  }

  const invocations = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM security_invocations
  `).get();

  res.json({
    security_by_type,
    total_security_value: Math.round(totalSecurity),
    instrument_count: active.length,
    shortfall_count: shortfallCount,
    avg_coverage_ratio: psas.length ? Number((ratioSum / psas.length).toFixed(3)) : 0,
    expiring,
    invocation_ytd_count: invocations.c,
    invocation_ytd_amount: invocations.s,
    weak_entities: byEntity.filter((e) => !e.adequate).sort((a, b) => a.coverage_ratio - b.coverage_ratio),
    entity_coverage: byEntity,
  });
});

router.get('/expiring', (req, res) => {
  const days = Number(req.query.days || 30);
  let sql = `
    SELECT ps.*, c.contract_no FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND ps.validity_end IS NOT NULL
      AND julianday(ps.validity_end) - julianday('now') <= ?
  `;
  const params = [days];
  const scope = readScope(req.user);
  if (!scope) return res.status(403).json({ error: 'Not authorized' });
  sql += scope.where;
  params.push(...scope.params);
  sql += ' ORDER BY ps.validity_end ASC';
  res.json(db.prepare(sql).all(...params).map(enrich));
});

// The demand notice as a document. It existed only as demand_letter_json, so a
// bank being asked to honour a guarantee had nothing that could be sent to it.
router.get('/invocations/:id/pdf', requireRole(...REIA_ALL), (req, res) => {
  const invocation = db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(req.params.id);
  if (!invocation) return res.status(404).json({ error: 'Invocation not found' });

  let letter = {};
  try { letter = JSON.parse(invocation.demand_letter_json || '{}'); } catch { letter = {}; }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(invocation.contract_id);
  const entity = contract
    ? db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.buyer_id || contract.seller_id)
    : null;
  const drawnIds = (letter.waterfall || []).map((w) => w.id).filter(Boolean);
  const instruments = drawnIds.length
    ? db.prepare(`SELECT * FROM payment_security WHERE id IN (${drawnIds.map(() => '?').join(',')})`).all(...drawnIds)
    : [];

  generateDemandLetterPdf({ invocation, letter, contract, instruments, entity }, res);
});

router.get('/adequacy/:contractId', (req, res) => {
  // The trading desk reads this before it bids; a counterparty reads its own.
  const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(req.params.contractId);
  const internal = INTERNAL_READ.includes(req.user.role) || ROLE_GROUPS.TRADING_ALL.includes(req.user.role) || hasGrant(req.user.role, 'reia.view');
  if (!internal && !(c && canReadContract(req.user, c))) return res.status(403).json({ error: 'Not authorized' });
  res.json(checkAdequacy({ contractId: req.params.contractId }));
});

router.get('/reopen-requests', (_req, res) => res.json([])); // compat placeholder

router.get('/releases', requireRole(...REIA_ALL), (_req, res) => {
  res.json(db.prepare(`
    SELECT sr.*, ps.instrument_no, ps.mechanism_type, ps.bg_subtype, ps.limit_amount, c.contract_no
    FROM security_releases sr
    JOIN payment_security ps ON ps.id = sr.payment_security_id
    JOIN contracts c ON c.id = sr.contract_id
    ORDER BY sr.created_at DESC
  `).all().map((r) => (r.status === 'PENDING' ? { ...r, position: releasePosition(r.contract_id), checklist: releaseChecklist(r) } : r)));
});

// S1: requirement vs held, per live contract.
router.get('/board', requireRole(...REIA_ALL), (_req, res) => res.json(securityBoard()));

// S1: ask the counterparty to make up the gap.
router.post('/board/:contractId/request', requireRole(...REIA_MAKE), (req, res) => {
  const c = db.prepare(`SELECT c.*, s.name AS seller_name, b.name AS buyer_name FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id LEFT JOIN entities b ON b.id = c.buyer_id WHERE c.id = ?`).get(req.params.contractId);
  if (!c) return res.status(404).json({ error: 'Contract not found' });
  const row = requirementVsHeld(c);
  const short = row.heads.filter((h) => h.gap > 0);
  if (!short.length) return res.status(400).json({ error: `${c.contract_no} holds what it requires — there is nothing to ask for.` });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const lines = short.map((h) => `${h.label}: ${rupees(h.gap)} short (required ${rupees(h.required)}, in force ${rupees(h.held)})`).join('; ');
  const message = `${c.contract_no}: the payment security in force falls short — ${lines}. Please lodge the shortfall and upload it on the Security Desk.${note ? ` ${note}` : ''}`;
  notifyCounterparty(c.id, row.paying_side, 'SECURITY_SHORTFALL', message);
  recordSecurityEvent({ contractId: c.id, user: req.user, eventType: 'SHORTFALL_REQUESTED', details: { heads: short.map((h) => ({ head: h.head, gap: h.gap })), note: note || undefined } });
  logAudit({ req, user: req.user, action: 'SECURITY_SHORTFALL_REQUESTED', module: 'REIA', entityType: 'contract', entityId: c.id, details: { gap: row.gap_total } });
  res.json({ ok: true, message, row: requirementVsHeld(c) });
});

// S4: revolving LCs drawn on and not yet restored.
router.get('/reinstatements', requireRole(...REIA_ALL), (_req, res) => res.json(reinstatementTracker()));

// S5: Finance signs off a release before the desk releases the instrument.
router.post('/releases/:id/finance-signoff', requireRole('FINANCE_USER'), (req, res) => {
  const rel = db.prepare('SELECT * FROM security_releases WHERE id = ?').get(req.params.id);
  if (!rel) return res.status(404).json({ error: 'Not found' });
  if (rel.status !== 'PENDING') return res.status(400).json({ error: 'This request has already been decided' });
  if (rel.finance_signoff_at) return res.status(400).json({ error: `Finance already signed off, ${rel.finance_signoff_by}` });
  const position = releasePosition(rel.contract_id);
  if (!position.clear) return res.status(400).json({ error: 'Dues or disputes are still open on the contract; Finance signs off once they are settled.' });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  db.prepare(`UPDATE security_releases SET finance_signoff_at = datetime('now'), finance_signoff_by = ?, finance_signoff_by_id = ?, finance_signoff_note = ? WHERE id = ?`)
    .run(req.user.name, req.user.id || null, note || null, rel.id);
  recordSecurityEvent({ instrumentId: rel.payment_security_id, contractId: rel.contract_id, user: req.user, eventType: 'RELEASE_FINANCE_SIGNOFF', details: { note: note || undefined } });
  logAudit({ req, user: req.user, action: 'SECURITY_RELEASE_FINANCE_SIGNOFF', module: 'REIA', entityType: 'payment_security', entityId: rel.payment_security_id, details: { release_id: rel.id } });
  const fresh = db.prepare('SELECT * FROM security_releases WHERE id = ?').get(rel.id);
  res.json({ ...fresh, checklist: releaseChecklist(fresh) });
});

router.get('/overrides', requireRole(...REIA_ALL), (_req, res) => {
  res.json(db.prepare(`
    SELECT o.*, c.contract_no FROM security_adequacy_overrides o
    JOIN contracts c ON c.id = o.contract_id
    ORDER BY o.created_at DESC
  `).all());
});

router.get('/requirements/:contractId', (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.contractId);
  if (!c) return res.status(404).json({ error: 'Contract not found' });
  if (!canReadContract(req.user, c)) return res.status(403).json({ error: 'Not authorized' });
  res.json(db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(req.params.contractId));
});

// S2: claims lodged with banks — the answer window, late banks, and letters.
router.get('/invocations/claim-tracker', requireRole(...REIA_ALL), (req, res) => {
  res.json(claimTracker());
});

// The bank's settlement or refusal letter, filed once it has answered.
router.post('/invocations/:id/letter', requireRole(...REIA_MAKE), letterUpload.single('file'), (req, res) => {
  const inv = db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(req.params.id);
  const refuse = (status, error) => { discardUpload(req.file); return res.status(status).json({ error }); };
  if (!inv) return refuse(404, 'Not found');
  if (!['FUNDS_RECEIVED', 'REJECTED'].includes(inv.status)) return refuse(400, `${inv.invocation_no} is at "${words(inv.status)}" — the bank's letter is filed once it has paid or refused.`);
  const problem = letterProblem(req.file);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare(`UPDATE security_invocations SET outcome_letter_file = ?, outcome_letter_name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.file.filename, req.file.originalname, inv.id);
  recordSecurityEvent({ instrumentId: inv.payment_security_id, contractId: inv.contract_id, user: req.user, eventType: 'BANK_LETTER_FILED', details: { invocation_no: inv.invocation_no, file: req.file.originalname, outcome: inv.status } });
  res.status(201).json(db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(inv.id));
});
router.get('/invocations/:id/letter', requireRole(...REIA_ALL), (req, res) => {
  const inv = db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(req.params.id);
  const file = inv?.outcome_letter_file && deskFilePath('bank-letters', inv.outcome_letter_file);
  if (!file) return res.status(404).json({ error: 'No bank letter is filed for this invocation' });
  res.download(file, inv.outcome_letter_name || inv.outcome_letter_file);
});

router.get('/invocations', requireRole(...REIA_ALL), (req, res) => {
  const { contract_id, status } = req.query;
  let sql = `SELECT si.*, c.contract_no FROM security_invocations si JOIN contracts c ON c.id = si.contract_id WHERE 1=1`;
  const params = [];
  if (contract_id) { sql += ' AND si.contract_id = ?'; params.push(contract_id); }
  if (status) { sql += ' AND si.status = ?'; params.push(status); }
  sql += ' ORDER BY si.created_at DESC, si.rowid DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/', (req, res) => {
  const { contract_id, status, mechanism_type, bg_subtype, expiring_days } = req.query;
  let sql = `
    SELECT ps.*, c.contract_no, c.contract_type, c.seller_id, c.buyer_id
    FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id WHERE 1=1
  `;
  const params = [];
  const scope = readScope(req.user);
  if (!scope) return res.status(403).json({ error: 'Not authorized' });
  sql += scope.where;
  params.push(...scope.params);
  if (contract_id) { sql += ' AND ps.contract_id = ?'; params.push(contract_id); }
  if (status) { sql += ' AND ps.status = ?'; params.push(status); }
  if (mechanism_type) { sql += ' AND ps.mechanism_type = ?'; params.push(mechanism_type); }
  if (bg_subtype) { sql += ' AND ps.bg_subtype = ?'; params.push(bg_subtype); }
  if (expiring_days) {
    sql += ` AND ps.validity_end IS NOT NULL AND julianday(ps.validity_end) - julianday('now') <= ? AND ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')`;
    params.push(Number(expiring_days));
  }
  sql += ' ORDER BY ps.validity_end ASC';
  res.json(db.prepare(sql).all(...params).map(enrich));
});

router.get('/:id', (req, res) => {
  const ps = db.prepare(`
    SELECT ps.*, c.contract_no, c.contract_type FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id WHERE ps.id = ?
  `).get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!INTERNAL_READ.includes(req.user.role) && !canAccessInstrument(req.user, ps)) return res.status(403).json({ error: 'Not authorized' });

  const events = db.prepare('SELECT * FROM security_events WHERE payment_security_id = ? ORDER BY created_at, rowid').all(ps.id);
  // The invocations that drew on this instrument. Every invocation on the
  // contract used to be listed, so an instrument the waterfall never reached
  // showed a demand letter for money taken from another one.
  const invocations = db.prepare('SELECT * FROM security_invocations WHERE contract_id = ? ORDER BY created_at DESC, rowid DESC').all(ps.contract_id)
    .filter((inv) => {
      if (inv.payment_security_id === ps.id) return true;
      try { return JSON.parse(inv.waterfall_used || '[]').some((w) => w.id === ps.id); } catch { return false; }
    });
  const alerts = db.prepare('SELECT * FROM security_alerts WHERE payment_security_id = ? ORDER BY created_at DESC LIMIT 20').all(ps.id);
  const releases = db.prepare('SELECT * FROM security_releases WHERE payment_security_id = ? ORDER BY created_at DESC').all(ps.id);
  const requirements = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(ps.contract_id);
  const coverage = computeCoverage(ps.contract_id);
  const eligibility = evaluateInvocationEligibility(ps.contract_id);

  res.json({
    ...enrich(ps),
    events,
    invocations,
    alerts,
    releases,
    requirements,
    coverage,
    invocation_eligibility: eligibility,
  });
});

router.post('/', requireRole(...REIA_MAKE), (req, res) => {
  const b = req.body || {};
  if (!b.contract_id) return res.status(400).json({ error: 'Choose the contract this instrument secures' });
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(String(b.contract_id));
  if (!c) return res.status(404).json({ error: 'Contract not found' });
  if (!MECHANISMS.includes(b.mechanism_type)) {
    return res.status(400).json({ error: `Say what kind of instrument this is: ${MECHANISMS.join(', ')}` });
  }
  const limit = Number(b.limit_amount ?? b.amount);
  if (!(limit > 0)) return res.status(400).json({ error: 'The limit must be more than zero' });
  const isBg = b.mechanism_type === 'BANK_GUARANTEE';
  if (isBg && b.bg_subtype && !BG_SUBTYPES.includes(b.bg_subtype)) {
    return res.status(400).json({ error: 'A bank guarantee is an EMD, a PBG or another guarantee (OTHER_BG)' });
  }
  const validityStart = String(b.validity_start || '').trim() || null;
  const validityEnd = String(b.validity_end || '').trim() || null;
  for (const [label, v] of [['Validity start', validityStart], ['Validity end', validityEnd]]) {
    if (v && !DAY.test(v)) return res.status(400).json({ error: `${label} must be a date (YYYY-MM-DD)` });
  }
  if (validityStart && validityEnd && validityEnd < validityStart) {
    return res.status(400).json({ error: 'The validity cannot end before it starts' });
  }
  // A letter of credit or a guarantee is a bank's document with its own number;
  // the desk recorded them with none, so nothing tied the row to the paper.
  const bankRef = String(b.bank_reference_no || '').trim().slice(0, 80);
  if (['LC', 'BANK_GUARANTEE'].includes(b.mechanism_type) && !bankRef) {
    return res.status(400).json({ error: `Enter the bank's ${isBg ? 'guarantee' : 'letter of credit'} number` });
  }
  if (bankRef && db.prepare(`SELECT 1 FROM payment_security WHERE contract_id = ? AND bank_reference_no = ? AND status != 'CLOSED'`).get(c.id, bankRef)) {
    return res.status(409).json({ error: `${bankRef} is already on record for this contract` });
  }
  const instrumentNo = String(b.instrument_no || '').trim()
    || genInstrumentNo(isBg ? (b.bg_subtype || 'BG') : b.mechanism_type);
  if (db.prepare('SELECT 1 FROM payment_security WHERE instrument_no = ?').get(instrumentNo)) {
    return res.status(409).json({ error: `${instrumentNo} is already on record` });
  }

  const id = newId('PSC');
  const entityId = b.entity_id || (c.contract_type === 'PSA' ? c.buyer_id : c.seller_id);
  const priority = b.waterfall_priority ?? WATERFALL_DEFAULTS[b.mechanism_type] ?? 100;
  const isRevolving = b.is_revolving != null ? (b.is_revolving ? 1 : 0) : (b.mechanism_type === 'LC' ? 1 : 0);
  const required = b.required_amount ?? computeCoverage(c.id).required_amount;
  // Entered after it had already lapsed, it is on the register as what it is.
  const status = validityEnd && validityEnd < today() ? 'EXPIRED' : 'ACTIVE';

  db.prepare(`
    INSERT INTO payment_security (
      id, instrument_no, contract_id, entity_id, mechanism_type, bg_subtype, is_revolving,
      limit_amount, utilized_amount, available_amount, required_amount, waterfall_priority,
      issuing_bank, beneficiary, validity_start, validity_end, status, remarks, bank_reference_no
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    instrumentNo,
    c.id,
    entityId,
    b.mechanism_type,
    isBg ? (b.bg_subtype || null) : null,
    isRevolving,
    limit,
    limit,
    required,
    priority,
    b.issuing_bank || null,
    b.beneficiary || 'SJVN Limited',
    validityStart,
    validityEnd,
    status,
    b.remarks || null,
    bankRef || null
  );

  recordSecurityEvent({ instrumentId: id, contractId: c.id, user: req.user, eventType: 'CREATE', details: b });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'payment_security', entityId: id, details: b });
  res.status(201).json(enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id)));
});

router.post('/from-contract/:contractId', requireRole(...REIA_MAKE), (req, res) => {
  if (!db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(req.params.contractId)) {
    return res.status(404).json({ error: 'Contract not found' });
  }
  syncRequirementsFromContract(req.params.contractId);
  const created = createInstrumentsFromRequirements(req.params.contractId, req.user);
  res.status(201).json({ created: created.map(enrich), requirements: db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(req.params.contractId) });
});

router.post('/alerts/run', requireRole(...REIA_WRITE, ...ROLE_GROUPS.REIA_APPROVE), (_req, res) => {
  // The desk's own cascade, and the reminder to whoever holds the instrument and
  // has to have it extended — the button ran only the first.
  const cascade = runAlertCascade();
  const holders = remindExpiringSecurity();
  const late = alertLateReinstatements();
  res.json({ ...cascade, sent: cascade.sent + holders.sent + late.sent, holders_reminded: holders.sent, late_reinstatements: late.sent });
});

// An override is management's call, for a stated time (decided 17-Oct-2026):
// the desk that wants the bid through is not the one that waives the cover
// behind it, and an open-ended waiver is a gate switched off.
const OVERRIDE_MAX_DAYS = 90;
router.post('/overrides', requireRole(...ROLE_GROUPS.REIA_APPROVE), (req, res) => {
  const { contract_id, valid_until } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!contract_id || !reason) return res.status(400).json({ error: 'Choose the contract and say why its security is being treated as adequate' });
  if (reason.length < 15) return res.status(400).json({ error: 'Give the reason in a sentence (at least 15 characters) — it is what the audit trail shows.' });
  const overridden = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(String(contract_id));
  if (!overridden) return res.status(404).json({ error: 'Contract not found' });
  if (!valid_until) return res.status(400).json({ error: `Give the date the override runs to (at most ${OVERRIDE_MAX_DAYS} days).` });
  if (!DAY.test(String(valid_until)) || String(valid_until) < today()) {
    return res.status(400).json({ error: 'Valid until must be a date from today onwards' });
  }
  const latest = new Date(Date.now() + OVERRIDE_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  if (String(valid_until) > latest) return res.status(400).json({ error: `An override runs for at most ${OVERRIDE_MAX_DAYS} days (to ${latest}). Renew it then if the cover is still short.` });
  const twin = db.prepare(`SELECT 1 FROM security_adequacy_overrides WHERE contract_id = ? AND reason = ? AND COALESCE(valid_until, '') = ? AND (valid_until IS NULL OR valid_until >= date('now'))`)
    .get(String(contract_id), reason, valid_until || '');
  if (twin) return res.status(409).json({ error: `This override is already on record for ${overridden.contract_no}` });
  const id = newId('SOV');
  db.prepare(`
    INSERT INTO security_adequacy_overrides (id, contract_id, reason, approved_by, valid_until)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, contract_id, reason, req.user.name, valid_until || null);
  recordSecurityEvent({ contractId: contract_id, user: req.user, eventType: 'ADEQUACY_OVERRIDE', details: { reason, valid_until } });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SECURITY_OVERRIDE', module: 'REIA', entityType: 'contract', entityId: contract_id, details: req.body });
  pushNotification({ role: 'MANAGEMENT', type: 'SECURITY_OVERRIDE', message: `Adequacy override on ${overridden.contract_no} by ${req.user.name}: ${reason}` });
  res.status(201).json(db.prepare('SELECT * FROM security_adequacy_overrides WHERE id = ?').get(id));
});

router.post('/invocations', requireRole(...REIA_MAKE), (req, res) => {
  const { contract_id, amount, invoice_ids, side } = req.body;
  if (!contract_id) return res.status(400).json({ error: 'Choose the contract whose security is being invoked' });
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(String(contract_id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  // Whose default: said outright, or read off the contract. The form names no
  // side, and this always ran the buyer's — so invoking on a PPA, where the
  // only cover is the seller's guarantee, drew nothing and still filed a notice.
  const given = String(side || '').toUpperCase();
  if (given && !['BUYER', 'SELLER'].includes(given)) {
    return res.status(400).json({ error: "side must be BUYER or SELLER" });
  }
  const defaultingSide = given || defaultSideOf(contract);
  const refusal = invocationRefusal(contract, defaultingSide, amount, req.body.reason);
  if (refusal.error) return res.status(400).json(refusal);
  const { amt, elig } = refusal;
  const inv = invokeWaterfall(contract.id, amt, Array.isArray(invoice_ids) ? invoice_ids : elig.overdue_invoices, req.user, defaultingSide);
  if (!inv) {
    return res.status(400).json({
      error: `Nothing could be drawn for a ${defaultingSide.toLowerCase()} default on ${contract.contract_no} — no live ${defaultingSide === 'SELLER' ? 'guarantee' : 'letter of credit'} or pooled cover with a balance. No demand notice was raised.`,
      side: defaultingSide,
    });
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'INVOKE_WATERFALL', module: 'REIA', entityType: 'security_invocation', entityId: inv.id, details: { amount: amt, side: defaultingSide, drawn: inv.amount } });
  res.status(201).json(inv);
});

/**
 * How much may be demanded, or why nothing may.
 *
 * A buyer's letter of credit answers for bills overdue past the invocation
 * rule, less what is already demanded and not back — the amount typed was
 * drawn whatever it was, ₹2 lakh against ₹1 lakh owed, and a blank one drew
 * the same overdue bill again while the first notice was still with the bank.
 * A seller's guarantee answers for a performance default that no bill states,
 * so the amount and the ground for it are the desk's to put on record.
 */
function invocationRefusal(contract, side, amount, reason) {
  const elig = evaluateInvocationEligibility(contract.id);
  const stated = amount != null && amount !== '';
  const amt = stated ? Number(amount) : elig.amount;
  if (stated && !(amt > 0)) return { error: 'The amount to invoke must be more than zero' };
  if (side === 'BUYER') {
    if (!(elig.amount > 0)) {
      return {
        error: elig.already_demanded > 0
          ? `Everything overdue on ${contract.contract_no} (${rupees(elig.overdue_amount)}) is already demanded under notices still with the bank.`
          : `Nothing on ${contract.contract_no} is overdue by ${elig.rule_days} days or more, so the buyer's security cannot be invoked.`,
        eligibility: elig,
      };
    }
    if (amt > elig.amount + 1) {
      return { error: `Only ${rupees(elig.amount)} can be demanded on ${contract.contract_no} — what is overdue by ${elig.rule_days}+ days and not already demanded.`, eligibility: elig };
    }
  } else {
    if (!stated) return { error: 'Enter the amount to invoke on the seller\'s guarantee — a performance default has no bill to read it from.' };
    if (String(reason || '').trim().length < 15) {
      return { error: 'Say what the seller defaulted on (at least 15 characters) — it goes on the demand to the bank.' };
    }
  }
  return { amt, elig };
}

// A demand moves one way: notice, claim lodged with the bank, funds in. It
// could be sent to any status from any other, so one already paid could be put
// back to a notice.
const INVOCATION_NEXT = {
  ELIGIBLE: ['NOTICE_ISSUED'],
  NOTICE_ISSUED: ['CLAIMED', 'REJECTED'],
  CLAIMED: ['FUNDS_RECEIVED', 'REJECTED'],
  FUNDS_RECEIVED: [],
  REJECTED: [],
};

router.post('/invocations/:id/transition', requireRole(...REIA_CHECK), (req, res) => {
  const { status, notes } = req.body;
  if (!Object.keys(INVOCATION_NEXT).includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const inv = db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!(INVOCATION_NEXT[inv.status] || []).includes(status)) {
    return res.status(400).json({ error: `${inv.invocation_no} is at "${words(inv.status)}" — it cannot move to "${words(status)}".` });
  }

  // S2: lodging the claim starts the bank's answer window; the bank's answer
  // closes it.
  let claim = null;
  let answered = null;
  try {
    if (status === 'CLAIMED') claim = claimFields(req.body);
    if (inv.status === 'CLAIMED' && ['FUNDS_RECEIVED', 'REJECTED'].includes(status)) answered = responseDate(inv, req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.prepare(`UPDATE security_invocations SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(status, notes ?? null, inv.id);
  if (claim) {
    db.prepare('UPDATE security_invocations SET claim_submitted_on = ?, claim_reference = ?, bank_response_due = ? WHERE id = ?')
      .run(claim.claim_submitted_on, claim.claim_reference, claim.bank_response_due, inv.id);
  }
  if (answered) db.prepare('UPDATE security_invocations SET bank_responded_on = ? WHERE id = ?').run(answered, inv.id);

  let letterSide = 'BUYER';
  try { letterSide = JSON.parse(inv.demand_letter_json || '{}').side || letterSide; } catch { /* an older notice names no side */ }
  // The bank refused: nothing was drawn after all, so the cover is back.
  if (status === 'REJECTED') {
    let draws = [];
    try { draws = JSON.parse(inv.waterfall_used || '[]'); } catch { draws = []; }
    for (const d of draws) {
      db.prepare(`UPDATE payment_security SET utilized_amount = MAX(0, COALESCE(utilized_amount, 0) - ?), updated_at = datetime('now') WHERE id = ?`).run(Number(d.amount) || 0, d.id);
      syncInstrumentAvailable(d.id);
      recordSecurityEvent({ instrumentId: d.id, contractId: inv.contract_id, user: req.user, eventType: 'DRAW_REVERSED', details: { amount: d.amount, invocation_no: inv.invocation_no, notes } });
    }
  }
  // The money is in: it pays the bills it was demanded for, oldest first. They
  // stayed overdue — surcharge running, and invocable again — after SJVN had
  // already been paid by the bank.
  let settled = [];
  if (status === 'FUNDS_RECEIVED' && letterSide === 'BUYER') {
    let ids = [];
    try { ids = JSON.parse(inv.invoice_ids || '[]'); } catch { ids = []; }
    let left = Number(inv.amount) || 0;
    const bills = ids.length ? db.prepare(`SELECT * FROM invoices WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY due_date, created_at`).all(...ids) : [];
    for (const b of bills) {
      if (left <= 0.005) break;
      const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(b.id).s;
      const open = Math.max(0, Math.max(0, (Number(b.total_amount) || 0) - (Number(b.rebate) || 0) + (Number(b.lps) || 0) - (Number(b.disputed_amount) || 0)) - paid);
      const take = Math.round(Math.min(open, left) * 100) / 100;
      if (take <= 0) continue;
      applyInvoicePayment(b, { amount: take, payment_date: new Date().toISOString().slice(0, 10), mode: 'SECURITY_INVOCATION', reference: inv.invocation_no }, req);
      settled.push({ invoice_no: b.invoice_no, amount: take });
      left -= take;
    }
  }
  if (status === 'FUNDS_RECEIVED') {
    const side = letterSide;
    const contractNo = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(inv.contract_id)?.contract_no || inv.contract_id;
    notifyCounterparty(inv.contract_id, side, 'SECURITY_REPLENISH_DEMAND',
      `${contractNo}: SJVN has received ${rupees(inv.amount)} under ${inv.invocation_no}.${side === 'BUYER' ? ' Have the letter of credit reinstated to its full value.' : ''}`);
  }
  recordSecurityEvent({
    instrumentId: inv.payment_security_id,
    contractId: inv.contract_id,
    user: req.user,
    eventType: `INVOCATION_${status}`,
    details: { invocation_id: inv.id, invocation_no: inv.invocation_no, notes, settled: settled.length ? settled : undefined },
  });
  res.json({ ...db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(inv.id), settled });
});

router.post('/releases/:id/act', requireRole(...REIA_CHECK, 'FINANCE_USER'), (req, res) => {
  const { decision } = req.body; // APPROVED | REJECTED
  const badDecision = invalidDecision(decision);
  if (badDecision) return res.status(400).json({ error: badDecision });
  const rel = db.prepare('SELECT * FROM security_releases WHERE id = ?').get(req.params.id);
  if (!rel) return res.status(404).json({ error: 'Not found' });
  if (rel.status !== 'PENDING') {
    return res.status(400).json({ error: `This release request has already been ${rel.status === 'RELEASED' ? 'approved' : words(rel.status)}` });
  }
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(rel.payment_security_id);
  const contractNo = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(rel.contract_id)?.contract_no || rel.contract_id;
  const note = String(req.body.note ?? '').trim().slice(0, 1000);
  // Whose instrument it is, so the party that asked hears what was decided.
  const side = ps?.mechanism_type === 'LC' ? 'BUYER' : ps?.mechanism_type === 'BANK_GUARANTEE' ? 'SELLER' : null;
  const tell = (message) => {
    if (side) notifyCounterparty(rel.contract_id, side, 'SECURITY_RELEASED', message);
    else for (const s of ['SELLER', 'BUYER']) notifyCounterparty(rel.contract_id, s, 'SECURITY_RELEASED', message);
  };

  if (decision === 'REJECTED') {
    if (!note) return res.status(400).json({ error: 'Say why the release is refused' });
    db.transaction(() => {
      db.prepare(`UPDATE security_releases SET status = 'REJECTED', decision_note = ?, acted_by = ?, acted_at = datetime('now') WHERE id = ?`)
        .run(note, req.user.name, rel.id);
      // Back to where it stood on its own facts. It went to ACTIVE whatever it
      // had been, so a guarantee that had lapsed, or one half drawn, came back
      // from a refused release reading as whole and in force.
      if (ps) {
        db.prepare(`UPDATE payment_security SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(standingStatus(ps), ps.id);
      }
      recordSecurityEvent({ instrumentId: rel.payment_security_id, contractId: rel.contract_id, user: req.user, eventType: 'RELEASE_REJECTED', details: { note } });
    })();
    logAudit({ req, user: req.user, action: 'SECURITY_RELEASE_REJECTED', module: 'REIA', entityType: 'payment_security', entityId: rel.payment_security_id, details: { release_id: rel.id, note } });
    tell(`${ps?.instrument_no || 'Your instrument'} (${contractNo}): SJVN has refused the release — ${note}`);
    return res.json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(rel.id));
  }

  // The position as it is now, not as it was stamped when the request was
  // raised. Releasing security while money is still owed or a dispute is open
  // removes the only cover for it — and a request raised with dues open stayed
  // "checklist incomplete" for good, even after every bill had been paid.
  const position = releasePosition(rel.contract_id);
  db.prepare('UPDATE security_releases SET checklist_no_dues = ?, checklist_no_disputes = ? WHERE id = ?')
    .run(position.outstanding_dues > 0 ? 0 : 1, position.open_disputes === 0 ? 1 : 0, rel.id);
  if (!position.clear) {
    const blockers = [
      position.outstanding_dues > 0 && `${rupees(position.outstanding_dues)} is still outstanding`,
      position.open_disputes > 0 && `${position.open_disputes} dispute${position.open_disputes === 1 ? ' is' : 's are'} still open`,
    ].filter(Boolean).join(' and ');
    return res.status(400).json({
      error: `Cannot release ${ps?.instrument_no || 'this instrument'}: on ${contractNo}, ${blockers}. Release it once that is settled, or refuse the request.`,
      outstanding_amount: position.outstanding_dues,
      open_disputes: position.open_disputes,
    });
  }
  if (ps) {
    const live = releaseWhileLive(ps);
    if (!live.allowed) {
      return res.status(400).json({
        error: `Cannot release ${ps.instrument_no || 'this instrument'}: ${live.contract_no} is still ${live.contract_status.toLowerCase().replace(/_/g, ' ')}, and without it the contract would hold ${rupees(Math.max(0, live.left))} against the ${rupees(live.needed)} it needs. Accept a replacement first, or release it when the contract ends.`,
        cover_left: live.left,
        cover_needed: live.needed,
      });
    }
  }
  // S5: Finance signs off first, and the release itself is someone else's act.
  if (!rel.finance_signoff_at) {
    return res.status(400).json({ error: `Finance has not signed off the release of ${ps?.instrument_no || 'this instrument'} yet.`, checklist: releaseChecklist(rel) });
  }
  if (rel.finance_signoff_by_id && rel.finance_signoff_by_id === req.user.id) {
    return res.status(403).json({ error: 'You signed off this release for Finance, so someone else releases it.' });
  }
  db.transaction(() => {
    db.prepare(`UPDATE security_releases SET status = 'RELEASED', decision_note = ?, acted_by = ?, acted_at = datetime('now') WHERE id = ?`)
      .run(note || null, req.user.name, rel.id);
    db.prepare(`UPDATE payment_security SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`)
      .run(rel.payment_security_id);
    recordSecurityEvent({
      instrumentId: rel.payment_security_id,
      contractId: rel.contract_id,
      user: req.user,
      eventType: 'RELEASED',
      details: note ? { note } : null,
    });
  })();
  logAudit({ req, user: req.user, action: 'SECURITY_RELEASED', module: 'REIA', entityType: 'payment_security', entityId: rel.payment_security_id, details: { release_id: rel.id } });
  notifyDesk('SECURITY_RELEASED', `${ps?.instrument_no || 'An instrument'} (${contractNo}) has been released by ${req.user.name}.`, ['FINANCE_USER']);
  tell(`${ps?.instrument_no || 'Your instrument'} (${contractNo}) has been released by SJVN. The original can be collected / the bank advised to cancel it.`);
  res.json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(rel.id));
});

router.post('/:id/verify', requireRole(...REIA_CHECK), (req, res) => {
  const { bank_confirmation_ref } = req.body;
  if (String(bank_confirmation_ref || '').trim().length < 4) {
    return res.status(400).json({ error: "Record the bank's confirmation reference (the SFMS message or advice number, at least 4 characters)" });
  }
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  // Confirmed once: a second confirmation would overwrite who checked it and when.
  if (ps.verified_at) {
    return res.status(409).json({ error: `${ps.instrument_no} was already confirmed by ${ps.verified_by} (${ps.bank_confirmation_ref})` });
  }
  db.prepare(`
    UPDATE payment_security SET bank_confirmation_ref = ?, verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(bank_confirmation_ref, req.user.name, ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'VERIFIED', details: { bank_confirmation_ref } });
  res.json(enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(ps.id)));
});

router.post('/:id/utilize', requireRole(...REIA_CHECK), (req, res) => {
  const amount = Number(req.body.amount);
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  // Only an instrument in force can be drawn on. One still awaiting acceptance,
  // one released, one refused — each took a draw, and the register then showed
  // money taken from security SJVN did not hold.
  if (!ACTIVE_STATUSES.includes(ps.status)) {
    return res.status(400).json({ error: `${ps.instrument_no} is ${words(ps.status === 'DRAFT' ? 'awaiting acceptance' : ps.status)} — it cannot be drawn on` });
  }
  if (ps.validity_end && String(ps.validity_end).slice(0, 10) < today()) {
    return res.status(400).json({ error: `${ps.instrument_no} expired on ${ps.validity_end} — it cannot be drawn on. Record the bank's extension first.` });
  }
  if (!(amount > 0)) return res.status(400).json({ error: 'The amount to draw must be more than zero' });
  // A draw is money taken under someone's security; it says why.
  if (String(req.body.reason || '').trim().length < 10) {
    return res.status(400).json({ error: 'Say why the instrument is drawn on (at least 10 characters) — the holder is told.' });
  }
  if (amount > refreshAvailable(ps)) {
    return res.status(400).json({ error: `Only ${rupees(refreshAvailable(ps))} is available on ${ps.instrument_no}` });
  }
  db.prepare(`UPDATE payment_security SET utilized_amount = utilized_amount + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(amount, ps.id);
  const fresh = syncInstrumentAvailable(ps.id);
  recordSecurityEvent({
    instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'UTILIZE',
    // The before and after, because "amount: 1000000" alone does not say what
    // cover was left standing — which is the question anyone reads this event to
    // answer. Replenishment already recorded its own; this did not.
    details: {
      amount, reason: (req.body.reason || '').trim() || undefined,
      available_before: refreshAvailable(ps), available_after: refreshAvailable(fresh),
      utilized_before: ps.utilized_amount || 0, utilized_after: fresh.utilized_amount || 0,
    },
  });
  logAudit({ req, user: req.user, action: 'SECURITY_UTILIZED', module: 'REIA', entityType: 'payment_security', entityId: ps.id, details: { amount, reason: (req.body.reason || '').trim() || undefined } });
  {
    // Whose instrument it is hears of every draw. Only a draw that left a
    // revolving LC short was announced, so money taken from any other
    // instrument was something its owner found out by looking.
    const contract = db.prepare('SELECT contract_no, contract_type FROM contracts WHERE id = ?').get(ps.contract_id);
    const side = ps.mechanism_type === 'LC' ? 'BUYER' : ps.mechanism_type === 'BANK_GUARANTEE' ? 'SELLER' : defaultSideOf(contract);
    const short = ps.is_revolving && refreshAvailable(fresh) < fresh.required_amount;
    notifyCounterparty(ps.contract_id, side, 'SECURITY_REPLENISH_DEMAND',
      `${contract?.contract_no || ps.contract_id}: ${rupees(amount)} has been drawn on ${fresh.instrument_no}, leaving ${rupees(refreshAvailable(fresh))}${short ? ` against ${rupees(fresh.required_amount)} required. Have the letter of credit reinstated.` : '.'}`);
  }
  res.json(enrich(fresh));
});

// The whole buyer company, not only its admin: topping up a revolving LC is
// the sort of thing a company's finance maker does. Ownership is enforced by
// canAccessInstrument below either way.
router.post('/:id/replenish', requireRole(...REIA_MAKE, ...BUYER_ROLES), (req, res) => {
  const amount = Number(req.body.amount);
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!canAccessInstrument(req.user, ps)) return res.status(403).json({ error: 'Not authorized' });
  if (!(amount > 0)) return res.status(400).json({ error: 'The amount reinstated must be more than zero' });
  if (['RELEASED', 'CLOSED', 'DRAFT'].includes(ps.status)) {
    return res.status(400).json({ error: `${ps.instrument_no} is ${words(ps.status === 'DRAFT' ? 'awaiting acceptance' : ps.status)} — there is nothing on it to reinstate` });
  }

  const drawn = ps.utilized_amount || 0;
  if (amount > drawn) {
    return res.status(400).json({
      error: drawn > 0
        ? `Only ${rupees(drawn)} has been drawn on ${ps.instrument_no}, so ${rupees(amount)} cannot be reinstated. To raise its value, record the bank's amendment instead.`
        : `Nothing has been drawn on ${ps.instrument_no}, so there is nothing to reinstate. To raise its value, record the bank's amendment instead.`,
      drawn,
    });
  }

  // A revolving instrument reinstates on its own terms after a draw. A
  // non-revolving one does not: restoring it means someone actually paid back
  // into the fund or had the guarantee amended, and that is a fact about the
  // world rather than a number being edited. is_revolving was recorded on every
  // instrument and read by nothing, so a corpus fund replenished as freely as a
  // revolving letter of credit.
  const reason = String(req.body.reason ?? '').trim();
  if (!ps.is_revolving && !reason) {
    return res.status(400).json({
      error: 'This instrument is not revolving, so its cover does not come back on its own. Record what restored it — a reference for the payment into the fund, or the guarantee amendment.',
      is_revolving: 0,
    });
  }

  const newUtil = Math.max(0, drawn - amount);
  db.prepare(`UPDATE payment_security SET utilized_amount = ?, updated_at = datetime('now') WHERE id = ?`).run(newUtil, ps.id);
  const fresh = syncInstrumentAvailable(ps.id);
  recordSecurityEvent({
    instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'REPLENISH',
    details: { amount, is_revolving: ps.is_revolving ? 1 : 0, reason: reason || undefined, drawn_before: drawn },
  });
  // A buyer reinstating its own letter of credit restores cover on its say-so;
  // the desk is at least told, so it can be checked against the bank's advice.
  if (!counterpartySide(req.user)) {
    const contract = db.prepare('SELECT contract_no, contract_type FROM contracts WHERE id = ?').get(ps.contract_id);
    const side = ps.mechanism_type === 'LC' ? 'BUYER' : ps.mechanism_type === 'BANK_GUARANTEE' ? 'SELLER' : defaultSideOf(contract);
    notifyCounterparty(ps.contract_id, side, 'SECURITY', `${contract?.contract_no || ps.contract_id}: SJVN has recorded ${rupees(amount)} reinstated on ${ps.instrument_no}.`);
  }
  if (counterpartySide(req.user)) {
    const contractNo = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(ps.contract_id)?.contract_no || ps.contract_id;
    notifyDesk('SECURITY', `${contractNo}: ${req.user.name} has recorded ${rupees(amount)} reinstated on ${ps.instrument_no}. Check it against the bank's advice.`);
  }
  res.json(enrich(fresh));
});

router.post('/:id/renew', requireRole(...REIA_MAKE), (req, res) => {
  const { validity_end, limit_amount, amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!validity_end) return res.status(400).json({ error: 'validity_end required' });
  const newLimit = Number(limit_amount ?? amount ?? existing.limit_amount);
  // A renewal is an amendment by the bank, so it goes into the amendment chain
  // rather than overwriting the dates with nothing to show what they were.
  try {
    if (validity_end !== existing.validity_end || newLimit !== Number(existing.limit_amount)) db.transaction(() => takeAmendmentOnRecord(existing, {
      newValidityEnd: validity_end !== existing.validity_end ? validity_end : null,
      newLimit: newLimit !== Number(existing.limit_amount) ? newLimit : null,
      reason: req.body.reason || 'Renewed by the REIA desk', user: req.user, side: 'SJVN',
    }))();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const fresh = syncInstrumentAvailable(existing.id);
  recordSecurityEvent({ instrumentId: existing.id, contractId: existing.contract_id, user: req.user, eventType: 'RENEW', details: { validity_end, limit_amount: newLimit } });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'RENEW', module: 'REIA', entityType: 'payment_security', entityId: existing.id });
  res.json(enrich(fresh));
});

// Backward-compat invoke → waterfall on contract or single instrument
/**
 * Whose default an instrument answers for.
 *
 * A letter of credit is the buyer's payment instrument and a bank guarantee is
 * the seller's performance instrument. Pooled funds back either, so those need
 * telling which default is being invoked rather than being guessed at.
 */
function sideForInstrument(instrument, explicit) {
  const given = String(explicit || '').toUpperCase();
  if (given === 'BUYER' || given === 'SELLER') return given;
  if (instrument.mechanism_type === 'LC') return 'BUYER';
  if (instrument.mechanism_type === 'BANK_GUARANTEE') return 'SELLER';
  return null;
}

router.post('/:id/invoke', requireRole(...REIA_CHECK), (req, res) => {
  const { amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Which side's default this instrument answers for. The waterfall takes a side
  // and this route never passed one, so it always ran the buyer's — and invoking
  // a bank guarantee, which only ever answers for the seller, drew nothing while
  // still filing a demand notice for the attempt.
  const side = sideForInstrument(existing, req.body.side);
  if (!side) {
    return res.status(400).json({
      error: `${existing.mechanism_type} answers for either side, so say which default is being invoked — pass side as BUYER or SELLER.`,
    });
  }

  // The same rules as the contract-level invocation: it used to draw the
  // instrument's whole balance when nothing was overdue.
  const contractRow = db.prepare('SELECT * FROM contracts WHERE id = ?').get(existing.contract_id);
  const refusal = invocationRefusal(contractRow, side, amount, req.body.reason);
  if (refusal.error) return res.status(400).json(refusal);
  const { amt, elig } = refusal;

  const inv = invokeWaterfall(existing.contract_id, amt, elig.overdue_invoices, req.user, side);
  const draws = JSON.parse(inv?.waterfall_used || '[]');

  // A notice that drew nothing is a demand on the file for something that never
  // happened. Two of them were recorded during testing, both against a guarantee
  // the buyer-side waterfall could never have touched.
  if (!inv || !draws.length) {
    if (inv) db.prepare('DELETE FROM security_invocations WHERE id = ?').run(inv.id);
    return res.status(400).json({
      error: `Nothing could be drawn for a ${side} default on this contract — no live ${side === 'SELLER' ? 'guarantee' : 'letter of credit'} or pooled cover with a balance. No demand notice was raised.`,
      side,
    });
  }

  logAudit({
    req: typeof req !== "undefined" ? req : null, user: req.user, action: 'INVOKE', module: 'REIA',
    entityType: 'payment_security', entityId: existing.id,
    details: { amount: amt, side, drew: draws.map((d) => ({ instrument_no: d.instrument_no, amount: d.amount })) },
  });
  res.json({ instrument: enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(existing.id)), invocation: inv });
});

router.post('/:id/release-request', (req, res) => {
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!canAccessInstrument(req.user, ps) && !isReia(req.user)) return res.status(403).json({ error: 'Not authorized' });
  // A second request used to stack on the first, and one could be raised on an
  // instrument already released or never accepted.
  if (!['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED', 'EXPIRED'].includes(ps.status)) {
    return res.status(400).json({ error: ps.status === 'RELEASE_PENDING' ? 'A release request on this instrument is already with SJVN' : `An instrument that is ${ps.status.toLowerCase().replace(/_/g, ' ')} cannot be released` });
  }

  const position = releasePosition(ps.contract_id);
  const reason = String(req.body.reason ?? '').trim().slice(0, 1000) || 'Contract completion release';

  const id = newId('SRL');
  db.prepare(`
    INSERT INTO security_releases (
      id, payment_security_id, contract_id, status, checklist_no_dues, checklist_no_disputes, reason, requested_by
    ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).run(
    id, ps.id, ps.contract_id,
    position.outstanding_dues > 0 ? 0 : 1,
    position.open_disputes === 0 ? 1 : 0,
    reason,
    req.user.name
  );
  db.prepare(`UPDATE payment_security SET status = 'RELEASE_PENDING', updated_at = datetime('now') WHERE id = ?`).run(ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'RELEASE_REQUESTED', details: { outstanding: position.outstanding_dues, openDisputes: position.open_disputes, reason } });
  const contractNo = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(ps.contract_id)?.contract_no || ps.contract_id;
  notifyDesk('SECURITY', `${contractNo}: ${req.user.name} has asked for ${ps.instrument_no} to be released — ${reason}`, ['FINANCE_USER']);
  res.status(201).json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(id));
});

export default router;
