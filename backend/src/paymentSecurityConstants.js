import { nextSeriesNo } from './util.js';

const pad5 = (n) => String(n).padStart(5, '0');

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

// Both of these land in columns declared UNIQUE (payment_security.instrument_no,
// and the invocation register). They used to draw four random digits — nine
// thousand possible numbers — so by the birthday bound a register holding just
// 100 instruments had already about a 42% chance of having drawn the same
// number twice, and 200 made it near-certain. A repeat is not a duplicate on a
// report: the INSERT is rejected and the instrument cannot be recorded at all.
// Numbers come from the shared register instead, padded to five digits so they
// cannot land on one of the four-digit numbers already issued.
export function genInstrumentNo(type = 'LC') {
  const year = new Date().getFullYear();
  return `PS/${type}/${year}/${pad5(nextSeriesNo(`PS-${type}`, year))}`;
}

export function genInvocationNo() {
  const year = new Date().getFullYear();
  return `INVOK/${year}/${pad5(nextSeriesNo('INVOK', year))}`;
}

export function refreshAvailable(row) {
  const limit = row.limit_amount ?? row.amount ?? 0;
  const utilized = row.utilized_amount || 0;
  return Math.max(0, limit - utilized);
}
