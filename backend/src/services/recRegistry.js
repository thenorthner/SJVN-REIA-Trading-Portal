// REC for the CSPP before the certificates exist (CP-83-85 §5, steps 1–3):
// the joint meter reading from the plant, the application on the NLDC REC
// Registry, the documents behind it, and the follow-up with the SLDC and NLDC
// until the Central Agency issues.
//
// A lot already recorded APPLIED and then ISSUED, with nothing in between — no
// JMR, no application number, no record of the query the SLDC raised or of who
// chased it and when. An application that has sat unanswered for a month looked
// exactly like one submitted yesterday. This keeps the application's own trail on
// the lot, and the queue of applications that are due a follow-up.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { newId } from '../util.js';

export const REGISTRY_STAGES = ['JMR_RECEIVED', 'SUBMITTED', 'UNDER_VERIFICATION', 'QUERY_RAISED', 'APPROVED'];
export const FOLLOW_UP = 'FOLLOW_UP';
export const STAGE_LABELS = {
  JMR_RECEIVED: 'JMR received from CSPP',
  SUBMITTED: 'Application submitted on the NLDC REC Registry',
  UNDER_VERIFICATION: 'Under SLDC / NLDC verification',
  QUERY_RAISED: 'Query raised by SLDC / NLDC',
  APPROVED: 'Approved, awaiting issuance',
  FOLLOW_UP: 'Follow-up',
};
export const DOC_TYPES = ['JMR', 'APPLICATION', 'SLDC_VERIFICATION', 'QUERY_REPLY', 'ISSUANCE_CERTIFICATE', 'OTHER'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REC_DOC_DIR = process.env.SJVN_REC_DOC_DIR || path.join(__dirname, '../../uploads/rec-lots');

export class RegistryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const validDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function lotEvents(lotId) {
  return db.prepare('SELECT * FROM rec_lot_events WHERE lot_id = ? ORDER BY created_at, rowid').all(lotId)
    .map((e) => ({ ...e, label: STAGE_LABELS[e.stage] || e.stage }));
}

export function lotDocuments(lotId) {
  return db.prepare(`
    SELECT id, lot_id, doc_type, file_name, mime_type, size_bytes, uploaded_by, created_at
    FROM rec_lot_documents WHERE lot_id = ? ORDER BY created_at, rowid
  `).all(lotId);
}

/**
 * Record where a lot's registry application now stands, or a follow-up that
 * leaves it where it is. The step each stage cannot happen without is required
 * with it: a JMR reference to start, an application number to submit, and a
 * note for a query or a follow-up — a follow-up with nothing said is not one.
 */
export function recordRegistryStep(lotId, body = {}, actor = null, today = new Date().toISOString().slice(0, 10)) {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(lotId);
  if (!lot) throw new RegistryError(404, 'REC lot not found');
  if (lot.status === 'CANCELLED') throw new RegistryError(409, 'This lot is cancelled.');
  if (lot.issuance_date) throw new RegistryError(409, 'This lot has been issued; its registry application is closed.');

  const stage = String(body.stage || '').toUpperCase();
  if (![...REGISTRY_STAGES, FOLLOW_UP].includes(stage)) {
    throw new RegistryError(400, `stage must be one of ${[...REGISTRY_STAGES, FOLLOW_UP].join(', ')}`);
  }
  const note = body.note ? String(body.note).trim() : '';
  for (const key of ['jmr_date', 'next_follow_up_date']) {
    if (body[key] && !validDate(body[key])) throw new RegistryError(400, `${key} must be a valid YYYY-MM-DD date`);
  }
  if (body.next_follow_up_date && body.next_follow_up_date < today) {
    throw new RegistryError(400, 'next_follow_up_date cannot be in the past');
  }

  const jmrReference = body.jmr_reference ? String(body.jmr_reference).trim() : lot.jmr_reference;
  const applicationNo = body.application_no ? String(body.application_no).trim() : lot.application_no;
  if (stage === 'JMR_RECEIVED' && !jmrReference) throw new RegistryError(400, 'A JMR reference is needed to record the JMR.');
  if (['SUBMITTED', 'UNDER_VERIFICATION', 'QUERY_RAISED', 'APPROVED'].includes(stage) && !applicationNo) {
    throw new RegistryError(400, 'Record the NLDC REC Registry application number first.');
  }
  if ((stage === 'QUERY_RAISED' || stage === FOLLOW_UP) && !note) {
    throw new RegistryError(400, stage === FOLLOW_UP ? 'Say what the follow-up was.' : 'Say what the query is.');
  }
  if (stage === FOLLOW_UP && !lot.registry_stage) {
    throw new RegistryError(409, 'Record the JMR or the application before following it up.');
  }

  const nextFollowUp = body.next_follow_up_date || null;
  db.transaction(() => {
    db.prepare(`
      UPDATE rec_ledger SET
        registry_stage = ?, jmr_reference = ?, jmr_date = COALESCE(?, jmr_date), application_no = ?,
        application_date = CASE WHEN ? = 'SUBMITTED' AND application_date IS NULL THEN ? ELSE application_date END,
        next_follow_up_date = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      stage === FOLLOW_UP ? lot.registry_stage : stage,
      jmrReference || null, body.jmr_date || null, applicationNo || null,
      stage, today,
      nextFollowUp, lot.id,
    );
    db.prepare(`
      INSERT INTO rec_lot_events (id, lot_id, stage, note, next_follow_up_date, actor) VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId('RLE'), lot.id, stage, note || null, nextFollowUp, actor);
  })();

  return db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(lot.id);
}

/**
 * Applications that want chasing: a follow-up date that has come or is inside
 * the week, and applications nobody has touched for a fortnight with no date
 * set at all. Overdue first, then soonest, then the stalest.
 */
export function followUpQueue({ today = new Date().toISOString().slice(0, 10), horizonDays = 7, staleDays = 14 } = {}) {
  const day = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS);
  const now = day(today);
  const lots = db.prepare(`
    SELECT l.*, (SELECT MAX(created_at) FROM rec_lot_events e WHERE e.lot_id = l.id) AS last_activity
    FROM rec_ledger l
    WHERE l.issuance_date IS NULL AND l.status = 'APPLIED'
  `).all();

  const queue = [];
  for (const lot of lots) {
    const lastActivity = lot.last_activity || lot.updated_at || lot.created_at;
    const idleDays = now - day(lastActivity);
    let reason = null;
    let dueIn = null;
    if (lot.next_follow_up_date) {
      dueIn = day(lot.next_follow_up_date) - now;
      if (dueIn < 0) reason = 'OVERDUE';
      else if (dueIn <= horizonDays) reason = 'DUE';
    } else if (idleDays >= staleDays) {
      reason = 'NO_FOLLOW_UP_SET';
    }
    if (!reason) continue;
    queue.push({
      lot_id: lot.id,
      rec_no: lot.rec_no,
      source: lot.source,
      vintage_month: lot.vintage_month,
      quantity: lot.quantity,
      registry_stage: lot.registry_stage,
      stage_label: STAGE_LABELS[lot.registry_stage] || 'Not started',
      application_no: lot.application_no,
      next_follow_up_date: lot.next_follow_up_date,
      due_in_days: dueIn,
      idle_days: idleDays,
      reason,
    });
  }
  const rank = { OVERDUE: 0, DUE: 1, NO_FOLLOW_UP_SET: 2 };
  return queue.sort((a, b) => rank[a.reason] - rank[b.reason]
    || (a.due_in_days ?? 0) - (b.due_in_days ?? 0)
    || b.idle_days - a.idle_days);
}

