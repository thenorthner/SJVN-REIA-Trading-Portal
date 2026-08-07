import db from '../db/index.js';
import { newId, genSjvnInvoiceNo, clientCodeFor } from '../util.js';

// One place where a trading invoice is priced and written.
//
// Two shapes share the trading_invoices table: an ENERGY bill priced off a rate
// and quantum, and a SETTLEMENT bill made up of exchange/transmission fee legs.
// They were previously created by two routes that disagreed on the accounting —
// one deducted TDS from the invoice's own face value and computed GST on the
// remainder, the other kept the face value gross. The ISET ledger settles it: an
// energy invoice reads 86,60,920 with 8,661 withheld and 86,52,259 received, so
// the face value is gross and TDS is a withholding shown against it.
//
// The rules applied here, once, for both shapes:
//   subtotal    the taxable value of the bill
//   gst         18% of subtotal when applicable — never net of TDS
//   total       subtotal + gst, the invoice's face value
//   tds         withheld on subtotal (not on GST), by section
//   net_payable total - tds, what the client actually remits

const GST_RATE = 0.18;
const DEFAULT_TDS_RATES = { '194Q': 0.001, '194C': 0.10, '194J': 0.10, NONE: 0 };

// invoice_kind decides which shape is being billed.
const ENERGY_KINDS = new Set(['TRADING_MARGIN_ONLY', 'POWER_SUPPLY_ONLY', 'COMBINED']);
const SETTLEMENT_KINDS = new Set(['EXCHANGE', 'BILATERAL']);

export function shapeOf(invoiceKind) {
  if (ENERGY_KINDS.has(invoiceKind)) return 'ENERGY';
  if (SETTLEMENT_KINDS.has(invoiceKind)) return 'SETTLEMENT';
  return null;
}

function subtotalFor(shape, b) {
  const n = (v) => Number(v) || 0;
  if (shape === 'ENERGY') {
    const powerSupply = b.invoice_kind === 'TRADING_MARGIN_ONLY' ? 0 : n(b.quantum_mwh) * n(b.rate_per_unit);
    const margin = b.invoice_kind === 'POWER_SUPPLY_ONLY' ? 0 : Math.round(n(b.quantum_mwh) * (b.margin_rate ?? 0.05));
    return { subtotal: powerSupply + margin, trading_margin: margin };
  }
  // A settlement bill is the sum of its fee legs plus the desk's margin.
  const margin = n(b.sjvn_margin);
  const legs = b.invoice_kind === 'EXCHANGE'
    ? n(b.exchange_fee) + n(b.clearing_charges) + n(b.regulatory_levy)
    : n(b.transmission_charges) + n(b.dsm_charges);
  return { subtotal: legs + margin, trading_margin: margin };
}

// Which section applies, unless the caller states one. An energy bill attracts
// 194Q; a fee-based settlement bill attracts 194C. A pure margin bill carries no
// energy value and so no 194Q liability.
function resolveTds(shape, b, subtotal) {
  const requested = b.tds_section;
  const section = ['194Q', '194C', '194J', 'NONE'].includes(requested)
    ? requested
    : shape === 'ENERGY'
      ? (b.invoice_kind === 'TRADING_MARGIN_ONLY' ? 'NONE' : '194Q')
      : '194C';
  const rate = b.tds_rate != null ? Number(b.tds_rate) : DEFAULT_TDS_RATES[section];
  const amount = section === 'NONE' ? 0 : Math.round(subtotal * rate);
  return { section, rate, amount };
}

export function priceTradingInvoice(body) {
  const shape = shapeOf(body.invoice_kind);
  if (!shape) throw new Error(`Unknown invoice_kind: ${body.invoice_kind}`);

  const { subtotal, trading_margin } = subtotalFor(shape, body);
  const gst = body.gst_applicable ? Math.round(subtotal * GST_RATE) : 0;
  const total = subtotal + gst;
  const tds = resolveTds(shape, body, subtotal);

  return {
    shape,
    subtotal,
    trading_margin,
    gst_amount: gst,
    total_amount: total,
    tds_section: tds.section,
    tds_rate: tds.rate,
    tds_amount: tds.amount,
    net_payable: total - tds.amount,
  };
}

