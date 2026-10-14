/**
 * CERC Form-IV, split into the annexures the Commission actually receives.
 *
 * "Form-IV" is not one table. The monthly return is a set of formats — IV-A,
 * IV-B, IV-C and so on — one per kind of transaction, each with its own
 * columns. The register in cercFormIv.js holds the transactions; this sorts
 * them into those formats and lays each one out the way it is filed.
 *
 * The titles, columns, section headings and footnotes below are transcribed
 * from a monthly Form-IV as filed by a trading licensee (February 2026), not
 * written from memory:
 *
 *   IV-A  Short-term inter-State, round the clock
 *   IV-B  Short-term inter-State, peak
 *   IV-C  Short-term inter-State, other than peak and RTC
 *   IV-D  Long-term inter-State
 *   IV-E  Intra-State (volume by state only)
 *   IV-F  Day-ahead power exchange, with a margin table
 *   IV-G  Term-ahead power exchange
 *   IV-H  Renewable energy certificates
 *   IV-K  Real-time market, with a margin table
 *   IV-L  Green term-ahead
 *   IV-O  High-price day-ahead, with a margin table
 *
 * IV-A, IV-B and IV-C each carry three sections: ordinary inter-State trades,
 * trades through a banking arrangement, and cross-border trades. Banking and
 * cross-border are sections of those forms, not forms of their own.
 *
 * Green day-ahead is reported here as IV-I. That letter is the one format in
 * this file not confirmed against a filed return, and it is flagged as such.
 */
import XLSX from 'xlsx';
import db from '../db/index.js';
import { getParam } from '../mastersService.js';
import { resolvePeriod, deriveLines, getLines } from './cercFormIv.js';

const round = (v, dp = 4) => {
  const f = 10 ** dp;
  return Math.round((Number(v) || 0) * f) / f;
};

const BILATERAL_SECTIONS = [
  ['A', 'Inter State Trading Transactions'],
  ['B', 'Inter State Trading Transactions through Banking Arrangement'],
  ['C', 'Cross Border Transactions'],
];

const TERM_AHEAD_SECTIONS = [
  ['A', 'Intra-Day Contracts'],
  ['B', 'Day-Ahead Contingency Contracts'],
  ['C', 'Daily Contracts / Any Day Contracts'],
  ['D', 'Weekly Contracts'],
  ['E', 'Monthly Contracts'],
  ['F', 'Any day single sided Contracts'],
];

const INTRA_SECTIONS = [
  ['ST', 'Short Term Transactions'],
  ['LT', 'Long Term Transactions'],
];

const BILATERAL_NOTES = [
  'Note: (1) Data shall be submitted transactionwise and should not be aggregated.',
  'Note: (2) Indicate the names and the category of the seller/buyer namely generator, captive power plant, distribution licensee, Government, industrial open access consumer, commercial open access consumer, trader (when applicable) etc.',
  'Note: (3) Data shall be posted on the website of the electricity trader or any other authorised website (Name of the link on the home page: Statutory Information).',
  'Note: (4) Data shall be submitted on a monthly basis by 15th of the following month to the Commission, Regional Load Dispatch Centre and Regional Power Committee.',
  'Note: (5) Data shall be submitted to the Commission i.e. hard copy to Secretary, CERC and soft copy in an Excel Sheet by Email and through Saudamini Portal (e-monitoring).',
  'Note: (6) Full form of the abbreviations used for Name of the Seller/Buyer etc. shall be provided at the end of the Table.',
];

const PX_DAY_NOTE = 'Note: Trading Margin shall be charged for each 15 minutes contract separately. However, the reporting shall be made on day-wise basis in light of the large volume of data';

