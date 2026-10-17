import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, resetReia } from '../helpers/reia.js';

// Found by the browser audit of the CERC compliance desk (17-Oct-2026): the
// trading desk, which prepares and files Form-IV, was refused the calendar it is
// accountable for; a month nobody had started showed no breaches whatever its
// trades; and a reversed range returned an empty calendar.

const trade = (start, end, sale, purchase) => db.prepare(`
  INSERT INTO bilateral_transactions (id, counterparty, quantum_mw, tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit, start_date, end_date)
  VALUES (?, 'QA Buyer', 10, ?, ?, ?, ?, ?, ?)`).run(newId('BT'), sale, purchase, sale, Math.round((sale - purchase) * 1e4) / 1e4, start, end);
const cerc = (q = '', who) => request(app).get(`/api/reports/cerc-compliance${q}`).set(auth(who));

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM cerc_form_iv').run();
  try { db.prepare('DELETE FROM bids').run(); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM bilateral_transactions').run(); } catch { /* ignore */ }
});

describe('S53 The CERC filing calendar', () => {
  it('is open to the trading desk that files the return, and closed to counterparties', async () => {
    trade('2026-07-01', '2026-07-31', 4.4, 4.37);
    expect((await cerc('', tokenFor('TRADING_USER'))).status).toBe(200);
    const seller = signToken(makeUser('SELLER', { linked_entity_id: makeEntity('SELLER').id }));
    expect((await cerc('', seller)).status).toBe(403);
  });

  it('counts the trades and the cap breaches of a month nobody has started, from the trade book', async () => {
    trade('2026-07-01', '2026-07-31', 4.4, 4.37); // 3 paise: within the 7-paise cap above ₹3
    trade('2026-07-01', '2026-07-31', 2.9, 2.8); // 10 paise on a ₹2.90 sale: over the 4-paise cap
    const { body } = await cerc('?from=2026-06&to=2026-07', tokenFor('REIA_USER'));
    const july = body.monthly.find((r) => r.period === '2026-07');
    const june = body.monthly.find((r) => r.period === '2026-06');
    expect(july).toMatchObject({ status: 'MISSING', trade_count: 2, breach_count: 1, breaches_from: 'TRADE_BOOK', nil_return: false });
    expect(june).toMatchObject({ status: 'MISSING', trade_count: 0, nil_return: true });
    expect(body.totals.open_breaches).toBeGreaterThanOrEqual(1);
  });

  it('refuses a reversed or malformed range instead of showing an empty calendar', async () => {
    const reia = tokenFor('REIA_USER');
    const reversed = await cerc('?from=2026-09&to=2026-07', reia);
    expect(reversed.status).toBe(400);
    expect(reversed.body.error).toMatch(/starts \(2026-09\) after it ends \(2026-07\)/);
    expect((await cerc('?from=2026-13', reia)).status).toBe(400);
  });
});

describe('S53 When a return is due', () => {
  it('owes a monthly return by the 15th of the next month, and the annual one by 30 April', async () => {
    trade('2025-03-01', '2025-03-31', 4.4, 4.37);
    const { body } = await cerc('?from=2025-03&to=2025-12', tokenFor('REIA_USER'));
    expect(body.monthly.find((r) => r.period === '2025-03').due_date).toBe('2025-04-15');
    expect(body.monthly.find((r) => r.period === '2025-12').due_date).toBe('2026-01-15');
    expect(body.annual.find((r) => r.period === '2024-25').due_date).toBe('2025-04-30');
  });

  it('stores on a new return the same date the calendar shows', async () => {
    const reia = tokenFor('REIA_USER');
    const r = await request(app).post('/api/form-iv').set(auth(tokenFor('TRADING_USER'))).send({ period_type: 'MONTHLY', period: '2026-02', auto_generate: false });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(db.prepare(`SELECT due_date FROM cerc_form_iv WHERE period = '2026-02'`).get().due_date).toBe('2026-03-15');
    const feb = (await cerc('?from=2026-02&to=2026-02', reia)).body.monthly[0];
    expect(feb.due_date).toBe('2026-03-15');
  });
});
