/**
 * Minimal clean seed — enough to walk REIA flows without clutter.
 * Delete platform.db and run: npm run seed
 */
import bcrypt from 'bcryptjs';
import db from './index.js';
import { newId, buildBillingFamilyRef } from '../util.js';
import {
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
} from '../paymentSecurityEngine.js';
import { ensureMasterDefaults } from '../mastersService.js';
import { refreshLot } from '../services/recLedger.js';
import { seedExchangeDesk } from './seedExchangeDesk.js';
import { seedBilateralDesk } from './seedBilateralDesk.js';
import { seedRecDesk } from './seedRecDesk.js';

// ── Market Rates & Analytics (IEX / PXIL / HPX) ──
// Additive and idempotent: row ids are derived from exchange+product+date and
// inserted with INSERT OR IGNORE, so this block sits above the "already
// seeded" guard — an existing platform.db picks up market data from
// `npm run seed` without a destructive reseed of anything else.

const MARKET_DAYS = 90;
const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const MARKET_PRODUCTS = ['DAM', 'RTM', 'GDAM'];
const PRODUCT_BASE = { DAM: 4.2, RTM: 4.65, GDAM: 3.55 };      // ₹/unit floor-of-band
const EXCHANGE_OFFSET = { IEX: 0.18, PXIL: -0.12, HPX: -0.06 }; // IEX carries a liquidity premium
const EXCHANGE_SOURCE = { IEX: 'IEX_PORTAL', PXIL: 'PXIL_PORTAL', HPX: 'HPX_PORTAL' };
const EXCHANGE_VOLUME = { IEX: 5200, PXIL: 1450, HPX: 760 };    // typical cleared MW
const PRODUCT_VOLUME_SHARE = { DAM: 1, RTM: 0.42, GDAM: 0.18 };