// One column: `h` is its heading, `g` the group heading it sits under (if any).
const COLS = {
  BILATERAL: [
    { h: 'Sr.No', key: 'sr' },
    { g: 'Period of Power Delivery', h: 'Start date (DD/MM/YYYY)', key: 'start_date' },
    { g: 'Period of Power Delivery', h: 'End date (DD/MM/YYYY)', key: 'end_date' },
    { g: 'Time of Power Delivery', h: 'Start Time (HH:MM)', key: 'start_time' },
    { g: 'Time of Power Delivery', h: 'End Time (HH:MM)', key: 'end_time' },
    { h: 'Scheduled Volume (MUs)', key: 'volume_mu' },
    { g: 'Purchased from', h: 'Name of the Seller', key: 'seller' },
    { g: 'Purchased from', h: 'Category', key: 'seller_category' },
    { g: 'Purchased from', h: 'State', key: 'seller_state' },
    { g: 'Sold to', h: 'Name of the Buyer', key: 'buyer' },
    { g: 'Sold to', h: 'Category', key: 'buyer_category' },
    { g: 'Sold to', h: 'State', key: 'buyer_state' },
    { h: 'Purchase Price (₹/kWh)', key: 'purchase_price' },
    { h: 'Sale Price (₹/kWh)', key: 'sale_price' },
    { h: 'Trading Margin (₹/kWh)', key: 'margin' },
  ],
  LONG_TERM: [
    { h: 'Sr.No', key: 'sr' },
    { g: 'Period of Power Delivery', h: 'Start date (DD/MM/YYYY)', key: 'start_date' },
    { g: 'Period of Power Delivery', h: 'End date (DD/MM/YYYY)', key: 'end_date' },
    { h: 'Scheduled Volume (MUs)', key: 'volume_mu' },
    { g: 'Purchased from', h: 'Name of the Seller', key: 'seller' },
    { g: 'Purchased from', h: 'Category', key: 'seller_category' },
    { g: 'Purchased from', h: 'State', key: 'seller_state' },
    { g: 'Sold to', h: 'Name of the Buyer', key: 'buyer' },
    { g: 'Sold to', h: 'Category', key: 'buyer_category' },
    { g: 'Sold to', h: 'State', key: 'buyer_state' },
    { h: 'Sale Price (₹/kWh)', key: 'sale_price' },
    { h: 'Trading Margin (₹/kWh)', key: 'margin' },
  ],
  INTRA: [
    { h: 'Sr. No.', key: 'sr' },
    { h: 'Total Transacted Volume (MUs)', key: 'volume_mu' },
    { h: 'State', key: 'seller_state' },
  ],
  PX_DAY: [
    { h: 'Sr.No', key: 'sr' },
    { h: 'Date of Delivery (DD/MM/YYYY)', key: 'start_date' },
    { h: 'Total Scheduled Volume (MUs) for each client', key: 'volume_mu' },
    { g: 'Purchased from', h: 'Name of Seller/ Name of PX', key: 'seller' },
    { g: 'Purchased from', h: 'State', key: 'seller_state' },
    { g: 'Sold to', h: 'Name of Buyer/ Name of PX', key: 'buyer' },
    { g: 'Sold to', h: 'State', key: 'buyer_state' },
  ],
  PX_TERM: [
    { h: 'Sr.No', key: 'sr' },
    { h: 'Name of Power Exchange', key: 'exchange' },
    { g: 'Period of Power Delivery', h: 'Start date (DD/MM/YYYY)', key: 'start_date' },
    { g: 'Period of Power Delivery', h: 'End date (DD/MM/YYYY)', key: 'end_date' },
    { g: 'Time of Power Delivery', h: 'Start Time (HH:MM)', key: 'start_time' },
    { g: 'Time of Power Delivery', h: 'End Time (HH:MM)', key: 'end_time' },
    { h: 'Scheduled Volume (MUs)', key: 'volume_mu' },
    { g: 'Purchased from', h: 'Name of Seller', key: 'seller' },
    { g: 'Purchased from', h: 'State', key: 'seller_state' },
    { g: 'Sold to', h: 'Name of Buyer', key: 'buyer' },
    { g: 'Sold to', h: 'State', key: 'buyer_state' },
    { h: 'Transaction Price (₹/kWh)', key: 'sale_price' },
    { h: 'Trading Margin (₹/kWh)', key: 'margin' },
  ],
  REC: [
    { h: 'Sr. No.', key: 'sr' },
    { h: 'Mode (through PX/ Bilateral)', key: 'mode' },
    { g: 'Purchased from', h: 'Name of Seller (Client)/ Power Exchange', key: 'seller' },
    { g: 'Purchased from', h: 'Client Type / Power Exchange', key: 'seller_category' },
    { g: 'Sold To', h: 'Name of Buyer (Client)/ Power Exchange', key: 'buyer' },
    { g: 'Sold To', h: 'Client Type / Power Exchange', key: 'buyer_category' },
    { h: 'Volume (RECs)', key: 'volume_recs' },
    { h: 'Market Clearing Price/ Sale Price (Rs/REC)', key: 'sale_price' },
    { h: 'Trading Margin Charged (Rs/kWh)', key: 'margin' },
  ],
  HP_DAM: [
    { h: 'Sr. No.', key: 'sr' },
    { h: 'Date of Delivery (DD/MM/YYYY)', key: 'start_date' },
    { h: 'Scheduled Volume under HP-DAM (MUs)', key: 'volume_mu' },
    { g: 'Purchased From', h: 'Name of Seller/ Name of PX', key: 'seller' },
    { g: 'Purchased From', h: 'Type (Imported Coal/ Gas/ BESS)', key: 'fuel_type' },
    { g: 'Purchased From', h: 'State', key: 'seller_state' },
    { g: 'Sold To', h: 'Name of Buyer/ Name of PX', key: 'buyer' },
    { g: 'Sold To', h: 'State', key: 'buyer_state' },
    { h: 'Remarks', key: 'note' },
  ],
};

