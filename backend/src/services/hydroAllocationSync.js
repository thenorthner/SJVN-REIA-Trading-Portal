/**
 * The month's beneficiary allocation, taken from the account the energy came
 * from.
 *
 * A hydro bill apportions its charges on each beneficiary's weighted average
 * entitlement for the month. That figure is in the Regional Energy Account
 * (Table C1) beside the energy, and it moves: in September 2026 Uttarakhand's
 * share of Nathpa Jhakri was nil and Punjab's had grown by as much. The bill
 * run used to read the energy off the new account and the percentages off
 * whatever sheet had last been typed in, so the station total matched NRPC to
 * the rupee while Rs 1.67 crore of it sat on a beneficiary that had drawn
 * nothing.
 *
 * So before a month is billed, its sheet is derived here:
 *
 *   - one row per state from Table C1, to its six decimals;
 *   - Delhi divided among its licensees as Delhi SLDC's State Energy Account
 *     divides it (Annexure-2) — and, until that account is out, with the fixed
 *     shares carried and the balance on the licensee that takes the balance;
 *   - Rajasthan divided on the discom shares the state allocates on;
 *   - the home state split between its free-power row and the Sale of Rights
 *     share that is fixed.
 *
 * Nothing here guesses. A row that does not line up with the energy scheduled
 * in Table D2, a share nobody on the sheet can be billed for, a total that is
 * not 100 — each refuses the sheet and says why, and the month waits for the
 * desk. A sheet the desk has entered for the month itself is never replaced.
 */

import fs from 'fs';
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';
import { secureLogAudit } from '../auditEngine.js';
import { reaScraper } from './reaScraper.js';
import { delhiSeaForMonth } from './delhiSldcSea.js';

const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const SAME = 5e-7; // two six-decimal figures are the same figure

const HOME_STATE = 'HIMACHAL PRADESH';
// How a state on the REA is named on the bill, where the two differ.
const BILLED_AS = { 'JAMMU AND KASHMIR': 'J & K', 'MADHYA PRADESH': 'MPPMCL' };
// Columns of Table C1 that are not a party a bill can be raised on.
const NOT_A_BENEFICIARY = ['SURRENDERED POWER', 'PG-HVDC-NR'];
const DELHI_LICENSEES = {
  BRPL: 'BSES RAJDHANI POWER', BYPL: 'BSES YAMUNA POWER', TPDDL: 'TPDDL', NDMC: 'NDMC', MES: 'MES',
};

export const AUTO_PREFIX = 'AUTO:';
const PROVISIONAL_DELHI = 'Delhi split provisional';
const DEFAULT_RAJASTHAN_SHARES = 'AJMER VVNL:27.09,JAIPUR VVNL:38.22,JODHPUR VVNL:34.69';

/** "AJMER VVNL:27.09,JAIPUR VVNL:38.22,…" as [{ name, share }]; null if it does not total 100. */
export function parseShares(text) {
  const parts = String(text || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.lastIndexOf(':');
    return { name: p.slice(0, i).trim().toUpperCase(), share: Number(p.slice(i + 1)) };
  });
  if (parts.length < 2 || parts.some((p) => !p.name || !(p.share > 0))) return null;
  if (Math.abs(parts.reduce((a, p) => a + p.share, 0) - 100) > 1e-6) return null;
  return parts;
}

/** Which state of the REA a row of the sheet belongs to. */
function stateOf(row) {
  if (row.parent_state) return String(row.parent_state).toUpperCase();
  const name = String(row.beneficiary_name).toUpperCase();
  if (row.is_home_state || /^HPSEB/.test(name)) return HOME_STATE;
  const back = Object.entries(BILLED_AS).find(([, billed]) => billed === name);
  return back ? back[0] : name;
}

/** A sheet's percentages added up by state — what Table C1 would show for it. */
export function stateTotals(rows) {
  const out = {};
  for (const r of rows) out[stateOf(r)] = r6((out[stateOf(r)] || 0) + Number(r.pct_rea));
  return out;
}

