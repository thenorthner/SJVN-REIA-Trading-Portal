import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, buildBillingFamilyRef, directionForContract } from '../util.js';
import { getParamNumber } from '../mastersService.js';
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

function resolveEnergyBfr(contractId, periodMonth, dataType) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) return null;
  const bfr = buildBillingFamilyRef(contract.contract_no, periodMonth, directionForContract(contract));
  let supersedes = null;
  if (dataType === 'FINAL') {
    const prov = db.prepare(`
      SELECT id FROM energy_data
      WHERE contract_id = ? AND period_month = ? AND data_type = 'PROVISIONAL'
      ORDER BY created_at ASC LIMIT 1
    `).get(contractId, periodMonth);
    if (prov) supersedes = prov.id;
  }
  return { bfr, supersedes, contract };
}

router.get('/', (req, res) => {
  const { contract_id, period_month, status } = req.query;
  let sql = `SELECT ed.*, c.contract_no FROM energy_data ed JOIN contracts c ON c.id = ed.contract_id WHERE 1=1`;
  const params = [];
  
  const side = counterpartySide(req.user);
  if (side === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (side === 'BUYER') {
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
  const dataType = b.data_type || 'PROVISIONAL';
  const resolved = resolveEnergyBfr(b.contract_id, b.period_month, dataType);
  if (!resolved) return res.status(400).json({ error: 'Contract not found' });

  const id = newId('ENG');
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status, billing_family_ref, supersedes_energy_id)
    VALUES (@id, @contract_id, @period_month, @data_type, @source, @energy_mwh, @cuf_percent, @availability_percent, 'DRAFT', @billing_family_ref, @supersedes_energy_id)
  `).run({
    id,
    contract_id: b.contract_id,
    period_month: b.period_month,
    data_type: dataType,
    source: b.source || 'MANUAL',
    energy_mwh: b.energy_mwh,
    cuf_percent: b.cuf_percent ?? null,
    availability_percent: b.availability_percent ?? null,
    billing_family_ref: resolved.bfr,
    supersedes_energy_id: resolved.supersedes,
  });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'energy_data', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(id));
});

// Validate against contract parameters (simple deviation check demo)
router.post('/:id/validate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  
  let baseCuf = getParamNumber('solar_base_cuf_pct', 22) / 100;
  if (contract.project_type === 'Wind') baseCuf = getParamNumber('wind_base_cuf_pct', 30) / 100;
  if (contract.project_type === 'Hydro') baseCuf = getParamNumber('hydro_base_cuf_pct', 65) / 100;
  
  const expected = contract.capacity_mw * 24 * 30 * baseCuf;
  const deviationPct = Math.abs(row.energy_mwh - expected) / expected * 100;
  
  const tolerance = contract.project_type === 'Hydro'
    ? getParamNumber('hydro_validate_tolerance_pct', 80)
    : getParamNumber('energy_validate_tolerance_pct', 30);
  const flagged = deviationPct > tolerance;
  
  db.prepare(`UPDATE energy_data SET status = ?, deviation_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(flagged ? 'DISPUTED' : 'VALIDATED', `Deviation ${deviationPct.toFixed(1)}% vs expected ${expected.toFixed(0)} MWh (${(baseCuf * 100).toFixed(0)}% CUF) - Tolerance: ${tolerance}%`, row.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'VALIDATE', module: 'REIA', entityType: 'energy_data', entityId: row.id, details: { deviationPct } });
  res.json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id));
});

// Freeze / lock — keeps data_type intact (provisional history must survive for BFR trail)
router.post('/:id/lock', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  if (row.status === 'LOCKED') return res.status(400).json({ error: 'Already locked' });

  // Ensure BFR / supersedes links exist
  if (!row.billing_family_ref || (row.data_type === 'FINAL' && !row.supersedes_energy_id)) {
    const resolved = resolveEnergyBfr(row.contract_id, row.period_month, row.data_type);
    if (resolved) {
      db.prepare(`
        UPDATE energy_data
        SET billing_family_ref = COALESCE(NULLIF(billing_family_ref, ''), ?),
            supersedes_energy_id = COALESCE(supersedes_energy_id, ?),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(resolved.bfr, resolved.supersedes, row.id);
    }
  }

  db.prepare(`UPDATE energy_data SET status = 'LOCKED', updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'LOCK', module: 'REIA', entityType: 'energy_data', entityId: row.id, details: { data_type: row.data_type } });

  // FINAL lock → re-run reconciliation from provisional basis if one exists
  if (row.data_type === 'FINAL') {
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