export const ANNEXURES = [
  { code: 'IV-A', layout: 'BILATERAL', sections: BILATERAL_SECTIONS, notes: BILATERAL_NOTES,
    title: 'Short-term Inter-State Transactions of Electricity by Trading Licensees ( RTC*)',
    footnote: '*RTC= Round The Clock (24 Hours i.e. from 00:00 to 24:00)' },
  { code: 'IV-B', layout: 'BILATERAL', sections: BILATERAL_SECTIONS, notes: BILATERAL_NOTES,
    title: 'Short-term Inter-State Transactions of Electricity by Trading Licensees ( Peak*)',
    footnote: '*Peak= Peak Period (Evening Peak from 17:00 hrs to 23:00 hrs). Peak period may be revised by the Commission from time to time' },
  { code: 'IV-C', layout: 'BILATERAL', sections: BILATERAL_SECTIONS, notes: BILATERAL_NOTES,
    title: 'Short-term Inter-State Transactions of Electricity by Trading Licensees ( Other than Peak & RTC)' },
  { code: 'IV-D', layout: 'LONG_TERM',
    title: 'Long-term Inter-State Transactions of Electricity by Trading Licensees' },
  { code: 'IV-E', layout: 'INTRA', sections: INTRA_SECTIONS,
    title: 'Intra-State Transactions of Electricity by Trading Licensees',
    notes: [
      'Note: (1) Total Transacted Volume shall be aggregated for all transactions within each state.',
      'Note: (2) Name of the parties and the price of these transactions are not required.',
    ] },
  { code: 'IV-F', layout: 'PX_DAY', product: 'DAM', notes: [PX_DAY_NOTE],
    title: 'Day Ahead Power Exchange Transactions of Electricity by Trading Licensees',
    marginTitle: 'Margin charged by trading licensees in Day Ahead Power Exchange transactions' },
  { code: 'IV-G', layout: 'PX_TERM', product: 'TAM', sections: TERM_AHEAD_SECTIONS,
    title: 'Term Ahead Power Exchange Transactions of Electricity by Trading Licensees',
    notes: ['Note: Any other Contract on the Power Exchange should be included as and when it introduced'] },
  { code: 'IV-H', layout: 'REC', product: 'REC',
    title: 'Trading of Renewable Energy Certificates (REC) by Trading Licensees' },
  { code: 'IV-I', layout: 'PX_DAY', product: 'GDAM', notes: [PX_DAY_NOTE], unverified: true,
    title: 'Green Day Ahead Power Exchange Transactions of Electricity by Trading Licensees',
    marginTitle: 'Margin charged by trading licensees in Green Day Ahead Power Exchange transactions' },
  { code: 'IV-K', layout: 'PX_DAY', product: 'RTM', notes: [PX_DAY_NOTE],
    title: 'Electricity transacted by Trading Licensees in Real Time Market on Power Exchanges',
    marginTitle: 'Margin charged by trading licensees in Real Time Market on Power Exchange transactions' },
  { code: 'IV-L', layout: 'PX_TERM', product: 'GTAM', sections: TERM_AHEAD_SECTIONS,
    title: 'Green Term Ahead Power Exchange Transactions of Electricity by Trading Licensees' },
  { code: 'IV-O', layout: 'HP_DAM', product: 'HPDAM',
    title: 'High Price Day Ahead (HP-DAM) Power Exchange Transactions of Electricity by Trading Licensees',
    marginTitle: 'Margin charged by Trading licensees for transactions in High Price Day Ahead Market on Power Exchanges' },
];

