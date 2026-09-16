/**
 * NOAR Trader API integration — bilateral application data.
 *
 * Spec: "API Implementation Guide — NOAR Platform Solution / TRADER" (PwC,
 * 24-Aug-2022) plus the NOAR_Trader_API_Collection Postman file. One endpoint
 * is published to traders today:
 *
 *   POST {base}/api/external-services-api/Report/ApplicantBilateralApplicationData
 *        ?TP_CLIENT_KEY={api_key}
 *        Authorization: Bearer {api_secret}
 *        { "FromDate": "01/12/2022", "ToDate": "31/12/2022", "isRejected": false }
 *
 * It returns SJVN's own bilateral open-access applications as NOAR holds them —
 * application number, the approval number NLDC granted, applied / approved /
 * scheduled MWh and the block-wise summaries. Read-only: NOAR publishes no
 * submit API to traders, so filing an application stays a portal activity and
 * this only tells us what the registry says about what was filed.
 *
 * WHAT IT IS FOR: the platform's own noar_status is keyed in by the desk. This
 * pull is the independent record to check it against — an approval granted days
 * ago and never entered, an approval number that disagrees, a quantum approved
 * short of what was applied for. It therefore reports differences and does NOT
 * move noar_status by itself: the numeric Status / BidStatus / CongestionStatus
 * / PaymentStatus codes are undocumented in the guide (SJVN has asked PwC for
 * the enumeration), so acting on them would be guesswork against a live
 * approval workflow. Approval numbers and MWh are plain values and are the only
 * things reconciled on.
 *
 * DATES: the request wants DD/MM/YYYY. The response mixes formats — FromDate /
 * ToDate on the application come back DD/MM/YYYY, while the block summaries
 * carry them as the integer YYYYMMDD. Both are converted to ISO on the way in.
 *
 * Without a key and secret it runs in stub mode against a payload in the
 * documented shape, so the mapping, the reconciliation and the screens can be
 * exercised before NOAR issues credentials and whitelists SJVN's IP.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';

/** Base URLs Grid India / PwC gave SJVN (mail from PwC, 15-Sep-2026). */
export const NOAR_HOSTS = {
  PRODUCTION: 'https://external.noar.in',
  TEST: 'https://devdr.noar.in:84',
};

const REPORT_PATH = '/api/external-services-api/Report/ApplicantBilateralApplicationData';

/** NOAR refuses a range wider than a month on this report; longer spans are chunked. */
export const MAX_RANGE_DAYS = 31;

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getNoarTraderConfig() {
  const environment = String(envOrParam('NOAR_API_ENV', 'noar_api_environment', 'TEST')).toUpperCase() === 'PRODUCTION'
    ? 'PRODUCTION' : 'TEST';
  // The key is a query parameter and the secret is the bearer token. Both are
  // env-first: a secret pasted into master data is visible on the Masters
  // screen to everyone who can open it.
  const apiKey = envOrParam('NOAR_API_KEY', 'noar_api_key', '');
  const apiSecret = envOrParam('NOAR_API_SECRET', 'noar_api_secret', '');
  const traderName = envOrParam('NOAR_TRADER_NAME', 'noar_trader_name', '');
  const baseUrl = (envOrParam('NOAR_API_BASE_URL', 'noar_api_base_url', '') || NOAR_HOSTS[environment]).replace(/\/$/, '');
  const enabled = String(envOrParam('NOAR_API_ENABLED', 'noar_api_enabled', 'false')).toLowerCase() === 'true';
  const timeoutMs = Number(envOrParam('NOAR_API_TIMEOUT_MS', 'noar_api_timeout_ms', '60000')) || 60000;
  return {
    environment,
    enabled,
    live: enabled && !!apiKey && !!apiSecret,
    apiKey,
    apiSecret,
    traderName,
    baseUrl,
    timeoutMs,
  };
}

/* ------------------------------------------------------------------ dates */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO (YYYY-MM-DD) to the DD/MM/YYYY the request body wants. */
export function toNoarDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Any of the date shapes NOAR returns, to ISO:
 *   "09/08/2022" (DD/MM/YYYY), 20220809 / "20220809", "2022-08-08T08:39:07.41".
 * Anything else comes back null rather than a date invented from it.
 */
