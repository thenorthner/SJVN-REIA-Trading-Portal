/**
 * SMS delivery via the TextGuru gateway.
 *
 * Mirrors mailService: when the gateway is configured and SMS is switched on it
 * sends for real; otherwise it writes the message to backend/outbox/ so the
 * flow can be built and tested without credentials. Credentials come from env
 * or master data — never from code.
 *
 * ── What TRAI's DLT regime requires of everything below ────────────────────
 *
 * Under TCCCPR 2018 an Indian operator scrubs every commercial SMS against the
 * content template its principal entity registered on the DLT platform. Three
 * things follow, and all three are enforced here rather than left to callers:
 *
 *   1. The registered template's id travels with the message. A send without
 *      one is dropped by the operator, silently — the gateway still answers
 *      200. templateIdFor() resolves it from master data, so the ids can be
 *      entered once DLT returns them without a code change.
 *   2. The fixed text must match the registered template character for
 *      character. sanitizeSmsText() maps the characters a developer types by
 *      habit — an en-dash, a rupee sign, a curly quote — onto the GSM-7 forms
 *      the templates are registered with. Without it a stray em-dash both
 *      fails the match and silently halves the per-segment length, because a
 *      single non-GSM character pushes the whole message into UCS-2.
 *   3. Each variable is capped, 30 characters by default. smsVar() truncates,
 *      so a long rejection reason or a forty-character DISCOM name cannot fail
 *      the scrub at send time.
 */
import fs from 'fs';
import path from 'path';
import { getParam } from '../mastersService.js';

/** Default cap on one DLT variable. The portals allow this to be raised per
 *  template; until one is, the conservative figure is what we hold to. */
export const DLT_VAR_MAX = 30;

/**
 * Characters that are not in the GSM-7 alphabet, mapped to the forms the DLT
 * templates are registered with. One of these in a body would otherwise both
 * break the template match and force UCS-2 encoding, cutting a segment from
 * 160 characters to 70 and roughly doubling the cost of every message.
 */
const GSM7_SUBSTITUTIONS = [
  [/[\u2010-\u2015]/g, '-'],   // hyphens, en-dash, em-dash, horizontal bar
  [/[\u2018\u2019\u201B]/g, "'"], // curly single quotes
  [/[\u201C\u201D]/g, '"'],     // curly double quotes
  [/\u2026/g, '...'],           // ellipsis
  [/\u20B9/g, 'Rs'],            // rupee sign
  [/[\u00A0\u2007\u202F]/g, ' '], // non-breaking / figure / narrow spaces
  [/[\u2022\u00B7]/g, '-'],     // bullets
  [/\u2122/g, 'TM'],
  [/[\u00D7]/g, 'x'],
];

/**
 * Put a message into the character set the registered template uses.
 *
 * This is not cosmetic. The body that leaves here has to equal the registered
 * fixed text once variables are substituted, so the same normalisation has to
 * run on every path — including the retry sweep, which re-sends a body stored
 * before this existed.
 */
