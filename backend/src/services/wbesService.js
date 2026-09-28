/**
 * NOAR / State WBES (Energy Scheduling Platform) integration.
 *
 * Pulls approved 15-minute block-wise schedules for open-access transactions
 * and lands them in bilateral_schedules, which until now had to be keyed in by
 * hand. Read-only: the platform exposes Get Schedule Data / Get Latest Revision
 * No / Get All Revisions — there is no submit API, so Format-D and the NOAR
 * application itself stay a portal activity tracked in our own workflow.
 *
 * Without an API key it runs in stub mode against a recorded-shape sample, so
 * the mapping and the sync can be built and tested before credentials arrive.
 *
 * ACCESS (Grid India, 28-Sep-2026). They supplied the endpoint URL
 *   https://gateway.grid-india.in/POSOCO/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData?apikey=
 * and the username `usr_SJVNL`. Note what that URL is: the whole endpoint, not a
 * base — so normaliseBaseUrl() below strips the path and query back to
 * `https://gateway.grid-india.in/POSOCO`. Pasted whole into wbes_base_url it
 * would otherwise build a URL with the path twice over and a stray `apikey=`.
 *
 * THE ACRONYM IS NOT CONFIRMED. Asked for the registered utility acronym they
 * answered "SJVN Limited", which is the entity's name; every acronym in the
 * guide is a token (`BIHAR_STATE`, `BSPHCL`, `NEA_Bihar`), the username they
 * issued is `usr_SJVNL`, and ISET's own block-wise report calls the trader
 * `SJVNL`. So `SJVNL` is the likely value and "SJVN Limited" the likely
 * misreading of the question — but a wrong acronym returns an empty list, which
 * reads exactly like "no schedule was published that day". That is the one
 * failure this integration must never guess at, so nothing is assumed: the probe
 * tries the candidates and whichever the gateway accepts gets configured.
 *
 * GetLatestFullSchdRevNo (guide 3.2) takes only { Date, UserName } — no acronym
 * — which makes it the honest first call: it proves the URL, the key, the
 * username and the whitelisting all at once, and cannot be confused by the
 * acronym question.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';

/** A delivery day is 96 fifteen-minute blocks. */
export const BLOCKS_PER_DAY = 96;

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

/**
 * The base a WBES URL is built from, whatever form it was configured in.
 *
 * Grid India hand out the full endpoint URL — path, `?apikey=` and all — and
 * that is what lands in a config field asking for a "base URL". Taken literally
 * it produces
 *   .../GetUtilityExternalSharedData?apikey=/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData
 * which fails as a 404 that looks like the gateway being wrong rather than us.
 * So anything from `/reports/` onward is cut, along with any query string.
 */
