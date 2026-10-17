import db from '../db/index.js';
import { newId, genInvoiceNo, buildBillingFamilyRef, computeDueDate } from '../util.js';
import { getParamNumber } from '../mastersService.js';
import { resolveTariff } from './tariffStructure.js';
import { allocationsInForce } from './allocations.js';

// Held to what banking is (17-Oct-2026 audit): 50,000 MWh were banked on a PSA,
// at a typed ₹30/unit, into a cycle that had already closed, and the sweep paid
// it out at once — ₹112.5 crore; and the sweep took any "as of" date, so a
// running cycle could be cashed out by naming 2099. Banking is now a PPA's
// generation of a month that is locked, up to that month's energy, at the
// contract's tariff, into a cycle still open; drawing stops when the cycle
// closes; and only a cycle that has actually closed is settled.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIVE = ['ACTIVE', 'AMENDED', 'NEARING_EXPIRY', 'RENEWED'];
const RE_TYPES = ['Solar', 'Wind', 'Hybrid', 'FDRE'];

// How banked energy is paid for (decided 17-Oct-2026). The month's PPA bill —
// and each PSA bill's share of it — leaves banked energy out (it was not sold
// that month); a draw is billed to SJVN by the generator at the full tariff the
// energy was banked at, and to each buyer for its share at its own tariff; and
// what lapses unused is billed by the generator at the settlement percentage
// when the cycle closes, and passed on to each buyer for its share at the same
// percentage of its own tariff (SJVN carries none of it). Each is a SUPPLEMENTARY bill from
// the generator to SJVN, raised as a DRAFT to go through approval like any other.
// Before, settlement only wrote a figure on the banking row and nothing was
// payable, while the month's bill had already paid for the same energy in full.