export function sanitizeSmsText(raw) {
  let text = String(raw ?? '');
  for (const [pattern, replacement] of GSM7_SUBSTITUTIONS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * One DLT variable: sanitized, and cut to the registered length.
 *
 * Call this on anything a person typed or a counterparty is named by — a
 * rejection reason, a cancellation reason, a DISCOM's full legal name. An
 * over-long variable fails the scrub, and it fails it at send time, on the one
 * message that mattered.
 */
export function smsVar(value, max = DLT_VAR_MAX) {
  const text = sanitizeSmsText(value);
  if (text.length <= max) return text;
  // An ellipsis would itself be three of the characters we are trying to save,
  // so the cut is plain.
  return `${text.slice(0, max - 1).trimEnd()}.`;
}

/**
 * The DLT content-template id registered for an event.
 *
 * Held in master data (sms_dlt_template_ids) as {EVENT: "id"}, because the ids
 * are issued by the DLT portal after this code ships. Null until one is
 * entered — see sendSms() for what that means.
 */
export function templateIdFor(event) {
  if (!event) return null;
  try {
    const map = getParam('sms_dlt_template_ids', null);
    const parsed = typeof map === 'string' ? JSON.parse(map) : map;
    const id = parsed && parsed[event];
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

const OUTBOX_DIR = path.join(process.cwd(), 'outbox');

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getSmsConfig() {
  const apiKey = envOrParam('TEXTGURU_API_KEY', 'textguru_api_key', '');
  const senderId = envOrParam('TEXTGURU_SENDER', 'textguru_sender_id', '');
  const baseUrl = envOrParam('TEXTGURU_URL', 'textguru_url', 'https://www.textguru.in/api/');
  // The gateway is only "live" when explicitly enabled AND keyed. Either off
  // and it stays in outbox mode, so a stray true can't start billing SMS.
  const enabled = String(envOrParam('SMS_ENABLED', 'sms_enabled', 'false')) === 'true';
  return { enabled, live: enabled && !!apiKey, apiKey, senderId, baseUrl };
}

/**
 * Reduce a number to the 10-digit Indian mobile the gateway expects, dropping
 * +91/91/0 prefixes and any spacing. Returns null if it is not a plausible
 * 10-digit mobile, so junk never reaches the gateway.
 */
export function normalizeInPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let n = digits;
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  else if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

function ensureOutbox() {
  if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  return OUTBOX_DIR;
}

/**
 * @param {{ to: string, text: string, event?: string, templateId?: string }} opts
 *   event      — the notification event, used to look the DLT template id up
 *                when the caller does not pass one outright
 *   templateId — an explicit DLT content-template id, which wins over the lookup
 * @returns {Promise<{ ok: boolean, mode: string, to?: string, provider_ref?: string, error?: string }>}
 */
export async function sendSms(opts) {
  const cfg = getSmsConfig();
  const to = normalizeInPhone(opts.to);
  if (!to) return { ok: false, mode: 'NONE', error: `Not a valid Indian mobile number: ${opts.to}` };
  // Normalised here rather than at the call sites, so every path — including
  // the retry sweep re-sending a body stored before this existed — puts the
  // same characters on the wire as the registered template carries.
  const text = sanitizeSmsText(opts.text);
  if (!text) return { ok: false, mode: 'NONE', error: 'Empty SMS body' };
  const templateId = opts.templateId || templateIdFor(opts.event);

  if (cfg.live) {
    // A live send with no registered template is not a send. The operator
    // scrubs it and drops it, and TextGuru still answers 200 — so the delivery
    // log would record a message that reached nobody as SENT. Refuse it here
    // instead, naming the event whose template is missing.
    if (!templateId) {
      return {
        ok: false,
        mode: 'TEXTGURU',
        to,
        error: `No DLT content template registered for ${opts.event || 'this message'}. `
          + 'Add its id to the sms_dlt_template_ids master parameter; an unregistered '
          + 'message is scrubbed by the operator and never delivered.',
      };
    }
    try {
      const params = new URLSearchParams({
        APIKEY: cfg.apiKey,
        senderid: cfg.senderId,
        number: to,
        message: text,
        format: 'json',
      });
      params.set('templateid', templateId);
      const resp = await fetch(`${cfg.baseUrl}?${params.toString()}`);
      const body = await resp.text();
      if (!resp.ok) return { ok: false, mode: 'TEXTGURU', to, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
      // TextGuru echoes a message id / status string; keep it as the provider ref.
      return { ok: true, mode: 'TEXTGURU', to, provider_ref: body.slice(0, 120) };
    } catch (err) {
      return { ok: false, mode: 'TEXTGURU', to, error: err.message };
    }
  }

  // Dev / not-yet-configured fallback: record the SMS in the outbox.
  const dir = ensureOutbox();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const metaPath = path.join(dir, `${stamp}_SMS_${to}.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    at: new Date().toISOString(),
    mode: 'FILE_OUTBOX',
    channel: 'SMS',
    to,
    sender_id: cfg.senderId || null,
    event: opts.event || null,
    template_id: templateId,
    text,
    note: cfg.enabled
      ? 'SMS enabled but textguru_api_key not set — written to outbox instead of sent.'
      : 'SMS disabled (sms_enabled != true) — written to outbox instead of sent.',
    // Said while it is still cheap to fix. Once the gateway is keyed this same
    // message is refused rather than written here.
    dlt_warning: templateId ? null
      : `No DLT content template registered for ${opts.event || 'this message'} — it would be refused once the gateway is live.`,
  }, null, 2));

  return { ok: true, mode: 'FILE_OUTBOX', to, provider_ref: path.basename(metaPath) };
}
