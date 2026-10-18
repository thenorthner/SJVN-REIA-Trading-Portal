/**
 * The counterparty's side of the energy record.
 *
 * routes/energyData.js is where SJVN enters, validates and locks a period's
 * energy. This is what the seller or buyer whose energy it is can do with it:
 *
 *   see it      as a trend — energy and CUF month on month — and, for one
 *               period, the document it was taken from and its 15-minute blocks;
 *   answer it   accept the figure, or object to it with the figure they hold.
 *               An acceptance is the record that both sides agreed before the
 *               bill; an objection stops the period being locked unnoticed.
 *
 * A counterparty reads and answers its own contracts' records only.
 */
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification, billableCapacityMw } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { contractVisibleTo, PRESENTED_STATUSES } from '../services/counterpartyScope.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// SJVN staff read every station's energy; the Hydro and Thermal desks' own
// dashboards read their stations' REA here and were refused (Hydro QA run 16).
const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, 'COMPLIANCE_AUDITOR'])];
const canManage = (user) => ROLE_GROUPS.REIA_WRITE.includes(user?.role);
const sideOf = (user) => counterpartySide(user) || (INTERNAL_READ.includes(user?.role) ? 'SJVN' : null);

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[ENERGY]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, id, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'ENERGY', entityType: 'energy_data', entityId: id, ...extra }); } catch (err) { console.error('[ENERGY] audit failed', err.message); }
};

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKS_PER_DAY = 96;
const hoursIn = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() * 24; };
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
/** "00:15-00:30" for block 2. */
const blockLabel = (n) => {
  const t = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return `${t((n - 1) * 15)}-${t(n * 15 === 1440 ? 1440 : n * 15)}`.replace('24:00', '24:00');
};

/** The record and its contract, if the caller may see them. */
function recordFor(user, id) {
  const side = sideOf(user);
  const row = side && db.prepare('SELECT * FROM energy_data WHERE id = ?').get(id);
  const contract = row && db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (!contract || !contractVisibleTo(user, contract)) throw fail(404, 'Energy record not found');
  return { row, contract, side };
}

/** The contracts whose energy the caller may see. */
function contractsFor(user, contractId) {
  const side = sideOf(user);
  if (!side) throw fail(403, 'Access denied');
  let sql = 'SELECT * FROM contracts WHERE 1 = 1';
  const params = [];
  if (side !== 'SJVN') {
    if (!user.linked_entity_id) return { side, contracts: [] };
    // Same as the list: a contract still being drafted is not shown to the counterparty.
    sql += ` AND ${side === 'SELLER' ? 'seller_id' : 'buyer_id'} = ? AND status NOT IN ('DRAFT', 'UNDER_NEGOTIATION')`;
    params.push(user.linked_entity_id);
  }
  if (contractId) { sql += ' AND id = ?'; params.push(contractId); }
  return { side, contracts: db.prepare(sql).all(...params) };
}

/** CUF for a period: the recorded one, or worked out from the energy and the capacity commissioned. */
function cufOf(row, contract) {
  if (row.cuf_percent != null) return { cuf: round(row.cuf_percent), computed: false };
  const mw = billableCapacityMw(contract);
  if (!(mw > 0) || !MONTH.test(row.period_month)) return { cuf: null, computed: false };
  return { cuf: round((row.energy_mwh / (mw * hoursIn(row.period_month))) * 100), computed: true };
}

/**
 * Of a period's records, the one that stands: the locked figure (the one billed),
 * else a validated one; final over provisional; then the latest. Picking the
 * latest of any status put an unvalidated draft — or a disputed figure — at the
 * head of the counterparty's trend in place of what was billed.
 */
const STANDING_RANK = { LOCKED: 3, VALIDATED: 2, DISPUTED: 1, DRAFT: 0 };
const standing = (rows) => [...rows].sort((a, b) => (STANDING_RANK[b.status] ?? 0) - (STANDING_RANK[a.status] ?? 0)
  || (b.data_type === 'FINAL') - (a.data_type === 'FINAL')
  || String(b.created_at).localeCompare(String(a.created_at)))[0];

