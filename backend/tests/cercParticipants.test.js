import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import {
  parseParticipantTable, parseRecTable, parseTermAheadTables, tableNumber, PARTICIPANT_TABLES,
} from '../src/services/cercScraper.js';

// The CERC monthly report says who traded — each trading licensee's share, every
// entity's sale and purchase in bilateral and each exchange market, the REC bid
// book, and the term-ahead markets contract by contract. The platform read none
// of it, and the market widgets said so; before that, they drew typed-in numbers
// and placeholder names ("State2" … "State20").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(__dirname, '../cerc_downloads');

describe('Reading the tables', () => {
  it('names a table by its own number, which moves between years', () => {
    expect(tableNumber('Table-31: VOLUME OF ELECTRICITY SOLD IN GREEN DAY AHEAD MARKET')).toBe('Table-31');
    expect(tableNumber('Table 22: VOLUME OF ELECTRICITY SOLD')).toBe('Table-22');
    expect(tableNumber('Table-46(a,b) : CROSS BORDER')).toBe('Table-46(a,b)');
  });

  it('reads an entity table to its footer, and the footer as the segment\'s concentration', () => {
    const t = parseParticipantTable([
      ['Table-31: VOLUME OF ELECTRICITY SOLD IN GREEN DAY AHEAD MARKET THROUGH POWER EXCHANGES, FEBRUARY 2026'],
      ['Name of the Entity', 'Volume of Sale (MU)', '% of Volume'],
      ['Karnataka', 213.49609, 28.229],
      ['ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13', 44.765385, 5.919],
      [null, null, null],
      ['Madhya Pradesh', 29.37284, 3.884],
      ['Total', 287.634315, 38.032],
      ['Volume sold by top 5 Regional Entities', 287.634315, 38.032],
      ['Herfindahl-Hirschman Index ', null, 0.097],
      ['Source: NLDC'],
      ['A line under the source is not an entity', 99, 99],
    ]);
    expect(t.source_table).toBe('Table-31');
    expect(t.participants.map((p) => [p.rank, p.entity_name, p.volume_mu])).toEqual([
      [1, 'Karnataka', 213.49609],
      [2, 'ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13', 44.765385],
      [3, 'Madhya Pradesh', 29.37284],
    ]);
    expect(t.concentration).toEqual({
      entity_count: 3, total_volume_mu: 287.634315, top5_volume_mu: 287.634315, top5_share_percent: 38.032, hhi: 0.097,
    });
  });

  it('reads the licensee table\'s shares, and its top five given as a fraction as a percent', () => {
    const t = parseParticipantTable([
      ['Table-2: PERCENTAGE SHARE OF ELECTRICITY TRANSACTED BY TRADING LICENSEES, FEBRUARY 2026'],
      ['Sr.No', 'Name of the Trading Licensee', '% Share in total Volume transacted by Trading Licensees'],
      [1, 'PTC India Ltd. ', 34.0886],
      [2, 'Powerpulse Trading Solutions Ltd.', 19.0916],
      ['TOTAL', null, 1],
      ['Top 5 trading licensees', null, 0.812],
      ['Herfindahl-Hirschman Index ', null, 0.1863],
      ['Note: '],
      ['1. Volume of electricity transacted by the trading licensees includes bilateral transactions', null, null],
    ], { licensee: true });
    expect(t.participants).toEqual([
      { rank: 1, entity_name: 'PTC India Ltd.', volume_mu: null, share_percent: 34.0886 },
      { rank: 2, entity_name: 'Powerpulse Trading Solutions Ltd.', volume_mu: null, share_percent: 19.0916 },
    ]);
    // TOTAL here is the shares summing to one, not a volume.
    expect(t.concentration.total_volume_mu).toBeNull();
    expect(t.concentration.top5_share_percent).toBeCloseTo(81.2, 6);
    expect(t.concentration.hhi).toBe(0.1863);
  });

  it('reads the REC bid book, not only what traded, and the traders\' bilateral sales beside it', () => {
    const rec = parseRecTable([
      ['Table-45 : VOLUME AND PRICE OF RENEWABLE ENERGY CERTIFICATES (RECs) TRANSACTED THROUGH POWER EXCHANGES AND THROUGH TRADERS'],
      [null, 'Details of REC Transactions', 'Through Power Exchange', null, null, 'Through Traders'],
      [null, null, 'IEX', ' PXIL', 'HPX', 'Solar '],
      ['A', 'Volume of Buy Bid', 4206930, 2129094, 862671, '-'],
      ['B', 'Volume of Sell Bid', 4228834, 2161143, 1800322, '-'],
      ['C', 'Ratio of Buy Bid to Sell Bid Volume', 0.9948, 0.9852, 0.4792, '-'],
      ['D', 'Traded Volume (MWh)', 1885656, 1336152, 672671, 301332],
      ['E', 'Weighted average Price (₹/MWh)', 334.7469, 333, 333, 338],
      ['Source: Power Exchanges & Grid-India REC Report'],
      ['Note 1: 1 REC = 1 MWh'],
    ]);
    const get = (exchange, metric) => rec.marketData.find((m) => m.exchange === exchange && m.metric === metric)?.val;
    expect(get('HPX', 'Buy Bid Volume')).toBe(862671);
    expect(get('HPX', 'Sell Bid Volume')).toBe(1800322);
    // The ratio is a ratio, not a buy bid: its label names both.
    expect(get('HPX', 'Buy/Sell Bid Ratio')).toBe(0.4792);
    expect(rec.volume).toEqual({ IEX: 1885656, PXIL: 1336152, HPX: 672671, TRADERS: 301332 });
    expect(rec.price.TRADERS).toBe(338);
    expect(get('TRADERS', 'Buy Bid Volume')).toBeUndefined();
  });

  it('reads the term-ahead tables on both sides of the 2025 split, and a contract nobody traded as unpriced', () => {
    const { contracts, printed_totals: totals } = parseTermAheadTables([
      ['Table-8: PRICE OF ELECTRICITY TRANSACTED IN REAL TIME MARKET THROUGH POWER EXCHANGES'],
      [null, 'Minimum', 1, 2, 3],
      ['Table-XX: CHARGES FOR DEVIATION UNDER DSM, APRIL 2023'],
      [1, 'Daily Contracts', 999, 9],
      ['Table-9: VOLUME AND PRICE OF ELECTRICITY IN INTRADAY AND CONTINGENCY OF IEX, FEBRUARY 2026'],
      ['Sr.No', ' Intraday and Contingency contracts', 'Actual Scheduled Volume (MUs)', 'Weighted Average Price (₹/kWh)'],
      [1, 'Intra-Day Contracts', 2.173, 4.2505],
      [2, 'Day Ahead Contingency Contracts', 178.8327, 4.3018],
      [null, 'Total', 181.0057, 4.3011],
      ['Source: IEX'],
      ['Table-18: VOLUME AND PRICE OF ELECTRICITY IN GREEN TERM AHEAD MARKET OF PXIL, JANUARY 2026'],
      ['Sr.No', 'Green Term ahead contracts', 'Actual Scheduled Volume (MUs)', 'Weighted Average Price (₹/kWh)'],
      [1, 'Daily Contracts', 52.254, 3.0123],
      [2, 'Weekly Contracts', 0, 0],
      [3, 'Monthly', 4.066055, 5.55],
      [null, 'Total', 56.320055, 3.1955],
      ['Source: PXIL'],
      ['Table-17: VOLUME AND PRICE OF ELECTRICITY IN HIGH PRICE TERM AHEAD MARKET OF HPX, AUGUST 2024'],
      ['Sr.No', 'Term ahead contracts', 'Actual Scheduled Volume (MU)', 'Weighted Average Price (₹/kWh)'],
      [1, 'Any Day Single Sided Contracts', 14.6, 11.2],
      [null, 'Total', 14.6, 11.2],
    ]);

    // The DSM table that strays into this sheet is not a term-ahead market.
    expect(contracts.some((c) => c.volume_mu === 999)).toBe(false);
    expect(contracts.map((c) => [c.market, c.exchange, c.contract_type, c.volume_mu, c.price_rs_kwh])).toEqual([
      ['TAM', 'IEX', 'INTRADAY', 2.173, 4.2505],
      ['TAM', 'IEX', 'DAY_AHEAD_CONTINGENCY', 178.8327, 4.3018],
      ['GTAM', 'PXIL', 'DAILY', 52.254, 3.0123],
      // Printed as price 0: nothing was scheduled, so there is no price.
      ['GTAM', 'PXIL', 'WEEKLY', 0, null],
      // Printed as plain "Monthly" — read all the same, or the month's volume
      // falls short of CERC's own total.
      ['GTAM', 'PXIL', 'MONTHLY', 4.066055, 5.55],
      ['HP-TAM', 'HPX', 'ANY_DAY_SINGLE_SIDED', 14.6, 11.2],
    ]);
    expect(totals.map((t) => [t.market, t.exchange, t.source_table])).toEqual([
      ['TAM', 'IEX', 'Table-9'], ['GTAM', 'PXIL', 'Table-18'], ['HP-TAM', 'HPX', 'Table-17'],
    ]);
  });
});

