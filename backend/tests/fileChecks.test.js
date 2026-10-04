import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import PDFDocument from 'pdfkit';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';
import { unreadablePdf } from '../src/services/fileChecks.js';

// A PDF that is only a header opens nowhere. It is turned away wherever a file
// can be attached, not found out later by whoever tries to read it.

const STUB = Buffer.from('%PDF-1.4\n%%EOF');
const realPdf = () => new Promise((resolve) => {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.text('A real page');
  doc.end();
});
const as = (u) => auth(signToken(u));

describe('the check itself', () => {
  it('tells a whole PDF from a header with nothing behind it, and leaves other files alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfcheck-'));
    const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
    expect(unreadablePdf(write('stub.pdf', STUB))).toBe(true);
    expect(unreadablePdf(write('cut.pdf', (await realPdf()).subarray(0, 300)))).toBe(true);
    expect(unreadablePdf(write('good.pdf', await realPdf()))).toBe(false);
    expect(unreadablePdf(write('note.txt', Buffer.from('just text')))).toBe(false);
    expect(unreadablePdf(write('pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBe(false);
    expect(unreadablePdf(path.join(dir, 'missing.pdf'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('where a file can be attached', () => {
  let reia, finance, seller, alpha, contract;
  beforeEach(() => {
    resetReia();
    alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
    contract = makeContract({ seller_id: alpha.id });
    reia = makeUser('REIA_USER', { name: 'Riya REIA' });
    finance = makeUser('FINANCE_USER', { name: 'Farid Finance' });
    seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  });

  it('refuses a broken PDF on a mail, and sends a sound one', async () => {
    const send = (buf, name) => request(app).post('/api/mail').set(as(reia))
      .field('to', JSON.stringify([finance.id])).field('subject', 'Bill copy').field('body', 'Attached')
      .attach('files', buf, name);
    const bad = await send(STUB, 'bill.pdf');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/bill\.pdf cannot be opened/);
    expect(db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n).toBe(0);
    const good = await send(await realPdf(), 'bill.pdf');
    expect(good.status, JSON.stringify(good.body)).toBe(201);
  });

  it('refuses a broken PDF as dispute evidence, and files a sound one', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: 'A/1', total_amount: 1000000, energy_charges: 1000000 });
    const d = await request(app).post('/api/disputes').set(as(seller)).send({ invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 1000, issue_description: 'Wrong tariff' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const put = (buf) => request(app).post(`/api/disputes/${d.body.id}/evidence`).set(as(seller)).attach('file', buf, 'meter-reading.pdf');
    const bad = await put(STUB);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/meter-reading\.pdf cannot be opened/);
    expect(JSON.parse(db.prepare('SELECT supporting_docs FROM disputes WHERE id = ?').get(d.body.id).supporting_docs || '[]')).toEqual([]);
    const good = await put(await realPdf());
    expect(good.status).toBeLessThan(300);
  });
});