const BY_PRODUCT = Object.fromEntries(ANNEXURES.filter((a) => a.product).map((a) => [a.product, a.code]));

const CATEGORY_LABEL = {
  GENERATOR: 'Generator',
  DISCOM: 'Distribution Licensee',
  'C&I': 'Industrial Open Access Consumer',
  TRADER: 'Trader',
};

/** "Delhi, SLDC" and "HP SLDC" both name a state; the form wants the state. */
const stateOf = (sldc) => String(sldc || '').replace(/,?\s*SLDC\s*$/i, '').trim();

const daysBetween = (from, to) => Math.floor((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

/** A contract of a year or more is reported as long-term; anything shorter is short-term. */
export function isLongTerm(trade) {
  if (!trade) return false;
  if (trade.oa_type === 'LTOA') return true;
  if (!trade.start_date || !trade.end_date) return false;
  return daysBetween(trade.start_date, trade.end_date) >= 365;
}

/**
 * Which annexure, and which section of it, a bilateral trade belongs on.
 *
 * `trade` is the bilateral_transactions row behind the line, or null for a line
 * typed in by hand — which is treated as an ordinary short-term RTC trade,
 * because that is what the register's own quantum arithmetic assumes.
 */
export function classifyBilateral(trade) {
  const text = [trade?.contract_type, trade?.transaction_type, trade?.type_of_contract, trade?.product, trade?.remarks]
    .filter(Boolean).join(' ');
  const from = stateOf(trade?.supplier_sldc);
  const to = stateOf(trade?.procurer_sldc);

  if (from && to && from.toLowerCase() === to.toLowerCase()) {
    return { code: 'IV-E', section: isLongTerm(trade) ? 'LT' : 'ST' };
  }
  if (isLongTerm(trade)) return { code: 'IV-D', section: null };

  let section = 'A';
  if (/bank/i.test(text)) section = 'B';
  else if (/cross[\s-]?border|nepal|bhutan|bangladesh|myanmar/i.test(text)) section = 'C';

  const product = String(trade?.product || '');
  if (/off[\s-]?peak|night|day\s*time|solar\s*hours/i.test(product)) return { code: 'IV-C', section };
  if (/peak/i.test(product)) return { code: 'IV-B', section };
  return { code: 'IV-A', section };
}

const DELIVERY_WINDOW = { 'IV-A': ['00:00', '24:00'], 'IV-B': ['17:00', '23:00'] };

function bilateralRows(lines) {
  const tradeStmt = db.prepare(`
    SELECT bt.*, tc.client_type AS client_type, tc.sldc_name AS client_sldc, tc.state AS client_state
    FROM bilateral_transactions bt LEFT JOIN trading_clients tc ON tc.id = bt.client_id
    WHERE bt.id = ?
  `);
  const buyerStmt = db.prepare('SELECT client_type, sldc_name, state FROM trading_clients WHERE name = ? COLLATE NOCASE LIMIT 1');

  return lines.map((l) => {
    // Lines typed in as exchange trades have no product on them; day-ahead is
    // the commonest case, and the note says where the row came from.
    if (l.source === 'EXCHANGE') {
      return {
        code: 'IV-F', section: null,
        start_date: l.period_from, end_date: l.period_to, volume_mu: round(l.quantum_mu),
        seller: l.seller_name, buyer: l.buyer_name, seller_state: '', buyer_state: '',
        sale_price: l.sale_rate, margin: l.trading_margin_per_unit,
        note: 'Entered by hand on the Form-IV register as an exchange trade',
        source_ref: l.contract_ref || null,
      };
    }

    const trade = l.bilateral_id ? tradeStmt.get(l.bilateral_id) : null;
    const buyer = buyerStmt.get(l.buyer_name);
    const { code, section } = classifyBilateral(trade);
    const [startTime, endTime] = DELIVERY_WINDOW[code] || ['', ''];
    return {
      code, section,
      start_date: l.period_from, end_date: l.period_to,
      start_time: startTime, end_time: endTime,
      volume_mu: round(l.quantum_mu),
      seller: l.seller_name,
      seller_category: CATEGORY_LABEL[trade?.client_type] || '',
      seller_state: stateOf(trade?.supplier_sldc) || stateOf(trade?.client_sldc) || trade?.client_state || '',
      buyer: l.buyer_name,
      buyer_category: CATEGORY_LABEL[buyer?.client_type] || '',
      buyer_state: stateOf(trade?.procurer_sldc) || stateOf(buyer?.sldc_name) || buyer?.state || '',
      purchase_price: l.purchase_rate,
      sale_price: l.sale_rate,
      margin: l.trading_margin_per_unit,
      note: l.compliance_status === 'EXEMPT' ? l.exempt_reason : (l.remarks || null),
      source_ref: l.contract_ref || l.bilateral_id || null,
    };
  });
}

/** Hours in a "18:00-18:15" block label; a quarter hour when it cannot be read. */
function blockHours(label) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(label || '').trim());
  if (!m) return 0.25;
  const mins = (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2]));
  return mins > 0 ? mins / 60 : 0.25;
}