/** Keep a file against a lot. The file is already on disk (multer); this files it. */
export function addLotDocument(lotId, file, docType, actor) {
  const lot = db.prepare('SELECT id FROM rec_ledger WHERE id = ?').get(lotId);
  if (!lot) {
    if (file?.path) fs.rm(file.path, { force: true }, () => {});
    throw new RegistryError(404, 'REC lot not found');
  }
  const type = String(docType || '').toUpperCase();
  if (!DOC_TYPES.includes(type)) {
    if (file?.path) fs.rm(file.path, { force: true }, () => {});
    throw new RegistryError(400, `doc_type must be one of ${DOC_TYPES.join(', ')}`);
  }
  if (!file) throw new RegistryError(400, 'Attach the file.');
  const id = newId('RLD');
  db.prepare(`
    INSERT INTO rec_lot_documents (id, lot_id, doc_type, file_name, stored_path, mime_type, size_bytes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, lotId, type, file.originalname, file.path, file.mimetype || null, file.size || null, actor);
  return db.prepare('SELECT id, lot_id, doc_type, file_name, mime_type, size_bytes, uploaded_by, created_at FROM rec_lot_documents WHERE id = ?').get(id);
}

export function getLotDocument(docId) {
  return db.prepare('SELECT * FROM rec_lot_documents WHERE id = ?').get(docId);
}
