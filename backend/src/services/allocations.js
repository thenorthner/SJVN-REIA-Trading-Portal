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

// The PPAs a PSA draws its energy from for a period, with its share of each.
//
// A DISCOM's PSA is often backed by several developers' PPAs at once, so this
// returns every source, one row per PPA. The share in force on the first day of
// the period governs the whole month — the same rule a single-source PSA was
// always billed on: a change dated mid-month applies from the next month's bill.
// Where a re-split left two rows of the same PPA covering that day, the later
// one is the share in force.
export function sourcesForPsa(psaId, periodMonth) {
  const periodStart = `${periodMonth}-01`;
  const rows = db.prepare(`
    SELECT a.*, p.contract_no AS ppa_contract_no, p.capacity_mw AS ppa_capacity_mw
    FROM contract_allocations a
    JOIN contracts p ON p.id = a.ppa_id
    WHERE a.psa_id = ?
      AND COALESCE(a.effective_from, '0000-01-01') <= ?
      AND COALESCE(a.effective_to, '9999-12-31') >= ?
    ORDER BY COALESCE(a.effective_from, '0000-01-01') DESC
  `).all(psaId, periodStart, periodStart);
  const byPpa = new Map();
  for (const r of rows) if (!byPpa.has(r.ppa_id)) byPpa.set(r.ppa_id, r);
  return [...byPpa.values()].sort((a, b) => b.allocation_percent - a.allocation_percent
    || String(a.ppa_contract_no).localeCompare(String(b.ppa_contract_no)));
}
