/** L4: Finance's TDS-to-Form-16A reconciliation register. */
import { Router } from 'express';
import XLSX from 'xlsx';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { tdsRecon, markTdsRecon } from '../services/tdsRecon.js';

const router = Router();
router.use(requireAuth);
const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
// Finance marks TDS (Target #2 Phase B: the administrators transact nothing).
const WRITE = ['FINANCE_USER'];
const fyOf = (q) => (q.fy && /^\d{4}-\d{2}$/.test(q.fy) ? q.fy : null);

router.get('/', requireRole(...READ), (req, res) => res.json(tdsRecon({ fy: fyOf(req.query) })));

router.get('/export.xlsx', requireRole(...READ), (req, res) => {
  const r = tdsRecon({ fy: fyOf(req.query) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Counterparty', 'Who withheld', 'FY', 'Quarter', 'TDS 194Q', 'TDS 194C', 'TDS other', 'TDS withheld', 'Form 16A no.', '16A amount', 'Difference', '16A due', 'State', 'Reconciliation', 'Note'],
    ...r.rows.map((x) => [x.entity_name, x.party_side === 'BUYER' ? 'Buyer (on SJVN)' : 'SJVN (on developer)', x.financial_year, x.quarter,
      x.by_section['194Q'] || 0, x.by_section['194C'] || 0, Object.entries(x.by_section).filter(([k]) => !['194Q', '194C'].includes(k)).reduce((a, [, v]) => a + v, 0),
      x.deducted, x.certificate?.certificate_no || '', x.certificate?.amount ?? '', x.difference ?? '', x.certificate_due, x.state, x.recon_status || '', x.recon_note || '']),
  ]), 'TDS vs 16A');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tds-16a-reconciliation${r.fy ? `-${r.fy}` : ''}.xlsx"`);
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

router.post('/mark', requireRole(...WRITE), (req, res) => {
  try { res.json(markTdsRecon(req.body || {}, req.user, req)); } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

export default router;
