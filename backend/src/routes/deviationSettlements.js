import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef } from '../util.js';
import { getParamNumber } from '../mastersService.js';
import { scrapeLatestDSM } from '../services/nrpcScraper.js';
import { settledLakh, settlementRupees, luToMwh } from '../services/nrpcDsa.js';

const router = Router();
router.use(requireAuth);

// Deviation settlement is settled station by station with the regional pool,
// so each vertical's desk works its own stations' weeks: REIA its RE plants,
// Commercial the hydro stations, Thermal the thermal ones.
const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE])];

/** The contracts a vertical's desk settles DSM for, as a SQL condition on alias c. */
const VERTICAL_TYPES = {
  HYDRO: "c.project_type IN ('Hydro','PSP')",
  THERMAL: "c.project_type = 'Thermal'",
  REIA: "COALESCE(c.project_type, '') NOT IN ('Hydro','PSP','Thermal')",
};
/**
 * The Hydro and Thermal desks raise DSM only on their own stations. REIA has
 * settled the SJVN hydro stations' DSA weeks since the module was built and
 * keeps doing so; administrators are not tied to one desk.
 */
function outsideDesk(user, contract) {
  const role = user?.role;
  const type = contract?.project_type || '';
  const hydro = ['Hydro', 'PSP'].includes(type);
  const thermal = type === 'Thermal';
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL', 'COMMERCIAL_USER'].includes(role) && !hydro) return 'the Hydro desk settles DSM for hydro stations only';
  if (['THERMAL_ADMIN', 'THERMAL_USER'].includes(role) && !thermal) return 'the Thermal desk settles DSM for thermal stations only';
  return null;
}

function verticalClause(vertical) {
  if (!vertical) return '';
  const cond = VERTICAL_TYPES[vertical];
  if (!cond) throw Object.assign(new Error('vertical must be REIA, HYDRO or THERMAL'), { status: 400 });
  return ` AND contract_id IN (SELECT c.id FROM contracts c WHERE ${cond})`;
}

function withContract(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no, contract_type, project_type FROM contracts WHERE id = ?').get(row.contract_id);
  let invoice_status = null;
  if (row.invoice_id) {
    invoice_status = db.prepare('SELECT status FROM invoices WHERE id = ?').get(row.invoice_id)?.status || null;
  }
  let dsa = null;
  if (row.dsa_account_id) {
    dsa = db.prepare(`
      SELECT week_code, revision, financial_year, week_start, week_end, issued_date, due_date, status
      FROM nrpc_dsa_accounts WHERE id = ?
    `).get(row.dsa_account_id) || null;
  }
  return {
    ...row,
    contract_no: c?.contract_no,
    project_type: c?.project_type,
    invoice_status,
    // An estimate is worth labelling wherever the row is shown.
    is_estimate: row.source !== 'NRPC_DSA',
    dsa_statement: dsa,
    // A statement that has since been revised: the figure on this row is no
    // longer the operative one.
    dsa_superseded: dsa ? dsa.status === 'SUPERSEDED' : false,
  };
}

/**
 * The manual estimate: (actual − scheduled) MWh × rate (₹/MWh),
 * +recoverable / −payable.
 *
 * This is an estimate and not a settlement. NRPC prices each 15-minute block
 * against the grid frequency in that block, so no single rate reproduces the
 * published figure, and the direction does not always follow the deviation —
 * over the archive Nathpa Jhakri settles against the direction of its own
 * deviation on 88 of 1715 days. Rows priced this way are marked source
 * 'MANUAL' and should be replaced by the statement once it is published; see
 * POST /from-dsa.
 */
function computeNet(scheduled, actual, rate) {
  const dev = Math.round(((Number(actual) || 0) - (Number(scheduled) || 0)) * 1000) / 1000;
  const amount = Math.round(dev * (Number(rate) || 0));
  return { deviation_mwh: dev, deviation_amount: amount };
}

/**
 * Catch a DSM rate entered in the wrong unit.
 *
 * deviation_rate is ₹/MWh, while every tariff field on a contract is ₹/kWh. The
 * two differ by a thousand and nothing on the way in said which was wanted, so
 * entering 2.00 for a ₹2/kWh rate produced a ₹6 charge where ₹6,000 was meant —
 * small enough to be paid without anyone querying it. NRPC DSM rates run in the
 * hundreds to thousands of ₹/MWh, so a non-zero rate below the floor is a unit
 * slip rather than a real price.
 */
/**
 * The Monday an NRPC financial-year week starts on. Week 1 starts on the Monday
 * on or before 1 April (FY 2025-26 W40 = 29 Dec 2025, FY 2022-23 W44 =
 * 23 Jan 2023, both as printed on the statements).
 */
export function fyWeekStart(fyStartYear, weekNo) {
  const apr1 = new Date(Date.UTC(fyStartYear, 3, 1));
  const back = (apr1.getUTCDay() + 6) % 7; // days since Monday
  const d = new Date(apr1.getTime() - back * 86400000 + (weekNo - 1) * 7 * 86400000);
  return d.toISOString().slice(0, 10);
}

/** The week's start date if week n falls in the month given (either FY it could belong to), else null. */
function weekInMonth(periodMonth, weekNo) {
  const [y, m] = periodMonth.split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  for (const start of [fyWeekStart(fy, weekNo), fyWeekStart(fy + 1, weekNo)]) {
    if (start.slice(0, 7) === periodMonth) return start;
  }
  return null;
}

/** The most a station can put out in a week: its capacity for 168 hours (hydro may run 10% over). */
function weeklyCeilingMwh(contract) {
  const mw = Number(contract?.commissioned_capacity_mw) > 0 ? Number(contract.commissioned_capacity_mw) : Number(contract?.capacity_mw) || 0;
  const overload = ['Hydro', 'PSP'].includes(contract?.project_type) ? 1.1 : 1;
  return mw > 0 ? Math.round(mw * 168 * overload * 1000) / 1000 : null;
}

function implausibleRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r === 0) return null;
  // The sign of a week comes from its deviation; a negative rate flipped it, so
  // an over-injection read as a payable.
  if (r < 0) {
    return { error: 'The deviation rate is a price and is never negative — the sign comes from the deviation (actual − scheduled).', given_rate_per_mwh: r };
  }
  const floor = getParamNumber('dsm_rate_min_per_mwh', 50);
  if (Math.abs(r) >= floor) return null;
  return {
    error: `The deviation rate is in ₹/MWh, not ₹/kWh — ${r} would be well below any real DSM rate. Did you mean ${r * 1000}?`,
    given_rate_per_mwh: r,
    likely_intended_per_mwh: r * 1000,
    minimum_plausible_per_mwh: floor,
  };
}

/**
 * Create a SUPPLEMENTARY invoice for a DSM row and link it back.
 * Caller must validate eligibility; runs inside its own transaction.
 */
/**
 * What an earlier bill for the week already settled, signed from SJVN's side
 * (+ recoverable from the pool, − payable to it). A pool bill carries its sign
 * in its direction; one from before 17-Oct-2026 (DSM-PPA / DSM-PSA) carried it
 * in its total.
 */
export function dsmSigned(inv) {
  const t = Number(inv?.total_amount) || 0;
  if (String(inv?.invoice_no || '').startsWith('DSM-POOL')) return inv.direction === 'SELLER_TO_SJVN' ? -t : t;
  return t;
}

/**
 * When the pool expects the week settled: the date NRPC prints on the
 * statement, else the bill date plus dsm_pool_payment_days. Contract payment
 * terms (45 days) are the buyer's PSA, not the pool's.
 */
