/**
 * Which stations a desk may work on.
 *
 * The hydro desk (Commercial roles) and the thermal desk share the station
 * billing routes, so every request naming a station — directly, or through a
 * bill, note, dispute or other record of one — is checked against the desk's
 * own vertical. Administrators, management, finance and audit are not tied to
 * a desk and see both.
 */
import db from '../db/index.js';

const HYDRO_ROLES = ['COMMERCIAL_ADMIN', 'COMMERCIAL', 'COMMERCIAL_USER'];
const THERMAL_ROLES = ['THERMAL_ADMIN', 'THERMAL_USER'];

/** 'HYDRO', 'THERMAL', or null for a role that is not tied to one desk. */
export function deskVertical(user) {
  if (HYDRO_ROLES.includes(user?.role)) return 'HYDRO';
  if (THERMAL_ROLES.includes(user?.role)) return 'THERMAL';
  return null;
}

/** 'HYDRO' or 'THERMAL' for a station contract, null for anything else. */
export function verticalOfContract(contractId) {
  if (!contractId) return null;
  const c = db.prepare('SELECT project_type FROM contracts WHERE id = ?').get(contractId);
  if (!c) return null;
  if (c.project_type === 'Thermal') return 'THERMAL';
  if (['Hydro', 'PSP'].includes(c.project_type)) return 'HYDRO';
  return null;
}

// The records that carry a station, in the order a route id is tried against them.
const OWNERS = [
  'hydro_station_bills', 'hydro_ledger_docs', 'hydro_notes', 'hydro_disputes',
  'hydro_security_instruments', 'hydro_reconciliations', 'hydro_tds_entries',
  'hydro_beneficiary_allocations', 'hydro_fi_postings',
  'hydro_additional_charges',
];

export function contractOfRecord(id) {
  for (const t of OWNERS) {
    try {
      const r = db.prepare(`SELECT contract_id FROM ${t} WHERE id = ?`).get(id);
      if (r) return r.contract_id;
    } catch { /* table absent on an older database */ }
  }
  return null;
}

function refusal(user, contractId) {
  const desk = deskVertical(user);
  if (!desk || !contractId) return null;
  const v = verticalOfContract(contractId);
  if (v && v !== desk) {
    return `This is a ${v === 'THERMAL' ? 'thermal' : 'hydro'} station's record; the ${desk === 'THERMAL' ? 'thermal' : 'hydro'} desk works on its own stations only.`;
  }
  return null;
}

/** Install the check on a router. */
export function stationScope(router) {
  router.use((req, res, next) => {
    const named = req.query?.contract_id || req.body?.contract_id;
    const no = refusal(req.user, named);
    if (no) return res.status(403).json({ error: no });
    return next();
  });
  const byRecord = (req, res, next, id) => {
    const no = refusal(req.user, contractOfRecord(id));
    if (no) return res.status(403).json({ error: no });
    return next();
  };
  router.param('id', byRecord);
  router.param('docId', byRecord);
  router.param('postingId', byRecord);
}
