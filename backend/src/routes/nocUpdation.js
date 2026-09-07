import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

// NOC Updation (ERP).
//
// ISET's screen is an entry form, not a report: a standing clearance header
// (who it is for, who issued it, how long it runs) with the injection/drawal
// blocks it clears underneath. A clearance is only usable if its lines sit
// inside its own validity window, so that is checked here rather than left to
// whoever reads the register later.

const router = Router();
router.use(requireAuth);

const READ = [...ROLE_GROUPS.TRADING_ALL];
const WRITE = [...ROLE_GROUPS.TRADING_WRITE];

const DIRECTIONS = ['INJECTION', 'DRAWAL'];
const SOURCES = ['CONVENTIONAL', 'RENEWABLE', 'HYDRO', 'SOLAR', 'WIND'];

export const ISSUING_AUTHORITIES = [
  'NRLDC', 'WRLDC', 'SRLDC', 'ERLDC', 'NERLDC',
  'HPSLDC', 'PSLDC', 'HSLDC', 'RSLDC', 'UPSLDC', 'UKSLDC', 'DSLDC',
  'GSLDC', 'MSLDC', 'MPSLDC', 'CSLDC', 'GJSLDC',
];

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

/** Reference data the form needs: the authority list and the clients to pick from. */
router.get('/meta', requireRole(...READ), (req, res) => {
  let clients = [];
  try {
    clients = db.prepare(`
      SELECT id, name AS client_name, noar_id FROM trading_clients
      WHERE status = 'ACTIVE' ORDER BY name
    `).all();
  } catch {
    clients = [];
  }
  res.json({
    issuing_authorities: ISSUING_AUTHORITIES,
    directions: DIRECTIONS,
    energy_sources: SOURCES,
    clients,
  });
});

