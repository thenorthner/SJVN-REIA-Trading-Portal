/**
 * Statutory identifiers on a stakeholder record — the form's copy of
 * backend/src/services/kycValidation.js. The server decides; this copy exists so
 * the form can say what is wrong at the field, before anything is submitted.
 */

export const KYC_RULES = {
  pan_no: {
    label: 'PAN',
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    maxLength: 10,
    example: 'ABCDE1234F',
    rule: 'Exactly 10 characters: 5 letters, 4 digits, 1 letter.',
  },
  gst_no: {
    label: 'GSTIN',
    pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    maxLength: 15,
    example: '08ABCDE1234F1Z5',
    rule: 'Exactly 15 characters: 2-digit state code, the 10-character PAN, entity code, the letter Z, check character.',
  },
  tan_no: {
    label: 'TAN',
    pattern: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    maxLength: 10,
    example: 'DELA12345B',
    rule: 'Exactly 10 characters: 4 letters, 5 digits, 1 letter.',
  },
  cin: {
    label: 'CIN',
    pattern: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
    maxLength: 21,
    example: 'U40106RJ2016PTC012345',
    rule: '21 characters: L or U, 5-digit industry code, 2-letter state, 4-digit year, 3-letter company type, 6-digit registration number.',
  },
  ifsc_code: {
    label: 'IFSC code',
    pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    maxLength: 11,
    example: 'SBIN0001234',
    rule: 'Exactly 11 characters: 4 letters, then the digit 0, then 6 letters or digits.',
  },
  account_no: {
    label: 'Bank account number',
    pattern: /^[0-9]{9,18}$/,
    maxLength: 18,
    example: '001122334455',
    rule: '9 to 18 digits. No letters, spaces or symbols.',
  },
};

export const UPPERCASE_FIELDS = ['pan_no', 'gst_no', 'tan_no', 'cin', 'ifsc_code'];

const GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97', '99',
]);

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** What the field holds as it is typed: upper-cased identifiers, digits-only account number. */
export function normaliseKycInput(field, value) {
  const s = String(value ?? '');
  if (UPPERCASE_FIELDS.includes(field)) return s.replace(/\s+/g, '').toUpperCase();
  if (field === 'account_no') return s.replace(/\D+/g, '');
  return s;
}

/**
 * The problem with one field given the rest of the form, or null. Cross-checks
 * (GSTIN against PAN) are reported on the GSTIN.
 */
export function fieldError(field, form) {
  const v = form[field];
  const rule = KYC_RULES[field];

  if (rule && !blank(v) && !rule.pattern.test(String(v))) {
    return `Invalid ${rule.label} "${v}". ${rule.rule} Example: ${rule.example}`;
  }

  if (field === 'gst_no' && !blank(v)) {
    const state = String(v).slice(0, 2);
    if (!GST_STATE_CODES.has(state)) return `GSTIN state code "${state}" is not a valid GST state code (01–38, 97 or 99).`;
    const pan = form.pan_no;
    if (!blank(pan) && KYC_RULES.pan_no.pattern.test(String(pan)) && String(v).slice(2, 12) !== String(pan)) {
      return `GSTIN PAN component (${String(v).slice(2, 12)}) does not match PAN (${pan}). Characters 3 to 12 of the GSTIN must be the PAN.`;
    }
  }

  if (field === 'cin' && !blank(v)) {
    const year = Number(String(v).slice(8, 12));
    const thisYear = new Date().getFullYear();
    if (year < 1850 || year > thisYear) return `CIN year of incorporation (${year}) must be between 1850 and ${thisYear}.`;
  }

  if (field === 'corporate_email' && !blank(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())) {
    return `"${v}" is not a valid email address.`;
  }
  if (field === 'corporate_phone' && !blank(v)) {
    const digits = String(v).replace(/[\s\-()+]/g, '');
    if (!/^[0-9]{10,13}$/.test(digits)) return 'Phone must be 10 to 13 digits (STD or country code allowed).';
  }
  if (field === 'corporate_website' && !blank(v)
      && !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(v).trim())) {
    return `"${v}" is not a valid web address. Example: www.company.in`;
  }
  if (['capacity_mw', 'contracted_capacity_mw', 'psa_tariff'].includes(field) && !blank(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 'Must be a number greater than zero.';
  }
  return null;
}

