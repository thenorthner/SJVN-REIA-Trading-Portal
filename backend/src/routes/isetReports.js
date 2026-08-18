import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { PENDING_REPORT_CATALOG, ALL_PENDING_KINDS, pendingReportRows } from '../data/pendingReportCatalog.js';

const router = Router();
router.use(requireAuth);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '../data/isetReportSeeds.json');

const CORE_KINDS = [
  'api-details',
  'registration',
  'registration-category',
  'noar-approvals',
  'nrldc-refund',
  'nrldc-refund-latest',
  'compensation-reconciliation',
  'tds-format',
  'daily-schedule',
  'implemented-schedule',
  'implemented-block-wise',
  'outstanding-dues',
  'bilateral-contracts',
];

const KINDS = [...CORE_KINDS, ...ALL_PENDING_KINDS];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtIsetDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`;
}

function bilateralContractRows(q) {
  let sql = `
    SELECT * FROM bilateral_transactions
    WHERE loa_no IS NOT NULL AND TRIM(loa_no) != ''
  `;
  const params = [];
  if (q) {
    sql += ` AND (
      loa_no LIKE ? OR supplier_name LIKE ? OR procurer_name LIKE ?
      OR supplier_sldc LIKE ? OR procurer_sldc LIKE ? OR counterparty LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY start_date DESC, created_at DESC';
  return db.prepare(sql).all(...params).map((tx) => {
    const maxQ = Number(tx.quantum_mw);
    const rate = tx.tariff_per_unit != null ? Number(tx.tariff_per_unit) : null;
    return {
      id: tx.id,
      loa_no: tx.loa_no || tx.loi_contract_ref || '',
      seller_name: tx.supplier_name || '',
      seller_state: tx.supplier_sldc || '',
      buyer_name: tx.procurer_name || '',
      buyer_state: tx.procurer_sldc || '',
      start_date: fmtIsetDate(tx.start_date),
      end_date: fmtIsetDate(tx.end_date),
      max_quantum_mw: Number.isFinite(maxQ) && maxQ > 0 ? maxQ : '',
      rate_kwh: Number.isFinite(rate) && rate > 0 ? rate : '',
      trading_margin: tx.trading_margin_per_unit != null ? Number(tx.trading_margin_per_unit) : '',
    };
  });
}

function matchesQuery(row, q, keys) {
  if (!q) return true;
  const needle = String(q).toLowerCase();
  return keys.some((k) => String(row[k] ?? '').toLowerCase().includes(needle));
}

const BLOCK_HOURS = 0.25;

/** 15-minute label `00:00-00:15` → ISET block 1..96. */
export function timeBlockNumber(label) {
  const raw = String(label || '').trim();
  const start = raw.split('-')[0] || '';
  const m = start.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const mins = Number(m[1]) * 60 + Number(m[2]);
    if (mins >= 0 && mins < 24 * 60 && mins % 15 === 0) return mins / 15 + 1;
  }
  const n = Number(raw.replace(/^B/i, ''));
  if (Number.isFinite(n) && n >= 1 && n <= 96) return n;
  return raw;
}

function implementedMw(row) {
  if (row.actual_mw != null && Number.isFinite(Number(row.actual_mw))) return Number(row.actual_mw);
  return Number(row.approved_mw || 0) - Number(row.curtailed_mw || 0);
}

function punchedSchedules() {
  return db.prepare(`
    SELECT
      s.id, s.transaction_id, s.schedule_date, s.time_block,
      s.approved_mw, s.curtailed_mw, s.actual_mw, s.status,
      t.loa_no, t.loi_contract_ref, t.ppa_no, t.supplier_name, t.procurer_name,
      t.supplier_sldc, t.procurer_sldc, t.noar_contract_no, t.counterparty
    FROM bilateral_schedules s
    JOIN bilateral_transactions t ON t.id = s.transaction_id
    WHERE s.status != 'CANCELLED'
    ORDER BY s.schedule_date DESC, s.time_block
  `).all();
}