/**
 * Table C1 against Table D2.
 *
 * Hydro is scheduled in proportion to entitlement, so each state's share of the
 * energy scheduled sits within a few hundredths of a percent of its
 * entitlement. A figure read into the wrong column lands whole points away —
 * which is what this is here to catch, not small differences.
 */
export function checkAgainstSchedule(entitlement, scheduledLu, tolerance = 0.5) {
  if (!scheduledLu || !Object.keys(scheduledLu).length) return ['Table D2 has no schedule for the station to check the entitlements against'];
  const byState = {};
  for (const [name, lu] of Object.entries(scheduledLu)) {
    const state = /^GOHP\b/i.test(name) ? HOME_STATE : name.toUpperCase();
    byState[state] = (byState[state] || 0) + Number(lu);
  }
  const total = Object.values(byState).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return ['Table D2 schedules no energy for the station'];
  const problems = [];
  for (const state of new Set([...Object.keys(entitlement), ...Object.keys(byState)])) {
    const pct = Number(entitlement[state]) || 0;
    const scheduled = ((byState[state] || 0) / total) * 100;
    if (Math.abs(pct - scheduled) > tolerance) {
      problems.push(`${state} is entitled to ${pct.toFixed(6)}% but was scheduled ${scheduled.toFixed(3)}% of the energy`);
    }
  }
  return problems;
}

/**
 * The sheet for a month.
 *
 * `prevRows` is the sheet in force: it says who the billing parties are, in
 * what order, and what the fixed shares inside a state stand at. `entitlement`
 * is Table C1 for the station. `delhiSea` is the station's row from Delhi
 * SLDC's account for the same month, when it is out.
 */
