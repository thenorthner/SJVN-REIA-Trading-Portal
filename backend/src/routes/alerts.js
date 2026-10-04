import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { getParam } from '../mastersService.js';
import {
  BOARD_READ, BOARD_WRITE, scopeFor, activeBroadcasts, safeAll, buildBoard,
  acknowledge, unacknowledge, boardHistory, getPreferences, savePreferences,
} from '../services/alertBoard.js';
import { getClearance, clearancesNeedingAttention } from '../services/standingClearance.js';
import { tradingSessions } from '../services/recLedger.js';

const router = Router();
router.use(requireAuth);

/**
 * Compliance ticker — what the trading desk needs to see at a glance.
 *
 * Standing clearance state for the portfolio in context (or the worst state on
 * the desk when none is selected), plus the next certificate trading windows.
 *
 * Every figure here is derived. The bar this feeds used to be static JSX that
 * read "Remaining 20 Days for REC bid" and "NOC Expired" forever, regardless of
 * any record, so a renewed clearance still showed as expired and a closed
 * auction window still showed twenty days.
 */
const SEVERITY_ORDER = { EXPIRED: 0, RENEWAL_DUE: 1, NOT_ON_RECORD: 2, ACTIVE: 3 };

router.get('/compliance-ticker', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const daysFrom = (iso) => Math.round(
    (new Date(`${iso}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000
  );

  // ── Standing clearance ────────────────────────────────────────────────
  let clearance = null;
  if (req.query.portfolio_id) {
    clearance = getClearance(req.query.portfolio_id);
  } else {
    const groups = clearancesNeedingAttention();
    const all = [...groups.expired, ...groups.renewal_due, ...groups.not_on_record, ...groups.active];
    // Surface the most pressing one so the bar cannot read green while a
    // clearance elsewhere on the desk has lapsed.
    clearance = all.sort((a, b) => SEVERITY_ORDER[a.state] - SEVERITY_ORDER[b.state])[0] || null;
  }

  // ── REC sessions: 2nd and last Wednesday, per the CERC order ──────────
  const recNext = tradingSessions(today, 1)[0] || null;

  // ── ESCert sessions: no calendar rule, so only what has been entered ───
  let escertNext = null;
  const configured = getParam('escert_session_dates', []);
  if (Array.isArray(configured)) {
    escertNext = configured
      .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
      .sort()[0] || null;
  }

  res.json({
    as_of: today,
    clearance,
    rec_session: recNext ? { date: recNext, days_away: daysFrom(recNext) } : null,
    escert_session: escertNext
      ? { date: escertNext, days_away: daysFrom(escertNext) }
      : null,
  });
});

// GET /alerts/board — broadcasts + live alerts + summary counts, as this
// person sees them: what they have acknowledged is marked and left out of the counts.
router.get('/board', requireRole(...BOARD_READ), (req, res) => {
  res.json(buildBoard(req.user));
});

const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });

// POST /alerts/board/ack { kind: 'ALERT'|'BROADCAST', key } — "seen it": off
// this person's board until it gets worse. /unack puts it back.
router.post('/board/ack', requireRole(...BOARD_READ), (req, res) => {
  try {
    acknowledge(req.user, req.body.kind, req.body.key);
    res.json(buildBoard(req.user));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/board/unack', requireRole(...BOARD_READ), (req, res) => {
  try {
    unacknowledge(req.user, req.body.kind, req.body.key);
    res.json(buildBoard(req.user));
  } catch (err) {
    fail(res, err);
  }
});

// GET /alerts/history?q=&severity=&group=&status=open|resolved&from=&to=&limit=&offset=
router.get('/history', requireRole(...BOARD_READ), (req, res) => {
  try {
    res.json(boardHistory(req.user, req.query));
  } catch (err) {
    fail(res, err);
  }
});

// GET / PUT /alerts/preferences — which alerts also reach this person by email or SMS.
router.get('/preferences', requireRole(...BOARD_READ), (req, res) => {
  res.json(getPreferences(req.user));
});

router.put('/preferences', requireRole(...BOARD_READ), (req, res) => {
  try {
    res.json(savePreferences(req.user, req.body));
  } catch (err) {
    fail(res, err);
  }
});

// GET /alerts/broadcasts — manage list (includes inactive for admins)
router.get('/broadcasts', requireRole(...BOARD_READ), (req, res) => {
  const scope = scopeFor(req.user);
  const all = req.query.all === '1' && BOARD_WRITE.includes(req.user.role);
  res.json(all
    ? safeAll(`SELECT * FROM broadcast_messages ORDER BY created_at DESC LIMIT 100`)
    : activeBroadcasts(scope.audiences));
});

// POST /alerts/broadcasts — admin flashes a message on the board
router.post('/broadcasts', requireRole(...BOARD_WRITE), (req, res) => {
  const { title, message, severity, audience, expires_at } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });
  const sev = ['INFO', 'WARNING', 'CRITICAL'].includes(severity) ? severity : 'INFO';
  const aud = ['ALL', 'INTERNAL', 'SELLERS', 'BUYERS'].includes(audience) ? audience : 'ALL';
  const id = newId('BRD');
  db.prepare(`
    INSERT INTO broadcast_messages (id, title, message, severity, audience, expires_at, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, message, sev, aud, expires_at || null, req.user.id, req.user.name);
  logAudit({ req, user: req.user, action: 'CREATE', module: 'NOTIFICATION', entityType: 'broadcast', entityId: id, details: { title, severity: sev, audience: aud } });
  res.status(201).json(db.prepare('SELECT * FROM broadcast_messages WHERE id = ?').get(id));
});

// DELETE /alerts/broadcasts/:id — take a message off the board
router.delete('/broadcasts/:id', requireRole(...BOARD_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM broadcast_messages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  db.prepare(`UPDATE broadcast_messages SET is_active = 0, removed_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'DEACTIVATE', module: 'NOTIFICATION', entityType: 'broadcast', entityId: req.params.id });
  res.json({ ok: true });
});

export default router;
