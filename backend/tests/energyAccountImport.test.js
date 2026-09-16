import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeContract, makeEntity } from './helpers/reia.js';
import { parseEnergyAccount, parseMonthCell } from '../src/services/energyAccountImport.js';

// Energy for a month from the account that states it (REIA scope D). Only the
// regional energy account had a route in; the JMR, the SLDC's state energy
// account and an RLDC statement were typed in a figure at a time.
//
// The unit is the whole danger here: a state energy account states energy in
// MUs and a JMR in MWh, and the same number is a thousand times bigger in one
// than the other.

let reia, finance, njhps, rampur, luhri;

// The two stations stand for the whole file: a contract number is unique, so
// they are made once and the energy they carry is cleared between tests.
beforeAll(() => {
  njhps = makeContract({ contract_no: 'PPA/NJHPS/001', seller_id: makeEntity('SELLER', { name: 'Nathpa Jhakri HEP' }).id });
  rampur = makeContract({ contract_no: 'PPA/RHPS/002', seller_id: makeEntity('SELLER', { name: 'Rampur HEP' }).id });
  luhri = makeContract({ contract_no: 'PPA/LUHRI/003', seller_id: makeEntity('SELLER', { name: 'Luhri Stage-I HEP' }).id });
  // One station selling under two contracts: its name alone cannot say which.
  const dhaulasidh = makeEntity('SELLER', { name: 'Dhaulasidh HEP' }).id;
  makeContract({ contract_no: 'PPA/DHEP/005', seller_id: dhaulasidh });
  makeContract({ contract_no: 'PPA/DHEP/006', seller_id: dhaulasidh });
});

beforeEach(() => {
  db.prepare('DELETE FROM energy_data').run();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
});

const csv = (lines) => Buffer.from(lines.join('\n'), 'utf8');

const post = (buffer, fields = {}, token = reia) => {
  const r = request(app).post('/api/energy-data/upload-account').set(auth(token));
  for (const [k, v] of Object.entries(fields)) r.field(k, String(v));
  return r.attach('file', buffer, fields.file_name || 'account.csv');
};

const energyFor = (contractId, month = '2026-06') => db.prepare(
  'SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?',
).get(contractId, month);

describe('Reading the account', () => {
  it('reads a joint meter reading in the unit it is stated in', () => {
    const out = parseEnergyAccount(csv([
      'Station,Contract No,Period,Unit,Energy Exported,Availability %',
      'Nathpa Jhakri HEP,PPA/NJHPS/001,2026-06,MWh,81616.38,96.4',
    ]));
    expect(out.errors).toEqual([]);
    expect(out.rows[0]).toMatchObject({
      station: 'Nathpa Jhakri HEP', contract_no: 'PPA/NJHPS/001', period_month: '2026-06',
      energy_value: 81616.38, unit: 'MWH', energy_mwh: 81616.38, availability_percent: 96.4,
    });
  });

  it('reads the state energy account\'s MUs as MUs, not as MWh', () => {
    // Delhi SLDC's Annexure-3 states "Details of Energy Scheduled to the
    // Licensees ( in Mus )". 81.61638 MUs is 81,616.38 MWh — reading it as MWh
    // would bill a hundredth of the month.
    const out = parseEnergyAccount(csv([
      'Station,Beneficiary,Period,Scheduled Energy (in MUs)',
      'NATHPA JHAKRI,BRPL,Jun-26,81.6163800',
    ]));
    expect(out.rows[0]).toMatchObject({ unit: 'MU', energy_mwh: 81616.38, period_month: '2026-06' });
    expect(out.unit_from).toBe('the energy column heading');
  });

  it('refuses to read energy whose unit nobody stated', () => {
    const out = parseEnergyAccount(csv([
      'Station,Period,Scheduled Energy',
      'NATHPA JHAKRI,2026-06,81.61638',
    ]));
    expect(out.rows).toBeUndefined();
    expect(out.errors[0]).toMatch(/unit of the energy column is not stated/);
    expect(out.errors[0]).toMatch(/thousand times bigger in MUs/);
  });

  it('lets each row carry its own unit, and lets the heading beat the upload', () => {
    const perRow = parseEnergyAccount(csv([
      'Station,Period,Unit,Energy',
      'NATHPA JHAKRI,2026-06,MU,81.61638',
      'Rampur HEP,2026-06,MWh,42000',
      'Luhri HEP,2026-06,furlongs,7',
    ]));
    expect(perRow.rows.map((r) => r.energy_mwh)).toEqual([81616.38, 42000]);
    expect(perRow.errors[0]).toMatch(/"furlongs" is not a unit this reads/);

    // The document's own word wins over what was chosen on the form.
    const heading = parseEnergyAccount(csv(['Station,Period,Energy (MU)', 'NATHPA JHAKRI,2026-06,1']), { unit: 'MWh' });
    expect(heading.rows[0].energy_mwh).toBe(1000);
  });

  it('reads the month however the account writes it', () => {
    expect(['2026-06', 'Jun-26', "Jun'26", 'June 2026', '06/2026'].map(parseMonthCell))
      .toEqual(['2026-06', '2026-06', '2026-06', '2026-06', '2026-06']);
    expect(parseMonthCell('sometime in June')).toBeNull();
  });

  it('skips the account\'s own total line and its footnotes', () => {
    const out = parseEnergyAccount(csv([
      'Station,Period,Unit,Energy',
      'NATHPA JHAKRI,2026-06,MU,81.61638',
      'Rampur HEP,2026-06,MU,26.84',
      'Grand Total,,,108.45638',
      '* All hydro stations scheduled by RLDC under must-run,,,',
    ]));
    expect(out.rows).toHaveLength(2);
    expect(out.errors).toEqual([]);
  });

  it('says what it could not read rather than quietly reading a title page', () => {
    expect(parseEnergyAccount(csv(['DELHI TRANSCO LIMITED', 'State Load Despatch Centre'])).errors[0])
      .toMatch(/No table header found/);
    expect(parseEnergyAccount(csv(['Station,Period,Unit,Remarks', 'NJHPS,2026-06,MU,fine'])).errors[0])
      .toMatch(/No table header found/);
  });
});

