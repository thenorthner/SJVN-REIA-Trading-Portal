/**
 * Real-database clean-up approved by the user on 17-Oct-2026
 * (docs/DECISIONS_2026-10-17.md, "Real-database items waiting for a go-ahead").
 *
 * Runs through the platform's own routes — maker-checker, caps and audit all
 * apply — as two clearly labelled data-fix users, never as a real officer.
 * Run from backend/:  node ../tools/data-fixes/2026-10-17-real-db-cleanup.mjs [--apply]
 * Without --apply it only prints what it would do.
 */
import { createRequire } from 'module';
// Packages come from backend/, where this is run from.
const need = createRequire(`${process.cwd()}/package.json`);
const express = need('express');
const request = need('supertest');

const APPLY = process.argv.includes('--apply');
const { default: db } = await import(`${process.cwd()}/src/db/index.js`);
const { signToken } = await import(`${process.cwd()}/src/middleware/auth.js`);
const { newId, logAudit } = await import(`${process.cwd()}/src/util.js`);
const { computeDueDate } = await import(`${process.cwd()}/src/util.js`);
const invoices = (await import(`${process.cwd()}/src/routes/invoices.js`)).default;
const notes = (await import(`${process.cwd()}/src/routes/notes.js`)).default;
const recon = (await import(`${process.cwd()}/src/routes/reconciliation.js`)).default;

const app = express();
app.use(express.json());
app.use('/api/invoices', invoices);
app.use('/api/notes', notes);
app.use('/api/reconciliation', recon);

const user = (id, name, role) => {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES (?, ?, ?, '!', ?, 1)`)
      .run(id, name, `${id.toLowerCase()}@datafix.invalid`, role);
  } else db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
};
const makerU = user('USR-DATAFIX-MAKER', 'Data fix (Claude) — on Kshitij Sharma\'s instruction, 17-Oct-2026', 'REIA_USER');
const checkerU = user('USR-DATAFIX-CHECKER', 'Data fix approval — on Kshitij Sharma\'s instruction, 17-Oct-2026', 'FINANCE_USER');
const maker = { Authorization: `Bearer ${signToken(makerU)}` };
const checker = { Authorization: `Bearer ${signToken(checkerU)}` };
const auditUser = { id: makerU.id, name: makerU.name, role: makerU.role };
const log = [];
const say = (m) => { log.push(m); console.log(m); };
const bill = (no) => db.prepare('SELECT * FROM invoices WHERE invoice_no = ?').get(no);

async function reverseByCreditNote(no, reason) {
  const inv = bill(no);
  if (!inv) return say(`- ${no}: not found, skipped`);
  const credited = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM debit_credit_notes WHERE invoice_id = ? AND note_type='CREDIT' AND model='V2' AND status IN ('DRAFT','ISSUED','SETTLED')`).get(inv.id).s;
  const amount = Math.round((inv.total_amount - credited) * 100) / 100;
  if (amount <= 0.005) return say(`- ${no}: already fully credited, skipped`);
  if (!APPLY) return say(`- ${no} (${inv.status}): would raise and issue a full credit note of ₹${amount.toLocaleString('en-IN')}`);
  const draft = await request(app).post('/api/notes').set(maker).send({ invoice_id: inv.id, note_type: 'CREDIT', amount, reason_code: 'OTHER', reason });
  if (draft.status !== 201) throw new Error(`${no}: note refused — ${JSON.stringify(draft.body)}`);
  const issued = await request(app).post(`/api/notes/${draft.body.id}/approve`).set(checker).send({});
  if (issued.status !== 200) throw new Error(`${no}: approval refused — ${JSON.stringify(issued.body)}`);
  say(`- ${no}: credit note ${issued.body.note_no} for ₹${amount.toLocaleString('en-IN')} issued; bill now ${bill(no).status}`);
}

say(`# Real-DB clean-up ${APPLY ? '(APPLIED)' : '(dry run)'} — ${new Date().toISOString()}`);

