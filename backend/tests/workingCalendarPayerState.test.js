import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId, computeDueDate, contractRebatePct } from '../src/util.js';
import { ensureMasterDefaults, invalidateParamCache } from '../src/mastersService.js';
import {
  clearHolidayCache, isWorkingDay, payerStateFor, payerStateForInvoice, windowEnd, stateNamed,
} from '../src/services/workingCalendar.js';
import { tieredRebatePctOn } from '../src/disputesConstants.js';
import { rebateRateOn } from '../src/routes/invoices.js';
import { beneficiaryState, dueDateFor, rebateRateFor } from '../src/services/hydroLedger.js';
import { makeEntity, makeContract, makeInvoice, tokenFor, auth } from './helpers/reia.js';

// A bill falls due, and its rebate window closes, on the payer's calendar:
// weekly offs, national holidays and the payer's own state's holidays.
//
// The April 2026 week these tests turn on, from the seeded calendar:
//   Sun 12  weekly off
//   Mon 13  Baisakhi — Punjab only
//   Tue 14  Ambedkar Jayanti — national
//   Wed 15  Himachal Day — Himachal Pradesh only (SJVN's own state)
//   Thu 16  open everywhere

const setParam = (key, value, type = 'TEXT') => {
  const row = db.prepare('SELECT id FROM system_parameters WHERE param_key = ?').get(key);
  if (row) db.prepare('UPDATE system_parameters SET param_value = ?, is_active = 1 WHERE id = ?').run(value, row.id);
  else {
    db.prepare(`INSERT INTO system_parameters (id, category, param_key, param_value, data_type, unit, description, effective_from, is_active)
      VALUES (?, 'BILLING', ?, ?, ?, '', '', date('now'), 1)`).run(newId('PRM'), key, value, type);
  }
  invalidateParamCache();
};

const entityIn = (type, state) => {
  const e = makeEntity(type);
  db.prepare('UPDATE entities SET state = ? WHERE id = ?').run(state, e.id);
  return e;
};

let punjab;
let haryana;

beforeAll(() => {
  ensureMasterDefaults();
  // An optional holiday on an otherwise open Thursday: shown on the calendar,
  // closes nothing.
  db.prepare(`INSERT OR IGNORE INTO holidays (id, holiday_date, name, scope, state, holiday_type, is_active)
    VALUES (?, '2026-04-16', 'Test optional day', 'STATE', 'Punjab', 'RESTRICTED', 1)`).run(newId('HOL'));
  punjab = entityIn('BUYER', 'Punjab');
  haryana = entityIn('BUYER', 'HARYANA'); // typed in capitals, as entity rows often are
});

beforeEach(() => {
  setParam('due_date_counting_mode', 'CALENDAR_ROLL_FORWARD');
  setParam('lps_day_count_mode', 'CALENDAR');
  setParam('weekly_off_days', '[0,6]', 'JSON');
  setParam('sjvn_payer_state', 'Himachal Pradesh');
  setParam('early_payment_rebate_tiers', '[{"within_days":5,"pct":1.5},{"within_days":30,"pct":1}]', 'JSON');
  clearHolidayCache();
});

describe('which calendar governs a bill', () => {
  it('is the buyer\'s state when SJVN bills a buyer', () => {
    const psa = makeContract({ contract_type: 'PSA', buyer_id: punjab.id });
    expect(payerStateFor(psa, 'SJVN_TO_BUYER')).toBe('Punjab');
    expect(payerStateFor(psa)).toBe('Punjab'); // a PSA says the direction itself
  });

  it('is SJVN\'s own state when a seller bills SJVN — not the seller\'s', () => {
    const seller = entityIn('SELLER', 'Rajasthan');
    const ppa = makeContract({ contract_type: 'PPA', seller_id: seller.id });
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN' });
    expect(payerStateForInvoice(inv)).toBe('Himachal Pradesh');
    expect(payerStateFor(ppa)).toBe('Himachal Pradesh');
  });

  it('falls back to the national calendar when the buyer\'s state was never captured', () => {
    const psa = makeContract({ contract_type: 'PSA' });
    expect(payerStateFor(psa)).toBeNull();
  });
});

