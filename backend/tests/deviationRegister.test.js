import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { summary, scorecard, incidents, runDeviationAlerts } from '../src/services/deviationRegister.js';

const CONTRACT = 'TEST_LOA';

function day(date, requested, scheduled, sellerShort = 0, buyerShort = 0) {
  db.prepare(`
    INSERT INTO schedule_deviations (id, contract_ref, counterparty, schedule_date,
      availability_mwh, requested_mwh, scheduled_mwh, buyer_default_mwh, seller_default_mwh)
    VALUES (?, ?, 'Test Seller', ?, ?, ?, ?, ?, ?)
  `).run(`SD-${date}`, CONTRACT, date, 2000, requested, scheduled, buyerShort, sellerShort);
}

beforeEach(() => {
  db.prepare('DELETE FROM schedule_deviations').run();
  db.prepare("DELETE FROM notifications WHERE type = 'SCHEDULE_DEVIATION'").run();
});

describe('summary', () => {
  it('reports full reliability when nothing was missed', () => {
    day('2026-05-01', 1000, 1000);
    day('2026-05-02', 1000, 1000);
    const s = summary();
    expect(s.days).toBe(2);
    expect(s.seller_reliability_pct).toBe(100);
    expect(s.seller_default_days).toBe(0);
  });

  it('measures reliability as the delivered share of what was requested', () => {
    day('2026-05-01', 1000, 900, 100);
    const s = summary();
    expect(s.seller_default_mwh).toBe(100);
    expect(s.seller_shortfall_pct).toBe(10);
    expect(s.seller_reliability_pct).toBe(90);
  });

  it('keeps the two sides apart', () => {
    day('2026-05-01', 1000, 900, 100, 0);
    day('2026-05-02', 1000, 950, 0, 50);
    const s = summary();
    expect(s.seller_default_mwh).toBe(100);
    expect(s.buyer_default_mwh).toBe(50);
    expect(s.seller_default_days).toBe(1);
    expect(s.buyer_default_days).toBe(1);
  });

  it('honours a date filter', () => {
    day('2026-05-01', 1000, 1000);
    day('2026-06-01', 1000, 1000);
    expect(summary({ from: '2026-06-01' }).days).toBe(1);
  });

  it('does not divide by zero on an empty period', () => {
    const s = summary();
    expect(s.days).toBe(0);
    expect(s.seller_reliability_pct).toBe(100);
  });
});

describe('scorecard', () => {
  it('grades on delivered share', () => {
    day('2026-05-01', 10000, 9990, 10);        // 99.9% -> A
    expect(scorecard()[0].grade).toBe('A');

    db.prepare('DELETE FROM schedule_deviations').run();
    day('2026-05-01', 10000, 9900, 100);       // 99% -> B
    expect(scorecard()[0].grade).toBe('B');

    db.prepare('DELETE FROM schedule_deviations').run();
    day('2026-05-01', 10000, 9700, 300);       // 97% -> C
    expect(scorecard()[0].grade).toBe('C');

    db.prepare('DELETE FROM schedule_deviations').run();
    day('2026-05-01', 10000, 9000, 1000);      // 90% -> D
    expect(scorecard()[0].grade).toBe('D');
  });

  it('counts incident days and the worst one', () => {
    day('2026-05-01', 1000, 900, 100);
    day('2026-05-02', 1000, 500, 500);
    day('2026-05-03', 1000, 1000);
    const s = scorecard()[0];
    expect(s.incident_days).toBe(2);
    expect(s.worst_shortfall_mwh).toBe(500);
  });
});

describe('incidents', () => {
  it('lists only days a side defaulted, worst first', () => {
    day('2026-05-01', 1000, 900, 100);
    day('2026-05-02', 1000, 500, 500);
    day('2026-05-03', 1000, 1000);
    const list = incidents();
    expect(list).toHaveLength(2);
    expect(list[0].seller_default_mwh).toBe(500);
  });
});

describe('runDeviationAlerts', () => {
  const raised = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE type = 'SCHEDULE_DEVIATION'").get().c;

  it('raises an alert above the threshold and stays quiet below it', () => {
    day('2026-05-01', 1000, 900, 100);   // 10% -> alert
    day('2026-05-02', 1000, 990, 10);    // 1%  -> no alert
    const r = runDeviationAlerts();
    expect(r.checked).toBe(2);
    expect(r.alerted).toBe(1);
    expect(raised()).toBe(1);
  });

  it('raises each incident once, not on every sweep', () => {
    day('2026-05-01', 1000, 900, 100);
    runDeviationAlerts();
    const second = runDeviationAlerts();
    expect(second.alerted).toBe(0);
    expect(raised()).toBe(1);
  });

  it('settles below-threshold days so they are not re-examined', () => {
    day('2026-05-01', 1000, 990, 10);
    runDeviationAlerts();
    expect(runDeviationAlerts().checked).toBe(0);
  });

  it('names the side and the size in the message', () => {
    day('2026-05-01', 1000, 500, 500);
    runDeviationAlerts();
    const msg = db.prepare("SELECT message FROM notifications WHERE type = 'SCHEDULE_DEVIATION'").get().message;
    expect(msg).toMatch(/Test Seller/);
    expect(msg).toMatch(/500/);
    expect(msg).toMatch(/50\.0%/);
  });

  it('ignores days where nothing was missed', () => {
    day('2026-05-01', 1000, 1000);
    expect(runDeviationAlerts().checked).toBe(0);
  });
});
