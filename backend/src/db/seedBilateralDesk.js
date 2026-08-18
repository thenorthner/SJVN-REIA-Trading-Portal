/**
 * Additive Bilateral-desk demo seed.
 *
 * Fills Power Trading → Bilateral (contracts, Format-D bidding, applications,
 * 15-min schedules, NOAR open access, settlement invoices) without wiping
 * platform.db. Stable ids + INSERT OR IGNORE.
 */
import db from './index.js';
import { seedRateMaster } from '../services/rateMaster.js';
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

const PEAK = blocksInRange(18, 0, 20, 0);
const SOLAR = blocksInRange(10, 0, 16, 0);
const NODES = ['INJECTION_SLDC', 'RLDC', 'NLDC', 'DRAWEE_SLDC'];
const OA_STATUS_FOR_NOAR = { APPROVED: 'APPROVED', REJECTED: 'REJECTED' };

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
}

function refreshLifecycle(transactionId) {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(transactionId);
  if (!tx) return;
  const scheds = db.prepare('SELECT * FROM bilateral_schedules WHERE transaction_id = ?').all(transactionId);
  const live = scheds.filter((s) => s.status !== 'CANCELLED');
  let scheduleStatus;
  if (!scheds.length) scheduleStatus = 'DRAFT';
  else if (!live.length) scheduleStatus = 'CANCELLED';
  else if (live.some((s) => s.status === 'CURTAILED')) scheduleStatus = 'REVISED';
  else if (live.every((s) => s.status === 'APPROVED')) scheduleStatus = 'APPROVED';
  else scheduleStatus = 'SUBMITTED';

  let oaStatus = OA_STATUS_FOR_NOAR[tx.noar_status] ?? tx.open_access_status;
  if (oaStatus === 'APPROVED' && live.some((s) => s.status === 'CURTAILED')) oaStatus = 'PARTIAL';

  db.prepare('UPDATE bilateral_transactions SET schedule_status = ?, open_access_status = ? WHERE id = ?')
    .run(scheduleStatus, oaStatus, transactionId);
}

function insertContract(row) {
  db.prepare(`
    INSERT OR IGNORE INTO bilateral_transactions (
      id, client_id, counterparty, loi_contract_ref, oa_type, is_standing_clearance,
      quantum_mw, contracted_mwh, tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit,
      trading_margin_per_unit, open_access_status, schedule_status,
      noar_application_no, noar_region, noar_contract_no, noar_status,
      wheeling_charges, transmission_charges,
      loss_injection_state, loss_inter_state, loss_drawee_state,
      start_date, end_date, status,
      contract_type, transaction_type, loa_no, ppa_no, type_of_contract, product,
      supplier_name, supplier_id, supplier_sldc, supplier_region, injecting_point,
      procurer_name, procurer_id, procurer_sldc, procurer_region, drawal_point,
      route, alternate_route, is_renewable, billing_type, remarks,
      compensation, late_payment_surcharge, rebate, client_registration_fee, application_fee,
      ists_charges_bearer, sldc_consent_bearer, created_at
    ) VALUES (
      @id, @client_id, @counterparty, @loi_contract_ref, @oa_type, 0,
      @quantum_mw, @contracted_mwh, @sale_rate, @purchase_rate, @sale_rate,
      @margin, 'PENDING', 'DRAFT',
      @noar_application_no, @noar_region, @noar_contract_no, @noar_status,
      0, 0,
      @loss_injection_state, @loss_inter_state, @loss_drawee_state,
      @start_date, @end_date, @status,
      'Bilateral', @transaction_type, @loa_no, @ppa_no, @type_of_contract, @product,
      @supplier_name, @supplier_id, @supplier_sldc, @supplier_region, @injecting_point,
      @procurer_name, @procurer_id, @procurer_sldc, @procurer_region, @drawal_point,
      @route, @alternate_route, @is_renewable, @billing_type, @remarks,
      0, 0, 0, @client_registration_fee, @application_fee,
      'BUYER', 'BUYER', @created_at
    )
  `).run(row);

  db.prepare(`
    INSERT OR IGNORE INTO bilateral_order_details
      (id, transaction_id, date_from, date_to, time_from, time_to, rate_type, rate, quantum, variation)
    VALUES (?, ?, ?, ?, ?, ?, 'Fixed', ?, ?, '0')
  `).run(
    `${row.id}-OD1`, row.id, row.start_date, row.end_date,
    row.time_from || '18:00', row.time_to || '20:00',
    row.sale_rate, row.quantum_mw,
  );
}

