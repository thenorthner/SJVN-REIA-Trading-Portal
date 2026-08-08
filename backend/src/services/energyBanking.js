import db from '../db/index.js';
import { newId } from '../util.js';
import { getParamNumber } from '../mastersService.js';

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
export function bankEnergy({ contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on, createdBy }) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) throw new Error('Contract not found');
  const mwh = Number(banked_mwh);
  if (!Number.isFinite(mwh) || mwh <= 0) throw new Error('banked_mwh must be a positive number');
  if (!cycle_ends_on) throw new Error('cycle_ends_on is required — banked energy has to expire somewhere');

  const id = newId('BNK');
  db.prepare(`
    INSERT INTO energy_banking (id, contract_id, cycle, period_month, banked_mwh, tariff_per_unit,
      cycle_ends_on, settlement_pct, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).run(id, contract_id, cycle, period_month || null, mwh,
    Number(tariff_per_unit ?? contract.tariff_per_unit) || 0, cycle_ends_on, settlementPct(), createdBy || null);
  return db.prepare('SELECT * FROM energy_banking WHERE id = ?').get(id);
}

/** Draw banked energy back out, oldest first, within the cycle. */
export function drawBanked({ contract_id, cycle, draw_mwh }) {
  let remaining = Number(draw_mwh);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('draw_mwh must be a positive number');

  const open = db.prepare(`
    SELECT * FROM energy_banking
    WHERE contract_id = ? AND cycle = ? AND status IN ('OPEN','DRAWN')
    ORDER BY created_at
  `).all(contract_id, cycle);

  const available = open.reduce((s, r) => s + (r.banked_mwh - r.drawn_mwh), 0);
  if (remaining > available) {
    throw new Error(`Only ${available} MWh is banked for this cycle; cannot draw ${remaining} MWh.`);
  }

  const drawn = [];
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
      drawn.push({ id: row.id, drawn_mwh: take });
    }
  })();
  return { drawn, remaining_unfilled: remaining };
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
  db.transaction(() => {
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
      settled.push({
        id: row.id, contract_id: row.contract_id, cycle: row.cycle,
        unused_mwh: unused, settlement_pct: pct, settled_rate: rate, settlement_amount: amount,
      });
    }
  })();
  return { checked: expired.length, settled: settled.length, as_of: today, items: settled };
}

/** What is still banked for a contract, by cycle. */
export function bankedPosition(contractId) {
  return db.prepare(`
    SELECT cycle, cycle_ends_on,
           ROUND(SUM(banked_mwh), 3) AS banked_mwh,
           ROUND(SUM(drawn_mwh), 3) AS drawn_mwh,
           ROUND(SUM(banked_mwh - drawn_mwh), 3) AS available_mwh,
           ROUND(SUM(settlement_amount), 2) AS settled_amount
    FROM energy_banking WHERE contract_id = ?
    GROUP BY cycle, cycle_ends_on ORDER BY cycle_ends_on
  `).all(contractId);
}