export function buildMonthSheet({ prevRows, entitlement, delhiSea = null, rajasthanShares = null }) {
  const problems = [];
  const notes = [];
  let provisional = false;
  const prev = prevRows.map((r) => ({ ...r, _state: stateOf(r), _name: String(r.beneficiary_name).toUpperCase() }));
  const order = new Map(prev.map((r, i) => [r._name, r.sr_no ?? i + 1]));
  const out = [];
  const add = (name, pct, extra = {}) => {
    const was = prev.find((r) => r._name === name.toUpperCase());
    out.push({
      beneficiary_name: was ? was.beneficiary_name : name,
      beneficiary_id: was?.beneficiary_id || null,
      parent_state: extra.parent_state ?? was?.parent_state ?? null,
      pct_rea: r6(pct),
      pct_incl_free: r6(extra.pct_incl_free ?? pct),
      is_home_state: extra.is_home_state ? 1 : 0,
    });
  };

  const total = Object.values(entitlement).reduce((a, b) => a + Number(b), 0);
  if (Math.abs(total - 100) > 1e-4) problems.push(`Table C1 totals ${total.toFixed(6)}% for the station, not 100%`);

  for (const [state, raw] of Object.entries(entitlement)) {
    const pct = Number(raw);
    if (!(pct > 0)) continue;
    if (NOT_A_BENEFICIARY.includes(state)) {
      problems.push(`${pct.toFixed(6)}% of the station is under "${state}" — there is no party on the sheet to bill it to`);
      continue;
    }
    const members = prev.filter((r) => r._state === state);

    if (state === HOME_STATE) {
      const home = members.find((r) => r.is_home_state);
      if (!home) { problems.push(`${state} has ${pct.toFixed(6)}% but the sheet in force marks no home-state row`); continue; }
      // The Sale of Rights share is fixed; the home state's own row is what is left.
      const fixed = members.filter((r) => r !== home);
      const left = r6(pct - fixed.reduce((a, r) => a + Number(r.pct_rea), 0));
      if (left < 0) { problems.push(`${state}'s ${pct.toFixed(6)}% is less than the fixed shares inside it`); continue; }
      add(home.beneficiary_name, left, { pct_incl_free: pct, is_home_state: true });
      for (const r of fixed) add(r.beneficiary_name, r.pct_rea, { pct_incl_free: 0 });
      continue;
    }

    if (state === 'DELHI') {
      const seaOk = delhiSea && Math.abs(Number(delhiSea.total) - pct) <= SAME;
      if (delhiSea && !seaOk) {
        notes.push(`Delhi SLDC's account gives Delhi ${Number(delhiSea.total).toFixed(6)}% of the station against the REA's ${pct.toFixed(6)}% — not used`);
      }
      if (seaOk) {
        const parts = Object.entries(DELHI_LICENSEES)
          .map(([code, name]) => ({ name, pct: r6(delhiSea[code] || 0) })).filter((p) => p.pct > 0);
        const sum = r6(parts.reduce((a, p) => a + p.pct, 0));
        if (Math.abs(sum - pct) > 1e-6) {
          problems.push(`Delhi SLDC's licensee shares add to ${sum.toFixed(6)}%, not Delhi's ${pct.toFixed(6)}%`);
          continue;
        }
        for (const p of parts) add(p.name, p.pct, { parent_state: 'DELHI' });
        continue;
      }
      if (!members.length) { problems.push(`Delhi has ${pct.toFixed(6)}% but no licensee split is known for it yet`); continue; }
      if (members.length === 1) { add(members[0].beneficiary_name, pct); continue; }
      // Until Delhi SLDC's account is out: the fixed shares stand, and the
      // licensee that takes the balance takes the balance.
      const balance = members.reduce((a, r) => (Number(r.pct_rea) > Number(a.pct_rea) ? r : a));
      const left = r6(pct - members.filter((r) => r !== balance).reduce((a, r) => a + Number(r.pct_rea), 0));
      if (left < 0) { problems.push(`Delhi's ${pct.toFixed(6)}% is less than the fixed licensee shares inside it`); continue; }
      for (const r of members) add(r.beneficiary_name, r === balance ? left : r.pct_rea);
      provisional = true;
      continue;
    }

    if (members.length > 1) {
      const shares = state === 'RAJASTHAN' ? rajasthanShares : null;
      if (!shares) { problems.push(`${state} is billed through ${members.length} parties and no rule divides its ${pct.toFixed(6)}% among them`); continue; }
      const top = shares.reduce((a, s) => (s.share > a.share ? s : a));
      const parts = shares.map((s) => ({ ...s, pct: r6((pct * s.share) / 100) }));
      // Rounding leaves a millionth over or short; it sits on the largest share.
      const others = parts.filter((p) => p.name !== top.name).reduce((a, p) => a + p.pct, 0);
      for (const p of parts) add(p.name, p.name === top.name ? r6(pct - others) : p.pct, { parent_state: state });
      continue;
    }

    add(members[0]?.beneficiary_name || BILLED_AS[state] || state, pct);
  }

  const sum = out.reduce((a, r) => a + r.pct_rea, 0);
  if (!problems.length && Math.abs(sum - 100) > 1e-6) problems.push(`The derived sheet totals ${sum.toFixed(6)}%, not 100%`);

  out.sort((a, b) => (order.get(a.beneficiary_name.toUpperCase()) ?? 9999) - (order.get(b.beneficiary_name.toUpperCase()) ?? 9999)
    || a.beneficiary_name.localeCompare(b.beneficiary_name));
  out.forEach((r, i) => { r.sr_no = i + 1; });
  return { rows: out, problems, notes, provisional };
}

/** What changed between two sheets, short enough to put in a notification. */
export function describeChanges(before, after) {
  const was = new Map(before.map((r) => [String(r.beneficiary_name).toUpperCase(), Number(r.pct_rea)]));
  const now = new Map(after.map((r) => [String(r.beneficiary_name).toUpperCase(), Number(r.pct_rea)]));
  const out = [];
  for (const [name, pct] of now) {
    if (!was.has(name)) out.push(`${name} added at ${pct.toFixed(6)}`);
    else if (Math.abs(was.get(name) - pct) > SAME) out.push(`${name} ${was.get(name).toFixed(6)} → ${pct.toFixed(6)}`);
  }
  for (const [name, pct] of was) if (!now.has(name)) out.push(`${name} dropped (was ${pct.toFixed(6)})`);
  return out;
}

