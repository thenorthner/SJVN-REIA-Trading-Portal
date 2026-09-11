/**
 * The audit trail is the platform's evidence about itself, so the tests here
 * are about two things: that tampering is still detected after the verification
 * was made to stream rather than to load the table, and that the one-time
 * repair stays one-time — a chain that breaks later must stay visibly broken
 * instead of being quietly rebuilt into looking fine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { getMeta } from '../src/db/meta.js';
import {
  secureLogAudit,
  verifyLogIntegrity,
  verifyRecentIntegrity,
  rebuildAuditChain,
  repairAuditChainIfBroken,
  detectSoDViolations,
} from '../src/auditEngine.js';

const REPAIR_MARKER = 'audit_chain_repaired_v1';

function reqFor(user) {
  return { user, traceId: 'TRC-test', ip: '127.0.0.1' };
}

function writeEntries(n, opts = {}) {
  for (let i = 0; i < n; i++) {
    secureLogAudit(reqFor({ id: 'USR-1', name: 'Tester', role: 'SJVN_ADMIN' }), {
      action: opts.action || 'UPDATE',
      module: 'TEST',
      entityType: 'thing',
      entityId: `${opts.entityId || 'ENT'}-${i}`,
      details: { i },
    });
  }
}

beforeEach(() => {
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare('DELETE FROM platform_meta WHERE key = ?').run(REPAIR_MARKER);
});

describe('chain verification', () => {
  it('accepts a chain the writer produced', () => {
    writeEntries(12);
    expect(verifyLogIntegrity().isValid).toBe(true);
  });

  it('calls an empty chain valid', () => {
    expect(verifyLogIntegrity()).toMatchObject({ isValid: true });
  });

  it('detects a row whose payload was altered', () => {
    writeEntries(6);
    const target = db.prepare('SELECT id FROM audit_logs ORDER BY rowid ASC LIMIT 1 OFFSET 3').get();
    db.prepare("UPDATE audit_logs SET reason = 'edited after the fact' WHERE id = ?").run(target.id);

    const r = verifyLogIntegrity();
    expect(r.isValid).toBe(false);
    expect(r.brokenLogId).toBe(target.id);
    expect(r.brokenAtIndex).toBe(3);
    expect(r.message).toMatch(/tampering/i);
  });

  it('detects a deleted row by the hole it leaves in the links', () => {
    writeEntries(6);
    const target = db.prepare('SELECT id FROM audit_logs ORDER BY rowid ASC LIMIT 1 OFFSET 2').get();
    db.prepare('DELETE FROM audit_logs WHERE id = ?').run(target.id);

    const r = verifyLogIntegrity();
    expect(r.isValid).toBe(false);
    expect(r.message).toMatch(/broken chain link/i);
  });
});

describe('the boot-time tail check', () => {
  it('passes on a healthy chain and reports how much it looked at', () => {
    writeEntries(5);
    expect(verifyRecentIntegrity()).toMatchObject({ isValid: true, checked: 5 });
  });

  it('reads only the window it was asked for, however long the chain is', () => {
    writeEntries(40);
    expect(verifyRecentIntegrity(10).checked).toBe(10);
  });

  it('catches tampering inside the window', () => {
    writeEntries(8);
    const last = db.prepare('SELECT id FROM audit_logs ORDER BY rowid DESC LIMIT 1').get();
    db.prepare("UPDATE audit_logs SET user_name = 'somebody else' WHERE id = ?").run(last.id);
    expect(verifyRecentIntegrity(5).isValid).toBe(false);
  });
});

describe('the one-time repair', () => {
  it('leaves a valid chain alone and records that it has run', () => {
    writeEntries(4);
    const r = repairAuditChainIfBroken();
    expect(r).toMatchObject({ rebuilt: 0, wasValid: true });
    expect(getMeta(REPAIR_MARKER)).toBeTruthy();
  });

  it('rebuilds hashes written by the old inconsistent logic', () => {
    writeEntries(5);
    // Old-style hashes: authentic rows whose recorded hash cannot be reproduced.
    db.prepare("UPDATE audit_logs SET curr_hash = 'legacy-' || id").run();
    expect(verifyLogIntegrity().isValid).toBe(false);

    const r = repairAuditChainIfBroken();
    expect(r.wasValid).toBe(false);
    expect(r.rebuilt).toBe(5);
    expect(r.nowValid).toBe(true);
    expect(verifyLogIntegrity().isValid).toBe(true);
    // Recorded only because it worked — a repair that left the chain invalid
    // must leave the marker unset so the next boot tries again.
    expect(getMeta(REPAIR_MARKER)).toBeTruthy();
  });

  // The point of the marker. Boot used to verify the whole history every time,
  // which grows without limit, and used to rebuild whatever it found broken —
  // which re-certifies edited rows and leaves the chain looking untouched.
  it('does not touch the chain again once it has run', () => {
    writeEntries(4);
    repairAuditChainIfBroken();

    const victim = db.prepare('SELECT id FROM audit_logs ORDER BY rowid ASC LIMIT 1 OFFSET 1').get();
    db.prepare("UPDATE audit_logs SET reason = 'tampered' WHERE id = ?").run(victim.id);

    const second = repairAuditChainIfBroken();
    expect(second).toMatchObject({ rebuilt: 0, skipped: true });
    // Still broken, and still saying so.
    expect(verifyLogIntegrity().isValid).toBe(false);
  });
});

describe('paging over a long chain', () => {
  it('rebuilds correctly across page boundaries', () => {
    writeEntries(11);
    db.prepare("UPDATE audit_logs SET curr_hash = 'legacy-' || id").run();

    // A batch size smaller than the chain, so the loop genuinely pages.
    const { rebuilt } = rebuildAuditChain({ batchSize: 3 });
    expect(rebuilt).toBe(11);
    expect(verifyLogIntegrity().isValid).toBe(true);
  });

  it('finds a segregation-of-duties breach across page boundaries', () => {
    const sameUser = { id: 'USR-9', name: 'Solo Approver', role: 'SJVN_ADMIN' };
    // Padding, so the create and the approval land in different pages.
    writeEntries(7);
    secureLogAudit(reqFor(sameUser), { action: 'CREATE', module: 'BILLING', entityType: 'invoice', entityId: 'INV-SOD' });
    writeEntries(7);
    secureLogAudit(reqFor(sameUser), { action: 'APPROVE', module: 'BILLING', entityType: 'invoice', entityId: 'INV-SOD' });

    const violations = detectSoDViolations({ pageSize: 3 });
    expect(violations.map((v) => v.entityId)).toContain('INV-SOD');
  });

  it('does not flag a create and approval by two different people', () => {
    secureLogAudit(reqFor({ id: 'USR-A', name: 'Maker', role: 'REIA_USER' }),
      { action: 'CREATE', module: 'BILLING', entityType: 'invoice', entityId: 'INV-OK' });
    secureLogAudit(reqFor({ id: 'USR-B', name: 'Checker', role: 'SJVN_ADMIN' }),
      { action: 'APPROVE', module: 'BILLING', entityType: 'invoice', entityId: 'INV-OK' });

    expect(detectSoDViolations({ pageSize: 3 }).map((v) => v.entityId)).not.toContain('INV-OK');
  });
});