const blockEdges = (label) => {
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(label || '').trim());
  return m ? [m[1], m[2]] : ['', ''];
};

/** What one bid actually cleared: energy, the price it cleared at, and the hours it spans. */
function clearedOf(bid) {
  const blocks = db.prepare(`
    SELECT time_block, cleared_quantum_mw, cleared_price, price_per_unit FROM bid_blocks
    WHERE bid_id = ? AND status IN ('CLEARED','PARTIALLY_CLEARED') AND cleared_quantum_mw > 0
    ORDER BY time_block
  `).all(bid.id);

  // A bid recorded without block rows carries its result on the header.
  const rows = blocks.length ? blocks : [{
    time_block: bid.time_block, cleared_quantum_mw: bid.cleared_quantum_mw,
    cleared_price: bid.cleared_price, price_per_unit: bid.price_per_unit,
  }];

  let mwh = 0;
  let value = 0;
  for (const r of rows) {
    const e = (Number(r.cleared_quantum_mw) || 0) * blockHours(r.time_block);
    mwh += e;
    value += e * (r.cleared_price != null ? Number(r.cleared_price) : Number(r.price_per_unit) || 0);
  }
  const edges = rows.map((r) => blockEdges(r.time_block)).filter(([a]) => a);
  return {
    mwh,
    quantity: rows.reduce((a, r) => a + (Number(r.cleared_quantum_mw) || 0), 0),
    price: mwh > 0 ? value / mwh : 0,
    start_time: edges.length ? edges[0][0] : '',
    end_time: edges.length ? edges[edges.length - 1][1] : '',
  };
}

function exchangeRows(from, to) {
  const bids = db.prepare(`
    SELECT b.*, tc.name AS client_name, tc.client_type, tc.sldc_name, tc.state AS client_state,
           ec.side AS contract_side, ec.trading_margin AS contract_margin
    FROM bids b
    LEFT JOIN trading_clients tc ON tc.id = b.client_id
    LEFT JOIN exchange_contracts ec ON ec.id = b.contract_id
    WHERE b.status IN ('CLEARED','PARTIALLY_CLEARED')
      AND b.delivery_date >= ? AND b.delivery_date <= ?
    ORDER BY b.delivery_date, b.id
  `).all(from, to);

  const rows = [];
  const margins = [];
  // Day-ahead style forms are reported one row per client per day.
  const daily = new Map();

  for (const bid of bids) {
    const code = BY_PRODUCT[bid.product];
    if (!code) continue; // ESCerts and RPO are not Form-IV transactions.
    const cleared = clearedOf(bid);
    if (!(cleared.quantity > 0)) continue;

    // Without a contract saying otherwise, a generator sells and everyone else buys.
    const sells = bid.contract_side
      ? /sell/i.test(bid.contract_side)
      : bid.client_type === 'GENERATOR';
    const client = bid.client_name || 'Unknown client';
    const clientState = stateOf(bid.sldc_name) || bid.client_state || '';
    const parties = sells
      ? { seller: client, seller_state: clientState, buyer: bid.exchange, buyer_state: '' }
      : { seller: bid.exchange, seller_state: '', buyer: client, buyer_state: clientState };
    const margin = bid.contract_margin != null ? Number(bid.contract_margin) : null;
    const annexure = ANNEXURES.find((a) => a.code === code);

    if (margin != null) margins.push({ code, client, exchange: bid.exchange, margin });

    if (annexure.layout === 'REC') {
      rows.push({
        code, section: null, mode: 'PX', exchange: bid.exchange,
        ...parties,
        seller_category: sells ? 'Eligible Entity' : 'PX',
        buyer_category: sells ? 'PX' : (CATEGORY_LABEL[bid.client_type] || 'Obligated Entity'),
        volume_recs: round(cleared.quantity, 0), volume_mu: 0,
        sale_price: round(cleared.price, 2), margin,
        source_ref: bid.id,
      });
    } else if (annexure.layout === 'PX_TERM') {
      rows.push({
        code,
        // The bid does not record which term-ahead contract it was, so it is
        // listed under daily contracts; move it by hand if it was another.
        section: 'C',
        exchange: bid.exchange,
        start_date: bid.delivery_date, end_date: bid.delivery_date,
        start_time: cleared.start_time, end_time: cleared.end_time,
        volume_mu: round(cleared.mwh / 1000),
        ...parties,
        sale_price: round(cleared.price, 4), margin,
        source_ref: bid.id,
      });
    } else {
      const key = [code, bid.delivery_date, client, bid.exchange, sells].join('|');
      const row = daily.get(key) || {
        code, section: null, exchange: bid.exchange,
        start_date: bid.delivery_date, end_date: bid.delivery_date,
        volume_mu: 0, ...parties, margin, fuel_type: '', source_ref: bid.id,
      };
      row.volume_mu = round(row.volume_mu + cleared.mwh / 1000);
      daily.set(key, row);
    }
  }

  return { rows: [...rows, ...daily.values()], margins };
}