describe('the holiday calendar itself', () => {
  it('matches a state however its name was typed', () => {
    expect(isWorkingDay('2026-04-13', 'punjab')).toBe(false);
    expect(isWorkingDay('2026-04-13', 'PUNJAB')).toBe(false);
    expect(isWorkingDay('2026-04-13', 'Haryana')).toBe(true);
  });

  it('does not close an office for a restricted (optional) holiday', () => {
    expect(isWorkingDay('2026-04-16', 'Punjab')).toBe(true);
  });

  it('reads a state off billing names', () => {
    expect(stateNamed('PUNJAB')).toBe('Punjab');
    expect(stateNamed('j & k')).toBe('Jammu and Kashmir');
    expect(stateNamed('Nowhere')).toBeNull();
  });
});

describe('due date rolls past the payer\'s closed days', () => {
  // 30 days from 14 Mar is Mon 13 Apr.
  const terms = { payment_terms_days: 30 };

  it('moves a Punjab buyer\'s bill past Baisakhi and Ambedkar Jayanti', () => {
    const psa = makeContract({ contract_type: 'PSA', buyer_id: punjab.id, payment_terms_days: 30 });
    expect(computeDueDate('2026-03-14', psa)).toBe('2026-04-15');
  });

  it('leaves a Haryana buyer\'s bill on the 13th, which is open there', () => {
    const psa = makeContract({ contract_type: 'PSA', buyer_id: haryana.id, payment_terms_days: 30 });
    expect(computeDueDate('2026-03-14', psa)).toBe('2026-04-13');
  });

  it('moves a seller\'s bill past Himachal Day, because SJVN pays it', () => {
    const ppa = makeContract({ contract_type: 'PPA', payment_terms_days: 30 });
    // 30 days from 16 Mar is Wed 15 Apr.
    expect(computeDueDate('2026-03-16', ppa)).toBe('2026-04-16');
    // Asked for on the national calendar alone, it stays.
    expect(computeDueDate('2026-03-16', ppa, 30, null)).toBe('2026-04-15');
  });

  it('counts calendar days and moves only the last one by default', () => {
    db.prepare("DELETE FROM system_parameters WHERE param_key = 'due_date_counting_mode'").run();
    invalidateParamCache();
    const psa = makeContract({ contract_type: 'PSA', buyer_id: haryana.id, ...terms });
    expect(computeDueDate('2026-03-14', psa)).toBe('2026-04-13');
  });

  it('rolls a hydro station bill off a weekly off', () => {
    const c = { payment_terms_days: 30 };
    // 30 days from 13 Mar is Sun 12 Apr; Mon 13 is open nationally.
    expect(dueDateFor(c, '2026-03-13')).toBe('2026-04-13');
    // For Punjab it runs on past Baisakhi and Ambedkar Jayanti.
    expect(dueDateFor(c, '2026-03-13', 'Punjab')).toBe('2026-04-15');
  });
});

