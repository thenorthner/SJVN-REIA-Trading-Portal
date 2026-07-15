/** Payment Security constants */

export const INVOCATION_OVERDUE_DAYS = 30;
export const DEFAULT_MONTHS_COVER = 1;
export const ALERT_CASCADE_DAYS = [60, 30, 15, 7, 0];
export const ACTIVE_STATUSES = ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED'];

export const WATERFALL_DEFAULTS = {
  CORPUS_FUND: 10,
  PAYMENT_SECURITY_FUND: 20,
  LC: 30,
  BANK_GUARANTEE: 40,
  OTHER: 90,
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