describe('Against every CERC report on file', () => {
  const reports = fs.existsSync(REPORTS)
    ? fs.readdirSync(REPORTS).filter((d) => /^\d{4}-\d{2}$/.test(d)).map((d) => path.join(REPORTS, d, `MMC_Report_${d}.xlsx`)).filter(fs.existsSync)
    : [];
  const byTitle = (wb, re) => {
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      if (re.test(String((rows[0] || []).find((c) => c) || ''))) return rows;
    }
    return null;
  };

  it('adds each table up to the total CERC printed under it', () => {
    expect(reports.length).toBeGreaterThanOrEqual(16);
    const gaps = [];
    let checked = 0;
    for (const file of reports) {
      const wb = XLSX.readFile(file);
      const month = path.basename(path.dirname(file));

      for (const spec of PARTICIPANT_TABLES) {
        const rows = byTitle(wb, spec.title);
        if (!rows) continue;
        const t = parseParticipantTable(rows, { licensee: !!spec.licensee });
        checked += 1;
        if (spec.licensee) {
          const sum = t.participants.reduce((a, p) => a + p.share_percent, 0);
          if (Math.abs(sum - 100) > 0.5) gaps.push(`${month} licensee shares add to ${sum}`);
        } else {
          const sum = t.participants.reduce((a, p) => a + p.volume_mu, 0);
          if (Math.abs(sum - (t.concentration.total_volume_mu ?? 0)) > 0.01 * Math.max(1, t.concentration.total_volume_mu ?? 0)) {
            gaps.push(`${month} ${spec.segment}/${spec.side}: ${sum} against ${t.concentration.total_volume_mu}`);
          }
        }
      }

      const sheet = wb.SheetNames.find((n) => /^table[- ]*3\s*to/i.test(n));
      const term = parseTermAheadTables(XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null }));
      for (const total of term.printed_totals) {
        checked += 1;
        const sum = term.contracts
          .filter((c) => c.market === total.market && c.exchange === total.exchange && c.source_table === total.source_table)
          .reduce((a, c) => a + c.volume_mu, 0);
        if (Math.abs(sum - (total.volume_mu ?? 0)) > 0.001) gaps.push(`${month} ${total.source_table} ${total.market}/${total.exchange}: ${sum} against ${total.volume_mu}`);
      }
      const unknown = term.contracts.filter((c) => c.contract_type === 'OTHER');
      if (unknown.length) gaps.push(`${month} unrecognised contracts: ${unknown.map((c) => c.contract_label).join(', ')}`);

      const rec = parseRecTable(byTitle(wb, /RENEWABLE ENERGY CERTIFICATES/i));
      if (rec.marketData.filter((m) => /Bid Volume/.test(m.metric)).length !== 6) gaps.push(`${month} REC bid book not read`);
    }
    expect(gaps).toEqual([]);
    expect(checked).toBeGreaterThan(350);
  });
});

