/**
 * SAP Gateway client for the REIA FI posting service (ZCB_FI_REIA_SRV).
 *
 * The service takes the Dr/Cr lines of one invoice as one `$batch` changeset
 * and stores them in SAP for the FI posting run; a GET filtered on Timestamp
 * and Belnr reads them back with the FI document number once SAP has posted.
 *
 * Plain HTTP(S) with Basic auth, no SAP SDK. A write needs a CSRF token, and
 * the token is bound to the session cookie it was issued with, so both are
 * fetched together and sent back on every write.
 *
 * Configured from the environment only (backend/.env):
 *   SAP_ODATA_ENABLED  true to call SAP at all
 *   SAP_ODATA_URL      service root, e.g.
 *                      http://sjvneds.sjvn.co.in:53000/sap/opu/odata/sap/ZCB_FI_REIA_SRV
 *   SAP_CLIENT         SAP client (mandant), e.g. 200
 *   SAP_USER / SAP_PASSWORD
 *
 * There is no stub mode: without configuration every call fails and says so,
 * so a screen never shows a booking SAP did not make.
 *
 * SEEN LIVE (EDS client 200, 28-Oct-2026):
 *   - ReversalEntry and Flag are Edm.Boolean: send false/true, not "" / "X".
 *   - Budat and Aedat come back null until SAP has posted the invoice.
 *   - Pushing the same Timestamp + Belnr twice is refused with
 *     "This invoice push (Timestamp + Belnr) is already in SAP".
 */

const TIMEOUT_MS = 30000;

export function sapConfig() {
  const url = String(process.env.SAP_ODATA_URL || '').trim().replace(/\/+$/, '');
  const user = String(process.env.SAP_USER || '').trim();
  const password = String(process.env.SAP_PASSWORD || '');
  const client = String(process.env.SAP_CLIENT || '').trim();
  const enabled = String(process.env.SAP_ODATA_ENABLED || '').toLowerCase() === 'true';
  const missing = [];
  if (!enabled) missing.push('SAP_ODATA_ENABLED=true');
  if (!url) missing.push('SAP_ODATA_URL');
  if (!user) missing.push('SAP_USER');
  if (!password) missing.push('SAP_PASSWORD');
  return { url, user, password, client, ready: missing.length === 0, missing };
}

// What a network error code means, for the person reading the message.
const NET_ERRORS = {
  ECONNREFUSED: 'nothing answers on that port',
  ENOTFOUND: 'host name not found',
  EAI_AGAIN: 'host name not found (DNS)',
  ETIMEDOUT: 'the connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  ECONNRESET: 'the connection was cut',
  UND_ERR_SOCKET: 'the connection was cut',
  EHOSTUNREACH: 'no network route to the host',
};

