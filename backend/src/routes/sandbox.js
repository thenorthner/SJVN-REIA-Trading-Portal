import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { sandboxEnabled } from '../services/clock.js';

// Moving a record's dates so scheduled work sees them as past due.
//
// End-to-end testing had no way to advance time. Verifying that a surcharge
// accrues after a due date, or that a dispute escalates when its SLA lapses,
// meant either waiting weeks or writing to the database by hand — and a test
// that reaches around the application proves nothing about the application.
//
// This is the narrow exception to that: it mutates, so it is refused unless the
// environment opts in and is never available in production. What it moves is
// only ever a date, never an amount or a status — aging a record is the whole
// point, deciding its outcome is not.

const router = Router();
router.use(requireAuth);

// Every route here is gated, not just the mutating ones, so the surface does not
// exist at all on a deployment that has not opted in.
router.use((req, res, next) => {
  if (!sandboxEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

router.get('/', (_req, res) => {
  res.json({
    sandbox: true,
    note: 'Date-shifting for testing. Enabled by SJVN_SANDBOX and never active in production.',
    shiftable: {
      invoice: ['due_date', 'issued_at', 'created_at'],
      dispute: ['sla_ack_due', 'sla_resolve_due', 'created_at'],
    },
  });
});

const SHIFTABLE = {
  invoice: { table: 'invoices', fields: ['due_date', 'issued_at', 'created_at'] },
  dispute: { table: 'disputes', fields: ['sla_ack_due', 'sla_resolve_due', 'created_at'] },
};

/**
 * Shift one record's dates by a number of days.
 *
 * POST /api/sandbox/age { record: 'invoice', id, days: -31 }
 * POST /api/sandbox/age { record: 'dispute', id, fields: { sla_resolve_due: '2026-07-01' } }
 *
 * Negative days move a record into the past, which is what aging means here.
 */
router.post('/age', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { record, id, days, fields } = req.body || {};
  const spec = SHIFTABLE[record];
  if (!spec) {
    return res.status(400).json({ error: `record must be one of: ${Object.keys(SHIFTABLE).join(', ')}` });
  }
  if (!id) return res.status(400).json({ error: 'id is required' });

  const row = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: `No ${record} with id ${id}` });

  const before = Object.fromEntries(spec.fields.map((f) => [f, row[f]]));
  const sets = [];
  const params = [];

  if (days !== undefined) {
    const n = Number(days);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'days must be a number' });
    // Only shift the dates the record actually has — a NULL stays NULL rather
    // than springing into existence at some invented date.
    for (const f of spec.fields) {
      if (row[f] == null) continue;
      sets.push(`${f} = datetime(${f}, ?)`);
      params.push(`${n} days`);
    }
  }

  for (const [field, value] of Object.entries(fields || {})) {
    if (!spec.fields.includes(field)) {
      return res.status(400).json({ error: `${record}.${field} is not shiftable; allowed: ${spec.fields.join(', ')}` });
    }
    sets.push(`${field} = ?`);
    params.push(value);
  }

  if (!sets.length) return res.status(400).json({ error: 'Pass days, or fields, or both' });

  db.prepare(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  const after = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);

  logAudit({
    req, user: req.user, action: 'SANDBOX_AGE', module: 'REIA',
    entityType: record, entityId: id,
    details: { days, fields, before, after: Object.fromEntries(spec.fields.map((f) => [f, after[f]])) },
  });

  res.json({
    record, id, days: days ?? null,
    before,
    after: Object.fromEntries(spec.fields.map((f) => [f, after[f]])),
  });
});

export default router;