/** A supplementary Seller → SJVN bill for banked energy, as a DRAFT with its approval row. */
function raiseBankingBill({ contract, billingPeriod, mwh, amount, rate, lines, title, createdBy, direction = 'SELLER_TO_SJVN' }) {
  const id = newId('INV');
  const invoiceNo = genInvoiceNo(direction === 'SJVN_TO_BUYER' ? 'BNK-PSA' : 'BNK-PPA');
  const issued = istToday();
  const breakdown = [
    ...lines,
    { code: 'TOTAL', label: title, value: amount },
  ];
  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      billing_family_ref, created_by, created_by_id)
    VALUES (?, ?, ?, 'SUPPLEMENTARY', ?, ?, ?, ?, ?, ?, ?, 0, ?, 'DRAFT', ?, ?, ?)
  `).run(id, invoiceNo, contract.id, direction, billingPeriod, Math.round(mwh * 1000) / 1000, rate, amount, amount,
    JSON.stringify(breakdown), computeDueDate(issued, contract), buildBillingFamilyRef(contract.contract_no, billingPeriod, direction),
    createdBy?.name || 'Energy banking (system)', createdBy?.id || null);
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  return { id, invoice_no: invoiceNo, total_amount: amount, contract_no: contract.contract_no };
}
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const lastDayOf = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
};

// Energy banking under a PPA.
//
// When the buyer cannot take generation, the energy can be credited to the seller
// and drawn back later within the banking cycle. Anything still unused when the
// cycle closes is settled in cash — but at a discount to tariff, because banking
// is a carry-forward facility, not a guaranteed sale. The regulator sets that
// discount; 75% of tariff is the common figure and the default here.

const DEFAULT_SETTLEMENT_PCT = 75;

function settlementPct() {
  const pct = getParamNumber('banking_settlement_pct', DEFAULT_SETTLEMENT_PCT);
  return pct > 0 && pct <= 100 ? pct : DEFAULT_SETTLEMENT_PCT;
}

/** Credit energy to the bank for a contract's cycle. */
export function bankEnergy({ contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on, createdBy, asOf = istToday() }) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) throw new Error('Contract not found');
  // The generator's energy the buyer could not take is what is banked: a PPA's.
  if (contract.contract_type !== 'PPA') throw new Error(`${contract.contract_no} is a ${contract.contract_type}; energy is banked to the generator under its PPA.`);
  if (!LIVE.includes(contract.status)) throw new Error(`${contract.contract_no} is ${contract.status}; only a live PPA banks energy.`);
  if (!RE_TYPES.some((t) => t.toUpperCase() === String(contract.project_type || '').toUpperCase())) throw new Error(`${contract.contract_no} is ${contract.project_type}; banking is for solar, wind and hybrid generation.`);
  const label = String(cycle || '').trim();
  if (!label) throw new Error('cycle is required, e.g. FY2026-27');
  const mwh = Number(banked_mwh);
  if (!Number.isFinite(mwh) || mwh <= 0) throw new Error('banked_mwh must be a positive number');
  const period = String(period_month || '');
  if (!MONTH.test(period)) throw new Error('period_month is required: the month whose generation is banked (YYYY-MM)');
  if (!cycle_ends_on || !DATE.test(String(cycle_ends_on))) throw new Error('cycle_ends_on is required (YYYY-MM-DD) — banked energy has to expire somewhere');
  const ends = String(cycle_ends_on);
  if (ends < asOf) throw new Error(`The cycle ended on ${ends}; energy cannot be banked into a closed cycle.`);
  if (ends < lastDayOf(period)) throw new Error(`The cycle ends on ${ends}, before ${period} does.`);
  if (ends > addMonths(lastDayOf(period), 12)) throw new Error(`A banking cycle runs at most a year: ${ends} is more than twelve months after ${period}.`);
  const sameCycle = db.prepare('SELECT DISTINCT cycle_ends_on e FROM energy_banking WHERE contract_id = ? AND cycle = ?').all(contract.id, label);
  if (sameCycle.some((r) => r.e !== ends)) throw new Error(`Cycle ${label} on ${contract.contract_no} already ends on ${sameCycle[0].e}.`);

  // What can be banked is the month's own generation, once locked, less what is already banked from it.
  const energy = db.prepare(`SELECT energy_mwh FROM energy_data WHERE contract_id = ? AND period_month = ? AND status = 'LOCKED'
    ORDER BY (data_type = 'FINAL') DESC, created_at DESC LIMIT 1`).get(contract.id, period);
  if (!energy) throw new Error(`${period} has no locked energy on ${contract.contract_no}; bank energy once the month's figure is locked.`);
  const already = db.prepare('SELECT COALESCE(SUM(banked_mwh), 0) s FROM energy_banking WHERE contract_id = ? AND period_month = ?').get(contract.id, period).s;
  if (mwh + already > Number(energy.energy_mwh) + 1e-6) {
    throw new Error(`${period} generated ${energy.energy_mwh} MWh${already ? `, of which ${already} MWh is already banked` : ''}; ${mwh} MWh more cannot be banked.`);
  }
  // Once the month is billed, its energy has been paid for in full; banking part
  // of it afterwards would pay for that part again.
  const billed = db.prepare(`SELECT invoice_no FROM invoices WHERE contract_id = ? AND billing_period = ? AND direction = 'SELLER_TO_SJVN'
    AND invoice_type IN ('PROVISIONAL', 'FINAL') AND status != 'CANCELLED' LIMIT 1`).get(contract.id, period);
  if (billed) throw new Error(`${period} is already billed on ${contract.contract_no} (${billed.invoice_no}); bank energy before the month is billed, or cancel that bill first.`);
  // Nor once a buyer has been billed its share of the month: that bill paid for it in full too.
  const psaIds = allocationsInForce(contract.id, period).map((a) => a.psa_id);
  if (psaIds.length) {
    const psaBill = db.prepare(`SELECT invoice_no FROM invoices WHERE contract_id IN (${psaIds.map(() => '?').join(',')}) AND billing_period = ?
      AND direction = 'SJVN_TO_BUYER' AND invoice_type IN ('PROVISIONAL', 'FINAL') AND status != 'CANCELLED' LIMIT 1`).get(...psaIds, period);
    if (psaBill) throw new Error(`The buyer has already been billed for ${period} (${psaBill.invoice_no}); bank energy before the month is billed, or cancel that bill first.`);
  }
  // The contract's tariff for that month: a typed one used to be taken, and the
  // cash settlement is worked from it.
  const tariff = resolveTariff(contract, period).rate || Number(contract.tariff_per_unit) || 0;
  if (tariff_per_unit !== undefined && tariff_per_unit !== null && tariff_per_unit !== ''
    && Math.abs(Number(tariff_per_unit) - tariff) > 0.00005) {
    throw new Error(`Banked energy is valued at the contract's tariff for ${period} (₹${tariff}/unit), not ₹${tariff_per_unit}.`);
  }

  const id = newId('BNK');
  db.prepare(`
    INSERT INTO energy_banking (id, contract_id, cycle, period_month, banked_mwh, tariff_per_unit,
      cycle_ends_on, settlement_pct, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).run(id, contract_id, label, period, mwh, tariff, ends, settlementPct(), createdBy || null);
  return db.prepare('SELECT * FROM energy_banking WHERE id = ?').get(id);
}

/** Draw banked energy back out, oldest first, within the cycle. */
export function drawBanked({ contract_id, cycle, draw_mwh, asOf = istToday(), createdBy = null }) {
  let remaining = Number(draw_mwh);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('draw_mwh must be a positive number');
  // A closed cycle settles in cash; drawing after it ended took the same energy twice.
  const closed = db.prepare(`SELECT MIN(cycle_ends_on) e FROM energy_banking WHERE contract_id = ? AND cycle = ? AND status IN ('OPEN','DRAWN')`).get(contract_id, cycle)?.e;
  if (closed && closed < asOf) throw new Error(`Cycle ${cycle} closed on ${closed}; what is left in it is settled in cash, not drawn.`);

  const open = db.prepare(`
    SELECT * FROM energy_banking
    WHERE contract_id = ? AND cycle = ? AND status IN ('OPEN','DRAWN')
    ORDER BY created_at
  `).all(contract_id, cycle);

  const available = Number(open.reduce((s, r) => s + (r.banked_mwh - r.drawn_mwh), 0).toFixed(3));
  if (remaining > available) {
    throw new Error(`Only ${available} MWh is banked for this cycle; cannot draw ${remaining} MWh.`);
  }

  const drawn = [];
  let bill = null;
  const buyerBills = [];
  db.transaction(() => {
    for (const row of open) {
      if (remaining <= 0) break;
      const left = row.banked_mwh - row.drawn_mwh;
      if (left <= 0) continue;
      const take = Math.min(left, remaining);
      const nowDrawn = Number((row.drawn_mwh + take).toFixed(3));
      db.prepare(`UPDATE energy_banking SET drawn_mwh = ?, status = ? WHERE id = ?`)
        .run(nowDrawn, nowDrawn >= row.banked_mwh ? 'DRAWN' : 'OPEN', row.id);
      remaining = Number((remaining - take).toFixed(3));
      drawn.push({ id: row.id, drawn_mwh: take, tariff_per_unit: row.tariff_per_unit, period_month: row.period_month });
    }
    // Energy taken back is sold now, at the tariff it was banked at.
    if (drawn.length) {
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
      const mwh = drawn.reduce((a, d) => a + d.drawn_mwh, 0);
      const amount = drawn.reduce((a, d) => a + Math.round(d.drawn_mwh * 1000 * d.tariff_per_unit), 0);
      bill = raiseBankingBill({
        contract, billingPeriod: asOf.slice(0, 7), mwh, amount,
        rate: Number((amount / (mwh * 1000)).toFixed(4)),
        lines: drawn.map((d) => ({ code: 'BNKD', label: `Banked energy drawn back, cycle ${cycle} (banked from ${d.period_month || '—'}): ${d.drawn_mwh} MWh × ₹${d.tariff_per_unit}/unit`, value: Math.round(d.drawn_mwh * 1000 * d.tariff_per_unit) })),
        title: `Banked energy drawn — ${Math.round(mwh * 1000) / 1000} MWh`,
        createdBy,
      });

      // And the buyer takes it now: each PSA the energy was allocated to in the
      // month it was banked from is billed its share, at its own tariff for that
      // month — the share its month bill left out.
      const perPsa = new Map();
      for (const d of drawn) {
        if (!d.period_month) continue;
        for (const a of allocationsInForce(contract_id, d.period_month)) {
          const psa = db.prepare('SELECT * FROM contracts WHERE id = ?').get(a.psa_id);
          if (!psa) continue;
          const share = Math.round(d.drawn_mwh * (Number(a.allocation_percent) || 0) / 100 * 1000) / 1000;
          if (!(share > 0)) continue;
          const psaRate = resolveTariff(psa, d.period_month).rate || Number(psa.tariff_per_unit) || 0;
          const value = Math.round(share * 1000 * psaRate);
          if (!perPsa.has(psa.id)) perPsa.set(psa.id, { psa, mwh: 0, amount: 0, lines: [] });
          const g = perPsa.get(psa.id);
          g.mwh += share; g.amount += value;
          g.lines.push({ code: 'BNKD', label: `Banked energy from ${contract.contract_no} drawn back (banked from ${d.period_month}): your ${a.allocation_percent}% share, ${share} MWh × ₹${psaRate}/unit`, value });
        }
      }
      for (const g of perPsa.values()) {
        buyerBills.push(raiseBankingBill({
          contract: g.psa, direction: 'SJVN_TO_BUYER', billingPeriod: asOf.slice(0, 7), mwh: g.mwh, amount: g.amount,
          rate: Number((g.amount / (g.mwh * 1000)).toFixed(4)), lines: g.lines,
          title: `Banked energy delivered — ${Math.round(g.mwh * 1000) / 1000} MWh`, createdBy,
        }));
      }
    }
  })();
  return { drawn, remaining_unfilled: remaining, invoice: bill, buyer_invoices: buyerBills };
}

/**
 * Settle every cycle that has closed with energy still unused.
 *
 * Runs on a schedule rather than waiting to be asked: a cycle that ends with
 * unused energy has to settle whether or not anyone remembers to press a button.
 */
export function settleExpiredBanking(asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const expired = db.prepare(`
    SELECT * FROM energy_banking
    WHERE status IN ('OPEN','DRAWN') AND cycle_ends_on < ?
  `).all(today);

  const settled = [];
  const buyerBills = [];
  db.transaction(() => {
    const groups = new Map();
    for (const row of expired) {
      const unused = Number((row.banked_mwh - row.drawn_mwh).toFixed(3));
      if (unused <= 0) {
        // Fully drawn within the cycle: nothing to pay out.
        db.prepare(`UPDATE energy_banking SET status = 'EXPIRED', settled_on = ? WHERE id = ?`).run(today, row.id);
        continue;
      }
      const pct = row.settlement_pct || DEFAULT_SETTLEMENT_PCT;
      const rate = Number((row.tariff_per_unit * (pct / 100)).toFixed(4));
      const amount = Math.round(unused * 1000 * rate);   // tariff is per kWh
      db.prepare(`
        UPDATE energy_banking
        SET status = 'SETTLED', settled_mwh = ?, settlement_amount = ?, settled_on = ?
        WHERE id = ?
      `).run(unused, amount, today, row.id);
      const item = {
        id: row.id, contract_id: row.contract_id, cycle: row.cycle, cycle_ends_on: row.cycle_ends_on, period_month: row.period_month,
        unused_mwh: unused, tariff_per_unit: row.tariff_per_unit, settlement_pct: pct, settled_rate: rate, settlement_amount: amount,
      };
      settled.push(item);
      const key = `${row.contract_id}|${row.cycle}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    // One bill per contract and cycle: what lapsed, at the settlement rate.
    for (const items of groups.values()) {
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(items[0].contract_id);
      if (!contract) continue; // a row whose contract is gone has no one to bill
      const mwh = items.reduce((a, i) => a + i.unused_mwh, 0);
      const amount = items.reduce((a, i) => a + i.settlement_amount, 0);
      const bill = raiseBankingBill({
        contract, billingPeriod: String(items[0].cycle_ends_on).slice(0, 7), mwh, amount,
        rate: Number((amount / (mwh * 1000)).toFixed(4)),
        lines: items.map((i) => ({ code: 'BNKL', label: `Banked energy lapsed unused, cycle ${i.cycle} (banked from ${i.period_month || '—'}): ${i.unused_mwh} MWh × ₹${i.settled_rate}/unit (${i.settlement_pct}% of ₹${i.tariff_per_unit})`, value: i.settlement_amount })),
        title: `Banking settlement — cycle ${items[0].cycle} closed ${items[0].cycle_ends_on}`,
      });
      const set = db.prepare('UPDATE energy_banking SET settlement_invoice_id = ? WHERE id = ?');
      for (const i of items) { set.run(bill.id, i.id); i.invoice_no = bill.invoice_no; i.invoice_id = bill.id; }

      // The buyers bear the lapse too (decided 17-Oct-2026): SJVN is a
      // pass-through at a 7-paise margin, and the energy was banked because the
      // buyer did not take it. Each PSA allocated the energy in the month it was
      // banked from is billed its share at the settlement percentage of its own
      // tariff for that month.
      const perPsa = new Map();
      for (const i of items) {
        if (!i.period_month) continue;
        for (const a of allocationsInForce(contract.id, i.period_month)) {
          const psa = db.prepare('SELECT * FROM contracts WHERE id = ?').get(a.psa_id);
          if (!psa) continue;
          const share = Math.round(i.unused_mwh * (Number(a.allocation_percent) || 0) / 100 * 1000) / 1000;
          if (!(share > 0)) continue;
          const psaTariff = resolveTariff(psa, i.period_month).rate || Number(psa.tariff_per_unit) || 0;
          const psaRate = Number((psaTariff * (i.settlement_pct / 100)).toFixed(4));
          const value = Math.round(share * 1000 * psaRate);
          if (!perPsa.has(psa.id)) perPsa.set(psa.id, { psa, mwh: 0, amount: 0, lines: [] });
          const g = perPsa.get(psa.id);
          g.mwh += share; g.amount += value;
          g.lines.push({ code: 'BNKL', label: `Banked energy from ${contract.contract_no} lapsed unused, cycle ${i.cycle} (banked from ${i.period_month}): your ${a.allocation_percent}% share, ${share} MWh × ₹${psaRate}/unit (${i.settlement_pct}% of ₹${psaTariff})`, value });
        }
      }
      for (const g of perPsa.values()) {
        const buyerBill = raiseBankingBill({
          contract: g.psa, direction: 'SJVN_TO_BUYER', billingPeriod: String(items[0].cycle_ends_on).slice(0, 7), mwh: g.mwh, amount: g.amount,
          rate: Number((g.amount / (g.mwh * 1000)).toFixed(4)), lines: g.lines,
          title: `Banking settlement — energy not taken, cycle ${items[0].cycle} closed ${items[0].cycle_ends_on}`,
        });
        buyerBills.push({ ...buyerBill, ppa_contract_id: contract.id, cycle: items[0].cycle });
      }
    }
  })();
  return { checked: expired.length, settled: settled.length, as_of: today, items: settled, buyer_invoices: buyerBills };
}