export function parseNoarDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (ISO_RE.test(s.slice(0, 10)) && (s.length === 10 || s[10] === 'T' || s[10] === ' ')) return s.slice(0, 10);
  return null;
}

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from, to) => Math.round(
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
);

/** Split [from, to] into windows of at most MAX_RANGE_DAYS days. */
export function splitRange(fromDate, toDate, maxDays = MAX_RANGE_DAYS) {
  const out = [];
  let start = fromDate;
  while (daysBetween(start, toDate) >= 0) {
    const end = daysBetween(start, toDate) + 1 > maxDays ? addDays(start, maxDays - 1) : toDate;
    out.push({ fromDate: start, toDate: end });
    start = addDays(end, 1);
  }
  return out;
}

/* ------------------------------------------------------------------- call */

/**
 * One call to ApplicantBilateralApplicationData.
 * @param {string}  fromDate  ISO
 * @param {string}  toDate    ISO
 * @param {boolean} isRejected  NOAR returns rejected applications only when true
 */
export async function fetchBilateralApplications({ fromDate, toDate, isRejected = false } = {}) {
  const cfg = getNoarTraderConfig();
  const body = { FromDate: toNoarDate(fromDate), ToDate: toNoarDate(toDate), isRejected: !!isRejected };

  if (!cfg.live) {
    return {
      ok: true,
      mode: 'STUB',
      request: body,
      data: stubResponse(fromDate, toDate, isRejected),
      note: 'NOAR Trader API not configured (needs noar_api_enabled, NOAR_API_KEY, NOAR_API_SECRET) — returning a sample in the documented response shape.',
    };
  }

  const url = `${cfg.baseUrl}${REPORT_PATH}?TP_CLIENT_KEY=${encodeURIComponent(cfg.apiKey)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        ...(cfg.traderName ? { Name: cfg.traderName } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const text = await resp.text();
    if (!resp.ok) {
      // 401 here is as likely to be the IP whitelist as the credentials —
      // NOAR whitelists the caller's public IP alongside issuing the key.
      const hint = resp.status === 401
        ? ' — check the API key/secret and that SJVN\'s outbound IP is whitelisted at NOAR'
        : '';
      return { ok: false, mode: cfg.environment, error: `HTTP ${resp.status}: ${text.slice(0, 300)}${hint}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, mode: cfg.environment, error: `Response was not JSON: ${text.slice(0, 200)}` };
    }
    const status = responseStatus(data);
    if (status.code && status.code !== 'NOAR-200') {
      return { ok: false, mode: cfg.environment, error: `${status.code}: ${status.message || 'NOAR rejected the request'}` };
    }
    return { ok: true, mode: cfg.environment, request: body, data };
  } catch (err) {
    return { ok: false, mode: cfg.environment, error: err.name === 'TimeoutError' ? `NOAR did not respond within ${cfg.timeoutMs} ms` : err.message };
  }
}

/** Code/Message sit inside ResponseStatus in the guide and beside ResponseBody in the sample. */
function responseStatus(payload) {
  const s = payload?.ResponseStatus || payload || {};
  return { code: s.Code || payload?.Code || null, message: s.Message || payload?.Message || null };
}

/* -------------------------------------------------------------- normalise */

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function mapSummary(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: num(r.Id),
    from_date: parseNoarDate(r.FromDate),
    to_date: parseNoarDate(r.ToDate),
    from_block: num(r.FromBlock),
    to_block: num(r.ToBlock),
    mw: num(r.Mw),
    mwh: num(r.Mwh),
    application_id: num(r.ApplicationId),
    revision_no: num(r.RevisionNo),
  }));
}