describe('Participants and term-ahead markets on the API', () => {
  let trader;
  const participant = (period, segment, side, rank, name, volume, share) => db.prepare(`
    INSERT INTO cerc_participants (id, report_period, segment, side, rank, entity_name, volume_mu, share_percent, source_table)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Table-31')
  `).run(newId('CPT'), period, segment, side, rank, name, volume, share);
  const concentration = (period, segment, side, fields) => db.prepare(`
    INSERT INTO cerc_market_concentration (id, report_period, segment, side, entity_count, total_volume_mu, top5_volume_mu, top5_share_percent, hhi, source_table)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Table-31')
  `).run(newId('CMC'), period, segment, side, fields.count, fields.total ?? null, fields.top5 ?? null, fields.top5Share, fields.hhi);
  const term = (period, market, exchange, type, label, volume, price) => db.prepare(`
    INSERT INTO cerc_term_ahead (id, report_period, market, exchange, contract_type, contract_label, volume_mu, price_rs_kwh)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId('CTA'), period, market, exchange, type, label, volume, price);
  const get = (p) => request(app).get(`/api/cerc-market${p}`).set(auth(trader));

  beforeEach(() => {
    for (const t of ['cerc_participants', 'cerc_market_concentration', 'cerc_term_ahead', 'cerc_market_data', 'cerc_monthly_summary']) db.prepare(`DELETE FROM ${t}`).run();
    trader = tokenFor('TRADING_USER');
    for (const p of ['2026-01', '2026-02']) {
      db.prepare('INSERT INTO cerc_monthly_summary (id, report_period) VALUES (?, ?)').run(newId('CMS'), p);
    }
    participant('2026-02', 'GDAM', 'SELL', 1, 'Karnataka', 213.49609, 28.229);
    participant('2026-02', 'GDAM', 'SELL', 2, 'ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13', 44.765385, 5.919);
    participant('2026-02', 'GDAM', 'SELL', 3, 'Government of Himachal Pradesh_RampurHEP', 4.63, 0.61);
    concentration('2026-02', 'GDAM', 'SELL', { count: 100, total: 756.3, top5: 353.79, top5Share: 46.78, hhi: 0.097 });
    participant('2026-02', 'TRADING_LICENSEE', 'ALL', 1, 'PTC India Ltd.', null, 34.09);
    concentration('2026-02', 'TRADING_LICENSEE', 'ALL', { count: 39, top5Share: 81.2, hhi: 0.186 });
    concentration('2026-01', 'TRADING_LICENSEE', 'ALL', { count: 38, top5Share: 80.3, hhi: 0.188 });

    term('2026-02', 'TAM', 'IEX', 'DAILY', 'Daily Contracts', 215.345, 5.491);
    term('2026-02', 'TAM', 'IEX', 'WEEKLY', 'Weekly Contracts', 0, null);
    term('2026-02', 'TAM', 'IEX', 'ANY_DAY_SINGLE_SIDED', 'Any Day Single Sided Contracts', 378.866, 5.643);
  });

  it('lists the largest participants first, with how concentrated the segment is', async () => {
    const r = await get('/participants?segment=GDAM&side=SELL&limit=2');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ period: '2026-02', segment: 'GDAM', side: 'SELL', entities_in_table: 3, in_report: true });
    expect(r.body.participants.map((p) => p.entity_name)).toEqual(['Karnataka', 'ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13']);
    expect(r.body.concentration).toMatchObject({ entity_count: 100, top5_share_percent: 46.78, hhi: 0.097 });
  });

  it('finds an entity by name, as the report spells it', async () => {
    const r = await get('/participants?segment=GDAM&side=SELL&q=rampur');
    expect(r.body.participants).toEqual([{ rank: 3, entity_name: 'Government of Himachal Pradesh_RampurHEP', volume_mu: 4.63, share_percent: 0.61 }]);
  });

  it('says when a month\'s report has no table for a segment, rather than an empty market', async () => {
    const r = await get('/participants?segment=HP-DAM&side=BUY&period=2026-01');
    expect(r.body).toMatchObject({ period: '2026-01', in_report: false, participants: [], concentration: null });
    expect((await get('/participants?segment=PIGEON')).status).toBe(400);
    expect((await get('/participants?segment=GDAM&side=SIDEWAYS')).status).toBe(400);
  });

  it('gives the licensees their share, and the concentration month by month', async () => {
    const r = await get('/participants?segment=TRADING_LICENSEE');
    expect(r.body.side).toBe('ALL');
    expect(r.body.participants[0]).toMatchObject({ entity_name: 'PTC India Ltd.', volume_mu: null, share_percent: 34.09 });
    const history = await get('/concentration-history?segment=TRADING_LICENSEE');
    expect(history.body.map((h) => [h.period, h.top5_share_percent, h.hhi])).toEqual([['2026-01', 80.3, 0.188], ['2026-02', 81.2, 0.186]]);
  });

  it('adds each exchange\'s term-ahead contracts up, weighting the price by what was scheduled', async () => {
    const r = await get('/term-ahead?market=TAM');
    expect(r.body).toMatchObject({ period: '2026-02', market: 'TAM', in_report: true });
    const iex = r.body.exchanges.find((e) => e.exchange === 'IEX');
    expect(iex.volume_mu).toBeCloseTo(594.211, 6);
    // (215.345 × 5.491 + 378.866 × 5.643) / 594.211; the unscheduled weekly contract counts for nothing.
    expect(iex.weighted_price_rs_kwh).toBeCloseTo(5.5879, 4);
    expect(iex.contracts.find((c) => c.contract_type === 'WEEKLY')).toMatchObject({ volume_mu: 0, price_rs_kwh: null });
    // An exchange with nothing in the table has no volume, not zero.
    expect(r.body.exchanges.find((e) => e.exchange === 'HPX')).toMatchObject({ contracts: [], volume_mu: null, weighted_price_rs_kwh: null });
    expect((await get('/term-ahead?market=FUTURES')).status).toBe(400);
  });

  it('puts the licensees and the REC bid book on the market month', async () => {
    db.prepare(`INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit)
      VALUES (?, '2026-02', 'REC', 'REC', 'HPX', 'Sell Bid Volume', 1800322, 'MWh')`).run(newId('CMD'));
    const { body } = await get('/market-month?period=2026-02');
    expect(body.licensees).toMatchObject({ entity_count: 39, top5_share_percent: 81.2, hhi: 0.186 });
    expect(body.rec.find((x) => x.exchange === 'HPX').sell_bid_mwh).toBe(1800322);
    expect(body.rec.map((x) => x.exchange)).toEqual(['IEX', 'PXIL', 'HPX', 'TRADERS']);
    expect(body.not_in_report).toBeUndefined();
  });
});