/** Labels for every field the onboarding form can report on. */
export const FIELD_LABELS = {
  name: 'Name', category: 'Category', pan_no: 'PAN No', gst_no: 'GST No', tan_no: 'TAN No', cin: 'CIN',
  corporate_email: 'Corporate Email', corporate_phone: 'Corporate Phone', corporate_website: 'Corporate Website',
  credit_rating: 'Credit Rating', technology: 'Technology', capacity_mw: 'Capacity (MW)',
  contracted_capacity_mw: 'Contracted Capacity (MW)', psa_tariff: 'PSA Tariff', supply_criteria: 'Criteria for Supply of Power',
  bank_name: 'Bank Name', account_no: 'Account No', ifsc_code: 'IFSC Code', branch_address: 'Branch Address',
  contact_name: 'Commercial Contact Name', contact_email: 'Commercial Contact Email', contact_phone: 'Commercial Contact Phone',
};

/**
 * Everything wrong with the onboarding form, in the order the fields appear.
 * Returns [{ field, label, message }].
 */
export function validateStakeholderForm(form) {
  const errors = [];
  const add = (field, message) => errors.push({ field, label: FIELD_LABELS[field] || field, message });

  const required = ['name', 'category', 'pan_no', 'gst_no'];
  required.push(form.entity_type === 'BUYER' ? 'contracted_capacity_mw' : 'capacity_mw');
  required.push('bank_name', 'account_no', 'ifsc_code', 'branch_address');

  const order = [
    'name', 'category', 'pan_no', 'gst_no', 'tan_no', 'cin', 'corporate_email', 'corporate_phone', 'corporate_website',
    'contact_name', 'contact_email', 'contact_phone',
    'capacity_mw', 'contracted_capacity_mw', 'psa_tariff', 'bank_name', 'account_no', 'ifsc_code', 'branch_address',
  ];

  const contact = form.contacts?.[0] || {};
  const flat = { ...form, contact_name: contact.name, contact_email: contact.email, contact_phone: contact.phone };

  for (const field of order) {
    if (field === 'capacity_mw' && form.entity_type !== 'SELLER') continue;
    if (['contracted_capacity_mw', 'psa_tariff'].includes(field) && form.entity_type !== 'BUYER') continue;

    if (field === 'contact_name') {
      if (blank(flat.contact_name)) add(field, 'A commercial contact name is required — it is who SJVN writes to about bills.');
      continue;
    }
    if (field === 'contact_email') {
      const e = fieldError('corporate_email', { corporate_email: flat.contact_email });
      if (e) add(field, e);
      continue;
    }
    if (field === 'contact_phone') {
      const e = fieldError('corporate_phone', { corporate_phone: flat.contact_phone });
      if (e) add(field, e);
      continue;
    }

    if (required.includes(field) && blank(flat[field])) {
      add(field, `${FIELD_LABELS[field]} is required.`);
      continue;
    }
    const e = fieldError(field, flat);
    if (e) add(field, e);
  }
  return errors;
}

// ── Fixed choices. A field with a known set of answers is a dropdown, so the
// register does not end up with "Discom", "DISCOM" and "discom." as three
// categories. ───────────────────────────────────────────────────────────────

export const CATEGORY_OPTIONS = {
  SELLER: ['RE Generator', 'Hydro Generator', 'Thermal Generator', 'IPP', 'SPV', 'Captive Generator', 'Trading Licensee'],
  BUYER: ['DISCOM', 'State Utility', 'C&I', 'Open Access Consumer', 'Trading Licensee', 'Railways / Bulk Consumer'],
};

export const CREDIT_RATING_OPTIONS = [
  'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
  'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'C', 'D', 'Unrated',
];

export const TECHNOLOGY_OPTIONS = ['Solar', 'Wind', 'Hybrid', 'FDRE', 'Peak Power', 'Hydro', 'PSP', 'Storage', 'Thermal'];

export const SUPPLY_CRITERIA_OPTIONS = ['Round the Clock (RTC)', 'Peak', 'Off-peak', 'As Available', 'FDRE / Demand-following'];

export const VERTICAL_LABELS = { REIA: 'REIA', HYDRO: 'Hydro Billing', THERMAL: 'Thermal Billing' };