function poolDueDate(row, billDate) {
  const printed = row.dsa_account_id
    ? db.prepare('SELECT due_date FROM nrpc_dsa_accounts WHERE id = ?').get(row.dsa_account_id)?.due_date
    : null;
  if (printed && /^\d{4}-\d{2}-\d{2}/.test(String(printed))) return String(printed).slice(0, 10);
  const days = getParamNumber('dsm_pool_payment_days', 10);
  return new Date(Date.parse(`${billDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Decided 17-Oct-2026: a DSM bill settles with the NRPC deviation pool, so it
 * sits in a series of its own (DSM-POOL) and never in the PPA's developer
 * pipeline. Its amount is always positive: a recoverable week is a receivable
 * (SJVN → pool, read as SJVN_TO_BUYER), a payable week or a revision that
 * lowers the figure is a payable (pool → SJVN, read as SELLER_TO_SJVN). No
 * counterparty on the contract sees it.
 */
function createDsmInvoice(row, contract, { invoice_no: overrideNo, dispatch_date, created_by, created_by_id = null, prior = [] }) {
  // A revised statement replaces the week's figure: what is billed is the
  // difference from what earlier bills for the week already asked for.
  const statementAmount = Math.round(Number(row.deviation_amount) || 0);
  const priorBilled = prior.reduce((t, p) => t + dsmSigned(p), 0);
  const signed = statementAmount - priorBilled;
  const amount = Math.abs(signed);
  const direction = signed >= 0 ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, row.period_month, direction);
  const invoiceId = newId('INV');
  const invoice_no = overrideNo || genInvoiceNo('DSM-POOL');
  const billDate = dispatch_date || new Date().toISOString().split('T')[0];
  const due_date = poolDueDate(row, billDate);

  const signLabel = signed >= 0 ? 'recoverable from the pool' : 'payable to the pool';
  const fromStatement = row.source === 'NRPC_DSA';
  const breakdown = [
    {
      code: 'DSM',
      label: `DSM ${row.dsm_no} · Week ${row.week_no}${row.entry_type === 'REVISED' ? ' (R)' : ''}`,
      value: null,
    },
    // Energy, said to be energy: without a format these three printed as rupees
    // on the bill — "Scheduled (MWh) ₹51,107".
    { code: 'SCH', label: 'Scheduled (MWh)', value: Number(row.scheduled_mwh) || 0, format: 'mwh' },
    { code: 'ACT', label: 'Actual (MWh)', value: Number(row.actual_mwh) || 0, format: 'mwh' },
    { code: 'DEV', label: 'Deviation (MWh)', value: Number(row.deviation_mwh) || 0, format: 'mwh' },
    // A statement-backed bill shows its source, not a rate: NRPC prices each
    // block against frequency and publishes no rate, so quoting one would
    // suggest the total was derived from it.
    fromStatement
      ? { code: 'SRC', label: `Per NRPC Deviation Settlement Account · ${row.dsa_entity_name}`, value: null }
      : { code: 'RATE', label: 'DSM rate (₹/MWh) — estimate', value: Number(row.deviation_rate) || 0 },
    // A deviation bill sits in the PPA's series, where every other bill is the
    // seller's on SJVN. This one settles with the regional pool, so it says so.
    {
      code: 'FLOW',
      label: signed >= 0
        ? 'Recoverable by SJVN — received from the NRPC deviation pool for this week'
        : 'Payable by SJVN — paid to the NRPC deviation pool for this week',
      value: null,
    },
    ...(prior.length ? [
      { code: 'STMT', label: `Week's figure per this statement (${row.dsa_entity_name || 'revised'})`, value: statementAmount },
      ...prior.map((p) => ({ code: 'PRIOR', label: `Less: already settled on ${p.invoice_no}`, value: -dsmSigned(p) })),
    ] : []),
    { code: 'AMT', label: `${prior.length ? 'Difference to settle' : 'Net DSM amount'} (${signLabel})`, value: amount },
    { code: 'DUE', label: `Due to the pool by ${due_date}${row.dsa_account_id ? ' (per the NRPC statement where printed)' : ''}`, value: null },
    { code: 'TOTAL', label: signed >= 0 ? 'Receivable from NRPC deviation pool' : 'Payable to NRPC deviation pool', value: amount },
  ];

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
        tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
        transmission_charges, lps, penalty, trading_margin, taxes,
        other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
        parent_invoice_id, billing_family_ref, energy_data_id, created_by, created_by_id)
      VALUES (@id, @invoice_no, @contract_id, 'SUPPLEMENTARY', @direction, @billing_period, 0,
        0, @energy_charges, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
        NULL, @billing_family_ref, NULL, @created_by, @created_by_id)
    `).run({
      id: invoiceId,
      invoice_no,
      contract_id: contract.id,
      direction,
      billing_period: row.period_month,
      energy_charges: amount,
      total_amount: amount,
      invoice_breakdown_json: JSON.stringify(breakdown),
      due_date,
      billing_family_ref: billingFamilyRef,
      created_by,
      // Who raised it, as an id: it is what stops the same person approving it.
      created_by_id,
    });
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(
      newId('APR'), invoiceId, 'PENDING',
    );
    db.prepare(`
      UPDATE deviation_settlements
      SET status='DISPATCHED', invoice_no=?, invoice_id=?, dispatch_date=?, updated_at=datetime('now')
      WHERE id=?
    `).run(invoice_no, invoiceId, billDate, row.id);
  });
  run();

  return { invoiceId, invoice_no, dispatch_date: billDate, amount: signed };
}

/**
 * The section of the NRPC statement a station's contract is printed under, and
 * the plant code SJVN files it by. A week raised for Rampur's contract from
 * Nathpa Jhakri's section — or another company's — is another plant's money on
 * this one's account, and the form let any of the hundred entities be picked.
 */
const STATIONS = [
  { match: 'NJHPS', entity: 'NATHPA JHAKRI HEP', plant_code: '001' },
  { match: 'RHPS', entity: 'RAMPUR HEP', plant_code: '002' },
  { match: 'SGEL', entity: 'SJVN GREEN ENERGY', plant_code: null },
];
const stationOf = (contract) => STATIONS.find((st) => String(contract?.contract_no || '').toUpperCase().includes(st.match)) || null;

// List — filter by contract / period / status
router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, status, vertical } = req.query;
  let sql = 'SELECT * FROM deviation_settlements WHERE 1=1';
  try { sql += verticalClause(vertical); } catch (err) { return res.status(400).json({ error: err.message }); }
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY period_month DESC, week_no DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withContract));
});

/**
 * Fetch the latest NRPC weekly deviation account for a plant.
 *
 * Not built — answers 501 so the client can say so plainly. 501 rather than 500
 * because nothing failed: the pipeline does not exist yet. See nrpcScraper.js
 * for what has to be settled first.
 */
router.get('/scrape', requireRole(...WRITE), async (req, res) => {
  const result = await scrapeLatestDSM(req.query.plant_code);
  if (!result.success) {
    return res.status(501).json({ error: result.message, reason: result.reason });
  }
  res.json(result);
});

/**
 * Summary totals for a period.
 *
 * A week can hold both a PRIMARY row and a REVISED one — a revision replaces
 * what it revises, it does not add to it — so only the operative row per
 * (contract, period, week) is counted. Summing both double-counted every
 * revised week.
 */
router.get('/summary', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, vertical } = req.query;
  let filters = '';
  try { filters += verticalClause(vertical); } catch (err) { return res.status(400).json({ error: err.message }); }
  const params = [];
  if (contract_id) { filters += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { filters += ' AND period_month = ?'; params.push(period_month); }

  const row = db.prepare(`
    WITH operative AS (
      SELECT deviation_amount, source, week_date,
             ROW_NUMBER() OVER (
               PARTITION BY contract_id, period_month, week_no
               ORDER BY CASE entry_type WHEN 'REVISED' THEN 0 ELSE 1 END, created_at DESC
             ) AS rn
      FROM deviation_settlements
      WHERE status != 'CANCELLED'${filters}
    )
    SELECT COUNT(*) weeks,
           COALESCE(SUM(deviation_amount),0) net_amount,
           COALESCE(SUM(CASE WHEN deviation_amount>0 THEN deviation_amount ELSE 0 END),0) recoverable,
           COALESCE(SUM(CASE WHEN deviation_amount<0 THEN deviation_amount ELSE 0 END),0) payable,
           COALESCE(SUM(CASE WHEN source='NRPC_DSA' THEN 1 ELSE 0 END),0) from_statement,
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' THEN 1 ELSE 0 END),0) estimated,
           -- An estimate for a week whose statement has since been imported is
           -- waiting to be replaced; one whose statement has not arrived is
           -- simply not due yet. Only the latter is still to be reconciled.
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' AND NOT EXISTS (
             SELECT 1 FROM nrpc_dsa_accounts a
             WHERE a.status = 'ACTIVE'
               AND a.week_start <= operative.week_date
               AND a.week_end   >= operative.week_date
           ) THEN 1 ELSE 0 END),0) pending_reconciliation,
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' AND EXISTS (
             SELECT 1 FROM nrpc_dsa_accounts a
             WHERE a.status = 'ACTIVE'
               AND a.week_start <= operative.week_date
               AND a.week_end   >= operative.week_date
           ) THEN 1 ELSE 0 END),0) estimates_replaceable
    FROM operative WHERE rn = 1
  `).get(...params);
  res.json(row);
});

// ── DSM1: statements against the register ──────────────────────────────────
// Each current NRPC statement, for every SJVN station on it: what the week's
// figure is, whether it is raised and billed, and the revision delta still to
// settle beside what was billed — with one click to raise it.
const callHandler = (handler, req) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  handler(req, res);
});

router.get('/statement-sync', requireRole(...READ), (req, res) => {
  const limit = Math.min(104, Math.max(1, Number(req.query.weeks) || 26));
  const accounts = db.prepare(`
    SELECT * FROM nrpc_dsa_accounts WHERE status <> 'SUPERSEDED' ORDER BY financial_year DESC, week_no DESC LIMIT ?
  `).all(limit);
  const contracts = db.prepare(`SELECT * FROM contracts WHERE status IN ('ACTIVE','NEARING_EXPIRY','AMENDED','RENEWED','EXPIRED')`).all()
    .map((c) => ({ c, st: stationOf(c) })).filter((x) => x.st);
  const rows = [];
  for (const a of accounts) {
    for (const { c, st } of contracts) {
      const total = db.prepare('SELECT * FROM nrpc_dsa_entity_totals WHERE account_id = ? AND entity_name = ?').get(a.id, st.entity);
      if (!total) continue;
      const figure = settlementRupees(total);
      const row = db.prepare(`SELECT id, dsm_no, status, invoice_no FROM deviation_settlements WHERE contract_id = ? AND dsa_account_id = ? AND status <> 'CANCELLED'`).get(c.id, a.id);
      const bills = db.prepare(`
        SELECT i.invoice_no, i.total_amount, i.direction, i.status FROM deviation_settlements d
        JOIN nrpc_dsa_accounts x ON x.id = d.dsa_account_id JOIN invoices i ON i.id = d.invoice_id
        WHERE d.contract_id = ? AND d.week_no = ? AND x.financial_year = ? AND i.status <> 'CANCELLED'
      `).all(c.id, a.week_no, a.financial_year);
      const billed = Math.round(bills.reduce((t, b) => t + dsmSigned(b), 0));
      const delta = figure == null ? null : Math.round(figure - billed);
      const state = !row ? (bills.length ? 'REVISION_NOT_RAISED' : 'NOT_RAISED')
        : row.status === 'DISPATCHED' ? (delta === 0 ? 'SETTLED' : 'BILLED') : 'RAISED_UNBILLED';
      rows.push({
        dsa_account_id: a.id, financial_year: a.financial_year, week_no: a.week_no, revision: a.revision || null,
        week_start: a.week_start, week_end: a.week_end, due_date: a.due_date,
        contract_id: c.id, contract_no: c.contract_no, entity_name: st.entity,
        statement_amount: figure, billed_so_far: billed, delta, row: row || null, bills, state,
      });
    }
  }
  res.json({ rows, totals: { to_raise: rows.filter((r) => ['NOT_RAISED', 'REVISION_NOT_RAISED', 'RAISED_UNBILLED'].includes(r.state) && r.delta).length } });
});

// One click: raise the week from the statement and bill it.
router.post('/raise-from-statement', requireRole(...WRITE), async (req, res) => {
  const { dsa_account_id: accountId, contract_id: contractId } = req.body || {};
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  { const no = outsideDesk(req.user, contract); if (no) return res.status(403).json({ error: `${contract.contract_no}: ${no}.` }); }
  const st = stationOf(contract);
  if (!st) return res.status(400).json({ error: `${contract.contract_no} is not one of SJVN's stations on the NRPC statement.` });
  let row = db.prepare(`SELECT * FROM deviation_settlements WHERE contract_id = ? AND dsa_account_id = ? AND status <> 'CANCELLED'`).get(contractId, accountId);
  if (!row) {
    const made = await callHandler(fromDsaHandler, { ...req, body: { contract_id: contractId, dsa_account_id: accountId, entity_name: st.entity } });
    if (made.status >= 400) return res.status(made.status).json(made.body);
    row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(made.body.id);
  }
  if (row.status === 'DISPATCHED' && row.invoice_id) return res.status(409).json({ error: `${row.dsm_no} is already billed (${row.invoice_no}).` });
  const billed = await callHandler(dispatchHandler, { ...req, params: { id: row.id }, body: {} });
  if (billed.status >= 400) return res.status(billed.status).json({ ...billed.body, raised: row.dsm_no });
  res.status(201).json(billed.body);
});