function punchSchedules({ txId, dates, labels, mw, kind, trader, meterFactor = 1, curtailBlocks = 0 }) {
  const insSch = db.prepare(`
    INSERT OR IGNORE INTO bilateral_schedules
      (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, actual_mw, deviation_mw, dsm_penalty_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insAp = db.prepare(`
    INSERT OR IGNORE INTO bilateral_approvals (id, schedule_id, node_type, status, acted_by, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  dates.forEach((date, di) => {
    labels.forEach((block, bi) => {
      const schId = `${txId}-${date}-B${String(bi + 1).padStart(2, '0')}`;
      const curtail = kind === 'partial' && bi < curtailBlocks ? Math.round(mw * 0.3 * 10) / 10 : 0;
      const scheduled = mw - curtail;
      const metered = kind === 'metered' || kind === 'partial';
      const actual = metered ? Number((scheduled * meterFactor).toFixed(2)) : null;
      const status = curtail > 0 ? 'CURTAILED'
        : (kind === 'pending' || kind === 'in_flight' ? 'PENDING' : 'APPROVED');
      insSch.run(
        schId, txId, date, block, mw, curtail,
        actual, actual != null ? Number((actual - scheduled).toFixed(2)) : null,
        0, status,
      );

      const approvedThrough = kind === 'pending' ? 1 : (kind === 'in_flight' ? 2 : 4);
      NODES.forEach((node, ni) => {
        const ok = ni < approvedThrough;
        insAp.run(
          `${schId}-${node}`, schId, node,
          ok ? 'APPROVED' : 'PENDING',
          ok ? trader : null,
          ok ? `${date} ${10 + ni}:15:00` : null,
        );
      });
    });
  });
}

function noarPath(txId, steps, trader) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO noar_status_timeline
      (id, transaction_id, status_from, status_to, noar_contract_no, changed_by, note, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  steps.forEach((s, i) => {
    ins.run(
      `${txId}-NOAR-${i + 1}`, txId, s.from, s.to, s.contractNo || null,
      trader, s.note || null, s.at,
    );
  });
}

export function seedBilateralDesk() {
  seedRateMaster();
  const trader = userId('trading@sjvn.in');
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
    },
    hppc: {
      id: 'TCL-EX-HPPC', entity_id: 'ENT-EX-HPPC', short_code: 'HPPC',
      name: 'Haryana Power Purchase Centre', client_type: 'DISCOM',
      exposure_limit: 400000000, sldc_name: 'Haryana', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'HVPN-SLDC/SC/2026/088', noar_id: 'NOAR-HPPC-001',
      tgna_approved_mw: 180, periphery_loss_percent: 4.1,
    },
    pspcl: {
      id: 'TCL-EX-PSPCL', entity_id: 'ENT-EX-PSPCL', short_code: 'PSPCL',
      name: 'Punjab State Power Corporation Ltd', client_type: 'DISCOM',
      exposure_limit: 350000000, sldc_name: 'Punjab', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'PSTCL-SLDC/SC/2026/061', noar_id: 'NOAR-PSPCL-001',
      tgna_approved_mw: 150, periphery_loss_percent: 3.8,
    },
    guvnl: {
      id: 'TCL-EX-GUVNL', entity_id: 'ENT-EX-GUVNL', short_code: 'GUVNL',
      name: 'Gujarat Urja Vikas Nigam Ltd', client_type: 'DISCOM',
      exposure_limit: 400000000, sldc_name: 'Gujarat', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'GETCO-SLDC/SC/2026/110', noar_id: 'NOAR-GUVNL-001',
      tgna_approved_mw: 200, periphery_loss_percent: 3.4,
    },
    teesta: {
      id: 'TCL-SEED-GEN1', entity_id: 'ENT-EX-TEESTA', short_code: 'TEESTA',
      name: 'Teesta Urja Ltd', client_type: 'GENERATOR',
      exposure_limit: 200000000, sldc_name: 'Sikkim', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'SSLD-SC/2026/012', noar_id: 'NOAR-TEESTA-001',
      tgna_approved_mw: 200, periphery_loss_percent: 2.5,
    },
    jaypee: {
      id: 'TCL-SEED-GEN2', entity_id: 'ENT-EX-JAYPEE', short_code: 'JAYPEE',
      name: 'Jaypee Karcham Hydro', client_type: 'GENERATOR',
      exposure_limit: 150000000, sldc_name: 'Himachal Pradesh', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'HPSLDC/SC/2026/044', noar_id: 'NOAR-JAYPEE-001',
      tgna_approved_mw: 120, periphery_loss_percent: 2.8,
    },
    adani: {
      id: 'TCL-SEED-GEN3', entity_id: 'ENT-EX-ADANI', short_code: 'ADANI',
      name: 'Adani Green Energy Ltd', client_type: 'GENERATOR',
      exposure_limit: 300000000, sldc_name: 'Gujarat', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'GETCO-SLDC/SC/2026/204', noar_id: 'NOAR-ADANI-001',
      tgna_approved_mw: 300, periphery_loss_percent: 3.0,
    },
    ntpc: {
      id: 'TCL-SEED-GEN4', entity_id: 'ENT-EX-NTPCRE', short_code: 'NTPCRE',
      name: 'NTPC Renewable Energy Ltd', client_type: 'GENERATOR',
      exposure_limit: 250000000, sldc_name: 'Rajasthan', noc_valid_till: '2027-03-31',
      standing_clearance_no: 'RVPN-SLDC/SC/2026/077', noar_id: 'NOAR-NTPCRE-001',
      tgna_approved_mw: 180, periphery_loss_percent: 3.1,
    },
  };

  db.transaction(() => {
    Object.values(clients).forEach(ensureClient);

    insertContract({
      id: 'BT-DESK-TEESTA-HPPC', client_id: clients.teesta.id,
      counterparty: clients.hppc.name, procurer_name: clients.hppc.name, procurer_id: clients.hppc.id,
      procurer_sldc: 'Haryana', procurer_region: 'NR', drawal_point: 'Panipat 400 kV',
      supplier_name: clients.teesta.name, supplier_id: clients.teesta.id,
      supplier_sldc: 'West Bengal', supplier_region: 'ER', injecting_point: 'Rangpo 400 kV',
      loa_no: 'BIL/LOA/TEESTA-HPPC/2026-08', ppa_no: 'PPA/TEESTA/HPPC/2025/04',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/081',
      quantum_mw: 50, contracted_mwh: 500, sale_rate: 4.28, purchase_rate: 4.25, margin: 0.03,
      oa_type: 'STOA', noar_region: 'NR', noar_application_no: 'SJVN180826NR0001',
      noar_contract_no: 'NR/STOA/2026/0818/0144', noar_status: 'APPROVED',
      start_date: thisStart, end_date: thisEnd, status: 'ACTIVE',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'RTC Hydro',
      route: 'Rangpo–Purnea–Ballabgarh–Panipat', alternate_route: 'Rangpo–Muzaffarpur–Meerut',
      is_renewable: 'Yes', billing_type: 'Weekly',
      loss_injection_state: 2.5, loss_inter_state: 1.7, loss_drawee_state: 2.0,
      client_registration_fee: 25000, application_fee: 10000, time_from: '18:00', time_to: '20:00',
      remarks: 'Teesta surplus hydro to HPPC evening peak — fully scheduled and metered.',
      created_at: fmtCreated(-18, 9, 20),
    });

    insertContract({
      id: 'BT-DESK-ADANI-PSPCL', client_id: clients.adani.id,
      counterparty: clients.pspcl.name, procurer_name: clients.pspcl.name, procurer_id: clients.pspcl.id,
      procurer_sldc: 'Punjab', procurer_region: 'NR', drawal_point: 'Nakodar 400 kV',
      supplier_name: clients.adani.name, supplier_id: clients.adani.id,
      supplier_sldc: 'West Bengal', supplier_region: 'WR', injecting_point: 'Bhuj 400 kV',
      loa_no: 'BIL/LOA/ADANI-PSPCL/2026-08', ppa_no: 'PPA/ADANI/PSPCL/2026/01',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/082',
      quantum_mw: 60, contracted_mwh: 1080, sale_rate: 4.48, purchase_rate: 4.45, margin: 0.03,
      oa_type: 'MTOA', noar_region: 'WR', noar_application_no: 'SJVN150826WR0008',
      noar_contract_no: 'WR/MTOA/2026/0815/0061', noar_status: 'APPROVED',
      start_date: thisStart, end_date: thisEnd, status: 'ACTIVE',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'Solar',
      route: 'Bhuj–Indore–Agra–Nakodar', alternate_route: null,
      is_renewable: 'Yes', billing_type: 'Weekly',
      loss_injection_state: 3.0, loss_inter_state: 1.5, loss_drawee_state: 2.2,
      client_registration_fee: 25000, application_fee: 8000, time_from: '10:00', time_to: '16:00',
      remarks: 'Adani solar to PSPCL — corridor congestion curtailed a few blocks.',
      created_at: fmtCreated(-16, 11, 5),
    });

    insertContract({
      id: 'BT-DESK-JAYPEE-NDMC', client_id: clients.jaypee.id,
      counterparty: clients.ndmc.name, procurer_name: clients.ndmc.name, procurer_id: clients.ndmc.id,
      procurer_sldc: 'Delhi', procurer_region: 'NR', drawal_point: 'Maharani Bagh 220 kV',
      supplier_name: clients.jaypee.name, supplier_id: clients.jaypee.id,
      supplier_sldc: 'West Bengal', supplier_region: 'NR', injecting_point: 'Karcham 400 kV',
      loa_no: 'BIL/LOA/JAYPEE-NDMC/2026-08', ppa_no: 'PPA/JAYPEE/NDMC/2025/09',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/083',
      quantum_mw: 40, contracted_mwh: 320, sale_rate: 3.18, purchase_rate: 3.15, margin: 0.03,
      oa_type: 'STOA', noar_region: 'NR', noar_application_no: 'SJVN170826NR0004',
      noar_contract_no: null, noar_status: 'SUBMITTED',
      start_date: thisStart, end_date: thisEnd, status: 'ACTIVE',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'Hydro',
      route: 'Karcham–Abdullapur–Mandola–Maharani Bagh', alternate_route: null,
      is_renewable: 'Yes', billing_type: 'Weekly',
      loss_injection_state: 2.2, loss_inter_state: 1.4, loss_drawee_state: 1.8,
      client_registration_fee: 20000, application_fee: 8000, time_from: '18:00', time_to: '20:00',
      remarks: 'Jaypee Karcham to NDMC — filed with NOAR, waiting NLDC/drawee SLDC.',
      created_at: fmtCreated(-12, 14, 40),
    });

    insertContract({
      id: 'BT-DESK-NTPC-GUVNL', client_id: clients.ntpc.id,
      counterparty: clients.guvnl.name, procurer_name: clients.guvnl.name, procurer_id: clients.guvnl.id,
      procurer_sldc: 'Gujarat', procurer_region: 'WR', drawal_point: 'Vadodara 400 kV',
      supplier_name: clients.ntpc.name, supplier_id: clients.ntpc.id,
      supplier_sldc: 'West Bengal', supplier_region: 'NR', injecting_point: 'Bhadla 765 kV',
      loa_no: 'BIL/LOA/NTPC-GUVNL/2026-08', ppa_no: 'PPA/NTPCRE/GUVNL/2026/03',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/084',
      quantum_mw: 75, contracted_mwh: 0, sale_rate: 5.10, purchase_rate: 5.07, margin: 0.03,
      oa_type: 'LTOA', noar_region: 'WR', noar_application_no: 'SJVN100826WR0002',
      noar_contract_no: null, noar_status: 'FORMAT_D_PREPARED',
      start_date: thisStart, end_date: nextEnd, status: 'ACTIVE',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'Solar',
      route: 'Bhadla–Kankroli–Vadodara', alternate_route: 'Bhadla–Ajmer–Indore',
      is_renewable: 'Yes', billing_type: 'Monthly',
      loss_injection_state: 2.8, loss_inter_state: 1.6, loss_drawee_state: 2.0,
      client_registration_fee: 40000, application_fee: 12000, time_from: '10:00', time_to: '16:00',
      remarks: 'NTPC RE to GUVNL LTOA — Format-D prepared, contract not yet created on NOAR.',
      created_at: fmtCreated(-8, 16, 10),
    });

    insertContract({
      id: 'BT-DESK-TEESTA-NDMC-JUL', client_id: clients.teesta.id,
      counterparty: clients.ndmc.name, procurer_name: clients.ndmc.name, procurer_id: clients.ndmc.id,
      procurer_sldc: 'Delhi', procurer_region: 'NR', drawal_point: 'Maharani Bagh 220 kV',
      supplier_name: clients.teesta.name, supplier_id: clients.teesta.id,
      supplier_sldc: 'West Bengal', supplier_region: 'ER', injecting_point: 'Rangpo 400 kV',
      loa_no: 'BIL/LOA/TEESTA-NDMC/2026-07', ppa_no: 'PPA/TEESTA/NDMC/2025/04',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/071',
      quantum_mw: 40, contracted_mwh: 320, sale_rate: 4.22, purchase_rate: 4.19, margin: 0.03,
      oa_type: 'STOA', noar_region: 'NR', noar_application_no: 'SJVN010726NR0012',
      noar_contract_no: 'NR/STOA/2026/0701/0098', noar_status: 'APPROVED',
      start_date: lastStart, end_date: lastEnd, status: 'COMPLETED',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'RTC Hydro',
      route: 'Rangpo–Purnea–Mandola–Maharani Bagh', alternate_route: null,
      is_renewable: 'Yes', billing_type: 'Weekly',
      loss_injection_state: 2.5, loss_inter_state: 1.7, loss_drawee_state: 1.8,
      client_registration_fee: 25000, application_fee: 10000, time_from: '18:00', time_to: '20:00',
      remarks: 'July Teesta–NDMC window — supply completed and billed.',
      created_at: fmtCreated(-40, 9, 0),
    });

    insertContract({
      id: 'BT-DESK-HPPC-SEP', client_id: clients.teesta.id,
      counterparty: clients.hppc.name, procurer_name: clients.hppc.name, procurer_id: clients.hppc.id,
      procurer_sldc: 'Haryana', procurer_region: 'NR', drawal_point: 'Panipat 400 kV',
      supplier_name: clients.teesta.name, supplier_id: clients.teesta.id,
      supplier_sldc: 'West Bengal', supplier_region: 'ER', injecting_point: 'Rangpo 400 kV',
      loa_no: 'BIL/LOA/TEESTA-HPPC/2026-09', ppa_no: 'PPA/TEESTA/HPPC/2025/04',
      loi_contract_ref: 'LOI/SJVN/BIL/2026/091',
      quantum_mw: 50, contracted_mwh: 0, sale_rate: 4.30, purchase_rate: 4.27, margin: 0.03,
      oa_type: 'STOA', noar_region: 'NR', noar_application_no: 'SJVN180826NR0009',
      noar_contract_no: null, noar_status: 'NOT_INITIATED',
      start_date: nextStart, end_date: nextEnd, status: 'ACTIVE',
      transaction_type: 'Sale', type_of_contract: 'Purchase Side', product: 'RTC Hydro',
      route: 'Rangpo–Purnea–Ballabgarh–Panipat', alternate_route: null,
      is_renewable: 'Yes', billing_type: 'Weekly',
      loss_injection_state: 2.5, loss_inter_state: 1.7, loss_drawee_state: 2.0,
      client_registration_fee: 25000, application_fee: 10000, time_from: '18:00', time_to: '20:00',
      remarks: 'September Teesta–HPPC — LoA issued, OA not initiated, no schedule yet.',
      created_at: fmtCreated(-1, 17, 30),
    });

    punchSchedules({
      txId: 'BT-DESK-TEESTA-HPPC', dates: [iso(-6), iso(-5), iso(-4), iso(-3), iso(-2)],
      labels: PEAK, mw: 50, kind: 'metered', trader, meterFactor: 0.985,
    });
    punchSchedules({
      txId: 'BT-DESK-ADANI-PSPCL', dates: [iso(-4), iso(-3), iso(-2)],
      labels: SOLAR, mw: 60, kind: 'partial', trader, meterFactor: 0.97, curtailBlocks: 4,
    });
    punchSchedules({
      txId: 'BT-DESK-JAYPEE-NDMC', dates: [iso(-1), iso(0)],
      labels: PEAK, mw: 40, kind: 'in_flight', trader,
    });
    punchSchedules({
      txId: 'BT-DESK-TEESTA-NDMC-JUL', dates: [lastStart, iso(-28)],
      labels: PEAK, mw: 40, kind: 'metered', trader, meterFactor: 1.0,
    });

    noarPath('BT-DESK-TEESTA-HPPC', [
      { from: null, to: 'FORMAT_D_PREPARED', at: fmtCreated(-17, 10, 0), note: 'Format-D generated from evening-peak schedule' },
      { from: 'FORMAT_D_PREPARED', to: 'CONTRACT_CREATED', at: fmtCreated(-16, 15, 20), note: 'NOAR contract created', contractNo: 'NR/STOA/2026/0818/0144' },
      { from: 'CONTRACT_CREATED', to: 'SUBMITTED', at: fmtCreated(-15, 9, 45), note: 'Filed with NLDC' },
      { from: 'SUBMITTED', to: 'APPROVED', at: fmtCreated(-14, 18, 10), note: 'NLDC approved STOA', contractNo: 'NR/STOA/2026/0818/0144' },
    ], trader);
    noarPath('BT-DESK-ADANI-PSPCL', [
      { from: null, to: 'FORMAT_D_PREPARED', at: fmtCreated(-15, 11, 0) },
      { from: 'FORMAT_D_PREPARED', to: 'CONTRACT_CREATED', at: fmtCreated(-14, 16, 0), contractNo: 'WR/MTOA/2026/0815/0061' },
      { from: 'CONTRACT_CREATED', to: 'SUBMITTED', at: fmtCreated(-13, 10, 30) },
      { from: 'SUBMITTED', to: 'APPROVED', at: fmtCreated(-11, 12, 0), note: 'Approved with corridor congestion note', contractNo: 'WR/MTOA/2026/0815/0061' },
    ], trader);
    noarPath('BT-DESK-JAYPEE-NDMC', [
      { from: null, to: 'FORMAT_D_PREPARED', at: fmtCreated(-10, 9, 30) },
      { from: 'FORMAT_D_PREPARED', to: 'CONTRACT_CREATED', at: fmtCreated(-9, 14, 0) },
      { from: 'CONTRACT_CREATED', to: 'SUBMITTED', at: fmtCreated(-8, 11, 15), note: 'Awaiting NLDC and Delhi SLDC' },
    ], trader);
    noarPath('BT-DESK-NTPC-GUVNL', [
      { from: null, to: 'FORMAT_D_PREPARED', at: fmtCreated(-6, 16, 40), note: 'LTOA Format-D drafted' },
    ], trader);
    noarPath('BT-DESK-TEESTA-NDMC-JUL', [
      { from: null, to: 'FORMAT_D_PREPARED', at: fmtCreated(-42, 10, 0) },
      { from: 'FORMAT_D_PREPARED', to: 'CONTRACT_CREATED', at: fmtCreated(-41, 12, 0), contractNo: 'NR/STOA/2026/0701/0098' },
      { from: 'CONTRACT_CREATED', to: 'SUBMITTED', at: fmtCreated(-41, 15, 0) },
      { from: 'SUBMITTED', to: 'APPROVED', at: fmtCreated(-40, 11, 0), contractNo: 'NR/STOA/2026/0701/0098' },
    ], trader);

    ['BT-DESK-TEESTA-HPPC', 'BT-DESK-ADANI-PSPCL', 'BT-DESK-JAYPEE-NDMC',
      'BT-DESK-NTPC-GUVNL', 'BT-DESK-TEESTA-NDMC-JUL', 'BT-DESK-HPPC-SEP']
      .forEach(refreshLifecycle);

    const insBid = db.prepare(`
      INSERT OR IGNORE INTO bilateral_biddings (
        id, applicant, seller_name, seller_id, seller_injecting_point, seller_utility, seller_sldc, seller_region,
        seller_contract_id, seller_contract_no, buyer_name, buyer_id, buyer_drawal_point, buyer_utility,
        buyer_sldc, buyer_region, buyer_contract_id, buyer_contract_no, under_gtam, access_type, accept_partial,
        application_type, route, alternate_route, generating_sources_json, schedule_json, declaration_accepted,
        status, transaction_id, created_by, created_at
      ) VALUES (
        ?, 'SJVN Limited', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'No', 'T-GNA', 'No',
        ?, ?, ?, ?, ?, 1, ?, ?, ?, ?
      )
    `);
    const schedJson = (from, to, tFrom, tTo, mw) => JSON.stringify([
      { date_from: from, date_to: to, time_from: tFrom, time_to: tTo, capacity: mw },
    ]);
    insBid.run('BBD-SEED-001', clients.teesta.name, clients.teesta.id, 'Rangpo 400 kV', 'Sikkim Power', 'Sikkim', 'ER',
      'BT-DESK-TEESTA-HPPC', 'BIL/LOA/TEESTA-HPPC/2026-08', clients.hppc.name, clients.hppc.id, 'Panipat 400 kV',
      'UHBVN/DHBVN', 'Haryana', 'NR', 'BT-DESK-TEESTA-HPPC', 'PPA/TEESTA/HPPC/2025/04',
      'Fresh', 'Rangpo–Purnea–Ballabgarh–Panipat', 'Rangpo–Muzaffarpur–Meerut',
      JSON.stringify(['Hydro']), schedJson(thisStart, thisEnd, '18:00', '20:00', 50),
      'APPROVED', 'BT-DESK-TEESTA-HPPC', trader, fmtCreated(-18, 9, 10));
    insBid.run('BBD-SEED-002', clients.adani.name, clients.adani.id, 'Bhuj 400 kV', 'GETCO', 'Gujarat', 'WR',
      'BT-DESK-ADANI-PSPCL', 'BIL/LOA/ADANI-PSPCL/2026-08', clients.pspcl.name, clients.pspcl.id, 'Nakodar 400 kV',
      'PSPCL', 'Punjab', 'NR', 'BT-DESK-ADANI-PSPCL', 'PPA/ADANI/PSPCL/2026/01',
      'Fresh', 'Bhuj–Indore–Agra–Nakodar', null,
      JSON.stringify(['Solar']), schedJson(thisStart, thisEnd, '10:00', '16:00', 60),
      'APPROVED', 'BT-DESK-ADANI-PSPCL', trader, fmtCreated(-16, 10, 50));
    insBid.run('BBD-SEED-003', clients.jaypee.name, clients.jaypee.id, 'Karcham 400 kV', 'HPSEBL', 'Himachal Pradesh', 'NR',
      'BT-DESK-JAYPEE-NDMC', 'BIL/LOA/JAYPEE-NDMC/2026-08', clients.ndmc.name, clients.ndmc.id, 'Maharani Bagh 220 kV',
      'NDMC', 'Delhi', 'NR', 'BT-DESK-JAYPEE-NDMC', 'PPA/JAYPEE/NDMC/2025/09',
      'Fresh', 'Karcham–Abdullapur–Mandola–Maharani Bagh', null,
      JSON.stringify(['Hydro']), schedJson(thisStart, thisEnd, '18:00', '20:00', 40),
      'SUBMITTED', 'BT-DESK-JAYPEE-NDMC', trader, fmtCreated(-12, 14, 20));
    insBid.run('BBD-SEED-004', clients.ntpc.name, clients.ntpc.id, 'Bhadla 765 kV', 'RVPN', 'Rajasthan', 'NR',
      null, 'PPA/NTPCRE/GUVNL/2026/03', clients.guvnl.name, clients.guvnl.id, 'Vadodara 400 kV',
      'GUVNL', 'Gujarat', 'WR', null, 'PPA/NTPCRE/GUVNL/2026/03',
      'Advance', 'Bhadla–Kankroli–Vadodara', 'Bhadla–Ajmer–Indore',
      JSON.stringify(['Solar']), schedJson(nextStart, nextEnd, '10:00', '16:00', 75),
      'SUBMITTED', null, trader, fmtCreated(-2, 11, 25));
    insBid.run('BBD-SEED-005', clients.teesta.name, clients.teesta.id, 'Rangpo 400 kV', 'Sikkim Power', 'Sikkim', 'ER',
      null, 'PPA/TEESTA/HPPC/2025/04', clients.hppc.name, clients.hppc.id, 'Panipat 400 kV',
      'UHBVN/DHBVN', 'Haryana', 'NR', null, 'PPA/TEESTA/HPPC/2025/04',
      'Revision', 'Rangpo–Purnea–Ballabgarh–Panipat', null,
      JSON.stringify(['Hydro']), schedJson(iso(1), iso(3), '18:00', '22:00', 80),
      'REJECTED', null, trader, fmtCreated(-3, 16, 5));

    const insApp = db.prepare(`
      INSERT OR IGNORE INTO bilateral_applications (
        id, application_id, application_date, applicant, seller_name, buyer_name,
        bidding_id, seller_contract_no, buyer_contract_no, status, transaction_id, created_by
      ) VALUES (?, ?, ?, 'SJVN Limited', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insApp.run('BAP-SEED-001', 'BL20260801A1801', fmtCreated(-18, 9, 12), clients.teesta.name, clients.hppc.name,
      'BBD-SEED-001', 'BIL/LOA/TEESTA-HPPC/2026-08', 'PPA/TEESTA/HPPC/2025/04',
      'APPROVED', 'BT-DESK-TEESTA-HPPC', trader);
    insApp.run('BAP-SEED-002', 'BL20260803A1802', fmtCreated(-16, 10, 55), clients.adani.name, clients.pspcl.name,
      'BBD-SEED-002', 'BIL/LOA/ADANI-PSPCL/2026-08', 'PPA/ADANI/PSPCL/2026/01',
      'APPROVED', 'BT-DESK-ADANI-PSPCL', trader);
    insApp.run('BAP-SEED-003', 'BL20260807A1803', fmtCreated(-12, 14, 25), clients.jaypee.name, clients.ndmc.name,
      'BBD-SEED-003', 'BIL/LOA/JAYPEE-NDMC/2026-08', 'PPA/JAYPEE/NDMC/2025/09',
      'SUBMITTED', 'BT-DESK-JAYPEE-NDMC', trader);
    insApp.run('BAP-SEED-004', 'BL20260816A1808', fmtCreated(-2, 11, 28), clients.ntpc.name, clients.guvnl.name,
      'BBD-SEED-004', 'PPA/NTPCRE/GUVNL/2026/03', 'PPA/NTPCRE/GUVNL/2026/03',
      'SUBMITTED', null, trader);
    insApp.run('BAP-SEED-005', 'BL20260815A1806', fmtCreated(-3, 16, 8), clients.teesta.name, clients.hppc.name,
      'BBD-SEED-005', 'PPA/TEESTA/HPPC/2025/04', 'PPA/TEESTA/HPPC/2025/04',
      'REJECTED', null, trader);
  })();

  const billable = [
    { id: 'BT-DESK-TEESTA-HPPC', from: iso(-6), to: iso(-2), date: iso(0), client: 'TCL-EX-HPPC' },
    { id: 'BT-DESK-ADANI-PSPCL', from: iso(-4), to: iso(-2), date: iso(-1), client: 'TCL-EX-PSPCL' },
    { id: 'BT-DESK-TEESTA-NDMC-JUL', from: lastStart, to: lastEnd, date: lastEnd, client: 'TCL-EX-NDMC' },
  ];
  let invoices = 0;
  for (const row of billable) {
    const already = db.prepare(
      'SELECT COUNT(*) c FROM view_bill_invoices WHERE bilateral_id = ?',
    ).get(row.id).c;
    if (already > 0) continue;
    const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(row.id);
    for (const bill_type of ['BILATERAL_ENERGY', 'BILATERAL_OA', 'BILATERAL_SLDC']) {
      try {
        const priced = priceBill({
          bill_type, contract_id: row.id, from: row.from, to: row.to,
          options: {
            injection_state: tx.supplier_sldc,
            drawal_state: tx.procurer_sldc || null,
            include_ists: true,
          },
        });
        const objection = billingObjection(priced, { allow_zero_volume: bill_type !== 'BILATERAL_ENERGY' });
        if (objection) continue;
        raiseInvoice({
          bill_type, priced, bilateral_id: row.id,
          client_id: row.client, invoice_date: row.date,
          remarks: `Demo bilateral settlement ${row.from} → ${row.to}`,
          actor_id: trader,
        });
        invoices += 1;
      } catch (e) {
        console.warn(`Bilateral invoice ${bill_type} for ${row.id} skipped:`, e.message);
      }
    }
  }

  console.log('Bilateral desk seeded:', {
    contracts: db.prepare("SELECT COUNT(*) c FROM bilateral_transactions WHERE id LIKE 'BT-DESK-%'").get().c,
    schedules: db.prepare("SELECT COUNT(*) c FROM bilateral_schedules WHERE transaction_id LIKE 'BT-DESK-%'").get().c,
    biddings: db.prepare("SELECT COUNT(*) c FROM bilateral_biddings WHERE id LIKE 'BBD-SEED-%'").get().c,
    applications: db.prepare("SELECT COUNT(*) c FROM bilateral_applications WHERE id LIKE 'BAP-SEED-%'").get().c,
    invoices_raised: invoices,
  });
}