/** The clearance register, newest validity first. */
router.get('/', requireRole(...READ), (req, res) => {
  const { client_id, status, q } = req.query;
  let sql = 'SELECT * FROM noc_updations WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(String(client_id)); }
  if (status) { sql += ' AND status = ?'; params.push(String(status).toUpperCase()); }
  if (q) {
    sql += ' AND (client_name LIKE ? OR noc_reference_no LIKE ? OR noar_id LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY noc_valid_from DESC, created_at DESC';
  const rows = db.prepare(sql).all(...params);
  const counts = db.prepare(`
    SELECT noc_id, COUNT(*) AS n, SUM(quantum_mw) AS mw
    FROM noc_updation_orders GROUP BY noc_id
  `).all();
  const byId = new Map(counts.map((c) => [c.noc_id, c]));
  res.json(rows.map((r) => ({
    ...r,
    order_count: byId.get(r.id)?.n || 0,
    total_quantum_mw: byId.get(r.id)?.mw || 0,
  })));
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const noc = db.prepare('SELECT * FROM noc_updations WHERE id = ?').get(req.params.id);
  if (!noc) return res.status(404).json({ error: 'NOC not found' });
  noc.orders = db.prepare('SELECT * FROM noc_updation_orders WHERE noc_id = ? ORDER BY line_no').all(noc.id);
  res.json(noc);
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const {
    client_name, client_id, noar_id, issuing_authority, noc_reference_no,
    noc_valid_from, noc_valid_to, orders,
  } = req.body || {};

  const missing = ['client_name', 'client_id', 'noar_id', 'issuing_authority', 'noc_reference_no', 'noc_valid_from', 'noc_valid_to']
    .filter((k) => !req.body?.[k]);
  if (missing.length) return res.status(400).json({ error: `Required: ${missing.join(', ')}` });
  if (!isDate(noc_valid_from) || !isDate(noc_valid_to)) {
    return res.status(400).json({ error: 'NOC validity dates must be YYYY-MM-DD' });
  }
  if (noc_valid_to < noc_valid_from) {
    return res.status(400).json({ error: 'NOC Validity To Date cannot be before the From Date' });
  }
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'At least one order line is required' });
  }

  const lines = [];
  for (let i = 0; i < orders.length; i += 1) {
    const o = orders[i] || {};
    const at = `order line ${i + 1}`;
    const direction = String(o.direction || 'INJECTION').toUpperCase();
    const source = String(o.energy_source || 'CONVENTIONAL').toUpperCase();
    if (!DIRECTIONS.includes(direction)) return res.status(400).json({ error: `${at}: direction must be one of ${DIRECTIONS.join(', ')}` });
    if (!SOURCES.includes(source)) return res.status(400).json({ error: `${at}: energy_source must be one of ${SOURCES.join(', ')}` });
    if (!isDate(o.valid_from) || !isDate(o.valid_to)) return res.status(400).json({ error: `${at}: validity dates must be YYYY-MM-DD` });
    if (o.valid_to < o.valid_from) return res.status(400).json({ error: `${at}: To date cannot be before the From date` });
    // A line outside the NOC's own window is a clearance nobody issued.
    if (o.valid_from < noc_valid_from || o.valid_to > noc_valid_to) {
      return res.status(400).json({ error: `${at}: validity must sit inside the NOC validity ${noc_valid_from} to ${noc_valid_to}` });
    }
    if (!isTime(o.hour_from) || !isTime(o.hour_to)) return res.status(400).json({ error: `${at}: hours must be HH:MM` });
    if (o.hour_to <= o.hour_from) return res.status(400).json({ error: `${at}: To hour must be after the From hour` });
    const mw = Number(o.quantum_mw);
    if (!Number.isFinite(mw) || mw <= 0) return res.status(400).json({ error: `${at}: quantum (MW) must be a positive number` });
    lines.push({ direction, source, ...o, quantum_mw: mw, line_no: i + 1 });
  }

  const id = newId('NOC');
  const insertNoc = db.prepare(`
    INSERT INTO noc_updations (id, client_name, client_id, noar_id, issuing_authority,
      noc_reference_no, noc_valid_from, noc_valid_to, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `);
  const insertLine = db.prepare(`
    INSERT INTO noc_updation_orders (id, noc_id, line_no, direction, energy_source,
      valid_from, valid_to, hour_from, hour_to, quantum_mw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insertNoc.run(id, client_name, client_id, noar_id, issuing_authority,
      noc_reference_no, noc_valid_from, noc_valid_to, req.user?.username || req.user?.id || null);
    for (const l of lines) {
      insertLine.run(newId('NOCL'), id, l.line_no, l.direction, l.source,
        l.valid_from, l.valid_to, l.hour_from, l.hour_to, l.quantum_mw);
    }
  })();

  logAudit({
    req, user: req.user, action: 'CREATE_NOC_UPDATION', module: 'TRADING',
    entityType: 'noc_updations', entityId: id, details: { noc_reference_no, lines: lines.length },
  });

  const created = db.prepare('SELECT * FROM noc_updations WHERE id = ?').get(id);
  created.orders = db.prepare('SELECT * FROM noc_updation_orders WHERE noc_id = ? ORDER BY line_no').all(id);
  res.status(201).json(created);
});

/** Cancelling leaves the record and its lines in place — the register is evidence. */
router.patch('/:id/cancel', requireRole(...WRITE), (req, res) => {
  const noc = db.prepare('SELECT * FROM noc_updations WHERE id = ?').get(req.params.id);
  if (!noc) return res.status(404).json({ error: 'NOC not found' });
  if (noc.status === 'CANCELLED') return res.status(400).json({ error: 'This NOC is already cancelled' });
  db.prepare("UPDATE noc_updations SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?").run(noc.id);
  logAudit({
    req, user: req.user, action: 'CANCEL_NOC_UPDATION', module: 'TRADING',
    entityType: 'noc_updations', entityId: noc.id, reason: req.body?.reason,
  });
  res.json(db.prepare('SELECT * FROM noc_updations WHERE id = ?').get(noc.id));
});

export default router;