const notifyCounterparty = (contract, message) => {
  try {
    for (const entityId of [contract.seller_id, contract.buyer_id].filter(Boolean)) {
      for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId)) {
        pushNotification({ userId: u.id, type: 'ENERGY_DATA', message });
      }
    }
  } catch { /* the bell is a courtesy */ }
};
const notifyDesk = (message) => {
  try { for (const role of ROLE_GROUPS.REIA_WRITE) pushNotification({ role, type: 'ENERGY_DATA', message }); } catch { /* as above */ }
};

/** Called by the validate route: a period is ready for the counterparty to confirm. */
export function announceValidated(row) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (contract) notifyCounterparty(contract, `${contract.contract_no}: energy for ${row.period_month} (${row.energy_mwh} MWh) is ready for your confirmation under Energy Data.`);
}

// GET /analytics?contract_id=&months=24 — month on month, with the numbers that sum it up.
router.get('/analytics', (req, res) => send(res, () => {
  const { side, contracts } = contractsFor(req.user, req.query.contract_id);
  const months = Math.min(Math.max(Number(req.query.months) || 24, 1), 120);
  // When aggregating across all contracts, do not double-count back-to-back PSAs
  // whose energy is already accounted for in the parent PPA.
  const effectiveContracts = req.query.contract_id
    ? contracts
    : contracts.filter((c) => c.contract_type === 'PPA' || !db.prepare('SELECT 1 FROM contract_allocations WHERE psa_id = ?').get(c.id));
  const byId = new Map(effectiveContracts.map((c) => [c.id, c]));
  if (!effectiveContracts.length) return { series: [], totals: null, contracts: [] };

  // A counterparty's trend is built from figures SJVN has finished with.
  const rows = db.prepare(`
    SELECT * FROM energy_data WHERE contract_id IN (${effectiveContracts.map(() => '?').join(',')})
    ${side === 'SJVN' ? '' : "AND status != 'DRAFT'"}
  `).all(...effectiveContracts.map((c) => c.id));

  // One standing record per contract per period, then the periods summed across contracts.
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.contract_id}|${r.period_month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const perPeriod = new Map();
  let awaiting = 0;
  for (const list of groups.values()) {
    const r = standing(list);
    const c = byId.get(r.contract_id);
    const mw = billableCapacityMw(c);
    const p = perPeriod.get(r.period_month) || { period: r.period_month, energy_mwh: 0, capacity_hours: 0, provisional: false, min_cuf: null };
    p.energy_mwh += Number(r.energy_mwh) || 0;
    if (mw > 0 && MONTH.test(r.period_month)) p.capacity_hours += mw * hoursIn(r.period_month);
    if (r.data_type !== 'FINAL') p.provisional = true;
    if (c.min_cuf_percent != null) p.min_cuf = Math.max(p.min_cuf ?? 0, Number(c.min_cuf_percent));
    // A single contract's own recorded CUF is kept as it was recorded.
    if (contracts.length === 1 && r.cuf_percent != null) p.recorded_cuf = Number(r.cuf_percent);
    perPeriod.set(r.period_month, p);
    // Asked for while the period is validated and not yet locked for billing; a period
    // locked long ago can still be answered, but is not chased.
    if (side !== 'SJVN' && !r.response_status && r.status === 'VALIDATED') awaiting += 1;
  }
  const series = [...perPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-months).map((p) => {
    const cuf = p.recorded_cuf ?? (p.capacity_hours > 0 ? (p.energy_mwh / p.capacity_hours) * 100 : null);
    return {
      period: p.period, energy_mwh: round(p.energy_mwh, 3), cuf_percent: round(cuf), min_cuf_percent: p.min_cuf,
      provisional: p.provisional, below_min: p.min_cuf != null && cuf != null && cuf < p.min_cuf,
    };
  });

  const last12 = series.slice(-12);
  const withCuf = last12.filter((s) => s.cuf_percent != null);
  const best = [...last12].sort((a, b) => b.energy_mwh - a.energy_mwh)[0] || null;
  return {
    series,
    totals: {
      months: last12.length,
      energy_mwh: round(last12.reduce((s, x) => s + x.energy_mwh, 0), 3),
      avg_cuf_percent: withCuf.length ? round(withCuf.reduce((s, x) => s + x.cuf_percent, 0) / withCuf.length) : null,
      best_month: best ? { period: best.period, energy_mwh: best.energy_mwh } : null,
      months_below_min: last12.filter((s) => s.below_min).length,
      awaiting_response: awaiting,
    },
    contracts: contracts.map((c) => ({ id: c.id, contract_no: c.contract_no, min_cuf_percent: c.min_cuf_percent })),
  };
}));

