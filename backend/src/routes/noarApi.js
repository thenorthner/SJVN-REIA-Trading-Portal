/**
 * NOAR Trader API — pull and reconcile SJVN's bilateral open-access
 * applications as the registry holds them. See services/noarTraderService.js
 * for what the API is and why nothing here writes noar_status.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  getNoarTraderConfig,
  syncBilateralApplications,
  differencesFor,
  NOAR_HOSTS,
} from '../services/noarTraderService.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const hydrate = (row) => (row ? {
  ...row,
  is_rejected: !!row.is_rejected,
  is_alternate_route_enabled: !!row.is_alternate_route_enabled,
  approved_summary: JSON.parse(row.approved_summary_json || '[]'),
  applied_summary: JSON.parse(row.applied_summary_json || '[]'),
} : row);

/** Configuration and whether the pull would go live or run against the stub. */
router.get('/status', requireRole(...READ), (_req, res) => {
  const cfg = getNoarTraderConfig();
  const last = db.prepare('SELECT MAX(synced_at) AS at, COUNT(*) AS rows FROM noar_api_applications').get();
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    environment: cfg.environment,
    base_url: cfg.baseUrl,
    known_hosts: NOAR_HOSTS,
    api_key_set: !!cfg.apiKey,
    api_secret_set: !!cfg.apiSecret,
    trader_name: cfg.traderName || null,
    timeout_ms: cfg.timeoutMs,
    mode: cfg.live ? cfg.environment : 'STUB',
    last_synced_at: last?.at || null,
    applications_held: last?.rows || 0,
    note: cfg.live
      ? null
      : 'Running in stub mode — set noar_api_enabled plus NOAR_API_KEY and NOAR_API_SECRET (generated from the NOAR portal under API Integration) to pull live data. NOAR also whitelists the caller\'s public IP.',
  });
});

/**
 * Pull a date range from NOAR. Read-only against the registry, and it does not
 * move any transaction's noar_status — it reports where the two disagree.
 */
router.post('/sync', requireRole(...WRITE), async (req, res) => {
  const fromDate = String(req.body?.from_date || '').trim();
  const toDate = String(req.body?.to_date || '').trim();
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    return res.status(400).json({ error: 'from_date and to_date (YYYY-MM-DD) are required' });
  }
  const includeRejected = req.body?.include_rejected !== false;
  const dryRun = !!req.body?.dry_run;

  try {
    const result = await syncBilateralApplications({ fromDate, toDate, includeRejected, dryRun });
    if (!result.ok) return res.status(502).json(result);
    if (!dryRun) {
      secureLogAudit(req, {
        action: 'NOAR_API_SYNC',
        module: 'TRADING',
        entityType: 'noar_api_application',
        entityId: `${fromDate}..${toDate}`,
        details: {
          mode: result.mode,
          received: result.applications_received,
          matched: result.matched,
          unmatched: result.unmatched,
          differences: result.differences.length,
        },
      });
    }
    res.json(result);
  } catch (err) {
    console.error('NOAR Trader API sync error:', err);
    res.status(500).json({ error: err.message || 'NOAR sync failed' });
  }
});

/** Everything pulled, newest delivery window first. */
router.get('/applications', requireRole(...READ), (req, res) => {
  const { application_no, approval_no, transaction_id, from_date, to_date } = req.query;
  let sql = 'SELECT * FROM noar_api_applications WHERE 1=1';
  const params = [];
  if (application_no) { sql += ' AND application_no = ?'; params.push(application_no); }
  if (approval_no) { sql += ' AND approval_no = ?'; params.push(approval_no); }
  if (transaction_id) { sql += ' AND transaction_id = ?'; params.push(transaction_id); }
  if (from_date) {
    if (!DATE_RE.test(from_date)) return res.status(400).json({ error: 'from_date must be YYYY-MM-DD' });
    sql += ' AND to_date >= ?'; params.push(from_date);
  }
  if (to_date) {
    if (!DATE_RE.test(to_date)) return res.status(400).json({ error: 'to_date must be YYYY-MM-DD' });
    sql += ' AND from_date <= ?'; params.push(to_date);
  }
  if (req.query.unmatched === 'true') sql += ' AND transaction_id IS NULL';
  sql += ' ORDER BY from_date DESC, application_no, revision_no DESC';
  res.json(db.prepare(sql).all(...params).map(hydrate));
});

/** One application, every revision NOAR has issued, and the deal it belongs to. */
router.get('/applications/:applicationNo', requireRole(...READ), (req, res) => {
  const applicationNo = String(req.params.applicationNo || '').trim();
  const revisions = db.prepare(
    'SELECT * FROM noar_api_applications WHERE application_no = ? ORDER BY revision_no DESC',
  ).all(applicationNo).map(hydrate);
  if (!revisions.length) {
    return res.status(404).json({ error: `NOAR has not returned application ${applicationNo} to this platform` });
  }
  const latest = revisions[0];
  const tx = latest.transaction_id
    ? db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(latest.transaction_id)
    : null;
  res.json({
    application_no: applicationNo,
    latest,
    revisions,
    transaction: tx,
    differences: differencesFor(latest, tx),
  });
});

/**
 * Where NOAR and the platform disagree, across everything pulled so far.
 * Computed on read from the stored rows, so it reflects any status the desk has
 * corrected since the last sync without needing another call to NOAR.
 */
router.get('/reconciliation', requireRole(...READ), (_req, res) => {
  // Only the newest revision of each application is compared; an older
  // revision has been superseded at NOAR and disagreeing with it means nothing.
  const rows = db.prepare(`
    SELECT a.* FROM noar_api_applications a
    JOIN (
      SELECT application_no, MAX(revision_no) AS rev
      FROM noar_api_applications GROUP BY application_no
    ) latest ON latest.application_no = a.application_no AND latest.rev = a.revision_no
    ORDER BY a.from_date DESC, a.application_no
  `).all().map(hydrate);

  const items = [];
  for (const row of rows) {
    const tx = row.transaction_id
      ? db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(row.transaction_id)
      : null;
    const differences = differencesFor(row, tx);
    if (!differences.length) continue;
    items.push({
      application_no: row.application_no,
      revision_no: row.revision_no,
      approval_no: row.approval_no,
      seller_name: row.seller_name,
      buyer_name: row.buyer_name,
      from_date: row.from_date,
      to_date: row.to_date,
      transaction_id: row.transaction_id,
      counterparty: tx?.counterparty || null,
      platform_status: tx?.noar_status || null,
      synced_at: row.synced_at,
      differences,
    });
  }

  const byKind = {};
  for (const item of items) {
    for (const d of item.differences) byKind[d.kind] = (byKind[d.kind] || 0) + 1;
  }

  res.json({
    applications_compared: rows.length,
    applications_with_differences: items.length,
    by_kind: byKind,
    items,
  });
});

export default router;
