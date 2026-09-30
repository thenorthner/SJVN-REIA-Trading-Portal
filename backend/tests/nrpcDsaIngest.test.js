/**
 * Storage tests for NRPC Deviation Settlement Accounts.
 *
 * Exercises storeParsedDsa directly, so no network and no PDFs: the parser has
 * its own tests, and what matters here is what reaches the database and how
 * reissues of a week are ordered against each other.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { storeParsedDsa, comparePrecedence, resolveWeekIdentity } from '../src/services/nrpcDsaIngest.js';

beforeEach(() => {
  db.prepare('DELETE FROM nrpc_dsa_accounts').run();
});

/** A minimal parsed statement, with knobs for the fields the tests vary. */
function parsed({ weekNo = 40, fy = '2025-26', issued = '2026-01-14', net = -8.37312 } = {}) {
  return {
    header: {
      week_no: weekNo,
      financial_year: fy,
      week_start: '2025-12-29',
      week_end: '2026-01-04',
      issued_date: issued,
      due_date: '2026-01-24',
    },
    entities: [{
      entity_name: 'NATHPA JHAKRI HEP',
      days: [
        { entry_date: '2025-12-29', schedule_lu: 74.3, actual_lu: 74.26546, devi_amt_lakh: net, sus_devi: null, sus_amount_lakh: null, add_devi_lakh: null, adj_lakh: 0, net_devi_lakh: net },
      ],
      total: { schedule_lu: 74.3, actual_lu: 74.26546, devi_amt_lakh: net, sus_devi: null, sus_amount_lakh: null, add_devi_lakh: null, adj_lakh: 0, net_devi_lakh: net },
    }],
    problems: [],
    warnings: [],
  };
}

const store = (p, opts = {}) => storeParsedDsa(p, {
  buffer: Buffer.from(opts.body || `pdf-${Math.random()}`),
  sourceKind: 'UPLOAD',
  createdBy: 'test',
  ...opts,
});

