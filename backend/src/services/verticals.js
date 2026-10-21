// Which desk a contract belongs to, from what it generates.
//
// REIA, Hydro and Thermal share the contracts, invoices and energy tables, so
// the only thing keeping one desk's books out of another's is a filter on the
// contract's project type. It lives here so every list and every dashboard cuts
// it the same way. Hydro includes pumped storage, as the Hydro desk already does.

export const VERTICAL_NAMES = ['REIA', 'HYDRO', 'THERMAL'];

const HYDRO_TYPES = "('hydro','psp')";

/** SQL condition on a contracts alias that holds for contracts of this vertical. */
export function contractVerticalSql(vertical, alias = 'c') {
  const t = `lower(COALESCE(${alias}.project_type, ''))`;
  if (vertical === 'HYDRO') return `(${t} IN ${HYDRO_TYPES} OR ${t} LIKE '%hydro%')`;
  if (vertical === 'THERMAL') return `${t} = 'thermal'`;
  return `NOT (${t} IN ${HYDRO_TYPES} OR ${t} LIKE '%hydro%' OR ${t} = 'thermal')`;
}

/** The same cut for a table that only carries contract_id. */
export function contractIdInVerticalSql(vertical, column) {
  return `${column} IN (SELECT c_v.id FROM contracts c_v WHERE ${contractVerticalSql(vertical, 'c_v')})`;
}

export function verticalOfContract(contract) {
  const t = String(contract?.project_type || '').toLowerCase();
  if (t === 'thermal') return 'THERMAL';
  if (t === 'hydro' || t === 'psp' || t.includes('hydro')) return 'HYDRO';
  return 'REIA';
}

/** Validated ?vertical= value, or null for "all". Throws on junk so a typo is not an unfiltered list. */
export function parseVertical(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = String(raw).toUpperCase();
  if (!VERTICAL_NAMES.includes(v)) {
    const err = new Error(`vertical must be one of: ${VERTICAL_NAMES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return v;
}
