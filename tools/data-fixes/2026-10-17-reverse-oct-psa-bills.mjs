/**
 * Second real-database clean-up approved by the user on 17-Oct-2026: the
 * PSPCL, HPPC and NDMC October 2026 bills raised on 5-Oct, before the month
 * ended, are reversed by full credit notes, and the 250 MW PPA's October
 * energy they were raised on is unlocked — October is billed afresh on the
 * month-end REA. Same method as 2026-10-17-real-db-cleanup.mjs.
 * Run from backend/:  node ../tools/data-fixes/2026-10-17-reverse-oct-psa-bills.mjs [--apply]
 */
import { createRequire } from 'module';

const need = createRequire(`${process.cwd()}/package.json`);
const express = need('express');
const request = need('supertest');
const APPLY = process.argv.includes('--apply');
const { default: db } = await import(`${process.cwd()}/src/db/index.js`);
const { signToken } = await import(`${process.cwd()}/src/middleware/auth.js`);
const { logAudit } = await import(`${process.cwd()}/src/util.js`);
const notes = (await import(`${process.cwd()}/src/routes/notes.js`)).default;

const app = express();
app.use(express.json());
app.use('/api/notes', notes);

const user = (id, name, role) => {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES (?, ?, ?, '!', ?, 1)`).run(id, name, `${id.toLowerCase()}@datafix.invalid`, role);
  } else db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
};
const makerU = user('USR-DATAFIX-MAKER', 'Data fix (Claude) — on Kshitij Sharma\'s instruction, 17-Oct-2026', 'REIA_USER');
const checkerU = user('USR-DATAFIX-CHECKER', 'Data fix approval — on Kshitij Sharma\'s instruction, 17-Oct-2026', 'FINANCE_USER');
const maker = { Authorization: `Bearer ${signToken(makerU)}` };
const checker = { Authorization: `Bearer ${signToken(checkerU)}` };
const say = (m) => console.log(m);

say(`# October PSA bills reversal ${APPLY ? '(APPLIED)' : '(dry run)'} — ${new Date().toISOString()}`);
for (const no of ['INV-PSA/PSPCL/2026/001', 'INV-PSA/HPPC/2026/001', 'INV-PSA/NDMC/2026/001']) {
  const inv = db.prepare('SELECT * FROM invoices WHERE invoice_no = ?').get(no);
  if (!inv) { say(`- ${no}: not found`); continue; }
  const credited = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM debit_credit_notes WHERE invoice_id = ? AND note_type='CREDIT' AND model='V2' AND status IN ('DRAFT','ISSUED','SETTLED')`).get(inv.id).s;
  const amount = Math.round((inv.total_amount - credited) * 100) / 100;
  if (amount <= 0.005) { say(`- ${no}: already fully credited`); continue; }
  if (!APPLY) { say(`- ${no} (${inv.status}): would issue a full credit note of ₹${amount.toLocaleString('en-IN')}`); continue; }
  const draft = await request(app).post('/api/notes').set(maker).send({ invoice_id: inv.id, note_type: 'CREDIT', amount, reason_code: 'OTHER',
    reason: 'Reversal: October 2026 bill raised on 5-Oct, before the month ended; October is billed afresh on the month-end REA (approved 17-Oct-2026).' });
  if (draft.status !== 201) throw new Error(`${no}: ${JSON.stringify(draft.body)}`);
  const issued = await request(app).post(`/api/notes/${draft.body.id}/approve`).set(checker).send({});
  if (issued.status !== 200) throw new Error(`${no}: ${JSON.stringify(issued.body)}`);
  say(`- ${no}: credit note ${issued.body.note_no} for ₹${amount.toLocaleString('en-IN')} issued; bill now ${db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status}`);
}
const e = db.prepare("SELECT * FROM energy_data WHERE id = 'ED-SOLAR-250MW-202610-P'").get();
if (e?.status === 'LOCKED') {
  const why = 'Unlocked: October 2026 was locked before the month ended and its bills are reversed (data fix approved 17-Oct-2026). Lock again on the month-end REA.';
  if (!APPLY) say(`- energy ${e.id} (${e.energy_mwh} MWh): would move LOCKED → VALIDATED`);
  else {
    db.prepare(`UPDATE energy_data SET status = 'VALIDATED', locked_at = NULL, deviation_notes = COALESCE(deviation_notes || ' · ', '') || ?, updated_at = datetime('now') WHERE id = ?`).run(why, e.id);
    logAudit({ user: { id: makerU.id, name: makerU.name, role: makerU.role }, action: 'ENERGY_UNLOCKED_DATA_FIX', module: 'REIA', entityType: 'energy_data', entityId: e.id, beforeValue: { status: 'LOCKED' }, afterValue: { status: 'VALIDATED' }, details: { reason: why } });
    say(`- energy ${e.id}: LOCKED → VALIDATED`);
  }
}
if (APPLY) db.prepare(`UPDATE users SET is_active = 0 WHERE id IN ('USR-DATAFIX-MAKER','USR-DATAFIX-CHECKER')`).run();
say('Done.');