// ── DSM4: what is owed to and from the pool, and paid ───────────────────────
// Each pool bill with NRPC's due date, the payments (UTR) against it, and the
// late payment interest the DSM regulations charge on what was late
// (dsm_late_interest_pct_per_day, 0.04% a day by default).
router.get('/pool-tracker', requireRole(...READ), (req, res) => {
  const rate = getParamNumber('dsm_late_interest_pct_per_day', 0.04) / 100;
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const days = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
  const bills = db.prepare(`
    SELECT i.*, c.contract_no, d.dsm_no, d.week_no, x.financial_year, x.revision FROM invoices i
    JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN deviation_settlements d ON d.invoice_id = i.id
    LEFT JOIN nrpc_dsa_accounts x ON x.id = d.dsa_account_id
    WHERE i.invoice_no LIKE 'DSM-%' AND i.status NOT IN ('CANCELLED', 'DRAFT', 'REJECTED')
    ORDER BY i.due_date IS NULL, i.due_date
  `).all();
  const rows = bills.map((b) => {
    const signed = dsmSigned(b);
    const pays = db.prepare('SELECT amount, deduction, payment_date, reference FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(b.id);
    const amount = Math.abs(Number(b.total_amount) || 0);
    let left = amount;
    let interest = 0;
    for (const p of pays) {
      const paid = (Number(p.amount) || 0) + (Number(p.deduction) || 0);
      if (b.due_date && p.payment_date > b.due_date) interest += Math.min(left, paid) * rate * days(b.due_date, p.payment_date);
      left = Math.max(0, left - paid);
    }
    if (left > 0.5 && b.due_date && today > b.due_date) interest += left * rate * days(b.due_date, today);
    return {
      invoice_id: b.id, invoice_no: b.invoice_no, contract_no: b.contract_no, dsm_no: b.dsm_no, week: b.week_no ? `${b.financial_year} W${b.week_no}${b.revision ? `-${b.revision}` : ''}` : null,
      flow: signed >= 0 ? 'RECEIVABLE' : 'PAYABLE', amount, due_date: b.due_date, status: b.status,
      paid: Math.round(amount - left), outstanding: Math.round(left),
      utrs: pays.map((p) => p.reference).filter(Boolean), last_paid_on: pays.length ? pays[pays.length - 1].payment_date : null,
      days_late: left > 0.5 && b.due_date && today > b.due_date ? days(b.due_date, today) : 0,
      late_interest: Math.round(interest),
    };
  });
  const sum = (flow, k) => rows.filter((r) => r.flow === flow).reduce((t, r) => t + r[k], 0);
  res.json({
    rate_pct_per_day: rate * 100,
    rows,
    totals: {
      receivable_outstanding: sum('RECEIVABLE', 'outstanding'), payable_outstanding: sum('PAYABLE', 'outstanding'),
      interest_due_to_sjvn: sum('RECEIVABLE', 'late_interest'), interest_due_by_sjvn: sum('PAYABLE', 'late_interest'),
    },
  });
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  res.json(withContract(row));
});

/**
 * Create a settlement row from a NRPC Deviation Settlement Account.
 *
 * This is the path that should be used. The amount is the figure NRPC
 * published for that entity in that week, converted once in nrpcDsa.js — no
 * rate is involved and nothing is recomputed here. The row lands CALCULATED
 * for the desk to review; it does not dispatch itself.
 *
 * Body: { contract_id, dsa_account_id, entity_name, plant_code?, plant_name?, notes? }
 */
const fromDsaHandler = (req, res) => {
  const b = req.body || {};
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const notMine = outsideDesk(req.user, contract);
  if (notMine) return res.status(403).json({ error: `${contract.contract_no}: ${notMine}.` });
  if (!b.dsa_account_id) return res.status(400).json({ error: 'dsa_account_id is required' });
  if (!b.entity_name) return res.status(400).json({ error: 'entity_name is required — the name the statement uses, e.g. NATHPA JHAKRI HEP' });

  const account = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(b.dsa_account_id);
  if (!account) return res.status(404).json({ error: 'DSA statement not found' });
  if (account.status === 'SUPERSEDED') {
    return res.status(409).json({
      error: 'That statement has been superseded by a later one for the same week. Use the current statement.',
      superseded_by: account.superseded_by,
    });
  }

  const station = stationOf(contract);
  if (station && station.entity !== b.entity_name) {
    return res.status(400).json({
      error: `${contract.contract_no} is ${station.entity} on the statement. "${b.entity_name}" is another station's section — its week cannot be raised on this contract.`,
    });
  }
  const other = STATIONS.find((st) => st.entity === b.entity_name);
  if (!station && other) {
    return res.status(400).json({
      error: `"${b.entity_name}" is the section of an SJVN station with its own contract. Raise its week on that contract.`,
    });
  }

  const total = db.prepare(
    'SELECT * FROM nrpc_dsa_entity_totals WHERE account_id = ? AND entity_name = ?',
  ).get(b.dsa_account_id, b.entity_name);
  if (!total) {
    return res.status(404).json({
      error: `The statement for week ${account.week_no} of ${account.financial_year} has no entity named "${b.entity_name}".`,
    });
  }

  // The week a NRPC statement covers is a financial-year week and can straddle
  // a month boundary. It is filed under the month it starts in, so that a week
  // lands in exactly one period.
  const period_month = account.week_start.slice(0, 7);
  const entry_type = account.revision ? 'REVISED' : 'PRIMARY';

  // One row per statement. Raised once, it is not raised again; a later
  // revision of the same week is a row of its own (it used to have nowhere to go
  // once the first revision was billed).
  const same = db.prepare(`SELECT id, dsm_no FROM deviation_settlements WHERE contract_id = ? AND dsa_account_id = ? AND status <> 'CANCELLED'`)
    .get(b.contract_id, account.id);
  if (same) {
    return res.status(409).json({ error: `Week ${account.week_no} of ${account.financial_year}${account.revision ? ` (${account.revision})` : ''} is already raised for this contract as ${same.dsm_no}.`, existing_id: same.id, existing_source: 'NRPC_DSA' });
  }
  const estimate = db.prepare(`SELECT id, dsm_no FROM deviation_settlements WHERE contract_id = ? AND period_month = ? AND week_no = ? AND source = 'MANUAL' AND status <> 'CANCELLED'`)
    .get(b.contract_id, period_month, account.week_no);
  if (estimate) {
    return res.status(409).json({
      error: `Week ${account.week_no} already holds a manual estimate for this contract in ${period_month} (${estimate.dsm_no}). Delete the estimate, then raise the published figure in its place.`,
      existing_id: estimate.id, existing_source: 'MANUAL',
    });
  }

  const scheduled_mwh = luToMwh(total.schedule_lu) ?? 0;
  const actual_mwh = luToMwh(total.actual_lu) ?? 0;
  const deviation_amount = settlementRupees(total);
  if (deviation_amount == null) {
    return res.status(422).json({ error: 'The statement publishes no settled amount for this entity.' });
  }

  const id = newId('DSM');
  const dsm_no = `DSM/${contract.contract_no?.replace(/[^A-Za-z0-9]+/g, '-')}/${account.financial_year}/W${account.week_no}${account.revision ? `-${account.revision}` : ''}`;
  if (db.prepare('SELECT 1 FROM deviation_settlements WHERE dsm_no = ?').get(dsm_no)) {
    return res.status(409).json({ error: `${dsm_no} is already on record (cancelled). Ask the desk to restore it rather than raising it twice.` });
  }
  // Rows for this week from statements since superseded, still unbilled, are
  // stale: the new statement takes their place.
  const stale = db.prepare(`
    SELECT d.id FROM deviation_settlements d JOIN nrpc_dsa_accounts a ON a.id = d.dsa_account_id
    WHERE d.contract_id = ? AND d.week_no = ? AND a.financial_year = ? AND a.status = 'SUPERSEDED' AND d.status IN ('DRAFT','CALCULATED','SUBMITTED')
  `).all(b.contract_id, account.week_no, account.financial_year);
  for (const r of stale) {
    db.prepare(`UPDATE deviation_settlements SET status = 'CANCELLED', notes = COALESCE(notes || ' · ', '') || ?, updated_at = datetime('now') WHERE id = ?`)
      .run(`Superseded by ${dsm_no}`, r.id);
    logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'deviation_settlement', entityId: r.id, details: { superseded_by: dsm_no } });
  }
  db.prepare(`
    INSERT INTO deviation_settlements (id, dsm_no, contract_id, plant_code, plant_name, period_month,
      week_no, week_date, entry_type, source, dsa_account_id, dsa_entity_name,
      scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate, deviation_amount, status, notes, created_by)
    VALUES (@id, @dsm_no, @contract_id, @plant_code, @plant_name, @period_month,
      @week_no, @week_date, @entry_type, 'NRPC_DSA', @dsa_account_id, @dsa_entity_name,
      @scheduled_mwh, @actual_mwh, @deviation_mwh, NULL, @deviation_amount, 'CALCULATED', @notes, @created_by)
  `).run({
    id,
    dsm_no,
    contract_id: b.contract_id,
    plant_code: b.plant_code || station?.plant_code || null,
    plant_name: b.plant_name || b.entity_name,
    period_month,
    week_no: account.week_no,
    week_date: account.week_start,
    entry_type,
    dsa_account_id: account.id,
    dsa_entity_name: b.entity_name,
    scheduled_mwh,
    actual_mwh,
    // Reported for context. It is not what the amount was derived from, and on
    // some weeks its direction disagrees with the settlement's.
    deviation_mwh: Math.round((actual_mwh - scheduled_mwh) * 1000) / 1000,
    deviation_amount,
    notes: b.notes || null,
    created_by: req.user.name,
  });

  logAudit({
    req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'deviation_settlement',
    entityId: id,
    details: {
      source: 'NRPC_DSA', dsa_account_id: account.id, entity_name: b.entity_name,
      week_no: account.week_no, financial_year: account.financial_year,
      settled_lakh: settledLakh(total), deviation_amount,
    },
  });
  res.status(201).json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(id)));
};
router.post('/from-dsa', requireRole(...WRITE), fromDsaHandler);

