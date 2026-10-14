/**
 * Statutory identifiers on a counterparty record: what each must look like, and
 * how they have to agree with one another.
 *
 * Nothing checked these. A PAN was whatever was typed into the box, so a record
 * could carry "INVALID123" as its PAN and a GSTIN belonging to a different
 * company — and the first anyone heard of it was a GST return that would not
 * reconcile or a TDS certificate issued against a number that does not exist.
 *
 * The same rules live in frontend/src/lib/kycValidation.js so the form can say
 * what is wrong as it is typed; this copy is the one that decides.
 */

export const KYC_RULES = {
  pan_no: {
    label: 'PAN',
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    example: 'ABCDE1234F',
    rule: 'Exactly 10 characters: 5 letters, 4 digits, 1 letter.',
  },
  gst_no: {
    label: 'GSTIN',
    pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    example: '08ABCDE1234F1Z5',
    rule: 'Exactly 15 characters: 2-digit state code, the 10-character PAN, entity code, the letter Z, check character.',
  },
  tan_no: {
    label: 'TAN',
    pattern: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    example: 'DELA12345B',
    rule: 'Exactly 10 characters: 4 letters, 5 digits, 1 letter.',
  },
  cin: {
    label: 'CIN',
    pattern: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
    example: 'U40106RJ2016PTC012345',
    rule: '21 characters: L or U, 5-digit industry code, 2-letter state, 4-digit year, 3-letter company type, 6-digit registration number.',
  },
  ifsc_code: {
    label: 'IFSC code',
    pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    example: 'SBIN0001234',
    rule: 'Exactly 11 characters: 4 letters, then the digit 0, then 6 letters or digits.',
  },
  account_no: {
    label: 'Bank account number',
    pattern: /^[0-9]{9,18}$/,
    example: '001122334455',
    rule: '9 to 18 digits. No letters, spaces or symbols.',
  },
};

/** Fields stored upper-cased with no surrounding or inner whitespace. */
export const UPPERCASE_FIELDS = ['pan_no', 'gst_no', 'tan_no', 'cin', 'ifsc_code'];

/** GST state codes in use (01–38, plus 97 Other Territory and 99 Centre Jurisdiction). */
const GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97', '99',
]);

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** The form a value is stored in: trimmed, and upper-cased where the identifier is case-insensitive. */
export function normaliseKycValue(field, value) {
  if (blank(value)) return value ?? null;
  const s = String(value).trim();
  if (UPPERCASE_FIELDS.includes(field)) return s.replace(/\s+/g, '').toUpperCase();
  if (field === 'account_no') return s.replace(/\s+/g, '');
  return s;
}

/** A copy of `body` with every identifier normalised. Fields not present stay absent. */
export function normaliseKycBody(body) {
  const out = { ...body };
  for (const f of [...UPPERCASE_FIELDS, 'account_no']) {
    if (out[f] !== undefined) out[f] = normaliseKycValue(f, out[f]);
  }
  return out;
}

/**
 * Check the identifiers present in `body` (already normalised).
 *
 * `context` carries the values already on record, so an edit that changes only
 * the GSTIN is still checked against the PAN it has to contain.
 *
 * Returns [{ field, message }] — every problem at once, not the first one, so a
 * form can be corrected in a single pass.
 */
export function validateKyc(body, context = {}) {
  const errors = [];
  const value = (f) => (body[f] !== undefined ? body[f] : context[f]);

  for (const [field, rule] of Object.entries(KYC_RULES)) {
    const v = body[field];
    if (blank(v)) continue;
    if (!rule.pattern.test(String(v))) {
      errors.push({
        field,
        message: `Invalid ${rule.label} "${v}". ${rule.rule} Example: ${rule.example}`,
      });
    }
  }

  const bad = (f) => errors.some((e) => e.field === f);
  const pan = value('pan_no');
  const gst = value('gst_no');

  // A GSTIN is issued against a PAN and carries it in characters 3 to 12. One
  // that carries a different PAN belongs to a different taxpayer.
  if (!blank(gst) && !bad('gst_no') && (body.gst_no !== undefined || body.pan_no !== undefined)) {
    const gstPan = String(gst).slice(2, 12);
    if (!GST_STATE_CODES.has(String(gst).slice(0, 2))) {
      errors.push({ field: 'gst_no', message: `GSTIN state code "${String(gst).slice(0, 2)}" is not a valid GST state code (01–38, 97 or 99).` });
    }
    if (!blank(pan) && !bad('pan_no') && gstPan !== String(pan)) {
      errors.push({ field: 'gst_no', message: `GSTIN PAN component (${gstPan}) does not match PAN (${pan}).` });
    }
  }

  // A CIN carries the year of incorporation; one from before company law
  // existed, or from the future, was mistyped.
  if (!blank(body.cin) && !bad('cin')) {
    const year = Number(String(body.cin).slice(8, 12));
    const thisYear = new Date().getFullYear();
    if (year < 1850 || year > thisYear) {
      errors.push({ field: 'cin', message: `CIN year of incorporation (${year}) must be between 1850 and ${thisYear}.` });
    }
  }

  for (const [field, label] of [['corporate_email', 'Corporate email']]) {
    const v = body[field];
    if (!blank(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())) {
      errors.push({ field, message: `${label} "${v}" is not a valid email address.` });
    }
  }
  if (!blank(body.corporate_phone)) {
    const digits = String(body.corporate_phone).replace(/[\s\-()+]/g, '');
    if (!/^[0-9]{10,13}$/.test(digits)) {
      errors.push({ field: 'corporate_phone', message: 'Corporate phone must be 10 to 13 digits (STD or country code allowed).' });
    }
  }
  if (!blank(body.corporate_website)
      && !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(body.corporate_website).trim())) {
    errors.push({ field: 'corporate_website', message: `Corporate website "${body.corporate_website}" is not a valid web address.` });
  }

  for (const [field, label] of [
    ['capacity_mw', 'Capacity (MW)'],
    ['contracted_capacity_mw', 'Contracted capacity (MW)'],
    ['psa_tariff', 'PSA tariff'],
  ]) {
    const v = body[field];
    if (blank(v)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) errors.push({ field, message: `${label} must be a number greater than zero.` });
  }

  return errors;
}