/** One row per client, one column per exchange — the "Margin" half of IV-F, IV-K and IV-O. */
function marginTable(entries) {
  const exchanges = [...new Set(entries.map((e) => e.exchange))].sort();
  const byClient = new Map();
  for (const e of entries) {
    const row = byClient.get(e.client) || { client: e.client, margins: {} };
    row.margins[e.exchange] = e.margin;
    byClient.set(e.client, row);
  }
  return { exchanges, rows: [...byClient.values()].sort((a, b) => a.client.localeCompare(b.client)) };
}

/**
 * Build every annexure for a period.
 *
 * Bilateral rows come from the period's Form-IV when one exists, so hand-added
 * lines and recorded exemptions are respected; when nobody has started the
 * return they are derived straight from the trade book, which is what makes the
 * split visible on the calendar for a period that is still "Not started".
 * Exchange rows always come from cleared bids.
 */
export function buildAnnexures(periodType, period) {
  const type = periodType === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
  const window = resolvePeriod(type, period);
  const form = db.prepare('SELECT * FROM cerc_form_iv WHERE period_type = ? AND period = ?').get(type, window.period) || null;
  const lines = form ? getLines(form.id) : deriveLines(window.from, window.to);

  const bilateral = bilateralRows(lines);
  const exchange = exchangeRows(window.from, window.to);
  const all = [...bilateral, ...exchange.rows];

  const annexures = ANNEXURES.map((a) => {
    let rows = all.filter((r) => r.code === a.code);

    // Intra-State is filed as a volume per state, not transaction by transaction.
    if (a.layout === 'INTRA') {
      const byState = new Map();
      for (const r of rows) {
        const key = `${r.section}|${r.seller_state}`;
        const agg = byState.get(key) || { code: a.code, section: r.section, seller_state: r.seller_state, volume_mu: 0 };
        agg.volume_mu = round(agg.volume_mu + r.volume_mu);
        byState.set(key, agg);
      }
      rows = [...byState.values()];
    }

    const margins = a.marginTitle ? marginTable(exchange.margins.filter((m) => m.code === a.code)) : null;
    return {
      code: a.code,
      title: a.title,
      layout: a.layout,
      unverified: !!a.unverified,
      columns: COLS[a.layout].map((c) => ({ key: c.key, label: c.h, group: c.g || null })),
      sections: (a.sections || []).map(([key, label]) => ({ key, label })),
      rows,
      row_count: rows.length,
      volume_mu: round(rows.reduce((s, r) => s + (r.volume_mu || 0), 0)),
      margins,
    };
  });

  return {
    period_type: type,
    period: window.period,
    period_from: window.from,
    period_to: window.to,
    form_id: form?.id || null,
    form_no: form?.form_no || null,
    form_status: form?.status || 'MISSING',
    // Where the bilateral rows came from, so the screen can say so.
    basis: form ? 'FORM_IV' : 'TRADE_BOOK',
    total_volume_mu: round(annexures.reduce((s, a) => s + a.volume_mu, 0)),
    annexures,
  };
}

