import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';

// Scope G: who at the counterparty opened or downloaded a bill, and when.

let buyerEntity, contract, desk;

beforeEach(() => {
  resetReia();
  buyerEntity = makeEntity('BUYER');
  contract = makeContract({ contract_type: 'PSA', buyer_id: buyerEntity.id });
  desk = tokenFor('REIA_USER');
});

const buyer = () => tokenFor('BUYER', { linked_entity_id: buyerEntity.id });
const actions = (id, only) => auditFor(id).map((r) => r.action).filter((a) => !only || only.includes(a));
const ACCESS = ['VIEW_INVOICE', 'DOWNLOAD_INVOICE_PDF'];

describe('invoice access history', () => {
  it('records the buyer opening a bill and downloading it', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT' });
    const b = buyer();
    expect((await request(app).get(`/api/invoices/${inv.id}`).set(auth(b))).status).toBe(200);
    expect((await request(app).get(`/api/invoices/${inv.id}/pdf`).set(auth(b))).status).toBe(200);
    expect(actions(inv.id, ACCESS)).toEqual(['DOWNLOAD_INVOICE_PDF', 'VIEW_INVOICE']);
  });

  it("does not count the SJVN desk's own reads as views", async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT' });
    await request(app).get(`/api/invoices/${inv.id}`).set(auth(desk));
    expect(actions(inv.id, ['VIEW_INVOICE'])).toEqual([]);
  });

  it('shows the desk who had the bill, newest first', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT' });
    const b = buyer();
    await request(app).get(`/api/invoices/${inv.id}`).set(auth(b));
    await request(app).get(`/api/invoices/${inv.id}/pdf`).set(auth(b));

    const r = await request(app).get(`/api/invoices/${inv.id}`).set(auth(desk));
    expect(r.status).toBe(200);
    expect(r.body.access_log.map((a) => a.action)).toEqual(['DOWNLOAD_INVOICE_PDF', 'VIEW_INVOICE']);
    expect(r.body.access_log[0]).toMatchObject({ user_role: 'BUYER' });
    expect(r.body.access_log[0].created_at).toBeTruthy();
  });

  it('does not hand the access history to the counterparty itself', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT' });
    const r = await request(app).get(`/api/invoices/${inv.id}`).set(auth(buyer()));
    expect(r.status).toBe(200);
    expect(r.body.access_log).toBeUndefined();
  });

  it('will not give a counterparty the PDF of a bill SJVN has not finished approving', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'DRAFT' });
    const r = await request(app).get(`/api/invoices/${inv.id}/pdf`).set(auth(buyer()));
    expect(r.status).toBe(404);
    expect(actions(inv.id, ACCESS)).toEqual([]);
  });

  it('still lets the desk download a draft', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'DRAFT' });
    const r = await request(app).get(`/api/invoices/${inv.id}/pdf`).set(auth(desk));
    expect(r.status).toBe(200);
    expect(actions(inv.id, ACCESS)).toEqual(['DOWNLOAD_INVOICE_PDF']);
  });
});
