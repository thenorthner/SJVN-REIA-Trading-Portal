import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { kycOpen } from '../src/middleware/kycGate.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// A seller or buyer whose company KYC is not approved is held to its
// onboarding routes on the server, as the screen holds it (ProtectedRoute
// requiresKyc). The company here has a contract and a bill already, as one
// that edited its profile and went back to PENDING would.

let sellerCo, buyerCo, contract, psa, seller, sellerMaker, buyer, okSeller, okBuyer, reia;
const as = (u) => auth(signToken(u));
const get = (u, url) => request(app).get(url).set(as(u));
const setStatus = (id, status) => db.prepare('UPDATE entities SET status = ? WHERE id = ?').run(status, id);

const doc = (owner, title) => {
  const id = `DOC-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`INSERT INTO documents (id, entity_id, contract_id, document_type, category, title) VALUES (?, ?, ?, 'OTHER', 'RECORD', ?)`)
    .run(id, owner.entity_id || null, owner.contract_id || null, title);
  db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type)
    VALUES (?, ?, 1, 'x.pdf', 'x.pdf', 10, 'application/pdf')`).run(`${id}-V1`, id);
  return id;
};

beforeEach(() => {
  resetReia();
  sellerCo = makeEntity('SELLER', { name: 'Pending Solar', status: 'PENDING' });
  buyerCo = makeEntity('BUYER', { name: 'Pending Discom', status: 'PENDING' });
  contract = makeContract({ seller_id: sellerCo.id });
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
  makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', invoice_no: 'PS/1' });
  makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: 'PD/1' });
  seller = makeUser('SELLER', { linked_entity_id: sellerCo.id });
  sellerMaker = makeUser('SELLER_L1', { linked_entity_id: sellerCo.id });
  buyer = makeUser('BUYER', { linked_entity_id: buyerCo.id });
  const okSellerCo = makeEntity('SELLER', { name: 'Approved Wind' });
  const okBuyerCo = makeEntity('BUYER', { name: 'Approved Discom' });
  makeInvoice({ contract_id: makeContract({ seller_id: okSellerCo.id }).id, direction: 'SELLER_TO_SJVN', status: 'SENT', invoice_no: 'AW/1' });
  makeInvoice({ contract_id: makeContract({ contract_type: 'PSA', buyer_id: okBuyerCo.id }).id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: 'AD/1' });
  okSeller = makeUser('SELLER', { linked_entity_id: okSellerCo.id });
  okBuyer = makeUser('BUYER', { linked_entity_id: okBuyerCo.id });
  reia = makeUser('REIA_CHECKER');
});

const DATA_ROUTES = [
  '/api/invoices',
  '/api/contracts',
  '/api/reports/reia/catalog',
  '/api/reports/reia/run?preset=ageing',
  '/api/energy-data',
  '/api/disputes',
  '/api/payment-security',
  '/api/reconciliation',
  '/api/ledger',
  '/api/home/summary.pdf',
];