// --- Excel -----------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ddmmyyyy = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (d || '');
};

function periodLabel(built) {
  if (built.period_type === 'ANNUAL') return `Financial Year: ${built.period}`;
  const [y, m] = built.period.split('-').map(Number);
  return `Month: ${MONTHS[m - 1]}, ${y}`;
}

const cell = (row, key) => {
  if (key === 'start_date' || key === 'end_date') return ddmmyyyy(row[key]);
  const v = row[key];
  return v == null ? '' : v;
};

/** Lay one annexure out as rows of cells plus the merges its two-row header needs. */
function sheetFor(annexure, built, licensee) {
  const def = ANNEXURES.find((a) => a.code === annexure.code);
  const cols = COLS[def.layout];
  const aoa = [
    [`Form ${def.code.replace('-', ' ')}`],
    [def.title],
    [`Name of the Trading Licensee : ${licensee.name}`],
    [`Licence Details (No & Date): ${licensee.licence}`],
    [periodLabel(built)],
    [],
  ];
  const merges = [];
  const top = aoa.length;

  aoa.push(cols.map((c) => c.g || c.h));
  aoa.push(cols.map((c) => (c.g ? c.h : '')));
  for (let i = 0; i < cols.length; i += 1) {
    if (!cols[i].g) {
      merges.push({ s: { r: top, c: i }, e: { r: top + 1, c: i } });
    } else if (i === 0 || cols[i - 1].g !== cols[i].g) {
      let j = i;
      while (j + 1 < cols.length && cols[j + 1].g === cols[i].g) j += 1;
      if (j > i) merges.push({ s: { r: top, c: i }, e: { r: top, c: j } });
    }
  }

  // An empty form is still filed, with NIL in it.
  const body = (rows) => {
    if (!rows.length) {
      aoa.push([1, 'NIL']);
      return;
    }
    rows.forEach((r, i) => aoa.push(cols.map((c) => (c.key === 'sr' ? i + 1 : cell(r, c.key)))));
  };

  if (def.sections) {
    for (const [key, label] of def.sections) {
      aoa.push(def.layout === 'INTRA' ? [label] : [key, label]);
      body(annexure.rows.filter((r) => r.section === key));
    }
  } else {
    body(annexure.rows);
  }

  aoa.push([]);
  if (def.footnote) aoa.push([def.footnote], []);
  for (const n of def.notes || []) aoa.push([n]);

  if (def.marginTitle) {
    const exchanges = annexure.margins.exchanges.length ? annexure.margins.exchanges : ['IEX', 'PXIL', 'HPX'];
    aoa.push([], [`Form ${def.code.replace('-', ' ')} : Margin`], [def.marginTitle], []);
    const mTop = aoa.length;
    aoa.push(['S.No.', 'Name of the Client', ...exchanges]);
    aoa.push(['', '', ...exchanges.map(() => 'Margin charged (₹/kWh)')]);
    merges.push({ s: { r: mTop, c: 0 }, e: { r: mTop + 1, c: 0 } }, { s: { r: mTop, c: 1 }, e: { r: mTop + 1, c: 1 } });
    if (!annexure.margins.rows.length) aoa.push([1, 'NIL']);
    annexure.margins.rows.forEach((r, i) => {
      aoa.push([i + 1, r.client, ...exchanges.map((x) => (r.margins[x] ?? ''))]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = cols.map((c) => ({ wch: /Name of/.test(c.h) ? 34 : c.key === 'sr' ? 7 : 16 }));
  return ws;
}

/**
 * The whole return as one workbook, a sheet per form, in the filed layout.
 *
 * The Commission takes the soft copy "in an Excel Sheet by Email and through
 * Saudamini Portal" — so this is the file the desk sends, not a screen export.
 */
export function annexuresWorkbook(built) {
  const licensee = {
    name: getParam('cerc_licensee_name', 'SJVN Limited') || 'SJVN Limited',
    licence: getParam('cerc_licence_details', '') || '',
  };
  const wb = XLSX.utils.book_new();
  for (const a of built.annexures) {
    XLSX.utils.book_append_sheet(wb, sheetFor(a, built, licensee), `Form ${a.code}`);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
