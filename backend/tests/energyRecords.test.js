import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, auditFor } from './helpers/reia.js';

// The counterparty's side of the energy record: the trend, the source document,
// the 15-minute blocks, and the answer — accept or object — that stands on
// record before the period is billed.

let reia, checker, seller, otherSeller, alpha, beta, contract;
const as = (u) => auth(signToken(u));
const get = (u, path) => request(app).get(`/api/energy-records${path}`).set(as(u));
const post = (u, path, body) => request(app).post(`/api/energy-records${path}`).set(as(u)).send(body);

function energy(period, mwh, extra = {}) {
  const id = `ENG-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, extra.contract_id || contract.id, period, extra.data_type || 'FINAL', extra.source || 'JMR', mwh, extra.cuf_percent ?? null, extra.status || 'VALIDATED');
  return id;
}

const sheet = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Block', 'Scheduled MWh', 'Actual MWh'], ...rows]), 'Blocks');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const loadBlocks = (u, id, rows) => request(app).post(`/api/energy-records/${id}/blocks`).set(as(u)).attach('file', sheet(rows), 'blocks.xlsx');

beforeEach(() => {
  db.prepare('DELETE FROM energy_blocks').run();
  db.prepare('DELETE FROM energy_data').run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id, capacity_mw: 100 });
  db.prepare('UPDATE contracts SET min_cuf_percent = 20 WHERE id = ?').run(contract.id);
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  // Phase B.2: the checker rules on an objection and locks the period.
  checker = makeUser('REIA_ADMIN', { name: 'Chetan Checker' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
});

describe('the trend', () => {
  it('gives energy and CUF month on month, final over provisional, for the caller’s own contracts', async () => {
    energy('2026-04', 14400);                                   // 30 days × 24 h × 100 MW = 72,000 → 20%
    energy('2026-05', 9000, { data_type: 'PROVISIONAL' });
    energy('2026-05', 11160);                                   // 31 days → 74,400 → 15%
    energy('2026-06', 5000, { contract_id: makeContract({ seller_id: beta.id }).id });

    const a = await get(seller, '/analytics');
    expect(a.body.series).toEqual([
      expect.objectContaining({ period: '2026-04', energy_mwh: 14400, cuf_percent: 20, below_min: false }),
      expect.objectContaining({ period: '2026-05', energy_mwh: 11160, cuf_percent: 15, below_min: true, provisional: false }),
    ]);
    expect(a.body.totals).toMatchObject({ energy_mwh: 25560, avg_cuf_percent: 17.5, months_below_min: 1, awaiting_response: 2 });
    expect((await get(otherSeller, '/analytics')).body.series.map((s) => s.period)).toEqual(['2026-06']);
    expect((await get(reia, '/analytics')).body.series).toHaveLength(3);
  });
});

describe('one record', () => {
  it('shows provisional against final, and is closed to another company', async () => {
    energy('2026-05', 9000, { data_type: 'PROVISIONAL' });
    const id = energy('2026-05', 9450);
    const d = await get(seller, `/${id}`);
    expect(d.body.comparison).toMatchObject({ provisional_mwh: 9000, final_mwh: 9450, difference_mwh: 450, difference_pct: 5 });
    expect(d.body).toMatchObject({ can_respond: true, cuf_computed: true });
    expect((await get(otherSeller, `/${id}`)).status).toBe(404);
  });

  it('carries the source document SJVN attaches, which must be the contract’s own', async () => {
    const id = energy('2026-05', 9450);
    db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES ('DJ', ?, 'JMR_SIGNED', 'RECORD', 'JMR May')`).run(contract.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES ('VJ', 'DJ', 1, '/nowhere', 'jmr-may.pdf', 10, 'application/pdf')`).run();
    expect((await post(seller, `/${id}/source-document`, { version_id: 'VJ' })).status).toBe(403);
    expect((await post(reia, `/${id}/source-document`, { version_id: 'nope' })).status).toBe(400);
    const ok = await post(reia, `/${id}/source-document`, { version_id: 'VJ' });
    expect(ok.body.source_document).toMatchObject({ version_id: 'VJ', file_name: 'jmr-may.pdf' });
    expect((await get(seller, `/${id}`)).body.source_document.title).toBe('JMR May');
  });
});

describe('15-minute blocks', () => {
  it('are loaded by SJVN for the month, read by the counterparty, and downloadable', async () => {
    const id = energy('2026-05', 30);
    expect((await loadBlocks(seller, id, [['2026-05-01', 1, 5, 5]])).status).toBe(403);
    const bad = await loadBlocks(reia, id, [['2026-06-01', 1, 5, 5], ['2026-05-01', 97, 5, 5]]);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not in 2026-05.*block must be 1 to 96/s);

    const ok = await loadBlocks(reia, id, [['2026-05-01', 1, 10, 9.5], ['2026-05-01', 2, 10, 10.5], ['02-05-2026', 1, 10, 9]]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ loaded: 3, days: 2, actual_mwh: 29 });
    expect(ok.body.warning).toMatch(/3.33% below/);

    const b = await get(seller, `/${id}/blocks`);
    expect(b.body.days).toEqual([
      expect.objectContaining({ date: '2026-05-01', blocks: 2, actual_mwh: 20, deviation_mwh: 0 }),
      expect.objectContaining({ date: '2026-05-02', blocks: 1, deviation_mwh: -1 }),
    ]);
    expect(b.body.blocks[1]).toMatchObject({ block_no: 2, time: '00:15-00:30', deviation_mwh: 0.5 });
    expect((await get(seller, `/${id}/blocks?date=2026-05-02`)).body.blocks).toHaveLength(1);

    const x = await get(seller, `/${id}/blocks.xlsx`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(x.status).toBe(200);
    expect(XLSX.utils.sheet_to_json(XLSX.read(x.body).Sheets.Blocks, { header: 1 })).toHaveLength(7);
    expect((await get(otherSeller, `/${id}/blocks`)).status).toBe(404);
  });
});

describe('accepting and objecting', () => {
  it('records the counterparty’s acceptance, once', async () => {
    const draft = energy('2026-04', 100, { status: 'DRAFT' });
    expect((await post(seller, `/${draft}/respond`, { response: 'ACCEPTED' })).status).toBe(400);
    const id = energy('2026-05', 9450);
    expect((await post(reia, `/${id}/respond`, { response: 'ACCEPTED' })).status).toBe(400);
    expect((await post(otherSeller, `/${id}/respond`, { response: 'ACCEPTED' })).status).toBe(404);

    const ok = await post(seller, `/${id}/respond`, { response: 'ACCEPTED' });
    expect(ok.body).toMatchObject({ response_status: 'ACCEPTED', response_by_name: 'Arun Alpha', can_respond: false });
    expect((await post(seller, `/${id}/respond`, { response: 'OBJECTED', note: 'x' })).status).toBe(400);
    expect(auditFor(id).map((a) => a.action)).toContain('ENERGY_ACCEPTED');
  });

  it('holds a period with an unanswered objection back from being locked', async () => {
    const id = energy('2026-05', 9450);
    expect((await post(seller, `/${id}/respond`, { response: 'OBJECTED' })).status).toBe(400);
    const obj = await post(seller, `/${id}/respond`, { response: 'OBJECTED', note: 'Our check meter reads higher', claimed_mwh: 9600 });
    expect(obj.body).toMatchObject({ response_status: 'OBJECTED', claimed_mwh: 9600 });

    const lock = () => request(app).post(`/api/energy-data/${id}/lock`).set(as(checker));
    const refused = await lock().send({});
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/objected/);

    expect((await post(seller, `/${id}/resolve-objection`, { outcome: 'REJECTED', note: 'x' })).status).toBe(403);
    expect((await post(reia, `/${id}/resolve-objection`, { outcome: 'REJECTED', note: 'x' })).status).toBe(403);
    expect((await post(checker, `/${id}/resolve-objection`, { outcome: 'REJECTED' })).status).toBe(400);
    const answered = await post(checker, `/${id}/resolve-objection`, { outcome: 'REJECTED', note: 'JMR is signed by both parties' });
    expect(answered.body).toMatchObject({ objection_outcome: 'REJECTED', objection_resolved_by_name: 'Chetan Checker' });
    expect((await lock().send({})).status).toBe(200);
  });

  it('lets SJVN lock over an open objection only with a reason on record', async () => {
    const id = energy('2026-05', 9450);
    await post(seller, `/${id}/respond`, { response: 'OBJECTED', note: 'Disagree' });
    const r = await request(app).post(`/api/energy-data/${id}/lock`).set(as(checker)).send({ override_reason: 'Billing deadline; objection to follow as a dispute' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(db.prepare('SELECT lock_override_reason FROM energy_data WHERE id = ?').get(id).lock_override_reason).toMatch(/Billing deadline/);
  });
});

describe('the list', () => {
  it('says which bill a period went onto, and whether it has block data', async () => {
    const id = energy('2026-05', 9450);
    const inv = makeInvoice({ contract_id: contract.id, billing_period: '2026-05', status: 'SENT', direction: 'SELLER_TO_SJVN' });
    makeInvoice({ contract_id: contract.id, billing_period: '2026-05', status: 'DRAFT' });
    await loadBlocks(reia, id, [['2026-05-01', 1, 10, 9.5]]);
    const list = await request(app).get('/api/energy-data').set(as(seller));
    expect(list.body[0]).toMatchObject({ invoice_id: inv.id, has_blocks: 1, min_cuf_percent: 20 });
  });
});
