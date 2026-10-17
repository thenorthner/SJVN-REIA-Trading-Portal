/**
 * CERC Intelligence (Batch 4, 17-Oct-2026).
 *
 * CERC4  The annual Form-IV built from the twelve monthly returns of the
 *        financial year: each month's lines copied in, totals rolled up, and
 *        the annual figures set against the sum of the monthlies so a
 *        difference is caught before the annual return is filed.
 * CERC5  Licence category watch: the year's traded volume against the upper
 *        limit of SJVN's licence category, warned at cerc_category_warn_pct
 *        (85%) and over it — with the run-rate for the year.
 */
import db from '../db/index.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { getParam, getParamNumber } from '../mastersService.js';
import { getLines, insertLine, refreshTotals, resolvePeriod, dueDateFor } from './cercFormIv.js';

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const r2 = (v, d = 4) => Math.round((Number(v) || 0) * 10 ** d) / 10 ** d;
const FIELDS = ['total_volume_mu', 'total_revenue', 'total_purchase_cost', 'trading_margin', 'line_count', 'breach_count'];

function monthsOf(fy) {
  const y = Number(String(fy).slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; return `${m >= 4 ? y : y + 1}-${String(m).padStart(2, '0')}`; });
}

/** Where a financial year stands: its monthlies, their sum, and the annual return against it. */
export function annualPosition(fy) {
  if (!/^\d{4}-\d{2}$/.test(String(fy))) throw err(400, 'The financial year is written 2026-27');
  const months = monthsOf(fy).map((period) => {
    const f = db.prepare("SELECT * FROM cerc_form_iv WHERE period_type = 'MONTHLY' AND period = ?").get(period);
    return { period, id: f?.id || null, form_no: f?.form_no || null, status: f?.status || 'MISSING', reference_no: f?.reference_no || null, filed_outside: !!f?.filed_outside, ...Object.fromEntries(FIELDS.map((k) => [k, f ? Number(f[k]) || 0 : 0])) };
  });
  const sum = Object.fromEntries(FIELDS.map((k) => [k, r2(months.reduce((t, m) => t + m[k], 0), k === 'total_volume_mu' ? 4 : 2)]));
  const annual = db.prepare("SELECT * FROM cerc_form_iv WHERE period_type = 'ANNUAL' AND period = ?").get(fy);
  const differences = annual ? FIELDS.filter((k) => Math.abs((Number(annual[k]) || 0) - sum[k]) > (k === 'total_volume_mu' ? 0.0001 : 1))
    .map((k) => ({ field: k, annual: Number(annual[k]) || 0, monthlies: sum[k] })) : [];
  const notFiled = months.filter((m) => m.status !== 'SUBMITTED').map((m) => m.period);
  return {
    fy, months, sum, not_filed: notFiled, ready: notFiled.length === 0,
    annual: annual ? { id: annual.id, form_no: annual.form_no, status: annual.status, ...Object.fromEntries(FIELDS.map((k) => [k, Number(annual[k]) || 0])) } : null,
    differences,
  };
}