/** The parser's name for a station contract. */
export function stationKeyFor(contract) {
  const text = `${contract.contract_no || ''} ${contract.seller_name || ''} ${contract.station_name || ''}`.toUpperCase();
  if (/NATHPA|NJHPS|NJHEP/.test(text)) return 'NATHPA_JHAKRI';
  if (/RAMPUR|RHPS|RHEP/.test(text)) return 'RAMPUR';
  if (/LUHRI/.test(text)) return 'LUHRI';
  return null;
}

const dayBefore = (isoDate) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const isAuto = (row) => String(row.source_note || '').startsWith(AUTO_PREFIX);

function rowsInForce(contractId, monthStart) {
  return db.prepare(`
    SELECT * FROM hydro_beneficiary_allocations
    WHERE contract_id = ? AND is_active = 1 AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY COALESCE(sr_no, 9999), beneficiary_name
  `).all(contractId, monthStart, monthStart);
}

/**
 * Put a sheet in force from the first of a month.
 *
 * The sheet before it is closed the day before rather than deleted — earlier
 * months were billed on it and can be re-read against it. A sheet already
 * dated later is left alone, and this one ends the day before that begins.
 */
function writeSheet(contract, month, rows, sourceNote, actor) {
  const monthStart = `${month}-01`;
  const insert = db.prepare(`
    INSERT INTO hydro_beneficiary_allocations
      (id, contract_id, beneficiary_name, beneficiary_id, parent_state, sr_no,
       pct_incl_free, pct_rea, is_home_state, effective_from, effective_to, source_note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    const next = db.prepare(`
      SELECT MIN(effective_from) d FROM hydro_beneficiary_allocations
      WHERE contract_id = ? AND is_active = 1 AND effective_from > ?
    `).get(contract.id, monthStart).d;
    db.prepare(`
      UPDATE hydro_beneficiary_allocations SET effective_to = ?, updated_at = datetime('now')
      WHERE contract_id = ? AND is_active = 1 AND effective_from < ?
        AND (effective_to IS NULL OR effective_to >= ?)
    `).run(dayBefore(monthStart), contract.id, monthStart, monthStart);
    db.prepare('DELETE FROM hydro_beneficiary_allocations WHERE contract_id = ? AND effective_from = ?')
      .run(contract.id, monthStart);
    for (const r of rows) {
      insert.run(newId('HBA'), contract.id, r.beneficiary_name, r.beneficiary_id, r.parent_state, r.sr_no,
        r.pct_incl_free, r.pct_rea, r.is_home_state, monthStart, next ? dayBefore(next) : null,
        sourceNote, actor?.user?.id || null);
    }
  })();
  secureLogAudit(actor, {
    action: 'HYDRO_ALLOCATION_SHEET_FROM_REA',
    module: 'REIA',
    entityType: 'hydro_beneficiary_allocations',
    entityId: contract.id,
    afterValue: { contract_no: contract.contract_no, effective_from: monthStart, rows: rows.length, source: sourceNote },
  });
}

// One account is parsed once for the stations billed from it in a run. Held
// only briefly: a month re-fetched after an amendment lands on the same path.
const parsedAccounts = new Map();
async function parseAccount(filePath, rpc) {
  const held = parsedAccounts.get(filePath);
  if (held && Date.now() - held.at < 60000) return held.parsed;
  const parsed = await reaScraper.parsePdf(filePath, rpc);
  parsedAccounts.set(filePath, { parsed, at: Date.now() });
  if (parsedAccounts.size > 12) parsedAccounts.delete(parsedAccounts.keys().next().value);
  return parsed;
}

/** Forget what has been parsed — for a caller that has just replaced a file. */
export function forgetParsedAccounts() { parsedAccounts.clear(); }

/**
 * Bring a station's allocation sheet into line with the month's REA.
 *
 * Returns what was done and why, never throws for a reason the desk can act
 * on: the bill run reads `status` to decide whether the month can be billed.
 *
 *   WRITTEN       a sheet was put in force from the first of the month
 *   UNCHANGED     the sheet in force already says what the account says
 *   DESK_SHEET    the desk entered a sheet for this month; left alone (with
 *                 `warnings` where it disagrees with the account)
 *   REFUSED       the account could not be turned into a sheet — do not bill
 *   NO_ACCOUNT / NO_ENTITLEMENT / OFF   nothing to derive from; the sheet in
 *                 force stands, as it did before this existed
 */
export async function syncAllocationFromRea(contract, month, {
  rpc = 'NRPC', dataType = null, actor = null, fetchDelhiSea = delhiSeaForMonth,
} = {}) {
  if (String(getParam('hydro_rea_auto_allocation', 'true')).toLowerCase() !== 'true') {
    return { status: 'OFF', reason: 'switched off (hydro_rea_auto_allocation)' };
  }
  const key = stationKeyFor(contract);
  const log = db.prepare(`
    SELECT * FROM rea_fetch_log
    WHERE rpc_source = ? AND period_month = ? AND status IN ('PARSED','PROCESSED')
      AND local_file_path IS NOT NULL AND (? IS NULL OR data_type = ?)
    ORDER BY fetched_at DESC, rowid DESC LIMIT 1
  `).get(rpc, month, dataType, dataType);
  if (!key || !log || !fs.existsSync(log.local_file_path) || typeof reaScraper.parsePdf !== 'function') {
    return { status: 'NO_ACCOUNT', reason: `no ${rpc} account on file for ${month} to read the entitlements from` };
  }

  let station;
  try {
    const parsed = await parseAccount(log.local_file_path, rpc);
    station = (parsed.data || []).find((s) => s.station_id === key);
  } catch (err) {
    return { status: 'NO_ENTITLEMENT', reason: `the ${month} account could not be re-read: ${err.message}` };
  }
  const entitlement = station?.entitlement_pct;
  if (!entitlement || !Object.keys(entitlement).length) {
    return { status: 'NO_ENTITLEMENT', reason: `Table C1 of the ${month} account has no row that could be read for this station` };
  }
  const account = `${rpc} ${log.data_type === 'FINAL' ? 'Final' : 'Provisional'} REA ${month}, Table C1`;

  const mismatch = checkAgainstSchedule(entitlement, station.scheduled_lu);
  if (mismatch.length) return { status: 'REFUSED', reason: `${account} does not agree with Table D2: ${mismatch.join('; ')}` };

  const monthStart = `${month}-01`;
  const inForce = rowsInForce(contract.id, monthStart);
  const own = inForce.filter((r) => r.effective_from === monthStart);
  if (own.length && !own.every(isAuto)) {
    const held = stateTotals(inForce);
    const warnings = [];
    for (const state of new Set([...Object.keys(held), ...Object.keys(entitlement)])) {
      const a = Number(held[state]) || 0;
      const b = Number(entitlement[state]) || 0;
      if (Math.abs(a - b) > SAME) warnings.push(`${state}: sheet ${a.toFixed(6)}%, ${account} ${b.toFixed(6)}%`);
    }
    return { status: 'DESK_SHEET', reason: `a sheet was entered for ${month}; it is not replaced`, warnings };
  }
  if (!inForce.length) return { status: 'REFUSED', reason: 'no allocation sheet is in force to take the billing parties from' };

  let sea = null;
  const notes = [];
  if (Number(entitlement.DELHI) > 0) {
    try {
      sea = await fetchDelhiSea(month);
    } catch (err) {
      notes.push(`Delhi SLDC's account could not be read (${err.message})`);
    }
  }
  const built = buildMonthSheet({
    prevRows: inForce,
    entitlement,
    delhiSea: sea?.stations?.[key] || null,
    rajasthanShares: parseShares(getParam('hydro_rajasthan_discom_shares', DEFAULT_RAJASTHAN_SHARES)),
  });
  notes.push(...built.notes);
  if (built.problems.length) return { status: 'REFUSED', reason: built.problems.join('; '), notes };

  const changes = describeChanges(inForce, built.rows);
  // A provisional Delhi split is written even when the figures have not moved,
  // so that it is on record as waiting for Delhi SLDC's account.
  const alreadyWaiting = own.length && String(own[0].source_note || '').includes(PROVISIONAL_DELHI);
  if (!changes.length && (!built.provisional || alreadyWaiting)) {
    return { status: 'UNCHANGED', provisional: built.provisional, notes, source: account };
  }

  const usedSea = sea?.stations?.[key] && !built.provisional && Number(entitlement.DELHI) > 0;
  const delhiNote = built.provisional
    ? `; ${PROVISIONAL_DELHI} — fixed licensee shares carried, pending Delhi SLDC's State Energy Account`
    : (usedSea ? `; Delhi split per Delhi SLDC "${sea.title}", Annexure-2` : '');
  writeSheet(contract, month, built.rows, `${AUTO_PREFIX} ${account}${delhiNote}`, actor);
  return { status: 'WRITTEN', provisional: built.provisional, changes, notes, source: account, rows: built.rows.length };
}

