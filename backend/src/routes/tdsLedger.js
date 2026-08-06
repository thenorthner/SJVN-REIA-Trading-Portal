import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { seedTdsVendors, listVendors, recordTds, recordChallan, pendingByVendor, summary } from '../services/tdsLedger.js';

const router = Router();
router.use(requireAuth);

const TDS_READ = [...ROLE_GROUPS.TRADING_ALL];
const TDS_WRITE = [...ROLE_GROUPS.TRADING_WRITE, 'FINANCE_USER'];

seedTdsVendors();

// Vendor master (CTUIL, GRID-INDIA, STUs, SLDCs) with PANs.
router.get('/vendors', requireRole(...TDS_READ), (req, res) => {
  res.json(listVendors());
});

// Deduction register. Filters: ?status=DEDUCTED|DEPOSITED &vendor= &period=YYYY-MM
router.get('/', requireRole(...TDS_READ), (req, res) => {
  const { status, vendor, period } = req.query;
  let sql = 'SELECT * FROM tds_ledger WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (vendor) { sql += ' AND vendor_name = ?'; params.push(vendor); }
  if (period) { sql += ' AND period = ?'; params.push(period); }
  sql += ' ORDER BY deducted_date DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Outstanding TDS still to be deposited, grouped by vendor.
router.get('/pending', requireRole(...TDS_READ), (req, res) => {
  const rows = pendingByVendor();
  const total = rows.reduce((s, r) => s + (r.tds_pending || 0), 0);
  res.json({ total_pending: Math.round(total * 100) / 100, vendors: rows });
});

// Form-26Q-style rollup by vendor/PAN/section. Optional ?period=YYYY-MM.
router.get('/summary', requireRole(...TDS_READ), (req, res) => {
  res.json(summary(req.query.period || null));
});

// Record a TDS deduction.
router.post('/', requireRole(...TDS_WRITE), (req, res) => {
  const { vendor_name, vendor_id, section, rate, taxable_amount, reference_type, reference_no, period, deducted_date, note } = req.body;
  if (!vendor_name && !vendor_id) return res.status(400).json({ error: 'vendor_name or vendor_id is required' });
  if (taxable_amount == null) return res.status(400).json({ error: 'taxable_amount is required' });
  try {
    const row = recordTds({
      vendorName: vendor_name, vendorId: vendor_id, section, rate,
      taxableAmount: taxable_amount, referenceType: reference_type, referenceNo: reference_no,
      period, deductedDate: deducted_date, note, createdBy: req.user?.id,
    });
    logAudit({ req, user: req.user, action: 'RECORD_TDS', module: 'TRADING', entityType: 'tds_ledger', entityId: row.id, details: req.body });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Record the challan (deposit with the government) against a deduction.
router.post('/:id/challan', requireRole(...TDS_WRITE), (req, res) => {
  const { challan_no, challan_date, paid_to_govt_date } = req.body;
  if (!challan_no) return res.status(400).json({ error: 'challan_no is required' });
  const row = recordChallan(req.params.id, { challanNo: challan_no, challanDate: challan_date, paidToGovtDate: paid_to_govt_date });
  if (!row) return res.status(404).json({ error: 'TDS entry not found' });
  logAudit({ req, user: req.user, action: 'RECORD_CHALLAN', module: 'TRADING', entityType: 'tds_ledger', entityId: row.id, details: req.body });
  res.json(row);
});

export default router;
