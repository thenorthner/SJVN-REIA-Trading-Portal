import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import db from '../src/db/index.js';
import {
  sendSms, sanitizeSmsText, smsVar, templateIdFor, normalizeInPhone, DLT_VAR_MAX,
} from '../src/services/smsService.js';
import { dispatch } from '../src/services/notificationService.js';
import { ensureMasterDefaults, invalidateParamCache } from '../src/mastersService.js';
import { makeUser } from './helpers/reia.js';

/** Master data is a table, not an API — the same way the other suites set one. */
const setParam = (key, value) => {
  db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(value, key);
  invalidateParamCache();
};

// What TRAI's DLT regime demands of an outgoing SMS, checked rather than
// assumed. Each of these covers a way a message is accepted by the gateway with
// a 200 and then dropped by the operator before it reaches a handset — the
// failure mode that leaves no trace anywhere except the bill not being paid.

const OUTBOX = path.join(process.cwd(), 'outbox');
const written = new Set();
const forget = (ref) => { if (ref) written.add(path.isAbsolute(ref) ? ref : path.join(OUTBOX, ref)); };

const ENV_KEYS = ['SMS_ENABLED', 'TEXTGURU_API_KEY', 'TEXTGURU_SENDER'];
let savedEnv;

// Master data is seeded at server boot, and this suite deliberately does not
// boot one — it exercises the gateway directly. Seed it here instead.
ensureMasterDefaults();

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  db.prepare('DELETE FROM notification_deliveries').run();
  setParam('sms_dlt_template_ids', JSON.stringify({}));
  invalidateParamCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  setParam('sms_dlt_template_ids', JSON.stringify({}));
  invalidateParamCache();
});

afterAll(() => {
  // dispatch() also writes an email sidecar; provider_ref holds the path.
  for (const d of db.prepare('SELECT provider_ref FROM notification_deliveries').all()) {
    if (d.provider_ref) forget(d.provider_ref);
  }
  for (const f of written) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  db.prepare('DELETE FROM notification_deliveries').run();
});

/** Put the gateway in the state it will be in once SJVN goes live. */
function goLive() {
  process.env.SMS_ENABLED = 'true';
  process.env.TEXTGURU_API_KEY = 'test-key';
  process.env.TEXTGURU_SENDER = 'SJVNLT';
  invalidateParamCache();
}