/**
 * Settle the Delhi splits that were carried while Delhi SLDC's account was
 * still to come.
 *
 * Each waiting sheet is checked once its account is out. Where the account
 * agrees, the sheet is marked confirmed. Where it does not, the sheet is
 * corrected — and if a bill was already drafted on the carried figures, that
 * is said plainly, because the draft is now wrong by exactly this much.
 */
export async function confirmProvisionalDelhiSplits({ actor = null, fetchDelhiSea = delhiSeaForMonth } = {}) {
  const waiting = db.prepare(`
    SELECT DISTINCT a.contract_id, a.effective_from FROM hydro_beneficiary_allocations a
    WHERE a.is_active = 1 AND a.source_note LIKE ? AND a.source_note LIKE ?
    ORDER BY a.effective_from
  `).all(`${AUTO_PREFIX}%`, `%${PROVISIONAL_DELHI}%`);
  const results = [];
  for (const w of waiting) {
    const month = w.effective_from.slice(0, 7);
    const contract = db.prepare(`
      SELECT c.*, e.name AS seller_name FROM contracts c LEFT JOIN entities e ON c.seller_id = e.id WHERE c.id = ?
    `).get(w.contract_id);
    const key = contract && stationKeyFor(contract);
    let sea;
    try { sea = await fetchDelhiSea(month); } catch (err) { results.push({ contract_no: contract?.contract_no, month, status: 'ERROR', reason: err.message }); continue; }
    const row = sea?.stations?.[key];
    if (!row) { results.push({ contract_no: contract?.contract_no, month, status: 'WAITING' }); continue; }

    const rows = db.prepare(`
      SELECT * FROM hydro_beneficiary_allocations
      WHERE contract_id = ? AND effective_from = ? AND is_active = 1 ORDER BY COALESCE(sr_no, 9999)
    `).all(w.contract_id, w.effective_from);
    const built = buildMonthSheet({
      prevRows: rows,
      entitlement: stateTotals(rows),
      delhiSea: row,
      rajasthanShares: parseShares(getParam('hydro_rajasthan_discom_shares', DEFAULT_RAJASTHAN_SHARES)),
    });
    if (built.problems.length || built.provisional) {
      results.push({ contract_no: contract.contract_no, month, status: 'DISAGREES', reason: [...built.problems, ...built.notes].join('; ') });
      continue;
    }
    const changes = describeChanges(rows, built.rows);
    const note = String(rows[0].source_note).replace(/; Delhi split provisional.*$/, '')
      + `; Delhi split per Delhi SLDC "${sea.title}", Annexure-2`;
    if (!changes.length) {
      db.prepare(`
        UPDATE hydro_beneficiary_allocations SET source_note = ?, updated_at = datetime('now')
        WHERE contract_id = ? AND effective_from = ?
      `).run(note, w.contract_id, w.effective_from);
      results.push({ contract_no: contract.contract_no, month, status: 'CONFIRMED' });
      continue;
    }
    writeSheet(contract, month, built.rows, note, actor);
    const bill = db.prepare(`
      SELECT bill_no, status FROM hydro_station_bills
      WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED' AND bill_kind IN ('PROVISIONAL','FINAL')
      ORDER BY created_at DESC LIMIT 1
    `).get(w.contract_id, month);
    results.push({ contract_no: contract.contract_no, month, status: 'CORRECTED', changes, bill: bill || null });
  }
  return results;
}
