/**
 * L4: TDS against Form 16A, quarter by quarter, for Finance (Batch 5,
 * 17-Oct-2026).
 *
 * Both ways tax is withheld on energy money:
 *   SELLER  SJVN withholds on what it pays a developer and issues the 16A;
 *   BUYER   a buyer withholds on what it pays SJVN and issues the 16A to SJVN.
 * For each counterparty and quarter: the tax withheld by section (194Q on the
 * purchase of electricity as goods, 194C on transmission / works), the
 * certificate on file and the difference. The 16A for a quarter is due 15 days
 * after that quarter's TDS return (Rule 31): 15 Aug, 15 Nov, 15 Feb, 15 Jun.
 * Finance marks a quarter reconciled, or a mismatch to be taken up, with a note.
 */
import db from '../db/index.js';
import { logAudit } from '../util.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function quarterOf(date) {
  const [y, m] = String(date).slice(0, 10).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, quarter: m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4' };
}
export function certificateDue(fy, quarter) {
  const y = Number(String(fy).slice(0, 4));
  return { Q1: `${y}-08-15`, Q2: `${y}-11-15`, Q3: `${y + 1}-02-15`, Q4: `${y + 1}-06-15` }[quarter];
}
const SIDES = {
  SELLER: { col: 'c.seller_id', direction: 'SELLER_TO_SJVN' },
  BUYER: { col: 'c.buyer_id', direction: 'SJVN_TO_BUYER' },
};

export function tdsRecon({ fy = null, today = istToday() } = {}) {
  const rows = new Map();
  const at = (entityId, name, side, f, q) => {
    const key = `${entityId}|${side}|${f}|${q}`;
    if (!rows.has(key)) rows.set(key, { entity_id: entityId, entity_name: name, party_side: side, financial_year: f, quarter: q, deducted: 0, by_section: {}, payments: 0 });
    return rows.get(key);
  };
  for (const [side, of] of Object.entries(SIDES)) {
    for (const p of db.prepare(`
      SELECT p.payment_date, p.tds_amount, COALESCE(p.tds_section, 'UNSPECIFIED') AS section, ${of.col} AS entity_id, e.name AS entity_name
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN contracts c ON c.id = i.contract_id LEFT JOIN entities e ON e.id = ${of.col}
      WHERE i.direction = '${of.direction}' AND COALESCE(p.tds_amount, 0) > 0
    `).all()) {
      const q = quarterOf(p.payment_date);
      if (fy && q.fy !== fy) continue;
      const r = at(p.entity_id, p.entity_name, side, q.fy, q.quarter);
      r.deducted = money(r.deducted + p.tds_amount);
      r.by_section[p.section] = money((r.by_section[p.section] || 0) + p.tds_amount);
      r.payments += 1;
    }
  }
  for (const c of db.prepare(`SELECT t.*, e.name AS entity_name, e.entity_type FROM tds_certificates t JOIN entities e ON e.id = t.entity_id ${fy ? 'WHERE t.financial_year = ?' : ''}`).all(...(fy ? [fy] : []))) {
    const side = c.entity_type === 'BUYER' ? 'BUYER' : 'SELLER';
    const r = at(c.entity_id, c.entity_name, side, c.financial_year, c.quarter);
    r.certificate = { id: c.id, certificate_no: c.certificate_no, amount: money(c.tds_amount), has_file: !!c.version_id };
  }
  const marks = new Map(db.prepare('SELECT * FROM tds_reconciliations').all().map((m) => [`${m.entity_id}|${m.party_side}|${m.financial_year}|${m.quarter}`, m]));

  const out = [...rows.entries()].map(([key, r]) => {
    const cert = r.certificate?.amount ?? null;
    const diff = cert == null ? null : money(cert - r.deducted);
    const due = certificateDue(r.financial_year, r.quarter);
    const state = cert == null ? (today > due ? 'OVERDUE' : 'AWAITED') : Math.abs(diff) <= 1 ? 'MATCHED' : diff < 0 ? 'SHORT' : 'EXCESS';
    const m = marks.get(key);
    return {
      ...r, certificate: r.certificate || null, difference: diff, certificate_due: due, state,
      recon_status: m?.status || null, recon_note: m?.note || null, recon_by: m?.marked_by || null, recon_at: m?.marked_at || null,
    };
  }).sort((a, b) => `${b.financial_year}${b.quarter}`.localeCompare(`${a.financial_year}${a.quarter}`) || String(a.entity_name).localeCompare(String(b.entity_name)));

  const count = (s) => out.filter((r) => r.state === s).length;
  return {
    fy,
    rows: out,
    totals: {
      quarters: out.length,
      deducted: money(out.reduce((a, r) => a + r.deducted, 0)),
      certified: money(out.reduce((a, r) => a + (r.certificate?.amount || 0), 0)),
      matched: count('MATCHED'), awaited: count('AWAITED'), overdue: count('OVERDUE'), short: count('SHORT'), excess: count('EXCESS'),
      unreconciled: out.filter((r) => r.recon_status !== 'RECONCILED').length,
    },
  };
}

export function markTdsRecon({ entity_id, party_side, financial_year, quarter, status, note }, user, req = null) {
  if (!['SELLER', 'BUYER'].includes(party_side)) throw fail(400, 'party_side must be SELLER or BUYER');
  if (!/^\d{4}-\d{2}$/.test(String(financial_year || ''))) throw fail(400, 'financial_year must read like 2026-27');
  if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) throw fail(400, 'quarter must be Q1–Q4');
  if (!['RECONCILED', 'MISMATCH'].includes(status)) throw fail(400, 'status must be RECONCILED or MISMATCH');
  const text = String(note || '').trim();
  const row = tdsRecon({ fy: financial_year }).rows.find((r) => r.entity_id === entity_id && r.party_side === party_side && r.quarter === quarter);
  if (!row) throw fail(404, 'No tax was withheld and no certificate is on file for that quarter.');
  if (status === 'RECONCILED' && row.state !== 'MATCHED' && text.length < 10) {
    throw fail(400, `The certificate does not match the tax withheld (${row.state.toLowerCase()}); say why it is reconciled anyway — at least 10 characters.`);
  }
  if (status === 'MISMATCH' && text.length < 10) throw fail(400, 'Say what does not match and what was asked for — at least 10 characters.');
  db.prepare(`INSERT INTO tds_reconciliations (id, entity_id, party_side, financial_year, quarter, status, note, marked_by, marked_at)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entity_id, party_side, financial_year, quarter) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at`)
    .run(entity_id, party_side, financial_year, quarter, status, text || null, user.name);
  logAudit({ req, user, action: `TDS_QUARTER_${status}`, module: 'FINANCE', entityType: 'entity', entityId: entity_id, details: { party_side, financial_year, quarter, deducted: row.deducted, certified: row.certificate?.amount ?? null, note: text || null } });
  return tdsRecon({ fy: financial_year }).rows.find((r) => r.entity_id === entity_id && r.party_side === party_side && r.quarter === quarter);
}