// Deterministic 0..1 from the row's natural key — keeps charts stable across reseeds.
function marketNoise(...parts) {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Offsets are days from the start of the window (day 0 = MARKET_DAYS-1 days ago).
const MARKET_EVENT_TEMPLATES = [
  { offset: 6, event_type: 'TRANSMISSION_CONSTRAINT', impact_level: 'MEDIUM', description: 'NR-WR corridor congestion; ATC curtailed for evening blocks.' },
  { offset: 14, event_type: 'HEATWAVE', impact_level: 'HIGH', description: 'IMD heatwave alert across NR; peak demand crossed 240 GW.' },
  { offset: 21, event_type: 'HYDRO_INFLOW', impact_level: 'LOW', description: 'Improved Satluj inflows lifted hydro availability at NJHPS/RHPS.' },
  { offset: 30, event_type: 'PLANT_OUTAGE', impact_level: 'HIGH', description: 'Forced outage of 2x660 MW thermal units in WR; DAM tightened.' },
  { offset: 38, event_type: 'REGULATORY', impact_level: 'MEDIUM', description: 'CERC market coupling consultation; GDAM price cap clarified.' },
  { offset: 45, event_type: 'MONSOON_ONSET', impact_level: 'MEDIUM', description: 'Monsoon onset softened cooling demand in NR and WR.' },
  { offset: 52, event_type: 'RE_CURTAILMENT', impact_level: 'LOW', description: 'Solar curtailment in Rajasthan pushed volumes to GDAM.' },
  { offset: 61, event_type: 'COAL_SUPPLY', impact_level: 'HIGH', description: 'Coal rake shortage at pithead stations; RTM spiked in evening peak.' },
  { offset: 70, event_type: 'FESTIVAL_DEMAND', impact_level: 'MEDIUM', description: 'Festival load pickup in NR; DISCOMs bought heavily on DAM.' },
  { offset: 78, event_type: 'GRID_EVENT', impact_level: 'LOW', description: 'Frequency excursion event; NRPC advisory on DSM discipline.' },
  { offset: 85, event_type: 'IMPORT_TARIFF', impact_level: 'MEDIUM', description: 'Cross-border (Nepal/Bhutan) exchange volumes revised upward.' },
];

function seedMarketAnalytics() {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (MARKET_DAYS - 1));

  const dates = [];
  for (let i = 0; i < MARKET_DAYS; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const eventByDate = {};
  for (const t of MARKET_EVENT_TEMPLATES) {
    if (t.offset < dates.length) eventByDate[dates[t.offset]] = t;
  }

  const insertRate = db.prepare(`
    INSERT OR IGNORE INTO market_rates
      (id, product, rate_date, mcp_rate, forecast_rate, exchange, volume_mw, min_rate, max_rate, avg_rate, time_block, data_source)
    VALUES (@id, @product, @rate_date, @mcp_rate, @forecast_rate, @exchange, @volume_mw, @min_rate, @max_rate, @avg_rate, 'DAILY', @data_source)
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO market_events (id, event_date, event_type, description, impact_level)
    VALUES (@id, @event_date, @event_type, @description, @impact_level)
  `);
  const insertFactor = db.prepare(`
    INSERT OR IGNORE INTO market_factors (id, factor_date, weather_index, renewable_forecast_mw, coal_price_index, demand_forecast_mw)
    VALUES (@id, @factor_date, @weather_index, @renewable_forecast_mw, @coal_price_index, @demand_forecast_mw)
  `);
  const round2 = (v) => Math.round(v * 100) / 100;

  db.transaction(() => {
    dates.forEach((date, dayIndex) => {
      const dow = new Date(`${date}T12:00:00`).getDay();
      const seasonal = 0.55 * Math.sin((dayIndex / MARKET_DAYS) * Math.PI * 2);
      const weekend = dow === 0 || dow === 6 ? -0.34 : 0;
      const event = eventByDate[date];
      const eventLift = event
        ? (event.impact_level === 'HIGH' ? 3.1 : event.impact_level === 'MEDIUM' ? 0.85 : 0.15)
        : 0;

      for (const exchange of EXCHANGES) {
        for (const product of MARKET_PRODUCTS) {
          const n = marketNoise(exchange, product, date);
          const mcp = Math.min(10, Math.max(2.5,
            PRODUCT_BASE[product] + EXCHANGE_OFFSET[exchange] + seasonal + weekend
            + (n - 0.5) * 0.7
            + eventLift * (0.75 + n * 0.5)
          ));
          const spread = 0.18 + n * 0.14;
          const volumeBase = EXCHANGE_VOLUME[exchange] * PRODUCT_VOLUME_SHARE[product];
          insertRate.run({
            id: `MRT-${exchange}-${product}-${date}`,
            product,
            rate_date: date,
            mcp_rate: round2(mcp),
            // Day-ahead forecast published before clearing — deliberately imperfect (±6%).
            forecast_rate: round2(mcp * (1 + (marketNoise(exchange, product, date, 'fc') - 0.5) * 0.12)),
            exchange,
            volume_mw: Math.round(volumeBase * (0.82 + n * 0.36) * (weekend ? 0.88 : 1)),
            min_rate: round2(Math.max(2.0, mcp * (1 - spread))),
            max_rate: round2(Math.min(12, mcp * (1 + spread * 1.6))),
            avg_rate: round2(mcp * (0.97 + n * 0.05)),
            data_source: EXCHANGE_SOURCE[exchange],
          });
        }
      }

      const f = marketNoise('factor', date);
      insertFactor.run({
        id: `MFC-${date}`,
        factor_date: date,
        weather_index: round2(31 + 6 * Math.sin((dayIndex / MARKET_DAYS) * Math.PI * 2) + (f - 0.5) * 4),
        renewable_forecast_mw: Math.round(6400 + 1800 * Math.sin((dayIndex / 30) * Math.PI) + (f - 0.5) * 1200),
        coal_price_index: round2(118 + 14 * Math.sin((dayIndex / MARKET_DAYS) * Math.PI * 1.5) + (f - 0.5) * 5),
        demand_forecast_mw: Math.round(211000 + 16000 * Math.sin((dayIndex / MARKET_DAYS) * Math.PI * 2) + (f - 0.5) * 6000),
      });
    });

    for (const [date, t] of Object.entries(eventByDate)) {
      insertEvent.run({
        id: `MEV-${date}-${t.event_type}`,
        event_date: date,
        event_type: t.event_type,
        description: t.description,
        impact_level: t.impact_level,
      });
    }
  })();

  console.log('Market analytics seeded:', {
    rates: db.prepare('SELECT COUNT(*) c FROM market_rates').get().c,
    events: db.prepare('SELECT COUNT(*) c FROM market_events').get().c,
    factors: db.prepare('SELECT COUNT(*) c FROM market_factors').get().c,
    window: `${dates[0]} → ${dates[dates.length - 1]}`,
  });
}

try {
  seedMarketAnalytics();
} catch (e) {
  console.warn('Market analytics seed skipped:', e.message);
}

// ── NOAR wallet (Open Access charges) ──
// Same additive/idempotent contract as the market block: fixed ids +
// INSERT OR IGNORE, so an existing platform.db picks up the ledger without a
// destructive reseed. Balances are recomputed after insert so the running
// column is right regardless of insertion order.

// Days back from today → keeps the ledger "recent" whenever the demo is reseeded.
const NOAR_TXNS = [
  { d: 112, type: 'RECHARGE', amount: 2500000, payee: 'Grid India', ref: 'NEFT/NOAR/RCH/0001', notes: 'Opening NOAR wallet recharge for Q1 open-access scheduling' },
  { d: 106, type: 'CHARGE', amount: 145000, cat: 'APPLICATION', payee: 'CTUIL', ref: 'CTUIL/OA-APP/2026/0412', notes: 'Long-term open access application processing fee' },
  { d: 99, type: 'CHARGE', amount: 612500, cat: 'ISTS', payee: 'CTUIL', ref: 'CTUIL/ISTS/2026/03', notes: 'ISTS transmission charges — March scheduling' },
  { d: 96, type: 'CHARGE', amount: 88400, cat: 'RLDC', payee: 'RLDC', ref: 'NRLDC/OPCHG/2026/03', notes: 'NRLDC operating charges — March' },
  { d: 88, type: 'CHARGE', amount: 42000, cat: 'OTHER', payee: 'NLDC', ref: 'NLDC/REA/2026/03', notes: 'NLDC application & data access charges' },
  { d: 80, type: 'RECHARGE', amount: 1500000, payee: 'Grid India', ref: 'NEFT/NOAR/RCH/0002', notes: 'Top-up ahead of April bilateral schedules' },
  { d: 74, type: 'CHARGE', amount: 655800, cat: 'ISTS', payee: 'CTUIL', ref: 'CTUIL/ISTS/2026/04', notes: 'ISTS transmission charges — April scheduling' },
  { d: 71, type: 'CHARGE', amount: 91200, cat: 'RLDC', payee: 'RLDC', ref: 'NRLDC/OPCHG/2026/04', notes: 'NRLDC operating charges — April' },
  { d: 64, type: 'CHARGE', amount: 126000, cat: 'APPLICATION', payee: 'CTUIL', ref: 'CTUIL/OA-APP/2026/0518', notes: 'Short-term open access application — bilateral corridor' },
  { d: 58, type: 'CHARGE', amount: 38500, cat: 'OTHER', payee: 'Grid India', ref: 'GI/MISC/2026/05', notes: 'Metering & communication compliance charges' },
  { d: 52, type: 'RECHARGE', amount: 1200000, payee: 'Grid India', ref: 'NEFT/NOAR/RCH/0003', notes: 'Wallet top-up — May cycle' },
  { d: 46, type: 'CHARGE', amount: 701300, cat: 'ISTS', payee: 'CTUIL', ref: 'CTUIL/ISTS/2026/05', notes: 'ISTS transmission charges — May scheduling' },
  { d: 43, type: 'CHARGE', amount: 96700, cat: 'RLDC', payee: 'RLDC', ref: 'NRLDC/OPCHG/2026/05', notes: 'NRLDC operating charges — May' },
  { d: 36, type: 'CHARGE', amount: 54000, cat: 'OTHER', payee: 'NLDC', ref: 'NLDC/REA/2026/05', notes: 'Deviation account & REA data charges' },
  { d: 30, type: 'RECHARGE', amount: 1800000, payee: 'Grid India', ref: 'NEFT/NOAR/RCH/0004', notes: 'Pre-monsoon top-up for June/July corridors' },
  { d: 24, type: 'CHARGE', amount: 668900, cat: 'ISTS', payee: 'CTUIL', ref: 'CTUIL/ISTS/2026/06', notes: 'ISTS transmission charges — June scheduling' },
  { d: 21, type: 'CHARGE', amount: 89500, cat: 'RLDC', payee: 'RLDC', ref: 'NRLDC/OPCHG/2026/06', notes: 'NRLDC operating charges — June' },
  { d: 15, type: 'CHARGE', amount: 132400, cat: 'APPLICATION', payee: 'CTUIL', ref: 'CTUIL/OA-APP/2026/0701', notes: 'Open access application — July short-term corridor' },
  { d: 9, type: 'CHARGE', amount: 47800, cat: 'OTHER', payee: 'Grid India', ref: 'GI/MISC/2026/07', notes: 'Registry & scheduling portal charges' },
  { d: 4, type: 'RECHARGE', amount: 900000, payee: 'Grid India', ref: 'NEFT/NOAR/RCH/0005', notes: 'Interim top-up pending July ISTS bill' },
];

function seedNoarWallet() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO noar_wallet_txns
      (id, txn_no, txn_type, category, amount, balance_after, payee, reference, txn_date, notes, created_by)
    VALUES (@id, @txn_no, @txn_type, @category, @amount, 0, @payee, @reference, @txn_date, @notes, 'Trading Ops')
  `);

  const dateFor = (daysBack) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
  };

  db.transaction(() => {
    NOAR_TXNS.forEach((t, i) => {
      insert.run({
        id: `NOAR-SEED-${String(i + 1).padStart(3, '0')}`,
        // Own numbering namespace — `NOAR/nnnnn` is reserved for txns booked
        // through the API, and txn_no is UNIQUE, so a clash here would silently
        // drop the seeded row.
        txn_no: `NOAR/SEED/${String(i + 1).padStart(4, '0')}`,
        txn_type: t.type,
        category: t.type === 'CHARGE' ? t.cat : null,
        amount: t.amount,
        payee: t.payee,
        reference: t.ref,
        txn_date: dateFor(t.d),
        notes: t.notes,
      });
    });

    // Rebuild the running balance in strict date order (matches the API's own
    // recompute, so seeded and user-entered rows stay consistent).
    const rows = db.prepare(`
      SELECT id, txn_type, amount FROM noar_wallet_txns
      ORDER BY txn_date ASC, created_at ASC, id ASC
    `).all();
    const upd = db.prepare('UPDATE noar_wallet_txns SET balance_after = ? WHERE id = ?');
    let running = 0;
    for (const r of rows) {
      running += r.txn_type === 'RECHARGE' ? Number(r.amount) : -Number(r.amount);
      upd.run(Math.round(running * 100) / 100, r.id);
    }
  })();

  const bal = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN txn_type='RECHARGE' THEN amount ELSE -amount END), 0) b
    FROM noar_wallet_txns
  `).get().b;
  console.log('NOAR wallet seeded:', {
    txns: db.prepare('SELECT COUNT(*) c FROM noar_wallet_txns').get().c,
    balance: Math.round(bal),
  });
}