describe('the characters that go on the wire', () => {
  it('replaces an en-dash, which would both break the template match and halve the segment', () => {
    // One non-GSM character pushes the whole message into UCS-2: 70 characters
    // per segment instead of 160.
    expect(sanitizeSmsText('SJVN: SLA breached on dispute D-1 — escalated.'))
      .toBe('SJVN: SLA breached on dispute D-1 - escalated.');
  });

  it('replaces the rupee sign with Rs', () => {
    expect(sanitizeSmsText('Amount ₹1,00,000')).toBe('Amount Rs1,00,000');
  });

  it('replaces curly quotes, ellipsis and non-breaking spaces', () => {
    expect(sanitizeSmsText('the DISCOM’s bill…')).toBe("the DISCOM's bill...");
  });

  it('leaves a message that is already GSM-7 exactly as it is', () => {
    const body = 'SJVN: Invoice INV-1 is available for payment (due 2026-05-31). View on the portal.';
    expect(sanitizeSmsText(body)).toBe(body);
  });

  it('is applied by sendSms itself, so no call site can forget it', async () => {
    const res = await sendSms({ to: '9876543210', text: 'SJVN: dispute D-9 — escalated.' });
    expect(res.ok).toBe(true);
    forget(res.provider_ref);
    const written_ = JSON.parse(fs.readFileSync(path.join(OUTBOX, res.provider_ref), 'utf8'));
    expect(written_.text).toBe('SJVN: dispute D-9 - escalated.');
  });

  it('no live SMS body in the codebase carries a character the templates cannot hold', () => {
    // The registered templates are GSM-7. A body that is not is a message the
    // operator will not match, so this guards the source, not just the helper.
    const files = ['src/routes/invoices.js', 'src/routes/disputes.js', 'src/routes/bilateral.js',
      'src/routes/noar.js', 'src/services/hydroNotifications.js'];
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      for (const line of src.split('\n')) {
        if (!line.includes('SJVN:')) continue;
        const bad = line.match(/[‐-―‘’“”…₹]/g);
        if (bad) offenders.push(`${f}: ${line.trim().slice(0, 90)} → ${[...new Set(bad)].join(' ')}`);
      }
    }
    expect(offenders, `non-GSM-7 characters in SMS bodies:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the thirty-character cap on a DLT variable', () => {
  it('leaves a short value alone', () => {
    expect(smsVar('PUNJAB')).toBe('PUNJAB');
  });

  it('cuts a DISCOM name that runs past the limit', () => {
    const name = 'Himachal Pradesh State Electricity Board Limited';
    expect(name.length).toBeGreaterThan(DLT_VAR_MAX);
    expect(smsVar(name).length).toBeLessThanOrEqual(DLT_VAR_MAX);
  });

  it('cuts a free-text reason, which is where this actually bites', () => {
    const reason = 'Application rejected because the transmission corridor was not available';
    expect(smsVar(reason).length).toBeLessThanOrEqual(DLT_VAR_MAX);
  });

  it('sanitizes as well as truncates, so a variable cannot smuggle in a bad character', () => {
    expect(smsVar('reason — unclear')).toBe('reason - unclear');
  });

  it('survives null and undefined rather than printing them', () => {
    expect(smsVar(null)).toBe('');
    expect(smsVar(undefined)).toBe('');
  });
});

describe('the registered template id', () => {
  it('is null until one is entered, and resolves once it is', () => {
    expect(templateIdFor('INVOICE_SENT')).toBeNull();
    setParam('sms_dlt_template_ids', JSON.stringify({ INVOICE_SENT: '1107161234567890123' }));
    invalidateParamCache();
    expect(templateIdFor('INVOICE_SENT')).toBe('1107161234567890123');
    expect(templateIdFor('PAYMENT_RECEIVED')).toBeNull();
  });

  it('refuses a live send that has no template, rather than letting it be scrubbed silently', async () => {
    goLive();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await sendSms({ to: '9876543210', text: 'SJVN: test', event: 'INVOICE_SENT' });
    expect(res.ok, 'an unregistered message was sent to the gateway').toBe(false);
    expect(res.error).toMatch(/No DLT content template registered for INVOICE_SENT/);
    expect(fetchSpy, 'the gateway was called for a message the operator would drop').not.toHaveBeenCalled();
  });

  it('sends the template id as templateid once it is registered', async () => {
    goLive();
    setParam('sms_dlt_template_ids', JSON.stringify({ INVOICE_SENT: '1107161234567890123' }));
    invalidateParamCache();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'MSG-1' }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await sendSms({ to: '9876543210', text: 'SJVN: test', event: 'INVOICE_SENT' });
    expect(res.ok, res.error).toBe(true);
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('templateid=1107161234567890123');
    expect(url).toContain('senderid=SJVNLT');
  });

  it('lets an explicit templateId win over the lookup', async () => {
    goLive();
    setParam('sms_dlt_template_ids', JSON.stringify({ INVOICE_SENT: 'from-masters' }));
    invalidateParamCache();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'MSG-1' }));
    vi.stubGlobal('fetch', fetchSpy);

    await sendSms({ to: '9876543210', text: 'x', event: 'INVOICE_SENT', templateId: 'explicit' });
    expect(fetchSpy.mock.calls[0][0]).toContain('templateid=explicit');
  });

  it('warns in the outbox while SMS is off, instead of refusing', async () => {
    // Before go-live a missing template must not block the workflow being
    // built and tested — but it must be visible.
    const res = await sendSms({ to: '9876543210', text: 'SJVN: test', event: 'INVOICE_SENT' });
    expect(res.ok).toBe(true);
    forget(res.provider_ref);
    const meta = JSON.parse(fs.readFileSync(path.join(OUTBOX, res.provider_ref), 'utf8'));
    expect(meta.event).toBe('INVOICE_SENT');
    expect(meta.template_id).toBeNull();
    expect(meta.dlt_warning).toMatch(/No DLT content template registered for INVOICE_SENT/);
  });
});

describe('the event travels with the message', () => {
  it('dispatch passes the event through, so the template is found', async () => {
    setParam('sms_dlt_template_ids', JSON.stringify({ PAYMENT_RECEIVED: '1107169999999999999' }));
    invalidateParamCache();
    const officer = makeUser('FINANCE_USER', { name: 'DLT Desk Officer' });
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run('9812345601', officer.id);

    await dispatch({
      event: 'PAYMENT_RECEIVED', userId: officer.id,
      subject: 'Payment recorded', message: 'SJVN: Payment of Rs 1,000 recorded against INV-1. Status now PAID.',
    });

    const row = db.prepare(
      `SELECT * FROM notification_deliveries WHERE channel = 'SMS' AND address = '9812345601'`).get();
    expect(row, 'no SMS delivery was logged').toBeTruthy();
    expect(row.status).toBe('SENT');
    forget(row.provider_ref);
    const meta = JSON.parse(fs.readFileSync(path.join(OUTBOX, row.provider_ref), 'utf8'));
    expect(meta.event).toBe('PAYMENT_RECEIVED');
    expect(meta.template_id, 'the registered template id did not reach the gateway')
      .toBe('1107169999999999999');
  });

  it('a retried delivery carries its template too', async () => {
    // A retry is a fresh send to the operator. The row holds the event, which
    // is what resolves the template — without it every recovery would be
    // scrubbed even though the first attempt was fine.
    setParam('sms_dlt_template_ids', JSON.stringify({ INVOICE_SENT: '1107160000000000001' }));
    invalidateParamCache();
    db.prepare(`
      INSERT INTO notification_deliveries (id, event, channel, address, body, status, attempts)
      VALUES ('NDL-RETRY-1', 'INVOICE_SENT', 'SMS', '9812345602', 'SJVN: Invoice INV-9 is available for payment (due 2026-05-31). View on the portal.', 'FAILED', 1)
    `).run();

    const { retryFailedDeliveries } = await import('../src/services/notificationService.js');
    const out = await retryFailedDeliveries(10);
    expect(out.retried).toBeGreaterThan(0);

    const row = db.prepare(`SELECT * FROM notification_deliveries WHERE id = 'NDL-RETRY-1'`).get();
    expect(row.status).toBe('SENT');
    forget(row.provider_ref);
    const meta = JSON.parse(fs.readFileSync(path.join(OUTBOX, row.provider_ref), 'utf8'));
    expect(meta.template_id).toBe('1107160000000000001');
  });
});

describe('the number itself', () => {
  it('still refuses anything that is not an Indian mobile', () => {
    expect(normalizeInPhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizeInPhone('09876543210')).toBe('9876543210');
    expect(normalizeInPhone('1234567890')).toBeNull();
    expect(normalizeInPhone('')).toBeNull();
  });
});
