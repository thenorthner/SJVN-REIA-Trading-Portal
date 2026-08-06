import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { importTradingLedger } from '../services/ledgerImporter.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: 'uploads/' });
const IMPORT_WRITE = [...ROLE_GROUPS.TRADING_WRITE];

// Default location of the ledger workbook shipped with the repo docs.
const DEFAULT_LEDGER = path.resolve(process.cwd(), '../docs/Power Trading Ledger FY 2026-27 (13).xlsx');

// Import the Power Trading Ledger. Accepts an uploaded .xlsx (field "file"), or
// falls back to the workbook in docs/ when no file is supplied. Idempotent — a
// re-run skips buyers/deals/TDS rows already present.
router.post('/trading-ledger', requireRole(...IMPORT_WRITE), upload.single('file'), (req, res) => {
  const filePath = req.file ? req.file.path : DEFAULT_LEDGER;
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: `Ledger file not found at ${filePath}. Upload one as "file".` });
  }
  try {
    const report = importTradingLedger(filePath);
    logAudit({ req, user: req.user, action: 'IMPORT_LEDGER', module: 'TRADING', entityType: 'trading_ledger', entityId: 'ledger', details: report });
    res.json({ ok: true, source: req.file ? req.file.originalname : 'docs default', report });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

export default router;