try {
  seedNoarWallet();
} catch (e) {
  console.warn('NOAR wallet seed skipped:', e.message);
}

// ── Bilateral trades (source data for CERC Form-IV) ──
// SJVN buys from the registered generator client and sells to the DISCOM
// counterparty, so each row is one reportable inter-state trading transaction.
// Rates are chosen to exercise both CERC margin caps, including two deliberate
// breaches and one trade with the purchase leg missing.

const FORM_IV_CLIENTS = [
  { id: 'TCL-SEED-GEN1', name: 'Teesta Urja Ltd', client_type: 'GENERATOR' },
  { id: 'TCL-SEED-GEN2', name: 'Jaypee Karcham Hydro', client_type: 'GENERATOR' },
  { id: 'TCL-SEED-GEN3', name: 'Adani Green Energy Ltd', client_type: 'GENERATOR' },
  { id: 'TCL-SEED-GEN4', name: 'NTPC Renewable Energy Ltd', client_type: 'GENERATOR' },
];

// margin = tariff − purchase. Cap is 4 paise at/below ₹3/kWh, 7 paise above.
const FORM_IV_TRADES = [
  { id: 'BT-SEED-001', client: 'TCL-SEED-GEN1', counterparty: 'Haryana Power Purchase Centre', ref: 'LOI/SJVN/TRD/2026/011', mw: 50, purchase: 4.19, tariff: 4.25, from: '2026-05-01', to: '2026-07-31' },
  { id: 'BT-SEED-002', client: 'TCL-SEED-GEN2', counterparty: 'UP Power Corporation Ltd', ref: 'LOI/SJVN/TRD/2026/012', mw: 35, purchase: 2.91, tariff: 2.95, from: '2026-05-15', to: '2026-08-14' },
  // Over cap: 12 paise on a ₹3.60 sale where only 7 paise is permitted.
  { id: 'BT-SEED-003', client: 'TCL-SEED-GEN3', counterparty: 'Rajasthan Urja Vikas Nigam', ref: 'LOI/SJVN/TRD/2026/013', mw: 40, purchase: 3.48, tariff: 3.60, from: '2026-06-01', to: '2026-07-31' },
  { id: 'BT-SEED-004', client: 'TCL-SEED-GEN4', counterparty: 'Maharashtra State Electricity Distribution', ref: 'LOI/SJVN/TRD/2026/014', mw: 60, purchase: 5.04, tariff: 5.10, from: '2026-06-01', to: '2026-09-30' },
  // Over cap the other way: 6 paise is fine above ₹3 but not on a ₹2.80 sale.
  { id: 'BT-SEED-005', client: 'TCL-SEED-GEN1', counterparty: 'Bihar State Power Holding Co', ref: 'LOI/SJVN/TRD/2026/015', mw: 25, purchase: 2.74, tariff: 2.80, from: '2026-06-15', to: '2026-07-14' },
  { id: 'BT-SEED-006', client: 'TCL-SEED-GEN3', counterparty: 'Gujarat Urja Vikas Nigam Ltd', ref: 'LOI/SJVN/TRD/2026/016', mw: 45, purchase: 4.35, tariff: 4.40, from: '2026-07-01', to: '2026-09-30' },
  { id: 'BT-SEED-007', client: 'TCL-SEED-GEN2', counterparty: 'Punjab State Power Corporation Ltd', ref: 'LOI/SJVN/TRD/2026/017', mw: 30, purchase: 3.09, tariff: 3.15, from: '2026-07-01', to: '2026-07-31' },
  // Purchase leg never captured — the filing gate must refuse this until fixed.
  { id: 'BT-SEED-008', client: 'TCL-SEED-GEN4', counterparty: 'Delhi Transco Ltd', ref: 'LOI/SJVN/TRD/2026/018', mw: 20, purchase: null, tariff: 4.02, from: '2026-07-05', to: '2026-08-04' },
];