/**
 * What is still banked for a contract, by cycle.
 *
 * Only energy on an open row is still drawable. Once a cycle has been settled or
 * expired the undrawn energy has been paid out in cash, and counting it as
 * available would offer a draw that drawBanked will always refuse.
 */
export function bankedPosition(contractId) {
  return db.prepare(`
    SELECT cycle, cycle_ends_on,
           (SELECT GROUP_CONCAT(DISTINCT i.invoice_no) FROM energy_banking b2 JOIN invoices i ON i.id = b2.settlement_invoice_id
             WHERE b2.contract_id = energy_banking.contract_id AND b2.cycle = energy_banking.cycle) AS settlement_invoice_no,
           ROUND(SUM(banked_mwh), 3) AS banked_mwh,
           ROUND(SUM(drawn_mwh), 3) AS drawn_mwh,
           ROUND(SUM(CASE WHEN status IN ('OPEN','DRAWN') THEN banked_mwh - drawn_mwh ELSE 0 END), 3) AS available_mwh,
           ROUND(SUM(settled_mwh), 3) AS settled_mwh,
           ROUND(SUM(settlement_amount), 2) AS settled_amount
    FROM energy_banking WHERE contract_id = ?
    GROUP BY cycle, cycle_ends_on ORDER BY cycle_ends_on
  `).all(contractId);
}