/** Desk-punched 15-min blocks rolled to the Daily Schedule Report shape. */
export function dailyScheduleFromPunches() {
  const groups = new Map();
  for (const row of punchedSchedules()) {
    const key = `${row.transaction_id}|${row.schedule_date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `DS-${row.transaction_id}-${row.schedule_date}`,
        buyer_contract: row.loa_no || row.ppa_no || row.procurer_name || '',
        seller_contract: row.loi_contract_ref || row.ppa_no || row.supplier_name || '',
        delivery_from: row.schedule_date,
        delivery_to: row.schedule_date,
        seller_availability: 0,
        buyer_request: 0,
        remarks: row.loa_no ? `Punched ${row.loa_no}` : 'Punched bilateral schedule',
        source: 'bilateral_schedules',
      });
    }
    const g = groups.get(key);
    const mwh = Number(row.approved_mw || 0) * BLOCK_HOURS;
    g.seller_availability += mwh;
    g.buyer_request += mwh;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    seller_availability: Number(g.seller_availability.toFixed(4)),
    buyer_request: Number(g.buyer_request.toFixed(4)),
  }));
}

export function implementedSummaryFromPunches() {
  const groups = new Map();
  for (const row of punchedSchedules()) {
    const key = `${row.transaction_id}|${row.schedule_date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `IS-${row.transaction_id}-${row.schedule_date}`,
        reading_date: row.schedule_date,
        seller_name: row.supplier_name || row.counterparty || '',
        buyer_name: row.procurer_name || '',
        seller_schedule_mwh: 0,
        buyer_schedule_mwh: 0,
        source: 'bilateral_schedules',
      });
    }
    const g = groups.get(key);
    const mwh = implementedMw(row) * BLOCK_HOURS;
    g.seller_schedule_mwh += mwh;
    g.buyer_schedule_mwh += mwh;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    seller_schedule_mwh: Number(g.seller_schedule_mwh.toFixed(4)),
    buyer_schedule_mwh: Number(g.buyer_schedule_mwh.toFixed(4)),
  }));
}

export function implementedBlockWiseFromPunches() {
  return punchedSchedules().map((row) => {
    const mw = Number(implementedMw(row).toFixed(4));
    return {
      id: row.id,
      seller_name: row.supplier_name || row.counterparty || '',
      seller_state: row.supplier_sldc || '',
      buyer_name: row.procurer_name || '',
      buyer_state: row.procurer_sldc || '',
      trader_name: 'SJVN',
      reading_date: row.schedule_date,
      time_block: timeBlockNumber(row.time_block),
      seller_schedule_mw: mw,
      buyer_schedule_mw: mw,
      schedule_type: row.status,
      approval_no: row.noar_contract_no || row.loa_no || '',
      source: 'bilateral_schedules',
    };
  });
}