function seedBilateralTrades() {
  const insClient = db.prepare(`
    INSERT OR IGNORE INTO trading_clients (id, name, client_type, risk_rating, exposure_limit, status)
    VALUES (@id, @name, @client_type, 'LOW', 100000000, 'ACTIVE')
  `);
  const insTrade = db.prepare(`
    INSERT OR IGNORE INTO bilateral_transactions
      (id, client_id, counterparty, loi_contract_ref, quantum_mw, tariff_per_unit, purchase_rate_per_unit,
       open_access_status, schedule_status, start_date, end_date, status)
    VALUES (@id, @client_id, @counterparty, @ref, @mw, @tariff, @purchase,
       'APPROVED', 'APPROVED', @from, @to, 'ACTIVE')
  `);

  db.transaction(() => {
    FORM_IV_CLIENTS.forEach((c) => insClient.run(c));
    FORM_IV_TRADES.forEach((t) => insTrade.run({ ...t, client_id: t.client }));
  })();

  console.log('Bilateral trades seeded:', {
    clients: db.prepare('SELECT COUNT(*) c FROM trading_clients').get().c,
    trades: db.prepare('SELECT COUNT(*) c FROM bilateral_transactions').get().c,
  });
}

try {
  seedBilateralTrades();
} catch (e) {
  console.warn('Bilateral trade seed skipped:', e.message);
}

// ── REC lots and their disposal tranches ──
// Quantities follow the CERC certificate multiplier (hydro 1.5, solar/wind 1),
// and each lot is cleared across several exchange sessions rather than in one
// go, so the ledger exercises partial positions, redemptions and ageing.

