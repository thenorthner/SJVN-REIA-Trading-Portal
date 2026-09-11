import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { makeUser } from './helpers/reia.js';
import { distributeMonthlyMis } from '../src/services/misDistribution.js';

// The monthly MIS pack: rendered, attached, and sent to the executive group.

const OCT_1 = new Date('2026-10-01T03:30:00Z');
const capture = () => {
  const sent = [];
  const send = async (m) => { sent.push(m); return { ok: true, mode: 'TEST' }; };
  return { sent, send };
};

beforeEach(() => {
  // Users an earlier test here created are removed, and whoever the fixtures
  // seeded is set aside, so each test decides the audience itself.
  db.prepare("DELETE FROM users WHERE email LIKE '%.test' OR email = ''").run();
  db.prepare('UPDATE users SET is_active = 0').run();
});

describe('monthly MIS distribution', () => {
  it('sends the MIS and REIA dashboard PDFs to the executive group and nobody else', async () => {
    makeUser('MANAGEMENT', { email: 'md@sjvn.test' });
    makeUser('FINANCE_USER', { email: 'cfo@sjvn.test' });
    makeUser('SELLER', { email: 'seller@gen.test' });
    makeUser('TRADING_USER', { email: 'desk@sjvn.test' });
    const { sent, send } = capture();

    const r = await distributeMonthlyMis({ now: OCT_1, send });

    expect(r).toMatchObject({ sent: true, period: '2026-09', recipients: 2, mode: 'TEST' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['cfo@sjvn.test', 'md@sjvn.test']);
    expect(sent[0].subject).toBe('SJVN monthly MIS — September 2026');
    expect(sent[0].attachments.map((a) => a.filename)).toEqual(['SJVN_MIS_2026-09.pdf', 'SJVN_REIA_Dashboard_2026-09.pdf']);
    for (const a of sent[0].attachments) {
      expect(a.content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(a.content.length).toBeGreaterThan(1000);
    }
  });

  it('leaves out inactive users and users without an email address', async () => {
    makeUser('MANAGEMENT', { email: 'md@sjvn.test' });
    const gone = makeUser('MANAGEMENT', { email: 'former@sjvn.test' });
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(gone.id);
    const blank = makeUser('SJVN_ADMIN');
    db.prepare("UPDATE users SET email = '' WHERE id = ?").run(blank.id);
    const { sent, send } = capture();

    await distributeMonthlyMis({ now: OCT_1, send });
    expect(sent[0].to).toEqual(['md@sjvn.test']);
  });

  it('does not claim to have sent anything when nobody is entitled to it', async () => {
    const r = await distributeMonthlyMis({ now: OCT_1, send: async () => { throw new Error('must not send'); } });
    expect(r).toEqual({ sent: false, period: '2026-09', reason: 'no active executive user has an email address' });
  });

  it('reports a failed send as failed', async () => {
    makeUser('MANAGEMENT', { email: 'md@sjvn.test' });
    const r = await distributeMonthlyMis({
      now: OCT_1, send: async () => ({ ok: false, mode: 'SMTP', error: 'connection refused' }),
    });
    expect(r).toMatchObject({ sent: false, error: 'connection refused' });
  });

  it('records each distribution in the audit trail', async () => {
    makeUser('MANAGEMENT', { email: 'md@sjvn.test' });
    await distributeMonthlyMis({ now: OCT_1, send: capture().send });
    const row = db.prepare(`SELECT * FROM audit_logs WHERE action = 'DISTRIBUTE_MIS' ORDER BY rowid DESC LIMIT 1`).get();
    expect(row.entity_id).toBe('2026-09');
    expect(JSON.parse(row.details)).toMatchObject({ recipients: 1, ok: true });
  });
});