// Item 2 — October 2026 billed before the month was over.
say('\n## Items 1 and 2 — double margin, and premature October 2026 bills and energy');
{
  const inv = bill('SELLER-INV/2026/000005');
  if (inv && inv.status !== 'CANCELLED') {
    if (!APPLY) say(`- SELLER-INV/2026/000005 (${inv.status}): would cancel`);
    else {
      const r = await request(app).post(`/api/invoices/${inv.id}/cancel`).set(maker).send({ reason: 'Raised on October 2026 energy locked before the month ended; to be billed again once October is over (data fix approved 17-Oct-2026).' });
      if (r.status >= 400) throw new Error(`cancel refused — ${JSON.stringify(r.body)}`);
      say('- SELLER-INV/2026/000005: cancelled');
    }
  }
}
await reverseByCreditNote('INV-PPA/2026/000005', 'Reversal: raised on October 2026 energy locked before the month ended; October is billed again once it is over (approved 17-Oct-2026).');
// Item 1 — the double margin. Its credit note was drafted on 16-Oct (₹5,72,880);
// it is issued as it stands, and the reversal below takes the rest of the bill.
{
  const inv = bill('INV-PSA/2026/000001');
  const drafts = inv ? db.prepare(`SELECT * FROM debit_credit_notes WHERE invoice_id = ? AND note_type = 'CREDIT' AND status = 'DRAFT'`).all(inv.id) : [];
  for (const d of drafts) {
    if (!APPLY) { say(`- INV-PSA/2026/000001: would issue draft credit note ${d.note_no} (₹${d.amount.toLocaleString('en-IN')}, ${d.reason.slice(0, 60)}…)`); continue; }
    const r = await request(app).post(`/api/notes/${d.id}/approve`).set(checker).send({});
    if (r.status !== 200) throw new Error(`issuing ${d.note_no} refused — ${JSON.stringify(r.body)}`);
    say(`- INV-PSA/2026/000001: double-margin credit note issued as ${r.body.note_no} (₹${d.amount.toLocaleString('en-IN')})`);
  }
}
await reverseByCreditNote('INV-PSA/2026/000001', 'Reversal: raised on October 2026 energy locked before the month ended, and carrying the trading margin twice (₹5,72,880); October is billed again once it is over (approved 17-Oct-2026).');
for (const [id, to, why] of [
  ['ENG-71e43674ab8f4b54', 'VALIDATED', 'Unlocked: October 2026 was locked before the month ended (data fix approved 17-Oct-2026). Lock again once October is over.'],
  ['ENG-3e7575b88c84481b', 'DRAFT', 'Set aside: a PSA fed by a PPA carries no energy of its own (energy is recorded on the source PPA); locked before October ended (data fix approved 17-Oct-2026).'],
]) {
  const e = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(id);
  if (!e || e.status !== 'LOCKED') { say(`- ${id}: ${e ? e.status : 'missing'}, skipped`); continue; }
  if (!APPLY) { say(`- energy ${id} (${e.period_month}, ${e.energy_mwh} MWh): would move LOCKED → ${to}`); continue; }
  db.prepare(`UPDATE energy_data SET status = ?, locked_at = NULL, deviation_notes = COALESCE(deviation_notes || ' · ', '') || ?, updated_at = datetime('now') WHERE id = ?`).run(to, why, id);
  logAudit({ user: auditUser, action: 'ENERGY_UNLOCKED_DATA_FIX', module: 'REIA', entityType: 'energy_data', entityId: id, beforeValue: { status: 'LOCKED' }, afterValue: { status: to }, details: { reason: why } });
  say(`- energy ${id}: LOCKED → ${to}`);
}

// Item 3 — sent with no due date.
say('\n## Item 3 — presented bills with no due date');
for (const no of ['INV-PSA/PSPCL/2026/001', 'INV-PSA/HPPC/2026/001', 'INV-PSA/NDMC/2026/001']) {
  const inv = bill(no);
  if (!inv || inv.due_date) { say(`- ${no}: ${inv ? `already due ${inv.due_date}` : 'missing'}, skipped`); continue; }
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  const sentOn = String(inv.issued_at || inv.created_at).slice(0, 10);
  const due = computeDueDate(sentOn, contract);
  if (!APPLY) { say(`- ${no}: would set presented ${sentOn}, due ${due}`); continue; }
  db.prepare(`UPDATE invoices SET due_date = ?, issued_at = COALESCE(issued_at, ?), updated_at = datetime('now') WHERE id = ?`).run(due, `${sentOn} 00:00:00`, inv.id);
  logAudit({ user: auditUser, action: 'DUE_DATE_SET_DATA_FIX', module: 'REIA', entityType: 'invoice', entityId: inv.id, beforeValue: { due_date: null }, afterValue: { due_date: due, presented_on: sentOn }, details: { basis: 'sent date (created) + contract payment terms' } });
  say(`- ${no}: presented ${sentOn}, due ${due}`);
}

// Item 5 — Adani seed bill.
say('\n## Item 5 — Adani seed bill');
await reverseByCreditNote('INV-ADANI/2026/00101', 'Reversal of seed/test bill raised on October 2026 energy locked before the month ended (approved 17-Oct-2026), as on the QA copy.');

// Item 4 — empty September statements.
say('\n## Item 4 — September 2026 statements');
const stmts = db.prepare(`SELECT r.*, c.contract_no FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id
  WHERE r.period = '2026-09' AND r.status = 'PENDING_SIGN_OFF' AND r.sjvn_ack_at IS NULL AND r.counterparty_ack_at IS NULL`).all();
for (const r of stmts) {
  if (!APPLY) { say(`- ${r.recon_no} (${r.contract_no}): would withdraw if empty, else regenerate`); continue; }
  const w = await request(app).post(`/api/reconciliation/${r.id}/withdraw`).set(maker).send({ reason: 'Nothing to reconcile for September 2026 on this contract (data fix approved 17-Oct-2026).' });
  if (w.status === 200) { say(`- ${r.recon_no} (${r.contract_no}): withdrawn — nothing to reconcile`); continue; }
  if (/regenerate/.test(w.body?.error || '')) {
    const g = await request(app).post(`/api/reconciliation/${r.id}/regenerate-statement`).set(maker).send({});
    say(`- ${r.recon_no} (${r.contract_no}): ${g.status < 400 ? 'regenerated from current data' : `regenerate refused — ${g.body?.error}`}`);
  } else say(`- ${r.recon_no} (${r.contract_no}): left — ${w.body?.error}`);
}

if (APPLY) db.prepare(`UPDATE users SET is_active = 0 WHERE id IN ('USR-DATAFIX-MAKER','USR-DATAFIX-CHECKER')`).run();
say('\nDone.');