const REC_LOTS = [
  {
    id: 'REC-SEED-001', rec_no: 'REC/HYDRO/2026-01/0001', source: 'NJHPS (Nathpa Jhakri)', technology: 'Hydro',
    contract_no: 'PPA/SJVN/NJHPS/001', vintage: '2026-01', energy_mwh: 4200, cost: 4,
    applied: '2026-02-08', issued: '2026-02-24', registry: 'GI/REC/ISS/2026/00418',
    txns: [
      { type: 'SALE', qty: 2500, rate: 385, date: '2026-03-25', platform: 'IEX', buyer: 'Maharashtra State Electricity Distribution', ref: 'IEX/REC/2026/03/1188' },
      { type: 'SALE', qty: 2000, rate: 402, date: '2026-04-29', platform: 'IEX', buyer: 'Gujarat Urja Vikas Nigam Ltd', ref: 'IEX/REC/2026/04/1342' },
      { type: 'SALE', qty: 1800, rate: 396, date: '2026-05-27', platform: 'PXIL', buyer: 'Tata Power Trading Co', ref: 'PXIL/REC/2026/05/0771' },
    ],
  },
  {
    id: 'REC-SEED-002', rec_no: 'REC/SOLAR/2026-02/0002', source: 'Charanka Solar Park (CSPP)', technology: 'Solar',
    contract_no: 'PPA/SJVN/2024/001', vintage: '2026-02', energy_mwh: 21500, cost: 4,
    applied: '2026-03-06', issued: '2026-03-20', registry: 'GI/REC/ISS/2026/00532',
    txns: [
      { type: 'SALE', qty: 9000, rate: 372, date: '2026-04-29', platform: 'IEX', buyer: 'UP Power Corporation Ltd', ref: 'IEX/REC/2026/04/1355' },
      { type: 'SALE', qty: 6500, rate: 358, date: '2026-06-24', platform: 'IEX', buyer: 'Rajasthan Urja Vikas Nigam', ref: 'IEX/REC/2026/06/1601' },
      { type: 'REDEMPTION', qty: 3000, date: '2026-05-18', obligated: 'SJVN Ltd — captive RPO compliance FY 2025-26', ref: 'GI/REC/RDM/2026/00219' },
    ],
  },
  {
    id: 'REC-SEED-003', rec_no: 'REC/HYDRO/2026-03/0003', source: 'RHPS (Rampur)', technology: 'Hydro',
    contract_no: null, vintage: '2026-03', energy_mwh: 3600, cost: 4,
    applied: '2026-04-07', issued: '2026-04-21', registry: 'GI/REC/ISS/2026/00674',
    txns: [
      { type: 'SALE', qty: 2200, rate: 410, date: '2026-06-24', platform: 'IEX', buyer: 'Punjab State Power Corporation Ltd', ref: 'IEX/REC/2026/06/1620' },
    ],
  },
  {
    id: 'REC-SEED-004', rec_no: 'REC/SOLAR/2026-04/0004', source: 'Charanka Solar Park (CSPP)', technology: 'Solar',
    contract_no: 'PPA/SJVN/2024/001', vintage: '2026-04', energy_mwh: 23800, cost: 4,
    applied: '2026-05-05', issued: '2026-05-19', registry: 'GI/REC/ISS/2026/00791',
    txns: [
      { type: 'SALE', qty: 8000, rate: 364, date: '2026-07-08', platform: 'IEX', buyer: 'Haryana Power Purchase Centre', ref: 'IEX/REC/2026/07/1744' },
    ],
  },
  // Issued but never taken to a session — this is the ageing inventory story.
  {
    id: 'REC-SEED-005', rec_no: 'REC/WIND/2026-05/0005', source: 'Khirvire Wind (JV)', technology: 'Wind',
    contract_no: null, vintage: '2026-05', energy_mwh: 5400, cost: 4,
    applied: '2026-06-04', issued: '2026-06-18', registry: 'GI/REC/ISS/2026/00903',
    txns: [],
  },
  // Applied for, awaiting the Central Agency's 15-working-day issuance window.
  {
    id: 'REC-SEED-006', rec_no: 'REC/HYDRO/2026-06/0006', source: 'NJHPS (Nathpa Jhakri)', technology: 'Hydro',
    contract_no: 'PPA/SJVN/NJHPS/001', vintage: '2026-06', energy_mwh: 5100, cost: 4,
    applied: '2026-07-06', issued: null, registry: null,
    txns: [],
  },
];

function seedRecLedger() {
  // Multipliers live in masters; make sure the defaults are present so the
  // seeded quantities match what the API would compute.
  ensureMasterDefaults();
  const MULTIPLIER = { Hydro: 1.5, Solar: 1, Wind: 1 };

  const insLot = db.prepare(`
    INSERT OR IGNORE INTO rec_ledger (id, rec_no, source, technology, certificate_multiplier, energy_mwh,
      contract_id, vintage_month, quantity, status, application_date, issuance_date, registry_ref,
      issue_cost_per_rec, sale_rate_per_rec, sale_amount, created_by)
    VALUES (@id, @rec_no, @source, @technology, @multiplier, @energy_mwh,
      @contract_id, @vintage, @quantity, @status, @applied, @issued, @registry,
      @cost, 0, 0, 'Shreya (Trading Ops)')
  `);
  const insTxn = db.prepare(`
    INSERT OR IGNORE INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount,
      trade_date, platform, buyer, obligated_entity, reference, created_by)
    VALUES (@id, @lot_id, @txn_no, @txn_type, @quantity, @rate, @amount,
      @trade_date, @platform, @buyer, @obligated, @reference, 'Shreya (Trading Ops)')
  `);

  let txnSeq = 0;
  db.transaction(() => {
    REC_LOTS.forEach((lot) => {
      const multiplier = MULTIPLIER[lot.technology] || 1;
      const contract = lot.contract_no
        ? db.prepare('SELECT id FROM contracts WHERE contract_no = ?').get(lot.contract_no)
        : null;

      insLot.run({
        id: lot.id, rec_no: lot.rec_no, source: lot.source, technology: lot.technology,
        multiplier, energy_mwh: lot.energy_mwh, contract_id: contract?.id || null,
        vintage: lot.vintage, quantity: Math.floor(lot.energy_mwh * multiplier),
        status: lot.issued ? 'ISSUED' : 'APPLIED',
        applied: lot.applied, issued: lot.issued, registry: lot.registry, cost: lot.cost,
      });

      lot.txns.forEach((t, i) => {
        txnSeq += 1;
        const rate = t.type === 'SALE' ? t.rate : 0;
        insTxn.run({
          id: `RECT-SEED-${lot.id.slice(-3)}-${i + 1}`,
          lot_id: lot.id,
          txn_no: `RECT/SEED/${String(txnSeq).padStart(4, '0')}`,
          txn_type: t.type,
          quantity: t.qty,
          rate,
          amount: Math.round(t.qty * rate),
          trade_date: t.date,
          platform: t.platform || null,
          buyer: t.buyer || null,
          obligated: t.obligated || null,
          reference: t.ref || null,
        });
      });
    });
  })();

  // Fold the tranches into each lot's position using the same code the API uses.
  REC_LOTS.forEach((lot) => refreshLot(lot.id));

  const agg = db.prepare(`
    SELECT COALESCE(SUM(quantity),0) issued, COALESCE(SUM(sold_qty),0) sold,
           COALESCE(SUM(redeemed_qty),0) redeemed, COALESCE(SUM(sale_amount),0) revenue
    FROM rec_ledger WHERE status != 'CANCELLED'
  `).get();
  console.log('REC ledger seeded:', {
    lots: db.prepare('SELECT COUNT(*) c FROM rec_ledger').get().c,
    tranches: db.prepare('SELECT COUNT(*) c FROM rec_transactions').get().c,
    issued: agg.issued,
    held: agg.issued - agg.sold - agg.redeemed,
    revenue: agg.revenue,
  });
}