// Create a weekly deviation entry (data provided by NRPC)
router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const notMine = outsideDesk(req.user, contract);
  if (notMine) return res.status(403).json({ error: `${contract.contract_no}: ${notMine}.` });
  if (!b.period_month) return res.status(400).json({ error: 'period_month (YYYY-MM) is required' });
  if (b.week_no == null || b.week_no === '') return res.status(400).json({ error: 'week_no is required' });
  const entry_type = ['PRIMARY', 'REVISED'].includes(b.entry_type) ? b.entry_type : 'PRIMARY';

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.period_month))) return res.status(400).json({ error: 'period_month must be YYYY-MM' });
  const weekNo = Number(b.week_no);
  // NRPC numbers weeks through the financial year, WK-01 to WK-53.
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 53) return res.status(400).json({ error: 'week_no is the financial-year week, 1 to 53' });
  for (const k of ['scheduled_mwh', 'actual_mwh']) {
    if (!Number.isFinite(Number(b[k])) || Number(b[k]) < 0) return res.status(400).json({ error: `${k} must be a number, zero or more` });
  }

  // Deviation is the generator's with the grid; a buyer's PSA has no DSM of SJVN's to estimate.
  if (contract.contract_type !== 'PPA') {
    return res.status(400).json({ error: `${contract.contract_no} is a ${contract.contract_type}. Deviation is settled for the station's PPA.` });
  }
  const weekStart = weekInMonth(String(b.period_month), weekNo);
  if (!weekStart) {
    return res.status(400).json({ error: `Week ${weekNo} of the financial year does not fall in ${b.period_month}. NRPC files a week under the month it starts in.` });
  }
  const ceiling = weeklyCeilingMwh(contract);
  for (const k of ['scheduled_mwh', 'actual_mwh']) {
    if (ceiling && Number(b[k]) > ceiling) {
      return res.status(400).json({ error: `${k === 'actual_mwh' ? 'Actual' : 'Scheduled'} ${Number(b[k]).toLocaleString('en-IN')} MWh is more than ${contract.contract_no} can deliver in a week (${contract.capacity_mw} MW × 168 h${['Hydro', 'PSP'].includes(contract.project_type) ? ' × 110%' : ''} = ${ceiling.toLocaleString('en-IN')} MWh).` });
    }
  }
  const dup = db.prepare(`SELECT id, status FROM deviation_settlements WHERE contract_id=? AND period_month=? AND week_no=? AND entry_type=? AND status <> 'CANCELLED'`)
    .get(b.contract_id, b.period_month, weekNo, entry_type);
  if (dup) return res.status(409).json({ error: `A ${entry_type} entry for week ${b.week_no} already exists this period. Edit it or use REVISED.` });

  const badRate = implausibleRate(b.deviation_rate);
  if (badRate) return res.status(400).json(badRate);

  const { deviation_mwh, deviation_amount } = computeNet(b.scheduled_mwh, b.actual_mwh, b.deviation_rate);
  const id = newId('DSM');
  // A cancelled row keeps its place on record; the replacement needs its own number.
  let manualNo = `DSM/${contract.contract_no?.replace(/[^A-Za-z0-9]+/g, '-')}/${b.period_month}/W${b.week_no}${entry_type === 'REVISED' ? '-R' : ''}`;
  for (let n = 2; db.prepare('SELECT 1 FROM deviation_settlements WHERE dsm_no = ?').get(manualNo); n += 1) {
    manualNo = `${manualNo.replace(/~\d+$/, '')}~${n}`;
  }
  db.prepare(`
    INSERT INTO deviation_settlements (id, dsm_no, contract_id, plant_code, plant_name, period_month,
      week_no, week_date, entry_type, scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate,
      deviation_amount, status, notes, created_by)
    VALUES (@id, @dsm_no, @contract_id, @plant_code, @plant_name, @period_month,
      @week_no, @week_date, @entry_type, @scheduled_mwh, @actual_mwh, @deviation_mwh, @deviation_rate,
      @deviation_amount, 'CALCULATED', @notes, @created_by)
  `).run({
    id,
    dsm_no: manualNo,
    contract_id: b.contract_id,
    plant_code: b.plant_code || null,
    plant_name: b.plant_name || null,
    period_month: b.period_month,
    week_no: Number(b.week_no),
    week_date: weekStart,
    entry_type,
    scheduled_mwh: Number(b.scheduled_mwh) || 0,
    actual_mwh: Number(b.actual_mwh) || 0,
    deviation_mwh,
    deviation_rate: Number(b.deviation_rate) || 0,
    deviation_amount,
    notes: b.notes || null,
    created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'deviation_settlement', entityId: id, details: { ...b, deviation_mwh, deviation_amount } });
  res.status(201).json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(id)));
});

