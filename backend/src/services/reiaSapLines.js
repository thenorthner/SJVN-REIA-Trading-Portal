/**
 * The FI lines a REIA invoice becomes in SAP (bill type RE).
 *
 * Pure: no database, no network. services/reiaSapPush.js sends what this
 * builds; scripts/sapPushTest.js uses it to send a test invoice without the
 * platform database.
 *
 * TEST STAGE: GLs, profit centres, plant and beneficiary come from
 * backend/.env until Finance gives the REIA plant map and buyer list.
 */

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// The credit side, in CPOS order: posting-line amount column → .env GL key.
const CREDIT_PARTS = [
  ['energy_amount', 'SAP_FI_GL_ENERGY', 'energy'],
  ['margin_amount', 'SAP_FI_GL_MARGIN', 'SJVN margin'],
  ['pass_through_amount', 'SAP_FI_GL_PASS_THROUGH', 'pass-through'],
  ['tax_amount', 'SAP_FI_GL_TAX', 'tax'],
  ['adjustment_amount', 'SAP_FI_GL_ADJUSTMENT', 'adjustment'],
];

const env = (k) => String(process.env[k] || '').trim();

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** The posting values SAP needs that the platform has no master for yet. */
export function sapPostingConfig() {
  const cfg = {
    plant_id: env('SAP_FI_PLANT_ID'),
    beneficiary_no: env('SAP_FI_BENEFICIARY_NO'),
    blart: env('SAP_FI_BLART') || 'CB',
    gl_receivable: env('SAP_FI_GL_RECEIVABLE'),
    prctr_receivable: env('SAP_FI_PRCTR_RECEIVABLE'),
    prctr_income: env('SAP_FI_PRCTR_INCOME'),
  };
  const missing = ['SAP_FI_PLANT_ID', 'SAP_FI_BENEFICIARY_NO', 'SAP_FI_GL_RECEIVABLE',
    'SAP_FI_PRCTR_RECEIVABLE', 'SAP_FI_PRCTR_INCOME'].filter((k) => !env(k));
  return { ...cfg, missing };
}

/**
 * The invoice number as SAP's 16-character field takes it.
 *
 * REIA numbers run to 19 (INV-PSA/2026/000002). Dropping the "INV-" prefix
 * keeps them unique and readable; anything still too long is refused rather
 * than cut, because SAP finds an invoice's earlier bookings by this number.
 */
export function sapInvoiceNo(no) {
  const s = String(no || '').trim();
  if (s.length <= 16) return s;
  const short = s.replace(/^INV-/i, '');
  if (short.length <= 16) return short;
  throw bad(`Invoice number ${s} is longer than the 16 characters SAP holds`);
}

/** YYYYMMDDHHMMSS in IST, SAP's run id for a push. */
export function istStamp(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().replace(/\D/g, '').slice(0, 14);
}

/** The FI lines of one invoice on a posting. */
export function buildInvoiceLines({ line, posting, bldat, belnr, timestamp, cfg }) {
  const [year, month] = String(posting.period_month).split('-');
  const ben = String(cfg.beneficiary_no).padStart(2, '0');
  const base = {
    BillId: 'RE',
    PlantId: cfg.plant_id,
    BeneficiaryNo: ben,
    UrsBenNo: '00',
    Sub: '00',
    Zmonth: month,
    Zyear: year,
    TrnType: 'BL',
    Timestamp: timestamp,
    // One CB document per invoice: two invoices of the same beneficiary in
    // one push would otherwise share SAP's table key.
    CbDocNo: belnr,
    CbDocNoAdj: '',
    ReversalEntry: false,
    Bldat: `${bldat}T00:00:00`,
    InvoiceNo: sapInvoiceNo(line.doc_no),
    InvoiceNoAdj: '',
    Blart: cfg.blart,
    Bktxt: `RE_${month}${year}${ben}_Dr`,
    PaymentInfo: '',
    Kostl: '',
    Belnr: belnr,
  };

  const total = money(line.total_amount);
  if (total === 0) throw bad(`${line.doc_no} totals zero; there is nothing to book`);

  const out = [{
    ...base, Cpos: '0001', Hkont: cfg.gl_receivable, Prctr: cfg.prctr_receivable,
    Newbs: '40', Dmbtr: total.toFixed(2), Sgtxt: `REIA_${month}${year}${ben}_Dr`,
  }];
  let credits = 0;
  for (const [col, glKey, label] of CREDIT_PARTS) {
    const amt = money(line[col]);
    if (amt === 0) continue;
    const gl = env(glKey);
    if (!gl) throw bad(`${line.doc_no} has ${label} of ${amt}; set ${glKey} in backend/.env`);
    credits = money(credits + amt);
    out.push({
      ...base, Cpos: String(out.length + 1).padStart(4, '0'), Hkont: gl, Prctr: cfg.prctr_income,
      Newbs: '50', Dmbtr: amt.toFixed(2), Sgtxt: `REIA_${month}${year}${ben}_Cr`,
    });
  }
  if (Math.abs(credits - total) >= 0.01) {
    throw bad(`${line.doc_no} does not balance: total ${total}, parts ${credits}`);
  }
  return out;
}
