import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { makeUser, tokenFor, auth, makeEntity } from './helpers/reia.js';
import { routeInventory } from './helpers/routeInventory.js';
import { approvalParamProblem } from '../src/routes/masters.js';
import { DEFAULT_LEVEL_ROLES } from '../src/routes/invoices.js';
import { notifyRoles } from '../src/util.js';

// Target #2, Phase A (docs/governance/TARGET-2-ROLE-TRANSFER.md): before any
// power is taken from the SJVN Administrator, everything that only it could do
// or only it was told about has a desk owner.

const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);
const rolesNotified = (type, like) => db.prepare(
  "SELECT DISTINCT role FROM notifications WHERE type = ? AND message LIKE ? AND role IS NOT NULL ORDER BY role",
).all(type, `%${like}%`).map((r) => r.role);

describe('alerts reach a role that can act on them', () => {
  let seq = 7000;
  const company = (extra = {}) => {
    const n = String(seq++).padStart(4, '0');
    return { entity_type: 'SELLER', category: 'RE Generator', name: `Phase A ${n}`, capacity_mw: 40, pan_no: `AAACP${n}E`, gst_no: `24AAACP${n}E1ZQ`, ...extra };
  };

  it('onboarding: the administrator and the desk that approves it', async () => {
    const c = await post('/api/entities', tokenFor('COMMERCIAL_ADMIN'), company({ verticals: 'HYDRO' }));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const roles = rolesNotified('ONBOARDING', c.body.name);
    expect(roles).toContain('SJVN_ADMIN');
    expect(roles.some((r) => r !== 'SJVN_ADMIN')).toBe(true);
  });

  it('blacklisting: the administrator, the compliance auditor and the desk', async () => {
    const e = makeEntity('SELLER', { name: 'Phase A Blacklist Co' });
    const r = await post(`/api/entities/${e.id}/blacklist`, tokenFor('REIA_ADMIN'), { blacklisted: true, reason: 'Fraudulent bank proof' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(rolesNotified('COMPLIANCE_ALERT', 'Phase A Blacklist Co')).toEqual(expect.arrayContaining(['SJVN_ADMIN', 'COMPLIANCE_AUDITOR', 'REIA_CHECKER']));
  });

  it('sends each role one copy', () => {
    db.prepare("DELETE FROM notifications WHERE type = 'PHASE_A_PROBE'").run();
    notifyRoles(['FINANCE_USER', 'FINANCE_USER', 'IT_SUPER_ADMIN'], { type: 'PHASE_A_PROBE', message: 'probe' });
    expect(rolesNotified('PHASE_A_PROBE', 'probe')).toEqual(['FINANCE_USER', 'IT_SUPER_ADMIN']);
  });

  it('no alert in the code is addressed to the SJVN Administrator alone', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.resolve(__dirname, '../src');
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith('.js') && files.push(path.join(d, f.name))));
    walk(root);
    const solo = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/pushNotification\(\{\s*role:\s*'SJVN_ADMIN'|noteOnce\('SJVN_ADMIN'/g)) {
        solo.push(`${path.relative(root, f)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(solo).toEqual([]);
  });
});

describe('H1 — a bill waiting with an approver can be recalled when its maker is away', () => {
  let contract, makerUser, maker, head, other, admin, hodUser;
  const billFor = async (month) => {
    const b = await post('/api/hydro-billing', maker, { contract_id: contract.id, billing_month: month, ex_bus_scheduled_kwh: 500000000, pafm_percent: 100, beta_value: 0 });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    await post(`/api/hydro-billing/${b.body.id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'QA' });
    return b.body.id;
  };

  beforeAll(() => {
    contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
    makerUser = makeUser('COMMERCIAL', { name: 'PA Maker' });
    hodUser = makeUser('COMMERCIAL_ADMIN', { name: 'PA HoD' });
    maker = signToken(makerUser);
    head = signToken(makeUser('COMMERCIAL_ADMIN', { name: 'PA Desk Head' }));
    other = signToken(makeUser('COMMERCIAL', { name: 'PA Other' }));
    admin = signToken(makeUser('SJVN_ADMIN', { name: 'PA Admin' }));
  });

  it('by the desk head, on record as for the maker, and the maker is told', async () => {
    const id = await billFor('2026-04');
    const r = await post(`/api/hydro-billing/${id}/recall`, head, { reason: 'maker on leave, wrong amount' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const step = db.prepare("SELECT comments FROM hydro_bill_approvals WHERE bill_id = ? AND status = 'REJECTED'").get(id);
    expect(step.comments).toMatch(/desk head \(PA Desk Head\) for the maker/);
    expect(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'HYDRO_BILL_RECALLED'").get(makerUser.id).c).toBe(1);
  });

  it('not by another officer, and no longer by the SJVN Administrator', async () => {
    const id = await billFor('2026-05');
    expect((await post(`/api/hydro-billing/${id}/recall`, other, { reason: 'not mine to recall' })).status).toBe(403);
    expect((await post(`/api/hydro-billing/${id}/recall`, admin, { reason: 'administrator override' })).status).toBe(403);
    expect((await post(`/api/hydro-billing/${id}/recall`, maker, { reason: 'my own bill' })).status).toBe(200);
  });
});

describe('H2 — nobody at SJVN signs a statement for the counterparty', () => {
  it('the exemption is gone from the counterparty branch', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../src/routes/reconciliation.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/!okRole && req\.user\.role !== 'SJVN_ADMIN'/);
  });
});

describe('H3 — every approval level keeps a desk signatory', () => {
  it('the default chain has a non-administrator at every level', () => {
    expect(approvalParamProblem('invoice_approval_level_roles', DEFAULT_LEVEL_ROLES)).toBeNull();
  });

  it('refuses a level only the administrators can sign, or a role nobody holds', () => {
    expect(approvalParamProblem('invoice_approval_level_roles', { 1: ['REIA_USER'], 3: ['SJVN_ADMIN'] })).toMatch(/level 3 can only be signed by the SJVN/);
    expect(approvalParamProblem('invoice_approval_level_roles', { 1: ['REIA_CHIEF'] })).toMatch(/no user can hold/);
    expect(approvalParamProblem('invoice_approval_levels', [{ above: 100000, levels: 2, roles: { 2: ['IT_SUPER_ADMIN'] } }])).toMatch(/band above 100000/);
    expect(approvalParamProblem('invoice_approval_levels', [{ above: 100000, levels: 2 }])).toBeNull();
  });

  it('the masters screen refuses to save such a chain', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    const r = await request(app).put('/api/masters/parameters/invoice_approval_levels').set(auth(admin))
      .send({ param_value: JSON.stringify([{ above: 1000000, levels: 3, roles: { 3: ['SJVN_ADMIN'] } }]) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/SJVN \/ IT administrator/);
  });
});

describe('H4–H6 — powers the administrator shares already have a desk owner', () => {
  const inv = routeInventory();
  const gate = (method, path) => inv.find((r) => r.method === method && r.path === path)?.roles || [];

  it('H4 payment-security override: Management', () => {
    expect(gate('POST', '/api/payment-security/overrides')).toContain('MANAGEMENT');
  });

  it('H5 reconciliation reopen decision: Finance and the REIA desk', () => {
    expect(gate('POST', '/api/reconciliation/reopen-requests/:id/act')).toEqual(expect.arrayContaining(['FINANCE_USER', 'REIA_CHECKER']));
  });

  it('H6 disputes: the REIA checker reads the dispute register and the forum tracker', async () => {
    const checker = tokenFor('REIA_ADMIN');
    expect((await request(app).get('/api/disputes').set(auth(checker))).status).toBe(200);
    expect((await request(app).get('/api/dispute-extras/forum-tracker').set(auth(checker))).status).toBe(200);
  });
});

describe('a trading client signs its own side (decided 19-Oct-2026)', () => {
  let n = 0;
  beforeAll(() => {
    for (const [id, name] of [['TC-PHASE-A', 'Phase A Client'], ['TC-OTHER', 'Other Client']]) {
      db.prepare("INSERT OR IGNORE INTO trading_clients (id, name, client_type) VALUES (?, ?, 'DISCOM')").run(id, name);
    }
  });
  const clientToken = (clientId = 'TC-PHASE-A') => tokenFor('TRADING_CLIENT', { linked_entity_id: clientId });
  const statement = (status = 'PENDING_SIGN_OFF') => {
    const id = `REC-TC-${++n}`;
    db.prepare(`
      INSERT INTO reconciliations (id, recon_no, scope, trading_client_id, counterparty_role, period_type, period, status)
      VALUES (?, ?, 'TRADING_CLIENT', 'TC-PHASE-A', 'TRADING_CLIENT', 'MONTHLY', '2026-08', ?)
    `).run(id, `RECON/TC/${n}`, status);
    return id;
  };
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const attach = (token, id, fields = {}, file = pdf, name = 'client-signed.pdf') => {
    let r = request(app).post(`/api/recon-signoff/${id}/offline-counterparty-sign`).set(auth(token));
    for (const [k, v] of Object.entries({ signatory_name: 'R. Mehta', signatory_designation: 'CFO', signed_on: '2026-10-15', ...fields })) r = r.field(k, v);
    return file ? r.attach('file', file, name) : r;
  };

  it('the trading desk can no longer sign the client side itself', async () => {
    const id = statement();
    const r = await post(`/api/recon-signoff/${id}/sign`, tokenFor('TRADING_USER'), { decision: 'AGREE' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/signs its own side/);
    expect(db.prepare('SELECT counterparty_ack_at FROM reconciliations WHERE id = ?').get(id).counterparty_ack_at).toBeNull();
  });

  it('the client itself still signs', async () => {
    const id = statement();
    const r = await post(`/api/recon-signoff/${id}/sign`, clientToken(), { decision: 'AGREE' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('another client can neither see nor sign it', async () => {
    const id = statement();
    const other = clientToken('TC-OTHER');
    expect((await request(app).get(`/api/recon-signoff/${id}`).set(auth(other))).status).toBe(403);
    expect((await post(`/api/recon-signoff/${id}/sign`, other, { decision: 'AGREE' })).status).toBe(403);
    const list = (await request(app).get('/api/reconciliation').set(auth(other))).body;
    expect((Array.isArray(list) ? list : list.rows || list.data || []).some((r) => r.id === id)).toBe(false);
    const mine = (await request(app).get('/api/reconciliation').set(auth(clientToken()))).body;
    expect((Array.isArray(mine) ? mine : mine.rows || mine.data || []).some((r) => r.id === id)).toBe(true);
  });

  it('a client login linked to no client sees none', async () => {
    const id = statement();
    expect((await request(app).get(`/api/recon-signoff/${id}`).set(auth(tokenFor('TRADING_CLIENT')))).status).toBe(403);
  });

  it('the panel offers the desk the signed-copy route, not a sign button', async () => {
    const id = statement();
    const d = (await request(app).get(`/api/recon-signoff/${id}`).set(auth(tokenFor('TRADING_USER')))).body;
    expect(d.can_sign).toBe(false);
    expect(d.can_attach_client_signed_copy).toBe(true);
  });

  it('the desk attaches the client’s signed copy, recorded as the client’s signature', async () => {
    const id = statement();
    const r = await attach(tokenFor('TRADING_USER', { name: 'Desk Officer' }), id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(id);
    expect(row.counterparty_ack_by).toMatch(/^R\. Mehta \(client, signed offline; copy attached by Desk Officer\)$/);
    const sign = JSON.parse(row.counterparty_sign_json);
    expect(sign).toMatchObject({ by: 'R. Mehta', designation: 'CFO', role: 'TRADING_CLIENT', mode: 'OFFLINE_SIGNED_COPY', signed_on: '2026-10-15', attached_by: 'Desk Officer' });
    expect(JSON.parse(row.signed_copies_json).counterparty.file_name).toBe('client-signed.pdf');
    expect(r.body.signatures.counterparty.mode).toBe('OFFLINE_SIGNED_COPY');
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'RECON_CLIENT_SIGNED_OFFLINE' AND entity_id = ?").get(id).c).toBe(1);
  });

  it('closes the statement when SJVN has already signed', async () => {
    const id = statement();
    db.prepare("UPDATE reconciliations SET sjvn_ack_at = datetime('now'), sjvn_ack_by = 'REIA Officer' WHERE id = ?").run(id);
    expect((await attach(tokenFor('TRADING_USER'), id)).status).toBe(200);
    expect(db.prepare('SELECT status FROM reconciliations WHERE id = ?').get(id).status).toBe('CLOSED');
  });

  it('refuses without a PDF, a signatory or a valid date, and refuses a second signature', async () => {
    const desk = tokenFor('TRADING_USER');
    const id = statement();
    expect((await attach(desk, id, {}, null)).status).toBe(400);
    expect((await attach(desk, id, {}, Buffer.from('not a pdf'), 'x.pdf')).body.error).toMatch(/must be a PDF/);
    expect((await attach(desk, id, { signatory_name: 'R' })).body.error).toMatch(/signatory/);
    expect((await attach(desk, id, { signed_on: '2099-01-01' })).body.error).toMatch(/future/);
    expect((await attach(desk, id)).status).toBe(200);
    expect((await attach(desk, id)).body.error).toMatch(/already signed/);
  });

  it('is the trading desk’s alone, and only for a trading client’s statement', async () => {
    const id = statement();
    expect((await attach(tokenFor('SJVN_ADMIN'), id)).status).toBe(403);
    expect((await attach(tokenFor('REIA_ADMIN'), id)).status).toBe(403);
    expect((await attach(clientToken(), id)).status).toBe(403);
    const review = statement('NEEDS_REVIEW');
    expect((await attach(tokenFor('TRADING_USER'), review)).body.error).toMatch(/finished its review/);
  });
});