/** Build (or rebuild, while not filed) the annual return from the twelve filed monthlies. */
export function rollUpAnnual(fy, { user, req = null } = {}) {
  const pos = annualPosition(fy);
  if (!pos.ready) throw err(400, `The annual return is built from the twelve filed monthlies; not yet filed: ${pos.not_filed.join(', ')}.`, { not_filed: pos.not_filed });
  let form = db.prepare("SELECT * FROM cerc_form_iv WHERE period_type = 'ANNUAL' AND period = ?").get(fy);
  if (form?.status === 'SUBMITTED') throw err(409, `The annual return for ${fy} is already filed (${form.reference_no || form.form_no}).`);
  db.transaction(() => {
    if (!form) {
      const window = resolvePeriod('ANNUAL', fy);
      const id = newId('FIV');
      const seq = (db.prepare('SELECT COUNT(*) c FROM cerc_form_iv').get().c || 0) + 1;
      db.prepare(`INSERT INTO cerc_form_iv (id, form_no, period_type, period, due_date, status, notes, created_by) VALUES (?, ?, 'ANNUAL', ?, ?, 'DRAFT', ?, ?)`)
        .run(id, `FORM-IV/${fy}/${String(seq).padStart(3, '0')}`, fy, dueDateFor(window.to, 'ANNUAL'), 'Rolled up from the twelve filed monthly returns', user?.name || null);
      form = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(id);
    } else {
      db.prepare('DELETE FROM cerc_form_iv_lines WHERE form_id = ?').run(form.id);
    }
    let n = 0;
    for (const m of pos.months) {
      for (const l of getLines(m.id)) {
        n += 1;
        insertLine(form.id, { ...l, line_no: n, remarks: [l.remarks, `from ${m.form_no}`].filter(Boolean).join(' · ') });
      }
    }
    db.prepare("UPDATE cerc_form_iv SET generated_at = datetime('now') WHERE id = ?").run(form.id);
    refreshTotals(form.id);
  })();
  logAudit({ req, user, action: 'FORM_IV_ANNUAL_ROLLED_UP', module: 'TRADING', entityType: 'cerc_form_iv', entityId: form.id, details: { fy } });
  return annualPosition(fy);
}

/** CERC5: this year's volume against the licence category's upper limit. */
export function categoryWatch({ asOf = new Date() } = {}) {
  const today = new Date(asOf.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [y, m] = today.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const limit = Number(getParam('cerc_licence_category_limit_mu', '')) || null;
  const warnPct = getParamNumber('cerc_category_warn_pct', 85);
  const rows = db.prepare(`SELECT period, total_volume_mu FROM cerc_form_iv WHERE period_type = 'MONTHLY' AND period >= ? AND period <= ?`).all(`${startYear}-04`, `${startYear + 1}-03`);
  const volume = r2(rows.reduce((t, x) => t + (Number(x.total_volume_mu) || 0), 0));
  const monthsCounted = rows.filter((x) => Number(x.total_volume_mu) > 0).length;
  const projected = monthsCounted ? r2((volume / monthsCounted) * 12) : null;
  const pct = limit ? r2((volume / limit) * 100, 1) : null;
  const state = !limit ? 'NO_LIMIT' : volume >= limit ? 'OVER' : pct >= warnPct ? 'WARN' : projected != null && projected >= limit ? 'PROJECTED_OVER' : 'OK';
  return { fy, category: getParam('cerc_licence_category', 'I') || 'I', limit_mu: limit, warn_pct: warnPct, volume_mu: volume, months_counted: monthsCounted, pct_of_limit: pct, projected_mu: projected, state };
}

/** Tell the trading desk and compliance once per year and state reached. */
export function alertCategoryWatch() {
  const w = categoryWatch();
  if (!['WARN', 'OVER', 'PROJECTED_OVER'].includes(w.state)) return { sent: 0, watch: w };
  const key = `CERC category watch ${w.fy} ${w.state}`;
  if (db.prepare('SELECT 1 FROM notifications WHERE type = ? AND message LIKE ?').get('CERC_CATEGORY', `${key}%`)) return { sent: 0, watch: w };
  const message = `${key}: ${w.volume_mu} MU traded against the Category ${w.category} limit of ${w.limit_mu} MU (${w.pct_of_limit}%)${w.projected_mu != null ? `; at this rate the year ends near ${w.projected_mu} MU` : ''}. ${w.state === 'OVER' ? 'The licence category is exceeded — apply to move up and pay the higher fee.' : 'Plan the move to a higher category before the limit is crossed.'}`;
  for (const role of ['TRADING_USER', 'SJVN_ADMIN', 'MANAGEMENT', 'COMPLIANCE_AUDITOR']) pushNotification({ role, type: 'CERC_CATEGORY', message });
  return { sent: 1, watch: w };
}