export function normaliseBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutQuery = raw.split(/[?#]/)[0];
  const cut = withoutQuery.replace(/\/reports\/.*$/i, '');
  return cut.replace(/\/+$/, '');
}

export function getWbesConfig() {
  const apiKey = envOrParam('WBES_API_KEY', 'wbes_api_key', '');
  const baseUrl = normaliseBaseUrl(envOrParam('WBES_BASE_URL', 'wbes_base_url', ''));
  const userName = envOrParam('WBES_USERNAME', 'wbes_username', '');
  const utility = envOrParam('WBES_UTILITY_ACRONYM', 'wbes_utility_acronym', '');
  const enabled = String(envOrParam('WBES_ENABLED', 'wbes_enabled', 'false')) === 'true';
  // The guide accepts the key either as the X-API-Key header or as an `apikey`
  // query parameter, and Grid India handed us the query form. Both are sent by
  // default: they carry the same value, and a gateway that routes on one of them
  // must not be met with the other. Set WBES_KEY_IN_QUERY=false to stop putting
  // a credential in a URL once we know the header alone is honoured.
  const keyInQuery = String(envOrParam('WBES_KEY_IN_QUERY', 'wbes_key_in_query', 'true')) !== 'false';
  return { enabled, live: enabled && !!apiKey && !!baseUrl, apiKey, baseUrl, userName, utility, keyInQuery };
}

/** Block index (0-based) to the 15-minute window it covers, e.g. "00:15-00:30". */
export function blockLabel(index) {
  const startMin = index * 15;
  const endMin = startMin + 15;
  const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${fmt(startMin)}-${fmt(endMin)}`;
}

const API_PREFIX = '/reports/1.0/WebAccessAPI';

/** A WBES endpoint URL, with the key in the query when that form is enabled. */
function wbesUrl(cfg, endpoint) {
  const url = `${cfg.baseUrl}${API_PREFIX}/${endpoint}`;
  return cfg.keyInQuery ? `${url}?apikey=${encodeURIComponent(cfg.apiKey)}` : url;
}

/**
 * A failure that happened before any HTTP status existed.
 *
 * The Grid India gateway does not refuse an unregistered address with a 403 — it
 * accepts the TCP connection and then drops it mid-handshake. Measured from a
 * non-whitelisted address on 28-Sep-2026: port 443 opens, the client sends its
 * 1559-byte ClientHello, reads back zero bytes, and no certificate is ever
 * served. Node surfaces that as a flat "fetch failed", which reads like the
 * gateway being down and sends someone to check the key.
 *
 * It is worth naming because of what it implies: from an unregistered address the
 * API key is never transmitted at all, so nothing about the credential, the
 * username or the acronym can be tested until the IP is registered.
 */
function describeTransportError(err) {
  const msg = String(err?.message || err);
  const cause = String(err?.cause?.code || err?.cause?.message || '');
  const handshakeDied = /fetch failed|socket hang ?up|ECONNRESET|EPROTO|SSL|TLS/i.test(`${msg} ${cause}`);
  if (handshakeDied) {
    return `${msg}${cause ? ` (${cause})` : ''} — the connection was dropped before a reply. The Grid India gateway accepts the TCP connection from an unregistered address and then closes it during the TLS handshake, so this is what "our IP is not whitelisted" looks like: the API key is never even sent. Have 49.50.97.173 registered at the gateway before treating this as an outage.`;
  }
  return msg;
}

/**
 * WBES answers its own failures with HTTP 200 and a WBES-4xx inside the body —
 * "API Access Validation Failed" for a key, username or IP it does not accept
 * (guide 3.2). Read only the HTTP status and that reads as success with no data,
 * which for a schedule means "nothing was scheduled that day". Hence this.
 */
function readStatus(payload) {
  const st = payload?.ResponseStatus;
  const code = st?.Code ?? null;
  if (!code || String(code) === 'WBES-200') return null;
  const detail = [st?.Message, ...(Array.isArray(st?.DetailsList) ? st.DetailsList : [])]
    .filter(Boolean).join('; ');
  return `${code}${detail ? `: ${detail}` : ''}`;
}

/** WBES wants the delivery date as DD-MM-YYYY; we store ISO everywhere else. */
const toWbesDate = (iso) => {
  const [y, m, d] = String(iso).split('-');
  return `${d}-${m}-${y}`;
};

/**
 * Fetch one day's schedule payload.
 * @param {string} date        ISO delivery date (YYYY-MM-DD)
 * @param {number} revisionNo  -1 for the latest revision
 */
export async function fetchScheduleData(date, revisionNo = -1) {
  const cfg = getWbesConfig();
  const body = {
    Date: toWbesDate(date),
    SchdRevNo: revisionNo,
    UserName: cfg.userName,
    UtilAcronymList: cfg.utility ? [cfg.utility] : [],
  };

  if (!cfg.live) {
    return { ok: true, mode: 'STUB', request: body, data: stubResponse(date), note: 'WBES not configured (needs wbes_enabled, wbes_api_key, wbes_base_url) — returning a sample of the documented response shape.' };
  }

  try {
    const resp = await fetch(wbesUrl(cfg, 'GetUtilityExternalSharedData'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': cfg.apiKey },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, mode: 'WBES', error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const data = JSON.parse(text);
    const refused = readStatus(data);
    if (refused) return { ok: false, mode: 'WBES', request: body, error: `WBES refused the request — ${refused}` };
    return { ok: true, mode: 'WBES', request: body, data };
  } catch (err) {
    return { ok: false, mode: 'WBES', error: describeTransportError(err) };
  }
}

/**
 * The latest full-schedule revision number for a day (guide 3.2).
 *
 * Worth having for its own sake — a revision number is how we know a schedule we
 * already hold has been superseded — but its real value is that it takes only a
 * date and a username. No acronym, no parsing: whatever it answers is about the
 * URL, the key, the username and the whitelisting, and nothing else.
 */
export async function fetchLatestRevisionNo(date) {
  const cfg = getWbesConfig();
  const body = { Date: toWbesDate(date), UserName: cfg.userName };
  if (!cfg.live) {
    return { ok: true, mode: 'STUB', request: body, revision_no: 1, note: 'WBES not configured (needs wbes_enabled, wbes_api_key, wbes_base_url) — returning a sample revision number.' };
  }
  try {
    const resp = await fetch(wbesUrl(cfg, 'GetLatestFullSchdRevNo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': cfg.apiKey },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, mode: 'WBES', error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const data = JSON.parse(text);
    const refused = readStatus(data);
    if (refused) return { ok: false, mode: 'WBES', request: body, error: `WBES refused the request — ${refused}` };
    return { ok: true, mode: 'WBES', request: body, revision_no: data?.ResponseBody ?? null };
  } catch (err) {
    return { ok: false, mode: 'WBES', error: describeTransportError(err) };
  }
}

/**
 * Flatten the nested response into one row per open-access schedule line.
 * Only OA schedules are taken — ISGS and URS lines belong to other flows.
 */
export function extractOaSchedules(payload) {
  const rb = payload?.ResponseBody || {};
  const out = [];
  for (const group of rb.GroupWiseDataList || []) {
    for (const line of group.FullschdList || []) {
      const oa = line.FullScheduleData?.OAFullScheduleJsonData;
      if (!oa || !Array.isArray(oa.SchdAmount)) continue;
      out.push({
        utility: group.Acronym,
        approval_no: line.ApprovalNo || null,
        seller: line.SellerAcronym || null,
        buyer: line.BuyerAcronym || null,
        trader: line.TraderAcronym || null,
        schedule_type: line.EnergyScheduleTypeName || null,
        revision_no: rb.FullSchdRevisionNo ?? null,
        published_at: rb.SchedulePublishedTime || null,
        blocks: oa.SchdAmount,
        injection_loss: oa.POCInjectionLoss || null,
      });
    }
  }
  return out;
}

/**
 * Sync one delivery day into bilateral_schedules.
 *
 * Lines are matched to a transaction by ApprovalNo == noar_contract_no. A line
 * with no matching contract is reported as unmatched rather than guessed at or
 * silently dropped — attaching a schedule to the wrong deal would corrupt both
 * the delivery record and the DSM that follows from it.
 *
 * Re-running for the same date replaces that date's rows for the matched
 * transactions, so a later revision supersedes an earlier one without
 * duplicating blocks.
 */
export async function syncSchedulesForDate(date, { revisionNo = -1, dryRun = false } = {}) {
  const res = await fetchScheduleData(date, revisionNo);
  if (!res.ok) return { ok: false, date, error: res.error, mode: res.mode };

  const lines = extractOaSchedules(res.data);
  const matched = [];
  const unmatched = [];

  for (const line of lines) {
    const tx = line.approval_no
      ? db.prepare('SELECT id, counterparty FROM bilateral_transactions WHERE noar_contract_no = ?').get(line.approval_no)
      : null;
    if (!tx) { unmatched.push({ approval_no: line.approval_no, seller: line.seller, buyer: line.buyer }); continue; }
    matched.push({ line, tx });
  }

  let blocksWritten = 0;
  if (!dryRun && matched.length) {
    const del = db.prepare('DELETE FROM bilateral_schedules WHERE transaction_id = ? AND schedule_date = ?');
    const ins = db.prepare(`
      INSERT INTO bilateral_schedules (id, transaction_id, schedule_date, time_block, approved_mw, status)
      VALUES (?, ?, ?, ?, ?, 'APPROVED')
    `);
    db.transaction(() => {
      for (const { line, tx } of matched) {
        del.run(tx.id, date);
        line.blocks.slice(0, BLOCKS_PER_DAY).forEach((mw, i) => {
          ins.run(newId('BSC'), tx.id, date, blockLabel(i), Number(mw) || 0);
          blocksWritten += 1;
        });
      }
    })();
  }

  return {
    ok: true,
    date,
    mode: res.mode,
    revision_no: lines[0]?.revision_no ?? null,
    lines_received: lines.length,
    matched: matched.map((m) => ({
      transaction_id: m.tx.id,
      counterparty: m.tx.counterparty,
      approval_no: m.line.approval_no,
      blocks: Math.min(m.line.blocks.length, BLOCKS_PER_DAY),
      total_mw: Math.round(m.line.blocks.reduce((a, b) => a + (Number(b) || 0), 0) * 100) / 100,
    })),
    unmatched,
    blocks_written: blocksWritten,
    dry_run: dryRun,
    note: res.note,
  };
}

/**
 * A response in the documented shape, used until credentials exist. The
 * approval number is read from a real transaction so a stub sync actually
 * exercises the matching path rather than always landing in "unmatched".
 */
function stubResponse(date) {
  const tx = db.prepare("SELECT noar_contract_no, counterparty FROM bilateral_transactions WHERE noar_contract_no IS NOT NULL AND noar_contract_no <> '' LIMIT 1").get();
  // A plausible flat-ish day: 40 MW off-peak, 60 MW through the evening peak.
  const blocks = Array.from({ length: BLOCKS_PER_DAY }, (_, i) => (i >= 68 && i < 88 ? 60 : 40));
  return {
    ResponseBody: {
      Date: toWbesDate(date),
      FullSchdRevisionNo: 1,
      ScheduleRemarks: 'stub sample',
      SchedulePublishedTime: `${date}T10:00:00`,
      GroupWiseDataList: [{
        Acronym: getWbesConfig().utility || 'SJVN_STATE',
        FullschdList: [{
          EnergyScheduleTypeName: 'OA_GNA',
          SellerAcronym: 'SJVN',
          BuyerAcronym: tx?.counterparty || 'BUYER',
          TraderAcronym: 'SJVN',
          ApprovalNo: tx?.noar_contract_no || null,
          FullScheduleData: {
            ISGSFullScheduleJsonData: null,
            URSFullScheduleJsonData: null,
            OAFullScheduleJsonData: {
              SchdAmount: blocks,
              POCInjectionLoss: Array.from({ length: BLOCKS_PER_DAY }, () => 0),
            },
          },
        }],
      }],
    },
  };
}