// Create the invoice and, for a settlement bill, its client ledger posting — as
// one unit, so an invoice can never exist without the ledger line that accounts
// for it. The ledger is debited with net_payable because that is what the client
// actually owes SJVN; the withheld tax goes to the government, not to the desk.
export function createTradingInvoice(body, { postLedger = false } = {}) {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(body.client_id);
  if (!client) throw new Error('Client not found');

  const priced = priceTradingInvoice(body);
  // A pure margin bill has its own register; everything else bills as energy.
  const series = body.invoice_kind === 'TRADING_MARGIN_ONLY' ? 'MARGIN' : 'ENERGY';
  // Bill under the client's own short code where one is set, so the number reads
  // the way the desk refers to the counterparty.
  const invoiceNo = genSjvnInvoiceNo(series, clientCodeFor(body.client_id) || client.name, body.billing_period);
  const id = newId('TIN');

  const insertInvoice = db.prepare(`
    INSERT INTO trading_invoices (
      id, invoice_no, client_id, invoice_kind, billing_period, quantum_mwh,
      rate_per_unit, trading_margin,
      trade_date, settlement_date, trade_type,
      exchange_fee, clearing_charges, regulatory_levy, sjvn_margin, transmission_charges, dsm_charges,
      gst_applicable, gst_amount, total_amount,
      tds_section, tds_rate, tds_amount, net_payable, status
    ) VALUES (
      @id, @invoice_no, @client_id, @invoice_kind, @billing_period, @quantum_mwh,
      @rate_per_unit, @trading_margin,
      @trade_date, @settlement_date, @trade_type,
      @exchange_fee, @clearing_charges, @regulatory_levy, @sjvn_margin, @transmission_charges, @dsm_charges,
      @gst_applicable, @gst_amount, @total_amount,
      @tds_section, @tds_rate, @tds_amount, @net_payable, 'DRAFT'
    )
  `);

  // COALESCE wraps the whole subquery: with no prior row it returns no rows at
  // all, so the running balance must default to 0 for a client's first entry.
  const insertLedger = db.prepare(`
    INSERT INTO client_ledgers (id, client_id, transaction_type, reference_id, credit, debit, running_balance, description, timestamp)
    VALUES (?, ?, 'INVOICE', ?, 0, ?, COALESCE((SELECT running_balance FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC LIMIT 1), 0) + ?, ?, ?)
  `);

  const n = (v) => Number(v) || 0;
  db.transaction(() => {
    insertInvoice.run({
      id,
      invoice_no: invoiceNo,
      client_id: body.client_id,
      invoice_kind: body.invoice_kind,
      billing_period: body.billing_period,
      quantum_mwh: n(body.quantum_mwh),
      rate_per_unit: body.rate_per_unit != null ? Number(body.rate_per_unit) : null,
      trading_margin: priced.trading_margin,
      trade_date: body.trade_date || null,
      settlement_date: body.settlement_date || null,
      trade_type: body.trade_type || null,
      exchange_fee: n(body.exchange_fee),
      clearing_charges: n(body.clearing_charges),
      regulatory_levy: n(body.regulatory_levy),
      sjvn_margin: n(body.sjvn_margin),
      transmission_charges: n(body.transmission_charges),
      dsm_charges: n(body.dsm_charges),
      gst_applicable: body.gst_applicable ? 1 : 0,
      gst_amount: priced.gst_amount,
      total_amount: priced.total_amount,
      tds_section: priced.tds_section,
      tds_rate: priced.tds_rate,
      tds_amount: priced.tds_amount,
      net_payable: priced.net_payable,
    });
    if (postLedger) {
      insertLedger.run(newId('CLG'), body.client_id, id, priced.net_payable, body.client_id, priced.net_payable,
        `Invoice Generated: ${invoiceNo}`, body.trade_date ? `${body.trade_date} 10:00:00` : new Date().toISOString());
    }
  })();

  return db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(id);
}
