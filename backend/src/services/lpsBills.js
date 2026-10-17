/**
 * PM5: Late Payment Surcharge supplementary bills (Batch 2, 17-Oct-2026).
 *
 * Under the Electricity (Late Payment Surcharge and Related Matters) Rules,
 * 2022, surcharge runs on what is unpaid past the due date at the base rate
 * for the first month, rising 0.5% a month to a cap of 3% above it, counted on
 * calendar days. The platform worked it out on every bill but only charged it
 * when a payment came in, so on a bill nobody paid it was never demanded.
 *
 * Once a month, one LPS bill per buyer contract demands the surcharge its
 * overdue bills have earned to the month's last day and not yet been charged.
 * Each source bill records what was demanded on it (lps_invoiced), so its own
 * surcharge is reckoned net of that and nothing is charged twice; cancelling
 * an LPS bill gives it back. An LPS bill earns no surcharge itself.
 */
import db from '../db/index.js';
import { newId, genInvoiceNo, computeDueDate, logAudit, buildBillingFamilyRef } from '../util.js';
import { invoiceLpsAsOf } from './invoiceLps.js';
import { lastCompleteMonth } from './energyRules.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0, 18, 29, 59)); };
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** What each buyer contract's overdue bills have earned to the month end and not yet been charged. */
export function lpsBillPreview(period = lastCompleteMonth()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) throw err(400, 'period_month must be YYYY-MM');
  if (period > lastCompleteMonth()) throw err(400, `${period} has not ended; surcharge is billed for a month once it is over.`);
  const asOf = monthEnd(period);
  const asOfDay = asOf.toISOString().slice(0, 10);
  const bills = db.prepare(`
    SELECT i.*, c.contract_no, b.name AS buyer FROM invoices i JOIN contracts c ON c.id = i.contract_id LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE i.direction = 'SJVN_TO_BUYER' AND i.status IN ('SENT', 'PARTIALLY_PAID', 'DISPUTED', 'PAID')
      AND i.due_date IS NOT NULL AND i.due_date < ? AND i.invoice_no NOT LIKE 'DSM-%' AND i.invoice_no NOT LIKE 'LPS-%'
    ORDER BY c.contract_no, i.due_date
  `).all(asOfDay);
  const byContract = new Map();
  for (const inv of bills) {
    const accrued = invoiceLpsAsOf(inv, asOf);
    const unbilled = money(Math.max(0, (Number(accrued.lps) || 0) - (Number(inv.lps) || 0)));
    if (unbilled < 1) continue;
    if (!byContract.has(inv.contract_id)) byContract.set(inv.contract_id, { contract_id: inv.contract_id, contract_no: inv.contract_no, buyer: inv.buyer, lines: [], total: 0 });
    const g = byContract.get(inv.contract_id);
    g.lines.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, due_date: inv.due_date, days_overdue: accrued.days_overdue, rate_pct: accrued.effective_pct ?? accrued.annual_pct, amount: unbilled });
    g.total = money(g.total + unbilled);
  }
  const rows = [...byContract.values()].map((g) => {
    const existing = db.prepare(`SELECT invoice_no, status FROM invoices WHERE contract_id = ? AND billing_period = ? AND invoice_no LIKE 'LPS-%' AND status <> 'CANCELLED'`).get(g.contract_id, period);
    return { ...g, existing: existing || null };
  });
  return { period, as_of: asOfDay, rows, total: money(rows.reduce((t, r) => t + (r.existing ? 0 : r.total), 0)) };
}

/** Raise the month's LPS bills (one per buyer contract), as drafts for approval. */
export function raiseLpsBills({ period, contractIds = null, user, req = null }) {
  const preview = lpsBillPreview(period);
  const only = contractIds?.length ? new Set(contractIds) : null;
  const raised = [];
  const skipped = [];
  for (const g of preview.rows) {
    if (only && !only.has(g.contract_id)) continue;
    if (g.existing) { skipped.push({ contract_no: g.contract_no, reason: `already billed on ${g.existing.invoice_no}` }); continue; }
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(g.contract_id);
    const billDate = new Date().toISOString().slice(0, 10);
    const id = newId('INV');
    const invoiceNo = genInvoiceNo('LPS-PSA');
    const breakdown = [
      ...g.lines.map((l) => ({ code: 'LPS', label: `Late payment surcharge on ${l.invoice_no} (due ${l.due_date}), ${l.days_overdue} days to ${preview.as_of}`, value: l.amount, source_invoice_id: l.invoice_id })),
      { code: 'TOTAL', label: `Late payment surcharge for ${period} — LPS Rules, 2022`, value: g.total },
    ];
    db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit, energy_charges,
          other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status, billing_family_ref, created_by, created_by_id)
        VALUES (?, ?, ?, 'SUPPLEMENTARY', 'SJVN_TO_BUYER', ?, 0, 0, 0, ?, ?, ?, 0, ?, 'DRAFT', ?, ?, ?)
      `).run(id, invoiceNo, g.contract_id, period, g.total, g.total, JSON.stringify(breakdown), computeDueDate(billDate, contract),
        buildBillingFamilyRef(contract.contract_no, period, 'SJVN_TO_BUYER'), user?.name || null, user?.id || null);
      db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(newId('APR'), id);
      for (const l of g.lines) db.prepare('UPDATE invoices SET lps_invoiced = COALESCE(lps_invoiced, 0) + ? WHERE id = ?').run(l.amount, l.invoice_id);
    })();
    logAudit({ req, user, action: 'LPS_BILL_RAISED', module: 'REIA', entityType: 'invoice', entityId: id, details: { invoice_no: invoiceNo, period, total: g.total, lines: g.lines.length } });
    raised.push({ invoice_id: id, invoice_no: invoiceNo, contract_no: g.contract_no, total: g.total });
  }
  return { period, raised, skipped };
}

/** Cancelling an LPS bill gives its surcharge back to the bills it was on. */
export function releaseLpsBill(inv) {
  if (!String(inv?.invoice_no || '').startsWith('LPS-')) return;
  let lines = [];
  try { lines = JSON.parse(inv.invoice_breakdown_json || '[]').filter((l) => l.code === 'LPS' && l.source_invoice_id); } catch { /* nothing to give back */ }
  for (const l of lines) db.prepare('UPDATE invoices SET lps_invoiced = MAX(0, COALESCE(lps_invoiced, 0) - ?) WHERE id = ?').run(Number(l.value) || 0, l.source_invoice_id);
}
