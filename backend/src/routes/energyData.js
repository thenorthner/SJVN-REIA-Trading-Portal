import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { runFinalDataRecon } from './reconciliation.js';
import multer from 'multer';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: 'temp/' });

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { contract_id, period_month, status } = req.query;
  let sql = `SELECT ed.*, c.contract_no FROM energy_data ed JOIN contracts c ON c.id = ed.contract_id WHERE 1=1`;
  const params = [];
  
  if (req.user.role === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }
  
  if (contract_id) { sql += ' AND ed.contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND ed.period_month = ?'; params.push(period_month); }
  if (status) { sql += ' AND ed.status = ?'; params.push(status); }
  sql += ' ORDER BY ed.period_month DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/parse-rea', requireRole(...ROLE_GROUPS.REIA_WRITE), upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded' });
  }

  const pdfPath = req.file.path;
  const scriptPath = path.join(__dirname, '../scripts/parse_rea.py');

  exec(`python3 "${scriptPath}" "${pdfPath}"`, (error, stdout, stderr) => {
    // cleanup temp file
    fs.unlink(pdfPath, () => {});

    if (error) {
      console.error('REA parsing error:', stderr || error);
      return res.status(500).json({ error: 'Failed to parse REA PDF' });
    }

    try {
      const result = JSON.parse(stdout);
      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Failed to parse REA PDF' });
      }
      res.json(result.data);
    } catch (parseErr) {
      console.error('Invalid JSON from script:', stdout);
      res.status(500).json({ error: 'Invalid output from parser script' });
    }
  });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('ENG');
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status)
    VALUES (@id, @contract_id, @period_month, @data_type, @source, @energy_mwh, @cuf_percent, @availability_percent, 'DRAFT')
  `).run({
    id,
    contract_id: b.contract_id,
    period_month: b.period_month,
    data_type: b.data_type || 'PROVISIONAL',
    source: b.source || 'MANUAL',
    energy_mwh: b.energy_mwh,
    cuf_percent: b.cuf_percent ?? null,
    availability_percent: b.availability_percent ?? null,
  });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'energy_data', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(id));
});

// Validate against contract parameters (simple deviation check demo)
router.post('/:id/validate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  
  let baseCuf = 0.22;
  if (contract.project_type === 'Wind') baseCuf = 0.30;
  if (contract.project_type === 'Hydro') baseCuf = 0.65;
  
  const expected = contract.capacity_mw * 24 * 30 * baseCuf;
  const deviationPct = Math.abs(row.energy_mwh - expected) / expected * 100;
  
  // Hydro has extreme seasonality (monsoon vs winter)
  const tolerance = contract.project_type === 'Hydro' ? 80 : 30;
  const flagged = deviationPct > tolerance;
  
  db.prepare(`UPDATE energy_data SET status = ?, deviation_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(flagged ? 'DISPUTED' : 'VALIDATED', `Deviation ${deviationPct.toFixed(1)}% vs expected ${expected.toFixed(0)} MWh (${(baseCuf * 100).toFixed(0)}% CUF) - Tolerance: ${tolerance}%`, row.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'VALIDATE', module: 'REIA', entityType: 'energy_data', entityId: row.id, details: { deviationPct } });
  res.json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id));
});

// Freeze / lock post-finalization
router.post('/:id/lock', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  if (row.status === 'LOCKED') return res.status(400).json({ error: 'Already locked' });
  db.prepare(`UPDATE energy_data SET status = 'LOCKED', data_type = 'FINAL', updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'LOCK', module: 'REIA', entityType: 'energy_data', entityId: row.id });

  // If a provisional recon existed for this period, auto-trigger FINAL re-recon
  try {
    const hadProv = db.prepare(`
      SELECT id FROM reconciliations
      WHERE contract_id = ? AND period = ? AND data_basis = 'PROVISIONAL'
      LIMIT 1
    `).get(row.contract_id, row.period_month);
    if (hadProv) {
      runFinalDataRecon(row.contract_id, row.period_month, req.user);
      pushNotification({
        role: 'REIA_USER',
        type: 'RECONCILIATION',
        message: `Final-data reconciliation triggered for ${row.period_month} after energy lock`,
      });
    }
  } catch (err) {
    console.error('Final recon trigger failed', err.message);
  }

  res.json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id));
});

// ──────────────────────────────────────────────
// REA Automation Endpoints
// ──────────────────────────────────────────────
import { reaScraper } from '../services/reaScraper.js';
import { RPC_SOURCES } from '../config/rpcSources.js';

// GET /rea-status — Dashboard status per RPC
router.get('/rea-status', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  try {
    const status = reaScraper.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /rea-log — Full fetch audit log
router.get('/rea-log', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  try {
    const log = reaScraper.getFetchLog({
      rpc_source: req.query.rpc_source,
      status: req.query.status,
    });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rea-trigger — Manually trigger scrape
router.post('/rea-trigger', requireRole('SJVN_ADMIN', 'REIA_USER'), async (req, res) => {
  const { rpc, period_month, data_type } = req.body;
  
  if (!rpc || !period_month) {
    return res.status(400).json({ error: 'rpc and period_month are required' });
  }
  
  if (!RPC_SOURCES[rpc]) {
    return res.status(400).json({ error: `Unknown RPC source: ${rpc}. Valid: ${Object.keys(RPC_SOURCES).join(', ')}` });
  }

  try {
    const result = await reaScraper.triggerManual(rpc, period_month, data_type || 'PROVISIONAL');
    logAudit({ req, user: req.user, action: 'REA_TRIGGER', module: 'REIA', entityType: 'rea_fetch_log', entityId: result.logId, details: { rpc, period_month } });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /rea-scan — Trigger full scan for all RPCs (or one specific RPC)
router.post('/rea-scan', requireRole('SJVN_ADMIN'), async (req, res) => {
  const { rpc } = req.body;
  
  try {
    let results;
    if (rpc) {
      results = [await reaScraper.runFullCycle(rpc)];
    } else {
      results = await reaScraper.runAllSources();
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