try {
  seedRecLedger();
} catch (e) {
  console.warn('REC ledger seed skipped:', e.message);
}

// ── Exchange desk (ISET Power Trading → Exchange) ──
// Additive: fixed ids + INSERT OR IGNORE, so an existing platform.db picks up
// contracts / bids / invoices without a destructive reseed.
try {
  seedExchangeDesk();
} catch (e) {
  console.warn('Exchange desk seed skipped:', e.message);
}

try {
  seedBilateralDesk();
} catch (e) {
  console.warn('Bilateral desk seed skipped:', e.message);
}

try {
  seedRecDesk();
} catch (e) {
  console.warn('REC desk seed skipped:', e.message);
}

const already = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (already > 0) {
  console.log('Database already seeded. Skipping the rest. (delete platform.db to reseed)');
  process.exit(0);
}

const hash = bcrypt.hashSync('password123', 8);

const insertUser = db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, linked_entity_id)
  VALUES (@id, @name, @email, @password_hash, @role, @linked_entity_id)
`);

const users = [
  { name: 'Admin User', email: 'admin@sjvn.in', role: 'SJVN_ADMIN' },
  { name: 'Rahul (REIA Ops)', email: 'reia@sjvn.in', role: 'REIA_USER' },
  { name: 'Shreya (Trading Ops)', email: 'trading@sjvn.in', role: 'TRADING_USER' },
  { name: 'Vikas (Finance)', email: 'finance@sjvn.in', role: 'FINANCE_USER' },
  { name: 'Divyankur (Management)', email: 'management@sjvn.in', role: 'MANAGEMENT' },
  { name: 'Ravi (Compliance)', email: 'auditor@sjvn.in', role: 'COMPLIANCE_AUDITOR' },
  { name: 'Sunrise Solar Pvt Ltd', email: 'seller@sunrise-solar.in', role: 'SELLER' },
  { name: 'State DISCOM Buyer', email: 'buyer@discom.gov.in', role: 'BUYER' },
  { name: 'ABC Trading Client', email: 'client@abctrading.in', role: 'TRADING_CLIENT' },
];

const userIds = {};
for (const u of users) {
  const id = newId('USR');
  userIds[u.email] = id;
  insertUser.run({ id, name: u.name, email: u.email, password_hash: hash, role: u.role, linked_entity_id: null });
}

const insertEntity = db.prepare(`
  INSERT INTO entities (id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating, is_blacklisted,
    capacity_mw, technology, contracted_capacity_mw, psa_tariff, supply_criteria, organization_details, regulatory_approvals,
    bank_name, account_no, ifsc_code, branch_address, is_penny_drop_verified, status, address, corporate_email, corporate_phone)
  VALUES (@id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating, @is_blacklisted,
    @capacity_mw, @technology, @contracted_capacity_mw, @psa_tariff, @supply_criteria, @organization_details, @regulatory_approvals,
    @bank_name, @account_no, @ifsc_code, @branch_address, @is_penny_drop_verified, @status, @address, @corporate_email, @corporate_phone)
`);

const seller = {
  id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator',
  name: 'Sunrise Solar Pvt Ltd', pan_no: 'ABCDE1234F', gst_no: '08ABCDE1234F1Z5', cin: 'U40106RJ2016PTC012345',
  credit_rating: 'AA', is_blacklisted: 0, capacity_mw: 150, technology: 'Solar', contracted_capacity_mw: 150,
  psa_tariff: null, supply_criteria: null, organization_details: 'Demo solar SPV', regulatory_approvals: 'CEA registered',
  bank_name: 'HDFC Bank', account_no: '001122334455', ifsc_code: 'HDFC0001234', branch_address: 'Jaipur',
  is_penny_drop_verified: 1, status: 'APPROVED', address: 'Jaipur, Rajasthan',
  corporate_email: 'ops@sunrise-solar.in', corporate_phone: '9876543210',
};

const buyer = {
  id: newId('BUY'), parent_entity_id: null, entity_type: 'BUYER', category: 'DISCOM',
  name: 'Punjab State Power Corp', pan_no: 'PSPBB3456I', gst_no: '03PSPBB3456I1Z5', cin: 'U40109PB2010SGC033813',
  credit_rating: 'A', is_blacklisted: 0, capacity_mw: null, technology: null, contracted_capacity_mw: 120,
  psa_tariff: 3.45, supply_criteria: 'Round the clock RE supply', organization_details: 'State DISCOM',
  regulatory_approvals: 'PSERC approved', bank_name: 'PNB', account_no: '550066778899', ifsc_code: 'PUNB0123456',
  branch_address: 'Chandigarh', is_penny_drop_verified: 1, status: 'APPROVED', address: 'Chandigarh',
  corporate_email: 'billing@pspcl.in', corporate_phone: '9811112233',
};

insertEntity.run(seller);
insertEntity.run(buyer);

db.prepare(`
  INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
  VALUES (?, ?, 'COMMERCIAL', ?, ?, ?, 1)