/** One SLDCApplicationDashboard element to the row we store. */
export function normalizeApplication(raw, { isRejected = false } = {}) {
  return {
    noar_app_id: num(raw.Id),
    application_no: raw.ApplicationNo || null,
    revision_no: num(raw.RevisionNo) ?? 0,
    applicant_id: raw.ApplicantId || null,
    applicant_name: raw.ApplicantName || null,
    seller_id: raw.SellerId || null,
    seller_name: raw.SellerName || null,
    seller_state_id: num(raw.SellerStateId),
    buyer_id: raw.BuyerId || null,
    buyer_name: raw.BuyerName || null,
    buyer_state_id: num(raw.BuyerStateId),
    from_date: parseNoarDate(raw.FromDate),
    to_date: parseNoarDate(raw.ToDate),
    primary_route: raw.PrimaryRouteName || null,
    alternate_route: raw.AlternateRouteName || null,
    is_alternate_route_enabled: raw.IsAlternateRouteEnabled ? 1 : 0,
    re_type_id: num(raw.ReTypeId),
    created_on: parseNoarDate(raw.CreatedOn),
    applied_mwh: num(raw.AppliedMWH),
    approved_mwh: num(raw.ApprovedMWH),
    scheduled_mwh: num(raw.ScheduledMWH),
    // Undocumented enumerations — stored as received, never interpreted.
    bid_status: num(raw.BidStatus),
    congestion_status: num(raw.CongestionStatus),
    status_code: num(raw.Status),
    payment_status: num(raw.PaymentStatus),
    approval_no: raw.ApprovalNo || null,
    is_rejected: isRejected ? 1 : 0,
    approved_summary: mapSummary(raw.ApplicationApprovedSummary),
    applied_summary: mapSummary(raw.ApplicationAppliedSummary),
    raw,
  };
}

/** The applications in a response, whatever wrapper NOAR used. */
export function extractApplications(payload, { isRejected = false } = {}) {
  const body = payload?.ResponseBody ?? payload?.responseBody ?? [];
  const list = Array.isArray(body) ? body : [body];
  return list.filter((r) => r && (r.ApplicationNo || r.Id)).map((r) => normalizeApplication(r, { isRejected }));
}

/* ---------------------------------------------------------------- persist */

/**
 * Match a NOAR application to the bilateral transaction it belongs to.
 *
 * Application number first — that is what SJVN files under and what the desk
 * records. The approval number is the fallback for a transaction whose
 * application number was never keyed in but whose approval was.
 */
export function matchTransaction(app) {
  if (app.application_no) {
    const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE noar_application_no = ?').get(app.application_no);
    if (tx) return { tx, matched_on: 'application_no' };
  }
  if (app.approval_no) {
    const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE noar_contract_no = ?').get(app.approval_no);
    if (tx) return { tx, matched_on: 'approval_no' };
  }
  return { tx: null, matched_on: null };
}

