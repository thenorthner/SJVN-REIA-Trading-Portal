import db from '../db/index.js';

// The PSAs a PPA's energy is allocated to for a period, with their shares.
//
// Only allocations whose validity covers the period count, so a share that ended
// before it is not billed and one that starts within it is. This is what makes a
// mid-cycle change of split safe: an earlier period keeps billing on the split
// that was in force then, rather than being restated by a later change.
export function allocationsInForce(ppaId, periodMonth) {
  const periodStart = `${periodMonth}-01`;
  const periodEnd = `${periodMonth}-31`;
  return db.prepare(`
    SELECT a.*, c.contract_no AS psa_contract_no
    FROM contract_allocations a
    LEFT JOIN contracts c ON c.id = a.psa_id
    WHERE a.ppa_id = ?
      AND COALESCE(a.effective_from, '0000-01-01') <= ?
      AND COALESCE(a.effective_to, '9999-12-31') >= ?
    ORDER BY a.allocation_percent DESC
  `).all(ppaId, periodEnd, periodStart);
}
