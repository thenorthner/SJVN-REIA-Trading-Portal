import { Router } from 'express';
import { requireRole, ROLE_GROUPS, SELLER_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { catalogFor, facetsFor, runReport, listTemplates, saveTemplate, retireTemplate } from '../services/reiaReports.js';
import { reportCsv, reportXlsx } from '../services/reiaReportExport.js';
import { generateReiaReportPdf } from '../scripts/reiaReportPdf.js';
import { logAudit } from '../util.js';

// REIA Reports tab: the predefined reports and the custom report builder,
// mounted at /api/reports/reia. The datasets, their columns and their filters
// are declared in services/reiaReports.js; a request names keys from those
// lists and the service refuses anything else. Counterparties reach the same
// API and are scoped to their own entity there, not here.
const router = Router();

const READERS = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR', ...SELLER_ROLES, ...BUYER_ROLES])];

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[REIA reports]', err);
  if (!res.headersSent) res.status(status).json({ error: err.message || 'The report could not be prepared' });
};

function specFrom(req) {
  const raw = req.query.spec;
  if (!raw) throw Object.assign(new Error('Say which report to run'), { status: 400 });
  try {
    return JSON.parse(String(raw));
  } catch {
    throw Object.assign(new Error('The report request could not be read'), { status: 400 });
  }
}

const slug = (s) => String(s || 'report').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

router.get('/catalog', requireRole(...READERS), (req, res) => {
  try {
    const cat = catalogFor(req.user);
    if (!cat) return res.status(403).json({ error: 'Reports are not available to your role' });
    res.json(cat);
  } catch (err) { fail(res, err); }
});

router.get('/facets', requireRole(...READERS), (req, res) => {
  try {
    res.json(facetsFor(String(req.query.dataset || ''), req.user));
  } catch (err) { fail(res, err); }
});

/**
 * GET /api/reports/reia/run?spec=<json>&format=json|csv|xlsx|pdf
 *
 * The spec is { dataset, columns, filters: [{ key, op, value }], group_by,
 * sort: [{ key, dir }], summary }. JSON answers the screen; the other three
 * are the same report as a download, and each download is recorded.
 */
router.get('/run', requireRole(...READERS), (req, res) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'format must be json, csv, xlsx or pdf' });
    const report = runReport(specFrom(req), req.user);
    if (format === 'json') return res.json(report);

    const file = `SJVN_REIA_${slug(report.title)}_${report.generated_at.slice(0, 10)}.${format}`;
    logAudit({
      req, user: req.user, action: 'REPORT_EXPORTED', module: 'REPORTS', entityType: 'report', entityId: report.dataset,
      details: { format, rows: report.count, criteria: report.criteria },
    });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(reportCsv(report));
    }
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(reportXlsx(report));
    }
    return generateReiaReportPdf(report, res, file);
  } catch (err) { fail(res, err); }
});

router.get('/templates', requireRole(...READERS), (req, res) => {
  try {
    res.json(listTemplates(req.user));
  } catch (err) { fail(res, err); }
});

// A saved layout is the user's own (like an alert preference), not a transaction.
router.post('/templates', requireRole(...READERS), (req, res) => {
  try {
    const out = saveTemplate(req.user, req.body || {});
    res.status(out.replaced ? 200 : 201).json(out);
  } catch (err) { fail(res, err); }
});

router.delete('/templates/:id', requireRole(...READERS), (req, res) => {
  try {
    res.json(retireTemplate(req.user, req.params.id));
  } catch (err) { fail(res, err); }
});

export default router;