describe('Into the energy register', () => {
  it('matches each row to its contract and records where the figure came from', async () => {
    const r = await post(csv([
      'Station,Contract No,Period,Unit,Energy Exported,Availability %',
      'Nathpa Jhakri HEP,PPA/NJHPS/001,2026-06,MWh,81616.38,96.4',
      'Rampur HEP,PPA/RHPS/002,2026-06,MWh,26841.59,94.1',
    ]), { account_type: 'JMR' });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: 2, replaced: 0, skipped: 0, source: 'JMR', rows_read: 2 });
    const row = energyFor(njhps.id);
    expect(row).toMatchObject({
      energy_mwh: 81616.38, source: 'JMR', data_type: 'PROVISIONAL', status: 'DRAFT', availability_percent: 96.4,
    });
    // The provisional↔final trail key is set the same way a typed row's is.
    expect(row.billing_family_ref).toMatch(/^BFR\/PPA-NJHPS-001\/2026-06\//);
  });

  it('matches on the station name when the account carries no contract number', async () => {
    const r = await post(csv([
      'Station,Beneficiary,Period,Scheduled Energy (in MUs)',
      'Luhri Stage-I HEP,BRPL,Jun-26,21.4',
    ]), { account_type: 'SEA' });
    expect(r.body.created).toBe(1);
    expect(r.body.rows[0].matched_on).toBe('station name');
    // A state energy account is the SLDC's document, and reconciliation
    // compares it against the regional one.
    expect(energyFor(luhri.id)).toMatchObject({ energy_mwh: 21400, source: 'SLDC' });
  });

  it('will not guess between two contracts that share a station', async () => {
    const r = await post(csv([
      'Station,Period,Scheduled Energy (in MUs)',
      'Dhaulasidh HEP,Jun-26,12.5',
    ]), { account_type: 'SEA' });
    expect(r.body).toMatchObject({ created: 0, skipped: 1 });
    expect(r.body.rows[0].reason).toMatch(/matches 2 contracts \(PPA\/DHEP\/005, PPA\/DHEP\/006\) — give the contract number/);
  });

  it('leaves a row it cannot place alone, and says why', async () => {
    const r = await post(csv([
      'Station,Contract No,Period,Unit,Energy',
      'Nathpa Jhakri HEP,PPA/NJHPS/001,2026-06,MU,81.61638',
      'Koldam HEP,,2026-06,MU,30',
      ',PPA/NOPE/999,2026-06,MU,10',
    ]), { account_type: 'SEA' });

    expect(r.body).toMatchObject({ created: 1, skipped: 2 });
    const reasons = r.body.rows.filter((x) => x.action === 'SKIPPED').map((x) => x.reason);
    expect(reasons[0]).toMatch(/"Koldam HEP" matches no contract/);
    expect(reasons[1]).toMatch(/No contract is numbered "PPA\/NOPE\/999"/);
  });

  it('will not overwrite a month that has been locked', async () => {
    await post(csv(['Station,Contract No,Period,Unit,Energy', 'NJHPS,PPA/NJHPS/001,2026-06,MWh,81616.38']), { account_type: 'JMR' });
    db.prepare("UPDATE energy_data SET status = 'LOCKED' WHERE contract_id = ?").run(njhps.id);

    const again = await post(csv(['Station,Contract No,Period,Unit,Energy', 'NJHPS,PPA/NJHPS/001,2026-06,MWh,99999']), { account_type: 'JMR', file_name: 'revised.csv' });
    expect(again.body).toMatchObject({ created: 0, replaced: 0, skipped: 1 });
    expect(again.body.rows[0].reason).toMatch(/already locked on this contract at 81616.38 MWh/);
    expect(energyFor(njhps.id).energy_mwh).toBe(81616.38);
  });

  it('restates a draft month when a revised account arrives, and says what changed', async () => {
    await post(csv(['Station,Contract No,Period,Unit,Energy', 'NJHPS,PPA/NJHPS/001,2026-06,MU,81.61638']), { account_type: 'SEA' });
    const revised = await post(csv(['Station,Contract No,Period,Unit,Energy', 'NJHPS,PPA/NJHPS/001,2026-06,MU,82.1']), { account_type: 'SEA', file_name: 'final-sea.csv' });

    expect(revised.body).toMatchObject({ created: 0, replaced: 1 });
    expect(revised.body.rows[0]).toMatchObject({ was_energy_mwh: 81616.38, changed: true });
    expect(energyFor(njhps.id).energy_mwh).toBe(82100);
  });

  it('shows what a file would do without doing it', async () => {
    const dry = await post(csv(['Station,Contract No,Period,Unit,Energy', 'NJHPS,PPA/NJHPS/001,2026-06,MWh,81616.38']), { account_type: 'JMR', dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dry_run: true, created: 1 });
    expect(energyFor(njhps.id)).toBeUndefined();
  });

  it('takes the account as a spreadsheet, and the period from the upload when the file has none', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Station', 'Contract No', 'Unit', 'Energy Exported'],
      ['Nathpa Jhakri HEP', 'PPA/NJHPS/001', 'MWh', 81616.38],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'JMR');
    const r = await post(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
      account_type: 'JMR', period_month: '2026-06', file_name: 'jmr-jun.xlsx',
    });
    expect(r.body.created).toBe(1);
    expect(energyFor(njhps.id).energy_mwh).toBe(81616.38);
  });

  it('refuses a period it cannot place, an account type it does not know, and a reader who may not write', async () => {
    const file = csv(['Station,Contract No,Unit,Energy', 'NJHPS,PPA/NJHPS/001,MWh,100']);
    expect((await post(file, { account_type: 'JMR' })).body.errors[0]).toMatch(/no period month, and none was chosen/);
    expect((await post(file, { account_type: 'PIGEON', period_month: '2026-06' })).body.error).toMatch(/account_type must be one of/);
    expect((await post(file, { account_type: 'JMR', period_month: 'June' })).body.error).toMatch(/period_month must be YYYY-MM/);
    expect((await post(file, { account_type: 'JMR', period_month: '2026-06' }, finance)).status).toBe(403);
  });

  it('serves a template shaped like each account, and names the unit in it', async () => {
    const jmr = await request(app).get('/api/energy-data/account-template?account_type=JMR').set(auth(reia));
    expect(jmr.status).toBe(200);
    expect(jmr.text).toMatch(/Station,Contract No,Period,Unit,Energy Exported/);
    const sea = await request(app).get('/api/energy-data/account-template?account_type=SEA').set(auth(reia));
    expect(sea.text).toMatch(/Beneficiary/);
    expect(sea.text).toMatch(/,MU,/);

    const meta = await request(app).get('/api/energy-data/account-types').set(auth(finance));
    expect(meta.body.account_types.map((a) => a.key)).toEqual(['JMR', 'SEA', 'RLDC']);
    expect(meta.body.units.find((u) => u.key === 'MU')).toMatchObject({ mwh_per_unit: 1000 });
  });
});
