/** Payment Security constants */

export const INVOCATION_OVERDUE_DAYS = 30;
// PSA Art. 6.5.2: Letter of Credit = 110% of estimated average monthly billing.
export const DEFAULT_MONTHS_COVER = 1.1;
export const ALERT_CASCADE_DAYS = [60, 30, 15, 7, 0];
export const ACTIVE_STATUSES = ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED'];

// The order security is drawn in on a default. An instrument dedicated to one
// counterparty is exhausted before anything pooled: a corpus or payment-security
// fund covers every contract, so spending it on one buyer's default removes cover
// that protects all the others. Lower number is drawn first.
export const WATERFALL_DEFAULTS = {
  LC: 10,                     // the buyer's own letter of credit
  BANK_GUARANTEE: 20,         // the seller's own performance guarantee
  PAYMENT_SECURITY_FUND: 30,  // pooled
  CORPUS_FUND: 40,            // pooled
  OTHER: 90,
};

// Which instruments answer for whose default. A letter of credit is the buyer's
// payment instrument and a bank guarantee is the seller's performance
// instrument; invoking one for the other's failure is not a fallback, it is the
// wrong instrument. Pooled funds back either side.
export const INSTRUMENTS_BY_SIDE = {
  BUYER: ['LC', 'CORPUS_FUND', 'PAYMENT_SECURITY_FUND', 'OTHER'],
  SELLER: ['BANK_GUARANTEE', 'CORPUS_FUND', 'PAYMENT_SECURITY_FUND', 'OTHER'],
};

export function genInstrumentNo(type = 'LC') {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PS/${type}/${new Date().getFullYear()}/${rand}`;
}

export function genInvocationNo() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INVOK/${new Date().getFullYear()}/${rand}`;
}

export function refreshAvailable(row) {
  const limit = row.limit_amount ?? row.amount ?? 0;
  const utilized = row.utilized_amount || 0;
  return Math.max(0, limit - utilized);
}