/** Insert or refresh one application. Keyed on (application_no, revision_no). */
function upsertApplication(app, { transactionId, environment }) {
  const existing = db.prepare(
    'SELECT id FROM noar_api_applications WHERE application_no = ? AND revision_no = ?',
  ).get(app.application_no, app.revision_no);
  const row = {
    id: existing?.id || newId('NAA'),
    noar_app_id: app.noar_app_id,
    application_no: app.application_no,
    revision_no: app.revision_no,
    applicant_id: app.applicant_id,
    applicant_name: app.applicant_name,
    seller_id: app.seller_id,
    seller_name: app.seller_name,
    seller_state_id: app.seller_state_id,
    buyer_id: app.buyer_id,
    buyer_name: app.buyer_name,
    buyer_state_id: app.buyer_state_id,
    from_date: app.from_date,
    to_date: app.to_date,
    primary_route: app.primary_route,
    alternate_route: app.alternate_route,
    is_alternate_route_enabled: app.is_alternate_route_enabled,
    re_type_id: app.re_type_id,
    created_on: app.created_on,
    applied_mwh: app.applied_mwh,
    approved_mwh: app.approved_mwh,
    scheduled_mwh: app.scheduled_mwh,
    bid_status: app.bid_status,
    congestion_status: app.congestion_status,
    status_code: app.status_code,
    payment_status: app.payment_status,
    approval_no: app.approval_no,
    is_rejected: app.is_rejected,
    transaction_id: transactionId,
    approved_summary_json: JSON.stringify(app.approved_summary),
    applied_summary_json: JSON.stringify(app.applied_summary),
    raw_json: JSON.stringify(app.raw),
    source_env: environment,
  };
  db.prepare(`
    INSERT INTO noar_api_applications (
      id, noar_app_id, application_no, revision_no, applicant_id, applicant_name,
      seller_id, seller_name, seller_state_id, buyer_id, buyer_name, buyer_state_id,
      from_date, to_date, primary_route, alternate_route, is_alternate_route_enabled,
      re_type_id, created_on, applied_mwh, approved_mwh, scheduled_mwh,
      bid_status, congestion_status, status_code, payment_status, approval_no,
      is_rejected, transaction_id, approved_summary_json, applied_summary_json,
      raw_json, source_env, synced_at
    ) VALUES (
      @id, @noar_app_id, @application_no, @revision_no, @applicant_id, @applicant_name,
      @seller_id, @seller_name, @seller_state_id, @buyer_id, @buyer_name, @buyer_state_id,
      @from_date, @to_date, @primary_route, @alternate_route, @is_alternate_route_enabled,
      @re_type_id, @created_on, @applied_mwh, @approved_mwh, @scheduled_mwh,
      @bid_status, @congestion_status, @status_code, @payment_status, @approval_no,
      @is_rejected, @transaction_id, @approved_summary_json, @applied_summary_json,
      @raw_json, @source_env, datetime('now')
    )
    ON CONFLICT(application_no, revision_no) DO UPDATE SET
      noar_app_id = excluded.noar_app_id,
      applicant_id = excluded.applicant_id,
      applicant_name = excluded.applicant_name,
      seller_id = excluded.seller_id,
      seller_name = excluded.seller_name,
      seller_state_id = excluded.seller_state_id,
      buyer_id = excluded.buyer_id,
      buyer_name = excluded.buyer_name,
      buyer_state_id = excluded.buyer_state_id,
      from_date = excluded.from_date,
      to_date = excluded.to_date,
      primary_route = excluded.primary_route,
      alternate_route = excluded.alternate_route,
      is_alternate_route_enabled = excluded.is_alternate_route_enabled,
      re_type_id = excluded.re_type_id,
      created_on = excluded.created_on,
      applied_mwh = excluded.applied_mwh,
      approved_mwh = excluded.approved_mwh,
      scheduled_mwh = excluded.scheduled_mwh,
      bid_status = excluded.bid_status,
      congestion_status = excluded.congestion_status,
      status_code = excluded.status_code,
      payment_status = excluded.payment_status,
      approval_no = excluded.approval_no,
      is_rejected = excluded.is_rejected,
      transaction_id = excluded.transaction_id,
      approved_summary_json = excluded.approved_summary_json,
      applied_summary_json = excluded.applied_summary_json,
      raw_json = excluded.raw_json,
      source_env = excluded.source_env,
      synced_at = datetime('now')
  `).run(row);
  return { id: row.id, created: !existing };
}

/**
 * Keep the NOAR Approvals report (noar_approval_entries) in step with what the
 * registry returned. Only applications carrying an approval number land there —
 * that report is a list of approvals, not of everything filed.
 */