describe('rebate window closes on the payer\'s calendar', () => {
  // Presented Tue 7 Apr: day 5 is Sun 12 Apr.
  const terms = { rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE' };

  it('ends on the payer\'s next working day', () => {
    expect(windowEnd('2026-04-07', 5, null)).toBe('2026-04-13');
    expect(windowEnd('2026-04-07', 5, 'Haryana')).toBe('2026-04-13');
    expect(windowEnd('2026-04-07', 5, 'Punjab')).toBe('2026-04-15');
  });

  it('still earns a Punjab buyer the contract rebate on the 15th, but not a Haryana buyer', () => {
    expect(contractRebatePct(terms, { billDate: '2026-04-07', payDate: new Date('2026-04-15'), state: 'Punjab' })).toBe(1.5);
    expect(contractRebatePct(terms, { billDate: '2026-04-07', payDate: new Date('2026-04-15'), state: 'Haryana' })).toBe(0);
    expect(contractRebatePct(terms, { billDate: '2026-04-07', payDate: new Date('2026-04-13'), state: 'Haryana' })).toBe(1.5);
  });

  it('applies the same to the CERC tiers', () => {
    const tiers = [{ within_days: 5, pct: 1.5 }, { within_days: 30, pct: 1 }];
    expect(tieredRebatePctOn('2026-04-07', '2026-04-13', tiers, null)).toBe(1.5);
    expect(tieredRebatePctOn('2026-04-07', '2026-04-15', tiers, 'Punjab')).toBe(1.5);
    expect(tieredRebatePctOn('2026-04-07', '2026-04-15', tiers, 'Haryana')).toBe(1);
    expect(tieredRebatePctOn('2026-04-07', '2026-06-01', tiers, 'Punjab')).toBe(0);
    expect(tieredRebatePctOn('2026-04-07', '2026-04-15', [], 'Punjab')).toBeNull();
  });

  it('gives a seller\'s bill its 1.5% when day 5 is Himachal Day and SJVN pays the day after', () => {
    // No contract rebate terms, so the master tiers apply. Presented Fri 10 Apr:
    // day 5 is Wed 15 Apr, Himachal Day, so SJVN's window runs to Thu 16.
    const ppa = makeContract({ contract_type: 'PPA' });
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', issued_at: '2026-04-10 10:00:00', total_amount: 100000, energy_charges: 100000 });
    expect(rebateRateOn(inv, new Date('2026-04-16'))).toBeCloseTo(0.015, 6);
    expect(rebateRateOn(inv, new Date('2026-04-17'))).toBeCloseTo(0.01, 6);
  });
});

describe('hydro beneficiaries pay on their own state\'s calendar', () => {
  it('knows each billing party\'s state', () => {
    expect(beneficiaryState({ beneficiary_name: 'PUNJAB' })).toBe('Punjab');
    expect(beneficiaryState({ beneficiary_name: 'GoHP' })).toBe('Himachal Pradesh');
    expect(beneficiaryState({ beneficiary_name: 'AJMER VVNL' })).toBe('Rajasthan');
    expect(beneficiaryState({ beneficiary_name: 'BSES YAMUNA POWER' })).toBe('Delhi');
    expect(beneficiaryState({ beneficiary_name: 'BIHAR (NBPDCL/SBPDCL)' })).toBe('Bihar');
    expect(beneficiaryState({ beneficiary_name: 'X DISCOM', parent_state: 'RAJASTHAN' })).toBe('Rajasthan');
    expect(beneficiaryState({ beneficiary_name: 'PTC India Ltd' })).toBeNull();
  });

  it('extends a hydro rebate window past the beneficiary\'s holidays', () => {
    const c = makeContract({ project_type: 'Hydro', rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE' });
    const pb = (name) => ({ contract_id: c.id, doc_date: '2026-04-07', due_date: '2026-05-07', beneficiary_name: name, bill_line_id: null });
    expect(rebateRateFor(pb('PUNJAB'), '2026-04-15').pct).toBe(1.5);
    // Haryana's window shut on the 13th; the CERC 30-day tier still gives 1%.
    expect(rebateRateFor(pb('HARYANA'), '2026-04-15').pct).toBe(1);
  });
});

describe('holiday calendar API', () => {
  it('says how surcharge days are counted', async () => {
    const res = await request(app).get('/api/masters/holidays/settings').set(auth(tokenFor('REIA_USER')));
    expect(res.status).toBe(200);
    expect(res.body.due_date_counting_mode).toBe('CALENDAR_ROLL_FORWARD');
    expect(res.body.lps_day_count_mode).toBe('CALENDAR');
  });

  it('marks the rolled due date in the calendar-day preview', async () => {
    const res = await request(app).get('/api/masters/holidays/due-date-preview')
      .query({ bill_date: '2026-03-14', terms_days: 30, state: 'Punjab' })
      .set(auth(tokenFor('REIA_USER')));
    expect(res.status).toBe(200);
    expect(res.body.due_date).toBe('2026-04-15');
    expect(res.body.shifted_from).toBe('2026-04-13');
    const byDate = Object.fromEntries(res.body.daily_breakdown.map((b) => [b.date, b]));
    // Day 30 is Baisakhi in Punjab: counted, but not the due date.
    expect(byDate['2026-04-13'].status).toBe('COUNTED');
    expect(byDate['2026-04-13'].day_number).toBe(30);
    expect(byDate['2026-04-14'].status).toBe('ROLLED');
    expect(byDate['2026-04-15'].status).toBe('DUE_DATE');
    // A weekend inside the term still counts in calendar mode.
    expect(byDate['2026-03-15'].status).toBe('COUNTED');
  });
});