// Edit (recomputes net); blocked once dispatched
router.put('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  // Each desk works its own stations' weeks on every step, not only when one
  // is raised: the Hydro and Thermal desks could edit, bill and delete a
  // solar plant's week (Hydro QA run 11).
  { const no = outsideDesk(req.user, db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id)); if (no) return res.status(403).json({ error: no }); }
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be edited' });
  // Editing used to set the status back to CALCULATED whatever it was, which
  // quietly revived a deleted week.
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'This week was deleted. Add it again rather than editing the deleted entry.' });
  const b = req.body;
  // A statement-backed row carries the figure NRPC published. Editing the
  // energy or the rate would recompute it from a formula that does not
  // reproduce the settlement, quietly replacing a published number with an
  // estimate. Notes and plant labels are still editable below.
  if (row.source === 'NRPC_DSA') {
    const figureEdits = ['scheduled_mwh', 'actual_mwh', 'deviation_rate'].filter((k) => b[k] !== undefined);
    if (figureEdits.length) {
      return res.status(400).json({
        error: `This row carries the figures NRPC published for ${row.dsa_entity_name}; `
          + `${figureEdits.join(', ')} cannot be edited. Import the revised statement instead.`,
      });
    }
  }
  if (b.deviation_rate !== undefined) {
    const badRate = implausibleRate(b.deviation_rate);
    if (badRate) return res.status(400).json(badRate);
  }
  if (row.source !== 'NRPC_DSA') {
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
    const ceiling = weeklyCeilingMwh(contract);
    for (const k of ['scheduled_mwh', 'actual_mwh']) {
      const v = b[k] ?? row[k];
      if (!Number.isFinite(Number(v)) || Number(v) < 0) return res.status(400).json({ error: `${k} must be a number, zero or more` });
      if (ceiling && Number(v) > ceiling) {
        return res.status(400).json({ error: `${Number(v).toLocaleString('en-IN')} MWh is more than ${contract.contract_no} can deliver in a week (${ceiling.toLocaleString('en-IN')} MWh).` });
      }
    }
  }
  const { deviation_mwh, deviation_amount } = row.source === 'NRPC_DSA'
    ? { deviation_mwh: row.deviation_mwh, deviation_amount: row.deviation_amount }
    : computeNet(b.scheduled_mwh ?? row.scheduled_mwh, b.actual_mwh ?? row.actual_mwh, b.deviation_rate ?? row.deviation_rate);
  db.prepare(`
    UPDATE deviation_settlements SET plant_code=?, plant_name=?, week_date=?, scheduled_mwh=?, actual_mwh=?,
      deviation_mwh=?, deviation_rate=?, deviation_amount=?, notes=?, status='CALCULATED', updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.plant_code ?? row.plant_code, b.plant_name ?? row.plant_name, b.week_date ?? row.week_date,
    Number(b.scheduled_mwh ?? row.scheduled_mwh) || 0, Number(b.actual_mwh ?? row.actual_mwh) || 0,
    deviation_mwh,
    row.source === 'NRPC_DSA' ? null : (Number(b.deviation_rate ?? row.deviation_rate) || 0),
    deviation_amount,
    b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id, details: b });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// No separate submit step (decided 17-Oct-2026): a statement-backed week is
// raised straight from CALCULATED, and the bill it makes goes through approval.

// Dispatch — creates SUPPLEMENTARY invoice + links invoice_id on DSM
const dispatchHandler = (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  // Each desk works its own stations' weeks on every step, not only when one
  // is raised: the Hydro and Thermal desks could edit, bill and delete a
  // solar plant's week (Hydro QA run 11).
  { const no = outsideDesk(req.user, db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id)); if (no) return res.status(403).json({ error: no }); }
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'Cancelled deviation cannot be dispatched' });
  if (row.status === 'DISPATCHED' && row.invoice_id) {
    return res.status(400).json({ error: 'Already dispatched with a linked invoice', invoice_id: row.invoice_id, invoice_no: row.invoice_no });
  }
  if (!['CALCULATED', 'SUBMITTED'].includes(row.status) && !(row.status === 'DISPATCHED' && !row.invoice_id)) {
    return res.status(400).json({ error: `A week that is ${String(row.status).toLowerCase()} cannot be billed` });
  }
  if (row.dsa_account_id) {
    const acct = db.prepare('SELECT status FROM nrpc_dsa_accounts WHERE id = ?').get(row.dsa_account_id);
    if (acct?.status === 'SUPERSEDED') {
      return res.status(400).json({ error: 'The statement behind this row has been superseded. Import the current statement for this week and raise the bill from that.' });
    }
  }
  // An estimate must not become a bill. A manual row is priced by multiplying a
  // deviation by a rate, and NRPC prices each 15-minute block against the grid
  // frequency in it — so the figure is not the settlement, and on some weeks not
  // even its direction. Estimates exist so finance can book a provision while
  // the statement is still a week and a half away; invoicing a beneficiary off
  // one is a different thing entirely.
  if (row.source !== 'NRPC_DSA') {
    return res.status(400).json({
      error: 'This row is a manual estimate, not the published settlement, so it cannot be '
        + 'billed. Import the NRPC Deviation Settlement Account for this week and raise the '
        + 'bill from that.',
      source: row.source,
    });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Earlier bills for the same week (from statements this one revises). A bill
  // nobody has been given yet is withdrawn and this one stands in its place; one
  // already presented stays, and only the difference is billed. Dispatching R1
  // billed its whole figure again, so the week was settled twice.
  const earlier = row.dsa_account_id ? db.prepare(`
    SELECT d.id AS row_id, d.dsm_no, i.id, i.invoice_no, i.total_amount, i.direction, i.status
    FROM deviation_settlements d
    JOIN nrpc_dsa_accounts a ON a.id = d.dsa_account_id
    JOIN nrpc_dsa_accounts mine ON mine.id = ?
    JOIN invoices i ON i.id = d.invoice_id
    WHERE d.contract_id = ? AND d.id <> ? AND d.status = 'DISPATCHED' AND d.week_no = ?
      AND a.financial_year = mine.financial_year AND i.status <> 'CANCELLED'
  `).all(row.dsa_account_id, row.contract_id, row.id, row.week_no) : [];
  const unpresented = earlier.filter((e) => ['DRAFT', 'SUBMITTED', 'PENDING_L2', 'UNDER_APPROVAL', 'REJECTED'].includes(e.status));
  const prior = earlier.filter((e) => !unpresented.includes(e));
  const amount = Math.round(Number(row.deviation_amount) || 0) - prior.reduce((t, p) => t + dsmSigned(p), 0);
  // A week first billed years late is outside the limitation period for a
  // money claim (decided 17-Oct-2026: 3 years, dsm_bill_age_limit_days). A
  // revision of a week already billed is still settled whatever its age.
  if (!earlier.length) {
    const weekEnd = row.dsa_account_id
      ? db.prepare('SELECT week_end FROM nrpc_dsa_accounts WHERE id = ?').get(row.dsa_account_id)?.week_end
      : null;
    const limit = getParamNumber('dsm_bill_age_limit_days', 1095);
    const end = weekEnd || (row.period_month ? `${row.period_month}-28` : null);
    if (end && limit > 0 && (Date.now() - Date.parse(`${String(end).slice(0, 10)}T00:00:00Z`)) / 86400000 > limit) {
      return res.status(400).json({
        error: `This week ended on ${String(end).slice(0, 10)}, more than ${Math.round(limit / 365)} years ago, and was never billed. A claim that old is time-barred; it is not raised now.`,
        week_end: String(end).slice(0, 10),
      });
    }
  }
  if (amount === 0) {
    return res.status(400).json({
      error: prior.length
        ? `Nothing more to bill: ${prior.map((p) => p.invoice_no).join(', ')} already settle${prior.length === 1 ? 's' : ''} this week at the revised figure.`
        : 'Cannot dispatch DSM with zero deviation amount',
    });
  }

  const wantedNo = String(req.body.invoice_no || '').trim();
  if (wantedNo && db.prepare('SELECT 1 FROM invoices WHERE invoice_no = ?').get(wantedNo)) {
    return res.status(409).json({ error: `Invoice number ${wantedNo} is already on record. Use a different number, or leave it blank to have one assigned.` });
  }
  const billDate = String(req.body.dispatch_date || '').trim();
  if (billDate && !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
    return res.status(400).json({ error: 'dispatch_date must be a date (YYYY-MM-DD)' });
  }

  try {
    const result = db.transaction(() => {
      for (const u of unpresented) {
        db.prepare(`UPDATE invoices SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = datetime('now'), cancelled_by = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(`Superseded by revised NRPC statement (${row.dsm_no})`, req.user.name, u.id);
        db.prepare(`UPDATE deviation_settlements SET status = 'CANCELLED', notes = COALESCE(notes || ' · ', '') || ?, updated_at = datetime('now') WHERE id = ?`)
          .run(`Bill ${u.invoice_no} withdrawn — superseded by ${row.dsm_no}`, u.row_id);
      }
      return createDsmInvoice(row, contract, {
        invoice_no: wantedNo || null,
        dispatch_date: req.body.dispatch_date || null,
        created_by: req.user.name,
        created_by_id: req.user.id || null,
        prior,
      });
    })();
    const { invoice_no, dispatch_date, amount: amt } = result;
    logAudit({
      req, user: req.user, action: 'DISPATCH', module: 'REIA', entityType: 'deviation_settlement',
      entityId: req.params.id,
      details: { invoice_no, dispatch_date, amount: amt },
    });
    pushNotification({
      role: 'REIA_USER',
      type: 'DSM_DISPATCHED',
      message: `DSM bill ${invoice_no} dispatched (${row.dsm_no}) — REIA supplementary invoice created`,
    });
    res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
  } catch (err) {
    console.error('DSM dispatch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch DSM and create invoice' });
  }
};
router.post('/:id/dispatch', requireRole(...WRITE), dispatchHandler);