`).run(newId('CNT'), seller.id, 'Amit Sharma', 'billing@sunrise-solar.in', '9876543210');
db.prepare(`
  INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
  VALUES (?, ?, 'COMMERCIAL', ?, ?, ?, 1)
`).run(newId('CNT'), buyer.id, 'Priya Kaur', 'billing@pspcl.in', '9811112233');

db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(seller.id, 'seller@sunrise-solar.in');
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(buyer.id, 'buyer@discom.gov.in');

const ppa = {
  id: newId('CON'),
  contract_no: 'PPA/SJVN/2024/001',
  contract_type: 'PPA',
  seller_id: seller.id,
  buyer_id: null,
  project_type: 'Solar',
  capacity_mw: 150,
  commissioned_capacity_mw: 150,
  cod_date: '2024-03-15',
  tariff_type: 'FLAT',
  tariff_per_unit: 2.55,
  tariff_structure_json: null,
  tenure_start: '2024-04-01',
  tenure_end: '2049-03-31',
  billing_cycle: 'MONTHLY',
  payment_terms: 'Net 30 days',
  emd_amount: 15000000,
  pbg_amount: 22500000,
  pbg_type: 'BG',
  pbg_expiry: '2027-03-31',
  termination_reason: null,
  termination_date: null,
  status: 'ACTIVE',
};

const psa = {
  id: newId('CON'),
  contract_no: 'PSA/SJVN/2024/101',
  contract_type: 'PSA',
  seller_id: null,
  buyer_id: buyer.id,
  project_type: 'Solar',
  capacity_mw: 120,
  commissioned_capacity_mw: 120,
  cod_date: '2024-03-15',
  tariff_type: 'FLAT',
  tariff_per_unit: 3.45,
  tariff_structure_json: null,
  tenure_start: '2024-04-01',
  tenure_end: '2049-03-31',
  billing_cycle: 'MONTHLY',
  payment_terms: 'Net 45 days',
  emd_amount: null,
  pbg_amount: null,
  pbg_type: null,
  pbg_expiry: null,
  termination_reason: null,
  termination_date: null,
  status: 'ACTIVE',
};

const insertContract = db.prepare(`
  INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms,
    emd_amount, pbg_amount, pbg_type, pbg_expiry, termination_reason, termination_date, status)
  VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
    @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms,
    @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, @termination_reason, @termination_date, @status)
`);
insertContract.run(ppa);
insertContract.run(psa);

db.prepare(`
  INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw) VALUES (?, ?, ?)
`).run(ppa.id, seller.id, 150);

db.prepare(`
  INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from)
  VALUES (?, ?, ?, ?, ?)
`).run(newId('ALC'), ppa.id, psa.id, 80, '2024-04-01');

// ── NJHPS Hydro PPA (CERC capacity + β demo) ──
const existingNjhpsSeller = db.prepare(`SELECT id FROM entities WHERE pan_no = 'AABCS1234D' OR name LIKE '%Nathpa Jhakri%'`).get();
const njhpsSeller = existingNjhpsSeller || {
  id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator',
  name: 'SJVN Nathpa Jhakri HEP', pan_no: 'AABCS1234D', gst_no: '02AABCS1234D1Z5', cin: 'L40101HP1988GOI008409',
  credit_rating: 'AAA', is_blacklisted: 0, capacity_mw: 1500, technology: 'Hydro', contracted_capacity_mw: 1500,
  psa_tariff: null, supply_criteria: null, organization_details: 'NJHPS hydro station', regulatory_approvals: 'CERC',
  bank_name: 'SBI', account_no: '112233445566', ifsc_code: 'SBIN0001234', branch_address: 'Shimla',
  is_penny_drop_verified: 1, status: 'APPROVED', address: 'Jhakri, Himachal Pradesh',
  corporate_email: 'billing@sjvn.nic.in', corporate_phone: '0177-2660089',
};
if (!existingNjhpsSeller) {
  insertEntity.run(njhpsSeller);
}

const existingNjhpsPpa = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
const njhpsPpa = existingNjhpsPpa || {
  id: newId('CON'),
  contract_no: 'PPA/SJVN/NJHPS/001',
  contract_type: 'PPA',
  seller_id: njhpsSeller.id,
  buyer_id: null,
  project_type: 'Hydro',
  capacity_mw: 1500,
  commissioned_capacity_mw: 1500,
  cod_date: '2004-05-06',
  tariff_type: 'TWO_PART',
  tariff_per_unit: 1.25,
  tariff_structure_json: null,
  tenure_start: '2004-05-06',
  tenure_end: '2039-05-05',
  billing_cycle: 'MONTHLY',
  payment_terms: 'Net 45 days',
  emd_amount: null,
  pbg_amount: null,
  pbg_type: null,
  pbg_expiry: null,
  termination_reason: null,
  termination_date: null,
  status: 'ACTIVE',
};
if (!existingNjhpsPpa) {
  insertContract.run(njhpsPpa);
}

db.prepare(`
  UPDATE contracts SET normative_aux = ?, free_energy_home_state = ?, capacity_charges_total = ?,
    annual_afc = ?, annual_design_energy_mwh = ?, napaf_percent = ?
  WHERE id = ?
