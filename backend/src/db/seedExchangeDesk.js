/**
 * Additive Exchange-desk demo seed.
 *
 * Fills the ISET Power Trading → Exchange screens (contracts, bidding,
 * applications, DAM/RTM/GDAM bids, IEX bid book, PXIL, settlement invoices)
 * without touching users or wiping platform.db. Ids are stable; INSERT OR IGNORE
 * so a second `npm run seed` is a no-op.
 */
import db from './index.js';
import { seedRateMaster } from '../services/rateMaster.js';
import { refreshExchangeContractStatus } from '../services/exchangeSettlement.js';
import { priceBill, raiseInvoice, billingObjection } from '../services/billingRegister.js';

function iso(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function monthStart(offsetMonths = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 10);
}

function monthEnd(offsetMonths = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function fmtCreated(offsetDays, hh = 10, mm = 15) {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 15-minute labels `HH:MM-HH:MM` covering [from, to) in minutes from midnight. */
function blocksInRange(fromH, fromM, toH, toM) {
  const start = fromH * 60 + fromM;
  const end = toH * 60 + toM;
  const out = [];
  for (let t = start; t < end; t += 15) {
    const aH = String(Math.floor(t / 60)).padStart(2, '0');
    const aM = String(t % 60).padStart(2, '0');
    const b = t + 15;
    const bH = String(Math.floor(b / 60) % 24).padStart(2, '0');
    const bM = String(b % 60).padStart(2, '0');
    out.push(`${aH}:${aM}-${bH}:${bM}`);
  }
  return out;
}

const PEAK = blocksInRange(18, 0, 20, 0);     // 8 blocks, evening
const SOLAR = blocksInRange(10, 0, 16, 0);    // 24 blocks, solar hours
const RTM_PEAK = blocksInRange(18, 0, 19, 0); // 4 blocks

function userId(email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id || null;
}

function ensureClient(c) {
  if (c.entity_id && c.short_code) {
    const entityType = c.client_type === 'GENERATOR' ? 'SELLER' : 'BUYER';
    db.prepare(`
      INSERT OR IGNORE INTO entities (id, entity_type, category, name, short_code, status)
      VALUES (?, ?, ?, ?, ?, 'APPROVED')
    `).run(c.entity_id, entityType, c.client_type === 'GENERATOR' ? 'RE Generator' : 'DISCOM', c.name, c.short_code);
  }
  db.prepare(`
    INSERT OR IGNORE INTO trading_clients
      (id, entity_id, name, client_type, risk_rating, exposure_limit, status,
       sldc_name, noc_valid_till, standing_clearance_no, noar_id,
       tgna_approved_mw, periphery_loss_percent)
    VALUES (@id, @entity_id, @name, @client_type, 'LOW', @exposure_limit, 'ACTIVE',
       @sldc_name, @noc_valid_till, @standing_clearance_no, @noar_id,
       @tgna_approved_mw, @periphery_loss_percent)
  `).run(c);
  db.prepare(`
    UPDATE trading_clients SET
      exposure_limit = MAX(COALESCE(exposure_limit, 0), @exposure_limit),
      sldc_name = COALESCE(sldc_name, @sldc_name),
      noc_valid_till = COALESCE(noc_valid_till, @noc_valid_till),
      standing_clearance_no = COALESCE(standing_clearance_no, @standing_clearance_no),
      noar_id = COALESCE(noar_id, @noar_id),
      tgna_approved_mw = COALESCE(tgna_approved_mw, @tgna_approved_mw),
      periphery_loss_percent = COALESCE(periphery_loss_percent, @periphery_loss_percent),
      entity_id = COALESCE(entity_id, @entity_id),
      status = 'ACTIVE'
    WHERE id = @id
  `).run(c);

  if (c.exchanges) {
    const insEx = db.prepare(`
      INSERT OR IGNORE INTO trading_client_exchanges (id, client_id, exchange, registration_id, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);
    for (const [exchange, registrationId] of Object.entries(c.exchanges)) {
      insEx.run(`${c.id}-${exchange}`, c.id, exchange, registrationId);
    }
  }
}

function insertContract(row) {
  db.prepare(`
    INSERT OR IGNORE INTO exchange_contracts (
      id, contract_type, portfolio_id, loa_no, ppa_no, start_date, end_date,
      compensation, late_payment_surcharge, rebate,
      side, carry_over, client_id, client_name, concerned_sldc, region,
      product, bidding_type, is_renewable, billing_type,
      bank_guarantee, bank_guarantee_validity, client_registration_fee,
      trading_margin, application_fee, remarks, schedule_json, status, created_by, created_at
    ) VALUES (
      @id, 'Exchange', @portfolio_id, @loa_no, @ppa_no, @start_date, @end_date,
      @compensation, @late_payment_surcharge, @rebate,
      @side, @carry_over, @client_id, @client_name, @concerned_sldc, @region,
      @product, @bidding_type, @is_renewable, @billing_type,
      @bank_guarantee, @bank_guarantee_validity, @client_registration_fee,
      @trading_margin, @application_fee, @remarks, @schedule_json, @status, @created_by, @created_at
    )
  `).run(row);
}

function insertBid({ id, client_id, contract_id, exchange, product, bid_date, delivery_date,
  status, approval_status, quantum_mw, price_per_unit, cleared_quantum_mw = 0, cleared_price = null,
  ocf_leg = 0, carry_forward_from = null, premium_discount = 0, created_by, blocks, events }) {
  db.prepare(`
    INSERT OR IGNORE INTO bids (
      id, client_id, exchange, product, bid_date, delivery_date, time_block,
      quantum_mw, price_per_unit, approval_status, contract_id,
      carry_forward_from, ocf_leg, premium_discount,
      cleared_quantum_mw, cleared_price, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, client_id, exchange, product, bid_date, delivery_date, blocks[0]?.time_block || null,
    quantum_mw, price_per_unit, approval_status, contract_id,
    carry_forward_from, ocf_leg, premium_discount,
    cleared_quantum_mw, cleared_price, status, created_by, `${bid_date} 10:05:00`,
  );

  const insBlk = db.prepare(`
    INSERT OR IGNORE INTO bid_blocks
      (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  blocks.forEach((blk, i) => {
    insBlk.run(
      `${id}-B${String(i + 1).padStart(2, '0')}`,
      id, blk.time_block, blk.quantum_mw, blk.price_per_unit,
      blk.cleared_quantum_mw ?? 0, blk.cleared_price ?? null, blk.status,
    );
  });

  const insEv = db.prepare(`
    INSERT OR IGNORE INTO bid_events (id, bid_id, actor_id, event_type, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  (events || []).forEach((ev, i) => {
    insEv.run(`${id}-E${i + 1}`, id, ev.actor, ev.type, JSON.stringify(ev.details || {}), ev.at);
  });
}

export function seedExchangeDesk() {
  seedRateMaster();

  const trader = userId('trading@sjvn.in');
  const checker = userId('admin@sjvn.in');
  const thisStart = monthStart(0);
  const thisEnd = monthEnd(0);
  const lastStart = monthStart(-1);
  const lastEnd = monthEnd(-1);
  const nextStart = monthStart(1);
  const nextEnd = monthEnd(1);

  const clients = {
    ndmc: {
      id: 'TCL-EX-NDMC', entity_id: 'ENT-EX-NDMC', short_code: 'NDMC',
      name: 'New Delhi Municipal Council', client_type: 'DISCOM',
      exposure_limit: 500000000, sldc_name: 'Delhi', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'SLDC-DL/SC/2026/0144', noar_id: 'NOAR-NDMC-001',
      tgna_approved_mw: 250, periphery_loss_percent: 3.2,
      exchanges: { IEX: 'N2DL0SJV0000', PXIL: 'PX-NDMC-001', HPX: 'HPX-NDMC-001' },
    },
    hppc: {
      id: 'TCL-EX-HPPC', entity_id: 'ENT-EX-HPPC', short_code: 'HPPC',
      name: 'Haryana Power Purchase Centre', client_type: 'DISCOM',
      exposure_limit: 400000000, sldc_name: 'Haryana', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'HVPN-SLDC/SC/2026/088', noar_id: 'NOAR-HPPC-001',
      tgna_approved_mw: 180, periphery_loss_percent: 4.1,
      exchanges: { IEX: 'N2HR0HPP0001' },
    },
    pspcl: {
      id: 'TCL-EX-PSPCL', entity_id: 'ENT-EX-PSPCL', short_code: 'PSPCL',
      name: 'Punjab State Power Corporation Ltd', client_type: 'DISCOM',
      exposure_limit: 350000000, sldc_name: 'Punjab', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'PSTCL-SLDC/SC/2026/061', noar_id: 'NOAR-PSPCL-001',
      tgna_approved_mw: 150, periphery_loss_percent: 3.8,
      exchanges: { IEX: 'N2PB0PSP0001' },
    },
    teesta: {
      id: 'TCL-SEED-GEN1', entity_id: 'ENT-EX-TEESTA', short_code: 'TEESTA',
      name: 'Teesta Urja Ltd', client_type: 'GENERATOR',
      exposure_limit: 200000000, sldc_name: 'Sikkim', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'SSLD-SC/2026/012', noar_id: 'NOAR-TEESTA-001',
      tgna_approved_mw: 200, periphery_loss_percent: 2.5,
      exchanges: { IEX: 'E1SK0TST0001' },
    },
    adani: {
      id: 'TCL-SEED-GEN3', entity_id: 'ENT-EX-ADANI', short_code: 'ADANI',
      name: 'Adani Green Energy Ltd', client_type: 'GENERATOR',
      exposure_limit: 300000000, sldc_name: 'Gujarat', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'GETCO-SLDC/SC/2026/204', noar_id: 'NOAR-ADANI-001',
      tgna_approved_mw: 300, periphery_loss_percent: 3.0,
      exchanges: { IEX: 'W2GJ0AGE0001', PXIL: 'PX-AGE-001' },
    },
  };

  const schedule = (from, to, rate, quantum) => JSON.stringify([
    { date_from: from, date_to: to, time_from: '00:00', time_to: '24:00', rate_type: 'Fixed', rate, quantum },
  ]);

  db.transaction(() => {
    Object.values(clients).forEach(ensureClient);

    insertContract({
      id: 'EXC-SEED-NDMC-DAM', portfolio_id: 'IEXNDMC123', loa_no: 'EXC/LOA/NDMC/DAM/2026-08',
      ppa_no: 'PPA/NDMC/EXCH/2025/07', start_date: thisStart, end_date: thisEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Buyer', carry_over: 'Yes',
      client_id: clients.ndmc.id, client_name: clients.ndmc.name, concerned_sldc: 'Delhi', region: 'NR',
      product: 'DAM', bidding_type: 'Single Bid', is_renewable: 'No', billing_type: 'Weekly',
      bank_guarantee: 25000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 50000,
      trading_margin: 0.03, application_fee: 10000,
      remarks: 'NDMC day-ahead buy on IEX — evening peak + solar hours.',
      schedule_json: schedule(thisStart, thisEnd, 5.5, 80),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-20, 9, 40),
    });
    insertContract({
      id: 'EXC-SEED-HPPC-RTM', portfolio_id: 'IEXHPPC088', loa_no: 'EXC/LOA/HPPC/RTM/2026-08',
      ppa_no: 'PPA/HPPC/EXCH/2026/02', start_date: thisStart, end_date: thisEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Buyer', carry_over: 'No',
      client_id: clients.hppc.id, client_name: clients.hppc.name, concerned_sldc: 'Haryana', region: 'NR',
      product: 'RTM', bidding_type: 'Single Bid', is_renewable: 'No', billing_type: 'Weekly',
      bank_guarantee: 15000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 25000,
      trading_margin: 0.04, application_fee: 8000,
      remarks: 'HPPC real-time top-up for evening peak shortfall.',
      schedule_json: schedule(thisStart, thisEnd, 6.2, 40),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-18, 11, 5),
    });
    insertContract({
      id: 'EXC-SEED-PSPCL-GDAM', portfolio_id: 'IEXPSPCL061', loa_no: 'EXC/LOA/PSPCL/GDAM/2026-08',
      ppa_no: 'PPA/PSPCL/GREEN/2025/11', start_date: thisStart, end_date: thisEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Buyer', carry_over: 'Yes',
      client_id: clients.pspcl.id, client_name: clients.pspcl.name, concerned_sldc: 'Punjab', region: 'NR',
      product: 'GDAM', bidding_type: 'Single Bid', is_renewable: 'Yes', billing_type: 'Weekly',
      bank_guarantee: 18000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 25000,
      trading_margin: 0.03, application_fee: 8000,
      remarks: 'PSPCL green day-ahead buy against RPO.',
      schedule_json: schedule(thisStart, thisEnd, 4.8, 60),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-16, 14, 22),
    });
    insertContract({
      id: 'EXC-SEED-TEESTA-DAM', portfolio_id: 'IEXTEESTA012', loa_no: 'EXC/LOA/TEESTA/DAM/2026-08',
      ppa_no: 'PPA/TEESTA/SALE/2024/04', start_date: thisStart, end_date: thisEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Seller', carry_over: 'No',
      client_id: clients.teesta.id, client_name: clients.teesta.name, concerned_sldc: 'Sikkim', region: 'ER',
      product: 'DAM', bidding_type: 'Block Bid', is_renewable: 'Yes', billing_type: 'Weekly',
      bank_guarantee: 20000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 40000,
      trading_margin: 0.02, application_fee: 10000,
      remarks: 'Teesta surplus hydro sale on IEX DAM.',
      schedule_json: schedule(thisStart, thisEnd, 4.1, 100),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-15, 8, 50),
    });
    insertContract({
      id: 'EXC-SEED-ADANI-TAM', portfolio_id: 'PXADANI204', loa_no: 'EXC/LOA/ADANI/TAM/2026-08',
      ppa_no: 'PPA/ADANI/TAM/2026/01', start_date: thisStart, end_date: nextEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Seller', carry_over: 'No',
      client_id: clients.adani.id, client_name: clients.adani.name, concerned_sldc: 'Gujarat', region: 'WR',
      product: 'TAM', bidding_type: 'Block Bid', is_renewable: 'Yes', billing_type: 'Fortnightly',
      bank_guarantee: 30000000, bank_guarantee_validity: '2027-06-30', client_registration_fee: 50000,
      trading_margin: 0.025, application_fee: 12000,
      remarks: 'Adani Green weekly TAM sale on PXIL.',
      schedule_json: schedule(thisStart, nextEnd, 4.4, 75),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-12, 16, 10),
    });
    insertContract({
      id: 'EXC-SEED-NDMC-JUL', portfolio_id: 'IEXNDMC123', loa_no: 'EXC/LOA/NDMC/DAM/2026-07',
      ppa_no: 'PPA/NDMC/EXCH/2025/07', start_date: lastStart, end_date: lastEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Buyer', carry_over: 'No',
      client_id: clients.ndmc.id, client_name: clients.ndmc.name, concerned_sldc: 'Delhi', region: 'NR',
      product: 'DAM', bidding_type: 'Single Bid', is_renewable: 'No', billing_type: 'Weekly',
      bank_guarantee: 25000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 50000,
      trading_margin: 0.03, application_fee: 10000,
      remarks: 'Closed July DAM window — completed after last delivery.',
      schedule_json: schedule(lastStart, lastEnd, 5.2, 80),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-40, 9, 0),
    });
    insertContract({
      id: 'EXC-SEED-HPPC-SEP', portfolio_id: 'IEXHPPC088', loa_no: 'EXC/LOA/HPPC/DAM/2026-09',
      ppa_no: 'PPA/HPPC/EXCH/2026/02', start_date: nextStart, end_date: nextEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Buyer', carry_over: 'Yes',
      client_id: clients.hppc.id, client_name: clients.hppc.name, concerned_sldc: 'Haryana', region: 'NR',
      product: 'DAM', bidding_type: 'Single Bid', is_renewable: 'No', billing_type: 'Weekly',
      bank_guarantee: 15000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 25000,
      trading_margin: 0.03, application_fee: 8000,
      remarks: 'September DAM agreement — filed, not yet bid (DRAFT).',
      schedule_json: schedule(nextStart, nextEnd, 5.4, 60),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-1, 17, 45),
    });

    const insBidding = db.prepare(`
      INSERT OR IGNORE INTO exchange_biddings (
        id, client_id, client_name, client_ref_no, exchange, segment, portfolio_id,
        contract_id, contract_label, product_type, bidding_type,
        supply_start_date, supply_end_date, schedule_json, status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)
    `);
    const bidSched = (date, side, price, cap) => JSON.stringify([
      { date_from: date, date_to: date, time_from: '18:00', time_to: '20:00', price, capacity: cap, side },
    ]);
    insBidding.run('EXB-SEED-001', clients.ndmc.id, clients.ndmc.name, 'NDMC/DAM/WK33',
      'IEX', 'Day Ahead', 'IEXNDMC123', 'EXC-SEED-NDMC-DAM', 'EXC/LOA/NDMC/DAM/2026-08',
      'DAM', 'Single Bid', iso(-5), iso(-5), bidSched(iso(-5), 'Buy', 5500, 80), trader, fmtCreated(-5, 10, 12));
    insBidding.run('EXB-SEED-002', clients.ndmc.id, clients.ndmc.name, 'NDMC/DAM/WK34',
      'IEX', 'Day Ahead', 'IEXNDMC123', 'EXC-SEED-NDMC-DAM', 'EXC/LOA/NDMC/DAM/2026-08',
      'DAM', 'Single Bid', iso(-1), iso(-1), bidSched(iso(-1), 'Buy', 6200, 80), trader, fmtCreated(-1, 10, 8));
    insBidding.run('EXB-SEED-003', clients.hppc.id, clients.hppc.name, 'HPPC/RTM/0817',
      'IEX', 'Real Time', 'IEXHPPC088', 'EXC-SEED-HPPC-RTM', 'EXC/LOA/HPPC/RTM/2026-08',
      'RTM', 'Single Bid', iso(-2), iso(-2), bidSched(iso(-2), 'Buy', 7100, 40), trader, fmtCreated(-2, 17, 40));
    insBidding.run('EXB-SEED-004', clients.pspcl.id, clients.pspcl.name, 'PSPCL/GDAM/WK33',
      'IEX', 'Green', 'IEXPSPCL061', 'EXC-SEED-PSPCL-GDAM', 'EXC/LOA/PSPCL/GDAM/2026-08',
      'GDAM', 'Single Bid', iso(-3), iso(-3),
      JSON.stringify([{ date_from: iso(-3), date_to: iso(-3), time_from: '10:00', time_to: '16:00', price: 4800, capacity: 60, side: 'Buy' }]),
      trader, fmtCreated(-3, 10, 30));
    insBidding.run('EXB-SEED-005', clients.teesta.id, clients.teesta.name, 'TEESTA/DAM/SELL',
      'IEX', 'Day Ahead', 'IEXTEESTA012', 'EXC-SEED-TEESTA-DAM', 'EXC/LOA/TEESTA/DAM/2026-08',
      'DAM', 'Block Bid', iso(-4), iso(-4), bidSched(iso(-4), 'Sell', 4100, 100), trader, fmtCreated(-4, 9, 55));

    const insLatest = db.prepare(`
      INSERT OR IGNORE INTO exchange_bidding_latest (
        id, transaction_id, client_id, client_name, client_ref_no, contract_id, contract_label,
        product_type, bid_type, delivery_date, asset_id, bid_area_id, user_id, participant_id,
        portfolio_id, initiated_by, session, details_json, status, status_message, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Success', 'Request Submitted Successfully.', ?, ?)
    `);
    const latestDetails = (buySell, from, to, rate, qty, ref) => JSON.stringify([{
      from_period_id: from, to_period_id: to, buy_sell: buySell, ocf_opted: 'No',
      premium_discount_price: 0, max_ocf_quantity: 0,
      pq_data: [{ rate, quantity: qty, bid_reference: ref, block_id: '' }],
    }]);
    insLatest.run('EXBL-SEED-001', 'Vndmc-dam1-08130001', clients.ndmc.id, clients.ndmc.name, 'NDMC/DAM/WK33',
      'EXC-SEED-NDMC-DAM', 'EXC/LOA/NDMC/DAM/2026-08', 'DAM', 'single', iso(-5),
      'INDIA', 'N1', 'SJVA1', 'N2DL0SJV0000', 'IEXNDMC123', 'SJVA1', 'DAM',
      latestDetails('Buy', '18:00', '20:00', 5.5, 80, 'NDMC01'), trader, fmtCreated(-5, 10, 20));
    insLatest.run('EXBL-SEED-002', 'Vndmc-dam1-08170002', clients.ndmc.id, clients.ndmc.name, 'NDMC/DAM/WK34',
      'EXC-SEED-NDMC-DAM', 'EXC/LOA/NDMC/DAM/2026-08', 'DAM', 'single', iso(-1),
      'INDIA', 'N1', 'SJVA1', 'N2DL0SJV0000', 'IEXNDMC123', 'SJVA1', 'DAM',
      latestDetails('Buy', '18:00', '20:00', 6.2, 80, 'NDMC02'), trader, fmtCreated(-1, 10, 18));
    insLatest.run('EXBL-SEED-003', 'Vhppc-rtm1-08160003', clients.hppc.id, clients.hppc.name, 'HPPC/RTM/0817',
      'EXC-SEED-HPPC-RTM', 'EXC/LOA/HPPC/RTM/2026-08', 'RTM', 'single', iso(-2),
      'INDIA', 'N1', 'SJVA1', 'N2HR0HPP0001', 'IEXHPPC088', 'SJVA1', 'RTM-S18',
      latestDetails('Buy', '18:00', '19:00', 7.1, 40, 'HPPC18'), trader, fmtCreated(-2, 17, 42));
    insLatest.run('EXBL-SEED-004', 'Vpspc-gdam-08150004', clients.pspcl.id, clients.pspcl.name, 'PSPCL/GDAM/WK33',
      'EXC-SEED-PSPCL-GDAM', 'EXC/LOA/PSPCL/GDAM/2026-08', 'GDAM', 'single', iso(-3),
      'INDIA', 'N1', 'SJVA1', 'N2PB0PSP0001', 'IEXPSPCL061', 'SJVA1', 'GDAM',
      latestDetails('Buy', '10:00', '16:00', 4.8, 60, 'PSPCLG1'), trader, fmtCreated(-3, 10, 35));
    insLatest.run('EXBL-SEED-005', 'Vtsta-dam1-08140005', clients.teesta.id, clients.teesta.name, 'TEESTA/DAM/SELL',
      'EXC-SEED-TEESTA-DAM', 'EXC/LOA/TEESTA/DAM/2026-08', 'DAM', 'block', iso(-4),
      'INDIA', 'E1', 'SJVA1', 'E1SK0TST0001', 'IEXTEESTA012', 'SJVA1', 'DAM',
      latestDetails('Sell', '18:00', '23:30', 4.1, 100, 'TEESTA1'), trader, fmtCreated(-4, 10, 2));

    const insApp = db.prepare(`
      INSERT OR IGNORE INTO exchange_applications (
        id, application_id, application_date, portfolio_id, exchange, product, bid_type,
        approval_status, px1_status, px2_status, exchange_request_status, exchange_approval_status,
        contract_id, bid_ids, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ndmcDamDay = iso(-5);
    const hppcRtmDay = iso(-2);
    const pspclGdamDay = iso(-3);
    const teestaDamDay = iso(-4);
    const ndmcPartialDay = iso(-1);
    insApp.run('PXA-SEED-001', 'PX20260813A2101', `${ndmcDamDay} 10:12:00`, 'IEXNDMC123', 'IEX', 'DAM', 'Single Bid',
      'APPROVED', 'DONE', 'DONE', 'DONE', 'APPROVED',
      'EXC-SEED-NDMC-DAM', JSON.stringify([`BID-SEED-NDMC-DAM-${ndmcDamDay}`]),
      'Cleared on IEX DAM session.', trader);
    insApp.run('PXA-SEED-002', 'PX20260816A2104', `${hppcRtmDay} 17:40:00`, 'IEXHPPC088', 'IEX', 'RTM', 'Single Bid',
      'APPROVED', 'DONE', 'DONE', 'DONE', 'APPROVED',
      'EXC-SEED-HPPC-RTM', JSON.stringify([`BID-SEED-HPPC-RTM-${hppcRtmDay}`]),
      'RTM session 18 placed.', trader);
    insApp.run('PXA-SEED-003', 'PX20260815A2103', `${pspclGdamDay} 10:30:00`, 'IEXPSPCL061', 'IEX', 'GDAM', 'Single Bid',
      'APPROVED', 'DONE', 'DONE', 'DONE', 'APPROVED',
      'EXC-SEED-PSPCL-GDAM', JSON.stringify([`BID-SEED-PSPCL-GDAM-${pspclGdamDay}`]),
      'Green DAM solar-hours bid.', trader);
    insApp.run('PXA-SEED-004', 'PX20260817A2108', `${ndmcPartialDay} 10:08:00`, 'IEXNDMC123', 'IEX', 'DAM', 'Single Bid',
      'PENDING', 'DONE', 'DONE', 'PENDING', 'PENDING',
      'EXC-SEED-NDMC-DAM', JSON.stringify(['BID-SEED-NDMC-DAM-PARTIAL']),
      null, trader);
    insApp.run('PXA-SEED-005', 'PX20260818A2110', `${iso(0)} 09:55:00`, 'IEXHPPC088', 'IEX', 'DAM', 'Single Bid',
      'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING',
      'EXC-SEED-HPPC-SEP', null,
      'September window application — awaiting PX1.', trader);
    insApp.run('PXA-SEED-006', 'PX20260814A2106', `${teestaDamDay} 09:50:00`, 'IEXTEESTA012', 'IEX', 'DAM', 'Block Bid',
      'REJECTED', 'DONE', 'DONE', 'DONE', 'REJECTED',
      'EXC-SEED-TEESTA-DAM', JSON.stringify([`BID-SEED-TEESTA-DAM-${teestaDamDay}`]),
      'Block linked incorrectly — resubmit as single evening block.', trader);

    // Existing DBs already have the PXA rows without contract/bid ids.
    const linkApp = db.prepare(`
      UPDATE exchange_applications
         SET contract_id = COALESCE(contract_id, ?), bid_ids = COALESCE(bid_ids, ?)
       WHERE id = ?
    `);
    linkApp.run('EXC-SEED-NDMC-DAM', JSON.stringify([`BID-SEED-NDMC-DAM-${ndmcDamDay}`]), 'PXA-SEED-001');
    linkApp.run('EXC-SEED-HPPC-RTM', JSON.stringify([`BID-SEED-HPPC-RTM-${hppcRtmDay}`]), 'PXA-SEED-002');
    linkApp.run('EXC-SEED-PSPCL-GDAM', JSON.stringify([`BID-SEED-PSPCL-GDAM-${pspclGdamDay}`]), 'PXA-SEED-003');
    linkApp.run('EXC-SEED-NDMC-DAM', JSON.stringify(['BID-SEED-NDMC-DAM-PARTIAL']), 'PXA-SEED-004');
    linkApp.run('EXC-SEED-HPPC-SEP', null, 'PXA-SEED-005');
    linkApp.run('EXC-SEED-TEESTA-DAM', JSON.stringify([`BID-SEED-TEESTA-DAM-${teestaDamDay}`]), 'PXA-SEED-006');

    const clearedBlocks = (labels, mw, bidPx, mcp, status = 'CLEARED') => labels.map((time_block) => ({
      time_block, quantum_mw: mw, price_per_unit: bidPx,
      cleared_quantum_mw: status === 'UNCLEARED' ? 0 : mw,
      cleared_price: status === 'UNCLEARED' ? null : mcp,
      status,
    }));

    const lifecycle = (date, extra = []) => [
      { type: 'CREATED', actor: trader, at: `${date} 10:05:00`, details: { source: 'seed' } },
      { type: 'APPROVED', actor: checker, at: `${date} 10:40:00`, details: { status: 'APPROVED' } },
      { type: 'SUBMITTED', actor: trader, at: `${date} 11:05:00`, details: { exchange: 'IEX' } },
      ...extra,
    ];

    // NDMC DAM — five fully cleared evenings
    const ndmcDays = [-6, -5, -4, -3, -2];
    const ndmcMcp = [5.42, 5.88, 6.15, 5.71, 7.04];
    ndmcDays.forEach((off, i) => {
      const date = iso(off);
      const mcp = ndmcMcp[i];
      const peak = clearedBlocks(PEAK, 80, 6.5, mcp);
      insertBid({
        id: `BID-SEED-NDMC-DAM-${date}`,
        client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-DAM',
        exchange: 'IEX', product: 'DAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 80, price_per_unit: 6.5, cleared_quantum_mw: 80, cleared_price: mcp,
        created_by: trader, blocks: peak,
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 18:35:00`, details: { mcp } }],
      });
    });

    // Yesterday: partial clear, then OCF into RTM
    const yday = iso(-1);
    const yPeak = PEAK.map((time_block, i) => ({
      time_block, quantum_mw: 80, price_per_unit: 6.8,
      cleared_quantum_mw: i < 5 ? 80 : 0,
      cleared_price: i < 5 ? 6.95 : null,
      status: i < 5 ? 'CLEARED' : 'UNCLEARED',
    }));
    insertBid({
      id: 'BID-SEED-NDMC-DAM-PARTIAL',
      client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-DAM',
      exchange: 'IEX', product: 'DAM', bid_date: yday, delivery_date: yday,
      status: 'PARTIALLY_CLEARED', approval_status: 'APPROVED',
      quantum_mw: 80, price_per_unit: 6.8, cleared_quantum_mw: 50, cleared_price: 6.95,
      created_by: trader, blocks: yPeak,
      events: [...lifecycle(yday), { type: 'RESULT', actor: trader, at: `${yday} 18:35:00`, details: { mcp: 6.95, uncleared: 30 } }],
    });
    insertBid({
      id: 'BID-SEED-NDMC-RTM-OCF',
      client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-DAM',
      exchange: 'IEX', product: 'RTM', bid_date: yday, delivery_date: yday,
      status: 'CLEARED', approval_status: 'APPROVED',
      quantum_mw: 30, price_per_unit: 7.1, cleared_quantum_mw: 30, cleared_price: 7.35,
      ocf_leg: 1, carry_forward_from: 'BID-SEED-NDMC-DAM-PARTIAL', premium_discount: 0.3,
      created_by: trader,
      blocks: PEAK.slice(5).map((time_block) => ({
        time_block, quantum_mw: 80, price_per_unit: 7.1, cleared_quantum_mw: 80, cleared_price: 7.35, status: 'CLEARED',
      })),
      events: [
        { type: 'CREATED', actor: trader, at: `${yday} 18:50:00`, details: { ocf: true, from: 'DAM' } },
        { type: 'APPROVED', actor: checker, at: `${yday} 18:55:00`, details: {} },
        { type: 'SUBMITTED', actor: trader, at: `${yday} 19:00:00`, details: {} },
        { type: 'RESULT', actor: trader, at: `${yday} 19:20:00`, details: { mcp: 7.35 } },
      ],
    });

    // Tomorrow DAM — live on exchange, waiting for result (demo "Manage Bids")
    const tmr = iso(1);
    insertBid({
      id: 'BID-SEED-NDMC-DAM-LIVE',
      client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-DAM',
      exchange: 'IEX', product: 'DAM', bid_date: iso(0), delivery_date: tmr,
      status: 'SUBMITTED', approval_status: 'APPROVED',
      quantum_mw: 80, price_per_unit: 6.4, created_by: trader,
      blocks: PEAK.map((time_block) => ({
        time_block, quantum_mw: 80, price_per_unit: 6.4, cleared_quantum_mw: 0, cleared_price: null, status: 'PENDING',
      })),
      events: lifecycle(iso(0)),
    });

    // Rejected bid — price cap story
    insertBid({
      id: 'BID-SEED-NDMC-DAM-REJ',
      client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-DAM',
      exchange: 'IEX', product: 'DAM', bid_date: iso(-7), delivery_date: iso(-6),
      status: 'REJECTED', approval_status: 'REJECTED',
      quantum_mw: 120, price_per_unit: 14.0, created_by: trader,
      blocks: PEAK.map((time_block) => ({
        time_block, quantum_mw: 120, price_per_unit: 14.0, cleared_quantum_mw: 0, cleared_price: null, status: 'UNCLEARED',
      })),
      events: [
        { type: 'CREATED', actor: trader, at: `${iso(-7)} 10:05:00`, details: {} },
        { type: 'REJECTED', actor: checker, at: `${iso(-7)} 10:25:00`, details: { reason: 'Bid price above IEX DAM cap' } },
      ],
    });

    // HPPC RTM
    [-3, -2, -1].forEach((off, i) => {
      const date = iso(off);
      const mcp = [6.8, 7.25, 6.55][i];
      insertBid({
        id: `BID-SEED-HPPC-RTM-${date}`,
        client_id: clients.hppc.id, contract_id: 'EXC-SEED-HPPC-RTM',
        exchange: 'IEX', product: 'RTM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 40, price_per_unit: 7.5, cleared_quantum_mw: 40, cleared_price: mcp,
        created_by: trader, blocks: clearedBlocks(RTM_PEAK, 40, 7.5, mcp),
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 18:22:00`, details: { mcp } }],
      });
    });

    // PSPCL GDAM solar hours
    [-4, -3, -2].forEach((off, i) => {
      const date = iso(off);
      const mcp = [4.35, 4.62, 4.18][i];
      insertBid({
        id: `BID-SEED-PSPCL-GDAM-${date}`,
        client_id: clients.pspcl.id, contract_id: 'EXC-SEED-PSPCL-GDAM',
        exchange: 'IEX', product: 'GDAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 60, price_per_unit: 5.0, cleared_quantum_mw: 60, cleared_price: mcp,
        created_by: trader, blocks: clearedBlocks(SOLAR, 60, 5.0, mcp),
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 12:05:00`, details: { mcp } }],
      });
    });

    // Teesta sell DAM
    [-5, -4, -3, -2].forEach((off, i) => {
      const date = iso(off);
      const mcp = [3.95, 4.22, 4.08, 4.55][i];
      insertBid({
        id: `BID-SEED-TEESTA-DAM-${date}`,
        client_id: clients.teesta.id, contract_id: 'EXC-SEED-TEESTA-DAM',
        exchange: 'IEX', product: 'DAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 100, price_per_unit: 3.8, cleared_quantum_mw: 100, cleared_price: mcp,
        created_by: trader, blocks: clearedBlocks(PEAK, 100, 3.8, mcp),
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 18:35:00`, details: { mcp } }],
      });
    });

    // Adani TAM — one bid per delivery day under the weekly contract
    const tamMcp = [4.52, 4.48, 4.61, 4.40, 4.55, 4.33, 4.70];
    [-7, -6, -5, -4, -3, -2, -1].forEach((off, i) => {
      const date = iso(off);
      const mcp = tamMcp[i];
      insertBid({
        id: `BID-SEED-ADANI-TAM-${date}`,
        client_id: clients.adani.id, contract_id: 'EXC-SEED-ADANI-TAM',
        exchange: 'PXIL', product: 'TAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 75, price_per_unit: 4.4, cleared_quantum_mw: 75, cleared_price: mcp,
        created_by: trader,
        blocks: [{
          time_block: '00:00-24:00', quantum_mw: 75, price_per_unit: 4.4,
          cleared_quantum_mw: 75, cleared_price: mcp, status: 'CLEARED',
        }],
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 16:00:00`, details: { mcp } }],
      });
    });

    // Teesta GTAM solar hours
    insertContract({
      id: 'EXC-SEED-TEESTA-GTAM', portfolio_id: 'IEXTEESTA012', loa_no: 'EXC/LOA/TEESTA/GTAM/2026-08',
      ppa_no: 'PPA/TEESTA/SALE/2024/04', start_date: thisStart, end_date: thisEnd,
      compensation: 0, late_payment_surcharge: 0, rebate: 0, side: 'Seller', carry_over: 'No',
      client_id: clients.teesta.id, client_name: clients.teesta.name, concerned_sldc: 'Sikkim', region: 'ER',
      product: 'GTAM', bidding_type: 'Block Bid', is_renewable: 'Yes', billing_type: 'Weekly',
      bank_guarantee: 20000000, bank_guarantee_validity: '2027-03-31', client_registration_fee: 40000,
      trading_margin: 0.02, application_fee: 10000,
      remarks: 'Teesta green term-ahead sale.',
      schedule_json: schedule(thisStart, thisEnd, 4.2, 50),
      status: 'DRAFT', created_by: trader, created_at: fmtCreated(-10, 9, 15),
    });
    [-4, -3, -2].forEach((off, i) => {
      const date = iso(off);
      const mcp = [4.15, 4.28, 4.05][i];
      insertBid({
        id: `BID-SEED-TEESTA-GTAM-${date}`,
        client_id: clients.teesta.id, contract_id: 'EXC-SEED-TEESTA-GTAM',
        exchange: 'IEX', product: 'GTAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 50, price_per_unit: 4.2, cleared_quantum_mw: 50, cleared_price: mcp,
        created_by: trader, blocks: clearedBlocks(SOLAR, 50, 4.2, mcp),
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 12:05:00`, details: { mcp } }],
      });
    });

    // July NDMC — completed window, two delivery days
    const julDates = [lastStart, iso(Math.min(-25, -20))];
    julDates.forEach((date, i) => {
      insertBid({
        id: `BID-SEED-NDMC-JUL-${i + 1}`,
        client_id: clients.ndmc.id, contract_id: 'EXC-SEED-NDMC-JUL',
        exchange: 'IEX', product: 'DAM', bid_date: date, delivery_date: date,
        status: 'CLEARED', approval_status: 'APPROVED',
        quantum_mw: 80, price_per_unit: 5.5, cleared_quantum_mw: 80, cleared_price: 5.1 + i * 0.2,
        created_by: trader, blocks: clearedBlocks(PEAK, 80, 5.5, 5.1 + i * 0.2),
        events: [...lifecycle(date), { type: 'RESULT', actor: trader, at: `${date} 18:35:00`, details: {} }],
      });
    });

    // Point the ISET forms at the DAM bids they describe, so Bidding and
    // Manage Bids tell the same story on a seeded desk.
    const linkIset = (table, isetId, bidIds, kind) => {
      const existing = bidIds.filter((bidId) => db.prepare('SELECT id FROM bids WHERE id = ?').get(bidId));
      if (!existing.length) return;
      db.prepare(`UPDATE ${table} SET bid_ids = ? WHERE id = ? AND (bid_ids IS NULL OR bid_ids = '')`)
        .run(JSON.stringify(existing), isetId);
      for (const bidId of existing) {
        db.prepare('UPDATE bids SET source_kind = COALESCE(source_kind, ?), source_id = COALESCE(source_id, ?) WHERE id = ?')
          .run(kind, isetId, bidId);
      }
    };
    linkIset('exchange_biddings', 'EXB-SEED-001', [`BID-SEED-NDMC-DAM-${iso(-5)}`], 'ISET');
    linkIset('exchange_biddings', 'EXB-SEED-002', ['BID-SEED-NDMC-DAM-PARTIAL'], 'ISET');
    linkIset('exchange_biddings', 'EXB-SEED-003', [`BID-SEED-HPPC-RTM-${iso(-2)}`], 'ISET');
    linkIset('exchange_biddings', 'EXB-SEED-004', [`BID-SEED-PSPCL-GDAM-${iso(-3)}`], 'ISET');
    linkIset('exchange_biddings', 'EXB-SEED-005', [`BID-SEED-TEESTA-DAM-${iso(-4)}`], 'ISET');
    linkIset('exchange_bidding_latest', 'EXBL-SEED-001', [`BID-SEED-NDMC-DAM-${iso(-5)}`], 'ISET_LATEST');
    linkIset('exchange_bidding_latest', 'EXBL-SEED-002', ['BID-SEED-NDMC-DAM-PARTIAL'], 'ISET_LATEST');
    linkIset('exchange_bidding_latest', 'EXBL-SEED-003', [`BID-SEED-HPPC-RTM-${iso(-2)}`], 'ISET_LATEST');
    linkIset('exchange_bidding_latest', 'EXBL-SEED-004', [`BID-SEED-PSPCL-GDAM-${iso(-3)}`], 'ISET_LATEST');
    linkIset('exchange_bidding_latest', 'EXBL-SEED-005', [`BID-SEED-TEESTA-DAM-${iso(-4)}`], 'ISET_LATEST');

    const insPxil = db.prepare(`
      INSERT OR IGNORE INTO pxil_orders (
        id, transaction_code, user_id, nor, tm_id, reference_no, tac_id,
        order_type, product_code, quantity, price, delivery_date_from, delivery_date_to,
        from_time, to_time, side, status, bid_placed_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insPxil.run('PXL-SEED-001', 'PXIL-TAM-W33', 'SJVA1', 'NOR/ADANI/001', 'TM-SJVN-01',
      'PXIL/TAM/2026/0811', 'TAC-AGE-204', 'Weekly', 'TAM-W', 75, 4.4,
      iso(-7), iso(-1), '00:00', '24:00', 'Seller', 'BID_PLACED', `${iso(-7)} 16:05:00`,
      trader, fmtCreated(-7, 15, 40));
    insPxil.run('PXL-SEED-002', 'PXIL-TAM-W34', 'SJVA1', 'NOR/ADANI/001', 'TM-SJVN-01',
      'PXIL/TAM/2026/0818', 'TAC-AGE-204', 'Weekly', 'TAM-W', 75, 4.35,
      iso(0), iso(6), '00:00', '24:00', 'Seller', 'CREATED', null,
      trader, fmtCreated(0, 11, 20));

    ['EXC-SEED-NDMC-DAM', 'EXC-SEED-HPPC-RTM', 'EXC-SEED-PSPCL-GDAM',
      'EXC-SEED-TEESTA-DAM', 'EXC-SEED-ADANI-TAM', 'EXC-SEED-TEESTA-GTAM',
      'EXC-SEED-NDMC-JUL', 'EXC-SEED-HPPC-SEP'].forEach((id) => refreshExchangeContractStatus(id));
  })();

  // Invoices sit outside the big write so a pricing miss does not roll back the desk.
  const billable = [
    { id: 'EXC-SEED-NDMC-DAM', from: iso(-6), to: iso(-1), date: iso(0) },
    { id: 'EXC-SEED-HPPC-RTM', from: iso(-3), to: iso(-1), date: iso(0) },
    { id: 'EXC-SEED-PSPCL-GDAM', from: iso(-4), to: iso(-2), date: iso(-1) },
    { id: 'EXC-SEED-TEESTA-DAM', from: iso(-5), to: iso(-2), date: iso(-1) },
  ];
  let invoices = 0;
  for (const row of billable) {
    const already = db.prepare(
      'SELECT COUNT(*) c FROM view_bill_invoices WHERE exchange_contract_id = ?',
    ).get(row.id).c;
    if (already > 0) continue;
    const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(row.id);
    for (const bill_type of ['EXCHANGE_ENERGY', 'EXCHANGE_OA', 'TRADING_MARGIN']) {
      try {
        const priced = priceBill({
          bill_type, contract_id: row.id, from: row.from, to: row.to,
          options: { drawal_state: contract.concerned_sldc || null, include_ists: true },
        });
        const objection = billingObjection(priced, { allow_zero_volume: bill_type !== 'EXCHANGE_ENERGY' });
        if (objection) continue;
        raiseInvoice({
          bill_type, priced, exchange_contract_id: row.id,
          client_id: contract.client_id, invoice_date: row.date,
          remarks: `Demo settlement ${row.from} → ${row.to}`,
          actor_id: userId('trading@sjvn.in'),
        });
        invoices += 1;
      } catch (e) {
        console.warn(`Exchange invoice ${bill_type} for ${row.id} skipped:`, e.message);
      }
    }
  }

  console.log('Exchange desk seeded:', {
    contracts: db.prepare("SELECT COUNT(*) c FROM exchange_contracts WHERE id LIKE 'EXC-SEED-%'").get().c,
    biddings: db.prepare("SELECT COUNT(*) c FROM exchange_biddings WHERE id LIKE 'EXB-SEED-%'").get().c,
    latest: db.prepare("SELECT COUNT(*) c FROM exchange_bidding_latest WHERE id LIKE 'EXBL-SEED-%'").get().c,
    applications: db.prepare('SELECT COUNT(*) c FROM exchange_applications').get().c,
    bids: db.prepare("SELECT COUNT(*) c FROM bids WHERE id LIKE 'BID-SEED-%'").get().c,
    blocks: db.prepare("SELECT COUNT(*) c FROM bid_blocks WHERE id LIKE 'BID-SEED-%'").get().c,
    invoices_raised: invoices,
  });
}
