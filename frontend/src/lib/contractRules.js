// What the contract says about each rule, read from the structured fields the
// billing engine uses. The stored sentence is only a fallback: a contract loaded
// from a spreadsheet, or amended, can carry the numbers without the sentence,
// and the screen then showed "-" for a rule that was in force.
export function paymentTermsText(c) {
  if (c.payment_terms_days != null && c.payment_terms_days !== '') return `Net ${c.payment_terms_days} days from bill date`;
  return c.payment_terms || '-';
}
export function rebateText(c) {
  if (c.rebate_pct != null && c.rebate_pct !== '' && Number(c.rebate_pct) > 0) {
    const ref = c.rebate_basis === 'DUE_DATE' ? 'due date' : 'bill date';
    return `${c.rebate_pct}% if paid within ${c.rebate_days || 0} days from ${ref}`;
  }
  return c.rebate_rule || 'No early-payment rebate';
}
export function lpsText(c) {
  if (c.lps_annual_pct != null && c.lps_annual_pct !== '' && Number(c.lps_annual_pct) > 0) {
    const grace = Number(c.lps_grace_days) > 0 ? `, after a ${c.lps_grace_days}-day grace period` : '';
    return `${c.lps_annual_pct}% per annum on the overdue amount${grace}`;
  }
  return c.lps_rule || 'No late-payment surcharge';
}

// How the contract's payment security is named, on the form and wherever it is read back.
export const SECURITY_TYPES = [
  { value: 'LETTER_OF_CREDIT', label: 'Letter of Credit (LC)' },
  { value: 'BANK_GUARANTEE', label: 'Bank Guarantee (BG)' },
  { value: 'CORPUS_FUND', label: 'Corpus Fund' },
  { value: 'PAYMENT_SECURITY_FUND', label: 'Payment Security Fund' },
  { value: 'ESCROW', label: 'Escrow Account' },
  { value: 'NONE', label: 'None' },
];
export function paymentSecurityText(c) {
  return SECURITY_TYPES.find((s) => s.value === c.payment_security_type)?.label || c.payment_security_type || '-';
}