`).run(1.2, 12, Math.round(14615741000 / 12), 14615741000, 6612000, 87, njhpsPpa.id);

const existingBeta = db.prepare(`SELECT id FROM station_beta WHERE contract_id = ? AND period_month = '2026-05'`).get(njhpsPpa.id);
if (!existingBeta) {
  db.prepare(`
    INSERT INTO station_beta (
      id, contract_id, period_month, beta_value, station_code, station_name,
      source, certified_on, notes, created_by
    ) VALUES (?, ?, '2026-05', 1.00, 'NJHPS', 'NATHPA JHAKRI', 'NRPC', '2026-06-19',
      'NRPC Average Monthly Frequency Response Performance – May 2026', ?)
  `).run(newId('BETA'), njhpsPpa.id, 'Rahul (REIA Ops)');
}

// ── One clear billing story for May 2026 (BFR demo) ──
const period = '2026-05';
const bfrPpa = buildBillingFamilyRef(ppa.contract_no, period, 'SELLER_TO_SJVN');

const engProvId = newId('ENG');
const engFinalId = newId('ENG');
const provMwh = 24000;
const finalMwh = 25200;

db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status, billing_family_ref, supersedes_energy_id)
  VALUES (?, ?, ?, 'PROVISIONAL', 'REA', ?, 22.2, 98.1, 'LOCKED', ?, NULL)
`).run(engProvId, ppa.id, period, provMwh, bfrPpa);

db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status, billing_family_ref, supersedes_energy_id)
  VALUES (?, ?, ?, 'FINAL', 'REA', ?, 23.3, 98.5, 'LOCKED', ?, ?)
`).run(engFinalId, ppa.id, period, finalMwh, bfrPpa, engProvId);

// tariff is ₹/kWh; energy in MWh → ×1000 for rupee charges
const provCharges = Math.round(provMwh * 1000 * ppa.tariff_per_unit);
const invProvId = newId('INV');
db.prepare(`
  INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
    tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
    transmission_charges, lps, penalty, trading_margin, taxes, other_adjustments, total_amount,
    disputed_amount, due_date, status, billing_family_ref, energy_data_id, created_by)
  VALUES (?, ?, ?, 'PROVISIONAL', 'SELLER_TO_SJVN', ?, ?,
    ?, ?, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, ?,
    0, '2026-06-30', 'PARTIALLY_PAID', ?, ?, ?)
`).run(
  invProvId, 'INV-PPA/2026/1001', ppa.id, period, provMwh,
  ppa.tariff_per_unit, provCharges, provCharges,
  bfrPpa, engProvId, 'Rahul (REIA Ops)'
);

const paidAmt = Math.round(provCharges * 0.6);
db.prepare(`
  INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction)
  VALUES (?, ?, ?, '2026-06-15', 'NEFT', 'UTR-DEMO-001', 0)
`).run(newId('PAY'), invProvId, paidAmt);

// Light payment security on PPA (requirements + instruments)
try {
  const seedUser = { id: userIds['reia@sjvn.in'], name: 'Rahul (REIA Ops)' };
  syncRequirementsFromContract(ppa.id);
  createInstrumentsFromRequirements(ppa.id, seedUser);
} catch (e) {
  console.warn('Payment security seed skipped:', e.message);
}

// One trading client shell (empty bids — portal not empty on Trading nav)
db.prepare(`
  INSERT INTO trading_clients (id, name, client_type, risk_rating, exposure_limit, status)
  VALUES (?, 'ABC Trading Client', 'TRADER', 'LOW', 50000000, 'ACTIVE')
`).run(newId('TCL'));

// Master data defaults (also applied on every server boot)
try {
  ensureMasterDefaults();
  console.log('Master data seeded:', {
    banks: db.prepare('SELECT COUNT(*) c FROM bank_master').get().c,
    params: db.prepare('SELECT COUNT(*) c FROM system_parameters').get().c,
    doc_types: db.prepare('SELECT COUNT(*) c FROM document_type_master').get().c,
    lookups: db.prepare('SELECT COUNT(*) c FROM lookup_master').get().c,
  });
} catch (e) {
  console.warn('Master defaults seed skipped:', e.message);
}

console.log('── Fresh minimal seed complete ──');
console.log('Logins (password: password123):');
console.log('  reia@sjvn.in / admin@sjvn.in / seller@sunrise-solar.in / buyer@discom.gov.in');
console.log('Demo story: PPA/SJVN/2024/001 · period 2026-05');
console.log('  Provisional energy + invoice (60% paid) + Final energy (same BFR)');
console.log('  Open Invoices → click BFR / Settlement Trail');
console.log('NJHPS Hydro: PPA/SJVN/NJHPS/001 · β=1.00 for 2026-05 (Masters → Frequency β)');
console.log('Counts:', {
  entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
  contracts: db.prepare('SELECT COUNT(*) c FROM contracts').get().c,
  energy: db.prepare('SELECT COUNT(*) c FROM energy_data').get().c,
  invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
  payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c,
});