// GET /blocks-template — the sheet SJVN fills with a month's 15-minute blocks.
router.get('/blocks-template', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Access denied' });
  const ws = XLSX.utils.aoa_to_sheet([
    ['Date', 'Block', 'Scheduled MWh', 'Actual MWh'],
    ['2026-09-01', 1, 6.25, 6.1],
    ['2026-09-01', 2, 6.25, 6.3],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Blocks');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="energy-blocks-template.xlsx"');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

/** Everything about one record that the list does not carry. */
function detailOf(row, contract, side, user = null) {
  const siblings = db.prepare(`
    SELECT id, data_type, source, energy_mwh, cuf_percent, status, created_at FROM energy_data
    WHERE contract_id = ? AND period_month = ? ORDER BY created_at
  `).all(row.contract_id, row.period_month);
  const prov = siblings.filter((s) => s.data_type === 'PROVISIONAL').pop();
  const fin = siblings.filter((s) => s.data_type === 'FINAL').pop();

  const doc = row.source_version_id ? db.prepare(`
    SELECT v.id AS version_id, v.file_name, v.created_at, d.title, d.document_type
    FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?
  `).get(row.source_version_id) : null;
  // A regional energy account is a public document: where one was fetched for this period, say where from.
  let rea = null;
  try {
    rea = db.prepare(`
      SELECT rpc_source, pdf_url, fetched_at FROM rea_fetch_log
      WHERE period_month = ? AND data_type = ? AND pdf_url IS NOT NULL AND status IN ('PARSED','PROCESSED','DOWNLOADED')
      ORDER BY fetched_at DESC LIMIT 1
    `).get(row.period_month, row.data_type) || null;
  } catch { /* no fetch log here */ }
  if (rea && !/^REA|RPC|RLDC/i.test(String(row.source || ''))) rea = null;

  const invoice = db.prepare(`
    SELECT id, invoice_no, status, total_amount, energy_mwh FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND status IN (${PRESENTED_STATUSES.filter((s) => s !== 'CANCELLED').map(() => '?').join(',')})
    ORDER BY created_at DESC LIMIT 1
  `).get(row.contract_id, row.period_month, ...PRESENTED_STATUSES.filter((s) => s !== 'CANCELLED')) || null;

  const blocks = db.prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT block_date) AS days, COALESCE(SUM(actual_mwh), 0) AS actual, COALESCE(SUM(scheduled_mwh), 0) AS scheduled
    FROM energy_blocks WHERE contract_id = ? AND period_month = ?
  `).get(row.contract_id, row.period_month);
  const names = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);
  const { cuf, computed } = cufOf(row, contract);

  return {
    ...row,
    contract_no: contract.contract_no,
    cuf_percent: cuf,
    cuf_computed: computed,
    min_cuf_percent: contract.min_cuf_percent,
    side,
    can_manage: side === 'SJVN' && (!user || canManage(user)),
    lock_override_by: row.lock_override_by || null,
    // A locked figure nobody answered is past answering: the bill is where it is taken up.
    can_respond: side !== 'SJVN' && (['VALIDATED', 'DISPUTED'].includes(row.status) || (row.status === 'LOCKED' && row.response_status === 'OBJECTED')) && row.response_status !== 'ACCEPTED',
    response_by_name: names(row.response_by),
    objection_resolved_by_name: names(row.objection_resolved_by),
    comparison: prov && fin ? {
      provisional_mwh: prov.energy_mwh, final_mwh: fin.energy_mwh,
      difference_mwh: round(fin.energy_mwh - prov.energy_mwh, 3),
      difference_pct: prov.energy_mwh ? round(((fin.energy_mwh - prov.energy_mwh) / prov.energy_mwh) * 100) : null,
    } : null,
    source_document: doc,
    rea,
    invoice,
    blocks: { count: blocks.n, days: blocks.days, actual_mwh: round(blocks.actual, 3), scheduled_mwh: round(blocks.scheduled, 3) },
  };
}

// GET /:id — one record in full.
router.get('/:id', (req, res) => send(res, () => {
  const { row, contract, side } = recordFor(req.user, req.params.id);
  return detailOf(row, contract, side, req.user);
}));

// GET /:id/blocks?date= — the month day by day, and one day's 96 blocks.
router.get('/:id/blocks', (req, res) => send(res, () => {
  const { row } = recordFor(req.user, req.params.id);
  const days = db.prepare(`
    SELECT block_date AS date, COUNT(*) AS blocks, SUM(scheduled_mwh) AS scheduled_mwh, SUM(actual_mwh) AS actual_mwh
    FROM energy_blocks WHERE contract_id = ? AND period_month = ? GROUP BY block_date ORDER BY block_date
  `).all(row.contract_id, row.period_month).map((d) => ({
    ...d, scheduled_mwh: round(d.scheduled_mwh, 3), actual_mwh: round(d.actual_mwh, 3),
    deviation_mwh: d.scheduled_mwh != null && d.actual_mwh != null ? round(d.actual_mwh - d.scheduled_mwh, 3) : null,
  }));
  const date = DAY.test(req.query.date || '') ? req.query.date : days[0]?.date || null;
  const blocks = date ? db.prepare(`
    SELECT block_no, scheduled_mwh, actual_mwh FROM energy_blocks
    WHERE contract_id = ? AND block_date = ? ORDER BY block_no
  `).all(row.contract_id, date).map((b) => ({
    ...b, time: blockLabel(b.block_no),
    deviation_mwh: b.scheduled_mwh != null && b.actual_mwh != null ? round(b.actual_mwh - b.scheduled_mwh, 4) : null,
  })) : [];
  return { period_month: row.period_month, days, date, blocks };
}));

// GET /:id/blocks.xlsx — the whole month's blocks as a workbook.
router.get('/:id/blocks.xlsx', (req, res) => {
  try {
    const { row, contract } = recordFor(req.user, req.params.id);
    const blocks = db.prepare(`
      SELECT block_date, block_no, scheduled_mwh, actual_mwh FROM energy_blocks
      WHERE contract_id = ? AND period_month = ? ORDER BY block_date, block_no
    `).all(row.contract_id, row.period_month);
    if (!blocks.length) return res.status(404).json({ error: 'No 15-minute data has been loaded for this period' });
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Contract', contract.contract_no], ['Period', row.period_month], [],
      ['Date', 'Block', 'Time', 'Scheduled MWh', 'Actual MWh', 'Deviation MWh'],
      ...blocks.map((b) => [b.block_date, b.block_no, blockLabel(b.block_no), b.scheduled_mwh, b.actual_mwh,
        b.scheduled_mwh != null && b.actual_mwh != null ? round(b.actual_mwh - b.scheduled_mwh, 4) : null]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Blocks');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="blocks-${contract.contract_no.replace(/[^A-Za-z0-9]+/g, '_')}-${row.period_month}.xlsx"`);
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

/** A date cell as YYYY-MM-DD, whether it came as text, a JS date or a spreadsheet serial. */
function asDay(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; }
  const s = String(v ?? '').trim();
  if (DAY.test(s)) return s;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// POST /:id/blocks (file) — load a month's 15-minute blocks, replacing what was there.
router.post('/:id/blocks', upload.single('file'), (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk can load block data');
  const { row, contract } = recordFor(req.user, req.params.id);
  // The blocks behind a billed month are part of what was billed.
  if (row.status === 'LOCKED') throw fail(400, `${row.period_month} is locked for billing; its 15-minute blocks cannot be replaced.`);
  if (!req.file) throw fail(400, 'Attach the block-wise file');
  // No block can hold more than the plant makes in a quarter-hour.
  const blockMax = billableCapacityMw(contract) > 0
    ? Math.round(billableCapacityMw(contract) * 0.25 * (['HYDRO', 'PSP'].includes(String(contract.project_type || '').toUpperCase()) ? 1.1 : 1) * 10000) / 10000
    : null;
  let table;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  } catch {
    throw fail(400, 'The file could not be read as a spreadsheet or CSV');
  }
  const headAt = table.findIndex((r) => r.some((c) => /date/i.test(String(c || ''))) && r.some((c) => /block/i.test(String(c || ''))));
  if (headAt < 0) throw fail(400, 'The sheet needs a header row with Date, Block, Scheduled MWh and Actual MWh');
  const head = table[headAt].map((c) => String(c || '').toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const at = { date: col(/date/), block: col(/block/), sched: col(/sched/), actual: col(/actual|inject|meter/) };
  if (at.actual < 0 && at.sched < 0) throw fail(400, 'The sheet needs a Scheduled or an Actual column');

  const num = (v) => (v === null || v === '' ? null : Number(v));
  const parsed = [];
  const errors = [];
  const seen = new Set();
  table.slice(headAt + 1).forEach((r, i) => {
    if (!r || r.every((c) => c === null || c === '')) return;
    const line = headAt + i + 2;
    const date = asDay(r[at.date]);
    const block = Number(r[at.block]);
    const sched = at.sched >= 0 ? num(r[at.sched]) : null;
    const actual = at.actual >= 0 ? num(r[at.actual]) : null;
    if (!date) errors.push(`Row ${line}: the date is not readable`);
    else if (!date.startsWith(row.period_month)) errors.push(`Row ${line}: ${date} is not in ${row.period_month}`);
    else if (!Number.isInteger(block) || block < 1 || block > BLOCKS_PER_DAY) errors.push(`Row ${line}: block must be 1 to ${BLOCKS_PER_DAY}`);
    else if ([sched, actual].some((v) => v !== null && !Number.isFinite(v))) errors.push(`Row ${line}: the energy is not a number`);
    else if ([sched, actual].some((v) => v !== null && v < 0)) errors.push(`Row ${line}: energy cannot be negative`);
    else if (blockMax != null && [sched, actual].some((v) => v !== null && v > blockMax)) errors.push(`Row ${line}: ${Math.max(sched ?? 0, actual ?? 0)} MWh in 15 minutes is more than ${contract.contract_no} can make (${blockMax} MWh)`);
    else if (seen.has(`${date}|${block}`)) errors.push(`Row ${line}: ${date} block ${block} appears twice`);
    else { seen.add(`${date}|${block}`); parsed.push({ date, block, sched, actual }); }
  });
  if (errors.length) throw fail(400, `${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` — and ${errors.length - 5} more` : ''}. Nothing was loaded.`);
  if (!parsed.length) throw fail(400, 'The sheet has no block rows');

  db.transaction(() => {
    db.prepare('DELETE FROM energy_blocks WHERE contract_id = ? AND period_month = ?').run(row.contract_id, row.period_month);
    const ins = db.prepare(`
      INSERT INTO energy_blocks (id, contract_id, period_month, block_date, block_no, scheduled_mwh, actual_mwh, source_file, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of parsed) ins.run(newId('EBK'), row.contract_id, row.period_month, b.date, b.block, b.sched, b.actual, req.file.originalname, req.user.id);
  })();
  const total = parsed.reduce((s, b) => s + (b.actual || 0), 0);
  audit(req, 'ENERGY_BLOCKS_LOADED', row.id, { details: { file: req.file.originalname, blocks: parsed.length, actual_mwh: round(total, 3) } });
  // The blocks should add up to the month. Where they do not, the desk is told — not stopped.
  const gap = row.energy_mwh ? ((total - row.energy_mwh) / row.energy_mwh) * 100 : null;
  return {
    loaded: parsed.length, days: new Set(parsed.map((b) => b.date)).size, actual_mwh: round(total, 3), record_mwh: row.energy_mwh,
    warning: at.actual >= 0 && gap !== null && Math.abs(gap) > 1
      ? `The blocks add up to ${round(total, 3)} MWh, ${round(Math.abs(gap))}% ${gap > 0 ? 'above' : 'below'} the ${row.energy_mwh} MWh on the record for ${contract.contract_no}.` : null,
  };
}));

// POST /:id/source-document { version_id } — the JMR or REA this figure was taken from.
router.post('/:id/source-document', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk can attach the source document');
  const { row, contract, side } = recordFor(req.user, req.params.id);
  const v = db.prepare(`
    SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.contract_id = ?
  `).get(String(req.body.version_id || ''), contract.id);
  if (!v) throw fail(400, 'That file is not one of this contract\'s documents');
  db.prepare(`UPDATE energy_data SET source_version_id = ?, updated_at = datetime('now') WHERE id = ?`).run(v.id, row.id);
  audit(req, 'ENERGY_SOURCE_ATTACHED', row.id, { afterValue: { source_version_id: v.id } });
  return detailOf(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id), contract, side, req.user);
}));

// POST /:id/respond { response: ACCEPTED|OBJECTED, note, claimed_mwh, attachment_version_id }
router.post('/:id/respond', (req, res) => send(res, () => {
  const { row, contract, side } = recordFor(req.user, req.params.id);
  if (side === 'SJVN') throw fail(400, 'The figure is SJVN\'s own; it is the counterparty that accepts or objects to it');
  if (row.status === 'DRAFT') throw fail(400, 'This period is still being prepared by SJVN');
  if (row.response_status === 'ACCEPTED') throw fail(400, 'This figure has already been accepted');
  const response = String(req.body.response || '').toUpperCase();
  if (!['ACCEPTED', 'OBJECTED'].includes(response)) throw fail(400, 'response must be ACCEPTED or OBJECTED');
  const note = String(req.body.note || '').trim().slice(0, 2000);
  let claimed = null;
  let attachment = null;
  if (response === 'OBJECTED') {
    if (!note) throw fail(400, 'Say what is wrong with the figure');
    if (req.body.claimed_mwh !== undefined && req.body.claimed_mwh !== '' && req.body.claimed_mwh !== null) {
      claimed = Number(req.body.claimed_mwh);
      if (!(claimed >= 0)) throw fail(400, 'The figure you hold must be a number of MWh');
    }
    if (req.body.attachment_version_id) {
      const v = db.prepare(`SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.contract_id = ?`)
        .get(String(req.body.attachment_version_id), contract.id);
      if (!v) throw fail(400, 'The attached file is not one of this contract\'s documents');
      attachment = v.id;
    }
  }
  db.prepare(`
    UPDATE energy_data
    SET response_status = ?, response_note = ?, claimed_mwh = ?, response_version_id = ?, response_by = ?, response_at = datetime('now'),
        objection_outcome = NULL, objection_resolution = NULL, objection_resolved_by = NULL, objection_resolved_at = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(response, note || null, claimed, attachment, req.user.id, row.id);
  audit(req, response === 'ACCEPTED' ? 'ENERGY_ACCEPTED' : 'ENERGY_OBJECTED', row.id, {
    afterValue: { response, energy_mwh: row.energy_mwh, claimed_mwh: claimed }, reason: note || undefined,
  });
  notifyDesk(response === 'ACCEPTED'
    ? `${contract.contract_no}: ${req.user.name} has accepted the energy for ${row.period_month} (${row.energy_mwh} MWh).`
    : `${contract.contract_no}: ${req.user.name} objects to the energy for ${row.period_month}${claimed != null ? ` — holds ${claimed} MWh against ${row.energy_mwh}` : ''}: ${note}`);
  return detailOf(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id), contract, side, req.user);
}));

// POST /:id/resolve-objection { outcome: UPHELD|REJECTED, note } — SJVN's answer to an objection.
router.post('/:id/resolve-objection', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk can answer an objection');
  const { row, contract, side } = recordFor(req.user, req.params.id);
  if (row.response_status !== 'OBJECTED' || row.objection_outcome) throw fail(400, 'There is no open objection on this period');
  const outcome = String(req.body.outcome || '').toUpperCase();
  if (!['UPHELD', 'REJECTED'].includes(outcome)) throw fail(400, 'outcome must be UPHELD or REJECTED');
  const note = String(req.body.note || '').trim().slice(0, 2000);
  if (!note) throw fail(400, 'Give the reasons for the decision');
  db.prepare(`
    UPDATE energy_data SET objection_outcome = ?, objection_resolution = ?, objection_resolved_by = ?, objection_resolved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(outcome, note, req.user.id, row.id);
  audit(req, `ENERGY_OBJECTION_${outcome}`, row.id, { reason: note });
  notifyCounterparty(contract, outcome === 'UPHELD'
    ? `${contract.contract_no}: SJVN agrees with your objection to the energy for ${row.period_month} and will correct the record — ${note}`
    : `${contract.contract_no}: SJVN has not accepted your objection to the energy for ${row.period_month} — ${note}`);
  return detailOf(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id), contract, side, req.user);
}));

export default router;