describe('a pending company is refused its data routes', () => {
  for (const who of ['seller', 'seller maker', 'buyer']) {
    it(`${who}: every data route answers 403 KYC_PENDING`, async () => {
      const u = { seller, 'seller maker': sellerMaker, buyer }[who];
      for (const url of DATA_ROUTES) {
        const res = await get(u, url);
        expect(res.status, url).toBe(403);
        expect(res.body.code, url).toBe('KYC_PENDING');
        expect(res.body.error, url).toBe("Your company's KYC is pending. This opens once SJVN has approved it.");
      }
    });
  }

  it('the side\'s own dashboards and writes are refused too', async () => {
    expect((await get(seller, '/api/seller-dashboard')).status).toBe(403);
    expect((await get(buyer, '/api/buyer-dashboard')).status).toBe(403);
    expect((await get(buyer, '/api/buyer-bills')).status).toBe(403);
    const post = await request(app).post('/api/invoices').set(as(seller)).send({ contract_id: contract.id, billing_period: '2026-09' });
    expect(post.status).toBe(403);
    expect(post.body.code).toBe('KYC_PENDING');
  });

  it('a REJECTED company is held the same way, and says so', async () => {
    setStatus(sellerCo.id, 'REJECTED');
    const res = await get(seller, '/api/invoices');
    expect(res.status).toBe(403);
    expect(res.body.kyc_status).toBe('REJECTED');
    expect(res.body.error).toMatch(/KYC is rejected/);
  });

  it('a download link carrying the token in the query is held too', async () => {
    const res = await request(app).get(`/api/home/summary.pdf?token=${signToken(seller)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('KYC_PENDING');
  });

  it('each refusal is in the audit trail', async () => {
    await get(seller, '/api/invoices');
    const row = db.prepare(`SELECT * FROM audit_logs WHERE action = 'ACCESS_DENIED' AND entity_id = 'GET /api/invoices' ORDER BY rowid DESC`).get();
    expect(row).toBeTruthy();
    expect(row.user_id).toBe(seller.id);
    expect(row.reason).toBe('Company KYC is PENDING');
  });

  it('the refusal never names another desk', async () => {
    const res = await get(buyer, '/api/contracts');
    expect(JSON.stringify(res.body)).not.toMatch(/trading|hydro|commercial|thermal/i);
  });
});

describe('a pending company keeps its onboarding routes', () => {
  for (const who of ['seller', 'buyer']) {
    it(`${who}: sign-in, profile, KYC, documents, team, mail and notifications answer`, async () => {
      const u = who === 'seller' ? seller : buyer;
      const co = who === 'seller' ? sellerCo : buyerCo;
      const open = [
        '/api/auth/me',
        '/api/entities',
        `/api/entities/${co.id}`,
        '/api/entities/regulatory-catalog',
        `/api/documents?entity_id=${co.id}`,
        '/api/documents/requests?status=OPEN',
        '/api/masters/document-types?module=STAKEHOLDERS',
        '/api/team',
        '/api/notifications',
        '/api/alerts/board',
        '/api/mail/unread-count',
        '/api/mail',
        '/api/privacy/my-data',
        '/api/privacy/requests',
        '/api/home',
      ];
      for (const url of open) {
        const res = await get(u, url);
        expect(res.status, `${url} → ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      }
    });
  }

  it('the company may still send its KYC details for review', async () => {
    const res = await request(app).put(`/api/entities/${sellerCo.id}`).set(as(seller)).send({ address: '12 Solar Park Road, Shimla' });
    expect(res.body.code).not.toBe('KYC_PENDING');
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT address FROM entities WHERE id = ?').get(sellerCo.id).address).toBe('12 Solar Park Road, Shimla');
  });

  it('the landing page carries the KYC notice and holds the figures back', async () => {
    const res = await get(seller, '/api/home');
    expect(res.status).toBe(200);
    expect(res.body.me.kyc_status).toBe('PENDING');
    expect(res.body.me.kyc_held).toBe(true);
    expect(res.body.contracts).toEqual([]);
    expect(res.body.kpis.billed).toBe(0);
    expect(res.body.kpis.outstanding).toBe(0);
    expect(res.body.recent.invoices).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('PS/1');
  });

  it('documents: the company\'s own are listed, its contracts\' wait for approval', async () => {
    const own = doc({ entity_id: sellerCo.id }, 'GST certificate');
    const ppa = doc({ contract_id: contract.id }, 'Signed PPA');
    const ids = (await get(seller, '/api/documents')).body.map((d) => d.id);
    expect(ids).toContain(own);
    expect(ids).not.toContain(ppa);
    expect((await get(seller, `/api/documents/${ppa}-V1/download`)).status).toBe(403);

    setStatus(sellerCo.id, 'APPROVED');
    const after = (await get(seller, '/api/documents')).body.map((d) => d.id);
    expect(after).toEqual(expect.arrayContaining([own, ppa]));
  });
});

describe('who is not affected', () => {
  it('an approved seller and buyer read their data as before', async () => {
    for (const u of [okSeller, okBuyer]) {
      for (const url of ['/api/invoices', '/api/contracts', '/api/reports/reia/catalog', '/api/home', '/api/disputes']) {
        const res = await get(u, url);
        expect(res.status, url).toBe(200);
      }
    }
    const inv = (await get(okSeller, '/api/invoices')).body;
    expect(JSON.stringify(inv)).toContain('AW/1');
    const home = (await get(okBuyer, '/api/home')).body;
    expect(home.me.kyc_held).toBe(false);
    expect(home.contracts.length).toBe(1);
  });

  it('the moment SJVN approves the company, its routes open', async () => {
    expect((await get(seller, '/api/invoices')).status).toBe(403);
    setStatus(sellerCo.id, 'APPROVED');
    const res = await get(seller, '/api/invoices');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('PS/1');
  });

  it('SJVN officers are never held by a company\'s KYC', async () => {
    const res = await get(reia, '/api/invoices');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('PS/1');
  });

  it('a login with no company linked is left to the routes\' own scoping, as on screen', async () => {
    const loose = makeUser('SELLER');
    const res = await get(loose, '/api/contracts');
    expect(res.body.code).not.toBe('KYC_PENDING');
  });
});

describe('the open list', () => {
  it('matches whole path segments, and methods where it names them', () => {
    expect(kycOpen('GET', '/auth/me')).toBe(true);
    expect(kycOpen('GET', '/authority')).toBe(false);
    expect(kycOpen('GET', '/home')).toBe(true);
    expect(kycOpen('GET', '/home/')).toBe(true);
    expect(kycOpen('GET', '/home/summary.pdf')).toBe(false);
    expect(kycOpen('POST', '/home')).toBe(false);
    expect(kycOpen('GET', '/masters/document-types')).toBe(true);
    expect(kycOpen('POST', '/masters/document-types')).toBe(false);
    expect(kycOpen('GET', '/masters/holidays')).toBe(false);
    expect(kycOpen('GET', '/invoices')).toBe(false);
  });
});