/**
 * Backfill: create linked SUPPLEMENTARY invoice for a legacy DISPATCHED DSM
 * that has invoice_no but no invoice_id.
 */
router.post('/:id/link-invoice', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  // Each desk works its own stations' weeks on every step, not only when one
  // is raised: the Hydro and Thermal desks could edit, bill and delete a
  // solar plant's week (Hydro QA run 11).
  { const no = outsideDesk(req.user, db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id)); if (no) return res.status(403).json({ error: no }); }
  if (row.invoice_id) {
    return res.status(400).json({ error: 'DSM already linked to an invoice', invoice_id: row.invoice_id, invoice_no: row.invoice_no });
  }
  if (row.status !== 'DISPATCHED') {
    return res.status(400).json({ error: 'link-invoice is for DISPATCHED rows without invoice_id; use /dispatch for SUBMITTED' });
  }
  const amount = Math.round(Number(row.deviation_amount) || 0);
  if (amount === 0) {
    return res.status(400).json({ error: 'Cannot create invoice for zero deviation amount' });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  try {
    const { invoice_no, dispatch_date, amount: amt } = createDsmInvoice(row, contract, {
      invoice_no: req.body.invoice_no || row.invoice_no || null,
      dispatch_date: req.body.dispatch_date || row.dispatch_date || null,
      created_by: req.user.name,
      created_by_id: req.user.id || null,
    });
    logAudit({
      req, user: req.user, action: 'LINK_INVOICE', module: 'REIA', entityType: 'deviation_settlement',
      entityId: req.params.id,
      details: { invoice_no, dispatch_date, amount: amt },
    });
    pushNotification({
      role: 'REIA_USER',
      type: 'DSM_INVOICE_LINKED',
      message: `DSM ${row.dsm_no} linked to supplementary invoice ${invoice_no}`,
    });
    res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
  } catch (err) {
    console.error('DSM link-invoice failed:', err);
    res.status(500).json({ error: err.message || 'Failed to link DSM invoice' });
  }
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  // Each desk works its own stations' weeks on every step, not only when one
  // is raised: the Hydro and Thermal desks could edit, bill and delete a
  // solar plant's week (Hydro QA run 11).
  { const no = outsideDesk(req.user, db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id)); if (no) return res.status(403).json({ error: no }); }
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be deleted' });
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'This week is already deleted' });
  db.prepare(`UPDATE deviation_settlements SET status='CANCELLED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id });
  res.json({ ok: true });
});


export default router;
