import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import { timeBlockNumber } from '../src/routes/isetReports.js';

const TX = 'BT-SCHED-RPT';
const CLIENT = 'TCL-SCHED-RPT';

beforeEach(() => {
  db.prepare('DELETE FROM bilateral_approvals').run();
  db.prepare('DELETE FROM bilateral_schedules').run();
  db.prepare('DELETE FROM bilateral_order_details').run();
  db.prepare('DELETE FROM daily_schedule_entries').run();
  db.prepare('DELETE FROM implemented_schedule_summary').run();
  db.prepare('DELETE FROM implemented_schedule_blocks').run();
  db.prepare('DELETE FROM bilateral_transactions WHERE id = ?').run(TX);
  db.prepare('DELETE FROM trading_clients WHERE id = ?').run(CLIENT);
  db.prepare("INSERT INTO trading_clients (id, name, client_type) VALUES (?, 'NDMC Report', 'DISCOM')").run(CLIENT);
  db.prepare(`
    INSERT INTO bilateral_transactions (
      id, client_id, counterparty, loa_no, loi_contract_ref, quantum_mw, tariff_per_unit,
      sale_rate_per_unit, start_date, end_date, supplier_name, procurer_name,
      supplier_sldc, procurer_sldc, noar_contract_no, status
    ) VALUES (?, ?, 'Teesta Urja', 'LOA/RPT/001', 'LOI-TEESTA-1', 80, 4.5, 4.5,
      '2026-09-01', '2026-09-07', 'Teesta Urja Ltd', 'New Delhi Municipal Council',
      'West Bengal', 'Delhi', 'NOAR-RPT-9', 'ACTIVE')
  `).run(TX, CLIENT);
});

function punch(block, mw, extra = {}) {
  db.prepare(`
    INSERT INTO bilateral_schedules
      (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, actual_mw, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    extra.id || newId('SCH'), TX, extra.date || '2026-09-01', block, mw,
    extra.curtailed ?? 0, extra.actual ?? null, extra.status || 'APPROVED',
  );
}

describe('timeBlockNumber', () => {
  it('maps a 15-minute label onto ISET block 1..96', () => {
    expect(timeBlockNumber('00:00-00:15')).toBe(1);
    expect(timeBlockNumber('18:00-18:15')).toBe(73);
    expect(timeBlockNumber('23:45-00:00')).toBe(96);
  });
});

describe('GET /api/iset-reports schedule kinds', () => {
  it('builds the daily schedule from punched bilateral_schedules, not the ISET seed table', async () => {
    punch('18:00-18:15', 80);
    punch('18:15-18:30', 80);
    db.prepare(`
      INSERT INTO daily_schedule_entries (id, buyer_contract, seller_contract, delivery_from, delivery_to)
      VALUES ('DSC-FAKE', 'FAKE-BUY', 'FAKE-SELL', '2026-01-01', '2026-01-01')
    `).run();

    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/iset-reports/daily-schedule').set(auth(trader));
    expect(r.status).toBe(200);
    const live = r.body.filter((row) => row.source === 'bilateral_schedules');
    expect(live).toHaveLength(1);
    expect(live[0].buyer_contract).toBe('LOA/RPT/001');
    // 2 blocks × 80 MW × 0.25 h
    expect(live[0].seller_availability).toBe(40);
    expect(live[0].buyer_request).toBe(40);
    expect(r.body.some((row) => row.buyer_contract === 'FAKE-BUY')).toBe(true);
  });

  it('values implemented summary at actual MW when metered', async () => {
    punch('18:00-18:15', 80, { actual: 70 });
    punch('18:15-18:30', 80, { actual: 70 });
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/iset-reports/implemented-schedule').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].seller_name).toBe('Teesta Urja Ltd');
    expect(r.body[0].buyer_name).toBe('New Delhi Municipal Council');
    expect(r.body[0].seller_schedule_mwh).toBe(35);
    expect(r.body[0].source).toBe('bilateral_schedules');
  });

  it('expands one row per 15-minute block for the block-wise report', async () => {
    punch('18:00-18:15', 80);
    punch('18:15-18:30', 40, { curtailed: 10, actual: 30 });
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/iset-reports/implemented-block-wise').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    const a = r.body.find((row) => row.time_block === 73);
    const b = r.body.find((row) => row.time_block === 74);
    expect(a.seller_schedule_mw).toBe(80);
    expect(b.seller_schedule_mw).toBe(30);
    expect(a.seller_state).toBe('West Bengal');
    expect(a.buyer_state).toBe('Delhi');
    expect(a.approval_no).toBe('NOAR-RPT-9');
    expect(r.body.every((row) => row.source === 'bilateral_schedules')).toBe(true);
  });

  it('does not leak the implemented seed tables once punches exist', async () => {
    punch('00:00-00:15', 10);
    db.prepare(`
      INSERT INTO implemented_schedule_summary
        (id, reading_date, seller_name, buyer_name, seller_schedule_mwh, buyer_schedule_mwh)
      VALUES ('ISS-FAKE', '2020-01-01', 'Seed Seller', 'Seed Buyer', 999, 999)
    `).run();
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/iset-reports/implemented-schedule').set(auth(trader));
    expect(r.body.some((row) => row.seller_name === 'Seed Seller')).toBe(false);
  });
});