function listKind(kind, q) {
  switch (kind) {
    // Served from the Bill of Supply register rather than the pending-report
    // catalog's sample rows, now that the entry screen actually keeps what it
    // is given.
    case 'supply-bill-report': {
      let sql = "SELECT * FROM bill_of_supply WHERE status != 'CANCELLED'";
      const params = [];
      if (q) {
        sql += ' AND (bill_no LIKE ? OR client_name LIKE ?)';
        params.push(`%${q}%`, `%${q}%`);
      }
      sql += ' ORDER BY invoice_date DESC, created_at DESC';
      return db.prepare(sql).all(...params).map((r) => ({
        id: r.id,
        bill_no: r.bill_no,
        client_name: r.client_name,
        bill_date: r.invoice_date,
        supply_from: r.supply_from_date,
        supply_to: r.supply_to_date,
        energy_mwh: r.quantity,
        amount_rs: r.amount_after_rebate,
        status: r.status,
      }));
    }
    case 'api-details':
      return db.prepare('SELECT id, name, link, fetched_upto FROM cea_api_catalog ORDER BY sort_order, name').all();
    case 'registration':
      return db.prepare(`
        SELECT id, client_name, reference_no, short_name, registered_company_name,
               unit_address, company_address, state, category_name
        FROM client_registrations ORDER BY client_name
      `).all();
    case 'registration-category': {
      const stats = db.prepare('SELECT category_name, count FROM registration_category_stats ORDER BY count DESC').all();
      if (stats.length) return stats.map((r, i) => ({ id: `cat-${i}`, ...r }));
      return db.prepare(`
        SELECT category_name, COUNT(*) AS count
        FROM client_registrations GROUP BY category_name ORDER BY count DESC
      `).all().map((r, i) => ({ id: `cat-${i}`, ...r }));
    }
    case 'noar-approvals':
      return db.prepare(`
        SELECT id, application_no, applicant_name, seller_name, buyer_name,
               from_date, to_date, applied_capacity_mwh, approved_capacity_mwh,
               approval_no, approval_date
        FROM noar_approval_entries ORDER BY approval_date DESC, application_no
      `).all();
    case 'nrldc-refund':
      return db.prepare(`
        SELECT id, application_id, approval_no, from_date, to_date, applicant,
               refund_mwh_curtailment, refund_amt_curtailment, refund_amt_waiver,
               refund_reason, net_payable, received, refund_from_rldc, rldc
        FROM nrldc_refunds WHERE is_latest = 0
        ORDER BY from_date DESC, application_id
      `).all();
    case 'nrldc-refund-latest':
      return db.prepare(`
        SELECT id, application_id, approval_no, from_date, to_date, applicant,
               refund_amt_waiver, refund_reason, net_payable, received, refund_from_rldc, rldc
        FROM nrldc_refunds WHERE is_latest = 1
        ORDER BY from_date DESC, application_id
      `).all();
    case 'compensation-reconciliation':
      return db.prepare('SELECT * FROM compensation_reconciliation ORDER BY delivery_date DESC').all();
    case 'tds-format':
      return db.prepare('SELECT * FROM tds_format_entries ORDER BY application_no').all();
    case 'daily-schedule': {
      const punched = dailyScheduleFromPunches();
      const keyed = new Set(punched.map((r) => `${r.buyer_contract}|${r.seller_contract}|${r.delivery_from}`));
      const manual = db.prepare('SELECT * FROM daily_schedule_entries ORDER BY delivery_from, buyer_contract').all()
        .filter((r) => !keyed.has(`${r.buyer_contract}|${r.seller_contract}|${r.delivery_from}`))
        .map((r) => ({ ...r, source: 'daily_schedule_entries' }));
      const rows = [...punched, ...manual];
      return q
        ? rows.filter((r) => matchesQuery(r, q, ['buyer_contract', 'seller_contract', 'remarks', 'delivery_from']))
        : rows;
    }
    case 'implemented-schedule': {
      const rows = implementedSummaryFromPunches();
      return q
        ? rows.filter((r) => matchesQuery(r, q, ['seller_name', 'buyer_name', 'reading_date']))
        : rows;
    }
    case 'implemented-block-wise': {
      const rows = implementedBlockWiseFromPunches();
      return q
        ? rows.filter((r) => matchesQuery(r, q, ['seller_name', 'buyer_name', 'seller_state', 'buyer_state', 'approval_no', 'reading_date']))
        : rows;
    }
    case 'outstanding-dues':
      return db.prepare(`
        SELECT id, client_name, bill_type, bill_date, bill_due_date,
               bill_amount, amount_paid, outstanding_amount
        FROM outstanding_dues ORDER BY bill_date DESC
      `).all();
    case 'bilateral-contracts':
      return bilateralContractRows(q);
    default: {
      if (!ALL_PENDING_KINDS.includes(kind)) return null;
      return db.prepare(`
        SELECT id, payload_json FROM generic_report_entries
        WHERE report_kind = ? ORDER BY sort_order ASC, id ASC
      `).all(kind).map((r) => {
        let data = {};
        try { data = JSON.parse(r.payload_json || '{}'); } catch { /* ignore */ }
        return { id: r.id, ...data };
      });
    }
  }
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const catalogs = {};
  for (const kind of ALL_PENDING_KINDS) {
    const c = PENDING_REPORT_CATALOG[kind];
    catalogs[kind] = { title: c.title, columns: c.columns, showSr: c.showSr !== false };
  }
  res.json({ kinds: KINDS, source: 'typed-tables', catalogs });
});