function fail(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function requireConfig() {
  const cfg = sapConfig();
  if (!cfg.ready) {
    throw fail(`SAP is not configured on this server: set ${cfg.missing.join(', ')} in backend/.env`, 400);
  }
  return cfg;
}

function urlFor(cfg, path, query = {}) {
  const u = new URL(`${cfg.url}/${path}`);
  if (cfg.client) u.searchParams.set('sap-client', cfg.client);
  // $filter is built by hand: URLSearchParams would encode the spaces as '+',
  // which Gateway does not read as a space inside $filter.
  let s = u.toString();
  const extra = Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/'/g, '%27')}`)
    .join('&');
  if (extra) s += (s.includes('?') ? '&' : '?') + extra;
  return s;
}

function authHeader(cfg) {
  return `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`;
}

async function call(cfg, url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const code = err.cause?.code;
    const why = err.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000}s` : (NET_ERRORS[code] || code || err.message);
    // No answer is not a refusal: a write may have reached SAP all the same.
    throw Object.assign(fail(`Could not reach SAP at ${new URL(cfg.url).host}: ${why}`), { noAnswer: true });
  }
  if (res.status === 401) throw fail('SAP refused the user or password (HTTP 401)');
  if (res.status === 403) throw fail('SAP user is not authorised for this service (HTTP 403)');
  return res;
}

/** The text of an OData error body, or the raw body when it is not one. */
export function odataErrorText(body) {
  try {
    const j = typeof body === 'string' ? JSON.parse(body) : body;
    return j?.error?.message?.value || j?.error?.message || String(body).slice(0, 300);
  } catch {
    const m = String(body).match(/<message[^>]*>([^<]*)<\/message>/);
    return m ? m[1] : String(body).slice(0, 300);
  }
}

/** A CSRF token and the session cookies it belongs to. */
export async function openSession() {
  const cfg = requireConfig();
  const res = await call(cfg, urlFor(cfg, ''), {
    headers: { Authorization: authHeader(cfg), 'x-csrf-token': 'Fetch', Accept: 'application/json' },
  });
  if (!res.ok) throw fail(`SAP service did not answer (HTTP ${res.status}): ${odataErrorText(await res.text())}`);
  const token = res.headers.get('x-csrf-token');
  if (!token) throw fail('SAP did not issue a CSRF token');
  const cookies = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cfg, token, cookies };
}

/** Is the service there, and does it let this user in? Reads only. */
export async function ping() {
  const cfg = requireConfig();
  const res = await call(cfg, urlFor(cfg, '', { $format: 'json' }), {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw fail(`SAP service did not answer (HTTP ${res.status}): ${odataErrorText(text)}`);
  let sets = [];
  try { sets = JSON.parse(text)?.d?.EntitySets || []; } catch { /* not JSON */ }
  return { ok: true, host: new URL(cfg.url).host, client: cfg.client || null, entity_sets: sets };
}

/** A `$batch` body holding one changeset that creates every entity given. */
export function buildBatch(entitySet, entities, stamp = Date.now()) {
  const batch = `batch_${stamp}`;
  const changeset = `changeset_${stamp}`;
  const CRLF = '\r\n';
  const parts = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${changeset}`, ''];
  for (const e of entities) {
    parts.push(
      `--${changeset}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      `POST ${entitySet} HTTP/1.1`,
      'Content-Type: application/json',
      'Accept: application/json',
      '',
      JSON.stringify(e),
      '',
    );
  }
  parts.push(`--${changeset}--`, `--${batch}--`, '');
  return { boundary: batch, body: parts.join(CRLF) };
}

/**
 * What a `$batch` answer says about its changeset.
 *
 * The envelope is 202 even when the changeset failed; the verdict is in the
 * HTTP status lines inside it. A failed changeset answers with one error part
 * in place of its operations.
 */
export function readBatchResponse(text) {
  const statuses = [...String(text).matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
  const failed = statuses.find((s) => s >= 400);
  if (!statuses.length) return { ok: false, statuses, error: 'SAP answered the batch without any result' };
  if (failed) {
    // Gateway writes the error body as one line of JSON.
    const line = String(text).split(/\r?\n/).find((l) => l.trim().startsWith('{"error"'));
    return { ok: false, statuses, error: odataErrorText(line ? line.trim() : text) };
  }
  return { ok: true, statuses, created: statuses.filter((s) => s === 201).length };
}

/** Send one invoice's lines as one changeset. All go in, or none. */
export async function postChangeset(session, entitySet, entities) {
  const { cfg, token, cookies } = session;
  const { boundary, body } = buildBatch(entitySet, entities);
  const res = await call(cfg, urlFor(cfg, '$batch'), {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'x-csrf-token': token,
      ...(cookies ? { Cookie: cookies } : {}),
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
      Accept: 'multipart/mixed',
    },
    body,
  });
  const text = await res.text();
  if (res.status !== 202 && res.status !== 200) {
    return { ok: false, statuses: [res.status], error: `HTTP ${res.status}: ${odataErrorText(text)}` };
  }
  return readBatchResponse(text);
}

/** Read lines back from SAP. `filter` is a ready OData $filter expression. */
export async function readEntities(entitySet, filter) {
  const cfg = requireConfig();
  const res = await call(cfg, urlFor(cfg, entitySet, { $filter: filter, $format: 'json' }), {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw fail(`SAP read failed (HTTP ${res.status}): ${odataErrorText(text)}`);
  return JSON.parse(text)?.d?.results || [];
}