function upsertApprovalEntry(app) {
  if (!app.approval_no) return false;
  const existing = db.prepare(
    'SELECT id FROM noar_approval_entries WHERE application_no = ? ORDER BY created_at DESC LIMIT 1',
  ).get(app.application_no);
  if (existing) {
    db.prepare(`
      UPDATE noar_approval_entries
      SET applicant_name = ?, seller_name = ?, buyer_name = ?, from_date = ?, to_date = ?,
          applied_capacity_mwh = ?, approved_capacity_mwh = ?, approval_no = ?
      WHERE id = ?
    `).run(
      app.applicant_name || '', app.seller_name || '', app.buyer_name || '',
      app.from_date || '', app.to_date || '',
      app.applied_mwh ?? 0, app.approved_mwh ?? 0, app.approval_no, existing.id,
    );
    return false;
  }
  db.prepare(`
    INSERT INTO noar_approval_entries (
      id, application_no, applicant_name, seller_name, buyer_name,
      from_date, to_date, applied_capacity_mwh, approved_capacity_mwh,
      approval_no, approval_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId('NAR'), app.application_no, app.applicant_name || '', app.seller_name || '', app.buyer_name || '',
    app.from_date || '', app.to_date || '', app.applied_mwh ?? 0, app.approved_mwh ?? 0,
    app.approval_no,
    // NOAR does not publish an approval date on this report; leaving it blank
    // is honest, inventing the sync date would not be.
    '',
  );
  return true;
}

/**
 * What NOAR says versus what the platform holds, for one application.
 *
 * Only facts are compared — is the application on our books at all, does the
 * approval number agree, was less approved than applied for, is it rejected at
 * NOAR while open here. The numeric status codes are not compared because the
 * guide never defines them.
 */
export function differencesFor(app, tx) {
  const out = [];
  if (!tx) {
    out.push({
      kind: 'NOT_ON_PLATFORM',
      detail: `NOAR has application ${app.application_no} (${app.seller_name || '?'} → ${app.buyer_name || '?'}) with no matching bilateral transaction`,
    });
    return out;
  }
  if (app.approval_no && !tx.noar_contract_no) {
    out.push({ kind: 'APPROVAL_NOT_RECORDED', detail: `NOAR approval ${app.approval_no} is not recorded against ${tx.id}`, noar: app.approval_no, platform: null });
  } else if (app.approval_no && tx.noar_contract_no && app.approval_no !== tx.noar_contract_no) {
    out.push({ kind: 'APPROVAL_NO_MISMATCH', detail: `NOAR approval ${app.approval_no} differs from ${tx.noar_contract_no} on ${tx.id}`, noar: app.approval_no, platform: tx.noar_contract_no });
  }
  if (app.approval_no && tx.noar_status !== 'APPROVED') {
    out.push({ kind: 'STATUS_BEHIND', detail: `NOAR carries an approval number; platform status is ${tx.noar_status}`, noar: 'APPROVED', platform: tx.noar_status });
  }
  if (app.is_rejected && tx.noar_status !== 'REJECTED') {
    out.push({ kind: 'REJECTED_AT_NOAR', detail: `NOAR returned this application as rejected; platform status is ${tx.noar_status}`, noar: 'REJECTED', platform: tx.noar_status });
  }
  if (app.applied_mwh != null && app.approved_mwh != null && app.approved_mwh < app.applied_mwh) {
    out.push({
      kind: 'PARTIAL_APPROVAL',
      detail: `NOAR approved ${app.approved_mwh} MWh against ${app.applied_mwh} MWh applied`,
      noar: app.approved_mwh,
      platform: app.applied_mwh,
    });
  }
  return out;
}

/**
 * Pull a date range and land it.
 *
 * Two passes: live applications, then — unless turned off — the rejected ones,
 * which NOAR only returns when isRejected is true. Ranges longer than a month
 * are chunked. Nothing on bilateral_transactions is written; the desk moves
 * noar_status itself after looking at the differences this reports.
 */
export async function syncBilateralApplications({
  fromDate, toDate, includeRejected = true, dryRun = false,
} = {}) {
  if (!ISO_RE.test(String(fromDate)) || !ISO_RE.test(String(toDate))) {
    return { ok: false, error: 'from_date and to_date (YYYY-MM-DD) are required' };
  }
  if (daysBetween(fromDate, toDate) < 0) {
    return { ok: false, error: 'from_date must not be after to_date' };
  }

  const cfg = getNoarTraderConfig();
  const windows = splitRange(fromDate, toDate);
  const passes = includeRejected ? [false, true] : [false];

  const applications = [];
  const errors = [];
  let note = null;

  for (const w of windows) {
    for (const isRejected of passes) {
      const res = await fetchBilateralApplications({ ...w, isRejected });
      if (!res.ok) {
        errors.push({ ...w, is_rejected: isRejected, error: res.error });
        continue;
      }
      note = note || res.note || null;
      applications.push(...extractApplications(res.data, { isRejected }));
    }
  }

  // A window that failed outright must not read as "nothing was filed".
  if (errors.length && !applications.length) {
    return { ok: false, error: errors[0].error, errors, mode: cfg.live ? cfg.environment : 'STUB' };
  }

  const results = [];
  let created = 0;
  let updated = 0;
  let approvalsWritten = 0;

  const persist = db.transaction(() => {
    for (const app of applications) {
      const { tx, matched_on } = matchTransaction(app);
      const differences = differencesFor(app, tx);
      if (!dryRun) {
        const r = upsertApplication(app, { transactionId: tx?.id || null, environment: cfg.live ? cfg.environment : 'STUB' });
        if (r.created) created += 1; else updated += 1;
        if (upsertApprovalEntry(app)) approvalsWritten += 1;
      }
      results.push({
        application_no: app.application_no,
        revision_no: app.revision_no,
        approval_no: app.approval_no,
        seller_name: app.seller_name,
        buyer_name: app.buyer_name,
        from_date: app.from_date,
        to_date: app.to_date,
        applied_mwh: app.applied_mwh,
        approved_mwh: app.approved_mwh,
        scheduled_mwh: app.scheduled_mwh,
        is_rejected: !!app.is_rejected,
        transaction_id: tx?.id || null,
        matched_on,
        differences,
      });
    }
  });
  persist();

  return {
    ok: true,
    mode: cfg.live ? cfg.environment : 'STUB',
    from_date: fromDate,
    to_date: toDate,
    windows: windows.length,
    include_rejected: includeRejected,
    applications_received: applications.length,
    matched: results.filter((r) => r.transaction_id).length,
    unmatched: results.filter((r) => !r.transaction_id).length,
    rows_created: created,
    rows_updated: updated,
    approvals_written: approvalsWritten,
    differences: results.filter((r) => r.differences.length),
    applications: results,
    errors,
    dry_run: dryRun,
    note,
  };
}

/* ------------------------------------------------------------------- stub */

/**
 * A response in the documented shape. The application and approval numbers are
 * read off a real transaction where one exists, so a stub sync exercises the
 * matching path instead of always landing in "unmatched".
 */
function stubResponse(fromDate, toDate, isRejected) {
  const tx = db.prepare(`
    SELECT noar_application_no, noar_contract_no, counterparty, quantum_mw
    FROM bilateral_transactions
    WHERE noar_application_no IS NOT NULL AND noar_application_no <> ''
    ORDER BY created_at DESC LIMIT 1
  `).get();
  const appliedMwh = 1488;
  const approvedMwh = isRejected ? 0 : appliedMwh;
  // A rejected application is a different application, not the same one seen
  // twice: NOAR returns the two sets from two calls and they do not overlap.
  const applicationNo = isRejected
    ? 'SJVN010826WR999'
    : (tx?.noar_application_no || 'SJVN010822WR001');
  const compact = (iso) => String(iso).replace(/-/g, '');
  const summary = [{
    Id: 141547,
    FromDate: Number(compact(fromDate)),
    ToDate: Number(compact(toDate)),
    FromBlock: 1,
    ToBlock: 96,
    Mw: 62,
    Mwh: appliedMwh,
    ApplicationId: 0,
    RevisionNo: 0,
  }];
  return {
    ResponseBody: [{
      Id: 11434,
      ApplicationNo: applicationNo,
      ApplicantId: '86b6945f-6dac-47d0-a7f2-c40736c33bc9',
      ApplicantName: 'SJVN LIMITED',
      SellerId: '8f4a5aed-cd86-4c5a-ba56-e760c5c1baf6',
      BuyerId: 'eb87f5eb-a4f4-4fbc-9bce-3e72ec0ef4f2',
      BuyerStateId: 10,
      SellerStateId: 2,
      SellerName: 'SJVN LIMITED',
      BuyerName: tx?.counterparty || 'BSES YAMUNA POWER LIMITED',
      FromDate: toNoarDate(fromDate),
      ToDate: toNoarDate(toDate),
      PrimaryRouteId: 21,
      PrimaryRouteName: 'NR-WR-SR',
      AlternateRouteId: 0,
      AlternateRouteName: '',
      ReTypeId: 0,
      CreatedOn: `${fromDate}T08:39:07.411619`,
      RevisionNo: 0,
      AppliedMWH: appliedMwh,
      ApprovedMWH: approvedMwh,
      ScheduledMWH: approvedMwh,
      BidStatus: 0,
      CongestionStatus: 30,
      ApprovalNo: isRejected ? '' : (tx?.noar_contract_no || 'NR/2026/3641/D'),
      IsAlternateRouteEnabled: 0,
      Status: isRejected ? 60 : 50,
      PaymentStatus: 0,
      ApplicationApprovedSummary: isRejected ? [] : summary,
      ApplicationAppliedSummary: summary,
    }],
    Code: 'NOAR-200',
    Message: 'Get SLDC Application dashboardView has been executed successfully',
  };
}