describe('storeParsedDsa', () => {
  it('stores the statement, its daily rows and its printed Totals', () => {
    const r = store(parsed());
    expect(r.stored).toBe(true);
    expect(r.entities).toBe(1);

    const acct = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(r.account_id);
    expect(acct).toMatchObject({ week_no: 40, financial_year: '2025-26', status: 'ACTIVE' });

    const day = db.prepare('SELECT * FROM nrpc_dsa_entity_days WHERE account_id = ?').get(r.account_id);
    // Stored in the statement's own units and sign — LU, Rs Lakh, and negative
    // for money SJVN receives. No conversion happens on the way in.
    expect(day.schedule_lu).toBeCloseTo(74.3, 5);
    expect(day.net_devi_lakh).toBeCloseTo(-8.37312, 5);
    expect(day.sus_devi).toBeNull();

    const total = db.prepare('SELECT * FROM nrpc_dsa_entity_totals WHERE account_id = ?').get(r.account_id);
    expect(total.net_devi_lakh).toBeCloseTo(-8.37312, 5);
  });

  it('refuses a statement that has problems', () => {
    const p = parsed();
    p.problems = ['Entity "X": devi_amt_lakh daily rows sum to 1 but the Total says 2'];
    expect(() => store(p)).toThrow(/Refusing to store/);
    expect(db.prepare('SELECT COUNT(*) c FROM nrpc_dsa_accounts').get().c).toBe(0);
  });

  it('refuses the same file twice, which is what makes a backfill re-runnable', () => {
    const first = store(parsed(), { body: 'identical' });
    const second = store(parsed(), { body: 'identical' });
    expect(first.stored).toBe(true);
    expect(second).toMatchObject({ stored: false, reason: 'DUPLICATE', account_id: first.account_id });
    expect(db.prepare('SELECT COUNT(*) c FROM nrpc_dsa_accounts').get().c).toBe(1);
  });

  it('supersedes the earlier statement when a reissue arrives', () => {
    const original = store(parsed({ issued: '2026-01-14' }), { body: 'a' });
    const reissue = store(parsed({ issued: '2026-01-21', net: -9.5 }), { body: 'b' });

    const rows = db.prepare('SELECT id, status, superseded_by FROM nrpc_dsa_accounts').all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[original.account_id]).toMatchObject({ status: 'SUPERSEDED', superseded_by: reissue.account_id });
    expect(byId[reissue.account_id].status).toBe('ACTIVE');
  });

  it('decides by issue date, so a backfill that arrives out of order still lands right', () => {
    // The reissue is stored first, as happens when the archive is walked in
    // dropdown order rather than by date.
    const reissue = store(parsed({ issued: '2026-01-21' }), { body: 'b' });
    const original = store(parsed({ issued: '2026-01-14' }), { body: 'a' });

    const byId = Object.fromEntries(
      db.prepare('SELECT id, status, superseded_by FROM nrpc_dsa_accounts').all().map((r) => [r.id, r]),
    );
    expect(byId[reissue.account_id].status).toBe('ACTIVE');
    expect(byId[original.account_id]).toMatchObject({ status: 'SUPERSEDED', superseded_by: reissue.account_id });
  });

  it('leaves a different week alone', () => {
    store(parsed({ weekNo: 39 }), { body: 'a' });
    store(parsed({ weekNo: 40 }), { body: 'b' });
    const active = db.prepare("SELECT COUNT(*) c FROM nrpc_dsa_accounts WHERE status = 'ACTIVE'").get().c;
    expect(active).toBe(2);
  });

  it('lets a dateless reissue supersede the original it revises', () => {
    // Reissues are often published as data only, with no covering letter and
    // so no issue date. Ordering on date alone would put them behind the
    // statement they replace.
    const original = store(parsed({ issued: '2021-09-15' }), { body: 'a', weekCode: '160821-220821(WK-21)' });
    const revision = store(parsed({ issued: null }), { body: 'b', weekCode: '160821-220821(WK-21)_R1' });

    const byId = Object.fromEntries(
      db.prepare('SELECT id, status FROM nrpc_dsa_accounts').all().map((r) => [r.id, r.status]),
    );
    expect(byId[revision.account_id]).toBe('ACTIVE');
    expect(byId[original.account_id]).toBe('SUPERSEDED');
  });

  it('records where the statement came from', () => {
    const r = store(parsed(), {
      sourceKind: 'ARCHIVE',
      sourceUrl: 'https://nrpc.gov.in/comm/2021-22/dsa/291225-040126(WK-40)/dsa.pdf',
      weekCode: '291225-040126(WK-40)_R1',
      fileName: '291225-040126(WK-40)-dsa.pdf',
    });
    const acct = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(r.account_id);
    expect(acct.source_kind).toBe('ARCHIVE');
    expect(acct.week_code).toBe('291225-040126(WK-40)_R1');
    expect(acct.revision).toBe('R1');
    expect(acct.file_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('comparePrecedence', () => {
  it.each([
    ['a revision beats the original', { revision: 'R1' }, { revision: null }],
    ['a later revision beats an earlier one', { revision: 'R2' }, { revision: 'R1' }],
    ['a corrigendum beats a revision', { revision: 'Corrigendum' }, { revision: 'R2' }],
    ['a dateless revision still beats a dated original', { revision: 'R1', issued_date: null }, { revision: null, issued_date: '2021-09-15' }],
    ['issue date breaks ties within a rank', { revision: null, issued_date: '2026-01-21' }, { revision: null, issued_date: '2026-01-14' }],
  ])('%s', (_label, winner, loser) => {
    expect(comparePrecedence(winner, loser)).toBeGreaterThan(0);
    expect(comparePrecedence(loser, winner)).toBeLessThan(0);
  });
});

describe('resolveWeekIdentity', () => {
  it('copies the week number and year from a statement held for the same dates', () => {
    store(parsed({ weekNo: 40, fy: '2025-26' }), { body: 'a' });
    const got = resolveWeekIdentity(
      { week_no: null, financial_year: null, week_start: '2025-12-29', week_end: '2026-01-04' },
      null,
    );
    expect(got).toEqual({ week_no: 40, financial_year: '2025-26' });
  });

  it('falls back to the week number in the archive code', () => {
    store(parsed({ weekNo: 40, fy: '2025-26' }), { body: 'a' });
    const got = resolveWeekIdentity(
      { week_no: null, financial_year: null, week_start: '2025-12-22', week_end: '2025-12-28' },
      '221225-281225(WK-39)_R1',
    );
    // Week number off the code; year off the nearby statement already held.
    expect(got).toEqual({ week_no: 39, financial_year: '2025-26' });
  });

  it('resolves nothing when there is nothing to resolve from', () => {
    const got = resolveWeekIdentity(
      { week_no: null, financial_year: null, week_start: '2025-12-29', week_end: '2026-01-04' },
      null,
    );
    expect(got).toEqual({ week_no: null, financial_year: null });
  });
});