router.get('/:kind', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const kind = req.params.kind;
  if (!KINDS.includes(kind)) {
    return res.status(404).json({ error: `Unknown report kind: ${kind}` });
  }
  const rows = listKind(kind, req.query.q);
  res.json(rows || []);
});

router.post('/daily-schedule', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];
  if (!String(b.buyer_contract || '').trim()) errors.push('buyer_contract is required');
  if (!String(b.seller_contract || '').trim()) errors.push('seller_contract is required');
  if (!String(b.delivery_from || '').trim()) errors.push('delivery_from is required');
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('DSC');
  db.prepare(`
    INSERT INTO daily_schedule_entries (
      id, buyer_contract, seller_contract, delivery_from, delivery_to,
      seller_availability, buyer_request, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(b.buyer_contract).trim(),
    String(b.seller_contract).trim(),
    String(b.delivery_from).trim(),
    b.delivery_to ? String(b.delivery_to).trim() : '',
    b.seller_availability != null && b.seller_availability !== '' ? Number(b.seller_availability) : null,
    b.buyer_request != null && b.buyer_request !== '' ? Number(b.buyer_request) : null,
    b.remarks || '',
  );
  res.status(201).json(db.prepare('SELECT * FROM daily_schedule_entries WHERE id = ?').get(id));
});

function n(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function seedIfEmpty(table, countSql, insertFn) {
  const c = db.prepare(countSql).get().c;
  if (c > 0) return false;
  insertFn();
  return true;
}

export function seedIsetReports() {
  let seed;
  try {
    seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  } catch (err) {
    console.warn('[ISET Reports] seed file missing:', err.message);
    return;
  }

  seedIfEmpty('cea_api_catalog', 'SELECT COUNT(*) AS c FROM cea_api_catalog', () => {
    const ins = db.prepare(`
      INSERT INTO cea_api_catalog (id, name, link, fetched_upto, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    (seed['api-details'] || []).forEach((r, i) => {
      ins.run(newId('CEA'), r.name, r.link, r.fetched_upto || '', i + 1);
    });
  });

  seedIfEmpty('client_registrations', 'SELECT COUNT(*) AS c FROM client_registrations', () => {
    const ins = db.prepare(`
      INSERT INTO client_registrations (
        id, client_name, reference_no, short_name, registered_company_name,
        unit_address, company_address, state, category_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed.registration || []) {
      ins.run(
        newId('CRG'), r.client_name, r.reference_no, r.short_name || '',
        r.registered_company_name || '', r.unit_address || '', r.company_address || '',
        r.state || '', r.category_name || '',
      );
    }
  });

  seedIfEmpty('registration_category_stats', 'SELECT COUNT(*) AS c FROM registration_category_stats', () => {
    const ins = db.prepare('INSERT INTO registration_category_stats (category_name, count) VALUES (?, ?)');
    for (const r of seed['registration-category'] || []) {
      ins.run(r.category_name, n(r.count));
    }
  });

  seedIfEmpty('noar_approval_entries', 'SELECT COUNT(*) AS c FROM noar_approval_entries', () => {
    const ins = db.prepare(`
      INSERT INTO noar_approval_entries (
        id, application_no, applicant_name, seller_name, buyer_name,
        from_date, to_date, applied_capacity_mwh, approved_capacity_mwh,
        approval_no, approval_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['noar-approvals'] || []) {
      ins.run(
        newId('NAR'), r.application_no, r.applicant_name || '', r.seller_name || '', r.buyer_name || '',
        r.from_date || '', r.to_date || '', n(r.applied_capacity_mwh), n(r.approved_capacity_mwh),
        r.approval_no || '', r.approval_date || '',
      );
    }
  });

  seedIfEmpty('nrldc_refunds', 'SELECT COUNT(*) AS c FROM nrldc_refunds', () => {
    const ins = db.prepare(`
      INSERT INTO nrldc_refunds (
        id, application_id, approval_no, from_date, to_date, applicant,
        refund_mwh_curtailment, refund_amt_curtailment, refund_amt_waiver,
        refund_reason, net_payable, received, refund_from_rldc, rldc, is_latest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['nrldc-refund'] || []) {
      ins.run(
        newId('NRF'), r.application_id, r.approval_no || '', r.from_date || '', r.to_date || '',
        r.applicant || 'SJVN Limited', n(r.refund_mwh_curtailment), n(r.refund_amt_curtailment),
        n(r.refund_amt_waiver), r.refund_reason || '', n(r.net_payable), n(r.received),
        n(r.refund_from_rldc), r.rldc || 'NRLDC', 0,
      );
    }
    for (const r of seed['nrldc-refund-latest'] || []) {
      ins.run(
        newId('NRF'), r.application_id, r.approval_no || '', r.from_date || '', r.to_date || '',
        r.applicant || 'SJVN Limited', 0, 0, n(r.refund_amt_waiver), r.refund_reason || '',
        n(r.net_payable), n(r.received), n(r.refund_from_rldc), r.rldc || 'NRLDC', 1,
      );
    }
  });

  // compensation stays empty unless seed has rows
  seedIfEmpty('compensation_reconciliation', 'SELECT COUNT(*) AS c FROM compensation_reconciliation', () => {
    const ins = db.prepare(`
      INSERT INTO compensation_reconciliation (
        id, delivery_date, purchase_contract, purchase_contracted_mwh, scheduled_availability_mwh,
        purchase_default_mwh, purchase_default_pct, purchase_compensation,
        sale_contract, sale_contracted_mwh, scheduled_requisition_mwh,
        sale_default_mwh, sale_default_pct, sale_compensation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['compensation-reconciliation'] || []) {
      ins.run(
        newId('CMP'), r.delivery_date || '', r.purchase_contract || '',
        n(r.purchase_contracted_mwh, null), n(r.scheduled_availability_mwh, null),
        n(r.purchase_default_mwh, null), n(r.purchase_default_pct, null), n(r.purchase_compensation, null),
        r.sale_contract || '', n(r.sale_contracted_mwh, null), n(r.scheduled_requisition_mwh, null),
        n(r.sale_default_mwh, null), n(r.sale_default_pct, null), n(r.sale_compensation, null),
      );
    }
  });

  seedIfEmpty('tds_format_entries', 'SELECT COUNT(*) AS c FROM tds_format_entries', () => {
    const ins = db.prepare(`
      INSERT INTO tds_format_entries (
        id, nodal_rldc, application_no, noar_fee, approval_no,
        stoa_posoco, stoa_ctu, stoa_seller_stu, stoa_buyer_stu, stoa_seller_sldc, stoa_buyer_sldc, total_stoa,
        payment_date, vendor_posoco, pan_posoco, tds_posoco, vendor_ctu, pan_ctu, tds_ctu,
        vendor_seller_sldc, name_seller_sldc, pan_seller_sldc, tds_seller_sldc,
        vendor_seller_stu, name_seller_stu, pan_seller_stu, tds_seller_stu,
        vendor_buyer_sldc, name_buyer_sldc, pan_buyer_sldc, tds_buyer_sldc,
        vendor_buyer_stu, name_buyer_stu, pan_buyer_stu, tds_buyer_stu,
        total_tds, net_payment, actual_stoa_paid, actual_tds_paid
      ) VALUES (
        ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?
      )
    `);
    for (const r of seed['tds-format'] || []) {
      ins.run(
        newId('TDS'), r.nodal_rldc || '', r.application_no || '', n(r.noar_fee, null), r.approval_no || '',
        n(r.stoa_posoco, null), n(r.stoa_ctu, null), n(r.stoa_seller_stu, null), n(r.stoa_buyer_stu, null),
        n(r.stoa_seller_sldc, null), n(r.stoa_buyer_sldc, null), n(r.total_stoa, null),
        r.payment_date || '', r.vendor_posoco || '', r.pan_posoco || '', n(r.tds_posoco, null),
        r.vendor_ctu || '', r.pan_ctu || '', n(r.tds_ctu, null),
        r.vendor_seller_sldc || '', r.name_seller_sldc || '', r.pan_seller_sldc || '', n(r.tds_seller_sldc, null),
        r.vendor_seller_stu || '', r.name_seller_stu || '', r.pan_seller_stu || '', n(r.tds_seller_stu, null),
        r.vendor_buyer_sldc || '', r.name_buyer_sldc || '', r.pan_buyer_sldc || '', n(r.tds_buyer_sldc, null),
        r.vendor_buyer_stu || '', r.name_buyer_stu || '', r.pan_buyer_stu || '', n(r.tds_buyer_stu, null),
        n(r.total_tds, null), n(r.net_payment, null), n(r.actual_stoa_paid, null), n(r.actual_tds_paid, null),
      );
    }
  });

  seedIfEmpty('daily_schedule_entries', 'SELECT COUNT(*) AS c FROM daily_schedule_entries', () => {
    const ins = db.prepare(`
      INSERT INTO daily_schedule_entries (
        id, buyer_contract, seller_contract, delivery_from, delivery_to,
        seller_availability, buyer_request, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['daily-schedule'] || []) {
      ins.run(
        newId('DSC'), r.buyer_contract || '', r.seller_contract || '',
        r.delivery_from || '', r.delivery_to || '',
        n(r.seller_availability, null), n(r.buyer_request, null), r.remarks || '',
      );
    }
  });

  seedIfEmpty('implemented_schedule_summary', 'SELECT COUNT(*) AS c FROM implemented_schedule_summary', () => {
    const ins = db.prepare(`
      INSERT INTO implemented_schedule_summary (
        id, reading_date, seller_name, buyer_name, seller_schedule_mwh, buyer_schedule_mwh
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['implemented-schedule'] || []) {
      ins.run(
        newId('IMS'), r.reading_date || '', r.seller_name || '', r.buyer_name || '',
        n(r.seller_schedule_mwh, null), n(r.buyer_schedule_mwh, null),
      );
    }
  });

  seedIfEmpty('implemented_schedule_blocks', 'SELECT COUNT(*) AS c FROM implemented_schedule_blocks', () => {
    const ins = db.prepare(`
      INSERT INTO implemented_schedule_blocks (
        id, seller_name, seller_state, buyer_name, buyer_state, trader_name,
        reading_date, time_block, seller_schedule_mw, buyer_schedule_mw, schedule_type, approval_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['implemented-block-wise'] || []) {
      ins.run(
        newId('ISB'), r.seller_name || '', r.seller_state || '', r.buyer_name || '', r.buyer_state || '',
        r.trader_name || '', r.reading_date || '', n(r.time_block, null),
        n(r.seller_schedule_mw, null), n(r.buyer_schedule_mw, null),
        r.schedule_type || '', r.approval_no || '',
      );
    }
  });

  seedIfEmpty('outstanding_dues', 'SELECT COUNT(*) AS c FROM outstanding_dues', () => {
    const ins = db.prepare(`
      INSERT INTO outstanding_dues (
        id, client_name, bill_type, bill_date, bill_due_date,
        bill_amount, amount_paid, outstanding_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of seed['outstanding-dues'] || []) {
      ins.run(
        newId('ODU'), r.client_name, r.bill_type || '', r.bill_date || '', r.bill_due_date || '',
        n(r.bill_amount), n(r.amount_paid), n(r.outstanding_amount),
      );
    }
  });

  // Remaining pending screens (CERC / CEA / ERP / extra reports)
  const insGeneric = db.prepare(`
    INSERT INTO generic_report_entries (id, report_kind, sort_order, payload_json)
    VALUES (?, ?, ?, ?)
  `);
  const countGeneric = db.prepare('SELECT COUNT(*) AS c FROM generic_report_entries WHERE report_kind = ?');
  const txGeneric = db.transaction(() => {
    for (const kind of ALL_PENDING_KINDS) {
      if (countGeneric.get(kind).c > 0) continue;
      pendingReportRows(kind).forEach((row, idx) => {
        insGeneric.run(newId('GRE'), kind, idx + 1, JSON.stringify(row));
      });
    }
  });
  txGeneric();
}

export default router;
